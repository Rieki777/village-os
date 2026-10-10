/**
 * The structure change plan, against the shape the first real vendor sync sent
 * on 2026-10-09: circles under the vendor's own "Circle Name", one structure
 * proposal holding every seat, four of them named the same as live seats (one
 * name twice), and an old chart beside it with people in some of its seats.
 */
import { describe, expect, it } from "vitest";
import {
  decideStructure,
  planStructure,
  seatIdFor,
  type PlanLiveCircle,
  type PlanLiveSeat,
  type PlanProposal,
} from "./structurePlan";

const LIVE_CIRCLES: PlanLiveCircle[] = [
  { id: "general-circle", name: "General Coordinating Circle", parentCircleId: null, status: "active", isExample: false },
  { id: "development-circle", name: "Development Circle", parentCircleId: "general-circle", status: "active", isExample: false },
  { id: "outreach-growth-circle", name: "Outreach & Growth Circle", parentCircleId: "general-circle", status: "active", isExample: false },
  { id: "community-circle", name: "Community Circle", parentCircleId: "general-circle", status: "forming", isExample: false },
  { id: "old-dormant", name: "Old Dormant", parentCircleId: "general-circle", status: "dormant", isExample: false },
  { id: "example-circle", name: "Example Circle", parentCircleId: null, status: "active", isExample: true },
];

const LIVE_SEATS: PlanLiveSeat[] = [
  { id: "operations-steward", name: "Operations Steward", circleId: "general-circle", active: true, isExample: false, holders: 0 },
  { id: "project-manager", name: "Project Manager", circleId: "development-circle", active: true, isExample: false, holders: 1 },
  { id: "sales-lead", name: "Sales Lead", circleId: "outreach-growth-circle", active: true, isExample: false, holders: 0 },
  { id: "land-liaison", name: "Land Liaison", circleId: "development-circle", active: true, isExample: false, holders: 1 },
  { id: "potluck", name: "Potluck Priestess", circleId: "community-circle", active: true, isExample: false, holders: 0 },
  { id: "rested", name: "Rested Seat", circleId: "community-circle", active: false, isExample: false, holders: 0 },
  { id: "example-seat", name: "Example Seat", circleId: "example-circle", active: true, isExample: true, holders: 0 },
];

const circle = (id: string, name: string, extra: Record<string, unknown> = {}): PlanProposal => ({
  id,
  kind: "circle.proposed",
  payload: { "Circle Name": name, Status: "Active", Notes: "[Rewritten 2026-09-22 per V5]", vendorRecordId: id, ...extra },
});

/** The production shape: one structure, seats naming their circle in words. */
function batch(): PlanProposal[] {
  return [
    {
      id: "xprop-structure",
      kind: "org.proposed",
      payload: {
        title: "Structure suggested by the connected service",
        rationale: "The connected service suggests six seats.",
        seats: [
          { name: "Operations Steward", circleName: "Community Anchor", aim: "Day to day coordination.", id: "rec-ops-1" },
          { name: "Operations Steward", circleName: "Regenerative Business", aim: "Runs the ventures.", id: "rec-ops-2" },
          { name: "Project Manager", circleName: "Regenerative Development", aim: "Plans the build.", id: "rec-pm" },
          { name: "Sales Lead", circleName: "Regenerative Community", aim: "Lot sales.", id: "rec-sales" },
          { name: "Events Manager", circleName: "Regenerative Community", aim: "Gatherings.", id: "rec-events" },
          { name: "Development Manager", circleName: "Regenerative Development", aim: "Permits.", id: "rec-dev" },
        ],
      },
    },
    circle("xprop-anchor", "Community Anchor"),
    circle("xprop-business", "Regenerative Business", { parentCircleId: "Community Anchor" }),
    circle("xprop-development", "Regenerative Development", { parentCircleId: "Community Anchor" }),
    circle("xprop-community", "Regenerative Community", { parentCircleId: "Community Anchor" }),
    circle("xprop-tech", "Technology & Systems"),
    { id: "xprop-risk", kind: "risk.observed", payload: { Risk: "Permits slip" } },
  ];
}

const plan = () => planStructure(batch(), LIVE_CIRCLES, LIVE_SEATS);

/** Every match settled one way, so a test can change only what it is about. */
const settled = {
  "xprop-structure#0": { choice: "update" as const },
  "xprop-structure#1": { choice: "rename" as const, name: "Ventures Operations Steward" },
  "xprop-structure#2": { choice: "update" as const },
  "xprop-structure#3": { choice: "update" as const },
};

