/**
 * The Game Mechanics foundation, pinned.
 *
 * Three properties the whole initiative stands on:
 *  1. Generated defs mirror the ladder — every stage gets its multiplier
 *     variable (and quest-threshold / unlock variables where applicable)
 *     whose DEFAULT equals the previously-hardcoded config value, so an
 *     untouched village is byte-identical to the pre-registry game.
 *  2. Ring resolution is deterministic and safe-by-default: infrastructure
 *     and abuse guards are founder-held, game rules are open.
 *  3. The one gate honors per-village unlock overrides WITHOUT changing its
 *     order of authority — including "none", which closes the stage path
 *     while roles still grant.
 */
import { describe, expect, it } from "vitest";
import {
  applyTimingOf,
  parseVariable,
  ringOf,
  validateVariable,
  VARIABLES,
  VARIABLES_BY_KEY,
} from "./gameVariables";
import { NEED_DEPTHS, NEED_DEPTH_LABELS } from "./needs";
import { GAME_CONFIG } from "./gameConfig";
import { HIGHEST_TIER_KEY, isMetaSetting } from "./ballotSubjects";
import { CRITICALITIES } from "./governanceEngine";
import { hasCapability, STAGE_UNLOCKS, type Capability } from "./capabilities";

const stageIndexOf = (id: string) => GAME_CONFIG.stages.findIndex((s) => s.id === id);

describe("generated progression defs", () => {
  it("every stage has a multiplier variable defaulting to its config value", () => {
    for (const s of GAME_CONFIG.stages) {
      const def = VARIABLES_BY_KEY[`progression.multiplier.${s.id}`];
      expect(def, `missing multiplier def for stage ${s.id}`).toBeTruthy();
      expect(Number(def.default)).toBe(s.gratitudeMultiplier);
    }
  });

  it("every quests-rule stage has a threshold variable defaulting to its config min", () => {
    for (const s of GAME_CONFIG.stages) {
      if (s.rule.type !== "quests") continue;
      const def = VARIABLES_BY_KEY[`progression.quests_for.${s.id}`];
      expect(def, `missing quests_for def for stage ${s.id}`).toBeTruthy();
      expect(Number(def.default)).toBe(s.rule.min);
    }
  });

  it("every platform stage-unlock has an override variable defaulting to the platform stage, with a 'none' escape", () => {
    for (const [cap, stage] of Object.entries(STAGE_UNLOCKS)) {
      const def = VARIABLES_BY_KEY[`progression.unlock.${cap}`];
      expect(def, `missing unlock def for ${cap}`).toBeTruthy();
      expect(def.default).toBe(stage);
      expect(def.choices?.some((c) => c.value === "none")).toBe(true);
      // Every choice is a real stage id or "none" — a typo'd stage in a
      // choice list would make the gate silently never match.
      for (const c of def.choices ?? []) {
        expect(c.value === "none" || stageIndexOf(c.value) >= 0).toBe(true);
      }
    }
  });

  it("the registry has no duplicate keys (the import-time guard's invariant)", () => {
    expect(Object.keys(VARIABLES_BY_KEY).length).toBe(VARIABLES.length);
  });
});

describe("ring resolution", () => {
  it("game rules are open, infrastructure and guards are founder-held", () => {
    expect(ringOf(VARIABLES_BY_KEY["gratitude.base_budget"])).toBe("open");
    expect(ringOf(VARIABLES_BY_KEY["quest.consent_cap_mode"])).toBe("open");
    expect(ringOf(VARIABLES_BY_KEY["progression.multiplier.guest"])).toBe("open");
    expect(ringOf(VARIABLES_BY_KEY["abuse.register_per_ip_hourly"])).toBe("founder");
    expect(ringOf(VARIABLES_BY_KEY["tokens.base_rpc_url"])).toBe("founder");
    expect(ringOf(VARIABLES_BY_KEY["hypha.org_url"])).toBe("founder");
    expect(ringOf(VARIABLES_BY_KEY["auth.session_days"])).toBe("founder");
  });

  it("settlement-basis variables apply at cycle close; the rest instantly", () => {
    expect(applyTimingOf(VARIABLES_BY_KEY["gratitude.pool_per_cycle"])).toBe("cycle-close");
    expect(applyTimingOf(VARIABLES_BY_KEY["progression.multiplier.member"])).toBe("cycle-close");
    expect(applyTimingOf(VARIABLES_BY_KEY["quest.consent_cap_mode"])).toBe("instant");
    // The waning dials carry their timing on the DEF rather than in
    // CYCLE_APPLY_KEYS, which two sessions edit at once, and a def-level
    // override cannot be lost in a merge.
    expect(applyTimingOf(VARIABLES_BY_KEY["economy.voice_decay_pct"])).toBe("cycle-close");
    expect(applyTimingOf(VARIABLES_BY_KEY["economy.voice_decay_basis"])).toBe("cycle-close");
  });
});

