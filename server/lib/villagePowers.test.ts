import { describe, expect, it } from "vitest";
import { villagePowerRows, type VillagePowerInput } from "./villagePowers";
import { ALL_CAPABILITIES } from "../../shared/capabilities";

const NOW = new Date("2026-11-05T12:00:00Z");
const groups = [
  { id: "structure", name: "Structure", capabilities: ["org.seat", "org.decide"] },
  { id: "keepers", name: "Library keepers", capabilities: ["library.keep"] },
  { id: "demo", name: "Demo", capabilities: ["org.seat"], isExample: true },
];
const names: Record<string, { full: string; first: string }> = {
  rye: { full: "Rye Cordon", first: "Rye" },
  ana: { full: "Ana Ruiz", first: "Ana" },
};
const input = (over: Partial<VillagePowerInput> = {}): VillagePowerInput => ({
  holders: new Map(),
  groups,
  holdings: [],
  orgRoleName: (id) => ({ "ops-lead": "Ops lead" })[id],
  nameOf: (id) => names[id] ?? null,
  stageName: (cap) => (cap === "forum.post" ? "Member" : null),
  now: NOW,
  ...over,
});
const row = (rows: ReturnType<typeof villagePowerRows>, cap: string) => rows.find((r) => r.capability === cap)!;

describe("villagePowerRows: every power, and who holds it today", () => {
  it("lists every power the gate knows, once", () => {
    const rows = villagePowerRows(input());
    expect(rows.map((r) => r.capability).sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it("keeps ONE order whoever holds what (R55)", () => {
    const empty = villagePowerRows(input()).map((r) => r.capability);
    const busy = villagePowerRows(
      input({
        holdings: [{ roleId: "structure", userId: "rye", viaOrgRoleId: "ops-lead" }],
        holders: new Map([["library.keep", { roleId: "keepers", roleName: "Library keepers", movedAt: "x", byBallot: true }]]),
      }),
    ).map((r) => r.capability);
    expect(busy).toEqual(empty);
  });

  it("names a seat holder by the role they hold it through, the house way, and sends suggestions to them", () => {
    const r = row(villagePowerRows(input({ holdings: [{ roleId: "structure", userId: "rye", viaOrgRoleId: "ops-lead" }] })), "org.seat");
    expect(r.heldToday).toEqual(["Ops lead (Rye)"]);
    expect(r.suggestionsGoTo).toBe("holders");
  });

  it("names a direct holder by the group", () => {
    expect(row(villagePowerRows(input({ holdings: [{ roleId: "structure", userId: "ana" }] })), "org.decide").heldToday).toEqual(["Structure (Ana)"]);
  });

  it("control: with nobody holding it, nobody is named and a suggestion goes to a vote", () => {
    const r = row(villagePowerRows(input()), "org.seat");
    expect(r.heldToday).toEqual([]);
    expect(r.suggestionsGoTo).toBe("vote");
  });

  it("leaves out a lapsed holding, an example group and somebody with no name to give", () => {
    const rows = villagePowerRows(
      input({
        holdings: [
          { roleId: "structure", userId: "rye", termEndsAt: "2026-11-01T00:00:00Z" },
          { roleId: "demo", userId: "ana" },
          { roleId: "structure", userId: "ghost" },
        ],
      }),
    );
    expect(row(rows, "org.seat").heldToday).toEqual([]);
  });

  it("once the village holds a power it names the looking-after role, and a suggestion goes to a vote", () => {
    const r = row(
      villagePowerRows(
        input({
          holdings: [{ roleId: "keepers", userId: "ana" }],
          holders: new Map([["library.keep", { roleId: "keepers", roleName: "Library keepers", movedAt: "x", byBallot: true }]]),
        }),
      ),
      "library.keep",
    );
    // First names only, the house form (Rye, 2026-10-30): never "Ana Ruiz".
    expect(r.heldBy).toEqual({ roleName: "Library keepers", byBallot: true, movedAt: "x", people: ["Ana"] });
    expect(r.heldToday).toEqual([]);
    expect(r.suggestionsGoTo).toBe("vote");
  });

  it("carries a family, launch guidance and the stage by its name", () => {
    const r = row(villagePowerRows(input()), "forum.post");
    expect(r.family).toBe("voice");
    expect(r.guidance).toBe("everyday");
    expect(r.stage).toBe("Member");
    expect(row(villagePowerRows(input()), "steward.veto").guidance).toBe("mature-only");
  });

  it("carries no number a page could turn into a score", () => {
    for (const r of villagePowerRows(input())) {
      for (const [k, v] of Object.entries(r)) expect(typeof v, k).not.toBe("number");
    }
  });
});
