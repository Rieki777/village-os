/**
 * The crown bar's chips: what each one reads, and how a reading is drawn.
 *
 * Rye, deciding F29 (2026-10-02): "Mark them as examples and wire them to
 * admin where we can add in a label and a datasource (or we can expose a list
 * of datasources we have that it can pull from) and make them highly
 * customizable this way. Label as example - this label goes away once set."
 *
 * So the five numbers the map has always drawn (24 people, 62kg, 96, 76%,
 * 132) stay, marked as EXAMPLES, until a founder points a chip at something.
 * Three things live here so the server, the shell, the editor and the tests
 * cannot disagree about them:
 *
 *   1. STAT_SOURCES, the list of readings the server can count honestly from
 *      data it already keeps. A source nobody can compute is not on the list:
 *      the map may not invent, and a chip reading a guess is the defect F29
 *      named in the first place.
 *   2. The chips DOCUMENT and its sanitiser. An ordered list a founder edits in
 *      Village settings: label, icon, source, unit, format and an optional
 *      door. Its own app_config document, for the reason the vocabulary got
 *      one (server/index.ts, `mapVocabRepo`): it is a list the map owns, and
 *      folding it into `brand` would put it behind the Setup Wizard's
 *      read-modify-write, where a skin save could drop it.
 *   3. `resolveChips`, which turns the document plus the server's readings
 *      into what the map draws. Pure, so the route, the editor's preview and
 *      the tests all run the same function.
 *
 * WHAT "EXAMPLE" MEANS, in one place. A chip is an example when its source is
 * `none`, or `manual` with no value typed. The map then draws its own sample
 * for the five chips it has always carried and a dash for any other, and says
 * "example" on the chip. Any other source draws the reading and the word goes.
 */

/** The app_config key the chips document is stored under. */
export const MAP_CHIPS_DOC = "map_chips";

/**
 * How a save reaches an already-open map, the same two-signal shape the skin
 * uses (shared/mapSkin.ts): an event for this tab, a storage write for others.
 */
export const MAP_CHIPS_SAVED_EVENT = "map-chips-saved";
export const MAP_CHIPS_SAVED_KEY = "map.chipsSavedAt";

/**
 * How often an open map asks for fresh readings. A minute: the numbers move
 * when somebody gives gratitude or takes a seat, and a visitor watching the
 * bar for a minute is the longest anybody waits. The server holds each
 * reading for half that, so a village full of open maps costs one count per
 * source per half minute, whatever the number of visitors.
 */
export const MAP_CHIPS_REFRESH_MS = 60_000;
export const MAP_STATS_TTL_MS = 30_000;

/**
 * The bar holds six chips and the moon. On a phone the bar is the full width
 * of the screen and its labels are already hidden: seven cells at 390px are
 * 55px each, which a four-character reading fits and a fifth chip more would
 * not.
 */
export const MAX_MAP_CHIPS = 6;

// ── Icons ──────────────────────────────────────────────────────────────────

/**
 * The icons a chip may wear. Each is a single 24x24 stroke path, drawn by the
 * artifact from its own `VICON` table. The paths are kept here as well so the
 * editor can show a founder the icon they are choosing, and
 * shared/mapArtifactChips.test.ts holds the two copies equal.
 */
export const CHIP_ICON_PATHS = {
  people: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0z",
  food: "M12 2c1 4-3 5-3 9a3 3 0 006 0c0-4-4-5-3-9zM7 20h10",
  water: "M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z",
  canopy: "M12 3l7 8h-4l4 6H5l4-6H5l7-8zM12 17v4",
  hearts: "M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z",
  quests: "M6 21V4m0 0h10l-2 4 2 4H6",
  seats: "M7 4v9h10V4M5 13h14M7 13v7m10-7v7",
  circles: "M12 4a8 8 0 100 16 8 8 0 000-16zm0 4a4 4 0 100 8 4 4 0 000-8z",
  events: "M5 6h14v14H5zM5 10h14M9 3v5m6-5v5",
  leaf: "M5 19c0-8 5-14 14-14 0 9-6 14-14 14zm0 0l7-7",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
} as const;
export type ChipIcon = keyof typeof CHIP_ICON_PATHS;
export const CHIP_ICONS = Object.keys(CHIP_ICON_PATHS) as ChipIcon[];

