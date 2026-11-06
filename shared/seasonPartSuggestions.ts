/**
 * YOUR PART, STARTED FROM YOUR SEATS (season plans, 2026-10-21).
 *
 * Rye, looking at the live page: quests a moon should be filled in for the
 * member, and how they measure their work should come from their roles and
 * what those roles answer for. This file is the part with no database and no
 * request in it. The route reads the member's seats and hands them here;
 * the page shows what comes back as suggestions the member takes or leaves.
 * Nothing here is ever saved on the member's behalf, and no AI is asked.
 *
 * ── WHICH TERMS SPEAK FOR A SEAT ───────────────────────────────────────────
 *
 * A seat can carry up to three sets of terms for one member, ranked:
 *
 *   adopted   the terms the member is seated on, or an adopted application
 *   applied   an application of theirs the village has not answered yet
 *   offer     what the seat offers whoever holds it (`terms_offer`)
 *
 * For quests, each seat speaks once, through the highest ranked set that has
 * a quests group. Seats are never summed: a member on two seats asking 3 to 5
 * each is asked 3 to 5, so the fewest is the largest fewest across seats and
 * the most is the largest most. With no quests group anywhere, the platform's
 * own quests preset is the starting point.
 *
 * For measures, every scoreboard measure from every set is offered, adopted
 * first, then applied, then offers, and after them one measure per thing a
 * seat answers for. The same words are offered once, under the first seat.
 *
 * ── NO MONEY, NO RANKING ───────────────────────────────────────────────────
 *
 * Only the quests and scoreboard groups are ever read, one group at a time,
 * so a pay group never reaches the output and a problem in it cannot hide a
 * seat's measures. Every suggestion passes the scoreboard reader, which
 * refuses words that rank people and anything shaped like payment details.
 */
import { presetById } from "./seatPresets";
import { LIMITS, parseSeatSettings, type QuestSettings, type ScoreMeasure } from "./seatSettings";

/** The platform's quests preset: the starting point when no seat says. */
export const DEFAULT_QUESTS_PRESET = "platform:three-to-five-done-when-by-consent";

/** The most suggestions one page carries. A member on many seats still reads a short list. */
export const SUGGESTIONS_MAX = 24;

export const TERMS_RANKS = ["adopted", "applied", "offer"] as const;
export type TermsRank = (typeof TERMS_RANKS)[number];

/** One seat the member holds or applied for, as much of it as suggestions read. */
export interface SuggestionSeat {
  seatId: string;
  name: string;
  /** The role card's "Answers for" list. */
  accountabilities: readonly string[];
  /** Every set of terms that speaks for this seat, any order. Settings are read raw. */
  terms: ReadonlyArray<{ rank: TermsRank; settings: unknown }>;
}

export interface QuestSource {
  seatId: string;
  seat: string;
  min: number | null;
  max: number | null;
}

export interface QuestSuggestion {
  min: number | null;
  max: number | null;
  /** "terms" when a seat's terms set it, "default" for the platform preset. */
  from: "terms" | "default";
  source: QuestSource[];
}

export interface MeasureSuggestion {
  seatId: string;
  seat: string;
  from: "terms" | "accountability";
  measure: string;
  target?: string;
}

export interface PartSuggestions {
  quests: QuestSuggestion;
  measures: MeasureSuggestion[];
}

const rankOf = (r: TermsRank) => TERMS_RANKS.indexOf(r);

/** One settings group read alone, so a problem elsewhere in the terms never hides it. */
function readGroup<G extends "quests" | "scoreboard">(settings: unknown, group: G) {
  let raw = settings;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = (raw as Record<string, unknown>)[group];
  if (value === undefined || value === null) return undefined;
  const parsed = parseSeatSettings({ v: 1, [group]: value });
  return parsed.ok && parsed.settings ? parsed.settings[group] : undefined;
}

function sortedTerms(seat: SuggestionSeat) {
  return [...(seat.terms ?? [])].sort((a, b) => rankOf(a.rank) - rankOf(b.rank));
}

/** The platform default, read off the preset so the two cannot drift. */
export function defaultQuests(): { min: number | null; max: number | null } {
  const values = (presetById(DEFAULT_QUESTS_PRESET)?.values ?? {}) as Partial<QuestSettings>;
  return { min: values.perMoonMin ?? null, max: values.perMoonMax ?? null };
}

