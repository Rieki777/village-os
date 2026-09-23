/**
 * WCAG contrast for a rendered component, computed from the DESIGN TOKENS.
 *
 * jsdom paints nothing: it never runs Tailwind, never resolves a custom
 * property and never composites a translucent layer. So a component test that
 * wants to hold a contrast fix has two bad options, asserting a class name
 * (which passes as long as the class survives, whatever it resolves to) or
 * giving up. This is the third option. The test renders the real component,
 * and for every line of text this module reads the classes that line and its
 * ancestors ACTUALLY carry, resolves each one through the same sources the
 * browser uses, and measures the pair:
 *
 *   - client/src/index.css: the `@theme inline` colour tokens, the `:root`
 *     values a light page resolves them to and the `.dark` values that
 *     ThemeContext switches on by putting `dark` on <html>;
 *   - tailwindcss/theme.css: the stock palette (`white`, `stone-500`, ...);
 *   - optionally a brand overlay, the `--tone-*` and semantic values
 *     shared/brandTokens.ts derives for a village and server/lib/themeCss.ts
 *     emits at `:root:root`, which outranks `.dark`.
 *
 * Translucent grounds are composited bottom up the way the contrast QA probe
 * (scripts/qa/contrast.mjs) does it in a browser, and the ratio comes from
 * shared/brandTokens.ts, the function the design system measures itself with.
 *
 * WHAT IT REFUSES TO GUESS. A ground painted by a gradient or an image, an
 * element carrying two background colours, an `opacity-*` fade and any
 * `text-`/`bg-` utility it cannot place all THROW, naming the element. An
 * unmeasurable line reported as a measured one is the failure every earlier
 * contrast tool in this repo shipped (scripts/qa/README.md), so a line this
 * module cannot read fails the test instead of passing it.
 *
 * WHAT IT DOES NOT SEE. Only the base state at the narrowest breakpoint:
 * `hover:`, `focus:`, `md:` and every other variant is skipped, except
 * `dark:`, which applies in the dark scheme. Emoji are skipped, because a
 * colour glyph ignores the text colour.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "@shared/brandTokens";

export type Scheme = "light" | "dark";

type Rgba = { r: number; g: number; b: number; a: number };

export interface TextContrast {
  /** The element's own text, trimmed. */
  text: string;
  ratio: number;
  /** 4.5 for body text, 3 for large text (24px, or 18.66px bold). */
  floor: number;
  fg: string;
  bg: string;
}

// ── Reading the stylesheets ─────────────────────────────────────────────────

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every top-level block whose selector line is exactly `selector {`. */
function blocks(css: string, selector: string): string[] {
  const out: string[] = [];
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opener = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = opener.exec(css))) {
    let depth = 1;
    let i = opener.lastIndex;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const decl = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(body))) out[m[1]] = m[2].trim();
  return out;
}

interface Sheets {
  /** `--color-<name>` -> raw value, palette first and index.css on top. */
  colors: Record<string, string>;
  root: Record<string, string>;
  dark: Record<string, string>;
}

let cached: Sheets | null = null;

/** The repository root. Under jsdom `import.meta.url` is not a file URL, so fall back to the cwd vitest runs from. */
const repoRoot = () =>
  import.meta.url.startsWith("file:")
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
    : process.cwd();

function sheets(): Sheets {
  if (cached) return cached;
  const root = repoRoot();
  const indexCss = stripComments(
    fs.readFileSync(path.join(root, "client", "src", "index.css"), "utf8"),
  ).replace(/\r/g, "");
  const require = createRequire(path.join(root, "package.json"));
  const paletteCss = stripComments(fs.readFileSync(require.resolve("tailwindcss/theme.css"), "utf8"));

  const colors: Record<string, string> = {};
  const collect = (decls: Record<string, string>) => {
    Object.keys(decls).forEach((k) => {
      if (k.startsWith("--color-")) colors[k.slice("--color-".length)] = decls[k];
    });
  };
  blocks(paletteCss, "@theme default").forEach((b) => collect(declarations(b)));
  blocks(indexCss, "@theme inline").forEach((b) => collect(declarations(b)));

  const merge = (bodies: string[]) =>
    bodies.reduce<Record<string, string>>((acc, b) => Object.assign(acc, declarations(b)), {});
  cached = { colors, root: merge(blocks(indexCss, ":root")), dark: merge(blocks(indexCss, ".dark")) };
  return cached;
}

