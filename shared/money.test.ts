/**
 * Display money (0083, P8): exponents from Intl, conversion as arithmetic,
 * and the rule that a missing rate shows the ORIGINAL currency instead of a
 * number invented from nothing.
 */
import { describe, expect, it } from "vitest";
import {
  convertMinor,
  crossRate,
  defaultDisplayCurrency,
  displayCurrencyProblem,
  exponentOf,
  formatMoney, hasDailyRate, projectCurrencyToStore, FX_QUOTES } from "./money";

describe("exponents", () => {
  it("reads them from Intl: two for francs, none for yen", () => {
    expect(exponentOf("CHF")).toBe(2);
    expect(exponentOf("USD")).toBe(2);
    expect(exponentOf("JPY")).toBe(0);
  });

  it("falls back to two for a code Intl does not know", () => {
    expect(exponentOf("ZZZ")).toBe(2);
  });
});

describe("convertMinor", () => {
  it("converts across equal exponents", () => {
    expect(convertMinor(1250, "USD", "CHF", 0.8)).toBe(1000);
  });

  it("honours both exponents: 500 yen at 0.006 is three dollars", () => {
    expect(convertMinor(500, "JPY", "USD", 0.006)).toBe(300);
    expect(convertMinor(300, "USD", "JPY", 1 / 0.006)).toBe(500);
  });
});

