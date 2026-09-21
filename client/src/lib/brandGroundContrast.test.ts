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
 * UNDER THE POINTER, added 2026-09-21 on Rye's ruling that a primary button
 * keeps a visible hover colour and that the hover passes AA. The second half
 * of this file reads every class list in client/src whose ink is white under
 * hover, focus or active and whose ground there is one a village's seed
 * moves, resolves that ground the same way, and asserts 4.5:1 plus a visible
 * step from rest. There is no dark mode (the theme is fixed to light by the
 * same ruling), so those readings and the Housing hero's are LIGHT only: 55
 * per surface.
 *
 * WHAT IT DOES NOT MEASURE: anything painted by a gradient or an image, which
 * no ratio can score honestly, and a fade's backdrop beyond white. A
 * translucent or faded hover is composited over white, the lightest ground a
 * button sits on and so the worst case for white text.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildThemeCss } from "../../../server/lib/themeCss";
import { CHARACTER_CARDS, contrastRatio, deriveTheme, HOVER_STEP } from "@shared/brandTokens";

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

// ── Light only, from here down ───────────────────────────────────────────────

/* Rye, 2026-09-21: no dark mode; the theme is fixed to light. */
const lightCache = new Map<string, Map<string, string>>();
const light = (village: Village) => {
  if (!lightCache.has(village.name)) lightCache.set(village.name, customProperties(village, "light"));
  return lightCache.get(village.name)!;
};
const WHITE = "#ffffff";

/** The innermost element whose source matches the anchor, ground or not. */
function locateAny(file: string, anchor: RegExp): Located {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: (Located & { node: ts.Node })[] = [];
  const visit = (node: ts.Node, ancestors: string[][]) => {
    let next = ancestors;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const classes = classNameOf(ts.isJsxElement(node) ? node.openingElement : node);
      if (anchor.test(node.getText(sf))) found.push({ node, classes, ancestors });
      next = [classes, ...ancestors];
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(sf, []);
  const innermost = found.filter((f) => !found.some((g) => g !== f && g.node.pos >= f.node.pos && g.node.end <= f.node.end));
  if (innermost.length !== 1) throw new Error(`${file}: ${anchor} names ${innermost.length} elements, expected exactly one`);
  return innermost[0];
}

/** Text on the ground an ancestor paints: the nearest opaque ground, and the nearest ink. */
function measureOnNearestGround(where: Located, village: Village) {
  const vars = light(village);
  const chain = [where.classes, ...where.ancestors];
  let ground: string | null = null;
  for (const classes of chain) {
    const c = classes.map((t) => colourToken(t, "bg")).find((x) => x && utilityColour("bg", x.name, vars));
    if (c) {
      if (c.alpha !== 1) throw new Error(`a translucent ground (${c.name}) depends on what is behind it`);
      ground = utilityColour("bg", c.name, vars);
      break;
    }
  }
  if (!ground) throw new Error("no ground painted by the element or any ancestor");
  let ink: string | null = null;
  for (const classes of chain) {
    const c = classes.map((t) => colourToken(t, "text")).find((x) => x && utilityColour("text", x.name, vars));
    if (c) {
      const hex = utilityColour("text", c.name, vars)!;
      ink = c.alpha === 1 ? hex : blend(hex, c.alpha, ground);
      break;
    }
  }
  ink ??= utilityColour("text", "foreground", vars)!;
  return { ground, ink, ratio: contrastRatio(ink, ground) };
}

/*
 * THE HOUSING HERO, on the band since Rye's ruling. Both the heading and the
 * paragraph are held to 4.5:1. The heading is 36px bold and could claim the
 * 3:1 large-text floor, but it does not need it: the band is derived no
 * lighter than --tone-brand, which white clears at 4.5 by construction, so
 * the stricter floor costs nothing and catches more. The paragraph is the
 * one that needed full white: at /80 it read 4.03:1 on the handmade/#ff6b00
 * band and fell under 4.5 on 7 of the 54 seeded themes.
 */
const HERO: { label: string; anchor: RegExp }[] = [
  { label: "the Housing hero heading", anchor: /Housing at \{villageName\}/ },
  { label: "the Housing hero paragraph", anchor: /Find your place here/ },
];

describe("the Housing hero reads on the band for every village, light only", () => {
  for (const part of HERO) {
    it(`${part.label} reads at ${AA_BODY}:1 or better over 55 villages`, () => {
      const where = locateAny("client/src/pages/Housing.tsx", part.anchor);
      const below: string[] = [];
      let worst = Infinity;
      for (const village of VILLAGES) {
        const { ground, ink, ratio } = measureOnNearestGround(where, village);
        worst = Math.min(worst, ratio);
        if (ratio < AA_BODY) below.push(`${village.name}: ${ratio.toFixed(2)}:1, ${ink} on ${ground}`);
      }
      expect(below, `${part.label}: worst ${worst.toFixed(2)}:1`).toEqual([]);
    });
  }
});

// ── Under the pointer ────────────────────────────────────────────────────────

const STATE_VARIANT = /^(?:group-|peer-)?(?:hover|focus|focus-visible|focus-within|active)(?:\/[\w-]+)?$/;
const UNREAD_VARIANT = /^(?:dark|disabled|aria-disabled|group-disabled|peer-disabled)$/;

/** `[a&]:hover:bg-x` into its variant chain and utility; a `:` inside brackets does not split. */
function splitVariants(token: string): { variants: string[]; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of token) {
    if (c === "[") depth += 1;
    if (c === "]") depth -= 1;
    if (c === ":" && depth === 0) { parts.push(cur); cur = ""; } else cur += c;
  }
  parts.push(cur);
  return { variants: parts.slice(0, -1), utility: parts[parts.length - 1] };
}

