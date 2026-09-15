/**
 * THE SMALLEST HONEST DRY RUN: one cycle, one member, one quest, on both
 * clocks, with conservation asserted at every step.
 *
 * The point of this file is not that the model agrees with itself. A test can
 * only ever prove a behaviour is INTENDED. So every expected number below is
 * DERIVED BY READING THE REAL CODE, and the derivation is written out beside
 * the assertion with the file and the line it came from. If the engine changes
 * and the model does not, the derivation comment is where the disagreement
 * shows up first.
 *
 * It needs no database, and the last test in this file proves that
 * structurally: it walks the model's import graph from disk and fails if
 * anything under `server/` or the `mysql2` package is ever reachable from it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CALENDAR_CLOCK, LUNAR_CLOCK, clockFor } from "../cycleClock";
import { VARIABLES_BY_KEY } from "../gameVariables";
import { shareOfTotal } from "../governanceShare";
import {
  DEFAULT_ECONOMICS_ASSUMPTIONS,
  describeAssumptions,
  parseEconomicsAssumptions,
} from "./economicsAssumptions";
import {
  ALLOW_NEGATIVE_SOURCES,
  ECONOMICS_KEY,
  assertConserved,
  ceilingOutcome,
  ceilingOutcomeMinor,
  economicsModel,
  negativeKey,
  readEconomicsMemo,
  ruleCannotPay,
  writtenAmount,
} from "./economicsModel";
import { makeRng } from "./rng";
import { initialState, simulate } from "./simulate";
import type { ClockMode } from "../cycleClock";
import type { MintRuleSpec, QuestsSummary, SimState, TokenSpec, VillageSnapshot } from "./types";

// ── The instant the whole file runs from ────────────────────────────────────
//
// Named once and stated out loud, because two clocks from the SAME instant is
// the only comparison that says anything. Midday UTC, deliberately inside a
// month and inside a lunation rather than on either boundary.
const AT_ISO = "2026-09-03T12:00:00.000Z";
const AT = new Date(AT_ISO);

const SEED = 20260903;

// ── The six platform tokens a fresh village boots with ───────────────────
//
// SIX AND NOT SEVEN. The registry a real village boots with also holds the
// village's own EQUITY token, seeded by drizzle/0006_token_registry.sql:43. It
// is left out of this fixture on purpose: `shared/` is a hard-clean zone for
// `scripts/check-brand-refs.mjs`, and a platform test naming one village's
// equity slug is exactly the debt every fork would inherit. Nothing here turns
// on it. It is Hypha-governed with no faucet, so `faucetFor` (economy.ts:1028)
// returns null for it and the engine can never issue it, and `voice` below is
// the same shape and covers that path in the tests that need it.
//
// slugs, kinds and decimals from drizzle/0006_token_registry.sql:41 (gratitude,
// voice), drizzle/0007_village_credits_token.sql:10 (credits),
// server/lib/economy.ts:122 (village-voice, decimals 3 from VOICE_DECIMALS at
// economy.ts:151), server/lib/stays.ts:60 (stay-credit) and
// server/lib/library.ts:44 (library-credit). Every other token takes the
// column default, `decimals int NOT NULL DEFAULT 0` (0006:32).
//
// `governance` and `active` come from the same rows: 0006 seeds `voice` as
// `hypha` and everything the platform issues as `platform`, and `active`
// defaults to 1 (registerToken, server/lib/ledger.ts:222).
//
// Faucets from `faucetFor` (server/lib/economy.ts:1028) and the four system
// account ids it names: RECOGNITION_FAUCET and CYCLE_POOL_FAUCET and
// MINT_FAUCET (server/lib/ledger.ts:63,64,67), VOICE_MINT (economy.ts:109) and
// LIBRARY_MINT (economy.ts:72). `voice` is a Hypha-governed mirror and
// `faucetFor` returns null for it, which is why it has none.
//
// Sinks from `spendSinkFor` (server/lib/spending.ts:139).
function tokens(): TokenSpec[] {
  return [
    { slug: "gratitude", kind: "recognition", decimals: 0, faucet: "sys:gratitude-pool", sinks: ["sys:treasury"], governance: "platform", active: true },
    { slug: "voice", kind: "voice", decimals: 0, faucet: null, sinks: [], governance: "hypha", active: true },
    { slug: "credits", kind: "credit", decimals: 0, faucet: "sys:cycle-pool", sinks: ["sys:treasury"], governance: "platform", active: true },
    { slug: "village-voice", kind: "voice", decimals: 3, faucet: "sys:voice-mint", sinks: ["sys:treasury"], governance: "platform", active: true },
    { slug: "stay-credit", kind: "credit", decimals: 0, faucet: "sys:mint", sinks: ["sys:mint"], governance: "platform", active: true },
    { slug: "library-credit", kind: "credit", decimals: 0, faucet: "sys:library-mint", sinks: ["sys:treasury"], governance: "platform", active: true },
  ];
}

/**
 * The five faucets, the treasury and the one member, all present and all
 * empty.
 *
 * An empty row and a zero balance are the same number here, which is right:
 * `economySeed` grants nobody anything ("Neither is a genesis grant",
 * server/lib/economySeed.ts:14) so a fresh village starts at zero everywhere.
 * An ABSENT faucet account is a different fact and the model raises
 * `econ_faucet_account_missing` for it, so every faucet is listed.
 */
function balances(): Record<string, Record<string, bigint>> {
  return {
    "sys:gratitude-pool": {},
    "sys:cycle-pool": {},
    "sys:voice-mint": {},
    "sys:mint": {},
    "sys:library-mint": {},
    "sys:treasury": {},
    "mem:u1": {},
  };
}

/**
 * The DEFAULT mint rules, converted to minor units.
 *
 * Straight off `RULES` in server/lib/economySeed.ts:135-166, with the ids the
 * seed writes at economySeed.ts:227 (`rule-${trigger}-${token}`). The human
 * figures there are multiplied by the token's own scale the way
 * `toLedgerUnits` (server/lib/economy.ts:154) does it, so village-voice rides
 * in thousandths and everything else in whole units.
 *
 * `amountRaw` is the `decimal(18,4)` column's own text (drizzle/0071:51), which
 * is what the seed's whole numbers land as, and it is the only unrounded copy
 * of the amount in the simulation.
 */
function mintRules(): MintRuleSpec[] {
  return [
    {
      id: "rule-quest.completed-village-voice",
      trigger: "quest.completed",
      tokenSlug: "village-voice",
      recipient: "claimant",
      amount: BigInt(10000),
      amountRaw: "10.0000",
      ceiling: BigInt(100000),
      ceilingRaw: "100.0000",
      enabled: true,
    },
    {
      id: "rule-quest.completed-credits",
      trigger: "quest.completed",
      tokenSlug: "credits",
      recipient: "claimant",
      amount: BigInt(25),
      amountRaw: "25.0000",
      ceiling: BigInt(250),
      ceilingRaw: "250.0000",
      enabled: true,
    },
    {
      id: "rule-role.cycle-village-voice",
      trigger: "role.cycle",
      tokenSlug: "village-voice",
      recipient: "holder",
      amount: BigInt(50000),
      amountRaw: "50.0000",
      ceiling: BigInt(200000),
      ceilingRaw: "200.0000",
      enabled: true,
    },
    {
      id: "rule-role.cycle-credits",
      trigger: "role.cycle",
      tokenSlug: "credits",
      recipient: "holder",
      amount: BigInt(25),
      amountRaw: "25.0000",
      ceiling: BigInt(250),
      ceilingRaw: "250.0000",
      enabled: true,
    },
    // Seeded OFF on purpose (economySeed.ts:165 and the block comment above it).
    {
      id: "rule-role.cycle-gratitude",
      trigger: "role.cycle",
      tokenSlug: "gratitude",
      recipient: "holder",
      amount: BigInt(20),
      amountRaw: "20.0000",
      ceiling: BigInt(100),
      ceilingRaw: "100.0000",
      enabled: false,
    },
  ];
}

/**
 * One member, holding no seat.
 *
 * The stage is `member` and NOT `resident`. `resident` was the example in an
 * earlier draft of the contract's doc comment and there is no such stage:
 * `GAME_CONFIG.stages` (shared/gameConfig.ts:424-437) runs visitor, guest,
 * immersant, participant, member, contributor, quest-seeker, initiate,
 * co-creator, role-holder, guide, sage. A member at a stage off that list has
 * no `progression.multiplier.<stage>` variable, and `variable()`
 * (server/lib/variables.ts:39) THROWS on a key with no definition, so the real
 * server would 500 on their next gift. The `econ_stage_no_multiplier` test
 * below proves the model says so.
 */
function members() {
  return [{ id: "u1", accountId: "mem:u1", stage: "member", seats: [] as string[] }];
}

/**
 * What the village was MEASURED doing. One quest confirmed in the cycle before
 * the snapshot, one still open, and no recognition per confirmation, which is
 * what a village whose quests advertise nothing looks like.
 *
 * This is an observation and never an assumption: `QuestsSummary` is read off
 * the tables at the snapshot instant, and `SimInput.assumptions` holds only
 * the multiple applied to it.
 */
function quests(): QuestsSummary {
  return { open: 1, confirmedPerCycle: 1, gratitudePerConfirmation: BigInt(0) };
}

/**
 * The village, at the chosen instant, on the chosen clock.
 *
 * `variables` is EMPTY, and that is the honest shape: the database stores
 * changed values only and platform defaults inherit (CLAUDE.md, Five config
 * planes). One test below runs the same cycle with every default materialised
 * and asserts the balances come out identical, so the model is right whichever
 * way a snapshot reader fills the map.
 */
function snapshot(mode: ClockMode, overrides: Record<string, string> = {}): VillageSnapshot {
  return {
    atIso: AT_ISO,
    launched: true,
    quests: quests(),
    clock: { mode, timezone: "UTC" },
    tokens: tokens(),
    balances: balances(),
    mintRules: mintRules(),
    variables: { ...overrides },
    members: members(),
    // The four core modules are always public and cannot be disabled
    // (CLAUDE.md, Modules and access).
    modules: { quests: "public", gratitude: "public", progression: "public", profiles: "public" },
  };
}

