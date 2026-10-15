/** Single-line text styles built from Unicode look-alike alphabets. */

export interface UnicodeStyle {
  id: string;
  name: string;
  /** Shown in the picker so the look is visible before it is chosen. */
  sample: string;
  transform: (input: string) => string;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/** Builds a lookup from parallel source and target alphabets. */
function table(
  pairs: [string, string[] | null][]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [source, target] of pairs) {
    if (!target) continue;
    const from = Array.from(source);
    for (let i = 0; i < from.length && i < target.length; i++) {
      map.set(from[i], target[i]);
    }
  }
  return map;
}

/** Expands a contiguous Unicode run into one entry per character. */
function run(start: number, length: number): string[] {
  return Array.from({ length }, (_, i) => String.fromCodePoint(start + i));
}

/** Applies a table, leaving anything unmapped exactly as it was. */
function mapWith(map: Map<string, string>) {
  return (input: string) =>
    Array.from(input)
      .map((character) => map.get(character) ?? character)
      .join("");
}

const CIRCLED = table([
  [UPPER, run(0x24b6, 26)],
  [LOWER, run(0x24d0, 26)],
  // Circled zero sits apart from 1–9, which start at U+2460.
  [DIGITS, ["⓪", ...run(0x2460, 9)]],
]);

const CIRCLED_FILLED = table([
  [UPPER, run(0x1f150, 26)],
  [LOWER, run(0x1f150, 26)],
  [DIGITS, ["⓿", ...run(0x2776, 9)]],
]);

const SQUARED = table([
  [UPPER, run(0x1f130, 26)],
  [LOWER, run(0x1f130, 26)],
]);

const SQUARED_FILLED = table([
  [UPPER, run(0x1f170, 26)],
  [LOWER, run(0x1f170, 26)],
]);

const FULLWIDTH = table([
  [UPPER, run(0xff21, 26)],
  [LOWER, run(0xff41, 26)],
  [DIGITS, run(0xff10, 10)],
  [" ", ["　"]],
  ["!\"#$%&'()*+,-./", run(0xff01, 15)],
  [":;<=>?@", run(0xff1a, 7)],
]);

const MONOSPACE = table([
  [UPPER, run(0x1d670, 26)],
  [LOWER, run(0x1d68a, 26)],
  [DIGITS, run(0x1d7f6, 10)],
]);

const BOLD = table([
  [UPPER, run(0x1d400, 26)],
  [LOWER, run(0x1d41a, 26)],
  [DIGITS, run(0x1d7ce, 10)],
]);

const ITALIC = table([
  [UPPER, run(0x1d434, 26)],
  // Italic h lives at U+210E (Planck constant), not in the run.
  [LOWER, [...run(0x1d44e, 7), "ℎ", ...run(0x1d456, 18)]],
]);

const BOLD_ITALIC = table([
  [UPPER, run(0x1d468, 26)],
  [LOWER, run(0x1d482, 26)],
]);

const SCRIPT = table([
  [
    UPPER,
    [
      "𝒜", "ℬ", "𝒞", "𝒟", "ℰ",
      "ℱ", "𝒢", "ℋ", "ℐ", "𝒥",
      "𝒦", "ℒ", "ℳ", "𝒩", "𝒪",
      "𝒫", "𝒬", "ℛ", "𝒮", "𝒯",
      "𝒰", "𝒱", "𝒲", "𝒳",
      "𝒴", "𝒵",
    ],
  ],
  [
    LOWER,
    [
      "𝒶", "𝒷", "𝒸", "𝒹", "ℯ",
      "𝒻", "ℊ", "𝒽", "𝒾", "𝒿",
      "𝓀", "𝓁", "𝓂", "𝓃", "ℴ",
      "𝓅", "𝓆", "𝓇", "𝓈",
      "𝓉", "𝓊", "𝓋", "𝓌",
      "𝓍", "𝓎", "𝓏",
    ],
  ],
]);