interface ClassList { file: string; line: number; tokens: string[] }

/**
 * Every string a .tsx file writes, read with the TypeScript compiler rather
 * than the gate's text scan, so a fault in one does not blind the other. A
 * template also yields its static text joined to each string inside its
 * `${...}`, because that branch renders with it.
 */
function classListsIn(file: string): ClassList[] {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out: ClassList[] = [];
  const push = (n: ts.Node, text: string) => out.push({ file, line: lineOf(n), tokens: text.split(/\s+/).filter(Boolean) });
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node, node.text);
    if (ts.isTemplateExpression(node)) {
      const staticText = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
      push(node, staticText);
      const inner = (n: ts.Node): void => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) push(n, `${staticText} ${n.text}`);
        ts.forEachChild(n, inner);
      };
      node.templateSpans.forEach((s) => inner(s.expression));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The first colour utility in the list that the stylesheet can resolve, with its alpha. */
function firstPaint(utilities: string[], prefix: "bg" | "text", vars: Map<string, string>) {
  for (const u of utilities) {
    const c = colourToken(u, prefix);
    const hex = c && utilityColour(prefix, c.name, vars);
    if (c && hex) return { hex, alpha: c.alpha };
  }
  return null;
}

/**
 * What the pointer paints: the state ground (composited over white when it is
 * translucent), the ink under the state (a state text colour, else the
 * resting one), and a state opacity fading both toward white. Null when the
 * list has no state ground or no ink of its own.
 */
function hoverReading(tokens: string[], vars: Map<string, string>) {
  const parsed = tokens.map(splitVariants);
  const resting = parsed.filter((p) => p.variants.length === 0).map((p) => p.utility);
  const state = parsed
    .filter((p) => p.variants.some((v) => STATE_VARIANT.test(v)) && !p.variants.some((v) => UNREAD_VARIANT.test(v)))
    .map((p) => p.utility);
  const restBg = firstPaint(resting, "bg", vars);
  const stateBg = firstPaint(state, "bg", vars);
  const fade = state.map((u) => /^opacity-(\d+)$/.exec(u)).find(Boolean);
  const ink = firstPaint(state, "text", vars) ?? firstPaint(resting, "text", vars);
  if (!ink || (!stateBg && !fade)) return null;
  const over = (c: { hex: string; alpha: number }) => (c.alpha === 1 ? c.hex : blend(c.hex, c.alpha, WHITE));
  let ground = stateBg ? over(stateBg) : restBg ? over(restBg) : WHITE;
  let inkHex = ink.alpha === 1 ? ink.hex : blend(ink.hex, ink.alpha, ground);
  if (fade) {
    const a = Number(fade[1]) / 100;
    ground = blend(ground, a, WHITE);
    inkHex = blend(inkHex, a, WHITE);
  }
  // The visible step is judged only from an OPAQUE rest: a translucent one is
  // whatever sits behind it, and white is only the worst case for contrast.
  return { ground, ink: inkHex, rest: restBg && restBg.alpha === 1 ? restBg.hex : null };
}

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walkTsx(rel, out);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(rel);
  }
  return out;
}

/*
 * WHICH LISTS. White ink under the state, and a state ground that a village's
 * seed moves: the brand family. That leaves out white on bg-white/20 over a
 * dark band, a fixed red or sage, and every other ground no seed can reach,
 * which are not the pairing this ruling is about. It keeps the 25 buttons that
 * already hovered to bg-teal-deep-dark, whose hover colour this change moved
 * onto the derived tone, alongside the 60 it fixed.
 */
