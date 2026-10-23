/**
 * Live Sessions: A CIRCLE'S RHYTHM, and what is coming up.
 *
 * ONE FILE IS THE CONTRACT for when circles meet, the way shared/sessions.ts
 * is for the room and shared/sessionLibrary.ts is for the agenda items. The
 * store (server/repos/sessionRhythm.ts), the logic (server/lib/sessionRhythm.ts),
 * the doors (server/routes/sessionRhythm.ts) and "Coming up" on /sessions read
 * their shapes, rules and words from here. The schema is
 * drizzle/0271_a_circle_keeps_a_rhythm.sql.
 *
 * WHERE IT COMES FROM. The founder asked for a sessions page that helps the
 * village coordinate: agenda items for future sessions need a future to point
 * at. A circle keeps a rhythm (every week or every few weeks on a weekday, at
 * each new or full moon, or once on a date), "Coming up" shows each circle's
 * next meeting with the agenda items waiting for it, the start card gets the
 * room ready from it, and the circle's members hear the day before. Nothing
 * opens a room by itself: a person opens it.
 *
 * THE RHYTHM IS THE CALENDAR'S OWN SHAPE (`Recurrence`, shared/gatherings.ts),
 * so a circle's meetings can later sit on the village calendar unchanged.
 * Every time is in the village's own zone, read by the server. A rhythm keeps
 * a village date (its first meeting) and a wall-clock time, never an instant:
 * a daylight change or a new village zone leaves "Thursday at 18:00" where it
 * was, and a change to the rhythm keeps the circle's week.
 *
 * WHO KEEPS IT: the circle's own members (standing, server/lib/circleStanding.ts:
 * in its last meeting, or in one of its seats now) and admins. A circle sets
 * its own rhythm, the way it holds its own meetings. Anybody may read when a
 * circle meets: a meeting time is the circle's door, and the agenda items
 * behind it stay under their own rule.
 *
 * COPY RULES. Platform code carries no village's name. No em-dashes, and every
 * string a member reads lives in this file so the voice gate reads it.
 */
import type { Recurrence } from "./gatherings";
import type { OwnCalendarView } from "./sessionCalendar";
import { civilParts, fullMoonsBetween, newMoonsBetween, zonedTimeToUtc } from "./lunar";
import { SESSION_LIMITS, SESSION_REFUSALS, SESSIONS_API } from "./sessions";
import { circleWords } from "./sessionTasks";

// ── Doors ────────────────────────────────────────────────────────────────────

/**
 * Every door. A refusal is `{ error: <a sentence> }` with a 4xx status.
 *
 *   GET  /api/sessions                                  gains `comingUp: ComingUpPayload`
 *   PUT  /api/sessions/circles/:circleId/rhythm         RhythmInput -> { row: ComingUpRow | null }
 *   POST /api/sessions/circles/:circleId/rhythm/skip    { key } -> { row: ComingUpRow | null }
 *   GET  /api/sessions/circles/:circleId/summary        CircleSessionsSummary
 *
 * The circle's doors take four or five segments, so none is read as a room
 * (`/api/sessions/:id` and its fixed words take one and two).
 */
export const CIRCLES_API = `${SESSIONS_API}/circles`;

export function rhythmUrl(circleId: string): string {
  return `${CIRCLES_API}/${encodeURIComponent(circleId)}/rhythm`;
}

export function rhythmSkipUrl(circleId: string): string {
  return `${rhythmUrl(circleId)}/skip`;
}

export function circleSummaryUrl(circleId: string): string {
  return `${CIRCLES_API}/${encodeURIComponent(circleId)}/summary`;
}

/** A row's anchor on /sessions is `coming-<circleId>`, so a notice lands on it. */
export function comingAnchor(circleId: string): string {
  return `coming-${circleId}`;
}

export function comingLink(circleId: string): string {
  return `/sessions#${comingAnchor(circleId)}`;
}

// ── Kinds and limits ─────────────────────────────────────────────────────────

export const RHYTHM_KINDS = ["weekly", "moon", "once"] as const;
export type RhythmKind = (typeof RHYTHM_KINDS)[number];

export const MOON_MEETINGS = ["new_moon", "full_moon"] as const;
export type MoonMeeting = (typeof MOON_MEETINGS)[number];

