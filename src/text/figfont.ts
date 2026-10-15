/** FIGfont parsing and rendering. */

export interface FigFont {
  /** Placeholder character that renders as a space but never smushes away. */
  hardBlank: string;
  height: number;
  baseline: number;
  maxLength: number;
  /** Resolved from the header's old and full layout fields. */
  layout: LayoutMode;
  /** Active smushing rules as a bitmask, when `layout` is "smush". */
  smushRules: number;
  printDirection: number;
  chars: Map<number, string[]>;
}

export type LayoutMode = "full" | "kern" | "smush";

/* Horizontal smushing rules, as bit positions in the header's layout field. */
const RULE_EQUAL = 1;
const RULE_UNDERSCORE = 2;
const RULE_HIERARCHY = 4;
const RULE_OPPOSITE_PAIR = 8;
const RULE_BIG_X = 16;
const RULE_HARDBLANK = 32;

/** Characters the FIGfont spec stores after the printable ASCII run. */
const DEUTSCH_CODES = [196, 214, 220, 228, 246, 252, 223];

/** Hierarchy classes for rule 3, lowest precedence first. */
const HIERARCHY = ["|", "/\\", "[]", "{}", "()", "<>"];

export class FigFontError extends Error {}

/** Strips the end-mark characters that terminate every glyph line. */
function stripEndMark(line: string): string {
  if (line.length === 0) return line;
  const mark = line[line.length - 1];
  let end = line.length;
  while (end > 0 && line[end - 1] === mark) end--;
  return line.slice(0, end);
}

/** Parses a code-tagged character's code, which may be decimal, hex or octal. */
function parseCharCode(token: string): number | null {
  const negative = token.startsWith("-");
  const body = negative ? token.slice(1) : token;
  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(body)) value = parseInt(body.slice(2), 16);
  else if (/^0[0-7]+$/.test(body)) value = parseInt(body.slice(1), 8);
  else if (/^\d+$/.test(body)) value = parseInt(body, 10);
  else return null;
  return negative ? -value : value;
}

export function parseFigFont(source: string): FigFont {
  // Some fonts ship with a BOM.
  const lines = source.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const header = lines[0] ?? "";
  // `tlf2a` is the TOIlet variant.
  if (!header.startsWith("flf2a") && !header.startsWith("tlf2a")) {
    throw new FigFontError("Not a FIGfont file.");
  }

  const parts = header.split(/\s+/);
  const hardBlank = parts[0].charAt(parts[0].length - 1);
  const height = Number(parts[1]);
  const baseline = Number(parts[2]);
  const maxLength = Number(parts[3]);
  const oldLayout = Number(parts[4]);
  const commentLines = Number(parts[5]);
  const printDirection = parts.length > 6 ? Number(parts[6]) : 0;
  const fullLayout = parts.length > 7 ? Number(parts[7]) : null;

  if (!Number.isFinite(height) || height < 1) {
    throw new FigFontError("FIGfont has no usable height.");
  }

  // `fullLayout` supersedes `oldLayout` when present.
  let layout: LayoutMode;
  let smushRules = 0;
  if (fullLayout !== null && Number.isFinite(fullLayout)) {
    if (fullLayout & 128) {
      layout = "smush";
      smushRules = fullLayout & 63;
    } else if (fullLayout & 64) {
      layout = "kern";
    } else {
      layout = "full";
    }
  } else if (oldLayout < 0) {
    layout = "full";
  } else if (oldLayout === 0) {
    layout = "kern";
  } else {
    layout = "smush";
    smushRules = oldLayout & 63;
  }

  const chars = new Map<number, string[]>();
  let cursor = 1 + (Number.isFinite(commentLines) ? commentLines : 0);

  const readGlyph = (): string[] | null => {
    if (cursor + height > lines.length) return null;
    const glyph: string[] = [];
    for (let row = 0; row < height; row++) {
      glyph.push(stripEndMark(lines[cursor + row]));
    }
    cursor += height;
    return glyph;
  };

  for (let code = 32; code <= 126; code++) {
    const glyph = readGlyph();
    if (!glyph) break;
    chars.set(code, glyph);
  }
  for (const code of DEUTSCH_CODES) {
    const glyph = readGlyph();
    if (!glyph) break;
    chars.set(code, glyph);
  }

  // Code-tagged chars: a code point line, then the rows.
  while (cursor < lines.length) {
    const tag = lines[cursor];
    if (tag === undefined) break;
    const token = tag.trim().split(/\s+/)[0];
    if (!token) {
      cursor++;
      continue;
    }
    const code = parseCharCode(token);
    cursor++;
    if (code === null) continue;
    const glyph = readGlyph();
    if (!glyph) break;
    if (code >= 0) chars.set(code, glyph);
  }

  if (chars.size === 0) throw new FigFontError("FIGfont contains no glyphs.");

  return {
    hardBlank,
    height,
    baseline: Number.isFinite(baseline) ? baseline : height,
    maxLength: Number.isFinite(maxLength) ? maxLength : 80,
    layout,
    smushRules,
    printDirection: Number.isFinite(printDirection) ? printDirection : 0,
    chars,
  };
}

