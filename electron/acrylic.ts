// Win10/Win11 亚克力模糊 + 窗口圆角（koffi 直调 Win32）
// 亚克力：SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND) —— 真实模糊桌面内容
// 圆角：CreateRoundRectRgn + SetWindowRgn —— 亚克力是整窗矩形合成，必须把窗口切成圆角区域
import koffi from "koffi";
import type { BrowserWindow } from "electron";

let _k32: any = null, _u32: any = null, _gdi32: any = null;
let _SetWindowCompositionAttribute: any = null;
let _CreateRoundRectRgn: any = null, _SetWindowRgn: any = null, _DeleteObject: any = null;
let _CreateRectRgn: any = null, _CombineRgn: any = null;

/** 初始化 koffi 绑定；任何一步失败都静默降级（返回 false，走 CSS 兜底） */
export function initAcrylic(): boolean {
  try {
    _k32 = koffi.load("kernel32.dll");
    _u32 = koffi.load("user32.dll");
    _gdi32 = koffi.load("gdi32.dll");

    // 类型幂等注册（koffi 内建无 BOOL/HWND/HRGN 等 Win32 风格名，必须自定义；
    // 否则 func() 绑定在首个未知类型处抛错 → 亚克力/region 全部失效）
    const type = (name: string, def: () => void): void => {
      try { koffi.type(name); } catch { def(); }
    };
    type('BOOL', () => koffi.alias('BOOL', 'int32_t'));
    type('INT', () => koffi.alias('INT', 'int32_t'));
    type('UINT', () => koffi.alias('UINT', 'uint32_t'));
    type('HWND', () => koffi.pointer('HWND', koffi.opaque()));
    type('HRGN', () => koffi.alias('HRGN', 'void *'));
    type('HGDIOBJ', () => koffi.alias('HGDIOBJ', 'void *'));

    // 注册结构体（供 alloc/encode 使用）
    koffi.struct("ACCENT_POLICY", {
      AccentState: "int",
      AccentFlags: "int",
      GradientColor: "uint32",
      AnimationId: "int",
    });
    koffi.struct("WINDOWCOMPOSITIONATTRIBDATA", {
      Attrib: "int",
      pvData: koffi.pointer("void"),
      cbData: "int",
    });
    _SetWindowCompositionAttribute = _u32.func(
      "BOOL __stdcall SetWindowCompositionAttribute(HWND hWnd, _In_ WINDOWCOMPOSITIONATTRIBDATA *data)"
    );

    _CreateRoundRectRgn = _gdi32.func("HRGN __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int widthEllipse, int heightEllipse)");
    _CreateRectRgn = _gdi32.func("HRGN __stdcall CreateRectRgn(int left, int top, int right, int bottom)");
    _CombineRgn = _gdi32.func("int __stdcall CombineRgn(HRGN dst, HRGN src1, HRGN src2, int mode)");
    _SetWindowRgn = _u32.func("int __stdcall SetWindowRgn(HWND hWnd, HRGN hRgn, BOOL redraw)");
    _DeleteObject = _gdi32.func("BOOL __stdcall DeleteObject(HGDIOBJ hObj)");
    return true;
  } catch {
    return false;
  }
}

/**
 * 应用亚克力背景。
 * @param hwnd BrowserWindow 的 HWND（bigint/number）
 * @param tintRgb 0xRRGGBB tint 颜色
 * @param alpha 0-255 不透明度（越低越透，模糊越明显）
 */
export function applyAcrylic(hwnd: unknown, tintRgb: number, alpha: number): boolean {
  if (!_SetWindowCompositionAttribute) return false;
  try {
    // GradientColor 格式：0xAABBGGRR
    const gradient = ((Math.max(0, Math.min(255, alpha)) & 0xFF) << 24) |
      (((tintRgb & 0xFF) << 16) & 0xFF0000) |
      (tintRgb & 0xFF00) |
      ((tintRgb >> 16) & 0xFF);
    const policy = koffi.alloc("ACCENT_POLICY", 1);
    koffi.encode(policy, 0, "ACCENT_POLICY", { AccentState: 4, AccentFlags: 2, GradientColor: gradient >>> 0, AnimationId: 0 });
    const data = koffi.alloc("WINDOWCOMPOSITIONATTRIBDATA", 1);
    koffi.encode(data, 0, "WINDOWCOMPOSITIONATTRIBDATA", { Attrib: 19, pvData: policy, cbData: koffi.sizeof("ACCENT_POLICY") });
    const ok = _SetWindowCompositionAttribute(hwnd, data);
    koffi.free(data);
    koffi.free(policy);
    return !!ok;
  } catch {
    return false;
  }
}

