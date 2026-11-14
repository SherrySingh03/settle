// Draws Settle's icon: a marigold sun settling onto the horizon, with two fading reflections, on the night ground.
// One description of the shapes renders both outputs, so they always match:
//   src/icon.png          512x423, the TV app icon (Samsung's size for TV app icons); packed into the .wgt
//   docs/img/logo.svg     the same art as a vector, for the README and anywhere else
//   docs/img/icon-512.png 512x512, a square copy (avatars, social cards)
// No dependencies: shapes are rasterised here with 4x4 supersampling and written as PNG with zlib.
//   npm run icon
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SUN = [255, 178, 63];                      // --acc, the launcher's accent
const TOP = [24, 27, 34], BOTTOM = [10, 11, 13]; // the launcher's ground, lifted a little at the top

// The art, in a 100x100 box centred on the canvas. Half disc above the horizon (y 50), two rounded bars below it.
const ART = {
  sun: { cx: 50, cy: 50, r: 26 },
  bars: [{ x0: 22, x1: 78, y0: 58, y1: 64, a: 0.72 }, { x0: 34, x1: 66, y0: 70, y1: 76, a: 0.4 }],
  glow: { cx: 50, cy: 50, r: 62, a: 0.16 }       // warm haze behind the sun
};

function sdRoundBar(px, py, b) {                 // signed distance to a fully rounded bar (a capsule)
  const r = (b.y1 - b.y0) / 2, cy = (b.y0 + b.y1) / 2;
  const qx = Math.max(b.x0 + r - px, 0, px - (b.x1 - r));
  return Math.hypot(qx, py - cy) - r;
}

// Colour of one sample point (u, v in art units) over the background at canvas row fraction t.
function sample(u, v, t) {
  let c = TOP.map((a, i) => a + (BOTTOM[i] - a) * t);
  const g = ART.glow, gd = Math.hypot(u - g.cx, v - g.cy) / g.r;
  if (gd < 1) { const k = g.a * (1 - gd) * (1 - gd); c = c.map((x, i) => x + (SUN[i] - x) * k); }
  const s = ART.sun;
  if (v <= s.cy && Math.hypot(u - s.cx, v - s.cy) <= s.r) return SUN;
  for (const b of ART.bars) if (sdRoundBar(u, v, b) <= 0) return c.map((x, i) => x + (SUN[i] - x) * b.a);
  return c;
}

function render(W, H, artSize) {
  const raw = Buffer.alloc((W * 4 + 1) * H), N = 4;
  const scale = artSize / 100, ox = (W - artSize) / 2, oy = (H - artSize) / 2;
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const px = x + (i + 0.5) / N, py = y + (j + 0.5) / N;
        const c = sample((px - ox) / scale, (py - oy) / scale, py / H);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (W * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k] / (N * N));
      raw[o + 3] = 255;
    }
  }
  return png(W, H, raw);
}

const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function png(W, H, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// The same art as SVG (rounded square, for display; the TV icon itself is full-bleed).
function svg() {
  const hex = (c) => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
  const s = ART.sun, g = ART.glow;
  const bars = ART.bars.map((b) => `<rect x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" rx="${(b.y1 - b.y0) / 2}" fill="${hex(SUN)}" fill-opacity="${b.a}"/>`).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512" role="img" aria-label="Settle">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(TOP)}"/><stop offset="1" stop-color="${hex(BOTTOM)}"/></linearGradient>
    <radialGradient id="glow" cx="${g.cx}" cy="${g.cy}" r="${g.r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${hex(SUN)}" stop-opacity="${g.a}"/><stop offset="0.5" stop-color="${hex(SUN)}" stop-opacity="${(g.a / 4).toFixed(3)}"/><stop offset="1" stop-color="${hex(SUN)}" stop-opacity="0"/></radialGradient>
    <clipPath id="sky"><rect x="0" y="0" width="100" height="${s.cy}"/></clipPath>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#ground)"/>
  <rect width="100" height="100" rx="22" fill="url(#glow)"/>
  <circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${hex(SUN)}" clip-path="url(#sky)"/>
  ${bars}
</svg>
`;
}

function out(rel, data) {
  const p = resolve(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  console.log(rel, data.length, 'bytes');
}
out('src/icon.png', render(512, 423, 400));       // the drawing (56% of its box) spans about half the height: room for the TV's rounded mask
out('docs/img/icon-512.png', render(512, 512, 470));
out('docs/img/logo.svg', svg());
