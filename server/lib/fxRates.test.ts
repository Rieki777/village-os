/**
 * The rates cache (0083, P8): the parser against a CAPTURED response, the URL
 * that carries no currency codes at all, and the presence that matters: CRC.
 *
 * THIS FILE USED TO ASSERT THE OPPOSITE. Until 2026-09-25 it pinned that the
 * source answers no colones, because the ECB daily reference list does not
 * carry them and never will. That was true of the ECB and is still true of
 * every provider derived from it (frankfurter, measured the same day: 29
 * quotes, no CRC). The source changed because the first village this platform
 * serves prices in colones, and Rye asked for one that needs no key.
 *
 * The capture below is trimmed from the live answer of 2026-09-25: the
 * envelope verbatim, and five rates of the 166, chosen so that the one this
 * change exists for is the first of them.
 */
import { describe, expect, it } from "vitest";
import { dailyRatesUrl, FX_BASE, FX_QUOTES, parseDailyRates } from "./fxRates";

const CAPTURED = {
  result: "success",
  provider: "https://www.exchangerate-api.com",
  time_last_update_unix: 1790294551,
  time_last_update_utc: "Fri, 25 Sep 2026 00:02:31 +0000",
  base_code: "EUR",
  rates: {
    CRC: 515.670465,
    USD: 1.13807,
    CHF: 0.941694,
    GBP: 0.860483,
    CZK: 24.40159,
  },
};

describe("the daily parser", () => {
  it("reads quote, rate and the SOURCE's day from the captured response", () => {
    expect(parseDailyRates(CAPTURED)).toEqual([
      { quote: "CHF", rate: 0.941694, asOf: "2026-09-25" },
      { quote: "CRC", rate: 515.670465, asOf: "2026-09-25" },
      { quote: "CZK", rate: 24.40159, asOf: "2026-09-25" },
      { quote: "GBP", rate: 0.860483, asOf: "2026-09-25" },
      { quote: "USD", rate: 1.13807, asOf: "2026-09-25" },
    ]);
  });

  it("FINDS CRC, which is the whole reason the source changed", () => {
    const crc = parseDailyRates(CAPTURED).find((r) => r.quote === "CRC");
    expect(crc, "the ECB list could never answer this").toBeTruthy();
    expect(crc!.rate).toBeGreaterThan(0);
  });

  it("refuses an error envelope rather than reading it as an empty day", () => {
    // This source answers HTTP 200 with result:"error". A parser that read
    // `rates` first would store nothing, silently, for as long as the refusal
    // lasted, and the job would report "nothing usable" every day quite truly.
    expect(parseDailyRates({ ...CAPTURED, result: "error", "error-type": "unsupported-code" })).toEqual([]);
  });

  it("refuses an answer in a DIFFERENT base, which would invert nothing and break everything", () => {
    expect(parseDailyRates({ ...CAPTURED, base_code: "USD" })).toEqual([]);
  });

  it("keeps only quotes the list names, so the response is data and not a permission", () => {
    const withStranger = { ...CAPTURED, rates: { ...CAPTURED.rates, ZZZ: 1.5, XYZ: 2 } };
    const quotes = parseDailyRates(withStranger).map((r) => r.quote);
    expect(quotes).not.toContain("ZZZ");
    expect(quotes).toContain("CRC");
  });

  it("survives junk without inventing a rate", () => {
    expect(parseDailyRates(null)).toEqual([]);
    expect(parseDailyRates({})).toEqual([]);
    expect(parseDailyRates({ ...CAPTURED, time_last_update_unix: 0 })).toEqual([]);
    const zero = { ...CAPTURED, rates: { ...CAPTURED.rates, CHF: 0, GBP: -1, USD: "x" } };
    const quotes = parseDailyRates(zero).map((r) => r.quote);
    expect(quotes).not.toContain("CHF");
    expect(quotes).not.toContain("GBP");
    expect(quotes).not.toContain("USD");
  });
});

describe("the daily URL", () => {
  it("carries no currency codes at all, so nothing stored can steer it", () => {
    const url = dailyRatesUrl();
    expect(url).toBe("https://open.er-api.com/v6/latest/EUR");
    // No skip for the base: the typechecker refuses `q === FX_BASE` here
    // because EUR is not IN this list, which is itself the property worth
    // pinning. The base appears in the URL exactly once, as the path, and no
    // quote appears at all.
    expect((FX_QUOTES as readonly string[]).includes(FX_BASE)).toBe(false);
    for (const q of FX_QUOTES) {
      expect(url, `${q} must not appear in the URL`).not.toContain(q);
    }
  });

  it("asks for CRC by asking for nothing: the list is applied to the ANSWER", () => {
    expect((FX_QUOTES as readonly string[]).includes("CRC")).toBe(true);
    expect(dailyRatesUrl()).not.toContain("CRC");
  });

  it("still names every quote the ECB list used to carry, so the swap took nothing away", () => {
    const old = ["USD", "CHF", "GBP", "JPY", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "MXN", "BRL", "PLN", "CZK"];
    for (const q of old) expect(FX_QUOTES as readonly string[], q).toContain(q);
  });
});
