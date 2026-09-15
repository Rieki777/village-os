/**
 * The address a ballot uses to name a minting rule, pinned.
 *
 * The property that carries the whole design is the FIRST one: a mint rule key
 * and a game dial key can never be mistaken for each other. If that ever stops
 * holding, `validateChangeSet` starts sending a mint rule down the dial writer
 * or the other way round, and both directions are a silent wrong number in the
 * one table that decides what the village pays.
 */
import { describe, expect, it } from "vitest";
import { VARIABLES_BY_KEY } from "./gameVariables";
import {
  AMOUNT_FROM_SOURCE,
  MINT_RULE_FIELDS,
  MINT_RULE_MAX,
  MINT_RULE_PLACES,
  displayMintRuleValue,
  isMintRuleKey,
  mintRuleKey,
  mintRuleValueNumber,
  mintRuleValueProblem,
  parseMintRuleKey,
} from "./mintRuleKeys";

describe("mint rule keys cannot be confused with dials", () => {
  it("no dial in the registry parses as a mint rule key", () => {
    const keys = Object.keys(VARIABLES_BY_KEY);
    // A zero-length registry would pass every assertion below without
    // checking anything, which is the shape of a green gate that ran nothing.
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) {
      expect(isMintRuleKey(key), key).toBe(false);
      expect(parseMintRuleKey(key), key).toBeNull();
    }
  });

  it("no mint rule key collides with a dial", () => {
    for (const field of MINT_RULE_FIELDS) {
      const key = mintRuleKey("rule-role.cycle-gratitude", field);
      expect(VARIABLES_BY_KEY[key], key).toBeUndefined();
    }
  });
});

describe("reading a mint rule key", () => {
  it("round trips a real seeded rule id, dots and all", () => {
    for (const ruleId of ["rule-quest.completed-village-voice", "rule-role.cycle-gratitude"]) {
      for (const field of MINT_RULE_FIELDS) {
        expect(parseMintRuleKey(mintRuleKey(ruleId, field))).toEqual({ ruleId, field });
      }
    }
  });

  it("returns null instead of guessing", () => {
    expect(parseMintRuleKey("governance.unity_pct")).toBeNull();
    expect(parseMintRuleKey("mint:rule-role.cycle-gratitude")).toBeNull();
    expect(parseMintRuleKey("mint:rule-role.cycle-gratitude:recipient")).toBeNull();
    expect(parseMintRuleKey("mint::amount")).toBeNull();
    expect(parseMintRuleKey("mint:rule-x:")).toBeNull();
  });
});

