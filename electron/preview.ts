// 窗口预览捕获：koffi 枚举精确关联进程 → GDI BitBlt 截取窗口屏幕区域
// 相比 desktopCapturer：不依赖 WGC（RDP/虚拟化会话可用），按进程精确匹配、无全量枚举
// 实时性由渲染层 hover 期间定时轮询近似（约 800ms 刷新一次）
import koffi from "koffi";

// ---- Win32 绑定（自包含，惰性初始化，与 main.ts 共享 koffi 全局类型注册表） ----
let _u32: any = null, _k32: any = null, _gdi32: any = null;
let _EnumWindows: any = null, _IsWindowVisible: any = null, _IsIconic: any = null;
let _GetWindowTextLengthW: any = null, _GetWindowTextW: any = null;
let _GetWindowThreadProcessId: any = null, _OpenProcess: any = null;
let _QueryFullProcessImageNameW: any = null, _CloseHandle: any = null;
let _GetWindowRect: any = null;
let _GetDC: any = null, _ReleaseDC: any = null;
let _CreateCompatibleDC: any = null, _CreateCompatibleBitmap: any = null;
let _SelectObject: any = null, _DeleteDC: any = null, _DeleteObject: any = null;
let _BitBlt: any = null, _GetDIBits: any = null;
let _WNDENUMPROC: any = null;
let _BITMAPINFO: any = null;

const SRCCOPY = 0x00CC0020;
const BI_RGB = 0;
const DIB_RGB_COLORS = 0;

// 注册 koffi 全局类型（幂等：已存在则跳过，避免与 main.ts 的同名注册冲突）
function ensureKoffiTypes(): boolean {
  try {
    const type = (name: string, def: () => void): void => {
      try { koffi.type(name); } catch { def(); }
    };
    type('DWORD', () => koffi.alias('DWORD', 'uint32_t'));
    type('WORD', () => koffi.alias('WORD', 'uint16_t'));
    type('BOOL', () => koffi.alias('BOOL', 'int32_t'));
    type('INT', () => koffi.alias('INT', 'int32_t'));
    type('LONG', () => koffi.alias('LONG', 'int32_t'));
    type('UINT', () => koffi.alias('UINT', 'uint32_t'));
    type('HWND', () => koffi.pointer('HWND', koffi.opaque()));
    type('HANDLE', () => koffi.pointer('HANDLE', koffi.opaque()));
    type('HDC', () => koffi.pointer('HDC', koffi.opaque()));
    type('HBITMAP', () => koffi.pointer('HBITMAP', koffi.opaque()));
    type('HGDIOBJ', () => koffi.pointer('HGDIOBJ', koffi.opaque()));
    type('RECT', () => koffi.struct('RECT', { left: 'LONG', top: 'LONG', right: 'LONG', bottom: 'LONG' }));
    type('BITMAPINFOHEADER', () => koffi.struct('BITMAPINFOHEADER', {
      biSize: 'DWORD', biWidth: 'LONG', biHeight: 'LONG',
      biPlanes: 'WORD', biBitCount: 'WORD', biCompression: 'DWORD',
      biSizeImage: 'DWORD', biXPelsPerMeter: 'LONG', biYPelsPerMeter: 'LONG',
      biClrUsed: 'DWORD', biClrImportant: 'DWORD',
    }));
    type('BITMAPINFO', () => koffi.struct('BITMAPINFO', { bmiHeader: 'BITMAPINFOHEADER', bmiColors: 'uint32' }));
    try { _WNDENUMPROC = koffi.type('WNDENUMPROC'); } catch {
      _WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(intptr hwnd, intptr lParam)');
    }
    return true;
  } catch {
    return false;
  }
}

