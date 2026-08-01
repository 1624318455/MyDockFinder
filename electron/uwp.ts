// UWP / 商店应用支持：Get-StartApps 枚举（完整 AUMID）+ Get-AppxPackage 定位图标
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runPsAsyncWithTimeout } from "./ps.js";

export interface UwpApp {
  name: string;
  path: string;   // shell:AppsFolder\<AppID>
  appId: string;  // 完整 AUMID（含 PackageFamilyName!App）
  icon: string;   // dataUrl（空串表示无）
  isUwp: boolean; // 真 UWP（含 ! 的 AppID）或 商店包装 Win32
}

// 缓存：path -> UwpApp（10 分钟）
let uwpCache: UwpApp[] | null = null;
let uwpCacheTs = 0;
const UWP_CACHE_MS = 10 * 60 * 1000;

// PFN -> InstallLocation（Get-AppxPackage 一次性导出）
let pfnLocMap: Map<string, string> | null = null;

async function getPfnInstallMap(): Promise<Map<string, string>> {
  if (pfnLocMap) return pfnLocMap;
  const map = new Map<string, string>();
  try {
    const out = await runPsAsyncWithTimeout('Get-AppxPackage | ForEach-Object { Write-Output ($_.PackageFamilyName + "`t" + $_.InstallLocation) }', 30000);
    for (const line of out.split(/\r?\n/)) {
      const [pfn, loc] = line.split("\t");
      if (pfn && loc) map.set(pfn.trim(), loc.trim());
    }
  } catch { /* 保持空表 */ }
  pfnLocMap = map;
  return map;
}

/** 从 UWP 安装目录递归找 44px 方形 logo（优先 targetsize 变体，备选其他尺寸 logo） */
function findUwpLogo(installLoc: string): string {
  try {
    const candidates: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 2 || !existsSync(dir)) return;
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const f of entries) {
        const full = join(dir, f);
        let isDir = false;
        try { isDir = existsSync(full) && readdirSync(full).length >= 0; } catch { isDir = false; }
        if (isDir && depth < 2) walk(full, depth + 1);
        else if (/^Square44x44Logo.*\.png$/i.test(f)) candidates.push(full);
        else if (candidates.length === 0 && /^StoreLogo.*\.png$/i.test(f)) candidates.push(full);
      }
    };
    walk(installLoc, 0);
    const target = candidates.find(c => /targetsize/i.test(c)) || candidates[0];
    if (!target) return "";
    const buf = readFileSync(target);
    if (buf.length > 200 * 1024) return "";
    return "data:image/png;base64," + buf.toString("base64");
  } catch { return ""; }
}

/** 枚举开始菜单全部应用（UWP + 商店包装 Win32），含预取图标 */
export async function getStartAppsWithIcons(): Promise<UwpApp[]> {
  const now = Date.now();
  if (uwpCache && now - uwpCacheTs < UWP_CACHE_MS) return uwpCache;
  const apps: UwpApp[] = [];
  try {
    const [out, locMap] = await Promise.all([
      runPsAsyncWithTimeout('Get-StartApps | Where-Object { $_.AppID -match "!" } | ForEach-Object { Write-Output ($_.Name + "`t" + $_.AppID) }', 30000),
      getPfnInstallMap(),
    ]);
    for (const line of out.split(/\r?\n/)) {
      const tab = line.indexOf("\t");
      if (tab <= 0) continue;
      const name = line.slice(0, tab).trim();
      const appId = line.slice(tab + 1).trim();
      if (!appId || appId.startsWith("C:\\") || appId.startsWith("D:\\")) continue;
      const path = "shell:AppsFolder\\" + appId;
      let icon = "";
      const bang = appId.indexOf("!");
      if (bang > 0) {
        const pfn = appId.slice(0, bang);
        const loc = locMap.get(pfn);
        if (loc) icon = findUwpLogo(loc);
      }
      apps.push({ name, path, appId, icon, isUwp: true });
    }
  } catch { /* 失败返回已收集部分 */ }
  uwpCache = apps;
  uwpCacheTs = now;
  return apps;
}

/** 由 shell:AppsFolder 路径取图标（供 getAppIconCached 兜底） */
export async function getUwpIconByPath(path: string): Promise<string> {
  if (!path.toLowerCase().startsWith("shell:appsfolder\\")) return "";
  const apps = await getStartAppsWithIcons();
  const app = apps.find(a => a.path.toLowerCase() === path.toLowerCase());
  return app ? app.icon : "";
}
