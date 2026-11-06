/**
 * The differences between the outside service's chart and the live chart here,
 * computed from the stored snapshots (spec internal/spec/sera-sync, section 8).
 *
 * Every rule is a test, and each names the rule it holds: R1 to R11, R12 as a
 * data shape, R21's floor and R39's flags. The function is pure, so the inputs
 * here are the exact shapes the server hands it: snapshots newest first, the
 * live chart, and the changes this village published from the service.
 */
import { describe, expect, it } from "vitest";
import { seatIdFor } from "./structurePlan";
import {
  countDifferences,
  differences,
  laneFor,
  normaliseText,
  valueHash,
  type AcceptedChange,
  type Difference,
  type DifferencesInput,
  type LiveCircleIn,
  type LiveRoleIn,
  type Snapshot,
  type SnapshotKind,
  type SnapshotRead,
  type SnapshotRecord,
} from "./seraDifferences";
import { differenceSentence, flagWords, openInUrl, sourceWords } from "./seraDifferenceWords";

// ── Builders ────────────────────────────────────────────────────────────────

/** A page id shaped like the service's: 32 hex digits. */
const pid = (n: number) => n.toString(16).padStart(32, "0");
/** The role id a page id becomes when a draft creates the role. */
const roleIdOf = (pageId: string) => seatIdFor(pageId, "unused");

/** A record's extras, with fields in any shape: a test may hand in what the boundary would never let through. */
type RecordOpts = Omit<Partial<SnapshotRecord>, "fields"> & { fields?: Record<string, unknown> };

const circleRec = (id: string, name: string, { fields, ...rest }: RecordOpts = {}): SnapshotRecord => ({
  ...rest,
  id,
  fields: { "Circle Name": name, Status: "Active", ...(fields ?? {}) } as SnapshotRecord["fields"],
});

const roleRec = (id: string, name: string, circles: string[], { fields, ...rest }: RecordOpts = {}): SnapshotRecord => ({
  ...rest,
  id,
  fields: {
    "Role Name": name,
    ...(circles.length ? { Circle: circles.map((c) => ({ id: c })) } : {}),
    Status: "Active",
    ...(fields ?? {}),
  } as SnapshotRecord["fields"],
});

const kindOf = (records: SnapshotRecord[], read: SnapshotRead = "whole"): SnapshotKind => ({ read, records });

function snapshot(circles: SnapshotRecord[] | SnapshotKind, roles: SnapshotRecord[] | SnapshotKind, n = 1): Snapshot {
  return {
    takenAt: `2026-11-0${Math.min(9, n)}T09:00:00.000Z`,
    trigger: "by-hand",
    circles: Array.isArray(circles) ? kindOf(circles) : circles,
    roles: Array.isArray(roles) ? kindOf(roles) : roles,
  };
}

const liveCircle = (id: string, name: string, extra: Partial<LiveCircleIn> = {}): LiveCircleIn => ({
  id, name, aliases: [], status: "active", isExample: false, ...extra,
});

const liveRole = (id: string, name: string, circleId: string | null, extra: Partial<LiveRoleIn> = {}): LiveRoleIn => ({
  id, name, circleId, active: true, isExample: false, holders: 0, aim: null, paySet: false, ...extra,
});

const created = (id: string, payload: Record<string, unknown>): AcceptedChange => ({ op: "create_seat", orgRoleId: id, payload });

/** A small chart both sides agree on: one circle, one role made from a page id. */
const LAND = pid(1);
const WATER = pid(2);
const STEWARD = pid(10);
const LAND_HERE = liveCircle("land", "Land");
const WATER_HERE = liveCircle("water", "Water");

function input(over: Partial<DifferencesInput> = {}): DifferencesInput {
  return {
    snapshots: [],
    live: { circles: [LAND_HERE, WATER_HERE], roles: [] },
    accepted: [],
    ...over,
  };
}

const only = (list: Difference[], kind: Difference["kind"]) => list.filter((d) => d.kind === kind);

// ── R1: identity ────────────────────────────────────────────────────────────

