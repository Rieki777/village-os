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

/** The raw hex a circle draws in. For SVG export, tests and anything that
 *  is not painted by a browser that could carry a village's theme. */
export function colourForCircle(c: { id: string; color?: string | null }): string {
  return CIRCLE_TONE_HEX[toneForCircle(c)];
}

/**
 * THE SAME COLOUR, THEMEABLE, FOR ANYTHING A BROWSER PAINTS.
 *
 * `scripts/check-theme-literals.mjs` is a CI gate (one CLAUDE.md's list does
 * not mention) and it is right: a founder's colour compiled into a `.tsx`
 * cannot be re-themed by a fork, and this platform is white-label. Its
 * sanctioned escape is exactly this shape, `var(--token, #fallback)`, which
 * `CircleScene`, `MoonGlyph`, `YearWheel` and `MobileFab` all already use.
 *
 * So the eleven hues ship as DEFAULTS a village can override, one variable
 * each, declared in `client/src/index.css`. An untouched deployment draws
 * the living map's palette; a village that wants its own sets eleven
 * variables and both lenses move together, because both call this.
 *
 * A categorical palette is a different thing from a brand colour: its job is
 * to keep eleven circles apart, so shipping eleven greys would be shipping
 * the bug this palette was added to fix.
 */
export function cssColourForCircle(c: { id: string; color?: string | null }): string {
  const tone = toneForCircle(c);
  return `var(--circle-${tone}, ${CIRCLE_TONE_HEX[tone]})`;
}

// ── Containment, and the loop that used to erase the village ────────────────
//
// `parent_circle_id` is the only column that says which circle holds which,
// and until the org editor it had exactly one check: a circle may not parent
// ITSELF. Two circles parenting each other passed, and the layout then found
// no root to start from and drew an empty ring. A member's whole map went
// blank with nothing logged anywhere.
//
// `shared/mapLayout.ts` now degrades instead of blanking, which is the safety
// net. This is the other half: a write that would close a loop is REFUSED,
// so the net never has to catch anything. The refusal names the circles in
// the loop, because "invalid parent" tells a founder nothing about which of
// their fourteen circles to go and fix.

/** The minimum a cycle check needs, so importers and drafts can call it too. */
export interface CircleLink {
  id: string;
  parentCircleId?: string | null;
}

/**
 * The chain of parents above `id`, nearest first, stopping at the first
 * circle already seen. The stop is what makes this safe to call on data that
 * is ALREADY looping, which every importer has to do.
 */
export function ancestorIds(circles: CircleLink[], id: string): string[] {
  const byId = new Map(circles.map((c) => [c.id, c]));
  const chain: string[] = [];
  const seen = new Set<string>([id]);
  let at = byId.get(id)?.parentCircleId ?? null;
  while (at && byId.has(at) && !seen.has(at)) {
    chain.push(at);
    seen.add(at);
    at = byId.get(at)?.parentCircleId ?? null;
  }
  return chain;
}

/**
 * The loop `childId -> parentId` would create, or null if the move is fine.
 *
 * Returns the circles in the loop, child first, so a caller can say "Finance
 * is already inside Business, which is inside Finance" instead of "invalid".
 * `parentId` null or unknown is always fine: unparenting cannot loop.
 */
export function cycleFromParenting(
  circles: CircleLink[],
  childId: string,
  parentId: string | null | undefined,
): string[] | null {
  if (!parentId) return null;
  if (parentId === childId) return [childId];
  if (!circles.some((c) => c.id === parentId)) return null;
  // Walking UP from the proposed parent: meeting the child means the child
  // is already above it, so hanging the parent's subtree under the child
  // closes the loop.
  const above = ancestorIds(circles, parentId);
  const hit = above.indexOf(childId);
  if (hit === -1) return null;
  return [childId, parentId, ...above.slice(0, hit)];
}

/**
 * The whole refusal body for a parenting move, or null when the move is fine.
 *
 * Lives here rather than in the route so the SENTENCE is testable without
 * booting a server, and so the org editor can say the same words before the
 * drag lands as the server says when it refuses.
 */
export function parentCycleRefusal(
  circles: Array<CircleLink & { name?: string }>,
  childId: string,
  parentId: string | null | undefined,
): { error: string; message: string; circles: string[] } | null {
  const loop = cycleFromParenting(circles, childId, parentId);
  if (!loop) return null;
  const nameOf = (id: string) => String(circles.find((c) => c.id === id)?.name ?? id);
  return {
    error: "circle_parent_cycle",
    message:
      loop.length === 1
        ? "A circle cannot be inside itself."
        : `That would put ${nameOf(loop[0])} inside ${loop.slice(1).map(nameOf).join(", which is inside ")}, which is already inside ${nameOf(loop[0])}.`,
    circles: loop,
  };
}

/**
 * Every circle whose parent link sits on a loop, for a batch write nobody
 * can check row by row: an import, a seed, a whole-tree draft. A caller
 * either refuses the batch or nulls these parents, and both are honest.
 */
export function circlesOnCycles(circles: CircleLink[]): string[] {
  const byId = new Map(circles.map((c) => [c.id, c]));
  const bad = new Set<string>();
  for (const c of circles) {
    // `seen` starts holding the circle itself, so a self-parent is caught by
    // the same line that catches a longer loop.
    const seen = new Set<string>([c.id]);
    let at = c.parentCircleId ?? null;
    while (at && byId.has(at)) {
      if (seen.has(at)) { bad.add(c.id); break; }
      seen.add(at);
      at = byId.get(at)?.parentCircleId ?? null;
    }
  }
  return Array.from(bad).sort();
}

/**
 * The map lens's own ground, ring and ink.
 *
 * The circles surface is the map's world (dark ground, parchment ink) the
 * way the artifact is, and these three carry that through the same themeable
 * shape as the hues above.
 */
export const MAP_CHROME = {
  ground: "var(--circle-ground, #131a11)",
  ring: "var(--circle-ring, #8fb573)",
  ink: "var(--circle-ink, #e8dcbc)",
  inkDim: "var(--circle-ink-dim, #a8a081)",
  /** The scrim under the invitation on the mini render. */
  scrim: "linear-gradient(to top, var(--circle-scrim, rgba(19,26,17,.95)), transparent)",
} as const;
