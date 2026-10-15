/** Glyph measurement and rasterisation. */

import type { FontMetrics, GlyphSet } from "./types";

/** Signature grid per glyph. 4x8 mirrors the ~1:2 aspect of a monospace cell. */
export const SIG_W = 4;
export const SIG_H = 8;

/** Resolution glyphs are measured at before being reduced to a signature. */
const MEASURE_W = 16;
const MEASURE_H = 32;

/** Canvas dimensions stay well inside every browser's surface limit. */
const MAX_STRIP = 8192;

const metricsCache = new Map<string, FontMetrics>();
const glyphSetCache = new Map<string, GlyphSet>();
const maskCache = new Map<string, Uint8Array>();

function scratch(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

function fontString(family: string, weight: number, size: number): string {
  return `${weight} ${size}px ${family}`;
}

/** Font advance and extents at size 1. */
export function measureFont(family: string, weight: number): FontMetrics {
  const key = `${family}|${weight}`;
  const cached = metricsCache.get(key);
  if (cached) return cached;

  const ctx = scratch(8, 8);
  const probe = 100;
  ctx.font = fontString(family, weight, probe);

  // Average a few in case the font isn't actually monospace.
  const samples = ["M", "0", "@", "w"];
  let advance = 0;
  for (const ch of samples) advance += ctx.measureText(ch).width;
  advance /= samples.length;

  const m = ctx.measureText("Mgjpq|");
  const ascent =
    m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? probe * 0.8;
  const descent =
    m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? probe * 0.2;

  const metrics: FontMetrics = {
    advanceRatio: advance > 0 ? advance / probe : 0.6,
    ascentRatio: ascent / probe,
    descentRatio: descent / probe,
  };
  metricsCache.set(key, metrics);
  return metrics;
}

/** The font size at which one glyph's advance width fills exactly `cellW`. */
export function fontSizeForCell(cellW: number, metrics: FontMetrics): number {
  return cellW / (metrics.advanceRatio || 0.6);
}

/** Vertical baseline offset within a cell. */
export function baselineForCell(
  cellH: number,
  fontSize: number,
  metrics: FontMetrics
): number {
  const ascent = metrics.ascentRatio * fontSize;
  const descent = metrics.descentRatio * fontSize;
  const boxHeight = ascent + descent;
  return (cellH - boxHeight) / 2 + ascent;
}

/** Rasterises every character into an alpha mask of `cellW` x `cellH`. */
export function rasterizeMasks(
  chars: string[],
  cellW: number,
  cellH: number,
  family: string,
  weight: number
): Uint8Array {
  const cw = Math.max(1, Math.round(cellW));
  const ch = Math.max(1, Math.round(cellH));
  const key = `${family}|${weight}|${cw}x${ch}|${chars.join("")}`;
  const cached = maskCache.get(key);
  if (cached) return cached;

  const perRow = Math.max(1, Math.floor(MAX_STRIP / cw));
  const rows = Math.ceil(chars.length / perRow);
  const ctx = scratch(perRow * cw, rows * ch);

  const metrics = measureFont(family, weight);
  const fontSize = fontSizeForCell(cw, metrics);
  const baseline = baselineForCell(ch, fontSize, metrics);

  ctx.font = fontString(family, weight, fontSize);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";

  for (let i = 0; i < chars.length; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    ctx.fillText(chars[i], col * cw + cw / 2, row * ch + baseline);
  }

  const data = ctx.getImageData(0, 0, perRow * cw, rows * ch).data;
  const out = new Uint8Array(chars.length * cw * ch);
  const stripW = perRow * cw;

  for (let i = 0; i < chars.length; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const originX = col * cw;
    const originY = row * ch;
    const base = i * cw * ch;
    for (let y = 0; y < ch; y++) {
      const srcRow = (originY + y) * stripW + originX;
      const dstRow = base + y * cw;
      for (let x = 0; x < cw; x++) {
        // Alpha channel is the coverage; the fill is pure white.
        out[dstRow + x] = data[(srcRow + x) * 4 + 3];
      }
    }
  }

  // Cache bound: masks at large cell sizes are megabytes each.
  if (maskCache.size > 24) maskCache.clear();
  maskCache.set(key, out);
  return out;
}

/** Builds a density-sorted glyph set with shape signatures. */
export function buildGlyphSet(
  charsInput: string,
  family: string,
  weight: number
): GlyphSet {
  const key = `${family}|${weight}|${charsInput}`;
  const cached = glyphSetCache.get(key);
  if (cached) return cached;

  const chars = Array.from(charsInput);
  if (chars.length === 0) chars.push(" ");

  const masks = rasterizeMasks(chars, MEASURE_W, MEASURE_H, family, weight);
  const cellPixels = MEASURE_W * MEASURE_H;

  // Mean coverage per glyph, plus a box-downsampled shape signature.
  const rawDensity = new Float32Array(chars.length);
  const rawSig = new Float32Array(chars.length * SIG_W * SIG_H);
  const boxW = MEASURE_W / SIG_W;
  const boxH = MEASURE_H / SIG_H;

  for (let i = 0; i < chars.length; i++) {
    const base = i * cellPixels;
    let total = 0;
    for (let p = 0; p < cellPixels; p++) total += masks[base + p];
    rawDensity[i] = total / (cellPixels * 255);

    for (let sy = 0; sy < SIG_H; sy++) {
      for (let sx = 0; sx < SIG_W; sx++) {
        let sum = 0;
        for (let y = 0; y < boxH; y++) {
          const rowOffset = base + (sy * boxH + y) * MEASURE_W + sx * boxW;
          for (let x = 0; x < boxW; x++) sum += masks[rowOffset + x];
        }
        rawSig[i * SIG_W * SIG_H + sy * SIG_W + sx] =
          sum / (boxW * boxH * 255);
      }
    }
  }

  // Sort ascending by ink so `density[k]` increases monotonically.
  const order = chars.map((_, i) => i);
  order.sort((a, b) => {
    const d = rawDensity[a] - rawDensity[b];
    if (d !== 0) return d;
    return chars[a].codePointAt(0)! - chars[b].codePointAt(0)!;
  });

  const sortedChars: string[] = [];
  const density = new Float32Array(chars.length);
  const sig = new Float32Array(chars.length * SIG_W * SIG_H);

  for (let k = 0; k < order.length; k++) {
    const src = order[k];
    sortedChars.push(chars[src]);
    density[k] = rawDensity[src];
    sig.set(
      rawSig.subarray(
        src * SIG_W * SIG_H,
        src * SIG_W * SIG_H + SIG_W * SIG_H
      ),
      k * SIG_W * SIG_H
    );
  }

  // Stretch densities to 0..1 so small sets still use the full range.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < density.length; i++) {
    if (density[i] < min) min = density[i];
    if (density[i] > max) max = density[i];
  }
  const span = max - min;
  const normDensity = new Float32Array(density.length);
  for (let i = 0; i < density.length; i++) {
    normDensity[i] =
      span > 1e-6
        ? (density[i] - min) / span
        : i / Math.max(1, density.length - 1);
  }

  const set: GlyphSet = {
    key,
    chars: sortedChars,
    density: normDensity,
    rawDensity: density,
    sig,
    sigW: SIG_W,
    sigH: SIG_H,
  };

  if (glyphSetCache.size > 32) glyphSetCache.clear();
  glyphSetCache.set(key, set);
  return set;
}

/** Index of the glyph whose density is closest to `ink`. */
export function glyphForInk(set: GlyphSet, ink: number): number {
  const d = set.density;
  const n = d.length;
  if (n === 1) return 0;

  const ascending = d[n - 1] >= d[0];
  let lo = 0;
  let hi = n - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const goRight = ascending ? d[mid] < ink : d[mid] > ink;
    if (goRight) lo = mid + 1;
    else hi = mid;
  }

  // Binary search overshoots by one; check the neighbour below.
  if (lo > 0 && Math.abs(d[lo - 1] - ink) < Math.abs(d[lo] - ink)) return lo - 1;
  return lo;
}

export function clearGlyphCaches(): void {
  metricsCache.clear();
  glyphSetCache.clear();
  maskCache.clear();
}