describe("R1: what each record is matched to", () => {
  it("MATCHES A ROLE BY THE ID ITS PAGE ID MADE FIRST, so a rename at the service reads as a rename", () => {
    const id = roleIdOf(STEWARD);
    const list = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(STEWARD, "Water Keeper", [LAND])])],
        live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land")] },
        accepted: [created(id, { name: "Water Steward", circleId: "land" })],
      }),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "rename",
      field: "name",
      state: "suggestion",
      sera: "Water Keeper",
      ours: "Water Steward",
      subject: { kind: "role", ourId: id, via: "pageId" },
    });
  });

  it("matches a role by name when no page id fits, and flags that it was matched by name only", () => {
    const list = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(STEWARD, "Treasurer", [LAND], { fields: { Body: "Keeps the books." } })])],
        live: { circles: [LAND_HERE], roles: [liveRole("treasurer", "Treasurer", "land", { aim: "Counts the money." })] },
      }),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "textField", field: "aim", subject: { ourId: "treasurer", via: "name" } });
    expect(list[0].flags.map((f) => f.key)).toContain("matchedByName");
  });

  it("A ROLE TWO OF THE SERVICE'S RECORDS NAME IS NEVER MATCHED AUTOMATICALLY", () => {
    const list = differences(
      input({
        snapshots: [
          snapshot(
            [circleRec(LAND, "Land")],
            [roleRec(pid(11), "Treasurer", [LAND], { fields: { Body: "One." } }), roleRec(pid(12), "Treasurer", [LAND], { fields: { Body: "Two." } })],
          ),
        ],
        live: { circles: [LAND_HERE], roles: [liveRole("treasurer", "Treasurer", "land", { aim: "Ours." })] },
      }),
    );
    // Neither record is compared with the live role: no field difference names it.
    expect(list.some((d) => d.subject.ourId === "treasurer")).toBe(false);
    const adds = only(list, "roleAdd");
    expect(adds).toHaveLength(2);
    for (const d of adds) {
      expect(d.flags.map((f) => f.key)).toContain("matchedTwice");
      expect(d.autoEligible).toBe(false);
      expect(d.bulkEligible).toBe(false);
    }
  });

  it("matches a circle by name or alias, and keys on the page id so a stored link can take over later", () => {
    const viaAlias = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land & Ecology")], [])],
        live: { circles: [liveCircle("land", "Land", { aliases: ["Land & Ecology"] })], roles: [] },
      }),
    );
    expect(viaAlias).toEqual([]);

    // The link the next slice stores: page id to our id. A rename at the
    // service then reads as a rename, and the key never carries a name.
    const viaLink = differences(
      input({
        snapshots: [snapshot([circleRec(WATER, "Water & Wells")], [])],
        live: { circles: [WATER_HERE], roles: [] },
        links: { circles: { [WATER]: "water" } },
      }),
    );
    expect(viaLink).toHaveLength(1);
    expect(viaLink[0]).toMatchObject({ kind: "rename", subject: { kind: "circle", ourId: "water", via: "link" } });
    expect(viaLink[0].key).toBe(`circle:${WATER}:name`);
    expect(viaLink[0].key).not.toContain("Water");
  });
});

// ── R2: the base ────────────────────────────────────────────────────────────

