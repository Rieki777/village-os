/**
 * THE CASH BUDGET'S PURE HALF (shared/budgets.ts), rule by rule from the
 * budgets spec v0.2: periods in days (R6), amounts as people type them (R12),
 * formula cells (R13), precedence by moon and scope (R4), pro-rating and the
 * figure with null and 0 kept apart (R7, R8), and what a caller hands the
 * engine.
 */
import { describe, expect, it } from "vitest";
import {
  budgetFigure,
  convertAtRate,
  inVillageCurrency,
  isFormulaCell,
  lineShareOfMoon,
  moonCashTerms,
  moonPeriod,
  moonPlan,
  NO_COMMITMENTS,
  precedence,
  rateDrift,
  rateUnits,
  readAmount,
  readCategory,
  resolvePeriod,
  shareMoved,
  shareState,
  type FigureLine,
  type MoonSpan,
} from "./budgets";
import { LUNAR_CLOCK } from "./cycleClock";
import { settleDeficit } from "./valuationSetting";

const EN = { locale: "en", chosen: true };
const EN_DEFAULT = { locale: "en", chosen: false };
const ES = { locale: "es", chosen: true };
const ENV = { timezone: "America/Costa_Rica", seasons: [{ id: "season-2", startsOn: "2026-11-01", endsOn: "2027-02-01" }, { id: "founding", startsOn: "2026-06-01", endsOn: null }] };

const moonAt = (iso: string): MoonSpan => {
  const id = LUNAR_CLOCK.boundsFor(new Date(iso)).id;
  const p = moonPeriod(id, ENV.timezone)!;
  return { id, startsOn: p.startsOn, endsOn: p.endsOn, days: p.days };
};

const line = (over: Partial<FigureLine> = {}): FigureLine => ({
  id: over.id ?? "bl-1",
  label: "Garden pay",
  source: "upload",
  periodKind: "span",
  periodKey: "x",
  startsOn: "2026-01-01",
  endsOn: "2026-12-31",
  circleId: null,
  roleId: null,
  matched: true,
  category: "role_pay",
  plannedMinor: 100_000,
  currency: "CRC",
  status: "approved",
  adoptedAt: null,
  ...over,
});

describe("amounts as people type them (R12)", () => {
  it("refuses one separator followed by exactly three digits until a format is chosen, then reads it that format's way", () => {
    expect(readAmount("1,234", "CRC", EN_DEFAULT)).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(readAmount("509.000", "CRC", { locale: "es", chosen: false })).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(readAmount("1,234", "CRC", EN)).toEqual({ ok: true, minor: 123_400, cell: "1,234" });
    // In Spanish the comma is the decimal mark, so the same cell has three fraction digits.
    expect(readAmount("1,234", "CRC", ES)).toMatchObject({ ok: false, reason: "too_precise" });
    // Two separators settle it whatever the format.
    expect(readAmount("509.000,00", "CRC", { locale: "es", chosen: false })).toMatchObject({ ok: true, minor: 50_900_000 });
    expect(readAmount("1,234.50", "USD", EN_DEFAULT)).toMatchObject({ ok: true, minor: 123_450 });
  });

  it("takes a currency symbol or code off first, and refuses a code that is not the line's currency", () => {
    expect(readAmount("\u20a1509.000,00", "CRC", ES)).toMatchObject({ ok: true, minor: 50_900_000 });
    expect(readAmount("USD 1,200.50", "USD", EN)).toMatchObject({ ok: true, minor: 120_050 });
    expect(readAmount("1200 CRC", "CRC", EN)).toMatchObject({ ok: true, minor: 120_000 });
    expect(readAmount("$1,200", "USD", EN)).toMatchObject({ ok: true, minor: 120_000 });
    expect(readAmount("USD 1,200", "CRC", EN)).toMatchObject({ ok: false, reason: "currency_mismatch" });
  });

  it("refuses more fraction digits than the currency's exponent, counted off the text", () => {
    expect(readAmount("12.34", "CRC", EN)).toMatchObject({ ok: true, minor: 1234 });
    expect(readAmount("12.345", "CRC", EN)).toMatchObject({ ok: false, reason: "too_precise" });
    expect(readAmount("12.340", "CRC", EN), "three digits even though the value is 12.34").toMatchObject({ ok: false, reason: "too_precise" });
    expect(readAmount("1,000", "JPY", EN)).toMatchObject({ ok: true, minor: 1000 });
    expect(readAmount("10.5", "JPY", EN)).toMatchObject({ ok: false, reason: "too_precise" });
    expect(readAmount(1.234, "CRC", EN)).toMatchObject({ ok: false, reason: "too_precise" });
    expect(readAmount(12.5, "CRC", EN)).toEqual({ ok: true, minor: 1250, cell: "12.5" });
  });

  it("refuses a value below 0 by its value, so a Unicode minus is caught as well as a typed one", () => {
    expect(readAmount("\u22125", "CRC", EN)).toMatchObject({ ok: false, reason: "negative" });
    expect(readAmount(-1, "CRC", EN)).toMatchObject({ ok: false, reason: "negative" });
    expect(readAmount("0", "CRC", EN)).toEqual({ ok: true, minor: 0, cell: "0" });
  });

  it("refuses an empty cell and one with no number", () => {
    expect(readAmount("", "CRC", EN)).toMatchObject({ ok: false, reason: "empty" });
    expect(readAmount("lots", "CRC", EN)).toMatchObject({ ok: false, reason: "unreadable" });
    expect(readAmount("1,2,3", "CRC", EN)).toMatchObject({ ok: false, reason: "unreadable" });
  });
});

