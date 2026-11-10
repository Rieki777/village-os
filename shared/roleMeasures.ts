/**
 * Measures of the role journey (L11): counts and medians per season and circle,
 * for members. Pure: it is handed anonymous facts and returns numbers.
 *
 * ── WHAT IT NEVER HOLDS ──────────────────────────────────────────────────
 * No name, no user id, no application ref, no email. An input fact is a season,
 * a circle and STAMPED TIMES; an output row is the same two keys and numbers.
 * `MEASURE_KEYS` below is the closed key set a test holds both sides to.
 *
 * ── WHEN A NUMBER IS WITHHELD ────────────────────────────────────────────
 * A median or a share of fewer than `MIN_GROUP` people points at a person in a
 * village this size, so it is null there. Counts are always shown.
 */

export const MIN_GROUP = 3;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** One application, as stamped. Times are epoch milliseconds. */
export interface ApplicationFact {
  seasonId: string | null;
  circleId: string | null;
  confirmedAt: number;
  firstReplyAt: number | null;
  firstInterviewAt: number | null;
  decidedAt: number | null;
}

/** One seating that began, with its path and renewals. Times are epoch milliseconds. */
export interface HolderFact {
  seasonId: string | null;
  circleId: string | null;
  startedAt: number;
  endedAt: number | null;
  /** When the onboarding path opened, and when its last item was done (null while any is open). */
  pathOpenedAt: number | null;
  pathDoneAt: number | null;
  firstQuestDoneAt: number | null;
  /** Moon renewals whose term has ended: how each went. */
  renewalsDue: number;
  renewalsRenewed: number;
}

export interface Share {
  eligible: number;
  yes: number;
  /** 0 to 1, or null when `eligible` is under MIN_GROUP. */
  share: number | null;
}

export interface MeasureRow {
  seasonId: string | null;
  circleId: string | null;
  applications: {
    count: number;
    answered: Share;
    medianHoursToReply: number | null;
    medianHoursToInterview: number | null;
    medianHoursToDecision: number | null;
  };
  holders: {
    count: number;
    pathCompleteBy30: Share;
    firstQuestBy14: Share;
    stillInRoleAt90: Share;
    renewed: Share;
  };
}

/** The closed key sets, held by the key-set test. */
export const MEASURE_KEYS = {
  row: ["seasonId", "circleId", "applications", "holders"],
  applications: ["count", "answered", "medianHoursToReply", "medianHoursToInterview", "medianHoursToDecision"],
  holders: ["count", "pathCompleteBy30", "firstQuestBy14", "stillInRoleAt90", "renewed"],
  share: ["eligible", "yes", "share"],
} as const;

export function median(values: readonly number[]): number | null {
  if (values.length < MIN_GROUP) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function share(eligible: number, yes: number): Share {
  return { eligible, yes, share: eligible >= MIN_GROUP ? Math.round((yes / eligible) * 100) / 100 : null };
}

const hoursBetween = (from: number, to: number | null): number | null => (to === null || to < from ? null : Math.round(((to - from) / HOUR) * 10) / 10);

export function buildMeasures(apps: readonly ApplicationFact[], holders: readonly HolderFact[], now: number): MeasureRow[] {
  const keyOf = (s: string | null, c: string | null) => `${s ?? ""}\u0000${c ?? ""}`;
  const rows = new Map<string, { seasonId: string | null; circleId: string | null; a: ApplicationFact[]; h: HolderFact[] }>();
  const slot = (s: string | null, c: string | null) => {
    const k = keyOf(s, c);
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { seasonId: s, circleId: c, a: [], h: [] }));
    return r;
  };
  for (const a of apps) slot(a.seasonId, a.circleId).a.push(a);
  for (const h of holders) slot(h.seasonId, h.circleId).h.push(h);

  const out: MeasureRow[] = [];
  for (const r of Array.from(rows.values())) {
    const reply = r.a.map((a) => hoursBetween(a.confirmedAt, a.firstReplyAt)).filter((x): x is number => x !== null);
    const interview = r.a.map((a) => hoursBetween(a.confirmedAt, a.firstInterviewAt)).filter((x): x is number => x !== null);
    const decision = r.a.map((a) => hoursBetween(a.confirmedAt, a.decidedAt)).filter((x): x is number => x !== null);

    // A share counts only people whose window has closed, so a recent seating is not "failed" yet.
    const by = (days: number, done: (h: HolderFact) => boolean, opened: (h: HolderFact) => number | null): Share => {
      const eligible = r.h.filter((h) => {
        const o = opened(h);
        return o !== null && now >= o + days * DAY;
      });
      return share(eligible.length, eligible.filter(done).length);
    };
    const path = by(30, (h) => h.pathDoneAt !== null && h.pathOpenedAt !== null && h.pathDoneAt <= h.pathOpenedAt + 30 * DAY, (h) => h.pathOpenedAt);
    const quest = by(14, (h) => h.firstQuestDoneAt !== null && h.pathOpenedAt !== null && h.firstQuestDoneAt <= h.pathOpenedAt + 14 * DAY, (h) => h.pathOpenedAt);
    const kept = by(90, (h) => h.endedAt === null || h.endedAt >= h.startedAt + 90 * DAY, (h) => h.startedAt);
    const due = r.h.reduce((n, h) => n + h.renewalsDue, 0);
    const renewed = r.h.reduce((n, h) => n + h.renewalsRenewed, 0);

    out.push({
      seasonId: r.seasonId,
      circleId: r.circleId,
      applications: {
        count: r.a.length,
        answered: share(r.a.length, r.a.filter((a) => a.firstReplyAt !== null).length),
        medianHoursToReply: median(reply),
        medianHoursToInterview: median(interview),
        medianHoursToDecision: median(decision),
      },
      holders: { count: r.h.length, pathCompleteBy30: path, firstQuestBy14: quest, stillInRoleAt90: kept, renewed: share(due, renewed) },
    });
  }
  return out.sort((a, b) => String(b.seasonId ?? "").localeCompare(String(a.seasonId ?? "")) || String(a.circleId ?? "").localeCompare(String(b.circleId ?? "")));
}
