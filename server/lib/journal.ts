/**
 * The Journal: one member's own practice, and the few numbers a village may
 * read back from it.
 *
 * Reads and writes the four tables of 0227 through server/repos/journal.ts.
 * The shapes, the practices, the questions and the pulse metrics are
 * shared/journal.ts, which is the contract for every surface; nothing here
 * restates a list that file already holds.
 *
 * THE PRIVACY LINE, and where each half of it is held:
 *
 *   - An entry is its author's. Every function below that returns an entry
 *     takes the user id it filters on, and the one caller (server/routes/
 *     journal.ts) passes the id off the signed-in member's own token. There is
 *     no admin read, and no function here that could serve one.
 *   - The pulse's NUMBERS aggregate, and only above a floor. `pulseAggregate`
 *     takes no user id, and the repo's SELECT behind it names none. Its words
 *     stay in the author's entry: `journal_pulse` has no text column at all.
 *   - Feedback reaches its recipient unsigned. `receivedFeedback` maps rows
 *     whose SELECT never named `author_id`, so there is nothing to strip.
 *   - NOTHING HERE CALLS `recordEvent`. `health_events` defaults to a public
 *     audience, and a row saying a member wrote at 2am, or sent somebody
 *     feedback, would put on a steward's screen exactly what these tables keep
 *     off it. The same rule keeps journal text out of every notification.
 *
 * THE VILLAGE'S ZONE IS PASSED IN, never read here. The week a pulse belongs
 * to and the Monday a feedback batch lands on are both civil facts about the
 * village's own clock, and the caller reads that clock from `seasonState()`.
 * Every function that needs it takes `timeZone`, so each is testable across
 * zones and across a daylight change without touching a global.
 *
 * THE POOL IS PASSED IN, never imported, so every function here is testable
 * against a scratch schema and none of them owns a connection.
 */
import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  allEntryRowsForUser,
  deleteEntryRow,
  deleteJournalForUser,
  deletePulseRowsForEntry,
  entryRowByClientId,
  entryRowById,
  entryRowsForUser,
  gratitudeReceivedRows,
  insertEntryRow,
  insertQueuedFeedbackUnderCap,
  openPrefsRows,
  prefsRow,
  pulseAggregateRows,
  pulseRowsForUser,
  receivedFeedbackRows,
  respondFeedbackRow,
  sentFeedbackRowById,
  sentFeedbackRows,
  updateEntryRow,
  upsertPrefsRow,
  upsertPulseRow,
  withdrawFeedbackRow,
} from "../repos/journal";
import { numberVar } from "./variables";
import { civilDateKey, civilParts, zonedTimeToUtc } from "../../shared/lunar";
import {
  FEEDBACK_FIELD_MAX,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MIN_HOLD_HOURS,
  FEEDBACK_NOTE_MAX,
  FEEDBACK_PER_RECIPIENT_WEEKLY,
  JOURNAL_ANSWER_MAX,
  JOURNAL_ANSWERS_MAX,
  JOURNAL_REFLECTION_MAX,
  PULSE_FLOOR_DEFAULT,
  PULSE_METRICS,
  fillVillage,
  isFeedbackResponse,
  isFeedbackStyle,
  isJournalDepth,
  isJournalPractice,
  isJournalPrivacy,
  pulseScoreProblem,
  type DebriefMeta,
  type FeedbackDraft,
  type FeedbackPrefs,
  type FeedbackReceived,
  type FeedbackResponse,
  type FeedbackSent,
  type FeedbackStatus,
  type FeedbackStyle,
  type JournalAnswer,
  type JournalDepth,
  type JournalEntry,
  type JournalEntryInput,
  type JournalPractice,
  type JournalPrivacy,
  type OwnPulseWeek,
  type PulseAggregate,
  type PulseAggregateCell,
  type PulseAggregateWeek,
  type PulseScores,
  type PulseSignal,
} from "../../shared/journal";

/* -------------------------------------------------------------------------- *
 * Widths. Each is the column 0227 declares, or a limit this file chooses and
 * names. Clipped HERE, before the insert, never by MySQL after it.
 * -------------------------------------------------------------------------- */

/** `client_id` is varchar(64). Refused past it, never clipped: two clipped ids could collide. */
export const JOURNAL_CLIENT_ID_MAX = 64;
/** A question key travels inside the answers JSON; bounded so one entry cannot carry a novel in its keys. */
const QUESTION_KEY_MAX = 64;
/** The prompt as the person saw it. A question is a sentence. */
const PROMPT_MAX = 500;
/** A debrief's call name, and each seat or quest it names. */
const META_CALL_MAX = 200;
const META_ITEM_MAX = 120;
const META_ITEMS_MAX = 20;
/** How many entries one page of the member's own list carries. */
export const JOURNAL_PAGE_DEFAULT = 20;
export const JOURNAL_PAGE_MAX = 50;
/** How many weeks the aggregate looks back over. */
export const PULSE_AGGREGATE_WEEKS = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- *
 * Pure helpers. Each is a decision about inputs, testable with no database.
 * -------------------------------------------------------------------------- */

/** Trim and clip one free-text value. Never throws on a non-string. */
export function clipText(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}

/**
 * The floor in force: this village's dial, clamped to the registry's own min.
 *
 * READ AT THE POINT OF USE, never at module load. The override cache fills
 * after the stores initialise, so a value read at import would freeze the
 * platform default into the bundle and serve every village the number it
 * voted against. 1 is the smallest floor the engine honours: 0 would suppress
 * nothing while claiming to suppress something.
 */
