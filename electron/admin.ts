// 管理员模式检测：koffi 原生 OpenProcessToken + GetTokenInformation(TokenElevation)
// 官方限制：管理员模式下拖放动画不播放（克隆版：记录日志 + UI 提示 + 动画降级）
import koffi from "koffi";

let ready = false;
let _OpenProcessToken: any = null;
let _GetTokenInformation: any = null;
let _CloseHandle: any = null;
let _GetCurrentProcess: any = null;

const TOKEN_QUERY = 0x0008;
const TokenElevation = 20; // TOKEN_INFORMATION_CLASS::TokenElevation

function ensure(): boolean {
  if (ready) return true;
  try {
    const k32 = koffi.load("kernel32.dll");
    const a32 = koffi.load("advapi32.dll");
    // 类型幂等注册（koffi 内建无 INT/HANDLE 等 Win32 风格名，需自定义）
    const type = (name: string, def: () => void): void => {
      try { koffi.type(name); } catch { def(); }
    };
    type('HANDLE', () => koffi.pointer('HANDLE', koffi.opaque()));
    type('DWORD', () => koffi.alias('DWORD', 'uint32_t'));
    type('BOOL', () => koffi.alias('BOOL', 'int32_t'));
    type('INT', () => koffi.alias('INT', 'int32_t'));
    _GetCurrentProcess = k32.func('HANDLE __stdcall GetCurrentProcess()');
    _OpenProcessToken = a32.func('BOOL __stdcall OpenProcessToken(HANDLE ProcessHandle, DWORD DesiredAccess, HANDLE *TokenHandle)');
    _GetTokenInformation = a32.func('BOOL __stdcall GetTokenInformation(HANDLE TokenHandle, INT TokenInformationClass, void *TokenInformation, DWORD TokenInformationLength, DWORD *ReturnLength)');
    _CloseHandle = k32.func('BOOL __stdcall CloseHandle(HANDLE hObject)');
    ready = true;
    return true;
  } catch {
    return false;
  }
}

/** 检测当前进程是否以管理员（提升）模式运行；失败返回 null（未知） */
export function isElevated(): boolean | null {
  if (!ensure()) return null;
  try {
    const hProc = _GetCurrentProcess();
    // HANDLE 是 opaque 指针：用 koffi.alloc + decode 取 out 值
    const tokenPtr = koffi.alloc('HANDLE', 1);
    const ok = _OpenProcessToken(hProc, TOKEN_QUERY, tokenPtr);
    if (!ok) { koffi.free(tokenPtr); return null; }
    const token = koffi.decode(tokenPtr, 'HANDLE');
    koffi.free(tokenPtr);
    try {
      const buf = Buffer.alloc(4); // TOKEN_ELEVATION { DWORD TokenIsElevated }
      const retLen = [0];
      if (!_GetTokenInformation(token, TokenElevation, buf, 4, retLen)) return null;
      return buf.readUInt32LE(0) !== 0;
    } finally {
      _CloseHandle(token);
    }
  } catch {
    return null;
  }
}
