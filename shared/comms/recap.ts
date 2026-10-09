/**
 * AFTER A GATHERING: who came, the recap, and the two questions, as values
 * and pure rules (the comms build spec 5.9).
 *
 * The host ticks who came, writes a few lines, and presses send. People who
 * came get the recap; people who said yes and missed it get the same recap
 * with a note of their own. Each email asks the village's two questions as
 * one-click links and offers the next gathering, and every answer lands in
 * `event_feedback`, where the host reads it.
 *
 * NOBODY IS TOLD THEY WERE MISSED UNLESS THE HOST SAID SO. With no attendance
 * marked, everybody who said yes gets the "came" version, whose words read
 * right either way (the spec says so). With attendance marked, only a person
 * the host marked `missed` gets the missed version; somebody the host never
 * ticked either way still gets the warm one.
 *
 * Pure and isomorphic: the host's panel and the server read the same shapes.
 */
import type { ModuleLifecycle } from "../modules";

/** The two questions, by the key `event_feedback.question_key` stores. */
export const RECAP_QUESTION_KEYS = ["q1", "q2"] as const;
export type RecapQuestionKey = (typeof RECAP_QUESTION_KEYS)[number];

/** Question one is answered yes or no on the action page; question two in words. */
export const RECAP_YES_NO = ["yes", "no"] as const;
export type RecapYesNo = (typeof RECAP_YES_NO)[number];

export const RECAP_ANSWER_MAX = 1000;
export const RECAP_BODY_MAX = 20_000;
export const RECAP_NOTE_MAX = 5_000;
export const RECORDING_URL_MAX = 500;

/** How long a recap's answer links work. Answers come in slowly. */
export const RECAP_LINK_DAYS = 30;
/** A recap still unsent this long after the host pressed send is dropped (5.1). */
export const RECAP_EXPIRY_DAYS = 7;

export const ATTENDANCE_MARKS = ["came", "missed"] as const;
export type AttendanceMark = (typeof ATTENDANCE_MARKS)[number];

const DAY_MS = 86_400_000;

/**
 * Who gets which version.
 *
 * `going` is everybody who said yes, in the order to send. `marks` is the
 * attendance the host saved. A person marked `came` who never said yes (they
 * turned up anyway) gets the came version too, after the people who did.
 */
export function recapAudience(
  going: readonly string[],
  marks: ReadonlyMap<string, AttendanceMark>,
): { came: string[]; missed: string[] } {
  const seen = new Set<string>();
  const came: string[] = [];
  const missed: string[] = [];
  for (const key of going) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (marks.get(key) === "missed") missed.push(key);
    else came.push(key);
  }
  for (const [key, mark] of Array.from(marks.entries())) {
    if (mark === "came" && !seen.has(key)) {
      seen.add(key);
      came.push(key);
    }
  }
  return { came, missed };
}

/** The facts `recapSendRefusal` reads. Times are epoch milliseconds. */
export interface RecapSendFacts {
  /** `event_recaps.state`, or null when nothing is written yet. */
  state: string | null;
  bodyMd: string;
  startsAt: number;
  endsAt: number | null;
  now: number;
  /** The `comms.recap_window_days` dial. */
  windowDays: number;
  commsLifecycle: ModuleLifecycle;
}

/** Why the recap cannot go now, in words for the host, or null when it can. */
export function recapSendRefusal(f: RecapSendFacts): string | null {
  if (f.state === "sent") return "Already sent.";
  if (!f.bodyMd.trim()) return "Write the recap first.";
  if (f.commsLifecycle === "off") return "Village email is off. Turn on Village Comms to send recaps.";
  if (f.now < f.startsAt) return "Opens once the gathering begins.";
  if (f.now > recapWindowClosesAt(f)) return "The time to send this recap has passed.";
  return null;
}

/** When the last moment to send a recap is: the end (or the start) plus the window. */
export function recapWindowClosesAt(f: Pick<RecapSendFacts, "startsAt" | "endsAt" | "windowDays">): number {
  const days = Math.max(1, Math.trunc(f.windowDays) || 1);
  return (f.endsAt ?? f.startsAt) + days * DAY_MS;
}

/**
 * "Draft it for me": a first draft from what we know, for the host to read and
 * change before anything goes. It never sends (Rye's ruling of 2026-09-24),
 * and it says nothing it does not know.
 *
 * `came` is how many the host ticked as came, or null when nobody is marked;
 * then the count is of people who said yes, and the words say so.
 */
