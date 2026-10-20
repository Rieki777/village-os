/**
 * THE ROOM'S NIGHT HAS TO READ, for the untouched fork and for a real village.
 *
 * The open room sits under `.sheet-night` and `.room-night` (index.css). The
 * second block mixes the room's ground, panels, quiet ink and hairline out of
 * the village's derived band and accent with `color-mix`, which the shared
 * contrast helper (client/src/test/tokenContrast.ts) cannot read. So this file
 * resolves the two blocks itself, the way the browser does: the custom
 * properties of `:root`, the `@theme inline` tokens, the village's emitted
 * theme on top, then the night's own declarations, with `var()` fallbacks and
 * `color-mix(in srgb, ...)` worked out in sRGB. The ratio is the design
 * system's own (`contrastRatio`, shared/brandTokens.ts).
 *
 * Two villages are measured. The untouched fork, which has no seed and paints
 * the neutral fallbacks. And a canopy seed, a deep forest green on the
 * Handmade card with a pinned champagne accent, which is the first hosted
 * village's brand and the case the room was designed on.
 *
 * Floors: 4.5 for text, 3 for an edge or a large gold mark (WCAG 1.4.3 and
 * 1.4.11). Read the values from the stylesheet, so a re-tuned mix is measured
 * the day it changes.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, deriveTheme } from "@shared/brandTokens";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const CSS = fs
  .readFileSync(path.join(ROOT, "client", "src", "index.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\r/g, "");

/** The declarations of every top-level block whose selector is exactly `selector`. */
function block(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opener = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = opener.exec(CSS))) {
    let depth = 1;
    let i = opener.lastIndex;
    const start = i;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") depth--;
      i++;
    }
    const body = CSS.slice(start, i - 1);
    const decl = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let d: RegExpExecArray | null;
    while ((d = decl.exec(body))) out[d[1]] = d[2].trim();
  }
  return out;
}

type Rgb = [number, number, number];

/** Split at top-level commas. */
function args(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(inner.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(inner.slice(from).trim());
  return out;
}

function resolve(value: string, vars: Record<string, string>, depth = 0): Rgb {
  if (depth > 20) throw new Error(`reference loop at ${value}`);
  const v = value.trim();
  const ref = /^var\((.*)\)$/.exec(v);
  if (ref) {
    const [name, ...rest] = args(ref[1]);
    if (vars[name] !== undefined) return resolve(vars[name], vars, depth + 1);
    if (rest.length) return resolve(rest.join(", "), vars, depth + 1);
    throw new Error(`${name} has no value and no fallback`);
  }
  const mix = /^color-mix\(\s*in srgb\s*,(.*)\)$/.exec(v);
  if (mix) {
    const [a, b] = args(mix[1]);
    const pa = /\s([\d.]+)%$/.exec(a);
    const pb = /\s([\d.]+)%$/.exec(b);
    const wa = pa ? parseFloat(pa[1]) / 100 : pb ? 1 - parseFloat(pb[1]) / 100 : 0.5;
    const ca = resolve(pa ? a.slice(0, pa.index) : a, vars, depth + 1);
    const cb = resolve(pb ? b.slice(0, pb.index) : b, vars, depth + 1);
    return [0, 1, 2].map((k) => ca[k] * wa + cb[k] * (1 - wa)) as Rgb;
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  throw new Error(`cannot read colour "${v}"`);
}

const toHex = (c: Rgb) => "#" + c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("");

/** The night as the open room resolves it, for a village's emitted theme (empty for the fork). */
function night(theme: Record<string, string>) {
  const tokens = block("@theme inline");
  const vars = { ...block(":root"), ...tokens, ...theme, ...block(".sheet-night"), ...block(".room-night") };
  const read = (name: string) => toHex(resolve(`var(${name})`, vars));
  return {
    ground: read("--background"),
    panel: read("--card"),
    raised: read("--muted"),
    ink: read("--foreground"),
    dim: read("--muted-foreground"),
    edge: read("--border"),
    notice: read("--color-notice"),
  };
}

const canopy = deriveTheme("#14362B", "handmade", "#E0C79A");

const VILLAGES: [string, Record<string, string>][] = [
  ["the untouched fork", {}],
  ["a canopy seed with a pinned champagne", canopy?.vars ?? {}],
];

describe("the room's night", () => {
  it("derives a canopy theme to measure", () => {
    expect(canopy).not.toBeNull();
  });

  it("is the village's night: the panel is the band, the gold is the accent on the band", () => {
    const n = night(canopy!.vars);
    expect(n.panel).toBe(canopy!.vars["--tone-brand-band"].toLowerCase());
    expect(n.notice).toBe(canopy!.vars["--tone-sun-on-band"].toLowerCase());
  });

  for (const [name, theme] of VILLAGES) {
    describe(name, () => {
      const n = night(theme);
      const pair = (fg: string, bg: string) => contrastRatio(fg, bg);

      it("ink reads on the ground, the panel and a tile", () => {
        expect(pair(n.ink, n.ground)).toBeGreaterThanOrEqual(4.5);
        expect(pair(n.ink, n.panel)).toBeGreaterThanOrEqual(4.5);
        expect(pair(n.ink, n.raised)).toBeGreaterThanOrEqual(4.5);
      });

      it("the quiet ink reads on the panel and on a tile", () => {
        expect(pair(n.dim, n.panel)).toBeGreaterThanOrEqual(4.5);
        expect(pair(n.dim, n.raised)).toBeGreaterThanOrEqual(4.5);
        expect(pair(n.dim, n.ground)).toBeGreaterThanOrEqual(4.5);
      });

      it("the hairline holds on the panel and on a tile", () => {
        expect(pair(n.edge, n.panel)).toBeGreaterThanOrEqual(3);
        expect(pair(n.edge, n.raised)).toBeGreaterThanOrEqual(3);
      });

      it("the gold holds on the panel, and dark ink reads on the gold", () => {
        expect(pair(n.notice, n.panel)).toBeGreaterThanOrEqual(3);
        expect(pair(n.notice, n.raised)).toBeGreaterThanOrEqual(3);
        // The chosen tile and the gold button: the ground's colour on the gold.
        expect(pair(n.ground, n.notice)).toBeGreaterThanOrEqual(4.5);
      });

      it("the strong button is the ground on the moonlight", () => {
        expect(pair(n.ground, n.ink)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