/**
 * QUESTS A MOON FROM THE MEMBER'S SEATS. PURE.
 *
 * Each seat speaks through its highest ranked terms with a quests group. The
 * fewest is the largest fewest any seat asks, the most the largest most, and
 * a most below the fewest is raised to it.
 */
export function suggestQuests(seats: readonly SuggestionSeat[]): QuestSuggestion {
  const source: QuestSource[] = [];
  for (const seat of seats) {
    for (const t of sortedTerms(seat)) {
      const q = readGroup(t.settings, "quests") as QuestSettings | undefined;
      if (!q || (q.perMoonMin === undefined && q.perMoonMax === undefined)) continue;
      source.push({ seatId: seat.seatId, seat: seat.name, min: q.perMoonMin ?? null, max: q.perMoonMax ?? null });
      break;
    }
  }
  if (source.length === 0) return { ...defaultQuests(), from: "default", source: [] };
  const mins = source.map((s) => s.min).filter((n): n is number => n !== null);
  const maxes = source.map((s) => s.max).filter((n): n is number => n !== null);
  const min = mins.length ? Math.max(...mins) : null;
  let max = maxes.length ? Math.max(...maxes) : null;
  if (min !== null && max !== null && max < min) max = min;
  return { min, max, from: "terms", source };
}

/** "Front-End 3 to 5", "Kitchen at least 2": one seat's quests, in words. */
function sourceWords(s: QuestSource): string {
  if (s.min !== null && s.max !== null) return s.min === s.max ? `${s.seat} ${s.min}` : `${s.seat} ${s.min} to ${s.max}`;
  if (s.min !== null) return `${s.seat} at least ${s.min}`;
  return `${s.seat} up to ${s.max}`;
}

/** The one line under a prefilled Fewest and Most. */
export function questHint(q: QuestSuggestion): string {
  if (q.from === "default" || q.source.length === 0) return "A starting point. Change it if your roles ask for more.";
  return `From your roles' terms: ${q.source.map(sourceWords).join(", ")}`;
}

// ── Phrasing an accountability as a measure ─────────────────────────────────

/**
 * Verbs an accountability uses in its -ing form, with the form a measure says
 * them in: [after a list of things, after one thing]. Only these are turned;
 * any other -ing word is left as written, so "building" stays a noun.
 */
const VERBS: Record<string, [string, string]> = {
  showing: ["show", "shows"],
  running: ["run", "runs"],
  working: ["work", "works"],
  staying: ["stay", "stays"],
  getting: ["get", "gets"],
  arriving: ["arrive", "arrives"],
  landing: ["land", "lands"],
  flowing: ["flow", "flows"],
  reaching: ["reach", "reaches"],
  meeting: ["meet", "meets"],
  growing: ["grow", "grows"],
  looking: ["look", "looks"],
  reading: ["read", "reads"],
  matching: ["match", "matches"],
  passing: ["pass", "passes"],
  happening: ["happen", "happens"],
  going: ["go", "goes"],
  shipping: ["ship", "ships"],
  opening: ["open", "opens"],
  closing: ["close", "closes"],
  holding: ["hold", "holds"],
  standing: ["stand", "stands"],
  balancing: ["balance", "balances"],
  loading: ["load", "loads"],
};

/** "for members", "for the village": who it is for, which a measure of the work leaves out. */
const FOR_AUDIENCE =
  /\s+for\s+(?:all\s+|new\s+|every\s+)?(?:members|member|everyone|everybody|the village|villagers|the circle|the team|visitors|guests|newcomers|people|residents|the community|holders)$/i;

/** Words that say a phrase already has its own predicate, so it is kept as written. */
const ALREADY_SAID =
  /\b(?:is|are|was|were|be|been|has|have|had|gets|stays|runs|keeps|kept|done|made|paid|met|held|written|sent|on|by|before|after|every|each|within|until|monthly|weekly|daily|yearly|always|never)\b/i;

const ARTICLE = /^(?:the|a|an)\s+/i;
/** A line that says how much time a seat takes. Quests a moon already carries that. */
const TIME_LINE = /^contribution\s*:/i;

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > 0 ? cut.slice(0, at) : cut).trim();
}

/** "The org chart, role proposals and game mechanics" to its first two things. */
function things(subject: string): string[] {
  return subject
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map((p) => p.trim().replace(ARTICLE, "").trim())
    .filter(Boolean);
}

