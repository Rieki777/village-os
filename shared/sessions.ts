/**
 * Live Sessions: a circle holds a working call together, in real time.
 *
 * ONE FILE IS THE CONTRACT. The server routes (server/routes/liveSessions.ts),
 * the store (server/repos/liveSessions.ts), the logic (server/lib/liveSessions.ts)
 * and the room (client/src/pages/SessionRoom.tsx) read their shapes, limits and
 * words from here, so a stage renamed here is renamed on every surface at once.
 *
 * WHERE IT COMES FROM. A founder asked for a sociocratic game for the working
 * calls of a village: drop in, say how you are arriving on a scale of 1 to 11
 * and what would make it an 11+, build the agenda together, give every agenda
 * item its own live page, leave with every action claimed by a person or a
 * seat on the spot, and close with feedback on the facilitation and on the
 * tool itself. The shape follows the sociocratic meeting format (opening round,
 * consent to the agenda, content items with an aim, backlog, closing round),
 * with a breath, the moon and the season, gratitude, and a harvest of what each
 * item taught.
 *
 * THE FLOW. One session moves through six stages, and the facilitator moves the
 * room: drop in, arrival, agenda, items, actions, close. Everyone sees the stage
 * the facilitator is on and can look back at an earlier one on their own screen.
 *
 * THE PRIVACY LINE, which every shape below follows:
 *   - Members only. Every door needs a signed-in member; there are no guests.
 *   - Arrival stays in the room. While the session is open the people in it see
 *     each other's number and words, the way a spoken round works. At close the
 *     words are erased and only the spread is kept (count, median, range).
 *   - Feedback on the facilitation reaches the facilitator unsigned.
 *   - The record of a closed session (agenda, outcomes, decisions, seeds,
 *     actions, backlog) is read by the people who were in it and by the
 *     village's admins. Nothing is written to an event, because `recordEvent`
 *     defaults to a public audience.
 *   - The SHAREABLE minutes name no person at all: actions say the seat or "a
 *     member", and nothing from the arrival or the check-out crosses. They are
 *     what an admin may hand to an organisational-memory service, by hand.
 *
 * COPY RULES. Platform code carries no village's name. No em-dashes, and every
 * string a member reads lives in this file so the voice gate reads it.
 */

// ── Stages ───────────────────────────────────────────────────────────────────

export const SESSION_STAGES = ["dropin", "arrival", "agenda", "items", "actions", "close"] as const;
export type SessionStage = (typeof SESSION_STAGES)[number];

export function isSessionStage(v: unknown): v is SessionStage {
  return typeof v === "string" && (SESSION_STAGES as readonly string[]).includes(v);
}

export interface StageDef {
  title: string;
  short: string;
  lede: string;
  /** Prompts for whoever is facilitating; shown to the facilitator only. */
  cues: string[];
}

export const STAGE_DEFS: Record<SessionStage, StageDef> = {
  dropin: {
    title: "Drop in",
    short: "Drop in",
    lede: "Arrive where you are. Feel the ground under you and breathe together before we begin.",
    cues: [
      "Read the place line out loud, or ask someone to.",
      "Start the breath. Let the quiet sit when it ends.",
      "Name who is here and who sent word they could not come.",
    ],
  },
  arrival: {
    title: "How are you arriving?",
    short: "Arrival",
    lede: "Give one number from 1 to 11 for how you are arriving, and, if you like, what would make it an 11+. Nobody fixes anybody's answer.",
    cues: [
      "Go first to set the tone.",
      "Call two names at a time so the next person can get ready.",
      "If the room is low, offer to lighten the agenda and ask for consent.",
    ],
  },
  agenda: {
    title: "Build the agenda",
    short: "Agenda",
    lede: "Anyone can add an item. Each one gets an aim and some minutes, and then we consent to the agenda together.",
    cues: [
      "Start with the action check from last time, if there is one.",
      "Read the agenda back with its timings, then ask for objections.",
      "More than the time allows? Park an item for next session.",
    ],
  },
  items: {
    title: "The work",
    short: "Items",
    lede: "One item at a time, each with its own clock and its own page. Notes, ideas and actions land on the item they belong to.",
    cues: [
      "Start the item's clock and say its aim out loud.",
      "Catch every action as it comes, with a name or a seat on it.",
      "Close each item with a seed: one line on what we now know.",
    ],
  },
  actions: {
    title: "Who does what",
    short: "Actions",
    lede: "Every action leaves with a person or a seat on it, claimed here and now. Anything nobody can hold goes to the backlog.",
    cues: [
      "Read each action out, then wait for a claim.",
      "No action leaves without an owner. Park it if nobody can hold it.",
    ],
  },
  close: {
    title: "Close",
    short: "Close",
    lede: "Gratitude, one word each, and how this session could flow better next time.",
    cues: [
      "Open a gratitude round.",
      "Ask for feedback on the facilitation and on this tool.",
      "Close the session to keep the record and send it to the admins.",
    ],
  },
};

// ── Agenda items ─────────────────────────────────────────────────────────────

/** The sociocratic aims: a report shares, an exploration gathers, a decision decides by consent. */
export const ITEM_AIMS = ["report", "explore", "decide"] as const;
export type ItemAim = (typeof ITEM_AIMS)[number];

export function isItemAim(v: unknown): v is ItemAim {
  return typeof v === "string" && (ITEM_AIMS as readonly string[]).includes(v);
}

export const AIM_DEFS: Record<ItemAim, { label: string; hint: string }> = {
  report: { label: "Report", hint: "Share what is happening so everyone knows." },
  explore: { label: "Explore", hint: "Gather ideas and understanding, usually in a round." },
  decide: { label: "Decide", hint: "Shape a proposal and decide it by consent." },
};

