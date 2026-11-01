/**
 * Which account a Google sign-in is allowed to become, and who may be sent a
 * set-password link. The decisions, with no Express and no database, so the
 * security argument is a test.
 *
 * ── WHERE THE LINK IS STORED, AND WHY IT IS SIGNED ──────────────────────────
 *
 * The link lives at `prefs.googleLink` on the member record. `prefs` is an
 * existing JSON column the members repository already round-trips, so this
 * lane adds no migration and no new column. That choice has a cost and the
 * cost is paid here in full.
 *
 * The cost: `PUT /api/profile/prefs` lets a signed-in member write whatever
 * they like UNDER `prefs.notify`. Top-level keys are not member-writable
 * today, so `prefs.googleLink` is out of reach. Today. A single future edit to
 * that handler, of the shape `u.prefs = { ...u.prefs, ...req.body }`, would
 * turn a preferences change into whole-account takeover of anybody whose
 * Google subject the attacker could guess, and nothing in that diff would look
 * like an authentication change.
 *
 * So the stored value is NOT TRUSTED. Every link carries an HMAC over the
 * member id, the Google subject and the timestamp, keyed by the same secret
 * that signs session tokens, and `readGoogleLink` recomputes it on every
 * single read. A member who writes their own `prefs.googleLink` produces a
 * record that fails verification and is treated as absent. The storage medium
 * became untrusted input, which is what it always was.
 *
 * THE FOLLOW-UP THIS DOES NOT DO. A real `google_sub` column with a UNIQUE
 * index would additionally make "one Google account reaches at most one
 * member" a database invariant instead of a check made just before a write.
 * The residual gap is named under `decideGoogleSignIn`.
 */
import crypto from "node:crypto";
import { signTokenPayload } from "./memberTokens";

/** The shape written to `prefs.googleLink`. Read back through readGoogleLink, never directly. */
export interface GoogleLinkRecord {
  sub: string;
  linkedAt: string;
  sig: string;
}

function linkSignature(secret: string, userId: string, sub: string, linkedAt: string): string {
  return signTokenPayload(secret, `google-link:${userId}:${sub}:${linkedAt}`);
}

export function makeGoogleLink(
  secret: string,
  userId: string,
  sub: string,
  linkedAt: string = new Date().toISOString(),
): GoogleLinkRecord {
  return { sub, linkedAt, sig: linkSignature(secret, userId, sub, linkedAt) };
}

/**
 * The Google subject genuinely linked to this member, or null.
 *
 * Null covers every failure the same way: no record, a malformed record, and a
 * forged record. A caller cannot accidentally treat "somebody wrote a link
 * here" as "this member is linked".
 */
export function readGoogleLink(secret: string, member: { id: string; prefs?: any } | null): string | null {
  const raw = member?.prefs?.googleLink;
  if (!raw || typeof raw !== "object") return null;
  const sub = String(raw.sub ?? "");
  const linkedAt = String(raw.linkedAt ?? "");
  const sig = String(raw.sig ?? "");
  if (!sub || !linkedAt || !sig) return null;
  const expected = Buffer.from(linkSignature(secret, String(member!.id), sub, linkedAt));
  const provided = Buffer.from(sig);
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;
  return sub;
}

/** A member record, as far as these decisions are concerned. */
export interface AccountFacts {
  id: string;
  email: string;
  name?: string;
  passwordHash?: string;
  isExample?: boolean;
  prefs?: any;
}

/**
 * A tombstone: an account a member asked to be forgotten.
 *
 * The retirement path rewrites the address to `deleted-<id>@anonymized.invalid`
 * (server/index.ts, the anonymize step), so a lookup by any real address can
 * never return one. This test exists anyway, because "an attacker cannot guess
 * the address" is not a control, and because the same rule is needed by the
 * recovery route where the address is supplied by whoever is asking.
 */
export function isTombstone(member: Pick<AccountFacts, "email">): boolean {
  return String(member.email ?? "").toLowerCase().endsWith("@anonymized.invalid");
}

/**
 * An account that can never sign in, whatever it is asked.
 *
 * Standing example identities author example content and are not people. They
 * hold fixed, published addresses and an empty password hash, which is exactly
 * the shape a naive "has no password, so let them claim one" rule would hand
 * to the first stranger who typed the address in.
 */
export function isUnclaimable(member: AccountFacts): boolean {
  return member.isExample === true || isTombstone(member);
}

export type SignInDecision =
  | { kind: "sign_in"; userId: string }
  | { kind: "link"; userId: string }
  | { kind: "create" }
  | { kind: "refuse"; reason: string };