/** The smallest honest run: the measured quest rate, nothing given, nothing spent. */
const ONE_QUEST = {
  questRateMultiplier: 1,
  gratitudeAllowanceGivenShare: 0,
  sinkSpendPerMemberPerCycle: BigInt(0),
  poolClosedEachCycle: true,
};

/** Every non-zero balance, as sorted `account/slug=amount` lines. */
function nonZero(state: SimState): string[] {
  const out: string[] = [];
  for (const account of Object.keys(state.balances)) {
    const row = state.balances[account] ?? {};
    for (const slug of Object.keys(row)) {
      if (row[slug] !== BigInt(0)) out.push(`${account}/${slug}=${String(row[slug])}`);
    }
  }
  return out.sort();
}

/** One cycle through the real engine, and the live state the model returned. */
function runOneCycle(mode: ClockMode, overrides: Record<string, string> = {}) {
  const snap = snapshot(mode, overrides);
  const model = economicsModel(ONE_QUEST);
  const result = simulate({ snapshot: snap, changes: [], cycles: 1, seed: SEED }, [model]);
  // Both entry points are the vendored engine's own
  // (shared/dryRun/simulate.ts:404 and shared/dryRun/rng.ts:34).
  const stepped = model.step(initialState(snap), 1, makeRng(SEED));
  return { snap, model, result, stepped, memo: readEconomicsMemo(stepped)! };
}

describe("economics model, the smallest honest dry run", () => {
  it("pays one confirmed quest exactly what the engine would post", () => {
    const { result } = runOneCycle("lunar");
    const after = result.proposed[0].state;

    /*
     * THE DERIVATION, function by function and line by line.
     *
     *  1. `mintForConfirmedClaim` (server/lib/economy.ts:1117) reads
     *     `rulesFor(pool, "quest.completed")` (economy.ts:1141), which returns
     *     the ENABLED rules for that trigger (economy.ts:434).
     *  2. It skips the recognition token outright (economy.ts:1145: "Recognition
     *     is the consent route's job"), so no `gratitude` rule can fire here.
     *  3. Both default rules carry a fixed amount, so neither takes the
     *     from_source refusal at economy.ts:1147.
     *  4. Neither is zero (economy.ts:1166) and `ruleCannotPay`
     *     (economy.ts:1059) clears both: each token is registered,
     *     platform-governed, active, and has a faucet.
     *  5. `toLedgerUnits` (economy.ts:154) is
     *     `Math.round(human * 10 ** decimals)`:
     *       village-voice, amount 10 (economySeed.ts:140), decimals 3
     *         (VOICE_DECIMALS, economy.ts:151)  ->  round(10 * 1000)  = 10000
     *       credits, amount 25 (economySeed.ts:161), decimals 0
     *         (drizzle/0006_token_registry.sql:32)  ->  round(25 * 1) =    25
     *  6. THE CEILING CLAMPS ONE OCCURRENCE, in the rule's own human units and
     *     before `toLedgerUnits` (`ceilingOutcome`, economy.ts:590, called at
     *     economy.ts:1365). Both defaults sit well under their ceilings
     *     (10 under 100, 25 under 250), so `min(amount, ceiling)` is the amount
     *     and the full figure is posted.
     *  7. `mint` (economy.ts:462) calls `postTransfer` with
     *     `from: faucetFor(slug)` (economy.ts:1189) and
     *     `to: memberAccount(claim.userId)` (economy.ts:492, ledger.ts:70),
     *     which is `mem:u1`.
     *       faucetFor("village-voice") = VOICE_MINT     = "sys:voice-mint"
     *       faucetFor("credits")       = CYCLE_POOL_FAUCET = "sys:cycle-pool"
     *  8. A faucet's negative balance IS that token's issued supply
     *     (ledger.ts:8), so each faucet holds the exact negative.
     */
    expect(after.balances["mem:u1"]["village-voice"]).toBe(BigInt(10000));
    expect(after.balances["mem:u1"].credits).toBe(BigInt(25));
    expect(after.balances["sys:voice-mint"]["village-voice"]).toBe(BigInt(-10000));
    expect(after.balances["sys:cycle-pool"].credits).toBe(BigInt(-25));

    // Every other account is untouched, stated as the whole set so a stray
    // posting anywhere shows up as an extra line and never as a silent pass.
    expect(nonZero(after)).toEqual([
      "mem:u1/credits=25",
      "mem:u1/village-voice=10000",
      "sys:cycle-pool/credits=-25",
      "sys:voice-mint/village-voice=-10000",
    ]);

    // In human units: 10.000 village voice and 25 credits, which is what a
    // member would read on their chip (`fromLedgerUnits`, economy.ts:160).
    expect(Number(after.balances["mem:u1"]["village-voice"]) / 1000).toBe(10);
    expect(Number(after.balances["mem:u1"].credits)).toBe(25);
  });

  it("holds conservation over every account after the cycle, faucets included", () => {
    const { model, result, stepped } = runOneCycle("lunar");
    // From invariants(), over the engine's recorded state and over the live one.
    expect(model.invariants(result.proposed[0].state)).toEqual([]);
    expect(model.invariants(stepped)).toEqual([]);
    expect(result.violations).toEqual([]);

    // And summed by hand, so this assertion does not depend on the same code
    // path the model's own check uses.
    const totals: Record<string, bigint> = {};
    for (const account of Object.keys(stepped.balances)) {
      const row = stepped.balances[account] ?? {};
      for (const slug of Object.keys(row)) {
        totals[slug] = (totals[slug] ?? BigInt(0)) + row[slug];
      }
    }
    for (const slug of Object.keys(totals)) {
      expect(`${slug}=${String(totals[slug])}`).toBe(`${slug}=0`);
    }
  });

  it("reads the same answer whether the snapshot carries the defaults or inherits them", () => {
    // The database stores changed values only. A snapshot reader that
    // materialised every default must reach the same balances as one that
    // wrote nothing, or the preview depends on how it was loaded.
    const materialised: Record<string, string> = {};
    for (const key of Object.keys(VARIABLES_BY_KEY)) {
      materialised[key] = VARIABLES_BY_KEY[key].default;
    }
    const inherited = runOneCycle("lunar");
    const explicit = runOneCycle("lunar", materialised);
    expect(nonZero(explicit.stepped)).toEqual(nonZero(inherited.stepped));
    expect(explicit.memo.allowanceTotal).toBe(inherited.memo.allowanceTotal);
  });
});

describe("economics model, the contract's own shapes", () => {
  it("keeps its memo in models.economics and nowhere else", () => {
    const { stepped } = runOneCycle("lunar");
    expect(stepped.models[ECONOMICS_KEY]).toBeTruthy();
    expect(readEconomicsMemo(stepped)).toBe(stepped.models[ECONOMICS_KEY]);
    // No extra field on the state. The bag is the contract's one place for it.
    expect((stepped as unknown as Record<string, unknown>).economics).toBeUndefined();
    // A state nothing has stepped has no memo, and reading it answers null.
    expect(readEconomicsMemo(initialState(snapshot("lunar")))).toBeNull();
  });

  it("survives cloneState into every recorded cycle", () => {
    const model = economicsModel(ONE_QUEST);
    const result = simulate({ snapshot: snapshot("lunar"), changes: [], cycles: 2, seed: SEED }, [model]);
    // `cloneState` shallow copies the bag (shared/dryRun/simulate.ts:453), so
    // a memo REPLACED each cycle is readable off each recorded cycle and the
    // two are different objects.
    const first = readEconomicsMemo(result.proposed[0].state)!;
    const second = readEconomicsMemo(result.proposed[1].state)!;
    expect(first.cycle).toBe(1);
    expect(second.cycle).toBe(2);
    expect(first).not.toBe(second);
  });

  it("leaves atIso alone, because the engine owns the clock", () => {
    const before = initialState(snapshot("lunar"));
    const stepped = economicsModel(ONE_QUEST).step(before, 1, makeRng(SEED));
    // The model reads the clock and reports the boundary in its memo; it never
    // writes the instant. `runPass` re-stamps the cycle's own start after every
    // model has stepped (shared/dryRun/simulate.ts:321), so a model that moved
    // it would be writing a value the engine discards.
    expect(stepped.atIso).toBe(AT_ISO);
    expect(stepped.cycle).toBe(before.cycle);
    expect(readEconomicsMemo(stepped)!.nextBoundaryAt).toBe(LUNAR_CLOCK.nextBoundaryAfter(AT).toISOString());
  });

  it("reads assumptions off the state, over its own constructor, field by field", () => {
    const snap = snapshot("lunar");
    // The constructor supplies the fallback; SimInput.assumptions.economics
    // beats it for the fields it names and leaves the rest alone.
    const model = economicsModel({ ...ONE_QUEST, questRateMultiplier: 5 });
    const result = simulate(
      {
        snapshot: snap,
        changes: [],
        cycles: 1,
        seed: SEED,
        assumptions: { economics: { questRateMultiplier: 2 }, governance: { ignored: true } },
      },
      [model],
    );
    const memo = readEconomicsMemo(result.proposed[0].state)!;
    expect(memo.assumptions.questRateMultiplier).toBe(2);
    // Untouched fields keep the constructor's numbers.
    expect(memo.assumptions.poolClosedEachCycle).toBe(true);
    expect(memo.assumptions.sinkSpendPerMemberPerCycle).toBe(BigInt(0));
    // Two confirmations, so twice the payout.
    expect(memo.questsConfirmed).toBe(2);
    expect(result.proposed[0].state.balances["mem:u1"].credits).toBe(BigInt(50));
    // And the engine echoes what the run was given, verbatim.
    expect(result.assumptions).toEqual({ economics: { questRateMultiplier: 2 }, governance: { ignored: true } });
  });

  it("prints the assumptions a run actually used, and the observations beside them", () => {
    const snap = snapshot("lunar");
    const model = economicsModel(ONE_QUEST);
    const result = simulate(
      {
        snapshot: snap,
        changes: [],
        cycles: 1,
        seed: SEED,
        assumptions: { economics: { questRateMultiplier: 3, gratitudeAllowanceGivenShare: 0.5 } },
      },
      [model],
    );
    const printed = model.describeAssumptions(result.proposed[0].state);
    expect(printed.join(" ")).toContain("multiplied by 3");
    expect(printed.join(" ")).toContain("50%");
    // Observations are labelled as measurements, never as assumptions.
    expect(printed.join(" ")).toContain("Measured, never assumed");
    expect(printed.join(" ")).toContain("confirmed 1 quest(s)");
    // With no state it prints the model's own fallback.
    expect(model.describeAssumptions().join(" ")).toContain("repeats the quest rate");
  });

  it("mirrors all four of the engine's refusals", () => {
    /*
     * `ruleCannotPay` (server/lib/economy.ts:1059) refuses in this order: no
     * such token, governed on Hypha, retired from the registry, no faucet.
     * `TokenSpec` now carries `governance` and `active`, so all four are
     * reachable from the snapshot and a preview can no longer promise a payout
     * the engine would refuse.
     */
    const reg = tokens();
    expect(ruleCannotPay(reg, "no-such-token")).toContain("no token called");
    expect(ruleCannotPay(reg, "voice")).toContain("governed on Hypha");
    const retired = reg.map((t) => (t.slug === "credits" ? { ...t, active: false } : t));
    expect(ruleCannotPay(retired, "credits")).toContain("retired from the registry");
    const faucetless = reg.map((t) => (t.slug === "credits" ? { ...t, faucet: null } : t));
    expect(ruleCannotPay(faucetless, "credits")).toContain("no faucet");
    expect(ruleCannotPay(reg, "credits")).toBeNull();
    // The order matters: a Hypha token with no faucet says the Hypha thing.
    expect(ruleCannotPay(reg, "voice")).not.toContain("no faucet");
  });
});

