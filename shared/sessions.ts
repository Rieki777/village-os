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
import type { FilledIn } from "./sessionOnBehalf";
import type { ItemVotes } from "./sessionVotes";
import type { TaskCard } from "./sessionTasks";
import type { CheckView } from "./sessionCheck";

// ── Stages ───────────────────────────────────────────────────────────────────

export const SESSION_STAGES = ["dropin", "arrival", "agenda", "items", "actions", "close"] as const;
export type SessionStage = (typeof SESSION_STAGES)[number];

export function isSessionStage(v: unknown): v is SessionStage {
  return typeof v === "string" && (SESSION_STAGES as readonly string[]).includes(v);
}

/**
 * The mark each stage carries on the room's path. A plain key, so the shared
 * contract names no icon set: the room maps each key to the glyph it draws.
 */
export type StageGlyph = "wind" | "sunrise" | "list" | "sprout" | "hands" | "moon";

export interface StageDef {
  title: string;
  short: string;
  lede: string;
  /** Prompts for whoever is facilitating; shown to the facilitator only. */
  cues: string[];
  glyph: StageGlyph;
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
    glyph: "wind",
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
    glyph: "sunrise",
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
    glyph: "list",
  },
  items: {
    title: "The work",
    short: "Items",
    lede: "One item at a time, each with its own clock and its own page. Notes, ideas and actions land on the item they belong to.",
    cues: [
      "Start the item's clock and say its aim out loud.",
      "Catch every action as it comes, with a name or a role on it.",
      "Close each item with what we learned, in one sentence for the record.",
    ],
    glyph: "sprout",
  },
  actions: {
    title: "Who does what",
    short: "Actions",
    lede: "Every action leaves with a person or a role on it, claimed here and now. Anything nobody can hold goes to the backlog.",
    cues: [
      "Read each action out, then wait for a claim.",
      "No action leaves without an owner. Park it if nobody can hold it.",
    ],
    glyph: "hands",
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
    glyph: "moon",
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
 * seed      the one line an item closes with: what we learned. The room says
 *           "What we learned"; the kind keeps its stored name, `seed`, in
 *           the database, the API and the CSS hooks.
 * decision  a proposal text that a consent round runs on
 * action    something to do, which must leave with an owner
 * tension   something sensed that wants its own time; it goes to the backlog
 * win       a win or a celebration somebody shares (Rye, 2026-10-30: "add a
 *           section for 'wins and celebrations' to share about things
 *           they've won at!"); it goes into the record under its item
 */
export const ENTRY_KINDS = ["note", "idea", "seed", "decision", "action", "tension", "win"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export function isEntryKind(v: unknown): v is EntryKind {
  return typeof v === "string" && (ENTRY_KINDS as readonly string[]).includes(v);
}

export const ENTRY_LABELS: Record<EntryKind, string> = {
  note: "Note",
  idea: "Idea",
  seed: "What we learned",
  decision: "Proposal",
  action: "Action",
  tension: "Tension",
  win: "Win",
};

/**
 * The sections an item's page shows, by name, so a meeting template can
 * switch each on or off (a Friday session that recounts the week leads with
 * `wins`). A view that names none shows them all.
 */
export const ITEM_SECTIONS = ["notes", "ideas", "wins", "proposal", "learned", "actions"] as const;
export type ItemSection = (typeof ITEM_SECTIONS)[number];

export function isItemSection(v: unknown): v is ItemSection {
  return typeof v === "string" && (ITEM_SECTIONS as readonly string[]).includes(v);
}

/** The sections on, from whatever a template named: unknown names drop, and none named means every one. */
export function itemSectionsOn(named: readonly unknown[] | null | undefined): Set<ItemSection> {
  const known = (named ?? []).filter(isItemSection);
  return new Set(named == null ? ITEM_SECTIONS : known);
}

/** open: live. done: an action finished or a decision consented. parked: moved to the backlog. */
export const ENTRY_STATUSES = ["open", "done", "parked"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

// ── Consent rounds ───────────────────────────────────────────────────────────

/**
 * Four answers. `sleep` (Rye, 2026-10-22) is for someone who decides best
 * after a night: it is never an objection and it needs no sentence. Since
 * Rye's ruling on 2026-10-23 it names a time to answer by (`answerBy`): the
 * round waits for them until then, and a night still unanswered at that time
 * counts as no objection, by default. A night asked for before the ruling has
 * no time, and keeps the round waiting until they answer, as it did.
 */
export const CONSENT_VALUES = ["consent", "concern", "object", "sleep"] as const;
export type ConsentValue = (typeof CONSENT_VALUES)[number];

export function isConsentValue(v: unknown): v is ConsentValue {
  return typeof v === "string" && (CONSENT_VALUES as readonly string[]).includes(v);
}

export const CONSENT_LABELS: Record<ConsentValue, string> = {
  consent: "I consent",
  concern: "I consent, with a concern",
  object: "I object",
  sleep: "I'll sleep on it",
};

/** A concern or an objection is said in one sentence, so the room can hear it whole. Sleeping on it needs none. */
export function consentNeedsWords(value: ConsentValue): boolean {
  return value === "concern" || value === "object";
}

/**
 * How far ahead a night's answer-by time may be. At most a week, so a round is
 * never held for longer (a choice the ruling left open, made small); at least
 * a quarter of an hour, so a night is never over before the room has heard it
 * was asked for.
 */
export const SLEEP_LIMITS = {
  maxAheadMs: 7 * 86_400_000,
  minAheadMs: 15 * 60_000,
} as const;

/** A night's answer-by time from a body (an ISO instant), inside the window from `now`. */
export function cleanAnswerBy(raw: unknown, now: number): { ok: true; value: number } | { ok: false; error: string } {
  const at = typeof raw === "string" && raw.trim() ? Date.parse(raw) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(at)) return { ok: false, error: SESSION_REFUSALS.answerByNeeded };
  if (at < now + SLEEP_LIMITS.minAheadMs) return { ok: false, error: SESSION_REFUSALS.answerBySoon };
  if (at > now + SLEEP_LIMITS.maxAheadMs) return { ok: false, error: SESSION_REFUSALS.answerByFar };
  return { ok: true, value: at };
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

// ── The sit ──────────────────────────────────────────────────────────────────

/**
 * A meditation drop in: a quiet the whole room keeps for a few minutes, read
 * against the room's clock like the breath, so every screen ends together and
 * every bowl rings at the same moment.
 */
export const SIT_MINUTES = [1, 3, 5, 10] as const;

/**
 * How long the light keeps moving after the bowl rings: one slow climb from
 * the root to the crown and one slow fall back.
 */
export const SIT_SETTLE_SECS = 8;

export type SitMoment =
  | { state: "idle" }
  | { state: "sitting"; progress: number; secondsLeft: number; elapsed: number }
  | { state: "done"; sinceEnd: number };

/** Where a shared sit is at `now`. */
export function sitAt(s: { minutes: number; startedAt: number | null }, now: number): SitMoment {
  if (s.startedAt == null) return { state: "idle" };
  const total = s.minutes * 60;
  const t = (now - s.startedAt) / 1000;
  if (t < 0) return { state: "idle" };
  if (t >= total) return { state: "done", sinceEnd: t - total };
  return { state: "sitting", progress: t / total, secondsLeft: Math.ceil(total - t), elapsed: t };
}

// ── The room's state, which the facilitator moves ────────────────────────────

export interface SessionState {
  stage: SessionStage;
  stageStartedAt: number | null;
  /** When the session clock started: "Begin", or the facilitator's first move of the room, whichever came first. */
  startedAt: number | null;
  /** The agenda item on screen during the items stage. */
  activeItemId: number | null;
  itemStartedAt: number | null;
  /** Grace minutes the room consented to add to the active item. */
  itemExtraMin: number;
  breath: { pattern: BreathKey; rounds: number; startedAt: number | null };
  /** A meditation drop in the whole room sits together. */
  sit: { minutes: number; startedAt: number | null };
  /** A speaking round: the order people speak in and who is speaking now. */
  round: { label: string | null; order: number[]; at: number };
  /**
   * The facilitator set the agenda's order (0290, shared/sessionVotes.ts):
   * the room's vote is closed. False while the room votes and the agenda
   * sorts itself by the score.
   */
  orderSet: boolean;
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
    sit: { minutes: 3, startedAt: null },
    round: { label: null, order: [], at: 0 },
    orderSet: false,
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
  const sitIn = src.sit && typeof src.sit === "object" ? src.sit : {};
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
    sit: {
      minutes: (SIT_MINUTES as readonly number[]).includes(sitIn.minutes) ? sitIn.minutes : base.sit.minutes,
      startedAt: intOrNull(sitIn.startedAt, 0, 2 ** 53),
    },
    round: {
      label: typeof roundIn.label === "string" ? cleanLine(roundIn.label, 60) : null,
      order,
      at: intOrNull(roundIn.at, 0, Math.max(0, order.length)) ?? 0,
    },
    orderSet: src.orderSet === true,
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
  | { type: "sit"; minutes?: number; run: boolean }
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
    case "sit": {
      if (typeof a.run !== "boolean") return null;
      if (a.minutes === undefined) return { type: "sit", run: a.run };
      if (!(SIT_MINUTES as readonly number[]).includes(a.minutes)) return null;
      return { type: "sit", minutes: a.minutes, run: a.run };
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
      // The first move starts the clock. A facilitator who goes straight on
      // without pressing "Begin" still gets a room that counts its minutes,
      // so the agenda's fit and the session's length always have a start.
      return { ...state, stage: action.stage, stageStartedAt: now, startedAt: state.startedAt ?? now, round: { label: null, order: [], at: 0 } };
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
    case "sit":
      return { ...state, sit: { minutes: action.minutes ?? state.sit.minutes, startedAt: action.run ? now : null } };
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
  /** People sleeping on it: answered for now, never an objection, and the round waits for them. */
  sleeping: number;
  /**
   * Nights whose answer-by time passed with no other answer: each counts as no
   * objection, by default (Rye, 2026-10-23), and never keeps the round waiting.
   * Absent from a record written before the ruling, which reads as none.
   */
  byDefault?: number;
  /** People here who have not answered yet. */
  waiting: number;
  /** Everyone here has answered, nobody is sleeping on it, and nobody objects. */
  consented: boolean;
}

/** One answer in a consent round, with who gave it (a member's number in the room). */
export interface ConsentAnswer {
  who: number;
  value: ConsentValue;
  /** On a night: when it ends, in ms. Null on a night asked for before answer-by times, which never ends by itself. */
  answerBy?: number | null;
}

/** A night whose answer-by time has come counts as no objection. */
export function nightIsOver(a: Pick<ConsentAnswer, "value" | "answerBy">, now: number): boolean {
  return a.value === "sleep" && a.answerBy != null && a.answerBy <= now;
}

/** A night that still lasts: its answer-by time is still ahead. */
export function nightLasts(a: Pick<ConsentAnswer, "value" | "answerBy">, now: number): boolean {
  return a.value === "sleep" && a.answerBy != null && a.answerBy > now;
}

/**
 * A round that outlives its call (Rye, 2026-10-23: "Round outlives the call").
 * A proposal still open at the close with somebody sleeping on it keeps its
 * round after the session closes: whoever asked for a night answers it from
 * the record until their time, and once no night lasts, the round consents
 * when nobody objects and nobody in the room at the close went unheard
 * (`waitingAtClose`, since nobody else can answer after the call). Marking it
 * decided stays the facilitator's act. Pure, so the record, the job and the
 * doors read one rule.
 */
export function nightRoundState(
  atClose: { waiting: number } | undefined,
  answers: readonly ConsentAnswer[],
  now: number,
): { outlives: boolean; open: boolean; consented: boolean; tally: ConsentTally } {
  const t = consentTally(answers, [], now);
  const outlives = atClose != null;
  const open = t.sleeping > 0;
  const consented = outlives && !open && atClose.waiting === 0 && t.object === 0 && answers.length > 0;
  return { outlives, open, consented, tally: { ...t, waiting: atClose?.waiting ?? 0, consented } };
}

/** When a night ends, in the village's own clock: "9:00 on Saturday 24 October". */
export function nightAtWords(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", weekday: "long", day: "numeric", month: "long", hourCycle: "h23" }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${Number(part("hour"))}:${part("minute")} on ${part("weekday")} ${part("day")} ${part("month")}`;
}

/**
 * A consent round, counted person by person. `waiting` is the people here now
 * who have not answered, so an answer from someone who has left never stands in
 * for someone present who has not been heard. Every answer counts toward the
 * totals, and an objection blocks whoever gave it, present or not. A night
 * whose answer-by time has come (by `now`) counts as no objection, by default.
 */
export function consentTally(answers: readonly ConsentAnswer[], presentIds: readonly number[], now: number = Date.now()): ConsentTally {
  const t = { consent: 0, concern: 0, object: 0, sleep: 0, byDefault: 0 };
  for (const a of answers) {
    if (nightIsOver(a, now)) t.byDefault += 1;
    else t[a.value] += 1;
  }
  const waitingIds = consentWaitingIds(answers, presentIds);
  const heardHere = presentIds.some((id) => answers.some((a) => a.who === id));
  return {
    consent: t.consent,
    concern: t.concern,
    object: t.object,
    sleeping: t.sleep,
    byDefault: t.byDefault,
    waiting: waitingIds.length,
    consented: heardHere && waitingIds.length === 0 && t.object === 0 && t.sleep === 0,
  };
}

/**
 * The people here now who have not answered a consent round, in the order
 * they were given, each once. `consentTally` counts this same list, so the
 * number under a tally and the names under it can never disagree.
 */
export function consentWaitingIds(answers: readonly Pick<ConsentAnswer, "who">[], presentIds: readonly number[]): number[] {
  const said = new Set(answers.map((a) => a.who));
  return Array.from(new Set(presentIds)).filter((id) => !said.has(id));
}

/** The consent questions a room asks: the agenda, and the round on each proposal. */
export type ConsentTarget = "agenda" | `decision:${number}`;

/** Someone here who has not answered yet, named the way the room names people. */
export interface WaitingPerson {
  userId: number;
  name: string;
}

/**
 * Who each open consent question is still waiting on, by target: "agenda"
 * while the session is open, and "decision:<entryId>" for each proposal still
 * open. A target with nobody waiting holds an empty list. The room reads it to
 * name the people a tally's "still to answer" counts; it never reaches the
 * minutes, which keep only the counts.
 */
export type ConsentWaiting = Partial<Record<ConsentTarget, WaitingPerson[]>>;

/**
 * Who each open consent question is waiting on, from the room's own wire
 * shapes: the people here now (`present`), the proposals still open, and the
 * consent answers given. The server builds the view's `waiting` with it, and
 * the tally beside it counts the same people through `consentWaitingIds`.
 */
export function consentWaiting(
  people: readonly Pick<SessionPerson, "userId" | "name" | "present">[],
  entries: readonly Pick<SessionEntry, "id" | "kind" | "status">[],
  responses: readonly Pick<SessionResponse, "target" | "userId" | "value">[],
): ConsentWaiting {
  const here = people.filter((p) => p.present);
  const nameOf = new Map(here.map((p) => [p.userId, p.name] as const));
  const targets: ConsentTarget[] = [
    "agenda",
    ...entries.filter((e) => e.kind === "decision" && e.status === "open").map((e) => `decision:${e.id}` as const),
  ];
  const out: ConsentWaiting = {};
  for (const target of targets) {
    const answers = responses.filter((r) => r.target === target && isConsentValue(r.value)).map((r) => ({ who: r.userId }));
    out[target] = consentWaitingIds(answers, here.map((p) => p.userId)).map((userId) => ({ userId, name: nameOf.get(userId) ?? "" }));
  }
  return out;
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
  /** A text moon for places that can only carry text; the room draws `moonPhase` instead. */
  moonGlyph: string;
  /**
   * The moon's phase as the session opened: 0 new, 0.5 full, running back
   * toward 1 as it wanes, the fraction calendar/MoonGlyph.tsx draws. Null on a
   * stamp stored before it was kept. Optional only so older fixtures still
   * type; the server always sends it.
   */
  moonPhase?: number | null;
  /** Which way the drawn moon is lit, from `calendar.hemisphere`. Null on an older stamp; draw it as the north. */
  hemisphere?: "north" | "south" | null;
  /** The village's own moon count, when it keeps one. */
  moonOrdinal: number | null;
  /**
   * The season as the session opened, in the village's own words when it has
   * named its seasons (`calendar.seasons`), else one of SESSION_SEASONS by its
   * hemisphere. Null in the tropics when the village has named none, and on a
   * stamp that could not tell. Any string can arrive here, so whatever shows
   * it prints the name as given and maps nothing.
   */
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
  /**
   * Stock character art for the member's fronted character, or null. Never an
   * uploaded portrait: the room shows a face the member chose from the
   * village's own art, and nothing they uploaded leaves their profile this way.
   */
  avatar?: string | null;
  /** While open: the facilitator gave this arrival for them (0288, shared/sessionOnBehalf.ts). */
  arrivalFilledIn?: FilledIn | null;
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
  /**
   * When it was taken from the agenda library (shared/sessionLibrary.ts): the
   * library item's id, and the name of whoever brought it, who may not be in
   * the room. Optional so older fixtures still type; the room's view always
   * sends both, null for an item added in the room.
   */
  libraryId?: number | null;
  broughtBy?: string | null;
  /** The latest fill-in on it that still stands (0288, shared/sessionOnBehalf.ts). */
  filledIn?: FilledIn | null;
  /** The room's vote on it (0290, shared/sessionVotes.ts). Optional so older fixtures still type. */
  votes?: ItemVotes;
}

export interface SessionEntry {
  /** A win only: the id of the season priority it serves, or null (0298, shared/sessionTemplates.ts). */
  servesGoalId?: string | null;
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
  /**
   * First names of the people who sit in the owning seat now, read from the roster when the
   * room is read, so a line can say "Treasurer (Rick)" (Rye, 2026-10-30). Only the signed-in
   * room view fills it; the minutes and anything that leaves the village never carry it.
   */
  ownerSeatHolders?: string[];
  dueOn: string | null;
  createdAt: string;
  /** The latest fill-in on it that still stands (0288, shared/sessionOnBehalf.ts). */
  filledIn?: FilledIn | null;
}

/**
 * Where an open proposal of a closed session stands, when its round outlived
 * the call (`nightRoundState`). Only on a closed record, and only for the
 * people who read its answers.
 */
export interface NightRound {
  entryId: number;
  /** A night on it still lasts. */
  open: boolean;
  /** No night lasts, nobody objects, and nobody at the close went unheard. */
  consented: boolean;
  /** The viewer asked for a night on it that still lasts, so they answer it here. */
  canAnswer: boolean;
  /** The viewer may mark it decided: the session's facilitator or an admin, once it consented. */
  canDecide: boolean;
}

export interface SessionResponse {
  target: ResponseTarget;
  userId: number;
  value: string;
  text: string | null;
  /** On a night (`sleep`): when it ends, an ISO instant. Null otherwise, and on a night asked for before answer-by times. */
  answerBy?: string | null;
}

export interface SeatOption {
  id: string;
  name: string;
  circleId: string | null;
}

export interface SessionView {
  /**
   * The sections each item's page shows, when a meeting template named them
   * (`ITEM_SECTIONS`). Absent or null shows every one.
   */
  itemSections?: ItemSection[] | null;
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
  /**
   * Who each open consent question is still waiting on, for a viewer who sees
   * the answers (the people in the room and admins). Empty for anyone else and
   * once the session closes. Optional only so older fixtures still type; the
   * server always sends it.
   */
  waiting?: ConsentWaiting;
  seats: SeatOption[];
  /** After close: the arrival round as numbers only. */
  arrival: ArrivalSummary | null;
  /**
   * From the circle's last close, passing over a session one person was in
   * that left nothing behind: its open actions and its backlog.
   */
  carried: { sessionId: number; title: string; actions: SessionEntry[]; backlog: SessionEntry[]; parkedItems: { title: string; aim: ItemAim; minutes: number }[] } | null;
  /** On a closed record: the proposals whose round outlived the call (Rye, 2026-10-23). Absent or empty otherwise. */
  nights?: NightRound[];
  /**
   * This room's tensions already sent to a circle's agenda items, by entry id:
   * the circle's name, or null for no circle in particular (shared/sessionLibrary.ts).
   */
  sentTensions: Record<string, { circleName: string | null }>;
  /** The village's live circles, for choosing which circle's agenda items a tension goes to. Empty for somebody not in the room. */
  circleOptions: { id: string; name: string }[];
  /**
   * Every task from this circle's earlier sessions that is still open, or that
   * was answered since the circle last met, with its latest answer, as this
   * viewer may see it (shared/sessionTasks.ts). Always present; empty when the
   * session has no circle or the circle has no tasks.
   */
  circleTasks: TaskCard[];
  /**
   * When the circle last met: the close of the session `carried` comes from,
   * which the action check groups by. Null when there are no `circleTasks`, or
   * the circle has never closed a session.
   */
  circleLastMetAt: string | null;
  /**
   * Each checked proposal's read (0297, shared/sessionCheck.ts), for everybody
   * who sees the room. Null, or absent in an older fixture, when the module
   * that offers checks is not open to members.
   */
  check?: CheckView | null;
  me: { userId: number; joined: boolean; facilitates: boolean; secretary: boolean; admin: boolean };
}

/** What the session door changes. Only the title, for now; other keys are ignored. */
export interface SessionPatch {
  title?: string;
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
 *   GET    /api/sessions                          { open: SessionListRow[], recent: SessionListRow[], circles: {id,name}[], library }
 *   POST   /api/sessions                          { title, circleId?, durationMin?, libraryIds? } -> { id }
 *     (`templateId?` opens it from a meeting template and links it to that series: shared/sessionTemplates.ts)
 *          (the agenda library's own doors are listed in shared/sessionLibrary.ts)
 *   GET    /api/sessions/:id                      SessionView, with an ETag; 304 when nothing moved
 *   PATCH  /api/sessions/:id                      SessionPatch { title } -> { ok }
 *   DELETE /api/sessions/:id                      { ok } (discard an open session, or delete a closed record)
 *   POST   /api/sessions/:id/join                 { ok }
 *   POST   /api/sessions/:id/here                 { ok } (presence, every HERE_EVERY_MS)
 *   POST   /api/sessions/:id/arrival              { score, wish? } -> { ok }
 *   POST   /api/sessions/:id/items                { title, aim, minutes } -> { id }
 *   PATCH  /api/sessions/:id/items/:itemId        { title?, aim?, minutes?, position?, status? } -> { ok }
 *   POST   /api/sessions/:id/entries              { kind, text, itemId?, ownerSeatId?, dueOn? } -> { id }
 *   PATCH  /api/sessions/:id/entries/:entryId     { claim?, release?, ownerSeatId?, text?, dueOn?, status? } -> { ok }
 *   DELETE /api/sessions/:id/entries/:entryId     { ok }
 *   POST   /api/sessions/:id/entries/:entryId/check   {} -> { ok } (a proposal's read, 0297: shared/sessionCheck.ts)
 *   POST   /api/sessions/:id/respond              { target, value, text? } -> { ok } (never for someone else)
 *   POST   /api/sessions/:id/on-behalf/:fillId/undo   {} -> { ok } (shared/sessionOnBehalf.ts)
 *   POST   /api/sessions/:id/act                  { action: SessionAction } -> { ok, state }
 *   POST   /api/sessions/:id/hosts                { facilitatorUserId?, secretaryUserId? } -> { ok }
 *   POST   /api/sessions/:id/close                {} -> { ok } or 409 { error, unowned: number[] }
 *   POST   /api/sessions/:id/tool-feedback        { text } -> { ok } (lands in the village's feedback inbox)
 *   GET    /api/sessions/:id/minutes.md?for=shareable   text/markdown
 */
export const SESSIONS_API = "/api/sessions";

/** One session's own door: the GET of the room and the PATCH of its title. */
export function sessionUrl(id: number): string {
  return `${SESSIONS_API}/${id}`;
}

// ── Closing ──────────────────────────────────────────────────────────────────

/** Actions nobody holds yet. A session closes only when this is empty. */
export function unownedActions(entries: Pick<SessionEntry, "id" | "kind" | "status" | "ownerUserId" | "ownerSeatId">[]): number[] {
  return entries
    .filter((e) => e.kind === "action" && e.status === "open" && e.ownerUserId == null && !e.ownerSeatId)
    .map((e) => e.id);
}

export const CLOSE_REFUSAL = "Every action needs a person or a role before the session closes. Claim it, name a role, or park it.";

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
      const counts = t ? ` (${ROOM_COPY.talliedLine(t)})` : "";
      lines.push(`- **${how}:** ${text(d.text)}${counts}`);
    }
    for (const s of list.filter((e) => e.kind === "seed")) lines.push(`- **What we learned:** ${text(s.text)}`);
    for (const w of list.filter((e) => e.kind === "win")) lines.push(`- **Win:** ${text(w.text)}`);
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
  nothingOpen: "All quiet for now. Open the room when your circle is ready.",
  joinButton: "Join the room",
  joinedLabel: "You're in",
  placeLineFallback: "Take a moment to feel where you are.",
  arrivalPrompt: "How are you arriving, from 1 to 11?",
  wishPrompt: "What would make it an 11+?",
  wishPlaceholder: "Optional, in a few words",
  arrivalSaved: "Thanks. You're checked in.",
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
  itemSeedPrompt: "What did this item teach us?",
  overChoices: "Time is up for this item. Add five minutes with the room's consent, park it, or wrap it up.",
  addNote: "Add a note",
  addIdea: "Add an idea",
  addWin: "Share a win",
  addAction: "Add an action",
  addTension: "Name a tension",
  addDecision: "Write the proposal",
  claim: "I'll take it",
  release: "Hand it back",
  nameSeat: "Name a role",
  park: "Park it",
  unownedLeft: "still need someone",
  everyoneHolds: "Every action has someone holding it.",
  closeButton: "Close the session",
  closeDone: "Beautiful work, circle. The session is closed, and the notes are saved for everyone who was here.",
  wordPrompt: "One word as you leave",
  facilitationPrompt: "How did the facilitation feel?",
  facilitationMore: "What would you keep, or try next time? The facilitator reads this unsigned.",
  toolPrompt: "How could this tool flow better?",
  toolPlaceholder: "Your idea goes to the village's feedback inbox.",
  toolSent: "Thanks. Your idea was sent.",
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
  notesOnly: "Only the facilitator, the secretary or an admin in the room can change that.",
  aimMinutesNotes: "Once an item starts, its aim and minutes are for the facilitator or the secretary to change.",
  itemUnknown: "That item is not on this agenda.",
  itemTitleNeeded: "Give the item a title.",
  aimNeeded: "An aim is report, explore or decide.",
  minutesRange: `Give an item from ${SESSION_LIMITS.minutesMin} to ${SESSION_LIMITS.minutesMax} minutes.`,
  agendaFull: `The agenda holds ${SESSION_LIMITS.maxAgenda} items. Park one or finish one first.`,
  positionNeeded: "A place on the agenda is a whole number.",
  itemStatusUnknown: "An item is waiting, done or parked. Start one from the room's controls.",
  fromSession: "That earlier session is not a closed session of this circle.",
  entryKind: "An entry is a note, an idea, a line on what we learned, a proposal, an action or a tension.",
  textNeeded: "Write a few words first.",
  entryUnknown: "That entry is not in this session.",
  entriesFull: `This session holds ${SESSION_LIMITS.maxEntries} entries, and that is all it can hold.`,
  yoursFull: `One person can add ${SESSION_LIMITS.maxEntriesPerPerson} entries to a session, and you have.`,
  seatUnknown: "That role is not an active role in this village.",
  dueOn: "A due date reads like 2026-10-31.",
  notAction: "Only an action can be taken or handed back.",
  heldAlready: "Someone already holds this action.",
  notHeld: "Nobody holds this action yet.",
  releaseNotYours: "Only the person holding it, or the facilitator, can hand it back.",
  notYours: "Only the person who wrote it, the facilitator, the secretary or an admin in the room can change it.",
  entryStatusUnknown: "An entry is open, done or parked.",
  decisionNotConsented: "A proposal is decided once everyone here has answered and nobody objects.",
  decisionClosed: "That proposal is no longer open for answers.",
  targetUnknown: "That is not something to answer here.",
  consentValue: "Answer with consent, concern or object.",
  consentWords: "Say your concern or objection in one sentence.",
  answerByNeeded: "Say when you will answer by.",
  nightInRoom: "This session is still open. Answer in the room.",
  noNight: "Nobody asked for a night on this proposal.",
  nightNotYours: "Only somebody who asked for a night on this proposal answers it after the call.",
  nightOver: "Your night has ended, so your answer counts as no objection.",
  nightValue: "Answer with I consent, I consent with a concern, or I object.",
  answerBySoon: "Give yourself at least a quarter of an hour.",
  answerByFar: "Choose a time within the next week.",
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
  /** DELETE on an open session, from somebody who neither facilitates it nor is an admin. */
  discardNotYours: "Only the person facilitating or an admin can discard this session.",
  /** DELETE on a closed session, from anybody who is not an admin, the facilitator included. */
  recordAdminOnly: "Only an admin can delete the record of a closed session.",
} as const;

/** What a person is called when the village no longer holds their name. */
export const SESSION_SOMEONE = "A member";

/**
 * The platform's own season names, turned by the village's hemisphere. A stamp
 * carries one of these only when the village has named no seasons of its own
 * and its land is outside the tropics; otherwise `season` is the village's word
 * or null, so nothing may assume a stamp's season is in this list.
 */
export const SESSION_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type SessionSeason = (typeof SESSION_SEASONS)[number];

/** The words on the two notices a close sends. */
export const SESSION_NOTICES = {
  /** To every admin: the record of a session is ready to read. */
  recordReady: (title: string): string => `The record of "${title}" is ready to read`,
  /** To each person who holds an action, or who sits in a seat that holds one. */
  actionHeld: (title: string): string => `An action from "${title}" is in your hands`,
  /**
   * The line under it: the action itself, and its date when it has one, in
   * words ("Thursday 22 October", from taskDateWords), never machine digits.
   */
  actionBody: (text: string, dueWords: string | null): string => (dueWords ? `${text.replace(/[.!?]+$/, "")}, by ${dueWords}.` : text),
  /** To somebody whose night outlives the call: where and by when to answer. */
  nightOpen: (title: string): string => `You asked for a night on a proposal in "${title}"`,
  nightOpenBody: (text: string, when: string): string =>
    `${text.replace(/[.!?]+$/, "")}. Answer from the session's record by ${when}, or your answer counts as no objection.`,
  /** To the facilitator, once no night lasts on a round that outlived the call. */
  nightSettled: (title: string, consented: boolean): string =>
    consented ? `The round on a proposal in "${title}" consented after the call. You can mark it decided.` : `The night is over on a proposal in "${title}".`,
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
  clockWaiting: "The clock starts when the facilitator begins the session or moves the room on.",
  clockWaitingYou: "The clock starts when you begin, or when you first move the room on.",
  facilitatedBy: (name: string) => `Facilitated by ${name}`,
  clockLine: (elapsedMin: number, durationMin: number) => `${elapsedMin} of ${durationMin} min`,
  beginSession: "Begin the session",
  // Said once to a screen reader when Begin lands, because the same spot on
  // the bar then turns into the Next stage button.
  sessionBegun: "The session has begun. The clock is running.",
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
  nobodyHere: "The room is quiet. Nobody has arrived yet.",
  breathTitle: "Breathe together",
  breathIdle: "When the facilitator starts it, every screen breathes at the same pace.",
  breathDone: "Let the quiet sit for a moment.",
  breathPattern: "Pattern",
  breathRounds: "Rounds",
  breathStart: "Start the breath",
  breathStop: "Stop the breath",
  breathAgain: "Breathe again",
  breathRound: (n: number, of: number) => `Round ${n} of ${of}`,
  breathStepLine: (secondsLeft: number, round: number, of: number) =>
    `${secondsLeft === 1 ? "1 second" : `${secondsLeft} seconds`} · Round ${round} of ${of}`,
  breathCounts: (secs: readonly number[]) => secs.join(" · "),
  breathStartedSay: (rounds: number) => `The shared breath has started, ${rounds} rounds.`,

  sitTitle: "Sit together",
  sitIdle: "A few minutes of quiet for the whole room. A singing bowl rings on every screen when it ends.",
  sitMinutes: "Minutes",
  sitStart: "Start the sit",
  sitStop: "End the sit early",
  sitAgain: "Sit again",
  sitMinutesWord: (n: number) => (n === 1 ? "1 minute" : `${n} minutes`),
  sitLeft: (secondsLeft: number) => {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  },
  sitLeftHint: "left in the quiet",
  sitSitting: "Rest your eyes. The bowl will call you back.",
  sitDone: "The bowl has rung. Come back slowly.",
  sitStartedSay: (minutes: number) => `The sit has started, ${minutes === 1 ? "1 minute" : `${minutes} minutes`}.`,
  sitEndedSay: "The sit has ended.",
  bellOn: "Bell on this screen",
  bellOff: "Turn the bell on",
  bellHint: "Browsers stay silent until you tap once. Tap here so the bowl can ring for you.",
  bellMuted: "Sound is muted on this device, so the bowl will not ring.",

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
  roundDone: "Everyone has spoken. Thank you all.",
  joinFirst: "Join the room to take part here.",

  parkedItems: "Parked last time",
  addToAgenda: "Add to the agenda",
  actionCheckTitle: "Action check from last time",
  addActionCheck: "Add an action check to the agenda",
  itemTitleLabel: "Item title",
  itemTitlePlaceholder: "What needs the circle's time?",
  addItemButton: "Add it",
  agendaEmpty: "The agenda is still blank. Anyone in the room can add the first item.",
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
  tallyLine: (t: { consent: number; concern: number; object: number; sleeping?: number; byDefault?: number; waiting: number }) =>
    `${t.consent} consent, ${t.concern} with a concern, ${t.object} objecting${t.sleeping ? `, ${t.sleeping} sleeping on it` : ""}${t.byDefault ? `, ${t.byDefault} no objection by default` : ""}, ${t.waiting} still to answer`,
  /** A record written before anyone could sleep on it carries no `sleeping`, and reads the same as it did. */
  talliedLine: (t: { consent: number; concern: number; object: number; sleeping?: number; byDefault?: number }) =>
    `${t.consent} consent, ${t.concern} with a concern, ${t.object} objecting${t.sleeping ? `, ${t.sleeping} sleeping on it` : ""}${t.byDefault ? `, ${t.byDefault} no objection by default` : ""}`,
  /** Under a round while somebody is sleeping on it. */
  sleepingOpen: "Somebody asked for a night. The round stays open until they answer.",
  /** Choosing "I'll sleep on it": the time they will answer by (Rye, 2026-10-23). */
  nightAsk: "When will you answer by?",
  nightTomorrow: "Tomorrow, 9:00",
  nightTwoDays: "In two days, 9:00",
  nightTimeLabel: "Or choose a time",
  nightHint: "If you have not answered by then, your answer counts as no objection.",
  nightNeeded: "Say when you will answer by.",
  nightOpen: (name: string, when: string): string => `${name} asked for a night. The round stays open until ${when}.`,
  nightOver: (name: string, when: string): string => `${name}'s night ended at ${when}, so it counts as no objection.`,
  /** On a closed record, for a round that outlived the call. */
  recordNightYours: (when: string): string => `You asked for a night. Answer by ${when}, or your answer counts as no objection.`,
  recordConsented: "The round consented after the call: nobody objects.",
  recordNotConsented: "The night is over, and the round did not consent.",
  markDecided: "Mark it decided",
  nightAnswerAsk: "Your answer after a night",
  nightAnswered: "Your answer is in the record.",
  decidedAfterNight: "Marked decided.",
  consented: "Everyone here consents.",
  waitingFor: (names: readonly string[]) => `Waiting for ${names.join(", ")}`,
  proposalConsentAsk: "Do you consent to this proposal?",

  startItem: "Start this item",
  itemStatus: { waiting: "Waiting", active: "On now", done: "Done", parked: "Parked" } as Record<ItemStatus, string>,
  extendFive: "Add five minutes",
  wrapNext: "Wrap up and start the next",
  wrapUp: "Wrap it up",
  /** The facilitator's next-step bar: the one next thing to do, named, on the agenda, the items and the close. */
  nextStepLabel: "Next step",
  upNext: (title: string) => `Up next: ${title}`,
  nowOn: (title: string) => `Now: ${title}`,
  lastItem: "This is the last item on the agenda.",
  timeUpFor: (title: string) => `Time is up for ${title}.`,
  startFirst: "Start the first item",
  startNext: "Start the next item",
  itemsDone: "Every item on the agenda is done.",
  agendaReady: "When the agenda is ready, start the first item.",
  agendaNone: "Add an item to the agenda, or move on.",
  closeLast: "Last step: one word each, then close the session.",
  goToClose: "Go to Close the session",
  timeLeft: (seconds: number) => `${roomClock(seconds)} left`,
  timeOver: (seconds: number) => `${roomClock(seconds)} over`,
  leftWord: "left",
  overWord: "over",
  notes: "Notes",
  ideas: "Ideas",
  proposal: "Proposal",
  seed: "What we learned",
  seedHelp: "One sentence the circle wants to remember from this item. It goes into the record.",
  wins: "Wins and celebrations",
  winsHelp: "Something you won at, finished, or want the circle to celebrate. It goes into the record.",
  actionsHere: "Actions",
  nothingYet: "Nothing here yet.",
  writeHere: "Write it here",
  add: "Add",
  decide: "Decided by consent",
  decidedBadge: "Decided",
  seedSave: "Add to the record",
  dueLabel: "Due by",
  seatLabel: "A role holds it",
  noSeat: "No role",
  remove: "Remove",
  heldBy: "Held by",
  nobodyHolds: "Nobody holds this yet",
  unownedOne: "1 action still needs someone",
  outsideAgenda: "Outside the agenda",
  parkedLabel: "Parked",
  doneLabel: "Done",

  tensionPlaceholder: "What are you sensing? It goes to the backlog.",
  tensionSaved: "Thanks. It's in the backlog.",
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
  facilitationSent: "Thanks. The facilitator reads it unsigned.",
  facilitationHeading: "What the room said about the facilitation",
  facilitationNone: "No feedback yet.",
  toolSend: "Send the idea",
  closeConfirm: "Close the session now? The arrival words are erased, and the notes are saved for everyone who was here.",
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
  seedsHeading: "What we learned",
  actionsHeading: "Actions",
  backlogHeading: "Backlog for next time",
  proposalOpen: "Proposal, not decided",
  showMinutes: "Show the shareable minutes",
  minutesLoading: "Reading the minutes",
  minutesFailed: "The minutes did not load. Try again.",
  copied: "Copied.",
  copyFailed: "This browser would not copy. Select the text and copy it by hand.",

  // Editing in the room. Every box can be changed by whoever may change it,
  // and the words say plainly what a key does and what stays final.
  editThis: (what: string) => `Edit ${what}`,
  saving: "Saving...",
  /** Shown only after the server said yes. */
  saved: "Saved.",
  editKeys: "Enter saves. Shift and Enter starts a new line. Escape cancels.",
  editKeysOneLine: "Enter saves. Escape cancels.",
  countOf: (n: number, max: number) => `${n} of ${max}`,
  rewordWarn: "Changing the words starts the consent round again.",
  decidedLock: "Decided by consent. The words stay as the room agreed them.",
  backlogSoFar: "In the backlog so far",
  sessionTitleLabel: "Session title",
  actionPlaceholder: "What needs doing, in a sentence",
  actionHolderLabel: "Who holds it",
  answerAgain: "Answer again to change it.",
  facilitationReplace: "Sending again replaces what you sent before.",
  /** The one hand-lettered moment in the room, under the closing words. */
  signoff: "With gratitude",
  /** The eyebrow over the people strip. */
  holding: "Holding",
  /** A screen reader's word for the note-taker's mark. */
  noteTaking: "Taking notes",
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
  /** An open room's card, for a member already in it: the way back in. */
  enterRoom: "Enter the room",
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// DISCARDING A SESSION, AND DELETING A RECORD. One door, DELETE /api/sessions/:id.
// While a session is open its facilitator or an admin may discard it; once it
// has closed, only an admin may delete its record. Either way it is a real
// delete: every row the session holds goes, and no record is kept.
// ═════════════════════════════════════════════════════════════════════════════

export const SESSION_DISCARD_COPY = {
  /** The quiet control inside an open room. */
  discardButton: "Discard this session",
  discardTitle: "Discard this session?",
  discardBody: "Everything in it is removed for everyone, and no record is kept. Use this for a session opened by mistake or as a test.",
  keep: "Keep it",
  discard: "Discard",
  discarding: "Discarding...",
  /** What the sessions list says to whoever was in the room when it went. */
  discarded: "This session was discarded.",
  /** The quiet control on a closed record, for admins. */
  deleteButton: "Delete this record",
  deleteTitle: "Delete this record?",
  deleteBody: "Its minutes, decisions and the tasks it left are removed for everyone. This cannot be undone.",
  keepRecord: "Keep it",
  delete: "Delete",
  deleting: "Deleting...",
  /** What the sessions list says once a record is gone. */
  deleted: "This record was deleted.",
  /** A refusal with no sentence of its own, or a network that did not answer. */
  failed: "That did not go through. Try again in a moment.",
} as const;
