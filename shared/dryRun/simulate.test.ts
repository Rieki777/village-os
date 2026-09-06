import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffOf, initialState, orderedModels, simulate } from "./simulate";
import type { DomainModel, Flag, MintRuleSpec, ProposedChange, SimState, VillageSnapshot, Violation } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const snapshot = (over: Partial<VillageSnapshot> = {}): VillageSnapshot => ({
  atIso: "2026-09-03T00:00:00.000Z",
  launched: true,
  quests: { open: 4, confirmedPerCycle: 2, gratitudePerConfirmation: BigInt(30) },
  clock: { mode: "lunar", timezone: "UTC" },
  tokens: [
    { slug: "voice", kind: "voice", decimals: 0, faucet: "sys:faucet", sinks: [], governance: "platform", active: true },
  ],
  balances: {
    "mem:ada": { voice: BigInt(100) },
    "mem:bo": { voice: BigInt(300) },
  },
  mintRules: [
    {
      id: "rule-quest-voice",
      trigger: "quest.completed",
      tokenSlug: "voice",
      recipient: "member",
      amount: BigInt(5),
      amountRaw: "5.0000",
      ceiling: null,
      ceilingRaw: "",
      enabled: true,
    },
  ],
  variables: { "governance.quorum_pct": "50", "governance.unity_pct": "80" },
  members: [
    { id: "ada", accountId: "mem:ada", stage: "member", seats: [] },
    { id: "bo", accountId: "mem:bo", stage: "member", seats: [] },
  ],
  modules: { quests: "public" },
  ...over,
});

/** A model that does nothing, so a test can say what it is testing. */
const inert = (name: DomainModel["name"] = "economics"): DomainModel => ({
  name,
  step: (state) => state,
  flags: () => [],
  invariants: () => [],
});

/** A model that spends the generator, so determinism is actually exercised. */
const spender = (): DomainModel => ({
  name: "economics",
  step: (state, _cycle, rng) => {
    const account = { ...(state.balances["mem:ada"] ?? {}) };
    account.voice = (account.voice ?? BigInt(0)) + BigInt(rng.int(1000));
    return { ...state, balances: { ...state.balances, "mem:ada": account } };
  },
  flags: () => [],
  invariants: () => [],
});

/** A model that writes one variable at one cycle. */
const writesAt = (cycle: number, key: string, value: string): DomainModel => ({
  name: "economics",
  step: (state, at) => (at === cycle ? { ...state, variables: { ...state.variables, [key]: value } } : state),
  flags: () => [],
  invariants: () => [],
});

/** A model that reports a violation once the run reaches a cycle. */
const breaksAt = (cycle: number): DomainModel => ({
  name: "economics",
  step: (state) => state,
  flags: () => [],
  invariants: (state: SimState): Violation[] =>
    state.cycle >= cycle ? [{ invariant: "economics.conservation", cycle: 0, detail: "the pool went short" }] : [],
});

const stringify = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));

const codes = (flags: Flag[]): string[] => flags.map((f) => f.code);

