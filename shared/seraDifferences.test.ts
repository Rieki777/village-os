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
  differences as computeDifferences,
  laneFor,
  normaliseText,
  stampMatches,
  traceAccepted,
  valueHash,
  type AcceptedChange,
  type Difference,
  type DifferencesInput,
  type LiveCircleIn,
  type LiveRoleIn,
  type Snapshot,
  type SnapshotKind,
  type SnapshotMatch,
  type SnapshotRead,
  type SnapshotRecord,
} from "./seraDifferences";
import { differenceSentence, flagWords, openInUrl, sourceWords } from "./seraDifferenceWords";

/**
 * Every call in this file goes through here, so every fixture also holds the
 * rule that one key names one difference: a page can only take, keep or settle
 * a difference it can address.
 */
function differences(i: DifferencesInput): Difference[] {
  const out = computeDifferences(i);
  const keys = out.map((d) => d.key);
  expect(keys.filter((k, n) => keys.indexOf(k) !== n), "two differences share a key").toEqual([]);
  return out;
}

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

/** The names our circles answer to, so a published circle id can be traced back to the service's circle name. */
const CIRCLE_NAMES: Record<string, string> = { land: "Land", water: "Water" };

/**
 * A published create_seat traced to the service's own proposal, which said
 * exactly what was published: nobody edited it at accept.
 */
const created = (id: string, payload: Record<string, unknown>, pageId: string | null = null): AcceptedChange => ({
  op: "create_seat",
  orgRoleId: id,
  payload,
  from: {
    pageId,
    name: typeof payload.name === "string" ? payload.name : null,
    aim: typeof payload.aim === "string" ? payload.aim : null,
    circleName: typeof payload.circleId === "string" ? (CIRCLE_NAMES[payload.circleId] ?? null) : null,
  },
});

/** A published create_circle traced to the service's circle proposal. */
const madeCircle = (id: string, name: string, pageId: string | null): AcceptedChange => ({
  op: "create_circle",
  orgRoleId: `circle:${id}`,
  payload: { name },
  from: { pageId, name },
});

/** A small chart both sides agree on: one circle, one role made from a page id. */
const LAND = pid(1);
const WATER = pid(2);
const STEWARD = pid(10);
const LAND_HERE = liveCircle("land", "Land");
const WATER_HERE = liveCircle("water", "Water");

/** A snapshot taken at an exact moment, for the rules that look a day back. */
function snapshotAt(takenAt: string, circles: SnapshotRecord[] | SnapshotKind, roles: SnapshotRecord[] | SnapshotKind): Snapshot {
  return { ...snapshot(circles, roles), takenAt };
}

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
    // Read once, twice and three times: an older read's alias match is still a match by alias,
    // never a rename to suggest (review C3, the reviewer's probe 3).
    const aliased = { circles: [liveCircle("land", "Land", { aliases: ["Land & Ecology"] })], roles: [] };
    for (const reads of [1, 2, 3]) {
      const snapshots = Array.from({ length: reads }, (_, i) => snapshot([circleRec(LAND, "Land & Ecology")], [], reads - i));
      expect(differences(input({ snapshots, live: aliased })), `${reads} reads`).toEqual([]);
    }

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

  it("A SUBJECT AN OLDER READ MATCHED BY NAME IS STILL MATCHED BY NAME, never flagged as matched under an old name (C3)", () => {
    const reads = (body: string) => [
      snapshot([circleRec(LAND, "Land & Ecology")], [roleRec(STEWARD, "Treasurer", [LAND], { fields: { Body: body } })], 2),
      snapshot([circleRec(LAND, "Land & Ecology")], [roleRec(STEWARD, "Treasurer", [LAND], { fields: { Body: "Counts the money." } })], 1),
    ];
    const live = { circles: [liveCircle("land", "Land", { aliases: ["Land & Ecology"] })], roles: [liveRole("treasurer", "Treasurer", "land", { aim: "Counts the money." })] };
    const [aim] = differences(input({ snapshots: reads("Keeps the books."), live }));
    expect(aim).toMatchObject({ field: "aim", subject: { ourId: "treasurer", via: "name" } });
    expect(aim.flags.map((f) => f.key)).toEqual(["baseUnknown", "matchedByName"]);
    // The control: a subject whose name the service changed since the older read IS matched under its old name.
    const renamed = [
      snapshot([circleRec(LAND, "Land & Ecology")], [roleRec(STEWARD, "Head Treasurer", [LAND], { fields: { Body: "Counts the money." } })], 2),
      reads("Counts the money.")[1],
    ];
    const [rename] = differences(input({ snapshots: renamed, live }));
    expect(rename).toMatchObject({ kind: "rename", subject: { ourId: "treasurer", via: "earlier" } });
    expect(rename.flags.map((f) => f.key)).toContain("matchedEarlier");
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

    // The control: a published history for the same role, traced to the page id
    // the service sent it under, makes its absence from two whole reads count.
    const KITCHEN = pid(24);
    const withHistory = differences(
      input({ snapshots: twoReads, live: { circles: [LAND_HERE, garden], roles }, accepted: [created("kitchen", { name: "Kitchen" }, KITCHEN)] }),
    );
    expect(withHistory.map((d) => [d.kind, d.subject.ourId, d.key])).toEqual([["roleRest", "kitchen", `role:${KITCHEN}:presence`]]);

    // A history that names no page id cannot prove anything is gone.
    expect(differences(input({ snapshots: twoReads, live: { circles: [LAND_HERE, garden], roles }, accepted: [created("kitchen", { name: "Kitchen" })] }))).toEqual([]);
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
  const history = [created(xId, { name: "Kitchen", circleId: "land" }, X)];
  const live = { circles: [LAND_HERE], roles: [liveRole(xId, "Kitchen", "land")] };
  const withX = (n: number) => snapshot([circleRec(LAND, "Land")], [roleRec(X, "Kitchen", [LAND])], n);
  // A read without the kitchen. One that was not whole carries the read before it
  // forward, records and all, exactly as the sync stores it: never an empty list.
  const withoutX = (n: number, read: SnapshotRead = "whole") =>
    snapshot([circleRec(LAND, "Land")], kindOf([roleRec(pid(21), "Cook", [LAND])], read), n);

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
    const made = [madeCircle("garden", "Garden", G)];
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
    expect(d).toMatchObject({ kind: "pay", field: "pay", lane: "decision", ours: "none", state: "suggestion", base: "unknown" });
    expect(d.autoEligible).toBe(false);
    expect(d.bulkEligible).toBe(false);
    expect(d.takeable).toBe(false);
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
      toDecide: 2,
      lanes: { facts: 0, lowRisk: 1, decision: 2 },
      conflicts: 0,
      checkFirst: 1,
      oursAhead: 0,
    });
  });
});

