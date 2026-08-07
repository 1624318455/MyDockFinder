#!/usr/bin/env node
// 批次 B —— 悬停放大高度联动验证
// 分两层：
//  1) 计算层：复刻 Dock.tsx applyDockMagExtra 的增高量，对多个 magnification 采样断言
//     增高后的容器总高与主进程 hover 扩容区容量不等式（保证不溢出窗口）。
//  2) 静态层：断言 App.css 中存在容器 calc 高度公式 + 方向对齐规则；Dock.tsx 存在注入调用。
// 运行: node scripts/verify-batch-B.mjs   （预期全部 PASS，退出 0）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DOCK_BAR = 80, MAGNIFY_PAD = 24, PREVIEW_SPACE = 170;
// .dock-item 固定视觉盒高度（App.css 定义）
const ITEM_H = 56;

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

console.log('批次B · 悬停放大高度联动验证\n');

console.log('1) 增高量计算（复刻 Dock.tsx applyDockMagExtra）');
function magExtra(mag) { return Math.max(0, ITEM_H * (mag - 1)); }
const hoverCap = DOCK_BAR + MAGNIFY_PAD + PREVIEW_SPACE; // 主进程 hover 扩容窗口高
for (const mag of [1.0, 1.15, 1.3, 1.5, 1.8, 2.0]) {
  const extra = magExtra(mag);
  const totalH = 76 + extra; // 容器基线 --dock-height=76 + 增高
  ok('mag=' + mag + ' → 增高=' + extra.toFixed(1) + 'px, 容器高=' + totalH.toFixed(1) + 'px ≤ hover扩容区 ' + hoverCap + 'px',
     mag >= 1 && totalH <= hoverCap && totalH >= 76,
     '容器高 ' + totalH.toFixed(1) + ' 超过扩容区 ' + hoverCap);
}
ok('mag=1.0（不放大）时增高=0', magExtra(1.0) === 0);
ok('mag 最高 2.0 时增高=56px', magExtra(2.0) === 56);

console.log('── 2) App.css 静态约束 ──');
const css = readFileSync(join(ROOT, 'src/App.css'), 'utf-8');
ok('docker-container 高度用 calc 基线+增高变量',
  /\.dock-container\s*\{[\s\S]*?height:\s*calc\(var\(--dock-height\)\s*\+\s*var\(--dock-mag-extra,\s*0px\)\)/.test(css));
ok('存在 .dock-container 定义', css.includes('.dock-container'));
ok('存在 --dock-mag-extra 变量引用', css.includes('--dock-mag-extra'));
ok('容器有 height 过渡(平滑增高)', /transition:\s*height\s+0\.18s/.test(css));
ok('bottom 放大对齐规则(贴底向上凸)', /data-position='bottom'\s*\]\s*\.dock-items\s*\{\s*align-items:\s*flex-end/.test(css));
ok('top 放大对齐规则(贴顶向下凸)', /data-position='top'\s*\]\s*\.dock-items\s*\{\s*align-items:\s*flex-start/.test(css));

console.log('── 3) Dock.tsx 静态层 ──');
const dockTsx = readFileSync(join(ROOT, 'src/components/Dock.tsx'), 'utf-8');
ok('Dock.tsx 注入 --dock-mag-extra 变量', /setProperty\(['\"]--dock-mag-extra['\"]/.test(dockTsx));
ok('增高量公式 56*(mag-1)', /Math\.max\(0,\s*56\s*\*\s*\(mag\s*-\s*1\)\)/.test(dockTsx));
ok('leave 220ms 后清 0', /clearDockMagExtra\(\)/.test(dockTsx));

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);