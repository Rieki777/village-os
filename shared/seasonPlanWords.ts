/**
 * A PLAYER'S OWN WORDS ON THEIR SEASON PLAN (player role card, PR 6 of 7).
 *
 * Three things a member writes beside their plan, and one they set each moon:
 *
 *   SERVES GOALS     each village goal they tick, with a "How it helps" line.
 *                    At most the season's goal count, each one of the season's
 *                    goals as written. The first is still written to
 *                    `serves_goal`, so the previous release reads a plan.
 *   SEASONAL GOALS   zero to three bigger goals of their own for the whole
 *                    season, each a title and when it is done.
 *   CARD WORDS       how they hold their roles, in six short answers, for the
 *                    player card's "How I hold my roles".
 *   MOON LOAD        how this moon feels, from Healthy (1) to Heavy (5). Their
 *                    own read, one per moon, stored apart from the plan in
 *                    `player_moon_load`.
 *
 * Pure: no database and no request. The route (server/routes/seasonPlans.ts)
 * and Your season (client/src/pages/MySeason.tsx) read these, so a limit has
 * one spelling. Every free text is refused when it looks like payment details,
 * the same reader seat terms use. Seasonal goals measure the work, so the
 * scoreboard's ranking words are refused there too.
 *
 * Each reader takes `undefined` as "not sent" and hands `undefined` back, so a
 * save that leaves a group out keeps what the newest version holds. `null`
 * clears the group.
 */
import { looksLikePaymentDetails, PAYMENT_DETAIL_MESSAGE, RANKS_PEOPLE } from "./seatSettings";

export const HOW_IT_HELPS_MAX = 200;
export const SEASONAL_TITLE_MAX = 120;
export const DONE_WHEN_MAX = 300;
export const CARD_WORD_MAX = 300;
/** The most seasonal goals a plan holds. The player card reads the same three (`SEASONAL_GOALS_MAX`). */
export const SEASONAL_GOALS_LIMIT = 3;

/** The six answers under "How I hold my roles", in the card's order. */
export const CARD_WORD_KEYS = ["howIHold", "findMe", "decisions", "feedback", "growingEdge", "nextHolder"] as const;
export type CardWordKey = (typeof CARD_WORD_KEYS)[number];
export type CardWords = Partial<Record<CardWordKey, string>>;

/** The label each answer carries on the card and on the form. */
export const CARD_WORD_LABELS: Record<CardWordKey, string> = {
  howIHold: "How I hold my roles",
  findMe: "When to find me",
  decisions: "How decisions go",
  feedback: "Feedback and review",
  growingEdge: "Growing edge",
  nextHolder: "Who could hold this next",
};

export interface ServedGoal {
  /** One of the season's goals, as written. */
  goal: string;
  howItHelps: string | null;
}

export interface SeasonalGoal {
  title: string;
  doneWhen: string | null;
}

export const MOON_LOAD_MIN = 1;
export const MOON_LOAD_MAX = 5;
export const MOON_LOAD_WORDS = {
  heading: "How this moon feels",
  low: "Healthy",
  high: "Heavy",
  line: "My own read, set each moon.",
} as const;

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

const RANKS_MESSAGE = "A goal measures the work. It never ranks people.";

/** One free text: trimmed, empty is null, refused past `max` or when it carries payment details. */
function words(v: unknown, field: string, max: number, opts: { ranks?: boolean } = {}): Parsed<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, field, error: "This needs to be words." };
  const s = v.trim();
  if (!s) return { ok: true, value: null };
  if (s.length > max) return { ok: false, field, error: `Keep this to ${max} characters.` };
  if (looksLikePaymentDetails(s)) return { ok: false, field, error: PAYMENT_DETAIL_MESSAGE };
  if (opts.ranks && RANKS_PEOPLE.test(s)) return { ok: false, field, error: RANKS_MESSAGE };
  return { ok: true, value: s };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The village goals a member serves, each with how it helps. PURE.
 *
 * `goals` are the season's own goals. A served goal must be one of them, as
 * written, never twice, and never more than the season holds. An empty list
 * reads as null: no goal served.
 */
