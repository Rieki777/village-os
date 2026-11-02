/**
 * The words a card uses for what a piece of work pays (0265). The figures are
 * the server's; what is proved here is that the words never invent one: no
 * conversion without a rate, no money figure for a token, no "inquire" when
 * something is known, and no summary of values held in different currencies
 * pretending to be one range.
 */
import { describe, expect, it } from "vitest";
import type { WorkPay } from "@shared/workValue";
import { badgeWords, cashWords, conversionTarget, factorWords, lineWords, linesWords, payHeadline, paySummary, summaryWords, valueWords, voiceNames } from "./workPay";

const RATES = { base: "EUR", asOf: "2026-10-21", rates: { CRC: 500, USD: 1.1, CHF: 0.95 } };

const pay = (over: Partial<WorkPay> = {}): WorkPay => ({ value: null, lines: [], source: "standard", cadence: "once", ...over });

describe("the value and its conversion", () => {
  it("converts into the village's own currency when the viewer has chosen nothing (readiness R154)", () => {
    expect(conversionTarget("CRC", "", "CHF")).toBe("CHF");
    const words = valueWords({ minor: 2500000, currency: "CRC" }, RATES, "", "CHF");
    expect(words.own).toContain("25,000");
    expect(words.converted).toMatch(/^about CHF\s47\.50$/);
  });

  it("converts into nothing when neither the viewer nor the village named a currency, never a borrowed dollar", () => {
    expect(conversionTarget("CRC", "", "")).toBeNull();
    expect(valueWords({ minor: 2500000, currency: "CRC" }, RATES, "", "").converted).toBeNull();
    expect(conversionTarget("CHF", "", "CHF"), "a value already in the village's currency").toBeNull();
  });

  it("converts into the viewer's own choice, and not at all when that is the value's own currency", () => {
    // Intl puts a no-break space after the code, so the match allows any space.
    expect(valueWords({ minor: 2500000, currency: "CRC" }, RATES, "CHF").converted).toMatch(/^about CHF\s47\.50$/);
    expect(conversionTarget("CRC", "CRC")).toBeNull();
    expect(valueWords({ minor: 2500000, currency: "CRC" }, RATES, "CRC").converted).toBeNull();
    expect(conversionTarget("USD", "")).toBeNull();
  });

  it("shows the value unconverted when there is no rate, which is honest", () => {
    expect(valueWords({ minor: 2500000, currency: "CRC" }, null, "").converted).toBeNull();
    expect(valueWords({ minor: 2500000, currency: "XXX" }, RATES, "").converted).toBeNull();
  });
});

describe("the tokens", () => {
  it("names each line by its live name, and never as money", () => {
    const lines = [
      { token: "credits", name: "Village Credits", amount: 40 },
      { token: "village-voice", name: "Village Voice", amount: 2.5 },
    ];
    expect(lineWords(lines[0])).toBe("40 Village Credits");
    expect(linesWords(lines)).toBe("40 Village Credits, 2.5 Village Voice");
  });
});

describe("a role's cash", () => {
  it("states a fixed amount and a range, per their period", () => {
    expect(cashWords({ kind: "fixed", currency: "CRC", minor: 2000000, minMinor: null, maxMinor: null, per: "month" })).toMatch(/^.*20,000.* a month$/);
    expect(cashWords({ kind: "range", currency: "USD", minor: null, minMinor: 10000, maxMinor: 20000, per: "moon" })).toBe("$100.00 to $200.00 a moon");
  });

  it("states nothing the terms do not carry", () => {
    expect(cashWords(null)).toBeNull();
    expect(cashWords({ kind: "fixed", currency: null, minor: 100, minMinor: null, maxMinor: null, per: null })).toBeNull();
  });
});

describe("what the card leads with", () => {
  it("says to inquire only when nothing at all is known", () => {
    expect(payHeadline(pay())).toBe("inquire");
    expect(payHeadline(pay({ lines: [{ token: "credits", name: "Village Credits", amount: 25 }] }))).toBe("paid-unvalued");
    expect(payHeadline(pay({ cash: { kind: "fixed", currency: "CRC", minor: 1, minMinor: null, maxMinor: null, per: "month" } }))).toBe("paid-unvalued");
    expect(payHeadline(pay({ value: { minor: 0, currency: "CRC" } }))).toBe("valued");
  });
});

describe("a summary of many", () => {
  it("states the range in the most common currency and every token any of them pays", () => {
    const s = paySummary([
      pay({ value: { minor: 500000, currency: "CRC" }, lines: [{ token: "credits", name: "Village Credits", amount: 10 }] }),
      pay({ value: { minor: 2500000, currency: "CRC" }, lines: [{ token: "village-voice", name: "Village Voice", amount: 5 }] }),
      pay({ value: { minor: 4000, currency: "USD" } }),
      pay(),
      null,
    ]);
    expect(s).toMatchObject({ count: 4, valued: 3, currency: "CRC", lowMinor: 500000, highMinor: 2500000 });
    expect(s.tokens).toEqual(["Village Credits", "Village Voice"]);
    expect(summaryWords(s)).toMatch(/^worth .*5,000(\.00)? to .*25,000(\.00)?, paid as Village Credits and Village Voice$/);
  });

  it("says nothing when nothing is valued or paid", () => {
    expect(summaryWords(paySummary([pay(), pay()]))).toBeNull();
  });
});

describe("Voice and badges, the rest of the full pay (2026-10-30)", () => {
  it("names the badge beside the token it multiplies, never as a new figure", () => {
    const b = { badge: "Builder", token: "village-voice", name: "Village Voice", factor: 2 };
    expect(badgeWords(b)).toBe("×2 Village Voice with the Builder badge");
    expect(factorWords(1.5)).toBe("×1.5");
    expect(factorWords(1.333333)).toBe("×1.33");
  });

  it("finds the Voice lines by the server's flag, not by the token's name", () => {
    const p = pay({
      lines: [
        { token: "village-credit", name: "Village Credits", amount: 40 },
        { token: "village-voice", name: "Say", amount: 5, voice: true },
      ],
    });
    expect(voiceNames(p)).toEqual(["Say"]);
    expect(voiceNames(pay())).toEqual([]);
  });
});
