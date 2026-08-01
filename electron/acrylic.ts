// Win10/Win11 亚克力模糊 + 窗口圆角（koffi 直调 Win32）
// 亚克力：SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND) —— 真实模糊桌面内容
// 圆角：CreateRoundRectRgn + SetWindowRgn —— 亚克力是整窗矩形合成，必须把窗口切成圆角区域
import koffi from "koffi";
import type { BrowserWindow } from "electron";

let _k32: any = null, _u32: any = null, _gdi32: any = null;
let _SetWindowCompositionAttribute: any = null;
let _CreateRoundRectRgn: any = null, _SetWindowRgn: any = null, _DeleteObject: any = null;

/** 初始化 koffi 绑定；任何一步失败都静默降级（返回 false，走 CSS 兜底） */
export function initAcrylic(): boolean {
  try {
    _k32 = koffi.load("kernel32.dll");
    _u32 = koffi.load("user32.dll");
    _gdi32 = koffi.load("gdi32.dll");

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

