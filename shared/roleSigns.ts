/**
 * THE SIGN CATALOG: the closed list of things the platform can count about a
 * role's work, and the one pure counter for each.
 *
 * A role's terms say "how we'll know it's working" as measures written in
 * words (`ScoreMeasure` in `shared/seatSettings.ts`). A measure may name one
 * of these keys in `countedBy`, and then the card prints a count beside it.
 * A measure that names none reads "Not counted yet", never a number.
 *
 * THE RULES THE CATALOG KEEPS:
 *
 *   1. CLOSED. `SIGN_KEYS` is the whole list. The settings parser refuses any
 *      other key, so a measure cannot point at a counter that does not exist.
 *   2. EVERY COUNTER READS ROWS SHAPED LIKE REAL TABLES. The field names are
 *      the columns in `drizzle/`, snake case and all, so the server can hand
 *      a query's rows straight in and a reader can check the counter against
 *      the schema by eye. The migration each shape comes from is named on it.
 *   3. UNREAD IS ABSENT, NEVER 0. A counter whose table was not read returns
 *      null, and so does an unknown key. Only a table that was read and held
 *      nothing yields a 0.
 *   4. NO SIGN-IN COUNTER. Sign-ins are not stored anywhere, so there is
 *      nothing honest to count, and the catalog has no key for it.
 *   5. A TREND COMPARES TWO CYCLE WINDOWS. A "cycle" sign is counted over the
 *      current moon and over the moon before it. A "state" sign is a reading
 *      of how things stand now, there is no stored past state to compare it
 *      with, so its trend says "trend from next moon" and never invents one.
 *
 * Pure and node-tested (`roleSigns.test.ts`).
 */
import { isWithinBusinessDays } from "./businessDays";
import type { CycleClock } from "./cycleClock";

export const SIGN_KEYS = [
  "applications-answered",
  "season-plans-filed",
  "newcomers-active",
  "community-quests-finished",
  "roles-with-card-and-term",
  "org-drafts-decided",
  "circle-met",
  "decisions-recorded",
] as const;
export type SignKey = (typeof SIGN_KEYS)[number];

export function isSignKey(v: unknown): v is SignKey {
  return typeof v === "string" && (SIGN_KEYS as readonly string[]).includes(v);
}

// ── Row shapes, one per table read ─────────────────────────────────────────

/** A stored instant: a Date from the driver, or its ISO text. */
export type Stamp = Date | string;

/** `seat_applications` (0257). */
export interface SeatApplicationRow {
  id: string;
  status: string;
  created_at: Stamp;
  decided_at: Stamp | null;
  /** Read for the sign's sheet of rows only, which names a first name at the member tier. */
  candidate_user_id?: string;
}
/** `season_plans` (0258). */
export interface SeasonPlanRow {
  user_id: string;
  season_id: string;
  filed_at: Stamp | null;
  superseded_at: Stamp | null;
}
/** `users` (0001): the members a plan is counted against. */
export interface MemberRow {
  id: string;
  joined_at: Stamp;
}
/** `quest_claims` (0001). */
export interface QuestClaimRow {
  user_id: string;
  status: "claimed" | "submitted" | "consented" | "declined" | string;
  claimed_at: Stamp;
  consented_at: Stamp | null;
}
/** `org_roles` (0049). `accountabilities` is the JSON column, parsed or not. */
export interface OrgRoleRow {
  id: string;
  active: number | boolean;
  aim: string | null;
  domain: string | null;
  accountabilities: string[] | string | null;
  /** The role's full title, for the sign's sheet of rows. */
  name?: string;
}
/** `org_role_assignments` (0049). */
export interface OrgRoleAssignmentRow {
  org_role_id: string;
  user_id: string | null;
  started_at: Stamp;
  ended_at: Stamp | null;
  term_ends_at: Stamp | null;
}
/** `org_drafts` (0056). A draft is decided when it is published. */
export interface OrgDraftRow {
  id: string;
  status: "open" | "published" | "reverted" | "withdrawn" | string;
  created_at: Stamp;
  published_at: Stamp | null;
}
/** `live_sessions` (0238). */
export interface LiveSessionRow {
  id: number;
  circle_id: string | null;
  created_at: Stamp;
}
/** `live_session_people` (0238). */
export interface LiveSessionPersonRow {
  session_id: number;
  member_no: number;
}
/** `live_session_entries` (0238). */
export interface LiveSessionEntryRow {
  session_id: number;
  kind: string;
  /** open, done or parked. A decision is `done` once the room consents to it, and only then is it one. */
  status: string;
  created_at: Stamp;
}