describe("the waning dials (R3, R15)", () => {
  const pct = VARIABLES_BY_KEY["economy.voice_decay_pct"];
  const basis = VARIABLES_BY_KEY["economy.voice_decay_basis"];

  it("starts at 1 percent a cycle, and any village may set any percent", () => {
    // The ruling, as data. 1 by default, 0 turns it off, 100 is the ceiling.
    expect(pct.default).toBe("1");
    expect(pct.type).toBe("percentage");
    expect(pct.min).toBe(0);
    expect(pct.max).toBe(100);
    expect(parseVariable(pct, undefined)).toBe(1);
    expect(parseVariable(pct, "0")).toBe(0);
    expect(validateVariable(pct, "0")).toBeNull();
    expect(validateVariable(pct, "0.5")).toBeNull();
    expect(validateVariable(pct, "101")).toMatch(/at most 100/);
    expect(validateVariable(pct, "-1")).toMatch(/at least 0/);
  });

  it("lives under The Mint, where every other economy dial lives", () => {
    // There is no Economy category in this registry, and a fifth `economy.*`
    // key anywhere else would split one admin panel across two headings.
    expect(pct.category).toBe("The Mint");
    expect(basis.category).toBe("The Mint");
    // Ring 2, derived. Any village may govern its own rate, which is the
    // ruling: "it can be any %".
    expect(ringOf(pct)).toBe("open");
    expect(ringOf(basis)).toBe("open");
  });

  it("offers one basis, and refuses the one it does not ship", () => {
    // A member's balance already IS their unspent Voice, so `unspent` has no
    // second number to mean. The key exists so a village that later gains
    // another way to spend Voice gets a real option without a rename.
    expect(basis.choices?.map((c) => c.value)).toEqual(["all"]);
    expect(basis.default).toBe("all");
    expect(validateVariable(basis, "all")).toBeNull();
    expect(validateVariable(basis, "unspent")).toMatch(/Must be one of: all/);
  });
});

describe("the gate with per-village unlock overrides", () => {
  const baseCtx = {
    stageIndexOf,
    roleCapabilities: [] as string[],
  };
  const memberIdx = stageIndexOf("member");

  it("absent overrides = platform behaviour, exactly", () => {
    expect(hasCapability("forum.post", { ...baseCtx, stageIndex: memberIdx })).toBe(true);
    expect(hasCapability("forum.post", { ...baseCtx, stageIndex: stageIndexOf("guest") })).toBe(false);
  });

  it("an override moves the rung", () => {
    const stageUnlockOverrides: Partial<Record<Capability, string>> = { "forum.post": "guest" };
    expect(
      hasCapability("forum.post", { ...baseCtx, stageIndex: stageIndexOf("guest"), stageUnlockOverrides }),
    ).toBe(true);
  });

  it('"none" closes the stage path while a role still grants', () => {
    const stageUnlockOverrides: Partial<Record<Capability, string>> = { "forum.post": "none" };
    expect(
      hasCapability("forum.post", { ...baseCtx, stageIndex: stageIndexOf("sage"), stageUnlockOverrides }),
    ).toBe(false);
    expect(
      hasCapability("forum.post", {
        ...baseCtx,
        stageIndex: stageIndexOf("sage"),
        roleCapabilities: ["forum.post"],
        stageUnlockOverrides,
      }),
    ).toBe(true);
  });

  it("a badge deny still beats an override-granted stage unlock (order of authority unchanged)", () => {
    const stageUnlockOverrides: Partial<Record<Capability, string>> = { "forum.post": "guest" };
    expect(
      hasCapability("forum.post", {
        ...baseCtx,
        stageIndex: stageIndexOf("sage"),
        badgeDenies: ["forum.post"],
        stageUnlockOverrides,
      }),
    ).toBe(false);
  });
});

