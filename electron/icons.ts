// 图标服务：统一缓存 + 提取逻辑（单一事实源）
// 缓存语义：path(lowercase) -> Promise<dataUrl>；成功为 "data:image/png;base64,..."，失败为 ""
// 并发请求同一路径只会触发一次 PowerShell 提取；失败结果也缓存，避免重复慢查询
import { existsSync } from "node:fs";
import { runPsAsync } from "./ps.js";

const iconCache = new Map<string, Promise<string>>();
// 同步镜像：Promise resolve 后回填，供需要“只读已完成的缓存”的场景（如轮询快照）
const doneCache = new Map<string, string>();

function setIconCache(key: string, p: Promise<string>): void {
  iconCache.set(key, p);
  p.then(v => doneCache.set(key, v)).catch(() => {});
}

/** 同步读取已完成的缓存值；未完成/未缓存返回 ""（不触发提取） */
export function peekIcon(path: string): string {
  return doneCache.get(cacheKey(path)) ?? "";
}

// 并发限制：同时最多 6 个独立提取（批量提取不受此限制，单次 PowerShell 循环完成）
let iconConcurrency = 0;
const iconQueue: Array<() => void> = [];

function acquireIconSlot(): Promise<void> {
  return new Promise(resolve => {
    if (iconConcurrency < 6) { iconConcurrency++; resolve(); }
    else iconQueue.push(resolve);
  });
}
function releaseIconSlot(): void {
  const next = iconQueue.shift();
  if (next) next(); else iconConcurrency--;
}

function cacheKey(path: string): string { return path.toLowerCase(); }

/** 解析 .lnk 快捷方式指向的真实目标路径（失败返回原路径） */
async function resolveLnkTarget(lnkPath: string): Promise<string> {
  const r = await runPsAsync(
    "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('" + lnkPath.replace(/'/g, "''") + "'); Write-Output $s.TargetPath"
  );
  return r || lnkPath;
}

/** 单个提取（无缓存命中时执行一次 PowerShell，成功返回 dataUrl，失败返回 ""） */
async function extractIcon(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return "";
  await acquireIconSlot();
  try {
    let targetPath = filePath;
    if (filePath.toLowerCase().endsWith(".lnk")) {
      targetPath = await resolveLnkTarget(filePath) || filePath;
    }
    const ps = "Add-Type -AssemblyName System.Drawing; try { $icon=[System.Drawing.Icon]::ExtractAssociatedIcon('" +
      targetPath.replace(/'/g, "''") + "'); if($icon){ $ms=New-Object System.IO.MemoryStream; $icon.ToBitmap().Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); Write-Output ([Convert]::ToBase64String($ms.ToArray())); $icon.Dispose() } } catch {}";
    const out = await runPsAsync(ps);
    return out && out.length > 50 ? "data:image/png;base64," + out : "";
  } catch {
    return "";
  } finally {
    releaseIconSlot();
  }
}

/** 获取单个图标（带 Promise 缓存） */
export function getExeIconBase64Async(filePath: string): Promise<string> {
  const key = cacheKey(filePath);
  let p = iconCache.get(key);
  if (!p) {
    p = extractIcon(filePath);
    setIconCache(key, p);
  }
  return p;
}

/**
 * 批量获取图标：未命中的路径一次性 PowerShell 循环提取（替代逐个 spawn），
 * 结果回填缓存；返回以【原始传入路径】为 key 的映射。
 */
export async function getIconsBatch(paths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!paths.length) return result;
  const fresh: string[] = [];
  for (const p of paths) {
    const cached = iconCache.get(cacheKey(p));
    if (cached) result[p] = await cached;
    else fresh.push(p);
  }
  if (!fresh.length) return result;

  const items = fresh.map(p => "'" + p.replace(/'/g, "''") + "'").join(",");
  const script = "Add-Type -AssemblyName System.Drawing; $out=@{}; foreach($f in @(" + items + ")){ try { $icon=[System.Drawing.Icon]::ExtractAssociatedIcon($f); if($icon){ $ms=New-Object System.IO.MemoryStream; $icon.ToBitmap().Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); $out[$f]=[Convert]::ToBase64String($ms.ToArray()); $icon.Dispose() } } catch {} }; ConvertTo-Json $out -Compress";
  const out = await runPsAsync(script);
  try {
    const parsed = out ? JSON.parse(out) : {};
    for (const [k, v] of Object.entries(parsed)) {
      const data = typeof v === "string" && v.length > 50 ? "data:image/png;base64," + v : "";
      setIconCache(cacheKey(k), Promise.resolve(data));
      result[k] = data;
    }
  } catch { /* 解析失败则全部置空 */ }
  // 未命中的路径（含失败/未返回）补齐缓存与结果，避免下次重复请求
  for (const p of fresh) {
    const key = cacheKey(p);
    if (!iconCache.has(key)) setIconCache(key, Promise.resolve(""));
    if (!(p in result)) result[p] = "";
  }
  return result;
}

/** 最小化动画等内部场景：直接取单个图标（返回 dataUrl） */
export function getAppIconCached(path: string): Promise<string> {
  return getExeIconBase64Async(path);
}
