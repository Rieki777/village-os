/**
 * COMMITMENT AS A PERCENT (lane E1, the lead 12 Nov 2026).
 *
 *   "we need to do the migration to hold role commitment %'s as we may be
 *   using this to affect rewards and payouts and letting people move this
 *   commitment percentage around from time to time (seasonally, moon, weekly,
 *   etc)"
 *
 *   "they could also say what commitment percentage they're able to give and
 *   it would remove roles that say 100% required, etc and show quests that are
 *   easier vs harder"
 *
 * Three numbers from 1 to 100, all in migration 0383: what a quest asks
 * (`quests.commitment_pct`), what a role asks and whether it needs all of it
 * (`org_roles.commitment_pct`, `org_roles.commitment_required`), and what a
 * member says they can give, kept as a dated history (`member_commitments`).
 *
 * WHAT THIS IS FOR. Filtering work for the person themselves: which quests
 * suit what they can give now, which roles ask more than that. It NEVER ranks
 * people, and NOTHING THAT PAYS READS IT. Payout use waits for the lead, and
 * `server/lib/commitmentBoundary.test.ts` fails the day a pay path imports
 * this file or names its columns.
 *
 * Pure: no Node builtins, no clock except the one a caller passes.
 */

/** The periods a member's word covers: the season, the moon, or the week. */
export const COMMITMENT_PERIODS = ["season", "moon", "week"] as const;
export type CommitmentPeriod = (typeof COMMITMENT_PERIODS)[number];

export const COMMITMENT_PERIOD_WORDS: Record<CommitmentPeriod, string> = {
  season: "This season",
  moon: "This moon",
  week: "This week",
};

export const COMMITMENT_NOTE_MAX = 280;

export type CommitmentRead<T> = { ok: true; value: T } | { ok: false; problem: string };

export const COMMITMENT_WORDS = {
  pct: "A commitment is a whole percent from 1 to 100.",
  period: `The period is one of: ${COMMITMENT_PERIODS.join(", ")}.`,
  note: `Keep the note to ${COMMITMENT_NOTE_MAX} characters.`,
  date: "Write the date as year-month-day, like 2026-11-12.",
} as const;

/**
 * A commitment percent from a body or a row: a whole number from 1 to 100, or
 * null for "not said". Blank and null read as null; anything else is refused.
 * Strings of digits are read, so a form field and a card's text both work.
 */
export function readCommitmentPct(raw: unknown): CommitmentRead<number | null> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d{1,3}\s*%?\s*$/.test(raw) ? Number(raw.replace(/[%\s]/g, "")) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 100) return { ok: false, problem: COMMITMENT_WORDS.pct };
  return { ok: true, value: n };
}

/** The tolerant reading of a stored column: anything unreadable is "not said". */
export function storedCommitmentPct(raw: unknown): number | null {
  const r = readCommitmentPct(typeof raw === "string" || typeof raw === "number" ? raw : raw == null ? null : Number(raw));
  return r.ok ? r.value : null;
}

export function readCommitmentPeriod(raw: unknown): CommitmentRead<CommitmentPeriod> {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (COMMITMENT_PERIODS as readonly string[]).includes(v) ? { ok: true, value: v as CommitmentPeriod } : { ok: false, problem: COMMITMENT_WORDS.period };
}

/** One entry in a member's history, as the server sends it. */
export interface MemberCommitment {
  id: number;
  pct: number;
  /** The day it holds from, year-month-day. */
  fromDate: string;
  period: CommitmentPeriod;
  note: string | null;
  /** When it was said, an ISO instant. */
  saidAt: string | null;
}

/** What a member sends to say what they can give now. */
export interface CommitmentInput {
  pct: number;
  period: CommitmentPeriod;
  fromDate: string;
  note: string | null;
}

/**
 * A member's word, judged. `today` is the caller's year-month-day, the default
 * for `fromDate`. A from-date may be today or later, never before: the history
 * says what was true when it was said, and a back-dated row would rewrite it.
 */
