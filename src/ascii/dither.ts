/** Dithering. */

import type { DitherMode } from "./types";

/** Standard 8x8 Bayer threshold matrix, values 0–63. */
const BAYER_8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

/** Nearest entry in a sorted, ascending level table. */
function nearestLevel(levels: Float32Array, v: number): number {
  const n = levels.length;
  if (n <= 1) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (levels[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(levels[lo - 1] - v) < Math.abs(levels[lo] - v)) {
    return lo - 1;
  }
  return lo;
}

/** Quantises `plane` to `levels`, returning the chosen level index per sample. */
export function ditherPlane(
  plane: Float32Array,
  w: number,
  h: number,
  levels: Float32Array,
  mode: DitherMode,
  amount: number
): Uint16Array {
  const out = new Uint16Array(w * h);
  const k = Math.max(0, Math.min(1, amount / 100));

  if (mode === "none" || k === 0) {
    for (let i = 0; i < out.length; i++) out[i] = nearestLevel(levels, plane[i]);
    return out;
  }

  if (mode === "bayer") {
    // Ordered dither: offset by matrix position, then round.
    const step = levels.length > 1 ? 1 / (levels.length - 1) : 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = BAYER_8[(y & 7) * 8 + (x & 7)] / 64 - 0.5;
        out[i] = nearestLevel(levels, plane[i] + t * step * k);
      }
    }
    return out;
  }

  // Error diffusion.
  const atkinson = mode === "atkinson";

  for (let y = 0; y < h; y++) {
    const leftToRight = (y & 1) === 0;
    const xStart = leftToRight ? 0 : w - 1;
    const xEnd = leftToRight ? w : -1;
    const xStep = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const i = y * w + x;
      const old = plane[i];
      const idx = nearestLevel(levels, old);
      out[i] = idx;
      const err = (old - levels[idx]) * k;
      if (err === 0) continue;

      // Mirror the kernel when scanning right-to-left.
      const fwd = xStep;

      if (atkinson) {
        // Atkinson only spreads 6/8 of the error. Crisper, less contrast.
        const e = err / 8;
        spread(plane, w, h, x + fwd, y, e);
        spread(plane, w, h, x + 2 * fwd, y, e);
        spread(plane, w, h, x - fwd, y + 1, e);
        spread(plane, w, h, x, y + 1, e);
        spread(plane, w, h, x + fwd, y + 1, e);
        spread(plane, w, h, x, y + 2, e);
      } else {
        // Floyd–Steinberg.
        spread(plane, w, h, x + fwd, y, (err * 7) / 16);
        spread(plane, w, h, x - fwd, y + 1, (err * 3) / 16);
        spread(plane, w, h, x, y + 1, (err * 5) / 16);
        spread(plane, w, h, x + fwd, y + 1, (err * 1) / 16);
      }
    }
  }

  return out;
}

function spread(
  plane: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  amount: number
): void {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  plane[y * w + x] += amount;
}
