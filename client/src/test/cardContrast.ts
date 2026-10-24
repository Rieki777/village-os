/**
 * WCAG contrast for the PLAYER CARD, computed from the card's own stylesheet.
 *
 * The card draws with the approved design's classes (playerCard.css, the
 * `pc-` rules), not with Tailwind utilities, so the token instrument
 * (tokenContrast.ts) sees no colour on most of its lines and would measure
 * them all as the body's ink on the body's ground: a pass that measured
 * nothing. This instrument reads what the browser reads instead.
 *
 * HOW. playerCard.css is parsed into rules. For every line of text under the
 * card, its ink is the first `color` declared on it or an ancestor (CSS
 * inheritance), by the cascade over the rules whose selector the element
 * matches (`Element.matches`, specificity, then source order); its ground is
 * every `background` from it upward, composited until one is opaque. A
 * gradient ground is measured at EACH of its stops and the worst one counts,
 * so a translucent gold wash cannot hide a weak pair. Values resolve through
 * the `.pc-night` token block, which is also the overlay for any Tailwind
 * utility a shared control inside the card carries (the raise-a-tension form,
 * the decide doors): those are resolved by tokenContrast's own reader.
 *
 * WHAT IT SEES. The narrowest viewport: every `max-width` media block applies.
 * No state: rules naming `:hover`, `:focus`, `:target` or a pseudo-element are
 * left out. Floors: 4.5 for body text, 3 for large text (24px, or 18.66px at
 * 700 or heavier).
 *
 * WHAT IT REFUSES. A selector the DOM engine cannot match throws, naming it,
 * rather than being skipped: a rule silently dropped is a colour silently not
 * measured.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "@shared/brandTokens";
import { over, parseColor, schemeVars, toHex, utilityColour, type Rgba, type Scheme, type TextContrast } from "./tokenContrast";

const repoRoot = () =>
  import.meta.url.startsWith("file:") ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..") : process.cwd();

interface Rule {
  selector: string;
  decls: Record<string, string>;
  spec: [number, number, number];
  order: number;
}

const STATE = /:(hover|focus|focus-visible|focus-within|active|target|disabled)\b|::|:-webkit-|::-webkit-/;

/** Specificity of one complex selector, with `:where()` counting nothing and `:is()` its heaviest argument. */
function specificity(sel: string): [number, number, number] {
  let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  let a = 0;
  let b = 0;
  let c = 0;
  s = s.replace(/:is\(((?:[^()]|\([^()]*\))*)\)/g, (_m, inner: string) => {
    const best = inner
      .split(",")
      .map((x) => specificity(x.trim()))
      .sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0] ?? [0, 0, 0];
    a += best[0];
    b += best[1];
    c += best[2];
    return " ";
  });
  a += (s.match(/#[\w-]+/g) ?? []).length;
  b += (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  c += (s.replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [a, b, c];
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim().replace(/\s*!important$/, "");
    if (k) out[k] = v;
  }
  return out;
}

interface Sheet {
  rules: Rule[];
  tokens: Record<string, string>;
}

let cached: Sheet | null = null;

/** playerCard.css as rules, with every `@media (max-width: ...)` block applied (the narrowest viewport). */
export function cardSheet(): Sheet {
  if (cached) return cached;
  const file = path.join(repoRoot(), "client", "src", "components", "playerCard", "playerCard.css");
  const css = fs.readFileSync(file, "utf8").replace(/\r/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let order = 0;
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@media")) {
        if (/max-width/.test(head) && !/prefers-/.test(head)) walk(body);
      } else if (!head.startsWith("@")) {
        const decls = declarations(body);
        for (const sel of topLevel(head).filter(Boolean)) {
          if (STATE.test(sel)) continue;
          rules.push({ selector: sel, decls, spec: specificity(sel), order: order++ });
        }
      }
      i = j;
    }
  };
  walk(css);
  const tokens: Record<string, string> = {};
  for (const r of rules) {
    if (r.selector !== ".pc-night") continue;
    for (const [k, v] of Object.entries(r.decls)) if (k.startsWith("--")) tokens[k] = v;
  }
  cached = { rules, tokens };
  return cached;
}

/** The card's tokens as an overlay: the `.pc-night` block. */
export function cardOverlay(): Record<string, string> {
  return { ...cardSheet().tokens };
}

/** The winning declaration of `prop` on this element, from the card's rules, or null. */
function declared(el: Element, prop: string): string | null {
  let best: Rule | null = null;
  for (const r of cardSheet().rules) {
    if (r.decls[prop] === undefined) continue;
    let hit: boolean;
    try {
      hit = el.matches(r.selector);
    } catch {
      throw new Error(`cardContrast cannot match the selector "${r.selector}"`);
    }
    if (!hit) continue;
    if (
      !best ||
      r.spec[0] > best.spec[0] ||
      (r.spec[0] === best.spec[0] && (r.spec[1] > best.spec[1] || (r.spec[1] === best.spec[1] && (r.spec[2] > best.spec[2] || (r.spec[2] === best.spec[2] && r.order > best.order)))))
    )
      best = r;
  }
  return best ? best.decls[prop] : null;
}

