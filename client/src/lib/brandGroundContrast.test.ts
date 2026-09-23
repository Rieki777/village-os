/**
 * Text on a brand ground has to be READABLE, for every village, in both
 * colour schemes. This file measures that from the real inputs rather than
 * trusting a class name.
 *
 * WHY NOT ASSERT THE CLASS. Six buttons and a badge used to put white text on
 * `bg-teal`, which is --tone-brand-soft: derived at a fixed light tone, so it
 * measured 1.67 to 3.00:1 across every seed the token tests use. They now sit
 * on `bg-teal-deep`. A test that said "the class is bg-teal-deep" would stay
 * green the day somebody re-derives --tone-brand and white stops clearing on
 * it. So this test asserts the RELATIONSHIP: it reads each surface's class
 * list out of the page source, resolves the ground and the ink through
 * client/src/index.css and the stylesheet server/lib/themeCss.ts emits for a
 * village, and computes the WCAG ratio. Change the class, the tokens, or the
 * derivation, and the number moves with it.
 *
 * WHAT "EVERY VILLAGE" MEANS HERE. The nine seeds and six character cards
 * shared/brandTokens.test.ts already uses (54 derived themes), plus the
 * unseeded fork, which paints the neutral fallbacks in index.css. Each is
 * rendered in light and in dark: 110 readings per surface.
 *
 * HOW DARK RESOLVES, measured from the cascade rather than assumed. `.dark`
 * redefines the semantic set (--foreground, --background, ...) and never the
 * tone layer, so --tone-brand and --tone-brand-soft are the same in both
 * schemes. A village's emitted theme is `:root:root`, specificity (0,2,0), and
 * `.dark` sits on the same <html> at (0,1,0), so a seeded village's
 * --foreground beats the dark one too. Only an unseeded fork's dark scheme
 * differs, and that is exactly the case that sinks dark text on the soft tone
 * (1.98:1), which is why the soft tone with dark type was not the fix.
 *
 * WHAT IT DOES NOT MEASURE: hover and focus states (variant-prefixed classes
 * are ignored), and anything painted by a gradient or an image, which no
 * ratio can score honestly. It resolves only what the resting state paints.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildThemeCss } from "../../../server/lib/themeCss";
import { CHARACTER_CARDS, contrastRatio, deriveTheme } from "@shared/brandTokens";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const AA_BODY = 4.5;

// ── The stylesheet ───────────────────────────────────────────────────────────

interface CssRule {
  selector: string;
  decls: Map<string, string>;
  children: CssRule[];
}

/** A small block parser: enough for index.css, which is all it reads. */
function parseCss(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  const takeDecl = (raw: string, into: Map<string, string>) => {
    const d = raw.trim();
    const k = d.indexOf(":");
    if (k > 0 && /^(--[\w-]+|[a-z-]+)$/.test(d.slice(0, k).trim())) into.set(d.slice(0, k).trim(), d.slice(k + 1).trim());
  };
  const block = (): { decls: Map<string, string>; children: CssRule[] } => {
    const decls = new Map<string, string>();
    const children: CssRule[] = [];
    let buf = "";
    while (i < text.length) {
      const c = text[i++];
      if (c === "{") {
        const selector = buf.trim();
        buf = "";
        children.push({ selector, ...block() });
      } else if (c === "}") {
        takeDecl(buf, decls);
        return { decls, children };
      } else if (c === ";") {
        takeDecl(buf, decls);
        buf = "";
      } else {
        buf += c;
      }
    }
    return { decls, children };
  };
  return block().children;
}

const CSS = parseCss(fs.readFileSync(path.join(ROOT, "client/src/index.css"), "utf8"));
const topLevel = (selector: string) => CSS.filter((r) => r.selector === selector);
const THEME_DECLS = [...topLevel("@theme"), ...topLevel("@theme inline")];
const themeHas = (name: string) => THEME_DECLS.some((r) => r.decls.has(name));