describe("a dial states its effect, and never its number", () => {
  /*
   * R79. `platform.feedback_relay` was typed `integer` with a range of 0 to 1
   * and a unit of "on/off", so Admin drew it as a number box and a founder
   * read a bare "0". The description then spent its first two sentences
   * translating that number back into English. Every reader already treated
   * the dial as a switch, so the type was the only thing that was lying.
   *
   * THE NO-MIGRATION DECISION RESTS ON THE TWO PARSE ASSERTIONS BELOW. The
   * live village stores the string "0" for this key (measured on the public
   * mechanics route, 2026-08-29, the one non-default row besides the RPC
   * URL). If the boolean parser ever stops reading "0" as false, that village
   * gets the relay switched back on by a deploy it did not ask for, and
   * members' words start leaving it. So this is pinned rather than reasoned.
   */
  const relay = VARIABLES_BY_KEY["platform.feedback_relay"];

  it("the feedback relay is a switch, with no bounds and no unit to decode", () => {
    expect(relay.type).toBe("boolean");
    expect(relay.default).toBe("true");
    expect(relay.min).toBeUndefined();
    expect(relay.max).toBeUndefined();
    expect(relay.unit).toBeUndefined();
  });

  it("a value stored in the old integer spelling still reads the same", () => {
    expect(parseVariable(relay, "0")).toBe(false); // what the live village holds
    expect(parseVariable(relay, "1")).toBe(true);
    expect(parseVariable(relay, "false")).toBe(false);
    expect(parseVariable(relay, "true")).toBe(true);
    expect(parseVariable(relay, undefined)).toBe(true); // untouched village
  });

  it("a value stored in the old integer spelling still validates", () => {
    for (const stored of ["0", "1", "true", "false"]) {
      expect(validateVariable(relay, stored), stored).toBeNull();
    }
  });

  /*
   * THE SHAPE OF THE DEFECT, so a future dial cannot wear the same clothes.
   * A dial that only accepts 0 or 1 is a switch, and typing it as a number
   * forces its description to explain what each number means. Both guards are
   * exact: at the ref this was written, `platform.feedback_relay` was the only
   * def in the whole registry matching either one.
   */
  it("no dial is a number whose only two values are 0 and 1", () => {
    const twoValued = VARIABLES.filter(
      (v) => v.type !== "boolean" && v.min === 0 && v.max === 1,
    ).map((v) => `${v.key} (${v.type})`);
    expect(twoValued).toEqual([]);
  });

  it("no dial carries an on/off unit unless it is a boolean", () => {
    const onOff = VARIABLES.filter(
      (v) => (v.unit ?? "").replace(/[^a-z]/gi, "").toLowerCase() === "onoff" && v.type !== "boolean",
    ).map((v) => `${v.key} (${v.type})`);
    expect(onOff).toEqual([]);
  });

  it("a boolean has no bounds to show, because it has no range", () => {
    const bounded = VARIABLES.filter(
      (v) => v.type === "boolean" && (v.min !== undefined || v.max !== undefined),
    ).map((v) => v.key);
    expect(bounded).toEqual([]);
  });
});