export function parseServesGoals(v: unknown, goals: readonly string[]): Parsed<ServedGoal[] | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (!Array.isArray(v)) return { ok: false, field: "servesGoals", error: "The goals you serve arrive as a list." };
  const known = goals.map((g) => g.trim()).filter(Boolean);
  if (v.length > known.length) return { ok: false, field: "servesGoals", error: `This season has ${known.length === 1 ? "1 goal" : `${known.length} goals`}.` };
  const out: ServedGoal[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const at = `servesGoals.${i}`;
    const item = v[i];
    if (!isObject(item)) return { ok: false, field: at, error: "Pick a goal from the season's list." };
    for (const k of Object.keys(item)) if (k !== "goal" && k !== "howItHelps") return { ok: false, field: `${at}.${k}`, error: "A goal holds the goal and how it helps." };
    const goal = typeof item.goal === "string" ? item.goal.trim() : "";
    if (!goal || !known.includes(goal)) return { ok: false, field: `${at}.goal`, error: "That is not one of this season's goals. Pick one from the list." };
    if (out.some((g) => g.goal === goal)) return { ok: false, field: `${at}.goal`, error: "Each goal once." };
    const help = words(item.howItHelps, `${at}.howItHelps`, HOW_IT_HELPS_MAX);
    if (!help.ok) return help;
    out.push({ goal, howItHelps: help.value });
  }
  return { ok: true, value: out.length ? out : null };
}

/** Zero to three seasonal goals, each a title and when it is done. PURE. An empty list reads as null. */
export function parseSeasonalGoals(v: unknown): Parsed<SeasonalGoal[] | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (!Array.isArray(v)) return { ok: false, field: "seasonalGoals", error: "Your seasonal goals arrive as a list." };
  if (v.length > SEASONAL_GOALS_LIMIT) return { ok: false, field: "seasonalGoals", error: `Up to ${SEASONAL_GOALS_LIMIT} seasonal goals.` };
  const out: SeasonalGoal[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const at = `seasonalGoals.${i}`;
    const item = v[i];
    if (!isObject(item)) return { ok: false, field: at, error: "A seasonal goal is a title and when it is done." };
    for (const k of Object.keys(item)) if (k !== "title" && k !== "doneWhen") return { ok: false, field: `${at}.${k}`, error: "A seasonal goal is a title and when it is done." };
    const title = words(item.title, `${at}.title`, SEASONAL_TITLE_MAX, { ranks: true });
    if (!title.ok) return title;
    const doneWhen = words(item.doneWhen, `${at}.doneWhen`, DONE_WHEN_MAX, { ranks: true });
    if (!doneWhen.ok) return doneWhen;
    if (!title.value) {
      // A row left blank is dropped. A "done when" with no title is a goal half written.
      if (doneWhen.value) return { ok: false, field: `${at}.title`, error: "Give this goal a title." };
      continue;
    }
    out.push({ title: title.value, doneWhen: doneWhen.value });
  }
  return { ok: true, value: out.length ? out : null };
}

/** The six answers under "How I hold my roles". PURE. Unknown keys are refused; all blank reads as null. */
export function parseCardWords(v: unknown): Parsed<CardWords | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (!isObject(v)) return { ok: false, field: "cardWords", error: "Your card's words arrive as a set of answers." };
  const out: CardWords = {};
  for (const k of Object.keys(v)) {
    if (!(CARD_WORD_KEYS as readonly string[]).includes(k)) return { ok: false, field: `cardWords.${k}`, error: "That is not one of the card's questions." };
    const w = words(v[k], `cardWords.${k}`, CARD_WORD_MAX);
    if (!w.ok) return w;
    if (w.value) out[k as CardWordKey] = w.value;
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

/** This moon's load, a whole number from 1 (Healthy) to 5 (Heavy). PURE. */
export function parseMoonLoad(v: unknown): Parsed<number> {
  if (typeof v !== "number" || !Number.isInteger(v) || v < MOON_LOAD_MIN || v > MOON_LOAD_MAX) {
    return { ok: false, field: "level", error: `Pick a whole number from ${MOON_LOAD_MIN} (${MOON_LOAD_WORDS.low}) to ${MOON_LOAD_MAX} (${MOON_LOAD_WORDS.high}).` };
  }
  return { ok: true, value: v };
}

/**
 * The goals a stored plan serves. PURE.
 *
 * A plan the previous release wrote has `serves_goal` and no list: it reads as
 * that one goal with no "How it helps" line yet.
 */
export function servedGoalsOf(stored: ServedGoal[] | null | undefined, servesGoal: string | null | undefined): ServedGoal[] {
  if (Array.isArray(stored) && stored.length) return stored;
  const g = typeof servesGoal === "string" ? servesGoal.trim() : "";
  return g ? [{ goal: g, howItHelps: null }] : [];
}