/** What the editor calls each icon. Keyed by the union so a new icon cannot go unnamed. */
export const CHIP_ICON_NAMES: Record<ChipIcon, string> = {
  people: "People",
  food: "Harvest",
  water: "Water",
  canopy: "Tree",
  hearts: "Heart",
  quests: "Flag",
  seats: "Seat",
  circles: "Circle",
  events: "Calendar",
  leaf: "Leaf",
  star: "Star",
};

// ── Sources ────────────────────────────────────────────────────────────────

export const STAT_SOURCE_KEYS = [
  "members",
  "members_active",
  "quests_open",
  "quests_done_cycle",
  "quests_done_season",
  "gratitude_cycle",
  "seats_open",
  "circles",
  "gatherings_ahead",
  "trees_planted",
  "food_produced",
  "water_protected",
  "hectares_restored",
  "carbon_sequestered",
  "treasury",
] as const;
export type StatSourceKey = (typeof STAT_SOURCE_KEYS)[number];

/** How the editor's picker groups the sources, in the order it lists them. */
export const STAT_SOURCE_GROUPS = [
  "People",
  "Work",
  "Gratitude",
  "Roles and circles",
  "Calendar",
  "The land, from Village Health",
  "The treasury",
] as const;
export type StatSourceGroup = (typeof STAT_SOURCE_GROUPS)[number];

export interface StatSourceDef {
  group: StatSourceGroup;
  /** What the editor's picker calls it, and the label a new chip starts with. */
  label: string;
  /** The words under the number in the chip's drop-down. */
  sub: string;
  /** What is counted, said plainly. Shown in the drop-down and the editor. */
  how: string;
  /** The unit a new chip starts with. The founder can change it. */
  unit: string;
  icon: ChipIcon;
  /** The page a new chip's door starts pointing at. */
  link: string;
  /**
   * The module whose data this reads, or null for the core data every village
   * has. A source whose module this viewer cannot open is not drawn for them,
   * the same rule `/api/modules` applies to the module itself.
   */
  module: string | null;
  /**
   * Drawn only for a MEMBER: somebody signed in whom the village has let in
   * (`isAdmitted`, server/lib/admission.ts), or an admin. Stricter than a
   * module at `members`, which opens to any signed-in account, a guest
   * included. `sourceHiddenFrom` (server/lib/mapStats.ts) reads it before the
   * module rule, and a viewer it hides the chip from is never counted for.
   */
  membersOnly?: boolean;
}

/**
 * EVERY SOURCE HERE IS COUNTED FROM ROWS THE VILLAGE ALREADY KEEPS, and
 * server/lib/mapStats.ts is where each one is counted. One that was asked
 * about and is not here, and why:
 *
 *   crowdpool  Its totals belong to a remote hub, carry a currency each, and
 *              mean different things under the hub's two contract versions
 *              (server/lib/crowdpool.ts). One figure across campaigns would
 *              add currencies together.
 *
 * THE TREASURY, which was on that list, and what changed. Rye, 2026-10-05:
 * "Treasury balance shown to members only." It was left out because nothing
 * published a single-token figure: the health snapshot's `treasury_balance`
 * adds tokens of different kinds together, which is not a number a chip can
 * put a unit on, and it is NOT what this reads. This reads ONE account in ONE
 * token: `sys:treasury` (`TREASURY`, server/lib/ledger.ts), in the village's
 * value token, which is whatever token `gratitude.pool_token` names (`credits`
 * by default, drizzle/0007). That is the rule the economics code already
 * keeps for "the value token": the cycle close pays it, `/api/game/config`
 * publishes it as `currency.value`, and Journey to Launch's
 * `pool-token-spendable` check reads it. A token that dial names which is not
 * a platform token, or is recognition, gives no reading. The balance is the
 * ledger's own read (`balanceOf`), scaled by that token's own `decimals`
 * through `fromLedgerUnits`, and counted in WHOLE tokens with any fraction
 * left off, so the chip never shows more than the treasury holds. Whole
 * numbers for display is the house rule, and Rye's reason for it is written
 * beside the seeded amounts in server/lib/economySeed.ts (2026-08-11): whole
 * numbers read better on a chip than 0.1 does. Members only, by
 * `membersOnly` above.
 *
 * "This cycle" and not "this moon": a village can vote to keep a calendar
 * clock (`cycle.mode`), and the cycle is whichever the village keeps.
 */