export const RHYTHM_LIMITS = {
  /** Every one to four weeks. */
  everyWeeksMax: 4,
  /** How far ahead "Coming up" and a skip look. */
  lookAheadDays: 120,
  /** How many meetings ahead a skip may name. */
  skipAhead: 12,
  /** The notice goes this long before a meeting. */
  remindHours: 24,
  /** Set or skip, per member, per hour. */
  writesPerHour: 60,
} as const;

// ── Wire shapes ──────────────────────────────────────────────────────────────

/** What a member sends to set a rhythm, or to clear it. Times are the village's, "HH:MM"; dates "YYYY-MM-DD". */
export type RhythmInput =
  | { kind: "weekly"; weekday: number; everyWeeks: number; time: string; startsOn?: string; durationMin?: number }
  | { kind: "moon"; on: MoonMeeting; time: string; durationMin?: number }
  | { kind: "once"; on: string; time: string; durationMin?: number }
  | { kind: "none" };

/** One row of `live_session_rhythms`, as the rules read it. */
export interface StoredRhythm {
  circleId: string;
  kind: RhythmKind;
  recurrence: Recurrence | null;
  /** The village date of the first meeting, YYYY-MM-DD. A weekly rhythm counts its weeks from its week. */
  startsOn: string;
  /** The time of day every meeting keeps, HH:MM, in the village's zone. */
  time: string;
  durationMin: number;
}

/** What a rhythm input stores. */
export type RhythmRecord = Omit<StoredRhythm, "circleId">;

/** One meeting: when, and its key (the village date, YYYY-MM-DD), which a skip names. */
export interface Meeting {
  at: string;
  endsAt: string;
  key: string;
}

/** One circle's next meeting, as "Coming up" shows it. */
export interface ComingUpRow {
  circleId: string;
  circleName: string;
  /** "Every Thursday at 18:00", "At each new moon, 18:00", or "From the circle's own calendar". */
  rhythmWords: string;
  next: Meeting;
  /** Where the next meeting comes from: the rhythm, or the circle's own calendar (shared/sessionCalendar.ts). */
  nextFrom: "rhythm" | "calendar";
  /** The meeting's own title, when it comes from the circle's own calendar. */
  nextTitle: string | null;
  /** The rhythm's own next meeting, which a skip names, even while a meeting from the circle's own calendar comes sooner. */
  rhythmNext: (Meeting & { words: string }) | null;
  /** "Today at 18:00", "Tomorrow at 18:00", "Thursday 23 October at 18:00". */
  words: string;
  durationMin: number;
  /** The circle's waiting agenda items this viewer may see. */
  waiting: number;
  /** An open room of this circle, when there is one. */
  openRoom: { id: number; title: string } | null;
  /** The viewer is one of the circle's members, or an admin. */
  mine: boolean;
  canKeep: boolean;
  /** For the form: the rhythm as it is now, a weekly one starting from its next meeting, so a change keeps the circle's week. `none` while the circle has no rhythm. */
  rhythm: RhythmInput;
}

export interface ComingUpPayload {
  rows: ComingUpRow[];
  /** The village's zone, so the page can say whose time it is. */
  zone: string;
  /** The circles this viewer may set a rhythm for. */
  keepCircleIds: string[];
  /** The own calendars of the circles this viewer may keep, by circle. Never an address. */
  ownCalendars: Record<string, OwnCalendarView>;
  /** Whether a circle's own calendar can be attached here: false while the village cannot seal an address. */
  ownCalendarsAvailable: boolean;
}

/** One circle's sessions, for its home page (the circle card). */
export interface CircleSessionsSummary {
  circleId: string;
  rhythm: { words: string; kind: RhythmKind } | null;
  next: (Meeting & { words: string }) | null;
  /** ISO instant the circle last met (a closed session two or more people were in). */
  lastMetAt: string | null;
  waiting: number;
  openRoom: { id: number; title: string } | null;
  canKeep: boolean;
}

// ── Rights ───────────────────────────────────────────────────────────────────

/** May this viewer set or skip a circle's rhythm: its members, and admins. */
export function mayKeepRhythm(circleId: string, viewer: { admin: boolean; standing: ReadonlySet<string> }): boolean {
  return viewer.admin || viewer.standing.has(circleId);
}