describe("cells are values (R13)", () => {
  it("refuses an amount cell that starts like a formula, a tab or a carriage return", () => {
    for (const cell of ["=SUM(A1:A3)", "+5", "-5", "@5", "\t5", "\r5", " =1+1"]) {
      expect(readAmount(cell, "CRC", EN), cell).toMatchObject({ ok: false, reason: "formula" });
    }
  });

  it("names a label cell that starts like a formula, so it is kept as text and flagged", () => {
    expect(isFormulaCell("=HYPERLINK(\"x\")")).toBe(true);
    expect(isFormulaCell("@home")).toBe(true);
    expect(isFormulaCell("Seeds and tools")).toBe(false);
    expect(isFormulaCell("Tools - spring")).toBe(false);
  });
});

describe("categories", () => {
  it("reads a category the way a sheet writes it, and nothing else", () => {
    expect(readCategory("Role pay")).toBe("role_pay");
    expect(readCategory("quest-pay")).toBe("quest_pay");
    expect(readCategory("materials")).toBe("materials");
    expect(readCategory("salaries")).toBeNull();
  });
});

describe("periods in days (R6)", () => {
  it("reads a moon id as that moon's civil days in the village zone, and a calendar moon as its whole month", () => {
    const m = moonAt("2026-11-15T12:00:00Z");
    const r = resolvePeriod(m.id, ENV);
    expect(r).toEqual({ ok: true, period: { kind: "moon", key: m.id, startsOn: m.startsOn, endsOn: m.endsOn } });
    expect(resolvePeriod("month-2026-11", ENV)).toEqual({ ok: true, period: { kind: "moon", key: "month-2026-11", startsOn: "2026-11-01", endsOn: "2026-11-30" } });
  });

  it("reads a month, two dates, and a season by its id with its last day the day before endsOn", () => {
    expect(resolvePeriod("2026-02", ENV)).toEqual({ ok: true, period: { kind: "month", key: "2026-02", startsOn: "2026-02-01", endsOn: "2026-02-28" } });
    expect(resolvePeriod("2026-12", ENV)).toMatchObject({ ok: true, period: { endsOn: "2026-12-31" } });
    expect(resolvePeriod("2026-11-01..2026-12-15", ENV)).toEqual({ ok: true, period: { kind: "span", key: "2026-11-01..2026-12-15", startsOn: "2026-11-01", endsOn: "2026-12-15" } });
    expect(resolvePeriod("2026-11-01 to 2026-12-15", ENV)).toMatchObject({ ok: true, period: { key: "2026-11-01..2026-12-15" } });
    expect(resolvePeriod("season-2", ENV)).toEqual({ ok: true, period: { kind: "season", key: "season-2", startsOn: "2026-11-01", endsOn: "2027-01-31" } });
  });

  it("refuses an open-ended season, a month that is not one, a day that is not real, and dates the wrong way round", () => {
    expect(resolvePeriod("founding", ENV)).toMatchObject({ ok: false, message: expect.stringContaining("no end date") });
    expect(resolvePeriod("2026-13", ENV)).toMatchObject({ ok: false });
    expect(resolvePeriod("2026-02-30..2026-03-01", ENV)).toMatchObject({ ok: false });
    expect(resolvePeriod("2026-12-15..2026-11-01", ENV)).toMatchObject({ ok: false });
    expect(resolvePeriod("next spring", ENV)).toMatchObject({ ok: false });
    expect(resolvePeriod("", ENV)).toMatchObject({ ok: false });
  });
});