describe("what a field will accept", () => {
  it("an amount is above zero, or reads itself from the work", () => {
    expect(mintRuleValueProblem("amount", "20")).toBeNull();
    expect(mintRuleValueProblem("amount", AMOUNT_FROM_SOURCE)).toBeNull();
    expect(mintRuleValueProblem("amount", "0")).toContain("greater than zero");
    expect(mintRuleValueProblem("amount", "-1")).toContain("greater than zero");
    expect(mintRuleValueProblem("amount", "many")).toContain("number");
    expect(mintRuleValueProblem("amount", "")).toContain("number");
  });

  it("a ceiling is zero or more, and zero means zero", () => {
    expect(mintRuleValueProblem("ceiling", "0")).toBeNull();
    expect(mintRuleValueProblem("ceiling", "100")).toBeNull();
    expect(mintRuleValueProblem("ceiling", "-1")).toContain("zero or more");
    // The amount's escape hatch is the amount's alone. A ceiling read off the
    // work is an open faucet with a form in front of it.
    expect(mintRuleValueProblem("ceiling", AMOUNT_FROM_SOURCE)).toContain("number");
  });

  it("enabled is on or off and nothing else", () => {
    expect(mintRuleValueProblem("enabled", "true")).toBeNull();
    expect(mintRuleValueProblem("enabled", "false")).toBeNull();
    expect(mintRuleValueProblem("enabled", "1")).toContain("true or false");
    expect(mintRuleValueProblem("enabled", "yes")).toContain("true or false");
  });

  /*
   * ── WHAT THE COLUMN CAN ACTUALLY HOLD (MX) ────────────────────────────────
   *
   * Measured before this block existed: finiteness and sign were the whole of
   * the check, and `mint_rules.amount` and `mint_rules.ceiling` are both
   * `decimal(18,4)`. So three values passed a vote and became something the
   * village never decided.
   *
   *   0.00001 as a ceiling   stored 0.0000, which is a ceiling that refuses
   *   0.00001 as an amount   stored 0.0000, which is a silent off switch
   *   1e14    either field   threw an out-of-range error from inside the
   *                          ballot executor, after the vote had carried
   *
   * The first two are the dangerous ones: a village votes for a payment above
   * zero and gets a rule that pays nobody, with `ok` on the way in and no
   * sentence anywhere. A refusal at the raise costs one retype.
   */
  it("refuses a number the column would round away to nothing", () => {
    // A vote that silently becomes an off switch is worse than a refusal.
    expect(mintRuleValueProblem("ceiling", "0.00001")).toContain("nothing at all");
    expect(mintRuleValueProblem("amount", "0.00001")).toContain("nothing at all");
    // And it names the smallest figure the rule can actually carry.
    expect(mintRuleValueProblem("amount", "0.00001")).toContain("0.0001");
  });

  it("refuses a number the column would quietly reshape", () => {
    // 1.00001 stores as 1.0000. The village asked for one number and the row
    // would hold another, so the sentence names the one it would hold.
    expect(mintRuleValueProblem("amount", "1.00001")).toContain("stored as 1");
    expect(mintRuleValueProblem("ceiling", "250.00009")).toContain("stored as 250.0001");
    // Four places is exactly what the column keeps, so four places pass.
    expect(mintRuleValueProblem("amount", "0.0001")).toBeNull();
    expect(mintRuleValueProblem("ceiling", "250.0001")).toBeNull();
    expect(mintRuleValueProblem("amount", "20.0000")).toBeNull();
  });

  it("refuses a number above what the rule can hold, instead of throwing later", () => {
    // This used to reach `queueRuleChange` and come back as a driver error
    // from inside the ballot executor, which is a refusal nobody can act on.
    expect(mintRuleValueProblem("amount", "1e14")).toContain("above that");
    expect(mintRuleValueProblem("ceiling", "1e14")).toContain("above that");
    expect(mintRuleValueProblem("amount", String(MINT_RULE_MAX))).toBeNull();
  });

  it("holds the bound where a number can still be checked against the column", () => {
    // `decimal(18,4)` stops at 99999999999999.9999 and a double stops sooner:
    // four decimal places need `n * 10000` to be a whole number a double can
    // carry, which runs out at `Number.MAX_SAFE_INTEGER`. The tighter of the
    // two is the bound, because above it nothing can check the value at all.
    expect(MINT_RULE_MAX).toBe(Number.MAX_SAFE_INTEGER / 10 ** MINT_RULE_PLACES);
    expect(MINT_RULE_PLACES).toBe(4);
  });
});

describe("what a member reads", () => {
  it("says the value, never the column", () => {
    expect(displayMintRuleValue("enabled", "true")).toBe("On");
    expect(displayMintRuleValue("enabled", "false")).toBe("Off");
    expect(displayMintRuleValue("amount", AMOUNT_FROM_SOURCE)).toContain("posted for");
    expect(displayMintRuleValue("amount", "20")).toBe("20");
  });

  it("the source spelling becomes a real null for the column", () => {
    expect(mintRuleValueNumber("amount", AMOUNT_FROM_SOURCE)).toBeNull();
    expect(mintRuleValueNumber("amount", "20")).toBe(20);
    expect(mintRuleValueNumber("ceiling", "0")).toBe(0);
  });
});