describe("R2: the base is what this village published from the service", () => {
  const id = roleIdOf(STEWARD);
  const read = () => [snapshot([circleRec(LAND, "Land")], [roleRec(STEWARD, "Water Steward", [LAND], { fields: { Body: "Holds the wells." } })])];
  const live = () => ({ circles: [LAND_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: "Holds the water." })] });

  it("WITH NO HISTORY THE BASE IS UNKNOWN, flagged, and never eligible for an automatic apply or a bulk take", () => {
    const [d] = differences(input({ snapshots: read(), live: live() }));
    expect(d).toMatchObject({ kind: "textField", field: "aim", base: "unknown", lane: "lowRisk", state: "suggestion" });
    expect(d.flags.map((f) => f.key)).toEqual(["baseUnknown"]);
    expect(d.autoEligible).toBe(false);
    expect(d.bulkEligible).toBe(false);

    // The control: the same difference with the published history behind it.
    const [known] = differences(
      input({ snapshots: read(), live: live(), accepted: [created(id, { name: "Water Steward", circleId: "land", aim: "Holds the water." })] }),
    );
    expect(known).toMatchObject({ base: { value: "Holds the water." }, state: "suggestion" });
    expect(known.flags).toEqual([]);
    expect(known.autoEligible).toBe(true);
    expect(known.bulkEligible).toBe(true);
  });

  it("A ROLE OR CIRCLE WE HOLD WITH NO RECORD THERE AND NO HISTORY IS OURS, and never a difference", () => {
    const kitchen = liveRole("kitchen", "Kitchen", "land");
    const garden = liveCircle("garden", "Garden");
    // Two whole reads that hold one role both sides agree on, and never the kitchen.
    // (An empty answer is never a whole read: it says nothing about what is missing.)
    const cook = roleRec(pid(23), "Cook", [LAND]);
    const twoReads = [snapshot([circleRec(LAND, "Land")], [cook], 2), snapshot([circleRec(LAND, "Land")], [cook], 1)];
    const roles = [kitchen, liveRole("cook", "Cook", "land")];
    expect(differences(input({ snapshots: twoReads, live: { circles: [LAND_HERE, garden], roles } }))).toEqual([]);

    // The control: a published history for the same role makes its absence count.
    const withHistory = differences(
      input({ snapshots: twoReads, live: { circles: [LAND_HERE, garden], roles }, accepted: [created("kitchen", { name: "Kitchen" })] }),
    );
    expect(withHistory.map((d) => [d.kind, d.subject.ourId])).toEqual([["roleRest", "kitchen"]]);
  });

  it("WE RESTED WHAT THE SERVICE KEEPS: ours is ahead, counted, and never a difference to act on", () => {
    const list = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land"), circleRec(WATER, "Water")], [roleRec(STEWARD, "Water Steward", [LAND])])],
        live: {
          circles: [LAND_HERE, liveCircle("water", "Water", { status: "dormant" })],
          roles: [liveRole(id, "Water Steward", "land", { active: false })],
        },
      }),
    );
    expect(list.map((d) => [d.kind, d.state])).toEqual([
      ["circleAdd", "oursAhead"],
      ["roleAdd", "oursAhead"],
    ]);
    const count = countDifferences(list);
    expect(count).toMatchObject({ total: 0, oursAhead: 2, lanes: { facts: 0, lowRisk: 0, decision: 0 } });
  });
});

// ── The three-way states ────────────────────────────────────────────────────

describe("three ways: the base, the service's value and ours", () => {
  const id = roleIdOf(STEWARD);
  const run = (base: string, ours: string, sera: string) =>
    differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(STEWARD, "Water Steward", [LAND], { fields: { Body: sera } })])],
        live: { circles: [LAND_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: ours })] },
        accepted: [created(id, { name: "Water Steward", circleId: "land", aim: base })],
      }),
    );

  it("the service changed and we did not: a suggestion", () => {
    expect(run("A.", "A.", "B.").map((d) => d.state)).toEqual(["suggestion"]);
  });

  it("both changed and they disagree: a conflict, never eligible for an automatic apply", () => {
    const [d] = run("A.", "B.", "C.");
    expect(d.state).toBe("conflict");
    expect(d.autoEligible).toBe(false);
  });

  it("WE CHANGED AND THE SERVICE DID NOT: ours is ahead, counted and not a difference to act on", () => {
    const list = run("A.", "B.", "A.");
    expect(list.map((d) => d.state)).toEqual(["oursAhead"]);
    expect(list[0].bulkEligible).toBe(false);
    expect(countDifferences(list)).toMatchObject({ total: 0, oursAhead: 1 });
  });

  it("both changed to the same value: settled in silence", () => {
    expect(run("A.", "B.", "B.")).toEqual([]);
  });
});

// ── R3: absent is not cleared ───────────────────────────────────────────────

