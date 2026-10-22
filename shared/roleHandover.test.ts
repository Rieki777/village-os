/**
 * The role's handover words: the one parser's limits and refusals, the stored
 * readers, and the `handoverChecks` contract the player card's meter reads.
 */
import { describe, expect, it } from "vitest";
import {
  HANDOVER_CARD_KEYS,
  HANDOVER_CHECK_WORDS,
  ROLE_HANDOVER_FIELDS,
  ROLE_HANDOVER_WORDS as W,
  handoverChecks,
  readStoredRoleList,
  readStoredRunbook,
  runbookIsLink,
} from "./roleHandover";
import { parseRoleHandoverField, parseRoleWordList, parseRunbook, roleHandoverProblem } from "./roleHandoverParse";

const fail = (r: { ok: boolean; problem?: string }) => (r.ok ? null : r.problem);

describe("parseRoleWordList: Bring me and Not mine to hold", () => {
  it("takes a list or one item per line, trims, and drops blanks", () => {
    expect(parseRoleWordList(["  A reading ", "", null, "The key"], "bringMe")).toEqual({ ok: true, value: ["A reading", "The key"] });
    expect(parseRoleWordList("Garden\r\n\nRoof gutters\n", "notMine")).toEqual({ ok: true, value: ["Garden", "Roof gutters"] });
  });

  it("reads null, an empty list and blank text as nothing written", () => {
    for (const v of [null, undefined, [], "", "  \n  "]) expect(parseRoleWordList(v, "bringMe")).toEqual({ ok: true, value: null });
  });

  it("holds at most 8 items of 160 characters each", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `Item ${i}`);
    expect(parseRoleWordList(eight, "bringMe").ok).toBe(true);
    expect(fail(parseRoleWordList([...eight, "Nine"], "bringMe"))).toBe(W.tooMany);
    expect(parseRoleWordList(["x".repeat(160)], "bringMe").ok).toBe(true);
    expect(fail(parseRoleWordList(["x".repeat(161)], "notMine"))).toBe(W.itemTooLong);
  });

  it("refuses what is not words", () => {
    for (const v of [42, { a: 1 }, true, [1], [["nested"]]]) expect(fail(parseRoleWordList(v, "bringMe"))).toBe(W.notWords);
  });

  it("refuses payment details", () => {
    expect(fail(parseRoleWordList(["Pay into 1234 5678 9012"], "bringMe"))).toBe(W.paymentDetails);
    expect(fail(parseRoleWordList(["IBAN GB29NWBK60161331926819"], "notMine"))).toBe(W.paymentDetails);
    // A date and a clock time are not account numbers.
    expect(parseRoleWordList(["Readings from 2026-10-22 at 10:00"], "bringMe").ok).toBe(true);
  });

  it("keeps https links and refuses every other scheme", () => {
    expect(parseRoleWordList(["The log at https://example.org/log"], "bringMe").ok).toBe(true);
    for (const bad of ["http://example.org", "See ftp://files.example.org", "javascript:alert(1)", "data:text/html,hi"]) {
      expect(fail(parseRoleWordList([bad], "bringMe")), bad).toBe(W.httpsOnly);
    }
    // A colon in words is words.
    expect(parseRoleWordList(["Data: the monthly readings", "Note: ask first"], "bringMe").ok).toBe(true);
  });
});

describe("parseRunbook: words or one https link", () => {
  it("keeps words, and keeps one https link", () => {
    expect(parseRunbook("  Check the tanks every Monday.  ")).toEqual({ ok: true, value: "Check the tanks every Monday." });
    expect(parseRunbook("https://example.org/runbook")).toEqual({ ok: true, value: "https://example.org/runbook" });
  });

  it("reads null and blank text as nothing written", () => {
    for (const v of [null, undefined, "", "   "]) expect(parseRunbook(v)).toEqual({ ok: true, value: null });
  });

  it("holds at most 2000 characters", () => {
    expect(parseRunbook("x".repeat(2000)).ok).toBe(true);
    expect(fail(parseRunbook("x".repeat(2001)))).toBe(W.runbookTooLong);
  });

  it("refuses a link that is not https, a link with no host, payment details and what is not words", () => {
    expect(fail(parseRunbook("http://example.org/runbook"))).toBe(W.httpsOnly);
    expect(fail(parseRunbook("https://"))).toBe(W.notALink);
    expect(fail(parseRunbook("Account 12345678"))).toBe(W.paymentDetails);
    expect(fail(parseRunbook(["a list"]))).toBe(W.notWords);
  });
});