describe("pro-rating by days (R7, C2)", () => {
  it("counts a line for this very moon whole, and any other line by floor(planned x shared days / line days)", () => {
    const m = moonAt("2026-11-15T12:00:00Z");
    expect(lineShareOfMoon(line({ periodKind: "moon", periodKey: m.id, startsOn: m.startsOn, endsOn: m.endsOn, plannedMinor: 1001 }), m)).toMatchObject({ countedMinor: 1001, whole: true });
    const year = line({ startsOn: "2026-01-01", endsOn: "2026-12-31", plannedMinor: 365_00 });
    const share = lineShareOfMoon(year, m);
    expect(share.lineDays).toBe(365);
    expect(share.sharedDays).toBe(m.days);
    expect(share.countedMinor).toBe(Math.floor((365_00 * m.days) / 365));
    expect(lineShareOfMoon(line({ startsOn: "2025-01-01", endsOn: "2025-01-31" }), m)).toMatchObject({ countedMinor: 0, sharedDays: 0 });
  });

  it("never gives the moons a line crosses more than the line, over many random lines (a property test)", () => {
    // A seeded generator, so a failure names a line that can be run again.
    let seed = 20261108;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const first = LUNAR_CLOCK.boundsFor(new Date("2026-01-15T00:00:00Z")).cycleNumber;
    const moons: MoonSpan[] = [];
    for (let n = first - 1; n < first + 26; n++) {
      const id = `lunar-${String(n).padStart(6, "0")}`;
      const p = moonPeriod(id, ENV.timezone)!;
      moons.push({ id, startsOn: p.startsOn, endsOn: p.endsOn, days: p.days });
    }
    // The moons partition the days: each starts the day after the one before ends.
    for (let i = 1; i < moons.length; i++) expect(moons[i].startsOn > moons[i - 1].endsOn).toBe(true);
    for (let i = 0; i < 500; i++) {
      const startOffset = Math.floor(rand() * 600);
      const length = 1 + Math.floor(rand() * 400);
      const start = new Date(Date.UTC(2026, 0, 1 + startOffset)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(2026, 0, startOffset + length)).toISOString().slice(0, 10);
      const planned = Math.floor(rand() * 50_000_000);
      const l = line({ startsOn: start, endsOn: end, plannedMinor: planned });
      const total = moons.reduce((n, m) => n + lineShareOfMoon(l, m).countedMinor, 0);
      expect(total, `${start}..${end} at ${planned}`).toBeLessThanOrEqual(planned);
    }
  });
});

