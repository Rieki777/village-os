/**
 * SERA'S BUDGET LINES, READ INTO IMPORT ROWS: the pure half of the budget
 * puller (budgets spec R6, R15 to R17, R20; the contract's twelve fields).
 *
 *   planBudgetKind     the budget kind is planned from `tools/list` on its
 *                      own, by the same argument rule as the structure read,
 *                      and is never one of `HELD_KINDS` (R16)
 *   allowBudgetFields  the contract's fields cross, everything else is dropped
 *                      and named
 *   budgetCategoryOf   a fixed table onto our four; an unknown label is
 *                      `other`, its words kept as the source label (R20)
 *   periodForDates     an exact moon, a whole month, a season's dates, or a
 *                      span, in the village's zone (R6)
 *   seraBudgetRow      every refusal the puller makes itself (R15), and the
 *                      page-id mapping through the snapshot's stored match (R17)
 *   budgetPageOf       one page of an answer, in whichever shape it came
 *
 * No database, no network, no clock but the ones handed in.
 */
import { describe, expect, it } from "vitest";
import type { ToolInfo } from "./saberraClient";
import { HELD_KINDS, planKinds } from "./saberraKinds";
import {
  SERA_BUDGET_FIELDS,
  allowBudgetFields,
  budgetCategoryOf,
  budgetMatchesOf,
  budgetPageOf,
  isKnownCurrency,
  periodForDates,
  planBudgetKind,
  seraBudgetRow,
  type BudgetMatches,
  type BudgetRecordEnv,
} from "./saberraBudgetRecords";
import { CALENDAR_CLOCK, LUNAR_CLOCK, boundsForNumber } from "../../shared/cycleClock";
import { civilDateKey } from "../../shared/lunar";
import { moonDays } from "../../shared/moonRecap";
import { resolvePeriod } from "../../shared/budgets";
import type { Snapshot } from "../../shared/seraDifferences";

const TZ = "America/Costa_Rica";
const SEASONS = [{ id: "season-wet", startsOn: "2027-05-01", endsOn: "2027-11-01" }];
const ENV = { timezone: TZ, seasons: SEASONS };

const listRecords = (inputSchema: unknown): ToolInfo[] => [
  { name: "ask_sera", inputSchema: { type: "object", properties: { question: { type: "string" } } } },
  { name: "list_records", inputSchema },
];
const kindEnum = (values: string[], argument = "kind") => ({ type: "object", properties: { [argument]: { type: "string", enum: values }, limit: { type: "number" } } });

/** A page id that reads as one: 32 hex digits. */
const hex = (n: number) => n.toString(16).padStart(32, "0");

describe("planBudgetKind: the budget kind, planned on its own (R16)", () => {
  it("names the kind not offered when the service lists no list_records, no schema, or no budget among its kinds", () => {
    expect(planBudgetKind([])).toMatchObject({ offered: false });
    expect(planBudgetKind(listRecords(null))).toMatchObject({ offered: false });
    expect(planBudgetKind(listRecords({ type: "object", properties: {} }))).toMatchObject({ offered: false });
    expect(planBudgetKind(listRecords(kindEnum(["circle", "role", "role_assignment"])))).toMatchObject({ offered: false });
  });

  it("asks under the argument and the spelling the service's own enum gives, a $ref enum included", () => {
    expect(planBudgetKind(listRecords(kindEnum(["circle", "role", "budget"])))).toMatchObject({ offered: true, argument: "kind", wire: "budget" });
    expect(planBudgetKind(listRecords(kindEnum(["Circles", "Budgets"], "record_type")))).toMatchObject({ offered: true, argument: "record_type", wire: "Budgets" });
    const viaRef = {
      type: "object",
      properties: { kind: { $ref: "#/$defs/Kind" } },
      $defs: { Kind: { type: "string", enum: ["circle", "budget"] } },
    };
    expect(planBudgetKind(listRecords(viaRef))).toMatchObject({ offered: true, argument: "kind", wire: "budget" });
  });

  it("never takes a sort order that lists budget for the kind argument, while a familiar argument name is there", () => {
    const schema = { type: "object", properties: { kind: { type: "string", enum: ["circle", "role"] }, sort_by: { type: "string", enum: ["budget", "name"] } } };
    expect(planBudgetKind(listRecords(schema))).toMatchObject({ offered: false });
  });

  it("keeps budget out of the structure read: not a held kind, never asked by planKinds even when offered", () => {
    expect((HELD_KINDS as readonly string[]).includes("budget")).toBe(false);
    const plan = planKinds(listRecords(kindEnum(["circle", "role", "role_assignment", "budget"])));
    expect(plan.ask.map((a) => a.wire)).toEqual(["circle", "role", "role_assignment"]);
    expect(plan.notOffered.join(" ")).not.toContain("budget");
  });
});