// ── Reading a body ───────────────────────────────────────────────────────────

type Clean<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function readDuration(v: unknown): Clean<number> {
  if (v == null || v === "") return { ok: true, value: SESSION_LIMITS.durationDefault };
  const n = Number(v);
  return Number.isInteger(n) && n >= SESSION_LIMITS.durationMin && n <= SESSION_LIMITS.durationMax
    ? { ok: true, value: n }
    : { ok: false, status: 400, error: SESSION_REFUSALS.durationRange };
}

function readDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = DATE.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? v.trim() : null;
}

/** A rhythm from a body, cleaned. `{ kind: "none" }` clears it. */
export function cleanRhythm(raw: unknown): Clean<RhythmInput> {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (b.kind === "none") return { ok: true, value: { kind: "none" } };
  if (b.kind !== "weekly" && b.kind !== "moon" && b.kind !== "once") return { ok: false, status: 400, error: RHYTHM_REFUSALS.kindNeeded };
  const time = typeof b.time === "string" && TIME.test(b.time.trim()) ? b.time.trim() : null;
  if (!time) return { ok: false, status: 400, error: RHYTHM_REFUSALS.timeNeeded };
  const duration = readDuration(b.durationMin);
  if (!duration.ok) return duration;
  if (b.kind === "weekly") {
    const weekday = Number(b.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, status: 400, error: RHYTHM_REFUSALS.weekdayNeeded };
    const everyWeeks = b.everyWeeks == null || b.everyWeeks === "" ? 1 : Number(b.everyWeeks);
    if (!Number.isInteger(everyWeeks) || everyWeeks < 1 || everyWeeks > RHYTHM_LIMITS.everyWeeksMax) return { ok: false, status: 400, error: RHYTHM_REFUSALS.everyWeeks };
    let startsOn: string | undefined;
    if (b.startsOn != null && b.startsOn !== "") {
      const d = readDate(b.startsOn);
      if (!d) return { ok: false, status: 400, error: RHYTHM_REFUSALS.dateNeeded };
      startsOn = d;
    }
    return { ok: true, value: { kind: "weekly", weekday, everyWeeks, time, ...(startsOn ? { startsOn } : {}), durationMin: duration.value } };
  }
  if (b.kind === "moon") {
    if (b.on !== "new_moon" && b.on !== "full_moon") return { ok: false, status: 400, error: RHYTHM_REFUSALS.moonNeeded };
    return { ok: true, value: { kind: "moon", on: b.on, time, durationMin: duration.value } };
  }
  const on = readDate(b.on);
  if (!on) return { ok: false, status: 400, error: RHYTHM_REFUSALS.dateNeeded };
  return { ok: true, value: { kind: "once", on, time, durationMin: duration.value } };
}

// ── The arithmetic, pure ─────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The village date of an instant, YYYY-MM-DD. */
export function villageKey(at: Date, zone: string): string {
  const p = civilParts(at, zone);
  return dateKey(p.year, p.month, p.day);
}

