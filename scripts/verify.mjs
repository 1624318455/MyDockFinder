#!/usr/bin/env node
// 统一验证聚合入口：顺序运行全部批次验证脚本，任一失败则整体退出码非 0。
// 运行: node scripts/verify.mjs   或   pnpm verify
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scripts = [
  'verify-progress-B.mjs', // 批次A：任务进度迟滞滤波
  'verify-magnify-B.mjs',  // 批次B：悬停放大高度联动
  'verify-boundary-C.mjs', // 批次C：边界/多屏吸附
  'verify-theme-D.mjs',    // 批次D：浅色主题可读性
];

let failed = 0;
for (const s of scripts) {
  console.log('\n===== ' + s + ' =====');
  const r = spawnSync(process.execPath, [join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n验证未全部通过（${failed} 个脚本失败）` : '\n全部批次验证通过');
process.exit(failed ? 1 : 0);