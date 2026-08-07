#!/usr/bin/env node
// 批次 A —— filterProgress 迟滞滤波逻辑的单测（独立复刻生产逻辑）。
// 背景：filterProgress 定义于 electron/main.ts（依赖 electron，无法直接 import），
// 故此处按生产代码的语义完整复刻，用输入/输出断言验证其时序行为。
// 运行: node scripts/verify-progress-B.mjs  （预期全部 PASS，退出码 0）
const JITTER_RANGE = 2, ZERO_CONFIRM = 2;

// —— 复刻自 electron/main.ts 的 filterProgress（保持语义一致） ——
function makeFilter() {
  const H = new Map();
  return function filterProgress(raw) {
    const out = []; const seen = new Set();
    for (const p of raw) {
      const name = String(p.name || '').toLowerCase(); if (!name) continue;
      seen.add(name);
      const rawP = Math.max(0, Math.min(100, Number(p.percent) || 0));
      const prev = H.get(name);
      if (rawP === 0) {
        if (!prev) continue;
        const s = (prev.zeroStreak || 0) + 1;
        if (s < ZERO_CONFIRM) { H.set(name, { ...prev, zeroStreak: s }); out.push({ name, percent: prev.last }); }
        else H.delete(name);
        continue;
      }
      H.set(name, { last: rawP, zeroStreak: 0 });
      if (prev && prev.last > 0 && Math.abs(prev.last - rawP) <= JITTER_RANGE) continue;
      out.push({ name, percent: rawP });
    }
    for (const [name, v] of H) {
      if (seen.has(name)) continue;
      const st = (v.zeroStreak || 0) + 1;
      if (st >= ZERO_CONFIRM) H.delete(name); else H.set(name, { ...v, zeroStreak: st });
    }
    return out;
  };
}

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n        got ' + a + '\n        exp ' + e); }
}

console.log('批次A · filterProgress 迟滞滤波单元测试\n');
const f = makeFilter();

console.log('场景1 — 正常上升（应逐 tick 推送变化）');
eq('t1: 首次 0(无历史) → 不推', f([{ name: 'copy', percent: 0 }]), []);
eq('t2: 30 → 推30', f([{ name: 'copy', percent: 30 }]), [{ name: 'copy', percent: 30 }]);
eq('t3: 60 → 推60', f([{ name: 'copy', percent: 60 }]), [{ name: 'copy', percent: 60 }]);

console.log('场景2 — 小幅采样抖动(偏差 ≤2 抑制)');
eq('t4: 61(差1) → 抑制', f([{ name: 'copy', percent: 61 }]), []);
eq('t5: 65(差5) → 推送', f([{ name: 'copy', percent: 65 }]), [{ name: 'copy', percent: 65 }]);

console.log('场景3 — 归零仲裁(连续2次才真正归零)');
eq('t6: 0(第1次) → 保留最近非零65', f([{ name: 'copy', percent: 0 }]), [{ name: 'copy', percent: 65 }]);
eq('t7: 0(第2次) → 确认归零, 不再推', f([{ name: 'copy', percent: 0 }]), []);

console.log('场景4 — 进程消失(连续2 tick 清理)');
eq('t8: 空(第1次) → 无输出', f([]), []);
eq('t9: 空(第2次) → 无输出', f([]), []);

console.log('场景5 — 多进程独立互不干扰');
const g = makeFilter();
eq('g1: dl 20', g([{ name: 'dl', percent: 20 }]), [{ name: 'dl', percent: 20 }]);
eq('g2: play 40 独立推(无 dl 输入)', g([{ name: 'play', percent: 40 }]), [{ name: 'play', percent: 40 }]);
// g3: dl 已因 g2 缺席累计 zeroStreak=1，此处 dl:0 达到确认阈值 → 确认归零不推
eq('g3: dl 0(此前已有1次消失) → 确认归零', g([{ name: 'dl', percent: 0 }]), []);
// 独立干净实例：先推 dl=20，下一 tick 直接 dl=0(无中间缺席) → 第1次归零应保留20
const g2 = makeFilter();
eq('g2a: dl 20(干净实例)', g2([{ name: 'dl', percent: 20 }]), [{ name: 'dl', percent: 20 }]);
eq('g2b: dl 0(归零第1次) → 保留20', g2([{ name: 'dl', percent: 0 }]), [{ name: 'dl', percent: 20 }]);
eq('g2c: dl 0(归零第2次) → 确认', g2([{ name: 'dl', percent: 0 }]), []);

console.log('场景6 — 边界取值(clamp)');
const h = makeFilter();
eq('h1: percent 150 被 clamp 到 100', h([{ name: 'x', percent: 150 }]), [{ name: 'x', percent: 100 }]);
// h2: 干净实例, x=-5 clamp→0 且无历史 → 不推（视为从未有进度）
const h2 = makeFilter();
eq('h2: x=-5 clamp→0 无历史 → 不推', h2([{ name: 'x', percent: -5 }]), []);
eq('h3: x=100 正常推', h2([{ name: 'x', percent: 100 }]), [{ name: 'x', percent: 100 }]);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);