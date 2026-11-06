/**
 * The history strip a module page shows, from `module_events` and the vote
 * ledger. Two promises: a switch a vote wrote names the vote and no person,
 * and a member never learns what a village tried in preview.
 */
import { describe, expect, it } from "vitest";
import { composeModuleHistory } from "./moduleLibrary";

const at = (iso: string) => new Date(iso);

describe("composeModuleHistory", () => {
  const rows = [
    { from: "members", to: "off", at: at("2026-10-05T10:00:00Z"), byName: "Kira Hale" },
    { from: "off", to: "members", at: at("2026-10-03T10:00:01Z"), byName: null },
    { from: "preview", to: "off", at: at("2026-10-02T10:00:00Z"), byName: "Ada Moss" },
    { from: "off", to: "preview", at: at("2026-10-01T10:00:00Z"), byName: "Ada Moss" },
  ];
  const votes = [{ ballotId: "b-1", title: "Turn on Tools", newValue: "members", appliedAt: at("2026-10-03T10:00:00Z") }];

  it("names the vote for a switch a vote wrote, and the person for one a person made", () => {
    const out = composeModuleHistory(rows, votes, { steward: false });
    expect(out[0]).toMatchObject({ from: "members", to: "off", by: "Kira Hale", ballot: null });
    expect(out[1]).toMatchObject({ from: "off", to: "members", by: null, ballot: { id: "b-1", title: "Turn on Tools" } });
  });

  it("hides a preview below steward, and shows it to a steward", () => {
    expect(composeModuleHistory(rows, votes, { steward: false })).toHaveLength(2);
    const steward = composeModuleHistory(rows, votes, { steward: true });
    expect(steward).toHaveLength(4);
    expect(steward[3]).toMatchObject({ from: "off", to: "preview", by: "Ada Moss" });
  });

  it("does not credit a vote that wrote a different value or long before", () => {
    const far = [{ ...votes[0], appliedAt: at("2026-09-01T00:00:00Z") }];
    expect(composeModuleHistory(rows, far, { steward: false })[1].ballot).toBeNull();
  });
});
