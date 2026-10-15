/** Default settings and named presets. */

import type { AsciiSettings } from "./types";

/** Font stack for both the on-screen preview and the glyph rasteriser. */
export const MONO_STACK =
  '"JetBrains Mono", "DejaVu Sans Mono", "Menlo", "Consolas", "Liberation Mono", monospace';

export const DEFAULT_SETTINGS: AsciiSettings = {
  detail: 55,
  columnsOverride: null,
  charAspect: 2,

  mode: "density",
  charsetId: "classic",
  customCharset: "@%#*+=-:. ",
  reverseRamp: false,
  fontFamily: MONO_STACK,
  fontWeight: 400,

  brightness: 0,
  contrast: 0,
  gamma: 1,
  saturation: 0,
  sharpness: 35,
  invert: false,
  autoLevels: true,

  edgeStrength: 0,
  edgeThreshold: 35,

  dither: "none",
  ditherAmount: 80,

  colorMode: "original",
  colorStrength: 100,
  paletteId: "auto",
  paletteSize: 16,
  fgColor: "#e6edf3",
  bgColor: "#0a0c10",
  duoDark: "#1a0b2e",
  duoLight: "#00f5d4",
  transparentBg: false,
  cellBackground: false,

  flickerReduction: 45,
  frameBlend: 20,
};

/** Selectable fonts. */
export interface FontOption {
  id: string;
  label: string;
  stack: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: "jetbrains", label: "JetBrains Mono", stack: MONO_STACK },
  {
    id: "system",
    label: "System Mono",
    stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  {
    id: "courier",
    label: "Courier",
    stack: '"Courier New", Courier, "Nimbus Mono PS", monospace',
  },
  {
    id: "serif",
    label: "Serif Mono",
    stack: '"DejaVu Sans Mono", "Liberation Mono", "Andale Mono", monospace',
  },
];

export interface Preset {
  id: string;
  name: string;
  description: string;
  /** Look only. */
  settings: Partial<AsciiSettings>;
}

/** Presets are a *look*, not a resolution. */
const PRESERVED_KEYS = [
  "detail",
  "columnsOverride",
  "charAspect",
  "flickerReduction",
  "frameBlend",
] as const satisfies readonly (keyof AsciiSettings)[];

export const PRESETS: Preset[] = [
  {
    id: "classic",
    name: "Classic Terminal",
    description: "Green on black, the way it started.",
    settings: {
      mode: "density",
      // The 10-step Classic ramp banded badly on anything with a gradient.
      charsetId: "standard",
      colorMode: "monochrome",
      fgColor: "#33ff66",
      bgColor: "#001100",
      contrast: 16,
      sharpness: 40,
      dither: "atkinson",
      ditherAmount: 55,
      edgeStrength: 0,
    },
  },
  {
    id: "fullcolor",
    name: "Full Colour",
    description: "Keeps every character's original colour.",
    settings: {
      mode: "density",
      charsetId: "detailed",
      colorMode: "original",
      colorStrength: 100,
      bgColor: "#08090c",
      contrast: 10,
      sharpness: 40,
      dither: "floyd-steinberg",
      ditherAmount: 45,
    },
  },
  {
    id: "ultra",
    name: "Ultra Detail",
    description: "Shape matching and edges. Slow, and worth it on stills.",
    settings: {
      mode: "shape",
      charsetId: "detailed",
      colorMode: "original",
      contrast: 14,
      sharpness: 45,
      edgeStrength: 55,
      edgeThreshold: 34,
      bgColor: "#000000",
    },
  },
  {
    id: "lineart",
    name: "Line Art",
    description: "Edges only — turns a photo into a contour drawing.",
    settings: {
      mode: "density",
      charsetId: "simple",
      colorMode: "monochrome",
      fgColor: "#ffffff",
      bgColor: "#000000",
      contrast: 25,
      sharpness: 55,
      edgeStrength: 90,
      edgeThreshold: 22,
      gamma: 1.2,
    },
  },
  {
    id: "braille",
    name: "Braille HD",
    description: "Eight sub-pixels per character. The highest detail available.",
    settings: {
      mode: "braille",
      colorMode: "monochrome",
      fgColor: "#ffffff",
      bgColor: "#000000",
      contrast: 18,
      sharpness: 40,
      dither: "floyd-steinberg",
      ditherAmount: 95,
    },
  },
  {
    id: "blocks",
    name: "Pixel Blocks",
    description: "Quadrant blocks with per-cell colour. Almost photographic.",
    settings: {
      mode: "blocks",
      colorMode: "original",
      cellBackground: true,
      contrast: 8,
      sharpness: 25,
      dither: "floyd-steinberg",
      ditherAmount: 70,
      bgColor: "#000000",
    },
  },
  {
    id: "amber",
    name: "Amber Monitor",
    description: "Warm phosphor glow.",
    settings: {
      mode: "density",
      charsetId: "standard",
      colorMode: "duotone",
      duoDark: "#1a0d00",
      duoLight: "#ffab1a",
      bgColor: "#140a00",
      contrast: 15,
      sharpness: 35,
      gamma: 1.1,
      dither: "floyd-steinberg",
      ditherAmount: 50,
    },
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Katakana rain in phosphor green.",
    settings: {
      mode: "density",
      charsetId: "matrix",
      colorMode: "duotone",
      duoDark: "#001a05",
      duoLight: "#4dff88",
      bgColor: "#000000",
      contrast: 20,
      sharpness: 35,
      // Katakana all have similar ink coverage.
      dither: "bayer",
      ditherAmount: 65,
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Hard neon palette, heavy dithering.",
    settings: {
      mode: "density",
      charsetId: "code",
      colorMode: "palette",
      paletteId: "cyberpunk",
      bgColor: "#0d0221",
      contrast: 22,
      sharpness: 35,
      saturation: 30,
      dither: "atkinson",
      ditherAmount: 85,
      edgeStrength: 35,
    },
  },
  {
    id: "newspaper",
    name: "Newspaper",
    description: "Black on white with ordered dithering.",
    settings: {
      mode: "density",
      charsetId: "classic",
      colorMode: "monochrome",
      fgColor: "#111111",
      bgColor: "#f4f1ea",
      contrast: 18,
      sharpness: 35,
      gamma: 1.15,
      dither: "bayer",
      ditherAmount: 90,
    },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    description: "Technical drawing, edges emphasised.",
    settings: {
      mode: "density",
      charsetId: "simple",
      colorMode: "palette",
      paletteId: "blueprint",
      bgColor: "#06263f",
      contrast: 20,
      sharpness: 45,
      dither: "floyd-steinberg",
      ditherAmount: 50,
      edgeStrength: 65,
      edgeThreshold: 28,
    },
  },
  {
    id: "gameboy",
    name: "Game Boy",
    description: "Four shades of green, block shading.",
    settings: {
      mode: "density",
      charsetId: "blocks",
      colorMode: "palette",
      paletteId: "gameboy",
      bgColor: "#0f380f",
      contrast: 15,
      sharpness: 30,
      dither: "bayer",
      ditherAmount: 100,
    },
  },
];

/** Builds the settings for a preset, carrying the current output size across. */
export function applyPreset(
  preset: Preset,
  current: AsciiSettings = DEFAULT_SETTINGS
): AsciiSettings {
  const next: AsciiSettings = { ...DEFAULT_SETTINGS, ...preset.settings };
  for (const key of PRESERVED_KEYS) {
    Object.assign(next, { [key]: current[key] });
  }
  return next;
}
