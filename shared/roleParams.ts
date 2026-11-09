/**
 * THE PARAMETERS OF A ROLE'S FULL CARD (role journey PR-C, Rye 9 Nov 2026).
 *
 * The columns arrived in migration 0362 (PR-A). This file is the one reader and
 * the one parser for them, shared by the server projection, the admin write and
 * every client surface, so /roles, the draft board, the map and the profile all
 * say the same thing.
 *
 * WHAT IS PUBLIC. Track, village goals, selection criteria, the ordered
 * interviews, where, languages and the review length reach everyone. The budget
 * line and the funding start reach readers of terms. The access bundle and the
 * booking link stay at the editing tier. Pay is not here: only a pay group's
 * kind, range, currency, period and note ever leave the terms, and only for a
 * listed open role (`publicPayOf`).
 *
 * Pure: no Node builtins.
 */

// ── Track ────────────────────────────────────────────────────────────────────

export const ROLE_TRACKS = ["paid", "volunteer", "local", "ai"] as const;
export type RoleTrack = (typeof ROLE_TRACKS)[number];

export const TRACK_WORDS: Record<RoleTrack, string> = {
  paid: "Paid contractor",
  volunteer: "Volunteer",
  local: "Local employee",
  ai: "AI",
};

/** Tracks that are paid, so a range must be on offer before the card is complete. */
export const PAID_TRACKS: readonly RoleTrack[] = ["paid", "local"];

export const WHERE_WORKED = ["land", "remote", "both"] as const;
export type WhereWorked = (typeof WHERE_WORKED)[number];
export const WHERE_WORDS: Record<WhereWorked, string> = {
  land: "On the land",
  remote: "Remote",
  both: "On the land or remote",
};

// ── Interviews: an ordered list ──────────────────────────────────────────────

export interface InterviewStep {
  /** The role whose holder interviews. */
  roleId: string;
  /** How long this interview runs. */
  minutes: number;
  /** This interviewer gives the final approval. At most one step carries it. */
  final?: boolean;
}

export const INTERVIEW_MAX_STEPS = 6;
export const INTERVIEW_MIN_MINUTES = 5;
export const INTERVIEW_MAX_MINUTES = 240;
/** What a plain role id reads as when an older list named roles without lengths. */
export const INTERVIEW_DEFAULT_MINUTES = 20;

export interface InterviewStepView extends InterviewStep {
  /** The role's name, resolved by the server so a visitor needs no second read. */
  roleName: string | null;
}

// ── The record ───────────────────────────────────────────────────────────────

export interface RoleParams {
  villageGoals: string[] | null;
  track: RoleTrack | null;
  selectionCriteria: string[] | null;
  interviewerRoles: InterviewStep[] | null;
  whereWorked: WhereWorked | null;
  languages: string[] | null;
  budgetLine: string | null;
  fundedFrom: string | null;
  reviewAfterDays: number | null;
  accessBundle: string[] | null;
  bookingUrl: string | null;
}

export const ROLE_PARAM_KEYS = [
  "villageGoals",
  "track",
  "selectionCriteria",
  "interviewerRoles",
  "whereWorked",
  "languages",
  "budgetLine",
  "fundedFrom",
  "reviewAfterDays",
  "accessBundle",
  "bookingUrl",
] as const satisfies readonly (keyof RoleParams)[];
export type RoleParamKey = (typeof ROLE_PARAM_KEYS)[number];

/** The column each parameter lives in. */
export const ROLE_PARAM_COLUMNS: Record<RoleParamKey, string> = {
  villageGoals: "village_goals",
  track: "track",
  selectionCriteria: "selection_criteria",
  interviewerRoles: "interviewer_roles",
  whereWorked: "where_worked",
  languages: "languages",
  budgetLine: "budget_line",
  fundedFrom: "funded_from",
  reviewAfterDays: "review_after_days",
  accessBundle: "access_bundle",
  bookingUrl: "booking_url",
};

export const ROLE_PARAM_LABELS: Record<RoleParamKey, string> = {
  villageGoals: "Village goals it serves",
  track: "Track",
  selectionCriteria: "Selection criteria",
  interviewerRoles: "Interviews",
  whereWorked: "Where",
  languages: "Languages",
  budgetLine: "Budget line",
  fundedFrom: "Funded from",
  reviewAfterDays: "Review",
  accessBundle: "Access it needs",
  bookingUrl: "Booking link",
};

// ── Parsing ──────────────────────────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = <T>(problem: string): Parsed<T> => ({ ok: false, problem });

