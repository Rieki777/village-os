/**
 * The proposals domain logic, pinned: qualification composition, change-set
 * validation (ring, bounds, no-ops, duplicates, size), and the canonical
 * document carrying the [gm:] marker + machine-readable change-set the
 * bridge phase will match on-chain events against.
 */
import { describe, expect, it } from "vitest";
import {
  asChangeItem,
  naturalPriceFor,
  naturalTierFor,
  parseHyphaProposalId,
  priceChangeSet,
  pricingOf,
  proposerStanding,
  trialProblem,
  validateChangeSet,
  proposalMarkdown,
  displayChangeValue,
  CHANGE_SET_CAP,
  EXECUTABLE_ITEM_KINDS,
  type ChangeItem,
  type MintRuleValues,
} from "./mechanics";
import {
  CHANGE_ITEM_KINDS,
  GOVERNANCE_MODE,
  HIGHEST_TIER_KEY,
  MINT_RULE,
  thresholdSettingsFrom,
  TIER_SETTING_KEYS,
} from "../../shared/ballotSubjects";
import { TIER_FLOORS } from "../../shared/governanceEngine";
import { mintRuleKey, type MintRuleField } from "../../shared/mintRuleKeys";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";

// validateChangeSet only touches the pool for the cooldown query; with
// cooldownDays 0 it never dials out, so a throwing stub proves that too.
const noPool = new Proxy({}, { get: () => { throw new Error("pool must not be touched when cooldown is off"); } }) as any;

describe("proposer standing", () => {
  it("a badge deny closes everything — the remedy lever", () => {
    const s = proposerStanding(true, true, 10_000, 0);
    expect(s.denied).toBe(true);
    expect(s.qualified).toBe(false);
    expect(s.mayDraft).toBe(false);
  });

  it("capability + threshold = qualified", () => {
    expect(proposerStanding(true, false, 1000, 1000).qualified).toBe(true);
    expect(proposerStanding(true, false, 999, 1000).qualified).toBe(false);
  });

  it("admins bypass the standing bar but never a deny", () => {
    expect(proposerStanding(true, false, 0, 1000, true).qualified).toBe(true);
    expect(proposerStanding(true, true, 0, 1000, true).denied).toBe(true);
  });

  it("below the bar still drafts — the on-ramp, not a wall", () => {
    const noCap = proposerStanding(false, false, 0, 0);
    expect(noCap.qualified).toBe(false);
    expect(noCap.mayDraft).toBe(true);
    const noStanding = proposerStanding(true, false, 0, 500);
    expect(noStanding.qualified).toBe(false);
    expect(noStanding.mayDraft).toBe(true);
  });
});