export function readCommitmentInput(body: unknown, today: string): CommitmentRead<CommitmentInput> {
  const o = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const pct = readCommitmentPct(o.pct);
  if (!pct.ok) return pct;
  if (pct.value === null) return { ok: false, problem: COMMITMENT_WORDS.pct };
  const period = readCommitmentPeriod(o.period ?? "season");
  if (!period.ok) return period;
  let fromDate = today;
  if (o.fromDate !== undefined && o.fromDate !== null && o.fromDate !== "") {
    const s = typeof o.fromDate === "string" ? o.fromDate.trim() : "";
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, problem: COMMITMENT_WORDS.date };
    if (s < today) return { ok: false, problem: "A commitment holds from today or a later day." };
    fromDate = s;
  }
  let note: string | null = null;
  if (o.note !== undefined && o.note !== null) {
    if (typeof o.note !== "string") return { ok: false, problem: COMMITMENT_WORDS.note };
    const t = o.note.replace(/\s+/g, " ").trim();
    if (t.length > COMMITMENT_NOTE_MAX) return { ok: false, problem: COMMITMENT_WORDS.note };
    note = t || null;
  }
  return { ok: true, value: { pct: pct.value, period: period.value, fromDate, note } };
}

/**
 * The entry that holds on `today`: the latest from-date on or before it, the
 * later word winning a tie. A word said for a later day waits for that day.
 * Null when the member has said nothing that holds yet.
 */
export function commitmentOn<T extends Pick<MemberCommitment, "id" | "fromDate">>(history: readonly T[], today: string): T | null {
  let best: T | null = null;
  for (const h of history) {
    if (h.fromDate > today) continue;
    if (!best || h.fromDate > best.fromDate || (h.fromDate === best.fromDate && h.id > best.id)) best = h;
  }
  return best;
}

// ── Quests: size and fit ────────────────────────────────────────────────────

/**
 * The size bands the board filters by, easier to harder. Every percent falls
 * in exactly one band: up to 25, 26 to 60, over 60.
 */
export const QUEST_SIZES = ["light", "medium", "heavy"] as const;
export type QuestSize = (typeof QUEST_SIZES)[number];

export function questSizeOf(pct: number | null | undefined): QuestSize | null {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  if (pct <= 25) return "light";
  if (pct <= 60) return "medium";
  return "heavy";
}

/** How a quest sits beside what the member can give: within ten points fits. */
export type QuestFit = "fits" | "easier" | "harder";
export const FIT_BAND = 10;

export function questFit(questPct: number | null | undefined, memberPct: number | null | undefined): QuestFit | null {
  if (typeof questPct !== "number" || typeof memberPct !== "number") return null;
  const diff = questPct - memberPct;
  if (Math.abs(diff) <= FIT_BAND) return "fits";
  return diff < 0 ? "easier" : "harder";
}

/**
 * QUESTS IN ORDER OF HOW WELL THEY FIT what the member can give: the nearest
 * first, then the rest by distance, an easier quest before a harder one at
 * the same distance, and unsized quests last. Equal places keep the board's
 * own order. With no word from the member the list comes back as it was.
 * This orders work for one person; it never orders people.
 */
export function orderByFit<T>(items: readonly T[], pctOf: (item: T) => number | null | undefined, memberPct: number | null | undefined): T[] {
  if (typeof memberPct !== "number") return [...items];
  return items
    .map((item, i) => {
      const p = pctOf(item);
      const sized = typeof p === "number";
      return { item, i, sized, dist: sized ? Math.abs(p - memberPct) : Infinity, harder: sized && p > memberPct };
    })
    .sort((a, b) => Number(a.sized === false) - Number(b.sized === false) || a.dist - b.dist || Number(a.harder) - Number(b.harder) || a.i - b.i)
    .map((x) => x.item);
}

// ── Roles: what a role asks against what a member can give ─────────────────

export interface RoleAsk {
  commitmentPct?: number | null;
  commitmentRequired?: boolean | null;
}

/**
 * Whether a role asks more than the member can give: it needs its whole
 * commitment (marked required) and that commitment is above the member's
 * word. A flexible role, an unsized one and a member who has said nothing
 * are never "beyond".
 */
export function roleBeyondReach(role: RoleAsk, memberPct: number | null | undefined): boolean {
  if (typeof memberPct !== "number") return false;
  if (role.commitmentRequired !== true) return false;
  return typeof role.commitmentPct === "number" && role.commitmentPct > memberPct;
}

/** Split roles into those within the member's reach and those that need more time than they have. */
export function rolesWithinReach<T>(roles: readonly T[], askOf: (role: T) => RoleAsk, memberPct: number | null | undefined): { shown: T[]; beyond: T[] } {
  const shown: T[] = [];
  const beyond: T[] = [];
  for (const r of roles) (roleBeyondReach(askOf(r), memberPct) ? beyond : shown).push(r);
  return { shown, beyond };
}
