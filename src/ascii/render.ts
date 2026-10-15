/** Canvas rendering. */

import { rasterizeMasks } from "./glyphs";
import { hexToRgb } from "./color";
import type { AsciiFrame, AsciiSettings } from "./types";

export interface RenderOptions {
  /** Width of one character cell in device pixels. */
  cellW: number;
  fontFamily: string;
  fontWeight: number;
  charAspect: number;
  bgColor: string;
  transparentBg: boolean;
}

export interface RenderSize {
  width: number;
  height: number;
  cellW: number;
  cellH: number;
}

export interface PixelPartition {
  start: number;
  end: number;
}

/** Converts fractional cells into adjacent integer pixel intervals. */
export function partitionCellPixels(
  cells: number,
  cellSize: number,
  totalSize: number
): PixelPartition[] {
  const partitions: PixelPartition[] = [];
  for (let index = 0; index < cells; index++) {
    partitions.push({
      start: Math.round(index * cellSize),
      end:
        index === cells - 1
          ? totalSize
          : Math.round((index + 1) * cellSize),
    });
  }
  return partitions;
}

/** Cell size needed to fit a grid into a target box without overflowing. */
export function fitCellSize(
  cols: number,
  rows: number,
  maxWidth: number,
  maxHeight: number,
  charAspect: number
): number {
  const byWidth = maxWidth / cols;
  const byHeight = maxHeight / (rows * charAspect);
  return Math.max(1, Math.min(byWidth, byHeight));
}

/** Cell widths a raster export can actually use. */
export const MIN_CELL_PX = 2;
export const MAX_CELL_PX = 64;

/** Cell width implied by a target image width, or null with no grid yet. */
export function rasterCellWidth(
  targetWidth: number,
  cols: number | undefined
): number | null {
  return cols ? targetWidth / cols : null;
}

export function isCellWidthSupported(cellW: number | null): boolean {
  return cellW !== null && cellW >= MIN_CELL_PX && cellW <= MAX_CELL_PX;
}

export function measureOutput(
  frame: Pick<AsciiFrame, "cols" | "rows">,
  options: RenderOptions
): RenderSize {
  const cellW = Math.max(1, options.cellW);
  const cellH = Math.max(1, cellW * options.charAspect);
  return {
    // Keep cells fractional, round only the final size.
    width: Math.max(1, Math.round(frame.cols * cellW)),
    height: Math.max(1, Math.round(frame.rows * cellH)),
    cellW,
    cellH,
  };
}

/** Renders a frame onto a canvas, resizing it to match. */
export function renderToCanvas(
  canvas: HTMLCanvasElement,
  frame: AsciiFrame,
  options: RenderOptions
): RenderSize {
  const size = measureOutput(frame, options);
  const { cellW, cellH, width, height } = size;

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const imageData = ctx.createImageData(width, height);
  paintInto(imageData.data, width, height, frame, options, cellW, cellH);
  ctx.putImageData(imageData, 0, 0);

  return size;
}

/** Renders into a detached ImageData — used by the export paths. */
export function renderToImageData(
  frame: AsciiFrame,
  options: RenderOptions
): { imageData: ImageData; size: RenderSize } {
  const size = measureOutput(frame, options);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  const imageData = ctx.createImageData(size.width, size.height);
  paintInto(
    imageData.data,
    size.width,
    size.height,
    frame,
    options,
    size.cellW,
    size.cellH
  );
  return { imageData, size };
}

function paintInto(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  frame: AsciiFrame,
  options: RenderOptions,
  cellW: number,
  cellH: number
): void {
  const maskSets = new Map<string, Uint8Array>();
  const masksFor = (pixelW: number, pixelH: number) => {
    const key = `${pixelW}x${pixelH}`;
    let masks = maskSets.get(key);
    if (!masks) {
      masks = rasterizeMasks(
        frame.glyphs,
        pixelW,
        pixelH,
        options.fontFamily,
        options.fontWeight
      );
      maskSets.set(key, masks);
    }
    return masks;
  };

  const globalBg = hexToRgb(options.bgColor);
  const bgAlpha = options.transparentBg ? 0 : 255;
  const perCellBg = frame.bg;
  const xPartitions = partitionCellPixels(frame.cols, cellW, width);
  const yPartitions = partitionCellPixels(frame.rows, cellH, height);

  for (let cy = 0; cy < frame.rows; cy++) {
    const { start: y0, end: y1 } = yPartitions[cy];
    const pixelH = Math.max(1, y1 - y0);
    for (let cx = 0; cx < frame.cols; cx++) {
      const c = cy * frame.cols + cx;
      const g = frame.chars[c];
      const { start: x0, end: x1 } = xPartitions[cx];
      const pixelW = Math.max(1, x1 - x0);
      const masks = masksFor(pixelW, pixelH);
      const maskBase = g * pixelW * pixelH;

      const fr = frame.fg[c * 3];
      const fg_ = frame.fg[c * 3 + 1];
      const fb = frame.fg[c * 3 + 2];

      const br = perCellBg ? perCellBg[c * 3] : globalBg[0];
      const bgc = perCellBg ? perCellBg[c * 3 + 1] : globalBg[1];
      const bb = perCellBg ? perCellBg[c * 3 + 2] : globalBg[2];
      // Cell backgrounds stay opaque; only the global bg can be transparent.
      const ba = perCellBg ? 255 : bgAlpha;

      for (let py = 0; py < pixelH; py++) {
        const destRow = ((y0 + py) * width + x0) * 4;
        const maskRow = maskBase + py * pixelW;
        for (let px = 0; px < pixelW; px++) {
          const a = masks[maskRow + px] / 255;
          const o = destRow + px * 4;

          if (a >= 0.999) {
            out[o] = fr;
            out[o + 1] = fg_;
            out[o + 2] = fb;
            out[o + 3] = 255;
            continue;
          }
          if (a <= 0.001) {
            out[o] = br;
            out[o + 1] = bgc;
            out[o + 2] = bb;
            out[o + 3] = ba;
            continue;
          }

          // "Source over" with straight (non-premultiplied) alpha.
          const outA = a + (ba / 255) * (1 - a);
          if (outA <= 0) {
            out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
            continue;
          }
          const bw = (ba / 255) * (1 - a);
          out[o] = (fr * a + br * bw) / outA;
          out[o + 1] = (fg_ * a + bgc * bw) / outA;
          out[o + 2] = (fb * a + bb * bw) / outA;
          out[o + 3] = outA * 255;
        }
      }
    }
  }
}

/** Builds render options straight from the settings object. */
export function renderOptionsFrom(
  settings: AsciiSettings,
  cellW: number
): RenderOptions {
  return {
    cellW,
    fontFamily: settings.fontFamily,
    fontWeight: settings.fontWeight,
    charAspect: settings.charAspect,
    bgColor: settings.bgColor,
    transparentBg: settings.transparentBg,
  };
}

/** Plain-text form of a frame, for copying or a .txt download. */
export function frameToText(frame: AsciiFrame): string {
  const lines: string[] = [];
  for (let y = 0; y < frame.rows; y++) {
    let line = "";
    for (let x = 0; x < frame.cols; x++) {
      line += frame.glyphs[frame.chars[y * frame.cols + x]];
    }
    // Trailing spaces carry no information and bloat the file.
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}