describe("allowBudgetFields: the contract's fields cross, nothing else", () => {
  it("keeps exactly the twelve fields the contract names, from a flat record or one carrying its fields inside", () => {
    expect(Object.values(SERA_BUDGET_FIELDS).sort()).toEqual(
      ["category", "changedAt", "circle", "currency", "id", "label", "periodEnd", "periodStart", "plannedMinor", "role", "spentMinor", "status"],
    );
    const flat = allowBudgetFields({ id: "a", label: "Pay", plannedMinor: 5, holderName: "Wren Halloway", notes: "call Wren", url: "https://example.test/a" });
    expect(flat.values).toEqual({ id: "a", label: "Pay", plannedMinor: 5 });
    expect(flat.dropped).toEqual(["holderName", "notes", "url"]);
    const nested = allowBudgetFields({ id: "b", url: "https://example.test/b", fields: { label: "Seeds", currency: "CRC", "Active Holders": ["p-1"] } });
    expect(nested.values).toEqual({ id: "b", label: "Seeds", currency: "CRC" });
    // A key that is not shaped like a field name is counted and never named: it may be somebody's words.
    expect(nested.dropped).toEqual(["url", "1 more"]);
  });
});

describe("budgetCategoryOf: a fixed table onto our four (R20)", () => {
  it("reads our own four and the labels the table knows, and keeps an unknown label as the source label under other", () => {
    expect(budgetCategoryOf("role_pay")).toEqual({ category: "role_pay", sourceLabel: null });
    expect(budgetCategoryOf("Quest Pay")).toEqual({ category: "quest_pay", sourceLabel: null });
    expect(budgetCategoryOf("Stipends")).toEqual({ category: "role_pay", sourceLabel: null });
    expect(budgetCategoryOf("bounties")).toEqual({ category: "quest_pay", sourceLabel: null });
    expect(budgetCategoryOf("Supplies")).toEqual({ category: "materials", sourceLabel: null });
    expect(budgetCategoryOf("other")).toEqual({ category: "other", sourceLabel: null });
    expect(budgetCategoryOf("  Travel and lodging ")).toEqual({ category: "other", sourceLabel: "Travel and lodging" });
    expect(budgetCategoryOf("")).toBeNull();
    expect(budgetCategoryOf(7)).toBeNull();
  });
});

/** A lunar moon whose first civil day in the village's zone differs from its first day in UTC. */
function moonThatStartsADayEarlierHere(): number {
  const start = LUNAR_CLOCK.boundsFor(new Date("2026-11-09T12:00:00Z")).cycleNumber;
  for (let n = start; n < start + 60; n++) {
    const b = boundsForNumber(n);
    if (civilDateKey(b.startsAt, TZ) !== civilDateKey(b.startsAt, "UTC")) return n;
  }
  throw new Error("no such moon in five years, which the clock makes impossible");
}

