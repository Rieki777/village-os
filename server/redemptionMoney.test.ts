/**
 * What a redemption is worth, decided with no database (ruling 23).
 *
 * `server/lib/redemption.ts` is the pure half of this module, so every figure a
 * member reads and every refusal they meet can be driven here with no schema at
 * all. The cases below are the ones where getting it wrong costs real money:
 * the rate a village follows, the fee it keeps, and the caps that say how much
 * it will pay.
 *
 * UNITS: token amounts are MINOR units of the token; money is MINOR units of
 * the currency. The two scales are different and this file says which is which
 * on every line, because conflating them is how a village pays a hundred times
 * what it meant to (docs/ECONOMICS.md 10.3).
 */
import { describe, expect, it } from "vitest";
import {
  redemptionMoneyRefusal,
  redemptionQuote,
  resolveRedemptionRate,
  setRateAboveExchange,
  type RedemptionRate,
} from "./lib/redemption";

/** A conversion table with one pair in it, and nothing else reachable. */
const convertThrough = (pairs: Record<string, number>) =>
  (amountMinor: number, from: string, to: string): number | null => {
    if (from === to) return amountMinor;
    const rate = pairs[`${from}>${to}`];
    if (!rate) return null;
    // Both sides two-decimal in these cases, so the scale cancels.
    return Math.round(amountMinor * rate);
  };

describe("the rate a village redeems at", () => {
  it("follows the exchange's posted price when it is told to", () => {
    const rate = resolveRedemptionRate({
      currency: "USD",
      postedPriceMinor: 250,
      postedCurrency: "USD",
      setRatePerToken: 0,
      setRateCurrency: "USD",
      source: "exchange",
      convert: convertThrough({}),
    });
    expect(rate).toEqual({ minorPerToken: 250, source: "exchange", currency: "USD" });
  });

  it("converts the posted price into the village's own currency", () => {
    const rate = resolveRedemptionRate({
      currency: "CHF",
      postedPriceMinor: 250,
      postedCurrency: "USD",
      setRatePerToken: 0,
      setRateCurrency: "CHF",
      source: "exchange",
      convert: convertThrough({ "USD>CHF": 0.8 }),
    });
    expect(rate?.minorPerToken).toBe(200);
    expect(rate?.currency).toBe("CHF");
  });

  it("has NO rate when nobody has posted a price, which is a real answer", () => {
    expect(
      resolveRedemptionRate({
        currency: "USD",
        postedPriceMinor: null,
        postedCurrency: "USD",
        setRatePerToken: 0,
        setRateCurrency: "USD",
        source: "exchange",
        convert: convertThrough({}),
      }),
    ).toBeNull();
  });

  it("has no rate when the currency cannot be reached from the posted one", () => {
    // The ECB list carries no CRC, which server/lib/fxRates.ts says in writing.
    expect(
      resolveRedemptionRate({
        currency: "CRC",
        postedPriceMinor: 250,
        postedCurrency: "USD",
        setRatePerToken: 0,
        setRateCurrency: "CRC",
        source: "exchange",
        convert: convertThrough({}),
      }),
    ).toBeNull();
  });

  it("takes the village's own rate when the source is set, in whole money", () => {
    const rate = resolveRedemptionRate({
      currency: "USD",
      postedPriceMinor: 250,
      postedCurrency: "USD",
      setRatePerToken: 5,
      setRateCurrency: "USD",
      source: "set",
      convert: convertThrough({}),
    });
    // Five dollars a token is 500 minor, and the posted 250 is ignored.
    expect(rate).toEqual({ minorPerToken: 500, source: "set", currency: "USD" });
  });

  it("treats a set rate of zero as no rate at all", () => {
    expect(
      resolveRedemptionRate({
        currency: "USD",
        postedPriceMinor: 250,
        postedCurrency: "USD",
        setRatePerToken: 0,
        setRateCurrency: "USD",
        source: "set",
        convert: convertThrough({}),
      }),
    ).toBeNull();
  });
});

