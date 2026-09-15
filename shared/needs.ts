/**
 * The ten human needs, one vocabulary (R1, R18, R20; lane N1).
 *
 * THE WORD "NEEDS" IS ALREADY TAKEN ON SCREEN, so everything exported here is
 * qualified. `CrowdpoolNeed` in server/lib/crowdpool.ts is read-only mirror
 * data proxied from an external hub, and the page it feeds prints "The needs
 * shelf". That object carries a capital type, an estimated value and a pledge
 * meter. This file carries none of those. The two can appear on one admin
 * panel, so the human one is `HUMAN_NEEDS` and the table it scopes is
 * `village_needs`. A reader who sees a bare `Need` type is reading the pool.
 *
 * WHY A SHARED FILE AND NOT A TABLE. The taxonomy is platform copy, the same
 * way `shared/capitals.ts` and `shared/healthMetrics.ts` are, and this file is
 * modelled on the first of those down to the `label` / `formal` / `hue` split.
 * A rename here reaches every surface at once, and a village that disagrees
 * adds a CUSTOM need to `village_needs` instead of editing platform data. What
 * a village takes on is a row; what the platform offers is this list.
 *
 * WHERE THE WORDS COME FROM. `PART 2 NEEDS`, the founder's own deck, which
 * prints the table twice. The second pass is the clean one and is what is
 * copied here, character for character, including the trailing "etc" that says
 * each list is open. The first pass has the same ten needs with three of the
 * labels shifted one row against their expressions ("Self-Expression" heading
 * Significance's row, "Stability" heading Routine's, "Contribution &
 * Community" for Contribution), which is a rendering fault in the slide rather
 * than a second taxonomy. `shared/needs.test.ts`'s sibling,
 * `server/lib/needs.test.ts`, quotes the deck rows it asserts against.
 *
 * `hue` follows the capitals precedent: an Okabe-Ito-derived set that stays
 * distinguishable under the common colour blindnesses. Colour never stands
 * alone; `label` is the short word a chip shows and `formal` is the long name
 * a tooltip says.
 */

export interface HumanNeedDef {
  /** Stable id. Never renamed: it is written into `village_needs.need_key`. */
  id: string;
  /** The short word a chip or a tick row shows. The deck's own heading. */
  label: string;
  /** The long name a tooltip says, lowercase on purpose: it lands mid-sentence. */
  formal: string;
  /**
   * The deck's own expressions for this need, split on its commas.
   *
   * The last element is the deck's "etc", kept because it is the deck's word
   * and because it says the list is open. `expressionsLine` joins the array
   * back into the deck's row, so there is ONE source for both the chips and
   * the hint line and the two can never disagree.
   */
  expressions: string[];
  /** One hex colour, shared by every surface that draws this need. */
  hue: string;
}

export const HUMAN_NEEDS: HumanNeedDef[] = [
  {
    id: "vitality",
    label: "Vitality & Survival Needs",
    formal: "vitality and survival",
    expressions: ["Clean Air", "Organic Food", "Living Water", "Exercise", "Natural Shelter", "etc"],
    hue: "#009E73",
  },
  {
    id: "significance",
    label: "Significance",
    formal: "significance and self-expression",
    expressions: ["Self-Expression", "Meaning", "Validation", "Feeling Wanted", "Purpose", "etc"],
    hue: "#E69F00",
  },
  {
    id: "love",
    label: "Love",
    formal: "love",
    expressions: [
      "Connection",
      "Communication",
      "Intimacy",
      "Interdependence",
      "Authentic Community",
      "Family",
      "etc",
    ],
    hue: "#CC79A7",
  },
  {
    id: "growth",
    label: "Growth",
    formal: "growth",
    expressions: ["Physical", "Emotional", "Intellectual and Spiritual Development", "etc"],
    hue: "#56B4E9",
  },
  {
    id: "contribution",
    label: "Contribution",
    formal: "contribution and community",
    expressions: ["Effectiveness", "To Give", "Care", "and Serve an Idea Greater Than Myself", "etc"],
    hue: "#0072B2",
  },
  {
    id: "routine",
    label: "Routine",
    formal: "routine and stability",
    expressions: ["Consistency", "Stability", "Grounding", "etc"],
    hue: "#946B2D",
  },
  {
    id: "diversity",
    label: "Diversity",
    formal: "diversity",
    expressions: ["Variety", "Adventure", "Challenge", "Surprise", "etc"],
    hue: "#8B7DD8",
  },
  {
    id: "autonomy",
    label: "Autonomy",
    formal: "autonomy",
    expressions: ["Freedom", "Space", "Independence", "etc"],
    hue: "#33BBC5",
  },
  {
    id: "play",
    label: "Play",
    formal: "play",
    expressions: ["Joy", "Humor", "Passion", "Creativity", "etc"],
    hue: "#F0E442",
  },
  {
    id: "honesty",
    label: "Honesty",
    formal: "honesty",
    expressions: ["Authenticity", "Integrity", "Presence", "etc"],
    hue: "#D55E00",
  },
];

export const HUMAN_NEEDS_BY_ID: Record<string, HumanNeedDef> = Object.fromEntries(
  HUMAN_NEEDS.map((n) => [n.id, n]),
);

/** The deck's row for one need, rebuilt from its own words. */
export function expressionsLine(need: HumanNeedDef): string {
  return need.expressions.join(", ");
}

/**
 * The deck's depth ladder, lowest rung first. THE ORDER IS THE COMPARISON.
 *
 * The deck prints it top to bottom as Thriving, Satisfied, Alive, Unmet,
 * Deprived, against an axis labelled "Depth of Needs to Meet". Reversed here
 * so that a higher index is further along, because "at the Satisfied level or
 * better" is the sentence the summary screen has to say and it is an index
 * comparison. A five-value enum with no order would force every caller to
 * re-derive the ordering, and one of them would get it wrong.
 */
