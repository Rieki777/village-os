import { afterEach, describe, expect, it } from "vitest";
import { activateLocale } from "./i18n";
import { formatDate, formatMoneyMinor, formatNumber } from "./format";

afterEach(() => activateLocale("en", {}));

describe("format: Intl with the reader's locale (spec US5.2, §8 R10)", () => {
  it("English, by default", () => {
    expect(formatNumber(1234.5)).toBe("1,234.5");
    expect(formatMoneyMinor(1250, "USD")).toBe("$12.50");
    expect(formatDate(new Date(Date.UTC(2026, 10, 6, 12)), { dateStyle: "long", timeZone: "UTC" })).toBe("November 6, 2026");
  });

  it("Spanish with the browser's Costa Rican conventions, money still in the village's currency", () => {
    activateLocale("es", {}, "es-CR");
    expect(formatNumber(1234.5)).toMatch(/1\s?234,5/);
    expect(formatMoneyMinor(125000, "CRC")).toContain("₡");
    expect(formatDate(new Date(Date.UTC(2026, 10, 6, 12)), { dateStyle: "long", timeZone: "UTC" })).toBe("6 de noviembre de 2026");
  });

  it("a formatting locale of another language is ignored: Spanish catalog, Spanish conventions", () => {
    activateLocale("es", {}, "en-US");
    expect(formatNumber(1234.5)).toMatch(/1\.?234,5/);
  });

  it("Arabic keeps Latin digits on dates (R11: digits a member can read back into an input)", () => {
    activateLocale("ar", {});
    expect(formatDate(new Date(Date.UTC(2026, 10, 6, 12)), { year: "numeric", timeZone: "UTC" })).toMatch(/2026/);
  });
});