const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c && !c.includes(":"));

/** Split at top-level commas. */
function topLevel(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "(") depth++;
    else if (v[i] === ")") depth--;
    else if (v[i] === "," && depth === 0) {
      out.push(v.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(v.slice(from).trim());
  return out;
}

/** Every colour a background value can paint: one for a colour, each stop for a gradient, each layer for a stack. */
function groundCandidates(value: string, vars: Record<string, string>): Rgba[][] {
  // A stack of layers, top first; each layer is a list of the colours it may paint at some point.
  return topLevel(value).map((layer) => {
    const g = /^(?:linear|radial|conic)-gradient\((.*)\)$/.exec(layer);
    if (!g) return [parseColor(layer, vars)];
    return topLevel(g[1])
      .filter((stop) => !/^(from|to)\s|deg$|^\d/.test(stop))
      .map((stop) => parseColor(stop.replace(/\s+\d+(\.\d+)?%$/, ""), vars));
  });
}

function inkOf(el: Element, vars: Record<string, string>): Rgba | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const d = declared(e, "color");
    if (d && d !== "inherit") return parseColor(d, vars);
    for (const cls of classes(e)) {
      const u = utilityColour("text", cls, vars, e);
      if (u) return u;
    }
  }
  return null;
}

/** Every ground the text may sit on, worst case across gradient stops, composited down to an opaque one. */
function groundsOf(el: Element, vars: Record<string, string>, base: Rgba): Rgba[] {
  const stack: Rgba[][] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    const d = declared(e, "background") ?? declared(e, "background-color");
    let layers: Rgba[][] = [];
    if (d && d !== "none" && d !== "transparent") layers = groundCandidates(d, vars);
    else
      for (const cls of classes(e)) {
        const u = utilityColour("bg", cls, vars, e);
        if (u) layers = [[u]];
      }
    if (!layers.length) continue;
    stack.push(...layers);
    if (layers[layers.length - 1].every((c) => c.a >= 0.999)) break;
  }
  let grounds: Rgba[] = [base];
  for (let i = stack.length - 1; i >= 0; i--) {
    const next: Rgba[] = [];
    for (const top of stack[i]) for (const g of grounds) next.push(over(top, g));
    grounds = next;
  }
  return grounds;
}

const px = (v: string | null): number | null => {
  const m = /([\d.]+)px/.exec(v ?? "");
  return m ? parseFloat(m[1]) : null;
};

function fontPx(el: Element): number {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const size = px(declared(e, "font-size"));
    if (size) return size;
    const font = declared(e, "font");
    const f = font ? /(\d[\d.]*)px/.exec(font) : null;
    if (f) return parseFloat(f[1]);
  }
  return 16;
}

function weight(el: Element): number {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const w = declared(e, "font-weight");
    if (w && /^\d+$/.test(w)) return Number(w);
    const font = declared(e, "font");
    const f = font ? /^(\d{3})\s/.exec(font) : null;
    if (f) return Number(f[1]);
    if (e.tagName === "B" || e.tagName === "STRONG") return 700;
  }
  return 400;
}

const EMOJI = new RegExp("^[\\p{Extended_Pictographic}\\uFE0F\\u200D\\s]+$", "u");

/** Every line of text under the card, measured against the card's own stylesheet. */
/** `retint` overrides card tokens, for a control that must fail. */
export function measureCard(root: Element, scheme: Scheme = "light", retint: Record<string, string> = {}): TextContrast[] {
  const vars = schemeVars(scheme, { ...cardOverlay(), ...retint });
  const base = parseColor("var(--pc-ground)", vars);
  const out: TextContrast[] = [];
  root.querySelectorAll("*").forEach((el) => {
    let own = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) own += n.nodeValue ?? "";
    });
    const text = own.replace(/\s+/g, " ").trim();
    if (text.length < 2 || EMOJI.test(text)) return;
    const ink = inkOf(el, vars) ?? parseColor("var(--pc-ink)", vars);
    const size = fontPx(el);
    const floor = size >= 24 || (size >= 18.66 && weight(el) >= 700) ? 3 : 4.5;
    let worst: TextContrast | null = null;
    for (const ground of groundsOf(el, vars, base)) {
      const fg = over(ink, ground);
      const ratio = contrastRatio(toHex(fg), toHex(ground));
      if (!worst || ratio < worst.ratio) worst = { text, ratio, floor, fg: toHex(fg), bg: toHex(ground) };
    }
    if (worst) out.push(worst);
  });
  return out;
}