describe("change-set validation", () => {
  const effective = (key: string) =>
    ({ "gratitude.base_budget": "100", "gratitude.pool_per_cycle": "1000", "quest.consent_cap_mode": "posted" })[key] ?? "";

  it("accepts a clean set and captures the live baseline", async () => {
    const { problems, normalized } = await validateChangeSet(
      noPool,
      [{ key: "gratitude.base_budget", to: "150" }, { key: "quest.consent_cap_mode", to: "capped" }],
      effective,
      0,
    );
    expect(problems).toEqual([]);
    expect(normalized).toEqual([
      { key: "gratitude.base_budget", from: "100", to: "150" },
      { key: "quest.consent_cap_mode", from: "posted", to: "capped" },
    ]);
  });

  it("refuses founder-held dials — Ring 1 is not proposable", async () => {
    const { problems } = await validateChangeSet(noPool, [{ key: "abuse.register_per_ip_hourly", to: "50" }], effective, 0);
    expect(problems[0].problem).toContain("founder-held");
  });

  it("refuses out-of-bounds values — bounds are constitutional", async () => {
    const { problems } = await validateChangeSet(noPool, [{ key: "gratitude.base_budget", to: "999999999" }], effective, 0);
    expect(problems.length).toBe(1);
  });

  it("refuses no-ops, unknown dials, duplicates, and oversized sets", async () => {
    const noop = await validateChangeSet(noPool, [{ key: "gratitude.base_budget", to: "100" }], effective, 0);
    expect(noop.problems[0].problem).toContain("would not change anything");
    const unknown = await validateChangeSet(noPool, [{ key: "no.such_dial", to: "1" }], effective, 0);
    expect(unknown.problems[0].problem).toContain("No such dial");
    const dup = await validateChangeSet(
      noPool,
      [{ key: "gratitude.base_budget", to: "150" }, { key: "gratitude.base_budget", to: "200" }],
      effective,
      0,
    );
    expect(dup.problems.some((p) => p.problem.includes("twice"))).toBe(true);
    const big = await validateChangeSet(
      noPool,
      Array.from({ length: 13 }, (_, i) => ({ key: `k${i}`, to: "1" })),
      effective,
      0,
    );
    expect(big.problems[0].problem).toContain("at most 12");
  });

  it("a partial-bad set is refused whole — what is voted on is what was checked", async () => {
    const { problems, normalized } = await validateChangeSet(
      noPool,
      [{ key: "gratitude.base_budget", to: "150" }, { key: "no.such_dial", to: "1" }],
      effective,
      0,
    );
    expect(problems.length).toBe(1);
    // normalized still carries the good change; the ROUTE refuses on any
    // problem — this shape lets the client show both the good and the bad.
    expect(normalized.length).toBe(1);
  });
});

describe("the proposal document", () => {
  it("carries the [gm:] marker, the human table, and the machine block", () => {
    const md = proposalMarkdown({
      id: "gmp-test-1",
      title: "Widen the gratitude budget",
      rationale: "The village grew and the budget did not.",
      changeSet: [{ key: "gratitude.base_budget", from: "100", to: "150" }],
      villageName: "Testville",
      proposerName: "Ada",
      supports: 4,
      createdAt: "2026-07-31T00:00:00.000Z",
    });
    expect(md).toContain("[gm:gmp-test-1]");
    // The row carries the dial's OWN label, read from the registry, so a
    // rename of the label is a rename in one place. Hard-coding the string
    // here pinned "Base sending budget per cycle" and went red when R73
    // renamed the dial to an allowance, which is a copy edit reported as a
    // behaviour failure. The shape of the row is what this asserts.
    const label = VARIABLES_BY_KEY["gratitude.base_budget"].label;
    expect(label.length).toBeGreaterThan(0);
    expect(md).toContain(`| ${label} (\`gratitude.base_budget\`) | 100 Gratitude | **150 Gratitude** |`);
    expect(md).toContain('"marker": "gm:gmp-test-1"');
    expect(md).toContain("4 member(s) supported it");
    // The machine block round-trips.
    const json = md.slice(md.indexOf("```json") + 7, md.lastIndexOf("```"));
    expect(JSON.parse(json).changes).toEqual([{ key: "gratitude.base_budget", from: "100", to: "150" }]);
  });

  it("cycle-close changes carry the timing note voters should see", () => {
    const md = proposalMarkdown({
      id: "gmp-test-2",
      title: "t",
      rationale: "r",
      changeSet: [{ key: "gratitude.pool_per_cycle", from: "1000", to: "1500" }],
      villageName: "V",
      proposerName: "P",
      supports: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
    });
    expect(md).toContain("takes effect at the next cycle close");
  });

  it("display values read like the game, not like storage", () => {
    expect(displayChangeValue("gratitude.require_message", "true")).toBe("On");
    expect(displayChangeValue("quest.consent_cap_mode", "posted")).toBe("Exactly the posted amount");
    expect(displayChangeValue("gratitude.base_budget", "100")).toBe("100 Gratitude");
  });
});

