/**
 * A proposed seat, read from the shape a vendor actually sends.
 *
 * THE DEFECT THIS GUARDS. The accept path copied an allowlist of canonical key
 * names out of each proposed seat and dropped the rest in silence. A real first
 * batch of nineteen role records spelled the name `role_name`, the holder count
 * `seat_count`, gave the circle as a NAME under `circle`, and sent the
 * accountabilities as one "; "-separated string. All nineteen previewed as "A
 * seat needs a name", and a seat that did carry a name would have published
 * into no circle.
 *
 * The three REAL_ records below are copied from that batch with the seat,
 * circle and person names replaced. Their key sets and value shapes are
 * untouched, which is the part under test.
 *
 * Pure: no database, no server.
 */
import { describe, expect, it } from "vitest";
import {
  circlesNamed,
  normaliseAccountabilities,
  normaliseProposedSeat,
  readProposedSeats,
  type LiveCircle,
} from "./proposedSeats";

const CIRCLES: LiveCircle[] = [
  { id: "coordination", name: "Coordination & Records", aliases: ["Records"], isExample: false },
  { id: "trade", name: "Money & Trade", aliases: [], isExample: false },
  { id: "stewards", name: "Stewards", aliases: ["Stewardship Circle"], isExample: false },
  { id: "hearth-a", name: "Hearth", aliases: [], isExample: false },
  { id: "hearth-b", name: "Kitchen", aliases: ["hearth"], isExample: false },
  // Standing examples. Each would match a name below if examples counted.
  { id: "demo-soil", name: "Soil & Water", aliases: [], isExample: true },
  { id: "demo-trade", name: "Money & Trade", aliases: [], isExample: 1 },
];

const REAL_ONE = {
  role_name: "Record Steward",
  aim: "Review incoming cues and decisions in the shared memory system, assign owners to tasks, and keep a weekly review of the decision queue.",
  domain: "Decision queue management, task assignment oversight, shared memory maintenance, routing of governance items.",
  accountabilities:
    "Weekly review of pending decisions and tasks; assignment of ownership; routing to appropriate roles or profiles; verification of machine-generated task assignments before implementation; maintenance of decision queue status.",
  circle: "Coordination & Records",
  seat_count: 1,
  recruiting: false,
};

const REAL_TWO = {
  role_name: "Lot Sales Steward",
  aim: "Turn the six outer lots into closed sales.",
  domain: null,
  accountabilities:
    "Own the buyer pipeline end to end: every lead in the tracker, every conversation logged. Coordinate the outside agents. Drive one lot to the first closing.",
  circle: "Money & Trade",
  seat_count: 1,
  recruiting: true,
};

const REAL_THREE = {
  role_name: "Vision Keeper",
  aim: "Hold and articulate the founding vision, and keep decisions aligned with it.",
  domain: "Vision articulation, mission alignment, strategic guidance, community values",
  accountabilities:
    "Ensure decisions align with the 'village first, development second' philosophy; advocate for mission protection within the circle; represent long-term community and land interests",
  circle: "Stewardship Circle",
  seat_count: 1,
  recruiting: false,
};

describe("a vendor's real role record", () => {
  it("reads role_name, seat_count, a circle name and a string of accountabilities", () => {
    const r = normaliseProposedSeat(REAL_ONE, CIRCLES);
    expect(r.payload).toEqual({
      name: "Record Steward",
      aim: REAL_ONE.aim,
      domain: REAL_ONE.domain,
      recruiting: false,
      seats: 1,
      accountabilities: [
        "Weekly review of pending decisions and tasks",
        "assignment of ownership",
        "routing to appropriate roles or profiles",
        "verification of machine-generated task assignments before implementation",
        "maintenance of decision queue status",
      ],
      circleId: "coordination",
    });
    expect(r.ignored).toEqual([]);
    expect(r.circleProblem).toBeNull();
  });

  it("keeps a null domain, and keeps sentences inside one accountability together", () => {
    const r = normaliseProposedSeat(REAL_TWO, CIRCLES);
    expect(r.payload.name).toBe("Lot Sales Steward");
    expect(r.payload.domain).toBeNull();
    expect(r.payload.recruiting).toBe(true);
    // Only ";" and newlines separate. Periods inside stay; the one at the end goes.
    expect(r.payload.accountabilities).toEqual([
      "Own the buyer pipeline end to end: every lead in the tracker, every conversation logged. Coordinate the outside agents. Drive one lot to the first closing",
    ]);
    // The example circle with the same name does not make this ambiguous.
    expect(r.payload.circleId).toBe("trade");
    expect(r.ignored).toEqual([]);
  });

  it("places a circle given by one of its aliases", () => {
    const r = normaliseProposedSeat(REAL_THREE, CIRCLES);
    expect(r.payload.circleId).toBe("stewards");
    expect(r.payload.accountabilities).toHaveLength(3);
    expect(r.payload).not.toHaveProperty("circleName");
  });
});

