/**
 * Links a village names for itself, and the one rule that keeps them safe.
 *
 * ENDPOINTS ARE NODES, NEVER PEOPLE. "Ada mentors Bo" would be a statement
 * about two people that then has to be kept out of the public export by
 * filtering, and filtering is how leaks happen. "The Water Steward seat is
 * deputised by the Gate Steward seat" says the useful part, outlives both
 * holders, and is publishable by construction. The type system carries that
 * rule (`NodeKind` has two values), and `relationProblem` enforces it against
 * anything arriving over HTTP.
 */
import { describe, expect, it } from "vitest";
import {
  coveredSeatIds,
  relationProblem,
  relationsFor,
  STARTER_TYPES,
  type Relation,
  type RelationType,
} from "./orgRelations";

const type = (id: string, over: Partial<RelationType> = {}): RelationType => ({
  id, label: `is ${id} of`, inverseLabel: `${id}s`, symmetric: false,
  isCover: false, order: 0, isExample: false, ...over,
});

let n = 0;
const rel = (over: Partial<Relation> = {}): Relation => ({
  id: `r${(n += 1)}`, typeId: "deputy",
  fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "gate",
  note: null, isExample: false, ...over,
});

const known = {
  types: new Set(["deputy", "mentor"]),
  roles: new Set(["water", "gate", "compost"]),
  circles: new Set(["land-circle"]),
};

describe("what a link is allowed to be", () => {
  it("accepts a seat linked to a seat, and a seat linked to a circle", () => {
    expect(relationProblem({ typeId: "deputy", fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "gate" }, known)).toBeNull();
    expect(relationProblem({ typeId: "deputy", fromKind: "org_role", fromId: "water", toKind: "circle", toId: "land-circle" }, known)).toBeNull();
  });

  it("refuses a person as an endpoint, because that is a different feature", () => {
    // There is no `user` node kind and adding one is a consent question, not a
    // schema change. Anything else arriving over HTTP is rejected by name.
    expect(relationProblem({ typeId: "deputy", fromKind: "user", fromId: "u-ada", toKind: "org_role", toId: "gate" }, known))
      .toContain("not a role or a circle");
  });

  it("refuses a node that does not exist here", () => {
    expect(relationProblem({ typeId: "deputy", fromKind: "org_role", fromId: "ghost", toKind: "org_role", toId: "gate" }, known))
      .toContain("first end");
    expect(relationProblem({ typeId: "deputy", fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "ghost" }, known))
      .toContain("other end");
  });

  it("refuses a type the village has not defined", () => {
    expect(relationProblem({ typeId: "invented", fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "gate" }, known))
      .toContain("does not exist");
  });

  it("refuses a seat linked to itself", () => {
    // The one bad link that renders as an infinite loop on the page rather
    // than as visibly wrong data.
    expect(relationProblem({ typeId: "deputy", fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "water" }, known))
      .toContain("cannot be linked to itself");
  });

  it("allows a seat and a CIRCLE that share an id, because they are different nodes", () => {
    const shared = { ...known, circles: new Set(["water"]) };
    expect(relationProblem({ typeId: "deputy", fromKind: "org_role", fromId: "water", toKind: "circle", toId: "water" }, shared)).toBeNull();
  });
});

describe("reading a link from either end", () => {
  const types = new Map([
    ["deputy", type("deputy", { label: "is deputised by", inverseLabel: "deputises for", isCover: true })],
    ["works-with", type("works-with", { label: "works closely with", inverseLabel: "works closely with", symmetric: true })],
  ]);

  it("flips the label so the SAME row reads correctly from both sides", () => {
    // Stored once, read twice. Storing it twice to avoid the flip is how the
    // two copies eventually disagree.
    const rows = [rel({ typeId: "deputy", fromId: "water", toId: "gate" })];
    expect(relationsFor({ kind: "org_role", id: "water" }, rows, types)[0]).toMatchObject({
      label: "is deputised by", otherId: "gate",
    });
    expect(relationsFor({ kind: "org_role", id: "gate" }, rows, types)[0]).toMatchObject({
      label: "deputises for", otherId: "water",
    });
  });

  it("returns nothing for a node no link touches", () => {
    expect(relationsFor({ kind: "org_role", id: "compost" }, [rel()], types)).toEqual([]);
  });

  it("does not confuse a circle with a seat of the same id", () => {
    const rows = [rel({ fromKind: "circle", fromId: "water", toId: "gate" })];
    expect(relationsFor({ kind: "org_role", id: "water" }, rows, types)).toEqual([]);
    expect(relationsFor({ kind: "circle", id: "water" }, rows, types).length).toBe(1);
  });

  it("hides a link whose type was deleted rather than rendering a blank label", () => {
    expect(relationsFor({ kind: "org_role", id: "water" }, [rel({ typeId: "gone" })], types)).toEqual([]);
  });

  it("hides example links", () => {
    expect(relationsFor({ kind: "org_role", id: "water" }, [rel({ isExample: true })], types)).toEqual([]);
  });
});