describe("parseHyphaProposalId", () => {
  it("takes the id from a pasted Hypha URL — last numeric path segment wins", () => {
    expect(parseHyphaProposalId("https://app.hypha.earth/en/dho/my-village/agreements/777")).toBe("777");
    expect(parseHyphaProposalId("https://app.hypha.earth/en/dho/my-village/agreements/777?tab=votes#top")).toBe("777");
    expect(parseHyphaProposalId("https://app.hypha.earth/proposal/5704/")).toBe("5704");
  });

  it("accepts the bare number a founder might paste instead", () => {
    expect(parseHyphaProposalId("5704")).toBe("5704");
    expect(parseHyphaProposalId("  777  ")).toBe("777");
  });

  it("refuses to guess when nothing numeric is there", () => {
    expect(parseHyphaProposalId("https://app.hypha.earth/en/dho/my-village")).toBeNull();
    expect(parseHyphaProposalId("not a url at all")).toBeNull();
    expect(parseHyphaProposalId("")).toBeNull();
  });
});

/**
 * A BALLOT NAMING A MINTING RULE (R81, R84).
 *
 * The village votes on the rules that mint. `validateChangeSet` is where a
 * proposal stops being able to name one, so it is where the fix has to hold.
 * The case that matters most is the MIXED set: a ballot carries one threshold,
 * the threshold comes from the subject type, and a set that is two subjects
 * would be conducted at a price that is wrong for half of it.
 */