describe("simulate", () => {
  it("gives byte-equal results for the same input twice", () => {
    const input = { snapshot: snapshot(), changes: [], cycles: 4, seed: 2026 };
    const first = simulate(input, [inert("governance"), spender()]);
    const second = simulate(input, [inert("governance"), spender()]);
    expect(stringify(first)).toBe(stringify(second));
    // And the seed is the one that was asked for, printed in the answer.
    expect(first.seed).toBe(2026);
  });

  it("gives a different run for a different seed", () => {
    const base = { snapshot: snapshot(), changes: [], cycles: 4 };
    const a = simulate({ ...base, seed: 1 }, [spender()]);
    const b = simulate({ ...base, seed: 2 }, [spender()]);
    expect(stringify(a.baseline)).not.toBe(stringify(b.baseline));
  });

  it("leaves the caller's snapshot exactly where it found it", () => {
    const snap = snapshot();
    const changes: ProposedChange[] = [
      { kind: "dial", key: "governance.quorum_pct", from: "50", to: "60", timing: "at_acceptance" },
    ];
    simulate({ snapshot: snap, changes, cycles: 3, seed: 1 }, [spender()]);
    expect(snap.variables["governance.quorum_pct"]).toBe("50");
    expect(snap.balances["mem:ada"].voice).toBe(BigInt(100));
  });

  it("diffs one variable change against a baseline of the same snapshot", () => {
    const changes: ProposedChange[] = [
      { kind: "dial", key: "governance.quorum_pct", from: "50", to: "60", timing: "at_acceptance" },
    ];
    const out = simulate({ snapshot: snapshot(), changes, cycles: 3, seed: 7 }, [inert("governance")]);
    expect(out.diff).toHaveLength(1);
    expect(out.diff[0].path).toBe("variables/governance.quorum_pct");
    expect(out.diff[0].baseline).toBe("50");
    expect(out.diff[0].proposed).toBe("60");
    expect(out.diff[0].sentence).toContain("After 3 cycles");
    expect(out.violations).toEqual([]);
  });

  it("lands next_moon at cycle 1 and at_acceptance before it", () => {
    const later: ProposedChange[] = [
      { kind: "dial", key: "governance.unity_pct", from: "80", to: "90", timing: "next_moon" },
    ];
    const out = simulate({ snapshot: snapshot(), changes: later, cycles: 2, seed: 1 }, [inert("governance")]);
    // In force for the whole of cycle 1 either way, which is what the two
    // doors have in common; the diff is the same and the landing record is not.
    expect(out.proposed[0].state.variables["governance.unity_pct"]).toBe("90");
    expect(out.proposed[0].state.governance.landedPaths).toEqual(["variables/governance.unity_pct"]);
    expect(out.baseline[0].state.variables["governance.unity_pct"]).toBe("80");
  });

  it("reverts a term to the captured previous value", () => {
    const changes: ProposedChange[] = [
      { kind: "dial", key: "governance.quorum_pct", from: "50", to: "60", timing: "at_acceptance", expiresAfterCycles: 2 },
    ];
    const out = simulate({ snapshot: snapshot(), changes, cycles: 4, seed: 1 }, [inert("governance")]);
    expect(out.proposed[0].state.variables["governance.quorum_pct"]).toBe("60");
    expect(out.proposed[1].state.variables["governance.quorum_pct"]).toBe("60");
    expect(out.proposed[2].state.variables["governance.quorum_pct"]).toBe("50");
    expect(codes(out.flags)).toContain("term_reverted");
    // Back where it started, so there is nothing left to say about it.
    expect(out.diff).toEqual([]);
  });

  it("declines the reversion when something else has changed the value since", () => {
    const changes: ProposedChange[] = [
      { kind: "dial", key: "governance.quorum_pct", from: "50", to: "60", timing: "at_acceptance", expiresAfterCycles: 2 },
    ];
    const out = simulate({ snapshot: snapshot(), changes, cycles: 4, seed: 1 }, [
      inert("governance"),
      writesAt(2, "governance.quorum_pct", "70"),
    ]);
    expect(out.proposed[2].state.variables["governance.quorum_pct"]).toBe("70");
    expect(codes(out.flags)).toContain("term_reversion_declined");
    expect(codes(out.flags)).not.toContain("term_reverted");
  });

  it("stops the proposed pass at the first violation and names the cycle", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 6, seed: 1 }, [
      inert("governance"),
      breaksAt(3),
    ]);
    expect(out.proposed).toHaveLength(3);
    expect(out.proposed[2].cycle).toBe(3);
    expect(out.violations).toHaveLength(1);
    expect(out.violations[0].cycle).toBe(3);
    expect(out.violations[0].invariant).toBe("economics.conservation");
    // The baseline broke on the same cycle and stopped too, which is why the
    // diff over the two final states is still a comparison of like with like.
    expect(out.baseline).toHaveLength(3);
  });

  it("says out loud when it holds no copy of what a change writes", () => {
    const changes: ProposedChange[] = [
      { kind: "brand_field", key: "village.name", from: "a", to: "b", timing: "at_acceptance" },
    ];
    const out = simulate({ snapshot: snapshot(), changes, cycles: 2, seed: 1 }, [inert("governance")]);
    expect(codes(out.flags)).toContain("change_not_previewed");
    expect(out.diff).toEqual([]);
  });

  it("applies a mint rule change through the mint: key spelling", () => {
    const changes: ProposedChange[] = [
      { kind: "mint_rule", key: "mint:rule-quest-voice:amount", from: "5", to: "9", timing: "at_acceptance" },
    ];
    const out = simulate({ snapshot: snapshot(), changes, cycles: 1, seed: 1 }, [inert("governance")]);
    expect(out.proposed[0].state.mintRules[0].amount).toBe(BigInt(9));
    expect(out.baseline[0].state.mintRules[0].amount).toBe(BigInt(5));
  });

  it("diffs balances a model moved, in minor units", () => {
    const moves: DomainModel = {
      name: "economics",
      step: (state, cycle) =>
        cycle === 1 && state.variables["governance.quorum_pct"] === "60"
          ? { ...state, balances: { ...state.balances, "mem:bo": { voice: BigInt(999) } } }
          : state,
      flags: () => [],
      invariants: () => [],
    };
    const changes: ProposedChange[] = [
      { kind: "dial", key: "governance.quorum_pct", from: "50", to: "60", timing: "at_acceptance" },
    ];
    const out = simulate({ snapshot: snapshot(), changes, cycles: 2, seed: 1 }, [inert("governance"), moves]);
    const balance = out.diff.find((d) => d.path === "balances/mem:bo/voice");
    expect(balance).toBeDefined();
    expect(balance?.baseline).toBe("300");
    expect(balance?.proposed).toBe("999");
    expect(balance?.sentence).toContain("in minor units");
  });

  it("refuses a snapshot whose instant does not parse, and simulates nothing", () => {
    const out = simulate({ snapshot: snapshot({ atIso: "not a date" }), changes: [], cycles: 3, seed: 5 }, [inert()]);
    expect(out.baseline).toEqual([]);
    expect(out.proposed).toEqual([]);
    expect(out.violations[0].invariant).toBe("snapshot.readable");
    expect(out.seed).toBe(5);
  });

  it("runs no cycles for a run of no cycles", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 0, seed: 1 }, [inert()]);
    expect(out.baseline).toEqual([]);
    expect(out.diff).toEqual([]);
  });

  it("advances the instant one cycle boundary per cycle", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 3, seed: 1 }, [inert()]);
    const instants = out.baseline.map((c) => c.atIso);
    expect(instants[0]).toBe("2026-09-03T00:00:00.000Z");
    expect(new Date(instants[1]).getTime()).toBeGreaterThan(new Date(instants[0]).getTime());
    expect(new Date(instants[2]).getTime()).toBeGreaterThan(new Date(instants[1]).getTime());
  });

  it("keeps each recorded cycle as it was, so a later cycle cannot rewrite it", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 3, seed: 4 }, [spender()]);
    const first = out.baseline[0].state.balances["mem:ada"].voice;
    const last = out.baseline[2].state.balances["mem:ada"].voice;
    expect(last).toBeGreaterThan(first);
  });
});

