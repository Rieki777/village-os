/**
 * GRANTING A STAGE: the one path.
 *
 * Lifted out of `PUT /api/admin/players/:id/stage` (server/routes/players.ts,
 * the route the admin roster's stage-floor picker calls) unchanged, so an
 * adopted open role proposal grants the Member stage the same way an admin's
 * tick does (open proposals part B; coordinator's call 2, 2026-10-31): the
 * stage checked against the ladder, an example identity refused, the grant
 * written under the member's row lock, and the advance recorded with the
 * capabilities it opened.
 *
 * A GRANT IS A FLOOR (server/lib/admission.ts `climbLadder`): it raises the
 * member's stage and never lowers what they earned. An admin may move the
 * floor down by hand, which is the route's own act. A grant made by a decision
 * (`raiseOnly`) only ever moves it up: a member whose floor already sits above
 * the stage asked for keeps their floor, read under the same lock that writes.
 */
import { GAME_CONFIG } from "../../shared/gameConfig";
import type { AppDeps } from "./appDeps";
import { EXAMPLE_REFUSAL_BODY, isExampleUser } from "./examples";

export type StageGrantDeps = Pick<AppDeps, "members" | "stageOf" | "recordStageEvent">;

export type StageGrantOutcome =
  | { ok: true; stageComputed: string; changed: boolean }
  | { ok: false; status: 400 | 404 | 409; body: Record<string, unknown> };

const rungOf = (id: unknown): number => GAME_CONFIG.stages.findIndex((s) => s.id === id);

/**
 * Set a member's granted stage, or clear it with a null. `reason` is what the
 * stage event records. With `raiseOnly`, a floor already at or above the stage
 * is left where it is.
 */
export async function grantStage(
  deps: StageGrantDeps,
  userId: string,
  stageId: unknown,
  reason: string,
  opts: { raiseOnly?: boolean } = {},
): Promise<StageGrantOutcome> {
  if (stageId && !GAME_CONFIG.stages.some((s) => s.id === stageId)) {
    return { ok: false, status: 400, body: { error: "Unknown stage" } };
  }
  const target = await deps.members.byId(userId);
  if (!target) return { ok: false, status: 404, body: { error: "Not found" } };
  // The seed sets each identity's stage so its example content renders at
  // the right level; moving one is editing example content.
  if (isExampleUser(target)) return { ok: false, status: 409, body: EXAMPLE_REFUSAL_BODY };
  const before = await deps.stageOf(target);
  let changed = false;
  const updated = await deps.members.update(target.id, (u: any) => {
    if (opts.raiseOnly && stageId && rungOf(u.stageGranted) >= rungOf(stageId)) return;
    u.stageGranted = stageId ?? null;
    changed = true;
  });
  if (!updated) return { ok: false, status: 404, body: { error: "Not found" } };
  const after = await deps.stageOf(updated);
  await deps.recordStageEvent(updated, before, after, reason);
  return { ok: true, stageComputed: after, changed };
}