export const ITEM_STATUSES = ["waiting", "active", "done", "parked"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

// ── Entries: everything people add while the session runs ────────────────────

/**
 * note      anything worth keeping, on an item or on the session
 * idea      an idea in an exploration
 * seed      the one line an item closes with: what we now know
 * decision  a proposal text that a consent round runs on
 * action    something to do, which must leave with an owner
 * tension   something sensed that wants its own time; it goes to the backlog
 */
export const ENTRY_KINDS = ["note", "idea", "seed", "decision", "action", "tension"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export function isEntryKind(v: unknown): v is EntryKind {
  return typeof v === "string" && (ENTRY_KINDS as readonly string[]).includes(v);
}

export const ENTRY_LABELS: Record<EntryKind, string> = {
  note: "Note",
  idea: "Idea",
  seed: "Seed",
  decision: "Proposal",
  action: "Action",
  tension: "Tension",
};

/** open: live. done: an action finished or a decision consented. parked: moved to the backlog. */
export const ENTRY_STATUSES = ["open", "done", "parked"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

// ── Consent rounds ───────────────────────────────────────────────────────────

export const CONSENT_VALUES = ["consent", "concern", "object"] as const;
export type ConsentValue = (typeof CONSENT_VALUES)[number];

export function isConsentValue(v: unknown): v is ConsentValue {
  return typeof v === "string" && (CONSENT_VALUES as readonly string[]).includes(v);
}

export const CONSENT_LABELS: Record<ConsentValue, string> = {
  consent: "I consent",
  concern: "I consent, with a concern",
  object: "I object",
};

/** A concern or an objection is said in one sentence, so the room can hear it whole. */
export function consentNeedsWords(value: ConsentValue): boolean {
  return value !== "consent";
}

/**
 * Response targets. One answer per person per target, changeable while open.
 *   agenda              consent to the agenda
 *   decision:<entryId>  the consent round on one proposal
 *   word                the one closing word
 *   facilitation        feedback for the facilitator, read unsigned
 */
export type ResponseTarget = "agenda" | `decision:${number}` | "word" | "facilitation";

export function parseResponseTarget(raw: unknown): ResponseTarget | null {
  if (raw === "agenda" || raw === "word" || raw === "facilitation") return raw;
  if (typeof raw === "string") {
    const m = /^decision:([1-9]\d{0,9})$/.exec(raw);
    if (m) return `decision:${Number(m[1])}`;
  }
  return null;
}

export const FACILITATION_VALUES = ["flowed", "mixed", "stuck"] as const;
export type FacilitationValue = (typeof FACILITATION_VALUES)[number];

export const FACILITATION_LABELS: Record<FacilitationValue, string> = {
  flowed: "It flowed",
  mixed: "Some of it flowed",
  stuck: "It got stuck",
};

// ── Limits ───────────────────────────────────────────────────────────────────

export const SESSION_LIMITS = {
  title: 120,
  agendaTitle: 120,
  text: 600,
  wish: 200,
  word: 32,
  minutesMin: 1,
  minutesMax: 120,
  durationMin: 10,
  durationMax: 480,
  durationDefault: 60,
  maxAgenda: 30,
  maxEntries: 800,
  maxEntriesPerPerson: 250,
  maxPeople: 80,
  extendStepMin: 5,
  maxExtraMin: 60,
} as const;

export const ARRIVAL_MIN = 1;
export const ARRIVAL_MAX = 11;

export function isArrivalScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= ARRIVAL_MIN && v <= ARRIVAL_MAX;
}

/** How often an open room asks whether anything changed. A 304 costs almost nothing. */
export const ROOM_POLL_MS = 2500;
/** Someone seen within this window is "here". */
export const PRESENT_WINDOW_MS = 45_000;
/** How often a page in the room says it is still here. */
export const HERE_EVERY_MS = 20_000;

// ── Text ─────────────────────────────────────────────────────────────────────

/**
 * Characters that let text hide or disguise itself: controls other than tab
 * and newline, zero-width characters, the word joiner and invisible operators,
 * bidi overrides and isolates, the byte-order mark, and the tag characters that
 * can spell out words nobody sees. Built from code points, so no escape lands in
 * this file as the character itself.
 */
const HIDDEN = new RegExp(
  "[" +
    [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff], [0xe0000, 0xe007f]]
      .map(([a, b]) => (a === b ? String.fromCodePoint(a) : `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`))
      .join("") +
    "]",
  "gu",
);

/** One line: hidden characters out, whitespace collapsed, capped. Null when nothing is left. */
export function cleanLine(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(HIDDEN, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text ? text : null;
}

/** A few lines: hidden characters out, at most one blank line in a row, capped. */
export function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(HIDDEN, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
    .trim();
  return text ? text : null;
}

/** A due date as YYYY-MM-DD, or null. */
export function cleanDueOn(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : raw;
}

// ── The breath ───────────────────────────────────────────────────────────────

export const BREATH_PATTERNS = {
  settle: { label: "Long exhale", steps: [{ kind: "in", secs: 4 }, { kind: "out", secs: 6 }] },
  box: { label: "Box", steps: [{ kind: "in", secs: 4 }, { kind: "hold-in", secs: 4 }, { kind: "out", secs: 4 }, { kind: "hold-out", secs: 4 }] },
  even: { label: "Even", steps: [{ kind: "in", secs: 5 }, { kind: "out", secs: 5 }] },
} as const satisfies Record<string, { label: string; steps: readonly { kind: BreathStepKind; secs: number }[] }>;

export type BreathStepKind = "in" | "out" | "hold-in" | "hold-out";
export type BreathKey = keyof typeof BREATH_PATTERNS;
export const BREATH_KEYS = Object.keys(BREATH_PATTERNS) as BreathKey[];
export const BREATH_ROUNDS = [3, 6, 10] as const;

export const BREATH_WORDS: Record<BreathStepKind, string> = {
  in: "Breathe in",
  out: "Breathe out",
  "hold-in": "Hold",
  "hold-out": "Rest",
};

export type BreathMoment =
  | { state: "idle" }
  | { state: "done" }
  | { state: "breathing"; round: number; kind: BreathStepKind; progress: number; secondsLeft: number };

/** Where a shared breath is at `now`, so every screen in the room breathes together. */
export function breathAt(b: { pattern: BreathKey; rounds: number; startedAt: number | null }, now: number): BreathMoment {
  if (b.startedAt == null) return { state: "idle" };
  const steps = BREATH_PATTERNS[b.pattern]?.steps ?? BREATH_PATTERNS.settle.steps;
  const cycle = steps.reduce((s, x) => s + x.secs, 0);
  const t = (now - b.startedAt) / 1000;
  if (t < 0) return { state: "idle" };
  if (t >= cycle * b.rounds) return { state: "done" };
  const round = Math.floor(t / cycle);
  let inCycle = t - round * cycle;
  for (const step of steps) {
    if (inCycle < step.secs) {
      return { state: "breathing", round: round + 1, kind: step.kind, progress: inCycle / step.secs, secondsLeft: Math.ceil(step.secs - inCycle) };
    }
    inCycle -= step.secs;
  }
  return { state: "done" };
}

// ── The room's state, which the facilitator moves ────────────────────────────

export interface SessionState {
  stage: SessionStage;
  stageStartedAt: number | null;
  /** When the facilitator started the session clock. */
  startedAt: number | null;
  /** The agenda item on screen during the items stage. */
  activeItemId: number | null;
  itemStartedAt: number | null;
  /** Grace minutes the room consented to add to the active item. */
  itemExtraMin: number;
  breath: { pattern: BreathKey; rounds: number; startedAt: number | null };
  /** A speaking round: the order people speak in and who is speaking now. */
  round: { label: string | null; order: number[]; at: number };
}

export function defaultSessionState(): SessionState {
  return {
    stage: "dropin",
    stageStartedAt: null,
    startedAt: null,
    activeItemId: null,
    itemStartedAt: null,
    itemExtraMin: 0,
    breath: { pattern: "settle", rounds: 6, startedAt: null },
    round: { label: null, order: [], at: 0 },
  };
}

const intOrNull = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Whatever was stored, as a state the room can trust. Anything unknown falls back to the default. */
export function normalizeSessionState(raw: unknown): SessionState {
  const base = defaultSessionState();
  let src: Record<string, any> = {};
  if (typeof raw === "string") {
    try { src = JSON.parse(raw) ?? {}; } catch { src = {}; }
  } else if (raw && typeof raw === "object") {
    src = raw as Record<string, any>;
  }
  const breathIn = src.breath && typeof src.breath === "object" ? src.breath : {};
  const roundIn = src.round && typeof src.round === "object" ? src.round : {};
  const order = Array.isArray(roundIn.order)
    ? (roundIn.order as unknown[]).filter((x): x is number => intOrNull(x, 1, 2 ** 31) != null).slice(0, SESSION_LIMITS.maxPeople)
    : [];
  return {
    stage: isSessionStage(src.stage) ? src.stage : base.stage,
    stageStartedAt: intOrNull(src.stageStartedAt, 0, 2 ** 53),
    startedAt: intOrNull(src.startedAt, 0, 2 ** 53),
    activeItemId: intOrNull(src.activeItemId, 1, 2 ** 31),
    itemStartedAt: intOrNull(src.itemStartedAt, 0, 2 ** 53),
    itemExtraMin: intOrNull(src.itemExtraMin, 0, SESSION_LIMITS.maxExtraMin) ?? 0,
    breath: {
      pattern: (BREATH_KEYS as string[]).includes(breathIn.pattern) ? breathIn.pattern : base.breath.pattern,
      rounds: (BREATH_ROUNDS as readonly number[]).includes(breathIn.rounds) ? breathIn.rounds : base.breath.rounds,
      startedAt: intOrNull(breathIn.startedAt, 0, 2 ** 53),
    },
    round: {
      label: typeof roundIn.label === "string" ? cleanLine(roundIn.label, 60) : null,
      order,
      at: intOrNull(roundIn.at, 0, Math.max(0, order.length)) ?? 0,
    },
  };
}

/**
 * What the facilitator can do to the room's state. Actions that change the
 * agenda's rows (finishing or parking an item) are the server's; these change
 * only the shared state, and `applySessionAction` is the one place they do.
 */
export type SessionAction =
  | { type: "go"; stage: SessionStage }
  | { type: "start" }
  | { type: "breath"; pattern?: BreathKey; rounds?: number; run: boolean }
  | { type: "item"; itemId: number | null }
  | { type: "extend"; minutes: number }
  | { type: "round"; label: string | null; order: number[] }
  | { type: "next" }
  | { type: "previous" };

export function parseSessionAction(raw: unknown): SessionAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, any>;
  switch (a.type) {
    case "go":
      return isSessionStage(a.stage) ? { type: "go", stage: a.stage } : null;
    case "start":
      return { type: "start" };
    case "breath": {
      if (typeof a.run !== "boolean") return null;
      const out: SessionAction = { type: "breath", run: a.run };
      if (a.pattern !== undefined) {
        if (!(BREATH_KEYS as string[]).includes(a.pattern)) return null;
        out.pattern = a.pattern;
      }
      if (a.rounds !== undefined) {
        if (!(BREATH_ROUNDS as readonly number[]).includes(a.rounds)) return null;
        out.rounds = a.rounds;
      }
      return out;
    }
    case "item":
      return a.itemId === null || intOrNull(a.itemId, 1, 2 ** 31) != null ? { type: "item", itemId: a.itemId } : null;
    case "extend":
      return intOrNull(a.minutes, -SESSION_LIMITS.maxExtraMin, SESSION_LIMITS.maxExtraMin) != null ? { type: "extend", minutes: a.minutes } : null;
    case "round": {
      if (!Array.isArray(a.order) || a.order.length > SESSION_LIMITS.maxPeople) return null;
      if (!a.order.every((x: unknown) => intOrNull(x, 1, 2 ** 31) != null)) return null;
      const label = a.label === null ? null : cleanLine(a.label, 60);
      return { type: "round", label, order: Array.from(new Set(a.order as number[])) };
    }
    case "next":
      return { type: "next" };
    case "previous":
      return { type: "previous" };
    default:
      return null;
  }
}

export function applySessionAction(state: SessionState, action: SessionAction, now: number): SessionState {
  switch (action.type) {
    case "go":
      if (action.stage === state.stage) return state;
      return { ...state, stage: action.stage, stageStartedAt: now, round: { label: null, order: [], at: 0 } };
    case "start":
      return state.startedAt != null ? state : { ...state, startedAt: now, stageStartedAt: state.stageStartedAt ?? now };
    case "breath":
      return {
        ...state,
        breath: {
          pattern: action.pattern ?? state.breath.pattern,
          rounds: action.rounds ?? state.breath.rounds,
          startedAt: action.run ? now : null,
        },
      };
    case "item":
      if (action.itemId === state.activeItemId) return state;
      return { ...state, activeItemId: action.itemId, itemStartedAt: action.itemId == null ? null : now, itemExtraMin: 0 };
    case "extend": {
      if (state.activeItemId == null) return state;
      const extra = Math.max(0, Math.min(SESSION_LIMITS.maxExtraMin, state.itemExtraMin + action.minutes));
      return { ...state, itemExtraMin: extra };
    }
    case "round":
      return { ...state, round: { label: action.label, order: action.order, at: 0 } };
    case "next":
      return state.round.order.length ? { ...state, round: { ...state.round, at: Math.min(state.round.order.length, state.round.at + 1) } } : state;
    case "previous":
      return state.round.order.length ? { ...state, round: { ...state.round, at: Math.max(0, state.round.at - 1) } } : state;
  }
}

/** Who speaks now and who is ready next, two names at a time. */
export function roundSpeakers(round: SessionState["round"]): { now: number | null; next: number | null; done: boolean } {
  if (!round.order.length) return { now: null, next: null, done: false };
  if (round.at >= round.order.length) return { now: null, next: null, done: true };
  return { now: round.order[round.at] ?? null, next: round.order[round.at + 1] ?? null, done: false };
}

// ── Time ─────────────────────────────────────────────────────────────────────

export type TimeboxPhase = "idle" | "calm" | "near" | "over";

/**
 * An item's clock, with grace. Calm until four fifths of its minutes are gone,
 * then near (a soft shift), then over (a quiet bell and three choices: add
 * minutes with the room's consent, park it, or wrap it up).
 */
export function timebox(startedAt: number | null, minutes: number, extraMin: number, now: number): { phase: TimeboxPhase; secondsLeft: number; totalSeconds: number } {
  const totalSeconds = Math.max(0, (minutes + extraMin) * 60);
  if (startedAt == null) return { phase: "idle", secondsLeft: totalSeconds, totalSeconds };
  const used = Math.max(0, (now - startedAt) / 1000);
  const secondsLeft = Math.round(totalSeconds - used);
  if (secondsLeft <= 0) return { phase: "over", secondsLeft, totalSeconds };
  return { phase: used >= totalSeconds * 0.8 ? "near" : "calm", secondsLeft, totalSeconds };
}

/** Minutes the waiting and active items still ask for, against the time the session has left. */
export function agendaFit(items: { minutes: number; status: ItemStatus }[], durationMin: number, startedAt: number | null, now: number): { planned: number; left: number; over: boolean } {
  const planned = items.filter((i) => i.status === "waiting" || i.status === "active").reduce((s, i) => s + i.minutes, 0);
  const elapsed = startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 60000));
  const left = Math.max(0, durationMin - elapsed);
  return { planned, left, over: planned > left };
}