describe("economics model, the same cycle on both clocks", () => {
  it("gives the same balances, different cycle ids and different boundaries", () => {
    const lunar = runOneCycle("lunar");
    const calendar = runOneCycle("calendar");

    // Same money.
    expect(nonZero(calendar.stepped)).toEqual(nonZero(lunar.stepped));

    // Different names for the cycle, each one exactly what the seam gives for
    // this instant. Read from `clockFor`, never from a string typed here.
    expect(lunar.memo.cycleId).toBe(clockFor("lunar").idFor(AT));
    expect(calendar.memo.cycleId).toBe(clockFor("calendar").idFor(AT));
    expect(lunar.memo.cycleId).toMatch(/^lunar-\d{6}$/);
    expect(calendar.memo.cycleId).toMatch(/^month-\d{4}-\d{2}$/);
    expect(calendar.memo.cycleId).toBe("month-2026-09");
    expect(lunar.memo.cycleId).not.toBe(calendar.memo.cycleId);

    // Different boundaries. The ENGINE moves the instant; the memo reports
    // where the boundary falls so a reader can check it.
    expect(lunar.memo.nextBoundaryAt).toBe(LUNAR_CLOCK.nextBoundaryAfter(AT).toISOString());
    expect(calendar.memo.nextBoundaryAt).toBe(CALENDAR_CLOCK.nextBoundaryAfter(AT).toISOString());
    expect(calendar.memo.nextBoundaryAt).toBe("2026-10-01T00:00:00.000Z");
    expect(lunar.memo.nextBoundaryAt).not.toBe(calendar.memo.nextBoundaryAt);

    // And the bounds the cycle ran under are the clock's own.
    expect(calendar.memo.startsAt).toBe(CALENDAR_CLOCK.boundsFor(AT).startsAt.toISOString());
    expect(calendar.memo.endsAt).toBe(CALENDAR_CLOCK.boundsFor(AT).endsAt.toISOString());
    expect(lunar.memo.startsAt).toBe(LUNAR_CLOCK.boundsFor(AT).startsAt.toISOString());
    expect(lunar.memo.endsAt).toBe(LUNAR_CLOCK.boundsFor(AT).endsAt.toISOString());
  });
});

