/**
 * THE DESIGN TOKEN LAYER (docs/DESIGN_TOKENS_SPEC.md, as amended).
 *
 * A founder makes THREE decisions — a seed colour, a character card, a
 * sentence about their place — and everything visual derives: the palette
 * with its semantic roles, the corner radius, the type pairing, and (later)
 * the image-generation prompt. This is "design the system, not 200 images"
 * made executable: two villages running identical code look like themselves,
 * not like each other, from three inputs a non-designer can give.
 *
 * Two rules this module enforces by construction:
 *
 * NEUTRAL BY DEFAULT. No seed = no output. An untouched fork emits nothing
 * from here and renders pixel-identically to the platform's shipped CSS —
 * a fresh village must look like nobody in particular, never like the first
 * tenant (spec §2.3, and the whole point of the white-label rule).
 *
 * CONTRAST IS MEASURED, NEVER EXCUSED (amendment A3). Every derived pairing
 * is checked against WCAG 2.1; under the default "enforce" policy a failing
 * role is ADJUSTED (the seed keeps its hue, loses its lightness) and reported
 * as such. The report never claims "ok" for anything it did not compute.
 *
 * All colour math is here, dependency-free: hex ↔ HSL for derivation and the
 * WCAG relative-luminance formula for truth. HSL is crude next to OKLCH, but
 * every derived LIGHTNESS is chosen by binary search against the WCAG ratio
 * itself, so perceptual crudeness costs harmony at worst — never legibility.
 */

// ── Colour math ──────────────────────────────────────────────────────────────

export interface Hsl { h: number; s: number; l: number }

export function hexToHsl(hex: string): Hsl | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 :
    max === g ? ((b - r) / d + 2) * 60 :
    ((r - g) / d + 4) * 60;
  return { h, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** WCAG 2.1 relative luminance of a hex colour. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

/** WCAG contrast ratio between two hex colours: 1 (none) to 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The seed at a lightness where `against` text clears `ratio`. Binary search
 * on L against the WCAG formula itself — hue and saturation survive, so the
 * village's colour stays THEIRS; only its legibility is non-negotiable.
 */
export function atContrast(seed: Hsl, against: string, ratio: number, darker = true): Hsl {
  let lo = darker ? 0 : seed.l;
  let hi = darker ? seed.l : 1;
  let best = { ...seed, l: darker ? 0.2 : 0.9 };
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = { ...seed, l: mid };
    const ok = contrastRatio(hslToHex(candidate), against) >= ratio;
    if (ok) {
      best = candidate;
      // ok: move toward the seed's own lightness to change it as little as possible
      if (darker) lo = mid; else hi = mid;
    } else {
      if (darker) hi = mid; else lo = mid;
    }
  }
  return best;
}

// ── The character cards ──────────────────────────────────────────────────────

/**
 * One card bundles exactly the choices a non-designer gets wrong when asked
 * separately: radius, type pairing, surface warmth, palette intensity. Six
 * moods, all in the platform's register. The card also carries the WORLD
 * words the image prompt will use when generation lands — the same choice
 * that rounds your corners will light your illustrations.
 */
export interface CharacterCard {
  id: string;
  label: string;
  hint: string;
  radiusRem: number;
  /** Degrees the accent hue sits from the seed. */
  accentRotation: number;
  /** Multiplies derived-step saturation. The seed itself is never touched. */
  chromaMul: number;
  surface: "light" | "warm" | "deep";
  /** FONT_CATALOG ids (shared/fontCatalog.ts) — display / body / accent. */
  fonts: [string, string, string];
  /** WORLD clause for the future prompt grammar. Brand-neutral by CI. */
  world: string;
}

