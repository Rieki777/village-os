/**
 * THE CIRCLE CARD, BUILT FROM THE DATABASE FOR ONE CIRCLE AT ONE READER'S TIER.
 *
 * `buildCircleCardFor(pool, circle, ctx)` reads each table once (five reads,
 * whatever the number of roles), applies the reader's tier, and hands the rows
 * to the pure model (`buildCircleCard`, shared/circleCard.ts).
 *
 * ── ONE SEAT OBJECT, SO IT CANNOT DRIFT FROM /api/org ──────────────────────
 *
 * The circle's roles go through `projectSeats` (server/lib/seatProjection.ts)
 * at the tier `/api/org` would give this reader, and the card reads a role's
 * state, holder count and the holders' handles off that projection. A field the
 * projection withholds from this reader is unread on the card, never guessed.
 * The holders' names are never read off it: the card names roles, not people.
 *
 * ── WHAT EACH READER SEES ──────────────────────────────────────────────────
 *
 * Every reader sees the circle's words, the way `/api/org` serves every
 * circle's purpose to every reader, and each role with how full it is, which
 * `/api/org` also tells a visitor. The links to the holders' cards need the
 * member holder rows (`map.viewPeople`), so below that tier a filled role
 * carries no link and the card says once that holder cards are for members.
 */
import type { Pool } from "mysql2/promise";
import { buildCircleCard, type CircleCard, type CircleRoleIn } from "../../shared/circleCard";
import { charterFromRow } from "../../shared/circleCharter";
import { circleWordKeysOf, parseCircleWords } from "../../shared/circleCharterParse";
import { listOrgAssignments, listOrgRoles, type LapseContext } from "./orgChart";
import { projectSeats, type SeatTier } from "./seatProjection";
import { payBadgeBoosts, rolePayRules } from "./workPay";
import { readCircleLive } from "./circleLive";
import { circleSummary, type RhythmDeps } from "./sessionRhythm";
import type { CycleClock } from "../../shared/cycleClock";
import { handlesOf } from "../repos/orgRoleHealth";
import { openCircleWordProposals, readCharterRow, readCircleAdoptions } from "../repos/circleCard";

/** A circle as the circles store holds it (`circlesRepo`). */
export interface StoredCircle {
  id: string;
  name: string;
  purpose?: string | null;
  status?: string | null;
  parentCircleId?: string | null;
  isExample?: boolean;
}

export interface CircleCardCtx {
  now: Date;
  timeZone: string;
  lapse: LapseContext;
  /** `/api/org`'s tier for this reader (`orgSeatTier`). */
  tier: SeatTier;
  /** `org.ccos_terms`. */
  frameworkTerms: boolean;
  /** The village clock the signs count their moons on. */
  clock: CycleClock;
  /** Live Sessions is on for this reader: the meeting sections draw. */
  sessionsOn: boolean;
  /** The last day of the current season (Rye, 2026-10-22: a charter is reviewed each season), or null. */
  reviewOn: string | null;
  /** The signed-in reader, for Live Sessions' own door (`circleSummary`), which tiers what waits. */
  viewer: { userId: string; admin: boolean } | null;
  /** What `circleSummary` reads the circles from. */
  sessionsDeps: RhythmDeps;
  /** Badges asleep this season, so a card names no multiplier the payment would skip. */
  dormantBadges?: readonly string[];
}

/**
 * The card for one circle. `circles` is every circle in the store, read for
 * the name of the circle this one sits in.
 */