// ── The independent review of 2026-11-06 ────────────────────────────────────
// Each block below is one finding, built from the reviewer's probe inputs.

describe("review 1: a rename is never a removal", () => {
  const G = pid(80);
  const garden = liveCircle("garden", "Garden");
  const read = (n: number, name: string) => snapshot([circleRec(LAND, "Land"), circleRec(G, name)], [], n);
  const live = { circles: [LAND_HERE, garden], roles: [] };

  it("A CIRCLE THE SERVICE RENAMED UNDER THE SAME PAGE ID IS ONE RENAME, NEVER A REST", () => {
    // With and without a published history: the reads alone carry the page id.
    for (const accepted of [[], [madeCircle("garden", "Garden", G)]]) {
      const list = differences(
        input({ snapshots: [read(3, "Gardens & Orchards"), read(2, "Gardens & Orchards"), read(1, "Garden")], live, accepted }),
      );
      expect(list.map((d) => [d.kind, d.key, d.sera, d.ours])).toEqual([["rename", `circle:${G}:name`, "Gardens & Orchards", "Garden"]]);
      expect(list[0].flags.map((f) => f.key)).toContain("matchedEarlier");
      expect(list[0].bulkEligible).toBe(false);
    }
    // A published history knows the page id even when no kept read saw the old name.
    const fromHistory = differences(input({ snapshots: [read(1, "Gardens & Orchards")], live, accepted: [madeCircle("garden", "Garden", G)] }));
    expect(fromHistory.map((d) => [d.kind, d.base])).toEqual([["rename", { value: "Garden" }]]);
  });

  it("A RECORD WHOSE NAME FIELD STOPPED ARRIVING IS STILL THERE, so nothing is rested", () => {
    const nameless = (n: number) => snapshot([circleRec(LAND, "Land"), { id: G, fields: { Name: "Garden", Status: "Active" } }], [], n);
    expect(differences(input({ snapshots: [nameless(3), nameless(2), read(1, "Garden")], live, accepted: [madeCircle("garden", "Garden", G)] }))).toEqual([]);
  });

  it("A ROLE MATCHED BY NAME AND RENAMED AT THE SERVICE IS A RENAME, NEVER A REST", () => {
    const K = pid(81);
    const role = (n: number, name: string) => snapshot([circleRec(LAND, "Land")], [roleRec(K, name, [LAND])], n);
    const traced: AcceptedChange = {
      op: "update_seat", orgRoleId: "cook", payload: { name: "Cook", circleId: "land" },
      from: { pageId: K, name: "Cook", aim: null, circleName: "Land" },
    };
    for (const accepted of [[{ ...traced, from: null }], [traced]]) {
      const list = differences(
        input({ snapshots: [role(3, "Head Cook"), role(2, "Head Cook"), role(1, "Cook")], live: { circles: [LAND_HERE], roles: [liveRole("cook", "Cook", "land")] }, accepted }),
      );
      expect(list.map((d) => [d.kind, d.key, d.sera, d.ours])).toEqual([["rename", `role:${K}:name`, "Head Cook", "Cook"]]);
    }
  });

  it("A PAGE ID THAT WAS OURS AND CAN NO LONGER BE MATCHED IS FLAGGED ON ITS RECORD, NEVER RESTED", () => {
    const H = pid(82);
    // A stored link has given our garden to another record, and G is still sent.
    const both = (n: number) => snapshot([circleRec(G, "Gardens & Orchards"), circleRec(H, "Garden")], [], n);
    const list = differences(
      input({
        snapshots: [both(3), both(2), snapshot([circleRec(G, "Garden")], [], 1)],
        live: { circles: [garden], roles: [] },
        accepted: [madeCircle("garden", "Garden", G)],
        links: { circles: { [H]: "garden" } },
      }),
    );
    expect(only(list, "circleRest")).toEqual([]);
    const add = list.find((d) => d.key === `circle:${G}:presence`)!;
    expect(add.kind).toBe("circleAdd");
    expect(add.flags).toContainEqual({ key: "wasOurs", params: { name: "Garden", of: "circle" } });
  });

  it("NEVER TWO DIFFERENCES WITH ONE KEY, over every one of the review's fixtures", () => {
    const K = pid(81);
    const fixtures: DifferencesInput[] = [
      input({ snapshots: [read(3, "Gardens & Orchards"), read(2, "Gardens & Orchards"), read(1, "Garden")], live, accepted: [madeCircle("garden", "Garden", G)] }),
      input({
        snapshots: [
          snapshot([circleRec(LAND, "Land")], [roleRec(K, "Head Cook", [LAND])], 3),
          snapshot([circleRec(LAND, "Land")], [roleRec(K, "Head Cook", [LAND])], 2),
          snapshot([circleRec(LAND, "Land")], [roleRec(K, "Cook", [LAND])], 1),
        ],
        live: { circles: [LAND_HERE], roles: [liveRole("cook", "Cook", "land")] },
        accepted: [{ op: "update_seat", orgRoleId: "cook", payload: { name: "Cook" }, from: { pageId: K, name: "Cook" } }],
      }),
    ];
    for (const f of fixtures) {
      const keys = computeDifferences(f).map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("A CIRCLE TO REST COUNTS THE PEOPLE WHO HOLD ROLES IN IT", () => {
    const people = { circles: [garden], roles: [liveRole("weeder", "Weeder", "garden", { holders: 2 }), liveRole("waterer", "Waterer", "garden", { holders: 1 })] };
    const archived = differences(
      input({ snapshots: [snapshot([circleRec(G, "Garden", { fields: { Status: "Archived" } })], [], 1)], live: people, accepted: [madeCircle("garden", "Garden", G)] }),
    );
    const missing = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [], 3), snapshot([circleRec(LAND, "Land")], [], 2), read(1, "Garden")],
        live: { ...people, circles: [LAND_HERE, garden] },
        accepted: [madeCircle("garden", "Garden", G)],
      }),
    );
    for (const list of [archived, missing]) {
      const [rest] = only(list, "circleRest");
      expect(rest.flags).toContainEqual({ key: "heldHere", params: { holders: 3 } });
      expect(rest.bulkEligible).toBe(false);
    }
  });
});

