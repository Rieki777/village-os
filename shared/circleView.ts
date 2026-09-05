/**
 * ONE CIRCLE SHAPE, FOR EVERY SURFACE THAT DRAWS A CIRCLE.
 *
 * Three pages show the village's circles and they used to disagree about
 * what a circle IS:
 *
 *   /circles      the cards page, from `/api/org`
 *   /map/circles  the power map, from `/api/map`
 *   /roles        the role list, from `/api/org`
 *
 * Both endpoints read the SAME rows (`circlesRepo.all()`), so the SET could
 * never drift. The FIELDS did. `/api/map` returned `circlesRepo.all()` raw
 * and `/api/org` hand-picked eight keys, which silently dropped `color` and
 * `icon` on the way out. The cards page therefore could not render a
 * circle's colour at all: the data existed, was written by the admin form,
 * was read from the database, and was deleted by the projection one line
 * before it reached the wire. Nothing failed and nothing logged.
 *
 * That is the shape of every "these two pages disagree" bug in this repo, so
 * the fix is structural instead of careful: there is one projection, both
 * endpoints call it, and `server/circleView.e2e.test.ts` asserts the two
 * payloads carry byte-identical circle arrays. A field added here reaches
 * every surface at once, and a field added to only one of them is now a
 * compile error rather than a difference somebody notices in a screenshot.
 *
 * WHAT DOES NOT BELONG HERE: anything about a PERSON. A circle row carries
 * no holder, no member id and no name, which is why one projection can serve
 * the anonymous tier and the member tier without a `seesPeople` argument.
 * Holders are tiered in the endpoints, where that decision already lives.
 */

/** A circle as every surface receives it. */
export interface CircleView {
  id: string;
  name: string;
  purpose: string | null;
  status: string;
  parentCircleId: string | null;
  /** The fractal: this circle grew out of a seat that outgrew itself. */
  grownFromOrgRoleId: string | null;
  order: number;
  isExample: boolean;
  /** The wayfinding pair. Dropped by the old `/api/org` projection. */
  icon: string | null;
  color: string | null;
  /** Other names this circle answers to, for search. */
  aliases: string[];
  /** The seat that speaks for this circle, when one is named. */
  leadRoleId: string | null;
  /** How this circle decides (0083). */
  decidesBy: string | null;
  decidesByGloss: string | null;
  /*
   * A MAP, keyed by domain, and it has to stay one.
   *
   * `DecideLens` reads it as `decidesByDomains?.[domain]?.method` and walks
   * it with `Object.keys`. An earlier draft of this projection normalised it
   * with an array helper, which turned every override into `[]`: the decide
   * lens would have gone blank for every circle that had declared one, with
   * no error on either side of the wire. The server writes it through
   * `projectDecidesByDomains`, so it arrives already validated and this is a
   * passthrough on purpose.
   */
  decidesByDomains: Record<string, { method: string; gloss?: string }> | null;
}

const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

/**
 * Project one stored circle row onto the wire shape.
 *
 * Takes `any` deliberately: the caller is a `dbCollection` row, which is
 * typed as a bag of columns at every existing call site. The RETURN is the
 * typed thing, and that is the end this file exists to pin down.
 */
export function circleView(c: any): CircleView {
  return {
    id: String(c?.id ?? ""),
    name: String(c?.name ?? ""),
    purpose: str(c?.purpose),
    status: str(c?.status) ?? "active",
    parentCircleId: str(c?.parentCircleId),
    grownFromOrgRoleId: str(c?.grownFromOrgRoleId),
    order: Number(c?.order ?? 0),
    isExample: !!c?.isExample,
    icon: str(c?.icon),
    color: str(c?.color),
    aliases: strArray(c?.aliases),
    leadRoleId: str(c?.leadRoleId),
    decidesBy: str(c?.decidesBy),
    decidesByGloss: str(c?.decidesByGloss),
    decidesByDomains:
      c?.decidesByDomains && typeof c.decidesByDomains === "object" && !Array.isArray(c.decidesByDomains)
        ? (c.decidesByDomains as Record<string, { method: string; gloss?: string }>)
        : null,
  };
}

/** Every circle, in the order the store returns them. */
export function circleViews(rows: any[]): CircleView[] {
  return (Array.isArray(rows) ? rows : []).map(circleView);
}

/**
 * THE PALETTE A CIRCLE FALLS BACK TO.
 *
 * A village that has never opened the admin colour picker has `color: null`
 * on every circle, which is what made the power map draw seventeen circles in
 * one grey. Colour is the strongest wayfinding signal the map owns, so a
 * missing colour resolves to a stable choice from the map's own palette
 * instead of to nothing.
 *
 * Keyed by circle ID so it is DETERMINISTIC: the same circle is the same
 * colour on the cards page, on the map, in the mini render and after a
 * reload, without storing anything. Sorting or renaming circles never
 * reshuffles the colours, which an index-based assignment would.
 */
