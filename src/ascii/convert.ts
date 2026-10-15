/** The conversion pipeline. */

import {
  BRAILLE_BITS,
  EDGE_CHARS,
  QUADRANT_CHARS,
  getCharset,
} from "./charsets";
import {
  getPalette,
  hexToRgb,
  luma as lumaOf,
  medianCut,
  nearestInPalette,
  paletteToArray,
  type RGB,
} from "./color";
import { ditherPlane } from "./dither";
import { computeEdges } from "./edges";
import { SIG_H, SIG_W, buildGlyphSet, glyphForInk } from "./glyphs";
import { applyAdjustments, autoLevels, sharpenLuma } from "./imageops";
import { drawDownscaled } from "./resample";
import type {
  AsciiFrame,
  AsciiSettings,
  AsciiSource,
  GlyphSet,
  TemporalState,
} from "./types";

export const MIN_COLS = 16;
export const MAX_COLS = 600;
export const MAX_EXACT_COLS = 2048;

/** Cell budgets, per mode. */
const CELL_BUDGET: Record<string, number> = {
  density: 400_000,
  shape: 110_000,
  braille: 220_000,
  blocks: 320_000,
};

/** Maps the 0–100 detail slider to a column count. */
export function detailToColumns(detail: number): number {
  const t = Math.max(0, Math.min(1, detail / 100));
  return Math.round(MIN_COLS + (MAX_COLS - MIN_COLS) * Math.pow(t, 2.2));
}

/** Inverse of {@link detailToColumns}, for showing the slider a column count. */
export function columnsToDetail(cols: number): number {
  const t = (cols - MIN_COLS) / (MAX_COLS - MIN_COLS);
  return Math.round(Math.pow(Math.max(0, Math.min(1, t)), 1 / 2.2) * 100);
}

export interface GridSize {
  cols: number;
  rows: number;
}

/** Derives grid rows while preserving the source and character aspect ratios. */
export function rowsForColumns(
  sourceWidth: number,
  sourceHeight: number,
  columns: number,
  charAspect: number
): number {
  const aspect = charAspect > 0 ? charAspect : 2;
  return Math.max(
    1,
    Math.round((columns * sourceHeight) / (sourceWidth * aspect))
  );
}

/** Applies the conversion engine's performance ceiling to an existing grid. */
export function applyCellBudget(
  cols: number,
  rows: number,
  mode: string
): GridSize {
  const budget = CELL_BUDGET[mode] ?? CELL_BUDGET.density;
  if (cols * rows <= budget) return { cols, rows };

  const scale = Math.sqrt(budget / (cols * rows));
  const budgetedCols = Math.max(MIN_COLS, Math.floor(cols * scale));
  const scaledRows = Math.max(1, Math.floor(rows * scale));
  return {
    cols: budgetedCols,
    rows: Math.min(scaledRows, Math.floor(budget / budgetedCols)),
  };
}

/** Works out the grid for a source, applying the aspect and cell budget. */
export function computeGrid(
  srcW: number,
  srcH: number,
  settings: AsciiSettings
): GridSize {
  const requested =
    settings.columnsOverride ?? detailToColumns(settings.detail);
  let cols = Math.max(
    MIN_COLS,
    Math.min(MAX_EXACT_COLS, Math.round(requested))
  );
  let rows = rowsForColumns(srcW, srcH, cols, settings.charAspect);

  ({ cols, rows } = applyCellBudget(cols, rows, settings.mode));
  return { cols, rows };
}

/** Sub-cell sampling grid per render mode. */
function subGridFor(mode: string): [number, number] {
  switch (mode) {
    case "shape":
      return [SIG_W, SIG_H];
    case "braille":
      return [2, 4];
    case "blocks":
      return [2, 2];
    default:
      return [2, 4];
  }
}

