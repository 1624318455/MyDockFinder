// 任务进度：koffi 原生双通道探测（标题正则 + 进度条控件读取），替代纯 PowerShell 标题匹配
// 覆盖：文件复制对话框、下载管理器、播放器等带标准 msctls_progress32 控件的窗口
import koffi from "koffi";

let _u32: any = null, _k32: any = null;
let _EnumWindows: any = null, _EnumChildWindows: any = null, _IsWindowVisible: any = null;
let _GetWindowTextLengthW: any = null, _GetWindowTextW: any = null;
let _GetClassNameW: any = null, _GetWindowThreadProcessId: any = null;
let _OpenProcess: any = null, _QueryFullProcessImageNameW: any = null, _CloseHandle: any = null;
let _SendMessageTimeoutW: any = null;
let _PBRANGE: any = null, _WNDENUMPROC: any = null, _ChildEnumPtr: any = null;

const PBM_GETRANGE = 0x0407; // WM_USER+7
const PBM_GETPOS = 0x0408;   // WM_USER+8
const SMTO_ABORTIFHUNG = 0x2;

function ensureKoffiTypes(): boolean {
  try {
    const type = (name: string, def: () => void): void => {
      try { koffi.type(name); } catch { def(); }
    };
    type('DWORD', () => koffi.alias('DWORD', 'uint32_t'));
    type('BOOL', () => koffi.alias('BOOL', 'int32_t'));
    type('INT', () => koffi.alias('INT', 'int32_t'));
    type('UINT', () => koffi.alias('UINT', 'uint32_t'));
    type('HWND', () => koffi.pointer('HWND', koffi.opaque()));
    type('HANDLE', () => koffi.pointer('HANDLE', koffi.opaque()));
    type('WPARAM', () => koffi.alias('WPARAM', 'uintptr_t'));
    type('LPARAM', () => koffi.alias('LPARAM', 'intptr_t'));
    type('LRESULT', () => koffi.alias('LRESULT', 'intptr_t'));
    type('PBRANGE', () => koffi.struct('PBRANGE', { iLow: 'INT', iHigh: 'INT' }));
    try { koffi.type('WNDENUMPROC'); } catch {
      koffi.proto('bool __stdcall WNDENUMPROC(intptr hwnd, intptr lParam)');
    }
    _WNDENUMPROC = koffi.type('WNDENUMPROC');
    _ChildEnumPtr = koffi.pointer(_WNDENUMPROC);
    return true;
  } catch {
    return false;
  }
}