// ── Colour values ───────────────────────────────────────────────────────────

/** Split `a, b` at the first top-level comma. */
function splitFallback(inner: string): [string, string | null] {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
  }
  return [inner.trim(), null];
}

function oklchToRgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const enc = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  };
  return [enc(lin[0]), enc(lin[1]), enc(lin[2])];
}

function parseColor(value: string, vars: Record<string, string>, depth = 0): Rgba {
  if (depth > 12) throw new Error(`colour reference loop at ${value}`);
  const v = value.trim();
  const varRef = /^var\((.*)\)$/.exec(v);
  if (varRef) {
    const [name, fallback] = splitFallback(varRef[1]);
    if (vars[name] !== undefined) return parseColor(vars[name], vars, depth + 1);
    if (fallback !== null) return parseColor(fallback, vars, depth + 1);
    throw new Error(`custom property ${name} has no value and no fallback`);
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const oklch = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i.exec(v);
  if (oklch) {
    const l = parseFloat(oklch[1]) / (oklch[2] ? 100 : 1);
    const [r, g, b] = oklchToRgb(l, parseFloat(oklch[3]), parseFloat(oklch[4]));
    const a = oklch[5] === undefined ? 1 : parseFloat(oklch[5]) / (oklch[6] ? 100 : 1);
    return { r, g, b, a };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(v);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : parseFloat(rgb[4]);
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a };
  }
  throw new Error(`cannot read colour value "${v}"`);
}

const toHex = ({ r, g, b }: Rgba) =>
  "#" + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");

const over = (top: Rgba, bottom: Rgba): Rgba => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

// ── Classes ─────────────────────────────────────────────────────────────────

const TEXT_NOT_COLOUR = new Set([
  "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
  "left", "center", "right", "justify", "start", "end",
  "wrap", "nowrap", "balance", "pretty", "ellipsis", "clip",
]);
const BG_NOT_COLOUR = /^(cover|contain|auto|center|top|bottom|left|right|fixed|local|scroll|repeat|no-repeat|repeat-x|repeat-y|clip-.*|origin-.*|blend-.*)$/;
const SIZE_PX: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36,
  "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128,
};

const classList = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

/** The unprefixed classes, which are what applies at the narrowest breakpoint with no state. */
const baseClasses = (el: Element) => classList(el).filter((c) => !c.includes(":"));

/** In the dark scheme, the `dark:` classes (unprefixed); otherwise none. */
const darkClasses = (el: Element, scheme: Scheme) =>
  scheme === "dark"
    ? classList(el).filter((c) => /^dark:[^:]+$/.test(c)).map((c) => c.slice("dark:".length))
    : [];

/** The classes that apply in `scheme` at the base breakpoint, `dark:` last so it wins. */
const effectiveClasses = (el: Element, scheme: Scheme) => baseClasses(el).concat(darkClasses(el, scheme));

const describeEl = (el: Element) => `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`;

