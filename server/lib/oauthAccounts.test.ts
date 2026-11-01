/**
 * The account-linking policy and the recovery rule, as assertions.
 *
 * These two decide who a Google sign-in becomes and who may be posted a
 * set-password link. Both are places where getting it wrong hands somebody
 * else's village away, so each refusal is tested beside the acceptance it
 * would otherwise be indistinguishable from.
 */
import { describe, expect, it } from "vitest";
import {
  type AccountFacts,
  decideGoogleSignIn,
  isTombstone,
  isUnclaimable,
  makeGoogleLink,
  maySendSetPasswordLink,
  readGoogleLink,
} from "./oauthAccounts";

const SECRET = "a-test-signing-secret";

const member = (over: Partial<AccountFacts> = {}): AccountFacts => ({
  id: "user-1",
  email: "founder@example.com",
  name: "A Founder",
  passwordHash: "bcrypt-hash",
  ...over,
});

describe("the stored link is signed, so the storage medium is untrusted", () => {
  it("reads back a link this server wrote", () => {
    const m = member({ prefs: {} });
    m.prefs.googleLink = makeGoogleLink(SECRET, m.id, "sub-123");
    expect(readGoogleLink(SECRET, m as any)).toBe("sub-123");
  });

  it("REFUSES a link somebody wrote by hand", () => {
    // The attack: a future change to PUT /api/profile/prefs that spreads the
    // request body over the top level would otherwise let any member write
    // `googleLink.sub` and claim the Google identity of anyone they chose.
    const m = member({ prefs: { googleLink: { sub: "victims-sub", linkedAt: new Date().toISOString(), sig: "made-up" } } });
    expect(readGoogleLink(SECRET, m as any)).toBeNull();
  });

  it("refuses a link lifted from a DIFFERENT member's record", () => {
    // The signature covers the member id, so a valid record copied onto
    // another account stops verifying.
    const link = makeGoogleLink(SECRET, "user-1", "sub-123");
    const other = member({ id: "user-2", prefs: { googleLink: link } });
    expect(readGoogleLink(SECRET, member({ prefs: { googleLink: link } }) as any)).toBe("sub-123"); // control
    expect(readGoogleLink(SECRET, other as any)).toBeNull();
  });

  it("refuses a link whose subject was edited after signing", () => {
    const link = makeGoogleLink(SECRET, "user-1", "sub-123");
    const tampered = { ...link, sub: "sub-999" };
    expect(readGoogleLink(SECRET, member({ prefs: { googleLink: tampered } }) as any)).toBeNull();
  });

  it("refuses a link signed with another secret", () => {
    const m = member({ prefs: { googleLink: makeGoogleLink("some-other-secret", "user-1", "sub-123") } });
    expect(readGoogleLink(SECRET, m as any)).toBeNull();
  });

  it("returns null for every shape of absence", () => {
    expect(readGoogleLink(SECRET, null)).toBeNull();
    expect(readGoogleLink(SECRET, member({ prefs: {} }) as any)).toBeNull();
    expect(readGoogleLink(SECRET, member({ prefs: { googleLink: "a string" } }) as any)).toBeNull();
    expect(readGoogleLink(SECRET, member({ prefs: { googleLink: {} } }) as any)).toBeNull();
  });
});

describe("accounts that can never be signed into", () => {
  it("knows a tombstone by the address the retirement path writes", () => {
    expect(isTombstone({ email: "deleted-user-9@anonymized.invalid" })).toBe(true);
    expect(isTombstone({ email: "founder@example.com" })).toBe(false);
  });

  it("counts an example identity and a tombstone as unclaimable, and a real member as not", () => {
    expect(isUnclaimable(member({ isExample: true }))).toBe(true);
    expect(isUnclaimable(member({ email: "deleted-x@anonymized.invalid" }))).toBe(true);
    expect(isUnclaimable(member())).toBe(false);
  });
});

