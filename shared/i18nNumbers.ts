/**
 * Numbers as people type them, in their own language (internal spec i18n,
 * §8 R3), and bidi isolation for names and figures (R15).
 *
 * The amount inputs read `12,5` as 125 today because they strip every comma
 * before `Number()`, which is right for English and wrong for most of the
 * world: in Spanish the comma is the decimal mark. This reads the separators
 * the locale itself uses, from `Intl.NumberFormat#formatToParts`, so it is
 * correct for any language the browser knows, digits included (Arabic-Indic
 * digits parse too).
 *
 * Strict on purpose: anything ambiguous or malformed is null, and the input
 * says so, rather than storing a guess. Never used on stored or computed
 * values, only on what a person typed.
 */
function separators(locale: string): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    return {
      group: parts.find((p) => p.type === "group")?.value ?? ",",
      decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    };
  } catch {
    return { group: ",", decimal: "." };
  }
}

/**
 * The zero of each decimal-digit script a member's keyboard is likely to type:
 * Arabic-Indic, Persian, Devanagari, Bengali, Gurmukhi, Gujarati, Tamil,
 * Telugu, Kannada, Malayalam, Thai, Lao, Tibetan, Myanmar, Khmer, Mongolian,
 * fullwidth. A digit from any other script is left alone, so it fails the
 * strict check below rather than being guessed.
 */
const DIGIT_ZEROS = [0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810, 0xff10];

function asciiDigits(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? text[i] : String(cp - zero);
  }
  return out;
}

const SPACES = /[\s\u00a0\u202f\u2009]/g;

export function parseLocaleNumber(text: string, locale: string): number | null {
  const raw = asciiDigits(String(text ?? "").trim());
  if (!raw) return null;
  const { group, decimal } = separators(locale);
  const groupIsSpace = new RegExp(SPACES.source).test(group);
  // Arabic decimal and group marks (U+066B, U+066C), and the minus sign U+2212.
  let s = raw.replace(/\u2212/g, "-").replace(/\u066b/g, decimal).replace(/\u066c/g, groupIsSpace ? " " : group);
  const decimals = s.split(decimal).length - 1;
  if (decimals > 1) return null;
  const [intPart, fracPart = ""] = decimals === 1 ? s.split(decimal) : [s, ""];
  // Digit groups must look like groups: the last exactly 3 digits, the ones
  // before it 2 or 3 (Indian grouping uses 2), so "1,2,3" is refused rather
  // than read as 123.
  const groups = intPart.replace(/^-/, "").split(groupIsSpace ? SPACES : group).filter((g) => g !== "");
  if (groups.length > 1) {
    const rest = groups.slice(1);
    if (rest[rest.length - 1].length !== 3 || rest.some((g) => g.length < 2 || g.length > 3)) return null;
  }
  const sign = intPart.trim().startsWith("-") ? "-" : "";
  const normal = `${sign}${groups.join("")}${decimals === 1 ? `.${fracPart}` : ""}`;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Wrap text in Unicode first-strong isolates so it reads right inside either direction. */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}
