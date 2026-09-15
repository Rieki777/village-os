/**
 * The presence predicate, as assertions. Each exclusion is tested beside the
 * acceptance it would otherwise be indistinguishable from, because the defect
 * this replaces was exactly that: an empty password hash read the same for a
 * Google member, an unclaimed founder and a tombstone.
 *
 * The route-level proof, a Google member on a real ballot's frozen roll, is
 * server/googleMemberVote.routes.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { ADMISSION_RUNG, climbLadder, isAdmitted } from "./admission";
import { makeGoogleLink } from "./oauthAccounts";
import { hasWorkingCredential, isPresentMember, presenceTest } from "./memberPresence";

const SECRET = "a-test-signing-secret";

/** The exact record server/routes/authGoogle.ts writes for a new Google member. */
const googleMember = (id = "user-google") => ({
  id,
  name: "A Newcomer",
  email: "newcomer@example.com",
  passwordHash: "",
  prefs: { googleLink: makeGoogleLink(SECRET, id, "google-sub-1") },
});

describe("who is present", () => {
  it("a member with a password is present", () => {
    expect(isPresentMember({ id: "u1", email: "a@example.com", passwordHash: "bcrypt-hash", prefs: {} }, SECRET)).toBe(true);
  });

  it("A MEMBER WHO JOINED THROUGH GOOGLE IS PRESENT, with an empty password hash", () => {
    expect(isPresentMember(googleMember(), SECRET)).toBe(true);
  });

  it("a member with both credentials is present", () => {
    expect(isPresentMember({ ...googleMember(), passwordHash: "bcrypt-hash" }, SECRET)).toBe(true);
  });

  it("the old filter is the defect: it reads the Google member as nobody", () => {
    // Pinned so the reason for this module cannot quietly come back. A bare
    // truthiness check on the hash is what every roll used, and it is false
    // for exactly the record authGoogle.ts creates.
    const legacyFilter = (u: { passwordHash?: string }) => !!u.passwordHash;
    expect(legacyFilter(googleMember())).toBe(false);
    expect(isPresentMember(googleMember(), SECRET)).toBe(true);
  });
});

describe("who is not", () => {
  it("an UNCLAIMED account: bootstrap's founder before the claim link is used", () => {
    // server/index.ts, POST /api/admin/bootstrap: empty hash, no prefs at all.
    const unclaimed = { id: "usr-founder", email: "founder@example.com", passwordHash: "", role: "founder" };
    expect(isPresentMember(unclaimed, SECRET)).toBe(false);
    expect(isPresentMember({ ...unclaimed, prefs: {} }, SECRET)).toBe(false);
  });

  it("a FORGED link: a member who wrote prefs.googleLink by hand", () => {
    const forged = { ...googleMember(), prefs: { googleLink: { sub: "google-sub-1", linkedAt: "2026-09-14T00:00:00.000Z", sig: "not-a-signature" } } };
    expect(isPresentMember(forged, SECRET)).toBe(false);
  });

  it("a COPIED link: a valid link signed for a different member id", () => {
    const copied = { ...googleMember("user-other"), prefs: googleMember("user-google").prefs };
    expect(isPresentMember(copied, SECRET)).toBe(false);
  });

  it("a link signed under a different secret", () => {
    expect(isPresentMember(googleMember(), "some-other-secret")).toBe(false);
  });

  it("a TOMBSTONE, in the exact shape erasure's tombstone step leaves", () => {
    // server/lib/erasure.ts: address rewritten, hash cleared, prefs emptied.
    const tomb = { id: "user-gone", email: "deleted-user-gone@anonymized.invalid", passwordHash: "", prefs: {} };
    expect(isPresentMember(tomb, SECRET)).toBe(false);
  });

  it("a tombstone address refuses on its own, even if a hash or a link survived", () => {
    const partial = {
      ...googleMember("user-gone"),
      email: "deleted-user-gone@anonymized.invalid",
      passwordHash: "stale-hash",
    };
    expect(isPresentMember(partial, SECRET)).toBe(false);
  });

  it("an example identity, even holding a valid link", () => {
    expect(isPresentMember({ ...googleMember(), isExample: true }, SECRET)).toBe(false);
    expect(isPresentMember({ ...googleMember(), isExample: 1 }, SECRET)).toBe(false);
  });

  it("nothing, and a record with no id", () => {
    expect(isPresentMember(null, SECRET)).toBe(false);
    expect(isPresentMember(undefined, SECRET)).toBe(false);
    expect(isPresentMember({ ...googleMember(), id: "" }, SECRET)).toBe(false);
  });
});

describe("presence is not admission (server/lib/admission.ts)", () => {
  const stages = GAME_CONFIG.stages;
  const door = stages.findIndex((s) => s.id === ADMISSION_RUNG);

  it("a present Google member who was never admitted stands no higher than Member, whatever rules they meet", () => {
    // Present: on the candidate pool for a roll. Not admitted: no membership
    // grant and no stage grant. Every rung's own rule answered yes, the worst
    // case, and the door still holds, because nothing in it reads a credential.
    // The two admission fields as a fresh Google member's row carries them.
    const gina = { ...googleMember(), stageGranted: null, membershipGranted: false };
    expect(door).toBeGreaterThan(0);
    expect(isPresentMember(gina, SECRET)).toBe(true);
    expect(isAdmitted(gina, stages)).toBe(false);
    const rung = climbLadder(stages, gina, () => true);
    expect(stages.findIndex((s) => s.id === rung)).toBeLessThanOrEqual(door);
  });

  it("admission is what lifts them past the door, and a credential never does", () => {
    const admitted = { ...googleMember(), membershipGranted: true };
    expect(isAdmitted(admitted, stages)).toBe(true);
    const rung = climbLadder(stages, admitted, () => true);
    expect(stages.findIndex((s) => s.id === rung)).toBeGreaterThan(door);
    // And a password changes nothing about the door either.
    const withPassword = { ...googleMember(), passwordHash: "bcrypt-hash", stageGranted: null, membershipGranted: false };
    expect(stages.findIndex((s) => s.id === climbLadder(stages, withPassword, () => true))).toBeLessThanOrEqual(door);
  });
});

describe("the pieces", () => {
  it("hasWorkingCredential does not treat a non-string hash as a password", () => {
    expect(hasWorkingCredential({ id: "u1", passwordHash: 1 as unknown as string }, SECRET)).toBe(false);
  });

  it("presenceTest binds the secret and answers the same", () => {
    const isPresent = presenceTest(SECRET);
    expect(isPresent(googleMember())).toBe(true);
    expect(isPresent({ id: "usr-founder", email: "f@example.com", passwordHash: "" })).toBe(false);
  });
});
