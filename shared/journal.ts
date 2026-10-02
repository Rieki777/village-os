/**
 * The Journal: one member's own practice, and the few numbers a village may
 * read back from it.
 *
 * ONE FILE IS THE CONTRACT. The server routes (server/routes/journal.ts), the
 * store (server/lib/journal.ts) and the page (client/src/pages/Journal.tsx)
 * all read their shapes and their words from here, so a question renamed in
 * this file is renamed on every surface at once and a client can never render
 * an answer against a stale copy of the prompt it answered.
 *
 * WHERE THE IDEA COMES FROM. Two asks, merged. A founder asked for a daily
 * practice (morning and evening, light or deep), a weekly pulse on how the
 * team is really doing, and a kind road for feedback that would otherwise go
 * unsaid. A steward asked for an interviewer after each call that writes the
 * reasoning down and only promotes what the person confirms. Both are the same
 * act at different depths: a person answering good questions, in their own
 * words, with a guide that reflects back and never speaks for them.
 *
 * THE PRIVACY LINE, which every shape below follows:
 *   - An entry is its author's. No route returns one to anybody else, an admin
 *     included. There is no admin read.
 *   - The pulse's NUMBERS aggregate (above a floor the village sets, one by
 *     default). Its words stay in the author's entry.
 *   - Feedback reaches its recipient only, unsigned, in words the author
 *     approved, and only when the recipient said they want it.
 *   - Nothing here is ever written to an event, because `recordEvent` defaults
 *     to a public audience.
 *
 * COPY RULES. Platform code carries no village's name, so prompts say
 * `{village}` and the page fills it from the brand. No em-dashes.
 */

// ── Practices ────────────────────────────────────────────────────────────────

export const JOURNAL_PRACTICES = ["morning", "evening", "pulse", "debrief", "free"] as const;
export type JournalPractice = (typeof JOURNAL_PRACTICES)[number];

export function isJournalPractice(v: unknown): v is JournalPractice {
  return typeof v === "string" && (JOURNAL_PRACTICES as readonly string[]).includes(v);
}

/** Light is the few questions anybody can answer in two minutes. Deep adds the rest. */
export const JOURNAL_DEPTHS = ["light", "deep"] as const;
export type JournalDepth = (typeof JOURNAL_DEPTHS)[number];

export function isJournalDepth(v: unknown): v is JournalDepth {
  return typeof v === "string" && (JOURNAL_DEPTHS as readonly string[]).includes(v);
}

/**
 * The three privacy tiers a steward's debrief carries into their own notes.
 * Everything in the journal is held privately whatever this says; the tier
 * only travels with an EXPORT, so a person's own second brain knows what it
 * may later share.
 */
export const JOURNAL_PRIVACY = ["private", "internal", "clear"] as const;
export type JournalPrivacy = (typeof JOURNAL_PRIVACY)[number];

export function isJournalPrivacy(v: unknown): v is JournalPrivacy {
  return typeof v === "string" && (JOURNAL_PRIVACY as readonly string[]).includes(v);
}

export interface JournalQuestion {
  /** Stable id. Written into each answer, so never renamed once shipped. */
  key: string;
  /** The question, with `{village}` where the village's name belongs. */
  prompt: string;
  /** A softer second line under the question, when it helps. */
  hint?: string;
  /** Asked in the light pass too. Every question is asked in the deep pass. */
  light: boolean;
}

export interface JournalPracticeDef {
  id: JournalPractice;
  label: string;
  /** One line under the label on the picker. */
  blurb: string;
  /** How often a person is invited to it. Display only; nothing enforces it. */
  rhythm: "daily" | "weekly" | "after a call" | "any time";
  questions: JournalQuestion[];
}

