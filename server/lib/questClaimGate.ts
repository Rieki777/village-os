/**
 * Gathers the facts the one claim gate decides on (shared/questClaimGate.ts)
 * for a quest and a member, so both claim doors ask the same question the
 * same way: the board's route in server/routes/quests.ts and the map's
 * promise route in server/index.ts.
 */
import type { Pool } from "mysql2/promise";
import { questClaimGate, type ClaimRefusal } from "../../shared/questClaimGate";
import { stageIndex } from "../../shared/gameConfig";
import { isExampleRow } from "./examples";
import { questClosed } from "../repos/quests";

export interface ClaimGateDeps {
  getPool(): Pool;
  stageOf(user: any): Promise<string>;
  roleIdsFor(userId: string): string[];
}

export async function claimRefusalFor(
  deps: ClaimGateDeps,
  quest: { id: string; status?: string | null; minStage?: string | null; requiresRole?: string | null },
  user: { id: string },
): Promise<ClaimRefusal | null> {
  const minStage = quest.minStage ?? null;
  return questClaimGate({
    isExample: await isExampleRow(deps.getPool(), "quests", quest.id),
    closed: questClosed(quest.status),
    status: String(quest.status ?? ""),
    minStage,
    neededStageIndex: minStage ? stageIndex(minStage) : -1,
    // Asked only when a floor exists, as the routes always did: a member's
    // stage costs a read, and most quests name no floor.
    memberStageIndex: minStage ? stageIndex(await deps.stageOf(user)) : 0,
    requiresRole: quest.requiresRole ?? null,
    memberRoleIds: quest.requiresRole ? deps.roleIdsFor(user.id) : [],
  });
}
