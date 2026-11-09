/**
 * REVIEW, INTERVIEWS AND SELECTION (role journey, lane L5): the pure half.
 *
 * Everything the server and the pages must agree on lives here with no clock,
 * no database and no request in it: the steps an application passes through,
 * the ordered list of interviewers a role names, the four levels of a
 * scorecard, who may read a scorecard, and the clocks.
 *
 * ── ONE APPLICATION REF ─────────────────────────────────────────────────────
 *
 * An open proposal (`op-...`) and a member's role application (`sa-...`) share
 * these tables. The ref is the existing id: its prefix says which door it came
 * through, so nothing new has to be minted and nothing can point at both.
 *
 * ── THE INTERVIEWERS ARE ROLES, IN ORDER (Rye, 9 Nov 2026, answer 7) ───────
 *
 * A role names an ordered list of interviewing roles, each with its own
 * minutes, and may mark one as the final approval. The next interviewer is
 * asked only after the previous one has scored. The list is stored on the role
 * as JSON, `[{ roleId, minutes, final }]`, and read only through
 * `parseInterviewerRoles`, which drops what it cannot read and never throws.
 *
 * ── SCORES ARE PRIVATE ──────────────────────────────────────────────────────
 *
 * Four levels and one line of evidence per criterion. Never on a ballot, never
 * public, never shown to the applicant. A scorecard is hidden from every other
 * interviewer until their own is in (`mayReadScorecards`).
 *
 * No AI reads any of it: see `SELECTION_IS_HUMAN` and the refusal test.
 */
import { addBusinessDays } from "./businessDays";
import type { CycleClock } from "./cycleClock";
import { civilDateKey } from "./lunar";
import type { OpenProposalTerm } from "./openProposalTerm";

// ── The ref ─────────────────────────────────────────────────────────────────

export type ApplicationKind = "open" | "member";

const OPEN_REF = /^op-[0-9a-f]{20}$/;
const MEMBER_REF = /^sa-[A-Za-z0-9_-]{4,60}$/;

/** The door a ref came through, or null for something that is not an application ref. */
export function kindOfRef(ref: unknown): ApplicationKind | null {
  if (typeof ref !== "string") return null;
  if (OPEN_REF.test(ref)) return "open";
  if (MEMBER_REF.test(ref)) return "member";
  return null;
}

// ── The steps ───────────────────────────────────────────────────────────────

export const STEP_KINDS = ["confirmed", "first_reply", "interview", "scores_in", "consent", "decided", "cleared"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_WORDS: Record<StepKind, string> = {
  confirmed: "Received",
  first_reply: "First reply",
  interview: "Conversation",
  scores_in: "Conversations done",
  consent: "The circle's consent",
  decided: "Decision",
  cleared: "Cleared",
};

// ── How the conversations are booked (D30) ──────────────────────────────────

export const CONVERSATION_MODES = ["block", "split"] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/** A role's setting. By default one block through the first role's link, the others joining at set times; split over days on request. */
export function parseConversationMode(raw: unknown): ConversationMode {
  return raw === "split" ? "split" : "block";
}

/** The line the applicant reads about how their conversations are booked. */
export function bookingWords(mode: ConversationMode, firstRoleName: string | null, total: number): string {
  return mode === "block"
    ? `The conversations are one block of ${minutesWords(total)}, booked through ${firstRoleName ?? "the first role"}, with the others joining at set times. Ask for them to be split over days if that suits you better.`
    : `The conversations are booked one at a time, over several days, each through its own role.`;
}

// ── The interviewers a role names ───────────────────────────────────────────

export interface InterviewerRole {
  roleId: string;
  minutes: number;
  final: boolean;
}

export const INTERVIEW_MIN_MINUTES = 5;
export const INTERVIEW_MAX_MINUTES = 240;
export const INTERVIEW_MAX_COUNT = 6;

/**
 * The role's interviewer list, from the JSON the role stores. Entries without a
 * role id, repeats of a role, and lengths outside 5 to 180 minutes are dropped;
 * a length that is missing reads as 20. At most one entry is the final approval
 * (the first marked one). Never throws.
 */
export function parseInterviewerRoles(raw: unknown): InterviewerRole[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: InterviewerRole[] = [];
  let finalTaken = false;
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const roleId = typeof o.roleId === "string" ? o.roleId.trim().slice(0, 64) : "";
    if (!roleId || out.some((x) => x.roleId === roleId)) continue;
    const m = o.minutes === undefined || o.minutes === null ? 20 : Number(o.minutes);
    if (!Number.isFinite(m) || m < INTERVIEW_MIN_MINUTES || m > INTERVIEW_MAX_MINUTES) continue;
    const final = o.final === true && !finalTaken;
    if (final) finalTaken = true;
    out.push({ roleId, minutes: Math.round(m), final });
    if (out.length >= INTERVIEW_MAX_COUNT) break;
  }
  return out;
}