describe("R3: a field the service did not send", () => {
  const id = roleIdOf(STEWARD);
  const run = (fields: Record<string, unknown>, circles: string[] = [LAND]) =>
    differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land"), circleRec(WATER, "Water")], [roleRec(STEWARD, "Water Steward", circles, { fields })])],
        live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: "Holds the water." })] },
        accepted: [created(id, { name: "Water Steward", circleId: "land", aim: "Holds the water." })],
      }),
    );

  it("NEVER MAKES A DIFFERENCE, absent or blank, so clearing never counts as a change", () => {
    expect(run({})).toEqual([]);
    expect(run({ Body: "   " })).toEqual([]);
    // No circle at all is absent too: never a move out of every circle.
    expect(run({}, [])).toEqual([]);
    // The control: the same record with the words present and different.
    expect(run({ Body: "Holds the wells." }).map((d) => d.field)).toEqual(["aim"]);
  });
});

// ── R4: gone means archived, or missing twice ───────────────────────────────

describe("R4: when something counts as removed", () => {
  const X = pid(20);
  const xId = roleIdOf(X);
  const history = [created(xId, { name: "Kitchen", circleId: "land" })];
  const live = { circles: [LAND_HERE], roles: [liveRole(xId, "Kitchen", "land")] };
  const withX = (n: number) => snapshot([circleRec(LAND, "Land")], [roleRec(X, "Kitchen", [LAND])], n);
  const withoutX = (n: number, read: SnapshotRead = "whole") =>
    snapshot([circleRec(LAND, "Land")], kindOf(read === "whole" ? [roleRec(pid(21), "Cook", [LAND])] : [], read), n);

  it("ARCHIVED AT THE SERVICE IS GONE: a role to rest, with the reason", () => {
    const list = differences(
      input({ snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(X, "Kitchen", [LAND], { fields: { Status: "Archived" } })])], live, accepted: history }),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "roleRest", state: "suggestion", lane: "decision", params: { reason: "archived" } });
  });

  it("MISSING FROM ONE WHOLE READ IS NOT GONE; MISSING FROM TWO IN A ROW IS", () => {
    const once = differences(input({ snapshots: [withoutX(3), withX(2)], live, accepted: history }));
    expect(only(once, "roleRest")).toEqual([]);
    const twice = differences(input({ snapshots: [withoutX(3), withoutX(2), withX(1)], live, accepted: history }));
    expect(only(twice, "roleRest").map((d) => [d.subject.ourId, d.params?.reason])).toEqual([[xId, "missingTwice"]]);
    // Its key is still the page id, found in the older read that held it.
    expect(only(twice, "roleRest")[0].key).toBe(`role:${X}:presence`);
  });

  it("holds a circle to the same rule", () => {
    const G = pid(25);
    const garden = liveCircle("garden", "Garden");
    const circleLive = { circles: [LAND_HERE, garden], roles: [] };
    const made = [{ op: "create_circle", orgRoleId: "circle:garden", payload: { name: "Garden" } }];
    const read = (n: number, withGarden: boolean) =>
      snapshot([circleRec(LAND, "Land"), ...(withGarden ? [circleRec(G, "Garden")] : [])], [], n);
    expect(only(differences(input({ snapshots: [read(3, false), read(2, true)], live: circleLive, accepted: made })), "circleRest")).toEqual([]);
    const gone = only(differences(input({ snapshots: [read(3, false), read(2, false), read(1, true)], live: circleLive, accepted: made })), "circleRest");
    expect(gone.map((d) => [d.subject.ourId, d.key, d.params?.reason])).toEqual([["garden", `circle:${G}:presence`, "missingTwice"]]);
  });

  it("A READ THAT WAS NOT WHOLE NEVER COUNTS TOWARD MISSING TWICE", () => {
    for (const read of ["failed", "cut-short", "empty", "not-asked"] as const) {
      const list = differences(input({ snapshots: [withoutX(3, read), withoutX(2), withX(1)], live, accepted: history }));
      expect(only(list, "roleRest"), read).toEqual([]);
    }
  });

  it("an unknown base never proposes a rest, even when the service archived it", () => {
    const list = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(pid(22), "Treasurer", [LAND], { fields: { Status: "Archived" } })])],
        live: { circles: [LAND_HERE], roles: [liveRole("treasurer", "Treasurer", "land")] },
      }),
    );
    expect(list).toEqual([]);
  });
});

// ── R5: the combined snapshot ───────────────────────────────────────────────