describe("precedence by moon and scope (R4)", () => {
  it("drops every library line in a category when the village's own people wrote a village-wide line in it", () => {
    const own = line({ id: "own", source: "manual" });
    const sera = line({ id: "sera-1", source: "sera", adoptedAt: "2026-11-01" });
    const seraCircle = line({ id: "sera-2", source: "sera", circleId: "c-garden", adoptedAt: "2026-11-01" });
    const seraQuest = line({ id: "sera-3", source: "sera", category: "quest_pay", adoptedAt: "2026-11-01" });
    const r = precedence([own, sera, seraCircle, seraQuest]);
    expect(r.kept.map((l) => l.id)).toEqual(["own", "sera-3"]);
    expect(r.dropped).toEqual([{ id: "sera-1", by: "village_line" }, { id: "sera-2", by: "village_line" }]);
  });

  it("drops only that circle's library lines for a circle line, and keeps two of the village's own lines both", () => {
    const own = line({ id: "own-c", source: "upload", circleId: "c-garden" });
    const own2 = line({ id: "own-c2", source: "upload", circleId: "c-garden" });
    const seraGarden = line({ id: "sera-g", source: "sera", circleId: "c-garden" });
    const seraKitchen = line({ id: "sera-k", source: "sera", circleId: "c-kitchen" });
    const r = precedence([own, own2, seraGarden, seraKitchen]);
    expect(r.kept.map((l) => l.id)).toEqual(["own-c", "own-c2", "sera-k"]);
    expect(r.dropped).toEqual([{ id: "sera-g", by: "circle_line" }]);
  });
});

describe("the village's own circle stands where village-wide stood (R34, R4)", () => {
  it("lets the village's own line on the village's circle drop every source line in its category, and a line on another circle drop only that circle's", () => {
    const own = line({ id: "own-v", source: "upload", circleId: "c-village" });
    const seraElsewhere = line({ id: "sera-k", source: "sera", circleId: "c-kitchen", adoptedAt: "2026-11-01" });
    const seraVillage = line({ id: "sera-v", source: "sera", circleId: "c-village", sourceVillageWide: true, adoptedAt: "2026-11-01" });
    expect(precedence([own, seraElsewhere, seraVillage], "c-village").dropped.map((d) => [d.id, d.by])).toEqual([["sera-k", "village_line"], ["sera-v", "village_line"]]);
    // Read without knowing the village's circle, the same line is only a circle line.
    expect(precedence([own, seraElsewhere, seraVillage], null).dropped.map((d) => [d.id, d.by])).toEqual([["sera-v", "circle_line"]]);
  });
});

describe("the moon's figure, with null and 0 kept apart (R7, R8)", () => {
  const m = moonAt("2026-11-15T12:00:00Z");
  const moonLine = (over: Partial<FigureLine> = {}) => line({ periodKind: "moon", periodKey: m.id, startsOn: m.startsOn, endsOn: m.endsOn, ...over });

  it("is null with no line, with only materials, and with no village currency", () => {
    expect(budgetFigure([], m, "CRC", NO_COMMITMENTS, "r")).toBeNull();
    expect(budgetFigure([moonLine({ category: "materials" })], m, "CRC", NO_COMMITMENTS, "r")).toBeNull();
    expect(budgetFigure([moonLine()], m, "", NO_COMMITMENTS, "r")).toBeNull();
    expect(budgetFigure([moonLine()], m, null, NO_COMMITMENTS, "r")).toBeNull();
  });

  it("is a figure with 0 left, never null, when the moon's commitments use it up", () => {
    const f = budgetFigure([moonLine({ plannedMinor: 50_000 })], m, "CRC", { ...NO_COMMITMENTS, roleMinor: 40_000, questMinor: 20_000 }, "rev-1");
    expect(f).not.toBeNull();
    expect(f).toMatchObject({ plannedMinor: 50_000, committedMinor: 60_000, leftMinor: 0, currency: "CRC", revision: "rev-1" });
  });

  it("subtracts every committed part, and leaves allowances out of role pay", () => {
    const f = budgetFigure([moonLine({ plannedMinor: 100_000 }), moonLine({ id: "bl-2", category: "quest_pay", plannedMinor: 20_000 })], m, "CRC", {
      roleMinor: 10_000, questMinor: 5_000, proposalMinor: 3_000, settingsMinor: 2_000, materialsMinor: 999_999, otherCurrencyRows: 0,
    }, "r")!;
    expect(f.plannedMinor).toBe(120_000);
    expect(f.committedMinor).toBe(20_000);
    expect(f.leftMinor).toBe(100_000);
  });

  it("counts only approved or closed lines in the village currency, adopted when the library sent them, and matched", () => {
    const lines = [
      moonLine({ id: "ok", plannedMinor: 1000 }),
      moonLine({ id: "closed", status: "closed", plannedMinor: 10 }),
      moonLine({ id: "usd", currency: "USD", plannedMinor: 500 }),
      moonLine({ id: "draft", status: "draft", plannedMinor: 500 }),
      moonLine({ id: "gone", status: "withdrawn", plannedMinor: 500 }),
      moonLine({ id: "waiting", source: "sera", circleId: "c-x", adoptedAt: null, plannedMinor: 500 }),
      moonLine({ id: "elsewhere", source: "sera", circleId: "c-y", matched: false, adoptedAt: "2026-11-01", plannedMinor: 500 }),
    ];
    const f = budgetFigure(lines, m, "CRC", NO_COMMITMENTS, "r")!;
    expect(f.plannedMinor).toBe(1010);
    expect(f.working.notCounted).toEqual([
      { id: "usd", reason: "currency", currency: "USD" },
      { id: "draft", reason: "status", currency: "CRC" },
      { id: "waiting", reason: "not_adopted", currency: "CRC" },
      { id: "elsewhere", reason: "unmatched", currency: "CRC" },
    ]);
    // Only lines that would never count, on their own, make the figure null.
    expect(budgetFigure([moonLine({ currency: "USD" })], m, "CRC", NO_COMMITMENTS, "r")).toBeNull();
  });
});

