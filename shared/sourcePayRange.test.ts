import { describe, expect, it } from "vitest";
import { rangeFromFields, rangeFromText, readPayRange } from "./sourcePayRange";

describe("rangeFromFields", () => {
  it("reads a whole structured range", () => {
    expect(
      rangeFromFields({ min: 800, max: "1,200", currency: "usd", per: "Month", budgetLine: "Stewardship", fundedFrom: "Grant", status: "Consented" }),
    ).toEqual({ min: 800, max: 1200, currency: "USD", per: "month", budgetLine: "Stewardship", fundedFrom: "Grant", status: "consented", from: "fields" });
  });
  it("does not guess a half-sent or backwards range", () => {
    expect(rangeFromFields({ min: 800, max: 1200, currency: "USD" })).toBeNull();
    expect(rangeFromFields({ min: 1200, max: 800, currency: "USD", per: "month" })).toBeNull();
    expect(rangeFromFields({ min: 800, max: 1200, per: "month" })).toBeNull();
  });
});

describe("rangeFromText", () => {
  it("reads one clear range with a currency and a period", () => {
    expect(rangeFromText("Range: $800 to $1,200 per month, paid after the grant lands.")).toMatchObject({ min: 800, max: 1200, currency: "USD", per: "month", from: "text" });
    expect(rangeFromText("Range: USD 500-700 per moon")).toMatchObject({ min: 500, max: 700, per: "moon" });
  });
  it("leaves anything ambiguous as text", () => {
    expect(rangeFromText("Range: 800 to 1200 per month")).toBeNull(); // no currency
    expect(rangeFromText("Range: $800 to $1,200")).toBeNull(); // no period
    expect(rangeFromText("Range: $800 to $1,200 per month or $9,000 to $12,000 per year")).toBeNull(); // two ranges
    expect(rangeFromText("$800 to $1,200 per month, or $20 per hour")).toBeNull(); // two periods
    expect(rangeFromText("$800 to \u20AC1,200 per month")).toBeNull(); // two currencies
    expect(rangeFromText("Paid once the grant lands")).toBeNull();
    expect(rangeFromText(null)).toBeNull();
  });
});

describe("readPayRange", () => {
  it("round-trips and refuses junk", () => {
    const r = rangeFromFields({ min: 1, max: 2, currency: "USD", per: "week" })!;
    expect(readPayRange(r)).toEqual(r);
    expect(readPayRange("x")).toBeNull();
    expect(readPayRange({ min: "a" })).toBeNull();
  });
});
