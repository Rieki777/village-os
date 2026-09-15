/**
 * Is this account a present person: the ONE predicate for every roll, roster
 * and recipient list that means "a member who is here".
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────
 *
 * Every such list used to filter on a truthy `passwordHash`, and `buildElectorate`
 * wrote down why: erasure clears the hash, so a departed member drops out of
 * every roll built afterwards. True, and incomplete. A member who joins
 * through Google is created with `passwordHash: ""` on purpose
 * (server/routes/authGoogle.ts: sign-in is by Google until they choose to set
 * one), so every one of them was silently left off every ballot's frozen
 * electorate, off the weight allocation table, out of the people search, and
 * out of every notification email. An empty hash was being read as "not a
 * person" when it only ever meant "no password".
 *
 * ── WHAT PRESENT MEANS, AS POSITIVE FACTS ───────────────────────────────────
 *
 *  1. Not a standing example identity (`isExampleUser`). Content, never people.
 *  2. Not a tombstone (`isTombstone`). Erasure's tombstone step
 *     (server/lib/erasure.ts) rewrites the address to `@anonymized.invalid`,
 *     clears the hash AND empties `prefs`, so the Google link goes with it and
 *     a departed member fails fact 3 as well. The address check stands on its
 *     own anyway, so a tombstone is refused even if some later change forgot
 *     one of those writes.
 *  3. At least one WORKING credential: a password hash, or a Google link that
 *     verifies. The link is read through `readGoogleLink`, the same HMAC check
 *     the sign-in callback uses, so a hand-written or copied `prefs.googleLink`
 *     counts for nothing here exactly as it counts for nothing at the door.
 *
 * What is left out by fact 3, deliberately: an UNCLAIMED account. Founder
 * bootstrap (`POST /api/admin/bootstrap`) creates the founder with an empty
 * hash and no link, and nobody is behind it until the claim link is used.
 * There is no separate invite account: an invitation creates no member record
 * until somebody registers or signs in. So "unclaimed" is exactly "no hash and
 * no verified link".
 *
 * ── THE SECRET ──────────────────────────────────────────────────────────────
 *
 * The link is signed with the session secret, so this needs it, and the lib
 * spines are handed a bound `isPresent` by the host rather than the secret
 * itself. One consequence is shared with sign-in and is not new: a deployment
 * with no `AUTH_TOKEN_SECRET` set mints a random one per boot, so after a
 * restart a Google-only member is neither recognised at the door nor counted
 * here until they sign in again and the link is rewritten.
 */
import { isExampleUser } from "./examples";
import { isTombstone, readGoogleLink } from "./oauthAccounts";

/** The member fields this decision reads. Any member record satisfies it. */
export interface PresenceFacts {
  id?: unknown;
  email?: unknown;
  passwordHash?: unknown;
  isExample?: unknown;
  prefs?: any;
}

/** The predicate with the secret already bound, as the host hands it to a module. */
export type PresenceTest = (member: PresenceFacts | null | undefined) => boolean;

/** A password hash, or a Google link this server signed for THIS member id. */
export function hasWorkingCredential(member: PresenceFacts, authSecret: string): boolean {
  if (typeof member.passwordHash === "string" && member.passwordHash !== "") return true;
  return readGoogleLink(authSecret, { id: String(member.id ?? ""), prefs: member.prefs }) !== null;
}

/** See the header. False for null, for a record with no id, and for every exclusion above. */
export function isPresentMember(member: PresenceFacts | null | undefined, authSecret: string): boolean {
  if (!member || String(member.id ?? "") === "") return false;
  if (isExampleUser(member as Record<string, any>)) return false;
  if (isTombstone({ email: String(member.email ?? "") })) return false;
  return hasWorkingCredential(member, authSecret);
}

/** Bind the secret once, for a deps object. */
export function presenceTest(authSecret: string): PresenceTest {
  return (member) => isPresentMember(member, authSecret);
}