describe("a change set that names a minting rule", () => {
  const SEAT_GRATITUDE = "rule-role.cycle-gratitude";
  const QUEST_VOICE = "rule-quest.completed-village-voice";

  const rules = (): Map<string, MintRuleValues> =>
    new Map([
      [SEAT_GRATITUDE, { trigger: "role.cycle", tokenSlug: "gratitude", amount: 20, ceiling: 100, enabled: true }],
      [QUEST_VOICE, { trigger: "quest.completed", tokenSlug: "village-voice", amount: 10, ceiling: 100, enabled: true }],
    ]);
  const readRules = async (ids: string[]) => {
    const all = rules();
    return new Map(ids.filter((id) => all.has(id)).map((id) => [id, all.get(id)!]));
  };
  const effective = (key: string) => ({ "gratitude.base_budget": "100" })[key] ?? "";
  const key = (ruleId: string, field: MintRuleField) => mintRuleKey(ruleId, field);

  it("accepts a rule change and captures what the rule pays today", async () => {
    const { problems, normalized } = await validateChangeSet(
      noPool,
      [{ key: key(SEAT_GRATITUDE, "amount"), to: "30" }],
      effective,
      0,
      readRules,
    );
    expect(problems).toEqual([]);
    expect(normalized).toEqual([{ key: key(SEAT_GRATITUDE, "amount"), from: "20", to: "30" }]);
  });

  /*
   * REWRITTEN 2026-09-02. The refusal stands and its REASON has changed.
   *
   * It used to be a pricing refusal: "a ballot carries one threshold and a
   * set that is two subjects has no honest price". `priceChangeSet` gives a
   * mixed set an honest price now, which is the highest floor among its
   * elements, so that reason is gone.
   *
   * What is left is the apply. A dial holds its new value the moment a
   * proposal carries; a minting rule is queued and promoted at the next moon.
   * `applyMechanicsProposal` runs the two one after the other, and the
   * founder's Q9 ruling is that a proposal applies whole or not at all. So
   * the mix stays refused until the apply is one act, and the sentence says
   * that instead of a price.
   */
  it("still refuses a set that mixes dials with minting rules, on the reason that is still true", async () => {
    const { problems, normalized } = await validateChangeSet(
      noPool,
      [{ key: "gratitude.base_budget", to: "150" }, { key: key(SEAT_GRATITUDE, "amount"), to: "30" }],
      effective,
      0,
      readRules,
    );
    expect(problems.length).toBe(1);
    expect(problems[0].problem).toContain("two proposals");
    expect(problems[0].problem).toContain("one after the other");
    expect(problems[0].problem).toContain("whole or not at all");
    expect(problems[0].problem).not.toContain("threshold");
    expect(normalized).toEqual([]);
  });

  it("refuses a rule this village does not have", async () => {
    const { problems } = await validateChangeSet(
      noPool,
      [{ key: mintRuleKey("rule-invented-thing", "amount"), to: "5" }],
      effective,
      0,
      readRules,
    );
    expect(problems[0].problem).toContain("no minting rule by that name");
  });

  it("refuses a value the rule could never take", async () => {
    const zero = await validateChangeSet(noPool, [{ key: key(SEAT_GRATITUDE, "amount"), to: "0" }], effective, 0, readRules);
    expect(zero.problems[0].problem).toContain("greater than zero");
    const negative = await validateChangeSet(noPool, [{ key: key(SEAT_GRATITUDE, "ceiling"), to: "-1" }], effective, 0, readRules);
    expect(negative.problems[0].problem).toContain("zero or more");
    const word = await validateChangeSet(noPool, [{ key: key(SEAT_GRATITUDE, "enabled"), to: "yes" }], effective, 0, readRules);
    expect(word.problems[0].problem).toContain("true or false");
  });

  it("refuses a no-op even when it is wearing a decimal costume", async () => {
    // `mint_rules.amount` is decimal(18,4), so 20 and 20.0000 are one number
    // in two spellings. Without normalising, the village would be asked to
    // decide something that was already true.
    const same = await validateChangeSet(noPool, [{ key: key(SEAT_GRATITUDE, "amount"), to: "20.0000" }], effective, 0, readRules);
    expect(same.problems[0].problem).toContain("would not change anything");
  });

  it("refuses a set that builds a rule paying above its own ceiling", async () => {
    const built = await validateChangeSet(
      noPool,
      [{ key: key(SEAT_GRATITUDE, "amount"), to: "60" }, { key: key(SEAT_GRATITUDE, "ceiling"), to: "50" }],
      effective,
      0,
      readRules,
    );
    expect(built.problems.length).toBe(1);
    expect(built.problems[0].problem).toContain("is above the");
  });

  it("accepts the amount and the ceiling moving together", async () => {
    const together = await validateChangeSet(
      noPool,
      [{ key: key(SEAT_GRATITUDE, "amount"), to: "150" }, { key: key(SEAT_GRATITUDE, "ceiling"), to: "200" }],
      effective,
      0,
      readRules,
    );
    expect(together.problems).toEqual([]);
    expect(together.normalized.length).toBe(2);
  });

  it("refuses the same rule setting twice, and reads two rules at once", async () => {
    const twice = await validateChangeSet(
      noPool,
      [{ key: key(SEAT_GRATITUDE, "amount"), to: "30" }, { key: key(SEAT_GRATITUDE, "amount"), to: "40" }],
      effective,
      0,
      readRules,
    );
    expect(twice.problems.some((p) => p.problem.includes("twice"))).toBe(true);
    const two = await validateChangeSet(
      noPool,
      [{ key: key(SEAT_GRATITUDE, "amount"), to: "30" }, { key: key(QUEST_VOICE, "amount"), to: "15" }],
      effective,
      0,
      readRules,
    );
    expect(two.problems).toEqual([]);
    expect(two.normalized.length).toBe(2);
  });

  it("says so instead of guessing when this build has no reader for the rules", async () => {
    const { problems } = await validateChangeSet(noPool, [{ key: key(SEAT_GRATITUDE, "amount"), to: "30" }], effective, 0);
    expect(problems[0].problem).toContain("cannot take a minting rule to a vote");
  });

  it("names what it pays for on the document, never the column", async () => {
    const md = proposalMarkdown({
      id: "gmp-mint",
      title: "Pay a seat more",
      rationale: "The seats carry more than they used to.",
      changeSet: [{ key: key(SEAT_GRATITUDE, "amount"), from: "20", to: "30" }],
      villageName: "Larksfield",
      proposerName: "Rye",
      supports: 3,
      createdAt: "2026-08-30T00:00:00.000Z",
      mintRules: rules(),
    });
    expect(md).toContain("role.cycle in gratitude: how much it pays");
    expect(md).toContain("what it pays for");
    expect(md).toContain("takes effect at the next moon");
    // The frozen document must never promise that a carried mint is live.
    expect(md).not.toContain("applied exactly as listed");
  });
});