describe("periodForDates: Sera's two civil dates as a period, in the village's zone (R6)", () => {
  it("names an exact moon by its id, read on the village's civil days, and the same moon on UTC days as a span", () => {
    const n = moonThatStartsADayEarlierHere();
    const b = boundsForNumber(n);
    const here = moonDays(b, TZ);
    expect(periodForDates(here.firstDay, here.lastDay, ENV, LUNAR_CLOCK)).toEqual({ ok: true, period: b.id, kind: "moon" });
    const utc = moonDays(b, "UTC");
    expect(utc.firstDay).not.toBe(here.firstDay);
    expect(periodForDates(utc.firstDay, utc.lastDay, ENV, LUNAR_CLOCK)).toEqual({ ok: true, period: `${utc.firstDay}..${utc.lastDay}`, kind: "span" });
    // The day before the moon starts, to its last day: a span, never the moon.
    const early = periodForDates("2026-01-01", here.lastDay, ENV, LUNAR_CLOCK);
    expect(early).toMatchObject({ ok: true, kind: "span" });
  });

  it("names a whole calendar month as YYYY-MM, a leap February included, and on a calendar clock that month is the moon", () => {
    expect(periodForDates("2026-11-01", "2026-11-30", ENV, LUNAR_CLOCK)).toEqual({ ok: true, period: "2026-11", kind: "month" });
    expect(periodForDates("2028-02-01", "2028-02-29", ENV, LUNAR_CLOCK)).toEqual({ ok: true, period: "2028-02", kind: "month" });
    expect(periodForDates("2026-11-01", "2026-11-29", ENV, LUNAR_CLOCK)).toEqual({ ok: true, period: "2026-11-01..2026-11-29", kind: "span" });
    expect(periodForDates("2026-11-01", "2026-11-30", ENV, CALENDAR_CLOCK)).toEqual({ ok: true, period: "month-2026-11", kind: "moon" });
    expect(periodForDates("2026-12-01", "2026-12-31", ENV, CALENDAR_CLOCK)).toEqual({ ok: true, period: "month-2026-12", kind: "moon" });
  });

  it("names a season by its dates, its last day the day before the season calendar's end, and anything else a span", () => {
    expect(periodForDates("2027-05-01", "2027-10-31", ENV, LUNAR_CLOCK)).toEqual({ ok: true, period: "season-wet", kind: "season" });
    expect(periodForDates("2027-05-01", "2027-11-01", ENV, LUNAR_CLOCK)).toMatchObject({ ok: true, kind: "span" });
    expect(periodForDates("2026-11-10", "2026-11-10", ENV, LUNAR_CLOCK)).toEqual({ ok: true, period: "2026-11-10..2026-11-10", kind: "span" });
  });

  it("gives a period the import reads back as the same kind and days", () => {
    const n = moonThatStartsADayEarlierHere();
    const here = moonDays(boundsForNumber(n), TZ);
    for (const [a, b] of [[here.firstDay, here.lastDay], ["2026-11-01", "2026-11-30"], ["2027-05-01", "2027-10-31"], ["2026-11-10", "2026-12-02"]]) {
      const p = periodForDates(a, b, ENV, LUNAR_CLOCK);
      if (!p.ok) throw new Error("expected a period");
      const back = resolvePeriod(p.period, ENV);
      expect(back).toMatchObject({ ok: true, period: { kind: p.kind, startsOn: a, endsOn: b } });
    }
  });

  it("refuses a date that is not a real day, a missing one, and an end before the start", () => {
    expect(periodForDates("2026-02-30", "2026-03-01", ENV, LUNAR_CLOCK)).toMatchObject({ ok: false });
    expect(periodForDates("2026-11-09T00:00:00Z", "2026-11-10", ENV, LUNAR_CLOCK)).toMatchObject({ ok: false });
    expect(periodForDates(null, "2026-11-10", ENV, LUNAR_CLOCK)).toMatchObject({ ok: false });
    expect(periodForDates("2026-11-10", "2026-11-09", ENV, LUNAR_CLOCK)).toMatchObject({ ok: false });
  });
});

const CIRCLE_PAGE = hex(1);
const ROLE_PAGE = hex(2);
const OTHER_ROLE_PAGE = hex(3);
const STRANGER_PAGE = hex(9);

const MATCHES: BudgetMatches = {
  circles: new Map([[CIRCLE_PAGE, "c-garden"]]),
  roles: new Map([
    [ROLE_PAGE, { roleId: "r-gardener", circleId: "c-garden" }],
    [OTHER_ROLE_PAGE, { roleId: "r-cook", circleId: "c-kitchen" }],
  ]),
};

const RECORD_ENV: BudgetRecordEnv = { period: ENV, clock: LUNAR_CLOCK, villageCurrency: "CRC", matches: MATCHES };

const record = (over: Record<string, unknown> = {}) => ({
  id: hex(100),
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  circle: null,
  role: null,
  category: "role_pay",
  label: "Garden crew pay",
  currency: "CRC",
  plannedMinor: 100_000,
  spentMinor: null,
  status: "approved",
  changedAt: "2026-11-08T10:00:00Z",
  ...over,
});

const reasonsOf = (over: Record<string, unknown>) => (seraBudgetRow(record(over), RECORD_ENV).row.refusedBySource ?? []).map((r) => `${r.cell}:${r.reason}`);