/** 关闭亚克力（恢复普通窗口合成） */
export function removeAcrylic(hwnd: unknown): void {
  if (!_SetWindowCompositionAttribute) return;
  try {
    const policy = koffi.alloc("ACCENT_POLICY", 1);
    koffi.encode(policy, 0, "ACCENT_POLICY", { AccentState: 0, AccentFlags: 0, GradientColor: 0, AnimationId: 0 });
    const data = koffi.alloc("WINDOWCOMPOSITIONATTRIBDATA", 1);
    koffi.encode(data, 0, "WINDOWCOMPOSITIONATTRIBDATA", { Attrib: 19, pvData: policy, cbData: koffi.sizeof("ACCENT_POLICY") });
    _SetWindowCompositionAttribute(hwnd, data);
    koffi.free(data);
    koffi.free(policy);
  } catch { /* ignore */ }
}

/**
 * 把窗口切成圆角区域（配合亚克力整窗合成，圆角外露出桌面）。
 * 支持"条带"：仅裁剪窗口的一部分（如顶部留白透明区 + 底部 dock 条），
 * 使亚克力 tint 只出现在 dock 条范围内。窗口尺寸变化后需重新调用。
 * @param win BrowserWindow
 * @param radius 圆角半径
 * @param opts.top 条带顶部 y（窗口坐标，默认 0）
 * @param opts.height 条带高度（默认整窗）
 * @param opts.left 条带左侧 x（窗口坐标；与 top 同时给出时取二者并集矩形）
 * @param opts.width 条带宽度
 */
export function applyRoundedRegion(win: BrowserWindow, radius = 18, opts?: { top?: number; height?: number; left?: number; width?: number }): boolean {
  if (!_CreateRoundRectRgn || !_SetWindowRgn || !_DeleteObject) return false;
  try {
    const [w, h] = win.getSize();
    const top = Math.max(0, opts?.top ?? 0);
    const height = Math.min(h - top, opts?.height ?? h - top);
    const left = Math.max(0, opts?.left ?? 0);
    const width = Math.min(w - left, opts?.width ?? w - left);
    const rgn = _CreateRoundRectRgn(left, top, left + width + 1, top + height + 1, radius * 2, radius * 2);
    if (!rgn) return false;
    const handleBuf = win.getNativeWindowHandle();
    const hwnd = handleBuf.length >= 8 ? handleBuf.readBigUInt64LE(0) : handleBuf.readUInt32LE(0);
    // 注意：SetWindowRgn 会接管 region 所有权，不要 DeleteObject（系统在窗口销毁时释放）
    _SetWindowRgn(hwnd, rgn, 1);
    return true;
  } catch {
    return false;
  }
}

/** 清除窗口 region（恢复整窗可见/可点；全屏弹层 FolderView/Launchpad 打开时调用） */
export function clearWindowRegion(win: BrowserWindow): boolean {
  if (!_SetWindowRgn) return false;
  try {
    const handleBuf = win.getNativeWindowHandle();
    const hwnd = handleBuf.length >= 8 ? handleBuf.readBigUInt64LE(0) : handleBuf.readUInt32LE(0);
    // HRGN=0 → 取消裁剪，整窗恢复
    _SetWindowRgn(hwnd, 0, 1);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把窗口切成多个圆角矩形的并集（CombineRgn RGN_OR）。
 * 用于 hover 扩容：亚克力 tint 是整窗合成，必须用 region 只保留 dock 条 + 预览 popup 区域
 * （其余区域透明且鼠标穿透，消除“白色背景”）。窗口尺寸变化后需重新调用。
 * @param rects 矩形列表（窗口坐标），每个可带独立圆角半径
 */
export function applyCombinedRegion(win: BrowserWindow, rects: Array<{ left: number; top: number; width: number; height: number; radius?: number }>): boolean {
  if (!_CreateRoundRectRgn || !_CreateRectRgn || !_CombineRgn || !_SetWindowRgn || !_DeleteObject) return false;
  try {
    const [w, h] = win.getSize();
    let acc: any = null;
    for (const r of rects) {
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const left = Math.max(0, Math.round(r.left));
      const top = Math.max(0, Math.round(r.top));
      const right = Math.min(w, Math.round(r.left + r.width)) + 1;
      const bottom = Math.min(h, Math.round(r.top + r.height)) + 1;
      if (right <= left || bottom <= top) continue;
      const radius = Math.max(0, Math.min(24, Math.round(r.radius ?? 12)));
      const rgn = radius > 0
        ? _CreateRoundRectRgn(left, top, right, bottom, radius * 2, radius * 2)
        : _CreateRectRgn(left, top, right, bottom);
      if (!rgn) continue;
      if (!acc) {
        acc = rgn;
      } else {
        const merged = _CreateRectRgn(0, 0, 0, 0);
        _CombineRgn(merged, acc, rgn, 2 /* RGN_OR */);
        _DeleteObject(acc);
        _DeleteObject(rgn);
        acc = merged;
      }
    }
    if (!acc) return false;
    const handleBuf = win.getNativeWindowHandle();
    const hwnd = handleBuf.length >= 8 ? handleBuf.readBigUInt64LE(0) : handleBuf.readUInt32LE(0);
    _SetWindowRgn(hwnd, acc, 1); // acc 被系统接管，勿 DeleteObject
    return true;
  } catch {
    return false;
  }
}