export const NEED_DEPTHS = ["deprived", "unmet", "alive", "satisfied", "thriving"] as const;
export type NeedDepth = (typeof NEED_DEPTHS)[number];

/**
 * What each rung is called on screen.
 *
 * Keyed by the union, never `Record<string, string>`: a rung added to
 * `NEED_DEPTHS` without a label here is a compiler error instead of a blank
 * space where a word belonged. See the mirror-annotation trap in CLAUDE.md.
 */
export const NEED_DEPTH_LABELS: Record<NeedDepth, string> = {
  deprived: "Deprived",
  unmet: "Unmet",
  alive: "Alive",
  satisfied: "Satisfied",
  thriving: "Thriving",
};

/** True when `has` is at `target` or further along the ladder. */
export function depthAtLeast(has: NeedDepth, target: NeedDepth): boolean {
  return NEED_DEPTHS.indexOf(has) >= NEED_DEPTHS.indexOf(target);
}

/** True for a string that is one of the five rungs. */
export function isNeedDepth(value: unknown): value is NeedDepth {
  return typeof value === "string" && (NEED_DEPTHS as readonly string[]).includes(value);
}

/**
 * What a village's own need is keyed by.
 *
 * A CUSTOM NEED CAN NEVER TAKE A PLATFORM ID. The prefix is the whole
 * mechanism: `custom:` is not a legal character sequence in any platform id,
 * so the two key spaces cannot collide however a village names its need. If
 * they could, a fork writing a need called "love" would silently inherit the
 * platform's label, hue and expressions on every surface that looks one up,
 * and a later platform rename would rewrite what that village said it was for.
 */
export const CUSTOM_NEED_PREFIX = "custom:";

/** True for a key that names one of the ten needs above. */
export function isPlatformNeedKey(key: string): boolean {
  return Object.hasOwn(HUMAN_NEEDS_BY_ID, key);
}

/** True for a key in the village's own space. */
export function isCustomNeedKey(key: string): boolean {
  return key.startsWith(CUSTOM_NEED_PREFIX);
}

/**
 * The slug half of a custom need's key. Lowercase, hyphenated, never empty.
 *
 * Clipped to 50 characters so the whole key stays inside
 * `village_needs.need_key`, which is varchar(64). Strict MySQL turns an
 * over-long field into a LOST ROW, so the clip happens here and not at the
 * insert.
 */
export function customNeedKey(name: string): string {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return `${CUSTOM_NEED_PREFIX}${slug || "unnamed"}`;
}

/**
 * Why this key may not be written, or null when it may.
 *
 * Every scope write goes through this, so the rule lives in one place and the
 * route, the store and any later importer all refuse the same things in the
 * same words.
 */
export function needKeyProblem(key: unknown): string | null {
  if (typeof key !== "string" || !key.trim()) return "A need needs a key.";
  const k = key.trim();
  if (k.length > 64) return "That key is too long. 64 characters is the limit.";
  if (isPlatformNeedKey(k)) return null;
  if (!isCustomNeedKey(k)) {
    return `"${k}" is not one of the ten needs. A need this list does not name is keyed "${CUSTOM_NEED_PREFIX}<name>".`;
  }
  const slug = k.slice(CUSTOM_NEED_PREFIX.length);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return "A custom need's name is lowercase letters, digits and hyphens.";
  }
  if (isPlatformNeedKey(slug)) {
    // Belt and braces. `custom:love` is already a different key from `love`
    // because of the prefix, so this refusal is about the confusion on screen
    // and not about a collision in the table.
    return `"${slug}" is one of the ten needs. Tick it in the list instead of writing your own.`;
  }
  return null;
}

/**
 * The label to store for a key, given what the caller typed.
 *
 * A platform need's label is COPIED from the taxonomy at adoption and stored
 * on the row. A later platform rename must not silently rewrite what a village
 * said it was for, which is the same reasoning `exitPolicy.ts` uses when it
 * refuses to let a village publish platform words as its own. Clipped to 120
 * characters, the width of `village_needs.label`.
 */
export function needLabelFor(key: string, typed?: string | null): string {
  const given = String(typed ?? "").trim();
  if (given) return given.slice(0, 120);
  const platform = HUMAN_NEEDS_BY_ID[key];
  if (platform) return platform.label;
  return key.slice(CUSTOM_NEED_PREFIX.length).replace(/-/g, " ").slice(0, 120) || key.slice(0, 120);
}

/** What a need link may be tagged onto. The enum in `need_links.subject_type`. */
export const NEED_SUBJECTS = ["quest", "role", "sink", "stay", "event", "place"] as const;
export type NeedSubject = (typeof NEED_SUBJECTS)[number];

/**
 * How much of the need one tagged thing carries.
 *
 * Two words and not a number, because a percentage on a tag invites arithmetic
 * nobody has agreed on. "Primary" says this alone meets the need. "Partial"
 * says it helps. That is the only distinction the test run asks for: whether a
 * need has something that meets it, or has nothing but a helping hand.
 */
export const NEED_WEIGHTS = ["primary", "partial"] as const;
export type NeedWeight = (typeof NEED_WEIGHTS)[number];

export function isNeedSubject(value: unknown): value is NeedSubject {
  return typeof value === "string" && (NEED_SUBJECTS as readonly string[]).includes(value);
}

export function isNeedWeight(value: unknown): value is NeedWeight {
  return typeof value === "string" && (NEED_WEIGHTS as readonly string[]).includes(value);
}