/**
 * THE TYPED ITEMS, AND THE PRICE OF A SET (Q9, 2026-09-02).
 *
 * A change set was a `{ key, to }` pair whose kind was read off a prefix. It
 * is a discriminated union now, the untyped pair still reads into it because
 * every stored change set on disk is one, and a set is priced at the highest
 * floor among its elements.
 */
describe("typed change items", () => {
  const village = { unityPct: 80, quorumPct: 20 };
  const registry = thresholdSettingsFrom(() => 0);

  it("reads an untyped pair into the union, the way the route used to inline", () => {
    expect(asChangeItem({ key: "gratitude.base_budget", to: "150" })).toEqual({
      kind: "dial",
      key: "gratitude.base_budget",
      to: "150",
    });
    expect(asChangeItem({ key: "mint:rule-a:amount", to: "5" })).toEqual({
      kind: "mint_rule",
      key: "mint:rule-a:amount",
      to: "5",
    });
  });

  it("leaves a typed item alone, so a caller that knows the kind is believed", () => {
    const item: ChangeItem = { kind: "mode_switch", to: "token" };
    expect(asChangeItem(item)).toBe(item);
  });

  it("prices a dial by the DIAL's own tier, never by the word mechanics", () => {
    expect(pricingOf({ kind: "dial", key: "gratitude.base_budget", to: "1" })).toEqual({
      subject: "mechanics",
      criticality: "routine",
    });
    expect(pricingOf({ kind: "dial", key: "governance.quorum_pct", to: "30" })).toEqual({
      subject: "mechanics",
      criticality: "structural",
    });
    expect(pricingOf({ kind: "dial", key: "governance.weight_mode", to: "token" })).toEqual({
      subject: "mechanics",
      criticality: "constitutional",
    });
  });

  it("prices a dial nobody has heard of as routine rather than throwing", () => {
    expect(pricingOf({ kind: "dial", key: "not.a.dial", to: "1" }).criticality).toBe("routine");
  });

  it("prices a mode switch at the constitutional subject", () => {
    expect(pricingOf({ kind: "mode_switch", to: "equal" })).toEqual({
      subject: GOVERNANCE_MODE,
      criticality: "constitutional",
    });
  });

  it("lets a NAMED subject keep the tier it declared, so no tier overrules a reason", () => {
    /*
     * `mint_rule` asks 50 of quorum and deliberately nothing of unity, and
     * the reason is written on its registry entry. If the kind's tier were
     * laid over the top, unity would jump to 80 and the reason would be
     * silently gone.
     */
    expect(pricingOf({ kind: "mint_rule", key: "mint:rule-a:amount", to: "5" })).toEqual({
      subject: MINT_RULE,
      criticality: "routine",
    });
  });
});