describe("what a caller hands the engine (R7)", () => {
  it("turns no budget into a 0 share and budgetSet false, and a budget with 0 left into a 0 share and budgetSet true", () => {
    expect(moonCashTerms(null, 100_000)).toEqual({ cashSharePct: 0, budgetSet: false });
    expect(moonCashTerms({ leftMinor: 0 }, 100_000)).toEqual({ cashSharePct: 0, budgetSet: true });
    expect(moonCashTerms({ leftMinor: 50_000 }, 100_000)).toEqual({ cashSharePct: 50, budgetSet: true });
  });

  it("never lets null reach the engine's ?? fallback, and never reads 0 left as no budget at settlement", () => {
    const noBudget = moonCashTerms(null, 100_000);
    const spent = moonCashTerms({ leftMinor: 0 }, 100_000);
    // The engine reads `ctx.cashSharePct ?? work.cashPct`: a number never falls through to the model's default.
    expect(noBudget.cashSharePct ?? 77).toBe(0);
    expect(spent.cashSharePct ?? 77).toBe(0);
    const paid = { baseUnits: 10, cashMinor: 0, credits: 10, earnedEquity: 0 };
    expect(settleDeficit(paid, noBudget.cashSharePct, undefined, { budgetSet: noBudget.budgetSet })).toMatchObject({ deficitUnits: 0, cashOwedLaterMinor: 0 });
    expect(settleDeficit(paid, spent.cashSharePct, undefined, { budgetSet: spent.budgetSet })).toMatchObject({ deficitUnits: 10, cashOwedLaterMinor: 1000, choice: "owed" });
  });

  it("says the share moved when it flips between set and unset, or the figure changes", () => {
    const m = moonAt("2026-11-15T12:00:00Z");
    const f = budgetFigure([line({ periodKind: "moon", periodKey: m.id, startsOn: m.startsOn, endsOn: m.endsOn })], m, "CRC", NO_COMMITMENTS, "r");
    const before = shareState(m.id, null, null);
    const after = shareState(m.id, f, null);
    expect(before).toEqual({ moonId: m.id, set: false, leftMinor: null, sharePct: null });
    expect(after).toMatchObject({ set: true, leftMinor: 100_000 });
    expect(shareMoved(before, after)).toBe(true);
    expect(shareMoved(after, shareState(m.id, f, null))).toBe(false);
    expect(shareState(m.id, f, 200_000).sharePct).toBe(50);
  });
});