/** Smushes two overlapping chars, or null if they can't overlap. */
function smushPair(
  left: string,
  right: string,
  font: FigFont,
  rules: number
): string | null {
  if (left === " ") return right;
  if (right === " ") return left;

  // Only the edge of a neighbour can overlap.
  if (rules === 0) {
    // Universal smushing: later char wins, hardblanks only lose to visible chars.
    if (left === font.hardBlank) return right;
    if (right === font.hardBlank) return left;
    return font.printDirection === 1 ? left : right;
  }

  if (rules & RULE_HARDBLANK && left === font.hardBlank && right === font.hardBlank) {
    return left;
  }
  if (left === font.hardBlank || right === font.hardBlank) return null;

  if (rules & RULE_EQUAL && left === right) return left;

  if (rules & RULE_UNDERSCORE) {
    const others = "|/\\[]{}()<>";
    if (left === "_" && others.includes(right)) return right;
    if (right === "_" && others.includes(left)) return left;
  }

  if (rules & RULE_HIERARCHY) {
    const leftClass = HIERARCHY.findIndex((set) => set.includes(left));
    const rightClass = HIERARCHY.findIndex((set) => set.includes(right));
    if (leftClass !== -1 && rightClass !== -1 && leftClass !== rightClass) {
      return leftClass > rightClass ? left : right;
    }
  }

  if (rules & RULE_OPPOSITE_PAIR) {
    const pairs = ["[]", "][", "{}", "}{", "()", ")("];
    if (pairs.includes(left + right)) return "|";
  }

  if (rules & RULE_BIG_X) {
    if (left === "/" && right === "\\") return "|";
    if (left === "\\" && right === "/") return "Y";
    if (left === ">" && right === "<") return "X";
  }

  return null;
}

/** How far `right` may slide into `left` without breaking a glyph. */
function overlapAmount(
  left: string[],
  right: string[],
  font: FigFont,
  rules: number,
  allowSmush: boolean
): number {
  let minOverlap = Infinity;

  for (let row = 0; row < font.height; row++) {
    const l = left[row] ?? "";
    const r = right[row] ?? "";

    let trailing = 0;
    while (trailing < l.length && l[l.length - 1 - trailing] === " ") trailing++;

    let leading = 0;
    while (leading < r.length && r[leading] === " ") leading++;

    let amount = trailing + leading;

    const leftChar = l[l.length - trailing - 1];
    const rightChar = r[leading];
    if (
      allowSmush &&
      leftChar !== undefined &&
      rightChar !== undefined &&
      smushPair(leftChar, rightChar, font, rules) !== null
    ) {
      amount++;
    }

    minOverlap = Math.min(minOverlap, amount);
  }

  return minOverlap === Infinity ? 0 : Math.max(0, minOverlap);
}

function appendGlyph(
  left: string[],
  right: string[],
  font: FigFont,
  overlap: number
): string[] {
  const out: string[] = [];
  const rules = font.smushRules;
  const allowSmush = font.layout === "smush";

  for (let row = 0; row < font.height; row++) {
    const l = left[row] ?? "";
    const r = right[row] ?? "";
    const width = Math.min(overlap, l.length, r.length);

    let merged = l.slice(0, l.length - width);
    for (let i = 0; i < width; i++) {
      const lc = l[l.length - width + i] ?? " ";
      const rc = r[i] ?? " ";
      merged += allowSmush
        ? smushPair(lc, rc, font, rules) ?? (rc === " " ? lc : rc)
        : lc === " "
          ? rc
          : lc;
    }
    out.push(merged + r.slice(width));
  }

  return out;
}

/** Looks up a glyph, falling back so unmapped input never renders as nothing. */
function glyphFor(font: FigFont, code: number): string[] | null {
  return (
    font.chars.get(code) ??
    font.chars.get(63) ??
    font.chars.get(32) ??
    null
  );
}

export interface RenderOptions {
  /** Wraps to a new block of lines past this many columns. 0 disables it. */
  width?: number;
  /** Trims the trailing whitespace every FIGfont leaves on its rows. */
  trim?: boolean;
}

/** Renders text through a FIGfont. */
export function renderFigText(
  font: FigFont,
  text: string,
  options: RenderOptions = {}
): string {
  const width = options.width ?? 0;
  const trim = options.trim ?? true;
  const blank = () => Array.from({ length: font.height }, () => "");
  const blocks: string[][] = [];

  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = blank();
    let lineWidth = 0;
    let hasContent = false;

    // Words are laid out whole so wrapping never splits a letter's artwork.
    const words = paragraph.split(" ");
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      const pieces = w === 0 ? [word] : [" ", word];

      let candidate = line;
      let candidateWidth = lineWidth;
      for (const piece of pieces) {
        for (const character of Array.from(piece)) {
          const glyph = glyphFor(font, character.codePointAt(0) ?? 32);
          if (!glyph) continue;
          const overlap =
            candidateWidth === 0 && !hasContent
              ? 0
              : overlapAmount(
                  candidate,
                  glyph,
                  font,
                  font.smushRules,
                  font.layout === "smush"
                );
          candidate = appendGlyph(candidate, glyph, font, overlap);
          candidateWidth = Math.max(...candidate.map((row) => row.length));
        }
      }

      if (width > 0 && hasContent && candidateWidth > width) {
        blocks.push(line);
        line = blank();
        lineWidth = 0;
        hasContent = false;
        for (const character of Array.from(word)) {
          const glyph = glyphFor(font, character.codePointAt(0) ?? 32);
          if (!glyph) continue;
          const overlap = hasContent
            ? overlapAmount(line, glyph, font, font.smushRules, font.layout === "smush")
            : 0;
          line = appendGlyph(line, glyph, font, overlap);
          lineWidth = Math.max(...line.map((row) => row.length));
          hasContent = true;
        }
      } else {
        line = candidate;
        lineWidth = candidateWidth;
        hasContent = true;
      }
    }

    blocks.push(line);
  }

  const rows = blocks.flat().map((row) => {
    const withSpaces = row.split(font.hardBlank).join(" ");
    return trim ? withSpaces.replace(/\s+$/, "") : withSpaces;
  });

  return rows.join("\n");
}