function textOf(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function asJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

/** A short list of short lines. Blank lines drop out. Null or an empty list reads as nothing written. */
export function parseTextList(raw: unknown, field: string, max: number, len: number): Parsed<string[] | null> {
  if (raw === null || raw === undefined) return ok(null);
  if (!Array.isArray(raw)) return bad(`${field} is a list of short lines.`);
  const out: string[] = [];
  for (const item of raw) {
    if (item === null || item === undefined || item === "") continue;
    if (typeof item !== "string") return bad(`${field} holds words only.`);
    const t = textOf(item);
    if (!t) continue;
    if (t.length > len) return bad(`Each line of ${field} is at most ${len} characters.`);
    out.push(t);
  }
  if (out.length > max) return bad(`${field} holds at most ${max} lines.`);
  return ok(out.length ? out : null);
}

/**
 * The ordered interviews. A step is `{ roleId, minutes, final? }`. A bare role id
 * (how a plain list of roles would arrive) reads as 20 minutes. The same role
 * is not named twice, and at most one step is the final approval.
 */
export function parseInterviewSteps(raw: unknown): Parsed<InterviewStep[] | null> {
  if (raw === null || raw === undefined) return ok(null);
  if (!Array.isArray(raw)) return bad("The interviews are an ordered list.");
  const out: InterviewStep[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let roleId = "";
    let minutes: number = INTERVIEW_DEFAULT_MINUTES;
    let final = false;
    if (typeof item === "string") roleId = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      roleId = typeof o.roleId === "string" ? o.roleId.trim() : "";
      if (o.minutes !== undefined && o.minutes !== null && o.minutes !== "") {
        const m = Number(o.minutes);
        if (!Number.isInteger(m)) return bad("An interview's length is a whole number of minutes.");
        minutes = m;
      }
      final = o.final === true;
    } else continue;
    if (!roleId) return bad("Each interview names a role.");
    if (roleId.length > 120) return bad("A role id in the interviews is too long.");
    if (minutes < INTERVIEW_MIN_MINUTES || minutes > INTERVIEW_MAX_MINUTES) {
      return bad(`An interview runs ${INTERVIEW_MIN_MINUTES} to ${INTERVIEW_MAX_MINUTES} minutes.`);
    }
    if (seen.has(roleId)) return bad("A role interviews once in the list.");
    seen.add(roleId);
    out.push(final ? { roleId, minutes, final: true } : { roleId, minutes });
  }
  if (out.length > INTERVIEW_MAX_STEPS) return bad(`At most ${INTERVIEW_MAX_STEPS} interviews.`);
  if (out.filter((s) => s.final).length > 1) return bad("Only one interview gives the final approval.");
  return ok(out.length ? out : null);
}

function parseTrack(raw: unknown): Parsed<RoleTrack | null> {
  if (raw === null || raw === undefined || raw === "") return ok(null);
  return (ROLE_TRACKS as readonly unknown[]).includes(raw) ? ok(raw as RoleTrack) : bad(`The track is one of: ${ROLE_TRACKS.join(", ")}.`);
}

function parseWhere(raw: unknown): Parsed<WhereWorked | null> {
  if (raw === null || raw === undefined || raw === "") return ok(null);
  return (WHERE_WORKED as readonly unknown[]).includes(raw) ? ok(raw as WhereWorked) : bad(`Where is one of: ${WHERE_WORKED.join(", ")}.`);
}

function parseLine(raw: unknown, field: string, len: number): Parsed<string | null> {
  if (raw === null || raw === undefined) return ok(null);
  if (typeof raw !== "string") return bad(`${field} is words.`);
  const t = textOf(raw);
  if (!t) return ok(null);
  return t.length > len ? bad(`${field} is at most ${len} characters.`) : ok(t);
}

function parseDays(raw: unknown): Parsed<number | null> {
  if (raw === null || raw === undefined || raw === "") return ok(null);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 730) return bad("The review comes after 1 to 730 days.");
  return ok(n);
}

function parseDate(raw: unknown): Parsed<string | null> {
  if (raw === null || raw === undefined || raw === "") return ok(null);
  const s = typeof raw === "string" ? raw.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return bad("A funding start is a date, year-month-day.");
  return ok(s);
}