const UNSEEDED = VILLAGES[0];
const POINTER_LISTS = (() => {
  const seen = new Set<string>();
  const picked: (ClassList & { key: string })[] = [];
  for (const file of walkTsx("client/src").sort()) {
    for (const list of classListsIn(file)) {
      const first = hoverReading(list.tokens, light(UNSEEDED));
      if (!first || first.ink !== WHITE) continue;
      const grounds = new Set(VILLAGES.map((v) => hoverReading(list.tokens, light(v))?.ground));
      if (grounds.size < 2) continue;
      const key = `${file}:${list.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({ ...list, key });
    }
  }
  return picked;
})();

/*
 * THE FLOOR. Per file, the number of hovers this change fixed there (60 in
 * all: 17 onto the soft tone, 16 translucent brands, 25 faded buttons, the
 * shadcn button and the badge). A reader that stopped seeing them would
 * otherwise pass by measuring nothing.
 */
const FIXED: Record<string, number> = {
  "client/src/components/GuideChat.tsx": 2,
  "client/src/components/QuestActions.tsx": 2,
  "client/src/components/admin/ContentEditorTab.tsx": 1,
  "client/src/components/profile/InvitePanel.tsx": 1,
  "client/src/components/ui/badge.tsx": 1,
  "client/src/components/ui/button.tsx": 1,
  "client/src/pages/Admin.tsx": 13,
  "client/src/pages/Bootstrap.tsx": 1,
  "client/src/pages/CoCreatorsGuide.tsx": 1,
  "client/src/pages/FirstWalk.tsx": 2,
  "client/src/pages/Forum.tsx": 1,
  "client/src/pages/GameMechanics.tsx": 5,
  "client/src/pages/GoodNeighbor.tsx": 1,
  "client/src/pages/Home.tsx": 1,
  "client/src/pages/Housing.tsx": 2,
  "client/src/pages/HowWeCreate.tsx": 1,
  "client/src/pages/LoveLetter.tsx": 2,
  "client/src/pages/NotFound.tsx": 1,
  "client/src/pages/Opportunities.tsx": 1,
  "client/src/pages/ProjectHistory.tsx": 5,
  "client/src/pages/ProposeQuest.tsx": 2,
  "client/src/pages/QuestDetail.tsx": 1,
  "client/src/pages/Quests.tsx": 2,
  "client/src/pages/RequestMembership.tsx": 2,
  "client/src/pages/ResidentJourney.tsx": 2,
  "client/src/pages/ResidentRights.tsx": 1,
  "client/src/pages/SetPassword.tsx": 1,
  "client/src/pages/StewardRights.tsx": 1,
  "client/src/pages/Visit.tsx": 2,
  "client/src/pages/WorkWithUs.tsx": 1,
};

describe("under the pointer, a brand button stays readable and visibly moves, light only", () => {
  it(`reads every white-on-brand hover in client/src (${POINTER_LISTS.length}), and every one this change fixed`, () => {
    expect(Object.values(FIXED).reduce((n, v) => n + v, 0)).toBe(60);
    for (const [file, n] of Object.entries(FIXED)) {
      expect(POINTER_LISTS.filter((l) => l.file === file).length, `${file} hovers read`).toBeGreaterThanOrEqual(n);
    }
    expect(POINTER_LISTS.length).toBeGreaterThanOrEqual(60 + 25);
  });

  for (const list of POINTER_LISTS) {
    it(`${list.key} reads at ${AA_BODY}:1 or better under the pointer, a visible step from rest`, () => {
      const below: string[] = [];
      const flat: string[] = [];
      let worst = Infinity;
      for (const village of VILLAGES) {
        const r = hoverReading(list.tokens, light(village))!;
        const ratio = contrastRatio(r.ink, r.ground);
        worst = Math.min(worst, ratio);
        if (ratio < AA_BODY) below.push(`${village.name}: ${ratio.toFixed(2)}:1, ${r.ink} on ${r.ground}`);
        if (r.rest && contrastRatio(r.rest, r.ground) < HOVER_STEP) {
          flat.push(`${village.name}: rest ${r.rest} to hover ${r.ground} is ${contrastRatio(r.rest, r.ground).toFixed(2)}`);
        }
      }
      expect(below, `${list.key}: worst ${worst.toFixed(2)}:1 over ${list.tokens.join(" ")}`).toEqual([]);
      expect(flat, `${list.key}: a hover nobody can see`).toEqual([]);
    });
  }

  // The platform button's legacy class name, which index.css flags for a coordinated rename.
  const LEGACY_BUTTON = "btn-amora"; // brand-ok: the stylesheet's legacy class name, read here to measure it
  it(`.${LEGACY_BUTTON} keeps white readable under the pointer, and visibly moves`, () => {
    const below: string[] = [];
    const flat: string[] = [];
    for (const village of VILLAGES) {
      const vars = light(village);
      const ink = literalToHex(resolveValue(componentRule(LEGACY_BUTTON, "color")!, vars));
      const rest = literalToHex(resolveValue(componentRule(LEGACY_BUTTON, "background-color")!, vars));
      const hover = literalToHex(resolveValue(componentRule(`${LEGACY_BUTTON}:hover`, "background-color")!, vars));
      if (contrastRatio(ink, hover) < AA_BODY) below.push(`${village.name}: ${contrastRatio(ink, hover).toFixed(2)}:1 on ${hover}`);
      if (contrastRatio(rest, hover) < HOVER_STEP) flat.push(`${village.name}: ${rest} to ${hover}`);
    }
    expect(below).toEqual([]);
    expect(flat).toEqual([]);
  });

  it("the resolver reads the hover partner a village actually gets", () => {
    for (const village of VILLAGES.filter((v) => v.seed)) {
      const derived = deriveTheme(village.seed, village.card)!.vars["--tone-brand-hover"];
      expect(utilityColour("bg", "teal-deep-dark", light(village)), village.name).toBe(derived);
    }
    expect(utilityColour("bg", "teal-deep-dark", light(UNSEEDED))).toBe("#262626");
  });
});
