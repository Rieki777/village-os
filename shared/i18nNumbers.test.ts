import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";
import { isolate, parseLocaleNumber } from "./i18nNumbers";

describe("parseLocaleNumber (spec §8 R3): what a member types, read the way their language writes numbers", () => {
  it.each([
    ["12,5", "es", 12.5],
    ["1.234,56", "es", 1234.56],
    ["1234,56", "es-CR", 1234.56],
    ["1 234,56", "fr", 1234.56],
    ["1\u202f234,56", "fr", 1234.56],
    ["12.5", "en", 12.5],
    ["1,234.56", "en", 1234.56],
    ["٢٣٫٥", "ar-EG", 23.5],
    ["  7 ", "es", 7],
    ["-3,25", "es", -3.25],
  ])("%s in %s -> %s", (text, locale, want) => {
    expect(parseLocaleNumber(text, locale)).toBeCloseTo(want, 10);
  });

  it.each([
    ["", "es"],
    ["abc", "es"],
    ["1,2,3", "en-XX-garbage!!"],
    ["12..5", "en"],
    ["1.2.3,4,5", "es"],
  ])("%s in %s is not a number", (text, locale) => {
    expect(parseLocaleNumber(text, locale)).toBeNull();
  });

  it("a Spanish member typing 12,5 colones stores 1250 minor units, not 125 (the bug R3 names)", () => {
    const major = parseLocaleNumber("12,5", "es")!;
    expect(Math.round(major * 100)).toBe(1250);
  });
});

describe("formatMoney with a locale: the reader's way of writing, never another currency", () => {
  it("English keeps today's spelling", () => {
    expect(formatMoney(1250, "USD")).toBe("$12.50");
  });
  it("Costa Rican Spanish writes colones its own way and still in colones", () => {
    const s = formatMoney(125000, "CRC", undefined, "es-CR");
    expect(s).toContain("₡");
    expect(s).toMatch(/1\s?250,00/);
  });
});

describe("isolate (spec §8 R15): names and figures inside right-to-left text", () => {
  it("wraps in first-strong isolates", () => {
    expect(isolate("Rick")).toBe("\u2068Rick\u2069");
  });
});
