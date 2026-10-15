/** Export formats. */

import { hexToRgb } from "./color";
import { renderToImageData } from "./render";
import type { RenderOptions } from "./render";
import type { AsciiFrame } from "./types";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(
  text: string,
  filename: string,
  mime = "text/plain"
): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

/** Renders a frame to a PNG blob at the given cell size. */
export async function frameToPngBlob(
  frame: AsciiFrame,
  options: RenderOptions
): Promise<Blob> {
  const { imageData, size } = renderToImageData(frame, options);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode PNG"));
    }, "image/png");
  });
}

/** Renders a frame to a JPEG blob. Ignores transparency. */
export async function frameToJpegBlob(
  frame: AsciiFrame,
  options: RenderOptions,
  quality = 0.92
): Promise<Blob> {
  const { imageData, size } = renderToImageData(frame, options);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  // JPEG has no alpha, so lay down the background first.
  ctx.fillStyle = options.bgColor;
  ctx.fillRect(0, 0, size.width, size.height);
  const tmp = document.createElement("canvas");
  tmp.width = size.width;
  tmp.height = size.height;
  tmp.getContext("2d")!.putImageData(imageData, 0, 0);
  ctx.drawImage(tmp, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode JPEG"))),
      "image/jpeg",
      quality
    );
  });
}

interface Run {
  text: string;
  cells: number;
  r: number;
  g: number;
  b: number;
  br: number | null;
  bg: number | null;
  bb: number | null;
}

/** Splits a row into runs sharing the foreground and optional cell background. */
function rowRuns(frame: AsciiFrame, y: number, includeBackground = false): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;

  for (let x = 0; x < frame.cols; x++) {
    const c = y * frame.cols + x;
    const ch = frame.glyphs[frame.chars[c]];
    const r = frame.fg[c * 3];
    const g = frame.fg[c * 3 + 1];
    const b = frame.fg[c * 3 + 2];
    const br = includeBackground && frame.bg ? frame.bg[c * 3] : null;
    const bg = includeBackground && frame.bg ? frame.bg[c * 3 + 1] : null;
    const bb = includeBackground && frame.bg ? frame.bg[c * 3 + 2] : null;

    if (
      current &&
      current.r === r &&
      current.g === g &&
      current.b === b &&
      current.br === br &&
      current.bg === bg &&
      current.bb === bb
    ) {
      current.text += ch;
      current.cells += 1;
    } else {
      current = { text: ch, cells: 1, r, g, b, br, bg, bb };
      runs.push(current);
    }
  }
  return runs;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function ansiRgb(channel: 38 | 48, r: number, g: number, b: number): string {
  return `\x1b[${channel};2;${r};${g};${b}m`;
}

/** ANSI 24-bit colour escape sequences — paste straight into a terminal. */
export function frameToAnsi(
  frame: AsciiFrame,
  options: TextExportOptions
): string {
  const [globalFr, globalFg, globalFb] = hexToRgb(options.fgColor);
  const [globalBr, globalBg, globalBb] = hexToRgb(options.bgColor);
  const includeCellBackground = options.cellBackground && frame.bg !== null;
  const lines: string[] = [];
  for (let y = 0; y < frame.rows; y++) {
    if (!options.colored && !includeCellBackground) {
      let line = "";
      for (let x = 0; x < frame.cols; x++) {
        line += frame.glyphs[frame.chars[y * frame.cols + x]];
      }
      const foreground = ansiRgb(38, globalFr, globalFg, globalFb);
      const background = options.transparentBg
        ? ""
        : ansiRgb(48, globalBr, globalBg, globalBb);
      lines.push(`${foreground}${background}${line}\x1b[0m`);
      continue;
    }
    let line = "";
    for (const run of rowRuns(frame, y, includeCellBackground)) {
      const foreground = options.colored
        ? ansiRgb(38, run.r, run.g, run.b)
        : ansiRgb(38, globalFr, globalFg, globalFb);
      const background =
        run.br !== null
          ? ansiRgb(48, run.br, run.bg!, run.bb!)
          : options.transparentBg
            ? ""
            : ansiRgb(48, globalBr, globalBg, globalBb);
      line += `${foreground}${background}${run.text}`;
    }
    lines.push(`${line}\x1b[0m`);
  }
  return lines.join("\n");
}