export function sourceSize(source: AsciiSource): { w: number; h: number } {
  const s = source as unknown as {
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const w = s.videoWidth || s.naturalWidth || s.width || 0;
  const h = s.videoHeight || s.naturalHeight || s.height || 0;
  return { w: Math.round(w), h: Math.round(h) };
}

let sampleCanvas: HTMLCanvasElement | null = null;

function sampleContext(w: number, h: number): CanvasRenderingContext2D {
  if (!sampleCanvas) sampleCanvas = document.createElement("canvas");
  if (sampleCanvas.width !== w || sampleCanvas.height !== h) {
    sampleCanvas.width = w;
    sampleCanvas.height = h;
  }
  const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

const BRAILLE_CHARS: string[] = Array.from({ length: 256 }, (_, i) =>
  String.fromCharCode(0x2800 + i)
);

/** Braille bit index for a given sub-cell position, precomputed as a flat map. */
const BRAILLE_BIT_AT = (() => {
  const map = new Uint8Array(2 * 4);
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 4; y++) map[y * 2 + x] = BRAILLE_BITS[x][y];
  }
  return map;
})();

/** Glyph signature reduced to the active sub-grid. */
function buildSubMasks(
  set: GlyphSet,
  count: number,
  subW: number,
  subH: number
): Float32Array {
  const out = new Float32Array(count * subW * subH);
  const boxW = SIG_W / subW;
  const boxH = SIG_H / subH;

  for (let g = 0; g < count; g++) {
    for (let sy = 0; sy < subH; sy++) {
      for (let sx = 0; sx < subW; sx++) {
        let sum = 0;
        let n = 0;
        for (let y = 0; y < boxH; y++) {
          for (let x = 0; x < boxW; x++) {
            const gy = Math.min(SIG_H - 1, Math.floor(sy * boxH + y));
            const gx = Math.min(SIG_W - 1, Math.floor(sx * boxW + x));
            sum += set.sig[g * SIG_W * SIG_H + gy * SIG_W + gx];
            n++;
          }
        }
        out[g * subW * subH + sy * subW + sx] = n > 0 ? sum / n : 0;
      }
    }
  }
  return out;
}

/** Sub-masks for bitmask glyph tables (Braille, quadrant blocks). */
function buildBitMasks(
  count: number,
  subW: number,
  subH: number,
  bitAt: (sx: number, sy: number) => number
): Float32Array {
  const out = new Float32Array(count * subW * subH);
  for (let g = 0; g < count; g++) {
    for (let sy = 0; sy < subH; sy++) {
      for (let sx = 0; sx < subW; sx++) {
        const bit = bitAt(sx, sy);
        out[g * subW * subH + sy * subW + sx] = (g >> bit) & 1;
      }
    }
  }
  return out;
}