const SCRIPT_BOLD = table([
  [UPPER, run(0x1d4d0, 26)],
  [LOWER, run(0x1d4ea, 26)],
]);

const FRAKTUR = table([
  [
    UPPER,
    [
      "𝔄", "𝔅", "ℭ", "𝔇", "𝔈",
      "𝔉", "𝔊", "ℌ", "ℑ", "𝔍",
      "𝔎", "𝔏", "𝔐", "𝔑",
      "𝔒", "𝔓", "𝔔", "ℜ", "𝔖",
      "𝔗", "𝔘", "𝔙", "𝔚",
      "𝔛", "𝔜", "ℨ",
    ],
  ],
  [LOWER, run(0x1d51e, 26)],
]);

const FRAKTUR_BOLD = table([
  [UPPER, run(0x1d56c, 26)],
  [LOWER, run(0x1d586, 26)],
]);

const DOUBLE_STRUCK = table([
  [
    UPPER,
    [
      "𝔸", "𝔹", "ℂ", "𝔻", "𝔼",
      "𝔽", "𝔾", "ℍ", "𝕀", "𝕁",
      "𝕂", "𝕃", "𝕄", "ℕ", "𝕆",
      "ℙ", "ℚ", "ℝ", "𝕊", "𝕋",
      "𝕌", "𝕍", "𝕎", "𝕏",
      "𝕐", "ℤ",
    ],
  ],
  [LOWER, run(0x1d552, 26)],
  [DIGITS, run(0x1d7d8, 10)],
]);

const SMALL_CAPS = table([
  [
    LOWER,
    [
      "ᴀ", "ʙ", "ᴄ", "ᴅ", "ᴇ", "ꜰ", "ɢ",
      "ʜ", "ɪ", "ᴊ", "ᴋ", "ʟ", "ᴍ", "ɴ",
      "ᴏ", "ᴘ", "Q", "ʀ", "ꜱ", "ᴛ", "ᴜ",
      "ᴠ", "ᴡ", "x", "ʏ", "ᴢ",
    ],
  ],
]);

