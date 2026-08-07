#!/usr/bin/env node
// 批次 C —— 边界/多显示器稳定性验证
// 两层：
//  1) 吸附计算层：复刻 electron/main.ts set-dock-hover 的四方向 bounds 计算，用多组 mock
//     工作区(单屏/副屏非0坐标/窄工作区)断言：贴边不越界、副屏坐标用 wa.x/wa.y、高度 clamp。
//  2) 静态层：断言 Dock.tsx 存在 dockHoveredRef 双层去重护栏。
// 运行: node scripts/verify-boundary-C.mjs   （预期全部 PASS，退出 0）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DOCK_BAR = 80, MAGNIFY_PAD = 24, NAME_PAD = 220, HOVER_SIDE = 340, PREVIEW_SPACE = 170;

// 复刻 set-dock-hover 的 bounds 计算（仅输出 bounds）
function hoverBounds(pos, b, wa) {
  const pad = MAGNIFY_PAD;
  if (pos === 'bottom') {
    const newH = DOCK_BAR + pad + PREVIEW_SPACE;
    const w = Math.min(b.width + HOVER_SIDE * 2, wa.width);
    return { x: wa.x + (wa.width - w) / 2, y: wa.y + wa.height - newH, width: w, height: newH };
  } else if (pos === 'top') {
    const newH = DOCK_BAR + pad + 44 + PREVIEW_SPACE;
    const w = Math.min(b.width + HOVER_SIDE * 2, wa.width);
    return { x: wa.x + (wa.width - w) / 2, y: wa.y, width: w, height: newH };
  } else if (pos === 'left') {
    const newW = DOCK_BAR + NAME_PAD + HOVER_SIDE;
    const newH = Math.min(b.height + HOVER_SIDE, wa.height);
    return { x: wa.x, y: wa.y + Math.max(0, (wa.height - newH) / 2), width: newW, height: newH };
  } else {
    const newW = DOCK_BAR + NAME_PAD + HOVER_SIDE;
    const newH = Math.min(b.height + HOVER_SIDE, wa.height);
    return { x: wa.x + wa.width - newW, y: wa.y + Math.max(0, (wa.height - newH) / 2), width: newW, height: newH };
  }
}
// 断言 bounds 完全落在 workArea 内
function inWork(r, wa) { return r.x >= wa.x && r.y >= wa.y && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height; }

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

console.log('批次C · 边界/多屏吸附验证\n');

console.log('1) 单屏 bottom（主屏 1920x1040，dock宽480）');
const b = { x: 0, y: 1040 - 80 - 24, width: 480, height: 104 };
const wa1 = { x: 0, y: 0, width: 1920, height: 1040 };
const r1 = hoverBounds('bottom', b, wa1);
ok('bottom 贴工作区底(y+h=wa.bottom)', r1.y + r1.height === wa1.y + wa1.height, JSON.stringify(r1));
ok('bottom 水平居中', Math.abs((r1.x + r1.width / 2) - (wa1.x + wa1.width / 2)) < 0.001, JSON.stringify(r1));
ok('bottom 在 workArea 内', inWork(r1, wa1), JSON.stringify(r1));

console.log('2) top（贴顶向下扩展）');
const r2 = hoverBounds('top', b, wa1);
ok('top 顶贴 wa.y=0', r2.y === wa1.y, JSON.stringify(r2));
ok('top 在 workArea 内', inWork(r2, wa1), JSON.stringify(r2));

console.log('3) 副屏 right（wa.x=1920, wa.y≠0 顶部任务栏）');
const wa2 = { x: 1920, y: 40, width: 1920, height: 980 };
const r3 = hoverBounds('right', b, wa2);
ok('right 用 wa.x 定位(右缘贴 wa 右边界)', Math.abs((r3.x + r3.width) - (wa2.x + wa2.width)) < 0.001, JSON.stringify(r3));
ok('right y 用 wa.y 而非 0(≥40)', r3.y >= wa2.y, 'y=' + r3.y);
ok('right 在 workArea 内', inWork(r3, wa2), JSON.stringify(r3));

console.log('4) 副屏 left（wa.x=1920）');
const r4 = hoverBounds('left', b, wa2);
ok('left 贴 wa 左缘 x=1920', r4.x === wa2.x, JSON.stringify(r4));
ok('left 在 workArea 内', inWork(r4, wa2), JSON.stringify(r4));

console.log('5) 高度 clamp（窄工作区, left/right 高度被 wa 限制）');
const waNarrow = { x: 0, y: 0, width: 800, height: 300 };
const r5 = hoverBounds('left', { ...b, height: 500 }, waNarrow);
ok('left 高度 clamp 到 wa.height=300', r5.height <= waNarrow.height, 'h=' + r5.height);
ok('left 不越界', inWork(r5, waNarrow), JSON.stringify(r5));

console.log('6) 宽度 clamp（窄屏 bottom，camo 宽度不超 wa）');
const r6 = hoverBounds('bottom', b, { x: 0, y: 0, width: 500, height: 1040 });
ok('bottom 宽度 ≤ wa.width=500', r6.width <= 500, 'w=' + r6.width);
ok('bottom 不越界', inWork(r6, { x: 0, y: 0, width: 500, height: 1040 }), JSON.stringify(r6));

console.log('── 7) Dock.tsx 双层去重护栏（静态层面） ──');
const dock = readFileSync(join(ROOT, 'src/components/Dock.tsx'), 'utf-8');
ok('存在 dockHoveredRef', /dockHoveredRef\s*=\s*useRef\(false\)/.test(dock));
ok('enter 去重(已 hover 则 return)', /if \(dockHoveredRef\.current\) return;/.test(dock));
ok('enter 置 hovered=true', /dockHoveredRef\.current\s*=\s*true/.test(dock));
ok('leave debounce 220ms 后清 hovered=false', /dockHoveredRef\.current\s*=\s*false\s*;[\s\S]*?},?\s*220\)/.test(dock));

console.log('── 8) 问题1回归：region dock条高 与 渲染容器几何对齐(dockStripHeight) ──');
// 复刻 electron/main.ts dockStripHeight:
//   base = 76(容器) + 8(margin) = 84；hover 时 + 56*(magnification-1)
const DOCK_CSS = 76, MARGIN = 8;
function strip(hover, mag) { const base = DOCK_CSS + MARGIN; return base + (hover ? Math.max(0, 56 * (mag - 1)) : 0); }
ok('非hover: strip = 84 → region 覆盖容器底(不再露白)', strip(false, 1.15) === 84);
ok('hover 默认 mag1.15: strip ≈ 92.4(用近似比较，规避浮点)', Math.abs(strip(true, 1.15) - 92.4) < 1e-6);
ok('hover 最高 mag2.0: strip = 84+56=140(容器增高同步)', strip(true, 2.0) === 140);
ok('main.ts 定义 dockStripHeight 且用 hoverActive', /function dockStripHeight\(\)[\s\S]*?if \(!hoverActive\) return base/.test(readFileSync(join(ROOT, 'electron/main.ts'), 'utf-8')));
ok('regionOpts 非 left/right 用 dockStripHeight 而非固定 DOCK_BAR', /function regionOpts[\s\S]*?const strip = dockStripHeight\(\)[\s\S]*?return \{ top: Math\.max\(0, h - strip\), height: Math\.min\(strip, h\) \}/.test(readFileSync(join(ROOT, 'electron/main.ts'), 'utf-8')));

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);