export const JOURNAL_PRACTICE_DEFS: Record<JournalPractice, JournalPracticeDef> = {
  morning: {
    id: "morning",
    label: "Morning",
    blurb: "Arrive into the day before the day arrives into you.",
    rhythm: "daily",
    questions: [
      { key: "arrival", prompt: "How did you sleep, and how are you arriving into today?", light: true },
      { key: "one-thing", prompt: "What one thing would make today feel well spent?", light: true },
      { key: "protect", prompt: "What do you want to protect today?", hint: "Time, energy, a boundary, a person.", light: true },
      { key: "rhythm", prompt: "What rhythm do you want to keep today?", hint: "When you wake, move, rest, and when the phone comes on.", light: false },
      { key: "body", prompt: "What is your body asking for this morning?", light: false },
      { key: "grateful", prompt: "What are you grateful for right now?", light: false },
      { key: "commitment", prompt: "Which quest or commitment are you moving forward today?", light: false },
    ],
  },
  evening: {
    id: "evening",
    label: "Evening",
    blurb: "Close the day kindly and notice what it asked of you.",
    rhythm: "daily",
    questions: [
      { key: "nourished", prompt: "Did you nourish yourself today?", hint: "Food, rest, movement, people, nature.", light: true },
      { key: "went-well", prompt: "What went well today?", light: true },
      { key: "gave-more", prompt: "Where did you give more than you had?", light: true },
      { key: "late-work", prompt: "When did you last answer a message or do work, and did it need to happen then?", light: false },
      { key: "differently", prompt: "What would you do differently tomorrow?", light: false },
      { key: "thank", prompt: "Who would you like to thank?", hint: "You can send them gratitude from here.", light: false },
      { key: "let-go", prompt: "What are you letting go of before sleep?", light: false },
    ],
  },
  pulse: {
    id: "pulse",
    label: "Weekly pulse",
    blurb: "How the week really felt. Your numbers join the village's; your words stay yours.",
    rhythm: "weekly",
    questions: [
      { key: "help-most", prompt: "What would help the team most this week?", light: true },
      { key: "meetings", prompt: "Is there anything in how we meet that could flow better?", light: false },
      { key: "tension", prompt: "Is anything between you and someone on the team asking for attention?", hint: "This stays in your journal. The guide can help you turn it into feedback if you want.", light: false },
    ],
  },
  debrief: {
    id: "debrief",
    label: "Call debrief",
    blurb: "Five questions after a call, while the reasoning is still warm.",
    rhythm: "after a call",
    questions: [
      { key: "decided", prompt: "What got decided?", light: true },
      { key: "why", prompt: "Why that, and what else was on the table?", light: true },
      { key: "holds", prompt: "Which seat holds it now, and by when?", light: true },
      { key: "tension", prompt: "What tension is still open?", light: true },
      { key: "new-player", prompt: "If a new player asked about this, what would you tell them?", light: true },
      { key: "game", prompt: "What game is this?", hint: "A quest, a vote, a seat, a moon, a tension.", light: false },
      { key: "elsewhere", prompt: "Would you decide it the same way in another village?", light: false },
      { key: "differently", prompt: "What would you have done differently?", light: false },
    ],
  },
  free: {
    id: "free",
    label: "Open page",
    blurb: "Whatever is on your mind.",
    rhythm: "any time",
    questions: [{ key: "free", prompt: "What is on your mind?", light: true }],
  },
};

/** The questions one pass asks, in order. */
export function questionsFor(practice: JournalPractice, depth: JournalDepth): JournalQuestion[] {
  const all = JOURNAL_PRACTICE_DEFS[practice].questions;
  return depth === "deep" ? all : all.filter((q) => q.light);
}

/** Fill `{village}` in a prompt. One function, so no surface spells it twice. */
export function fillVillage(text: string, villageName: string): string {
  return text.split("{village}").join(villageName || "the village");
}

// ── The pulse's numbers ──────────────────────────────────────────────────────

export interface PulseMetricDef {
  key: string;
  prompt: string;
  min: number;
  max: number;
  /** The words at each end of the scale, low first. */
  ends: [string, string];
}

/**
 * Five numbers, asked weekly. The energy scale is centred on purpose: giving
 * far more than you receive and receiving far more than you give are both
 * signals, and a 1-to-5 scale would read the second as "good".
 */
export const PULSE_METRICS: PulseMetricDef[] = [
  { key: "confidence", prompt: "How confident are you in {village} right now?", min: 1, max: 5, ends: ["Shaky", "Strong"] },
  { key: "coherence", prompt: "How coherent does the team feel?", min: 1, max: 5, ends: ["Scattered", "In tune"] },
  { key: "energy", prompt: "Energy given and energy received this week", min: -2, max: 2, ends: ["Giving far more", "Receiving far more"] },
  { key: "load", prompt: "How heavy was the load this week?", min: 1, max: 5, ends: ["Light", "Too much"] },
  { key: "space", prompt: "Did you have the space you needed in our calls?", min: 1, max: 5, ends: ["No room", "Plenty"] },
];

export type PulseScores = Record<string, number>;

/** One week of this member's own numbers, as `GET /api/journal/pulse` returns them, newest week first. */
export interface OwnPulseWeek {
  /** ISO week in the village's zone, spelled `2026-W40`. */
  weekId: string;
  scores: PulseScores;
}