/** Total interview time in minutes. */
export function totalMinutes(list: readonly { minutes: number }[]): number {
  return list.reduce((n, i) => n + i.minutes, 0);
}

/** "2 hours", "1 hour 30 minutes", "45 minutes". */
export function minutesWords(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = h === 0 ? "" : `${h} hour${h === 1 ? "" : "s"}`;
  const mins = m === 0 ? "" : `${m} minute${m === 1 ? "" : "s"}`;
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

// ── Interviews in order ─────────────────────────────────────────────────────

export const INTERVIEW_STATES = ["waiting", "open", "scored", "skipped"] as const;
export type InterviewState = (typeof INTERVIEW_STATES)[number];

export interface InterviewFacts {
  position: number;
  state: InterviewState;
}

/** The interview that is asked now: the first one not finished, if every earlier one is. Null when all are done. */
export function currentInterview<T extends InterviewFacts>(list: readonly T[]): T | null {
  const sorted = [...list].sort((a, b) => a.position - b.position);
  for (const i of sorted) {
    if (i.state === "scored" || i.state === "skipped") continue;
    return i.state === "open" ? i : null;
  }
  return null;
}

/** The interview that opens after this one scores or is skipped, or null when none is left. */
export function nextAfter<T extends InterviewFacts>(list: readonly T[], position: number): T | null {
  return [...list].sort((a, b) => a.position - b.position).find((i) => i.position > position && i.state === "waiting") ?? null;
}

/** Every interview is scored or skipped. A role with no interviews is done at once. */
export function interviewsDone(list: readonly InterviewFacts[]): boolean {
  return list.every((i) => i.state === "scored" || i.state === "skipped");
}

// ── The scorecard ───────────────────────────────────────────────────────────

export const SCORE_LEVELS = ["strong", "solid", "borderline", "not_yet"] as const;
export type ScoreLevel = (typeof SCORE_LEVELS)[number];

export const LEVEL_WORDS: Record<ScoreLevel, string> = {
  strong: "Strong",
  solid: "Solid",
  borderline: "Borderline",
  not_yet: "Not yet",
};

export const EVIDENCE_MAX = 300;
export const CRITERIA_MAX = 5;

export interface Criterion {
  id: string;
  text: string;
}

/** The criteria a role names, from JSON: `[{ id, text }]` or plain strings. Three to five are good; one to five are read. */
export function parseCriteria(raw: unknown): Criterion[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: Criterion[] = [];
  for (const e of v) {
    const text = typeof e === "string" ? e : e && typeof e === "object" && typeof (e as any).text === "string" ? (e as any).text : "";
    const t = text.trim().slice(0, 200);
    if (!t) continue;
    const given = e && typeof e === "object" && typeof (e as any).id === "string" ? String((e as any).id).trim().slice(0, 40) : "";
    const id = given && !out.some((c) => c.id === given) ? given : `c${out.length + 1}`;
    out.push({ id, text: t });
    if (out.length >= CRITERIA_MAX) break;
  }
  return out;
}

/** Used when a role names none, so a scorecard is never empty. */
export const FALLBACK_CRITERIA: readonly Criterion[] = [{ id: "c1", text: "How well you would work with this role, as you heard it" }];

export interface ScoreEntry {
  criterionId: string;
  level: ScoreLevel;
  evidence: string;
}

export type ScoreParse = { ok: true; entries: ScoreEntry[] } | { ok: false; error: string; field?: string };

/** A submitted scorecard against the criteria: every criterion once, a level from the four, one line of evidence. */
export function parseScoreInput(body: unknown, criteria: readonly Criterion[]): ScoreParse {
  const raw = body && typeof body === "object" ? (body as any).entries : null;
  if (!Array.isArray(raw)) return { ok: false, error: "Send one entry for each criterion.", field: "entries" };
  const entries: ScoreEntry[] = [];
  for (const c of criteria) {
    const e = raw.find((x: any) => x && x.criterionId === c.id);
    if (!e) return { ok: false, error: "Every criterion needs a level and a line of evidence.", field: c.id };
    if (!(SCORE_LEVELS as readonly string[]).includes(e.level)) return { ok: false, error: "Pick one of the four levels.", field: c.id };
    const evidence = typeof e.evidence === "string" ? e.evidence.trim() : "";
    if (!evidence) return { ok: false, error: "Add one line of what you heard.", field: c.id };
    if (evidence.length > EVIDENCE_MAX) return { ok: false, error: `Keep the evidence to ${EVIDENCE_MAX} characters.`, field: c.id };
    entries.push({ criterionId: c.id, level: e.level as ScoreLevel, evidence });
  }
  if (raw.length !== criteria.length) return { ok: false, error: "That does not match the criteria.", field: "entries" };
  return { ok: true, entries };
}

// ── Who may read scorecards ─────────────────────────────────────────────────

export interface ReaderFacts {
  /** The reader is the applicant (by account). Never reads them. */
  isApplicant: boolean;
  /** The reader holds a live role this application names as an interviewer. */
  isInterviewer: boolean;
  /** The reader has submitted a scorecard on this application. */
  hasSubmitted: boolean;
  /** The reader recused. Never reads them. */
  recused: boolean;
  /** The reader holds the power to fill roles (`org.seat`). */
  holdsSeatPower: boolean;
}

/**
 * Scorecards are read by interviewers who have submitted their own, and by
 * holders of the power to fill roles. An interviewer who has not yet submitted
 * reads nothing, even holding that power: reading first would anchor them. The
 * applicant and anyone who stepped out read nothing.
 */
export function mayReadScorecards(f: ReaderFacts): boolean {
  if (f.isApplicant || f.recused) return false;
  if (f.hasSubmitted) return true;
  if (f.isInterviewer) return false;
  return f.holdsSeatPower;
}

// ── The clocks ──────────────────────────────────────────────────────────────

export const FIRST_REPLY_BUSINESS_DAYS = 3;
export const FIRST_REPLY_REMINDER_DAYS = 2;
/** An application that has not moved in this many days surfaces to the role that onboards. */
export const STALE_DAYS = 10;
/** Interviews are due within this many days of opening, for the reminder. */
export const INTERVIEW_DUE_DAYS = 14;

export function firstReplyDueAt(confirmedAt: Date, timeZone: string): Date {
  return addBusinessDays(confirmedAt, FIRST_REPLY_BUSINESS_DAYS, timeZone || "UTC");
}

export function firstReplyReminderAt(confirmedAt: Date, timeZone: string): Date {
  return addBusinessDays(confirmedAt, FIRST_REPLY_REMINDER_DAYS, timeZone || "UTC");
}

export function interviewDueAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + INTERVIEW_DUE_DAYS * 24 * 60 * 60 * 1000);
}

