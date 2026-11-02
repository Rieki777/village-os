/**
 * THE SETUP NEEDS MANIFEST, held to its own rules (shared/setupNeeds.ts).
 *
 * The registry must pass, and the validator must refuse each way a needs list
 * can be wrong, because module intake trusts this function to be the one
 * opinion about a valid need.
 */
import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "./capabilities";
import { VARIABLES } from "./gameVariables";
import { MODULES } from "./modules";
import { launchSetupNeeds, setupNeedsProblems, type SetupNeed, type SetupNeedsModule } from "./setupNeeds";

const ctx = { dialKeys: new Set(VARIABLES.map((v) => v.key)), capabilities: new Set<string>(ALL_CAPABILITIES) };

const need = (over: Partial<SetupNeed> = {}): SetupNeed => ({
  id: "first-thing",
  kind: "content",
  ref: "demo",
  title: "Make one thing",
  scope: "village",
  phase: "before-enable",
  need: "required",
  fixAt: "/admin?tab=demo",
  since: "1.2.0",
  certainty: "verified",
  source: "a test",
  ...over,
});
const mod = (needs: SetupNeed[], over: Partial<SetupNeedsModule> = {}): SetupNeedsModule => ({ id: "demo", setup: "required", guild: [], setupNeeds: needs, ...over });

describe("the needs every module declares", () => {
  it("passes for the whole registry", () => {
    expect(setupNeedsProblems(MODULES, ctx)).toEqual([]);
  });

  it("gives every module with setup to do a required need or a seed", () => {
    for (const m of MODULES) {
      if ((m.setup ?? "none") === "none") continue;
      const required = (m.setupNeeds ?? []).some((n) => n.need === "required") || (m.guild ?? []).length > 0;
      expect(required, m.id).toBe(true);
    }
  });

  it("never repeats a seed as a need", () => {
    for (const m of MODULES) for (const n of m.setupNeeds ?? []) expect((m.guild ?? []).includes(n.ref), `${m.id}:${n.id}`).toBe(false);
  });
});

describe("what the validator refuses", () => {
  const one = (m: SetupNeedsModule) => setupNeedsProblems([m], ctx);
  it("a module with setup to do and nothing declared", () => {
    expect(one(mod([]))).toEqual([expect.stringContaining("declares no required need and no seed")]);
  });
  it("a dial, a power or a content ref that does not resolve", () => {
    expect(one(mod([need({ kind: "decision", ref: "no.such_dial" })]))[0]).toContain("is not a dial");
    expect(one(mod([need({ kind: "hands", ref: "no.such_power" })]))[0]).toContain("is not a capability");
    expect(one(mod([need({ kind: "content", ref: "another-module" })]))[0]).toContain('ref must be "demo"');
  });
  it("a bad id, a duplicate, an outside link and a release that is not one", () => {
    expect(one(mod([need({ id: "Bad Id" })]))[0]).toContain("kebab-case");
    expect(one(mod([need(), need()])).some((p) => p.includes("appears twice"))).toBe(true);
    expect(one(mod([need({ fixAt: "https://elsewhere.example" })]))[0]).toContain('starting with "/"');
    expect(one(mod([need({ since: "soon" })]))[0]).toContain("release like 1.2.0");
  });
});

describe("what blocks launch (Rye, 2026-11-01: only the before-launch needs of the guilds chosen)", () => {
  it("is comms' required before-launch needs for a village that chose comms, and nothing for one that did not", () => {
    const comms = MODULES.filter((m) => m.id === "comms");
    expect(launchSetupNeeds(comms).map((x) => x.need.id).sort()).toEqual(["postal-address", "sender", "test-email"]);
    expect(launchSetupNeeds(MODULES.filter((m) => m.id === "map"))).toEqual([]);
  });
});
