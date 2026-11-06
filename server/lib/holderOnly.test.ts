import { describe, expect, it } from "vitest";
import { holderOnlyDecision } from "./holderOnly";
import type { CapabilityCtx } from "../../shared/capabilities";

const base: CapabilityCtx = { stageIndex: 3, stageIndexOf: () => 0, roleCapabilities: [], isAdmin: false };
const label = "Give powers to the village's roles, and take them away";
const ask = (ctx: CapabilityCtx | null, liveHolders: string[] = []) =>
  holderOnlyDecision({ capability: "power.assign", ctx, liveHolders, label });

describe("holderOnlyDecision: power.assign is its holders' alone", () => {
  it("a holder acts, and may give only what they hold", () => {
    const a = ask({ ...base, roleCapabilities: ["power.assign", "org.seat"] }, ["sam"]);
    expect(a.ok && a.via).toBe("holder");
    if (!a.ok) throw new Error("refused");
    expect(a.mayGive("org.seat")).toBe(true);
    expect(a.mayGive("cash.pay")).toBe(false);
  });

  it("an admin who holds it acts as a holder, and still gives only what they hold", () => {
    const a = ask({ ...base, isAdmin: true, roleCapabilities: ["power.assign"] }, ["rye"]);
    expect(a.ok && a.via).toBe("holder");
    if (!a.ok) throw new Error("refused");
    expect(a.mayGive("cash.pay")).toBe(false);
  });

  it("a plain admin is refused while somebody holds it, and is told who", () => {
    const a = ask({ ...base, isAdmin: true }, ["sam"]);
    expect(a.ok).toBe(false);
    if (a.ok) throw new Error("allowed");
    expect(a.status).toBe(403);
    expect(a.body.code).toBe("holders_only");
    expect(a.body.holders).toEqual(["sam"]);
  });

  it("control: the ordinary gate would have let that admin through", async () => {
    const { hasCapability } = await import("../../shared/capabilities");
    expect(hasCapability("power.assign", { ...base, isAdmin: true })).toBe(true);
  });

  it("with nobody holding it, an admin acts as the operator, and the answer says so", () => {
    const a = ask({ ...base, isAdmin: true }, []);
    expect(a.ok && a.via).toBe("fallback");
    if (!a.ok) throw new Error("refused");
    expect(a.mayGive("cash.pay")).toBe(true);
  });

  it("a member who does not hold it is refused whether or not anybody holds it", () => {
    expect(ask(base, []).ok).toBe(false);
    expect(ask(base, ["sam"]).ok).toBe(false);
  });

  it("once the village holds it, an admin outside the looking-after role has no fallback", () => {
    const a = ask({ ...base, isAdmin: true, villageHeld: ["power.assign"] }, []);
    expect(a.ok).toBe(false);
    if (a.ok) throw new Error("allowed");
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("village_holds_it");
  });

  it("nobody signed in is a 401", () => {
    const a = ask(null);
    expect(!a.ok && a.status).toBe(401);
  });
});