export function isStale(lastMovedAt: Date, now: Date): boolean {
  return now.getTime() - lastMovedAt.getTime() >= STALE_DAYS * 24 * 60 * 60 * 1000;
}

// ── The applicant's status page ─────────────────────────────────────────────

export interface StatusInput {
  decided: "adopted" | "declined" | "withdrawn" | null;
  firstReplyAt: Date | null;
  confirmedAt: Date;
  interviews: Array<{ position: number; state: InterviewState; roleName: string; minutes: number; final: boolean; dueAt: Date | null }>;
  consentOpen: boolean;
  consentClosesAt: Date | null;
  timeZone: string;
}

export interface Status {
  step: StepKind;
  stepWords: string;
  /** Who acts next, by role. Never a person, never a score. */
  actsNext: string;
  by: Date | null;
  /** The ordered path, for a progress list. */
  path: Array<{ label: string; state: "done" | "now" | "later" }>;
}

/** What the applicant reads: the step, who acts next and by when. Never a score, never a name. */
export function statusFor(i: StatusInput): Status {
  const path: Status["path"] = [{ label: STEP_WORDS.confirmed, state: "done" }];
  path.push({ label: STEP_WORDS.first_reply, state: i.firstReplyAt ? "done" : "later" });
  for (const iv of i.interviews) path.push({ label: `Conversation with ${iv.roleName} (${iv.minutes} minutes)`, state: iv.state === "scored" || iv.state === "skipped" ? "done" : iv.state === "open" ? "now" : "later" });
  const interviewing = i.interviews.some((v) => v.state === "open");
  const done = i.interviews.every((v) => v.state === "scored" || v.state === "skipped");
  path.push({ label: STEP_WORDS.consent, state: i.decided ? "done" : done && i.firstReplyAt ? "now" : "later" });
  path.push({ label: STEP_WORDS.decided, state: i.decided ? "done" : "later" });

  if (i.decided) return { step: "decided", stepWords: STEP_WORDS.decided, actsNext: "Nobody. The village has answered.", by: null, path };
  if (!i.firstReplyAt) {
    path[1] = { label: STEP_WORDS.first_reply, state: "now" };
    return { step: "first_reply", stepWords: STEP_WORDS.first_reply, actsNext: "The role that welcomes people replies with a time to talk.", by: firstReplyDueAt(i.confirmedAt, i.timeZone), path };
  }
  if (interviewing) {
    const cur = i.interviews.find((v) => v.state === "open")!;
    return { step: "interview", stepWords: STEP_WORDS.interview, actsNext: `${cur.roleName} talks with you for ${cur.minutes} minutes, then adds a note.`, by: cur.dueAt, path };
  }
  if (!done) return { step: "interview", stepWords: STEP_WORDS.interview, actsNext: "The next conversation is arranged once the last one is written up.", by: null, path };
  return { step: "consent", stepWords: STEP_WORDS.consent, actsNext: "The circle weighs it and consents, or says what is missing.", by: i.consentOpen ? i.consentClosesAt : null, path };
}