describe("review 2: the base is what the service itself said", () => {
  const K = pid(83);
  const kid = roleIdOf(K);
  const run = (published: string, original: string, sera: string) =>
    differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(K, "Kitchen", [LAND], { fields: { Body: sera } })])],
        live: { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen", "land", { aim: published })] },
        accepted: [{
          op: "create_seat", orgRoleId: kid, payload: { name: "Kitchen", circleId: "land", aim: published },
          from: { pageId: K, name: "Kitchen", aim: original, circleName: "Land" },
        }],
      }),
    );

  it("WORDS A STEWARD EDITED AT ACCEPT ARE AN UNKNOWN BASE, flagged, never an automatic suggestion", () => {
    const [d] = run("Cooks and keeps the pantry.", "Cooks.", "Cooks.");
    expect(d).toMatchObject({ kind: "textField", field: "aim", base: "unknown", autoEligible: false, bulkEligible: false });
    expect(d.flags.map((f) => f.key)).toContain("baseUnknown");
    // The control: nothing edited at accept, then the service changed its words.
    const [plain] = run("Cooks and keeps the pantry.", "Cooks and keeps the pantry.", "Cooks.");
    expect(plain).toMatchObject({ state: "suggestion", base: { value: "Cooks and keeps the pantry." }, autoEligible: true });
  });

  it("A NAME TYPED AT ACCEPT IS AN UNKNOWN BASE", () => {
    const list = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(K, "Kitchen", [LAND])])],
        live: { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen Two", "land")] },
        accepted: [{ op: "create_seat", orgRoleId: kid, payload: { name: "Kitchen Two", circleId: "land" }, from: { pageId: K, name: "Kitchen", circleName: "Land" } }],
      }),
    );
    expect(list.map((d) => [d.kind, d.base])).toEqual([["rename", "unknown"]]);
  });

  it("A CHANGE THAT CANNOT BE TRACED TO THE SERVICE IS LEFT OUT OF THE BASE", () => {
    const [d] = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(K, "Kitchen", [LAND], { fields: { Body: "Cooks." } })])],
        live: { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen", "land", { aim: "Feeds people." })] },
        accepted: [{ op: "create_seat", orgRoleId: kid, payload: { name: "Kitchen", aim: "Feeds people." }, from: null }],
      }),
    );
    expect(d).toMatchObject({ field: "aim", base: "unknown" });
  });
});

