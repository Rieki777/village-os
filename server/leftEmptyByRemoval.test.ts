/**
 * WHAT ONE REMOVAL WOULD LEAVE WITH NOBODY (Rye, 2026-10-23).
 *
 * The Power groups tab asks before it takes anybody out of a group, and when
 * the removal would leave a power the village has taken on with no holder at
 * all, it says so before the admin confirms. The panel reads this answer and
 * never re-derives it, so a wrong answer here is a wrong sentence there, in
 * either direction: a missed warning is how a village loses its only steward
 * by accident, and a false one teaches an admin to click past the true ones.
 *
 * Every case is a holding shape the live tab can show. The counting rule is
 * `liveHoldersOfCapability`, whose own suite (server/liveHolders.test.ts)
 * holds it to the gate; this file holds the removal arithmetic on top of it.
 */
import { describe, expect, it } from "vitest";
import { leftEmptyByRemoval } from "./lib/roleGrants";
import { leftEmptyByRemovalNow, type HolderReads } from "./lib/holdersNow";

const SEAT = "org.seat";
const VETO = "steward.veto";

const ROLES = [
  { id: "steward-circle", capabilities: [SEAT, "proposal.decide"] },
  { id: "founders-circle", capabilities: [SEAT] },
  { id: "gardeners", capabilities: [] as string[] },
  { id: "vouchers", capabilities: ["member.superVouch"] },
];

const NOW = new Date("2026-10-23T12:00:00.000Z");
const PAST = "2026-09-01T00:00:00.000Z";
const LATER = "2026-12-21T00:00:00.000Z";

const row = (roleId: string, userId: string, termEndsAt: string | null = null) => ({ roleId, userId, termEndsAt });

describe("what taking one person out of one group would leave with nobody", () => {
  it("names the power when the only holder leaves the only group carrying it", () => {
    const out = leftEmptyByRemoval([row("steward-circle", "ana")], ROLES, [SEAT], NOW);
    expect(out).toEqual({ "steward-circle": { ana: [SEAT] } });
  });

  it("says nothing while somebody else in the group still holds it", () => {
    const out = leftEmptyByRemoval([row("steward-circle", "ana"), row("steward-circle", "ben")], ROLES, [SEAT], NOW);
    expect(out).toEqual({});
  });

  it("says nothing while somebody in ANOTHER group carrying the power still holds it", () => {
    const out = leftEmptyByRemoval([row("steward-circle", "ana"), row("founders-circle", "ben")], ROLES, [SEAT], NOW);
    expect(out).toEqual({});
  });

  it("says nothing when the same person keeps the power through a second group", () => {
    // Taking them out of one still leaves them holding it through the other,
    // and taking them out of the other does the same. Neither removal empties it.
    const out = leftEmptyByRemoval([row("steward-circle", "ana"), row("founders-circle", "ana")], ROLES, [SEAT], NOW);
    expect(out).toEqual({});
  });

  it("counts a lapsed term as nobody, the way the gate does", () => {
    // Ben's term ran out, so Ana is the only live holder and removing Ana empties it.
    const lapsedBeside = leftEmptyByRemoval(
      [row("steward-circle", "ana", LATER), row("steward-circle", "ben", PAST)],
      ROLES, [SEAT], NOW,
    );
    expect(lapsedBeside).toEqual({ "steward-circle": { ana: [SEAT] } });
    // A power whose only holding has lapsed has nobody already, so no removal is what empties it.
    expect(leftEmptyByRemoval([row("steward-circle", "ana", PAST)], ROLES, [SEAT], NOW)).toEqual({});
  });

  it("says nothing when a badge keeps the same person holding the power", () => {
    const out = leftEmptyByRemoval([row("steward-circle", "ana")], ROLES, ["proposal.decide"], NOW, {
      ana: { grants: ["proposal.decide"] },
    });
    expect(out).toEqual({});
  });

  it("names the power when a warning badge has already taken it from everybody else", () => {
    const out = leftEmptyByRemoval(
      [row("steward-circle", "ana"), row("steward-circle", "ben")],
      ROLES, ["proposal.decide"], NOW,
      { ben: { denies: ["proposal.decide"] } },
    );
    expect(out).toEqual({ "steward-circle": { ana: ["proposal.decide"] } });
  });

  it("follows a greater key that carries the power", () => {
    // member.superVouch carries member.vouch, so the vouchers group holds member.vouch.
    const out = leftEmptyByRemoval([row("vouchers", "ana")], ROLES, ["member.vouch"], NOW);
    expect(out).toEqual({ vouchers: { ana: ["member.vouch"] } });
  });

  it("never names a group that does not give the person the power", () => {
    const out = leftEmptyByRemoval([row("steward-circle", "ana"), row("gardeners", "ana")], ROLES, [SEAT], NOW);
    expect(out).toEqual({ "steward-circle": { ana: [SEAT] } });
  });

  it("lists every power the one removal would empty", () => {
    const out = leftEmptyByRemoval([row("steward-circle", "ana")], ROLES, [SEAT, "proposal.decide", VETO], NOW);
    expect(out["steward-circle"].ana.sort()).toEqual(["org.seat", "proposal.decide"]);
  });
});

describe("the wire the holding route calls", () => {
  const reads = (holders: any[], badgeRows: unknown[] = []): HolderReads => ({
    badgesLive: () => true,
    dormantBadgeIds: async () => [],
    badgeRows: async () => badgeRows,
    roleHolders: () => holders,
    roles: () => ROLES,
  });

  it("leaves out a key a stage unlocks, because members at that stage still hold it", async () => {
    // member.vouch opens at Contributor by default, so a count that cannot see
    // the stage plane must not claim nobody holds it.
    const out = await leftEmptyByRemovalNow(reads([row("vouchers", "ana")]), ["member.vouch"], {});
    expect(out).toEqual({});
  });

  it("keeps a stage key in when the village set its rung to none", async () => {
    const out = await leftEmptyByRemovalNow(reads([row("vouchers", "ana")]), ["member.vouch"], { "member.vouch": "none" });
    expect(out).toEqual({ vouchers: { ana: ["member.vouch"] } });
  });

  it("reads badge rows the way the gate does, stored lists and all", async () => {
    const out = await leftEmptyByRemovalNow(
      reads([row("steward-circle", "ana")], [{ user_id: "ana", badge_id: "b1", capabilities: JSON.stringify([SEAT]), denies: "[]" }]),
      [SEAT],
      {},
    );
    expect(out).toEqual({});
  });

  it("answers for every holding at once, from one call", async () => {
    const out = await leftEmptyByRemovalNow(
      reads([row("steward-circle", "ana"), row("founders-circle", "ben")]),
      [SEAT, "proposal.decide"],
      {},
    );
    expect(out).toEqual({ "steward-circle": { ana: ["proposal.decide"] } });
  });
});
