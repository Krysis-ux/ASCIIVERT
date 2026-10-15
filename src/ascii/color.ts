/** Colour utilities: luminance, hex parsing, palettes and quantisation. */

/** Rec. 709 luma coefficients — perceptual, unlike a flat RGB average. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

export type RGB = [number, number, number];

/** Relative luminance of an 8-bit RGB triple, returned in 0–255. */
export function luma(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  {
    id: "auto",
    name: "Auto (from image)",
    colors: [],
  },
  {
    id: "gameboy",
    name: "Game Boy",
    colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  },
  {
    id: "green",
    name: "Green Phosphor",
    colors: ["#001100", "#00330a", "#00aa33", "#33ff66", "#ccffdd"],
  },
  {
    id: "amber",
    name: "Amber Monitor",
    colors: ["#1a0d00", "#4d2600", "#b35900", "#ffab1a", "#ffe0b3"],
  },
  {
    id: "cga",
    name: "CGA",
    colors: ["#000000", "#55ffff", "#ff55ff", "#ffffff"],
  },
  {
    id: "c64",
    name: "Commodore 64",
    colors: [
      "#000000", "#ffffff", "#880000", "#aaffee", "#cc44cc", "#00cc55",
      "#0000aa", "#eeee77", "#dd8855", "#664400", "#ff7777", "#333333",
      "#777777", "#aaff66", "#0088ff", "#bbbbbb",
    ],
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    colors: ["#0d0221", "#261447", "#ff2a6d", "#05d9e8", "#d1f7ff", "#f9c80e"],
  },
  {
    id: "vaporwave",
    name: "Vaporwave",
    colors: ["#1a0b2e", "#7b2cbf", "#ff6ec7", "#00f5d4", "#fdfd96", "#ffffff"],
  },
  {
    id: "sepia",
    name: "Sepia",
    colors: ["#1b1206", "#4a3520", "#8a6a45", "#c4a276", "#f2e0c4"],
  },
  {
    id: "blueprint",
    name: "Blueprint",
    colors: ["#06263f", "#0b4f7a", "#1789c4", "#7fd4f5", "#eaf7ff"],
  },
  {
    id: "mono8",
    name: "8-Step Grey",
    colors: [
      "#000000", "#242424", "#484848", "#6d6d6d",
      "#919191", "#b6b6b6", "#dadada", "#ffffff",
    ],
  },
];

export function getPalette(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

/** Converts a palette's hex strings into a flat Uint8Array of RGB triples. */
export function paletteToArray(colors: string[]): Uint8Array {
  const out = new Uint8Array(colors.length * 3);
  colors.forEach((hex, i) => {
    const [r, g, b] = hexToRgb(hex);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  });
  return out;
}

/** Nearest palette entry by squared Euclidean distance in RGB. */
export function nearestInPalette(
  palette: Uint8Array,
  r: number,
  g: number,
  b: number
): number {
  let best = 0;
  let bestDist = Infinity;
  const n = palette.length / 3;
  for (let i = 0; i < n; i++) {
    const dr = r - palette[i * 3];
    const dg = g - palette[i * 3 + 1];
    const db = b - palette[i * 3 + 2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

interface Box {
  pixels: number[];
  rMin: number; rMax: number;
  gMin: number; gMax: number;
  bMin: number; bMax: number;
}

function boxBounds(box: Box, colors: Uint8Array): void {
  box.rMin = box.gMin = box.bMin = 255;
  box.rMax = box.gMax = box.bMax = 0;
  for (const p of box.pixels) {
    const r = colors[p * 3];
    const g = colors[p * 3 + 1];
    const b = colors[p * 3 + 2];
    if (r < box.rMin) box.rMin = r;
    if (r > box.rMax) box.rMax = r;
    if (g < box.gMin) box.gMin = g;
    if (g > box.gMax) box.gMax = g;
    if (b < box.bMin) box.bMin = b;
    if (b > box.bMax) box.bMax = b;
  }
}

/** Median-cut colour quantisation. */
export function medianCut(colors: Uint8Array, count: number): Uint8Array {
  const total = colors.length / 3;
  const target = Math.max(2, Math.min(64, count));
  if (total === 0) return new Uint8Array([0, 0, 0, 255, 255, 255]);

  const initial: Box = {
    pixels: Array.from({ length: total }, (_, i) => i),
    rMin: 0, rMax: 0, gMin: 0, gMax: 0, bMin: 0, bMax: 0,
  };
  boxBounds(initial, colors);
  const boxes: Box[] = [initial];

  while (boxes.length < target) {
    // Pick the box with the largest single-channel spread.
    let bestIdx = -1;
    let bestSpread = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.pixels.length < 2) continue;
      const spread = Math.max(
        b.rMax - b.rMin,
        b.gMax - b.gMin,
        b.bMax - b.bMin
      );
      if (spread > bestSpread) {
        bestSpread = spread;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestSpread === 0) break;

    const box = boxes[bestIdx];
    const rSpread = box.rMax - box.rMin;
    const gSpread = box.gMax - box.gMin;
    const bSpread = box.bMax - box.bMin;
    const axis = rSpread >= gSpread && rSpread >= bSpread ? 0 : gSpread >= bSpread ? 1 : 2;

    box.pixels.sort((a, b) => colors[a * 3 + axis] - colors[b * 3 + axis]);
    const mid = box.pixels.length >> 1;

    const left: Box = {
      pixels: box.pixels.slice(0, mid),
      rMin: 0, rMax: 0, gMin: 0, gMax: 0, bMin: 0, bMax: 0,
    };
    const right: Box = {
      pixels: box.pixels.slice(mid),
      rMin: 0, rMax: 0, gMin: 0, gMax: 0, bMin: 0, bMax: 0,
    };
    boxBounds(left, colors);
    boxBounds(right, colors);
    boxes.splice(bestIdx, 1, left, right);
  }

  const out = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0;
    for (const p of box.pixels) {
      r += colors[p * 3];
      g += colors[p * 3 + 1];
      b += colors[p * 3 + 2];
    }
    const n = Math.max(1, box.pixels.length);
    out[i * 3] = Math.round(r / n);
    out[i * 3 + 1] = Math.round(g / n);
    out[i * 3 + 2] = Math.round(b / n);
  });
  return out;
}