let ready = false;
function initProgress(): boolean {
  if (ready) return true;
  if (!ensureKoffiTypes()) return false;
  try {
    _u32 = koffi.load("user32.dll");
    _k32 = koffi.load("kernel32.dll");
    _EnumWindows = _u32.func('EnumWindows', 'bool', [_ChildEnumPtr, 'intptr']);
    _EnumChildWindows = _u32.func('EnumChildWindows', 'bool', ['HWND', _ChildEnumPtr, 'intptr']);
    _IsWindowVisible = _u32.func('BOOL __stdcall IsWindowVisible(HWND hWnd)');
    _GetWindowTextLengthW = _u32.func('INT __stdcall GetWindowTextLengthW(HWND hWnd)');
    _GetWindowTextW = _u32.func('INT __stdcall GetWindowTextW(HWND hWnd, _Out_ char16_t *lpString, INT nMaxCount)');
    _GetClassNameW = _u32.func('INT __stdcall GetClassNameW(HWND hWnd, _Out_ char16_t *lpClassName, INT nMaxCount)');
    _GetWindowThreadProcessId = _u32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)');
    _OpenProcess = _k32.func('HANDLE __stdcall OpenProcess(DWORD dwDesiredAccess, BOOL bInheritHandle, DWORD dwProcessId)');
    _QueryFullProcessImageNameW = _k32.func('BOOL __stdcall QueryFullProcessImageNameW(HANDLE hProcess, DWORD dwFlags, _Out_ char16_t *lpExeName, _Inout_ DWORD *lpdwSize)');
    _CloseHandle = _k32.func('BOOL __stdcall CloseHandle(HANDLE hObject)');
    _SendMessageTimeoutW = _u32.func('SendMessageTimeoutW', 'LRESULT', ['HWND', 'UINT', 'WPARAM', 'void *', 'UINT', 'UINT', 'void *']);
    _PBRANGE = koffi.type('PBRANGE');
    ready = true;
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

/** 从窗口标题提取百分比（兜底通道 1） */
function titlePercent(title: string): number | null {
  const m = /(\d{1,3})\s*%/.exec(title);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return v >= 0 && v <= 100 ? v : null;
}

/** 从窗口进度条控件读取百分比（主通道 2，带超时防卡死） */
function progressBarPercent(hwnd: number): number | null {
  try {
    // 遍历子窗口找 msctls_progress32
    let found: number | null = null;
    const cb = koffi.register((childHwnd: any, _lParam: any) => {
      try {
        const buf = Buffer.allocUnsafe(64 * 2);
        const n = _GetClassNameW(childHwnd, buf, 64);
        if (n > 0) {
          const cls = koffi.decode(buf, 'char16_t', n);
          if (cls === 'msctls_progress32') { found = Number(childHwnd); return false; } // 停止枚举
        }
      } catch { /* ignore */ }
      return true;
    }, _ChildEnumPtr);
    _EnumChildWindows(hwnd, cb, 0);
    koffi.unregister(cb);
    if (!found) return null;

    // 读范围：传 PBRANGE 结构指针（窗口过程填充 iLow/iHigh）
    const rangeStruct = koffi.alloc("PBRANGE", 1);
    _SendMessageTimeoutW(found, PBM_GETRANGE, 0, koffi.as(rangeStruct, "PBRANGE *"), SMTO_ABORTIFHUNG, 500, Buffer.alloc(4));
    let total = 0;
    try {
      const r = koffi.decode(rangeStruct, "PBRANGE");
      total = (r.iHigh || 0) - (r.iLow || 0);
    } catch { /* 解码失败则放弃 */ }
    koffi.free(rangeStruct);
    if (total <= 0) return null;
    // 读位置（PBM_GETPOS 返回值即位置，写入 lpdwResult 低 32 位）
    const posBuf = Buffer.alloc(4);
    _SendMessageTimeoutW(found, PBM_GETPOS, 0, 0, SMTO_ABORTIFHUNG, 500, posBuf);
    const pos = posBuf.readUInt32LE(0);
    const pct = Math.round((pos / total) * 100);
    return pct >= 0 && pct <= 100 ? pct : null;
  } catch {
    return null;
  }
}

interface WinInfo { hwnd: number; pid: number; title: string; percent: number | null }

/** 收集任务进度：同进程取最大；返回 [{ name, percent }] */
export function collectProgressKoffi(): Array<{ name: string; percent: number }> {
  if (!initProgress()) return [];
  const wins: WinInfo[] = [];
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
    let percent = titlePercent(title);
    if (percent === null) percent = progressBarPercent(Number(hwnd));
    wins.push({ hwnd: Number(hwnd), pid, title, percent });
    return true;
  }, _ChildEnumPtr);
  try { _EnumWindows(cb, 0); } catch { /* ignore */ }
  koffi.unregister(cb);

  const byName = new Map<string, number>();
  for (const w of wins) {
    if (w.percent === null || w.percent === undefined) continue;
    const path = getProcessPath(w.pid);
    const name = path ? (path.replace(/\\/g, '/').split('/').pop() || '').replace(/\.exe$/i, '') : '';
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = byName.get(key) || 0;
    if (w.percent > prev) byName.set(key, w.percent);
  }
  return Array.from(byName.entries()).map(([name, percent]) => ({ name, percent }));
}