/** A date key's day, as midnight UTC: the arithmetic on dates runs on these. */
const keyDay = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const dayKey = (day: number): string => {
  const dt = new Date(day);
  return dateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

/** A date key some days later (or earlier). */
export function addDays(key: string, days: number): string {
  return dayKey(keyDay(key) + days * DAY_MS);
}

/** The instant a village date and wall-clock time name, in the village's zone. */
export function meetingAt(key: string, time: string, zone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return zonedTimeToUtc(y, m, d, hh, mm, zone);
}

/**
 * What a rhythm input stores: its kind, the calendar's recurrence, the village
 * date of its first meeting and its time of day. A weekly rhythm starts on the
 * first of its weekday on or after today, or on or after `startsOn` when that
 * is later, and counts its weeks from there; a meeting of that day already
 * over is simply passed by. Refused in words: a single meeting already over,
 * a first meeting further ahead than "Coming up" looks, or a moon rhythm
 * beyond the moon table.
 */
export function rhythmRecord(input: Exclude<RhythmInput, { kind: "none" }>, now: Date, zone: string): Clean<RhythmRecord> {
  const durationMin = input.durationMin ?? SESSION_LIMITS.durationDefault;
  const today = villageKey(now, zone);
  const lastDay = addDays(today, RHYTHM_LIMITS.lookAheadDays);
  const tooFar = { ok: false as const, status: 400, error: RHYTHM_REFUSALS.tooFar };
  const past = { ok: false as const, status: 400, error: RHYTHM_REFUSALS.past };
  if (input.kind === "once") {
    if (input.on > lastDay) return tooFar;
    if (meetingAt(input.on, input.time, zone).getTime() + durationMin * 60_000 <= now.getTime()) return past;
    return { ok: true, value: { kind: "once", recurrence: null, startsOn: input.on, time: input.time, durationMin } };
  }
  if (input.kind === "weekly") {
    let day = input.startsOn && input.startsOn > today ? input.startsOn : today;
    if (day > lastDay) return tooFar;
    while (new Date(keyDay(day)).getUTCDay() !== input.weekday) day = addDays(day, 1);
    return {
      ok: true,
      value: { kind: "weekly", recurrence: { freq: "weekly", byWeekday: [input.weekday], interval: input.everyWeeks }, startsOn: day, time: input.time, durationMin },
    };
  }
  const value: RhythmRecord = { kind: "moon", recurrence: { freq: "lunar", on: input.on }, startsOn: today, time: input.time, durationMin };
  return nextMeetings({ circleId: "", ...value }, now, zone, 1).length ? { ok: true, value } : past;
}

/**
 * The next meetings of a rhythm that have not ended by `from`, at most
 * `count`, within `lookAheadDays`. Every meeting is the rhythm's wall-clock
 * time on a village date, so it keeps "18:00" across a daylight change. A
 * weekly rhythm counts its weeks from its first meeting's week; a moon rhythm
 * meets on the village date of the moon. Nothing comes before the first
 * meeting's date, and a date named in `exceptions` is skipped.
 */
export function nextMeetings(r: StoredRhythm, from: Date, zone: string, count = 1, lookAheadDays: number = RHYTHM_LIMITS.lookAheadDays): Meeting[] {
  if (!DATE.test(r.startsOn) || !TIME.test(r.time)) return [];
  const lengthMs = r.durationMin * 60_000;
  // Whole village days: the last one counts to its end, the way rhythmRecord counts it.
  const lastKey = addDays(villageKey(from, zone), lookAheadDays);
  const skipped = new Set(r.recurrence?.exceptions ?? []);
  const out: Meeting[] = [];
  const take = (key: string) => {
    if (key < r.startsOn || key > lastKey || skipped.has(key)) return;
    const at = meetingAt(key, r.time, zone);
    if (at.getTime() + lengthMs <= from.getTime()) return;
    out.push({ at: at.toISOString(), endsAt: new Date(at.getTime() + lengthMs).toISOString(), key });
  };
  if (!r.recurrence) {
    take(r.startsOn);
    return out.slice(0, count);
  }
  const rec = r.recurrence;
  if (rec.freq === "weekly") {
    const interval = Math.max(1, rec.interval ?? 1);
    const baseDay = keyDay(r.startsOn);
    const baseWeekStart = baseDay - new Date(baseDay).getUTCDay() * DAY_MS;
    const first = Math.max(baseDay, keyDay(villageKey(from, zone)) - DAY_MS);
    for (let day = first; day <= first + lookAheadDays * DAY_MS && out.length < count; day += DAY_MS) {
      if (!rec.byWeekday.includes(new Date(day).getUTCDay())) continue;
      if (Math.floor((day - baseWeekStart) / (7 * DAY_MS)) % interval !== 0) continue;
      take(dayKey(day));
    }
    return out;
  }
  if (rec.freq === "lunar" && (rec.on === "new_moon" || rec.on === "full_moon")) {
    const moons = (rec.on === "new_moon" ? newMoonsBetween : fullMoonsBetween)(new Date(from.getTime() - 2 * DAY_MS), new Date(from.getTime() + (lookAheadDays + 2) * DAY_MS));
    for (const moon of moons) {
      if (out.length >= count) break;
      take(villageKey(moon, zone));
    }
    return out;
  }
  return out;
}

/**
 * The rhythm as the form shows it, read back from what is stored. Given the
 * next meeting's date, a weekly rhythm starts from it, so saving a change
 * (a new time, a new length) keeps the circle's week.
 */
export function rhythmAsInput(r: StoredRhythm, nextKey?: string): RhythmInput {
  if (r.recurrence?.freq === "weekly") {
    const weekday = r.recurrence.byWeekday[0] ?? new Date(keyDay(r.startsOn)).getUTCDay();
    return { kind: "weekly", weekday, everyWeeks: r.recurrence.interval ?? 1, time: r.time, ...(nextKey ? { startsOn: nextKey } : {}), durationMin: r.durationMin };
  }
  if (r.recurrence?.freq === "lunar" && (r.recurrence.on === "new_moon" || r.recurrence.on === "full_moon")) {
    return { kind: "moon", on: r.recurrence.on, time: r.time, durationMin: r.durationMin };
  }
  return { kind: "once", on: r.startsOn, time: r.time, durationMin: r.durationMin };
}

/**
 * The skipped dates a changed rhythm keeps: those that are still among its
 * next meetings. A new time keeps them; a new weekday lets them go, since no
 * meeting falls on them any more.
 */
export function keptSkips(previous: Recurrence | null, next: RhythmRecord, now: Date, zone: string): string[] {
  const was = previous?.exceptions ?? [];
  if (!was.length || !next.recurrence) return [];
  const open: StoredRhythm = { circleId: "", ...next, recurrence: { ...next.recurrence, exceptions: [] } };
  const keys = new Set(nextMeetings(open, now, zone, RHYTHM_LIMITS.skipAhead).map((m) => m.key));
  return was.filter((k) => keys.has(k)).sort();
}

// ── Words ────────────────────────────────────────────────────────────────────

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/**
 * "Every Thursday at 18:00", "Every 2 weeks on Thursday at 18:00", "At each
 * new moon, 18:00", "Once, Thursday 23 October at 18:00". A single meeting's
 * year shows when it is not this one (`now` in the village's zone).
 */
export function rhythmWords(r: StoredRhythm, now?: Date, zone?: string): string {
  const input = rhythmAsInput(r);
  if (input.kind === "weekly") {
    const day = WEEKDAYS[input.weekday] ?? "";
    return input.everyWeeks === 1 ? `Every ${day} at ${input.time}` : `Every ${input.everyWeeks} weeks on ${day} at ${input.time}`;
  }
  if (input.kind === "moon") return `${input.on === "new_moon" ? "At each new moon" : "At each full moon"}, ${input.time}`;
  if (input.kind === "once") {
    const thisYear = now && zone ? civilParts(now, zone).year : Number(r.startsOn.slice(0, 4));
    return `Once, ${keyWords(r.startsOn, thisYear)} at ${input.time}`;
  }
  return "";
}

/** A village date in words, "Thursday 23 October", with the year only when it is not this one. */
function keyWords(key: string, thisYear: number): string {
  const dt = new Date(keyDay(key));
  const year = dt.getUTCFullYear() === thisYear ? "" : ` ${dt.getUTCFullYear()}`;
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}${year}`;
}

/** "Thursday 23 October", with the year only when it is not this one. */
function dayWords(at: Date, zone: string, now: Date = at): string {
  return keyWords(villageKey(at, zone), civilParts(now, zone).year);
}

/** "Today at 18:00", "Tomorrow at 18:00", or "Thursday 23 October at 18:00", in the village's zone. */
export function meetingWords(at: Date, now: Date, zone: string): string {
  const p = civilParts(at, zone);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  const a = Date.UTC(p.year, p.month - 1, p.day);
  const t = civilParts(now, zone);
  const days = Math.round((a - Date.UTC(t.year, t.month - 1, t.day)) / DAY_MS);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  return `${dayWords(at, zone, now)} at ${time}`;
}

/** The same moment inside a sentence: "today at 18:00", "tomorrow at 18:00", "on Thursday 23 October at 18:00". */
export function meetingPhrase(at: Date, now: Date, zone: string): string {
  return phraseOf(meetingWords(at, now, zone));
}

/** `meetingWords` made ready for the middle of a sentence. */
export function phraseOf(words: string): string {
  if (words.startsWith("Today") || words.startsWith("Tomorrow")) return words.charAt(0).toLowerCase() + words.slice(1);
  return `on ${words}`;
}

export const RHYTHM_COPY = {
  sectionTitle: "Coming up",
  empty: "No circle has a meeting rhythm yet.",
  setRhythm: "Set a meeting rhythm",
  change: "Change",
  skip: "Skip this one",
  /** While a meeting from the circle's own calendar comes sooner, the skip names the rhythm's own: "on Thursday 29 October at 09:00". */
  skipRhythm: (when: string): string => `Skip the rhythm's meeting ${when}`,
  getReady: "Get the room ready",
  /** The start card's title for a meeting coming up: "Garden circle, 23 October". */
  roomTitle: (circleName: string, day: string): string => `${circleWords(circleName)}, ${day}`,
  join: "Join the room",
  openNow: "Happening now",
  waiting: (n: number): string => (n === 0 ? "No agenda items yet" : n === 1 ? "1 agenda item waiting" : `${n} agenda items waiting`),
  formTitle: "A meeting rhythm",
  circleLabel: "Which circle?",
  circleChoose: "Choose a circle",
  howOftenLabel: "How often?",
  howOften: {
    every1: "Every week",
    every2: "Every 2 weeks",
    every3: "Every 3 weeks",
    every4: "Every 4 weeks",
    new_moon: "At each new moon",
    full_moon: "At each full moon",
    once: "Once",
  },
  weekdayLabel: "On which day?",
  startsOnLabel: "Starting from",
  onLabel: "On which date?",
  timeLabel: "At what time?",
  durationLabel: "How long, in minutes",
  zoneHint: (zone: string): string => `Times are the village's own (${zone}).`,
  save: "Save the rhythm",
  saving: "Saving...",
  clear: "Stop this rhythm",
  /** The confirm "Stop this rhythm" opens. */
  clearConfirm: (circleName: string): string =>
    `Stop the meeting rhythm of the ${circleWords(circleName)}? Its meetings leave Coming up, and nobody hears the day before.`,
  clearYes: "Stop it",
  keep: "Keep it",
  cancel: "Cancel",
  failed: "That did not go through. Try again in a moment.",
  /** Read out once a write lands. */
  saved: (circleName: string): string => `Saved. The ${circleWords(circleName)} has its meeting rhythm.`,
  /** `when` is `phraseOf` the next meeting: "tomorrow at 18:00", "on Thursday 5 November at 18:00". */
  skipped: (circleName: string, when: string): string => `Skipped. The next ${circleWords(circleName)} meeting is ${when}.`,
  skippedLast: (circleName: string): string => `Skipped. The ${circleWords(circleName)} has no meeting coming up now.`,
  stopped: (circleName: string): string => `Stopped. The ${circleWords(circleName)} has no meeting rhythm now.`,
} as const;