export function draftRecap(f: { title: string; dateLine: string; came: number | null; going: number; notes: string }): string {
  const title = f.title.trim() || "the gathering";
  const on = f.dateLine.trim() ? ` on ${f.dateLine.trim()}` : "";
  let opening: string;
  if (f.came !== null && f.came > 0) {
    opening = `${f.came === 1 ? "One of us" : `${f.came} of us`} came to ${title}${on}.`;
  } else if (f.going > 0) {
    opening = `${f.going === 1 ? "One person" : `${f.going} people`} said yes to ${title}${on}.`;
  } else {
    opening = `We met for ${title}${on}.`;
  }
  const notes = f.notes.replace(/\r\n/g, "\n").trim();
  return [opening, notes || "Thank you to everyone who came.", ...(notes ? ["Thank you to everyone who came."] : [])].join("\n\n");
}

// ── The next gathering ──────────────────────────────────────────────────────

/** One evening the recap could offer next: a calendar item's fields that matter here. */
export interface NextCandidate {
  id: string;
  occurrenceKey: string;
  title: string;
  /** ISO instant. */
  startsAt: string;
  status: string;
  layer: string;
  kind: string;
  seatPrice?: number;
}

/**
 * Every evening the recap could offer, best first: the next evening of the
 * same series, then the soonest other gathering. Only scheduled gatherings
 * and festivals in `layers` that start after `now`, and never the evening
 * being recapped. The caller walks the list and takes the first one the
 * reader can actually answer (a guest needs a gathering open to guests).
 */
export function nextGatheringOrder(
  items: readonly NextCandidate[],
  f: { eventId: string; occurrenceKey: string; now: number; layers: readonly string[] },
): NextCandidate[] {
  const open = items.filter(
    (c) =>
      c.status === "scheduled" &&
      (c.kind === "gathering" || c.kind === "festival") &&
      f.layers.includes(c.layer) &&
      Date.parse(c.startsAt) > f.now &&
      !(c.id === f.eventId && c.occurrenceKey === f.occurrenceKey),
  );
  const at = (c: NextCandidate) => Date.parse(c.startsAt);
  const sameSeries = open.filter((c) => c.id === f.eventId).sort((a, b) => at(a) - at(b));
  const others = open.filter((c) => c.id !== f.eventId).sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
  return [...sameSeries, ...others];
}

/** Where the host's composer opens for one evening: the calendar, scrolled to the recap. The host nudge links here. */
export function recapComposerPath(eventId: string, occurrenceKey: string): string {
  return `/events?recap=${encodeURIComponent(eventId)}${occurrenceKey ? `&occ=${encodeURIComponent(occurrenceKey)}` : ""}`;
}

// ── What the host's panel reads ─────────────────────────────────────────────

/** One person on the attendance list. Never an address. */
export interface AttendancePerson {
  personKey: string;
  /** Their name, or null for a member who has since left or a guest who gave none. */
  name: string | null;
  guest: boolean;
  /** Their answer to the gathering, or null when they only have a mark. */
  answer: "going" | "maybe" | "declined" | null;
  mark: AttendanceMark | null;
}

export interface AttendanceView {
  manage: true;
  eventId: string;
  occurrenceKey: string;
  /** False until the evening has begun; marks are refused before then. */
  started: boolean;
  people: AttendancePerson[];
  /** True once the host has marked anybody. */
  marked: boolean;
}

/** One answer to one of the two questions, as the host reads it. */
export interface RecapAnswerRow {
  personKey: string;
  name: string | null;
  guest: boolean;
  questionKey: RecapQuestionKey;
  answer: string;
  /** Epoch seconds. */
  at: number;
}

export interface RecapDraft {
  bodyMd: string;
  missedNoteMd: string;
  recordingUrl: string;
  state: "draft" | "sent";
  /** Epoch seconds, or null while a draft. */
  sentAt: number | null;
}

export interface RecapView {
  manage: true;
  eventId: string;
  occurrenceKey: string;
  title: string;
  startsAt: string;
  recap: RecapDraft | null;
  /** Who the send would reach right now, by version. */
  audience: { came: number; missed: number };
  questions: [string, string];
  answers: RecapAnswerRow[];
  /** Whether send would go now, and the sentence when it would not. */
  sendable: { ok: boolean; reason: string | null };
  /** The last moment the recap can be sent, ISO. */
  closesAt: string;
  next: { title: string; when: string } | null;
}