describe("seraBudgetRow: one record into one import row", () => {
  it("reads a good record into the row the import takes: the id alone as the source ref, the period, the category, the amounts", () => {
    const out = seraBudgetRow(record(), RECORD_ENV);
    expect(out.row).toEqual({
      sourceRef: hex(100),
      sourceChangedAt: "2026-11-08T10:00:00.000Z",
      period: "2026-11",
      circleId: null,
      roleId: null,
      matched: true,
      category: "role_pay",
      sourceLabel: null,
      label: "Garden crew pay",
      plannedMinor: 100_000,
      spentMinor: null,
      currency: "CRC",
      status: "approved",
    });
    expect(out.refused).toBe(false);
  });

  it("keeps the page id alone when an id arrives cut from a page address, and refuses an address or anything else that is not an id", () => {
    expect(seraBudgetRow(record({ id: `Garden-Pay-${hex(7)}` }), RECORD_ENV).row.sourceRef).toBe(hex(7));
    for (const id of [`https://sera.example.test/Garden-Pay-${hex(7)}`, "garden pay", "", 42, null]) {
      const out = seraBudgetRow(record({ id }), RECORD_ENV);
      expect(out.refused, String(id)).toBe(true);
      expect(out.row.refusedBySource?.map((r) => r.cell)).toEqual(["source_ref"]);
      // A refused id is never stored as a source ref, so it can never be the key of a line.
      expect(out.row.sourceRef).toBe("");
    }
  });

  it("refuses and counts every amount that is not a whole number of minor units, 0 or more, planned and spent alike", () => {
    expect(reasonsOf({ plannedMinor: 1500.5 })).toEqual(["planned:fractional"]);
    expect(reasonsOf({ plannedMinor: -1 })).toEqual(["planned:negative"]);
    expect(reasonsOf({ plannedMinor: "100000" })).toEqual(["planned:not_a_number"]);
    expect(reasonsOf({ plannedMinor: undefined })).toEqual(["planned:not_a_number"]);
    expect(reasonsOf({ plannedMinor: 2 ** 60 })).toEqual(["planned:too_large"]);
    expect(reasonsOf({ spentMinor: 0.25 })).toEqual(["spent:fractional"]);
    expect(reasonsOf({ spentMinor: -5 })).toEqual(["spent:negative"]);
    expect(reasonsOf({ spentMinor: 0 })).toEqual([]);
    expect(seraBudgetRow(record({ spentMinor: 4_000 }), RECORD_ENV).row.spentMinor).toBe(4_000);
  });

  it("refuses a currency no ISO list knows, and takes the village's own code and any known one", () => {
    expect(reasonsOf({ currency: "XYZ" })).toEqual(["currency:unknown_currency"]);
    expect(reasonsOf({ currency: "dollars" })).toEqual(["currency:unknown_currency"]);
    expect(reasonsOf({ currency: null })).toEqual(["currency:unknown_currency"]);
    expect(reasonsOf({ currency: "usd" })).toEqual([]);
    expect(seraBudgetRow(record({ currency: "usd" }), RECORD_ENV).row.currency).toBe("USD");
    expect(isKnownCurrency("CRC")).toBe(true);
    expect(isKnownCurrency("XYZ")).toBe(false);
  });

  it("refuses a circle or a role that is not an id, an unknown status, a category that is not text, a label that is not text, and dates that are not a period", () => {
    expect(reasonsOf({ circle: "Land & Ecology" })).toEqual(["circle:not_an_id"]);
    expect(reasonsOf({ role: { name: "Gardener" } })).toEqual(["role:not_an_id"]);
    expect(reasonsOf({ status: "cancelled" })).toEqual(["status:status"]);
    expect(reasonsOf({ status: undefined })).toEqual(["status:status"]);
    expect(reasonsOf({ category: "" })).toEqual(["category:category"]);
    expect(reasonsOf({ label: { text: "Pay" } })).toEqual(["label:label"]);
    expect(reasonsOf({ periodEnd: "2026-10-01" })).toEqual(["period:period"]);
    // Every problem a record has is named, not only the first.
    expect(reasonsOf({ plannedMinor: -3, currency: "XYZ" })).toEqual(["currency:unknown_currency", "planned:negative"]);
  });

  it("keeps a refused record's id as its source ref, so the import counts it as listed and keeps its last good version", () => {
    const out = seraBudgetRow(record({ plannedMinor: 1.5 }), RECORD_ENV);
    expect(out.row).toEqual({ sourceRef: hex(100), refusedBySource: [expect.objectContaining({ cell: "planned", reason: "fractional" })] });
  });

  it("maps an unknown category to other and keeps Sera's label as the source label, never over the line's own label", () => {
    const out = seraBudgetRow(record({ category: "Travel" }), RECORD_ENV).row;
    expect(out).toMatchObject({ category: "other", sourceLabel: "Travel", label: "Garden crew pay" });
  });

  it("maps circle and role page ids through the stored match only: matched, role-only, unmatched, and a pair the chart disagrees with", () => {
    // Dashes and case are one id, the way the snapshot keys its records.
    const dashed = `${CIRCLE_PAGE.slice(0, 8)}-${CIRCLE_PAGE.slice(8, 12)}-${CIRCLE_PAGE.slice(12, 16)}-${CIRCLE_PAGE.slice(16, 20)}-${CIRCLE_PAGE.slice(20)}`.toUpperCase();
    expect(seraBudgetRow(record({ circle: dashed }), RECORD_ENV).row).toMatchObject({ circleId: "c-garden", roleId: null, matched: true });
    expect(seraBudgetRow(record({ circle: CIRCLE_PAGE, role: ROLE_PAGE }), RECORD_ENV).row).toMatchObject({ circleId: "c-garden", roleId: "r-gardener", matched: true });
    // A role-only line: the import takes its circle from the role on the chart (M10).
    expect(seraBudgetRow(record({ role: ROLE_PAGE }), RECORD_ENV).row).toMatchObject({ circleId: null, roleId: "r-gardener", matched: true });
    // A page id the snapshot never matched: unmatched, never village-wide.
    expect(seraBudgetRow(record({ circle: STRANGER_PAGE }), RECORD_ENV).row).toMatchObject({ circleId: null, matched: false });
    expect(seraBudgetRow(record({ circle: CIRCLE_PAGE, role: STRANGER_PAGE }), RECORD_ENV).row).toMatchObject({ circleId: "c-garden", roleId: null, matched: false });
    // Sera puts the cook in the garden; the chart puts the cook in the kitchen. Nobody guesses which is right.
    expect(seraBudgetRow(record({ circle: CIRCLE_PAGE, role: OTHER_ROLE_PAGE }), RECORD_ENV).row).toMatchObject({ matched: false });
  });
});