export function pulseFloor(): number {
  const voted = Math.trunc(numberVar("journal.pulse_floor"));
  return Number.isFinite(voted) && voted > 0 ? Math.max(1, voted) : PULSE_FLOOR_DEFAULT;
}

/** The UTC midnight of a civil date, for day arithmetic that never meets a zone. */
function civilUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Monday = 0 ... Sunday = 6, from a JS weekday where Sunday = 0. */
function mondayIndex(jsWeekday: number): number {
  return (jsWeekday + 6) % 7;
}

/**
 * The ISO week an instant falls in, on the VILLAGE's clock, spelled
 * `2026-W40`.
 *
 * The civil date comes first and the ISO arithmetic runs on that date alone,
 * so 23:30 on a Sunday in the village is that Sunday's week however far the
 * village sits from UTC. The ISO year is the year of the week's Thursday,
 * which is why 1 January can belong to the previous year's week 53.
 *
 * The string sorts: zero-padded weeks under a four-digit year compare in time
 * order, which is what lets the aggregate filter on `week_id >= ?`.
 */
export function isoWeekId(at: Date, timeZone: string): string {
  const c = civilParts(at, timeZone);
  const date = civilUtc(c.year, c.month, c.day);
  const thursday = new Date(date.getTime() + (3 - mondayIndex(date.getUTCDay())) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** The instant the village's ISO week containing `at` began: Monday 00:00, village time. */
export function isoWeekStart(at: Date, timeZone: string): Date {
  const c = civilParts(at, timeZone);
  const date = civilUtc(c.year, c.month, c.day);
  const monday = new Date(date.getTime() - mondayIndex(date.getUTCDay()) * DAY_MS);
  return zonedTimeToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, timeZone);
}

/**
 * When a queued message becomes visible: the first Monday 09:00 in the
 * village's zone that is at least FEEDBACK_MIN_HOLD_HOURS after queuing.
 *
 * WHY A BATCH AT ALL. A message that appeared the minute it was written would
 * tell its recipient who was online and upset with them that minute. Holding
 * every message to one shared Monday morning means the moment a message
 * appears says little about who wrote it. The hold makes sure even a message
 * queued late on a Sunday waits a week, so "queued just before the batch" is
 * never a tell either.
 *
 * 09:00 IS WALL-CLOCK TIME, built with `zonedTimeToUtc`, so a Monday on the far
 * side of a daylight change still lands at nine in the village and the UTC
 * instant moves by the hour the clocks did.
 */
export function feedbackDeliverAfter(queuedAt: Date, timeZone: string): Date {
  const earliest = new Date(queuedAt.getTime() + FEEDBACK_MIN_HOLD_HOURS * 60 * 60 * 1000);
  const c = civilParts(earliest, timeZone);
  const date = civilUtc(c.year, c.month, c.day);
  const ahead = (7 - mondayIndex(date.getUTCDay())) % 7;
  for (let extra = 0; extra <= 7; extra += 7) {
    const monday = new Date(date.getTime() + (ahead + extra) * DAY_MS);
    const candidate = zonedTimeToUtc(
      monday.getUTCFullYear(),
      monday.getUTCMonth() + 1,
      monday.getUTCDate(),
      9,
      0,
      timeZone,
    );
    if (candidate.getTime() >= earliest.getTime()) return candidate;
  }
  // Unreachable: a Monday seven days past the first one is always later.
  return new Date(earliest.getTime() + 7 * DAY_MS);
}

/** The oldest week id the aggregate reads, `weeks` weeks back including this one. */
export function aggregateSinceWeekId(now: Date, timeZone: string, weeks = PULSE_AGGREGATE_WEEKS): string {
  const start = isoWeekStart(now, timeZone);
  return isoWeekId(new Date(start.getTime() - (weeks - 1) * 7 * DAY_MS + 12 * 60 * 60 * 1000), timeZone);
}

/* -------------------------------------------------------------------------- *
 * Validation. Every refusal is a sentence a member can read and act on.
 * -------------------------------------------------------------------------- */

export type Checked<T> = { ok: true; value: T } | { ok: false; problem: string };

/** The answers array, cleaned, or a sentence saying why not. */
export function cleanAnswers(raw: unknown): Checked<JournalAnswer[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, problem: "Answers arrive as a list." };
  if (raw.length > JOURNAL_ANSWERS_MAX) {
    return { ok: false, problem: `One entry holds at most ${JOURNAL_ANSWERS_MAX} answers.` };
  }
  const out: JournalAnswer[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") return { ok: false, problem: "Each answer names its question and its words." };
    const questionKey = clipText((a as any).questionKey, QUESTION_KEY_MAX);
    if (!questionKey) return { ok: false, problem: "Each answer names the question it answers." };
    out.push({
      questionKey,
      prompt: clipText((a as any).prompt, PROMPT_MAX),
      // Clipped, never refused: a long answer keeps its first 8000 characters
      // and the person keeps everything they wrote up to there.
      text: clipText((a as any).text, JOURNAL_ANSWER_MAX),
    });
  }
  return { ok: true, value: out };
}

/** A pulse's numbers, checked one by one against the contract's own ranges. */
export function cleanScores(raw: unknown): Checked<PulseScores> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: "Pulse answers arrive as one number per question." };
  }
  const out: PulseScores = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const problem = pulseScoreProblem(key, value);
    if (problem) return { ok: false, problem };
    out[key] = value as number;
  }
  return { ok: true, value: out };
}

