/**
 * A COLON VILLAGE CAN SET WHAT A DOLLAR VILLAGE CAN, IN ITS OWN NUMBERS.
 *
 * Rye ruled on 2026-10-31 that Voice is paid at one per unit of the village's
 * currency, and the 2026-11-01 pay ruling prices Earned Equity and the Credits
 * bonus in that currency as well. A village counting in Costa Rican colones,
 * about 500 to the US dollar, therefore holds about 500 times the Voice, the
 * Earned Equity and the Credits a dollar village holds for the same work.
 *
 * Three dial maximums were sized for dollar amounts: the two claim thresholds
 * at 100,000 and the Gratitude pool at 1,000,000. Each one let a colon village
 * reach only twice its scaled default, where a dollar village could reach a
 * thousand times its own. The defaults scaled by 500 fitted under the old
 * maximums, which is why nothing failed loudly: the refusal waited for the
 * first colon village that wanted fewer, larger claims or a bigger pool.
 *
 * The property pinned here is parity. Anything a dollar village could set under
 * the dollar-sized maximum, a colon village can set at 500 times the number.
 *
 * And the new maximums are held under the two real limits they meet once
 * scaled: JavaScript's safe integers, where the ledger's minor units are
 * computed, and the signed INT column that stores one member's pool share.
 */
import { describe, expect, it } from "vitest";
import { validateVariable, VARIABLES_BY_KEY } from "./gameVariables";
import { CURRENCY_DECIMALS, VOICE_DECIMALS, minorPerWhole } from "./tokenScale";

/** Colones to one US dollar, rounded, as the brief measured it on 2026-10-31. */
const COLONES_PER_DOLLAR = 500;

/**
 * The maximum each dial carried until 2026-11-05. Frozen here on purpose: this
 * is the dollar-sized range, and the test is about scaling it, so it must not
 * be read back from the registry it is testing.
 */
const DOLLAR_SIZED_MAX: Record<string, number> = {
  "economy.voice_claim_threshold": 100_000,
  "economy.equity_claim_threshold": 100_000,
  "gratitude.pool_per_cycle": 1_000_000,
};

const KEYS = Object.keys(DOLLAR_SIZED_MAX);

/**
 * The finest scale any of these three dials is converted at. Village Voice
 * carries VOICE_DECIMALS, a spendable credit (what the pool pays) carries
 * CURRENCY_DECIMALS, and Earned Equity is seeded at 2 by migration 0266.
 */
const LEDGER_DECIMALS = Math.max(VOICE_DECIMALS, CURRENCY_DECIMALS, 2);

/**
 * `gratitude_distributions.credited` is `int NOT NULL` (migration 0010), signed,
 * and it stores one member's share of the pool in whole tokens. A village where
 * one member received all the recognition credits that member the whole pool,
 * so the pool's maximum has to fit the column. MySQL in strict mode refuses an
 * out-of-range write, which would fail the freeze and so the whole close.
 */
const SIGNED_INT_MAX = 2_147_483_647;

/**
 * `voice_claims.amount` is `decimal(18,4)` (migration 0072): fourteen whole
 * digits. A claim carries the member's whole balance, which is at least the
 * threshold, so a threshold has to fit with room to spare.
 */
const CLAIM_AMOUNT_WHOLE_DIGITS = 14;

describe("a colon village sets claim thresholds and the pool at its own scale", () => {
  for (const key of KEYS) {
    it(`${key}: the dollar default times ${COLONES_PER_DOLLAR} is accepted`, () => {
      const def = VARIABLES_BY_KEY[key];
      expect(def, `${key} is not in the registry`).toBeTruthy();
      const colonDefault = Number(def.default) * COLONES_PER_DOLLAR;
      expect(validateVariable(def, String(colonDefault))).toBeNull();
    });

    it(`${key}: the top of the dollar-sized range times ${COLONES_PER_DOLLAR} is accepted`, () => {
      const def = VARIABLES_BY_KEY[key];
      const colonTop = DOLLAR_SIZED_MAX[key] * COLONES_PER_DOLLAR;
      expect(validateVariable(def, String(colonTop))).toBeNull();
    });
  }
});

describe("the raised maximums stay inside what they are multiplied into", () => {
  for (const key of KEYS) {
    it(`${key}: the maximum in minor units is a safe integer`, () => {
      const max = VARIABLES_BY_KEY[key].max;
      expect(max, `${key} has no maximum`).toBeTypeOf("number");
      expect(Number.isSafeInteger(Number(max) * minorPerWhole(LEDGER_DECIMALS))).toBe(true);
    });
  }

  it("gratitude.pool_per_cycle: the whole pool fits the signed INT column one member's share is stored in", () => {
    expect(Number(VARIABLES_BY_KEY["gratitude.pool_per_cycle"].max)).toBeLessThanOrEqual(SIGNED_INT_MAX);
  });

  for (const key of ["economy.voice_claim_threshold", "economy.equity_claim_threshold"]) {
    it(`${key}: a claim at the threshold fits voice_claims.amount`, () => {
      expect(Number(VARIABLES_BY_KEY[key].max)).toBeLessThan(10 ** CLAIM_AMOUNT_WHOLE_DIGITS);
    });
  }
});
