/**
 * `role.pay`, THE TREASURER'S POWER TO SET ROLE PAY (Rye, 2026-11-06, C2).
 *
 * "Role pay is set by both the treasurer and the role/valuation algorithm."
 * The coordinator's reading, the same day: "the Treasurer" is a holder of
 * role.pay THROUGH the Treasury role. So the key is:
 *   - transferable, in the handover set, and held back to the mature handover
 *     like `cash.pay` (the role powers lane's advice: `MATURE_ONLY`);
 *   - granted to the seeded Treasury role, and to a running village's Treasury
 *     role once, leaving everything else on it alone;
 *   - never grantable by a badge, and never held by an agent.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BADGE_GRANTABLE, CAPABILITY_LABELS, DENIABLE, HANDOVER_SET, TRANSFERABLE } from "../../shared/capabilities";
import { CAPABILITY_CONSEQUENCE } from "../../shared/draftKinds";
import { HANDOVER_GUIDANCE, POWER_FAMILY } from "../../shared/powerBoard";
import { isMatureOnly, MATURE_ONLY } from "./launchHandover";
import { grantMoonReviewKeys, ROLE_PAY_GRANTS, TREASURY_ROLE_ID } from "./starterRoles";

type Role = { id: string; name: string; capabilities?: string[] };
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

describe("role.pay, the Treasurer's power to set role pay", () => {
  it("is a power the village can hold, handed over only at maturity, like cash.pay", () => {
    expect(TRANSFERABLE["role.pay"]).toBe(true);
    expect(HANDOVER_SET).toContain("role.pay");
    expect(isMatureOnly("role.pay")).toBe(true);
    expect(MATURE_ONLY).toContain("cash.pay");
    expect(HANDOVER_GUIDANCE["role.pay"]).toBe("mature-only");
    expect(POWER_FAMILY["role.pay"]).toBe("money");
  });

  it("says what it does, in the label and in the sentence a member reads", () => {
    expect(CAPABILITY_LABELS["role.pay"]).toMatch(/worth and pays/);
    expect(CAPABILITY_CONSEQUENCE["role.pay"]).toMatch(/never on a role they hold/);
  });

  it("is never grantable by a badge, and a warning badge can take it away", () => {
    expect(BADGE_GRANTABLE["role.pay"]).toBe(false);
    expect(DENIABLE["role.pay"]).toBe(true);
  });

  it("is granted to the seeded Treasury role in a new village", () => {
    const seed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "server/seeds/roles-seed.json"), "utf-8"));
    expect(seed.find((r: Role) => r.id === TREASURY_ROLE_ID)?.capabilities).toContain("role.pay");
  });

  it("reaches a running village's Treasury role once, and nothing else changes", async () => {
    const roles = store([
      { id: "founders-circle", name: "Founders Circle", capabilities: ["proposal.open"] },
      { id: TREASURY_ROLE_ID, name: "Our Money Keepers", capabilities: ["cash.pay"] },
    ]);
    expect(await grantMoonReviewKeys(roles, ROLE_PAY_GRANTS)).toBe(1);
    expect(roles.all().find((r) => r.id === TREASURY_ROLE_ID)?.capabilities).toEqual(["cash.pay", "role.pay"]);
    expect(roles.all().find((r) => r.id === "founders-circle")?.capabilities).toEqual(["proposal.open"]);
    expect(await grantMoonReviewKeys(roles, ROLE_PAY_GRANTS)).toBe(0);
    expect(roles.writes()).toBe(1);
  });

  it("does nothing for a village with no Treasury role", async () => {
    const roles = store([{ id: "founders-circle", name: "Founders Circle", capabilities: [] }]);
    expect(await grantMoonReviewKeys(roles, ROLE_PAY_GRANTS)).toBe(0);
    expect(roles.writes()).toBe(0);
  });
});
