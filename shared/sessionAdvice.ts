/**
 * Live Sessions: THE ADVICE PROCESS. A member who means to decide something
 * that touches others asks the people it touches first.
 *
 * ONE FILE IS THE CONTRACT, the way shared/sessionDecisions.ts is for a
 * circle's decisions. The store (server/repos/sessionAdvice.ts), the logic
 * (server/lib/sessionAdvice.ts), the doors (server/routes/sessionAdvice.ts) and
 * "Asking for advice" on /sessions read their shapes, rules and words from
 * here. The schema is drizzle/0284_a_member_asks_a_circle_for_advice.sql.
 *
 * WHERE IT COMES FROM. Feature 4 of the sessions program (Rye, 2026-10-22). In
 * a self-managing organisation anybody may decide, once they have asked the
 * people their decision touches and the people who know the ground. Nobody
 * has to follow the advice; everybody has to be asked. Here a member names
 * what they mean to decide, why, and by when, and asks a circle: everybody
 * with standing in it (in its last meeting, or holding one of its roles now)
 * is asked, the asker aside. Each answers in their own words, and can change
 * them until the decision. The asker records what they decided and how the
 * advice shaped it, or withdraws the request.
 *
 * WHO READS A REQUEST: whoever asked, and the people asked. The advice is
 * open between them, which is the point of the process: everybody asked sees
 * what the others said.
 *
 * COPY RULES. Platform code carries no village's name. No em-dashes, and every
 * string a member reads lives in this file so the voice gate reads it.
 */
import { SESSIONS_API, cleanText } from "./sessions";
import { addDaysTo, dateWords } from "./sessionDecisions";
import { circleWords } from "./sessionTasks";

// ── Doors ────────────────────────────────────────────────────────────────────

/**
 * Every door. A refusal is `{ error: <a sentence> }` with a 4xx status.
 *
 *   GET  /api/sessions/advice/requests                  AdvicePayload
 *   POST /api/sessions/advice/requests                  { circleId, intent, context, decideBy } -> { request }
 *   PUT  /api/sessions/advice/requests/:id/advice       { advice } -> { request }
 *   POST /api/sessions/advice/requests/:id/decide       { decision } -> { request }
 *   POST /api/sessions/advice/requests/:id/withdraw     -> { request }
 *
 * Three segments and more, so no door is ever read as a room's
 * (`/api/sessions/:id`). `decideBy` is a village date, YYYY-MM-DD.
 */
export const ADVICE_API = `${SESSIONS_API}/advice/requests`;

export const adviceRequestUrl = (id: number): string => `${ADVICE_API}/${id}`;
export const adviceGiveUrl = (id: number): string => `${adviceRequestUrl(id)}/advice`;
export const adviceDecideUrl = (id: number): string => `${adviceRequestUrl(id)}/decide`;
export const adviceWithdrawUrl = (id: number): string => `${adviceRequestUrl(id)}/withdraw`;

export const ADVICE_LIMITS = {
  intent: 600,
  context: 1200,
  advice: 1200,
  decision: 600,
  /** How far ahead the decide-by date may be, in days from today. */
  decideByMaxDays: 60,
  /** Requests one member may have open at once. */
  openPerAsker: 10,
  /** People one request may ask: a circle larger than this asks its first sixty by standing. */
  askedMax: 60,
  /** Settled requests the list keeps, newest first, beside every open one. */
  settledShown: 20,
  /** Writes per member, per hour. */
  writesPerHour: 60,
} as const;

/** The quick choices for the decide-by date, in days from today. */
export const DECIDE_BY_CHOICES = [3, 7, 14] as const;
export type DecideByChoice = (typeof DECIDE_BY_CHOICES)[number];

export const ADVICE_STATUSES = ["open", "decided", "withdrawn"] as const;
export type AdviceStatus = (typeof ADVICE_STATUSES)[number];

