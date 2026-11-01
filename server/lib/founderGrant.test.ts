/**
 * The founder grant is the only thing standing between "I signed in" and "I can
 * name my village", so the interesting tests here are the refusals rather than
 * the happy path. Each one is a way a village could be handed to the wrong
 * person, or taken from the right one.
 */
import { describe, expect, it } from "vitest";
import { decideFounderGrant, parseFounderEmails } from "./founderGrant";

const LIST = parseFounderEmails("founder@example.com, second@example.com");

function decide(over: Partial<Parameters<typeof decideFounderGrant>[0]> = {}) {
  return decideFounderGrant({
    email: "founder@example.com",
    emailVerified: true,
    currentRole: "member",
    founderEmails: LIST,
    ...over,
  });
}

describe("parsing FOUNDER_EMAILS", () => {
  it("tolerates the whitespace and casing an operator will actually paste", () => {
    const set = parseFounderEmails("  Founder@Example.com ,SECOND@example.com,  ");
    expect(set.has("founder@example.com")).toBe(true);
    expect(set.has("second@example.com")).toBe(true);
    // A trailing comma must not produce an empty entry that matches "".
    expect(set.has("")).toBe(false);
    expect(set.size).toBe(2);
  });

  it("is empty for unset, blank and comma-only values", () => {
    for (const raw of [undefined, null, "", "   ", ",", " , , "]) {
      expect(parseFounderEmails(raw).size).toBe(0);
    }
  });
});

describe("granting the founder role", () => {
  it("grants when a verified listed address holds no founder role", () => {
    const d = decide();
    expect(d.grant).toBe(true);
    expect(d.reason).toMatch(/FOUNDER_EMAILS/);
  });

  it("heals a role that went missing, which is the case that started this", () => {
    // A restore from backup, a bad migration, or a hand-edit. Signing in again
    // is the recovery, with no shell and no shared password.
    expect(decide({ currentRole: null }).grant).toBe(true);
    expect(decide({ currentRole: "" }).grant).toBe(true);
    expect(decide({ currentRole: undefined }).grant).toBe(true);
  });

  it("REFUSES an unverified address even though the callback should never send one", () => {
    // Defence in depth. If the email_verified check upstream is ever relaxed,
    // this must not become the way an attacker takes a village.
    const d = decide({ emailVerified: false });
    expect(d.grant).toBe(false);
    expect(d.reason).toMatch(/did not verify/);
  });

  it("refuses an address that is not on the list", () => {
    expect(decide({ email: "stranger@example.com" }).grant).toBe(false);
  });

  it("refuses everything when FOUNDER_EMAILS is unset", () => {
    // The default state of every fresh village. A blank list must never mean
    // "anyone", which is the empty-versus-zero confusion this codebase has
    // already been burned by once.
    const d = decide({ founderEmails: parseFounderEmails("") });
    expect(d.grant).toBe(false);
    expect(d.reason).toMatch(/not set/);
  });

  it("never elevates a standing example identity", () => {
    expect(decide({ isExample: true }).grant).toBe(false);
  });

  it("writes nothing when the role is already held", () => {
    // Idempotence matters: this runs on EVERY matching sign-in, and a write
    // per sign-in would be a pointless audit row per sign-in.
    for (const role of ["founder", "admin"]) {
      const d = decide({ currentRole: role });
      expect(d.grant).toBe(false);
      expect(d.reason).toMatch(/already holds/);
    }
  });

  it("only ever raises, so removing an address cannot demote a working founder", () => {
    // An operator's typo in FOUNDER_EMAILS must not be able to lock a village
    // out of itself. Demotion stays a deliberate act on the admin surface.
    const d = decideFounderGrant({
      email: "founder@example.com",
      emailVerified: true,
      currentRole: "founder",
      founderEmails: parseFounderEmails(""),
    });
    expect(d.grant).toBe(false);
  });

  it("matches case-insensitively, because Google returns what the user typed", () => {
    expect(decide({ email: "FOUNDER@Example.COM" }).grant).toBe(true);
    expect(decide({ email: "  founder@example.com  " }).grant).toBe(true);
  });

  it("gives a different reason for each refusal", () => {
    // A lockout is debuggable only if "nothing happened" says which nothing.
    const reasons = new Set([
      decide({ founderEmails: parseFounderEmails("") }).reason,
      decide({ emailVerified: false }).reason,
      decide({ isExample: true }).reason,
      decide({ email: "stranger@example.com" }).reason,
      decide({ currentRole: "founder" }).reason,
    ]);
    expect(reasons.size).toBe(5);
  });
});