describe("what a whole change set costs", () => {
  const village = { unityPct: 80, quorumPct: 20 };
  const registry = thresholdSettingsFrom(() => 0);

  it("leaves an ordinary set of routine dials exactly where it was", () => {
    const priced = priceChangeSet([{ key: "gratitude.base_budget", to: "150" }], "custom", village, registry);
    expect(priced.subjectType).toBe("mechanics");
    expect(priced.criticality).toBe("routine");
    expect(priced.dials).toEqual(village);
    expect(priced.conflict).toBeNull();
  });

  it("raises a structural dial to its tier, which is the whole point of tiers", () => {
    const priced = priceChangeSet([{ key: "governance.quorum_pct", to: "30" }], "custom", village, registry);
    expect(priced.criticality).toBe("structural");
    expect(priced.dials).toEqual(TIER_FLOORS.structural);
  });

  it("prices a mixed bundle at its hardest element, so nothing rides in cheap", () => {
    const priced = priceChangeSet(
      [
        { key: "gratitude.base_budget", to: "150" },
        { kind: "mode_switch", to: "token" } as ChangeItem,
      ],
      "custom",
      village,
      registry,
    );
    expect(priced.criticality).toBe("constitutional");
    expect(priced.dials).toEqual({ unityPct: 97, quorumPct: 97 });
    expect(priced.subjectType).toBe(GOVERNANCE_MODE);
  });

  it("stamps the subject the price came from, and mechanics only when it won", () => {
    const mint = priceChangeSet([{ key: "mint:rule-a:amount", to: "5" }], "custom", village, registry);
    expect(mint.subjectType).toBe(MINT_RULE);
    expect(mint.dials.quorumPct).toBe(50);
  });

  it("leaves a minting vote's unity exactly where the village put it", () => {
    // The shipped rule, unchanged by tiers: the floor raises quorum and says
    // nothing about how much of the room has to agree.
    const lenient = { unityPct: 60, quorumPct: 20 };
    expect(priceChangeSet([{ key: "mint:rule-a:amount", to: "5" }], "custom", lenient, registry).dials).toEqual({
      unityPct: 60,
      quorumPct: 50,
    });
  });

  it("never lowers a village that asks for more than every floor in the set", () => {
    const strict = { unityPct: 100, quorumPct: 100 };
    const priced = priceChangeSet(
      [{ key: "gratitude.base_budget", to: "150" }, { kind: "mode_switch", to: "equal" } as ChangeItem],
      "custom",
      strict,
      registry,
    );
    expect(priced.dials).toEqual(strict);
  });

  it("reads the village's own raised tier rather than the shipped floor", () => {
    const raised = thresholdSettingsFrom((k) => (k === TIER_SETTING_KEYS.structural.quorum ? 88 : 0));
    const priced = priceChangeSet([{ key: "governance.quorum_pct", to: "30" }], "custom", village, raised);
    expect(priced.dials.quorumPct).toBe(88);
  });

  it("prices an empty set as the village's own dials, and says so instead of guessing", () => {
    const priced = priceChangeSet([], "custom", village, registry);
    expect(priced.subjectType).toBe("mechanics");
    expect(priced.dials).toEqual(village);
    expect(priced.subjects).toEqual([]);
  });
});

describe("which kinds this build will take to a vote", () => {
  const effective = () => "100";

  /*
   * WIDENED BY THE DISPATCHER LANE, and this test was rewritten with it. The
   * set used to be two kinds because two executors existed. Four more landed in
   * `server/lib/changeset.ts` (weight allocation, the vote-mode switch, a
   * module's lifecycle, and the minting rules that were already here), so the
   * list this pins is longer. What has NOT changed is the property the test is
   * for: a kind outside the set is refused at validation rather than voted on
   * and silently dropped, and `brand_field` and `role` are still outside it.
   */
  it("names the kinds it can carry out, and no more", () => {
    expect(Array.from(EXECUTABLE_ITEM_KINDS).sort()).toEqual([
      "dial",
      "mint_rule",
      "mode_switch",
      "module_lifecycle",
      "weight_allocation",
    ]);
    for (const kind of CHANGE_ITEM_KINDS) {
      if (EXECUTABLE_ITEM_KINDS.has(kind)) continue;
      expect(["brand_field", "role"]).toContain(kind);
    }
  });

  it("refuses a kind it cannot apply, rather than voting on it and doing nothing", async () => {
    const { problems, normalized } = await validateChangeSet(
      noPool,
      [{ kind: "brand_field", field: "project.name", to: "Somewhere" } as ChangeItem],
      effective,
      0,
    );
    expect(problems.length).toBe(1);
    expect(problems[0].problem).toContain("cannot yet carry out");
    expect(problems[0].problem).toContain("brand_field");
    expect(normalized).toEqual([]);
  });

  it("accepts one once the executor exists, which is the one line that lifts it", async () => {
    const { problems } = await validateChangeSet(
      noPool,
      [{ kind: "mode_switch", to: "token" } as ChangeItem],
      effective,
      0,
      undefined,
      { executableKinds: new Set(["mode_switch"] as const) },
    );
    // The kind is allowed through; nothing about it is a dial, so it falls to
    // the dial branch and is refused by name rather than by kind. The
    // dispatcher lane's executor lands with its own validation beside it.
    expect(problems.map((p) => p.problem).join(" ")).not.toContain("cannot yet carry out");
  });
});