// ── Words (no dashes, role not seat) ────────────────────────────────────────

export const REVIEW_WORDS = {
  turnTitle: (applicant: string | null, minutes: number) => `${applicant ?? "An applicant"} is waiting to talk with you for ${minutes} minutes`,
  turnBody: "Book the conversation from the applicant's ask, then write your scorecard alone, against the role's criteria, before you read anyone else's.",
  firstReplyDue: (roleNames: readonly string[]) => `A first reply is due for an application for ${roleNames.join(", ")}`,
  firstReplyReminder: (roleNames: readonly string[]) => `A first reply is due tomorrow for ${roleNames.join(", ")}`,
  stale: (roleNames: readonly string[]) => `An application for ${roleNames.join(", ")} has not moved in ${STALE_DAYS} days`,
  interviewsDone: (roleNames: readonly string[]) => `Every conversation is written up for ${roleNames.join(", ")}`,
  consentWaitsForInterviews: "The circle will be asked once the conversations are written up.",
  agentsSkipped: (names: readonly string[]) => `${names.join(", ")} ${names.length === 1 ? "is" : "are"} held by an AI agent and not asked: consent is a human act.`,
  splitAsked: "Recorded. The conversations will be booked over several days.",
  splitTooLate: "The conversations have started, so they stay as booked.",
  arrived: (roleNames: readonly string[]) => `An application arrived for ${roleNames.join(", ")}`,
  notYourTurn: "That conversation has not opened yet. It opens when the one before it is written up.",
  alreadyScored: "That scorecard is already in.",
  notAnInterviewer: "Only a holder of the role this conversation is with can write this scorecard.",
  own: "Nobody scores their own application.",
  recused: "You stepped out of this one.",
  notFound: "That application is not here.",
  gone: "That application has been decided, so scores can no longer be added.",
  mayNotRead: "Scorecards open to you once you have added your own.",
  interviewsNotDone: "The conversations are not all written up yet.",
  recusalRecorded: "Recorded. You will not be asked again for this application.",
  alignWords: "Aligning is the village's way of signing.",
} as const;

