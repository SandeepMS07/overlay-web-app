/**
 * Generates the app and tray icons as PNGs with no image dependencies, so the
 * repo stays free of binary assets. electron-builder derives .icns/.ico from
 * build/icon.png automatically.
 *
 *   node scripts/make-icons.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');

// ------------------------------------------------------------- PNG encoding

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- rendering

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const SAMPLES = 3; // supersampling grid per axis

/**
 * @param {number} size
 * @param {(x: number, y: number) => [number, number, number, number]} shade
 *        returns premultiplied-free RGBA in 0-255 for a sample point
 */
function render(size, shade) {
  const buf = Buffer.alloc(size * size * 4);
  const step = 1 / (SAMPLES + 1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 1; sy <= SAMPLES; sy++) {
        for (let sx = 1; sx <= SAMPLES; sx++) {
          const [sr, sg, sb, sa] = shade(x + sx * step, y + sy * step);
          const alpha = sa / 255;
          r += sr * alpha;
          g += sg * alpha;
          b += sb * alpha;
          a += sa;
        }
      }

      const n = SAMPLES * SAMPLES;
      const outA = a / n;
      const weight = outA > 0 ? a / 255 : 1;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r / weight);
      buf[i + 1] = Math.round(g / weight);
      buf[i + 2] = Math.round(b / weight);
      buf[i + 3] = Math.round(outA);
    }
  }
  return buf;
}

function appIcon(size) {
  const c = size / 2;
  const pad = size * 0.06;
  const half = c - pad;
  const radius = size * 0.225;

  // Play triangle, optically centred (nudged right of true centre).
  const t = size * 0.2;
  const a = [c - t * 0.75, c - t];
  const b = [c - t * 0.75, c + t];
  const d = [c + t * 0.95, c];

  return render(size, (x, y) => {
    const dist = roundedRect(x, y, c, c, half, half, radius);
    if (dist > 0.7) return [0, 0, 0, 0];

    const edge = Math.max(0, Math.min(1, 0.5 - dist));
    const alpha = Math.round(255 * Math.min(1, edge + 0.5));

    if (insideTriangle(x, y, a, b, d)) return [103, 232, 249, alpha];

    // Vertical gradient from a lighter top to near-black bottom.
    const k = y / size;
    return [
      Math.round(26 - 14 * k),
      Math.round(28 - 15 * k),
      Math.round(36 - 20 * k),
      alpha,
    ];
  });
}

/** Monochrome template image: macOS recolours it for light/dark menu bars. */
function trayIcon(size) {
  const c = size / 2;
  const t = size * 0.3;
  const a = [c - t * 0.7, c - t];
  const b = [c - t * 0.7, c + t];
  const d = [c + t * 0.9, c];

  return render(size, (x, y) => (insideTriangle(x, y, a, b, d) ? [0, 0, 0, 255] : [0, 0, 0, 0]));
}

// -------------------------------------------------------------------- write

fs.mkdirSync(outDir, { recursive: true });

const files = [
  ['icon.png', 1024, appIcon(1024)],
  ['trayTemplate.png', 22, trayIcon(22)],
  ['trayTemplate@2x.png', 44, trayIcon(44)],
];

for (const [name, size, pixels] of files) {
  fs.writeFileSync(path.join(outDir, name), encodePng(size, size, pixels));
  console.log(`build/${name} (${size}x${size})`);
}