describe("the door governance.weight_mode travels through", () => {
  const effective = (key: string) => (key === "governance.weight_mode" ? "equal" : "");

  it("refuses it inside an ordinary dial item, and names the door instead of a wall", async () => {
    const { problems } = await validateChangeSet(
      noPool,
      [{ key: "governance.weight_mode", to: "token" }],
      effective,
      0,
    );
    expect(problems.length).toBe(1);
    expect(problems[0].key).toBe("governance.weight_mode");
    expect(problems[0].problem).toContain("mode switch");
    expect(problems[0].problem).toContain("constitutional");
  });

  it("still refuses every other founder-held dial with the plain sentence", async () => {
    const { problems } = await validateChangeSet(
      noPool,
      [{ key: "governance.weight_token", to: "village-voice" }],
      effective,
      0,
    );
    expect(problems.length).toBe(1);
    expect(problems[0].problem).toContain("founder-held");
  });
});

describe("the cap on how much one proposal may move", () => {
  const effective = () => "1";

  it("is still twelve, and says so in the sentence it refuses with", async () => {
    expect(CHANGE_SET_CAP).toBe(12);
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ key: `made.up.${i}`, to: "2" }));
    const { problems } = await validateChangeSet(noPool, thirteen, effective, 0);
    expect(problems.length).toBe(1);
    expect(problems[0].problem).toContain("at most 12");
  });
});

/**
 * THRESHOLDS FOR THRESHOLDS (19B). "they also can be changed by reaching the
 * same amount they are set at can change their threshold again." So moving a
 * bar costs whatever that bar currently asks, in either direction, and the
 * price is read off the setting and never off the tier's name.
 */
describe("a change to a threshold is priced at that threshold's current bar", () => {
  const village = { unityPct: 80, quorumPct: 20 };
  const registry = thresholdSettingsFrom(() => 0);

  it("prices a move of the constitutional tier at the constitutional tier", () => {
    const priced = priceChangeSet(
      [{ key: TIER_SETTING_KEYS.constitutional.quorum, to: "99" }],
      "custom",
      village,
      registry,
    );
    expect(priced.dials).toEqual(TIER_FLOORS.constitutional);
  });

  it("prices a move of a bar the village has raised at the RAISED number, not the shipped one", () => {
    const raised = thresholdSettingsFrom((k) =>
      k === TIER_SETTING_KEYS.structural.unity || k === TIER_SETTING_KEYS.structural.quorum ? 97 : 0,
    );
    const priced = priceChangeSet(
      [{ key: TIER_SETTING_KEYS.structural.quorum, to: "60" }],
      "custom",
      village,
      raised,
    );
    // Lowering it costs exactly what it currently asks. That is the whole rule.
    expect(priced.dials).toEqual({ unityPct: 97, quorumPct: 97 });
  });

  /*
   * THE OVERRIDE TIER IS PRICED AT ITSELF, ON TOP OF ITS REGISTRY FLOOR.
   *
   * 19E reads "changing it is priced at the highest tier". Two readings fit:
   * the tier the setting currently names, or the highest tier the platform
   * has. The build takes the second as a FLOOR under the first, so a village
   * that has raised its constitutional bar pays the raised number to move
   * this setting, and a village that has named a cheaper tier still cannot
   * walk its own override down on a quiet week. Recorded as a lane decision.
   */
  it("prices a move of the override tier at the constitutional floor, even when it names a cheaper tier", () => {
    const structural = thresholdSettingsFrom(
      () => 0,
      (k) => (k === HIGHEST_TIER_KEY ? "structural" : ""),
    );
    const priced = priceChangeSet([{ key: HIGHEST_TIER_KEY, to: "routine" }], "custom", village, structural);
    expect(priced.dials).toEqual(TIER_FLOORS.constitutional);
  });

  it("follows the constitutional bar upward when the village has raised it", () => {
    const raised = thresholdSettingsFrom(
      (k) => (k === TIER_SETTING_KEYS.constitutional.quorum ? 99 : 0),
      (k) => (k === HIGHEST_TIER_KEY ? "constitutional" : ""),
    );
    const priced = priceChangeSet([{ key: HIGHEST_TIER_KEY, to: "structural" }], "custom", village, raised);
    expect(priced.dials).toEqual({ unityPct: 97, quorumPct: 99 });
  });

  it("takes the harder of two bars when one set moves both", () => {
    const priced = priceChangeSet(
      [
        { key: TIER_SETTING_KEYS.structural.quorum, to: "60" },
        { key: TIER_SETTING_KEYS.constitutional.quorum, to: "99" },
      ],
      "custom",
      village,
      registry,
    );
    expect(priced.dials).toEqual(TIER_FLOORS.constitutional);
  });

  it("leaves an ordinary dial exactly where it was, so this rule reaches nothing else", () => {
    const priced = priceChangeSet([{ key: "gratitude.base_budget", to: "150" }], "custom", village, registry);
    expect(priced.dials).toEqual(village);
  });
});