export const STAT_SOURCES: Record<StatSourceKey, StatSourceDef> = {
  members: {
    group: "People",
    label: "Members",
    sub: "members",
    how: "Accounts in the village. Closed accounts and examples are not counted.",
    unit: "",
    icon: "people",
    link: "/team",
    module: null,
  },
  members_active: {
    group: "People",
    label: "Active",
    sub: "active this cycle",
    how: "Members who did something the village heard about since this cycle began.",
    unit: "",
    icon: "people",
    link: "/team",
    module: null,
  },
  quests_open: {
    group: "Work",
    label: "Open quests",
    sub: "quests open on the board",
    how: "Quests on the board that are not closed. Examples are not counted.",
    unit: "",
    icon: "quests",
    link: "/quests",
    module: null,
  },
  quests_done_cycle: {
    group: "Work",
    label: "Quests done",
    sub: "quests done this cycle",
    how: "Quest work the village consented to since this cycle began.",
    unit: "",
    icon: "quests",
    link: "/quests",
    module: null,
  },
  quests_done_season: {
    group: "Work",
    label: "Quests done",
    sub: "quests done this season",
    how: "Quest work the village consented to since the current season began.",
    unit: "",
    icon: "quests",
    link: "/quests",
    module: null,
  },
  gratitude_cycle: {
    group: "Gratitude",
    label: "Hearts",
    sub: "gratitude given this cycle",
    how: "Gratitude members gave since this cycle began, less anything taken back.",
    unit: "",
    icon: "hearts",
    link: "/gratitude",
    module: null,
  },
  seats_open: {
    group: "Roles and circles",
    label: "Open seats",
    sub: "seats waiting for someone",
    how: "Places on the village's live roles that nobody holds. A seat whose holder's term ran out counts as open.",
    unit: "",
    icon: "seats",
    link: "/roles",
    module: null,
  },
  circles: {
    group: "Roles and circles",
    label: "Circles",
    sub: "active and forming circles",
    how: "The village's circles that are active or forming. Dormant circles and examples are not counted.",
    unit: "",
    icon: "circles",
    link: "/circles",
    module: null,
  },
  gatherings_ahead: {
    group: "Calendar",
    label: "Gatherings",
    sub: "gatherings in the next 30 days",
    how: "Gatherings and festivals on the public calendar in the next 30 days, each date of a repeating one counted.",
    unit: "",
    icon: "events",
    link: "/events",
    module: "events",
  },
  trees_planted: {
    group: "The land, from Village Health",
    label: "Trees",
    sub: "trees planted",
    how: "Plantings the village's stewards recorded in Village Health, withdrawn readings left out.",
    unit: "",
    icon: "canopy",
    link: "/village-health",
    module: "health",
  },
  food_produced: {
    group: "The land, from Village Health",
    label: "Food",
    sub: "harvest recorded",
    how: "Harvest weighed and recorded in Village Health, withdrawn readings left out.",
    unit: "kg",
    icon: "food",
    link: "/village-health",
    module: "health",
  },
  water_protected: {
    group: "The land, from Village Health",
    label: "Water",
    sub: "liters of water protected",
    how: "Storage and springflow recorded in Village Health, withdrawn readings left out.",
    unit: "L",
    icon: "water",
    link: "/village-health",
    module: "health",
  },
  hectares_restored: {
    group: "The land, from Village Health",
    label: "Restoring",
    sub: "hectares in restoration",
    how: "Land under active regeneration, as recorded in Village Health.",
    unit: "ha",
    icon: "canopy",
    link: "/village-health",
    module: "health",
  },
  carbon_sequestered: {
    group: "The land, from Village Health",
    label: "Carbon",
    sub: "carbon sequestered",
    how: "Estimated sequestration from plantings and soil work, as recorded in Village Health.",
    unit: "kg",
    icon: "leaf",
    link: "/village-health",
    module: "health",
  },
  treasury: {
    group: "The treasury",
    label: "Treasury",
    // The reading says which token, by the name the registry gives it today
    // (server/lib/mapStats.ts). These words are for when it cannot.
    sub: "held in the village treasury",
    how: "What the village treasury holds of the token the cycle pool pays out, in whole tokens.",
    unit: "",
    icon: "star",
    // Where a member holds, sends and spends that token. Not Village Health:
    // its treasury figure adds tokens of different kinds together.
    link: "/wallet",
    module: null,
    membersOnly: true,
  },
};