/**
 * Everything any counter reads. A table left out is unread, and every counter
 * that needs it returns null.
 */
export interface SignRows {
  seat_applications?: SeatApplicationRow[];
  season_plans?: SeasonPlanRow[];
  users?: MemberRow[];
  quest_claims?: QuestClaimRow[];
  org_roles?: OrgRoleRow[];
  org_role_assignments?: OrgRoleAssignmentRow[];
  org_drafts?: OrgDraftRow[];
  live_sessions?: LiveSessionRow[];
  live_session_people?: LiveSessionPersonRow[];
  live_session_entries?: LiveSessionEntryRow[];
  /** The season a plan is filed for. Unread when absent. */
  season_id?: string;
  /** Narrows "circle met" to one circle. Absent counts every circle. */
  circle_id?: string | null;
}

/** A counting window: [from, to), with the zone business days are read in. */
export interface SignWindow {
  from: Date;
  to: Date;
  timeZone: string;
}

/** n of `of`, when the sign has a whole to count against. */
export interface SignCount {
  n: number;
  of?: number;
  /** The tables this count was read from, so a test can trace it. */
  source: string;
}

export interface SignDef {
  key: SignKey;
  label: string;
  countedFrom: string;
  window: "cycle" | "state";
  reads: readonly (keyof SignRows)[];
  count(rows: SignRows, window: SignWindow): SignCount | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const ms = (s: Stamp | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const t = s instanceof Date ? s.getTime() : new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
};
const inWindow = (s: Stamp | null | undefined, w: SignWindow): boolean => {
  const t = ms(s);
  return t !== null && t >= w.from.getTime() && t < w.to.getTime();
};
const DAY_MS = 86_400_000;
const ANSWER_DAYS = 2;
const NEWCOMER_DAYS = 7;

function hasAll(rows: SignRows, keys: readonly (keyof SignRows)[]): boolean {
  return keys.every((k) => rows[k] !== undefined);
}

function listOf(v: string[] | string | null): string[] {
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string" && s.trim());
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];
  } catch {
    return [];
  }
}

/**
 * Answered within 2 business days, over anything with a created and a decided
 * instant. A row still inside its 2 business days with no answer is not yet
 * late, so it is left out of the whole rather than counted as missed.
 */
function answeredInTime(
  rows: { created_at: Stamp; decided_at: Stamp | null }[],
  w: SignWindow,
): { n: number; of: number } {
  let n = 0;
  let of = 0;
  for (const r of rows) {
    if (!inWindow(r.created_at, w)) continue;
    const created = new Date(ms(r.created_at)!);
    const decided = ms(r.decided_at);
    if (decided !== null && isWithinBusinessDays(created, new Date(decided), ANSWER_DAYS, w.timeZone)) {
      n += 1;
      of += 1;
      continue;
    }
    const stillOpen = decided === null && isWithinBusinessDays(created, w.to, ANSWER_DAYS, w.timeZone);
    if (!stillOpen) of += 1;
  }
  return { n, of };
}

// ── The catalog ────────────────────────────────────────────────────────────