/** A debrief's call, seats, quests and portability, clipped to their widths. */
export function cleanMeta(raw: unknown): DebriefMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => clipText(x, META_ITEM_MAX)).filter(Boolean).slice(0, META_ITEMS_MAX)
      : [];
  const out: DebriefMeta = {};
  const call = clipText(m.call, META_CALL_MAX);
  if (call) out.call = call;
  const seats = list(m.seats);
  if (seats.length) out.seats = seats;
  const quests = list(m.quests);
  if (quests.length) out.quests = quests;
  if (typeof m.portable === "boolean") out.portable = m.portable;
  return Object.keys(out).length ? out : null;
}

/**
 * A save request, cleaned into the contract's input shape, or a sentence.
 *
 * `now` bounds `writtenAt` from above: an offline save arrives late, which is
 * ordinary, and one dated more than a day ahead is a broken clock, which a
 * member should hear about before it sorts above everything they write.
 */
export function cleanEntryInput(raw: unknown, now: Date = new Date()): Checked<JournalEntryInput> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const clientId = typeof b.clientId === "string" ? b.clientId.trim() : "";
  if (!clientId) return { ok: false, problem: "This save carries no id, so a retry could write it twice." };
  if (clientId.length > JOURNAL_CLIENT_ID_MAX) {
    return { ok: false, problem: `A save id is at most ${JOURNAL_CLIENT_ID_MAX} characters.` };
  }
  if (!isJournalPractice(b.practice)) {
    return { ok: false, problem: "A practice is morning, evening, pulse, debrief or free." };
  }
  const depth = b.depth === undefined ? "light" : b.depth;
  if (!isJournalDepth(depth)) return { ok: false, problem: "A depth is light or deep." };
  const answers = cleanAnswers(b.answers);
  if (!answers.ok) return answers;
  let scores: PulseScores | undefined;
  if (b.scores !== undefined && b.scores !== null) {
    if (b.practice !== "pulse") return { ok: false, problem: "Only the weekly pulse carries numbers." };
    const s = cleanScores(b.scores);
    if (!s.ok) return s;
    scores = s.value;
  }
  const hasWords = answers.value.some((a) => a.text.length > 0);
  const hasNumbers = !!scores && Object.keys(scores).length > 0;
  if (!hasWords && !hasNumbers) return { ok: false, problem: "Write something before saving." };
  const writtenAt = b.writtenAt === undefined ? now : new Date(String(b.writtenAt));
  if (Number.isNaN(writtenAt.getTime())) return { ok: false, problem: "That date could not be read." };
  if (writtenAt.getTime() > now.getTime() + DAY_MS) {
    return { ok: false, problem: "That entry is dated more than a day ahead. Check this device's clock." };
  }
  let localHour: number | undefined;
  if (b.localHour !== undefined && b.localHour !== null) {
    const h = Number(b.localHour);
    if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, problem: "An hour runs from 0 to 23." };
    localHour = h;
  }
  if (b.privacy !== undefined && !isJournalPrivacy(b.privacy)) {
    return { ok: false, problem: "Privacy is private, internal or clear." };
  }
  const reflection = b.reflection === undefined || b.reflection === null ? null : clipText(b.reflection, JOURNAL_REFLECTION_MAX) || null;
  return {
    ok: true,
    value: {
      clientId,
      practice: b.practice,
      depth,
      answers: answers.value,
      scores,
      writtenAt: writtenAt.toISOString(),
      localHour,
      privacy: (b.privacy as JournalPrivacy | undefined) ?? "private",
      meta: cleanMeta(b.meta) ?? undefined,
      reflection,
    },
  };
}

/** What an edit may change, cleaned. Every field optional; at least one present. */
export interface EntryPatch {
  answers?: JournalAnswer[];
  /** A string confirms the reflection; null takes it back. */
  reflection?: string | null;
  privacy?: JournalPrivacy;
}

export function cleanEntryPatch(raw: unknown): Checked<EntryPatch> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: EntryPatch = {};
  if (b.answers !== undefined) {
    const a = cleanAnswers(b.answers);
    if (!a.ok) return a;
    out.answers = a.value;
  }
  if (b.reflection !== undefined) {
    out.reflection = b.reflection === null ? null : clipText(b.reflection, JOURNAL_REFLECTION_MAX) || null;
  }
  if (b.privacy !== undefined) {
    if (!isJournalPrivacy(b.privacy)) return { ok: false, problem: "Privacy is private, internal or clear." };
    out.privacy = b.privacy;
  }
  if (Object.keys(out).length === 0) return { ok: false, problem: "Say what to change: answers, reflection or privacy." };
  return { ok: true, value: out };
}

/** A member's own word on receiving feedback, cleaned. */
export function cleanPrefs(raw: unknown): Checked<FeedbackPrefs> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof b.open !== "boolean") return { ok: false, problem: "Say yes or no to receiving feedback." };
  const style = b.style === undefined ? "gentle" : b.style;
  if (!isFeedbackStyle(style)) {
    return { ok: false, problem: "A style is straight to the point, gently with care, or with concrete examples." };
  }
  return { ok: true, value: { open: b.open, style, note: clipText(b.note, FEEDBACK_NOTE_MAX) } };
}

/**
 * The four parts of a feedback draft, cleaned. All four are asked for: a
 * request with no observation behind it is a demand, and an observation with
 * no request leaves the recipient guessing what to do with it.
 */