export function isAdviceStatus(v: unknown): v is AdviceStatus {
  return typeof v === "string" && (ADVICE_STATUSES as readonly string[]).includes(v);
}

// ── Wire shapes ──────────────────────────────────────────────────────────────

/** One person's advice on a request. */
export interface AdviceGiven {
  by: string;
  words: string;
  /** When they last changed it, an ISO instant. */
  at: string;
  /** The village date of that, YYYY-MM-DD. */
  on: string;
  mine: boolean;
}

export interface AdviceRequestCard {
  id: number;
  circleId: string;
  circleName: string;
  askerName: string;
  /** The viewer asked. */
  mine: boolean;
  intent: string;
  context: string | null;
  /** YYYY-MM-DD, a village date. */
  decideBy: string;
  status: AdviceStatus;
  decision: string | null;
  /** The village date it was decided or withdrawn. */
  settledOn: string | null;
  /** How many people were asked. */
  askedCount: number;
  advice: AdviceGiven[];
  /** The viewer was asked and the request is open. */
  canAdvise: boolean;
  /** The viewer's own advice, for the form. */
  myAdvice: string | null;
  /** The viewer asked and the request is open. */
  canDecide: boolean;
}

export interface AdvicePayload {
  /** Requests the viewer was asked about: open first, then the latest settled. */
  askedOfMe: AdviceRequestCard[];
  /** Requests the viewer made: open first, then the latest settled. */
  mine: AdviceRequestCard[];
  /** The circles the viewer may ask. */
  circles: { id: string; name: string }[];
  /** Today in the village, YYYY-MM-DD, for the date input's bounds. */
  today: string;
}

// ── Reading a body ───────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

type Clean<T> = { ok: true; value: T } | { ok: false; error: string };

const bodyOf = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});

/** A request for advice from a body: a live circle, what and why, and a decide-by date from tomorrow to sixty days ahead. */
export function cleanAdviceAsk(
  raw: unknown,
  liveCircleIds: ReadonlySet<string>,
  today: string,
): Clean<{ circleId: string; intent: string; context: string | null; decideBy: string }> {
  const b = bodyOf(raw);
  const circleId = typeof b.circleId === "string" ? b.circleId : "";
  if (!liveCircleIds.has(circleId)) return { ok: false, error: ADVICE_REFUSALS.circleUnknown };
  const intent = cleanText(b.intent, ADVICE_LIMITS.intent);
  if (!intent) return { ok: false, error: ADVICE_REFUSALS.intentNeeded };
  const context = cleanText(b.context, ADVICE_LIMITS.context);
  const decideBy = typeof b.decideBy === "string" ? b.decideBy.trim() : "";
  if (!realDate(decideBy)) return { ok: false, error: ADVICE_REFUSALS.dateNeeded };
  if (decideBy <= today) return { ok: false, error: ADVICE_REFUSALS.pastDate };
  if (decideBy > addDaysTo(today, ADVICE_LIMITS.decideByMaxDays)) return { ok: false, error: ADVICE_REFUSALS.tooFar };
  return { ok: true, value: { circleId, intent, context, decideBy } };
}

/** One person's advice from a body: their words, never empty. */
export function cleanAdvice(raw: unknown): Clean<string> {
  const words = cleanText(bodyOf(raw).advice, ADVICE_LIMITS.advice);
  return words ? { ok: true, value: words } : { ok: false, error: ADVICE_REFUSALS.adviceNeeded };
}

/** What the asker decided, from a body, never empty. */
export function cleanDecision(raw: unknown): Clean<string> {
  const words = cleanText(bodyOf(raw).decision, ADVICE_LIMITS.decision);
  return words ? { ok: true, value: words } : { ok: false, error: ADVICE_REFUSALS.decisionNeeded };
}

// ── Words ────────────────────────────────────────────────────────────────────

