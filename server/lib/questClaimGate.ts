/**
 * Gathers the facts the one claim gate decides on (shared/questClaimGate.ts)
 * for a quest and a member, so every door into a claim asks the same question
 * the same way: the board's route in server/routes/quests.ts, the map's
 * promise route in server/index.ts, and joining a crew on a physical quest.
 */
import type { Pool } from "mysql2/promise";
import { questClaimGate, type ClaimRefusal } from "../../shared/questClaimGate";
import { stageIndex } from "../../shared/gameConfig";
import { effectiveMinAge, MINIMUM_AGES_VARIABLE } from "../../shared/ageBands";
import { boolVar } from "./variables";
import { isExampleRow } from "./examples";
import { questClosed } from "../repos/quests";
import { ageBandOf, questSafetyOf, safetyBadgesHeld } from "../repos/questSafety";

export interface ClaimGateDeps {
  getPool(): Pool;
  stageOf(user: any): Promise<string>;
  roleIdsFor(userId: string): string[];
  /** Whether quests may ask a minimum age. Defaults to the village setting, which ships off. */
  minimumAgesOn?(): boolean;
}

/** The village's minimum-age setting, read at call time. */
export const minimumAgesOnByDefault = (): boolean => boolVar(MINIMUM_AGES_VARIABLE);

export async function claimRefusalFor(
  deps: ClaimGateDeps,
  quest: { id: string; status?: string | null; minStage?: string | null; requiresRole?: string | null },
  user: { id: string },
): Promise<ClaimRefusal | null> {
  const pool = deps.getPool();
  const minStage = quest.minStage ?? null;
  const safety = await questSafetyOf(pool, quest.id);
  const minAge = effectiveMinAge(safety, (deps.minimumAgesOn ?? minimumAgesOnByDefault)());
  const requiredBadges = safety?.requiredBadges ?? [];
  return questClaimGate({
    isExample: await isExampleRow(pool, "quests", quest.id),
    closed: questClosed(quest.status),
    status: String(quest.status ?? ""),
    minStage,
    neededStageIndex: minStage ? stageIndex(minStage) : -1,
    // Each fact is read only when the quest asks it, as the routes always did.
    memberStageIndex: minStage ? stageIndex(await deps.stageOf(user)) : 0,
    requiresRole: quest.requiresRole ?? null,
    memberRoleIds: quest.requiresRole ? deps.roleIdsFor(user.id) : [],
    minAge,
    memberAgeBand: minAge != null ? await ageBandOf(pool, user.id) : null,
    requiredBadges,
    memberBadgeIds: requiredBadges.length ? await safetyBadgesHeld(pool, user.id) : [],
  });
}

/** Whether the quest is hands-on, so joining its crew runs the gate too (spec R2). */
export async function isPhysicalQuest(pool: Pool, questId: string): Promise<boolean> {
  return !!(await questSafetyOf(pool, questId))?.physical;
}
