/**
 * byArrival: the only order a decider's page uses (Phase D, decider calm).
 * Oldest first, ties and undated rows in the order the server sent them, and
 * never a row lost or added.
 */
import { describe, expect, it } from "vitest";
import { byArrival } from "./deciderOrder";

const at = (r: { at: string | null }) => r.at;

describe("byArrival", () => {
  it("reads oldest first", () => {
    const rows = [
      { id: "c", at: "2026-11-07T10:00:00Z" },
      { id: "a", at: "2026-11-02T10:00:00Z" },
      { id: "b", at: "2026-11-04T10:00:00Z" },
    ];
    expect(byArrival(rows, at).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the server's order for a tie and puts a missing or unreadable date last", () => {
    const rows = [
      { id: "x", at: null },
      { id: "t1", at: "2026-11-03T00:00:00Z" },
      { id: "bad", at: "not a date" },
      { id: "t2", at: "2026-11-03T00:00:00Z" },
    ];
    expect(byArrival(rows, at).map((r) => r.id)).toEqual(["t1", "t2", "x", "bad"]);
  });

  it("returns every row once and leaves the input as it was", () => {
    const rows = [{ id: "b", at: "2026-11-05T00:00:00Z" }, { id: "a", at: "2026-11-01T00:00:00Z" }];
    const copy = rows.slice();
    const out = byArrival(rows, at);
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set(rows));
    expect(rows).toEqual(copy);
  });
});
