/**
 * ONE PERSON'S ROLE APPLICATIONS, GROUPED: PAST, THIS SEASON, NEXT SEASON.
 *
 * Pure, and node-tested (`applicationGroups.test.ts`). Read by two hosts so
 * they cannot disagree:
 *
 *   GET /api/governance/role-applications?candidate=<userId>   `groups` beside the list
 *   the player card's "My applications" section               shared/playerCard.ts
 *
 * The rule, in the order it is asked:
 *
 *   1. PAST       its term sits in a season that has ended, or its term ended
 *                 before now. Old seatings that came through no application
 *                 join this group too, labelled in plain words.
 *   2. NEXT       its term sits in the season after this one, or it starts on
 *                 or after the day this season ends.
 *   3. THIS       everything else: its term sits in this season, or it is
 *                 waiting on a decision with no later start.
 *
 * Only the person's own rows are grouped. A row for anybody else is dropped,
 * so a host cannot leak another member's application into a card by passing
 * the wrong list.
 */

export type ApplicationGroup = "past" | "thisSeason" | "nextSeason";

export const APPLICATION_GROUPS: readonly ApplicationGroup[] = ["past", "thisSeason", "nextSeason"];

/** The fields the rule reads. Instants are ISO strings or Dates. */
export interface GroupableApplication {
  candidateUserId: string;
  termSeasonId: string | null;
  startsAt: string | Date | null;
  termEndsAt: string | Date | null;
}

export interface GroupingContext {
  now: Date;
  /** The season in force today, or null. */
  seasonId: string | null;
  /** The first instant after this season, or null when it is open-ended. */
  seasonEndsAt: Date | null;
  nextSeasonId: string | null;
  /** Every season whose end has passed. */
  endedSeasonIds: ReadonlySet<string> | readonly string[];
}

const ms = (v: string | Date | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = (v instanceof Date ? v : new Date(String(v))).getTime();
  return Number.isNaN(t) ? null : t;
};

const hasId = (set: GroupingContext["endedSeasonIds"], id: string): boolean =>
  Array.isArray(set) ? set.includes(id) : (set as ReadonlySet<string>).has(id);

/** Which group one application sits in. */
export function applicationGroup(a: GroupableApplication, ctx: GroupingContext): ApplicationGroup {
  const now = ctx.now.getTime();
  const season = a.termSeasonId;
  if (season !== null && season !== ctx.seasonId && hasId(ctx.endedSeasonIds, season)) return "past";
  const ends = ms(a.termEndsAt);
  if (season === null || season !== ctx.seasonId) {
    if (ends !== null && ends <= now) return "past";
  }
  if (season !== null && ctx.nextSeasonId !== null && season === ctx.nextSeasonId) return "nextSeason";
  const starts = ms(a.startsAt);
  if (starts !== null && ctx.seasonEndsAt !== null && starts >= ctx.seasonEndsAt.getTime()) return "nextSeason";
  return "thisSeason";
}

/** One person's rows, in three groups, each keeping the order it arrived in. */
export function groupApplications<T extends GroupableApplication>(
  rows: readonly T[],
  candidateUserId: string,
  ctx: GroupingContext,
): Record<ApplicationGroup, T[]> {
  const out: Record<ApplicationGroup, T[]> = { past: [], thisSeason: [], nextSeason: [] };
  for (const a of rows) {
    if (a.candidateUserId !== candidateUserId) continue;
    out[applicationGroup(a, ctx)].push(a);
  }
  return out;
}

/** The seasons that have ended by `now`, from the calendar's civil end dates read as instants. */
export function endedSeasons(
  seasons: ReadonlyArray<{ id: string; endsOn?: string | null }>,
  endInstant: (endsOn: string) => Date | null,
  now: Date,
): Set<string> {
  const out = new Set<string>();
  for (const s of seasons) {
    if (!s.endsOn) continue;
    const at = endInstant(s.endsOn);
    if (at && at.getTime() <= now.getTime()) out.add(String(s.id));
  }
  return out;
}

/** An old seating that came through no application: a role held before applications were kept. */
export interface PastSeating {
  roleId: string;
  startedAt: string | null;
  endedAt: string | null;
}

export const PAST_SEATING_WORDS = {
  status: "Held, with no application on file",
  held: (from: string | null, to: string | null) =>
    from && to ? `Held from ${from} to ${to}` : to ? `Held until ${to}` : from ? `Held from ${from}` : "Held before applications were kept",
} as const;