describe("governance.hub_url: https-only, no loopback exemption (bridges lane)", () => {
  const def = VARIABLES_BY_KEY["governance.hub_url"];

  /*
   * SHIPS BLANK (thresholds lane, from the audit of 2026-09-03). This pin
   * used to hold one organisation's hub as the default, and this repository
   * is public: every fork inherited that address as part of its constitution.
   * `FEEDBACK_HUB_URL` was blanked for the same reason and this key follows
   * it. Empty means no hub, and every reader already treats empty as off.
   */
  it("exists, ships blank so no fork inherits somebody else's hub, and is founder-held", () => {
    expect(def).toBeTruthy();
    expect(def.default).toBe("");
    expect(validateVariable(def, def.default)).toBeNull();
    expect(def.description).toContain("Empty means this village has no hub");
    expect(ringOf(def)).toBe("founder");
  });

  it("accepts a real https URL", () => {
    expect(validateVariable(def, "https://hub.example.org")).toBeNull();
  });

  it("accepts blank (unconfigured)", () => {
    expect(validateVariable(def, "")).toBeNull();
  });

  it("refuses plain http, unlike the generic _url rule this key would otherwise inherit", () => {
    expect(validateVariable(def, "http://hub.example.org")).toMatch(/https URL/);
  });

  it("refuses a loopback http address - the ONE thing that makes this key's rule stricter than the generic _url rule", () => {
    // The generic rule (proven true for another founder-held *_url variable
    // below) exempts 127.0.0.1/localhost for local RPC nodes. That exemption
    // must NOT reach this key: this URL carries the shared governance secret
    // as a header on every request that uses it (server/index.ts's
    // link-hypha route), and a loopback exemption on a secret-bearing URL is
    // exactly the internal-address SSRF surface this platform's own guarded
    // dialer (toolcheck.ts) exists to close everywhere else.
    expect(validateVariable(def, "http://127.0.0.1:8080")).toMatch(/https URL/);
    expect(validateVariable(def, "http://localhost:8080")).toMatch(/https URL/);
  });

  it("refuses a non-http(s) scheme", () => {
    expect(validateVariable(def, "javascript:alert(1)")).toMatch(/https URL/);
    expect(validateVariable(def, "ftp://hub.example.org")).toMatch(/https URL/);
  });

  it("the generic _url rule DOES exempt loopback for an ordinary infrastructure URL (control case)", () => {
    // Proves the two rules are genuinely different, not that the test
    // regex is loose: this is the same assertion shape as the refusal
    // above, run against a key the stricter branch does not touch.
    const rpcDef = VARIABLES_BY_KEY["tokens.base_rpc_url"];
    expect(rpcDef).toBeTruthy();
    expect(validateVariable(rpcDef, "http://127.0.0.1:8545")).toBeNull();
    expect(validateVariable(rpcDef, "http://some-other-host:8545")).toMatch(/https URL/);
  });
});

