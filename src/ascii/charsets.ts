/** Character set presets. */

export interface Charset {
  id: string;
  name: string;
  chars: string;
  /** Short note shown in the UI. */
  hint: string;
}

export const CHARSETS: Charset[] = [
  {
    id: "classic",
    name: "Classic",
    chars: "@%#*+=-:. ",
    hint: "The traditional 10-step ramp. Reads well at any size.",
  },
  {
    id: "standard",
    name: "Standard",
    chars: "@#S%?*+;:,. ",
    hint: "Slightly softer mid-tones than Classic.",
  },
  {
    id: "detailed",
    name: "Detailed",
    chars:
      "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
    hint: "70 characters. Smooth gradients, needs a bigger grid.",
  },
  {
    id: "simple",
    name: "Simple",
    chars: "#+-. ",
    hint: "Five steps. Bold and graphic.",
  },
  {
    id: "blocks",
    name: "Block Shading",
    chars: "█▓▒░ ",
    hint: "Solid coverage, almost pixel-art.",
  },
  {
    id: "quadrants",
    name: "Quadrant Blocks",
    chars: " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█",
    hint: "2x2 sub-pixels per character. Use with Blocks mode.",
  },
  {
    id: "binary",
    name: "Binary",
    chars: "01 ",
    hint: "Ones and zeroes only.",
  },
  {
    id: "numbers",
    name: "Numbers",
    chars: "0123456789 ",
    hint: "Digits, sorted by how much ink each one uses.",
  },
  {
    id: "letters",
    name: "Letters",
    chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
    hint: "Uppercase alphabet.",
  },
  {
    id: "matrix",
    name: "Matrix",
    chars: "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ01 ",
    hint: "Half-width katakana. Needs a font with kana coverage.",
  },
  {
    id: "code",
    name: "Code",
    chars: "{}[]()<>/\\|=+-_;:,.!?*&^%$#@ ",
    hint: "Punctuation and operators.",
  },
  {
    id: "dots",
    name: "Dots",
    chars: "@o•·. ",
    hint: "Round, soft, stippled.",
  },
  {
    id: "ascii-full",
    name: "Full ASCII",
    chars:
      " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    hint: "Every printable ASCII character, auto-sorted by density.",
  },
];

/** Characters used for directional edges, indexed by quantised edge angle. */
export const EDGE_CHARS = ["-", "\\", "|", "/"] as const;

/** Unicode Braille. */
export const BRAILLE_BASE = 0x2800;
export const BRAILLE_BITS: number[][] = [
  [0, 1, 2, 6], // column x=0, rows y=0..3
  [3, 4, 5, 7], // column x=1, rows y=0..3
];

/** Quadrant blocks by 2x2 bitmask (bit0=TL,1=TR,2=BL,3=BR). */
export const QUADRANT_CHARS = [
  " ", // 0000
  "▘", // 0001 TL
  "▝", // 0010 TR
  "▀", // 0011 TL+TR
  "▖", // 0100 BL
  "▌", // 0101 TL+BL
  "▞", // 0110 TR+BL
  "▛", // 0111
  "▗", // 1000 BR
  "▚", // 1001 TL+BR
  "▐", // 1010 TR+BR
  "▜", // 1011
  "▄", // 1100 BL+BR
  "▙", // 1101
  "▟", // 1110
  "█", // 1111
];

export function getCharset(id: string, custom: string): string {
  if (id === "custom") {
    const cleaned = dedupe(custom);
    return cleaned.length >= 2 ? cleaned : "@%#*+=-:. ";
  }
  const found = CHARSETS.find((c) => c.id === id);
  return found ? found.chars : "@%#*+=-:. ";
}

/** Dedupe, keeping order. */
export function dedupe(input: string): string {
  const seen = new Set<string>();
  let out = "";
  for (const ch of Array.from(input)) {
    if (!seen.has(ch)) {
      seen.add(ch);
      out += ch;
    }
  }
  return out;
}