export async function buildCircleCardFor(
  pool: Pool,
  circle: StoredCircle,
  circles: readonly StoredCircle[],
  ctx: CircleCardCtx,
): Promise<CircleCard> {
  // The words an open draft would change are read where the holder rows are: the member tier.
  const memberTier = ctx.tier.people === "member";
  const [roles, assignments, charterRow, adoptions, openProposals, payRules, payBadges] = await Promise.all([
    listOrgRoles(pool),
    listOrgAssignments(pool, ctx.lapse),
    readCharterRow(pool, circle.id),
    readCircleAdoptions(pool, circle.id),
    memberTier ? openCircleWordProposals(pool, circle.id) : Promise.resolve(null),
    // What each role pays, at the tier `/api/org` reads it (Rye, 2026-10-30: the full pay before you take it on).
    ctx.tier.terms ? rolePayRules(pool) : Promise.resolve(undefined),
    ctx.tier.terms ? payBadgeBoosts(pool, ctx.dormantBadges ?? []).catch(() => []) : Promise.resolve(undefined),
  ]);
  const inCircle = roles.filter((r) => r.active && r.circleId === circle.id);
  const ids = new Set(inCircle.map((r) => r.id));
  const held = assignments.filter((a) => ids.has(a.orgRoleId));

  const memberIds = Array.from(new Set(held.filter((a) => a.holderKind === "member" && a.userId).map((a) => String(a.userId))));
  const handles = memberTier ? await handlesOf(pool, memberIds) : new Map<string, string | null>();

  // The holders' names are never read: nameOf answers nothing a reader sees.
  const seats = projectSeats(inCircle, held, ctx.tier, {
    route: "org",
    now: ctx.now,
    nameOf: () => "",
    firstName: (s) => s,
    ...(memberTier ? { handleOf: (id: string) => handles.get(String(id)) ?? null } : {}),
    payRules,
    payBadges,
  });
  // The live parts, at the tier the player card counts its signs at (`terms.read`).
  // The meeting rhythm, the next meeting, the last one and what waits come through Live Sessions' own
  // door (server/lib/sessionRhythm.ts `circleSummary`), so its rules stay in one place.
  const summary =
    ctx.tier.terms && ctx.sessionsOn && ctx.viewer
      ? await circleSummary(pool, circle.id, ctx.viewer, ctx.sessionsDeps, ctx.now).catch(() => null)
      : null;
  const counted = ctx.tier.terms ? await readCircleLive(pool, circle.id, inCircle, held, { now: ctx.now, timeZone: ctx.timeZone, clock: ctx.clock }) : null;
  const live = counted
    ? {
        ...counted,
        sessionsOn: ctx.sessionsOn,
        lastMetAt: summary ? summary.lastMetAt : counted.lastMetAt,
        rhythm: summary?.rhythm?.words ?? null,
        next: summary?.next?.words ?? null,
        waiting: summary ? summary.waiting : null,
      }
    : undefined;

  const roleRows: CircleRoleIn[] = seats.map((s: any) => ({
    id: String(s.id),
    name: String(s.name ?? ""),
    capacity: Number(s.seats) || 1,
    holderCount: Number(s.holderCount) || 0,
    state: String(s.state ?? "open"),
    isExample: !!s.isExample,
    ...(s.pay ? { pay: s.pay } : {}),
    holderHandles: memberTier
      ? (Array.isArray(s.holders) ? s.holders : [])
          .filter((h: any) => h?.kind === "member" && !h?.isAgent)
          .map((h: any) => (typeof h.handle === "string" && h.handle ? h.handle : null))
      : undefined,
  }));

  const parent = circle.parentCircleId ? circles.find((c) => c.id === circle.parentCircleId) : undefined;
  return buildCircleCard({
    circle: {
      id: circle.id,
      name: circle.name,
      purpose: circle.purpose ?? null,
      status: circle.status ?? null,
      parent: parent ? { id: parent.id, name: parent.name } : null,
    },
    charter: charterFromRow(charterRow),
    roles: roleRows,
    adoptions: adoptions.map((a) => ({
      draftId: a.draftId,
      publishedAt: new Date(a.publishedAt * 1000).toISOString(),
      byVote: a.byVote,
      created: a.created,
    })),
    timeZone: ctx.timeZone,
    frameworkTerms: ctx.frameworkTerms,
    // A reader who may not read terms is offered the door that has no membership to refuse them at.
    readerMayApply: ctx.tier.terms,
    live,
    reviewOn: ctx.reviewOn,
    pending: openProposals ? openProposals.flatMap((p) => circleWordKeysOf(p.payload)) : undefined,
    // The proposed words themselves, parsed by the one parser, so a decider reads what would go live.
    proposals: openProposals
      ? openProposals.flatMap((p) => {
          const parsed = parseCircleWords(p.payload);
          return parsed.ok ? [{ draftId: p.draftId, proposedAt: new Date(p.createdAt * 1000).toISOString(), words: parsed.value }] : [];
        })
      : undefined,
  });
}