describe("cover, which is why this table earns its place", () => {
  const types = new Map([
    ["deputy", type("deputy", { isCover: true })],
    ["mentor", type("mentor", { isCover: false })],
    ["buddy", type("buddy", { isCover: true, symmetric: true })],
  ]);

  it("covers the seat that is deputised, not the deputy", () => {
    // Directional on purpose. Treating cover as mutual would report a whole
    // chain as safe the moment one link existed.
    const covered = coveredSeatIds([rel({ typeId: "deputy", fromId: "water", toId: "gate" })], types);
    expect(covered.has("water")).toBe(true);
    expect(covered.has("gate")).toBe(false);
  });

  it("covers both ends of a SYMMETRIC cover type", () => {
    const covered = coveredSeatIds([rel({ typeId: "buddy", fromId: "water", toId: "gate" })], types);
    expect(covered.has("water")).toBe(true);
    expect(covered.has("gate")).toBe(true);
  });

  it("does not treat a mentor as cover", () => {
    // Being mentored is not the same as somebody being able to hold the seat,
    // and conflating them would report a village as safer than it is.
    expect(coveredSeatIds([rel({ typeId: "mentor" })], types).size).toBe(0);
  });

  it("ignores a link to a CIRCLE, because a circle does not hold a seat", () => {
    const covered = coveredSeatIds([rel({ typeId: "deputy", fromKind: "circle", fromId: "land-circle" })], types);
    expect(covered.has("land-circle")).toBe(false);
  });

  it("ignores example links and orphaned types", () => {
    expect(coveredSeatIds([rel({ typeId: "deputy", isExample: true })], types).size).toBe(0);
    expect(coveredSeatIds([rel({ typeId: "vanished" })], types).size).toBe(0);
  });
});

describe("the starter vocabulary", () => {
  it("ships types that a village can rename or delete", () => {
    // Suggestions, not platform vocabulary. Seeded into an EMPTY table only,
    // so a deleted one never comes back and an intentional deletion never
    // looks like a bug.
    expect(STARTER_TYPES.map((t) => t.id)).toContain("deputy");
    expect(STARTER_TYPES.every((t) => t.label && t.inverseLabel)).toBe(true);
  });

  it("marks exactly the types that mean somebody can carry the seat", () => {
    const cover = STARTER_TYPES.filter((t) => t.isCover).map((t) => t.id).sort();
    expect(cover).toEqual(["deputy", "successor"]);
  });

  it("gives a symmetric type the same words in both directions", () => {
    for (const t of STARTER_TYPES.filter((t) => t.symmetric)) {
      expect(t.label, t.id).toBe(t.inverseLabel);
    }
  });

  it("carries escalation exactly once, matching the 0083 row word for word", () => {
    // Two seeding doors exist: the migration's INSERT IGNORE for deployments
    // that seeded before 0083, and this list for fresh installs. They must
    // agree on every field, or which door a village came through would decide
    // which words its map draws.
    const esc = STARTER_TYPES.filter((t) => t.id === "escalation");
    expect(esc).toHaveLength(1);
    expect(esc[0]).toEqual({
      id: "escalation",
      label: "escalates objections to",
      inverseLabel: "hears objections from",
      symmetric: false,
      isCover: false,
      order: 6,
    });
  });
});