describe("tracing a published change to the service's proposal", () => {
  const K = pid(84);
  const kid = roleIdOf(K);
  const structure = {
    id: "p1", draftId: "d1", kind: "org.proposed", original: true,
    payload: { title: "Structure", seats: [{ id: K, name: "Kitchen", circleName: "Land", aim: "Cooks." }, { id: pid(85), name: "Cook" }] },
  };
  const orchard = { id: "p2", draftId: "d1", kind: "circle.proposed", original: true, payload: { "Circle Name": "Orchard", Status: "Active", vendorRecordId: pid(86) } };

  it("TRACES A ROLE BY ITS PAGE ID, AN UPDATE BY NAME AND A CIRCLE BY ITS ID, AND NEVER A REST", () => {
    const out = traceAccepted(
      [
        { draftId: "d1", op: "create_seat", orgRoleId: kid, payload: { name: "Kitchen" } },
        { draftId: "d1", op: "update_seat", orgRoleId: "cook-here", payload: { name: "Cook" } },
        { draftId: "d1", op: "create_circle", orgRoleId: "circle:orchard", payload: { name: "Orchard" } },
        { draftId: "d1", op: "rest_seat", orgRoleId: "old", payload: { chosenBy: "u-1" } },
      ],
      [structure, orchard],
    );
    expect(out.map((c) => c.from)).toEqual([
      { pageId: K, name: "Kitchen", aim: "Cooks.", circleName: "Land" },
      { pageId: pid(85), name: "Cook", aim: null, circleName: null },
      { pageId: pid(86), name: "Orchard" },
      null,
    ]);
  });

  it("NEVER TRACES TO A PROPOSAL SOMEBODY EDITED, OR TO ANOTHER DRAFT'S", () => {
    const changes = [
      { draftId: "d1", op: "create_seat", orgRoleId: kid, payload: {} },
      { draftId: "d2", op: "create_seat", orgRoleId: kid, payload: {} },
    ];
    expect(traceAccepted(changes, [{ ...structure, original: false }]).map((c) => c.from)).toEqual([null, null]);
    // The control: the untouched proposal traces its own draft's change, and only that one.
    expect(traceAccepted(changes, [structure]).map((c) => c.from?.pageId ?? null)).toEqual([K, null]);
  });
});

describe("review 4: a move says when its circle is not here", () => {
  const K = pid(87);
  const kid = roleIdOf(K);
  const ORCHARD = pid(88);
  const run = (circles: string[]) =>
    differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land"), circleRec(WATER, "Water"), circleRec(ORCHARD, "Orchard")], [roleRec(K, "Kitchen", circles)])],
        live: { circles: [LAND_HERE, WATER_HERE], roles: [liveRole(kid, "Kitchen", "land")] },
        accepted: [created(kid, { name: "Kitchen", circleId: "land" }, K)],
      }),
    );

  it("A MOVE INTO A CIRCLE THAT IS NOT HERE IS FLAGGED, and so is a move into several", () => {
    const [into] = only(run([ORCHARD]), "roleMove");
    expect(into.flags).toEqual([{ key: "circleNotHere", params: { circle: "Orchard" } }]);
    expect(into.bulkEligible).toBe(false);
    const [several] = only(run([WATER, ORCHARD]), "roleMove");
    expect(several.flags).toEqual([{ key: "circleNotHere", params: { circle: "Orchard" } }, { key: "severalCircles", params: { count: 2 } }]);
    // The control: one circle that is here carries no flag.
    expect(only(run([WATER]), "roleMove")[0].flags).toEqual([]);
  });
});