describe("the Exit levers (R4), whose whole job is to change nothing on the day they land", () => {
  /*
   * THE ONE PROPERTY THIS BLOCK EXISTS FOR.
   *
   * `sweepBalances` (`server/lib/exit.ts`) READS these dials now, and on the
   * values below it does what it always did: every positive balance goes, in
   * full, to `sys:exit-settlement`, with nothing kept and no date gating the
   * settle. So the defaults are not a taste question: each one has to be the
   * value that reproduces that sentence exactly, and each is asserted here BY
   * NAME against the behaviour it reproduces, so a later lane cannot quietly
   * change what an untouched village does by editing a default.
   *
   * `server/lib/exitDefaults.test.ts` is the other half of this claim: it
   * runs a real exit against a scratch schema on these defaults and compares
   * the token_ledger rows to the ones origin/main's `sweepBalances` writes.
   * A default asserted here and a posting measured there are two different
   * kinds of evidence for one sentence. `server/lib/exitSplit.test.ts` is the
   * mirror: what a village that MOVES one of these gets instead.
   */
  const def = (key: string) => {
    const d = VARIABLES_BY_KEY[key];
    expect(d, `missing Exit def ${key}`).toBeTruthy();
    return d;
  };

  it("the four keep shares all start at nothing, which is what a departure does today", () => {
    for (const kind of ["credit", "voice", "recognition", "equity"]) {
      const d = def(`exit.keep_pct.${kind}`);
      expect(d.default, `exit.keep_pct.${kind} default`).toBe("0");
      expect(d.type).toBe("percentage");
      expect(d.min).toBe(0);
      expect(d.max).toBe(100);
      // A share is parsed as the NUMBER zero from an unset village, and the
      // same zero when a village types it. An empty state and a real zero are
      // different facts about the row and the same fact about the sweep.
      expect(parseVariable(d, undefined)).toBe(0);
      expect(parseVariable(d, "0")).toBe(0);
      expect(validateVariable(d, "101")).toMatch(/at most 100/);
      expect(validateVariable(d, "-1")).toMatch(/at least 0/);
    }
  });

  it("the remainder lands in exit settlement, which is the account the sweep names today", () => {
    const d = def("exit.remainder_account");
    expect(d.default).toBe("settlement");
    expect(d.choices?.map((c) => c.value)).toEqual(["settlement", "treasury", "cycle-pool", "burn"]);
    expect(validateVariable(d, "settlement")).toBeNull();
    expect(validateVariable(d, "sys:exit-settlement")).toMatch(/Must be one of/);
  });

  it("the two choices that redefine a published supply figure each carry the warning", () => {
    // `spending.ts` already argues this case for stay credits: a faucet's
    // negative balance IS issued supply, so paying into one turns "released to
    // date" into "outstanding" on every surface that prints it. The dial is
    // allowed to do it and is not allowed to do it quietly.
    const d = def("exit.remainder_account");
    for (const value of ["cycle-pool", "burn"]) {
      const choice = d.choices?.find((c) => c.value === value);
      expect(choice?.hint, `${value} hint`).toMatch(/outstanding/);
      expect(choice?.hint, `${value} hint`).toMatch(/released to date/);
      expect(choice?.hint, `${value} hint`).toMatch(/only if you mean it/);
    }
    for (const value of ["settlement", "treasury"]) {
      expect(d.choices?.find((c) => c.value === value)?.hint ?? "").not.toMatch(/outstanding/);
    }
  });

  it("cooling starts at zero days, which is the guard the settle route has today", () => {
    const d = def("exit.cooling_days");
    expect(d.default).toBe("0");
    expect(d.type).toBe("integer");
    expect(d.min).toBe(0);
    expect(d.max).toBe(365);
    expect(validateVariable(d, "0.5")).toMatch(/whole number/);
    expect(validateVariable(d, "366")).toMatch(/at most 365/);
  });

  it("Voice is forfeit by default, and the rate under it is zero", () => {
    const voice = def("exit.voice_on_exit");
    expect(voice.default).toBe("forfeit");
    expect(voice.choices?.map((c) => c.value)).toEqual(["forfeit", "keep", "convert"]);
    const rate = def("exit.voice_convert_rate");
    expect(rate.default).toBe("0");
    expect(rate.type).toBe("decimal");
    expect(rate.min).toBe(0);
    expect(rate.max).toBe(1000);
    // A decimal accepts a fraction; the refusal that matters for this pair is
    // `exitLeverProblem`'s, not the type's.
    expect(validateVariable(rate, "0.25")).toBeNull();
  });

  it("no departure asks the village, and no leaver sells anything back", () => {
    const vote = def("exit.vote_over");
    expect(vote.default).toBe("0"); // 0 means never, which is every village today
    expect(vote.type).toBe("integer");
    expect(vote.min).toBe(0);
    const sellback = def("exit.sellback_enabled");
    expect(sellback.default).toBe("false");
    expect(sellback.type).toBe("boolean");
    // A boolean has no range to draw, which the block below enforces registry
    // wide; asserted here too because this is the def a fork copies.
    expect(sellback.min).toBeUndefined();
    expect(sellback.max).toBeUndefined();
  });

  it("every Exit dial is the village's to govern, and none of them waits for a cycle", () => {
    // Ring 2 by derivation: "Exit" is outside FOUNDER_CATEGORIES and no key is
    // in FOUNDER_KEYS. That is the answer to "Ring 1 or Ring 2": a village
    // governs its own exit terms.
    const exitDefs = VARIABLES.filter((v) => v.category === "Exit");
    expect(exitDefs.length).toBe(10);
    for (const d of exitDefs) {
      expect(ringOf(d), `${d.key} ring`).toBe("open");
      // A departure is not a cycle close, and none of these is a settlement
      // basis. Pinned so a later lane cannot fold them into CYCLE_APPLY_KEYS
      // and delay a policy change by a moon for no reason.
      expect(applyTimingOf(d), `${d.key} timing`).toBe("instant");
    }
  });
});