describe("crossRate over the base-EUR table", () => {
  const rates = { USD: 1.1699, CHF: 0.9353, GBP: 0.8567 };

  it("derives a pairwise rate through EUR", () => {
    expect(crossRate(rates, "USD", "CHF")).toBeCloseTo(0.9353 / 1.1699, 6);
    expect(crossRate(rates, "EUR", "USD")).toBeCloseTo(1.1699, 6);
    expect(crossRate(rates, "CHF", "CHF")).toBe(1);
  });

  it("answers null for a currency the table does not carry", () => {
    // The measured fact this feature is honest about: the ECB list has no
    // CRC, so colones cross to nothing until an admin records a manual rate.
    expect(crossRate(rates, "CRC", "CHF")).toBeNull();
    expect(crossRate(rates, "USD", "CRC")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("says the plain amount in its own currency", () => {
    expect(formatMoney(1250, "USD")).toBe("$12.50");
  });

  it("converts through a display currency when a rate exists", () => {
    expect(formatMoney(1250, "USD", { currency: "CHF", rate: 0.8 })).toContain("10.00");
    expect(formatMoney(1250, "USD", { currency: "CHF", rate: 0.8 })).toMatch(/CHF/);
  });

  it("shows the ORIGINAL currency whenever no rate exists", () => {
    const s = formatMoney(1250, "CRC", { currency: "CHF", rate: null });
    expect(s).toContain("CRC");
    expect(s).not.toContain("CHF");
  });

  it("never converts through a zero or junk rate", () => {
    expect(formatMoney(1250, "USD", { currency: "CHF", rate: 0 })).toContain("12.50");
    expect(formatMoney(1250, "USD", { currency: "CHF", rate: NaN })).toContain("12.50");
  });

  it("spells an unknown code plainly instead of throwing in a render", () => {
    const s = formatMoney(1250, "ZZZ");
    expect(s).toContain("ZZZ");
  });
});

describe("the starting display currency", () => {
  it("is the project's own fiat currency when declared", () => {
    expect(defaultDisplayCurrency({ country: "CR", fiatCurrency: "CRC" })).toBe("CRC");
  });

  it("is CHF when the project has not said (the universal default)", () => {
    expect(defaultDisplayCurrency({})).toBe("CHF");
    expect(defaultDisplayCurrency({ country: "", fiatCurrency: "" })).toBe("CHF");
    expect(defaultDisplayCurrency({ country: null, fiatCurrency: null })).toBe("CHF");
  });
});

describe("the preference gate", () => {
  it("takes three letters or nothing", () => {
    expect(displayCurrencyProblem("CHF")).toBeNull();
    expect(displayCurrencyProblem("crc")).toBeNull();
    expect(displayCurrencyProblem("")).toBeNull();
    expect(displayCurrencyProblem(null)).toBeNull();
    expect(displayCurrencyProblem("FRANCS")).toContain("three letter");
    expect(displayCurrencyProblem(12)).toContain("three letter");
  });
});

/**
 * WHAT A VILLAGE STORES AS ITS OWN CURRENCY, and what it means when it stores
 * nothing.
 *
 * `PUT /api/admin/brand` merged whatever arrived, so a value of spaces was
 * stored as spaces and three surfaces disagreed: the site fell back, because
 * every reader trims; the box showed empty behind the platform's own code; and
 * anything asking "has this village said?" saw a non-empty string and answered
 * yes. After the platform default moves to CHF, that mismatch stops being
 * visible anywhere, and this rule is the only thing that can still catch it.
 */
describe("projectCurrencyToStore", () => {
  it("keeps a real code, uppercased", () => {
    expect(projectCurrencyToStore(" chf ")).toEqual({ ok: true, value: "CHF" });
    expect(projectCurrencyToStore("CRC")).toEqual({ ok: true, value: "CRC" });
  });

  it("turns whitespace into blank, because blank means inherit", () => {
    // Not a refusal. The brand save carries the whole Make This Yours form in
    // one request, so refusing over characters the form never showed would
    // throw away the name, the tagline and the rest of somebody's afternoon.
    expect(projectCurrencyToStore("   ")).toEqual({ ok: true, value: "" });
    expect(projectCurrencyToStore("")).toEqual({ ok: true, value: "" });
    expect(projectCurrencyToStore(null)).toEqual({ ok: true, value: "" });
    expect(projectCurrencyToStore(undefined)).toEqual({ ok: true, value: "" });
  });

  it("refuses a code that is still wrong after trimming, in the shared sentence", () => {
    for (const bad of [" CH ", "EURO", "C1F", 12]) {
      const r = projectCurrencyToStore(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(displayCurrencyProblem("nope"));
    }
  });
});

/**
 * WHETHER A CURRENCY CONVERTS BY ITSELF. A question the rate source answers,
 * never a rule about what a village may choose.
 */
describe("hasDailyRate", () => {
  it("answers yes for the base and for every quote actually fetched", () => {
    expect(hasDailyRate("EUR")).toBe(true);
    for (const q of FX_QUOTES) expect(hasDailyRate(q)).toBe(true);
  });

  it("answers YES for CRC, since 2026-09-25, and the flip is the point", () => {
    /*
     * This case asserted FALSE until the source changed, and it was right to:
     * measured 2026-08-21, the ECB daily list does not carry colones and never
     * will, so the first village's own currency was the one a rule would have
     * refused. That is why this is a question and not a rule.
     *
     * The question has not changed. Its ANSWER has, because the source now
     * carries 165 quotes with no key. Keeping the case and flipping it is
     * deliberate: deleting it would lose the only place that records why the
     * platform ever had to ask.
     */
    expect(hasDailyRate("CRC")).toBe(true);
  });

  it("still answers no for a currency nobody quotes, so it is a question either way", () => {
    // The reason the manual-rate row exists. A village may name a currency no
    // source carries, and this must keep saying so rather than becoming a rule
    // now that the common cases happen to pass.
    expect(hasDailyRate("ZZZ")).toBe(false);
    expect(hasDailyRate("XBT")).toBe(false);
  });

  it("is case and space insensitive, and says no to nothing at all", () => {
    expect(hasDailyRate(" chf ")).toBe(true);
    expect(hasDailyRate("")).toBe(false);
    expect(hasDailyRate(null)).toBe(false);
  });

  it("is derived from the list the fetcher uses, so it cannot go stale", () => {
    // The list lives in this file and `server/lib/fxRates.ts` imports it. A
    // hand-typed copy beside the picker was the alternative, and it would
    // have been wrong the first time a quote was added.
    expect(FX_QUOTES.length).toBeGreaterThan(5);
    expect((FX_QUOTES as readonly string[]).includes("CRC")).toBe(true);
    // Every quote the list carried when it was the ECB's fourteen. The source
    // swap must not have quietly dropped one to gain the rest.
    for (const q of ["USD", "CHF", "GBP", "JPY", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "MXN", "BRL", "PLN", "CZK"]) {
      expect(FX_QUOTES as readonly string[], q).toContain(q);
    }
  });
});