describe("decideGoogleSignIn", () => {
  const base = { sub: "sub-123", existingLinkOnEmailMatch: null };

  it("signs in the account that already carries this Google subject", () => {
    const d = decideGoogleSignIn({ ...base, bySub: member({ id: "user-9" }), byEmail: null });
    expect(d).toEqual({ kind: "sign_in", userId: "user-9" });
  });

  it("follows the SUBJECT even when the address has changed at Google", () => {
    // A member who changed their Google address keeps their village account.
    // byEmail is not consulted at all once a subject matches.
    const d = decideGoogleSignIn({
      ...base,
      bySub: member({ id: "user-9", email: "old@example.com" }),
      byEmail: member({ id: "user-other" }),
    });
    expect(d).toEqual({ kind: "sign_in", userId: "user-9" });
  });

  it("LINKS a verified address to an existing password account", () => {
    // The defence: whoever holds this mailbox can already take the account by
    // asking for a password reset, so linking grants nothing new.
    const d = decideGoogleSignIn({ ...base, bySub: null, byEmail: member({ id: "user-1" }) });
    expect(d).toEqual({ kind: "link", userId: "user-1" });
  });

  it("LINKS an account that has NO password, which is the locked-out founder", () => {
    const d = decideGoogleSignIn({ ...base, bySub: null, byEmail: member({ id: "founder-1", passwordHash: "" }) });
    expect(d).toEqual({ kind: "link", userId: "founder-1" });
  });

  it("refuses to attach a SECOND Google account to a member already linked", () => {
    const d = decideGoogleSignIn({
      ...base,
      bySub: null,
      byEmail: member({ id: "user-1" }),
      existingLinkOnEmailMatch: "a-different-sub",
    });
    expect(d).toEqual({ kind: "refuse", reason: "already_linked_elsewhere" });
  });

  it("is idempotent when the existing link is already this subject", () => {
    const d = decideGoogleSignIn({
      ...base,
      bySub: null,
      byEmail: member({ id: "user-1" }),
      existingLinkOnEmailMatch: "sub-123",
    });
    expect(d).toEqual({ kind: "link", userId: "user-1" });
  });

  it("refuses an example identity and a tombstone by either route", () => {
    expect(decideGoogleSignIn({ ...base, bySub: null, byEmail: member({ isExample: true }) })).toEqual({
      kind: "refuse",
      reason: "account_unavailable",
    });
    expect(
      decideGoogleSignIn({ ...base, bySub: member({ email: "deleted-1@anonymized.invalid" }), byEmail: null }),
    ).toEqual({ kind: "refuse", reason: "account_unavailable" });
  });

  it("creates when nothing matches", () => {
    expect(decideGoogleSignIn({ ...base, bySub: null, byEmail: null })).toEqual({ kind: "create" });
  });
});

describe("maySendSetPasswordLink is the fix for the silent forgot-password", () => {
  it("sends a RESET to an ordinary member", () => {
    expect(maySendSetPasswordLink(member())).toEqual({ send: true, kind: "reset" });
  });

  it("sends a CLAIM to an account that never set a password, which used to get nothing", () => {
    // The whole bug: `if (user?.passwordHash)` answered success and sent no
    // email, on every attempt, forever. The founder of the live deployment is
    // in this state.
    expect(maySendSetPasswordLink(member({ passwordHash: "" }))).toEqual({ send: true, kind: "claim" });
  });

  it("treats a missing hash the same as an empty one", () => {
    expect(maySendSetPasswordLink(member({ passwordHash: undefined }))).toEqual({ send: true, kind: "claim" });
  });

  it("sends nothing for an unknown address", () => {
    expect(maySendSetPasswordLink(null)).toEqual({ send: false, reason: "no_such_account" });
  });

  it("sends nothing to a standing example identity", () => {
    // These carry fixed, published addresses and an empty password hash. A
    // rule that read "no password, so let them claim one" would hand an
    // example identity to the first stranger who typed the address in.
    expect(maySendSetPasswordLink(member({ isExample: true, passwordHash: "" }))).toEqual({
      send: false,
      reason: "example_identity",
    });
  });

  it("sends nothing to a tombstone", () => {
    expect(maySendSetPasswordLink(member({ email: "deleted-7@anonymized.invalid", passwordHash: "" }))).toEqual({
      send: false,
      reason: "tombstone",
    });
  });

  it("decides what to SEND and never what to answer", () => {
    // The account-enumeration defence lives in the route, which returns one
    // identical body for every verdict below. This asserts the shape that
    // makes that possible: no verdict carries a message.
    const verdicts = [
      maySendSetPasswordLink(null),
      maySendSetPasswordLink(member()),
      maySendSetPasswordLink(member({ passwordHash: "" })),
      maySendSetPasswordLink(member({ isExample: true })),
    ];
    for (const v of verdicts) expect(v).not.toHaveProperty("message");
  });
});
