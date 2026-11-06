/**
 * HOW VOICE IS SPREAD ACROSS THE PEOPLE WHO VOTE, as the governance page shows
 * it (Rye, 2026-10-31: "a graphic on the governance page that shows the
 * distribution of voice holdings and other relevant governance metrics").
 *
 * A ballot weighted by Voice gives a big contributor a big say. The village
 * should be able to SEE how big, without the page becoming a leaderboard.
 *
 * ── WHAT IT NEVER SAYS (the R55 rule /powers keeps) ─────────────────────────
 *
 * No member's name, no member's amount, no ranked list. Every figure here is a
 * share held by a GROUP, and a group is shown only when it holds at least
 * `MIN_GROUP` members AND the members outside it number at least `MIN_GROUP`
 * too. In a village of eight, "the top 10%" is one person, and their share is
 * their balance divided by a total anyone could work out; so it is withheld,
 * with a sentence, and the page says the village is too small to show it.
 * Shares are whole percents, so a share never carries a balance's last digits.
 *
 * Evenness is a word, never the number underneath it: the Gini coefficient
 * from `voiceDistribution` (shared/valuation.ts) picks one of three words, and
 * only once the village is big enough that a band can be shown at all.
 *
 * Pure: no clock, no pool.
 */
import { voiceDistribution } from "./valuation";

/** The fewest members a shown group, and the members outside it, may hold. */
export const MIN_GROUP = 3;

/** The groups the page compares, as the top fraction of voters by Voice. */
export const SPREAD_BANDS = [0.1, 0.25, 0.5] as const;

export type Evenness = "even" | "leaning" | "concentrated";

export interface SpreadBand {
  /** 10, 25 or 50: the top this-percent of voters by Voice. */
  topPct: number;
  /** The whole percent of all Voice that group holds. */
  sharePct: number;
}

export interface VoiceSpread {
  /** How many voters the spread is measured over (holders and non-holders). */
  voters: number;
  /** False when nobody holds any Voice yet: there is no spread to draw. */
  anyVoice: boolean;
  /** The groups big enough to show, largest share last. */
  bands: SpreadBand[];
  /** True when some band was held back because its group, or the rest, would be under `MIN_GROUP`. */
  withheld: boolean;
  /** A word for the whole spread, or null while no band can be shown. */
  evenness: Evenness | null;
}

/** The Gini at or above which a spread reads as leaning, then concentrated. */
const LEANING_FROM = 0.35;
const CONCENTRATED_FROM = 0.6;

export function evennessOf(gini: number): Evenness {
  if (gini >= CONCENTRATED_FROM) return "concentrated";
  if (gini >= LEANING_FROM) return "leaning";
  return "even";
}

/**
 * The spread of Voice over `balances`, one per voter, zero included. A
 * negative or unreadable balance counts as zero, as `voiceDistribution` reads it.
 */
export function voiceSpread(balances: readonly number[]): VoiceSpread {
  const xs = balances.map((b) => (Number.isFinite(b) && b > 0 ? b : 0)).sort((a, b) => b - a);
  const n = xs.length;
  const total = xs.reduce((s, x) => s + x, 0);
  if (n === 0 || total <= 0) return { voters: n, anyVoice: false, bands: [], withheld: false, evenness: null };
  const bands: SpreadBand[] = [];
  let withheld = false;
  for (const p of SPREAD_BANDS) {
    const k = Math.max(1, Math.round(n * p));
    if (k < MIN_GROUP || n - k < MIN_GROUP) {
      withheld = true;
      continue;
    }
    const held = xs.slice(0, k).reduce((s, x) => s + x, 0);
    bands.push({ topPct: Math.round(p * 100), sharePct: Math.round((held / total) * 100) });
  }
  return {
    voters: n,
    anyVoice: true,
    bands,
    withheld,
    evenness: bands.length ? evennessOf(voiceDistribution(xs).gini) : null,
  };
}

/** One village's governance at a glance, as GET /api/governance/voice-spread answers it. */
export interface VoiceSpreadView {
  spread: VoiceSpread;
  /** True when this village's votes are weighted by Voice right now. */
  weightedByVoice: boolean;
  /** The share of the village's weight a vote needs taking part, to count. */
  quorumPct: number;
  /** Village-wide votes since `since`, or ever when `since` is null. */
  ballots: {
    since: string | null;
    /** Votes opened in the period, withdrawn ones left out. */
    run: number;
    /** Of those, the ones decided: passed, failed or short of quorum. */
    closed: number;
    /** Of the closed ones, the ones that carried (a vetoed pass counts as not). */
    passed: number;
    /** Average share of the roll that voted, over the closed ones; null with none closed. */
    turnoutPct: number | null;
  };
}