describe("what the member receives", () => {
  const rate: RedemptionRate = { minorPerToken: 500, source: "set", currency: "USD" };

  it("multiplies whole tokens by the rate, at the token's own scale", () => {
    // 50 credits at two decimals is 5000 minor units of the token.
    const q = redemptionQuote({ amountUnits: 5000, decimals: 2, rate, feePct: 0, feeFixed: 0 });
    expect(q?.grossMinor).toBe(25000);
    expect(q?.feeMinor).toBe(0);
    expect(q?.netMinor).toBe(25000);
  });

  it("takes the percentage and the flat fee out of the payment, not off the tokens", () => {
    const q = redemptionQuote({ amountUnits: 5000, decimals: 2, rate, feePct: 2, feeFixed: 1 });
    // 250.00 gross, 2% is 5.00, plus 1.00 flat.
    expect(q?.grossMinor).toBe(25000);
    expect(q?.feeMinor).toBe(600);
    expect(q?.netMinor).toBe(24400);
    expect(q?.feeFixedMinor).toBe(100);
  });

  it("never lets a fee exceed the redemption, so nobody is paid a negative amount", () => {
    const q = redemptionQuote({ amountUnits: 100, decimals: 2, rate, feePct: 50, feeFixed: 40 });
    expect(q?.grossMinor).toBe(500);
    expect(q?.feeMinor).toBe(500);
    expect(q?.netMinor).toBe(0);
  });

  it("is null with no rate, so a village redeeming for services quotes nothing", () => {
    expect(redemptionQuote({ amountUnits: 5000, decimals: 2, rate: null, feePct: 2, feeFixed: 0 })).toBeNull();
  });
});

describe("the caps, in the member's own words", () => {
  const base = {
    valued: true,
    capsSet: true,
    grossMinor: 10000,
    minMinor: 0,
    maxPerRequestMinor: 0,
    memberSoFarMinor: 0,
    memberCapMinor: 0,
    villageSoFarMinor: 0,
    villageCapMinor: 0,
    grossText: "$100.00",
    minText: "$0.00",
    maxText: "$0.00",
    memberLeftText: "$0.00",
    villageLeftText: "$0.00",
  };

  it("lets a request through when no cap is set", () => {
    expect(redemptionMoneyRefusal(base)).toBeNull();
  });

  it("refuses below the floor, and names both numbers", () => {
    const no = redemptionMoneyRefusal({ ...base, minMinor: 20000, minText: "$200.00" });
    expect(no).toContain("$200.00");
    expect(no).toContain("$100.00");
  });

  it("refuses above the per-request ceiling", () => {
    expect(redemptionMoneyRefusal({ ...base, maxPerRequestMinor: 5000, maxText: "$50.00" })).toContain("$50.00");
  });

  it("counts what the member has already asked for this moon", () => {
    const no = redemptionMoneyRefusal({
      ...base,
      memberCapMinor: 15000,
      memberSoFarMinor: 10000,
      memberLeftText: "$50.00",
    });
    expect(no).toContain("$50.00");
  });

  it("counts what the whole village has already asked for this moon", () => {
    const no = redemptionMoneyRefusal({
      ...base,
      villageCapMinor: 15000,
      villageSoFarMinor: 14000,
      villageLeftText: "$10.00",
    });
    expect(no).toContain("$10.00");
    expect(no).toContain("new moon");
  });

  /*
   * THE DECISION WORTH PINNING. An unvalued request cannot be measured against
   * a cap, so it is refused while any cap is set rather than quietly exempted:
   * otherwise the only requests that escape the village's limit are the ones
   * nobody could price.
   */
  it("refuses an unvalued request while a cap is set, and allows it when none is", () => {
    expect(redemptionMoneyRefusal({ ...base, valued: false, capsSet: true, grossMinor: 0 })).toContain(
      "no rate for this token",
    );
    expect(redemptionMoneyRefusal({ ...base, valued: false, capsSet: false, grossMinor: 0 })).toBeNull();
  });
});

describe("the buy-and-redeem warning", () => {
  it("fires when the village pays more than it sells for, and never blocks", () => {
    const said = setRateAboveExchange({ setMinorPerToken: 600, exchangeMinorPerToken: 500, tokenName: "Village Credits" });
    expect(said).toContain("Village Credits");
    expect(said).toContain("at a profit");
  });

  it("says nothing when the village pays the same or less, or when either side is unpriced", () => {
    expect(setRateAboveExchange({ setMinorPerToken: 500, exchangeMinorPerToken: 500, tokenName: "x" })).toBeNull();
    expect(setRateAboveExchange({ setMinorPerToken: 400, exchangeMinorPerToken: 500, tokenName: "x" })).toBeNull();
    expect(setRateAboveExchange({ setMinorPerToken: null, exchangeMinorPerToken: 500, tokenName: "x" })).toBeNull();
    expect(setRateAboveExchange({ setMinorPerToken: 600, exchangeMinorPerToken: null, tokenName: "x" })).toBeNull();
  });
});
