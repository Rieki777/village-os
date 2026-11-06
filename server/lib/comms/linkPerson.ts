/**
 * WHETHER THE PERSON A ONE-CLICK LINK NAMES IS STILL SOMEBODY THE VILLAGE HOLDS.
 *
 * A signed link (./links.ts) names its person by key (shared/comms/kinds.ts):
 * a member's user id, or `guest:<contactId>`. It keeps working for weeks: a
 * time vote's for 120 days, a recap answer's for 30, a next-gathering seat's
 * until that evening. Erasure (server/lib/erasure.ts) tombstones the account,
 * deletes every contact the person had, and deletes their votes, answers and
 * guest seats ONCE (`forgetCommsPerson`, server/repos/commsPeople.ts). A link
 * signed before that still verifies, so a press on it would write a fresh
 * vote, answer or seat for the person the village promised to forget, and a
 * time vote can move the gathering. Every door that WRITES for the person a
 * link names asks this first:
 *
 *   a member   stands while their account exists and is not a tombstone
 *   a guest    stands while their contact exists. Erasure and the idle sweep
 *              (`sweepIdleContacts`) are the only deletes. The sweep keeps any
 *              contact that a seat, a queue place, an attendance mark, a vote,
 *              an answer or an email on the ledger still names, and the guests
 *              these links reach hold a seat or a mark, so a contact the sweep
 *              took is one the village had already let go.
 *
 * A guest key matters for members too: the address somebody used as a guest
 * before they joined is linked to them, and erasure deletes it with them.
 *
 * A door that only GIVES BACK does not ask: "can't make it" and "give my place
 * back" free what the person held, which is what the village wants for
 * somebody who has left.
 *
 * Reads the database each time, never a cache: a link is pressed once, and the
 * tombstone may have landed a second before.
 */
import type { Pool } from "mysql2/promise";
import { contactIdOfGuestKey } from "../../../shared/comms/kinds";
import { contactById } from "../../repos/commsContacts";
import { isTombstone } from "../oauthAccounts";

export interface LinkPersonDeps {
  getPool(): Pool;
  /** Members by id. A tombstone is still returned; this file tells it apart. */
  members: { byId(id: string): Promise<any | null> };
}

/** What a refused press reads, the same at every door. `rsvp_next` said it first. */
export const LINK_PERSON_GONE = "Sign in to answer this gathering.";

/** True while the person `personKey` names is somebody the village still holds. */
export async function linkPersonStands(deps: LinkPersonDeps, personKey: string): Promise<boolean> {
  if (!personKey) return false;
  const contactId = contactIdOfGuestKey(personKey);
  if (contactId) return (await contactById(deps.getPool(), contactId)) !== null;
  const member = await deps.members.byId(personKey);
  return !!member && !isTombstone({ email: String(member.email ?? "") });
}
