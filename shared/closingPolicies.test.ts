/**
 * THE CLOSING-POLICY REGISTRY AND ITS RULES (Rye, 2026-09-25), with no server.
 *
 * What each block pins, in the ruling's terms:
 *   - the default is proportional to CLOSING-DAY balances and says redemption
 *     already paid, in the words the ruling used;
 *   - the platform presumes no formula: the village's own words are a
 *     first-class policy, and only a policy that reads balances ever puts a
 *     sentence on the redemption screen;
 *   - silence cannot count: a draft, and the pre-filled default on its own,
 *     are not a named policy;
 *   - readers never receive the account that adopted the words.
 */
import { describe, expect, it } from "vitest";
import {
  CLOSING_MIN_WORDS,
  CLOSING_POLICIES,
  CLOSING_POLICY_IDS,
  CLOSING_REDEMPTION_NOTICE,
  PROPORTIONAL_CLOSING_RULE,
  PROPORTIONAL_CLOSING_STATEMENT,
  closingForReaders,
  closingNamed,
  closingPolicyDef,
  closingStatementProblem,
  closingWordsKeepTheirPolicy,
  redemptionClosingNotice,
} from "./closingPolicies";

const OWN_WORDS =
  "If the village closes, the land passes to a community land trust and the cash is shared equally among whoever still lives here.";
const ADOPTED_AT = "2026-10-03T10:00:00.000Z";

const adopted = (policyId: string, statement: string) => ({ policyId, statement, adoptedBy: "user-1", adoptedAt: ADOPTED_AT });
const draft = (policyId: string, statement: string) => ({ policyId, statement, adoptedBy: null, adoptedAt: null });

describe("the registry", () => {
  it("names every id once, and the first policy is an entry like any other", () => {
    expect(Object.keys(CLOSING_POLICIES).sort()).toEqual([...CLOSING_POLICY_IDS].sort());
    for (const id of CLOSING_POLICY_IDS) {
      expect(CLOSING_POLICIES[id].id).toBe(id);
      expect(CLOSING_POLICIES[id].name.length).toBeGreaterThan(0);
      expect(closingPolicyDef(id)).toBe(CLOSING_POLICIES[id]);
    }
    expect(closingPolicyDef("equal-shares")).toBeNull();
    expect(closingPolicyDef(undefined)).toBeNull();
  });

  it("the default reads CLOSING-DAY balances, in proportion, and says redemption already paid", () => {
    const text = CLOSING_POLICIES["proportional-closing-balance"].defaultStatement;
    expect(text).toBe(PROPORTIONAL_CLOSING_STATEMENT);
    expect(text).toContain("in proportion to the balances they hold on closing day");
    expect(text).toContain("A member who already redeemed receives nothing more");
    expect(text).toContain("because redemption already paid them");
    // The ruling's first reading ("an equal share") was wrong, and this is where it would come back.
    expect(text).not.toMatch(/equal/i);
    expect(CLOSING_POLICIES["proportional-closing-balance"].readsClosingDayBalances).toBe(true);
  });

  it("the village's own words start empty and never read balances", () => {
    expect(CLOSING_POLICIES["own-words"].defaultStatement).toBe("");
    expect(CLOSING_POLICIES["own-words"].readsClosingDayBalances).toBe(false);
  });
});

describe("closingStatementProblem", () => {
  it("refuses a policy the registry does not name", () => {
    expect(closingStatementProblem("equal-shares", OWN_WORDS)).toMatch(/Choose one of the named ways/);
    expect(closingStatementProblem("", OWN_WORDS)).toMatch(/Choose one of the named ways/);
  });

  it("refuses no words, and too few to be a statement", () => {
    expect(closingStatementProblem("own-words", "   ")).toMatch(/Write what closing means/);
    expect(closingStatementProblem("own-words", "TBD")).toMatch(new RegExp(`at least ${CLOSING_MIN_WORDS} words`));
    expect(closingStatementProblem("own-words", 42)).toMatch(/Write what closing means/);
  });

  it("refuses a statement long enough to be a document", () => {
    expect(closingStatementProblem("own-words", `${OWN_WORDS} `.repeat(60))).toMatch(/under 5000 characters/);
  });

  it("accepts the default's own words under the default, and a village's own words under its own", () => {
    expect(closingStatementProblem("proportional-closing-balance", PROPORTIONAL_CLOSING_STATEMENT)).toBeNull();
    expect(closingStatementProblem("own-words", OWN_WORDS)).toBeNull();
    // A village may edit the default's words and keep the default.
    expect(closingStatementProblem("proportional-closing-balance", `${PROPORTIONAL_CLOSING_STATEMENT} Land is sold first.`)).toBeNull();
  });

  it("refuses other words filed under the default's name: the name follows the words", () => {
    // Review of 2026-09-27: these were adopted under the default, and the member
    // page, the launch row and the redemption screen then asserted a formula the
    // village's words did not state.
    expect(closingStatementProblem("proportional-closing-balance", OWN_WORDS)).toMatch(
      /keep the sentence that choice stands for/,
    );
    expect(closingWordsKeepTheirPolicy("proportional-closing-balance", OWN_WORDS)).toBe(false);
    // Dropping the first sentence drops the default, even with the second kept.
    const secondOnly = PROPORTIONAL_CLOSING_STATEMENT.slice(PROPORTIONAL_CLOSING_RULE.length).trim();
    expect(closingStatementProblem("proportional-closing-balance", `${secondOnly} The land goes to a trust.`)).toMatch(
      /keep the sentence/,
    );
  });

  it("keeps the default for its first sentence in any spacing or case, run on or added to", () => {
    expect(PROPORTIONAL_CLOSING_STATEMENT.startsWith(PROPORTIONAL_CLOSING_RULE)).toBe(true);
    expect(CLOSING_POLICIES["proportional-closing-balance"].keepsSentence).toBe(PROPORTIONAL_CLOSING_RULE);
    expect(closingStatementProblem("proportional-closing-balance", PROPORTIONAL_CLOSING_RULE)).toBeNull();
    const shouted = `  ${PROPORTIONAL_CLOSING_RULE.toUpperCase().replace(/ /g, "\n  ")}  `;
    expect(closingStatementProblem("proportional-closing-balance", shouted)).toBeNull();
    const runOn = `${PROPORTIONAL_CLOSING_RULE.replace(/\.$/, "")}, once every debt is paid.`;
    expect(closingStatementProblem("proportional-closing-balance", runOn)).toBeNull();
    expect(closingStatementProblem("proportional-closing-balance", `The barn is sold first. ${PROPORTIONAL_CLOSING_RULE}`)).toBeNull();
    // A policy with no sentence of its own is never held to one.
    expect(closingWordsKeepTheirPolicy("own-words", OWN_WORDS)).toBe(true);
  });

  it("refuses the default's words filed as the village's own, whatever the spacing or case", () => {
    const shouted = `  ${PROPORTIONAL_CLOSING_STATEMENT.toUpperCase().replace(/ /g, "   ")}  `;
    expect(closingStatementProblem("own-words", shouted)).toMatch(/Choose the default itself/);
  });
});