describe("review 5: pay is never bulk-taken", () => {
  it("PAY'S BASE IS ALWAYS UNKNOWN, on the second read as on the first", () => {
    const K = pid(89);
    const kid = roleIdOf(K);
    const pay = { "Compensation Model": "Stipend", "Compensation Status": "Proposed", "Compensation Target (Monthly)": 1200 };
    const read = (n: number) => snapshot([circleRec(LAND, "Land")], [roleRec(K, "Kitchen", [LAND], { fields: pay })], n);
    const [d] = differences(
      input({
        snapshots: [read(2), read(1)],
        live: { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen", "land")] },
        accepted: [created(kid, { name: "Kitchen", circleId: "land" }, K)],
      }),
    );
    expect(d).toMatchObject({ kind: "pay", base: "unknown", bulkEligible: false, autoEligible: false });
  });
});

describe("review 6: facts and pay compare with the read a day before", () => {
  const id = roleIdOf(STEWARD);
  const live = { circles: [LAND_HERE], roles: [liveRole(id, "Water Steward", "land", { paySet: true })] };
  const accepted = [created(id, { name: "Water Steward", circleId: "land" }, STEWARD)];
  const at = (iso: string, fields: Record<string, unknown>) =>
    snapshotAt(iso, [circleRec(LAND, "Land")], [roleRec(STEWARD, "Water Steward", [LAND], { fields })]);

  it("A FACT THAT CHANGED STAYS IN THE LIST FOR A DAY, through any number of reads", () => {
    const a = at("2026-11-01T09:00:00.000Z", { "Next Audit Date": "2026-11-01" });
    const b = at("2026-11-02T08:00:00.000Z", { "Next Audit Date": "2026-12-01" });
    const c = at("2026-11-02T10:00:00.000Z", { "Next Audit Date": "2026-12-01" });
    const shown = differences(input({ live, accepted, snapshots: [c, b, a], asOf: "2026-11-02T10:00:00.000Z" }));
    expect(shown.map((d) => [d.kind, d.sera, d.ours])).toEqual([["valueField", "2026-12-01", "2026-11-01"]]);
    // A day after the read that changed it, the digest has moved on.
    const d = at("2026-11-03T10:00:00.000Z", { "Next Audit Date": "2026-12-01" });
    expect(differences(input({ live, accepted, snapshots: [d, c, b, a], asOf: "2026-11-03T10:00:00.000Z" }))).toEqual([]);
  });

  it("A PAY FIGURE THE SERVICE CHANGED, WITH PAY SET HERE, STAYS FOR A DAY TOO", () => {
    const pay = (usd: number) => ({ "Compensation Model": "Stipend", "Compensation Status": "Proposed", "Compensation Target (Monthly)": usd });
    const a = at("2026-11-01T09:00:00.000Z", pay(1200));
    const b = at("2026-11-02T08:00:00.000Z", pay(1500));
    const c = at("2026-11-02T10:00:00.000Z", pay(1500));
    const [d] = differences(input({ live, accepted, snapshots: [c, b, a], asOf: "2026-11-02T10:00:00.000Z" }));
    expect(d).toMatchObject({ kind: "pay", state: "conflict", ours: "set" });
  });
});

describe("review 7: presence needs the service's own status", () => {
  const K = pid(90);
  const kid = roleIdOf(K);
  const rec = (status?: string): SnapshotRecord => ({ id: K, fields: { "Role Name": "Kitchen", Circle: [{ id: LAND }], ...(status ? { Status: status } : {}) } });

  it("AN ABSENT OR UNKNOWN STATUS MAKES NO PRESENCE DIFFERENCE, either way", () => {
    // The reviewer's shape: rested here, and the service's record carries no status.
    const rested = { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen", "land", { active: false })] };
    const history: AcceptedChange[] = [created(kid, { name: "Kitchen", circleId: "land" }, K), { op: "rest_seat", orgRoleId: kid, payload: {}, from: null }];
    expect(differences(input({ snapshots: [snapshot([circleRec(LAND, "Land")], [rec()])], live: rested, accepted: history }))).toEqual([]);
    // Nothing here, and no status, or one the service never defined: no addition.
    for (const status of [undefined, "Paused"]) {
      expect(differences(input({ snapshots: [snapshot([circleRec(LAND, "Land")], [rec(status)])] })), String(status)).toEqual([]);
    }
    // The controls: an explicit live status adds, an explicit Archived rests.
    expect(differences(input({ snapshots: [snapshot([circleRec(LAND, "Land")], [rec("Vacant")])] })).map((d) => d.kind)).toEqual(["roleAdd"]);
    const live = { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen", "land")] };
    expect(differences(input({ snapshots: [snapshot([circleRec(LAND, "Land")], [rec("Archived")])], live, accepted: history })).map((d) => d.kind)).toEqual(["roleRest"]);
  });
});

describe("review 8 and 9: one normaliser, the name swap included", () => {
  const K = pid(91);
  const kid = roleIdOf(K);
  const swap = (t: string) => t.replace(/\bJane Example\b/g, "a member");
  const swapped = { namesAMember: ["Body"], swapped: ["Body"] };

  it("WORDS WITH A NAME SWAPPED OUT COMPARE EQUAL TO OUR WORDS WITH THE NAME IN THEM", () => {
    const ours = "Jane Example holds the water.";
    const run = (withSwap: boolean) =>
      differences(
        input({
          snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(K, "Kitchen", [LAND], { ...swapped, fields: { Body: "a member holds the water." } })])],
          live: { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen", "land", { aim: ours })] },
          accepted: [created(kid, { name: "Kitchen", circleId: "land", aim: ours }, K)],
          ...(withSwap ? { swap } : {}),
        }),
      );
    expect(run(true)).toEqual([]);
    // The control: without the swap on our side, the two never meet.
    expect(run(false).map((d) => d.field)).toEqual(["aim"]);
  });

  it("NEVER OFFERS SWAPPED WORDS AS THE VALUE TO TAKE", () => {
    const [d] = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(K, "Kitchen", [LAND], { ...swapped, fields: { Body: "a member keeps the wells." } })])],
        live: { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen", "land", { aim: "Keeps the water." })] },
        accepted: [created(kid, { name: "Kitchen", circleId: "land", aim: "Keeps the water." }, K)],
        swap,
      }),
    );
    expect(d.flags.map((f) => f.key)).toEqual(["namesAMember"]);
    expect(d).toMatchObject({ takeable: false, autoEligible: false, bulkEligible: false });
  });

  it("A NAME THAT NAMES A MEMBER IS FLAGGED, and kept as the service sent it", () => {
    const [d] = differences(input({ snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(K, "Jane's Helper", [LAND], { namesAMember: ["Role Name"] })])] }));
    expect(d).toMatchObject({ kind: "roleAdd", sera: "Jane's Helper", takeable: false });
    expect(d.flags.map((f) => f.key)).toContain("namesAMember");
  });
});