const DEFS: SignDef[] = [
  {
    key: "applications-answered",
    label: "Role applications answered within 2 business days",
    countedFrom: "Counted from when each role application was filed and when it was decided.",
    window: "cycle",
    reads: ["seat_applications"],
    count(rows, w) {
      // A withdrawn application was never the village's to answer.
      const live = rows.seat_applications!.filter((r) => r.status !== "withdrawn");
      return { ...answeredInTime(live, w), source: "seat_applications.created_at, seat_applications.decided_at" };
    },
  },
  {
    key: "season-plans-filed",
    label: "Season plans filed",
    countedFrom: "Counted from the season plans members have filed, against every member.",
    window: "state",
    reads: ["season_plans", "users", "season_id"],
    count(rows, w) {
      const members = new Set(rows.users!.map((u) => u.id));
      const filed = new Set(
        rows.season_plans!
          .filter((p) => p.season_id === rows.season_id && members.has(p.user_id))
          .filter((p) => {
            const t = ms(p.filed_at);
            return t !== null && t < w.to.getTime();
          })
          .map((p) => p.user_id),
      );
      return { n: filed.size, of: members.size, source: "season_plans.filed_at, users.id" };
    },
  },
  {
    key: "newcomers-active",
    label: "Newcomers active within 7 days",
    countedFrom: "Counted from each newcomer's join date to their first quest claim or first role.",
    window: "cycle",
    reads: ["users", "quest_claims", "org_role_assignments"],
    count(rows, w) {
      const firstAct = new Map<string, number>();
      const note = (id: string | null, s: Stamp) => {
        const t = ms(s);
        if (!id || t === null) return;
        const was = firstAct.get(id);
        if (was === undefined || t < was) firstAct.set(id, t);
      };
      for (const c of rows.quest_claims!) note(c.user_id, c.claimed_at);
      for (const a of rows.org_role_assignments!) note(a.user_id, a.started_at);
      let n = 0;
      let of = 0;
      for (const u of rows.users!) {
        if (!inWindow(u.joined_at, w)) continue;
        const joined = ms(u.joined_at)!;
        const deadline = joined + NEWCOMER_DAYS * DAY_MS;
        const act = firstAct.get(u.id);
        const active = act !== undefined && act >= joined && act <= deadline;
        if (active) {
          n += 1;
          of += 1;
        } else if (deadline <= w.to.getTime()) {
          of += 1;
        }
      }
      return { n, of, source: "users.joined_at, quest_claims.claimed_at, org_role_assignments.started_at" };
    },
  },
  {
    key: "community-quests-finished",
    label: "Community quests finished",
    countedFrom: "Counted from quest claims the village consented to as done.",
    window: "cycle",
    reads: ["quest_claims"],
    count(rows, w) {
      const n = rows.quest_claims!.filter((c) => c.status === "consented" && inWindow(c.consented_at, w)).length;
      return { n, source: "quest_claims.status, quest_claims.consented_at" };
    },
  },
  {
    key: "roles-with-card-and-term",
    label: "Roles with a full card and a term",
    countedFrom: "Counted from each active role's aim, domain and accountabilities, and a term on its holding.",
    window: "state",
    reads: ["org_roles", "org_role_assignments"],
    count(rows, w) {
      const now = w.to.getTime();
      const termed = new Set(
        rows.org_role_assignments!
          .filter((a) => {
            const ended = ms(a.ended_at);
            return (ended === null || ended > now) && ms(a.term_ends_at) !== null;
          })
          .map((a) => a.org_role_id),
      );
      const active = rows.org_roles!.filter((r) => r.active === true || r.active === 1);
      const n = active.filter(
        (r) => !!r.aim?.trim() && !!r.domain?.trim() && listOf(r.accountabilities).length > 0 && termed.has(r.id),
      ).length;
      return {
        n,
        of: active.length,
        source: "org_roles.aim, org_roles.domain, org_roles.accountabilities, org_role_assignments.term_ends_at",
      };
    },
  },
  {
    key: "org-drafts-decided",
    label: "Org chart drafts decided within 2 business days",
    countedFrom: "Counted from when each org chart draft was opened and when it was published.",
    window: "cycle",
    reads: ["org_drafts"],
    count(rows, w) {
      // A withdrawn draft records no decision time, so it is left out.
      const decidable = rows.org_drafts!
        .filter((d) => d.status !== "withdrawn")
        .map((d) => ({ created_at: d.created_at, decided_at: d.published_at }));
      return { ...answeredInTime(decidable, w), source: "org_drafts.created_at, org_drafts.published_at" };
    },
  },
  {
    key: "circle-met",
    label: "Times the circle met",
    countedFrom: "Counted from live sessions that two or more people joined.",
    window: "cycle",
    reads: ["live_sessions", "live_session_people"],
    count(rows, w) {
      const people = new Map<number, Set<number>>();
      for (const p of rows.live_session_people!) {
        const set = people.get(p.session_id) ?? new Set<number>();
        set.add(p.member_no);
        people.set(p.session_id, set);
      }
      const n = rows.live_sessions!.filter(
        (s) =>
          inWindow(s.created_at, w) &&
          (rows.circle_id === undefined || s.circle_id === rows.circle_id) &&
          (people.get(s.id)?.size ?? 0) >= 2,
      ).length;
      return { n, source: "live_sessions.created_at, live_session_people.member_no" };
    },
  },
  {
    key: "decisions-recorded",
    label: "Decisions recorded",
    countedFrom: "Counted from decisions a live session agreed by consent.",
    window: "cycle",
    reads: ["live_session_entries"],
    count(rows, w) {
      // A proposal still open, or one set aside, is not a decision: the log and the season pulse count the same way.
      const n = rows.live_session_entries!.filter((e) => e.kind === "decision" && e.status === "done" && inWindow(e.created_at, w)).length;
      return { n, source: "live_session_entries.kind, live_session_entries.status, live_session_entries.created_at" };
    },
  },
];