describe("R5: a carried kind still resolves the links between roles and circles", () => {
  it("places a role in a circle whose kind was carried from the read before", () => {
    const id = roleIdOf(STEWARD);
    const list = differences(
      input({
        snapshots: [
          snapshot(kindOf([circleRec(LAND, "Land"), circleRec(WATER, "Water")], "failed"), [roleRec(STEWARD, "Water Steward", [WATER])], 2),
        ],
        live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land")] },
        accepted: [created(id, { name: "Water Steward", circleId: "land" })],
      }),
    );
    expect(list.map((d) => [d.kind, d.sera, d.ours])).toEqual([["roleMove", "water", "land"]]);
  });
});

// ── R6: one normaliser, hashes of both sides ────────────────────────────────

describe("R6: one normaliser and a hash of each side", () => {
  const id = roleIdOf(STEWARD);
  const run = (ours: string, sera: string, extra: Partial<SnapshotRecord> = {}) =>
    differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(STEWARD, "Water Steward", [LAND], { ...extra, fields: { Body: sera } })])],
        live: { circles: [LAND_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: ours })] },
        accepted: [created(id, { name: "Water Steward", circleId: "land", aim: ours })],
      }),
    );

  it("SPACES AND LINE ENDINGS NEVER MAKE A DIFFERENCE, and each side's hash is of the normalised value", () => {
    expect(run("Holds  the\r\nwater. ", "Holds the water.")).toEqual([]);
    const [d] = run("Holds the water.", "Holds the wells.");
    expect(d.seraHash).toBe(valueHash(normaliseText("Holds the wells.")));
    expect(d.oursHash).toBe(valueHash(normaliseText("  Holds the water.")));
    expect(d.seraHash).not.toBe(d.oursHash);
  });

  it("NEVER COMPARES CLIPPED TEXT", () => {
    expect(run("Holds the water.", "Holds the wells.", { clipped: ["Body"] })).toEqual([]);
  });
});

// ── R7: one page id, once ───────────────────────────────────────────────────

describe("R7: de-duplicated by page id, and moves compare the set", () => {
  const id = roleIdOf(STEWARD);
  const live = { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: "A." })] };
  const accepted = [created(id, { name: "Water Steward", circleId: "land", aim: "A." })];
  const circles = [circleRec(LAND, "Land"), circleRec(WATER, "Water")];

  it("A PAGE ID SENT TWICE IS FLAGGED and never acted on by itself", () => {
    const [d] = differences(
      input({ snapshots: [snapshot(circles, [roleRec(STEWARD, "Water Steward", [LAND], { duplicate: true, fields: { Body: "B." } })])], live, accepted }),
    );
    expect(d.flags.map((f) => f.key)).toContain("duplicatePageId");
    expect(d.autoEligible).toBe(false);
  });

  it("A ROLE THE SERVICE LISTS IN SEVERAL CIRCLES HAS NOT MOVED while one of them is ours", () => {
    expect(differences(input({ snapshots: [snapshot(circles, [roleRec(STEWARD, "Water Steward", [WATER, LAND])])], live, accepted }))).toEqual([]);
    // The control: our circle is not among them, so it moved.
    const [d] = differences(input({ snapshots: [snapshot(circles, [roleRec(STEWARD, "Water Steward", [WATER])])], live, accepted }));
    expect(d).toMatchObject({ kind: "roleMove", field: "circle", params: { from: "Land", to: ["Water"] } });
  });
});

// ── R9: names in prose ──────────────────────────────────────────────────────

describe("R9: prose that named a member", () => {
  it("IS FLAGGED AND NEVER APPLIES BY ITSELF", () => {
    const id = roleIdOf(STEWARD);
    const [d] = differences(
      input({
        snapshots: [
          snapshot([circleRec(LAND, "Land")], [roleRec(STEWARD, "Water Steward", [LAND], { namesAMember: ["Body"], fields: { Body: "Kept by a member." } })]),
        ],
        live: { circles: [LAND_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: "A." })] },
        accepted: [created(id, { name: "Water Steward", circleId: "land", aim: "A." })],
      }),
    );
    expect(d.namesAMember).toBe(true);
    expect(d.flags.map((f) => f.key)).toEqual(["namesAMember"]);
    expect(d.autoEligible).toBe(false);
  });
});