/** The answer a metric accepts, or a sentence saying why not. */
export function pulseScoreProblem(key: string, value: unknown): string | null {
  const def = PULSE_METRICS.find((m) => m.key === key);
  if (!def) return `There is no pulse question called ${key}.`;
  if (typeof value !== "number" || !Number.isInteger(value)) return "A pulse answer is a whole number.";
  if (value < def.min || value > def.max) return `That answer runs from ${def.min} to ${def.max}.`;
  return null;
}

/**
 * How many different members must have answered a metric in a week before
 * anybody sees its average. The live value is the game variable
 * `journal.pulse_floor`.
 *
 * ONE BY DEFAULT, by ruling (2026-10-02): "We can still have the team pulse
 * even with a small team. We value transparency, and anonymity is in how we
 * capture and distribute anonymous feedback." So a team of three sees its
 * pulse. The dial stays, because a larger village may want a floor, and
 * raising it is a village decision on the variables page.
 */
export const PULSE_FLOOR_DEFAULT = 1;

export interface PulseAggregateCell {
  metric: string;
  /** Distinct members who answered. Null below the floor. */
  n: number | null;
  /** Mean, one decimal. Null below the floor. */
  mean: number | null;
  suppressed: boolean;
}

export interface PulseAggregateWeek {
  /** ISO week in the village's zone, spelled `2026-W40`. */
  weekId: string;
  cells: PulseAggregateCell[];
}

export interface PulseAggregate {
  floor: number;
  weeks: PulseAggregateWeek[];
  /** Plain sentences a member can read, derived from unsuppressed cells only. */
  signals: PulseSignal[];
}

/**
 * A pattern the numbers suggest, named in a shared vocabulary of how
 * organisations come apart. Wording is gentle on purpose: a signal is an
 * invitation to talk, never a verdict.
 */
export interface PulseSignal {
  key: "burnout" | "confidence" | "coherence" | "space";
  text: string;
}

// ── Entries ──────────────────────────────────────────────────────────────────

export interface JournalAnswer {
  questionKey: string;
  /** The prompt as the person saw it, kept so an old entry reads right after a rename. */
  prompt: string;
  text: string;
}

/** Longest single answer the store keeps. Strict MySQL refuses an over-long row, so the store clips first. */
export const JOURNAL_ANSWER_MAX = 8000;
/** Most answers in one entry. The deep debrief asks eight. */
export const JOURNAL_ANSWERS_MAX = 20;
/** The guide's distilled reflection, once confirmed. */
export const JOURNAL_REFLECTION_MAX = 2000;

export interface DebriefMeta {
  call?: string;
  seats?: string[];
  quests?: string[];
  /** True when the author said they would decide it the same way elsewhere. */
  portable?: boolean;
}

/** What the client sends to save an entry. `clientId` makes a retried save a no-op. */
export interface JournalEntryInput {
  clientId: string;
  practice: JournalPractice;
  depth: JournalDepth;
  answers: JournalAnswer[];
  /** Present only on a pulse. */
  scores?: PulseScores;
  /** When the person wrote it, as an ISO string. Offline saves arrive late. */
  writtenAt: string;
  /** The writer's own local hour, 0 to 23, so the guide can notice late nights. */
  localHour?: number;
  privacy?: JournalPrivacy;
  meta?: DebriefMeta;
  /** The guide's reflection, only when the author confirmed it. */
  reflection?: string | null;
}