describe("closingNamed: silence, a draft and the pre-filled default never count", () => {
  it("nothing, and anything that is not a section, is not named", () => {
    for (const nothing of [undefined, null, "", "closing", 7, [], {}]) {
      expect(closingNamed(nothing), JSON.stringify(nothing)).toBe(false);
    }
  });

  it("the default's words saved without an adoption are not named", () => {
    expect(closingNamed(draft("proportional-closing-balance", PROPORTIONAL_CLOSING_STATEMENT))).toBe(false);
  });

  it("adopted words the editor would refuse are not named", () => {
    expect(closingNamed(adopted("own-words", "TBD"))).toBe(false);
    expect(closingNamed(adopted("equal-shares", OWN_WORDS))).toBe(false);
  });

  it("an adoption stamp that is not an instant is not an adoption", () => {
    expect(closingNamed({ ...adopted("own-words", OWN_WORDS), adoptedAt: "soon" })).toBe(false);
    expect(closingNamed({ ...adopted("own-words", OWN_WORDS), adoptedAt: true })).toBe(false);
  });

  it("adopted words under a named policy are named, whichever policy it is", () => {
    expect(closingNamed(adopted("proportional-closing-balance", PROPORTIONAL_CLOSING_STATEMENT))).toBe(true);
    expect(closingNamed(adopted("own-words", OWN_WORDS))).toBe(true);
    // The reader's shape carries no adoptedBy and still reads as named.
    expect(closingNamed(closingForReaders(adopted("own-words", OWN_WORDS)))).toBe(true);
  });
});

describe("closingForReaders", () => {
  it("keeps the words and the date and drops who adopted them", () => {
    const read = closingForReaders(adopted("own-words", OWN_WORDS));
    expect(read).toEqual({ policyId: "own-words", statement: OWN_WORDS, adoptedAt: ADOPTED_AT });
    expect(read && "adoptedBy" in read).toBe(false);
  });

  it("answers undefined for no section, and a draft as a draft", () => {
    expect(closingForReaders(undefined)).toBeUndefined();
    expect(closingForReaders("closing")).toBeUndefined();
    expect(closingForReaders(draft("own-words", OWN_WORDS))?.adoptedAt).toBeNull();
  });
});

describe("redemptionClosingNotice: only when it applies", () => {
  it("speaks when the village ADOPTED the closing-day-balance policy", () => {
    expect(redemptionClosingNotice(adopted("proportional-closing-balance", PROPORTIONAL_CLOSING_STATEMENT))).toBe(
      CLOSING_REDEMPTION_NOTICE,
    );
    expect(CLOSING_REDEMPTION_NOTICE).toContain("Redeeming gives up the share these tokens would carry");
    expect(CLOSING_REDEMPTION_NOTICE).toContain("closing day");
  });

  // Wave 2 audit, 2026-09-28. A village where nobody holds `redemption.confirm`
  // decides each redemption by a village vote, and the panel says so just above
  // this notice. So the notice names nobody as the one who confirms: it is shown
  // in both modes, and "a steward confirms" was false in one of them.
  it("names nobody as the one who confirms, because a village vote confirms where nobody holds the key", () => {
    expect(CLOSING_REDEMPTION_NOTICE).toContain("once your redemption is confirmed, they are destroyed");
    expect(CLOSING_REDEMPTION_NOTICE).not.toMatch(/steward/i);
  });

  it("stays silent on a draft, on the village's own words, and on nothing", () => {
    expect(redemptionClosingNotice(draft("proportional-closing-balance", PROPORTIONAL_CLOSING_STATEMENT))).toBeNull();
    expect(redemptionClosingNotice(adopted("own-words", OWN_WORDS))).toBeNull();
    expect(redemptionClosingNotice(undefined)).toBeNull();
  });

  it("stays silent on the default's id carrying other words, which are not a named policy at all", () => {
    const disguised = adopted("proportional-closing-balance", OWN_WORDS);
    expect(closingNamed(disguised)).toBe(false);
    expect(redemptionClosingNotice(disguised)).toBeNull();
  });
});