// ── R12: one difference, one field ──────────────────────────────────────────

describe("R12: one difference is one field, or one add or rest", () => {
  const id = roleIdOf(STEWARD);
  const circles = [circleRec(LAND, "Land"), circleRec(WATER, "Water")];

  it("SPLITS A ROLE THAT CHANGED THREE WAYS INTO THREE DIFFERENCES, each about one field", () => {
    const list = differences(
      input({
        snapshots: [snapshot(circles, [roleRec(STEWARD, "Water Keeper", [WATER], { fields: { Body: "B." } })])],
        live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: "A." })] },
        accepted: [created(id, { name: "Water Steward", circleId: "land", aim: "A." })],
      }),
    );
    expect(list.map((d) => [d.kind, d.field])).toEqual([
      ["rename", "name"],
      ["roleMove", "circle"],
      ["textField", "aim"],
    ]);
    expect(new Set(list.map((d) => d.key)).size).toBe(3);
  });

  it("a new circle and its new roles: one add each, and the circle counts its roles", () => {
    const NEW = pid(30);
    const list = differences(
      input({
        snapshots: [
          snapshot([circleRec(LAND, "Land"), circleRec(NEW, "Land Stewardship")], [roleRec(pid(31), "Seed Keeper", [NEW]), roleRec(pid(32), "Soil Keeper", [NEW])]),
        ],
      }),
    );
    expect(list.map((d) => d.kind)).toEqual(["circleAdd", "roleAdd", "roleAdd"]);
    expect(list[0].params).toMatchObject({ roles: 2 });
    for (const d of only(list, "roleAdd")) {
      expect(d.flags.map((f) => f.key)).toEqual(["baseUnknown", "firstSight", "circleNotHere"]);
      expect(d.subject.circleName).toBe("Land Stewardship");
    }
  });

  it("NEVER A HOLDER OR A POWER, whatever the record carries or the chart counts", () => {
    const list = differences(
      input({
        snapshots: [
          snapshot(circles, [
            roleRec(STEWARD, "Water Steward", [LAND], { fields: { "Active Holders": ["p-1", "p-2"], Powers: "org.decide", "Role Holder": "Jane" } }),
          ]),
        ],
        live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land", { holders: 3 })] },
        accepted: [created(id, { name: "Water Steward", circleId: "land" })],
      }),
    );
    expect(list).toEqual([]);
  });

  it("PAY IS INFORMATION FROM THE FOUR COMPENSATION FIELDS, a decision, and never written", () => {
    const pay = {
      "Compensation Model": "Stipend",
      "Compensation Status": "Proposed",
      "Compensation Terms": "Paid monthly.",
      "Compensation Target (Monthly)": 1200,
    };
    const run = (paySet: boolean, earlier?: Record<string, unknown>) => {
      const now = snapshot(circles, [roleRec(STEWARD, "Treasurer", [LAND], { fields: pay })], 2);
      const before = earlier ? [snapshot(circles, [roleRec(STEWARD, "Treasurer", [LAND], { fields: earlier })], 1)] : [];
      return differences(
        input({
          snapshots: [now, ...before],
          live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Treasurer", "land", { paySet })] },
          accepted: [created(id, { name: "Treasurer", circleId: "land" })],
        }),
      );
    };
    const [d] = run(false);
    expect(d).toMatchObject({ kind: "pay", field: "pay", lane: "decision", ours: "none", state: "suggestion" });
    expect(d.autoEligible).toBe(false);
    expect(differenceSentence(d, "Sera")).toBe(
      "Sera lists Treasurer's pay as a stipend of US$1,200 a month for the whole role, still pending in Sera. This village has no pay set for it.",
    );
    // Pay set here and the service's figure unchanged: nothing to say.
    expect(run(true, pay)).toEqual([]);
    // Pay set here and the service changed its figure: both sides hold one.
    const [changed] = run(true, { ...pay, "Compensation Target (Monthly)": 900 });
    expect(changed).toMatchObject({ kind: "pay", state: "conflict", ours: "set" });
  });

  it("a fact the service changed since the read before is a value difference in the facts lane", () => {
    const now = snapshot(circles, [roleRec(STEWARD, "Water Steward", [LAND], { fields: { "Next Audit Date": "2026-12-01" } })], 2);
    const before = snapshot(circles, [roleRec(STEWARD, "Water Steward", [LAND], { fields: { "Next Audit Date": "2026-11-01" } })], 1);
    const live = { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land")] };
    const accepted = [created(id, { name: "Water Steward", circleId: "land" })];
    const [d] = differences(input({ snapshots: [now, before], live, accepted }));
    expect(d).toMatchObject({ kind: "valueField", field: "Next Audit Date", lane: "facts", sera: "2026-12-01", base: { value: "2026-11-01" } });
    expect(d.autoEligible).toBe(true);
    // Seen for the first time, a fact is not a change.
    expect(differences(input({ snapshots: [now], live, accepted }))).toEqual([]);
  });
});