describe("a rate a person locks on a line (spec 5a, option b; R8)", () => {
  const m = moonAt("2026-11-15T12:00:00Z");
  const usd = (over: Partial<FigureLine> = {}) => line({ periodKind: "moon", periodKey: m.id, startsOn: m.startsOn, endsOn: m.endsOn, currency: "USD", plannedMinor: 120_000, ...over });

  it("converts in minor units at the locked rate, read exactly off its decimal text, and floors the result", () => {
    // $1,200.00 at 509.86 colones per dollar.
    expect(convertAtRate(120_000, "USD", "CRC", "509.86000000")).toBe(61_183_200);
    // A rate float arithmetic gets wrong by a hair still lands exactly.
    expect(convertAtRate(10, "USD", "CRC", "0.29")).toBe(2);
    expect(convertAtRate(3, "USD", "CRC", "0.33333333")).toBe(0);
    // Exponents differ: yen have none, dinars have three.
    expect(convertAtRate(1000, "JPY", "CRC", "3.4")).toBe(340_000);
    expect(convertAtRate(12_345, "USD", "JPY", "150.5")).toBe(18_579);
    expect(convertAtRate(1_000, "KWD", "USD", "3.25")).toBe(325);
    expect(convertAtRate(100, "USD", "CRC", "0")).toBeNull();
    expect(convertAtRate(100, "USD", "CRC", "-1")).toBeNull();
    expect(rateUnits("509.86")).toEqual(BigInt("50986000000"));
    expect(rateUnits(509.86)).toEqual(BigInt("50986000000"));
  });

  it("counts a line in another currency once a rate is locked on it, converted, and pro-rated after conversion", () => {
    expect(budgetFigure([usd()], m, "CRC", NO_COMMITMENTS, "r"), "no lock, not counted yet").toBeNull();
    const locked = usd({ fxRate: "509.86000000", fxSource: "daily rate, open.er-api.com", fxAsOf: "2026-11-09", fxLockedBy: "u-1", fxLockedAt: "2026-11-09T10:00:00.000Z" });
    const f = budgetFigure([locked], m, "CRC", NO_COMMITMENTS, "r")!;
    expect(f.plannedMinor).toBe(61_183_200);
    expect(f.working.lines[0]).toMatchObject({ currency: "USD", plannedMinor: 120_000, convertedMinor: 61_183_200 });
    expect(f.working.lines[0].fx).toEqual({ rate: "509.86000000", source: "daily rate, open.er-api.com", asOf: "2026-11-09", lockedBy: "u-1", lockedAt: "2026-11-09T10:00:00.000Z" });
    // A line across two moons: converted first, then floor(converted x shared / line days).
    const long = usd({ periodKind: "span", periodKey: "s", startsOn: m.startsOn, endsOn: addDaysForTest(m.endsOn, 10), plannedMinor: 333, fxRate: "3.33333333" });
    const g = budgetFigure([long], m, "CRC", NO_COMMITMENTS, "r")!;
    const converted = convertAtRate(333, "USD", "CRC", "3.33333333")!;
    expect(g.plannedMinor).toBe(Math.floor((converted * m.days) / (m.days + 10)));
  });

  it("measures drift at today's rate for display only, and warns past 5%", () => {
    const locked = usd({ fxRate: "500.00000000" });
    expect(rateDrift(locked, "CRC", 515)).toMatchObject({ lockedMinor: 60_000_000, todayMinor: 61_800_000, pct: 3, overThreshold: false });
    expect(rateDrift(locked, "CRC", 530)).toMatchObject({ todayMinor: 63_600_000, pct: 6, overThreshold: true });
    expect(rateDrift(locked, "CRC", 470)).toMatchObject({ pct: -6, overThreshold: true });
    expect(rateDrift(locked, "CRC", null)).toMatchObject({ todayMinor: null, pct: null, overThreshold: false });
  });
});