describe("planStructure", () => {
  it("names vendor circles, places seats in the circles the same batch makes, and nests only where told", () => {
    const p = plan();
    expect(p.circles.map((c) => [c.id, c.status, c.parentId, c.problem])).toEqual([
      ["community-anchor", "new", null, null],
      ["regenerative-business", "new", "community-anchor", null],
      ["regenerative-development", "new", "community-anchor", null],
      ["regenerative-community", "new", "community-anchor", null],
      ["technology-systems", "new", null, null],
    ]);
    // The vendor's change log is never a purpose.
    expect(p.circles.every((c) => c.purpose === null)).toBe(true);
    expect(p.seats.map((s) => s.circleId)).toEqual([
      "community-anchor", "regenerative-business", "regenerative-development",
      "regenerative-community", "regenerative-community", "regenerative-development",
    ]);
    expect(p.seats.every((s) => s.circleProblem === null && s.problem === null)).toBe(true);
    expect(p.notes).toEqual([{ proposalId: "xprop-risk", kind: "risk.observed" }]);
    // Examples and rested seats are not the live chart.
    expect(p.live.seats.map((s) => s.id)).not.toContain("example-seat");
    expect(p.live.seats.map((s) => s.id)).not.toContain("rested");
  });

  it("matches seats to live seats by the preview's name rule, and two may match one", () => {
    const matches = plan().seats.map((s) => s.match?.seatId ?? null);
    expect(matches).toEqual(["operations-steward", "operations-steward", "project-manager", "sales-lead", null, null]);
    expect(plan().seats[2].match?.holders).toBe(1);
    // Case and spacing do not hide a match.
    const shouty = planStructure(
      [{ id: "p1", kind: "role.proposed", payload: { role_name: "  sales LEAD ", circleId: "development-circle" } }],
      LIVE_CIRCLES,
      LIVE_SEATS,
    );
    expect(shouty.seats[0].match?.seatId).toBe("sales-lead");
  });

  it("reads a circle a live circle already answers to as live, so its seats land in the live one", () => {
    const p = planStructure(
      [
        circle("xc", "development circle"),
        { id: "xs", kind: "org.proposed", payload: { seats: [{ name: "Water Steward", circleName: "Development Circle" }] } },
      ],
      LIVE_CIRCLES,
      LIVE_SEATS,
    );
    expect(p.circles[0]).toMatchObject({ status: "live", id: "development-circle" });
    expect(p.seats[0]).toMatchObject({ circleId: "development-circle", circleProblem: null });
  });

  it("flags a nameless circle and a seat that names a circle nobody makes, and never invents a parent", () => {
    const p = planStructure(
      [
        circle("xc-blank", ""),
        circle("xc-orphan", "Orphan", { parentCircleId: "Nowhere" }),
        { id: "xs", kind: "org.proposed", payload: { seats: [{ name: "Lost Seat", circleName: "Atlantis" }] } },
      ],
      LIVE_CIRCLES,
      LIVE_SEATS,
    );
    expect(p.circles[0].problem).toBe("This circle came with no name");
    expect(p.circles[0].id).toBe("circle-xc-blank");
    expect(p.circles[1].parentId).toBeNull();
    expect(p.circles[1].problem).toContain('"Nowhere"');
    expect(p.seats[0].circleProblem).toContain('"Atlantis"');
  });

  it("slugs a vendor id and falls back when nothing slug-shaped is left", () => {
    expect(seatIdFor("Water Steward!", "fb")).toBe("water-steward");
    expect(seatIdFor("!!!", "fb")).toBe("fb");
  });
});

