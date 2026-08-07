#!/usr/bin/env node
// 批次 D —— 浅色主题可读性验证
// 静态层面验证：
//  1) 批次D新增的 [data-theme=light] 覆盖规则存在(设置控件底/关闭按钮/副标题)；
//  2) 这些规则引用的每个 CSS 变量都在 :root[data-theme=light] 内"显式定义"(而非仅默认值)，
//     确保浅色下变量确实切换为浅色语义、而非仍执行深色值。
// 运行: node scripts/verify-theme-D.mjs   （预期全部 PASS，退出 0）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const css = readFileSync(join(ROOT, 'src/App.css'), 'utf-8');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

console.log('批次D · 浅色主题可读性验证\n');

console.log('── 1) 批次D 新增的浅色覆盖规则存在 ──');
const rules = {
  'setting-row select/range 控件底改用变量': /data-theme=\\"light\\"[^}]*\.setting-row select[\s\S]*?background:\s*var\(--dock-input-bg\)/.test(css),
};
// 更稳妥：直接 substring 检查关键片段
ok('存在 [data-theme=light] .setting-row select 覆盖', css.includes('[data-theme="light"] .setting-row select'));
ok('控件底用 var(--dock-input-bg)', /var\(--dock-input-bg\)/.test(css));
ok('控件边框用 var(--dock-line)', /var\(--dock-line\)/.test(css));
ok('存在 settings-close 浅色覆盖', css.includes('[data-theme="light"] .settings-close { background: var(--dock-hover-bg)'));
ok('存在 settings-close:hover 浅色覆盖', css.includes('[data-theme="light"] .settings-close:hover { background: var(--dock-hover-bg-strong)'));
ok('存在 settings-sub 浅色覆盖', css.includes('[data-theme="light"] .settings-sub { color: var(--text-secondary)'));

console.log('── 2) 覆盖所用变量在 :root[data-theme=light] 内确实定义 ──');
const lightBlockMatch = /:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(css);
const lightBlock = lightBlockMatch ? lightBlockMatch[1] : '';
const requiredVars = ['--dock-input-bg', '--dock-line', '--text-primary', '--text-secondary', '--dock-hover-bg', '--dock-hover-bg-strong'];
for (const v of requiredVars) {
  ok('浅色块定义了 ' + v, new RegExp(v + '\\s*:').test(lightBlock), '可在 :root[data-theme=light] 块内未找到定义');
}
console.log('── 3) 浅色专用变量不反向污染深色 ──');
ok('.setting-row select 深色定义用硬编码 rgba(255,255,255,0.06)（深色不受影响）',
  /input\[type="range"\]\s*\{[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.06\)/.test(css) || /\.setting-row select,\s*\n\s*\.setting-row input\[type="range"\]\s*\{[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.06\)/.test(css));
ok('--dock-input-bg 定义于 :root[data-theme=light]（浅色场景专用）', /--dock-input-bg\s*:/.test(lightBlock));
ok('--dock-hover-bg / --dock-hover-bg-strong 定义于 light 块',
  /--dock-hover-bg\s*:/.test(lightBlock) && /--dock-hover-bg-strong\s*:/.test(lightBlock));

console.log('── 4) 渲染层浅色主题激活机制 ──');
const tsx = readFileSync(join(ROOT, 'src/App.tsx'), 'utf-8');
ok('App.tsx 设置 data-theme=light', /setAttribute\(['\"]data-theme['\"],\s*dark\s*\?\s*['\"]dark['\"]\s*:\s*['\"]light['\"]\)/.test(tsx));

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);