import { describe, expect, it } from "vitest";
import { proposeStructure, type VendorRecord } from "./saberraProposals";
import { latestRolePay } from "./saberraRolePay";
import { readProposedSeats } from "../../shared/proposedSeats";
import type { SnapshotRow } from "../repos/saberraSnapshots";
import type { SnapshotRecord } from "../../shared/seraDifferences";

const circle: VendorRecord = { id: "c1", kind: "circle", fields: { "Circle Name": "Stewardship Circle" } };
const structured: VendorRecord = {
  id: "r1",
  kind: "role",
  fields: {
    "Role Name": "Steward of Coin",
    Circle: [{ id: "c1" }],
    "Pay Min": 800,
    "Pay Max": 1200,
    Currency: { name: "USD" },
    Per: { name: "Month" },
    "Budget Line": "Stewardship",
    "Funded From": "Operating grant",
    "Pay Status": { name: "Proposed" },
    "Compensation Terms": "Range: $1 to $2 per month",
  },
};
const textual: VendorRecord = {
  id: "r2",
  kind: "role",
  fields: { "Role Name": "Gardener", Circle: [{ id: "c1" }], "Compensation Terms": "Range: $300 to $500 per month, after the harvest." },
};
const ambiguous: VendorRecord = {
  id: "r3",
  kind: "role",
  fields: { "Role Name": "Cook", Circle: [{ id: "c1" }], "Compensation Terms": "Range: $300 to $500 per month or $4,000 to $5,000 per year" },
};

describe("a structured range from a sync", () => {
  const out = proposeStructure([circle, structured, textual, ambiguous], { sourceName: "Test Service" });
  const seat = (name: string) => out.payload.seats.find((s) => s.name === name) as Record<string, any>;

  it("reaches sourcePay.range, preferring the structured fields over the text", () => {
    expect(seat("Steward of Coin").sourcePay.range).toMatchObject({ min: 800, max: 1200, currency: "USD", per: "month", status: "proposed", budgetLine: "Stewardship", fundedFrom: "Operating grant", from: "fields" });
  });
  it("falls back to unambiguous text, and leaves ambiguous text as text", () => {
    expect(seat("Gardener").sourcePay.range).toMatchObject({ min: 300, max: 500, from: "text" });
    expect(seat("Cook").sourcePay.range).toBeUndefined();
    expect(seat("Cook").sourcePay.terms).toContain("per year");
  });
  it("never reaches a term or an offer: the seat carries no pay key but sourcePay", () => {
    for (const s of out.payload.seats) {
      expect(Object.keys(s).filter((k) => /pay|terms|offer|reward|range/i.test(k)).every((k) => k === "sourcePay")).toBe(true);
    }
    const read = readProposedSeats(out.payload.seats);
    expect(JSON.stringify(read)).not.toMatch(/"min":800/);
  });
  it("reports no structured pay field as unmapped", () => {
    expect(out.unmapped.filter((k) => /Pay |Currency|Per$|Budget|Funded/.test(k))).toEqual([]);
  });
});

describe("latestRolePay", () => {
  const rec = (id: string, ourId: string | null, fields: SnapshotRecord["fields"]): SnapshotRecord => ({ id, fields, ...(ourId ? { match: { ourId, via: "link" as const } } : {}) });
  const row = (seq: number, read: "whole" | "failed", records: SnapshotRecord[]): SnapshotRow => ({
    seq,
    snapshot: { takenAt: `2026-11-0${seq}T00:00:00Z`, trigger: "test", circles: { read: "whole", records: [] }, roles: { read, records } },
  });

  it("keys the newest whole read by our role id and skips unmatched records", () => {
    const rows = [
      row(3, "failed", []),
      row(2, "whole", [
        rec("a", "role-1", { "Pay Min": 800, "Pay Max": 1200, Currency: "USD", Per: "Month" }),
        rec("b", null, { "Pay Min": 1, "Pay Max": 2, Currency: "USD", Per: "Month" }),
        rec("c", "role-3", { "Role Name": "No pay here" }),
      ]),
      row(1, "whole", [rec("a", "role-1", { "Pay Min": 1, "Pay Max": 2, Currency: "USD", Per: "Week" })]),
    ];
    const r = latestRolePay(rows)!;
    expect(Object.keys(r.byRole)).toEqual(["role-1"]);
    expect(r.byRole["role-1"].range).toMatchObject({ min: 800, max: 1200, per: "month" });
    expect(r.readAt).toBe("2026-11-02T00:00:00Z");
  });
  it("is null when no read was whole", () => {
    expect(latestRolePay([row(1, "failed", [])])).toBeNull();
  });
});
