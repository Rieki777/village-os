/**
 * A role's CCOS words (0274): the one parser, its limits and its refusal
 * sentences, and the CCOS limits that bind a NEW write only.
 *
 *   - "This role exists while" and the three "Holding this role well" lines
 *     hold 300 characters, the time chip 80, and the two one-line fields
 *     refuse a line break;
 *   - "What I can decide on my own" and "What I do regularly" hold up to 8
 *     lines of 200 characters, sent as a list or one item per line;
 *   - payment details are refused in every one;
 *   - a role answers for 3 to 6 things once any is written: 2 and 7 are
 *     refused, none is "not written yet";
 *   - "How we'll know it's working" names 2 to 4 measures on a new write,
 *     while a stored scoreboard with 1 or 5 still loads.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNTABILITIES_MAX,
  ACCOUNTABILITIES_MIN,
  CCOS_LIST_ITEM_MAX,
  CCOS_LIST_MAX_ITEMS,
  ROLE_CCOS_COLUMNS,
  ROLE_CCOS_FIELDS,
  ROLE_CCOS_TEXT_MAX,
  ROLE_CCOS_WORDS,
  CARRIED_FROM_KEY,
  accountabilitiesProblem,
  payloadAccountabilitiesProblem,
  ccosWordsFromRow,
  readStoredCcosList,
  readStoredRoleText,
} from "./roleCcos";
import { parseCcosList, parseCcosText, parseRoleCcosField, roleCcosProblem } from "./roleCcosParse";
import { MEASURES_NEW_MESSAGE, parseSeatSettings } from "./seatSettings";
import { readTermsOffer } from "./seatTermsOffer";

const lines = (n: number, prefix = "Line") => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

describe("the seven fields and their columns", () => {
  it("names each draft key and the org_roles column it writes, in card order", () => {
    expect(ROLE_CCOS_FIELDS).toEqual(["existsWhile", "authorities", "responsibilities", "signsStretched", "flowsBack", "stepBack", "timeCommitment"]);
    expect(Object.values(ROLE_CCOS_COLUMNS)).toEqual([
      "exists_while", "authorities", "responsibilities", "signs_stretched", "flows_back", "step_back", "time_commitment",
    ]);
  });

  it("holds the brief's limits: 300, 8 by 200, 300 each, 80", () => {
    expect(ROLE_CCOS_TEXT_MAX).toEqual({ existsWhile: 300, signsStretched: 300, flowsBack: 300, stepBack: 300, timeCommitment: 80 });
    expect([CCOS_LIST_MAX_ITEMS, CCOS_LIST_ITEM_MAX]).toEqual([8, 200]);
    expect([ACCOUNTABILITIES_MIN, ACCOUNTABILITIES_MAX]).toEqual([3, 6]);
  });
});

describe("the parser", () => {
  it("reads a list sent as a list or one item per line, trimmed, blanks dropped", () => {
    expect(parseCcosList(["  Decide the intake form ", "", "Invite to a role"])).toEqual({ ok: true, value: ["Decide the intake form", "Invite to a role"] });
    expect(parseCcosList("One\n\n  Two  \r\nThree")).toEqual({ ok: true, value: ["One", "Two", "Three"] });
  });

  it("reads null, an empty list and blank text as nothing written, which clears the field", () => {
    for (const v of [null, undefined, [], "", "  \n "]) expect(parseCcosList(v)).toEqual({ ok: true, value: null });
    for (const v of [null, "", "   "]) expect(parseCcosText("existsWhile", v)).toEqual({ ok: true, value: null });
  });

  it("refuses 9 lines, a 201-character line, and anything that is not words", () => {
    expect(parseCcosList(lines(8))).toEqual({ ok: true, value: lines(8) });
    expect(parseCcosList(lines(9))).toEqual({ ok: false, problem: "Up to 8 lines." });
    expect(parseCcosList(["x".repeat(200)]).ok).toBe(true);
    expect(parseCcosList(["x".repeat(201)])).toEqual({ ok: false, problem: "Keep each line to 200 characters." });
    expect(parseCcosList(42)).toEqual({ ok: false, problem: ROLE_CCOS_WORDS.notWords });
    expect(parseCcosList(["Fine", 7])).toEqual({ ok: false, problem: ROLE_CCOS_WORDS.notWords });
    expect(parseCcosText("flowsBack", { a: 1 })).toEqual({ ok: false, problem: ROLE_CCOS_WORDS.notWords });
  });

  it("holds each text field to its own length", () => {
    for (const f of ["existsWhile", "signsStretched", "flowsBack", "stepBack"] as const) {
      expect(parseCcosText(f, "x".repeat(300)).ok, f).toBe(true);
      expect(parseCcosText(f, "x".repeat(301)), f).toEqual({ ok: false, problem: "Keep it to 300 characters." });
    }
    expect(parseCcosText("timeCommitment", "Part of a full-time season")).toEqual({ ok: true, value: "Part of a full-time season" });
    expect(parseCcosText("timeCommitment", "x".repeat(81))).toEqual({ ok: false, problem: "Keep it to 80 characters." });
  });

  it("keeps the inline line and the chip to one line, and lets the three ARC lines run on", () => {
    expect(parseCcosText("existsWhile", "people arrive\nand need a way in")).toEqual({ ok: false, problem: "Keep it to one line." });
    expect(parseCcosText("timeCommitment", "Two\ndays")).toEqual({ ok: false, problem: "Keep it to one line." });
    expect(parseCcosText("stepBack", "Name it on Friday.\nCalls pause first.").ok).toBe(true);
  });

  it("refuses payment details in every field", () => {
    for (const f of ROLE_CCOS_FIELDS) {
      const r = parseRoleCcosField(f, f === "authorities" || f === "responsibilities" ? ["Pay into 12345678901"] : "Pay 12345678901");
      expect(r.ok, f).toBe(false);
      if (!r.ok) expect(r.problem, f).toMatch(/bank or card number/);
    }
  });

  it("names the field in a draft's refusal, and leaves a key the payload does not carry alone", () => {
    expect(roleCcosProblem({ authorities: lines(9) })).toBe("What I can decide on my own: Up to 8 lines.");
    expect(roleCcosProblem({ timeCommitment: "x".repeat(81) })).toBe("Time: Keep it to 80 characters.");
    expect(roleCcosProblem({ name: "Water Steward", aim: "Keep the springs" })).toBeNull();
    expect(roleCcosProblem(null)).toBeNull();
  });
});

describe("what a role answers for: 3 to 6, on a new write", () => {
  it("refuses 2 and 7, and passes 3 and 6", () => {
    expect(accountabilitiesProblem(lines(2))).toBe(ROLE_CCOS_WORDS.accountabilities);
    expect(accountabilitiesProblem(lines(7))).toBe(ROLE_CCOS_WORDS.accountabilities);
    expect(accountabilitiesProblem(lines(3))).toBeNull();
    expect(accountabilitiesProblem(lines(6))).toBeNull();
    expect(ROLE_CCOS_WORDS.accountabilities).toBe("A role answers for 3 to 6 things. Write each one on its own line.");
  });

  it("reads none as not written yet, counts only written lines, and judges only a list", () => {
    expect(accountabilitiesProblem([])).toBeNull();
    expect(accountabilitiesProblem(undefined)).toBeNull();
    expect(accountabilitiesProblem(["One", " ", "", "Two", "Three"])).toBeNull();
    expect(accountabilitiesProblem(["One", " ", "Two"])).toBe(ROLE_CCOS_WORDS.accountabilities);
    expect(accountabilitiesProblem("One; Two")).toBeNull();
  });

  it("is part of a draft's refusal, after the field checks", () => {
    expect(roleCcosProblem({ accountabilities: lines(2) })).toBe(ROLE_CCOS_WORDS.accountabilities);
    expect(roleCcosProblem({ accountabilities: lines(4), authorities: ["Decide the intake form"] })).toBeNull();
  });
});

describe("stored columns read back", () => {
  it("reads every column through its reader, and a malformed one as nothing written", () => {
    expect(
      ccosWordsFromRow({
        exists_while: "  people arrive  ",
        authorities: '["Decide the intake form", " ", 4]',
        responsibilities: ["Run onboarding calls"],
        signs_stretched: "",
        flows_back: null,
        step_back: "Name it on Friday.",
        time_commitment: "Part of a full-time season",
      }),
    ).toEqual({
      existsWhile: "people arrive",
      authorities: ["Decide the intake form"],
      responsibilities: ["Run onboarding calls"],
      signsStretched: null,
      flowsBack: null,
      stepBack: "Name it on Friday.",
      timeCommitment: "Part of a full-time season",
    });
    expect(readStoredCcosList("not json")).toBeNull();
    expect(readStoredCcosList("{}")).toBeNull();
    expect(readStoredRoleText(12)).toBeNull();
    // A row from before 0274 carries none of the columns.
    expect(Object.values(ccosWordsFromRow({ id: "r1" })).every((v) => v === null)).toBe(true);
  });
});

describe("how we'll know it's working: 2 to 4 measures on a new write", () => {
  const board = (n: number) => ({ v: 1, scoreboard: { measures: Array.from({ length: n }, (_, i) => ({ measure: `Measure ${i + 1}` })) } });

  it("refuses 1 and 5 on a new write, and passes 2 and 4", () => {
    for (const n of [1, 5]) {
      const r = parseSeatSettings(board(n), { newWrite: true });
      expect(r.ok, String(n)).toBe(false);
      expect(r.problems).toEqual([{ path: "scoreboard.measures", message: MEASURES_NEW_MESSAGE }]);
    }
    for (const n of [2, 4]) expect(parseSeatSettings(board(n), { newWrite: true }).ok, String(n)).toBe(true);
    expect(MEASURES_NEW_MESSAGE).toBe("Name 2 to 4 measures of how we'll know it's working.");
  });

  it("passes a scoreboard with no measures yet, and terms with no scoreboard", () => {
    expect(parseSeatSettings(board(0), { newWrite: true }).ok).toBe(true);
    expect(parseSeatSettings({ v: 1, term: { reviewOn: "2026-11-09" } }, { newWrite: true }).ok).toBe(true);
  });

  it("still loads a stored scoreboard with 1 or 5: a read never applies the limit", () => {
    for (const n of [1, 5]) {
      expect(parseSeatSettings(board(n)).ok, String(n)).toBe(true);
      expect(readTermsOffer(JSON.stringify(board(n))).ok, String(n)).toBe(true);
    }
  });

  it("refuses at the terms-on-offer door a draft writes through", () => {
    expect(readTermsOffer(board(1), { newWrite: true })).toEqual({ ok: false, problem: MEASURES_NEW_MESSAGE });
    expect(readTermsOffer(board(3), { newWrite: true }).ok).toBe(true);
  });
});

describe("a role carried in from its own card keeps its count", () => {
  it("lets a create_seat that carries a role in keep 1, 2 or 7 lines, and holds every edit here to 3 to 6", () => {
    const carried = { name: "Ceremony Keeper", accountabilities: ["The ceremony calendar"], [CARRIED_FROM_KEY]: "regen-civics" };
    expect(payloadAccountabilitiesProblem(carried)).toBeNull();
    expect(roleCcosProblem(carried, "create_seat")).toBeNull();
    // The same payload as an edit to a role here is held to the limit.
    expect(roleCcosProblem(carried, "update_seat")).toBe(ROLE_CCOS_WORDS.accountabilities);
    expect(roleCcosProblem(carried)).toBe(ROLE_CCOS_WORDS.accountabilities);
    // Without the key, a new role is held to it too; a blank key is no key.
    expect(roleCcosProblem({ ...carried, [CARRIED_FROM_KEY]: undefined }, "create_seat")).toBe(ROLE_CCOS_WORDS.accountabilities);
    expect(roleCcosProblem({ ...carried, [CARRIED_FROM_KEY]: " " }, "create_seat")).toBe(ROLE_CCOS_WORDS.accountabilities);
  });

  it("still runs every field's parser on a carried-in role", () => {
    expect(roleCcosProblem({ [CARRIED_FROM_KEY]: "regen-civics", authorities: lines(9) }, "create_seat")).toBe("What I can decide on my own: Up to 8 lines.");
  });
});
