/**
 * `cash.pay` reaches the finance role (Rye, 2026-10-30: "yes and this one is
 * then given to a finance role as well"), in a new village through the seed and
 * in a village that already has its roles through a one-time grant that changes
 * nothing else.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { grantCashPayToTreasury, seedStarterRoles, TREASURY_ROLE_ID } from "./starterRoles";
import { HANDOVER_SET, TRANSFERABLE } from "../../shared/capabilities";

type Role = { id: string; name: string; description?: string; capabilities?: string[] };

function store(rows: Role[]) {
  let held = rows.map((r) => ({ ...r }));
  let writes = 0;
  return {
    all: () => held,
    replaceAll: async (next: Role[]) => {
      writes++;
      held = next;
    },
    writes: () => writes,
  };
}

const SEED = path.resolve(process.cwd(), "server/seeds/roles-seed.json");

describe("cash.pay and the finance role", () => {
  it("is one of the powers the founding stewards hold at launch and hand over", () => {
    expect(TRANSFERABLE["cash.pay"]).toBe(true);
    expect(HANDOVER_SET).toContain("cash.pay");
  });

  it("is granted to the seeded Treasury role in a new village", async () => {
    const seed = JSON.parse(fs.readFileSync(SEED, "utf-8"));
    expect(seed.find((r: Role) => r.id === TREASURY_ROLE_ID)?.capabilities).toContain("cash.pay");
    const roles = store([]);
    await seedStarterRoles(roles, SEED);
    expect(roles.all().find((r) => r.id === TREASURY_ROLE_ID)?.capabilities).toContain("cash.pay");
  });

  it("is added to an existing village's Treasury role once, leaving its words and other powers as the village set them", async () => {
    const roles = store([
      { id: "founders-circle", name: "Founders Circle", capabilities: ["proposal.open"] },
      { id: TREASURY_ROLE_ID, name: "Our Money Keepers", description: "Our own words", capabilities: ["exchange.manage"] },
    ]);
    expect(await grantCashPayToTreasury(roles)).toBe(true);
    const treasury = roles.all().find((r) => r.id === TREASURY_ROLE_ID)!;
    expect(treasury).toEqual({ id: TREASURY_ROLE_ID, name: "Our Money Keepers", description: "Our own words", capabilities: ["exchange.manage", "cash.pay"] });
    expect(roles.all().find((r) => r.id === "founders-circle")?.capabilities).toEqual(["proposal.open"]);
    // Run again: nothing to write.
    expect(await grantCashPayToTreasury(roles)).toBe(false);
    expect(roles.writes()).toBe(1);
  });

  it("does nothing for a village that has no Treasury role", async () => {
    const roles = store([{ id: "founders-circle", name: "Founders Circle", capabilities: [] }]);
    expect(await grantCashPayToTreasury(roles)).toBe(false);
    expect(roles.writes()).toBe(0);
  });

  it("never re-seeds a village that already has roles", async () => {
    const roles = store([{ id: "only", name: "Only", capabilities: [] }]);
    await seedStarterRoles(roles, SEED);
    expect(roles.writes()).toBe(0);
  });
});
