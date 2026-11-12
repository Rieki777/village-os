/**
 * Commitment as a percent (0383, lane E1): the readers, the size bands, the
 * fit, the quest ordering and the role filter. Pure.
 */
import { describe, expect, it } from "vitest";
import {
  commitmentOn,
  orderByFit,
  questFit,
  questSizeOf,
  readCommitmentInput,
  readCommitmentPct,
  roleBeyondReach,
  rolesWithinReach,
} from "./commitment";

describe("reading a percent", () => {
  it("takes whole numbers from 1 to 100, digits and a percent sign", () => {
    expect(readCommitmentPct(40)).toEqual({ ok: true, value: 40 });
    expect(readCommitmentPct("75")).toEqual({ ok: true, value: 75 });
    expect(readCommitmentPct("100%")).toEqual({ ok: true, value: 100 });
    expect(readCommitmentPct(1)).toEqual({ ok: true, value: 1 });
  });
  it("reads blank and null as not said", () => {
    for (const v of [null, undefined, ""]) expect(readCommitmentPct(v)).toEqual({ ok: true, value: null });
  });
  it("refuses zero, over 100, fractions and words", () => {
    for (const v of [0, 101, 33.5, "half", -10, true]) expect(readCommitmentPct(v).ok, String(v)).toBe(false);
  });
});

describe("a member's word", () => {
  const today = "2026-11-12";
  it("defaults to the season and today", () => {
    expect(readCommitmentInput({ pct: 60 }, today)).toEqual({ ok: true, value: { pct: 60, period: "season", fromDate: today, note: null } });
  });
  it("takes a moon or a week, a later day and a note", () => {
    const r = readCommitmentInput({ pct: "30", period: "week", fromDate: "2026-11-20", note: "  harvest   week " }, today);
    expect(r).toEqual({ ok: true, value: { pct: 30, period: "week", fromDate: "2026-11-20", note: "harvest week" } });
  });
  it("never back-dates: the history says what was true when it was said", () => {
    expect(readCommitmentInput({ pct: 60, fromDate: "2026-11-01" }, today).ok).toBe(false);
  });
  it("refuses a missing percent, an unknown period and a long note", () => {
    expect(readCommitmentInput({}, today).ok).toBe(false);
    expect(readCommitmentInput({ pct: 50, period: "year" }, today).ok).toBe(false);
    expect(readCommitmentInput({ pct: 50, note: "x".repeat(281) }, today).ok).toBe(false);
  });
});

describe("the word that holds today", () => {
  const h = [
    { id: 1, fromDate: "2026-09-01", pct: 80 },
    { id: 2, fromDate: "2026-11-01", pct: 40 },
    { id: 3, fromDate: "2026-11-01", pct: 50 },
    { id: 4, fromDate: "2026-12-01", pct: 100 },
  ];
  it("is the latest from-date on or before today, the later word winning a tie", () => {
    expect(commitmentOn(h, "2026-11-12")?.pct).toBe(50);
  });
  it("a word for a later day waits for that day", () => {
    expect(commitmentOn(h, "2026-11-30")?.pct).toBe(50);
    expect(commitmentOn(h, "2026-12-01")?.pct).toBe(100);
  });
  it("is null before any word holds", () => {
    expect(commitmentOn(h, "2026-08-01")).toBeNull();
  });
});

describe("quest size and fit", () => {
  it("every percent falls in exactly one band, easier to harder", () => {
    expect(questSizeOf(25)).toBe("light");
    expect(questSizeOf(26)).toBe("medium");
    expect(questSizeOf(60)).toBe("medium");
    expect(questSizeOf(61)).toBe("heavy");
    expect(questSizeOf(null)).toBeNull();
  });
  it("within ten points fits; below is easier; above is harder", () => {
    expect(questFit(50, 50)).toBe("fits");
    expect(questFit(60, 50)).toBe("fits");
    expect(questFit(20, 50)).toBe("easier");
    expect(questFit(80, 50)).toBe("harder");
    expect(questFit(null, 50)).toBeNull();
    expect(questFit(50, null)).toBeNull();
  });
});

describe("quest ordering by fit", () => {
  const q = (id: string, pct: number | null) => ({ id, pct });
  const board = [q("heavy", 90), q("unsized", null), q("light", 10), q("near-above", 55), q("near-below", 45), q("exact", 50)];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("nearest first, easier before harder at the same distance, unsized last", () => {
    expect(ids(orderByFit(board, (x) => x.pct, 50))).toEqual(["exact", "near-below", "near-above", "light", "heavy", "unsized"]);
  });
  it("a member who gives little sees the lightest work first", () => {
    expect(ids(orderByFit(board, (x) => x.pct, 10))[0]).toBe("light");
    expect(ids(orderByFit(board, (x) => x.pct, 10)).indexOf("heavy")).toBe(4);
  });
  it("with no word from the member the board keeps its own order", () => {
    expect(ids(orderByFit(board, (x) => x.pct, null))).toEqual(ids(board));
  });
  it("does not mutate the board it was handed", () => {
    const copy = [...board];
    orderByFit(board, (x) => x.pct, 50);
    expect(board).toEqual(copy);
  });
});

describe("roles beyond reach", () => {
  const full = { commitmentPct: 100, commitmentRequired: true };
  it("a role that needs 100% is hidden from a member who can give less", () => {
    expect(roleBeyondReach(full, 60)).toBe(true);
    expect(roleBeyondReach(full, 100)).toBe(false);
  });
  it("a flexible role, an unsized one and a member with no word are never hidden", () => {
    expect(roleBeyondReach({ commitmentPct: 100, commitmentRequired: false }, 20)).toBe(false);
    expect(roleBeyondReach({ commitmentPct: null, commitmentRequired: true }, 20)).toBe(false);
    expect(roleBeyondReach(full, null)).toBe(false);
  });
  it("splits a list into within reach and beyond, keeping order", () => {
    const roles = [
      { id: "a", commitmentPct: 100, commitmentRequired: true },
      { id: "b", commitmentPct: 40, commitmentRequired: true },
      { id: "c", commitmentPct: 100, commitmentRequired: false },
      { id: "d", commitmentPct: 80, commitmentRequired: true },
    ];
    const r = rolesWithinReach(roles, (x) => x, 50);
    expect(r.shown.map((x) => x.id)).toEqual(["b", "c"]);
    expect(r.beyond.map((x) => x.id)).toEqual(["a", "d"]);
  });
});