/** `.bg-x { background-color: ... }` wherever index.css declares one, nested or not. */
function componentRule(className: string, property: string): string | null {
  const walk = (rules: CssRule[]): string | null => {
    for (const r of rules) {
      if (r.selector === `.${className}` && r.decls.has(property)) return r.decls.get(property)!;
      const inner = walk(r.children);
      if (inner) return inner;
    }
    return null;
  };
  return walk(CSS);
}

type Scheme = "light" | "dark";
interface Village { name: string; seed?: string; card?: string }

const SEEDS = ["#3f4a44", "#39ff14", "#ffe4ec", "#0a0a0a", "#fdfdfd", "#157f7d", "#1e3a8a", "#ff6b00", "#7b2d8b"];
const VILLAGES: Village[] = [
  { name: "unseeded fork" },
  ...CHARACTER_CARDS.flatMap((c) => SEEDS.map((seed) => ({ name: `${c.id}/${seed}`, seed, card: c.id }))),
];
const SCHEMES: Scheme[] = ["light", "dark"];

/** Custom properties on <html>, in cascade order: theme, :root, .dark, then the village's :root:root. */
function customProperties(village: Village, scheme: Scheme): Map<string, string> {
  const vars = new Map<string, string>();
  const apply = (rules: CssRule[]) => rules.forEach((r) => r.decls.forEach((v, k) => k.startsWith("--") && vars.set(k, v)));
  apply(THEME_DECLS);
  apply(topLevel(":root"));
  if (scheme === "dark") apply(topLevel(".dark"));
  if (village.seed) {
    const emitted = parseCss(buildThemeCss({ seed: village.seed, character: village.card }));
    apply(emitted.filter((r) => r.selector === ":root:root"));
  }
  return vars;
}

/** Resolve var() chains, fallbacks included, down to a literal. */
function resolveValue(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 20) throw new Error(`var() chain too deep at ${value}`);
  const at = value.indexOf("var(");
  if (at === -1) return value.trim();
  let level = 0;
  let end = at + 4;
  for (; end < value.length; end += 1) {
    if (value[end] === "(") level += 1;
    if (value[end] === ")") { if (level === 0) break; level -= 1; }
  }
  const inner = value.slice(at + 4, end);
  const comma = inner.indexOf(",");
  const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
  const fallback = comma === -1 ? null : inner.slice(comma + 1);
  const replacement = vars.has(name) ? vars.get(name)! : fallback;
  if (replacement == null) throw new Error(`${name} is not defined and has no fallback`);
  return resolveValue(value.slice(0, at) + resolveValue(replacement, vars, depth + 1) + value.slice(end + 1), vars, depth + 1);
}

// ── Colour ───────────────────────────────────────────────────────────────────

const toHex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");

/** oklch(L C H) to sRGB hex, through OKLab. index.css writes its dark scheme this way. */
function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h), b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return toHex(lin.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
}

function literalToHex(literal: string): string {
  const v = literal.trim().toLowerCase();
  if (v === "white" || v === "#fff") return "#ffffff";
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return "#" + [...v.slice(1)].map((ch) => ch + ch).join("");
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(v);
  if (ok) return oklchToHex(Number(ok[1]) / (ok[2] ? 100 : 1), Number(ok[3]), Number(ok[4]));
  throw new Error(`cannot read the colour ${literal}`);
}

function blend(fg: string, alpha: number, bg: string): string {
  const ch = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
  const f = ch(fg), b = ch(bg);
  return toHex(f.map((v, k) => v * alpha + b[k] * (1 - alpha)));
}

/**
 * What a colour utility paints, the way Tailwind v4 and index.css decide it: a
 * name declared as --color-<name> in @theme generates `var(--color-<name>)`,
 * and utilities beat index.css's @layer components rules; a name with no theme
 * entry falls to the component rule; `white` is Tailwind's own. Anything else
 * is not a colour this test can speak for, and returns null.
 */
function utilityColour(prefix: "bg" | "text", name: string, vars: Map<string, string>): string | null {
  if (name === "white") return "#ffffff";
  if (themeHas(`--color-${name}`)) return literalToHex(resolveValue(`var(--color-${name})`, vars));
  const rule = componentRule(`${prefix}-${name}`, prefix === "bg" ? "background-color" : "color");
  return rule ? literalToHex(resolveValue(rule, vars)) : null;
}

