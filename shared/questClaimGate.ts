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
}

export type ClaimRefusal =
  | { kind: "example" }
  | { kind: "closed"; status: string }
  | { kind: "stage"; minStage: string }
  | { kind: "role"; requiresRole: string };

export const CLAIM_REFUSAL_KINDS = ["example", "closed", "stage", "role"] as const satisfies readonly ClaimRefusal["kind"][];

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
};
