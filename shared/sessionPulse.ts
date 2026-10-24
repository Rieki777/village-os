/**
 * Live Sessions: A CIRCLE'S SEASON, and THE REGENERATIVE LENS.
 *
 * ONE FILE IS THE CONTRACT for both, the way shared/sessionDecisions.ts is for
 * a circle's decisions. The pulse's reads (server/repos/sessionPulse.ts), its
 * rules (server/lib/sessionPulse.ts), its door (server/routes/sessionPulse.ts),
 * "This season" on /sessions, and the lens under a proposal in the room read
 * their shapes, rules and words from here. No table: everything is read from
 * what the circle's closed sessions already hold.
 *
 * WHERE IT COMES FROM. Feature 6 of the sessions program (Rye, 2026-10-22).
 *
 *   THE PULSE. How a circle has been doing this season, in numbers it already
 *   wrote down: how often it met and how many came, what it decided by
 *   consent, the tensions it named, where its actions stand, and how the room
 *   arrived (the arrival round's median, numbers only). The season is the one
 *   a session's stamp names (the village's own seasons, or the natural ones
 *   by hemisphere); a village with no seasons (the tropics) reads the last
 *   three months.
 *
 *   THE LENS. Four questions under an open proposal, for a room that wants to
 *   look at it whole before it consents. They are prompts, kept nowhere.
 *
 * WHO reads a circle's pulse: its members by standing (in its last meeting,
 * or holding one of its roles now) and admins, the audience its decision log
 * has. Counts only: no name, no words.
 *
 * COPY RULES. Platform code carries no village's name. No em-dashes, and every
 * string a member reads lives in this file so the voice gate reads it.
 */
import { CIRCLES_API } from "./sessionRhythm";
import { circleWords } from "./sessionTasks";

// ── The door ─────────────────────────────────────────────────────────────────

/**
 *   GET /api/sessions/circles/:circleId/pulse    CirclePulse
 *
 * Five segments beginning `circles`, so it is never read as a room's.
 */
export function circlePulseUrl(circleId: string): string {
  return `${CIRCLES_API}/${encodeURIComponent(circleId)}/pulse`;
}

export const PULSE_LIMITS = {
  /** How far back a season's sessions are read: a season is three months, and a little more for a long one. */
  seasonLookbackDays: 120,
  /** The window when the village keeps no seasons. */
  noSeasonDays: 90,
} as const;

// ── Wire shape ───────────────────────────────────────────────────────────────

export interface CirclePulse {
  circleId: string;
  /** The season's name as a stamp writes it ("spring", or the village's own), or null where the village keeps none. */
  season: string | null;
  /** The village date the window starts, YYYY-MM-DD: the season's first session, or three months back. */
  since: string;
  /** Sessions the circle closed this season with two or more people in them. */
  sessions: number;
  /** Different people who came to them. */
  people: number;
  /** Proposals decided by consent. */
  decisions: number;
  /** Tensions named. */
  tensions: number;
  /** Where the actions those sessions left stand now. */
  actions: { open: number; done: number; letGo: number };
  /** The median of the sessions' arrival medians, out of 11, or null when none was taken. */
  arrival: number | null;
}

/** The median of some numbers, or null for none. */
export function medianOf(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

// ── Words ────────────────────────────────────────────────────────────────────

const seasonWords = (season: string | null): string => (season ? `this ${season}` : "in the last three months");
const times = (n: number): string => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export const PULSE_COPY = {
  sectionTitle: "This season",
  lede: "How each circle has been doing this season, from what its sessions already wrote down. Counts only, never a name.",
  circleLabel: "Which circle?",
  /** The one sentence: "The Garden circle met 5 times this spring: 12 decisions by consent, 9 of 14 actions done." */
  line: (circleName: string, p: CirclePulse): string => {
    if (!p.sessions) return `The ${circleWords(circleName)} has not met ${seasonWords(p.season)} yet.`;
    const all = p.actions.open + p.actions.done + p.actions.letGo;
    const decided = `${p.decisions} ${p.decisions === 1 ? "decision" : "decisions"} by consent`;
    const actions = all ? `, ${p.actions.done} of ${all} ${all === 1 ? "action" : "actions"} done` : "";
    return `The ${circleWords(circleName)} met ${times(p.sessions)} ${seasonWords(p.season)}: ${decided}${actions}.`;
  },
  numbers: {
    sessions: "Times met",
    people: "People who came",
    decisions: "Decided by consent",
    tensions: "Tensions named",
    actionsDone: "Actions done",
    actionsOpen: "Actions still open",
    actionsLetGo: "Actions let go",
    arrival: "How the room arrived",
  },
  arrivalOf: (median: number): string => `${median} of 11`,
  noArrival: "Not taken",
  loadFailed: "This season's numbers didn't load.",
  retry: "Try again",
  loading: "Loading this season's numbers.",
} as const;

export const PULSE_REFUSALS = {
  circleUnknown: "That circle isn't one of the village's circles now.",
  notYours: "Only the circle's members and admins can read how its season is going.",
} as const;

/** The regenerative lens: four questions under an open proposal, kept nowhere. */
export const LENS_COPY = {
  show: "Look at it through a regenerative lens",
  hide: "Put the lens away",
  questions: [
    "Who and what does this touch beyond the people here?",
    "What does it give back to the land, the village and the people doing the work?",
    "What will it ask of us in a year, and of the people who come after us?",
    "How would we notice if it stops serving us, and how easily could we undo it?",
  ],
} as const;