function lowerBound(arr: Float32Array, value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface ConvertResult {
  frame: AsciiFrame;
  /** Timing in ms, useful for the stats panel. */
  elapsed: number;
}

export function convert(
  source: AsciiSource,
  settings: AsciiSettings,
  temporal?: TemporalState | null
): ConvertResult {
  const started =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const { w: srcW, h: srcH } = sourceSize(source);
  if (srcW <= 0 || srcH <= 0) {
    throw new Error("Source has no dimensions yet");
  }

  const { cols, rows } = computeGrid(srcW, srcH, settings);
  const [subW, subH] = subGridFor(settings.mode);
  const sw = cols * subW;
  const sh = rows * subH;
  const cellCount = cols * rows;
  const subCount = subW * subH;

  // 1. Sample
  const ctx = sampleContext(sw, sh);
  ctx.clearRect(0, 0, sw, sh);
  drawDownscaled(ctx, source as CanvasImageSource, srcW, srcH, sw, sh);
  const imageData = ctx.getImageData(0, 0, sw, sh);
  const rgba = imageData.data;

  // 2. Tone, saturation, sharpening
  const lumaPlane = new Float32Array(sw * sh);
  applyAdjustments(rgba, lumaPlane, {
    brightness: settings.brightness,
    contrast: settings.contrast,
    gamma: settings.gamma,
    saturation: settings.saturation,
    invert: settings.invert,
  });
  let lum = sharpenLuma(lumaPlane, sw, sh, settings.sharpness);

  if (settings.autoLevels) {
    const previous =
      temporal && temporal.prevBlack !== null && temporal.prevWhite !== null
        ? { black: temporal.prevBlack, white: temporal.prevWhite }
        : null;
    const points = autoLevels(lum, previous);
    if (temporal) {
      temporal.prevBlack = points ? points.black : null;
      temporal.prevWhite = points ? points.white : null;
    }
  } else if (temporal) {
    temporal.prevBlack = null;
    temporal.prevWhite = null;
  }

  // Blend against the previous frame to damp per-pixel noise in video.
  const blend = Math.max(0, Math.min(1, settings.frameBlend / 100)) * 0.6;
  if (
    temporal &&
    temporal.prevLuma &&
    temporal.prevLuma.length === lum.length &&
    blend > 0
  ) {
    const prev = temporal.prevLuma;
    if (lum === lumaPlane) lum = Float32Array.from(lum);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = lum[i] * (1 - blend) + prev[i] * blend;
    }
  }

  // 3. Per-cell aggregates
  const cellR = new Float32Array(cellCount);
  const cellG = new Float32Array(cellCount);
  const cellB = new Float32Array(cellCount);
  const cellL = new Float32Array(cellCount);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      let r = 0, g = 0, b = 0, l = 0;
      for (let sy = 0; sy < subH; sy++) {
        const rowBase = (cy * subH + sy) * sw + cx * subW;
        for (let sx = 0; sx < subW; sx++) {
          const p = rowBase + sx;
          const o = p * 4;
          r += rgba[o];
          g += rgba[o + 1];
          b += rgba[o + 2];
          l += lum[p];
        }
      }
      cellR[c] = r / subCount;
      cellG[c] = g / subCount;
      cellB[c] = b / subCount;
      cellL[c] = l / subCount;
    }
  }

  // 4. Ink plane
  // "Ink" is how much of a cell the character should cover.
  const bgRgb = hexToRgb(settings.bgColor);
  const bgIsDark =
    settings.transparentBg || lumaOf(bgRgb[0], bgRgb[1], bgRgb[2]) < 128;
  const flipInk = settings.reverseRamp;

  // Sharpen again at cell res; averaging sub-cells cancels most of the first pass.
  const inkLuma =
    settings.sharpness > 0
      ? sharpenLuma(cellL, cols, rows, settings.sharpness * 0.6)
      : cellL;

  const ink = new Float32Array(cellCount);
  for (let c = 0; c < cellCount; c++) {
    let v = bgIsDark ? inkLuma[c] : 1 - inkLuma[c];
    if (flipInk) v = 1 - v;
    ink[c] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // 5. Glyph selection
  const isBitMode = settings.mode === "braille" || settings.mode === "blocks";
  const chars = new Uint16Array(cellCount);

  let glyphs: string[];
  let subMasks: Float32Array;
  let baseSet: GlyphSet | null = null;
  let edgeIndex: number[] | null = null;

  if (isBitMode) {
    const braille = settings.mode === "braille";
    glyphs = braille ? BRAILLE_CHARS : QUADRANT_CHARS;
    subMasks = braille
      ? buildBitMasks(256, 2, 4, (sx, sy) => BRAILLE_BIT_AT[sy * 2 + sx])
      : buildBitMasks(16, 2, 2, (sx, sy) => sy * 2 + sx);

    // Threshold each sub-cell.
    const subInk = new Float32Array(sw * sh);
    for (let i = 0; i < subInk.length; i++) {
      let v = bgIsDark ? lum[i] : 1 - lum[i];
      if (flipInk) v = 1 - v;
      subInk[i] = v;
    }
    const binary = new Float32Array([0, 1]);
    const bits = ditherPlane(
      subInk,
      sw,
      sh,
      binary,
      settings.dither === "none" ? "floyd-steinberg" : settings.dither,
      settings.dither === "none" ? 100 : settings.ditherAmount
    );

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        let mask = 0;
        for (let sy = 0; sy < subH; sy++) {
          const rowBase = (cy * subH + sy) * sw + cx * subW;
          for (let sx = 0; sx < subW; sx++) {
            if (bits[rowBase + sx]) {
              const bit = braille
                ? BRAILLE_BIT_AT[sy * 2 + sx]
                : sy * 2 + sx;
              mask |= 1 << bit;
            }
          }
        }
        chars[cy * cols + cx] = mask;
      }
    }
  } else {
    const charsetString = getCharset(settings.charsetId, settings.customCharset);
    baseSet = buildGlyphSet(
      charsetString,
      settings.fontFamily,
      settings.fontWeight
    );

    const useEdges = settings.edgeStrength > 0;
    const edgeSet = useEdges
      ? buildGlyphSet(
          EDGE_CHARS.join(""),
          settings.fontFamily,
          settings.fontWeight
        )
      : null;

    glyphs = edgeSet
      ? [...baseSet.chars, ...edgeSet.chars]
      : [...baseSet.chars];

    // Edge glyphs live past the density ramp so they never disturb it.
    if (edgeSet) {
      edgeIndex = EDGE_CHARS.map(
        (ch) => baseSet!.chars.length + edgeSet.chars.indexOf(ch)
      );
    }

    const totalGlyphs = glyphs.length;
    const combinedSig = new Float32Array(totalGlyphs * SIG_W * SIG_H);
    combinedSig.set(baseSet.sig.subarray(0, baseSet.chars.length * SIG_W * SIG_H));
    if (edgeSet) {
      combinedSig.set(
        edgeSet.sig.subarray(0, edgeSet.chars.length * SIG_W * SIG_H),
        baseSet.chars.length * SIG_W * SIG_H
      );
    }
    subMasks = buildSubMasks(
      { ...baseSet, sig: combinedSig },
      totalGlyphs,
      subW,
      subH
    );

    if (settings.mode === "shape") {
      selectByShape(chars, ink, lum, baseSet, cols, rows, sw, subW, subH, bgIsDark, flipInk);
    } else {
      const working = Float32Array.from(ink);
      const idx = ditherPlane(
        working,
        cols,
        rows,
        baseSet.density,
        settings.dither,
        settings.ditherAmount
      );
      chars.set(idx);
    }
  }

  // 6. Edge overlay
  if (!isBitMode && settings.edgeStrength > 0 && edgeIndex) {
    const field = computeEdges(lum, sw, sh, cols, rows, subW, subH);
    const gain = settings.edgeStrength / 100;
    const threshold = Math.max(0.02, settings.edgeThreshold / 100);
    for (let c = 0; c < cellCount; c++) {
      if (field.strength[c] * gain >= threshold) {
        chars[c] = edgeIndex[field.direction[c]];
      }
    }
  }

  // 7. Temporal stability
  // Hysteresis so cells on a boundary don't flicker between glyphs.
  if (
    temporal &&
    temporal.prevChars &&
    temporal.prevInk &&
    temporal.cols === cols &&
    temporal.rows === rows &&
    // Indices are only meaningful against the table they were chosen from.
    temporal.glyphCount === glyphs.length &&
    settings.flickerReduction > 0
  ) {
    const tolerance = (settings.flickerReduction / 100) * 0.22;
    const prevChars = temporal.prevChars;
    const prevInk = temporal.prevInk;
    for (let c = 0; c < cellCount; c++) {
      if (Math.abs(ink[c] - prevInk[c]) < tolerance) chars[c] = prevChars[c];
    }
  }

  // 8. Colour
  const fg = new Uint8Array(cellCount * 3);
  const bg = settings.cellBackground ? new Uint8Array(cellCount * 3) : null;
  assignColors(
    fg, bg, chars, ink, cellR, cellG, cellB, cellL,
    subMasks, rgba, lum, cols, rows, sw, subW, subH, settings
  );

  // 9. Carry state to the next frame
  if (temporal) {
    temporal.prevChars = Uint16Array.from(chars);
    temporal.prevInk = Float32Array.from(ink);
    temporal.prevLuma = Float32Array.from(lum);
    temporal.cols = cols;
    temporal.rows = rows;
    temporal.glyphCount = glyphs.length;
  }

  const elapsed =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
    started;

  return {
    frame: { cols, rows, chars, fg, bg, glyphs, ink },
    elapsed,
  };
}