/**
 * The whole account-linking policy, in one function with no side effects.
 *
 * ── THE QUESTION THIS ANSWERS, AND THE DEFENCE ──────────────────────────────
 *
 * A Google sign-in arrives whose verified email matches an existing account
 * that has a password. Link, or refuse?
 *
 * LINK. The argument is not convenience, it is that refusing buys nothing.
 * Google has told us this person controls that mailbox
 * (`email_verified: true`, enforced in oauthGoogle.ts and a precondition of
 * calling this function). Anybody who controls that mailbox can already take
 * the account by asking for a password reset and clicking the link that
 * arrives. So linking grants no power that the mailbox did not already carry.
 * Refusing would lock real members out of accounts they own while leaving the
 * mailbox path exactly as open as it was.
 *
 * THAT ARGUMENT HAS A PRECONDITION, and this lane had to build it. The reset
 * path has to actually work for the account in question. For an account with
 * no password hash it did not: `forgot-password` sent nothing and answered
 * success, forever. That is fixed in the same change (see
 * `maySendSetPasswordLink`), which is what makes "the mailbox could already do
 * this" true for every account. Before that fix it held for most.
 *
 * WHAT IS REFUSED, and why each one:
 *
 *  - An account already linked to a DIFFERENT Google subject. Two Google
 *    accounts reaching one village account means either a stale link or an
 *    attempt to attach a second credential to somebody else's account. The
 *    member unlinks the old one first, deliberately, through a route that
 *    knows who they are.
 *  - An example identity or a tombstone. Neither is a person.
 *
 * MATCHING IS BY SUBJECT FIRST, EMAIL SECOND. Google's `sub` is the stable
 * identity and an email address is a mutable attribute of it. A member who
 * changes their Google address keeps their village account, because the
 * subject still matches. The email is consulted only when no account carries
 * this subject yet.
 *
 * THE RESIDUAL RACE, named here: two callbacks for the same new Google
 * subject arriving at the same instant both read "no account" and both
 * create one, leaving two member records for one Google identity. There is no
 * unique index behind `prefs.googleLink` to refuse the second. It needs a
 * double click at exactly the wrong millisecond, it degrades to a duplicate
 * account and never to a takeover, and the fix is the `google_sub` column
 * named at the top of this file.
 */
export function decideGoogleSignIn(input: {
  bySub: AccountFacts | null;
  byEmail: AccountFacts | null;
  /** The verified subject from the id_token. */
  sub: string;
  /** The verified link already on `byEmail`, read through readGoogleLink. */
  existingLinkOnEmailMatch: string | null;
}): SignInDecision {
  const { bySub, byEmail, sub, existingLinkOnEmailMatch } = input;

  if (bySub) {
    if (isUnclaimable(bySub)) return { kind: "refuse", reason: "account_unavailable" };
    return { kind: "sign_in", userId: bySub.id };
  }

  if (byEmail) {
    if (isUnclaimable(byEmail)) return { kind: "refuse", reason: "account_unavailable" };
    if (existingLinkOnEmailMatch && existingLinkOnEmailMatch !== sub) {
      return { kind: "refuse", reason: "already_linked_elsewhere" };
    }
    return { kind: "link", userId: byEmail.id };
  }

  return { kind: "create" };
}

export type RecoveryDecision =
  | { send: true; kind: "reset" | "claim" }
  | { send: false; reason: string };

/**
 * May this address be sent a set-password link, and which letter is it.
 *
 * ── THE BUG THIS REPLACES ───────────────────────────────────────────────────
 *
 * `POST /api/auth/forgot-password` guarded its whole body on
 * `if (user?.passwordHash)`. An account with no password hash therefore got
 * the cheerful "if an account exists, a link is on its way" answer and NO
 * EMAIL, on every attempt, forever. The comment beside it said bootstrap
 * covered that case. Bootstrap needs `ADMIN_PASSWORD` from the environment and
 * refuses outright once any founder exists, so for an ordinary member in that
 * state it covers nothing at all. The founder of the live deployment is in
 * exactly this state today.
 *
 * ── AN EMPTY STATE AND A REAL ZERO ARE DIFFERENT FACTS ──────────────────────
 *
 * Three different accounts have `passwordHash === ""`, and the old guard could
 * not tell them apart because falsiness is not a fact about any of them:
 *
 *   1. A member who never set one. A real person who must be able to recover.
 *   2. A standing example identity. Never a person, never signs in.
 *   3. A tombstone, a member who asked to be forgotten.
 *
 * So the rule is written on positive facts about each. Examples are marked
 * `isExample`. Tombstones carry a rewritten `@anonymized.invalid` address, and
 * are additionally unreachable by any real address anyone could type. What is
 * left is case 1, and case 1 gets a claim link.
 *
 * ── THE ENUMERATION DEFENCE IS UNCHANGED ────────────────────────────────────
 *
 * This function decides what to SEND, and never what to answer. The route
 * answers one identical 200 to every caller: unknown address, example,
 * tombstone, claim-pending and ordinary reset all read the same from outside.
 * The only thing that varies is which letter arrives in a mailbox, and the
 * only person who sees that is whoever controls the mailbox. Both properties
 * hold at once, which is why this returns a `kind` and not a message.
 */
export function maySendSetPasswordLink(member: AccountFacts | null): RecoveryDecision {
  if (!member) return { send: false, reason: "no_such_account" };
  if (member.isExample === true) return { send: false, reason: "example_identity" };
  if (isTombstone(member)) return { send: false, reason: "tombstone" };
  return { send: true, kind: member.passwordHash ? "reset" : "claim" };
}
