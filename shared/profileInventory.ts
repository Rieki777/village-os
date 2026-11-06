/**
 * INVENTORY ON THE PROFILE: what a member has borrowed, the stays they have
 * booked, and the homes they have asked to reserve (the 2026-08-11 foundation
 * handoff, section 3b).
 *
 *   GET /api/me/profile          carries `inventory`, always, for the member
 *   GET /api/profiles/:handle    carries it only when the member turned on
 *                                `showInventory` (default off, server/lib/profile.ts)
 *   PUT /api/me/privacy          turns it on or off
 *
 * Only what is live: a loan from reserved to being returned, a stay requested
 * or under way, a reservation that has not been withdrawn. A finished loan or
 * a past stay is history, and history belongs on the ledger.
 *
 * Nothing here is personal beyond the fact itself: a reservation carries the
 * home type, the place on the map and where it stands, never the name, email,
 * phone or notes typed into the form.
 */

export type LoanStatus = "reserved" | "pickup_pending" | "active" | "return_pending";
export type StayStatus = "requested" | "active";

export const LIVE_LOAN_STATUSES: readonly LoanStatus[] = ["reserved", "pickup_pending", "active", "return_pending"];
export const LIVE_STAY_STATUSES: readonly StayStatus[] = ["requested", "active"];

export interface InventoryLoan {
  id: string;
  item: string;
  status: LoanStatus;
  /** YYYY-MM-DD, or null. */
  dueOn: string | null;
}

export interface InventoryStay {
  id: string;
  place: string;
  status: StayStatus;
  /** YYYY-MM-DD, or null. */
  arriveOn: string | null;
}

export interface InventoryLot {
  id: string;
  homeType: string;
  structureKey: string | null;
  /** Where it stands, in the member's own terms (server/lib/housing.ts). */
  standing: string;
}

export interface Inventory {
  loans: InventoryLoan[];
  stays: InventoryStay[];
  lots: InventoryLot[];
}

/** Keyed by the union, so a new status cannot render as nothing. */
export const LOAN_WORDS: Record<LoanStatus, string> = {
  reserved: "Reserved",
  pickup_pending: "Ready to pick up",
  active: "Borrowed",
  return_pending: "Being returned",
};

export const STAY_WORDS: Record<StayStatus, string> = {
  requested: "Requested",
  active: "Staying now",
};

export const PRIVACY_URL = "/api/me/privacy";

export function isEmptyInventory(inv: Inventory | null | undefined): boolean {
  return !inv || (inv.loans.length === 0 && inv.stays.length === 0 && inv.lots.length === 0);
}