export const CHARACTER_CARDS: CharacterCard[] = [
  { id: "quiet",    label: "Quiet",    hint: "Restrained, spacious, lets the work speak.",          radiusRem: 0.5,  accentRotation: 30,  chromaMul: 0.7, surface: "light", fonts: ["raleway", "montserrat", "kalam"],          world: "soft even light, muted natural palette, calm negative space" },
  { id: "handmade", label: "Handmade", hint: "Warm, imperfect, close to the materials.",            radiusRem: 0.75, accentRotation: 45,  chromaMul: 0.9, surface: "warm",  fonts: ["josefin-sans", "nunito-sans", "caveat"],   world: "warm afternoon light, textured natural materials, hand-crafted detail" },
  { id: "field",    label: "Field",    hint: "Open air, working land, boots on.",                   radiusRem: 0.375,accentRotation: -40, chromaMul: 1.0, surface: "light", fonts: ["raleway", "nunito-sans", "kalam"],         world: "clear daylight, wide horizons, growing things in rows and hedges" },
  { id: "woven",    label: "Woven",    hint: "Layered, communal, many hands in the pattern.",       radiusRem: 1.0,  accentRotation: 60,  chromaMul: 1.1, surface: "warm",  fonts: ["cormorant-garamond", "montserrat", "caveat"], world: "interlaced patterns, gathered textiles, dappled communal light" },
  { id: "coastal",  label: "Coastal",  hint: "Bright water, salt air, easy movement.",              radiusRem: 0.75, accentRotation: -25, chromaMul: 1.0, surface: "light", fonts: ["josefin-sans", "montserrat", "caveat"],    world: "bright reflected light, water and sky, weathered timber" },
  { id: "civic",    label: "Civic",    hint: "Steady, inscriptional, built to be read aloud.",      radiusRem: 0.25, accentRotation: 15,  chromaMul: 0.8, surface: "deep",  fonts: ["marcellus", "montserrat", "kalam"],        world: "monumental calm, stone and timber, long shadows and clear geometry" },
];

export function cardById(id: string | undefined | null): CharacterCard | null {
  return CHARACTER_CARDS.find((c) => c.id === id) ?? null;
}

// ── Derivation ───────────────────────────────────────────────────────────────

export interface ContrastPair { name: string; fg: string; bg: string; ratio: number; wanted: number; verdict: "pass" | "adjusted" | "fail" }
export interface ContrastReport {
  /** "unverified" whenever anything was NOT computed — never silently "ok" (A3). */
  status: "ok" | "adjusted" | "fail" | "unverified";
  worstRatio: number;
  pairs: ContrastPair[];
}

export interface DerivedTheme {
  /** CSS custom properties, ready for :root:root emission. */
  vars: Record<string, string>;
  contrast: ContrastReport;
  card: CharacterCard;
  /** Font stacks the card implies (explicit theme.font* fields beat these). */
  fonts: { display: string; body: string; accent: string };
}

const AA_BODY = 4.5;
const AA_LARGE = 3.0;

/**
 * How far a hover moves from the brand, as the WCAG ratio between the two
 * grounds. The platform's own neutral pair, #404040 at rest and #262626 under
 * the pointer, is 1.46; Tailwind's blue-600 to blue-700 is 1.30. This sits
 * between them, so every village's hover reads as a change at least as clearly
 * as those do.
 */
export const HOVER_STEP = 1.4;

/**
 * Derive everything from (seed, card). Returns null when seed is absent or
 * invalid — the neutral case, which MUST emit nothing.
 */