describe("roleHandoverProblem: what a draft payload's preview line says", () => {
  it("names the field first, and checks only the keys a payload carries", () => {
    expect(roleHandoverProblem({ aim: "x" })).toBeNull();
    expect(roleHandoverProblem(null)).toBeNull();
    expect(roleHandoverProblem({ bringMe: ["ok"], runbook: "http://x.org" })).toBe(`Runbook: ${W.httpsOnly}`);
    expect(roleHandoverProblem({ notMine: Array(9).fill("x") })).toBe(`Not mine to hold: ${W.tooMany}`);
  });

  it("every field key parses through one door", () => {
    expect(ROLE_HANDOVER_FIELDS).toEqual(["bringMe", "notMine", "runbook"]);
    for (const f of ROLE_HANDOVER_FIELDS) expect(parseRoleHandoverField(f, null)).toEqual({ ok: true, value: null });
  });
});

describe("the stored readers", () => {
  it("read a JSON list, as text or parsed, and anything else as null", () => {
    expect(readStoredRoleList('["A","  B "]')).toEqual(["A", "B"]);
    expect(readStoredRoleList(["A", 3, ""])).toEqual(["A"]);
    for (const v of [null, undefined, "", "not json", "{}", "[]", 5]) expect(readStoredRoleList(v)).toBeNull();
    expect(readStoredRunbook("  words ")).toBe("words");
    expect(readStoredRunbook("   ")).toBeNull();
    expect(readStoredRunbook(7)).toBeNull();
  });

  it("say when a runbook is one link a reader may draw as a link", () => {
    expect(runbookIsLink("https://example.org/x")).toBe(true);
    expect(runbookIsLink("See https://example.org/x")).toBe(false);
    expect(runbookIsLink("http://example.org/x")).toBe(false);
    expect(runbookIsLink(null)).toBe(false);
  });
});

describe("handoverChecks: the contract the player card's handover meter reads", () => {
  const full = {
    aim: "Keep the springs running",
    domain: "The tanks",
    accountabilities: ["Test the water monthly"],
    bringMe: ["A reading"],
    notMine: ["Garden irrigation"],
    runbook: "https://example.org/water",
  };

  it("a role with every part written is complete and ready", () => {
    const c = handoverChecks(full);
    expect(c).toMatchObject({
      purpose: true, decide: true, countOnMe: true, bringMe: true, notMine: true,
      cardComplete: true, runbook: true, ready: true, done: 6, total: 6,
    });
    expect(c.checks.map((x) => x.key)).toEqual([...HANDOVER_CARD_KEYS, "runbook"]);
    expect(c.checks.every((x) => x.words === HANDOVER_CHECK_WORDS[x.key].done)).toBe(true);
  });

  it("a role with nothing written is all false, with the missing words", () => {
    const c = handoverChecks({});
    expect(c).toMatchObject({ cardComplete: false, runbook: false, ready: false, done: 0, total: 6 });
    expect(c.checks.map((x) => x.words)).toEqual(c.checks.map((x) => HANDOVER_CHECK_WORDS[x.key].missing));
  });

  it("blank text and blank-only lists count as not written", () => {
    const c = handoverChecks({ ...full, aim: "   ", bringMe: ["", "  "], runbook: " " });
    expect(c).toMatchObject({ purpose: false, bringMe: false, runbook: false, cardComplete: false, ready: false, done: 3 });
  });

  it("the card can be complete with no runbook, and ready only once one is written", () => {
    const c = handoverChecks({ ...full, runbook: null });
    expect(c).toMatchObject({ cardComplete: true, runbook: false, ready: false });
  });

  it("a runbook counts the moment it is not empty, whatever it says", () => {
    expect(handoverChecks({ runbook: "x" }).runbook).toBe(true);
    expect(handoverChecks({ runbook: "Ask around." }).runbook).toBe(true);
  });

  it("no word names a person, and none says seat or uses a long dash", () => {
    const all = [
      ...Object.values(HANDOVER_CHECK_WORDS).flatMap((w) => [w.label, w.done, w.missing]),
      ...Object.values(W).filter((v): v is string => typeof v === "string"),
    ];
    for (const s of all) {
      expect(s, s).not.toMatch(/\bseats?\b/i);
      expect(s, s).not.toMatch(/[–—]/);
    }
  });
});