describe("orderedModels", () => {
  it("puts governance first and keeps everybody else in the order given", () => {
    const a = { ...inert(), name: "economics" as const };
    const g = { ...inert(), name: "governance" as const };
    expect(orderedModels([a, g]).map((m) => m.name)).toEqual(["governance", "economics"]);
    expect(orderedModels([g, a]).map((m) => m.name)).toEqual(["governance", "economics"]);
  });
});

describe("diffOf", () => {
  it("sorts by path, so two runs of one preview read the same", () => {
    const a = initialState(snapshot());
    const b = initialState(snapshot({ variables: { "governance.quorum_pct": "60", "governance.unity_pct": "90", "a.key": "1" } }));
    const out = diffOf(a, b, 2);
    expect(out.map((d) => d.path)).toEqual([
      "variables/a.key",
      "variables/governance.quorum_pct",
      "variables/governance.unity_pct",
    ]);
  });
});

/**
 * THE ASSUMPTIONS PASS THROUGH UNTOUCHED.
 *
 * `SimInput.assumptions` is the one place an activity assumption lives, and
 * the whole value of that is the round trip: what a model read has to be what
 * the result shows, or a reader checking an answer against its stated
 * assumptions is checking the wrong object.
 */
describe("assumptions", () => {
  const ASSUMPTIONS = {
    economics: { questsPerCycle: 12, payout: "0.5000", sinks: ["dues"] },
    governance: { turnout: 0.6 },
  };

  /** A model that writes down what it was handed, so a test can read it back. */
  const probe = (): { model: DomainModel; sawInStep: unknown[]; sawInFlags: unknown[] } => {
    const sawInStep: unknown[] = [];
    const sawInFlags: unknown[] = [];
    return {
      sawInStep,
      sawInFlags,
      model: {
        name: "economics",
        step: (state) => {
          sawInStep.push(state.assumptions);
          return state;
        },
        flags: (state) => {
          sawInFlags.push(state.assumptions);
          return [];
        },
        invariants: () => [],
      },
    };
  };

  it("echoes them beside the seed, byte for byte", () => {
    const out = simulate(
      { snapshot: snapshot(), changes: [], cycles: 3, seed: 7, assumptions: ASSUMPTIONS },
      [inert("governance")],
    );
    expect(JSON.stringify(out.assumptions)).toBe(JSON.stringify(ASSUMPTIONS));
    // And it is the caller's own object, not a copy that merely agrees with
    // it. A copy would let the two drift the moment anything edited one.
    expect(out.assumptions).toBe(ASSUMPTIONS);
    expect(out.seed).toBe(7);
  });

  it("hands every model its own, in step and in flags, on every cycle", () => {
    const p = probe();
    simulate(
      { snapshot: snapshot(), changes: [], cycles: 3, seed: 1, assumptions: ASSUMPTIONS },
      [inert("governance"), p.model],
    );
    // Two passes, three cycles each.
    expect(p.sawInStep).toHaveLength(6);
    expect(p.sawInFlags).toHaveLength(6);
    for (const seen of p.sawInStep.concat(p.sawInFlags)) {
      expect(seen).toBe(ASSUMPTIONS);
      expect((seen as typeof ASSUMPTIONS).economics.questsPerCycle).toBe(12);
    }
  });

  it("carries them onto every recorded cycle of both passes", () => {
    const out = simulate(
      { snapshot: snapshot(), changes: [], cycles: 2, seed: 1, assumptions: ASSUMPTIONS },
      [inert("governance")],
    );
    for (const cycle of out.baseline.concat(out.proposed)) {
      expect(cycle.state.assumptions).toBe(ASSUMPTIONS);
    }
  });

  it("invents none when the caller gave none, and echoes that too", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 1, seed: 1 }, [inert("governance")]);
    expect(out.assumptions).toBeUndefined();
    expect(out.baseline[0].state.assumptions).toBeUndefined();
  });

  it("echoes them even when the snapshot refuses to parse", () => {
    const out = simulate(
      { snapshot: snapshot({ atIso: "not a date" }), changes: [], cycles: 2, seed: 1, assumptions: ASSUMPTIONS },
      [inert("governance")],
    );
    expect(out.violations[0].invariant).toBe("snapshot.readable");
    expect(out.assumptions).toBe(ASSUMPTIONS);
  });
});