// ── R21: the lanes and their floor ──────────────────────────────────────────

describe("R21: lanes by kind and field, with a floor no table moves", () => {
  it("DEFAULTS: the description and the facts are the automatic lanes (S1), everything structural is a decision", () => {
    expect(laneFor("textField", "aim")).toBe("lowRisk");
    expect(laneFor("valueField", "Role Type")).toBe("facts");
    expect(laneFor("textField", "Notes")).toBe("facts");
    for (const k of ["circleAdd", "circleRest", "roleAdd", "roleRest", "roleMove", "rename", "pay"] as const) {
      expect(laneFor(k, null), k).toBe("decision");
    }
  });

  it("THE FLOOR WINS OVER ANY TABLE, and review-this-instead is always available", () => {
    const table = { roleAdd: "lowRisk", rename: "facts", pay: "lowRisk", "textField:accountabilities": "lowRisk", "textField:terms": "facts" } as const;
    expect(laneFor("roleAdd", null, table)).toBe("decision");
    expect(laneFor("rename", "name", table)).toBe("decision");
    expect(laneFor("pay", "pay", table)).toBe("decision");
    expect(laneFor("textField", "accountabilities", table)).toBe("decision");
    expect(laneFor("textField", "terms", table)).toBe("decision");
    expect(laneFor("textField", "aim", { "textField:aim": "decision" })).toBe("decision");
    // A field nobody listed fails closed.
    expect(laneFor("textField", "something new")).toBe("decision");
  });

  it("holds the floor inside the list too", () => {
    const id = roleIdOf(STEWARD);
    const [d] = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(STEWARD, "Water Keeper", [LAND])])],
        live: { circles: [LAND_HERE], roles: [liveRole(id, "Water Steward", "land")] },
        accepted: [created(id, { name: "Water Steward", circleId: "land" })],
        lanes: { rename: "lowRisk" },
      }),
    );
    expect(d).toMatchObject({ kind: "rename", lane: "decision", autoEligible: false });
  });
});

// ── R39 and R35: the words ──────────────────────────────────────────────────