// ── Consent and arrival ──────────────────────────────────────────────────────

export interface ConsentTally {
  consent: number;
  concern: number;
  object: number;
  /** People here who have not answered yet. */
  waiting: number;
  /** Everyone here has answered and nobody objects. */
  consented: boolean;
}

/** One answer in a consent round, with who gave it (a member's number in the room). */
export interface ConsentAnswer {
  who: number;
  value: ConsentValue;
}

/**
 * A consent round, counted person by person. `waiting` is the people here now
 * who have not answered, so an answer from someone who has left never stands in
 * for someone present who has not been heard. Every answer counts toward the
 * totals, and an objection blocks whoever gave it, present or not.
 */
export function consentTally(answers: readonly ConsentAnswer[], presentIds: readonly number[]): ConsentTally {
  const t = { consent: 0, concern: 0, object: 0 };
  const said = new Set<number>();
  for (const a of answers) {
    t[a.value] += 1;
    said.add(a.who);
  }
  const here = Array.from(new Set(presentIds));
  const waiting = here.filter((id) => !said.has(id)).length;
  const heardHere = here.some((id) => said.has(id));
  return { ...t, waiting, consented: heardHere && waiting === 0 && t.object === 0 };
}

export interface ArrivalSummary {
  count: number;
  median: number | null;
  low: number | null;
  high: number | null;
}