export function deriveTheme(seedHex: string | undefined | null, cardId: string | undefined | null): DerivedTheme | null {
  const seed = seedHex ? hexToHsl(seedHex) : null;
  if (!seed) return null;
  const card = cardById(cardId) ?? CHARACTER_CARDS[0];

  const sat = (mul: number) => Math.max(0.04, Math.min(0.95, seed.s * card.chromaMul * mul));
  const pairs: ContrastPair[] = [];
  let adjusted = false;

  const measured = (name: string, fgHex: string, bgHex: string, wanted: number, wasAdjusted: boolean): void => {
    const ratio = contrastRatio(fgHex, bgHex);
    const verdict: ContrastPair["verdict"] = ratio >= wanted ? (wasAdjusted ? "adjusted" : "pass") : "fail";
    if (wasAdjusted) adjusted = true;
    pairs.push({ name, fg: fgHex, bg: bgHex, ratio: Math.round(ratio * 100) / 100, wanted, verdict });
  };

  // brand: the seed, at a lightness where white text clears AA body. This is
  // "enforce": the hue is the village's, the legibility is the platform's.
  const brandTarget = { ...seed, s: sat(1) };
  const brand = atContrast(brandTarget, "#ffffff", AA_BODY, true);
  const brandHex = hslToHex(brand);
  measured("white on brand", "#ffffff", brandHex, AA_BODY, Math.abs(brand.l - seed.l) > 0.02);

  /*
   * THE BRAND UNDER THE POINTER. A primary button is white text on `brand`,
   * and it needs a hover colour a member can SEE that still carries the white.
   * No tone here did both. The soft tone is where 17 buttons used to hover, and
   * white on it is 1.67 to 3.00:1. A translucent brand (`/90`, `opacity-90`)
   * lifts toward the page, and `brand` above is derived so white only just
   * clears 4.5, so the fade dropped 28 of 55 villages below it (3.79 worst).
   * The band is darker or equal, and it is EQUAL whenever the accent already
   * clears on the brand: 8 of 54 themes, where a hover to it changes nothing.
   *
   * So the hover is the brand moved by a fixed step, HOVER_STEP, measured as
   * the WCAG ratio between the two grounds. It goes DARKER when there is room,
   * which can only raise white's contrast. A brand so dark that no darker
   * colour sits a step away (a near-black seed) goes lighter by the same step
   * instead, and the step is small enough that white still clears AA body on
   * it with room to spare. Both directions keep the seed's hue and saturation.
   */
  const darkerHover = atContrast(brand, brandHex, HOVER_STEP, true);
  const brandHover =
    darkerHover.l < brand.l && contrastRatio(hslToHex(darkerHover), brandHex) >= HOVER_STEP
      ? darkerHover
      : atContrast(brand, brandHex, HOVER_STEP, false);
  const brandHoverHex = hslToHex(brandHover);
  measured("white on brand hover", "#ffffff", brandHoverHex, AA_BODY, false);

  // ink: near-black of the seed's hue, forced past AAA-ish on the background.
  const surfaces = {
    light: { bg: { h: seed.h, s: 0.04, l: 0.95 }, card: { h: 0, s: 0, l: 1 } },
    warm:  { bg: { h: 45, s: 0.28, l: 0.93 }, card: { h: 45, s: 0.35, l: 0.97 } },
    deep:  { bg: { h: seed.h, s: 0.08, l: 0.92 }, card: { h: 0, s: 0, l: 1 } },
  }[card.surface];
  const bgHex = hslToHex(surfaces.bg);
  const cardHex = hslToHex(surfaces.card);
  const ink = atContrast({ h: seed.h, s: Math.min(0.45, seed.s), l: 0.2 }, bgHex, 7, true);
  const inkHex = hslToHex(ink);
  measured("ink on background", inkHex, bgHex, AA_BODY, false);
  measured("ink on card", inkHex, cardHex, AA_BODY, false);

  // accent (sun): rotated hue, used for chips and highlights carrying ink.
  // Enforced upward: some rotations land in hues that are perceptually dark
  // at the same nominal lightness (teal+45° → blue read 2.65:1 under ink),
  // so the accent RISES until the ink clears large-text contrast on it.
  const sun = atContrast({ h: seed.h + card.accentRotation, s: sat(1.05), l: 0.62 }, inkHex, AA_LARGE, false);
  const sunHex = hslToHex(sun);
  measured("ink on accent", inkHex, sunHex, AA_LARGE, Math.abs(sun.l - 0.62) > 0.02);

  /*
   * THE ACCENT AS A LABEL ON THE BRAND SURFACE — the pairing this file did not
   * have, and the reason fifteen section eyebrows shipped at 2.53:1. `sun` above
   * is derived for ink to sit ON it. The client also does the opposite: the
   * accent AS TEXT, on the brand band. Nothing measured that, so nothing caught
   * it, and the header of this file was still telling the truth: it measures the
   * pairings it DERIVES, and that one was composed in JSX.
   *
   * Naively lifting the accent until it clears does not work, and the simulation
   * says so: `brand` is already derived so that WHITE only just clears 4.5 on it,
   * so no saturated colour can clear 4.5 above it without becoming white. Across
   * 72 seed x card combinations, lifting alone washed 34 accents past L 0.92.
   * Darkening the band alone is no better at the other end: a navy seed drove its
   * band to L 0.02, which is not navy any more, it is black.
   *
   * So BOTH MOVE, one step each, and the search stops the moment the pair clears.
   * Neither colour carries the whole cost. Measured over the same 72:
   *
   *     accents washed near-white   34 -> 0
   *     bands driven near-black      6 (from 1 catastrophic) and none below L 0.02
   *     worst pairing              4.51:1, max deviation 0.185 L on either side
   *     white on the deepened band 5.36:1 worst, so white text only gets safer
   *
   * That is the A3 philosophy applied to a pair rather than to one colour: the
   * village's hues stay theirs, and the legibility is non-negotiable.
   */
  const bandSeed = hexToHsl(brandHex)!;
  let brandBand = bandSeed;
  let sunOnBand = sun;
  for (let i = 0; i <= 100; i++) {
    const step = i * 0.005;
    brandBand = { ...bandSeed, l: Math.max(0, bandSeed.l - step) };
    sunOnBand = { ...sun, l: Math.min(1, sun.l + step) };
    if (contrastRatio(hslToHex(sunOnBand), hslToHex(brandBand)) >= AA_BODY) break;
  }
  const brandBandHex = hslToHex(brandBand);
  const sunOnBandHex = hslToHex(sunOnBand);
  measured("accent label on brand band", sunOnBandHex, brandBandHex, AA_BODY, brandBand.l < bandSeed.l - 0.001);
  measured("white on brand band", "#ffffff", brandBandHex, AA_BODY, false);

  // Soft steps — decorative tints, checked only where text sits on them.
  // brand-mid carries white text in hovers and secondary chips, so it is not
  // a blind lightness offset: it rises toward brand.l+0.14 only as far as
  // white-at-3:1 allows. A neon seed taught this — its mid at +0.14 measured
  // 2.28:1 and the report correctly refused to say "ok".
  const brandMid = hslToHex(
    atContrast({ ...brand, l: Math.min(0.55, brand.l + 0.14) }, "#ffffff", AA_LARGE, true),
  );
  const brandSoft = hslToHex({ h: seed.h, s: sat(0.55), l: 0.66 });
  const mist = hslToHex({ h: seed.h + 12, s: sat(0.35), l: 0.62 });
  const mistLight = hslToHex({ h: seed.h + 12, s: sat(0.3), l: 0.87 });
  const cream = card.surface === "warm" ? hslToHex({ h: 45, s: 0.4, l: 0.9 }) : hslToHex({ h: seed.h, s: sat(0.2), l: 0.91 });
  const border = hslToHex({ h: seed.h, s: sat(0.3), l: 0.82 });
  const mutedBg = hslToHex({ h: seed.h, s: sat(0.25), l: 0.92 });
  const mutedFg = atContrast({ h: seed.h, s: sat(0.6), l: 0.35 }, mutedBg, AA_BODY, true);
  measured("muted text on muted", hslToHex(mutedFg), mutedBg, AA_BODY, false);
  measured("white on brand-mid (large only)", "#ffffff", brandMid, AA_LARGE, false);

  // Each pair now CARRIES the floor it was judged against. This used to sniff the
  // name for "large" or "accent", which happened to be right for the six pairings
  // that existed and would have quietly mis-scored the next one added: "accent
  // label on brand band" is an AA_BODY pairing whose name contains "accent".
  const worst = Math.min(...pairs.map((p) => p.ratio / p.wanted));
  const anyFail = pairs.some((p) => p.verdict === "fail");
  const contrast: ContrastReport = {
    status: anyFail ? "fail" : adjusted ? "adjusted" : "ok",
    worstRatio: Math.round(Math.min(...pairs.map((p) => p.ratio)) * 100) / 100,
    pairs,
  };
  void worst;

  const vars: Record<string, string> = {
    // The tone layer — index.css aliases the historical colour names to these.
    "--tone-brand": brandHex,
    // The primary button's hover partner: a visible step from --tone-brand,
    // carrying white at AA body for every seed. Derived above.
    "--tone-brand-hover": brandHoverHex,
    "--tone-brand-mid": brandMid,
    "--tone-brand-soft": brandSoft,
    "--tone-mist": mist,
    "--tone-mist-light": mistLight,
    "--tone-cream": cream,
    "--tone-sun": sunHex,
    // The band, and the accent that is legible AS TEXT on it. Derived as a pair
    // above, because neither one alone can carry the contrast without ceasing to
    // be a colour the village would recognise.
    "--tone-brand-band": brandBandHex,
    "--tone-sun-on-band": sunOnBandHex,
    // The shadcn semantic set (already runtime vars in :root).
    "--primary": brandHex,
    "--primary-foreground": "#ffffff",
    "--ring": brandHex,
    "--background": bgHex,
    "--foreground": inkHex,
    "--card": cardHex,
    "--card-foreground": inkHex,
    "--popover": cardHex,
    "--popover-foreground": inkHex,
    "--secondary": sunHex,
    "--secondary-foreground": inkHex,
    "--accent": brandSoft,
    "--accent-foreground": inkHex,
    "--muted": mutedBg,
    "--muted-foreground": hslToHex(mutedFg),
    "--border": border,
    "--input": mutedBg,
    "--sidebar": cream,
    "--sidebar-foreground": inkHex,
    "--sidebar-primary": brandHex,
    "--sidebar-primary-foreground": "#ffffff",
    "--sidebar-accent": mutedBg,
    "--sidebar-accent-foreground": inkHex,
    "--sidebar-border": border,
    "--sidebar-ring": brandHex,
    "--chart-1": brandHex,
    "--chart-2": brandSoft,
    "--chart-3": mist,
    "--chart-4": sunHex,
    "--chart-5": mistLight,
    "--radius": `${card.radiusRem}rem`,
  };

  return { vars, contrast, card, fonts: cardFontStacks(card) };
}

/** Resolve a card's FONT_CATALOG ids to full stacks without importing the
 * catalogue here (shared→shared import cycles bite); the caller joins them. */
export function cardFontStacks(card: CharacterCard): { display: string; body: string; accent: string } {
  const STACKS: Record<string, string> = {
    "raleway": '"Raleway", system-ui, sans-serif',
    "josefin-sans": '"Josefin Sans", "Raleway", system-ui, sans-serif',
    "cormorant-garamond": '"Cormorant Garamond", Georgia, serif',
    "playfair-display": '"Playfair Display", Georgia, serif',
    "marcellus": '"Marcellus", Georgia, serif',
    "montserrat": '"Montserrat", -apple-system, BlinkMacSystemFont, sans-serif',
    "nunito-sans": '"Nunito Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    "kalam": '"Kalam", cursive',
    "caveat": '"Caveat", cursive',
  };
  const [d, b, a] = card.fonts;
  return {
    display: STACKS[d] ?? STACKS["raleway"],
    body: STACKS[b] ?? STACKS["montserrat"],
    accent: STACKS[a] ?? STACKS["kalam"],
  };
}
