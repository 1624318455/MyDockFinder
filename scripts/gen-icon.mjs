// 生成 MyDockFinder 应用图标：256px PNG + 多尺寸 ICO（macOS Dock 风格）
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

function renderIcon(size) {
  const png = new PNG({ width: size, height: size });
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
  };
  const s = size / 256;
  const pad = 10 * s, radius = 46 * s;
  const inRoundRect = (x, y) => {
    if (x < pad || y < pad || x >= size - pad || y >= size - pad) {
      const dx = Math.abs(x - (x < size / 2 ? pad : size - pad));
      const dy = Math.abs(y - (y < size / 2 ? pad : size - pad));
      if (dx > radius || dy > radius) return false;
      return (dx - radius) ** 2 + (dy - radius) ** 2 <= radius * radius;
    }
    return true;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundRect(x, y)) continue;
      const t = y / size;
      set(x, y, Math.round(40 + 40 * t), Math.round(52 + 30 * t), Math.round(88 + 20 * t), 255);
    }
  }
  const drawTile = (cx, cy, w, h, col) => {
    for (let y = Math.max(0, Math.floor(cy - h / 2)); y < Math.min(size, cy + h / 2); y++) {
      for (let x = Math.max(0, Math.floor(cx - w / 2)); x < Math.min(size, cx + w / 2); x++) {
        if (!inRoundRect(x, y)) continue;
        const rx = Math.min(x - (cx - w / 2), (cx + w / 2 - 1) - x);
        const ry = Math.min(y - (cy - h / 2), (cy + h / 2 - 1) - y);
        const cr = 6 * s;
        if (rx < cr && ry < cr && (cr - Math.min(rx, ry)) > 0 && Math.hypot(cr - rx, cr - ry) > cr) continue;
        const glow = y < cy ? 1.25 : 1;
        set(x, y, Math.min(255, Math.round(col[0] * glow)), Math.min(255, Math.round(col[1] * glow)), Math.min(255, Math.round(col[2] * glow)), 255);
      }
    }
  };
  drawTile(size * 0.5, size * 0.44, size * 0.3, size * 0.34, [255, 159, 10]);
  drawTile(size * 0.24, size * 0.55, size * 0.22, size * 0.26, [10, 132, 255]);
  drawTile(size * 0.76, size * 0.55, size * 0.22, size * 0.26, [48, 209, 88]);
  for (let x = 0; x < size; x++) {
    const y = Math.floor(size * 0.92);
    set(x, y, 255, 255, 255, 200);
    set(x, y + 1, 255, 255, 255, 120);
  }
  return PNG.sync.write(png);
}

function makeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.data)]);
}

mkdirSync("build", { recursive: true });
const sizes = [256, 128, 64, 48, 32, 16];
const pngs = sizes.map(sz => ({ size: sz, data: renderIcon(sz) }));
writeFileSync("build/icon.png", renderIcon(256));
writeFileSync("build/icon.ico", makeIco(pngs));
console.log("ICON_OK build/icon.png + build/icon.ico");