function parseBooking(raw: unknown): Parsed<string | null> {
  if (raw === null || raw === undefined) return ok(null);
  if (typeof raw !== "string") return bad("The booking link is a web address.");
  const s = raw.trim();
  if (!s) return ok(null);
  if (s.length > 300) return bad("The booking link is at most 300 characters.");
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return bad("The booking link is a web address.");
  }
  if (url.protocol !== "https:") return bad("The booking link starts with https.");
  return ok(s);
}

/** What a body may carry for the card's parameters. Only the keys it names are in `value`. */
export function parseRoleParams(body: unknown): Parsed<Partial<RoleParams>> {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const value: Partial<RoleParams> = {};
  const put = <K extends RoleParamKey>(key: K, r: Parsed<RoleParams[K]>): string | null => {
    if (!r.ok) return r.problem;
    value[key] = r.value;
    return null;
  };
  const problems: Array<string | null> = [];
  if (o.villageGoals !== undefined) problems.push(put("villageGoals", parseTextList(asJson(o.villageGoals), "Village goals", 5, 120)));
  if (o.track !== undefined) problems.push(put("track", parseTrack(o.track)));
  if (o.selectionCriteria !== undefined) problems.push(put("selectionCriteria", parseTextList(asJson(o.selectionCriteria), "Selection criteria", 5, 200)));
  if (o.interviewerRoles !== undefined) problems.push(put("interviewerRoles", parseInterviewSteps(asJson(o.interviewerRoles))));
  if (o.whereWorked !== undefined) problems.push(put("whereWorked", parseWhere(o.whereWorked)));
  if (o.languages !== undefined) problems.push(put("languages", parseTextList(asJson(o.languages), "Languages", 8, 40)));
  if (o.budgetLine !== undefined) problems.push(put("budgetLine", parseLine(o.budgetLine, "The budget line", 120)));
  if (o.fundedFrom !== undefined) problems.push(put("fundedFrom", parseDate(o.fundedFrom)));
  if (o.reviewAfterDays !== undefined) problems.push(put("reviewAfterDays", parseDays(o.reviewAfterDays)));
  if (o.accessBundle !== undefined) problems.push(put("accessBundle", parseTextList(asJson(o.accessBundle), "The access list", 12, 120)));
  if (o.bookingUrl !== undefined) problems.push(put("bookingUrl", parseBooking(o.bookingUrl)));
  const first = problems.find((p): p is string => !!p);
  return first ? bad(first) : ok(value);
}

/** Whether a body carries any parameter key. */
export function carriesRoleParams(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return ROLE_PARAM_KEYS.some((k) => Object.prototype.hasOwnProperty.call(body, k));
}

/** Column and bound value pairs for the parameters a parsed body names. */
export function roleParamColumns(value: Partial<RoleParams>): Array<[string, string | number | null]> {
  const out: Array<[string, string | number | null]> = [];
  for (const key of ROLE_PARAM_KEYS) {
    if (!(key in value)) continue;
    const v = value[key];
    const bound = v === null || v === undefined ? null : Array.isArray(v) ? JSON.stringify(v) : (v as string | number);
    out.push([ROLE_PARAM_COLUMNS[key], bound]);
  }
  return out;
}

/** The parameters of a stored row, each through the same tolerant reading. Anything unreadable is nothing written. */
export function roleParamsFromRow(r: Record<string, unknown>): RoleParams {
  const list = (v: unknown, max: number, len: number) => {
    const p = parseTextList(asJson(v), "x", max, len);
    return p.ok ? p.value : null;
  };
  const steps = parseInterviewSteps(asJson(r.interviewer_roles));
  const track = parseTrack(r.track);
  const where = parseWhere(r.where_worked);
  const days = parseDays(r.review_after_days);
  const date = r.funded_from instanceof Date ? parseDate(r.funded_from.toISOString()) : parseDate(r.funded_from);
  const budget = parseLine(r.budget_line, "x", 120);
  const url = parseBooking(r.booking_url);
  return {
    villageGoals: list(r.village_goals, 5, 120),
    track: track.ok ? track.value : null,
    selectionCriteria: list(r.selection_criteria, 5, 200),
    interviewerRoles: steps.ok ? steps.value : null,
    whereWorked: where.ok ? where.value : null,
    languages: list(r.languages, 8, 40),
    budgetLine: budget.ok ? budget.value : null,
    fundedFrom: date.ok ? date.value : null,
    reviewAfterDays: days.ok ? days.value : null,
    accessBundle: list(r.access_bundle, 12, 120),
    bookingUrl: url.ok ? url.value : null,
  };
}

// ── Words ────────────────────────────────────────────────────────────────────