export const CIRCLE_TONES = [
  "moss", "sage", "teal", "sky", "amber", "olive", "clay", "ember", "rose", "violet", "stone",
] as const;
export type CircleTone = (typeof CIRCLE_TONES)[number];

/**
 * THE LIVING MAP'S OWN PALETTE, WHICH THIS IS COPIED FROM ON PURPOSE.
 *
 * `docs/prototypes/grounds-v0.html` carries `CIRCLE_COL`: eleven hues, one
 * per circle, and it is the reason the artifact's Circles view reads as a
 * place while the power map read as a diagram. These are those hex values,
 * so crossing from the land to the circles does not feel like leaving the
 * world.
 *
 * Fixed hex, and NOT theme tokens, deliberately. This surface is the map's
 * own world (dark ground, parchment ink) the way the artifact is, so a
 * responsive token here would be a colour that changes out from under a
 * palette the rest of the picture holds fixed. That is the "theme-frozen
 * surface" trap in reverse and it is the same bug either way.
 */
export const CIRCLE_TONE_HEX: Readonly<Record<CircleTone, string>> = {
  moss: "#6fae52",   // Land
  sage: "#8fb573",
  teal: "#8ad0c0",   // Healing
  sky: "#7f9fd0",    // Learning
  amber: "#d0a94f",  // Community
  olive: "#b8b06a",  // Finance
  clay: "#c98b4e",   // Building
  ember: "#d0785a",  // Coordination
  rose: "#c96a8a",   // Gathering
  violet: "#a98ad0", // Wisdom
  stone: "#9aa08f",  // the artifact's own fallback hue
};

/**
 * WHAT IS ACTUALLY STORED IN `circles.color`, WHICH IS TWO DIFFERENT THINGS.
 *
 * `server/seeds/circles-seed.json` writes BARE TONE WORDS: sage, amber,
 * coral, rose, stone, teal, sky, emerald. The Admin panel writes TAILWIND
 * CLASSES, because `client/src/lib/swatch.ts` renders them: `bg-sage`,
 * `bg-teal-deep`, `bg-coral`. Both are live in the same column.
 *
 * PowerMap used to resolve that column through a four-entry lookup keyed by
 * bare words (sage, amber, coral, teal) with `?? var(--color-teal-deep)` on
 * the end. So of the eight seeded circles, four got their colour and four
 * (rose, stone, sky, emerald) fell silently to the fallback, along with
 * every circle a village had coloured through the admin form, because a
 * `bg-` class matched nothing. Seventeen circles, one grey.
 *
 * That is the `Record<string, T>` trap CLAUDE.md names: a hand-kept map
 * keyed by loose strings is a promise nobody checks. Keyed by the union, as
 * `CIRCLE_TONE_HEX` is, the compiler checks it instead.
 *
 * Lightness suffixes fold in, so a village that chose sage gets sage on
 * every surface whichever shade it picked.
 */
const TONE_BY_SWATCH: Readonly<Record<string, CircleTone>> = {
  // the seed's own words come first, because they are what is in the database
  sage: "sage", amber: "amber", coral: "ember", rose: "rose",
  stone: "stone", teal: "teal", sky: "sky", emerald: "moss",
  // and the rest of the swatch vocabulary the admin form can write
  forest: "moss", green: "moss", moss: "moss", olive: "olive", lime: "moss",
  aqua: "teal", cyan: "teal", mint: "teal", turquoise: "teal",
  blue: "sky", indigo: "sky", azure: "sky",
  gold: "amber", cream: "amber", yellow: "amber", sand: "olive",
  clay: "clay", orange: "clay", rust: "ember", ember: "ember", terracotta: "ember",
  pink: "rose", plum: "rose", magenta: "rose",
  violet: "violet", purple: "violet", lilac: "violet", lavender: "violet",
  grey: "stone", gray: "stone", slate: "stone", neutral: "stone",
};

export function toneForCircle(c: { id: string; color?: string | null }): CircleTone {
  const raw = String(c?.color ?? "").trim().toLowerCase();
  if (raw) {
    // `bg-teal-deep` becomes `teal`; a bare `sage` stays `sage`.
    const hue = raw
      .replace(/^bg-/, "")
      .replace(/-(light|lighter|deep|dark|darker|brand)$/, "");
    const hit = TONE_BY_SWATCH[hue] ?? TONE_BY_SWATCH[hue.split("-")[0] ?? ""];
    if (hit) return hit;
  }
  // Nothing declared, or a class this table does not know. A stable hash of
  // the ID, so the choice survives renames, re-ordering and a reload, and is
  // the same on every surface without being written down anywhere.
  let h = 0;
  const id = String(c?.id ?? "");
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CIRCLE_TONES[h % CIRCLE_TONES.length]!;
}

/** The hex a circle draws in, on the map and in the mini render. */
export function colourForCircle(c: { id: string; color?: string | null }): string {
  return CIRCLE_TONE_HEX[toneForCircle(c)];
}