/** The arrival round as numbers only: what the record keeps once the words are gone. */
export function arrivalSummary(scores: (number | null | undefined)[]): ArrivalSummary {
  const s = scores.filter(isArrivalScore).sort((a, b) => a - b);
  if (!s.length) return { count: 0, median: null, low: null, high: null };
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
  return { count: s.length, median, low: s[0], high: s[s.length - 1] };
}

/** A room arriving low is a reason to lighten the agenda, offered and consented, never imposed. */
export function arrivalIsLow(summary: ArrivalSummary): boolean {
  return summary.count >= 2 && summary.median != null && summary.median <= 5;
}

// ── Shapes on the wire ───────────────────────────────────────────────────────

export interface SessionStamp {
  /** e.g. "Waxing gibbous" */
  moonName: string;
  moonGlyph: string;
  /** The village's own moon count, when it keeps one. */
  moonOrdinal: number | null;
  /** The season by the village's hemisphere, e.g. "spring". */
  season: string | null;
  /** The village's place line, read at drop in. */
  placeLine: string | null;
}

export interface SessionPerson {
  userId: number;
  name: string;
  present: boolean;
  /** While open: the number this person gave. After close: always null. */
  arrival: number | null;
  /** While open: what would make it an 11+. After close: always null. */
  wish: string | null;
  /**
   * The member's public handle, so the close can thank them through the
   * gratitude door, which finds a person by handle. Null when they have none;
   * the room then links to the gratitude wall instead of the thank-you form.
   */
  handle?: string | null;
}

export interface SessionItem {
  id: number;
  title: string;
  aim: ItemAim;
  minutes: number;
  position: number;
  status: ItemStatus;
  presenterUserId: number | null;
  addedBy: number;
  startedAt: string | null;
  endedAt: string | null;
  usedSeconds: number;
  /** When it came over from an earlier session's backlog. */
  fromSessionId: number | null;
}

export interface SessionEntry {
  id: number;
  itemId: number | null;
  kind: EntryKind;
  text: string;
  status: EntryStatus;
  authorUserId: number;
  ownerUserId: number | null;
  ownerName: string | null;
  ownerSeatId: string | null;
  ownerSeatName: string | null;
  dueOn: string | null;
  createdAt: string;
}

export interface SessionResponse {
  target: ResponseTarget;
  userId: number;
  value: string;
  text: string | null;
}

export interface SeatOption {
  id: string;
  name: string;
  circleId: string | null;
}