/** Shape matching: best glyph by sub-cell layout, not just brightness. */
function selectByShape(
  out: Uint16Array,
  ink: Float32Array,
  lum: Float32Array,
  set: GlyphSet,
  cols: number,
  rows: number,
  sw: number,
  subW: number,
  subH: number,
  bgIsDark: boolean,
  flipInk: boolean
): void {
  const subCount = subW * subH;
  const target = new Float32Array(subCount);
  const density = set.density;
  const n = density.length;
  const WINDOW = 0.18;
  const MIN_CANDIDATES = 6;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;

      for (let sy = 0; sy < subH; sy++) {
        const rowBase = (cy * subH + sy) * sw + cx * subW;
        for (let sx = 0; sx < subW; sx++) {
          let v = lum[rowBase + sx];
          v = bgIsDark ? v : 1 - v;
          if (flipInk) v = 1 - v;
          target[sy * subW + sx] = v;
        }
      }

      const want = ink[c];
      let lo = lowerBound(density, want - WINDOW);
      let hi = lowerBound(density, want + WINDOW);
      if (hi - lo < MIN_CANDIDATES) {
        const centre = glyphForInk(set, want);
        lo = Math.max(0, centre - (MIN_CANDIDATES >> 1));
        hi = Math.min(n, lo + MIN_CANDIDATES);
        lo = Math.max(0, hi - MIN_CANDIDATES);
      }

      let best = lo;
      let bestScore = Infinity;
      for (let g = lo; g < hi; g++) {
        let err = 0;
        const base = g * subCount;
        for (let k = 0; k < subCount; k++) {
          const d = set.sig[base + k] - target[k];
          err += d * d;
        }
        // Keep overall tone honest; shape alone can drift bright or dark.
        const dTone = density[g] - want;
        const score = err / subCount + dTone * dTone * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = g;
        }
      }
      out[c] = best;
    }
  }
}

