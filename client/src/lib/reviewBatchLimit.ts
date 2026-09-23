/**
 * The review queue's batch limit and its withdraw refusals, read out of
 * client/src/pages/Review.tsx, which sits at the file-lines threshold.
 */

/** Where an admin changes the limit: the Game Mechanics tab, opened at that one dial. */
export const CHANGE_LIMIT_HREF = "/admin?tab=variables&variable=org.proposal_change_limit";

function changes(n: number): string {
  return n === 1 ? "1 change" : `${n} changes`;
}

/**
 * The limit a batch meets, said before anybody accepts it. Rye, 2026-09-14:
 * "Definitely should show the batch limit with a button to go to that
 * setting to change adjust it higher." A steward who cannot open that setting
 * is told who can, and is offered no button that would go nowhere.
 *
 * WHO CAN RAISE IT IS SAID ONLY OVER THE LIMIT, and names the limit. Under a
 * batch well inside it, "An admin can raise it." read as raising the batch.
 */
export function limitSentence(limit: number, proposed: number, mayChange: boolean): string {
  const parts = [`This village accepts up to ${changes(limit)} from one outside batch. This batch proposes ${proposed}.`];
  if (proposed > limit) {
    parts.push(`Every change past the first ${limit} will be blocked.`);
    if (!mayChange) parts.push("An admin can raise the limit.");
  }
  return parts.join(" ");
}

/**
 * How many changes one edited payload proposes, or null when the text is no
 * payload. The server reader's rule (`readProposedSeats`,
 * server/lib/proposedSeats.ts): a `seats` list is one change per object in
 * it, and any other payload is one seat.
 */
export function changesInEdit(text: string): number | null {
  let p: unknown;
  try {
    p = JSON.parse(text);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const seats = (p as Record<string, unknown>).seats;
  return Array.isArray(seats) ? seats.filter((s) => !!s && typeof s === "object" && !Array.isArray(s)).length : 1;
}

/**
 * The batch's count with the steward's edits in it.
 *
 * The server counts each card as it arrived. Accepting uses the edited
 * payloads, so a count that ignored the edits could say a batch fits when the
 * accept will block part of it. An edit that reads as a payload replaces its
 * card's share; one that does not keeps the share, and accepting refuses that
 * text anyway. An older server sends no shares, and the total stands.
 */
export function countWithEdits(
  total: number,
  shares: Record<string, number> | undefined,
  edits: Record<string, string>,
): number {
  if (!shares) return total;
  let n = total;
  for (const [id, share] of Object.entries(shares)) {
    const text = edits[id];
    if (text === undefined) continue;
    const edited = changesInEdit(text);
    if (edited !== null) n += edited - share;
  }
  return n;
}

/**
 * What a refused withdraw means for the cards that name its draft.
 *
 * A 409 IS THREE DIFFERENT ANSWERS, and reading all of them as "already gone"
 * cleared cards that were still true:
 * - `override`: the village holds the power and this admin did not break the
 *   glass. Nothing about the draft changed, so every card stays.
 * - `published`: the draft went live. Its withdraw is gone, and the fields it
 *   left out are still true of what went live.
 * - `closed`: withdrawn by somebody else, or no such draft. Both cards go.
 *
 * Anything that is not a 409 is `other`, and the cards stay.
 */
export type WithdrawRefusal = "override" | "published" | "closed" | "other";

export function readWithdrawRefusal(status: number, body: unknown): WithdrawRefusal {
  if (status !== 409) return "other";
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (b.requiresOverride === true) return "override";
  return b.draftStatus === "published" ? "published" : "closed";
}