describe("economics model, invariants", () => {
  it("catches a posting with one leg missing, naming the token and the sum", () => {
    const { model, stepped } = runOneCycle("lunar");
    // A corrupted state: the member keeps the voice they were paid and the
    // faucet that paid it never went negative. One leg of a two-leg move.
    const broken: SimState = {
      ...stepped,
      balances: { ...stepped.balances, "sys:voice-mint": {} },
    };
    const found = model.invariants(broken);
    const conservation = found.filter((v) => v.invariant === "ledger.conservation");
    expect(conservation).toHaveLength(1);
    expect(conservation[0].detail).toContain("village-voice");
    expect(conservation[0].detail).toContain("10000");
  });

  it("catches a non-faucet account holding a negative balance", () => {
    const { model, stepped } = runOneCycle("lunar");
    const broken: SimState = {
      ...stepped,
      balances: {
        ...stepped.balances,
        "mem:u1": { ...stepped.balances["mem:u1"], credits: BigInt(-5) },
        "sys:treasury": { credits: BigInt(30) },
      },
    };
    const found = model.invariants(broken);
    expect(found.map((v) => v.invariant)).toContain("ledger.no_negative_non_faucet");
    const negative = found.filter((v) => v.invariant === "ledger.no_negative_non_faucet")[0];
    expect(negative.detail).toContain("mem:u1");
    expect(negative.detail).toContain("stay_night");
    // And the same fact reaches a member as a sentence.
    const codes = model.flags(broken, 1).map((f) => f.code);
    expect(codes).toContain("econ_negative_balance");
  });

  it("throws from the guard step runs after every posting", () => {
    // `assertConserved` is the check `post` calls after EVERY two-account
    // move, so a cycle that returns at all is a cycle that balanced the whole
    // way through. Exercised directly here, because the public path cannot be
    // made to break it on purpose, which is the point.
    const { stepped } = runOneCycle("lunar");
    expect(() => assertConserved(stepped.balances, "village-voice", "the cycle")).not.toThrow();
    expect(() => assertConserved(stepped.balances, "credits", "the cycle")).not.toThrow();

    const oneLegged = { ...stepped.balances, "sys:voice-mint": {} };
    let message = "";
    try {
      assertConserved(oneLegged, "village-voice", "a posting with one leg");
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toContain("economics.conservation broke");
    expect(message).toContain("village-voice");
    expect(message).toContain("10000");
    expect(message).toContain("a posting with one leg");
  });
});

describe("the allow-negative mirror, keyed and bounded", () => {
  /**
   * A state with a hand-built memo, which is the only way to reach the lawful
   * branch: this model never posts an allow-negative source itself, so a
   * bounded exemption has to be constructed the way the ledger would have
   * produced it.
   */
  function withDebits(debits: Record<string, bigint>, extra: Record<string, Record<string, bigint>>) {
    const { model, stepped } = runOneCycle("lunar");
    const memo = { ...readEconomicsMemo(stepped)!, allowNegativeDebits: debits };
    const state: SimState = {
      ...stepped,
      balances: { ...stepped.balances, ...extra },
      models: { ...stepped.models, [ECONOMICS_KEY]: memo },
    };
    return { model, state };
  }

  const negatives = (r: { model: ReturnType<typeof economicsModel>; state: SimState }) =>
    r.model.invariants(r.state).filter((v) => v.invariant === "ledger.no_negative_non_faucet");

  it("holds every source the ledger holds, reversal included", () => {
    // The list itself is compared against the ledger's runtime value in
    // server/dryRunMirror.test.ts, which is the only test that may import both.
    // Here it is only asserted that the member the mirror was missing is back.
    expect(ALLOW_NEGATIVE_SOURCES).toContain("reversal");
    expect(ALLOW_NEGATIVE_SOURCES).toContain("stay_night");
    expect(ALLOW_NEGATIVE_SOURCES).toContain("payment_reversal");
    expect(ALLOW_NEGATIVE_SOURCES).toHaveLength(3);
  });

  it("lets a negative stand only as far as the allow-negative debits reach", () => {
    /*
     * `checkLedgerInvariants` (server/lib/ledger.ts:886) exempts an account
     * holding ANY debit from one of these sources, for that account AND that
     * token. Unbounded, that exempts a negative of any size once a single
     * clawback has touched the account. The bound is the honest reading: what a
     * clawback took out is the most a lawful negative can be.
     */
    const key = negativeKey("mem:u1", "credits");
    const exactly = withDebits(
      { [key]: BigInt(25) },
      { "mem:u1": { credits: BigInt(-25) }, "sys:treasury": { credits: BigInt(50) } },
    );
    expect(negatives(exactly)).toHaveLength(0);

    const over = withDebits(
      { [key]: BigInt(25) },
      { "mem:u1": { credits: BigInt(-26) }, "sys:treasury": { credits: BigInt(51) } },
    );
    expect(negatives(over)).toHaveLength(1);
    expect(negatives(over)[0].detail).toContain("took 25 credits out of it");
    expect(negatives(over)[0].detail).toContain("short by 1");
  });

  it("does not let a debit in one token exempt a negative in another", () => {
    // A stay_night burn of credits says nothing about a negative in
    // recognition. Keyed by account alone, it exempted it.
    const wrongToken = withDebits(
      { [negativeKey("mem:u1", "credits")]: BigInt(900) },
      { "mem:u1": { gratitude: BigInt(-900) }, "sys:treasury": { gratitude: BigInt(900) } },
    );
    expect(negatives(wrongToken)).toHaveLength(1);
    expect(negatives(wrongToken)[0].detail).toContain("gratitude");
    expect(negatives(wrongToken)[0].detail).toContain("took 0 gratitude out of it");

    // The same debit against the same token does exempt it.
    const rightToken = withDebits(
      { [negativeKey("mem:u1", "gratitude")]: BigInt(900) },
      { "mem:u1": { gratitude: BigInt(-900) }, "sys:treasury": { gratitude: BigInt(900) } },
    );
    expect(negatives(rightToken)).toHaveLength(0);
  });

  it("answers the same for the same balances however the run reached them", () => {
    /*
     * The verdict used to be decided by whichever debit came last, so two runs
     * ending on identical balances disagreed about whether the ledger was
     * broken. A bound over sums cannot depend on order: the same debits in any
     * arrangement give the same total.
     */
    const held = { "mem:u1": { credits: BigInt(-25) }, "sys:treasury": { credits: BigInt(50) } };
    const key = negativeKey("mem:u1", "credits");
    const oneWay = withDebits({ [key]: BigInt(10) + BigInt(15) }, held);
    const otherWay = withDebits({ [key]: BigInt(15) + BigInt(10) }, held);
    expect(negatives(oneWay).length).toBe(negatives(otherWay).length);
    expect(negatives(oneWay)).toHaveLength(0);
    // And an unrelated debit elsewhere changes nothing about this account.
    const noisy = withDebits({ [key]: BigInt(25), [negativeKey("mem:u2", "credits")]: BigInt(9999) }, held);
    expect(negatives(noisy)).toHaveLength(0);
  });

  it("treats a run with no memo as a run that earned no exemption", () => {
    // Fail closed. A state nothing stepped has no record of a clawback, so a
    // negative on it is a negative nobody can account for.
    const { model, stepped } = runOneCycle("lunar");
    const bare: SimState = {
      ...stepped,
      balances: { ...stepped.balances, "mem:u1": { credits: BigInt(-25) }, "sys:treasury": { credits: BigInt(50) } },
      models: {},
    };
    expect(model.invariants(bare).map((v) => v.invariant)).toContain("ledger.no_negative_non_faucet");
  });
});

describe("the gratitude allowance, mirrored as the engine posts it", () => {
  /** The same village with every token carrying `decimals` places. */
  function scaled(decimals: number): VillageSnapshot {
    const snap = snapshot("lunar");
    snap.quests = { open: 2, confirmedPerCycle: 0, gratitudePerConfirmation: BigInt(0) };
    snap.tokens = snap.tokens.map((t) => ({ ...t, decimals }));
    snap.balances["mem:u2"] = {};
    snap.members = [
      { id: "u1", accountId: "mem:u1", stage: "member", seats: [] },
      { id: "u2", accountId: "mem:u2", stage: "member", seats: [] },
    ];
    return snap;
  }

  it("keeps the allowance human and converts once, at the posting", () => {
    /*
     * THE SWEEP MEASURED THE SHIPPED PATH AND IT IS HUMAN UNTIL THE LEDGER.
     * `allowanceFor` (server/lib/economy.ts:851) returns
     * `Math.round(numberVar("gratitude.base_budget") * stageMultiplier)`, which
     * is 105 * 2 = 210 a member, and its `spent` and `remaining` are human.
     * `shareCapFor` divides that human total by `gratitude.full_sends_per_cycle`,
     * 7 by default, so the cap is 30 whole recognition tokens. `gratitude_log.amount` stores the
     * human number. The ONE conversion is `toLedgerUnits(HEARTS, amount)` at
     * the `postTransferOn` inside `give` (economy.ts:1425).
     *
     * So at four decimal places a gift of 30 posts 300000 minor units, and the
     * allowance, the cap and the expired figure all stay at their human 420,
     * 30 and 360. Every one of those three is a number a member reads.
     */
    const model = economicsModel({ ...ONE_QUEST, gratitudeAllowanceGivenShare: 1 });
    const stepped = model.step(initialState(scaled(4)), 1, makeRng(SEED));
    const memo = readEconomicsMemo(stepped)!;
    // HUMAN, all three.
    expect(memo.allowanceTotal).toBe(BigInt(420));
    expect(memo.gratitudeGiven).toBe(BigInt(60));
    expect(memo.gratitudeExpired).toBe(BigInt(360));
    // MINOR, at the ledger, and only there.
    expect(stepped.balances["mem:u1"].gratitude).toBe(BigInt(300000));
    expect(stepped.balances["mem:u2"].gratitude).toBe(BigInt(300000));
    expect(stepped.balances["sys:gratitude-pool"].gratitude).toBe(BigInt(-600000));
    // Which is 30 whole tokens each, the number `checkGive` weighed.
    expect(Number(stepped.balances["mem:u1"].gratitude) / 10000).toBe(30);

    /*
     * AT ZERO DECIMALS THE CONVERSION IS THE IDENTITY, which is why no village
     * running the shipped default has ever seen a difference: the same 30 is
     * both the human gift and the posting.
     */
    const flat = model.step(initialState(scaled(0)), 1, makeRng(SEED));
    const flatMemo = readEconomicsMemo(flat)!;
    expect(flatMemo.allowanceTotal).toBe(BigInt(420));
    expect(flatMemo.gratitudeExpired).toBe(BigInt(360));
    expect(flat.balances["mem:u1"].gratitude).toBe(BigInt(30));

    // THE THREE THINGS THAT BREAK IF THE SCALE MOVES EARLIER. The cap's floor
    // is one WHOLE token, the expired figure is what a member reads as
    // remaining, and the pool splits by the human figure the settlement reads
    // out of `gratitude_log`. All three are identical at 0 and at 4 places.
    expect(flatMemo.allowanceTotal).toBe(memo.allowanceTotal);
    expect(flatMemo.gratitudeGiven).toBe(memo.gratitudeGiven);
    expect(flatMemo.gratitudeExpired).toBe(memo.gratitudeExpired);
  });

  it("has nothing to say about the allowance now that the conversion is real", () => {
    /*
     * `econ_allowance_unscaled` was raised while the engine posted a human
     * allowance into a minor-unit ledger. The sweep fixed `give` and
     * `allowanceFor` together, `allowanceScale` returns the real conversion,
     * and the flag goes quiet by reading the same function the posting reads.
     * Its condition never changed, which is the whole point of putting both on
     * one seam: the flag cannot say one thing while the arithmetic does another.
     *
     * The code stays as a tripwire. Breaking `allowanceScale` back to 1 while a
     * token carries decimals makes it speak again, which is the red run this
     * test's failure mode is.
     */
    const model = economicsModel({ ...ONE_QUEST, gratitudeAllowanceGivenShare: 1 });
    for (const places of [0, 2, 3, 4]) {
      const stepped = model.step(initialState(scaled(places)), 1, makeRng(SEED));
      const codes = model.flags(stepped, 1).map((f) => f.code);
      expect(`${places} places: ${codes.indexOf("econ_allowance_unscaled") >= 0}`).toBe(`${places} places: false`);
    }
    // And quiet on the default fixture, which is every village that has not
    // touched its registry.
    const plain = runOneCycle("lunar");
    expect(plain.model.flags(plain.stepped, 1).map((f) => f.code)).not.toContain("econ_allowance_unscaled");
  });

  it("holds the per-person cap at one whole token, never at one minor unit", () => {
    /*
     * `shareCapFor` in server/lib/economy.ts is
     * `max(1, floor(total / gratitude.full_sends_per_cycle))` over the
     * HUMAN total, so its floor is one whole recognition token. Scaling the
     * allowance before this line would make the floor 0.0001 of a token at four
     * places, a cap the engine has never allowed.
     *
     * Measured at a base budget of 1, where the floor is the only thing holding
     * the cap up: 1 * 2 = 2 allowance, and 2 divided by 7 floors to 0, so the cap is
     * the floor of 1. The gift is therefore 1 whole token, which posts as 10000
     * at four places.
     */
    const snap = scaled(4);
    snap.variables["gratitude.base_budget"] = "1";
    const model = economicsModel({ ...ONE_QUEST, gratitudeAllowanceGivenShare: 1 });
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    const memo = readEconomicsMemo(stepped)!;
    expect(memo.allowanceTotal).toBe(BigInt(4));
    expect(memo.gratitudeGiven).toBe(BigInt(2));
    expect(stepped.balances["mem:u1"].gratitude).toBe(BigInt(10000));
  });

  it("splits the pool by the human figure the settlement reads", () => {
    /*
     * The close reads `gratitude_log` (`settleCycle`,
     * server/lib/gratitude-cycles.ts:202), whose `amount` column is human, and
     * `gratitude_log.amount` is NOT backfilled by the flip migration, so it
     * does not move scale. The ratio is unit-free, so the shares come out the
     * same either way; asserting it at two scales is what proves the model is
     * reading the human figure and not the balance.
     */
    const model = economicsModel({ ...ONE_QUEST, gratitudeAllowanceGivenShare: 1 });
    const deep = readEconomicsMemo(model.step(initialState(scaled(4)), 1, makeRng(SEED)))!;
    const flat = readEconomicsMemo(model.step(initialState(scaled(0)), 1, makeRng(SEED)))!;
    // 1000 credits (shared/gameVariables.ts:117), halved, at both scales.
    expect(deep.poolDistributed).toBe(BigInt(1000));
    expect(flat.poolDistributed).toBe(deep.poolDistributed);
    expect(deep.poolRemainder).toBe(BigInt(0));
  });

  it("compares the pool against an allowance in the same units", () => {
    /*
     * `econ_pool_exhausts` weighs `allowanceTotal` against
     * `gratitude.pool_per_cycle`. While the allowance was scaled by 10^decimals
     * and the pool was not, that sentence compared two different units and
     * cried exhaustion on a village that was fine. Both are the dial's own
     * whole numbers now.
     */
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(scaled(4)), 1, makeRng(SEED));
    // 420 of allowance against a pool of 1000.
    expect(readEconomicsMemo(stepped)!.allowanceTotal).toBe(BigInt(420));
    expect(readEconomicsMemo(stepped)!.poolSize).toBe(BigInt(1000));
    const exhausts = model.flags(stepped, 1).filter((f) => f.code === "econ_pool_exhausts");
    expect(exhausts.map((f) => f.sentence).join(" ")).not.toContain("worth less than one minor unit");
  });
});

describe("economics model, determinism", () => {
  it("answers the same state twice from the same seed", () => {
    const snap = snapshot("lunar");
    const model = economicsModel({ ...ONE_QUEST, questRateMultiplier: 1.5 });
    const first = model.step(initialState(snap), 1, makeRng(SEED));
    const second = model.step(initialState(snap), 1, makeRng(SEED));
    const shape = (s: SimState) => JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? `${String(v)}n` : v));
    expect(shape(second)).toBe(shape(first));
    expect(shape(first)).toContain("mem:u1");
  });

  it("mutates nothing it was handed", () => {
    const snap = snapshot("lunar");
    const before = initialState(snap);
    const frozen = JSON.stringify(before, (_k, v) => (typeof v === "bigint" ? `${String(v)}n` : v));
    economicsModel(ONE_QUEST).step(before, 1, makeRng(SEED));
    expect(JSON.stringify(before, (_k, v) => (typeof v === "bigint" ? `${String(v)}n` : v))).toBe(frozen);
    expect(before.atIso).toBe(AT_ISO);
    expect(before.models[ECONOMICS_KEY]).toBeUndefined();
  });
});

