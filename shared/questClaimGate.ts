/**
 * ONE CLAIM GATE, for every door into a claim (build days S5a, spec R15).
 *
 * Until this, the board's claim route (`POST /api/game/quests/:id/claim`) and
 * the map's (`POST /api/map/promise`) each wrote the same rules a second time:
 * a standing example refuses, a closed quest refuses, a stage floor refuses,
 * a reserved role refuses. Two copies drift, and the next rule (a safety badge,
 * a minimum age, a site's school hours) would have had to be written twice and
 * remembered twice. Now both doors ask this one predicate, in one order, and
 * each maps the typed refusal to its own reply: the board answers with a
 * status and a sentence, the map with its short reason vocabulary.
 *
 * FACTS ABOUT THE WORK, NEVER POWERS. This gate reads what a quest asks of
 * whoever takes it on. Who may ACT on a power is the one capability gate's
 * (shared/capabilities.ts, constitution VII.9), and nothing here reads a
 * capability.
 *
 * PURE. The server gathers the facts (server/lib/questClaimGate.ts); this
 * decides. The order is the order a member is told: the first refusal wins.
 */

import { bandMeets, type AgeBand } from "./ageBands";

export interface ClaimGateFacts {
  /** A standing example renders on the board and refuses every claim. */
  isExample: boolean;
  /** The board has shut the quest (`questClosed`). */
  closed: boolean;
  /** The quest's status word, carried into the refusal for the board's reply. */
  status: string;
  /** The stage floor the quest names, or null. */
  minStage: string | null;
  /** Index of that floor in the village's ladder; below 0 means the ladder does not know it. */
  neededStageIndex: number;
  /** Index of the member's own stage. */
  memberStageIndex: number;
  /** The permission-plane role the quest is reserved for, or null. */
  requiresRole: string | null;
  /** The permission-plane roles the member holds. */
  memberRoleIds: readonly string[];
  /**
   * The badges the quest asks for (build days S5): safety badges for tools,
   * heights and machines. Empty when it asks for none.
   */
  requiredBadges?: readonly string[];
  /**
   * The badges the member holds that may pass a safety gate: earned or
   * granted, unexpired, never self-declared (server/lib/questClaimGate.ts).
   */
  memberBadgeIds?: readonly string[];
  /** The minimum age the quest asks (shared/ageBands.ts `effectiveMinAge`), or null. */
  minAge?: number | null;
  /** The member's age band, or null when they have not said it. */
  memberAgeBand?: AgeBand | null;
}

export type ClaimRefusal =
  | { kind: "example" }
  | { kind: "closed"; status: string }
  | { kind: "stage"; minStage: string }
  | { kind: "role"; requiresRole: string }
  | { kind: "badge"; missing: string[] }
  | { kind: "attest"; minAge: number }
  | { kind: "age"; minAge: number };

export const CLAIM_REFUSAL_KINDS = ["example", "closed", "stage", "role", "badge", "attest", "age"] as const satisfies readonly ClaimRefusal["kind"][];

/** The first rule this member does not meet, or null when the claim may go ahead. */
export function questClaimGate(f: ClaimGateFacts): ClaimRefusal | null {
  if (f.isExample) return { kind: "example" };
  if (f.closed) return { kind: "closed", status: f.status };
  // A floor the ladder does not know is no floor: the board has always read an
  // unknown stage as open, and this keeps that reading.
  if (f.minStage && f.neededStageIndex >= 0 && f.memberStageIndex < f.neededStageIndex) {
    return { kind: "stage", minStage: f.minStage };
  }
  if (f.requiresRole && !f.memberRoleIds.includes(f.requiresRole)) {
    return { kind: "role", requiresRole: f.requiresRole };
  }
  // Age before badges: a badge can be earned on the day, an age cannot.
  if (f.minAge != null) {
    if (!f.memberAgeBand) return { kind: "attest", minAge: f.minAge };
    if (!bandMeets(f.memberAgeBand, f.minAge)) return { kind: "age", minAge: f.minAge };
  }
  const held = new Set(f.memberBadgeIds ?? []);
  const missing = (f.requiredBadges ?? []).filter((b) => !held.has(b));
  if (missing.length) return { kind: "badge", missing };
  return null;
}

/**
 * The map's reply word for each refusal. The map's vocabulary is short on
 * purpose (shared/mapPromise.ts): an example and a closed quest are both
 * "closed", a stage floor and a reserved role are both "not yet".
 */
export const MAP_REASON_FOR: Record<ClaimRefusal["kind"], "closed" | "not-yet"> = {
  example: "closed",
  closed: "closed",
  stage: "not-yet",
  role: "not-yet",
  badge: "not-yet",
  attest: "not-yet",
  age: "not-yet",
};
