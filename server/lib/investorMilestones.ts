/**
 * The investor path's writes, in order (spec v0.3, slice S2).
 *
 * Each function checks its rule from shared/investorPath.ts first, then writes,
 * then awards. A refusal names the vote that can change the rule (REFUSALS), so
 * nothing here is stuck without a vote path.
 *
 * THE BADGES ARE AWARDED AT THE MOMENT OF THE RECORD (Rye, 2026-11-09). A home
 * handed over earns Homeowner and a parcel bought earns Neighbour, through the
 * same `awardFirstTierNow` the Gene Keys badge uses, so the cycle-close engine
 * and this path write the same `rule:{badge}:{user}:tier-1` event and can never
 * award one twice. The caller passes `badgesOn`: a village with the badges
 * module off still records the handover and awards nothing.
 */
import type { Pool } from "mysql2/promise";
import {
  handVerdict,
  homeLeaseCheck,
  routeIntent,
  villageMonth,
  wayVisibility,
  type Refusal,
  type WayKey,
} from "../../shared/investorPath";
import { awardFirstTierNow } from "./badges";
import {
  closeInvitationRow,
  handCounts,
  insertHomeHandover,
  insertIntent,
  insertInvitationHistory,
  insertParcelSale,
  invitationById,
  withdrawIntentRow,
} from "../repos/investorMilestones";

export const HOMEOWNER_BADGE = "homeowner";
export const NEIGHBOUR_BADGE = "neighbour";

/** Refusals this file adds to the S1 table: facts about records, so no vote changes them. */
export type RecordProblem =
  | { ok: false; code: "ALREADY_RECORDED"; message: string }
  | { ok: false; code: "NOT_A_PARCEL"; message: string }
  | { ok: false; code: "INVITATION_CLOSED"; message: string };

// ── Raised hands ────────────────────────────────────────────────────────────

export interface RaiseHandInput {
  userId: string;
  way: WayKey;
  invitationId: string | null;
  member: boolean;
  hiddenWays: readonly WayKey[];
  /** `investor.hands_per_moon`. */
  limit: number;
  /** Who holds the way's role, and the anchor circle when nobody does. */
  roleHolders: readonly string[];
  anchorCircle: readonly string[];
  now: Date;
  timeZone: string;
}

export type RaiseHandResult = { ok: true; intentId: string; routedTo: "role" | "anchor" | "notice"; recipients: string[] } | Refusal;

export async function raiseHand(pool: Pool, input: RaiseHandInput): Promise<RaiseHandResult> {
  const visible = wayVisibility(input.way, { hidden: input.hiddenWays, member: input.member });
  if (!visible.ok) return visible;
  const moon = villageMonth(input.now, input.timeZone);
  const counts = await handCounts(pool, input.userId, input.way, moon);
  const verdict = handVerdict({ ...counts, limit: input.limit });
  if (!verdict.ok) return verdict;
  const route = routeIntent({ raiserId: input.userId, roleHolders: input.roleHolders, anchorCircle: input.anchorCircle });
  const intentId = await insertIntent(pool, {
    userId: input.userId,
    way: input.way,
    invitationId: input.invitationId,
    moon,
    routedKind: route.to,
    routedRef: route.recipients[0] ?? null,
  });
  // The unique key caught a second open hand that the count read before it existed.
  if (intentId === null) return handVerdict({ openOnWay: 1, raisedThisMoon: 0, limit: input.limit }) as Refusal;
  return { ok: true, intentId, routedTo: route.to, recipients: route.recipients };
}

export const withdrawHand = (pool: Pool, userId: string, intentId: string) => withdrawIntentRow(pool, userId, intentId);

// ── A home handed over (R3, R6) ─────────────────────────────────────────────

export interface HandOverInput {
  homeRef: string;
  reservationId: string | null;
  userId: string;
  recordedBy: string;
  /** `investor.home_lease_min_shares`. Null when the village has not set it, which refuses. */
  minShares: number | null;
  /** Whole units, read from the ledger by the caller. Never stored here. */
  investedUnits: number;
  earnedUnits: number;
  badgesOn: boolean;
}

export type HandOverResult = { ok: true; handoverId: string; badgeAwarded: boolean } | Refusal | RecordProblem;

/**
 * Hand a home over on its 99-year land lease. The lease needs the owner to
 * hold N shares (Rye, 2026-11-09), checked here at lease time. The steward
 * recording it learns yes or no, never the holding.
 */
export async function handOverHome(pool: Pool, input: HandOverInput): Promise<HandOverResult> {
  const lease = homeLeaseCheck({ minShares: input.minShares, investedUnits: input.investedUnits, earnedUnits: input.earnedUnits });
  if (!lease.ok) return lease;
  const handoverId = await insertHomeHandover(pool, {
    homeRef: input.homeRef,
    reservationId: input.reservationId,
    userId: input.userId,
    recordedBy: input.recordedBy,
  });
  if (handoverId === null) {
    return { ok: false, code: "ALREADY_RECORDED", message: "This home has already been handed over." };
  }
  const badgeAwarded = input.badgesOn ? await awardFirstTierNow(pool, HOMEOWNER_BADGE, input.userId) : false;
  return { ok: true, handoverId, badgeAwarded };
}

// ── A parcel sold (R5, R6) ──────────────────────────────────────────────────

export interface SellParcelInput {
  invitationId: string;
  /** Null for a parcel sold before the platform knew the buyer. */
  userId: string | null;
  recordedBy: string;
  badgesOn: boolean;
}

export type SellParcelResult = { ok: true; saleId: string; badgeAwarded: boolean } | RecordProblem;

export async function sellParcel(pool: Pool, input: SellParcelInput): Promise<SellParcelResult> {
  const inv = await invitationById(pool, input.invitationId);
  if (!inv || inv.way !== "parcel") {
    return { ok: false, code: "NOT_A_PARCEL", message: "That invitation is not a parcel." };
  }
  if (inv.status !== "open") {
    return { ok: false, code: "INVITATION_CLOSED", message: "That parcel is no longer offered." };
  }
  const saleId = await insertParcelSale(pool, { invitationId: inv.id, userId: input.userId, recordedBy: input.recordedBy });
  if (saleId === null) return { ok: false, code: "ALREADY_RECORDED", message: "This parcel has already been sold." };
  if (await closeInvitationRow(pool, inv.id, "sold")) {
    await insertInvitationHistory(pool, inv.id, "sold", null, input.recordedBy);
  }
  const badgeAwarded = input.badgesOn && input.userId ? await awardFirstTierNow(pool, NEIGHBOUR_BADGE, input.userId) : false;
  return { ok: true, saleId, badgeAwarded };
}