/** Assigns per-cell foreground (and optional background) colour. */
function assignColors(
  fg: Uint8Array,
  bg: Uint8Array | null,
  chars: Uint16Array,
  ink: Float32Array,
  cellR: Float32Array,
  cellG: Float32Array,
  cellB: Float32Array,
  cellL: Float32Array,
  subMasks: Float32Array,
  rgba: Uint8ClampedArray,
  lum: Float32Array,
  cols: number,
  rows: number,
  sw: number,
  subW: number,
  subH: number,
  settings: AsciiSettings
): void {
  const subCount = subW * subH;
  const cellCount = cols * rows;
  const mode = settings.colorMode;
  const strength = Math.max(0, Math.min(1, settings.colorStrength / 100));

  const fgFlat = hexToRgb(settings.fgColor);
  const bgFlat = hexToRgb(settings.bgColor);
  const duoDark = hexToRgb(settings.duoDark);
  const duoLight = hexToRgb(settings.duoLight);

  let palette: Uint8Array | null = null;
  if (mode === "palette") {
    const preset = getPalette(settings.paletteId);
    if (settings.paletteId === "auto" || !preset || preset.colors.length === 0) {
      const sampleStride = Math.max(1, Math.floor(cellCount / 4096));
      const sampled: number[] = [];
      for (let c = 0; c < cellCount; c += sampleStride) {
        sampled.push(cellR[c], cellG[c], cellB[c]);
      }
      palette = medianCut(Uint8Array.from(sampled), settings.paletteSize);
    } else {
      palette = paletteToArray(preset.colors);
    }
  }

  const onColor: RGB = [0, 0, 0];
  const offColor: RGB = [0, 0, 0];

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      const g = chars[c];
      const maskBase = g * subCount;

      let wOn = 0;
      let rOn = 0, gOn = 0, bOn = 0, lOn = 0;
      let rOff = 0, gOff = 0, bOff = 0, lOff = 0;

      for (let sy = 0; sy < subH; sy++) {
        const rowBase = (cy * subH + sy) * sw + cx * subW;
        for (let sx = 0; sx < subW; sx++) {
          const m = subMasks[maskBase + sy * subW + sx];
          const p = rowBase + sx;
          const o = p * 4;
          const r = rgba[o], gg = rgba[o + 1], b = rgba[o + 2], l = lum[p];
          rOn += r * m; gOn += gg * m; bOn += b * m; lOn += l * m;
          const inv = 1 - m;
          rOff += r * inv; gOff += gg * inv; bOff += b * inv; lOff += l * inv;
          wOn += m;
        }
      }
      const wOff = subCount - wOn;

      if (wOn > 0.02) {
        onColor[0] = rOn / wOn; onColor[1] = gOn / wOn; onColor[2] = bOn / wOn;
      } else {
        onColor[0] = cellR[c]; onColor[1] = cellG[c]; onColor[2] = cellB[c];
      }
      if (wOff > 0.02) {
        offColor[0] = rOff / wOff; offColor[1] = gOff / wOff; offColor[2] = bOff / wOff;
      } else {
        offColor[0] = cellR[c]; offColor[1] = cellG[c]; offColor[2] = cellB[c];
      }
      const lumaOn = wOn > 0.02 ? lOn / wOn : cellL[c];
      const lumaOff = wOff > 0.02 ? lOff / wOff : cellL[c];

      writeColor(fg, c, mode, onColor, lumaOn, ink[c], strength, palette,
        fgFlat, bgFlat, duoDark, duoLight, false);

      if (bg) {
        writeColor(bg, c, mode, offColor, lumaOff, 1 - ink[c], strength, palette,
          fgFlat, bgFlat, duoDark, duoLight, true);
      }
    }
  }
}