export interface SessionView {
  id: number;
  title: string;
  circleId: string | null;
  circleName: string | null;
  status: "open" | "closed";
  version: number;
  serverNow: number;
  durationMin: number;
  state: SessionState;
  stamp: SessionStamp;
  facilitatorUserId: number;
  secretaryUserId: number | null;
  createdAt: string;
  closedAt: string | null;
  people: SessionPerson[];
  items: SessionItem[];
  entries: SessionEntry[];
  /**
   * Consent answers on the agenda and on proposals, and closing words. Feedback
   * for the facilitator is never in this list; see `facilitation`.
   */
  responses: SessionResponse[];
  /** Feedback on the facilitation, unsigned. Only the facilitator and admins receive it. */
  facilitation: { value: FacilitationValue; text: string | null }[] | null;
  seats: SeatOption[];
  /** After close: the arrival round as numbers only. */
  arrival: ArrivalSummary | null;
  /** From the last closed session in the same circle: its open actions and its backlog. */
  carried: { sessionId: number; title: string; actions: SessionEntry[]; backlog: SessionEntry[]; parkedItems: { title: string; aim: ItemAim; minutes: number }[] } | null;
  me: { userId: number; joined: boolean; facilitates: boolean; secretary: boolean; admin: boolean };
}

export interface SessionListRow {
  id: number;
  title: string;
  circleId: string | null;
  circleName: string | null;
  status: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
  facilitatorName: string;
  peopleCount: number;
  joined: boolean;
}

// ── Doors ────────────────────────────────────────────────────────────────────

/**
 * Every door, so the page and the routes agree. A refusal is `{ error: <a
 * sentence> }` with a 4xx status.
 *
 *   GET    /api/sessions                          { open: SessionListRow[], recent: SessionListRow[], circles: {id,name}[] }
 *   POST   /api/sessions                          { title, circleId?, durationMin? } -> { id }
 *   GET    /api/sessions/:id                      SessionView, with an ETag; 304 when nothing moved
 *   POST   /api/sessions/:id/join                 { ok }
 *   POST   /api/sessions/:id/here                 { ok } (presence, every HERE_EVERY_MS)
 *   POST   /api/sessions/:id/arrival              { score, wish? } -> { ok }
 *   POST   /api/sessions/:id/items                { title, aim, minutes } -> { id }
 *   PATCH  /api/sessions/:id/items/:itemId        { title?, aim?, minutes?, position?, status? } -> { ok }
 *   POST   /api/sessions/:id/entries              { kind, text, itemId?, ownerSeatId?, dueOn? } -> { id }
 *   PATCH  /api/sessions/:id/entries/:entryId     { claim?, release?, ownerSeatId?, text?, dueOn?, status? } -> { ok }
 *   DELETE /api/sessions/:id/entries/:entryId     { ok }
 *   POST   /api/sessions/:id/respond              { target, value, text? } -> { ok }
 *   POST   /api/sessions/:id/act                  { action: SessionAction } -> { ok, state }
 *   POST   /api/sessions/:id/hosts                { facilitatorUserId?, secretaryUserId? } -> { ok }
 *   POST   /api/sessions/:id/close                {} -> { ok } or 409 { error, unowned: number[] }
 *   POST   /api/sessions/:id/tool-feedback        { text } -> { ok } (lands in the village's feedback inbox)
 *   GET    /api/sessions/:id/minutes.md?for=shareable   text/markdown
 */
export const SESSIONS_API = "/api/sessions";

// ── Closing ──────────────────────────────────────────────────────────────────

/** Actions nobody holds yet. A session closes only when this is empty. */
export function unownedActions(entries: Pick<SessionEntry, "id" | "kind" | "status" | "ownerUserId" | "ownerSeatId">[]): number[] {
  return entries
    .filter((e) => e.kind === "action" && e.status === "open" && e.ownerUserId == null && !e.ownerSeatId)
    .map((e) => e.id);
}

export const CLOSE_REFUSAL = "Every action needs a person or a seat before the session closes. Claim it, name a seat, or park it.";

// ── Minutes ──────────────────────────────────────────────────────────────────

export type MinutesAudience = "people" | "shareable";

export interface MinutesInput {
  title: string;
  circleName: string | null;
  createdAt: string;
  closedAt: string | null;
  durationMin: number;
  stamp: SessionStamp;
  facilitatorName: string;
  secretaryName: string | null;
  peopleNames: string[];
  arrival: ArrivalSummary | null;
  items: SessionItem[];
  entries: SessionEntry[];
  /** Per decision entry id: its tally when the session closed. */
  tallies: Record<number, ConsentTally>;
}

const EMAILISH = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;
const PHONEISH = /\+?\d[\d ().-]{7,}\d/g;

/** What crosses to a shareable record: emails and phone numbers out, whatever else a person typed stays theirs to review. */
function shareableText(text: string): string {
  return text.replace(EMAILISH, "[email removed]").replace(PHONEISH, "[number removed]");
}

const fmtDate = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

/**
 * The record as markdown, in one of two audiences.
 *   people     for the people who were there and the village's admins: names
 *              on actions, who facilitated and who was present.
 *   shareable  names no person at all. Actions say their seat or "a member",
 *              emails and phone numbers are removed, and nothing from the
 *              arrival round or the check-out crosses except the numbers.
 */
