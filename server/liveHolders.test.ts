/**
 * WHO HOLDS A POWER TODAY, counted the way the gate counts (2026-09-15).
 *
 * `liveHoldersOfCapability` exists because Rye's redemption rule is "a steward
 * confirms, but if there isn't a steward the village can vote on these things",
 * and org decide asks the same question. A counter that disagreed with the gate
 * would be the worst kind of wrong: the village would open a ballot while
 * somebody could have confirmed, or route to a steward nobody can act as.
 *
 * SO EVERY CASE HERE ASSERTS AGREEMENT rather than a number in isolation. The
 * expected answer is computed from `hasCapability` itself, on a context built
 * the way `capabilityCtx` builds one, so the day the gate's order changes this
 * file goes red instead of quietly describing the old order.
 *
 * The one deliberate DISAGREEMENT is the admin short-circuit, and it has its
 * own case: every admin passes every gate, so counting them would answer "somebody
 * holds it" in every village that has an administrator, which is all of them.
 * Rye's rule replaces the fall-through to admins, so the counter must exclude it.
 */
import { describe, expect, it } from "vitest";
import { hasCapability, type Capability, type CapabilityCtx } from "../shared/capabilities";
import { liveHoldersOfCapability } from "./lib/roleGrants";

const CONFIRM = "redemption.confirm" as Capability;

const ROLES = [
  { id: "steward-circle", capabilities: ["redemption.confirm"] },
  { id: "gardeners", capabilities: [] as string[] },
  { id: "vouchers", capabilities: ["member.superVouch"] },
];

const PAST = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-09-15T00:00:00.000Z");

/** The gate's own answer for one member, built the way `capabilityCtx` does. */
function gateSays(
  cap: Capability,
  member: { roleIds: string[]; grants?: string[]; denies?: string[]; isAdmin?: boolean },
): boolean {
  const roleCapabilities = ROLES.filter((r) => member.roleIds.includes(r.id)).flatMap((r) => r.capabilities);
  const ctx: CapabilityCtx = {
    stageIndex: 0,
    stageIndexOf: () => -1,
    roleCapabilities,
    badgeCapabilities: member.grants ?? [],
    badgeDenies: member.denies ?? [],
    isAdmin: member.isAdmin ?? false,
  };
  return hasCapability(cap, ctx);
}

describe("counting who can use a power", () => {
  it("counts somebody seated on a role that carries it", () => {
    const holders = [{ roleId: "steward-circle", userId: "wren", termEndsAt: null }];
    expect(liveHoldersOfCapability(holders, ROLES, CONFIRM, NOW)).toEqual(["wren"]);
    expect(gateSays(CONFIRM, { roleIds: ["steward-circle"] })).toBe(true);
  });

  it("does not count a holding whose term has run out", () => {
    // The founder's rule, 0171: "If they're not voted back in then they expire
    // when they expire." A lapsed seat grants nothing, so it counts as nobody.
    const holders = [{ roleId: "steward-circle", userId: "ash", termEndsAt: PAST }];
    expect(liveHoldersOfCapability(holders, ROLES, CONFIRM, NOW)).toEqual([]);
    // And the gate agrees, because `roleCapabilitiesFor` drops a lapsed role
    // before it builds the context: the member holds no role capabilities.
    expect(gateSays(CONFIRM, { roleIds: [] })).toBe(false);
  });

  it("counts a badge grant, the way the gate does", () => {
    const holders: Array<{ roleId: string; userId: string; termEndsAt: null }> = [];
    const badges = { sage: { grants: ["redemption.confirm"] } };
    expect(liveHoldersOfCapability(holders, ROLES, CONFIRM, NOW, badges)).toEqual(["sage"]);
    expect(gateSays(CONFIRM, { roleIds: [], grants: ["redemption.confirm"] })).toBe(true);
  });

  it("lets a warning badge's deny beat a role, the way the gate does", () => {
    const holders = [{ roleId: "steward-circle", userId: "wren", termEndsAt: null }];
    const badges = { wren: { denies: ["redemption.confirm"] } };
    expect(liveHoldersOfCapability(holders, ROLES, CONFIRM, NOW, badges)).toEqual([]);
    expect(gateSays(CONFIRM, { roleIds: ["steward-circle"], denies: ["redemption.confirm"] })).toBe(false);
  });

  it("counts a greater key that carries this one, the way the gate does", () => {
    const holders = [{ roleId: "vouchers", userId: "rowan", termEndsAt: null }];
    const vouch = "member.vouch" as Capability;
    expect(liveHoldersOfCapability(holders, ROLES, vouch, NOW)).toEqual(["rowan"]);
    expect(gateSays(vouch, { roleIds: ["vouchers"] })).toBe(true);
  });

  it("EXCLUDES the admin short-circuit, which is the one place it must disagree", () => {
    const holders: Array<{ roleId: string; userId: string; termEndsAt: null }> = [];
    // The gate says yes to an admin holding nothing...
    expect(gateSays(CONFIRM, { roleIds: [], isAdmin: true })).toBe(true);
    // ...and the counter still says nobody was given it, which is what makes
    // "if there isn't a steward" mean anything in a village that has admins.
    expect(liveHoldersOfCapability(holders, ROLES, CONFIRM, NOW)).toEqual([]);
  });

  it("counts each person once, however many ways they hold it", () => {
    const holders = [
      { roleId: "steward-circle", userId: "wren", termEndsAt: null },
      { roleId: "gardeners", userId: "wren", termEndsAt: null },
    ];
    const badges = { wren: { grants: ["redemption.confirm"] } };
    expect(liveHoldersOfCapability(holders, ROLES, CONFIRM, NOW, badges)).toEqual(["wren"]);
  });
});