export function cleanFeedbackDraft(raw: unknown): Checked<FeedbackDraft> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const recipientId = clipText(b.recipientId, 64);
  if (!recipientId) return { ok: false, problem: "Choose who this is for." };
  const parts = {
    observation: clipText(b.observation, FEEDBACK_FIELD_MAX),
    feeling: clipText(b.feeling, FEEDBACK_FIELD_MAX),
    need: clipText(b.need, FEEDBACK_FIELD_MAX),
    request: clipText(b.request, FEEDBACK_FIELD_MAX),
  };
  if (!parts.observation) return { ok: false, problem: "Say what you saw or heard." };
  if (!parts.feeling) return { ok: false, problem: "Say how you felt." };
  if (!parts.need) return { ok: false, problem: "Say what you need." };
  if (!parts.request) return { ok: false, problem: "Say what you are asking for." };
  return { ok: true, value: { recipientId, ...parts } };
}

/** The approved message, or a sentence. Refused past the width, never clipped. */
export function feedbackMessageProblem(raw: unknown): string | null {
  const message = typeof raw === "string" ? raw.trim() : "";
  if (!message) return "Approve the words the recipient will read before sending.";
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return `That message is longer than ${FEEDBACK_MESSAGE_MAX} characters. Shorten it before sending.`;
  }
  return null;
}

/* -------------------------------------------------------------------------- *
 * The aggregate and its signals. Pure, so the floor is testable without rows.
 * -------------------------------------------------------------------------- */

/** One week's tallies as the repo returns them: no user id anywhere. */
export interface PulseTally {
  weekId: string;
  metric: string;
  n: number;
  mean: number;
}

/**
 * Weeks newest first, one cell per metric in the contract's order.
 *
 * THE FLOOR IS COUNTED IN MEMBERS WHO ANSWERED THAT METRIC THAT WEEK, never
 * in members on the roll. A village of two hundred where two people answered
 * has a mean that points at a person however large the roll is.
 *
 * A SUPPRESSED CELL IS STILL A CELL, carrying nulls and `suppressed: true`. An
 * absent cell would read as a metric nobody asks about, and a zero as a week
 * that went well. A metric nobody answered at all in a week that has other
 * answers is the same: present, suppressed.
 *
 * THE FLOOR DEFAULTS TO 1, by ruling (2026-10-02, shared/journal.ts): a small
 * team still sees its own pulse, and the anonymity the village values lives in
 * how feedback is captured and delivered. At 1 nothing is suppressed except a
 * metric nobody answered. The path stays for a village that raises the dial.
 *
 * WHAT A RAISED FLOOR CANNOT DO is stop subtraction. At a floor of 4, somebody
 * who knows how three of the four answered reads the fourth off the mean. A
 * floor keeps a small count out of casual reading and promises nothing past
 * that, and the dial's own description says so.
 */
export function aggregatePulse(tallies: PulseTally[], floor: number): PulseAggregateWeek[] {
  const byWeek = new Map<string, Map<string, PulseTally>>();
  for (const t of tallies) {
    const week = byWeek.get(t.weekId) ?? new Map<string, PulseTally>();
    week.set(t.metric, t);
    byWeek.set(t.weekId, week);
  }
  const weekIds = Array.from(byWeek.keys()).sort().reverse();
  return weekIds.map((weekId) => {
    const week = byWeek.get(weekId)!;
    const cells: PulseAggregateCell[] = PULSE_METRICS.map((m) => {
      const t = week.get(m.key);
      const suppressed = !t || t.n < floor;
      return {
        metric: m.key,
        n: suppressed ? null : t!.n,
        mean: suppressed ? null : Math.round(t!.mean * 10) / 10,
        suppressed,
      };
    });
    return { weekId, cells };
  });
}

/**
 * Plain sentences the numbers suggest, read from the LATEST week with any cell
 * above the floor, and from unsuppressed cells only.
 *
 * Gentle on purpose. A signal is an invitation to talk, never a verdict, and
 * it names a pattern and never a person: every input is a mean.
 */