describe("R35 and R39: plain words, white label", () => {
  const id = roleIdOf(STEWARD);

  it("SAYS EACH KIND AS A SENTENCE, with no page id, kind or field key in it", () => {
    const NEW = pid(30);
    const ARCH = pid(40);
    const archId = roleIdOf(ARCH);
    const list = differences(
      input({
        snapshots: [
          snapshot(
            [circleRec(LAND, "Land"), circleRec(WATER, "Water"), circleRec(NEW, "Land Stewardship")],
            [
              roleRec(STEWARD, "Water Keeper", [WATER], { fields: { Body: "Holds the wells." } }),
              roleRec(pid(31), "Seed Keeper", [NEW]),
              roleRec(ARCH, "Kitchen", [LAND], { fields: { Status: "Archived" } }),
            ],
          ),
        ],
        live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: "Holds the water." }), liveRole(archId, "Kitchen", "land")] },
        accepted: [created(id, { name: "Water Steward", circleId: "land", aim: "Holds the water." }), created(archId, { name: "Kitchen", circleId: "land" })],
      }),
    );
    const said = list.map((d) => differenceSentence(d, "Sera"));
    expect(said).toEqual([
      "Sera suggests a new circle, Land Stewardship, with 1 role.",
      "Sera has archived Kitchen. It is still live here.",
      "Sera suggests a new role, Seed Keeper, in Land Stewardship.",
      "Sera suggests renaming Water Steward to Water Keeper.",
      "Sera suggests moving Water Steward from Land to Water.",
      "Sera has new words for Water Steward's purpose.",
    ]);
    for (const s of said) {
      expect(s).not.toMatch(/[0-9a-f]{32}/);
      expect(s).not.toMatch(/roleAdd|textField|circle\.proposed|Role Name|Body/);
    }
  });

  it("TAKES THE AGENT'S NAME IT IS GIVEN and says here, never a village's name", () => {
    const [d] = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(STEWARD, "Water Steward", [LAND])])],
        live: { circles: [LAND_HERE], roles: [liveRole(id, "Water Steward", "land", { active: false })] },
      }),
    );
    const s = differenceSentence(d, "Mira");
    expect(s).toBe("Water Steward was retired here. Mira still lists it.");
    expect(s).not.toContain("Sera");
  });

  it("SAYS EACH FLAG IN THE WORDS R39 GIVES", () => {
    expect(flagWords({ key: "firstSight" }, "Sera")).toBe("Check first: the first time Sera has sent this");
    expect(flagWords({ key: "sameNameAsLive", params: { name: "Treasurer", of: "role" } }, "Sera")).toBe(
      "Check first: same name as your Treasurer role",
    );
    expect(flagWords({ key: "circleNotHere", params: { circle: "Land Stewardship" } }, "Sera")).toBe(
      "Check first: Sera puts it in a circle this village doesn't have",
    );
    expect(flagWords({ key: "namesAMember" }, "Sera")).toBe("Names a member: check this one");
    expect(flagWords({ key: "matchedByName" }, "Sera")).toBe("Check first: matched by name only");
  });

  it("the first-sight flag goes only on additions, and only the first time the page id is seen", () => {
    const NEW = pid(50);
    const roleNow = roleRec(NEW, "Seed Keeper", [LAND]);
    const twice = differences(input({ snapshots: [snapshot([circleRec(LAND, "Land")], [roleNow], 2), snapshot([circleRec(LAND, "Land")], [roleNow], 1)] }));
    expect(twice.map((d) => d.kind)).toEqual(["roleAdd"]);
    expect(twice[0].flags.map((f) => f.key)).not.toContain("firstSight");
  });

  it("names its source by the edited time alone, and opens the service's page by id", () => {
    const [d] = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(pid(60), "Seed Keeper", [LAND], { editedAt: "2026-10-29T15:00:00.000Z" })])],
      }),
    );
    expect(sourceWords(d, "Sera")).toBe("Edited in Sera 29 Oct");
    expect(sourceWords({ ...d, source: { ...d.source, editedAt: null } }, "Sera")).toBe("From Sera's record");
    expect(openInUrl("https://dash.example.test/", pid(60))).toBe(`https://dash.example.test/${pid(60)}`);
    expect(openInUrl("", pid(60))).toBeNull();
    expect(openInUrl("http://dash.example.test", pid(60))).toBeNull();
  });
});

describe("the count", () => {
  it("totals per lane, leaving ours-ahead apart", () => {
    const id = roleIdOf(STEWARD);
    const list = differences(
      input({
        snapshots: [
          snapshot(
            [circleRec(LAND, "Land"), circleRec(WATER, "Water")],
            [roleRec(STEWARD, "Water Keeper", [LAND], { fields: { Body: "B." } }), roleRec(pid(70), "Seed Keeper", [LAND])],
          ),
        ],
        live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(id, "Water Steward", "land", { aim: "A." })] },
        accepted: [created(id, { name: "Water Steward", circleId: "land", aim: "A." })],
      }),
    );
    expect(countDifferences(list)).toEqual({
      total: 3,
      lanes: { facts: 0, lowRisk: 1, decision: 2 },
      conflicts: 0,
      checkFirst: 1,
      oursAhead: 0,
    });
  });
});
