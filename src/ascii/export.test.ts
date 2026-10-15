import { afterEach, describe, expect, it, vi } from "vitest";
import { measureOutput } from "./render";
import * as renderModule from "./render";
import {
  frameToAnsi,
  frameToHtml,
  frameToJson,
  frameToSvg,
  type TextExportOptions,
} from "./export";
import type { AsciiFrame } from "./types";

const FRAME: AsciiFrame = {
  cols: 2,
  rows: 2,
  chars: new Uint16Array([0, 1, 2, 3]),
  glyphs: ["<", "&", "A", "B"],
  fg: new Uint8Array([
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    240, 240, 240,
  ]),
  bg: new Uint8Array([
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
    10, 11, 12,
  ]),
  ink: new Float32Array([0.1, 0.2, 0.3, 0.4]),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("static text exports", () => {
  it("matches HTML geometry, weight, colors, and per-cell backgrounds", () => {
    const options: TextExportOptions = {
      bgColor: "#040506",
      fgColor: "#112233",
      transparentBg: false,
      cellBackground: true,
      fontFamily: '"Fixture Mono", monospace',
      fontWeight: 700,
      cellW: 9,
      cellH: 18,
      colored: true,
    };
    const html = frameToHtml(FRAME, options);

    expect(html).toContain("font-size:15px");
    expect(html).toContain("line-height:18px");
    expect(html).toContain("font-weight:700");
    expect(html).toContain("color:#112233");
    expect(html).toContain("background:#040506");
    expect(html).toContain(
      'style="color:rgb(255,0,0);background:rgb(1,2,3);width:9px"'
    );
    expect(html).toContain(
      'style="color:rgb(0,255,0);background:rgb(4,5,6);width:9px"'
    );
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
  });

  it("uses transparent HTML and the configured monochrome foreground", () => {
    const html = frameToHtml(FRAME, {
      bgColor: "#040506",
      fgColor: "#112233",
      transparentBg: true,
      cellBackground: false,
      fontFamily: "FixtureMono, monospace",
      fontWeight: 500,
      cellW: 8.5,
      cellH: 17.25,
      colored: false,
    });

    expect(html).toContain("background:transparent");
    expect(html).toContain("font-family:FixtureMono, monospace");
    expect(html).toContain("font-size:14.166667px");
    expect(html).toContain("line-height:17.25px");
    expect(html).toContain("font-weight:500");
    expect(html).toContain("color:#112233");
    expect(html).not.toContain("color:rgb(");
  });

  it("matches SVG geometry, styling, escaped content, and cell backgrounds", () => {
    const svg = frameToSvg(FRAME, {
      bgColor: "#040506",
      fgColor: "#112233",
      transparentBg: false,
      cellBackground: true,
      fontFamily: '"Fixture Mono", monospace',
      fontWeight: 700,
      cellW: 9,
      cellH: 18,
      colored: true,
    });

    expect(svg).toContain('width="18" height="36" viewBox="0 0 18 36"');
    expect(svg).toContain('font-size="15"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('<rect width="100%" height="100%" fill="#040506"/>');
    expect(svg).toContain(
      '<rect x="0" y="0" width="9" height="18" fill="rgb(1,2,3)"/>'
    );
    expect(svg).toContain(
      '<rect x="9" y="0" width="9" height="18" fill="rgb(4,5,6)"/>'
    );
    expect(svg.indexOf("<rect x=")).toBeLessThan(svg.indexOf("<text "));
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&amp;");
  });

  it("keeps transparent monochrome SVG fractional and uses configured foreground", () => {
    const svg = frameToSvg(FRAME, {
      bgColor: "#040506",
      fgColor: "#aabbcc",
      transparentBg: true,
      cellBackground: false,
      fontFamily: "FixtureMono, monospace",
      fontWeight: 500,
      cellW: 8.5,
      cellH: 17.25,
      colored: false,
    });

    expect(svg).toContain('width="17" height="35" viewBox="0 0 17 35"');
    expect(svg).toContain('font-size="14.166667"');
    expect(svg).toContain('font-weight="500"');
    expect(svg).toContain('fill="#aabbcc"');
    expect(svg).not.toContain('<rect width="100%"');
    expect(svg).not.toContain('fill="rgb(255,0,0)"');
  });

  it("styles monochrome ANSI and resets every line including the end", () => {
    const ansi = frameToAnsi(FRAME, {
      bgColor: "#040506",
      fgColor: "#112233",
      transparentBg: false,
      cellBackground: false,
      fontFamily: "FixtureMono, monospace",
      fontWeight: 500,
      cellW: 9,
      cellH: 18,
      colored: false,
    });
    const lines = ansi.split("\n");

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/^\x1b\[38;2;17;34;51m\x1b\[48;2;4;5;6m/);
      expect(line).toMatch(/\x1b\[0m$/);
    }
    expect(ansi).toMatch(/\x1b\[0m$/);
  });

  it("includes per-cell background colors in ANSI and JSON", () => {
    const options: TextExportOptions = {
      bgColor: "#040506",
      fgColor: "#112233",
      transparentBg: false,
      cellBackground: true,
      fontFamily: "FixtureMono, monospace",
      fontWeight: 400,
      cellW: 9,
      cellH: 18,
      colored: true,
    };
    const ansi = frameToAnsi(FRAME, options);
    const json = JSON.parse(frameToJson(FRAME));

    expect(ansi).toContain("\x1b[38;2;255;0;0m\x1b[48;2;1;2;3m<");
    expect(ansi).toContain("\x1b[38;2;0;255;0m\x1b[48;2;4;5;6m&");
    expect(json.backgroundColors).toEqual([
      ["#010203", "#040506"],
      ["#070809", "#0a0b0c"],
    ]);
  });

  it("omits JSON backgroundColors when the frame has no cell backgrounds", () => {
    const json = JSON.parse(frameToJson({ ...FRAME, bg: null }));

    expect(json).not.toHaveProperty("backgroundColors");
  });

  it("keeps configured monochrome foreground over ANSI cell backgrounds", () => {
    const ansi = frameToAnsi(FRAME, {
      bgColor: "#040506",
      fgColor: "#112233",
      transparentBg: false,
      cellBackground: true,
      fontFamily: "FixtureMono, monospace",
      fontWeight: 400,
      cellW: 9,
      cellH: 18,
      colored: false,
    });

    expect(ansi).toContain("\x1b[38;2;17;34;51m\x1b[48;2;1;2;3m<");
    expect(ansi).toContain("\x1b[38;2;17;34;51m\x1b[48;2;4;5;6m&");
  });

  it("counts an astral glyph as one cell when sizing export runs", () => {
    const frame: AsciiFrame = {
      ...FRAME,
      cols: 1,
      rows: 1,
      chars: new Uint16Array([0]),
      glyphs: ["🙂"],
      fg: new Uint8Array([255, 0, 0]),
      bg: new Uint8Array([1, 2, 3]),
      ink: new Float32Array([0.5]),
    };
    const options: TextExportOptions = {
      bgColor: "#040506",
      fgColor: "#112233",
      transparentBg: false,
      cellBackground: true,
      fontFamily: "FixtureMono, monospace",
      fontWeight: 400,
      cellW: 9,
      cellH: 18,
      colored: true,
    };

    expect(frameToHtml(frame, options)).toContain(
      'background:rgb(1,2,3);width:9px"'
    );
    expect(frameToSvg(frame, options)).toContain(
      '<rect x="0" y="0" width="9" height="18"'
    );
  });
});

describe("fractional raster geometry", () => {
  it("rounds final dimensions once instead of rounding cell width", () => {
    const frame = { ...FRAME, cols: 137, rows: 53 };
    const size = measureOutput(frame, {
      cellW: 1080 / 137,
      fontFamily: "monospace",
      fontWeight: 400,
      charAspect: 2,
      bgColor: "#000000",
      transparentBg: false,
    });

    expect(size.width).toBe(1080);
    expect(size.height).toBe(836);
    expect(size.cellW).toBeCloseTo(1080 / 137);
    expect(size.cellH).toBeCloseTo((1080 / 137) * 2);
  });

  it("partitions every final pixel exactly once with shared boundaries", () => {
    type Partition = { start: number; end: number };
    const partitionCellPixels = (
      renderModule as typeof renderModule & {
        partitionCellPixels?: (
          cells: number,
          cellSize: number,
          totalSize: number
        ) => Partition[];
      }
    ).partitionCellPixels;

    expect(partitionCellPixels).toBeTypeOf("function");
    if (!partitionCellPixels) return;

    const partitions = partitionCellPixels(137, 1080 / 137, 1080);
    expect(partitions).toHaveLength(137);
    expect(partitions[0]).toEqual({ start: 0, end: 8 });
    expect(partitions.at(-1)?.end).toBe(1080);
    expect(
      partitions.every(
        (partition, index) =>
          partition.end > partition.start &&
          (index === 0 || partition.start === partitions[index - 1].end)
      )
    ).toBe(true);
    expect(
      partitions.reduce(
        (coveredPixels, partition) =>
          coveredPixels + partition.end - partition.start,
        0
      )
    ).toBe(1080);
  });
});
