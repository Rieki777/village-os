/**
 * A QUEST'S STATUS MARK (Phase C, decision 5): the one small piece of the
 * nature layer the open work board keeps. Never the layout, only a mark on a
 * card.
 *
 *   seed     open, and nobody carries it yet
 *   sprout   underway: somebody carries it now (picked up or handed in)
 *   flower   done this moon (consented since this moon's new moon), and
 *            nobody carries it again yet
 *
 * THE MARK DESCRIBES THE WORK AND NEVER A PERSON. It reads the quest's own
 * life signs from GET /api/quests/field, counted across the whole village.
 *
 * Sprout before flower: a quest somebody is in the middle of is the one a
 * hand can join now, so a repeatable quest done this moon and taken up again
 * reads as underway.
 */
import { cycleBoundsFor } from "@shared/lunar";
import type { QuestSigns } from "./questBoard";

export type QuestStatus = "seed" | "sprout" | "flower";

export const QUEST_STATUSES: readonly QuestStatus[] = ["seed", "sprout", "flower"];

/** A quest's mark, from its life signs. No signs (or an older server) is a seed. */
export function statusFor(signs: QuestSigns | null | undefined): QuestStatus {
  if ((signs?.active ?? 0) > 0) return "sprout";
  if ((signs?.moon ?? 0) > 0) return "flower";
  return "seed";
}

/**
 * The mark for a piece of work a member holds, on their own profile: a sprout
 * while it is picked up or handed in, a flower when it was consented this
 * moon. Work finished in an earlier moon, or declined, has no mark (null): a
 * flower means "this moon" everywhere, and the profile never sums anybody's
 * work into a garden.
 */
export function claimStatus(
  claim: { status: string; resolvedAt?: string | null },
  now: Date = new Date(),
): QuestStatus | null {
  if (claim.status === "claimed" || claim.status === "submitted") return "sprout";
  if (claim.status !== "consented" || !claim.resolvedAt) return null;
  const at = new Date(claim.resolvedAt).getTime();
  if (Number.isNaN(at)) return null;
  return at >= cycleBoundsFor(now).startsAt.getTime() && at <= now.getTime() ? "flower" : null;
}
