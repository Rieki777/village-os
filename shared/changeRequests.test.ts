/**
 * The pure rules of a change request (Rye, 2026-11-06): which setting each
 * change touches, the words a change request is made of, and how a change
 * joins, replaces or leaves a revision.
 */
import { describe, expect, it } from "vitest";
import {
  CHANGE_REQUEST_TITLE_MAX,
  CHANGE_REQUEST_WHY_MAX,
  GATHERING_LIMIT_KEY,
  changeKeyOf,
  changeRequestTextProblem,
  withChangeAdded,
  withChangeRemoved,
  withChangeReplaced,
} from "./changeRequests";
import { VARIABLES_BY_KEY } from "./gameVariables";
import { isMetaSetting } from "./ballotSubjects";

describe("changeKeyOf: the setting a change touches, in the keys the app already uses", () => {
  it("names a dial by its key, and an untyped pair as a dial", () => {
    expect(changeKeyOf({ kind: "dial", key: "governance.vote_days", to: "9" })).toBe("governance.vote_days");
    expect(changeKeyOf({ key: "governance.vote_days", to: "9" })).toBe("governance.vote_days");
  });

  it("names the other kinds the way their own doors already do", () => {
    expect(changeKeyOf({ kind: "module_lifecycle", moduleId: "journal", to: "members" })).toBe("module:journal");
    expect(changeKeyOf({ kind: "brand_field", field: "project.tagline", to: "x" })).toBe("brand:project.tagline");
    expect(changeKeyOf({ kind: "mint_rule", key: "mint:r1:amount", to: "5" })).toBe("mint:r1:amount");
    expect(changeKeyOf({ kind: "mode_switch", to: "token" })).toBe("governance.weight_mode");
    expect(changeKeyOf({ kind: "weight_allocation", userId: "u1", to: "3", note: "n" })).toBe("weight:u1");
    expect(changeKeyOf({ kind: "mint_rule_create", trigger: "quest", tokenSlug: "credits", amount: "5", ceiling: "0" })).toContain("quest:credits");
  });
});

describe("the words of a change request", () => {
  it("needs a title of 1 to 120 characters and a why of 1 to 4000", () => {
    expect(CHANGE_REQUEST_TITLE_MAX).toBe(120);
    expect(CHANGE_REQUEST_WHY_MAX).toBe(4000);
    expect(changeRequestTextProblem({ title: "Garden hours", why: "The kitchen opens later in winter." })).toBeNull();
    expect(changeRequestTextProblem({ title: "  ", why: "x" })).toMatch(/title/i);
    expect(changeRequestTextProblem({ title: "x".repeat(121), why: "x" })).toMatch(/120/);
    expect(changeRequestTextProblem({ title: "x", why: " " })).toMatch(/why/i);
    expect(changeRequestTextProblem({ title: "x", why: "x".repeat(4001) })).toMatch(/4000/);
  });
});

describe("a change joins, replaces or leaves the list", () => {
  const a = { kind: "dial" as const, key: "governance.vote_days", to: "9" };
  const b = { kind: "brand_field" as const, field: "project.tagline", to: "Hello" };

  it("adds a change at the end", () => {
    expect(withChangeAdded([a], b)).toEqual({ ok: true, items: [a, b] });
  });

  it("refuses the same setting twice, and says to edit the one already there", () => {
    const again = withChangeAdded([a, b], { key: "governance.vote_days", to: "10" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.problem).toMatch(/already changes/);
  });

  it("replaces a change in place, and refuses a replacement that collides with another change", () => {
    const next = withChangeReplaced([a, b], 0, { kind: "dial", key: "governance.vote_days", to: "11" });
    expect(next.ok && next.items[0]).toEqual({ kind: "dial", key: "governance.vote_days", to: "11" });
    const clash = withChangeReplaced([a, b], 1, { key: "governance.vote_days", to: "3" });
    expect(clash.ok).toBe(false);
  });

  it("removes a change by position, and refuses a position that is not there", () => {
    expect(withChangeRemoved([a, b], 0)).toEqual({ ok: true, items: [b] });
    expect(withChangeRemoved([a, b], 2).ok).toBe(false);
    expect(withChangeReplaced([a], 5, b).ok).toBe(false);
  });
});

describe("the gathering limit dial (C7, R20)", () => {
  it("defaults to 5, is structural, and can never be trialled", () => {
    const def = VARIABLES_BY_KEY[GATHERING_LIMIT_KEY];
    expect(def.default).toBe("5");
    expect(def.min).toBe(1);
    expect(def.max).toBe(50);
    expect(def.criticality).toBe("structural");
    expect(isMetaSetting(GATHERING_LIMIT_KEY)).toBe(true);
  });
});
