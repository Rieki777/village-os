/**
 * A SEASON FILE: the week map a village lays over the governance canvas
 * (2026-09-26).
 *
 * The platform ships the FORMAT and nothing else. Which weeks a village meets
 * in, and which canvas blocks each one works on, belongs to whoever runs the
 * season: a cohort programme hands its founders a file, a village writes its
 * own, and a village with no file sees the blocks in canvas order. The file is
 * loaded by hand from the Canvas view and stored as the `canvas-season`
 * document in `app_config`, so it works the same on a self-hosted instance
 * with no outside service at all. `docs/seasons/` holds a template.
 *
 * ── IT ORDERS, IT NEVER GATES ──────────────────────────────────────────────
 *
 * A season decides which cards come FIRST on the Canvas view. It hides none,
 * locks none and marks none as late. `orderBlocks` below returns all twelve
 * blocks every time, whatever the file says, and a test holds it to that.
 * The Birthing gate reads the canvas readings; it never reads this file.
 *
 * ── ONE VALIDATOR, FOR THE ROUTE AND THE FORM ──────────────────────────────
 *
 * Isomorphic like shared/governanceCanvas.ts, so the Canvas view checks a
 * pasted file with exactly the words the server would refuse it in, before
 * anything is sent. The server runs it again on the PUT and on every read of
 * the stored document, because a stored document is only as good as the last
 * thing that wrote it.
 *
 * ── THE SHAPE ──────────────────────────────────────────────────────────────
 *
 *   { id, name, timezone, sessionTime?, description?,
 *     weeks: [{ number, date, title, blocks[], foundations[], tools[],
 *               showcaseAsk, actions[] }],
 *     moons: [{ date, blocks[], note }] }
 *
 * `date` is a calendar date, `YYYY-MM-DD`, in the season's own timezone. The
 * current week is worked out in that timezone too, so a session on a Saturday
 * in California starts on Saturday for everybody reading the page.
 *
 * A field the format does not know is left out of what is stored and named in
 * `ignored`, rather than refusing the whole file: a file written for a newer
 * release still loads on an older one, and the person loading it is told what
 * this release did not keep.
 */
import {
  CANVAS_BLOCK_IDS,
  CANVAS_BLOCKS,
  CANVAS_FOUNDATIONS,
  isCanvasBlockId,
  type CanvasBlock,
  type CanvasBlockId,
  type CanvasFoundation,
} from "./governanceCanvas";

/** The `app_config` key the village's chosen season is stored under. */
export const CANVAS_SEASON_KEY = "canvas-season";

/** The limits a season file is held to. Each one is named in its refusal. */
export const SEASON_LIMITS = {
  weeks: 60,
  moons: 60,
  weekNumber: 99,
  idLength: 64,
  name: 120,
  description: 500,
  title: 120,
  showcaseAsk: 400,
  tools: 8,
  tool: 160,
  actions: 8,
  action: 400,
  note: 400,
  /** The whole file, as JSON text. */
  fileCharacters: 128_000,
} as const;

export interface CanvasSeasonWeek {
  /** The session's number in the season, as the season names it. */
  number: number;
  /** `YYYY-MM-DD`, in the season's timezone. */
  date: string;
  title: string;
  /** The blocks this week works on, in the order it works on them. Its focus. */
  blocks: CanvasBlockId[];
  foundations: CanvasFoundation[];
  tools: string[];
  /** What the week asks a project to show. Empty when the week asks nothing. */
  showcaseAsk: string;
  actions: string[];
}

export interface CanvasSeasonMoon {
  /** `YYYY-MM-DD`, in the season's timezone. */
  date: string;
  /** The blocks a canvas moon looks at again. Empty means any block that moved. */
  blocks: CanvasBlockId[];
  note: string;
}

export interface CanvasSeason {
  id: string;
  name: string;
  /** An IANA zone, such as `America/Los_Angeles`. */
  timezone: string;
  /** `HH:MM` on each session's date, in the season's timezone. Absent when the file names no time. */
  sessionTime?: string;
  description?: string;
  weeks: CanvasSeasonWeek[];
  moons: CanvasSeasonMoon[];
}

export type SeasonParse =
  | { ok: true; season: CanvasSeason; ignored: string[] }
  | { ok: false; errors: string[] };