describe("economics model, flags", () => {
  it("reports the whole allowance expiring in a village of one", () => {
    const { model, stepped } = runOneCycle("lunar");
    const flags = model.flags(stepped, 1);
    const expired = flags.filter((f) => f.code === "econ_gratitude_expired");
    expect(expired).toHaveLength(1);
    /*
     * The allowance is `Math.round(numberVar("gratitude.base_budget") *
     * stageMultiplier)` (`allowanceFor`, server/lib/economy.ts:628). The base
     * budget defaults to 105 and the multiplier
     * for `member` is `progression.multiplier.member`, generated from
     * GAME_CONFIG.stages with the stage's own `gratitudeMultiplier` of 2
     * (shared/gameVariables.ts:1707, shared/gameConfig.ts:429). So 210, and
     * recognition has no decimals, so 210 minor units.
     */
    expect(readEconomicsMemo(stepped)!.allowanceTotal).toBe(BigInt(210));
    expect(readEconomicsMemo(stepped)!.gratitudeExpired).toBe(BigInt(210));
    expect(expired[0].sentence).toContain("210");
    // `checkGive` refuses a gift to yourself (economy.ts:706), so one member
    // can never spend a point of it.
    expect(expired[0].actionable).toContain("themselves");
  });

  it("says the pool is set in whole tokens when the pool token holds decimals", () => {
    const { model, stepped } = runOneCycle("lunar", { "gratitude.pool_token": "village-voice" });
    const flags = model.flags(stepped, 1);
    const pool = flags.filter((f) => f.code === "econ_pool_in_whole_tokens");
    expect(pool).toHaveLength(1);
    // gratitude.pool_per_cycle defaults to 1000 (shared/gameVariables.ts:117)
    // and the close hands that number straight to `postTransfer`
    // (server/index.ts:21444), which reads it as minor units.
    expect(pool[0].sentence).toContain("1.000");
    expect(pool[0].severity).toBe("danger");
    // And the default pool token has no decimals, so a default village is clear.
    const clean = runOneCycle("lunar");
    expect(clean.model.flags(clean.stepped, 1).map((f) => f.code)).not.toContain("econ_pool_in_whole_tokens");
  });

  it("names a rule that can never pay", () => {
    const snap = snapshot("lunar");
    snap.mintRules = snap.mintRules.concat([
      {
        id: "rule-quest.completed-hypha-mirror",
        trigger: "quest.completed",
        tokenSlug: "voice",
        recipient: "claimant",
        amount: BigInt(5),
        amountRaw: "5.0000",
        ceiling: BigInt(50),
        ceilingRaw: "50.0000",
        enabled: true,
      },
      {
        id: "rule-quest.completed-from-source",
        trigger: "quest.completed",
        tokenSlug: "credits",
        recipient: "claimant",
        amount: null,
        amountRaw: "",
        ceiling: BigInt(50),
        ceilingRaw: "50.0000",
        enabled: true,
      },
    ]);
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    const flags = model.flags(stepped, 1);
    const cannotPay = flags.filter((f) => f.code === "econ_rule_cannot_pay");
    // `ruleCannotPay` (economy.ts:1059) refuses a Hypha-governed token before
    // it ever asks about a faucet. The from_source rule is the refusal at
    // economy.ts:1147.
    expect(cannotPay.map((f) => f.sentence).join(" ")).toContain("governed on Hypha");
    expect(cannotPay.map((f) => f.sentence).join(" ")).toContain("reads its amount from the work");
    for (const flag of flags) expect(typeof flag.sentence).toBe("string");
    // Nothing was paid in the token the engine cannot issue.
    expect(stepped.balances["mem:u1"].voice).toBeUndefined();
  });

  it("says exactly what a rule was written as and what it actually pays", () => {
    /*
     * `mint_rules.amount` is `decimal(18,4)` (drizzle/0071_economy_core.sql:51)
     * and `toLedgerUnits` (economy.ts:154) is
     * `Math.round(human * 10 ** decimals)`. So on village-voice at 3 places:
     *   0.0004 -> round(0.4) = 0     the rule is enabled and pays nobody
     *   0.0006 -> round(0.6) = 1     the rule pays 0.001, not what was written
     *   0.0000 -> a deliberate zero, which economy.ts:1166 passes over in
     *             silence, so this preview stays silent about it too
     */
    expect(writtenAmount("0.0004", 3)!.rounded).toBe(BigInt(0));
    expect(writtenAmount("0.0004", 3)!.exact).toBe(false);
    expect(writtenAmount("0.0006", 3)!.rounded).toBe(BigInt(1));
    expect(writtenAmount("10.0000", 3)!.exact).toBe(true);
    expect(writtenAmount("25.0000", 0)!.rounded).toBe(BigInt(25));
    expect(writtenAmount("", 3)).toBeNull();

    /*
     * A BOUND FALLS. An amount rounds, because the nearest payable figure is
     * what a payment means; a cap rounded UP is a cap nobody voted for.
     *
     * 10.31: the model read a cap through the same rounding a payment uses, so
     * a village writing 0.5 on a whole-unit token had it read as 1 and the
     * preview promised twice the cap. The engine floors in `ceilingAtScale`;
     * these three rows are the model answering the same way. Each goes red
     * against the rounded reading with the number the adversary measured.
     */
    expect(writtenAmount("0.5", 0)!.floored).toBe(BigInt(0));
    expect(writtenAmount("0.5", 0)!.rounded).toBe(BigInt(1));
    expect(writtenAmount("25.5", 0)!.floored).toBe(BigInt(25));
    expect(writtenAmount("0.0005", 3)!.floored).toBe(BigInt(0));
    expect(writtenAmount("0.29", 2)!.floored).toBe(BigInt(29));

    const capped = (ceilingRaw: string, ceiling: bigint, decimals: number) =>
      ceilingOutcomeMinor(
        {
          id: "m-floor",
          trigger: "quest.completed",
          tokenSlug: "credits",
          amount: null,
          amountRaw: "",
          ceiling,
          ceilingRaw,
          recipient: "claimant",
          enabled: true,
        } as MintRuleSpec,
        BigInt(9),
        decimals,
      );
    // 0.6 asked against a 0.5 cap on a whole-unit token: the engine posts 0 and
    // refuses. Read as rounded, the model paid 1, which is twice the cap.
    expect(capped("0.5", BigInt(1), 0).paid).toBe(BigInt(0));
    expect(capped("25.5", BigInt(26), 0).paid).toBe(BigInt(9));
    expect(capped("0.0005", BigInt(1), 3).paid).toBe(BigInt(0));

    const snap = snapshot("lunar");
    snap.mintRules = snap.mintRules.concat([
      {
        id: "rule-quest.completed-dust",
        trigger: "quest.completed",
        tokenSlug: "stay-credit",
        recipient: "claimant",
        amount: BigInt(0),
        amountRaw: "0.0004",
        ceiling: BigInt(50),
        ceilingRaw: "50.0000",
        enabled: true,
      },
      {
        id: "rule-quest.completed-nearly",
        trigger: "quest.completed",
        tokenSlug: "library-credit",
        recipient: "claimant",
        amount: BigInt(0),
        amountRaw: "0.0000",
        ceiling: BigInt(50),
        ceilingRaw: "50.0000",
        enabled: true,
      },
    ]);
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    const rounds = model.flags(stepped, 1).filter((f) => f.code === "econ_amount_rounds_away");
    // Exactly one: the dust rule. The deliberate zero is a decision and stays
    // quiet, which is the whole reason `amountRaw` is on the contract.
    expect(rounds).toHaveLength(1);
    expect(rounds[0].sentence).toContain("written as 0.0004 stay-credit");
    expect(rounds[0].sentence).toContain("what actually pays is 0");
    expect(rounds[0].severity).toBe("warning");
    expect(stepped.balances["mem:u1"]["stay-credit"]).toBeUndefined();
    expect(stepped.balances["mem:u1"]["library-credit"]).toBeUndefined();
  });

  it("names a faucet account the ledger does not hold", () => {
    const snap = snapshot("lunar");
    delete snap.balances["sys:voice-mint"];
    const model = economicsModel(ONE_QUEST);
    const flags = model.flags(initialState(snap), 0);
    const missing = flags.filter((f) => f.code === "econ_faucet_account_missing");
    expect(missing).toHaveLength(1);
    expect(missing[0].sentence).toContain("sys:voice-mint");
  });

  it("names a member at a stage the ladder does not carry", () => {
    const snap = snapshot("lunar");
    expect(VARIABLES_BY_KEY["progression.multiplier.resident"]).toBeUndefined();
    snap.members = [{ id: "u1", accountId: "mem:u1", stage: "resident", seats: [] }];
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    const flags = model.flags(stepped, 1);
    const unknown = flags.filter((f) => f.code === "econ_stage_no_multiplier");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].sentence).toContain("resident");
    expect(unknown[0].severity).toBe("danger");
    // The quest still pays: the stage only decides the giving allowance.
    expect(stepped.balances["mem:u1"].credits).toBe(BigInt(25));
  });

  it("says nothing is issued at all while the village has not started its Game", () => {
    const snap = snapshot("lunar");
    // Read off the snapshot now, never assumed. `issuanceRefusal`
    // (server/lib/gameStart.ts:150) refuses every posting out of a faucet until
    // the launch vote carries, and `postTransfer` asks it on every faucet leg
    // (server/lib/ledger.ts:416).
    snap.launched = false;
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    expect(nonZero(stepped)).toEqual([]);
    expect(model.flags(stepped, 1).map((f) => f.code)).toContain("econ_issuance_closed");
    expect(readEconomicsMemo(stepped)!.issuanceRefusals).toBe(2);
    expect(readEconomicsMemo(stepped)!.launched).toBe(false);
  });

  it("lets eleven occurrences issue eleven times the amount, because the cap is per occurrence", () => {
    const snap = snapshot("lunar");
    /*
     * `ceilingOutcome` (server/lib/economy.ts:590) bounds ONE OCCURRENCE. There
     * is deliberately no "issued so far this cycle" argument, so eleven quests
     * at 25 under a ceiling of 250 issue 275 and every one of them is correct.
     * The old reading here measured a cycle total against the ceiling and was
     * wrong about what the column means.
     */
    const model = economicsModel({ ...ONE_QUEST, questRateMultiplier: 11 });
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    expect(readEconomicsMemo(stepped)!.questsConfirmed).toBe(11);
    expect(stepped.balances["mem:u1"].credits).toBe(BigInt(275));
    const codes = model.flags(stepped, 1).map((f) => f.code);
    expect(codes).not.toContain("econ_rule_contradicts_ceiling");
    expect(codes).not.toContain("econ_rule_ceiling_zero");
  });

  it("says so when a rule's amount is above its own ceiling", () => {
    const snap = snapshot("lunar");
    // The shape a ballot leaves behind when it lowers only the ceiling.
    snap.mintRules = snap.mintRules.map((r) =>
      r.id === "rule-quest.completed-credits" ? { ...r, ceiling: BigInt(5), ceilingRaw: "5.0000", amount: BigInt(25) } : r,
    );
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    // min(25, 5) = 5, and the clamp happens before the ledger sees it.
    expect(stepped.balances["mem:u1"].credits).toBe(BigInt(5));
    const flag = model.flags(stepped, 1).filter((f) => f.code === "econ_rule_contradicts_ceiling")[0];
    expect(flag.severity).toBe("warning");
    expect(flag.sentence).toContain("says it pays 25 credits and caps one occurrence at 5");
    expect(flag.actionable).toContain("Raise the ceiling to 25");
    expect(readEconomicsMemo(stepped)!.rules.filter((r) => r.tokenSlug === "credits")[0].clampedAway).toBe(
      BigInt(20),
    );
  });

  it("refuses a rule whose ceiling is zero, in the engine's own words", () => {
    const snap = snapshot("lunar");
    snap.mintRules = snap.mintRules.map((r) =>
      r.id === "rule-quest.completed-credits" ? { ...r, ceiling: BigInt(0), ceilingRaw: "0.0000" } : r,
    );
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    expect(stepped.balances["mem:u1"].credits).toBeUndefined();
    // The voice rule is untouched and still pays.
    expect(stepped.balances["mem:u1"]["village-voice"]).toBe(BigInt(10000));
    const flag = model.flags(stepped, 1).filter((f) => f.code === "econ_rule_ceiling_zero")[0];
    expect(flag.sentence).toContain("this rule's ceiling is 0, so it can pay no credits at all");
    expect(flag.sentence).toContain("Raise the ceiling or pause the rule");
    // And it lands in the same unpayable list ruleCannotPay feeds.
    const unpayable = readEconomicsMemo(stepped)!.unpayable;
    expect(unpayable.map((u) => u.reason).join(" ")).toContain("can pay no credits at all");
  });

  it("tells a cap of nothing from a cap typed below what the token can hold", () => {
    /*
     * BOTH VILLAGES ARRIVE HOLDING `ceiling: BigInt(0)`, and only
     * `MintRuleSpec.ceilingRaw` tells them apart.
     *
     * "0.0000" is a decision. `ceilingOutcome` (server/lib/economy.ts:590)
     * finds `ceiling <= 0` and refuses every occurrence, out loud.
     *
     * "0.0004" on a token with no decimal places is a typo. The engine reads
     * 0.0004, finds it ABOVE zero, so it does not refuse: `clampToCeiling`
     * (economy.ts:534) returns `min(25, 0.0004)` = 0.0004, and
     * `toLedgerUnits` (economy.ts:154) then rounds that to 0, which the mint
     * path reports as smaller than the token can hold (economy.ts:1377).
     * Reading the second as the first would turn a fat-fingered cap into a
     * total stop and preview a village nobody voted for.
     */
    const withCeiling = (raw: string, minor: bigint) => {
      const snap = snapshot("lunar");
      snap.mintRules = snap.mintRules.map((r) =>
        r.id === "rule-quest.completed-credits" ? { ...r, ceiling: minor, ceilingRaw: raw } : r,
      );
      const model = economicsModel(ONE_QUEST);
      const stepped = model.step(initialState(snap), 1, makeRng(SEED));
      return { model, stepped, codes: model.flags(stepped, 1).map((f) => f.code), flags: model.flags(stepped, 1) };
    };

    // A cap of nothing: the refusal, and never the rounds-away sentence.
    const decided = withCeiling("0.0000", BigInt(0));
    expect(decided.codes).toContain("econ_rule_ceiling_zero");
    expect(decided.codes).not.toContain("econ_ceiling_rounds_away");

    // A cap below the resolution: the rounds-away sentence, and never the refusal.
    const typo = withCeiling("0.0004", BigInt(0));
    expect(typo.codes).toContain("econ_ceiling_rounds_away");
    expect(typo.codes).not.toContain("econ_rule_ceiling_zero");
    const rounds = typo.flags.filter((f) => f.code === "econ_ceiling_rounds_away")[0];
    expect(rounds.severity).toBe("warning");
    expect(rounds.sentence).toContain("caps one occurrence at 0.0004 credits");
    expect(rounds.sentence).toContain("credits holds 0 decimal place(s)");
    expect(rounds.actionable).toContain("Write a ceiling of at least 1");

    // Neither one pays, and each says why in the engine's own words.
    expect(decided.stepped.balances["mem:u1"].credits).toBeUndefined();
    expect(typo.stepped.balances["mem:u1"].credits).toBeUndefined();
    const saidOf = (r: ReturnType<typeof withCeiling>) =>
      readEconomicsMemo(r.stepped)!.unpayable.map((u) => u.reason).join(" | ");
    expect(saidOf(decided)).toContain("this rule's ceiling is 0, so it can pay no credits at all");
    expect(saidOf(typo)).toContain("0.0004 is smaller than the smallest amount this token can hold");
    expect(saidOf(typo)).not.toContain("can pay no credits at all");

    // The voice rule is untouched in both, so this is about the ceiling and
    // never about the cycle failing.
    expect(decided.stepped.balances["mem:u1"]["village-voice"]).toBe(BigInt(10000));
    expect(typo.stepped.balances["mem:u1"]["village-voice"]).toBe(BigInt(10000));
  });

  it("refuses a cap the token cannot hold, and says so, where it used to round it up into a payment", () => {
    /*
     * REWRITTEN AT 10.31, AND THE OLD ASSERTION WAS THE DEFECT WRITTEN DOWN.
     *
     * This case used to read: "`toLedgerUnits` rounds half UP, so on
     * village-voice at three places 0.0006 becomes 1 thousandth and the cap is
     * real. Nothing is flagged, because nothing is wrong." It asserted a
     * payment of 1 and asserted that `econ_ceiling_rounds_away` must NOT fire.
     *
     * Something was wrong. 0.0006 is BELOW the smallest amount a token with
     * three places can express, and rounding a BOUND up hands the member more
     * than the village wrote. An amount rounds, because the nearest payable
     * figure is what a payment means; a bound may only ever fall. The engine
     * settled this in `ceilingAtScale`, and a preview that answered the old way
     * would promise a payout the run refuses.
     *
     * So the cap arrives as nothing, the rule pays nobody, and the flag that
     * exists for exactly this case fires and names the smallest cap that would
     * work. That is the whole point of `econ_ceiling_rounds_away`: the previous
     * assertion required it to stay silent on the one input it was written for.
     */
    const snap = snapshot("lunar");
    snap.mintRules = snap.mintRules.map((r) =>
      r.id === "rule-quest.completed-village-voice" ? { ...r, ceiling: BigInt(1), ceilingRaw: "0.0006" } : r,
    );
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    expect(stepped.balances["mem:u1"]?.["village-voice"] ?? BigInt(0)).toBe(BigInt(0));
    const flags = model.flags(stepped, 1);
    const codes = flags.map((f) => f.code);
    expect(codes).toContain("econ_ceiling_rounds_away");
    expect(codes).not.toContain("econ_rule_ceiling_zero");
    // And it names the smallest cap that would actually pay, so the village is
    // told what to write and not merely that what it wrote is wrong.
    expect(flags.find((f) => f.code === "econ_ceiling_rounds_away")!.actionable).toContain("0.001");
  });

  it("keeps a cap that survives the scale, down to the smallest unit the token holds", () => {
    /*
     * The boundary on the other side, and the one that proves the rule above is
     * a scale rule and not a refusal of small caps. "0.0010" IS expressible at
     * three places, so the cap is real, it clamps the rule's own 10.0000 down to
     * one thousandth, and nothing about the scale is flagged.
     */
    const snap = snapshot("lunar");
    snap.mintRules = snap.mintRules.map((r) =>
      r.id === "rule-quest.completed-village-voice" ? { ...r, ceiling: BigInt(1), ceilingRaw: "0.0010" } : r,
    );
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    expect(stepped.balances["mem:u1"]["village-voice"]).toBe(BigInt(1));
    const codes = model.flags(stepped, 1).map((f) => f.code);
    expect(codes).not.toContain("econ_ceiling_rounds_away");
    expect(codes).not.toContain("econ_rule_ceiling_zero");
    // It does contradict its own amount, which is a different and true thing.
    expect(codes).toContain("econ_rule_contradicts_ceiling");
  });

  it("survives a malformed spec that pairs a real cap of zero with no text", () => {
    /*
     * DELIBERATELY MALFORMED, AND NO CONFORMING READER EMITS IT.
     *
     * `types.ts` pairs an empty `ceilingRaw` with `ceiling: null`, and the two
     * together mean NO CAP. `ceiling: BigInt(0)` is a different fact: a real
     * cap of nothing. So this fixture asserts both at once, which no snapshot
     * reader can do, because the economy reader keys both fields off one null
     * check and emits them as a pair.
     *
     * It is here anyway, and that is the point. `writtenCeiling` carries a
     * fallback for a spec arriving with no text, and a fallback nothing
     * exercises is a fallback nobody can trust. The safe answer with no text to
     * read is the old one: a cap that rounded to nothing is treated as a cap of
     * nothing, which stops a payout rather than letting one through. This test
     * pins that, and it is the ONLY place in this file that builds a spec the
     * contract does not describe.
     */
    const snap = snapshot("lunar");
    snap.mintRules = snap.mintRules.map((r) =>
      // Malformed on purpose: a real cap of zero beside the empty text that
      // means no cap. See the block above.
      r.id === "rule-quest.completed-credits" ? { ...r, ceiling: BigInt(0), ceilingRaw: "" } : r,
    );
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    expect(model.flags(stepped, 1).map((f) => f.code)).toContain("econ_rule_ceiling_zero");
    expect(stepped.balances["mem:u1"].credits).toBeUndefined();
  });

  it("pays a seat holder from the role.cycle rules and a seatless member nothing", () => {
    const seatless = runOneCycle("lunar");
    expect(seatless.stepped.balances["mem:u1"].credits).toBe(BigInt(25));

    const snap = snapshot("lunar");
    snap.members = [{ id: "u1", accountId: "mem:u1", stage: "member", seats: ["seat-1"] }];
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    /*
     * `runSettlement` (server/lib/economy.ts:1297) pays every payable
     * `role.cycle` rule once per live seat (economy.ts:1354). The defaults are
     * 50 village voice and 25 credits (economySeed.ts:162,163), so one seat
     * adds 50000 thousandths and 25 credits on top of the quest's 10000 and 25.
     * The disabled gratitude rule (economySeed.ts:165) pays nothing.
     */
    expect(stepped.balances["mem:u1"]["village-voice"]).toBe(BigInt(60000));
    expect(stepped.balances["mem:u1"].credits).toBe(BigInt(50));
    expect(stepped.balances["mem:u1"].gratitude).toBeUndefined();
    expect(model.invariants(stepped)).toEqual([]);
  });
});

