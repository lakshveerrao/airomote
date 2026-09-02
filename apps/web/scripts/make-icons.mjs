// Generates placeholder PNG app icons (no native deps): dark rounded tile with a gradient ring.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const radius = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      // rounded rect mask
      const dx = Math.max(Math.abs(x - c) - (c - radius), 0);
      const dy = Math.max(Math.abs(y - c) - (c - radius), 0);
      const inside = Math.hypot(dx, dy) <= radius;
      let r = 11, g = 13, b = 18, a = inside ? 255 : 0;
      const d = Math.hypot(x - c, y - c);
      const ring = size * 0.29;
      const w = size * 0.085;
      if (inside && Math.abs(d - ring) < w) {
        const t = (Math.atan2(y - c, x - c) + Math.PI) / (2 * Math.PI);
        const stops = [
          [255, 122, 69],
          [155, 125, 255],
          [61, 220, 151],
          [255, 122, 69],
        ];
        const seg = t * 3;
        const k = Math.min(2, Math.floor(seg));
        const f = seg - k;
        const A = stops[k], B = stops[k + 1];
        r = A[0] + (B[0] - A[0]) * f;
        g = A[1] + (B[1] - A[1]) * f;
        b = A[2] + (B[2] - A[2]) * f;
      }
      // controller bar
      const bw = size * 0.066, bh = size * 0.265, br = bw;
      const bx = Math.max(Math.abs(x - c) - (bw - br), 0);
      const by = Math.max(Math.abs(y - c) - (bh - br), 0);
      if (inside && Math.hypot(bx, by) <= br) {
        r = 244; g = 246; b = 251;
        if (Math.hypot(x - c, y - (c - size * 0.165)) < size * 0.024) { r = 11; g = 13; b = 18; }
      }
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) writeFileSync(join(out, `icon-${s}.png`), png(s));
console.log('icons written to', out);