function writeColor(
  out: Uint8Array,
  index: number,
  mode: AsciiSettings["colorMode"],
  src: RGB,
  srcLuma: number,
  inkValue: number,
  strength: number,
  palette: Uint8Array | null,
  fgFlat: RGB,
  bgFlat: RGB,
  duoDark: RGB,
  duoLight: RGB,
  isBackground: boolean
): void {
  let r: number, g: number, b: number;

  switch (mode) {
    case "monochrome":
      if (isBackground) {
        // Flat bg would hide per-cell backgrounds here.
        const t = Math.max(0, Math.min(1, srcLuma)) * 0.55;
        r = bgFlat[0] + (fgFlat[0] - bgFlat[0]) * t;
        g = bgFlat[1] + (fgFlat[1] - bgFlat[1]) * t;
        b = bgFlat[2] + (fgFlat[2] - bgFlat[2]) * t;
      } else {
        r = fgFlat[0]; g = fgFlat[1]; b = fgFlat[2];
      }
      break;

    case "grayscale": {
      const v = srcLuma * 255;
      r = v; g = v; b = v;
      break;
    }

    case "duotone": {
      const t = Math.max(0, Math.min(1, inkValue));
      r = duoDark[0] + (duoLight[0] - duoDark[0]) * t;
      g = duoDark[1] + (duoLight[1] - duoDark[1]) * t;
      b = duoDark[2] + (duoLight[2] - duoDark[2]) * t;
      break;
    }

    case "palette": {
      if (palette && palette.length >= 3) {
        const i = nearestInPalette(palette, src[0], src[1], src[2]);
        r = palette[i * 3]; g = palette[i * 3 + 1]; b = palette[i * 3 + 2];
      } else {
        r = src[0]; g = src[1]; b = src[2];
      }
      // Colour strength mixes back toward neutral for a washed / tinted look.
      if (strength < 1) {
        const grey = lumaOf(r, g, b);
        r = grey + (r - grey) * strength;
        g = grey + (g - grey) * strength;
        b = grey + (b - grey) * strength;
      }
      break;
    }

    default: {
      r = src[0]; g = src[1]; b = src[2];
      if (strength < 1) {
        const grey = lumaOf(r, g, b);
        r = grey + (r - grey) * strength;
        g = grey + (g - grey) * strength;
        b = grey + (b - grey) * strength;
      }
      break;
    }
  }

  const o = index * 3;
  out[o] = r < 0 ? 0 : r > 255 ? 255 : r;
  out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
  out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
}