let win32Ready = false;
function initWin32(): boolean {
  if (win32Ready) return true;
  if (!ensureKoffiTypes()) return false;
  try {
    _u32 = koffi.load("user32.dll");
    _k32 = koffi.load("kernel32.dll");
    _gdi32 = koffi.load("gdi32.dll");
    const cbPtr = koffi.pointer(_WNDENUMPROC);
    _EnumWindows = _u32.func('EnumWindows', 'bool', [cbPtr, 'intptr']);
    _IsWindowVisible = _u32.func('BOOL __stdcall IsWindowVisible(HWND hWnd)');
    _IsIconic = _u32.func('BOOL __stdcall IsIconic(HWND hWnd)');
    _GetWindowTextLengthW = _u32.func('INT __stdcall GetWindowTextLengthW(HWND hWnd)');
    _GetWindowTextW = _u32.func('INT __stdcall GetWindowTextW(HWND hWnd, _Out_ char16_t *lpString, INT nMaxCount)');
    _GetWindowThreadProcessId = _u32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)');
    _GetWindowRect = _u32.func('BOOL __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *lpRect)');
    _GetDC = _u32.func('HDC __stdcall GetDC(HWND hWnd)');
    _ReleaseDC = _u32.func('int __stdcall ReleaseDC(HWND hWnd, HDC hDC)');
    _OpenProcess = _k32.func('HANDLE __stdcall OpenProcess(DWORD dwDesiredAccess, BOOL bInheritHandle, DWORD dwProcessId)');
    _QueryFullProcessImageNameW = _k32.func('BOOL __stdcall QueryFullProcessImageNameW(HANDLE hProcess, DWORD dwFlags, _Out_ char16_t *lpExeName, _Inout_ DWORD *lpdwSize)');
    _CloseHandle = _k32.func('BOOL __stdcall CloseHandle(HANDLE hObject)');
    _CreateCompatibleDC = _gdi32.func('HDC __stdcall CreateCompatibleDC(HDC hdc)');
    _CreateCompatibleBitmap = _gdi32.func('HBITMAP __stdcall CreateCompatibleBitmap(HDC hdc, int w, int h)');
    _SelectObject = _gdi32.func('HGDIOBJ __stdcall SelectObject(HDC hdc, HGDIOBJ h)');
    _DeleteDC = _gdi32.func('BOOL __stdcall DeleteDC(HDC hdc)');
    _DeleteObject = _gdi32.func('BOOL __stdcall DeleteObject(HGDIOBJ h)');
    _BitBlt = _gdi32.func('BOOL __stdcall BitBlt(HDC hdcDest, int xDest, int yDest, int wDest, int hDest, HDC hdcSrc, int xSrc, int ySrc, DWORD rop)');
    _GetDIBits = _gdi32.func('int __stdcall GetDIBits(HDC hdc, HBITMAP hbm, UINT start, UINT cLines, _Out_ void *lpvBits, _In_ BITMAPINFO *lpbmi, UINT usage)');
    win32Ready = true;
    return true;
  } catch {
    return false;
  }
}

function getProcessPath(pid: number): string {
  try {
    const h = _OpenProcess(0x1000, 0, pid);
    if (!h) return '';
    try {
      const sizePtr = [1024];
      const buf = Buffer.allocUnsafe(1024 * 2);
      const ok = _QueryFullProcessImageNameW(h, 0, buf, sizePtr);
      if (ok && sizePtr[0] > 0) return koffi.decode(buf, 'char16_t', sizePtr[0]);
      return '';
    } finally { _CloseHandle(h); }
  } catch { return ''; }
}

interface VisibleWin { hwnd?: number; name: string; path: string; title: string; minimized?: boolean; rect?: { left: number; top: number; right: number; bottom: number } }

/** 枚举可见窗口（含进程名/路径/标题/最小化状态/屏幕矩形） */
export async function getVisibleWindowProcesses(): Promise<VisibleWin[]> {
  if (!initWin32()) return [];
  const wins: VisibleWin[] = [];
  const cb = koffi.register((hwnd: any, _lParam: any) => {
    if (!_IsWindowVisible(hwnd)) return true;
    const len = _GetWindowTextLengthW(hwnd);
    if (len <= 0) return true;
    let title = '';
    try {
      const buf = Buffer.allocUnsafe((len + 1) * 2);
      const n = _GetWindowTextW(hwnd, buf, len + 1);
      if (n > 0) title = koffi.decode(buf, 'char16_t', n);
    } catch { title = ''; }
    let pid = 0;
    try {
      const ptr = [null];
      _GetWindowThreadProcessId(hwnd, ptr);
      pid = ptr[0] || 0;
    } catch {}
    const path = getProcessPath(pid);
    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    try { _GetWindowRect(hwnd, rect); } catch {}
    let name = '';
    if (path) name = (path.replace(/\\/g, '/').split('/').pop() || '').replace(/\.exe$/i, '');
    if (!name) name = 'proc' + pid;
    wins.push({ hwnd: Number(hwnd), name, path, title, minimized: !!_IsIconic(hwnd), rect });
    return true;
  }, koffi.pointer(_WNDENUMPROC));
  try { _EnumWindows(cb, 0); } catch { /* ignore */ }
  koffi.unregister(cb);
  return wins;
}

