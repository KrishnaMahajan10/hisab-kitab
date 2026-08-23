/**
 * Regenerates every app icon and the splash mark from one vector description.
 *
 *   npm run icons
 *
 * The mark is a three-slice donut chart -- the same breakdown the home screen
 * draws -- on a deep blue gradient. Everything is rasterised here with 3x
 * supersampling so the repo needs no image toolchain.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// ---------------------------------------------------------------- brand

const GRADIENT_FROM = [0x3f, 0x7e, 0xff];
const GRADIENT_TO = [0x11, 0x2c, 0x75];

// `lift` pushes a slice past the ring so the mark keeps a silhouette of its
// own instead of reading as a plain donut.
const SEGMENTS = [
  { sweep: 0.54, lift: 1.085, color: [0xff, 0xff, 0xff] }, // spent
  { sweep: 0.28, lift: 1, color: [0x34, 0xd3, 0x99] }, // received
  { sweep: 0.18, lift: 1, color: [0xfb, 0xbf, 0x24] }, // pending review
];
const MAX_LIFT = Math.max(...SEGMENTS.map((segment) => segment.lift));
const START_ANGLE = -100; // degrees clockwise from 12 o'clock
const GAP = 5; // degrees of background showing between slices

// ---------------------------------------------------------------- geometry

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (v) => v * v * (3 - 2 * v);

/** Which slice covers this point, or null outside the donut. */
function sliceAt(x, y, { cx, cy, outer, inner }) {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r < inner || r > outer * MAX_LIFT) return null;

  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 720) % 360;
  let cursor = START_ANGLE;
  for (const segment of SEGMENTS) {
    const start = cursor;
    const end = cursor + segment.sweep * 360;
    cursor = end;
    const from = ((start + GAP / 2) + 720) % 360;
    const to = ((end - GAP / 2) + 720) % 360;
    const inside = from <= to ? deg >= from && deg <= to : deg >= from || deg <= to;
    if (inside) return r <= outer * segment.lift ? segment.color : null;
  }
  return null;
}

/** Rounded-rect coverage test in unit space; radius 0 means a full square. */
function insideTile(x, y, radius) {
  if (radius <= 0) return true;
  const qx = Math.abs(x - 0.5) - (0.5 - radius);
  const qy = Math.abs(y - 0.5) - (0.5 - radius);
  if (qx <= 0 || qy <= 0) return Math.max(qx, qy) <= 0;
  return Math.hypot(qx, qy) <= radius;
}

function gradientAt(x, y) {
  const t = clamp01((x + y) / 2);
  const rgb = [
    GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * t,
    GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * t,
    GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * t,
  ];
  // Soft highlight so the tile reads as lit from the top-left.
  const glow = 0.2 * (1 - smoothstep(clamp01(Math.hypot(x - 0.26, y - 0.2) / 0.72)));
  return rgb.map((c) => clamp01((c / 255) * (1 - glow) + glow) * 255);
}

// ---------------------------------------------------------------- raster

const SAMPLES = 3; // per axis

/**
 * @param {object} options
 * @param {number} options.size          output edge in pixels
 * @param {'gradient'|'none'} options.tile
 * @param {number} [options.radius]      tile corner radius, unit space
 * @param {number} [options.outer]       donut outer radius, unit space (0 = no mark)
 * @param {number} [options.inner]
 * @param {boolean} [options.mono]       draw the mark as flat white
 */
function render({ size, tile, radius = 0, outer = 0, inner = 0, mono = false }) {
  const pixels = Buffer.alloc(size * size * 4);
  const donut = { cx: 0.5, cy: 0.5, outer, inner };
  const step = 1 / (size * SAMPLES);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px * SAMPLES + sx + 0.5) * step;
          const y = (py * SAMPLES + sy + 0.5) * step;

          let sample = null;
          if (outer > 0) {
            const slice = sliceAt(x, y, donut);
            if (slice) sample = mono ? [0xff, 0xff, 0xff] : slice;
          }
          if (!sample && tile === 'gradient' && insideTile(x, y, radius)) {
            sample = gradientAt(x, y);
          }
          if (!sample) continue;

          r += sample[0];
          g += sample[1];
          b += sample[2];
          a += 255;
        }
      }

      const total = SAMPLES * SAMPLES;
      const offset = (py * size + px) * 4;
      if (a > 0) {
        // Premultiplied accumulation divided back out keeps edges from darkening.
        pixels[offset] = Math.round(r / (a / 255));
        pixels[offset + 1] = Math.round(g / (a / 255));
        pixels[offset + 2] = Math.round(b / (a / 255));
        pixels[offset + 3] = Math.round(a / total);
      }
    }
  }

  return pixels;
}

// ---------------------------------------------------------------- png

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- outputs

const OUTPUTS = [
  // iOS and the store want an opaque square; the platform applies its own mask.
  { file: 'icon.png', size: 1024, tile: 'gradient', outer: 0.3, inner: 0.163 },
  // Adaptive icon layers: the mark stays inside Android's 66/108 safe circle.
  { file: 'android-icon-foreground.png', size: 1024, tile: 'none', outer: 0.272, inner: 0.148 },
  { file: 'android-icon-background.png', size: 1024, tile: 'gradient' },
  {
    file: 'android-icon-monochrome.png',
    size: 1024,
    tile: 'none',
    outer: 0.272,
    inner: 0.148,
    mono: true,
  },
  { file: 'favicon.png', size: 96, tile: 'gradient', radius: 0.22, outer: 0.308, inner: 0.167 },
  // Splash mark: transparent, the splash background colour shows through.
  { file: 'splash-icon.png', size: 1024, tile: 'none', outer: 0.41, inner: 0.222 },
];

for (const output of OUTPUTS) {
  const png = encodePng(render(output), output.size);
  writeFileSync(join(ASSETS, output.file), png);
  console.log(`${output.file.padEnd(32)} ${output.size}x${output.size}  ${png.length} bytes`);
}