/**
 * ONE ACCOUNTABILITY, PHRASED PLAINLY AS A MEASURE OF THE WORK. PURE.
 *
 *   1. Trim it, drop a closing full stop, and drop who it is for at the end
 *      ("for members").
 *   2. A line that starts with an -ing word is already an activity
 *      ("Testing the spring monthly") and is kept, capital first.
 *   3. Things followed by a known -ing verb ("The org chart, role proposals
 *      and game mechanics showing accurately") keep their first two things,
 *      lose their articles, and take the verb as a measure says it:
 *      "Org chart and role proposals show accurately".
 *   4. A short list of things with no verb of its own (six words or fewer,
 *      articles not counted, like "The kitchen, the pantry") keeps its first
 *      two things and is said as kept "in good order": "Kitchen and pantry
 *      in good order". Anything with its own predicate is kept as written,
 *      leading article dropped.
 *   5. A line about time given ("Contribution: 4 hours a week") gives no
 *      measure, and nor does one the scoreboard reader refuses.
 */
export function measureFromAccountability(text: string): string | null {
  let s = String(text ?? "").replace(/\s+/g, " ").trim().replace(/[.;:!]+$/, "").trim();
  if (!s || TIME_LINE.test(s)) return null;
  s = s.replace(FOR_AUDIENCE, "").trim();
  const words = s.split(" ");
  let out: string;
  if (/ing$/i.test(words[0]) && words.length > 1) {
    out = s;
  } else {
    const at = words.findIndex((w, i) => i > 0 && VERBS[w.toLowerCase()] !== undefined);
    if (at > 0) {
      const subject = things(words.slice(0, at).join(" ")).slice(0, 2);
      const verb = VERBS[words[at].toLowerCase()];
      const rest = words.slice(at + 1).join(" ");
      out = [subject.join(" and "), subject.length > 1 ? verb[0] : verb[1], rest].filter(Boolean).join(" ");
    } else if (words.filter((w) => !/^(?:the|a|an)$/i.test(w)).length <= 6 && !ALREADY_SAID.test(s)) {
      out = `${things(s).slice(0, 2).join(" and ")} in good order`;
    } else {
      out = s.replace(ARTICLE, "");
    }
  }
  out = capitalise(clip(out.trim(), LIMITS.measureChars));
  return passes({ measure: out }) ? out : null;
}

/** The scoreboard reader's word on one measure: no ranking, no payment details. */
function passes(m: ScoreMeasure): boolean {
  const parsed = parseSeatSettings({ v: 1, scoreboard: { measures: [m] } });
  return parsed.ok && (parsed.settings?.scoreboard?.measures.length ?? 0) === 1;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * MEASURES FROM THE MEMBER'S ROLES. PURE.
 *
 * Every terms measure first, adopted terms before applied before offers, then
 * one measure per accountability, seat by seat. The same words appear once.
 * Targets come only from terms; an accountability's target is the member's.
 */
export function suggestMeasures(seats: readonly SuggestionSeat[]): MeasureSuggestion[] {
  const out: MeasureSuggestion[] = [];
  const seen = new Set<string>();
  const add = (m: MeasureSuggestion) => {
    const k = key(m.measure);
    if (!k || seen.has(k) || out.length >= SUGGESTIONS_MAX) return;
    seen.add(k);
    out.push(m);
  };
  for (const rank of TERMS_RANKS) {
    for (const seat of seats) {
      for (const t of seat.terms ?? []) {
        if (t.rank !== rank) continue;
        const board = readGroup(t.settings, "scoreboard") as { measures: ScoreMeasure[] } | undefined;
        for (const m of board?.measures ?? []) {
          const measure = m.measure.trim();
          const target = m.target?.trim();
          if (!passes({ measure, ...(target ? { target } : {}) })) continue;
          add({ seatId: seat.seatId, seat: seat.name, from: "terms", measure, ...(target ? { target } : {}) });
        }
      }
    }
  }
  for (const seat of seats) {
    for (const a of seat.accountabilities ?? []) {
      const measure = measureFromAccountability(a);
      if (measure) add({ seatId: seat.seatId, seat: seat.name, from: "accountability", measure });
    }
  }
  return out;
}

export function partSuggestions(seats: readonly SuggestionSeat[]): PartSuggestions {
  return { quests: suggestQuests(seats), measures: suggestMeasures(seats) };
}