describe("the ceiling mirror, held to the engine's own table", () => {
  /*
   * MIRRORED BY TABLE, never by import. `ceilingOutcome` lives in
   * server/lib/economy.ts:590 and `shared/dryRun/` may not name anything under
   * `server/`, which the import-graph test at the bottom of this file enforces
   * from disk. So the copy in economicsModel.ts is held to the original by
   * asserting the SAME EIGHT ROWS that function's own test asserts. A drift
   * between the two shows up here as a red row, which is the only place a
   * copied arithmetic can honestly be checked from this side of the wall.
   *
   * The semantics, from the schema and the copy: the ceiling bounds ONE
   * OCCURRENCE, in the rule's own human units, clamped before `toLedgerUnits`.
   * Never per cycle, never per member, no running total, no window.
   */
  const rows: Array<{ amount: number | null; ceiling: number; posted: number; paid: number; refuses: boolean }> = [
    { amount: 25, ceiling: 250, posted: 0, paid: 25, refuses: false },
    { amount: 25, ceiling: 5, posted: 0, paid: 5, refuses: false },
    { amount: 25, ceiling: 25, posted: 0, paid: 25, refuses: false },
    { amount: 25, ceiling: 0, posted: 0, paid: 0, refuses: true },
    { amount: 0, ceiling: 250, posted: 0, paid: 0, refuses: false },
    { amount: null, ceiling: 100, posted: 40, paid: 40, refuses: false },
    { amount: null, ceiling: 100, posted: 4000, paid: 100, refuses: false },
    { amount: null, ceiling: 0, posted: 40, paid: 0, refuses: true },
  ];

  it("answers every row exactly as the engine's ceilingOutcome does", () => {
    for (const row of rows) {
      const label = `amount ${String(row.amount)} ceiling ${row.ceiling} posted ${row.posted}`;
      const got = ceilingOutcome({ amount: row.amount, ceiling: row.ceiling, tokenSlug: "credits" }, row.posted);
      expect(`${label} -> ${got.paid}`).toBe(`${label} -> ${row.paid}`);
      expect(`${label} -> refuses ${got.refusal !== null}`).toBe(`${label} -> refuses ${row.refuses}`);
    }
  });

  it("words the refusal the way a founder reads it in the Mint panel", () => {
    const refused = ceilingOutcome({ amount: 25, ceiling: 0, tokenSlug: "credits" }, 0, "Village Credits");
    expect(refused.refusal).toBe(
      "this rule's ceiling is 0, so it can pay no Village Credits at all. Raise the ceiling or pause the rule",
    );
    // With no token name it falls back to the slug, exactly as the engine does.
    expect(ceilingOutcome({ amount: 25, ceiling: 0, tokenSlug: "credits" }, 0).refusal).toContain("no credits at all");
  });

  it("clamps the same answer in minor units as in human units", () => {
    /*
     * The model holds bigint minor units and the engine clamps human units
     * before `toLedgerUnits`. The two agree because `Math.round` is monotone:
     * `round(min(a, c) * s)` equals `min(round(a * s), round(c * s))`. Proved
     * here on village-voice, whose scale is 1000 (VOICE_DECIMALS, economy.ts:151).
     */
    const snap = snapshot("lunar");
    snap.mintRules = snap.mintRules.map((r) =>
      r.id === "rule-quest.completed-village-voice" ? { ...r, ceiling: BigInt(2500), ceilingRaw: "2.5000", amount: BigInt(10000) } : r,
    );
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    // Human: min(10, 2.5) = 2.5 -> toLedgerUnits -> 2500.
    const human = ceilingOutcome({ amount: 10, ceiling: 2.5, tokenSlug: "village-voice" }, 0).paid;
    expect(Math.round(human * 1000)).toBe(2500);
    expect(stepped.balances["mem:u1"]["village-voice"]).toBe(BigInt(2500));
  });
});