/** Sera, the guide and every companion are refused these reads. Tested, not trusted. */
export const SELECTION_IS_HUMAN = ["application_scores", "application_interviews", "application_recusals", "application_steps"] as const;

// ── The moon running now ────────────────────────────────────────────────────

/**
 * THE MOON RUNNING NOW, whatever is left of it. `moonTermFor` rolls to the next
 * moon when fewer than 7 days remain, which is right for a proposal being sent;
 * a holder adopting an application whose moon has ended means the moon that is
 * running, so this reads the clock's bounds at `now` and nothing else.
 */
export function currentMoonTerm(now: Date, clock: CycleClock, timeZone: string): OpenProposalTerm {
  const b = clock.boundsFor(now);
  return { kind: "moon", startsOn: civilDateKey(b.startsAt, timeZone), endsOn: civilDateKey(new Date(b.endsAt.getTime() - 1), timeZone) };
}

/** Whether a stored moon term ended before today, so the door must offer the moon running now. */
export function moonEnded(term: OpenProposalTerm | undefined | null, now: Date, timeZone: string): boolean {
  return !!term && civilDateKey(now, timeZone) > term.endsOn;
}

// ── The words the pages show ────────────────────────────────────────────────

export const PANEL_WORDS = {
  heading: "Conversations and scorecards",
  intro: "Each role the applicant talks with writes a scorecard alone, against the criteria, before reading anyone else's. Scorecards are never shown to the applicant and never reach a ballot.",
  yourTurn: (minutes: number) => `It is your turn: a ${minutes} minute conversation. Write your scorecard when you have talked.`,
  hidden: REVIEW_WORDS.mayNotRead,
  levelLabel: "Level",
  evidenceLabel: "One line of what you heard",
  submit: "Add my scorecard",
  submitted: "Your scorecard is in.",
  recuse: "Step out of this application",
  recuseAsk: "Stepping out is recorded. You will not be asked about this application again.",
  recuseYes: "Yes, step out",
  recuseNo: "Stay",
  reasonLabel: "Why (optional, one line)",
  waiting: "Waiting",
  open: "Open now",
  scored: "Written up",
  skipped: "Skipped",
  final: "Final approval",
  minutes: (n: number) => `${n} minutes`,
  adoptThisMoon: "Adopt for the moon running now",
  toTheVillage: "Take it to the village's vote",
  toTheVillageLine: "Nobody can adopt this at the door. It becomes an application the village can vote on.",
  statusHeading: "Where your application is",
  statusNext: "Who acts next",
  statusBy: (day: string) => `By ${day}`,
  statusMissing: "That link does not match an application. Check the link in your email.",
  splitAsk: "Split the conversations over days",
  bookingLabel: "How the conversations are booked",
  statusPrivate: "This page shows steps only. What the people who talk with you write down stays with them.",
} as const;