/**
 * The Village Health metric each land source reads. Keyed by the source so
 * the compiler names one that is missing; the metric keys themselves are the
 * registry's (shared/healthMetrics.ts) and a test holds them to it.
 */
export const REGEN_SOURCE_METRIC = {
  trees_planted: "trees_planted",
  food_produced: "food_produced_kg",
  water_protected: "water_protected_liters",
  hectares_restored: "hectares_restored",
  carbon_sequestered: "carbon_sequestered_kg",
} as const;
export type RegenSourceKey = keyof typeof REGEN_SOURCE_METRIC;

export function isStatSource(v: unknown): v is StatSourceKey {
  return typeof v === "string" && (STAT_SOURCE_KEYS as readonly string[]).includes(v);
}

// ── The document ──────────────────────────────────────────────────────────

export type ChipSource = StatSourceKey | "manual" | "none";
export const CHIP_FORMATS = ["compact", "full"] as const;
export type ChipFormat = (typeof CHIP_FORMATS)[number];

export interface MapChip {
  /** Stable, and what the map keys the chip's drop-down on. */
  id: string;
  label: string;
  icon: ChipIcon;
  source: ChipSource;
  /** Written after the number exactly as typed: "kg" draws 62kg. */
  unit: string;
  format: ChipFormat;
  /** A page on this site the chip's drop-down offers a door to, or blank. */
  link: string;
  /** Only read when `source` is manual: the founder's number and its date. */
  manual: { value: string; asOf: string } | null;
}

export interface MapChipsDoc {
  chips: MapChip[];
}

/**
 * The five chips the map has always drawn, every one an example. These ids
 * are the artifact's own keys (`SCENE.vitals`), which is what lets an unset
 * chip keep drawing the sample the map has for it.
 */
export const LEGACY_CHIP_IDS = ["people", "food", "water", "canopy", "hearts"] as const;

const example = (id: (typeof LEGACY_CHIP_IDS)[number], label: string): MapChip => ({
  id,
  label,
  icon: id,
  source: "none",
  unit: "",
  format: "compact",
  link: "",
  manual: null,
});

export const DEFAULT_MAP_CHIPS: MapChip[] = [
  example("people", "People"),
  example("food", "Food"),
  example("water", "Water"),
  example("canopy", "Canopy"),
  example("hearts", "Hearts"),
];