function addDaysForTest(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

describe("the moon's plan by category and by circle, and moons ahead (R30, R31)", () => {
  const m = moonAt("2026-11-15T12:00:00Z");
  const moonLine = (over: Partial<FigureLine> = {}) => line({ periodKind: "moon", periodKey: m.id, startsOn: m.startsOn, endsOn: m.endsOn, ...over });

  it("sums the lines that count per category and per circle, village-wide lines as their own entry, after precedence and conversion", () => {
    const p = moonPlan(
      [
        moonLine({ id: "a", plannedMinor: 1000 }),
        moonLine({ id: "b", circleId: "c-garden", plannedMinor: 500 }),
        moonLine({ id: "c", circleId: "c-garden", category: "materials", plannedMinor: 200 }),
        moonLine({ id: "d", circleId: "c-kitchen", category: "quest_pay", currency: "USD", plannedMinor: 10, fxRate: "500" }),
        moonLine({ id: "e", source: "sera", adoptedAt: "2026-11-01", plannedMinor: 9999 }),
        moonLine({ id: "f", status: "draft", plannedMinor: 7777 }),
      ],
      m,
      "CRC",
    );
    expect(p.byCategory).toEqual({ role_pay: 1500, quest_pay: 5000, materials: 200, other: 0 });
    expect(p.cashPlannedMinor).toBe(6500);
    expect(p.totalMinor).toBe(6700);
    expect(p.byCircle).toEqual([
      { circleId: null, byCategory: { role_pay: 1000, quest_pay: 0, materials: 0, other: 0 }, totalMinor: 1000 },
      { circleId: "c-garden", byCategory: { role_pay: 500, quest_pay: 0, materials: 200, other: 0 }, totalMinor: 700 },
      { circleId: "c-kitchen", byCategory: { role_pay: 0, quest_pay: 5000, materials: 0, other: 0 }, totalMinor: 5000 },
    ]);
    expect(moonPlan([moonLine()], m, "").totalMinor, "no village currency, nothing counts").toBe(0);
  });

  it("never plans more across many moons than the lines hold, and agrees with the moon's figure (a property test of the multi-moon read)", () => {
    let seed = 991_1109;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const first = LUNAR_CLOCK.boundsFor(new Date("2026-01-15T00:00:00Z")).cycleNumber;
    const moons: MoonSpan[] = [];
    for (let n = first - 1; n < first + 26; n++) {
      const id = `lunar-${String(n).padStart(6, "0")}`;
      const p = moonPeriod(id, ENV.timezone)!;
      moons.push({ id, startsOn: p.startsOn, endsOn: p.endsOn, days: p.days });
    }
    const cats = ["role_pay", "quest_pay", "materials", "other"] as const;
    for (let i = 0; i < 200; i++) {
      const lines: FigureLine[] = [];
      for (let k = 0; k < 4; k++) {
        const off = Math.floor(rand() * 500);
        const len = 1 + Math.floor(rand() * 300);
        const usd = rand() < 0.3;
        lines.push(line({
          id: `l-${i}-${k}`,
          category: cats[Math.floor(rand() * 4)],
          circleId: rand() < 0.5 ? null : "c-x",
          startsOn: new Date(Date.UTC(2026, 0, 1 + off)).toISOString().slice(0, 10),
          endsOn: new Date(Date.UTC(2026, 0, off + len)).toISOString().slice(0, 10),
          plannedMinor: Math.floor(rand() * 5_000_000),
          currency: usd ? "USD" : "CRC",
          fxRate: usd ? "512.34567891" : null,
        }));
      }
      const held = lines.reduce((n, l) => n + inVillageCurrency(l, "CRC")!, 0);
      const plans = moons.map((mo) => moonPlan(lines, mo, "CRC"));
      expect(plans.reduce((n, p) => n + p.totalMinor, 0), `lines set ${i}`).toBeLessThanOrEqual(held);
      moons.forEach((mo, j) => expect(plans[j].cashPlannedMinor).toBe(budgetFigure(lines, mo, "CRC", NO_COMMITMENTS, "r")?.plannedMinor ?? 0));
    }
  });
});