export function pulseSignals(weeks: PulseAggregateWeek[], villageName: string): PulseSignal[] {
  const latest = weeks.find((w) => w.cells.some((c) => !c.suppressed));
  if (!latest) return [];
  const mean = (key: string): number | null => {
    const c = latest.cells.find((x) => x.metric === key);
    return c && !c.suppressed ? c.mean : null;
  };
  const out: PulseSignal[] = [];
  const energy = mean("energy");
  const load = mean("load");
  if (energy !== null && load !== null && energy <= -1 && load >= 4) {
    out.push({
      key: "burnout",
      text:
        "This week many people gave more than they received while carrying a heavy load. That is how burnout begins. It may help to ask together what can be set down.",
    });
  }
  const low = (key: string) => {
    const m = mean(key);
    return m !== null && m <= 2.5;
  };
  if (low("confidence")) {
    out.push({
      key: "confidence",
      text: fillVillage(
        "Confidence in {village} dipped this week. A conversation about what feels uncertain could help.",
        villageName,
      ),
    });
  }
  if (low("coherence")) {
    out.push({
      key: "coherence",
      text: "The team felt scattered this week. It may help to name together what matters most right now.",
    });
  }
  if (low("space")) {
    out.push({
      key: "space",
      text: "Some people did not have the space they needed in calls this week. A round where everyone speaks once could help.",
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * The markdown export.
 * -------------------------------------------------------------------------- */

/** A YAML double-quoted scalar. JSON's escaping is valid YAML. */
function yamlString(s: string): string {
  return JSON.stringify(s);
}

/** A heading is one line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * One entry as a markdown note: frontmatter a second brain can index, then one
 * section per answered question, then the reflection when the author
 * confirmed it. An unconfirmed reflection is the guide's guess and never the
 * person's words, so it does not travel.
 */
export function entryMarkdown(entry: JournalEntry, timeZone: string, villageName: string): string {
  const fm = [
    "---",
    `date: ${civilDateKey(new Date(entry.writtenAt), timeZone)}`,
    `practice: ${entry.practice}`,
    `depth: ${entry.depth}`,
  ];
  const meta = entry.meta;
  if (meta?.call) fm.push(`call: ${yamlString(meta.call)}`);
  if (meta?.seats?.length) fm.push(`seats: [${meta.seats.map(yamlString).join(", ")}]`);
  if (meta?.quests?.length) fm.push(`quests: [${meta.quests.map(yamlString).join(", ")}]`);
  if (typeof meta?.portable === "boolean") fm.push(`portable: ${meta.portable}`);
  if (entry.scores && Object.keys(entry.scores).length) {
    fm.push(`scores: { ${Object.entries(entry.scores).map(([k, v]) => `${k}: ${v}`).join(", ")} }`);
  }
  fm.push(
    `privacy: ${entry.privacy}`,
    `confirmed_by_author: ${entry.confirmed}`,
    `tags: [journal, ${entry.practice}]`,
    "---",
  );
  const sections: string[] = [];
  for (const a of entry.answers) {
    if (!a.text.trim()) continue;
    const heading = oneLine(fillVillage(a.prompt || a.questionKey, villageName));
    sections.push(`## ${heading}\n\n${a.text.trim()}`);
  }
  if (entry.confirmed && entry.reflection) sections.push(`## Reflection\n\n${entry.reflection.trim()}`);
  return `${fm.join("\n")}\n\n${sections.join("\n\n")}\n`;
}

/** Many entries, one file, oldest first, separated by a blank line. */
export function journalMarkdown(entries: JournalEntry[], timeZone: string, villageName: string): string {
  return entries.map((e) => entryMarkdown(e, timeZone, villageName)).join("\n");
}

/* -------------------------------------------------------------------------- *
 * Row mapping.
 * -------------------------------------------------------------------------- */

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function iso(v: unknown): string {
  return new Date(v as any).toISOString();
}

function toEntry(r: RowDataPacket): JournalEntry {
  const answers = parseJson<JournalAnswer[]>(r.answers, []);
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    practice: String(r.practice) as JournalPractice,
    depth: String(r.depth) as JournalDepth,
    answers: Array.isArray(answers) ? answers : [],
    scores: r.scores === null || r.scores === undefined ? null : parseJson<PulseScores | null>(r.scores, null),
    writtenAt: iso(r.written_at),
    localHour: r.local_hour === null || r.local_hour === undefined ? null : Number(r.local_hour),
    privacy: String(r.privacy) as JournalPrivacy,
    meta: r.meta === null || r.meta === undefined ? null : parseJson<DebriefMeta | null>(r.meta, null),
    reflection: r.reflection === null || r.reflection === undefined ? null : String(r.reflection),
    confirmed: Number(r.confirmed) === 1,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toSent(r: RowDataPacket, recipientName: string, now: Date): FeedbackSent {
  const deliverAfter = r.deliver_after ? new Date(r.deliver_after) : null;
  const status = String(r.status) as FeedbackStatus;
  return {
    id: String(r.id),
    recipientId: String(r.recipient_id),
    recipientName,
    observation: String(r.observation ?? ""),
    feeling: String(r.feeling ?? ""),
    need: String(r.need ?? ""),
    request: String(r.request ?? ""),
    message: String(r.message ?? ""),
    status,
    deliverAfter: deliverAfter ? deliverAfter.toISOString() : null,
    delivered: status === "queued" && !!deliverAfter && deliverAfter.getTime() <= now.getTime(),
    createdAt: iso(r.created_at),
  };
}

/**
 * The recipient's view, built FIELD BY FIELD from a row whose SELECT never
 * named the author. No spread, so a column added to that SELECT later still
 * cannot reach the wire through this function.
 */
function toReceived(r: RowDataPacket): FeedbackReceived {
  return {
    id: String(r.id),
    message: String(r.message ?? ""),
    deliveredAt: iso(r.deliver_after),
    response: (isFeedbackResponse(r.response) ? r.response : "none") as FeedbackResponse,
  };
}

/* -------------------------------------------------------------------------- *
 * Entries.
 * -------------------------------------------------------------------------- */

/**
 * Save one entry, IDEMPOTENT ON THE CLIENT'S ID.
 *
 * A retry with the same (member, client id) changes nothing and answers with
 * the row the first save wrote, `created: false`. The pulse numbers are written
 * only on the first save, so a retried pulse cannot move a number the member
 * has since changed in a later entry.
 */
export async function saveEntry(
  pool: Pool,
  userId: string,
  input: JournalEntryInput,
  timeZone: string,
): Promise<{ entry: JournalEntry; created: boolean }> {
  const uid = String(userId).slice(0, 64);
  const writtenAt = new Date(input.writtenAt);
  const reflection = input.reflection ? clipText(input.reflection, JOURNAL_REFLECTION_MAX) : null;
  const minted = `je-${randomUUID()}`;
  await insertEntryRow(pool, {
    id: minted,
    userId: uid,
    clientId: input.clientId,
    practice: input.practice,
    depth: input.depth,
    answers: JSON.stringify(input.answers),
    scores: input.scores && Object.keys(input.scores).length ? JSON.stringify(input.scores) : null,
    writtenAt,
    localHour: input.localHour ?? null,
    privacy: input.privacy ?? "private",
    meta: input.meta ? JSON.stringify(input.meta) : null,
    reflection,
    confirmed: reflection ? 1 : 0,
  });
  const rows = await entryRowByClientId(pool, uid, input.clientId);
  if (!rows[0]) throw new Error("journal entry did not save");
  const entry = toEntry(rows[0]);
  // CREATED MEANS THE ROW CARRIES THE ID THIS CALL MINTED. `affectedRows` is
  // no witness here: the driver connects with CLIENT_FOUND_ROWS, under which a
  // duplicate set to its own values reports 1, the same as a fresh insert, and
  // a late retry would then rewrite numbers a later entry already replaced.
  const created = entry.id === minted;
  if (created && entry.practice === "pulse" && entry.scores) {
    const weekId = isoWeekId(writtenAt, timeZone);
    for (const [metric, value] of Object.entries(entry.scores)) {
      await upsertPulseRow(pool, { id: `jp-${randomUUID()}`, userId: uid, entryId: entry.id, weekId, metric, value });
    }
  }
  return { entry, created };
}

/** Where one page of the member's own list stops: an instant, and the row id when known. */
export interface EntryCursor {
  at: Date;
  id: string | null;
}

/**
 * The cursor the NEXT page asks with: `<writtenAt>|<id>` of the last entry on
 * this one. The id breaks a tie between two entries written in the same
 * second, which a bare instant cannot.
 */
export function entryCursor(entry: Pick<JournalEntry, "writtenAt" | "id">): string {
  return `${entry.writtenAt}|${entry.id}`;
}

/**
 * Read a `before` value: `<ISO writtenAt>|<entry id>`, or a bare ISO instant,
 * which still works and pages strictly before that instant.
 */
export function parseEntryCursor(raw: unknown): Checked<EntryCursor | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  const text = String(raw);
  const bar = text.indexOf("|");
  const atText = bar >= 0 ? text.slice(0, bar) : text;
  const id = bar >= 0 ? text.slice(bar + 1).trim() : "";
  const at = new Date(atText);
  if (Number.isNaN(at.getTime())) return { ok: false, problem: "That date could not be read." };
  if (id.length > 64) return { ok: false, problem: "That page marker could not be read." };
  return { ok: true, value: { at, id: id || null } };
}

/** This member's own entries, newest first. */
export async function readEntries(
  pool: Pool,
  userId: string,
  opts: { limit?: number; before?: EntryCursor | null; practice?: JournalPractice | null } = {},
): Promise<JournalEntry[]> {
  const limit = Math.min(JOURNAL_PAGE_MAX, Math.max(1, Math.trunc(opts.limit ?? JOURNAL_PAGE_DEFAULT) || JOURNAL_PAGE_DEFAULT));
  const rows = await entryRowsForUser(pool, userId, {
    limit,
    before: opts.before ?? null,
    practice: opts.practice ?? null,
  });
  return rows.map(toEntry);
}

/** One of this member's entries, or null. Another member's id is null too. */
export async function readEntry(pool: Pool, userId: string, id: string): Promise<JournalEntry | null> {
  const rows = await entryRowById(pool, userId, id);
  return rows[0] ? toEntry(rows[0]) : null;
}

/**
 * Edit one of this member's entries. A reflection string confirms it as the
 * author's own words; null takes it back. Returns null when there is no such
 * entry of theirs.
 */
export async function editEntry(pool: Pool, userId: string, id: string, patch: EntryPatch): Promise<JournalEntry | null> {
  const before = await readEntry(pool, userId, id);
  if (!before) return null;
  await updateEntryRow(pool, userId, id, {
    answers: patch.answers === undefined ? undefined : JSON.stringify(patch.answers),
    reflection: patch.reflection,
    confirmed: patch.reflection === undefined ? undefined : patch.reflection ? 1 : 0,
    privacy: patch.privacy,
  });
  return readEntry(pool, userId, id);
}

/**
 * Forget one entry, and the numbers it carried. A number a later entry
 * already replaced belongs to that later entry and stays.
 */
export async function forgetEntry(pool: Pool, userId: string, id: string): Promise<boolean> {
  const r = await deleteEntryRow(pool, userId, id);
  if (Number(r?.affectedRows ?? 0) === 0) return false;
  await deletePulseRowsForEntry(pool, userId, id);
  return true;
}

/** Every entry, oldest first, for the markdown export. */
export async function allEntries(pool: Pool, userId: string, practice: JournalPractice | null = null): Promise<JournalEntry[]> {
  const rows = await allEntryRowsForUser(pool, userId, practice);
  return rows.map(toEntry);
}

/* -------------------------------------------------------------------------- *
 * The pulse.
 * -------------------------------------------------------------------------- */

/** This member's own numbers, one row per week, newest first. */
export async function readOwnPulse(pool: Pool, userId: string): Promise<OwnPulseWeek[]> {
  const rows = await pulseRowsForUser(pool, userId);
  const byWeek = new Map<string, PulseScores>();
  for (const r of rows) {
    const weekId = String(r.week_id);
    const scores = byWeek.get(weekId) ?? {};
    scores[String(r.metric)] = Number(r.value);
    byWeek.set(weekId, scores);
  }
  return Array.from(byWeek.entries()).map(([weekId, scores]) => ({ weekId, scores }));
}

/**
 * The village's numbers, as means and counts above the floor and nothing
 * below it. Takes no user id: the question it answers is about the village.
 */
export async function pulseAggregate(
  pool: Pool,
  opts: { now?: Date; timeZone: string; villageName: string; floor?: number },
): Promise<PulseAggregate> {
  const floor = opts.floor ?? pulseFloor();
  const since = aggregateSinceWeekId(opts.now ?? new Date(), opts.timeZone);
  const rows = await pulseAggregateRows(pool, since);
  const tallies: PulseTally[] = rows.map((r) => ({
    weekId: String(r.week_id),
    metric: String(r.metric),
    n: Number(r.n),
    mean: Number(r.mean),
  }));
  const weeks = aggregatePulse(tallies, floor);
  return { floor, weeks, signals: pulseSignals(weeks, opts.villageName) };
}

/* -------------------------------------------------------------------------- *
 * Feedback.
 * -------------------------------------------------------------------------- */

/** A member's own word on receiving feedback, or null when they have not said. */
export async function readPrefs(pool: Pool, userId: string): Promise<FeedbackPrefs | null> {
  const rows = await prefsRow(pool, userId);
  const r = rows[0];
  if (!r) return null;
  return {
    open: Number(r.open) === 1,
    style: (isFeedbackStyle(r.style) ? r.style : "gentle") as FeedbackStyle,
    note: String(r.note ?? ""),
  };
}

export async function savePrefs(pool: Pool, userId: string, prefs: FeedbackPrefs): Promise<FeedbackPrefs> {
  await upsertPrefsRow(pool, {
    userId: String(userId).slice(0, 64),
    open: prefs.open ? 1 : 0,
    style: prefs.style,
    note: clipText(prefs.note, FEEDBACK_NOTE_MAX),
  });
  return (await readPrefs(pool, userId)) ?? prefs;
}

/** Everyone who said yes, except the asker, as ids with their stated style. */
export async function openRecipients(
  pool: Pool,
  exceptUserId: string,
): Promise<Array<{ id: string; style: FeedbackStyle; note: string }>> {
  const rows = await openPrefsRows(pool, exceptUserId);
  return rows.map((r) => ({
    id: String(r.user_id),
    style: (isFeedbackStyle(r.style) ? r.style : "gentle") as FeedbackStyle,
    note: String(r.note ?? ""),
  }));
}

export type QueueOutcome =
  | { ok: true; sent: FeedbackSent }
  | { ok: false; status: number; problem: string };

/**
 * Queue one approved message for the next batch.
 *
 * THE REFUSALS, in the order a member meets them: to themselves, to somebody
 * who has not said yes, and past the weekly cap. The cap is held by the
 * insert itself (`insertQueuedFeedbackUnderCap`), so two sends racing from two
 * tabs cannot both slip under it.
 *
 * NO NOTIFICATION IS SENT, now or at delivery. A notice that something
 * arrived would mark the moment, and the moment is the tell the batch exists
 * to blur. The recipient finds it in their journal.
 */
export async function queueFeedback(
  pool: Pool,
  authorId: string,
  draft: FeedbackDraft,
  message: string,
  opts: { timeZone: string; now?: Date; recipientName: string },
): Promise<QueueOutcome> {
  const now = opts.now ?? new Date();
  if (draft.recipientId === authorId) {
    return { ok: false, status: 400, problem: "Feedback goes to somebody else. For yourself, write it in your journal." };
  }
  const prefs = await readPrefs(pool, draft.recipientId);
  if (!prefs?.open) {
    return { ok: false, status: 409, problem: "They have not said yes to receiving feedback." };
  }
  const id = `jf-${randomUUID()}`;
  const header = await insertQueuedFeedbackUnderCap(
    pool,
    {
      id,
      authorId,
      recipientId: draft.recipientId,
      observation: clipText(draft.observation, FEEDBACK_FIELD_MAX),
      feeling: clipText(draft.feeling, FEEDBACK_FIELD_MAX),
      need: clipText(draft.need, FEEDBACK_FIELD_MAX),
      request: clipText(draft.request, FEEDBACK_FIELD_MAX),
      message: message.trim(),
      deliverAfter: feedbackDeliverAfter(now, opts.timeZone),
      createdAt: now,
    },
    isoWeekStart(now, opts.timeZone),
    FEEDBACK_PER_RECIPIENT_WEEKLY,
  );
  if (Number(header?.affectedRows ?? 0) === 0) {
    return {
      ok: false,
      status: 409,
      problem: "You have already sent them feedback this week. It can wait for next week.",
    };
  }
  const rows = await sentFeedbackRowById(pool, authorId, id);
  if (!rows[0]) return { ok: false, status: 500, problem: "That message did not save." };
  return { ok: true, sent: toSent(rows[0], opts.recipientName, now) };
}

/** Everything this author wrote, newest first, as they see it. */
export async function sentFeedback(
  pool: Pool,
  authorId: string,
  nameOf: (id: string) => Promise<string>,
  now: Date = new Date(),
): Promise<FeedbackSent[]> {
  const rows = await sentFeedbackRows(pool, authorId);
  const out: FeedbackSent[] = [];
  for (const r of rows) out.push(toSent(r, await nameOf(String(r.recipient_id)), now));
  return out;
}

/**
 * Take a message back before its batch. After delivery it belongs to the
 * recipient, and withdrawing it then would edit what somebody already read.
 */
export async function withdrawFeedback(
  pool: Pool,
  authorId: string,
  id: string,
  nameOf: (id: string) => Promise<string>,
  now: Date = new Date(),
): Promise<{ ok: true; sent: FeedbackSent } | { ok: false; status: number; problem: string }> {
  const rows = await sentFeedbackRowById(pool, authorId, id);
  if (!rows[0]) return { ok: false, status: 404, problem: "You sent no message with that id." };
  const r = await withdrawFeedbackRow(pool, authorId, id, now);
  if (Number(r?.affectedRows ?? 0) === 0) {
    const status = String(rows[0].status);
    if (status === "withdrawn") return { ok: false, status: 409, problem: "That message was already withdrawn." };
    return { ok: false, status: 409, problem: "That message has already been delivered, so it stays." };
  }
  const after = await sentFeedbackRowById(pool, authorId, id);
  return { ok: true, sent: toSent(after[0], await nameOf(String(after[0].recipient_id)), now) };
}

/** What this member has received: delivered messages only, no author anywhere. */
export async function receivedFeedback(pool: Pool, recipientId: string, now: Date = new Date()): Promise<FeedbackReceived[]> {
  const rows = await receivedFeedbackRows(pool, recipientId, now);
  return rows.map(toReceived);
}

/** The recipient's answer to one delivered message. */
export async function respondFeedback(
  pool: Pool,
  recipientId: string,
  id: string,
  response: FeedbackResponse,
  now: Date = new Date(),
): Promise<FeedbackReceived | null> {
  const r = await respondFeedbackRow(pool, recipientId, id, response, now);
  if (Number(r?.affectedRows ?? 0) === 0) {
    // affectedRows is 0 for an unchanged value too, so read before refusing.
    const mine = (await receivedFeedback(pool, recipientId, now)).find((f) => f.id === id);
    return mine ?? null;
  }
  return (await receivedFeedback(pool, recipientId, now)).find((f) => f.id === id) ?? null;
}

/* -------------------------------------------------------------------------- *
 * Grounding for the guide: this member's own data, and nobody else's.
 * -------------------------------------------------------------------------- */

/** How many recent entries the guide sees, and how much of each answer. */
export const GUIDE_RECENT_ENTRIES = 10;
const GUIDE_ANSWER_CLIP = 400;

/** The member's last few entries, clipped, as the guide reads them. */
export async function recentForGuide(pool: Pool, userId: string, timeZone: string): Promise<unknown[]> {
  const entries = await readEntries(pool, userId, { limit: GUIDE_RECENT_ENTRIES });
  return entries.map((e) => ({
    date: civilDateKey(new Date(e.writtenAt), timeZone),
    practice: e.practice,
    answers: e.answers
      .filter((a) => a.text.trim())
      .map((a) => ({ question: a.prompt, answer: a.text.slice(0, GUIDE_ANSWER_CLIP) })),
    ...(e.scores ? { scores: e.scores } : {}),
    ...(e.confirmed && e.reflection ? { reflection: e.reflection.slice(0, GUIDE_ANSWER_CLIP) } : {}),
  }));
}

/** Gratitude this member received in the last `days` days: a count and up to three messages. */
export async function gratitudeForGuide(
  pool: Pool,
  userId: string,
  now: Date = new Date(),
  days = 14,
): Promise<{ days: number; count: number; recent: string[] }> {
  const rows = await gratitudeReceivedRows(pool, userId, new Date(now.getTime() - days * DAY_MS));
  return {
    days,
    count: rows.length,
    recent: rows
      .map((r) => clipText(r.message, 200))
      .filter(Boolean)
      .slice(0, 3),
  };
}

/* -------------------------------------------------------------------------- *
 * Leaving: erasure and export.
 * -------------------------------------------------------------------------- */

/**
 * Every journal row this member's name is on, gone. What the tombstone calls.
 *
 * DELETED AND NOT ANONYMIZED. The journal holds no value and settles nothing:
 * it is one person's words about their own life, and there is no accounting
 * reason to keep a single one of them.
 *
 * FEEDBACK GOES IN BOTH DIRECTIONS. What they wrote leaves with them, delivered
 * or not, because unsigned words can still carry the writer; what they
 * received leaves with them because it is about them. A recipient who stays
 * loses a delivered message from somebody who left, and that is the price of
 * the leaver's erasure being whole.
 *
 * WHERE THIS IS CALLED FROM. The `journal-after-tombstone` step of the sweep in
 * server/lib/erasure.ts, after the tombstone, where the member's sessions die,
 * so no entry saved through a still-live session can land behind the deletion.
 */
export async function forgetMemberJournal(pool: Pool, userId: string): Promise<number> {
  const uid = String(userId ?? "").trim();
  if (!uid) return 0;
  const gone = await deleteJournalForUser(pool, uid);
  return gone.entries + gone.pulse + gone.prefs + gone.feedback;
}

/**
 * Everything the journal holds about this member, for `GET /api/profile/export`.
 *
 * Received feedback carries the message, when it arrived and how they
 * answered, and nothing else: no author, at any depth. Undelivered messages
 * are not theirs yet and are not here. What they SENT carries the recipient's
 * id, because that half of the act was theirs.
 */
export async function exportMemberJournal(
  pool: Pool,
  userId: string,
  now: Date = new Date(),
): Promise<{
  entries: JournalEntry[];
  pulse: OwnPulseWeek[];
  feedbackPrefs: FeedbackPrefs | null;
  feedbackSent: Array<Omit<FeedbackSent, "recipientName">>;
  feedbackReceived: Array<{ message: string; deliveredAt: string; response: FeedbackResponse }>;
}> {
  const uid = String(userId ?? "").trim();
  const sent = (await sentFeedbackRows(pool, uid)).map((r) => {
    const { recipientName: _drop, ...rest } = toSent(r, "", now);
    return rest;
  });
  const received = (await receivedFeedback(pool, uid, now)).map((f) => ({
    message: f.message,
    deliveredAt: f.deliveredAt,
    response: f.response,
  }));
  return {
    entries: await allEntries(pool, uid),
    pulse: await readOwnPulse(pool, uid),
    feedbackPrefs: await readPrefs(pool, uid),
    feedbackSent: sent,
    feedbackReceived: received,
  };
}