export const ADVICE_COPY = {
  sectionTitle: "Asking for advice",
  lede: "Before you decide something that touches others, ask the people it touches. You still decide, once you have heard them.",
  askButton: "Ask for advice",
  askTitle: "Ask a circle for advice",
  circleLabel: "Which circle should advise?",
  intentLabel: "What do you mean to decide?",
  contextLabel: "Why, and what you know so far (optional)",
  decideByLabel: "I will decide by",
  inDays: (days: DecideByChoice): string => (days === 7 ? "In a week" : days === 14 ? "In two weeks" : `In ${days} days`),
  send: "Ask for advice",
  cancel: "Cancel",
  asked: (circleName: string, count: number): string => `Asked the ${circleWords(circleName)}: ${count} ${count === 1 ? "person" : "people"}.`,
  askedOfMeTitle: "Asked of you",
  mineTitle: "Your requests",
  nothingAsked: "Nobody has asked you for advice yet.",
  nothingMine: "You have not asked for advice yet.",
  fromWho: (asker: string, circleName: string): string => `${asker} asks the ${circleWords(circleName)}`,
  youAsked: (circleName: string): string => `You asked the ${circleWords(circleName)}`,
  decideByLine: (date: string): string => `Decides by ${dateWords(date)}`,
  decideByPassed: (date: string): string => `The decide-by date was ${dateWords(date)}`,
  adviceCount: (given: number, asked: number): string => `${given} of ${asked} ${asked === 1 ? "person" : "people"} gave advice`,
  noAdviceYet: "No advice yet.",
  adviceBy: (name: string): string => `${name} advises`,
  yourAdvice: "Your advice",
  giveAdvice: "Give my advice",
  changeAdvice: "Change my advice",
  decisionLabel: "What did you decide, and how did the advice shape it?",
  recordDecision: "Record my decision",
  withdraw: "Withdraw the request",
  withdrawConfirm: "Withdraw it? The people you asked will no longer be able to add advice.",
  withdrawYes: "Withdraw",
  keep: "Keep it open",
  decided: (date: string): string => `Decided on ${dateWords(date)}`,
  withdrawn: (date: string): string => `Withdrawn on ${dateWords(date)}`,
  saved: "Saved.",
  savedAdvice: (asker: string): string => `Your advice to ${asker} is saved.`,
  savedDecision: "Your decision is recorded, and the people you asked will hear it.",
  savedWithdrawn: "The request is withdrawn.",
  failed: "That did not go through. Try again in a moment.",
  loadFailed: "The requests for advice didn't load.",
  retry: "Try again",
  loading: "Loading the requests for advice.",
} as const;

export const ADVICE_REFUSALS = {
  circleUnknown: "Choose one of the village's circles.",
  intentNeeded: "Say what you mean to decide.",
  dateNeeded: "Give a date like 2026-11-07.",
  pastDate: "Choose a date after today.",
  tooFar: "Choose a date in the next sixty days.",
  nobodyToAsk: "Nobody else has standing in that circle yet, so there is nobody to ask.",
  tooManyOpen: `You have ${ADVICE_LIMITS.openPerAsker} requests open. Decide or withdraw one first.`,
  notFound: "That request for advice is not one you can see.",
  notAsked: "Only the people asked can give advice on this request.",
  notYours: "Only the person who asked can do that.",
  settled: "That request is decided or withdrawn already.",
  adviceNeeded: "Say your advice in a few words.",
  decisionNeeded: "Say what you decided.",
  slowDown: "That was a lot at once. Try again in a little while.",
  notOpenYet: "Asking for advice reaches people once Live Sessions is open to members.",
} as const;

/** The bells (bell only, server/lib/notify.ts). */
export const ADVICE_NOTICES = {
  asked: (asker: string, circleName: string): string => `${asker} asks the ${circleWords(circleName)} for advice`,
  given: (advisor: string): string => `${advisor} gave advice on what you mean to decide`,
  decided: (asker: string): string => `${asker} decided, after asking for your advice`,
} as const;