export function buildMinutes(input: MinutesInput, audience: MinutesAudience): string {
  const named = audience === "people";
  const text = (t: string) => (named ? t : shareableText(t));
  const lines: string[] = [];
  lines.push(`# ${text(input.title)}`);
  lines.push("");
  const when = [fmtDate(input.createdAt), input.circleName ? `Circle: ${input.circleName}` : null].filter(Boolean).join(" · ");
  if (when) lines.push(when);
  const sky = [input.stamp.moonOrdinal != null ? `Moon ${input.stamp.moonOrdinal}` : null, input.stamp.moonName, input.stamp.season].filter(Boolean).join(" · ");
  if (sky) lines.push(sky);
  if (named) {
    lines.push(`Facilitated by ${input.facilitatorName}${input.secretaryName ? `, notes by ${input.secretaryName}` : ""}.`);
    if (input.peopleNames.length) lines.push(`Present: ${input.peopleNames.join(", ")}.`);
  } else {
    lines.push(`${input.peopleNames.length} ${input.peopleNames.length === 1 ? "person" : "people"} took part.`);
  }
  if (input.arrival && input.arrival.count) {
    lines.push(`Arrival: median ${input.arrival.median} of 11 (from ${input.arrival.low} to ${input.arrival.high}).`);
  }
  lines.push("");

  const byItem = new Map<number | null, SessionEntry[]>();
  for (const e of input.entries) {
    const k = e.itemId ?? null;
    byItem.set(k, [...(byItem.get(k) ?? []), e]);
  }
  const owner = (e: SessionEntry): string => {
    if (e.ownerSeatName) return named && e.ownerName ? `${e.ownerSeatName} (${e.ownerName})` : e.ownerSeatName;
    if (e.ownerUserId != null) return named && e.ownerName ? e.ownerName : "a member";
    return "nobody yet";
  };
  const writeEntries = (list: SessionEntry[]) => {
    const decisions = list.filter((e) => e.kind === "decision");
    for (const d of decisions) {
      const t = input.tallies[d.id];
      const how = d.status === "done" ? "Decided by consent" : "Proposal, not decided";
      const counts = t ? ` (${t.consent} consent, ${t.concern} with a concern, ${t.object} objecting)` : "";
      lines.push(`- **${how}:** ${text(d.text)}${counts}`);
    }
    for (const s of list.filter((e) => e.kind === "seed")) lines.push(`- **Seed:** ${text(s.text)}`);
    for (const a of list.filter((e) => e.kind === "action" && e.status !== "parked")) {
      lines.push(`- **Action:** ${text(a.text)}, held by ${owner(a)}${a.dueOn ? `, by ${a.dueOn}` : ""}.`);
    }
    if (named) {
      for (const n of list.filter((e) => e.kind === "note" || e.kind === "idea")) lines.push(`- ${ENTRY_LABELS[n.kind]}: ${n.text}`);
    }
  };

  const items = [...input.items].sort((a, b) => a.position - b.position);
  if (items.length) {
    lines.push("## Agenda");
    lines.push("");
    for (const item of items) {
      const used = item.usedSeconds ? `, ${Math.round(item.usedSeconds / 60)} of ${item.minutes} min` : `, ${item.minutes} min`;
      const status = item.status === "parked" ? " (parked for next time)" : item.status === "done" ? "" : " (not reached)";
      lines.push(`### ${text(item.title)}`);
      lines.push(`${AIM_DEFS[item.aim].label}${used}${status}`);
      writeEntries(byItem.get(item.id) ?? []);
      lines.push("");
    }
  }
  const loose = byItem.get(null) ?? [];
  if (loose.some((e) => e.kind !== "tension")) {
    lines.push("## Outside the agenda");
    lines.push("");
    writeEntries(loose.filter((e) => e.kind !== "tension"));
    lines.push("");
  }
  const backlog = input.entries.filter((e) => e.kind === "tension" || e.status === "parked");
  const parkedItems = items.filter((i) => i.status === "parked" || i.status === "waiting");
  if (backlog.length || parkedItems.length) {
    lines.push("## Backlog for next time");
    lines.push("");
    for (const i of parkedItems) lines.push(`- Item: ${text(i.title)} (${AIM_DEFS[i.aim].label})`);
    for (const e of backlog) lines.push(`- ${ENTRY_LABELS[e.kind]}: ${text(e.text)}`);
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ── The module's words ───────────────────────────────────────────────────────

export const SESSION_COPY = {
  listTitle: "Live sessions",
  listLede: "Hold a working call together: arrive, set the agenda, decide by consent, and leave with every action in someone's hands.",
  startTitle: "Start a session",
  startButton: "Open the room",
  titlePlaceholder: "What is this session?",
  circleLabel: "Which circle is meeting?",
  noCircle: "No circle in particular",
  durationLabel: "How long, in minutes",
  openNow: "Happening now",
  recent: "Recent sessions",
  nothingOpen: "No session is open right now.",
  joinButton: "Join the room",
  joinedLabel: "You're in",
  placeLineFallback: "Take a moment to feel where you are.",
  arrivalPrompt: "How are you arriving, from 1 to 11?",
  wishPrompt: "What would make it an 11+?",
  wishPlaceholder: "Optional, in a few words",
  arrivalSaved: "Thank you. Your number is in the room.",
  arrivalLow: "The room is arriving low. The facilitator may offer a lighter agenda.",
  agendaAdd: "Add an item",
  agendaAimLabel: "Aim",
  agendaMinutesLabel: "Minutes",
  agendaConsentAsk: "Do you consent to this agenda?",
  agendaOver: "The agenda asks for more time than the session has left.",
  carriedTitle: "From last time",
  carriedActions: "Actions to check in on",
  carriedBacklog: "Waiting in the backlog",
  itemNone: "Choose an item to start.",
  itemSeedPrompt: "One line on what we now know",
  overChoices: "Time is up for this item. Add five minutes with the room's consent, park it, or wrap it up.",
  addNote: "Add a note",
  addIdea: "Add an idea",
  addAction: "Add an action",
  addTension: "Name a tension",
  addDecision: "Write the proposal",
  claim: "I'll take it",
  release: "Let it go",
  nameSeat: "Name a seat",
  park: "Park it",
  unownedLeft: "still need someone",
  everyoneHolds: "Every action has someone holding it.",
  closeButton: "Close the session",
  closeDone: "The session is closed. The record went to the admins.",
  wordPrompt: "One word as you leave",
  facilitationPrompt: "How did the facilitation feel?",
  facilitationMore: "What would you keep, or try next time? The facilitator reads this unsigned.",
  toolPrompt: "How could this tool flow better?",
  toolPlaceholder: "Your idea goes to the village's feedback inbox.",
  toolSent: "Thank you. Your idea is in the feedback inbox.",
  gratitudeTitle: "Gratitude",
  gratitudeLede: "Thank someone for what they brought today.",
  recordTitle: "The record",
  shareableTitle: "Shareable minutes",
  shareableLede: "These name no one. Read them through before you copy them anywhere.",
  copyMinutes: "Copy",
  closedNoAccess: "This record is kept for the people who were in the session and the village's admins.",
} as const;

// ══ ADDED BY THE SERVER LANE ═════════════════════════════════════════════════
//
// Everything below this line was added by the server half of the module
// (server/routes/liveSessions.ts, server/lib/liveSessions.ts). Nothing above
// it was changed. It holds the sentences a refusal carries, the words a
// notice carries, and the season names a stamp carries, so every string a
// member reads still lives in this file.

/** The sentence each refusal carries in `{ error }`. */
export const SESSION_REFUSALS = {
  notFound: "There is no session with that number.",
  closed: "This session is closed, and its record stays as it was.",
  joinFirst: "Join the room first.",
  full: `The room holds ${SESSION_LIMITS.maxPeople} people and it is full.`,
  titleNeeded: "Give the session a title.",
  circleUnknown: "That circle is not one of this village's circles.",
  durationRange: `A session runs from ${SESSION_LIMITS.durationMin} to ${SESSION_LIMITS.durationMax} minutes.`,
  facilitatorOnly: "Only the person facilitating can do that.",
  notesOnly: "Only the facilitator or the secretary can change that.",
  itemUnknown: "That item is not on this agenda.",
  itemTitleNeeded: "Give the item a title.",
  aimNeeded: "An aim is report, explore or decide.",
  minutesRange: `Give an item from ${SESSION_LIMITS.minutesMin} to ${SESSION_LIMITS.minutesMax} minutes.`,
  agendaFull: `The agenda holds ${SESSION_LIMITS.maxAgenda} items. Park one or finish one first.`,
  positionNeeded: "A place on the agenda is a whole number.",
  itemStatusUnknown: "An item is waiting, done or parked. Start one from the room's controls.",
  fromSession: "That earlier session is not a closed session of this circle.",
  entryKind: "An entry is a note, an idea, a seed, a proposal, an action or a tension.",
  textNeeded: "Write a few words first.",
  entryUnknown: "That entry is not in this session.",
  entriesFull: `This session holds ${SESSION_LIMITS.maxEntries} entries, and that is all it can hold.`,
  yoursFull: `One person can add ${SESSION_LIMITS.maxEntriesPerPerson} entries to a session, and you have.`,
  seatUnknown: "That seat is not an active seat in this village.",
  dueOn: "A due date reads like 2026-10-31.",
  notAction: "Only an action can be claimed or let go.",
  heldAlready: "Someone already holds this action.",
  notHeld: "Nobody holds this action yet.",
  releaseNotYours: "Only the person holding it, or the facilitator, can let it go.",
  notYours: "Only the person who wrote it, the facilitator or the secretary can change it.",
  entryStatusUnknown: "An entry is open, done or parked.",
  decisionNotConsented: "A proposal is decided once everyone here has answered and nobody objects.",
  decisionClosed: "That proposal is no longer open for answers.",
  targetUnknown: "That is not something to answer here.",
  consentValue: "Answer with consent, concern or object.",
  consentWords: "Say your concern or objection in one sentence.",
  wordNeeded: "Give one word as you leave.",
  facilitationValue: "Answer with flowed, mixed or stuck.",
  arrivalScore: `Give a whole number from ${ARRIVAL_MIN} to ${ARRIVAL_MAX}.`,
  hostsPerson: "Choose someone who is in the room.",
  actionUnknown: "The room does not know that move.",
  notClosedYet: "The minutes are written when the session closes.",
  slowDown: "That is a lot at once. Give it a moment and try again.",
  membersOnly: "Live sessions are for the village's members. Sign the commitment to join one.",
  alreadyOnAgenda: "That one is already on today's agenda.",
  decisionFinal: "That proposal was decided by consent, and its words stay as they were.",
} as const;

/** What a person is called when the village no longer holds their name. */
export const SESSION_SOMEONE = "A member";

/** The season names a stamp carries, by the village's own hemisphere. */
export const SESSION_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type SessionSeason = (typeof SESSION_SEASONS)[number];

/** The words on the two notices a close sends. */
export const SESSION_NOTICES = {
  /** To every admin: the record of a session is ready to read. */
  recordReady: (title: string): string => `The record of "${title}" is ready to read`,
  /** To each person who holds an action, or who sits in a seat that holds one. */
  actionHeld: (title: string): string => `An action from "${title}" is in your hands`,
  /** The line under it: the action itself, and its date when it has one. */
  actionBody: (text: string, dueOn: string | null): string => (dueOn ? `${text.replace(/[.!?]+$/, "")}, by ${dueOn}.` : text),
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// THE LIVE ROOM'S OWN WORDS. Added by the room lane (client/src/pages/
// SessionRoom.tsx and client/src/components/sessions/). Everything above this
// line is the contract as it was written; this block only adds to it, so the
// voice gate reads every sentence the room shows from one file.
// ═════════════════════════════════════════════════════════════════════════════

/** Minutes an item gets when it comes over from the backlog with none of its own. */
export const ROOM_ITEM_MINUTES_DEFAULT = 10;
/** A thank-you's default size, the same as the gratitude wall's form. */
export const ROOM_GRATITUDE_AMOUNT = 10;

/** "4:05" from 245 seconds. Negative counts read as their size. */
export function roomClock(seconds: number): string {
  const s = Math.max(0, Math.round(Math.abs(seconds)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const ROOM_COPY = {
  opening: "Opening the room",
  missing: "This session is not here. The link may be old, or the session was removed.",
  failed: "The room is not answering just now. It keeps trying.",
  signedOut: "Your sign-in ended. Sign in again to carry on in the room.",
  allSessions: "All sessions",
  writeFailed: "That did not go through. Try again.",
  offline: "Could not reach the village. Try again.",

  here: "Here now",
  away: "Away",
  facilitating: "Facilitating",
  takingNotes: "Taking notes",
  youFacilitate: "You are facilitating.",
  joinLede: "You can look around. Join to give your number, add to the agenda and take actions.",
  moonOrdinal: (n: number) => `Moon ${n}`,
  clockWaiting: "The clock starts when the facilitator begins the session.",
  clockLine: (elapsedMin: number, durationMin: number) => `${elapsedMin} of ${durationMin} min`,
  beginSession: "Begin the session",
  nextStage: "Next stage",
  moveHere: "Move the room here",
  liveBadge: "Now",
  browsing: (yours: string, room: string) => `You are looking at ${yours}. The room is on ${room}.`,
  backToRoom: "Back to the room",
  showCues: "Cues for you",
  hideCues: "Hide the cues",
  handTo: "Hand facilitation to",
  handOver: "Hand over",
  secretaryLabel: "Who takes notes",
  nobodyYet: "Nobody yet",
  stagesLabel: "The stages of this session",
  hostsTitle: "Hosting",
  takeOver: "Take over facilitating",
  takeOverHint: "If the facilitator has stepped away, an admin can hold the room from here.",

  whoIsHere: "Who is here",
  nobodyHere: "Nobody has arrived yet.",
  breathTitle: "Breathe together",
  breathIdle: "When the facilitator starts it, every screen breathes at the same pace.",
  breathDone: "Let the quiet sit for a moment.",
  breathPattern: "Pattern",
  breathRounds: "Rounds",
  breathStart: "Start the breath",
  breathStop: "Stop the breath",
  breathAgain: "Breathe again",
  breathRound: (n: number, of: number) => `Round ${n} of ${of}`,

  giveNumber: "Give my number",
  changeNumber: "Change my number",
  theRoom: "The room",
  notYet: "Not yet",
  arrivalHeardInRoom: "The numbers are shared with the people who joined the room.",
  answersHeardInRoom: "The answers are shared with the people who joined the room.",
  roomMovedTo: (title: string) => `The room moved on to ${title}.`,
  openProposalsTitle: "Proposals still open",
  openProposalsHint: "Mark each one decided by consent, or leave it open and it goes in the record as not decided.",
  roundStart: "Start a speaking round",
  roundNext: "Next speaker",
  roundBack: "Back one",
  roundEnd: "End the round",
  speakingNow: "Speaking now",
  readyNext: "Ready next",
  roundDone: "Everyone has spoken.",
  joinFirst: "Join the room to take part here.",

  parkedItems: "Parked last time",
  addToAgenda: "Add to the agenda",
  actionCheckTitle: "Action check from last time",
  addActionCheck: "Add an action check to the agenda",
  itemTitleLabel: "Item",
  itemTitlePlaceholder: "What needs the circle's time?",
  addItemButton: "Add it",
  agendaEmpty: "No items yet. Anyone in the room can add one.",
  moveUp: "Move up",
  moveDown: "Move down",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  takeOff: "Take it off the agenda",
  bringBack: "Bring it back",
  offAgenda: "Off the agenda",
  agendaFitLine: (planned: number, left: number) => `${planned} min planned, ${left} min left`,
  minutesShort: "min",
  consentSentence: "Say it in one sentence",
  consentNeedsSentence: "A concern or an objection needs one sentence, so the room can hear it whole.",
  consentSend: "Give my answer",
  consentChange: "Change my answer",
  tallyLine: (t: { consent: number; concern: number; object: number; waiting: number }) =>
    `${t.consent} consent, ${t.concern} with a concern, ${t.object} objecting, ${t.waiting} still to answer`,
  talliedLine: (t: { consent: number; concern: number; object: number }) =>
    `${t.consent} consent, ${t.concern} with a concern, ${t.object} objecting`,
  consented: "Everyone here consents.",
  proposalConsentAsk: "Do you consent to this proposal?",

  startItem: "Start this item",
  itemStatus: { waiting: "Waiting", active: "On now", done: "Done", parked: "Parked" } as Record<ItemStatus, string>,
  extendFive: "Add five minutes",
  wrapNext: "Wrap up and start the next",
  wrapUp: "Wrap it up",
  timeLeft: (seconds: number) => `${roomClock(seconds)} left`,
  timeOver: (seconds: number) => `${roomClock(seconds)} over`,
  leftWord: "left",
  overWord: "over",
  notes: "Notes",
  ideas: "Ideas",
  proposal: "Proposal",
  seed: "Seed",
  actionsHere: "Actions",
  nothingYet: "Nothing here yet.",
  writeHere: "Write it here",
  add: "Add",
  decide: "Decided by consent",
  decidedBadge: "Decided",
  seedSave: "Keep this seed",
  dueLabel: "Due by",
  seatLabel: "A seat holds it",
  noSeat: "No seat",
  remove: "Remove",
  heldBy: "Held by",
  nobodyHolds: "Nobody holds this yet",
  unownedOne: "1 action still needs someone",
  outsideAgenda: "Outside the agenda",
  parkedLabel: "Parked",
  doneLabel: "Done",

  tensionPlaceholder: "What are you sensing? It goes to the backlog.",
  tensionSaved: "Thank you. It is in the backlog.",
  send: "Send",

  amountLabel: "Amount",
  thank: (name: string) => `Thank ${name}`,
  thankPlaceholder: "What did they bring today?",
  thankSent: (name: string) => `Your thanks reached ${name}.`,
  thankOnWall: "Thank them on the gratitude wall",
  noOneToThank: "When others join the room, you can thank them here.",
  wordPlaceholder: "One word",
  wordSave: "Leave my word",
  roomWords: "The room's words",
  facilitationSend: "Send it unsigned",
  facilitationSent: "Thank you. The facilitator reads it unsigned.",
  facilitationHeading: "What the room said about the facilitation",
  facilitationNone: "No feedback yet.",
  toolSend: "Send the idea",
  closeConfirm: "Close the session now? The arrival words are erased and the record goes to the admins.",
  closeYes: "Yes, close it",
  closeNo: "Not yet",

  closedOn: (date: string) => `Closed ${date}`,
  arrivalHeading: "How the room arrived",
  arrivalNumbers: (a: { count: number; median: number | null; low: number | null; high: number | null }) =>
    `${a.count} gave a number. The middle was ${a.median} of 11, from ${a.low} to ${a.high}.`,
  noArrival: "Nobody gave a number.",
  agendaHeading: "Agenda and outcomes",
  usedOf: (used: number, of: number) => `${used} of ${of} min`,
  notReached: "Not reached",
  parkedNext: "Parked for next time",
  decisionsHeading: "Decisions",
  seedsHeading: "Seeds",
  actionsHeading: "Actions",
  backlogHeading: "Backlog for next time",
  proposalOpen: "Proposal, not decided",
  showMinutes: "Show the shareable minutes",
  minutesLoading: "Reading the minutes",
  minutesFailed: "The minutes did not load. Try again.",
  copied: "Copied.",
  copyFailed: "This browser would not copy. Select the text and copy it by hand.",
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// THE LIST PAGE'S OWN WORDS. Added by the shell lane (client/src/pages/
// Sessions.tsx and client/src/components/sessions/SessionList.tsx). It only
// adds to what is above, so the voice gate reads every sentence /sessions
// shows from this one file.
// ═════════════════════════════════════════════════════════════════════════════

export const SESSION_LIST_COPY = {
  /** The registry's name for the module, for the gate cards. */
  moduleName: "Live Sessions",
  loading: "Opening the sessions",
  loadFailed: "The sessions did not load. Try again in a moment.",
  retry: "Try again",
  signedOut: "Your sign-in ended. Sign in again to see the sessions.",
  titleLabel: "Title",
  /** The length field's placeholder while it is empty; empty sends no length. */
  usualLength: "The village's usual length",
  opening: "Opening the room...",
  startFailed: "The room did not open. Try again.",
  joining: "Joining...",
  joinFailed: "Could not join the room. Try again.",
  recentEmpty: "Sessions you were in show here once they close.",
  facilitatedBy: (name: string) => `Facilitated by ${name}`,
  people: (n: number) => (n === 1 ? "1 person" : `${n} people`),
  circle: (name: string) => `Circle: ${name}`,
  openedAt: (time: string) => `Opened ${time}`,
  closedOn: (date: string) => `Closed ${date}`,
} as const;