/** Printable text only, trimmed and clipped. Markup is the map's to escape. */
function text(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
/**
 * A page on this site: one leading slash, then lowercase words. No query, no
 * host, no second slash at the start. The map draws the door only when the
 * page is one the site serves (its `realRoute`), so a typo is a chip with no
 * door, never a door to somewhere else.
 */
const LINK = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date that exists, written YYYY-MM-DD. */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A fresh id for a chip a founder adds, unlike every id already in `taken`. */
export function freshChipId(base: string, taken: readonly string[]): string {
  // Split and join in one linear pass. A replace that trims dashes from both
  // ends is the polynomial pattern CodeQL flagged in orgChart.ts.
  const words = String(base).toLowerCase().slice(0, 64).split(/[^a-z0-9]+/).filter(Boolean);
  const joined = words.join("-").slice(0, 24);
  const stem = (joined.endsWith("-") ? joined.slice(0, -1) : joined) || "chip";
  if (!taken.includes(stem)) return stem;
  for (let n = 2; ; n += 1) {
    const id = `${stem}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

/**
 * Coerce anything into a chips document the map can be handed.
 *
 * Rebuilt field by field, like the skin, so nothing a client invents reaches
 * storage. Unknown sources fall back to `none` (an example) and unknown icons
 * to the source's own, so a document written by a newer platform still draws
 * on an older one instead of failing the read.
 *
 * NO DOCUMENT IS DIFFERENT FROM AN EMPTY ONE. An absent or unreadable list
 * gives the five example chips, which is what a fresh fork should show. An
 * empty list a founder saved on purpose is kept empty: a village may decide
 * its bar carries the moon and nothing else.
 */
export function sanitiseMapChips(input: unknown): MapChipsDoc {
  const raw = (input ?? {}) as { chips?: unknown };
  if (!Array.isArray(raw.chips)) return { chips: DEFAULT_MAP_CHIPS.map((c) => ({ ...c })) };
  const out: MapChip[] = [];
  const taken: string[] = [];
  for (const entry of raw.chips) {
    if (out.length >= MAX_MAP_CHIPS) break;
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    const source: ChipSource =
      c.source === "manual" || c.source === "none" ? c.source : isStatSource(c.source) ? c.source : "none";
    const def = isStatSource(source) ? STAT_SOURCES[source] : null;
    const label = text(c.label, 24) || def?.label || "Reading";
    const askedId = typeof c.id === "string" && ID.test(c.id) ? c.id : "";
    const id = askedId && !taken.includes(askedId) ? askedId : freshChipId(askedId || label, taken);
    taken.push(id);
    const icon: ChipIcon = (CHIP_ICONS as readonly string[]).includes(String(c.icon))
      ? (c.icon as ChipIcon)
      : def?.icon ?? "star";
    const askedLink = typeof c.link === "string" ? c.link.trim() : "";
    const link = askedLink.length <= 64 && LINK.test(askedLink) ? askedLink : "";
    const m = (c.manual ?? null) as Record<string, unknown> | null;
    const manual =
      source === "manual" && m && typeof m === "object"
        ? { value: text(m.value, 16), asOf: isDay(m.asOf) ? m.asOf : "" }
        : null;
    out.push({
      id,
      label,
      icon,
      source,
      unit: text(c.unit, 8),
      format: c.format === "full" ? "full" : "compact",
      link,
      manual,
    });
  }
  return { chips: out };
}

/**
 * A chip pointed at a new source, keeping whatever the founder made their own.
 *
 * A label, icon or door that still reads the old source's default (or is
 * blank) follows the new source; one the founder typed stays theirs. The unit
 * always follows, because a unit belongs to what is counted: trees are not
 * kilograms. `day` is the date a new typed number starts out true on.
 */
export function chipWithSource(chip: MapChip, next: ChipSource, day: string): MapChip {
  const prev = isStatSource(chip.source) ? STAT_SOURCES[chip.source] : null;
  const def = isStatSource(next) ? STAT_SOURCES[next] : null;
  function followed<T>(current: T, oldDefault: T | undefined, newDefault: T | undefined, blank: T): T {
    return newDefault !== undefined && (current === blank || current === oldDefault) ? newDefault : current;
  }
  return {
    ...chip,
    source: next,
    label: followed(chip.label, prev?.label, def?.label, ""),
    icon: followed<ChipIcon>(chip.icon, prev?.icon, def?.icon, "star"),
    unit: def ? def.unit : next === "manual" ? chip.unit : "",
    link: followed(chip.link, prev?.link, def?.link, ""),
    manual: next === "manual" ? chip.manual ?? { value: "", asOf: isDay(day) ? day : "" } : null,
  };
}

// ── Readings and what the map draws ───────────────────────────────────────

/**
 * One source counted by the server, or the reason it could not be.
 *
 * `sub`, when a count carries it, replaces the source's own words under the
 * number. The treasury's does, to name its token as the registry calls it
 * today; a static string here could not follow a rename.
 */
export type StatReading =
  | { ok: true; n: number; countedAt: string; sub?: string }
  | { ok: false; why: string };

export type ChipState = "live" | "manual" | "example" | "unavailable";

/** A chip, resolved: exactly what the map draws for it. */
export interface ResolvedChip {
  id: string;
  label: string;
  icon: ChipIcon;
  state: ChipState;
  /** The reading as drawn, unit included. Null for an example: the map draws its own. */
  value: string | null;
  sub: string;
  how: string;
  /** The day a manual number was true, or blank. */
  asOf: string;
  /** When a live reading was counted, ISO, or blank. */
  countedAt: string;
  link: string;
  source: ChipSource;
  /** Why an unavailable chip is not drawn. Editor only; the public read drops these chips. */
  why?: string;
}

/**
 * The number as the bar draws it.
 *
 * `compact` keeps a reading short enough for a phone's bar: 12,400 becomes
 * 12.4k. A unit that is a word gets a space after a compacted number, so
 * 12.4k kg does not read as one run of letters; a symbol (% or ♥) never does.
 */
export function formatStat(n: number, format: ChipFormat, unit: string): string {
  const finite = Number.isFinite(n) ? n : 0;
  const whole = (v: number, digits: number) =>
    v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  let num = whole(Math.round(finite * 10) / 10, 1);
  let compacted = false;
  const abs = Math.abs(finite);
  if (format === "compact" && abs >= 10_000) {
    const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : [1e3, "k"];
    const scaled = Math.round((finite / div) * 10) / 10;
    num = `${whole(scaled, 1)}${suffix}`;
    compacted = true;
  }
  if (!unit) return num;
  return compacted && /^[A-Za-z]/.test(unit) ? `${num} ${unit}` : `${num}${unit}`;
}

/** A date the way the drop-down says it: 3 Oct 2026. */
export function sayDay(day: string): string {
  if (!isDay(day)) return "";
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The sources a list of chips needs counted, each once. */
export function neededSources(chips: readonly MapChip[]): StatSourceKey[] {
  const out: StatSourceKey[] = [];
  for (const c of chips) if (isStatSource(c.source) && !out.includes(c.source)) out.push(c.source);
  return out;
}

/**
 * The chips as the map draws them.
 *
 * `readings` holds what the server counted for THIS viewer. A source with no
 * reading, or a reading that failed, makes the chip unavailable: it is not
 * drawn at all, because a chip the founder pointed at a source must never fall
 * back to the sample it replaced. The example label is for chips nobody has
 * set, and a set chip that cannot be read for this viewer is a different
 * fact.
 */
export function resolveChips(
  chips: readonly MapChip[],
  readings: Partial<Record<StatSourceKey, StatReading>>,
): ResolvedChip[] {
  return chips.map((c) => {
    const base = {
      id: c.id,
      label: c.label,
      icon: c.icon,
      link: c.link,
      source: c.source,
      asOf: "",
      countedAt: "",
    };
    if (c.source === "manual" && c.manual && c.manual.value) {
      const day = sayDay(c.manual.asOf);
      return {
        ...base,
        state: "manual" as const,
        value: `${c.manual.value}${c.unit}`,
        sub: day ? `as of ${day}` : "set by the founder",
        how: day
          ? `Set by the founder in Village settings. True as of ${day}.`
          : "Set by the founder in Village settings.",
        asOf: c.manual.asOf,
      };
    }
    if (!isStatSource(c.source)) {
      return {
        ...base,
        state: "example" as const,
        value: null,
        sub: "",
        how: "An example. The founder has not chosen what this chip reads yet.",
      };
    }
    const def = STAT_SOURCES[c.source];
    const r = readings[c.source];
    if (!r || !r.ok) {
      return {
        ...base,
        state: "unavailable" as const,
        value: null,
        sub: def.sub,
        how: def.how,
        why: r && !r.ok ? r.why : "Not counted for this viewer.",
      };
    }
    return {
      ...base,
      state: "live" as const,
      value: formatStat(r.n, c.format, c.unit),
      sub: r.sub || def.sub,
      how: def.how,
      countedAt: r.countedAt,
    };
  });
}
