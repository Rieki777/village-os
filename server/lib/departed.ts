/**
 * The one question every door that names a recipient asks: has this member
 * left? Moved here from server/lib/gratitude.ts, unchanged, so the ledger's
 * own preflight (server/lib/economy.ts) can ask it too: gratitude.ts imports
 * economy.ts, and the other way round would be a cycle.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { isTombstone } from "./oauthAccounts";
import { isTombstoneId } from "../repos/users";

/**
 * NOTHING IS SENT TO A MEMBER WHO HAS LEFT.
 *
 * An erased member's row stays, as "A departed member" at
 * `deleted-<id>@anonymized.invalid`, so history keeps somebody to point at.
 * Every door that pays a recipient a member names looked that row up by
 * address or by id and refused only the standing examples, so typing the
 * address, or hearting a departed member's old post, issued tokens into an
 * account nobody holds: the sender's allowance or balance spent, and
 * Gratitude, the voting-weight token by default, piling up in the name of
 * somebody who is gone.
 *
 * The doors that name a recipient ask this one question: `sendGratitude`
 * (server/lib/gratitude.ts, the wall and forum hearts), and in server/index.ts
 * the Hearts give (`POST /api/gratitude`), member sends (`POST /api/wallet/send`)
 * and the map contact relay (`POST /api/map/contact`, round 4, finding 7: it
 * stored the sender's words for nobody and mailed an @anonymized.invalid
 * address). The admin hand-mint asks it through `mintRecipientRefusal`
 * (server/lib/gratitude.ts).
 *
 * NOR IS WORK THEY DID BEFORE LEAVING PAID INTO THEIR TOMBSTONE (round 4,
 * finding 3). A claim they submitted, a proposal they sent and an item they
 * donated all outlive them, and a steward who signed one later paid the
 * tombstone's account and wrote cash owed to nobody. `departedById` below is
 * asked by every one of those payers: `owedPreflight` (server/lib/economy.ts),
 * so no owed row posts, on the consent's settle, the /review press or a retry;
 * `owe` (server/lib/cashOwed.ts), the one writer of `cash_owed`; the quest
 * consent route (server/routes/questClaims.ts), which answers 409 and tells the
 * steward to decline; `applyAcceptReward` (server/lib/proposalAward.ts); and
 * the library intake (server/lib/library.ts), which records no new intake for
 * them and signs a waiting one with no award.
 */
export const DEPARTED_RECIPIENT = "That member has left the village, so nothing can be sent to them.";

export function departedRecipient(member: { email?: unknown } | null | undefined): boolean {
  return !!member && isTombstone({ email: String(member.email ?? "") });
}

/** The same question asked by id, on the caller's connection, for the payers that hold only an id. */
export async function departedById(db: Pool | PoolConnection, userId: string): Promise<boolean> {
  return isTombstoneId(db, String(userId ?? ""));
}