/** "Roughly 40 hours a week": hours are an estimate, and the card says so. */
export function roughHours(text: string | null | undefined): string | null {
  const t = textOf(text);
  if (!t) return null;
  if (/^(roughly|about|around|approximately)\b/i.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  return `Roughly ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

/** The total time of a list of interviews, in words. */
export function interviewTotalWords(steps: readonly InterviewStep[]): string {
  const total = steps.reduce((n, s) => n + s.minutes, 0);
  if (total <= 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} minutes`;
  const hours = `${h} ${h === 1 ? "hour" : "hours"}`;
  return m === 0 ? hours : `${hours} ${m} minutes`;
}

function minutesWords(m: number): string {
  if (m % 60 === 0) {
    const h = m / 60;
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  return `${m} minutes`;
}

/** One line per interview, in order: "1. Visionary Channel, 1 hour". The final approval says so. */
export function interviewLines(steps: ReadonlyArray<InterviewStep & { roleName?: string | null }>): string[] {
  return steps.map((s, i) => `${i + 1}. ${s.roleName ?? "An interviewer"}, ${minutesWords(s.minutes)}${s.final ? ", final approval" : ""}`);
}

// ── The completeness gate ────────────────────────────────────────────────────

export const CARD_PARTS = [
  "aim",
  "decides",
  "answers",
  "hours",
  "track",
  "reward",
  "term",
  "goal",
  "criteria",
  "interviews",
  "range",
] as const;
export type CardPart = (typeof CARD_PARTS)[number];

export const CARD_PART_WORDS: Record<CardPart, string> = {
  aim: "its aim",
  decides: "what it decides on",
  answers: "what it answers for",
  hours: "rough hours",
  track: "its track",
  reward: "its reward type",
  term: "its term",
  goal: "a village goal",
  criteria: "selection criteria",
  interviews: "who interviews",
  range: "a pay range",
};

export interface CardGateInput {
  aim: string | null | undefined;
  domain: string | null | undefined;
  accountabilities: readonly string[] | null | undefined;
  timeCommitment: string | null | undefined;
  track: RoleTrack | null | undefined;
  /** The pay group's kind in the terms on offer, or null when none is written. */
  payKind: string | null;
  /** The pay group states an amount or a range. */
  hasRange: boolean;
  /** The terms name a term, or the role names a review length. */
  hasTerm: boolean;
  villageGoals: readonly string[] | null | undefined;
  selectionCriteria: readonly string[] | null | undefined;
  interviewerRoles: readonly InterviewStep[] | null | undefined;
}

export interface CardGate {
  complete: boolean;
  /** Parts not yet written, in card order. */
  missing: CardPart[];
  written: number;
  of: number;
}

const has = (s: string | null | undefined) => !!s && s.trim() !== "";

/**
 * "Apply" shows only when the aim, what it decides on, what it answers for,
 * rough hours, track, reward type, term, a village goal, selection criteria
 * and the interviewing roles are written, and, when paid, a range is on offer.
 */
export function roleCardGate(i: CardGateInput): CardGate {
  const paid = (!!i.track && PAID_TRACKS.includes(i.track)) || i.payKind === "fixed" || i.payKind === "range";
  const present: Record<CardPart, boolean> = {
    aim: has(i.aim),
    decides: has(i.domain),
    answers: (i.accountabilities ?? []).some((a) => has(a)),
    hours: has(i.timeCommitment),
    track: !!i.track,
    reward: i.payKind !== null || i.track === "volunteer" || i.track === "ai",
    term: i.hasTerm,
    goal: (i.villageGoals ?? []).length > 0,
    criteria: (i.selectionCriteria ?? []).length > 0,
    interviews: (i.interviewerRoles ?? []).length > 0,
    range: !paid || i.hasRange,
  };
  const parts = CARD_PARTS.filter((p) => p !== "range" || paid);
  const missing = parts.filter((p) => !present[p]);
  return { complete: missing.length === 0, missing, written: parts.length - missing.length, of: parts.length };
}

export const BEING_WRITTEN = "Being written";
export function beingWrittenLine(gate: Pick<CardGate, "missing">): string {
  const words = gate.missing.map((p) => CARD_PART_WORDS[p]);
  if (words.length === 0) return BEING_WRITTEN;
  const shown = words.slice(0, 3).join(", ");
  return `${BEING_WRITTEN}. Still to write: ${shown}${words.length > 3 ? ` and ${words.length - 3} more` : ""}.`;
}