/**
 * -- THE NATURAL TIER, AND THE TRIAL THAT CANNOT DISCOUNT IT ----------------
 *
 * Red before these: 21.2 priced a trial one tier below a setting's own and its
 * exclusion list omitted quorum, unity and every tier dial, so a trial of
 * governance.quorum_pct was expressible and nothing refused it.
 */
describe("trials and the natural tier", () => {
  const registry = thresholdSettingsFrom(() => 0);

  it("answers a setting's own tier with no discount", () => {
    expect(naturalTierFor("governance.weight_mode")).toBe("constitutional");
    expect(naturalTierFor(TIER_SETTING_KEYS.structural.quorum)).toBe("constitutional");
    expect(naturalTierFor("governance.vote_days")).toBe("routine");
  });

  it("answers routine for a key the registry has never heard of, the way pricing already does", () => {
    expect(naturalTierFor("nothing.at.all")).toBe("routine");
  });

  it("keeps the thresholds-for-thresholds bar inside the natural price", () => {
    // The constitutional tier's floor and this dial's own current bar are the
    // same numbers on the registry, and a village that raised its structural
    // tier above them proves the raise is real.
    expect(naturalPriceFor(TIER_SETTING_KEYS.constitutional.unity, registry)).toEqual(
      TIER_FLOORS.constitutional,
    );
    const raised = thresholdSettingsFrom((k) =>
      k === TIER_SETTING_KEYS.structural.unity || k === TIER_SETTING_KEYS.structural.quorum ? 99 : 0,
    );
    expect(naturalPriceFor(TIER_SETTING_KEYS.structural.quorum, raised)).toEqual({
      unityPct: 99,
      quorumPct: 99,
    });
  });

  it("refuses a trial of governance.quorum_pct and of any tier dial", () => {
    expect(trialProblem([{ kind: "dial", key: "governance.quorum_pct", to: "5" }])).toContain(
      "governance.quorum_pct",
    );
    expect(
      trialProblem([{ kind: "dial", key: TIER_SETTING_KEYS.constitutional.quorum, to: "10" }]),
    ).toContain(TIER_SETTING_KEYS.constitutional.quorum);
  });

  it("refuses a bundle carrying one pricing dial among ordinary ones", () => {
    expect(
      trialProblem([
        { kind: "dial", key: "governance.vote_days", to: "9" },
        { kind: "dial", key: HIGHEST_TIER_KEY, to: "routine" },
      ]),
    ).toContain(HIGHEST_TIER_KEY);
  });

  it("allows a trial of a dial that prices nothing", () => {
    expect(trialProblem([{ kind: "dial", key: "governance.vote_days", to: "9" }])).toBeNull();
    expect(trialProblem([])).toBeNull();
  });
});
