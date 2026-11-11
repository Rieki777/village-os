/**
 * The plain-words note on an equity-kind token, and Amora's own wording (the
 * lead, 2026-11-11): three claims, and no promise of cash or equity.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { equityTokenNote } from "./tokenNote";

const seed = (f: string) => JSON.parse(readFileSync(new URL(`../server/seeds/amora/${f}`, import.meta.url), "utf8"));
const PROMISE = /\b(convert\w*|cash(ed)? out|redeem\w*|will be worth|worth more|grow into|turn into|turned into|exchange\w*)\b/i;

function saysTheThreeThings(text: string) {
  expect(text).toMatch(/tracks? contributions that were not paid/);
  expect(text).toMatch(/no financial value yet/);
  expect(text).toMatch(/still being decided together/);
  expect(text).not.toMatch(PROMISE);
}

describe("the equity token note", () => {
  it("names the token and says the three things", () => {
    const n = equityTokenNote("Earned Equity");
    expect(n.startsWith("Earned Equity tracks")).toBe(true);
    saysTheThreeThings(n);
  });
  it("still reads when the token has no name", () => {
    expect(equityTokenNote("  ").startsWith("This token tracks")).toBe(true);
  });
});

describe("Amora's token words", () => {
  it("describes Earned Equity in the three plain claims", () => {
    saysTheThreeThings(seed("token-descriptions-seed.json")["earned-equity"]);
  });
  it("keeps the value-token line free of any conversion", () => {
    const line: string = seed("money-claims-seed.json").valueConversion;
    expect(line).toContain("{value}");
    saysTheThreeThings(line);
    expect(line).not.toMatch(/cash|equity|off the platform/i);
  });
});
