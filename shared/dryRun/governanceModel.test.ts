import { describe, expect, it } from "vitest";
import { governanceModel, settingsOf, votableWeightOf, weightsOf } from "./governanceModel";
import { makeRng } from "./rng";
import { initialState, simulate } from "./simulate";
import type { SimState, VillageSnapshot } from "./types";

const snapshot = (over: Partial<VillageSnapshot> = {}): VillageSnapshot => ({
  atIso: "2026-09-03T00:00:00.000Z",
  launched: true,
  quests: { open: 0, confirmedPerCycle: 0, gratitudePerConfirmation: BigInt(0) },
  clock: { mode: "lunar", timezone: "UTC" },
  tokens: [
    { slug: "voice", kind: "voice", decimals: 0, faucet: "sys:faucet", sinks: [], governance: "platform", active: true },
  ],
  balances: {
    "mem:ada": { voice: BigInt(100) },
    "mem:bo": { voice: BigInt(300) },
  },
  mintRules: [],
  variables: {
    "governance.weight_mode": "token",
    "governance.weight_token": "voice",
    "governance.unity_pct": "80",
    "governance.quorum_pct": "50",
  },
  members: [
    { id: "ada", accountId: "mem:ada", stage: "member", seats: [] },
    { id: "bo", accountId: "mem:bo", stage: "member", seats: [] },
  ],
  modules: {},
  ...over,
});

const stateOf = (over: Partial<VillageSnapshot> = {}): SimState => initialState(snapshot(over));

const codes = (state: SimState): string[] => governanceModel().flags(state, 1).map((f) => f.code);

describe("weightsOf", () => {
  it("weighs one a head in equal mode", () => {
    const state = stateOf({ variables: { "governance.weight_mode": "equal" } });
    expect(weightsOf(state).get("ada")).toBe(1);
    expect(weightsOf(state).get("bo")).toBe(1);
  });

  it("weighs the balance of the weight token in token mode", () => {
    const state = stateOf();
    expect(weightsOf(state).get("ada")).toBe(100);
    expect(weightsOf(state).get("bo")).toBe(300);
  });

  it("weighs the allocation in custom mode, and an absent one is zero", () => {
    const state = stateOf({
      variables: { "governance.weight_mode": "custom" },
      members: [
        { id: "ada", accountId: "mem:ada", stage: "member", seats: [], weight: 4 },
        { id: "bo", accountId: "mem:bo", stage: "member", seats: [] },
      ],
    });
    expect(weightsOf(state).get("ada")).toBe(4);
    expect(weightsOf(state).get("bo")).toBe(0);
  });

  it("floors a negative balance at zero, the way the live resolver does", () => {
    const state = stateOf({ balances: { "mem:ada": { voice: BigInt(-50) }, "mem:bo": { voice: BigInt(300) } } });
    expect(weightsOf(state).get("ada")).toBe(0);
  });
});

describe("votableWeightOf", () => {
  it("counts out the members who have gone still", () => {
    const state = stateOf({
      members: [
        { id: "ada", accountId: "mem:ada", stage: "member", seats: [] },
        { id: "bo", accountId: "mem:bo", stage: "member", seats: [], absent: true },
      ],
    });
    expect(votableWeightOf(state, weightsOf(state))).toBe(100);
  });
});

describe("the governance model's step", () => {
  it("is the identity on every balance and advances the governance clock", () => {
    const state = stateOf();
    const after = governanceModel().step(state, 1, makeRng(1));
    expect(after.balances).toEqual(state.balances);
    expect(after.mintRules).toEqual(state.mintRules);
    expect(after.governance.cyclesElapsed).toBe(state.governance.cyclesElapsed + 1);
    // Pure: the state it was handed is where it was.
    expect(state.governance.cyclesElapsed).toBe(0);
  });
});

describe("concentration", () => {
  it("flags a holder who clears the top tier on their own", () => {
    const state = stateOf({ balances: { "mem:ada": { voice: BigInt(1) }, "mem:bo": { voice: BigInt(300) } } });
    const flags = governanceModel().flags(state, 2);
    const concentration = flags.find((f) => f.code === "weight_concentration");
    expect(concentration).toBeDefined();
    expect(concentration?.cycle).toBe(2);
    expect(concentration?.severity).toBe("danger");
    expect(concentration?.sentence).toContain("One holder alone clears the top tier");
  });

  it("says nothing when no holder clears it", () => {
    expect(codes(stateOf())).not.toContain("weight_concentration");
  });

  it("says nothing on a roll carrying no weight", () => {
    const state = stateOf({ balances: { "mem:ada": { voice: BigInt(0) }, "mem:bo": { voice: BigInt(0) } } });
    expect(codes(state)).not.toContain("weight_concentration");
  });
});

