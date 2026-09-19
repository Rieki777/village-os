/**
 * The invitation's rules, decided without a database.
 *
 * The cases worth having are the ones where being wrong lets an account in
 * that nobody invited, or turns away somebody holding a good link.
 */
import { describe, expect, it } from "vitest";

import {
  INVITE_REFUSALS,
  daysLeft,
  hashInviteToken,
  invitePath,
  inviteStanding,
  mintInviteToken,
  readInviteToken,
} from "./invites";

describe("the token", () => {
  it("is long, URL-safe, and different every time", () => {
    const a = mintInviteToken();
    const b = mintInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("is kept only as a hash that the token alone reproduces", () => {
    const token = mintInviteToken();
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).not.toBe(hashInviteToken(mintInviteToken()));
    expect(hashInviteToken(token)).not.toContain(token);
  });

  it("reads a pasted token back, trimmed, and refuses anything that cannot be one of ours", () => {
    const token = mintInviteToken();
    expect(readInviteToken(`  ${token}\n`)).toBe(token);
    for (const junk of ["", "short", `${token}'; DROP TABLE users`, "a".repeat(65), null, undefined, 42]) {
      expect(readInviteToken(junk), `refuses ${JSON.stringify(junk)}`).toBeNull();
    }
  });

  it("travels in a link to the sign-up page", () => {
    const token = mintInviteToken();
    expect(invitePath(token)).toBe(`/register?invite=${token}`);
  });
});

describe("where a link stands", () => {
  const open = { usedAt: null, revokedAt: null, expired: false };

  it("is open only when nothing has happened to it", () => {
    expect(inviteStanding(open)).toBe("open");
  });

  it("says used before anything else, because that is what became of it", () => {
    expect(inviteStanding({ usedAt: new Date(), revokedAt: null, expired: true })).toBe("used");
  });

  it("says withdrawn before expired, so the person who withdrew it sees that they did", () => {
    expect(inviteStanding({ usedAt: null, revokedAt: new Date(), expired: true })).toBe("revoked");
    expect(inviteStanding({ ...open, expired: true })).toBe("expired");
  });

  it("has a sentence for every way a link can stop working", () => {
    for (const standing of ["used", "expired", "revoked", "unknown"] as const) {
      expect(INVITE_REFUSALS[standing].length, standing).toBeGreaterThan(20);
    }
  });
});

describe("days left", () => {
  it("rounds a part day up, and never reads below zero", () => {
    expect(daysLeft(14 * 86_400)).toBe(14);
    expect(daysLeft(86_400 + 1)).toBe(2);
    expect(daysLeft(1)).toBe(1);
    expect(daysLeft(0)).toBe(0);
    expect(daysLeft(-500)).toBe(0);
  });
});