/**
 * THE PER-MODEL MEMO BAG.
 *
 * `state.models` is where a model keeps what it remembers between cycles,
 * under its own name. The engine holds no opinion about what is in it and is
 * only obliged not to drop it.
 */
describe("the models memo bag", () => {
  /** A model that remembers how many cycles it has seen, under its own name. */
  const counter = (name: string): DomainModel => ({
    name: "economics",
    step: (state, cycle) => ({
      ...state,
      models: { ...state.models, [name]: { seen: cycle, at: state.atIso } },
    }),
    flags: () => [],
    invariants: () => [],
  });

  it("starts empty, because the engine invents nothing a model did not write", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 1, seed: 1 }, [inert("governance")]);
    expect(out.baseline[0].state.models).toEqual({});
  });

  it("carries what a model wrote into every recorded cycle", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 3, seed: 1 }, [
      inert("governance"),
      counter("economics"),
    ]);
    expect(out.proposed.map((c) => (c.state.models.economics as { seen: number }).seen)).toEqual([1, 2, 3]);
  });

  it("keeps two models out of each other's way", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 2, seed: 1 }, [
      inert("governance"),
      counter("economics"),
      counter("land"),
    ]);
    expect(Object.keys(out.proposed[1].state.models).sort()).toEqual(["economics", "land"]);
  });

  it("copies the bag per record, so a later cycle cannot add a key to an earlier one", () => {
    const late = (): DomainModel => ({
      name: "economics",
      step: (state, cycle) => (cycle === 2 ? { ...state, models: { ...state.models, late: true } } : state),
      flags: () => [],
      invariants: () => [],
    });
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 2, seed: 1 }, [inert("governance"), late()]);
    expect(out.proposed[0].state.models).toEqual({});
    expect(out.proposed[1].state.models).toEqual({ late: true });
  });
});