const SUPERSCRIPT = table([
  [
    LOWER,
    [
      "ᵃ", "ᵇ", "ᶜ", "ᵈ", "ᵉ", "ᶠ", "ᵍ",
      "ʰ", "ⁱ", "ʲ", "ᵏ", "ˡ", "ᵐ", "ⁿ",
      "ᵒ", "ᵖ", "q", "ʳ", "ˢ", "ᵗ", "ᵘ",
      "ᵛ", "ʷ", "ˣ", "ʸ", "ᶻ",
    ],
  ],
  [DIGITS, ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"]],
]);

const UPSIDE_DOWN_MAP = table([
  [
    LOWER,
    [
      "ɐ", "q", "ɔ", "p", "ǝ", "ɟ", "ƃ", "ɥ",
      "ᴉ", "ɾ", "ʞ", "l", "ɯ", "u", "o", "d", "b", "ɹ",
      "s", "ʇ", "n", "ʌ", "ʍ", "x", "ʎ", "z",
    ],
  ],
  [
    UPPER,
    [
      "∀", "б", "Ɔ", "ᗡ", "Ǝ", "Ⅎ", "⅁",
      "H", "I", "ſ", "⋊", "⅂", "W", "N", "O", "Ԁ",
      "Ό", "ᴚ", "S", "⊥", "∩", "Λ", "M", "X",
      "⅄", "Z",
    ],
  ],
  [DIGITS, ["0", "Ɩ", "ᄅ", "Ɛ", "ㄣ", "S", "9", "ㄥ", "8", "6"]],
  ["'.,?!\"()[]{}<>&_", ["ˋ", "˙", "'", "¿", "¡", "„", ")", "(", "]", "[", "}", "{", ">", "<", "⅋", "‾"]],
]);

/** Combining marks are appended per character, not substituted. */
function combining(mark: string) {
  return (input: string) =>
    Array.from(input)
      .map((character) => (character === " " ? character : character + mark))
      .join("");
}

function spaced(input: string): string {
  return Array.from(input).join(" ");
}

/** Flipping the letters is only half of it — the reading order flips too. */
function upsideDown(input: string): string {
  return Array.from(input)
    .map((character) => UPSIDE_DOWN_MAP.get(character) ?? character)
    .reverse()
    .join("");
}

function bracketed(open: string, close: string) {
  return (input: string) =>
    Array.from(input)
      .map((character) =>
        character.trim() === "" ? character : `${open}${character}${close}`
      )
      .join("");
}

export const UNICODE_STYLES: readonly UnicodeStyle[] = [
  { id: "circled", name: "Circled", sample: "Ⓐⓑⓒ", transform: mapWith(CIRCLED) },
  { id: "circled-filled", name: "Circled Filled", sample: "🅐🅑🅒", transform: mapWith(CIRCLED_FILLED) },
  { id: "squared", name: "Squared", sample: "🄰🄱🄲", transform: mapWith(SQUARED) },
  { id: "squared-filled", name: "Squared Filled", sample: "🅰🅱🅲", transform: mapWith(SQUARED_FILLED) },
  { id: "bubble", name: "Bubble Brackets", sample: "(a)(b)", transform: bracketed("(", ")") },
  { id: "boxed", name: "Boxed", sample: "[a][b]", transform: bracketed("[", "]") },
  { id: "fullwidth", name: "Fullwidth", sample: "ＡＢＣ", transform: mapWith(FULLWIDTH) },
  { id: "monospace", name: "Monospace", sample: "𝙰𝙱𝙲", transform: mapWith(MONOSPACE) },
  { id: "bold", name: "Bold", sample: "𝐀𝐁𝐂", transform: mapWith(BOLD) },
  { id: "italic", name: "Italic", sample: "𝐴𝐵𝐶", transform: mapWith(ITALIC) },
  { id: "bold-italic", name: "Bold Italic", sample: "𝑨𝑩𝑪", transform: mapWith(BOLD_ITALIC) },
  { id: "script", name: "Script", sample: "𝒜ℬ𝒞", transform: mapWith(SCRIPT) },
  { id: "script-bold", name: "Script Bold", sample: "𝓐𝓑𝓒", transform: mapWith(SCRIPT_BOLD) },
  { id: "fraktur", name: "Fraktur", sample: "𝔄𝔅ℭ", transform: mapWith(FRAKTUR) },
  { id: "fraktur-bold", name: "Fraktur Bold", sample: "𝕬𝕭𝕮", transform: mapWith(FRAKTUR_BOLD) },
  { id: "double-struck", name: "Double Struck", sample: "𝔸𝔹ℂ", transform: mapWith(DOUBLE_STRUCK) },
  { id: "small-caps", name: "Small Caps", sample: "ᴀʙᴄ", transform: (s) => mapWith(SMALL_CAPS)(s.toLowerCase()) },
  { id: "superscript", name: "Superscript", sample: "ᵃᵇᶜ", transform: (s) => mapWith(SUPERSCRIPT)(s.toLowerCase()) },
  { id: "upside-down", name: "Upside Down", sample: "ɐqɔ", transform: upsideDown },
  { id: "spaced", name: "S p a c e d", sample: "a b c", transform: spaced },
  { id: "strikethrough", name: "Strikethrough", sample: "a̶b̶c̶", transform: combining("̶") },
  { id: "underline", name: "Underline", sample: "a̲b̲c̲", transform: combining("̲") },
  { id: "slashed", name: "Slashed", sample: "a̸b̸c̸", transform: combining("̸") },
];

export function applyUnicodeStyle(id: string, input: string): string {
  const style = UNICODE_STYLES.find((candidate) => candidate.id === id);
  return style ? style.transform(input) : input;
}
