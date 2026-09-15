/**
 * A CARRIED CHANGE SET THAT DID NOT WHOLLY LAND IS A FAILED LANDING.
 *
 * `applyDue` marks a landing applied whenever a closer's `execute` returns, and
 * takes its failure path (the row goes back to pending, the sentence is written
 * onto the executor-pending attempt, the next tick tries again) only when it
 * throws. So a closer that RETURNS after `applyChangeSet` refused its set, or
 * after some of its elements failed, records a decision as landed that did not
 * land. The mechanics closer throws for that reason; this file gives the
 * weight-mode closer the same shape without growing `server/index.ts`.
 *
 * WHERE THE THROW IS SEEN. A Game change never executes inside the close: its
 * landing is stamped for an instant after the window, and `applyDueGovernance`
 * runs it then. So the throw reaches the landing job, never the close route.
 * `server/lib/landingRefusal.test.ts` pins both halves.
 */
import { applyChangeSet, type ApplySetResult, type ChangesetDeps } from "./changeset";
import type { ChangeInput } from "./mechanics";

/** The sentence a set that did not wholly land is recorded with, or null when it did. */
export function notLandedSentence(result: Pick<ApplySetResult, "refusal" | "failed">): string | null {
  if (result.refusal) return result.refusal.sentence;
  if (result.failed.length > 0) return result.failed.map((f) => `${f.key}: ${f.problem}`).join("; ");
  return null;
}

/**
 * Land a carried change to how votes are weighed: one mode switch through the
 * two-phase executor, whose phase 1 judges the whole switch (the mode, the
 * token and its bounds) before anything is written. Throws unless every
 * element landed, so the landing is never marked applied on a refusal or a
 * partial write.
 */
export async function landWeightMode(
  deps: ChangesetDeps,
  ballot: { id: string; subjectRef: string },
  actorId: string | null,
): Promise<ApplySetResult> {
  const [mode, token] = String(ballot.subjectRef).split("@");
  const change = { kind: "mode_switch", to: mode, ...(token ? { weightToken: token } : {}) };
  const result = await applyChangeSet(deps, {
    ballotId: ballot.id,
    proposalRef: `bal:${ballot.id}`,
    actor: actorId,
    changes: [change as unknown as ChangeInput],
  });
  const failure = notLandedSentence(result);
  if (failure) throw new Error(failure);
  return result;
}