export interface TextExportOptions {
  bgColor: string;
  fgColor: string;
  transparentBg: boolean;
  cellBackground: boolean;
  fontFamily: string;
  fontWeight: number;
  cellW: number;
  cellH: number;
  colored: boolean;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

/** A standalone HTML page containing selectable, colour-accurate ASCII. */
export function frameToHtml(
  frame: AsciiFrame,
  options: TextExportOptions
): string {
  const fontSize = options.cellW / 0.6;
  const includeBackground = options.cellBackground && frame.bg !== null;
  const body: string[] = [];

  for (let y = 0; y < frame.rows; y++) {
    if (!options.colored && !includeBackground) {
      let line = "";
      for (let x = 0; x < frame.cols; x++) {
        line += frame.glyphs[frame.chars[y * frame.cols + x]];
      }
      body.push(escapeHtml(line));
      continue;
    }
    let line = "";
    for (const run of rowRuns(frame, y, includeBackground)) {
      const color = options.colored
        ? `rgb(${run.r},${run.g},${run.b})`
        : options.fgColor;
      const background =
        run.br === null ? "" : `;background:rgb(${run.br},${run.bg},${run.bb})`;
      const width = formatNumber(run.cells * options.cellW);
      line += `<span style="color:${color}${background};width:${width}px">${escapeHtml(run.text)}</span>`;
    }
    body.push(line);
  }

  const background = options.transparentBg ? "transparent" : options.bgColor;
  const width = Math.round(frame.cols * options.cellW);
  const height = Math.round(frame.rows * options.cellH);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASCII export</title>
<style>
  html,body{margin:0;padding:0;background:${background};}
  pre.ascii{
    margin:0;
    font-family:${options.fontFamily};
    font-size:${formatNumber(fontSize)}px;
    line-height:${formatNumber(options.cellH)}px;
    font-weight:${options.fontWeight};
    width:${width}px;
    height:${height}px;
    letter-spacing:0;
    white-space:pre;
    color:${options.fgColor};
  }
  pre.ascii span{display:inline-block;height:${formatNumber(options.cellH)}px;overflow:hidden;vertical-align:top;}
</style>
</head>
<body>
<pre class="ascii">${body.join("\n")}</pre>
</body>
</html>
`;
}

/** SVG export. */
export function frameToSvg(frame: AsciiFrame, options: TextExportOptions): string {
  const cellW = options.cellW;
  const cellH = options.cellH;
  const width = Math.round(frame.cols * cellW);
  const height = Math.round(frame.rows * cellH);
  // Monospace advance is ~0.6em, so this font size fills the cell width.
  const fontSize = cellW / 0.6;
  const baseline = cellH * 0.5 + fontSize * 0.35;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`
  );
  if (!options.transparentBg) {
    parts.push(`<rect width="100%" height="100%" fill="${options.bgColor}"/>`);
  }
  const includeBackground = options.cellBackground && frame.bg !== null;
  const backgroundParts: string[] = [];
  const textParts: string[] = [];

  for (let y = 0; y < frame.rows; y++) {
    const ty = formatNumber(y * cellH + baseline);
    const runs = rowRuns(frame, y, includeBackground);

    if (includeBackground) {
      let backgroundX = 0;
      for (const run of runs) {
        const runWidth = run.cells * cellW;
        backgroundParts.push(
          `<rect x="${formatNumber(backgroundX)}" y="${formatNumber(
            y * cellH
          )}" width="${formatNumber(runWidth)}" height="${formatNumber(
            cellH
          )}" fill="rgb(${run.br},${run.bg},${run.bb})"/>`
        );
        backgroundX += runWidth;
      }
    }

    if (!options.colored) {
      let line = "";
      for (let x = 0; x < frame.cols; x++) {
        line += frame.glyphs[frame.chars[y * frame.cols + x]];
      }
      if (!line.trim()) continue;
      textParts.push(
        `<text x="0" y="${ty}" fill="${escapeAttribute(
          options.fgColor
        )}" textLength="${formatNumber(
          frame.cols * cellW
        )}" lengthAdjust="spacing" text-anchor="start">${escapeHtml(
          line
        )}</text>`
      );
      continue;
    }

    let x = 0;
    for (const run of runs) {
      const runWidth = run.cells * cellW;
      if (run.text.trim()) {
        textParts.push(
          `<text x="${formatNumber(
            x + runWidth / 2
          )}" y="${ty}" fill="rgb(${run.r},${run.g},${
            run.b
          })" textLength="${formatNumber(
            runWidth
          )}" lengthAdjust="spacing">${escapeHtml(run.text)}</text>`
        );
      }
      x += runWidth;
    }
  }

  parts.push(...backgroundParts);
  parts.push(
    `<g font-family="${escapeAttribute(
      options.fontFamily
    )}" font-size="${formatNumber(fontSize)}" font-weight="${
      options.fontWeight
    }" text-anchor="middle" xml:space="preserve">`
  );
  parts.push(...textParts);
  parts.push("</g></svg>");
  return parts.join("\n");
}

/** Frame data as JSON, for anyone wanting to post-process the grid. */
export function frameToJson(frame: AsciiFrame): string {
  const rows: string[] = [];
  const colors: string[][] = [];
  const backgroundColors: string[][] | undefined = frame.bg ? [] : undefined;
  for (let y = 0; y < frame.rows; y++) {
    let line = "";
    const rowColors: string[] = [];
    const rowBackgroundColors: string[] = [];
    for (let x = 0; x < frame.cols; x++) {
      const c = y * frame.cols + x;
      line += frame.glyphs[frame.chars[c]];
      const [r, g, b] = [frame.fg[c * 3], frame.fg[c * 3 + 1], frame.fg[c * 3 + 2]];
      rowColors.push(
        `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
      );
      if (frame.bg) {
        const [br, bg, bb] = [
          frame.bg[c * 3],
          frame.bg[c * 3 + 1],
          frame.bg[c * 3 + 2],
        ];
        rowBackgroundColors.push(
          `#${((1 << 24) | (br << 16) | (bg << 8) | bb)
            .toString(16)
            .slice(1)}`
        );
      }
    }
    rows.push(line);
    colors.push(rowColors);
    backgroundColors?.push(rowBackgroundColors);
  }
  const data: {
    cols: number;
    rows: number;
    text: string[];
    colors: string[][];
    backgroundColors?: string[][];
  } = { cols: frame.cols, rows: frame.rows, text: rows, colors };
  if (backgroundColors) data.backgroundColors = backgroundColors;
  return JSON.stringify(
    data,
    null,
    2
  );
}

/** Ensures the bg colour is a valid hex string before it reaches an exporter. */
export function safeHex(value: string, fallback: string): string {
  const [r, g, b] = hexToRgb(value);
  if (r === 0 && g === 0 && b === 0 && !/^#?0{3,6}$/.test(value.trim())) {
    return fallback;
  }
  return value;
}
