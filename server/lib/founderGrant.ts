/**
 * How a founder gets to be a founder, on a village that has none and on one
 * that has lost track of the one it had.
 *
 * WHY THIS EXISTS. Google sign-in gets a person INTO a village. It does not
 * make them anything in particular, and the role is what actually matters: a
 * founder who signs in successfully and lands as an ordinary member still
 * cannot name their village, and from their side that is indistinguishable
 * from being locked out. That is the state this deployment's own founder was
 * in when he asked for OAuth: signing in was never going to be enough on its
 * own.
 *
 * The existing answer, `POST /api/admin/bootstrap`, needs the deployment's
 * ADMIN_PASSWORD and refuses outright once any founder exists. It is the right
 * tool for a village's first minute and the wrong one for every minute after,
 * which is why a founder who loses their account has nothing to reach for.
 *
 * THE TRUST ANCHOR. `FOUNDER_EMAILS` is an environment variable, so the person
 * who controls the deployment decides who founds it. That is the same anchor
 * ADMIN_PASSWORD already uses and no weaker: anyone who can read or write that
 * variable can already read the database credentials sitting beside it.
 *
 * WHAT MAKES IT SAFE. The grant runs only on a sign-in whose email address
 * Google verified. `identityFromClaims` refuses `email_verified !== true`
 * before any account is looked up (server/lib/oauthGoogle.ts:301), so an
 * attacker cannot register a Google account claiming a founder's address and
 * collect the role. That refusal is load-bearing for this file. If it is ever
 * relaxed, this grant becomes a way to hand a village to a stranger.
 *
 * WHAT IT DELIBERATELY WILL NOT DO. It only ever raises a role, never lowers
 * one, so removing an address from the list cannot silently demote a working
 * founder and an operator's typo cannot lock a village out of itself.
 * Demotion stays a deliberate act through the admin surface.
 *
 * SELF-HEALING ON PURPOSE is the point rather than a side effect. It runs on
 * every matching sign-in, not once, so a role lost to a bad migration, a
 * restore from backup, or a hand-edit comes back the next time the founder
 * signs in. That is exactly the failure that started this.
 */

/** The roles this village treats as "can do anything". */
const FOUNDER_ROLES = new Set(["founder", "admin"]);

export interface FounderGrantDecision {
  /** True when the caller should write `role = "founder"` to this member. */
  grant: boolean;
  /**
   * Why, in a sentence fit for an audit row and a server log. Present on every
   * outcome, because "nothing happened" has several different causes here and
   * telling them apart is what makes a lockout debuggable.
   */
  reason: string;
}

/**
 * Parse FOUNDER_EMAILS into a comparable set.
 *
 * Comma separated, whitespace tolerated, case folded, empties dropped. An
 * operator pasting `a@b.com, c@d.com ` gets what they meant.
 */
export function parseFounderEmails(raw: string | undefined | null): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Should this sign-in be granted the founder role?
 *
 * Pure: no database, no Express, no environment read. The caller supplies the
 * facts and writes the consequence, which is what makes every branch here
 * testable without a server.
 */
export function decideFounderGrant(input: {
  /** The address Google verified. Callers MUST NOT pass an unverified one. */
  email: string;
  /** True only if the identity provider verified the address. */
  emailVerified: boolean;
  /** The member's role as it stands right now. */
  currentRole: string | null | undefined;
  /** Parsed FOUNDER_EMAILS. */
  founderEmails: Set<string>;
  /** Standing example identities can never sign in and must never be elevated. */
  isExample?: boolean;
}): FounderGrantDecision {
  if (input.founderEmails.size === 0) {
    return { grant: false, reason: "FOUNDER_EMAILS is not set on this deployment" };
  }
  // Defence in depth. The callback refuses unverified addresses long before
  // this runs, and this refuses them again, because the day someone relaxes
  // that check this file must not quietly become the way in.
  if (!input.emailVerified) {
    return { grant: false, reason: "the identity provider did not verify this address" };
  }
  if (input.isExample) {
    return { grant: false, reason: "standing example identities are never elevated" };
  }
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!email || !input.founderEmails.has(email)) {
    return { grant: false, reason: "this address is not in FOUNDER_EMAILS" };
  }
  if (FOUNDER_ROLES.has(String(input.currentRole ?? ""))) {
    return { grant: false, reason: "already holds the role, nothing to write" };
  }
  return { grant: true, reason: "address is in FOUNDER_EMAILS and the role was missing" };
}