const KNOWN_TOP = ["id", "name", "timezone", "sessionTime", "description", "weeks", "moons"];
const KNOWN_WEEK = ["number", "date", "title", "blocks", "foundations", "tools", "showcaseAsk", "actions"];
const KNOWN_MOON = ["date", "blocks", "note"];

/** More refusals than this and the list stops: a person fixes the first ones first. */
const MAX_ERRORS = 12;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A real calendar date written `YYYY-MM-DD`, between 2000 and 2100. 2026-02-30 is not one. */
export function isSeasonDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** A timezone this runtime can actually compute in. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * THE ONE VALIDATOR. Takes whatever was pasted, chosen or stored, and returns
 * the season ready to store, or every sentence that refuses it (up to a
 * dozen), each naming where the problem is.
 */
export function parseCanvasSeason(input: unknown): SeasonParse {
  const errors: string[] = [];
  const ignored: string[] = [];
  const fail = (e: string) => {
    if (errors.length < MAX_ERRORS) errors.push(e);
  };

  let size = 0;
  try {
    size = JSON.stringify(input ?? null).length;
  } catch {
    return { ok: false, errors: ["The season file could not be read as JSON."] };
  }
  if (size > SEASON_LIMITS.fileCharacters) {
    return {
      ok: false,
      errors: [`A season file is kept under ${SEASON_LIMITS.fileCharacters.toLocaleString("en-US")} characters, and this one is longer.`],
    };
  }
  if (!isRecord(input)) {
    return { ok: false, errors: ["A season file is one JSON object, with an id, a name, a timezone and its weeks."] };
  }

  for (const k of Object.keys(input)) if (!KNOWN_TOP.includes(k)) ignored.push(k);

  const text = (value: unknown, where: string, max: number, required: boolean): string => {
    if (value === undefined || value === null) {
      if (required) fail(`${where} is missing.`);
      return "";
    }
    if (typeof value !== "string") {
      fail(`${where} must be text.`);
      return "";
    }
    const t = value.trim();
    if (required && !t) fail(`${where} is empty.`);
    if (t.length > max) fail(`${where} is longer than ${max} characters.`);
    return t;
  };

  const list = (value: unknown, where: string, max: number, eachMax: number): string[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      fail(`${where} must be a list.`);
      return [];
    }
    if (value.length > max) fail(`${where} holds more than ${max} entries.`);
    const out: string[] = [];
    value.forEach((v, i) => {
      const t = text(v, `${where}, entry ${i + 1},`, eachMax, true);
      if (t) out.push(t);
    });
    return out;
  };

  const blocks = (value: unknown, where: string): CanvasBlockId[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      fail(`${where} must be a list of canvas block ids.`);
      return [];
    }
    const out: CanvasBlockId[] = [];
    for (const b of value) {
      if (!isCanvasBlockId(b)) {
        fail(`${where}: "${String(b).slice(0, 40)}" is not one of the twelve canvas blocks (${CANVAS_BLOCK_IDS.join(", ")}).`);
      } else if (!out.includes(b)) {
        out.push(b);
      }
    }
    return out;
  };

  const foundations = (value: unknown, where: string): CanvasFoundation[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      fail(`${where} must be a list of foundation ids.`);
      return [];
    }
    const out: CanvasFoundation[] = [];
    for (const f of value) {
      if (typeof f !== "string" || !(CANVAS_FOUNDATIONS as readonly string[]).includes(f)) {
        fail(`${where}: "${String(f).slice(0, 40)}" is not a canvas foundation (${CANVAS_FOUNDATIONS.join(", ")}).`);
      } else if (!out.includes(f as CanvasFoundation)) {
        out.push(f as CanvasFoundation);
      }
    }
    return out;
  };

  const date = (value: unknown, where: string): string => {
    if (!isSeasonDate(value)) {
      fail(`${where} must be a real date written YYYY-MM-DD, such as 2026-10-03.`);
      return "";
    }
    return value;
  };

  const idRaw = input.id;
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!id || id.length > SEASON_LIMITS.idLength || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    fail(`The season's id must be lowercase letters, digits and hyphens, up to ${SEASON_LIMITS.idLength} characters.`);
  }
  const name = text(input.name, "The season's name", SEASON_LIMITS.name, true);
  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
  if (!isTimeZone(timezone)) {
    fail("The season's timezone must be a place name this platform knows, such as America/Los_Angeles or Europe/Amsterdam.");
  }
  let sessionTime: string | undefined;
  if (input.sessionTime !== undefined && input.sessionTime !== null && input.sessionTime !== "") {
    if (typeof input.sessionTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.sessionTime.trim())) {
      fail("The season's sessionTime must be a time written HH:MM, such as 11:00.");
    } else {
      sessionTime = input.sessionTime.trim();
    }
  }
  const description = text(input.description, "The season's description", SEASON_LIMITS.description, false);

  const weeks: CanvasSeasonWeek[] = [];
  if (!Array.isArray(input.weeks) || input.weeks.length === 0) {
    fail("A season needs a list of weeks, with at least one week in it.");
  } else if (input.weeks.length > SEASON_LIMITS.weeks) {
    fail(`A season holds at most ${SEASON_LIMITS.weeks} weeks.`);
  } else {
    input.weeks.forEach((raw, i) => {
      const at = `Week entry ${i + 1}`;
      if (!isRecord(raw)) {
        fail(`${at} must be an object.`);
        return;
      }
      for (const k of Object.keys(raw)) if (!KNOWN_WEEK.includes(k)) ignored.push(`weeks[${i}].${k}`);
      const n = raw.number;
      const numberOk = typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= SEASON_LIMITS.weekNumber;
      if (!numberOk) fail(`${at} needs a whole week number from 0 to ${SEASON_LIMITS.weekNumber}.`);
      const label = numberOk ? `Week ${n}` : at;
      weeks.push({
        number: numberOk ? (n as number) : -1,
        date: date(raw.date, `${label}'s date`),
        title: text(raw.title, `${label}'s title`, SEASON_LIMITS.title, true),
        blocks: blocks(raw.blocks, `${label}'s blocks`),
        foundations: foundations(raw.foundations, `${label}'s foundations`),
        tools: list(raw.tools, `${label}'s tools`, SEASON_LIMITS.tools, SEASON_LIMITS.tool),
        showcaseAsk: text(raw.showcaseAsk, `${label}'s showcaseAsk`, SEASON_LIMITS.showcaseAsk, false),
        actions: list(raw.actions, `${label}'s actions`, SEASON_LIMITS.actions, SEASON_LIMITS.action),
      });
    });
    // The weeks run forward: each number and each date after the one before.
    for (let i = 1; i < weeks.length; i++) {
      const a = weeks[i - 1];
      const b = weeks[i];
      if (a.number >= 0 && b.number >= 0 && b.number <= a.number) {
        fail(`Week ${b.number} comes after week ${a.number} in the file, so its number must be higher.`);
      }
      if (a.date && b.date && b.date <= a.date) {
        fail(`Week ${b.number}'s date (${b.date}) must be after week ${a.number}'s (${a.date}).`);
      }
    }
  }

  const moons: CanvasSeasonMoon[] = [];
  if (input.moons !== undefined && input.moons !== null) {
    if (!Array.isArray(input.moons)) {
      fail("The season's moons must be a list.");
    } else if (input.moons.length > SEASON_LIMITS.moons) {
      fail(`A season holds at most ${SEASON_LIMITS.moons} moons.`);
    } else {
      input.moons.forEach((raw, i) => {
        const at = `Moon entry ${i + 1}`;
        if (!isRecord(raw)) {
          fail(`${at} must be an object.`);
          return;
        }
        for (const k of Object.keys(raw)) if (!KNOWN_MOON.includes(k)) ignored.push(`moons[${i}].${k}`);
        moons.push({
          date: date(raw.date, `${at}'s date`),
          blocks: blocks(raw.blocks, `${at}'s blocks`),
          note: text(raw.note, `${at}'s note`, SEASON_LIMITS.note, false),
        });
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const season: CanvasSeason = { id, name, timezone, weeks, moons };
  if (sessionTime) season.sessionTime = sessionTime;
  if (description) season.description = description;
  return { ok: true, season, ignored };
}

/** Today's date, `YYYY-MM-DD`, in a timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** A calendar date moved by whole days. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface SeasonMoment {
  /** Before the first week, during the weeks, or after the last one has run its seven days. */
  phase: "before" | "during" | "after";
  /** The week the date falls in, during the season. */
  week: CanvasSeasonWeek | null;
  /** The next session: the first week before the season starts, the following one during it. */
  next: CanvasSeasonWeek | null;
}

/**
 * Where a date falls in a season, in the season's own timezone.
 *
 * The current week is the last one whose date has come. It stays current
 * until the next week's date, so a gap in the schedule keeps the last session
 * on the page rather than showing nothing. The last week stays current for
 * seven days, then the season is over.
 */
export function seasonMoment(season: Pick<CanvasSeason, "weeks" | "timezone">, now: Date = new Date()): SeasonMoment {
  const weeks = season.weeks;
  if (weeks.length === 0) return { phase: "after", week: null, next: null };
  const today = todayIn(season.timezone, now);
  if (today < weeks[0].date) return { phase: "before", week: null, next: weeks[0] };
  let i = 0;
  while (i + 1 < weeks.length && weeks[i + 1].date <= today) i++;
  const week = weeks[i];
  if (i === weeks.length - 1 && today > addDays(week.date, 6)) return { phase: "after", week: null, next: null };
  return { phase: "during", week, next: weeks[i + 1] ?? null };
}

/**
 * The blocks to put first on the Canvas view: this week's during the season,
 * the first week's before it starts, and none after it ends.
 */
export function seasonFocus(season: Pick<CanvasSeason, "weeks" | "timezone"> | null, now: Date = new Date()): CanvasBlockId[] {
  if (!season) return [];
  const m = seasonMoment(season, now);
  if (m.phase === "during" && m.week) return m.week.blocks;
  if (m.phase === "before" && m.next) return m.next.blocks;
  return [];
}

/**
 * EVERY BLOCK, focus first. The focus blocks in the order given, then every
 * other block in canvas order. Always all twelve, each exactly once: an id the
 * canvas does not know is skipped, never added, and nothing the focus leaves
 * out is dropped.
 */
export function orderBlocks(focus: readonly unknown[] = []): CanvasBlock[] {
  const first: CanvasBlockId[] = [];
  for (const id of focus) if (isCanvasBlockId(id) && !first.includes(id)) first.push(id);
  const rest = CANVAS_BLOCK_IDS.filter((id) => !first.includes(id));
  return [...first, ...rest].map((id) => CANVAS_BLOCKS[id]);
}

export type SeasonEntry =
  | { kind: "week"; date: string; week: CanvasSeasonWeek }
  | { kind: "moon"; date: string; moon: CanvasSeasonMoon };

/**
 * The weeks and the moons in one list, by date, as the week map shows them. A
 * moon on a session's date comes after that session.
 */
export function seasonTimeline(season: Pick<CanvasSeason, "weeks" | "moons">): SeasonEntry[] {
  const entries: SeasonEntry[] = [
    ...season.weeks.map((week) => ({ kind: "week" as const, date: week.date, week })),
    ...season.moons.map((moon) => ({ kind: "moon" as const, date: moon.date, moon })),
  ];
  const rank = (e: SeasonEntry) => (e.kind === "week" ? 0 : 1);
  return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a) - rank(b)));
}