describe("economics model, concentration", () => {
  /** Three members, two seats on one of them, and no quests to muddy it. */
  function seatedVillage(): VillageSnapshot {
    const snap = snapshot("lunar");
    snap.quests = { open: 0, confirmedPerCycle: 0, gratitudePerConfirmation: BigInt(0) };
    snap.balances["mem:u2"] = {};
    snap.balances["mem:u3"] = {};
    snap.members = [
      { id: "u1", accountId: "mem:u1", stage: "member", seats: ["seat-1", "seat-2"] },
      { id: "u2", accountId: "mem:u2", stage: "member", seats: ["seat-3"] },
      { id: "u3", accountId: "mem:u3", stage: "member", seats: [] },
    ];
    return snap;
  }

  it("names the largest holder and the top three, and never blocks", () => {
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(seatedVillage()), 1, makeRng(SEED));
    const memo = readEconomicsMemo(stepped)!;
    /*
     * `runSettlement` pays 50 village voice per SEAT (economySeed.ts:162), so
     * u1 with two seats holds 100000 thousandths, u2 with one holds 50000 and
     * u3 holds nothing. 100000 of 150000 is two thirds.
     */
    expect(memo.voiceTotal).toBe(BigInt(150000));
    const byId: Record<string, number> = {};
    for (const s of memo.voiceShares) byId[s.memberId] = s.share;
    expect(byId.u1).toBeCloseTo(2 / 3, 10);
    expect(byId.u2).toBeCloseTo(1 / 3, 10);
    expect(byId.u3).toBe(0);

    // The shares come from shared/governanceShare.ts and never from a second
    // copy of that division: the same weights through `shareOfTotal` answer
    // the same thing.
    const weights = new Map<string, bigint>([
      ["u1", BigInt(100000)],
      ["u2", BigInt(50000)],
      ["u3", BigInt(0)],
    ]);
    const direct = shareOfTotal(weights);
    expect(byId.u1).toBe(direct.get("u1"));
    expect(byId.u2).toBe(direct.get("u2"));

    const flags = model.flags(stepped, 1);
    const conc = flags.filter((f) => f.code === "econ_voice_concentration");
    expect(conc).toHaveLength(1);
    expect(conc[0].severity).toBe("warning");
    expect(conc[0].sentence).toContain("u1 holds 66.7%");
    expect(conc[0].sentence).toContain("u2 holds 33.3%");
    expect(conc[0].sentence).toContain("u3 holds 0.0%");
    expect(conc[0].actionable).toBeTruthy();
    // Transparency is the protection: a warning is never a violation, so the
    // run carries on.
    expect(model.invariants(stepped)).toEqual([]);
  });

  it("says so when that share is also voting power", () => {
    const model = economicsModel(ONE_QUEST);
    const snap = seatedVillage();
    // governance.weight_mode defaults to `equal` and weight_token to
    // `gratitude` (shared/gameVariables.ts:475,489). A village that weighs
    // votes by Voice is a village where this share IS the ballot.
    snap.variables["governance.weight_mode"] = "token";
    snap.variables["governance.weight_token"] = "village-voice";
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    const conc = model.flags(stepped, 1).filter((f) => f.code === "econ_voice_concentration")[0];
    expect(conc.actionable).toContain("also voting power");

    const quiet = model.step(initialState(seatedVillage()), 1, makeRng(SEED));
    const other = model.flags(quiet, 1).filter((f) => f.code === "econ_voice_concentration")[0];
    expect(other.actionable).not.toContain("also voting power");
  });

  it("attributes a seat's Voice to the member who answers for it", () => {
    const snap = snapshot("lunar");
    snap.quests = { open: 0, confirmedPerCycle: 0, gratitudePerConfirmation: BigInt(0) };
    snap.balances["mem:u2"] = {};
    snap.members = [
      { id: "u1", accountId: "mem:u1", stage: "member", seats: ["seat-1"] },
      // `MemberSpec.isRepresentative` says this member answers on somebody
      // else's behalf, and `representsSeatId` says on which seat's.
      { id: "u2", accountId: "mem:u2", stage: "member", seats: [], isRepresentative: true, representsSeatId: "seat-1" },
    ];
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    const memo = readEconomicsMemo(stepped)!;
    // The LEDGER pays the holder: `runSettlement` posts to `seat.user_id`
    // (server/lib/economy.ts:1355), so the balance sits with u1.
    expect(stepped.balances["mem:u1"]["village-voice"]).toBe(BigInt(50000));
    expect(stepped.balances["mem:u2"]["village-voice"]).toBeUndefined();
    expect(memo.seatVoice["seat-1"]).toBe(BigInt(50000));
    // CONCENTRATION counts it where the answer comes from.
    const byId: Record<string, bigint> = {};
    for (const s of memo.voiceShares) byId[s.memberId] = s.minor;
    expect(byId.u1).toBe(BigInt(0));
    expect(byId.u2).toBe(BigInt(50000));
    const conc = model.flags(stepped, 1).filter((f) => f.code === "econ_voice_concentration")[0];
    expect(conc.sentence).toContain("u2 holds 100.0%");
  });

  it("stays quiet when nobody holds any Voice at all", () => {
    const snap = snapshot("lunar");
    snap.quests = { open: 0, confirmedPerCycle: 0, gratitudePerConfirmation: BigInt(0) };
    const model = economicsModel(ONE_QUEST);
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    expect(readEconomicsMemo(stepped)!.voiceTotal).toBe(BigInt(0));
    expect(model.flags(stepped, 1).map((f) => f.code)).not.toContain("econ_voice_concentration");
  });
});