/** Split `bg-teal-deep/90` into name and alpha; variant-prefixed tokens are not the resting state. */
function colourToken(token: string, prefix: "bg" | "text"): { name: string; alpha: number } | null {
  if (token.includes(":")) return null;
  const m = new RegExp(`^${prefix}-([a-z][\\w-]*)(?:/(\\d+))?$`).exec(token);
  return m ? { name: m[1], alpha: m[2] ? Number(m[2]) / 100 : 1 } : null;
}

// ── The page source ──────────────────────────────────────────────────────────

interface Located { classes: string[]; ancestors: string[][] }

function classNameOf(node: ts.JsxOpeningLikeElement): string[] {
  for (const p of node.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== "className" || !p.initializer) continue;
    const init = p.initializer;
    if (ts.isStringLiteral(init)) return init.text.split(/\s+/).filter(Boolean);
    if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text.split(/\s+/).filter(Boolean);
      // A template's static text only: a branch inside ${} is not the resting state of every render.
      if (ts.isTemplateExpression(e)) {
        return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(" ").split(/\s+/).filter(Boolean);
      }
    }
  }
  return [];
}

const paintsGround = (classes: string[]) =>
  classes.some((t) => colourToken(t, "bg") && !t.startsWith("bg-gradient") && !t.startsWith("bg-["));

/**
 * The element a surface names: the INNERMOST element that paints a ground and
 * whose source matches the anchor, inside the innermost element matching
 * `within` when the anchor alone repeats on the page. Exactly one, or the
 * anchor is too loose to trust and the test says so instead of measuring the
 * wrong element.
 */