// ── The second review of 2026-11-06 ─────────────────────────────────────────
// Each block below is one finding, built from the reviewer's probes 1 to 4.

describe("second review: a name that differs only by case is no rename", () => {
  it("A ROLE'S NAME IN OTHER CAPITALS IS NO RENAME, matched by name or by page id, the same as a circle's (probe 1 #5)", () => {
    const T = pid(100);
    // Matched by name: no base, so this read as a rename with an unknown base.
    const byName = differences(
      input({ snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(T, "treasurer", [LAND])])], live: { circles: [LAND_HERE], roles: [liveRole("t", "Treasurer", "land")] } }),
    );
    expect(byName).toEqual([]);
    // Matched by page id, with a known base in other capitals: still nothing.
    const tid = roleIdOf(T);
    const byPage = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(T, "TREASURER", [LAND])])],
        live: { circles: [LAND_HERE], roles: [liveRole(tid, "Treasurer", "land")] },
        accepted: [created(tid, { name: "Treasurer", circleId: "land" }, T)],
      }),
    );
    expect(byPage).toEqual([]);
    // A circle by a link, in other capitals: nothing either.
    expect(differences(input({ snapshots: [snapshot([circleRec(WATER, "WATER")], [])], live: { circles: [WATER_HERE], roles: [] }, links: { circles: { [WATER]: "water" } } }))).toEqual([]);
    // The control: a name that changed is a rename.
    const renamed = differences(
      input({
        snapshots: [snapshot([circleRec(LAND, "Land")], [roleRec(T, "Head Treasurer", [LAND])])],
        live: { circles: [LAND_HERE], roles: [liveRole(tid, "Treasurer", "land")] },
        accepted: [created(tid, { name: "Treasurer", circleId: "land" }, T)],
      }),
    );
    expect(renamed.map((d) => [d.kind, d.state, d.sera])).toEqual([["rename", "suggestion", "Head Treasurer"]]);
  });
});

describe("second review: pay never leaves the list undecided", () => {
  const K = pid(130);
  const kid = roleIdOf(K);
  const accepted = [created(kid, { name: "Kitchen", circleId: "land" }, K)];
  const live = { circles: [LAND_HERE], roles: [liveRole(kid, "Kitchen", "land", { paySet: true })] };
  const pay = (usd: number) => ({ "Compensation Model": "Stipend", "Compensation Status": "Proposed", "Compensation Target (Monthly)": usd });
  const at = (hours: number, usd: number) =>
    snapshotAt(new Date(Date.parse("2026-11-01T09:00:00.000Z") + hours * 3_600_000).toISOString(), [circleRec(LAND, "Land")], [roleRec(K, "Kitchen", [LAND], { fields: pay(usd) })]);
  /** The reads as the sync keeps them, each stamped against the chart, the newest thirty. */
  const chain = (reads: Snapshot[]) => {
    let kept: Snapshot[] = [];
    for (const s of reads) kept = [stampMatches(input({ snapshots: [s, ...kept], live, accepted }))!, ...kept].slice(0, 30);
    return kept;
  };
  const later = (from: number, n: number, usd: number) => Array.from({ length: n }, (_, i) => at(from + i, usd));

  it("THE SERVICE'S CHANGED PAY, WITH PAY SET HERE, STAYS PAST A DAY AND THROUGH THIRTY MORE READS", () => {
    const kept = chain([at(0, 1200), at(24, 1500), ...later(48, 30, 1500)]);
    const shown = differences(input({ snapshots: kept, live, accepted, asOf: kept[0].takenAt }));
    expect(shown.map((d) => [d.kind, d.state, d.ours, d.params?.monthlyUsd])).toEqual([["pay", "conflict", "set", 1500]]);
    expect(shown[0]).toMatchObject({ bulkEligible: false, autoEligible: false });
    // The controls: no change at the service is nothing, however many reads.
    expect(differences(input({ snapshots: chain([at(0, 1200), ...later(24, 31, 1200)]), live, accepted }))).toEqual([]);
    // And reads kept before matches were stored keep the old rule: a day, then gone.
    const old = [at(0, 1200), at(24, 1500), ...later(48, 30, 1500)].reverse().slice(0, 30);
    expect(differences(input({ snapshots: old, live, accepted, asOf: old[0].takenAt }))).toEqual([]);
  });
});