describe("reachability", () => {
  it("flags a tier the members who can answer cannot reach", () => {
    const state = stateOf({
      members: [
        { id: "ada", accountId: "mem:ada", stage: "member", seats: [] },
        { id: "bo", accountId: "mem:bo", stage: "member", seats: [], absent: true },
      ],
    });
    const flags = governanceModel().flags(state, 1).filter((f) => f.code === "tier_unreachable");
    // Structural asks for 50% of 400, constitutional for 97%, and the members
    // who can still answer hold 100 between them.
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.sentence).join(" ")).toContain("structural");
    expect(flags.map((f) => f.sentence).join(" ")).toContain("constitutional");
    expect(flags[0].sentence).toContain("One member has");
  });

  it("says nothing when everybody can answer", () => {
    expect(codes(stateOf())).not.toContain("tier_unreachable");
  });
});

describe("stalemate", () => {
  it("carries the engine's own sentence when a dial is above the ceiling", () => {
    const state = stateOf({
      variables: {
        "governance.weight_mode": "token",
        "governance.weight_token": "voice",
        "governance.unity_pct": "99",
        "governance.quorum_pct": "50",
      },
    });
    const flag = governanceModel().flags(state, 1).find((f) => f.code === "stalemate_risk");
    expect(flag).toBeDefined();
    expect(flag?.sentence).toContain("Above 97 the risk is a stalemate");
  });

  it("says nothing at the recommended ceiling", () => {
    expect(codes(stateOf())).not.toContain("stalemate_risk");
  });
});

describe("the weight invariant", () => {
  it("catches a member account carrying a negative balance of the weight token", () => {
    const state = stateOf({ balances: { "mem:ada": { voice: BigInt(-50) }, "mem:bo": { voice: BigInt(300) } } });
    const violations = governanceModel().invariants(state);
    expect(violations).toHaveLength(1);
    expect(violations[0].invariant).toBe("governance.weight_equals_balances");
    expect(violations[0].detail).toContain("negative balance");
  });

  it("holds on an ordinary village", () => {
    expect(governanceModel().invariants(stateOf())).toEqual([]);
  });

  it("asserts nothing outside token mode, where the two numbers are unrelated", () => {
    const state = stateOf({
      variables: { "governance.weight_mode": "equal" },
      balances: { "mem:ada": { voice: BigInt(-50) }, "mem:bo": { voice: BigInt(300) } },
    });
    expect(governanceModel().invariants(state)).toEqual([]);
  });
});

describe("settingsOf", () => {
  it("reads the village's dials and never falls below the platform floor", () => {
    const raised = settingsOf(stateOf({ variables: { "governance.tier_structural_quorum_pct": "70" } }));
    expect(raised.tiers.structural.quorumPct).toBe(70);
    const floored = settingsOf(stateOf({ variables: { "governance.tier_structural_quorum_pct": "10" } }));
    expect(floored.tiers.structural.quorumPct).toBe(50);
  });
});

describe("the model inside a run", () => {
  it("stops the run at the cycle a model breaks the weight invariant in", () => {
    const drains = {
      name: "economics" as const,
      step: (state: SimState, cycle: number): SimState =>
        cycle === 2
          ? { ...state, balances: { ...state.balances, "mem:ada": { voice: BigInt(-1) } } }
          : state,
      flags: () => [],
      invariants: () => [],
    };
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 5, seed: 3 }, [governanceModel(), drains]);
    expect(out.proposed).toHaveLength(2);
    expect(out.violations[0].cycle).toBe(2);
    expect(out.violations[0].invariant).toBe("governance.weight_equals_balances");
  });

  it("advances its clock once a cycle through a whole run", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 4, seed: 3 }, [governanceModel()]);
    expect(out.baseline.map((c) => c.state.governance.cyclesElapsed)).toEqual([1, 2, 3, 4]);
  });
});