/**
 * THE ENGINE OWNS THE CLOCK.
 *
 * A recorded cycle's instant is that cycle's START, on the result and on the
 * state alike, and no model can move it.
 */
describe("atIso", () => {
  it("records the cycle's start on the result and on the state, and they agree", () => {
    const out = simulate({ snapshot: snapshot(), changes: [], cycles: 3, seed: 1 }, [inert("governance")]);
    for (const cycle of out.proposed) expect(cycle.state.atIso).toBe(cycle.atIso);
    expect(out.proposed[0].atIso).toBe("2026-09-03T00:00:00.000Z");
    // Strictly increasing, one boundary at a time.
    const instants = out.proposed.map((c) => c.atIso);
    expect(instants.slice().sort()).toEqual(instants);
    expect(new Set(instants).size).toBe(3);
  });

  it("discards a model's own advance instead of compounding it", () => {
    const meddler: DomainModel = {
      name: "economics",
      // A model that thinks advancing the clock is its job. Before the engine
      // took ownership this moved the run: once here, once at the bottom of
      // the loop, so a three cycle run covered six.
      step: (state) => ({ ...state, atIso: new Date(new Date(state.atIso).getTime() + 9e8).toISOString() }),
      flags: () => [],
      invariants: () => [],
    };
    const honest = simulate({ snapshot: snapshot(), changes: [], cycles: 3, seed: 1 }, [inert("governance")]);
    const meddled = simulate({ snapshot: snapshot(), changes: [], cycles: 3, seed: 1 }, [
      inert("governance"),
      meddler,
    ]);
    expect(meddled.proposed.map((c) => c.atIso)).toEqual(honest.proposed.map((c) => c.atIso));
    expect(meddled.proposed.map((c) => c.state.atIso)).toEqual(honest.proposed.map((c) => c.state.atIso));
  });

  it("advances the final state exactly one cycle past the last one, not two", () => {
    // The final state is not recorded on a CycleResult, so it is read through
    // the one place it reaches the answer: a longer run's next cycle has to
    // begin exactly where the shorter run's final state was left.
    const two = simulate({ snapshot: snapshot(), changes: [], cycles: 2, seed: 1 }, [inert("governance")]);
    const three = simulate({ snapshot: snapshot(), changes: [], cycles: 3, seed: 1 }, [inert("governance")]);
    expect(three.proposed.map((c) => c.atIso).slice(0, 2)).toEqual(two.proposed.map((c) => c.atIso));
    // Cycle 3's start is what a two cycle run's final state advanced to, and
    // the fallback that computes it reads the cycle's own start and never
    // whatever the state was left holding.
    expect(three.proposed[2].atIso).not.toBe(two.proposed[1].atIso);
  });
});

/**
 * WHAT THE SNAPSHOT NOW CARRIES, AND WHY EACH OF IT REACHES A MODEL.
 */
