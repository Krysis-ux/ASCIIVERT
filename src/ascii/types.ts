/** Core type definitions for the ASCII conversion engine. */

/** How a cell's character is chosen. */
export type RenderMode =
  /** Classic: one character per cell, picked by ink density. Fastest. */
  | "density"
  /** Compares the actual rasterised shape of each glyph to the cell. Best stills. */
  | "shape"
  /** Unicode Braille — each character encodes a 2x4 dot grid (8x the detail). */
  | "braille"
  /** Unicode quadrant blocks — each character encodes a 2x2 grid. */
  | "blocks";

export type ColorMode =
  /** Each character keeps the average colour of the pixels it covers. */
  | "original"
  /** Characters shaded from black to white by brightness. */
  | "grayscale"
  /** A single flat foreground colour. Classic terminal look. */
  | "monochrome"
  /** Interpolates between two colours across the brightness range. */
  | "duotone"
  /** Colours snapped to a small fixed palette. */
  | "palette";

export type DitherMode = "none" | "floyd-steinberg" | "atkinson" | "bayer";

export type DestinationId =
  | "auto"
  | "phone"
  | "chat"
  | "terminal"
  | "readme"
  | "detailed"
  | "poster"
  | "custom";

export interface DestinationSelection {
  id: DestinationId;
  customColumns: number;
  customMaxRows: number | null;
}

export interface ResolvedDestination {
  id: DestinationId;
  requestedColumns: number;
  cols: number;
  rows: number;
  worstCaseCharacters: number;
  characterBudget: number | null;
  characterBudgetSatisfied: boolean;
  rowBudget: number | null;
  rowBudgetSatisfied: boolean;
  reducedBy: "rows" | "characters" | "cells" | null;
}

export interface AsciiSettings {
  // Detail & grid
  /** 0–100. Drives column count on a non-linear curve. */
  detail: number;
  /** When set, overrides the detail-derived column count. */
  columnsOverride: number | null;
  /** Cell height ÷ cell width. */
  charAspect: number;

  // Characters
  mode: RenderMode;
  charsetId: string;
  /** Used when `charsetId === "custom"`. */
  customCharset: string;
  /** Flip the density ramp (dark chars for bright areas). */
  reverseRamp: boolean;
  fontFamily: string;
  fontWeight: number;

  // Image adjustments (applied before characters are chosen)
  /** -100–100 */
  brightness: number;
  /** -100–100 */
  contrast: number;
  /** 0.1–3.0 */
  gamma: number;
  /** -100–100 */
  saturation: number;
  /** 0–100, unsharp mask on luminance. */
  sharpness: number;
  invert: boolean;
  /** Stretch each frame's tonal range to fill the character ramp. */
  autoLevels: boolean;

  // Edge detection
  /** 0–100. How strongly directional edge characters override density ones. */
  edgeStrength: number;
  /** 0–100. Minimum edge energy before a cell is treated as an edge. */
  edgeThreshold: number;

  // Dithering
  dither: DitherMode;
  /** 0–100, how much of the quantisation error is diffused. */
  ditherAmount: number;

  // Colour
  colorMode: ColorMode;
  /** 0–100. 0 = fully desaturated, 100 = original colour. */
  colorStrength: number;
  paletteId: string;
  /** Palette size when `paletteId === "auto"` (median-cut from the source). */
  paletteSize: number;
  fgColor: string;
  bgColor: string;
  duoDark: string;
  duoLight: string;
  transparentBg: boolean;
  /** Paint each cell's background with its average colour (denser, pixel-art look). */
  cellBackground: boolean;

  // Video
  /** 0–100. Character hysteresis — stops glyphs flickering between frames. */
  flickerReduction: number;
  /** 0–100. Blends the previous frame's luminance into the current one. */
  frameBlend: number;
}

/** The output of a conversion: a grid of character indices plus per-cell colour. */
export interface AsciiFrame {
  cols: number;
  rows: number;
  /** Length cols*rows. Index into `glyphs`. */
  chars: Uint16Array;
  /** Length cols*rows*3, RGB. */
  fg: Uint8Array;
  /** Length cols*rows*3, RGB. Only present when `cellBackground` is on. */
  bg: Uint8Array | null;
  /** The character table. */
  glyphs: string[];
  /** Length cols*rows. Target ink coverage 0–1, kept for temporal smoothing. */
  ink: Float32Array;
}

/** Font measurements normalised to a font size of 1. */
export interface FontMetrics {
  /** Advance width of one character ÷ font size. ~0.6 for most monospace. */
  advanceRatio: number;
  ascentRatio: number;
  descentRatio: number;
}

/** A character set that has been rasterised, measured and density-sorted. */
export interface GlyphSet {
  key: string;
  /** Characters ordered so `density` is monotonic. */
  chars: string[];
  /** Ink coverage per character, stretched to span 0–1. */
  density: Float32Array;
  /** Unnormalised coverage, before the range stretch. */
  rawDensity: Float32Array;
  /** Flat `chars.length * sigW * sigH` array of shape signatures, 0–1. */
  sig: Float32Array;
  sigW: number;
  sigH: number;
}

/** Anything the engine can read pixels from. */
export type AsciiSource =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap
  | OffscreenCanvas;

/** Carried between frames of a video so output stays temporally stable. */
export interface TemporalState {
  prevInk: Float32Array | null;
  prevChars: Uint16Array | null;
  prevLuma: Float32Array | null;
  cols: number;
  rows: number;
  /** Size of the glyph table the previous frame was built against. */
  glyphCount: number;
  /** Previous frame's auto-levels black and white points. */
  prevBlack: number | null;
  prevWhite: number | null;
}

export function createTemporalState(): TemporalState {
  return {
    prevInk: null,
    prevChars: null,
    prevLuma: null,
    cols: 0,
    rows: 0,
    glyphCount: 0,
    prevBlack: null,
    prevWhite: null,
  };
}
