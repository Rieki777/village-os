/**
 * A MEMBER'S SEASON, SUMMED UP WHEN IT TURNS (Rye, 2026-10-30, idea 4).
 *
 * "A season summary at season end: what you earned, your top contributions and
 * your badges, as a shareable card." The server reads it from tables that
 * already exist (server/lib/seasonSummary.ts) and the card draws it
 * (client/src/components/seasonSummary/).
 *
 * IT CELEBRATES ONE MEMBER'S SEASON AND IS NO SCORECARD. Nothing here compares
 * a member with anybody else: no rank, no percentile, no share of the village.
 * The same spirit as the header of client/src/pages/Powers.tsx.
 *
 * WHAT IS PRIVATE. The member sees all of it. A shared image carries only what
 * the member chose (`SHARE_DEFAULTS`), and cash is off until they turn it on.
 */

/** A season as the village's calendar writes it (`SeasonEntry` in shared/gameConfig.ts). */
export interface SummarySeasonInput {
  id: string;
  name: string;
  startsOn: string;
  /** Exclusive civil date. Empty or absent: open-ended. */
  endsOn?: string | null;
}

/** A season with the day it really turned: its own end, or the next season's start. */
export interface SummarySeasonWindow {
  id: string;
  name: string;
  startsOn: string;
  /** Exclusive civil date the season turned, or null while it still runs. */
  endedOn: string | null;
  closed: boolean;
}

/**
 * Every season that has begun, oldest first, with the day each one turned.
 *
 * An open-ended season ends the day the next one starts, which is how a founder
 * hands one over (`seasonState` in server/index.ts takes the same reading). A
 * season is closed once that day has come.
 */
export function seasonWindows(seasons: readonly SummarySeasonInput[], today: string): SummarySeasonWindow[] {
  const sorted = seasons.filter((s) => !!s.startsOn).slice().sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const out: SummarySeasonWindow[] = [];
  sorted.forEach((s, i) => {
    if (s.startsOn > today) return;
    const next = sorted[i + 1];
    const own = s.endsOn ? String(s.endsOn) : "";
    // The earlier of its own end and the next start: a season cannot run on
    // after the next one has begun.
    const ends = [own, next?.startsOn ?? ""].filter((d) => !!d).sort()[0] ?? null;
    out.push({ id: s.id, name: s.name, startsOn: s.startsOn, endedOn: ends, closed: !!ends && ends <= today });
  });
  return out;
}

/** The season a summary is for: the one asked for, or the most recently closed. */
export function pickSummarySeason(
  windows: readonly SummarySeasonWindow[],
  asked: string | null | undefined,
): SummarySeasonWindow | null {
  if (asked) return windows.find((w) => w.id === asked) ?? null;
  const closed = windows.filter((w) => w.closed);
  return closed.length ? closed[closed.length - 1] : null;
}

/** One token earned, at the token's own scale. */
export interface SummaryTokenLine {
  token: string;
  name: string;
  /** Levers taxonomy: equity, credit, voice. Recognition never shows here. */
  kind: string;
  amount: number;
}

export interface SummaryCashLine {
  currency: string;
  earnedMinor: number;
  paidMinor: number;
}

export type ContributionKind = "quest" | "role" | "proposal";

export interface SummaryContribution {
  kind: ContributionKind;
  id: string;
  title: string;
  /** Roles only: when the holding began and ended inside or across the season. */
  term?: { from: string; to: string | null } | null;
  /** When it happened: consented, adopted, or the holding began. */
  at: string;
  /** What it paid this member, token by token. Used only to order their own work. */
  paid: Array<{ token: string; name: string; amount: number }>;
}

export interface SummaryBadge {
  id: string;
  name: string;
  icon: string | null;
  kind: string;
  count: number;
}

export interface SeasonSummary {
  season: SummarySeasonWindow;
  member: { name: string; handle: string | null };
  /** Tokens earned for work, Voice apart. */
  tokens: SummaryTokenLine[];
  voice: SummaryTokenLine[];
  cash: SummaryCashLine[];
  gratitude: { sent: number; sentNotes: number; received: number; receivedNotes: number; people: number };
  counts: { quests: number; roles: number; proposals: number };
  top: SummaryContribution[];
  badges: SummaryBadge[];
  /** Every season this member can open a summary for, newest first. */
  seasons: Array<{ id: string; name: string; closed: boolean }>;
}

/** How many contributions the card shows. */
export const TOP_CONTRIBUTIONS = 3;

/**
 * The member's own best three, never measured against anybody else.
 *
 * Ordered by what each piece of work paid them across every token, then by
 * the most recent. A role held all season comes first only when it paid most,
 * which is the member's own story told in their own numbers.
 */
export function topContributions(all: readonly SummaryContribution[], n = TOP_CONTRIBUTIONS): SummaryContribution[] {
  const worth = (c: SummaryContribution) => c.paid.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);
  return all
    .slice()
    .sort((a, b) => worth(b) - worth(a) || b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .slice(0, n);
}

/** What the shared image carries. The member's screen always shows everything. */
export interface ShareChoices {
  earnings: boolean;
  gratitude: boolean;
  /** Cash is private: off until the member turns it on. */
  cash: boolean;
}

export const SHARE_DEFAULTS: ShareChoices = { earnings: true, gratitude: true, cash: false };

/** The words for each kind of work, keyed by the union so a new kind cannot render blank. */
export const CONTRIBUTION_WORDS: Record<ContributionKind, string> = {
  quest: "Quest",
  role: "Role",
  proposal: "Proposal adopted",
};