describe("launch, quests and the token registry", () => {
  it("carries launched and the quests summary onto the state a model steps", () => {
    const seen: SimState[] = [];
    const watcher: DomainModel = {
      name: "economics",
      step: (state) => {
        seen.push(state);
        return state;
      },
      flags: () => [],
      invariants: () => [],
    };
    simulate(
      {
        snapshot: snapshot({
          launched: false,
          quests: { open: 9, confirmedPerCycle: 3, gratitudePerConfirmation: BigInt(45) },
        }),
        changes: [],
        cycles: 1,
        seed: 1,
      },
      [inert("governance"), watcher],
    );
    expect(seen[0].launched).toBe(false);
    expect(seen[0].quests).toEqual({ open: 9, confirmedPerCycle: 3, gratitudePerConfirmation: BigInt(45) });
  });

  it("carries the four facts behind ruleCannotPay onto every token", () => {
    const out = simulate(
      {
        snapshot: snapshot({
          tokens: [
            { slug: "voice", kind: "voice", decimals: 0, faucet: "sys:faucet", sinks: [], governance: "platform", active: true },
            { slug: "equity", kind: "equity", decimals: 4, faucet: null, sinks: [], governance: "hypha", active: false },
          ],
        }),
        changes: [],
        cycles: 1,
        seed: 1,
      },
      [inert("governance")],
    );
    const mirrored = out.baseline[0].state.tokens[1];
    expect(mirrored.governance).toBe("hypha");
    expect(mirrored.active).toBe(false);
    expect(mirrored.faucet).toBeNull();
  });

  it("records launched and quests on every recorded cycle of both passes", () => {
    const out = simulate({ snapshot: snapshot({ launched: false }), changes: [], cycles: 2, seed: 1 }, [
      inert("governance"),
    ]);
    for (const cycle of out.baseline.concat(out.proposed)) {
      expect(cycle.state.launched).toBe(false);
      expect(cycle.state.quests.confirmedPerCycle).toBe(2);
    }
  });
});

/**
 * THE TWO DECIMAL FIELDS, HELD TWICE EACH AND KEPT IN STEP.
 *
 * `mint_rules.amount` and `mint_rules.ceiling` are both `decimal(18,4)`, and a
 * token with no decimals turns 0.0004 into 0 minor units. So each rounded
 * number and its column's own text are both carried, and they have to move
 * together or the flag that says "this rounds away to nothing" fires on a
 * value nobody proposed.
 */