describe("second review C5: a steward's capitals at accept are never taken for the service's words", () => {
  const R = pid(120);
  const rid = roleIdOf(R);
  // The steward fixed the capitals at accept. The stored payload carries the fix, and its claim,
  // folded to lower case, still hashes to the key it landed under, so the reader calls it untouched.
  const accepted = traceAccepted(
    [{ draftId: "d1", op: "create_seat", orgRoleId: rid, payload: { name: "Water Steward", circleId: "land", aim: "Keeps The Wells Clear." } }],
    [{ id: "x1", draftId: "d1", kind: "org.proposed", original: true, payload: { seats: [{ id: R, name: "Water Steward", circleName: "Land", aim: "Keeps The Wells Clear." }] } }],
  );
  const live = { circles: [LAND_HERE], roles: [liveRole(rid, "Water Steward", "land", { aim: "Keeps The Wells Clear." })] };
  const said = (name: string, body: string) => [snapshot([circleRec(LAND, "Land")], [roleRec(R, name, [LAND], { fields: { Body: body } })])];

  it("THE SERVICE'S OLD WORDS, DIFFERENT BY CAPITALS ALONE, ARE NEVER AN AUTOMATIC OR BULK CHANGE (probe 1 #3)", () => {
    const list = differences(input({ snapshots: said("water steward", "keeps the wells clear."), live, accepted }));
    expect(list.map((d) => [d.kind, d.field, d.state])).toEqual([["textField", "aim", "suggestion"]]);
    expect(list[0]).toMatchObject({ base: "unknown", autoEligible: false, bulkEligible: false });
    expect(list[0].flags.map((f) => f.key)).toContain("baseUnknown");
    // The control: words the service changed past capitals are a suggestion on the known base.
    const [changed] = differences(input({ snapshots: said("Water Steward", "Keeps the wells and the pumps clear."), live, accepted }));
    expect(changed).toMatchObject({ state: "suggestion", base: { value: "Keeps The Wells Clear." }, autoEligible: true, bulkEligible: true });
  });
});

