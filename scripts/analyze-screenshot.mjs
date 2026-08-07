#!/usr/bin/env node
// 分析截图：定位「白色背景区域」与 dock 条的像素几何/颜色，量化问题1。
// 用法: node scripts/analyze-screenshot.mjs [file.png]
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'screenshot/screenshot01.png';
const buf = readFileSync(file);
const png = PNG.sync.read(buf);
const { width: W, height: H, data } = png;
console.log(`\n文件: ${file}  尺寸: ${W}x${H}`);

function px(x, y) {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

// 1) 统计：全图 / 白色(亮)像素 / 深色像素 占比
let white = 0, dark = 0, mid = 0, transparent = 0;
let total = 0;
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
  total++;
  if (a < 20) { transparent++; continue; }
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 225 && r > 230 && g > 230 && b > 230) white++;       // 近白
  else if (lum < 70) dark++;                                      // 近黑
  else mid++;
}
console.log(`透明度: ${(transparent / total * 100).toFixed(1)}%  近白: ${(white / total * 100).toFixed(1)}%  近黑: ${(dark / total * 100).toFixed(1)}%  中间调: ${(mid / total * 100).toFixed(1)}%`);

// 2) 逐行亮度分布：找白色带 / 文字行 的纵向范围
console.log('\n逐行分析（每 8 行，左→右 每 40 列采样亮度, L<50=暗 # . L>210=白 W, else .）');
const rows = [];
for (let y = 0; y < H; y++) {
  let rowWhite = 0, rowRow = 0;
  for (let x = 0; x < W; x += 2) {
    const [r, g, b, a] = px(x, y);
    if (a < 30) continue;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 225 && r > 228) rowWhite++;
    rowRow++;
  }
  rows.push(rowWhite / Math.max(1, rowRow));
}
// 打印亮度条状图（每4行合成一行）
for (let y = 0; y < H; y += 4) {
  let line = '';
  let whiteSum = 0, n = 0;
  for (let x = 0; x < W; x += 12) {
    const [r, g, b, a] = px(x, y);
    if (a < 30) { line += ' '; }
    else {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      line += lum > 200 ? 'W' : lum < 80 ? '#' : lum < 160 ? '+' : '-';
    }
  }
  // 统计该合成带白色比例
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = px(x, y);
    if (a > 30 && r > 235 && g > 235 && b > 235) { whiteSum++; }
    n++;
  }
  console.log(`y=${String(y).padStart(3)} [白${(whiteSum / Math.max(1, n) * 100).toFixed(0)}%] ${line}`);
}

// 3) 定位「纯白/近白 大区域」包围盒（连续白色矩形带）
function isWhiteish(x, y) {
  const [r, g, b, a] = px(x, y);
  return a > 120 && r > 235 && g > 235 && b > 235;
}
let minWx = W, minWy = H, maxWx = -1, maxWy = -1, wCount = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (isWhiteish(x, y)) {
    if (x < minWx) minWx = x; if (x > maxWx) maxWx = x;
    if (y < minWy) minWy = y; if (y > maxWy) maxWy = y;
    wCount++;
  }
}
if (wCount > 10) {
  console.log(`\n近白色像素包围盒: x[${minWx}..${maxWx}] y[${minWy}..${maxWy}]  像素数=${wCount}  (占图高 ${((maxWy - minWy) / H * 100).toFixed(0)}%)`);
  // 判断白区是否横贯全宽（可能是整条白色背景）
  const fullWidth = (maxWx - minWx) >= W * 0.8;
  console.log(`白区${fullWidth ? '横贯整宽（疑似整条白色背景带）' : '非满宽（局部白色）'}`);
} else {
  console.log('\n未检测到成片近白像素（说明背景非纯白，或已被 region 裁走）');
}