describe("aliases", () => {
  it("lets the canonical key win when both it and an alias carry a value", () => {
    const r = normaliseProposedSeat(
      {
        name: "Canonical",
        role_name: "Alias",
        roleName: "Other alias",
        seats: 2,
        seat_count: 9,
        seatCount: 8,
        whyItMatters: "canonical reason",
        why_it_matters: "alias reason",
        circleId: "trade",
        circle_id: "coordination",
      },
      CIRCLES,
    );
    expect(r.payload).toEqual({ name: "Canonical", seats: 2, whyItMatters: "canonical reason", circleId: "trade" });
    // Every alias was read, so none of them is reported.
    expect(r.ignored).toEqual([]);
  });

  it("tries the aliases in order, and a null canonical key yields to an alias with a value", () => {
    expect(normaliseProposedSeat({ role_name: "First", roleName: "Second" }, CIRCLES).payload.name).toBe("First");
    expect(normaliseProposedSeat({ roleName: "Camel" }, CIRCLES).payload.name).toBe("Camel");
    expect(normaliseProposedSeat({ name: null, role_name: "Filled" }, CIRCLES).payload.name).toBe("Filled");
    expect(normaliseProposedSeat({ seatCount: 3 }, CIRCLES).payload.seats).toBe(3);
    expect(normaliseProposedSeat({ why_it_matters: "because" }, CIRCLES).payload.whyItMatters).toBe("because");
  });

  it("lets an explicit circleId, or circle_id, beat any circle name", () => {
    const a = normaliseProposedSeat({ name: "A", circleId: "trade", circle: "Coordination & Records" }, CIRCLES);
    expect(a.payload.circleId).toBe("trade");
    expect(a.payload).not.toHaveProperty("circleName");
    const b = normaliseProposedSeat({ name: "B", circle_id: "trade", circle_name: "Nowhere" }, CIRCLES);
    expect(b.payload.circleId).toBe("trade");
    expect(b.payload).not.toHaveProperty("circleName");
    expect(b.circleProblem).toBeNull();
    expect(b.ignored).toEqual([]);
  });
});

describe("accountabilities", () => {
  it("splits a string on semicolons and newlines, trims, drops one trailing period and empties", () => {
    expect(normaliseAccountabilities("a; b.\nc\r\n; ;  d.. ")).toEqual(["a", "b", "c", "d."]);
    expect(normaliseAccountabilities("")).toEqual([]);
  });

  it("passes an array through with items trimmed and empties dropped", () => {
    expect(normaliseAccountabilities(["  x ", "", "y.", null, 3])).toEqual(["x", "y.", "3"]);
  });

  it("carries null, and reports a value it cannot use instead of losing it at publish", () => {
    expect(normaliseAccountabilities(null)).toBeNull();
    const r = normaliseProposedSeat({ name: "N", accountabilities: 42 }, CIRCLES);
    expect(r.payload).not.toHaveProperty("accountabilities");
    expect(r.ignored).toEqual(["accountabilities"]);
  });
});