describe("second review C2: a rename here never turns what was matched into something new", () => {
  type Stamp = (r: SnapshotRecord) => SnapshotMatch | null;
  /** A read as the sync keeps it: each record carrying its match as it was made at that read. A kind with no stamp is kept the old way. */
  const kept = (s: Snapshot, circles: Stamp | null, roles: Stamp | null): Snapshot => ({
    ...s,
    circles: circles ? { ...s.circles, records: s.circles.records.map((r) => ({ ...r, match: circles(r) })) } : s.circles,
    roles: roles ? { ...s.roles, records: s.roles.records.map((r) => ({ ...r, match: roles(r) })) } : s.roles,
  });
  const waiting = (list: Difference[]) => list.filter((d) => d.state !== "oursAhead");

  // The reviewer's probe 4: two roles published from the service into our circle "Land", made here.
  const C = pid(110);
  const R1 = pid(111);
  const R2 = pid(112);
  const read = (n: number) => snapshot([circleRec(C, "Land")], [roleRec(R1, "Role 0", [C]), roleRec(R2, "Role 1", [C])], n);
  const accepted = [created(roleIdOf(R1), { name: "Role 0", circleId: "land" }, R1), created(roleIdOf(R2), { name: "Role 1", circleId: "land" }, R2)];
  const chart = (name: string) => ({ circles: [liveCircle("land", name)], roles: [liveRole(roleIdOf(R1), "Role 0", "land"), liveRole(roleIdOf(R2), "Role 1", "land")] });
  /** As kept while our circle was still "Land". */
  const keptThen = (n: number) =>
    kept(read(n), () => ({ ourId: "land", via: "name", agreed: { name: true } }), (r) => ({ ourId: roleIdOf(r.id), via: "pageId", agreed: { name: true, circle: "land" } }));

  it("OUR CIRCLE RENAMED HERE IS OURS AHEAD, never a circle to add and two roles to move (probe 4)", () => {
    const list = differences(input({ snapshots: [keptThen(2), keptThen(1)], live: chart("Land & Ecology"), accepted }));
    expect(list.map((d) => [d.kind, d.state, d.sera, d.ours, d.base])).toEqual([["rename", "oursAhead", "Land", "Land & Ecology", { value: "Land" }]]);
    expect(waiting(list)).toEqual([]);
    // Nothing at all while our circle keeps its name.
    expect(differences(input({ snapshots: [keptThen(2), keptThen(1)], live: chart("Land"), accepted }))).toEqual([]);
    // The control: the same reads kept before matches were stored are read the old way, against today's chart.
    const old = differences(input({ snapshots: [read(2), read(1)], live: chart("Land & Ecology"), accepted }));
    expect(old.map((d) => d.kind)).toEqual(["circleAdd", "roleMove", "roleMove"]);
  });

  // The reviewer's probe 1 #2: a role we hold, never published from the service, matched by name.
  const W = pid(113);
  const water = (name: string, body: string, n: number) => snapshot([circleRec(LAND, "Land")], [roleRec(W, name, [LAND], { fields: { Body: body } })], n);
  const ourWater = (name: string, aim = "Holds the water.") => ({ circles: [LAND_HERE], roles: [liveRole("our-water", name, "land", { aim })] });
  /** As kept while both sides said "Water Steward" and "Holds the water.". Only the roles were kept with their matches. */
  const waterThen = (n: number) =>
    kept(water("Water Steward", "Holds the water.", n), null, () => ({ ourId: "our-water", via: "name", agreed: { name: true, aim: true, circle: "land" } }));

  it("OUR ROLE RENAMED HERE IS OURS AHEAD, never a role to add that would duplicate it (probe 1 #2)", () => {
    const list = differences(input({ snapshots: [waterThen(2), waterThen(1)], live: ourWater("Water Keeper") }));
    expect(list.map((d) => [d.kind, d.state, d.sera, d.ours, d.base])).toEqual([["rename", "oursAhead", "Water Steward", "Water Keeper", { value: "Water Steward" }]]);
    expect(only(list, "roleAdd")).toEqual([]);
    // The control: kept before matches were stored, the old reading offers a role to add.
    expect(differences(input({ snapshots: [water("Water Steward", "Holds the water.", 2), water("Water Steward", "Holds the water.", 1)], live: ourWater("Water Keeper") })).map((d) => d.kind)).toEqual([
      "roleAdd",
    ]);
  });

  it("A CHANGE AT THE SERVICE AFTER BOTH AGREED IS A SUGGESTION against the value they agreed on", () => {
    // The service renamed it since; ours still holds the agreed name.
    const renamed = differences(input({ snapshots: [water("Water Warden", "Holds the water.", 2), waterThen(1)], live: ourWater("Water Steward") }));
    expect(renamed.map((d) => [d.kind, d.state, d.base])).toEqual([["rename", "suggestion", { value: "Water Steward" }]]);
    expect(renamed[0].flags.map((f) => f.key)).toEqual(["matchedEarlier"]);
    // New words at the service, against the words both held: a suggestion with a known base, still matched by name only.
    const [aim] = differences(input({ snapshots: [water("Water Steward", "Holds the wells.", 2), waterThen(1)], live: ourWater("Water Steward") }));
    expect(aim).toMatchObject({ kind: "textField", state: "suggestion", base: { value: "Holds the water." } });
    expect(aim.flags.map((f) => f.key)).toEqual(["matchedByName"]);
    // Our words changed and the service's did not: ours ahead.
    const ahead = differences(input({ snapshots: [waterThen(2), waterThen(1)], live: ourWater("Water Steward", "Holds the water and the wells.") }));
    expect(ahead.map((d) => [d.kind, d.state])).toEqual([["textField", "oursAhead"]]);
  });

  it("THE SYNC'S STORED MATCHES CARRY A RENAME HERE THROUGH THIRTY MORE READS (stampMatches, as each read is kept)", () => {
    // Each read stamped against the chart as it stood then, the newest first, the way the sync keeps them.
    let kept: Snapshot[] = [];
    const keep = (s: Snapshot, live: DifferencesInput["live"]) => {
      kept = [stampMatches(input({ snapshots: [s, ...kept], live, accepted }))!, ...kept].slice(0, 30);
    };
    keep(read(1), chart("Land"));
    expect(kept[0].circles.records[0].match).toEqual({ ourId: "land", via: "name", agreed: { name: true } });
    expect(kept[0].roles.records[0].match).toEqual({ ourId: roleIdOf(R1), via: "pageId", agreed: { name: true, circle: "land" } });
    // Renamed here, then thirty more reads: the read that saw both agree is long gone.
    for (let i = 0; i < 30; i += 1) keep(read(2), chart("Land & Ecology"));
    expect(kept[0].circles.records[0].match).toEqual({ ourId: "land", via: "earlier", agreed: { name: true } });
    const list = differences(input({ snapshots: kept, live: chart("Land & Ecology"), accepted }));
    expect(list.map((d) => [d.kind, d.state, d.base])).toEqual([["rename", "oursAhead", { value: "Land" }]]);
    // The service renames its circle since: a suggestion against the name both held.
    keep(snapshot([circleRec(C, "Land Stewardship")], [roleRec(R1, "Role 0", [C]), roleRec(R2, "Role 1", [C])], 3), chart("Land & Ecology"));
    const after = differences(input({ snapshots: kept, live: chart("Land & Ecology"), accepted }));
    expect(after.map((d) => [d.kind, d.state, d.sera, d.base])).toEqual([["rename", "conflict", "Land Stewardship", { value: "Land" }]]);
  });
});