export const RHYTHM_REFUSALS = {
  notYours: "Only the circle's members and admins can set when it meets.",
  kindNeeded: "Choose how often the circle meets.",
  timeNeeded: "Give a time like 18:00.",
  dateNeeded: "Give a date like 2026-11-05.",
  weekdayNeeded: "Choose a day of the week.",
  everyWeeks: `A circle meets every 1 to ${RHYTHM_LIMITS.everyWeeksMax} weeks.`,
  moonNeeded: "Choose the new moon or the full moon.",
  past: "That time has already gone. Choose one still to come.",
  tooFar: `Choose a first meeting in the next ${RHYTHM_LIMITS.lookAheadDays} days.`,
  noRhythm: "This circle has no meeting rhythm yet.",
  skipUnknown: "That meeting isn't one of this circle's next ones.",
  circleUnknown: SESSION_REFUSALS.circleUnknown,
  slowDown: SESSION_REFUSALS.slowDown,
} as const;

/** The notice a circle's members get the day before. In the bell. */
export const RHYTHM_NOTICES = {
  /** `when` is `meetingPhrase`: "tomorrow at 18:00". */
  comingUp: (circleName: string, when: string): string => `The ${circleWords(circleName)} meets ${when}`,
  /** The line under it: what is waiting for the meeting. */
  agenda: (titles: readonly string[], more: number): string =>
    titles.length === 0
      ? "Nothing is on the agenda yet. Add an agenda item for it."
      : `On the agenda: ${titles.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`,
} as const;