describe("decideStructure", () => {
  it("refuses while any match is unsettled, and says how many", () => {
    const d = decideStructure(plan(), {});
    expect(d.counts.matched).toBe(4);
    expect(d.counts.unsettled).toBe(4);
    expect(d.problems).toContain("4 seats already exist here. Choose what happens to each one.");
  });

  it("refuses two seats moving onto one live seat", () => {
    const d = decideStructure(plan(), {
      conflicts: { ...settled, "xprop-structure#1": { choice: "update" } },
    });
    expect(d.problems.some((p) => p.includes('"Operations Steward" can move only once'))).toBe(true);
  });

  it("turns a settled batch into one ordered set of changes: circles, updates, then new seats", () => {
    const d = decideStructure(plan(), { conflicts: settled });
    expect(d.problems).toEqual([]);
    expect(d.changes.map((c) => `${c.op} ${c.orgRoleId}`)).toEqual([
      "create_circle circle:community-anchor",
      "create_circle circle:regenerative-business",
      "create_circle circle:regenerative-development",
      "create_circle circle:regenerative-community",
      "create_circle circle:technology-systems",
      "update_seat operations-steward",
      "update_seat project-manager",
      "update_seat sales-lead",
      "create_seat rec-ops-2",
      "create_seat rec-events",
      "create_seat rec-dev",
    ]);
    // An update moves the live seat and takes the new wording, and never its holder count.
    const pm = d.changes.find((c) => c.orgRoleId === "project-manager")!;
    expect(pm.payload).toEqual({ name: "Project Manager", aim: "Plans the build.", circleId: "regenerative-development" });
    // The second Operations Steward lands under the name the steward typed.
    expect(d.changes.find((c) => c.orgRoleId === "rec-ops-2")!.payload.name).toBe("Ventures Operations Steward");
    expect(d.counts).toMatchObject({ newCircles: 5, newSeats: 3, matched: 4, unsettled: 0, updates: 3, kept: 11 });
    expect(d.accepted.sort()).toEqual(
      ["xprop-anchor", "xprop-business", "xprop-community", "xprop-development", "xprop-structure", "xprop-tech"].sort(),
    );
    expect(d.untouched).toEqual(["xprop-risk"]);
  });

  it("refuses a typed name that a live seat or another kept seat already has", () => {
    const taken = decideStructure(plan(), {
      conflicts: { ...settled, "xprop-structure#1": { choice: "rename", name: "land liaison" } },
    });
    expect(taken.problems).toContain('A live seat is already called "land liaison". Type a name of its own.');
    const twice = decideStructure(plan(), {
      conflicts: { ...settled, "xprop-structure#1": { choice: "rename", name: "Events Manager" } },
    });
    expect(twice.problems).toContain('Two seats in this change would be called "Events Manager".');
    const blank = decideStructure(plan(), { conflicts: { ...settled, "xprop-structure#1": { choice: "rename", name: "  " } } });
    expect(blank.problems[0]).toContain("Type a new name");
  });

  it("splits a structure when some of its seats are left out, and leaves the rest queued", () => {
    const d = decideStructure(plan(), {
      exclude: ["xprop-structure#4", "xprop-structure#1"],
      conflicts: { "xprop-structure#0": { choice: "update" }, "xprop-structure#2": { choice: "leave" }, "xprop-structure#3": { choice: "update" } },
    });
    expect(d.problems).toEqual([]);
    expect(d.split).toEqual([{ proposalId: "xprop-structure", kept: [0, 3, 5], left: [1, 2, 4] }]);
    expect(d.accepted).not.toContain("xprop-structure");
    expect(d.counts.matched).toBe(2);
  });

  it("refuses a seat whose new circle is left out, and a circle whose new parent is left out", () => {
    const d = decideStructure(plan(), { exclude: ["xprop-anchor"], conflicts: settled });
    expect(d.problems.some((p) => p.startsWith('"Regenerative Business" sits inside "Community Anchor"'))).toBe(true);
    expect(d.problems.some((p) => p.startsWith('"Operations Steward" sits in "Community Anchor"'))).toBe(true);
  });

  it("retires only empty, unheld old structure, and lists held seats to carry first", () => {
    const d = decideStructure(plan(), { conflicts: settled, retireOldChart: true }, "steward-1");
    // Project Manager moves (taken over). Land Liaison is held, so it stays and keeps its circle alive.
    expect(d.retire.carryFirst).toEqual([{ id: "land-liaison", name: "Land Liaison", circleId: "development-circle", holders: 1 }]);
    expect(d.retire.seats.map((s) => s.id)).toEqual(["potluck"]);
    // Outreach empties once Sales Lead moves; Community once Potluck rests. Development keeps a holder,
    // so its parent General stays too. A dormant circle is never retired twice.
    expect(d.retire.circles.map((c) => c.id).sort()).toEqual(["community-circle", "outreach-growth-circle"]);
    const rests = d.changes.filter((c) => c.op === "rest_seat" || c.op === "rest_circle");
    expect(rests.map((c) => `${c.op} ${c.orgRoleId}`)).toEqual([
      "rest_seat potluck",
      "rest_circle circle:outreach-growth-circle",
      "rest_circle circle:community-circle",
    ]);
    // A steward's retirement carries who chose it, which is what the preview reads.
    expect(rests.every((c) => c.payload.chosenBy === "steward-1")).toBe(true);
    expect(d.counts).toMatchObject({ retiringCircles: 2, retiringSeats: 1 });
  });

  it("retires a whole old branch once nobody is left in it", () => {
    const empty = LIVE_SEATS.map((s) => ({ ...s, holders: 0 }));
    const d = decideStructure(planStructure(batch(), LIVE_CIRCLES, empty), { conflicts: settled, retireOldChart: true }, "s");
    expect(d.retire.carryFirst).toEqual([]);
    expect(d.retire.circles.map((c) => c.id).sort()).toEqual(
      ["community-circle", "development-circle", "general-circle", "outreach-growth-circle"].sort(),
    );
  });

  it("keeps the retire switch off out of the changes, while still saying what it would do", () => {
    const d = decideStructure(plan(), { conflicts: settled });
    expect(d.changes.some((c) => c.op === "rest_seat" || c.op === "rest_circle")).toBe(false);
    expect(d.retire.circles.length).toBe(2);
    expect(d.counts.retiringCircles).toBe(0);
  });

  it("refuses an empty change and a kept nameless circle", () => {
    const p = plan();
    const all = [...p.circles.map((c) => c.key), ...p.seats.map((s) => s.key)];
    expect(decideStructure(p, { exclude: all }).problems).toContain("Nothing is kept in this change yet.");
    const blank = planStructure([circle("xc", "")], LIVE_CIRCLES, LIVE_SEATS);
    expect(decideStructure(blank, {}).problems[0]).toContain("This circle came with no name");
    expect(decideStructure(blank, { exclude: ["xc"] }).untouched).toEqual(["xc"]);
  });
});