/**
 * A chosen file too large to be a season, refused before it is read. A file
 * of JSON text holds at most four bytes per character, so anything past four
 * times the character limit cannot pass the validator anyway.
 */
export function seasonFileRefusal(file: { size: number }): string | null {
  return file.size > SEASON_LIMITS.fileCharacters * 4
    ? "That file is too large to be a season file. Choose the season's .json file."
    : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sat 26 Sep", or "Sat 26 Sep 2026" with the year. The same on every machine and in every zone. */
export function seasonDateLabel(date: string, withYear = false): string {
  if (!isSeasonDate(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** What `GET /api/canvas/season` answers a signed-in member. */
export interface CanvasSeasonPayload {
  season: CanvasSeason | null;
  /** Who loaded the season, by first name. Null with no season, or none recorded. */
  savedBy: { id: string; name: string } | null;
  savedAt: string | null;
  /** Set when a stored season no longer passes the validator; the view then shows canvas order. */
  problem: string | null;
  /** Whether this member holds the canvas pen, so the page offers the loading form. */
  mayEdit: boolean;
}

/** The document stored under `CANVAS_SEASON_KEY`: the season, and who loaded it when. */
export interface StoredCanvasSeason {
  season: CanvasSeason;
  savedBy: string;
  /** ISO instant. */
  savedAt: string;
}