describe("amountRaw and ceilingRaw", () => {
  const RULE_KEY = "mint:rule-quest-voice:amount";
  const CEILING_KEY = "mint:rule-quest-voice:ceiling";

  /** One rule, with whichever of the four fields a test wants to pin. */
  const ruleWith = (over: Partial<MintRuleSpec> = {}): MintRuleSpec => ({
    id: "rule-quest-voice",
    trigger: "quest.completed",
    tokenSlug: "voice",
    recipient: "member",
    amount: BigInt(5),
    amountRaw: "5.0000",
    ceiling: null,
    ceilingRaw: "",
    enabled: true,
    ...over,
  });

  it("comes through the snapshot unrounded, beside the rounded amount", () => {
    const out = simulate(
      {
        snapshot: snapshot({
          mintRules: [
            {
              id: "rule-quest-voice",
              trigger: "quest.completed",
              tokenSlug: "voice",
              recipient: "member",
              amount: BigInt(0),
              amountRaw: "0.0004",
              ceiling: null,
              ceilingRaw: "",
              enabled: true,
            },
          ],
        }),
        changes: [],
        cycles: 1,
        seed: 1,
      },
      [inert("governance")],
    );
    const rule = out.baseline[0].state.mintRules[0];
    // The two together are what tells a rule set to nothing apart from a rule
    // that rounded away to nothing. Either one alone cannot.
    expect(rule.amount).toBe(BigInt(0));
    expect(rule.amountRaw).toBe("0.0004");
  });

  it("moves with the amount when a change retunes it", () => {
    const changes: ProposedChange[] = [
      { kind: "mint_rule", key: RULE_KEY, from: "5", to: "0.0004", timing: "at_acceptance" },
    ];
    const out = simulate({ snapshot: snapshot(), changes, cycles: 1, seed: 1 }, [inert("governance")]);
    const proposed = out.proposed[0].state.mintRules[0];
    expect(proposed.amount).toBe(BigInt(0));
    expect(proposed.amountRaw).toBe("0.0004");
    // The baseline never saw the change, so it keeps the snapshot's text.
    expect(out.baseline[0].state.mintRules[0].amountRaw).toBe("5.0000");
  });

  it("gives back the exact text a term reversion took away", () => {
    const changes: ProposedChange[] = [
      { kind: "mint_rule", key: RULE_KEY, from: "5", to: "9", timing: "at_acceptance", expiresAfterCycles: 1 },
    ];
    const out = simulate(
      {
        snapshot: snapshot({
          mintRules: [
            {
              id: "rule-quest-voice",
              trigger: "quest.completed",
              tokenSlug: "voice",
              recipient: "member",
              amount: BigInt(5),
              amountRaw: "5.4321",
              ceiling: null,
              ceilingRaw: "",
              enabled: true,
            },
          ],
        }),
        changes,
        cycles: 3,
        seed: 1,
      },
      [inert("governance")],
    );
    expect(out.proposed[0].state.mintRules[0].amountRaw).toBe("9");
    // The term ran out at the start of cycle 2 and handed back the four
    // places the column was holding, not the rounded 5 the number carried.
    expect(codes(out.flags)).toContain("term_reverted");
    expect(out.proposed[1].state.mintRules[0].amount).toBe(BigInt(5));
    expect(out.proposed[1].state.mintRules[0].amountRaw).toBe("5.4321");
  });

  it("leaves both texts alone when a change writes some other field of the rule", () => {
    const changes: ProposedChange[] = [
      { kind: "mint_rule", key: "mint:rule-quest-voice:enabled", from: "true", to: "false", timing: "at_acceptance" },
    ];
    const out = simulate(
      { snapshot: snapshot({ mintRules: [ruleWith({ ceiling: BigInt(20), ceilingRaw: "20.0000" })] }), changes, cycles: 1, seed: 1 },
      [inert("governance")],
    );
    const rule = out.proposed[0].state.mintRules[0];
    expect(rule.enabled).toBe(false);
    expect(rule.amountRaw).toBe("5.0000");
    expect(rule.ceilingRaw).toBe("20.0000");
  });

  it("carries a ceiling of 0.0004 through the snapshot as text beside a rounded 0", () => {
    // THE CASE THIS FIELD EXISTS FOR. A cap typed below the token's own
    // resolution reaches a model as BigInt(0), which is the same value a cap
    // of "let nothing through" carries. Without the text a preview would show
    // the village a total stop where the engine clamps.
    const out = simulate(
      {
        snapshot: snapshot({ mintRules: [ruleWith({ ceiling: BigInt(0), ceilingRaw: "0.0004" })] }),
        changes: [],
        cycles: 1,
        seed: 1,
      },
      [inert("governance")],
    );
    const rule = out.baseline[0].state.mintRules[0];
    expect(rule.ceiling).toBe(BigInt(0));
    expect(rule.ceilingRaw).toBe("0.0004");
    // And the cap that really is nothing carries the same 0 with a text that
    // says so, which is the pair doing the one job it has.
    const stopped = simulate(
      {
        snapshot: snapshot({ mintRules: [ruleWith({ ceiling: BigInt(0), ceilingRaw: "0.0000" })] }),
        changes: [],
        cycles: 1,
        seed: 1,
      },
      [inert("governance")],
    );
    expect(stopped.baseline[0].state.mintRules[0].ceiling).toBe(BigInt(0));
    expect(stopped.baseline[0].state.mintRules[0].ceilingRaw).toBe("0.0000");
  });

  it("moves the ceiling's text with the ceiling when a change retunes it", () => {
    const changes: ProposedChange[] = [
      { kind: "mint_rule", key: CEILING_KEY, from: "20", to: "0.0004", timing: "at_acceptance" },
    ];
    const out = simulate(
      {
        snapshot: snapshot({ mintRules: [ruleWith({ ceiling: BigInt(20), ceilingRaw: "20.0000" })] }),
        changes,
        cycles: 1,
        seed: 1,
      },
      [inert("governance")],
    );
    const proposed = out.proposed[0].state.mintRules[0];
    expect(proposed.ceiling).toBe(BigInt(0));
    expect(proposed.ceilingRaw).toBe("0.0004");
    // The amount and its own text were never touched by a ceiling change.
    expect(proposed.amount).toBe(BigInt(5));
    expect(proposed.amountRaw).toBe("5.0000");
    expect(out.baseline[0].state.mintRules[0].ceilingRaw).toBe("20.0000");
  });

  it("gives back the ceiling's exact text a term reversion took away", () => {
    const changes: ProposedChange[] = [
      { kind: "mint_rule", key: CEILING_KEY, from: "20", to: "50", timing: "at_acceptance", expiresAfterCycles: 1 },
    ];
    const out = simulate(
      {
        snapshot: snapshot({ mintRules: [ruleWith({ ceiling: BigInt(20), ceilingRaw: "20.8765" })] }),
        changes,
        cycles: 3,
        seed: 1,
      },
      [inert("governance")],
    );
    expect(out.proposed[0].state.mintRules[0].ceilingRaw).toBe("50");
    expect(codes(out.flags)).toContain("term_reverted");
    expect(out.proposed[1].state.mintRules[0].ceiling).toBe(BigInt(20));
    expect(out.proposed[1].state.mintRules[0].ceilingRaw).toBe("20.8765");
  });
});

