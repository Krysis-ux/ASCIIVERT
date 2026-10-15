import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFigFont, renderFigText } from "./figfont";
import { FIG_FONTS, POPULAR_FIG_FONTS } from "./figfonts";

const FONT_DIR = path.join(process.cwd(), "fonts");

function load(name: string) {
  return parseFigFont(fs.readFileSync(path.join(FONT_DIR, `${name}.flf`), "utf8"));
}

describe("figfont catalogue", () => {
  it("ships every font the manifest lists", () => {
    const onDisk = new Set(
      fs.readdirSync(FONT_DIR).filter((f) => f.endsWith(".flf")).map((f) => f.slice(0, -4))
    );
    const missing = FIG_FONTS.filter((name) => !onDisk.has(name));
    expect(missing).toEqual([]);
    expect(FIG_FONTS.length).toBeGreaterThan(300);
  });

  it("parses every bundled font without throwing", () => {
    const failures: string[] = [];
    for (const name of FIG_FONTS) {
      try {
        const font = load(name);
        // A font with no letters would render every word as blank.
        if (!font.chars.has(65)) failures.push(`${name}: no 'A'`);
        if (font.height < 1) failures.push(`${name}: height ${font.height}`);
      } catch (error) {
        failures.push(`${name}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("renders every popular font to visible, rectangular output", () => {
    for (const name of POPULAR_FIG_FONTS) {
      const font = load(name);
      const out = renderFigText(font, "Hi", { width: 0 });
      const lines = out.split("\n");
      expect(lines.length, name).toBe(font.height);
      expect(out.replace(/\s/g, "").length, name).toBeGreaterThan(0);
      // Hardblanks are an internal marker and must never reach the output.
      expect(out.includes(font.hardBlank), name).toBe(false);
    }
  });
});

describe("figfont rendering", () => {
  /** Expected output from real figlet. */
  it.each([
    [
      "Standard",
      "ab",
      ["        _", "   __ _| |__", "  / _` | '_ \\", " | (_| | |_) |", "  \\__,_|_.__/", ""],
    ],
    [
      "Standard",
      "Hi",
      ["  _   _ _", " | | | (_)", " | |_| | |", " |  _  | |", " |_| |_|_|", ""],
    ],
    [
      "Small",
      "hello",
      ["  _        _ _", " | |_  ___| | |___", " | ' \\/ -_) | / _ \\", " |_||_\\___|_|_\\___/", ""],
    ],
    [
      "Slant",
      "Go",
      ["   ______", "  / ____/___", " / / __/ __ \\", "/ /_/ / /_/ /", "\\____/\\____/", ""],
    ],
  ])("matches figlet for %s / %s", (font, text, expected) => {
    expect(renderFigText(load(font), text).split("\n")).toEqual(expected);
  });

  it("keeps a blank line count for empty input rather than collapsing", () => {
    const font = load("Standard");
    expect(renderFigText(font, " ").split("\n").length).toBe(font.height);
  });

  it("starts a new block on an explicit newline", () => {
    const font = load("Standard");
    const out = renderFigText(font, "a\nb");
    expect(out.split("\n").length).toBe(font.height * 2);
  });

  it("wraps on word boundaries at the requested width", () => {
    const font = load("Small");
    const out = renderFigText(font, "hello world wide", { width: 40 });
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(font.height);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(40);
  });

  it("falls back rather than dropping characters it has no glyph for", () => {
    const font = load("Standard");
    const out = renderFigText(font, "\u2603");
    expect(out.replace(/\s/g, "").length).toBeGreaterThan(0);
  });
});
