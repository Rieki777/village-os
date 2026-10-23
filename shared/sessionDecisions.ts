/**
 * Live Sessions: A CIRCLE'S DECISIONS, and when each is reviewed.
 *
 * ONE FILE IS THE CONTRACT for the decision log and review dates, the way
 * shared/sessionRhythm.ts is for when circles meet. The store
 * (server/repos/sessionDecisions.ts), the logic (server/lib/sessionDecisions.ts),
 * the doors (server/routes/sessionDecisions.ts) and "Decisions" on /sessions
 * read their shapes, rules and words from here. The schema is
 * drizzle/0280_a_decision_names_when_it_is_reviewed.sql.
 *
 * WHERE IT COMES FROM. Feature 3 of the sessions program (Rye, 2026-10-22): in
 * sociocracy every agreement is good until it is reviewed. A circle's log
 * lists what it decided by consent, newest first; a decision can carry a
 * review date; and when the date comes, "Review: <the decision>" becomes one
 * of the circle's agenda items (its source is the decision, 0279), so the
 * circle's next session finds it with the rest. A closed session's record is
 * never written to.
 *
 * WHO: the circle's members (standing: in its last meeting, or in one of its
 * seats now, server/lib/circleStanding.ts) and admins read its log and set
 * review dates, the same audience the circle's task cards on its earlier
 * sessions already have. A session's title shows only to somebody who was in
 * it, or an admin.
 *
 * COPY RULES. Platform code carries no village's name. No em-dashes, and every
 * string a member reads lives in this file so the voice gate reads it.
 */
import { CIRCLES_API } from "./sessionRhythm";
import { circleWords } from "./sessionTasks";

// ── Doors ────────────────────────────────────────────────────────────────────

/**
 * Every door. A refusal is `{ error: <a sentence> }` with a 4xx status.
 *
 *   GET /api/sessions/circles/:circleId/decisions                    CircleDecisionLog
 *   PUT /api/sessions/circles/:circleId/decisions/:entryId/review    { reviewOn } -> { decision }
 *
 * `reviewOn` is a village date, YYYY-MM-DD, or null to have no review date.
 */
export function circleDecisionsUrl(circleId: string): string {
  return `${CIRCLES_API}/${encodeURIComponent(circleId)}/decisions`;
}

export function decisionReviewUrl(circleId: string, entryId: number): string {
  return `${circleDecisionsUrl(circleId)}/${entryId}/review`;
}

export const DECISION_LIMITS = {
  /** How far ahead a review date may be. */
  reviewMaxDays: 3 * 366,
  /** How many decisions a log shows, newest first. */
  logSize: 200,
  /** Review dates set, per member, per hour. */
  writesPerHour: 60,
} as const;

/** The quick choices for a review date, in months from today. */
export const REVIEW_CHOICES = [3, 6, 12] as const;
export type ReviewChoice = (typeof REVIEW_CHOICES)[number];

// ── Wire shapes ──────────────────────────────────────────────────────────────

export interface CircleDecision {
  entryId: number;
  text: string;
  /** The village date the session it was decided in closed. */
  decidedOn: string;
  /** That session, only for somebody who was in it or an admin. */
  session: { id: number; title: string } | null;
  review: {
    /** YYYY-MM-DD. */
    on: string;
    /** The date has come. */
    due: boolean;
    /** It became one of the circle's agenda items. */
    brought: boolean;
  } | null;
}

export interface CircleDecisionLog {
  circleId: string;
  decisions: CircleDecision[];
  /** The viewer may set review dates (and reads this log at all). */
  canSetReview: boolean;
  /** Today in the village, YYYY-MM-DD, for the date input's bounds. */
  today: string;
}

// ── Reading a body ───────────────────────────────────────────────────────────

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function realDate(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** A date key some days later. */
export function addDaysTo(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A date key some months later, the day kept where the month has it. */
export function addMonthsTo(key: string, months: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/** A review date from a body: tomorrow up to the furthest allowed, or null for none. */
export function cleanReviewOn(raw: unknown, today: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (b.reviewOn === null) return { ok: true, value: null };
  const v = typeof b.reviewOn === "string" ? b.reviewOn.trim() : "";
  if (!realDate(v)) return { ok: false, error: DECISION_REFUSALS.dateNeeded };
  if (v <= today) return { ok: false, error: DECISION_REFUSALS.pastDate };
  if (v > addDaysTo(today, DECISION_LIMITS.reviewMaxDays)) return { ok: false, error: DECISION_REFUSALS.tooFar };
  return { ok: true, value: v };
}

/** What a review's agenda item says: "Review: <the decision>". */
export function reviewItemText(decisionText: string): string {
  return `Review: ${decisionText.replace(/\s+/g, " ").trim()}`;
}

// ── Words ────────────────────────────────────────────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "22 October 2026". */
export function dateWords(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? ""} ${y}`;
}

export const DECISION_COPY = {
  sectionTitle: "Decisions",
  lede: "What each circle decided by consent, newest first. Give one a review date, and it comes back as an agenda item when the time comes.",
  circleLabel: "Which circle?",
  empty: (circleName: string): string => `The ${circleWords(circleName)} has no decisions yet.`,
  decidedIn: (title: string, date: string): string => `Decided in ${title} on ${date}`,
  decidedOn: (date: string): string => `Decided on ${date}`,
  reviewOn: (date: string): string => `Review on ${date}`,
  reviewDue: "Up for review now",
  reviewBrought: "Its review is one of the circle's agenda items",
  noReview: "No review date",
  setReview: "Set a review date",
  changeReview: "Change the review date",
  inMonths: (months: ReviewChoice): string => (months === 12 ? "In a year" : `In ${months} months`),
  dateLabel: "Or choose a date",
  save: "Save the date",
  clear: "Take the review date off",
  cancel: "Cancel",
  saved: (date: string): string => `Saved. It comes back for review on ${date}.`,
  cleared: "Saved. It has no review date now.",
  failed: "That did not go through. Try again in a moment.",
  loadFailed: "The decisions didn't load. Try again in a moment.",
} as const;

export const DECISION_REFUSALS = {
  notYours: "Only the circle's members and admins can read its decisions and set when they are reviewed.",
  notFound: "That decision isn't one of this circle's.",
  dateNeeded: "Give a date like 2027-04-22.",
  pastDate: "Choose a date after today.",
  tooFar: "Choose a review date in the next three years.",
  circleUnknown: "That circle isn't one of the village's circles now.",
  slowDown: "That was a lot at once. Try again in a little while.",
} as const;