/** GDI 截取屏幕某矩形区域 → BMP dataURL（不依赖 WGC，RDP/虚拟化会话可用） */
function gdiCaptureRect(left: number, top: number, width: number, height: number, maxWidth: number, maxHeight: number): string | null {
  try {
    if (width <= 0 || height <= 0) return null;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    const dw = Math.max(1, Math.round(width * scale));
    const dh = Math.max(1, Math.round(height * scale));
    const screenDC = _GetDC(0);
    if (!screenDC) return null;
    const memDC = _CreateCompatibleDC(screenDC);
    if (!memDC) { _ReleaseDC(0, screenDC); return null; }
    const hbmp = _CreateCompatibleBitmap(screenDC, dw, dh);
    if (!hbmp) { _DeleteDC(memDC); _ReleaseDC(0, screenDC); return null; }
    const oldObj = _SelectObject(memDC, hbmp);
    _BitBlt(memDC, 0, 0, dw, dh, screenDC, left, top, SRCCOPY);

    const bmi = koffi.alloc("BITMAPINFO", 1);
    koffi.encode(bmi, 0, "BITMAPINFO", {
      bmiHeader: {
        biSize: 40, biWidth: dw, biHeight: dh, biPlanes: 1, biBitCount: 32,
        biCompression: BI_RGB, biSizeImage: dw * dh * 4,
        biXPelsPerMeter: 0, biYPelsPerMeter: 0, biClrUsed: 0, biClrImportant: 0,
      },
      bmiColors: 0,
    });
    const pixels = Buffer.alloc(dw * dh * 4);
    _GetDIBits(memDC, hbmp, 0, dh, pixels, bmi, DIB_RGB_COLORS);
    koffi.free(bmi);
    _SelectObject(memDC, oldObj);
    _DeleteObject(hbmp);
    _DeleteDC(memDC);
    _ReleaseDC(0, screenDC);
    return buildBmpDataUrl(pixels, dw, dh);
  } catch {
    return null;
  }
}

/** 32bpp 像素（bottom-up）→ BMP dataURL */
function buildBmpDataUrl(pixels: Buffer, width: number, height: number): string {
  const rowSize = width * 4;
  const dataSize = rowSize * height;
  const headerSize = 54;
  const file = Buffer.alloc(headerSize + dataSize);
  file.write('BM', 0, 'ascii');
  file.writeUInt32LE(headerSize + dataSize, 2);
  file.writeUInt32LE(0, 6);
  file.writeUInt32LE(headerSize, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(32, 28);
  file.writeUInt32LE(BI_RGB, 30);
  file.writeUInt32LE(dataSize, 34);
  pixels.copy(file, headerSize, 0, dataSize);
  return "data:image/bmp;base64," + file.toString('base64');
}

/** 进程别名归一化（与 main.ts 保持一致）：Steam 新 UI 主窗口是 steamwebhelper.exe（CEF） */
const EXE_ALIAS: Record<string, string> = { steamwebhelper: "steam", gameoverlayui: "steam" };
function normalizeExeName(n: string): string {
  const k = String(n).toLowerCase();
  return EXE_ALIAS[k] ?? k;
}

/**
 * 捕获匹配进程名的窗口画面（GDI 截取窗口屏幕区域，最多 4 个窗口）。
 * UWP 窗口的进程名恒为 applicationframehost，其可辨识名是窗口标题（与 main.ts 运行枚举的 name=title 映射一致）。
 * 遮挡说明：截取的是屏幕当前画面，窗口被完全遮挡时显示最上层内容。
 */
export async function captureWindowPreviews(appName: string): Promise<Array<{ title: string; dataUrl: string }>> {
  if (!initWin32()) return [];
  try {
    const name = String(appName || '').toLowerCase();
    if (!name) return [];
    const wins = (await getVisibleWindowProcesses()).filter(w => {
      if (!w.hwnd || w.minimized) return false;
      if (normalizeExeName(w.name) === normalizeExeName(name)) return true;
      // UWP：进程名 applicationframehost + 标题匹配（main.ts 将 name 替换为 title.slice(0,60)）
      if (w.name.toLowerCase() === 'applicationframehost') {
        const t = (w.title || '').slice(0, 60).toLowerCase();
        if (t === name) return true;
      }
      return false;
    });
    if (!wins.length) return [];
    const out: Array<{ title: string; dataUrl: string }> = [];
    for (const w of wins) {
      if (out.length >= 4) break;
      if (!w.rect) continue;
      const dataUrl = gdiCaptureRect(w.rect.left, w.rect.top, w.rect.right - w.rect.left, w.rect.bottom - w.rect.top, 360, 240);
      if (dataUrl) out.push({ title: w.title, dataUrl });
    }
    return out;
  } catch {
    return [];
  }
}