function locate(file: string, anchor: RegExp, within?: RegExp): Located {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const innermostOf = <T extends { node: ts.Node }>(all: T[]) =>
    all.filter((f) => !all.some((g) => g !== f && g.node.pos >= f.node.pos && g.node.end <= f.node.end));
  const found: (Located & { node: ts.Node })[] = [];
  const scopes: { node: ts.Node }[] = [];
  const visit = (node: ts.Node, ancestors: string[][]) => {
    let next = ancestors;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const classes = classNameOf(opening);
      const text = node.getText(sf);
      if (paintsGround(classes) && anchor.test(text)) found.push({ node, classes, ancestors });
      if (within?.test(text)) scopes.push({ node });
      next = [classes, ...ancestors];
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(sf, []);
  let candidates = found;
  if (within) {
    const scope = innermostOf(scopes);
    if (scope.length !== 1) throw new Error(`${file}: ${within} names ${scope.length} scopes, expected exactly one`);
    const s = scope[0].node;
    candidates = found.filter((f) => f.node.pos >= s.pos && f.node.end <= s.end);
  }
  const innermost = innermostOf(candidates);
  if (innermost.length !== 1) throw new Error(`${file}: ${anchor} names ${innermost.length} elements, expected exactly one`);
  return innermost[0];
}

/** Ground and ink as the resting state paints them, for one village in one scheme. */
function measure(where: Located, village: Village, scheme: Scheme) {
  const vars = customProperties(village, scheme);
  const grounds = where.classes
    .map((t) => colourToken(t, "bg"))
    .filter((c): c is { name: string; alpha: number } => !!c && utilityColour("bg", c.name, vars) !== null);
  if (grounds.length !== 1) throw new Error(`expected one ground colour in "${where.classes.join(" ")}", found ${grounds.length}`);
  if (grounds[0].alpha !== 1) throw new Error(`a translucent ground (${grounds[0].name}/${grounds[0].alpha * 100}) depends on what is behind it`);
  const ground = utilityColour("bg", grounds[0].name, vars)!;

  // The ink is the element's own text colour, else the nearest ancestor's, else the body's.
  let ink: string | null = null;
  for (const classes of [where.classes, ...where.ancestors]) {
    for (const t of classes) {
      const c = colourToken(t, "text");
      const hex = c && utilityColour("text", c.name, vars);
      if (c && hex) { ink = c.alpha === 1 ? hex : blend(hex, c.alpha, ground); break; }
    }
    if (ink) break;
  }
  ink ??= utilityColour("text", "foreground", vars)!;
  return { ground, ink, ratio: contrastRatio(ink, ground) };
}

// ── The surfaces ─────────────────────────────────────────────────────────────

const SURFACES: { label: string; file: string; anchor: RegExp; within?: RegExp }[] = [
  { label: "Housing, the Learn About Residency button", file: "client/src/pages/Housing.tsx", anchor: /Learn About Residency/ },
  { label: "Housing, the Join Community Call button", file: "client/src/pages/Housing.tsx", anchor: /Join Community Call/ },
  { label: "ReserveHome, Back to housing options after a request", file: "client/src/pages/ReserveHome.tsx", anchor: /Back to housing options/ },
  { label: "ReserveHome, Back to housing when no homes are listed", file: "client/src/pages/ReserveHome.tsx", anchor: />\s*Back to housing\s*</ },
  { label: "ReserveHome, the Request this home button", file: "client/src/pages/ReserveHome.tsx", anchor: /Request this home/ },
  {
    label: "ProjectHistory, the open discussions count badge",
    file: "client/src/pages/ProjectHistory.tsx",
    anchor: /\{openCount\}/,
    within: /setActiveView\("discussion"\)/,
  },
];

describe("text on a brand ground clears AA for every village, light and dark", () => {
  it("measures 110 renderings per surface: the unseeded fork plus 54 derived themes, in two schemes", () => {
    expect(VILLAGES.length * SCHEMES.length).toBe(110);
  });

  for (const surface of SURFACES) {
    it(`${surface.label} reads at ${AA_BODY}:1 or better`, () => {
      const where = locate(surface.file, surface.anchor, surface.within);
      const below: string[] = [];
      let worst = Infinity;
      for (const village of VILLAGES) {
        for (const scheme of SCHEMES) {
          const { ground, ink, ratio } = measure(where, village, scheme);
          worst = Math.min(worst, ratio);
          if (ratio < AA_BODY) below.push(`${village.name} ${scheme}: ${ratio.toFixed(2)}:1, ${ink} on ${ground}`);
        }
      }
      expect(below, `${surface.label}: worst ${worst.toFixed(2)}:1 over ${where.classes.join(" ")}`).toEqual([]);
    });
  }
});

/*
 * The resolver above is what every number in this file stands on, so it is
 * held to the derivation it reads. A resolver that returned one constant, or
 * never applied `.dark`, would make every surface pass for the wrong reason.
 */
describe("the resolver reads the tokens a village actually gets", () => {
  it("resolves bg-teal-deep to the brand tone the theme derived, for every seeded village", () => {
    for (const village of VILLAGES.filter((v) => v.seed)) {
      const derived = deriveTheme(village.seed, village.card)!.vars["--tone-brand"];
      for (const scheme of SCHEMES) {
        expect(utilityColour("bg", "teal-deep", customProperties(village, scheme)), `${village.name} ${scheme}`).toBe(derived);
      }
    }
  });

  it("resolves an unseeded fork to the neutral fallbacks index.css ships", () => {
    const vars = customProperties(VILLAGES[0], "light");
    expect(utilityColour("bg", "teal-deep", vars)).toBe("#404040");
    expect(utilityColour("bg", "teal", vars)).toBe("#a3a3a3");
    expect(utilityColour("text", "foreground", vars)).toBe("#171717");
  });

  it("really applies the dark scheme: the unseeded fork's foreground turns light", () => {
    const light = utilityColour("text", "foreground", customProperties(VILLAGES[0], "light"))!;
    const dark = utilityColour("text", "foreground", customProperties(VILLAGES[0], "dark"))!;
    expect(contrastRatio(light, "#000000")).toBeLessThan(2);
    expect(contrastRatio(dark, "#000000")).toBeGreaterThan(12);
  });
});