export const SIGNS: Readonly<Record<SignKey, SignDef>> = Object.fromEntries(DEFS.map((d) => [d.key, d])) as Record<
  SignKey,
  SignDef
>;

// ── Reading a sign, with its trend ─────────────────────────────────────────

export const NOT_COUNTED_YET = "Not counted yet";
export const TREND_FROM_NEXT_MOON = "trend from next moon";

export type SignTrend =
  | { kind: "compare"; before: SignCount; direction: "up" | "down" | "same" }
  | { kind: "later"; words: string };

export type SignReading =
  | { kind: "counted"; key: SignKey; label: string; countedFrom: string; now: SignCount; trend: SignTrend | null }
  | { kind: "not-counted"; key: string | null; words: string };

/** The share n/of, or the bare n when there is no whole. Used only to compare. */
const level = (c: SignCount): number => (c.of === undefined ? c.n : c.of === 0 ? 0 : c.n / c.of);

/**
 * One sign, read over the current window and, for a cycle sign, the one before.
 * An unknown key or an unread table reads "Not counted yet" and carries no number.
 */
export function readSign(
  key: string | null | undefined,
  rows: SignRows,
  windows: { current: SignWindow; previous: SignWindow | null },
): SignReading {
  if (!isSignKey(key)) return { kind: "not-counted", key: key ?? null, words: NOT_COUNTED_YET };
  const def = SIGNS[key];
  if (!hasAll(rows, def.reads)) return { kind: "not-counted", key, words: NOT_COUNTED_YET };
  const now = def.count(rows, windows.current);
  if (!now) return { kind: "not-counted", key, words: NOT_COUNTED_YET };
  let trend: SignTrend | null = null;
  if (def.window === "state") {
    trend = { kind: "later", words: TREND_FROM_NEXT_MOON };
  } else if (windows.previous) {
    const before = def.count(rows, windows.previous);
    if (before) {
      const a = level(now);
      const b = level(before);
      trend = { kind: "compare", before, direction: a > b ? "up" : a < b ? "down" : "same" };
    }
  }
  return { kind: "counted", key, label: def.label, countedFrom: def.countedFrom, now, trend };
}

/**
 * The current cycle so far and the whole cycle before it, on the village's
 * own clock (a moon, or a calendar month).
 */
export function cycleWindows(now: Date, clock: CycleClock, timeZone: string): { current: SignWindow; previous: SignWindow } {
  const cur = clock.boundsFor(now);
  const prev = clock.boundsFor(new Date(cur.startsAt.getTime() - 1));
  return {
    current: { from: cur.startsAt, to: now, timeZone },
    previous: { from: prev.startsAt, to: cur.startsAt, timeZone },
  };
}