describe("economics assumptions", () => {
  it("defaults to the cautious village and prints every one of them", () => {
    const sentences = describeAssumptions(DEFAULT_ECONOMICS_ASSUMPTIONS);
    expect(sentences).toHaveLength(4);
    for (const s of sentences) expect(s.length).toBeGreaterThan(20);
    expect(sentences.join(" ")).toContain("expires unused");
    // With the observations, two more lines, both labelled.
    const withFacts = describeAssumptions(DEFAULT_ECONOMICS_ASSUMPTIONS, quests(), true);
    expect(withFacts).toHaveLength(6);
    expect(withFacts[4]).toContain("Measured, never assumed");
    expect(withFacts[5]).toContain("started its Game");
  });

  it("is total over any input the engine might hand it", () => {
    expect(parseEconomicsAssumptions(undefined)).toEqual(DEFAULT_ECONOMICS_ASSUMPTIONS);
    expect(parseEconomicsAssumptions(null)).toEqual(DEFAULT_ECONOMICS_ASSUMPTIONS);
    expect(parseEconomicsAssumptions("nonsense")).toEqual(DEFAULT_ECONOMICS_ASSUMPTIONS);
    expect(parseEconomicsAssumptions({ questRateMultiplier: "oops" })).toEqual(DEFAULT_ECONOMICS_ASSUMPTIONS);
    expect(parseEconomicsAssumptions({ gratitudeAllowanceGivenShare: 9 }).gratitudeAllowanceGivenShare).toBe(1);
    expect(parseEconomicsAssumptions({ gratitudeAllowanceGivenShare: -3 }).gratitudeAllowanceGivenShare).toBe(0);
    expect(parseEconomicsAssumptions({ sinkSpendPerMemberPerCycle: "42" }).sinkSpendPerMemberPerCycle).toBe(
      BigInt(42),
    );
    expect(parseEconomicsAssumptions({ poolClosedEachCycle: "false" }).poolClosedEachCycle).toBe(false);
    // The fallback is a parameter, so a caller supplying half an object gets
    // the model's own numbers for the other half.
    const mine = { ...DEFAULT_ECONOMICS_ASSUMPTIONS, questRateMultiplier: 7, poolClosedEachCycle: false };
    const merged = parseEconomicsAssumptions({ gratitudeAllowanceGivenShare: 0.25 }, mine);
    expect(merged.questRateMultiplier).toBe(7);
    expect(merged.poolClosedEachCycle).toBe(false);
    expect(merged.gratitudeAllowanceGivenShare).toBe(0.25);
  });

  it("gives recognition away only when somebody else can receive it", () => {
    const snap = snapshot("lunar");
    // Two members, and a measured rate of two confirmations so each gets one.
    snap.quests = { open: 2, confirmedPerCycle: 2, gratitudePerConfirmation: BigInt(0) };
    snap.balances["mem:u2"] = {};
    snap.members = [
      { id: "u1", accountId: "mem:u1", stage: "member", seats: [] },
      { id: "u2", accountId: "mem:u2", stage: "member", seats: [] },
    ];
    const model = economicsModel({ ...ONE_QUEST, gratitudeAllowanceGivenShare: 1 });
    const stepped = model.step(initialState(snap), 1, makeRng(SEED));
    const memo = readEconomicsMemo(stepped)!;
    /*
     * Two members, each with an allowance of 210 (see above), each giving all
     * of it. `shareCapFor` is the allowance divided by
     * `gratitude.full_sends_per_cycle`, floored and never below 1, and that
     * count defaults to 7, so 30 to any one
     * person. There is exactly one other person, so each giver places 30 and
     * 180 of each allowance expires. `give` (economy.ts:981) mints the
     * recognition fresh from the recognition faucet to the RECEIVER.
     */
    expect(memo.allowanceTotal).toBe(BigInt(420));
    expect(memo.gratitudeGiven).toBe(BigInt(60));
    expect(memo.gratitudeExpired).toBe(BigInt(360));
    expect(stepped.balances["mem:u1"].gratitude).toBe(BigInt(30));
    expect(stepped.balances["mem:u2"].gratitude).toBe(BigInt(30));
    expect(stepped.balances["sys:gratitude-pool"].gratitude).toBe(BigInt(-60));
    // And the value pool follows the recognition, split by it and floored
    // (server/index.ts:21417). 1000 credits, halved.
    expect(memo.poolDistributed).toBe(BigInt(1000));
    expect(stepped.balances["mem:u1"].credits).toBe(BigInt(525));
    expect(model.invariants(stepped)).toEqual([]);
  });
});

describe("economics model, more than one cycle", () => {
  it("splits the pool by what was given THIS cycle, never by the balance", () => {
    const snap = snapshot("lunar");
    snap.quests = { open: 2, confirmedPerCycle: 2, gratitudePerConfirmation: BigInt(0) };
    snap.balances["mem:u2"] = {};
    snap.members = [
      { id: "u1", accountId: "mem:u1", stage: "member", seats: [] },
      { id: "u2", accountId: "mem:u2", stage: "member", seats: [] },
    ];
    const model = economicsModel({ ...ONE_QUEST, gratitudeAllowanceGivenShare: 1 });
    const result = simulate({ snapshot: snap, changes: [], cycles: 2, seed: SEED }, [model]);
    expect(result.violations).toEqual([]);
    const first = result.proposed[0].state;
    const second = result.proposed[1].state;
    /*
     * The close reads `gratitude_log` rows INSIDE the cycle window
     * (`settleCycle`, server/lib/gratitude-cycles.ts:202, called from
     * server/index.ts:21399 for each due cycle), so the split is by what was
     * given this cycle. Reading the balance instead would carry cycle 1's
     * recognition into cycle 2's denominator and pay the same gift twice.
     * Two cycles, 1000 credits released in each: 500 each per cycle.
     */
    expect(first.balances["mem:u1"].gratitude).toBe(BigInt(30));
    expect(second.balances["mem:u1"].gratitude).toBe(BigInt(60));
    expect(first.balances["mem:u1"].credits).toBe(BigInt(525));
    expect(second.balances["mem:u1"].credits).toBe(BigInt(1050));
    expect(second.balances["sys:cycle-pool"].credits).toBe(BigInt(-2100));
    expect(model.invariants(second)).toEqual([]);
  });

  it("moves the instant one boundary per cycle on each clock", () => {
    for (const mode of ["lunar", "calendar"] as ClockMode[]) {
      const model = economicsModel(ONE_QUEST);
      const clock = clockFor(mode);
      const result = simulate({ snapshot: snapshot(mode), changes: [], cycles: 3, seed: SEED }, [model]);
      expect(result.proposed).toHaveLength(3);
      expect(result.proposed[0].atIso).toBe(AT_ISO);
      expect(result.proposed[1].atIso).toBe(clock.nextBoundaryAfter(AT).toISOString());
      expect(result.proposed[2].atIso).toBe(
        clock.nextBoundaryAfter(clock.nextBoundaryAfter(AT)).toISOString(),
      );
      // The recorded state carries the cycle's own start, never the next one.
      expect(result.proposed[1].state.atIso).toBe(result.proposed[1].atIso);
      // Three quests paid, one a cycle.
      expect(result.proposed[2].state.balances["mem:u1"].credits).toBe(BigInt(75));
    }
  });
});

describe("the cardinal rule, as an import graph", () => {
  it("cannot reach anything under server/ and cannot reach mysql2", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, "..", "..");
    const entry = path.join(here, "economicsModel.ts");

    const seen: Record<string, true> = {};
    const bare: string[] = [];
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen[file]) continue;
      seen[file] = true;
      if (file.endsWith(".json")) continue;
      const text = fs.readFileSync(file, "utf8");
      const specifiers: string[] = [];
      for (const m of text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)) specifiers.push(m[1]);
      for (const m of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specifiers.push(m[1]);
      for (const spec of specifiers) {
        if (!spec.startsWith(".")) {
          bare.push(spec);
          continue;
        }
        const base = path.resolve(path.dirname(file), spec);
        const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, "index.ts")];
        const resolved = candidates.filter((c) => fs.existsSync(c) && fs.statSync(c).isFile())[0];
        expect(resolved, `unresolved import ${spec} from ${file}`).toBeTruthy();
        queue.push(resolved);
      }
    }

    const reached = Object.keys(seen).map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
    expect(reached.length).toBeGreaterThan(1);
    // governanceShare is now on the graph, and it must be as clean as the rest.
    expect(reached).toContain("shared/governanceShare.ts");
    for (const file of reached) {
      expect(file.startsWith("server/"), `${file} is under server/`).toBe(false);
      expect(file.startsWith("client/"), `${file} is under client/`).toBe(false);
    }
    expect(bare).not.toContain("mysql2");
    expect(bare).not.toContain("mysql2/promise");
    expect(bare.filter((b) => b.indexOf("mysql") >= 0)).toEqual([]);
  });
});