describe("idempotence, because a reopened proposal comes through again", () => {
  it("returns an already-canonical payload unchanged", () => {
    for (const record of [REAL_ONE, REAL_TWO, REAL_THREE]) {
      const once = normaliseProposedSeat(record, CIRCLES);
      const twice = normaliseProposedSeat(once.payload, CIRCLES);
      expect(twice.payload).toEqual(once.payload);
      expect(twice.ignored).toEqual([]);
    }
  });

  it("keeps an unplaced circle name stable, and places it once the circle exists", () => {
    const once = normaliseProposedSeat({ role_name: "Mill Warden", circle: "Milling Circle" }, CIRCLES);
    expect(once.payload).toEqual({ name: "Mill Warden", circleName: "Milling Circle", circleMatches: 0 });
    const twice = normaliseProposedSeat(once.payload, CIRCLES);
    expect(twice.payload).toEqual(once.payload);
    expect(twice.ignored).toEqual([]);

    const later = normaliseProposedSeat(once.payload, [...CIRCLES, { id: "milling", name: "Milling Circle" }]);
    expect(later.payload).toEqual({ name: "Mill Warden", circleId: "milling" });
    expect(later.circleProblem).toBeNull();
  });
});

describe("placing a circle by name", () => {
  it("matches case-insensitively and trimmed, on the name or any alias", () => {
    expect(circlesNamed("  coordination & RECORDS ", CIRCLES)).toEqual(["coordination"]);
    expect(circlesNamed("records", CIRCLES)).toEqual(["coordination"]);
    expect(normaliseProposedSeat({ name: "S", circle_name: "RECORDS" }, CIRCLES).payload.circleId).toBe("coordination");
  });

  it("leaves no circleId when the name matches nothing, and carries the name as sent", () => {
    const r = normaliseProposedSeat({ name: "S", circle: "Nowhere Circle" }, CIRCLES);
    expect(r.payload).not.toHaveProperty("circleId");
    expect(r.payload.circleName).toBe("Nowhere Circle");
    expect(r.payload.circleMatches).toBe(0);
    expect(r.circleProblem).toEqual({ kind: "unknown", name: "Nowhere Circle", matches: [] });
  });

  it("leaves no circleId when the name matches more than one circle", () => {
    // One circle is named Hearth; another carries it as an alias.
    const r = normaliseProposedSeat({ name: "Cook", circle: "Hearth" }, CIRCLES);
    expect(r.payload).not.toHaveProperty("circleId");
    expect(r.payload.circleName).toBe("Hearth");
    expect(r.payload.circleMatches).toBe(2);
    expect(r.circleProblem).toEqual({ kind: "ambiguous", name: "Hearth", matches: ["hearth-a", "hearth-b"] });
  });

  it("never matches a standing example circle", () => {
    expect(circlesNamed("Soil & Water", CIRCLES)).toEqual([]);
    const r = normaliseProposedSeat({ name: "S", circle: "Soil & Water" }, CIRCLES);
    expect(r.circleProblem?.kind).toBe("unknown");
    expect(r.payload).not.toHaveProperty("circleId");
  });
});

describe("keys nothing reads", () => {
  it("reports every one, and never reports a structural key", () => {
    const r = normaliseProposedSeat(
      {
        id: "vendor-seat-7",
        title: "t",
        rationale: "r",
        role_name: "Seat",
        vendor_rank: 3,
        holder: "somebody",
        circle: "Money & Trade",
        circleMatches: 5,
      },
      CIRCLES,
    );
    expect(r.ignored).toEqual(["vendor_rank", "holder"]);
    expect(r.vendorId).toBe("vendor-seat-7");
    expect(r.payload).toEqual({ name: "Seat", circleId: "trade" });
  });

  it("reports a circle key whose value is not a name", () => {
    const r = normaliseProposedSeat({ name: "Seat", circle: { id: "trade" } }, CIRCLES);
    expect(r.ignored).toEqual(["circle"]);
    expect(r.payload).toEqual({ name: "Seat" });
  });

  it("reads a whole structure's seat list and reports keys beside it and inside it", () => {
    const r = readProposedSeats(
      {
        title: "The structure",
        rationale: "Because",
        source_meeting: "m-1",
        seats: [
          { id: "a", name: "A", circleId: "trade" },
          { id: "b", roleName: "B", notes: "x" },
          "not a seat",
        ],
      },
      CIRCLES,
    );
    expect(r.seats.map((s) => s.payload.name)).toEqual(["A", "B"]);
    expect(r.ignored).toEqual(["source_meeting", "notes"]);

    const one = readProposedSeats(REAL_ONE, CIRCLES);
    expect(one.seats).toHaveLength(1);
    expect(one.ignored).toEqual([]);
  });
});