describe("budgetMatchesOf: the snapshot's stored match, and nothing guessed", () => {
  const chart = {
    circles: [{ id: "c-garden", is_example: 0 }, { id: "c-demo", is_example: 1 }],
    roles: [{ id: "r-gardener", circle_id: "c-garden", is_example: 0 }],
  };
  const snapshot = (circles: Snapshot["circles"]["records"], roles: Snapshot["roles"]["records"] = []): Snapshot => ({
    takenAt: "2026-11-08T00:00:00.000Z",
    trigger: "by-hand",
    circles: { read: "whole", records: circles },
    roles: { read: "whole", records: roles },
  });

  it("takes each stored match whose subject is still on the chart, and leaves a record matched to nothing, kept before matches were stored, or matched to an example, unmatched", () => {
    const m = budgetMatchesOf(
      snapshot(
        [
          { id: CIRCLE_PAGE, fields: { "Circle Name": "Garden" }, match: { ourId: "c-garden", via: "pageId" } },
          // Its name is our circle's name, and it matched nothing: never matched by that name here.
          { id: hex(4), fields: { "Circle Name": "Garden" }, match: null },
          { id: hex(5), fields: { "Circle Name": "Kitchen" } },
          { id: hex(6), fields: { "Circle Name": "Demo" }, match: { ourId: "c-demo", via: "name" } },
          { id: hex(8), fields: { "Circle Name": "Gone" }, match: { ourId: "c-gone", via: "earlier" } },
        ],
        [{ id: ROLE_PAGE, fields: { "Role Name": "Gardener" }, match: { ourId: "r-gardener", via: "pageId" } }],
      ),
      chart,
    );
    expect(Array.from(m.circles.entries())).toEqual([[CIRCLE_PAGE, "c-garden"]]);
    expect(Array.from(m.roles.entries())).toEqual([[ROLE_PAGE, { roleId: "r-gardener", circleId: "c-garden" }]]);
  });

  it("matches nothing when no read has been kept yet", () => {
    const m = budgetMatchesOf(null, chart);
    expect(m.circles.size + m.roles.size).toBe(0);
  });
});

describe("budgetPageOf: one page of the answer, in whichever shape it came", () => {
  it("reads results with has_more and next_cursor, records with a cursor, and a bare list, and refuses prose", () => {
    expect(budgetPageOf({ results: [{ id: "a" }], has_more: true, next_cursor: "c2" })).toEqual({ records: [{ id: "a" }], next: "c2" });
    expect(budgetPageOf({ results: [{ id: "a" }], has_more: false, next_cursor: "c2" })).toEqual({ records: [{ id: "a" }], next: null });
    expect(budgetPageOf({ records: [], nextCursor: "c3" })).toEqual({ records: [], next: "c3" });
    expect(budgetPageOf([{ id: "b" }])).toEqual({ records: [{ id: "b" }], next: null });
    expect(budgetPageOf("Here are your budgets: ...")).toBeNull();
    expect(budgetPageOf({ budgets: "none" })).toBeNull();
  });
});