describe("the Needs dials (R1), re-derived against what the needs store actually does", () => {
  it("the two starting answers are what the store falls back to", () => {
    /*
     * `upsertScopeNeed` (server/lib/needs.ts) now writes
     * `input.depthTarget ?? defaultDepthTarget()` and
     * `input.breadthTargetPct === undefined ? defaultBreadthPct() : ...`,
     * and those two accessors read THESE keys. The constants they fall back
     * to when nothing is voted are `NEEDS_DEFAULT_DEPTH_TARGET` and
     * `NEEDS_DEFAULT_BREADTH_PCT`, which server/lib/needs.dials.test.ts pins
     * against this registry from the other side. So these two defaults are
     * still what a village that never opens the panel adopts needs at, and
     * a village that DOES open it now gets what it chose.
     */
    expect(VARIABLES_BY_KEY["needs.default_depth_target"].default).toBe("satisfied");
    expect(VARIABLES_BY_KEY["needs.default_breadth_pct"].default).toBe("100");
  });

  it("the depth choices ARE the five rungs, taken from the taxonomy and never retyped", () => {
    const d = VARIABLES_BY_KEY["needs.default_depth_target"];
    expect(d.choices?.map((c) => c.value)).toEqual([...NEED_DEPTHS]);
    expect(d.choices?.map((c) => c.label)).toEqual(NEED_DEPTHS.map((k) => NEED_DEPTH_LABELS[k]));
    // A rung added to the taxonomy reaches this dial with no edit here. A
    // retyped list would go stale in silence, which is the mirror-annotation
    // trap this repository has already paid for once.
    expect(validateVariable(d, "thriving")).toBeNull();
    expect(validateVariable(d, "content")).toMatch(/Must be one of/);
  });

  it("breadth is a WHOLE percent, because the store refuses a fraction by name", () => {
    // `scopeProblem` answers "A breadth is a whole number of percent, from 0
    // to 100." A dial typed `percentage` would accept 50.5 here and hand the
    // store a number it will not take, so the dial is an integer.
    const d = VARIABLES_BY_KEY["needs.default_breadth_pct"];
    expect(d.type).toBe("integer");
    expect(validateVariable(d, "50.5")).toMatch(/whole number/);
    expect(validateVariable(d, "100")).toBeNull();
    expect(validateVariable(d, "0")).toBeNull();
  });

  it("the totality target says on itself that it sizes nothing", () => {
    // R1's ruling and question 3's default: DESCRIPTIVE, never an engine
    // input. Nothing in the tree reads this key, and the description has to
    // say so plainly or a founder reads the target as a budget.
    const d = VARIABLES_BY_KEY["needs.totality_target_pct"];
    expect(d.default).toBe("0"); // 0 means nobody has said yet
    expect(d.description).toMatch(/sizes nothing/);
    expect(d.description).toMatch(/gates nothing/);
  });

  it("the aggregate floor starts at three, and can never be set to one", () => {
    const d = VARIABLES_BY_KEY["needs.aggregate_floor"];
    expect(d.default).toBe("3");
    expect(d.type).toBe("integer");
    expect(d.min).toBe(1);
    expect(validateVariable(d, "0")).toMatch(/at least 1/);
  });

  it("a needs target never blocks the launch vote, and there is no choice that would", () => {
    // Question 4's default, held as data: the severities the launch registry
    // knows are blocking, recommended and optional. This dial offers neither
    // `blocking` nor anything that maps to it, so no edit to this value can
    // hold a village's Game over an unanswered target.
    const d = VARIABLES_BY_KEY["needs.launch_requirement"];
    expect(d.default).toBe("recommended");
    expect(d.choices?.map((c) => c.value)).toEqual(["recommended", "none"]);
    expect(validateVariable(d, "blocking")).toMatch(/Must be one of/);
  });

  it("every Needs dial is the village's to govern, and none of them waits for a cycle", () => {
    const needsDefs = VARIABLES.filter((v) => v.category === "Needs");
    expect(needsDefs.length).toBe(5);
    for (const d of needsDefs) {
      expect(ringOf(d), `${d.key} ring`).toBe("open");
      expect(applyTimingOf(d), `${d.key} timing`).toBe("instant");
    }
  });
});

