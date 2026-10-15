/** Per-pixel image adjustments applied before characters are chosen. */

import { LUMA_B, LUMA_G, LUMA_R } from "./color";

export interface AdjustParams {
  /** -100–100 */
  brightness: number;
  /** -100–100 */
  contrast: number;
  /** 0.1–3.0 */
  gamma: number;
  /** -100–100 */
  saturation: number;
  invert: boolean;
}

/** Builds a 256-entry lookup table for brightness → contrast → gamma → invert. */
export function buildToneLut(p: AdjustParams): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);

  const offset = p.brightness / 200; // ±0.5 in normalised space
  // Standard contrast factor: maps -100..100 onto a smooth pivot at mid-grey.
  const c = Math.max(-255, Math.min(255, p.contrast * 2.55));
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const invGamma = 1 / Math.max(0.01, p.gamma);

  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v += offset;
    v = factor * (v - 0.5) + 0.5;
    v = Math.max(0, Math.min(1, v));
    v = Math.pow(v, invGamma);
    if (p.invert) v = 1 - v;
    lut[i] = Math.round(v * 255);
  }
  return lut;
}

/** Tone + saturation in place, luma (0–1) into `lumaOut`. */
export function applyAdjustments(
  rgba: Uint8ClampedArray,
  lumaOut: Float32Array,
  params: AdjustParams
): void {
  const lut = buildToneLut(params);
  const sat = 1 + params.saturation / 100;
  const needsSat = Math.abs(sat - 1) > 1e-3;
  const pixels = lumaOut.length;

  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    let r = lut[rgba[o]];
    let g = lut[rgba[o + 1]];
    let b = lut[rgba[o + 2]];

    if (needsSat) {
      const grey = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      r = grey + (r - grey) * sat;
      g = grey + (g - grey) * sat;
      b = grey + (b - grey) * sat;
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
    } else {
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
    }

    lumaOut[i] = (LUMA_R * r + LUMA_G * g + LUMA_B * b) / 255;
  }
}

/** Histogram resolution for {@link autoLevels}. Finer than the eye, cheap to scan. */
const LEVEL_BINS = 512;

/** Fraction of samples clipped at each end before the stretch. */
const CLIP = 0.004;

export interface LevelPoints {
  black: number;
  white: number;
}

/** Stretches luma so darkest/brightest land on 0 and 1. In place. */
export function autoLevels(
  luma: Float32Array,
  previous: LevelPoints | null
): LevelPoints | null {
  const n = luma.length;
  if (n === 0) return null;

  const histogram = new Uint32Array(LEVEL_BINS);
  for (let i = 0; i < n; i++) {
    const v = luma[i];
    const bin = v <= 0 ? 0 : v >= 1 ? LEVEL_BINS - 1 : (v * (LEVEL_BINS - 1)) | 0;
    histogram[bin]++;
  }

  const clip = Math.max(1, Math.floor(n * CLIP));

  let count = 0;
  let lowBin = 0;
  for (let i = 0; i < LEVEL_BINS; i++) {
    count += histogram[i];
    if (count > clip) {
      lowBin = i;
      break;
    }
  }

  count = 0;
  let highBin = LEVEL_BINS - 1;
  for (let i = LEVEL_BINS - 1; i >= 0; i--) {
    count += histogram[i];
    if (count > clip) {
      highBin = i;
      break;
    }
  }

  let black = lowBin / (LEVEL_BINS - 1);
  let white = highBin / (LEVEL_BINS - 1);

  // Flat plane, nothing to stretch. Doing it anyway just amplifies noise.
  if (white - black < 0.05) return previous;

  if (previous) {
    // A cut moves the points further than any camera move can.
    const jump =
      Math.abs(black - previous.black) + Math.abs(white - previous.white);
    if (jump < 0.25) {
      black = previous.black + (black - previous.black) * 0.15;
      white = previous.white + (white - previous.white) * 0.15;
    }
  }

  const scale = 1 / (white - black);
  for (let i = 0; i < n; i++) {
    const v = (luma[i] - black) * scale;
    luma[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  return { black, white };
}

/** Unsharp mask on the luminance plane. */
export function sharpenLuma(
  luma: Float32Array,
  w: number,
  h: number,
  amount: number
): Float32Array {
  const k = amount / 100;
  if (k <= 0.001 || w < 3 || h < 3) return luma;

  const out = new Float32Array(luma.length);
  for (let y = 0; y < h; y++) {
    const yUp = y > 0 ? y - 1 : 0;
    const yDn = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xL = x > 0 ? x - 1 : 0;
      const xR = x < w - 1 ? x + 1 : w - 1;

      // 3x3 box blur, then push the pixel away from it.
      const blur =
        (luma[yUp * w + xL] + luma[yUp * w + x] + luma[yUp * w + xR] +
          luma[y * w + xL] + luma[y * w + x] + luma[y * w + xR] +
          luma[yDn * w + xL] + luma[yDn * w + x] + luma[yDn * w + xR]) / 9;

      const v = luma[y * w + x];
      const sharpened = v + (v - blur) * k * 3;
      out[y * w + x] = sharpened < 0 ? 0 : sharpened > 1 ? 1 : sharpened;
    }
  }
  return out;
}