/** The colour a `text-*` or `bg-*` utility paints, or null when it is not a colour utility. */
function utilityColour(prefix: "text" | "bg", cls: string, vars: Record<string, string>, el: Element): Rgba | null {
  if (!cls.startsWith(prefix + "-")) return null;
  const rest = cls.slice(prefix.length + 1);
  if (prefix === "text" && (TEXT_NOT_COLOUR.has(rest) || /^\[[\d.]+(px|rem|em)\]$/.test(rest))) return null;
  if (prefix === "bg" && BG_NOT_COLOUR.test(rest)) return null;
  if (prefix === "bg" && /^(gradient|linear|radial|conic|none|\[)/.test(rest)) {
    throw new Error(`${describeEl(el)} paints a gradient or image, which this cannot measure`);
  }
  const slash = rest.lastIndexOf("/");
  const name = slash === -1 ? rest : rest.slice(0, slash);
  const alpha = slash === -1 ? 1 : parseFloat(rest.slice(slash + 1)) / 100;
  const raw = sheets().colors[name];
  if (raw === undefined) throw new Error(`${describeEl(el)}: "${cls}" is not a colour this can resolve`);
  const c = parseColor(raw, vars);
  return { ...c, a: c.a * alpha };
}

/**
 * The one `prefix` colour this element sets, or null. Two unprefixed colours
 * on one element are a conflict that stylesheet ORDER decides, invisibly, so
 * that throws; a `dark:` colour replaces the base one in the dark scheme.
 */
function single(prefix: "text" | "bg", el: Element, scheme: Scheme, vars: Record<string, string>): Rgba | null {
  const pick = (classes: string[]): Rgba | null => {
    let found: Rgba | null = null;
    let from = "";
    for (const cls of classes) {
      if (/^opacity-/.test(cls)) throw new Error(`${describeEl(el)} fades itself with ${cls}, which this does not model`);
      const c = utilityColour(prefix, cls, vars, el);
      if (!c) continue;
      if (found) throw new Error(`${describeEl(el)} carries two ${prefix} colours (${from}, ${cls})`);
      found = c;
      from = cls;
    }
    return found;
  };
  return pick(darkClasses(el, scheme)) ?? pick(baseClasses(el));
}

function fontPx(el: Element, scheme: Scheme): number {
  for (let e: Element | null = el; e; e = e.parentElement) {
    for (const cls of effectiveClasses(e, scheme)) {
      if (!cls.startsWith("text-")) continue;
      const rest = cls.slice(5);
      if (SIZE_PX[rest]) return SIZE_PX[rest];
      const px = /^\[([\d.]+)px\]$/.exec(rest);
      if (px) return parseFloat(px[1]);
    }
  }
  return 16;
}

function isBold(el: Element, scheme: Scheme): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    for (const cls of effectiveClasses(e, scheme)) {
      if (/^font-(bold|extrabold|black)$/.test(cls)) return true;
      if (/^font-(thin|extralight|light|normal|medium|semibold)$/.test(cls)) return false;
    }
  }
  return false;
}

// ── Measuring ───────────────────────────────────────────────────────────────

/**
 * The custom-property values a page resolves in `scheme`. `overlay` is a brand
 * document's derived values (shared/brandTokens.ts deriveTheme().vars), which
 * the server emits at `:root:root` and which therefore beat `.dark`.
 */
export function schemeVars(scheme: Scheme, overlay: Record<string, string> = {}): Record<string, string> {
  const s = sheets();
  return { ...s.root, ...(scheme === "dark" ? s.dark : {}), ...overlay };
}

const EMOJI = new RegExp("^[\\p{Extended_Pictographic}\\uFE0F\\u200D\\s]+$", "u");

/**
 * Every element under `root` with text of its own, measured against the ground
 * it is painted on. The body's own ground and ink (`bg-background`,
 * `text-foreground`) sit under everything, as they do on the page.
 */
export function measureText(root: Element, scheme: Scheme, overlay: Record<string, string> = {}): TextContrast[] {
  const vars = schemeVars(scheme, overlay);
  const bodyInk = parseColor(sheets().colors["foreground"], vars);
  const bodyGround = parseColor(sheets().colors["background"], vars);
  const out: TextContrast[] = [];
  root.querySelectorAll("*").forEach((el) => {
    let own = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) own += n.nodeValue ?? "";
    });
    const text = own.replace(/\s+/g, " ").trim();
    if (text.length < 2 || EMOJI.test(text)) return;

    let ink: Rgba | null = null;
    for (let e: Element | null = el; e && !ink; e = e.parentElement) ink = single("text", e, scheme, vars);
    ink = ink ?? bodyInk;

    const layers: Rgba[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const bg = single("bg", e, scheme, vars);
      if (!bg || bg.a === 0) continue;
      layers.push(bg);
      if (bg.a >= 0.999) break;
    }
    let ground = bodyGround;
    for (let i = layers.length - 1; i >= 0; i--) ground = over(layers[i], ground);
    const fg = over(ink, ground);

    const px = fontPx(el, scheme);
    const floor = px >= 24 || (px >= 18.66 && isBold(el, scheme)) ? 3 : 4.5;
    const ratio = Math.round(contrastRatio(toHex(fg), toHex(ground)) * 100) / 100;
    out.push({ text, ratio, floor, fg: toHex(fg), bg: toHex(ground) });
  });
  return out;
}

/** One line per failure, for an assertion message a person can act on. */
export function describeFailures(results: TextContrast[]): string[] {
  return results
    .filter((r) => r.ratio < r.floor)
    .map((r) => `"${r.text.slice(0, 60)}" ${r.ratio}:1 < ${r.floor}:1 (${r.fg} on ${r.bg})`);
}