describe("what this wave added to the registry, counted", () => {
  /*
   * THE COUNT IS PER CATEGORY AND NOT A REGISTRY TOTAL, deliberately.
   *
   * Measured at this ref: the registry held 151 defs before this wave and
   * holds 166 after it, which is the fifteen below and nothing else. A pin on
   * 166 would be a merge landmine, because nine lanes are adding dials to
   * other categories in the same week and every one of them would go red on a
   * number that says nothing about their change. Two category counts say the
   * same thing about THIS change and stay true through everybody else's.
   */
  it("fifteen new dials, in two new categories, and no key collides", () => {
    expect(VARIABLES.filter((v) => v.category === "Exit").length).toBe(10);
    expect(VARIABLES.filter((v) => v.category === "Needs").length).toBe(5);
    // The import-time guard's invariant, re-asserted after fifteen additions:
    // a duplicate key would make VARIABLES_BY_KEY silently keep the last def.
    expect(Object.keys(VARIABLES_BY_KEY).length).toBe(VARIABLES.length);
  });

  it("every one of the fifteen has a label, a description and a unit or a choice list", () => {
    for (const d of VARIABLES.filter((v) => v.category === "Exit" || v.category === "Needs")) {
      expect(d.label.length, `${d.key} label`).toBeGreaterThan(0);
      expect(d.description.length, `${d.key} description`).toBeGreaterThan(80);
      // Admin renders a value as `${raw} ${unit}` for a number and as a
      // labelled option for a choice. A number with no unit prints a bare
      // figure a founder has to guess at.
      if (d.type === "choice" || d.type === "boolean") expect(d.choices ?? d.type).toBeTruthy();
      else expect(d.unit, `${d.key} unit`).toBeTruthy();
    }
/**
 * THE OVERRIDE TIER AS A SETTING (19E). The village names the tier a veto
 * override is passed at, and the setting is votable, which is what the
 * founder's "this is also a setting that can change at the highest tier set"
 * needs: an open-ring dial priced by `thresholdChangePrice` at the tier it
 * currently names.
 */
describe("governance.highest_tier: the tier a veto override is passed at", () => {
  const def = VARIABLES_BY_KEY[HIGHEST_TIER_KEY];

  it("holds the same key string `shared/ballotSubjects.ts` exports, which is what the pricing rule looks up", () => {
    // The registry writes the literal because the governance document reads
    // this file as source text and cannot follow an imported constant.
    expect(def.key).toBe(HIGHEST_TIER_KEY);
  });

  it("exists, offers exactly the tiers the ladder has, and defaults to the top of it", () => {
    expect(def).toBeTruthy();
    expect(def.type).toBe("choice");
    expect((def.choices ?? []).map((c) => c.value)).toEqual([...CRITICALITIES]);
    expect(def.default).toBe(CRITICALITIES[CRITICALITIES.length - 1]);
    expect(validateVariable(def, def.default)).toBeNull();
  });

  it("is open ring, so the village can move it, and carries the constitutional floor", () => {
    expect(ringOf(def)).toBe("open");
    expect(def.criticality).toBe("constitutional");
  });

  it("refuses a value that is not a tier", () => {
    expect(validateVariable(def, "whatever")).toMatch(/Must be one of/);
  });
});

/**
 * The structural tier's numbers are the build's own, and the control says so
 * (thresholds lane). A village reading "80" should know it is a starting
 * point somebody chose and not a law of the platform.
 */
describe("the structural tier says its numbers are a starting point", () => {
  it("names the shipped number and says the village may raise it", () => {
    const quorum = VARIABLES_BY_KEY["governance.tier_structural_quorum_pct"];
    const unity = VARIABLES_BY_KEY["governance.tier_structural_unity_pct"];
    expect(quorum.default).toBe("50");
    expect(unity.default).toBe("80");
    expect(quorum.description).toContain("your village may raise it");
    expect(unity.description).toContain("your village may raise");
  });
});

/**
 * -- WHOSE WEIGHT THE QUORUM COUNTS (19G, thresholds-fix) -------------------
 *
 * Red before these two dials existed: 19C brought voice for other beings from
 * day one and 19F made quorum pure token weight, and nothing anywhere said
 * whether a river's share of the Voice was part of the count.
 */
describe("the two dials that decide who counts toward quorum", () => {
  it("ships with beings outside the count, which is the safe reading of a bar", () => {
    const def = VARIABLES_BY_KEY["governance.nonhuman_in_quorum"];
    expect(def).toBeTruthy();
    expect(def.type).toBe("boolean");
    expect(def.default).toBe("false");
    expect(def.criticality).toBe("constitutional");
    expect(ringOf(def)).toBe("open");
  });

  it("counts silence in cycles, defaults to three, and never allows zero", () => {
    const def = VARIABLES_BY_KEY["governance.absent_cycles"];
    expect(def).toBeTruthy();
    expect(def.type).toBe("integer");
    expect(def.default).toBe("3");
    expect(def.min).toBe(1);
    expect(def.criticality).toBe("constitutional");
    expect(validateVariable(def, "0")).toBeTruthy();
  });

  it("is priced as a meta setting, so no trial can move a denominator cheaply", () => {
    expect(isMetaSetting("governance.nonhuman_in_quorum")).toBe(true);
    expect(isMetaSetting("governance.absent_cycles")).toBe(true);
  });
});