export interface JournalEntry {
  id: string;
  clientId: string;
  practice: JournalPractice;
  depth: JournalDepth;
  answers: JournalAnswer[];
  scores: PulseScores | null;
  writtenAt: string;
  localHour: number | null;
  privacy: JournalPrivacy;
  meta: DebriefMeta | null;
  reflection: string | null;
  /** True once the author confirmed the reflection as their own words. */
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── The guide ────────────────────────────────────────────────────────────────

export interface GuideMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GuideRequest {
  practice: JournalPractice;
  depth: JournalDepth;
  /** What the person has written so far in this sitting. */
  answers: JournalAnswer[];
  /** The conversation with the guide in this sitting. Last turn is the person's. */
  messages: GuideMessage[];
  localHour?: number;
}

/**
 * The most messages one guide ask may carry. The client trims each request to
 * this; the assistant engine refuses anything over its own MAX_TURNS, and
 * server/routes/journal.guide.test.ts fails the build if this ever exceeds it.
 */
export const GUIDE_MAX_MESSAGES = 40;

export interface GuideReply {
  /** What the guide says. */
  reply: string;
  /** One follow-up question, or empty. */
  nextQuestion: string;
  /** A distilled version for "did I get that right?", or empty. */
  reflection: string;
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export const FEEDBACK_STYLES = ["direct", "gentle", "with-examples"] as const;
export type FeedbackStyle = (typeof FEEDBACK_STYLES)[number];

export function isFeedbackStyle(v: unknown): v is FeedbackStyle {
  return typeof v === "string" && (FEEDBACK_STYLES as readonly string[]).includes(v);
}

export const FEEDBACK_STYLE_LABELS: Record<FeedbackStyle, string> = {
  direct: "Straight to the point",
  gentle: "Gently, with care",
  "with-examples": "With concrete examples",
};

/** A member's own word on receiving feedback. No row means they have not said yes. */
export interface FeedbackPrefs {
  open: boolean;
  style: FeedbackStyle;
  /** "How I like to receive feedback", in their words. */
  note: string;
}

export const FEEDBACK_NOTE_MAX = 500;
export const FEEDBACK_FIELD_MAX = 1000;
/**
 * The longest message a recipient may be sent. REFUSED past this, never
 * clipped: the author approved the exact words, and a clipped message is a
 * message nobody approved.
 */
export const FEEDBACK_MESSAGE_MAX = 2000;

/**
 * The four parts of a nonviolent request: what I saw, how I felt, what I
 * need, what I am asking for. The author writes these; the guide turns them
 * into one message; the author approves that message before it is queued.
 */
export interface FeedbackDraft {
  recipientId: string;
  observation: string;
  feeling: string;
  need: string;
  request: string;
}

export const FEEDBACK_STATUSES = ["draft", "queued", "withdrawn"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** The author's own view of something they wrote. */
export interface FeedbackSent extends FeedbackDraft {
  id: string;
  recipientName: string;
  /** The words the recipient will read, exactly. */
  message: string;
  status: FeedbackStatus;
  /** When it becomes visible to the recipient. */
  deliverAfter: string | null;
  /** True once the recipient can read it: its Monday has come and their yes covers it. */
  delivered: boolean;
  /**
   * True while the recipient is not taking feedback and this has not reached
   * them: it waits, and arrives if they say yes again. The author may still
   * withdraw it. Optional only so a page built before it reads as "not held".
   */
  held?: boolean;
  createdAt: string;
}

/** The recipient's view. Carries no author at any depth. */
export interface FeedbackReceived {
  id: string;
  message: string;
  deliveredAt: string;
  response: FeedbackResponse;
}

export const FEEDBACK_RESPONSES = ["none", "thanks", "not-useful"] as const;
export type FeedbackResponse = (typeof FEEDBACK_RESPONSES)[number];

export function isFeedbackResponse(v: unknown): v is FeedbackResponse {
  return typeof v === "string" && (FEEDBACK_RESPONSES as readonly string[]).includes(v);
}

/** Someone who said yes to feedback, as the author's picker shows them. */
export interface FeedbackPerson {
  id: string;
  name: string;
  style: FeedbackStyle;
  note: string;
}

/**
 * Delivery is held to a weekly batch so the moment a message appears says
 * little about who wrote it. A queued message becomes visible on the first
 * Monday morning (village time) at least this many hours after it was queued.
 */
export const FEEDBACK_MIN_HOLD_HOURS = 48;

/** One author may queue at most this many messages to one recipient per week. */
export const FEEDBACK_PER_RECIPIENT_WEEKLY = 1;

// ── The HTTP surface, for both sides to agree on ─────────────────────────────
//
//   GET    /api/journal/practices              JOURNAL_PRACTICE_DEFS + PULSE_METRICS + floor
//   GET    /api/journal/entries?limit&before    this member's entries, newest first
//   POST   /api/journal/entries                 save one (idempotent on clientId)
//   PATCH  /api/journal/entries/:id             edit answers / reflection / privacy
//   DELETE /api/journal/entries/:id             forget one
//   POST   /api/journal/guide                   GuideRequest -> GuideReply
//   GET    /api/journal/pulse                   this member's own scores by week
//   GET    /api/journal/pulse/aggregate         PulseAggregate, any member
//   GET    /api/journal/feedback/prefs          FeedbackPrefs | null
//   PUT    /api/journal/feedback/prefs          FeedbackPrefs
//   GET    /api/journal/feedback/people         FeedbackPerson[] (open, excluding me)
//   POST   /api/journal/feedback/shape          FeedbackDraft -> { message }
//   POST   /api/journal/feedback                FeedbackDraft + message -> FeedbackSent (queued)
//   GET    /api/journal/feedback/sent           FeedbackSent[]
//   POST   /api/journal/feedback/:id/withdraw   before delivery only
//   GET    /api/journal/feedback/received       FeedbackReceived[] (delivered only)
//   POST   /api/journal/feedback/:id/respond    { response }
//   GET    /api/journal/export.md?practice      this member's entries as markdown