/**
 * THE CARDINAL RULE, PROVEN FROM DISK.
 *
 * `simulate` may not be able to reach a connection. That is the whole reason
 * the engine takes plain data, and a comment saying so is worth nothing the
 * first time somebody adds an import to fetch one more field. So this walks
 * the real import graph out of the real source files and fails on anything
 * under `server/db`, `server/repos` or the `mysql2` package.
 *
 * It walks the WHOLE graph, transitively, because the risk is never the
 * import somebody writes in this file. It is the third file down.
 */
describe("the import graph", () => {
  const RESOLVE_ORDER = [".ts", ".tsx", ".json", "/index.ts", "/index.tsx"];

  const resolve = (from: string, spec: string): string | null => {
    const base = path.resolve(path.dirname(from), spec);
    if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
    for (const ext of RESOLVE_ORDER) {
      const candidate = base + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  };

  const specifiersIn = (file: string): string[] => {
    const source = fs.readFileSync(file, "utf8");
    const found: string[] = [];
    const patterns = [
      /\bfrom\s+["']([^"']+)["']/g,
      /\bimport\s+["']([^"']+)["']/g,
      /\brequire\(\s*["']([^"']+)["']\s*\)/g,
      /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
      let match = pattern.exec(source);
      while (match) {
        found.push(match[1]);
        match = pattern.exec(source);
      }
    }
    return found;
  };

  const walk = (entry: string): { files: string[]; packages: string[] } => {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      if (file.endsWith(".json")) continue;
      for (const spec of specifiersIn(file)) {
        if (!spec.startsWith(".")) {
          packages.add(spec);
          continue;
        }
        const target = resolve(file, spec);
        if (target) queue.push(target);
        else throw new Error(`${file} imports ${spec} and nothing on disk answers to it`);
      }
    }
    return { files: Array.from(seen), packages: Array.from(packages) };
  };

  it("reaches nothing under server/db, server/repos or mysql2", () => {
    const graph = walk(path.join(HERE, "simulate.ts"));
    const normalised = graph.files.map((f) => f.split(path.sep).join("/"));
    const forbidden = normalised.filter(
      (f) => /\/server\/db\//.test(f) || /\/server\/repos\//.test(f) || /\/server\//.test(f),
    );
    expect(forbidden).toEqual([]);
    const badPackages = graph.packages.filter((p) => p === "mysql2" || p.startsWith("mysql2/"));
    expect(badPackages).toEqual([]);
  });

  it("reaches nothing under server/ from the governance model either", () => {
    const graph = walk(path.join(HERE, "governanceModel.ts"));
    const normalised = graph.files.map((f) => f.split(path.sep).join("/"));
    expect(normalised.filter((f) => /\/server\//.test(f))).toEqual([]);
    expect(graph.packages.filter((p) => p === "mysql2" || p.startsWith("mysql2/"))).toEqual([]);
  });

  it("actually walked more than the entry file, so a green here means something", () => {
    const graph = walk(path.join(HERE, "simulate.ts"));
    expect(graph.files.length).toBeGreaterThan(3);
  });
});
