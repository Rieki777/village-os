/**
 * ONE SEAT, TWO DOORS, AND WHO READS WHAT AT EACH.
 *
 * `seatProjection.ts` is the seat object `/api/map` and `/api/org` both send.
 * This file pins three things, and each one is a different way it could
 * quietly go wrong:
 *
 *   1. THE KEY SET PER ROUTE PER TIER. Every key a route sent before stays at
 *      the tier it was sent at, and the only new keys are the ones the header
 *      of seatProjection.ts names. A renamed key on a live wire breaks readers
 *      that have not shipped, and a key that rides out one tier early is a
 *      privacy defect, so both directions are asserted on exact key lists.
 *   2. THE PRIVACY RULE FOR WHAT `/api/org` GAINED. A field reaches a caller
 *      on `/api/org` only where `/api/map` would already show that caller the
 *      same field, or at the member tier.
 *   3. BOTH HANDLERS CALL IT. A projection nobody calls proves nothing, so the
 *      last block reads `server/index.ts` the way
 *      `shared/circleView.sources.test.ts` does for circles.
 *
 * Every absence assertion carries a known-positive control: the same fixture
 * at the tier that DOES carry the key, or the same search finding the thing it
 * should. A search that finds nothing proves nothing until it has found
 * something.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { hasCapability } from "../../shared/capabilities";
import type { OrgAssignment, OrgRole } from "./orgChart";
import {
  PUBLIC_AGENT_NAME,
  earliestLiveTerm,
  mapSeatTier,
  mapShowsStructureTo,
  orgSeatTier,
  projectSeat,
  projectSeats,
  stateSource,
  villageWay,
  type SeatProjectionCtx,
  type SeatTier,
} from "./seatProjection";

const NOW = new Date("2026-10-01T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86400000);

const role = (over: Partial<OrgRole> = {}): OrgRole => ({
  id: "seat-water", circleId: "circle-land", name: "Water Steward",
  aim: "Keep the springs running.", domain: "The springs and the tanks",
  accountabilities: ["Testing the water monthly", "Calling a repair early"],
  whyItMatters: "A village that loses its water loses a season.",
  seats: 2, criticality: "high", active: true, recruiting: true, expiresEachSeason: null,
  statusOverride: null, statusOverrideExpiresAt: null,
  icon: null, color: null, order: 0, isExample: false, archetypes: ["steward"],
  authority: "Signs off water repairs", firstYearOutcomes: "A tested spring",
  first90DayOutcomes: "A repair list", locationExpectations: "On site weekly",
  compensationReality: "Unpaid this season", evidenceRequired: "Monthly test log",
  representsCircle: true, howChosen: "election", howChosenGloss: null,
  termsOffer: null, termsOfferAt: null, termsOfferBy: null,
  ...over,
});

const seating = (over: Partial<OrgAssignment> = {}): OrgAssignment => ({
  id: "seating-1", orgRoleId: "seat-water", holderKind: "member", userId: "u-mara",
  displayName: null, holderKey: "member:u-mara", focus: "mornings only",
  note: "Away and inactive.", seasonId: "season-1", termEndsAt: day(41),
  startedAt: day(-100), endedAt: null, endedReason: null,
  lapsed: false, lapsedReason: null, isExample: false, isAgent: false,
  ...over,
});

/** The brief's sample: a member, a lapsed agent, and a documented person. */
const VENDOR = "Vendor Bot Pro";
const MARA = seating();
const AGENT = seating({
  id: "seating-2", holderKind: "documented", userId: null, displayName: VENDOR,
  holderKey: "agent:vendor-bot", focus: "drafting minutes", note: null,
  termEndsAt: day(-30), lapsed: true, lapsedReason: "term", isAgent: true,
});
const ROWAN = seating({
  id: "seating-3", holderKind: "documented", userId: null, displayName: "Rowan Ashfield",
  holderKey: "doc:rowan-ashfield", focus: "the upper spring", note: "Two days a week.",
  termEndsAt: null, lapsed: false, lapsedReason: null,
});
const HELD = [MARA, AGENT, ROWAN];

const NAMES: Record<string, string> = { "u-mara": "Mara Quill" };
/** The server's own rule (server/index.ts `firstName`), restated for the fixture. */
const firstName = (name: string) => String(name ?? "").trim().split(/\s+/)[0] || "Someone";
const ctx = (route: "map" | "org"): SeatProjectionCtx => ({
  route,
  now: NOW,
  nameOf: (id) => firstName(NAMES[id] ?? "Member"),
  firstName,
  avatarOf: (id) => (id === "u-mara" ? "/images/avatars/steward-f-olive.webp" : null),
});

const MAP_MEMBER: SeatTier = mapSeatTier(true);
const MAP_STRUCTURE: SeatTier = mapSeatTier(false);
const tierOrg = (over: Partial<Parameters<typeof orgSeatTier>[0]> = {}) =>
  orgSeatTier({ editing: false, viewPeople: false, peopleArePublic: true, mapStructure: false, ...over });
const ORG_STRANGER_DARK = tierOrg();
const ORG_STRANGER_LIT = tierOrg({ mapStructure: true });
const ORG_MEMBER = tierOrg({ viewPeople: true });
const ORG_EDITING = tierOrg({ viewPeople: true, editing: true });

const sorted = (o: object) => Object.keys(o).sort();
const holdersOf = (seat: Record<string, unknown>) => seat.holders as Array<Record<string, unknown>>;

/** What each route sent before the projection, exactly. */
const MAP_BEFORE = [
  "id", "name", "description", "domain", "accountabilities", "whyItMatters", "circleId", "seats",
  "minStage", "holderCount", "vacant", "state", "isExample", "representsCircle", "howChosen",
  "howChosenGloss", "termEnds", "archetypes", "holders",
];
const ORG_BEFORE = [
  "id", "circleId", "name", "aim", "domain", "accountabilities", "whyItMatters", "seats",
  "criticality", "recruiting", "state", "holderCount", "holders", "isExample",
];
const PACK = [
  "authority", "firstYearOutcomes", "first90DayOutcomes", "locationExpectations",
  "compensationReality", "evidenceRequired",
];
/** The seat fields `/api/org` gained, all of them structure on `/api/map`. */
const ORG_GAINED = ["representsCircle", "howChosen", "howChosenGloss", "termEnds", "archetypes", "stateSource"];
const MAP_GAINED = ["criticality", "recruiting", "stateSource"];

describe("the key set per route and tier: everything kept, only the named fields added", () => {
  it("/api/map at the structure tier: the old keys plus criticality, recruiting and stateSource", () => {
    const seat = projectSeat(role(), HELD, MAP_STRUCTURE, ctx("map"));
    expect(sorted(seat)).toEqual([...MAP_BEFORE, ...MAP_GAINED].sort());
    expect(seat.criticality).toBe("high");
    expect(seat.recruiting).toBe(true);
    expect(seat.holders, "no names below map.viewPeople").toEqual([]);
    // The control: the same seat at the member tier does carry holder rows.
    expect(holdersOf(projectSeat(role(), HELD, MAP_MEMBER, ctx("map")))).toHaveLength(3);
  });

  it("/api/map at the member tier: the holder row is exactly what it was", () => {
    const seat = projectSeat(role(), HELD, MAP_MEMBER, ctx("map"));
    expect(sorted(seat)).toEqual([...MAP_BEFORE, ...MAP_GAINED].sort());
    for (const h of holdersOf(seat)) {
      expect(sorted(h)).toEqual(["avatar", "focus", "isAgent", "kind", "lapsed", "name", "termEndsAt", "userId"]);
    }
    const [mara, agent] = holdersOf(seat);
    expect(mara).toMatchObject({ userId: "u-mara", name: "Mara", avatar: "/images/avatars/steward-f-olive.webp" });
    expect(mara.termEndsAt).toBe(day(41).toISOString());
    expect(agent).toMatchObject({ isAgent: true, lapsed: true, avatar: null });
    expect(seat.description).toBe("Keep the springs running.");
    expect(seat.minStage).toBeNull();
    expect(seat.vacant).toBe(false);
  });

  it("/api/org to a stranger the map does not show its structure: exactly the old keys", () => {
    const seat = projectSeat(role(), HELD, ORG_STRANGER_DARK, ctx("org"));
    expect(sorted(seat)).toEqual([...ORG_BEFORE].sort());
    for (const k of ORG_GAINED) expect(seat, `${k} stays off the dark tier`).not.toHaveProperty(k);
    // The control: the same seat, for a stranger the map DOES show, carries each.
    const lit = projectSeat(role(), HELD, ORG_STRANGER_LIT, ctx("org"));
    for (const k of ORG_GAINED) expect(lit, `${k} reaches the lit tier`).toHaveProperty(k);
    expect(sorted(lit)).toEqual([...ORG_BEFORE, ...ORG_GAINED].sort());
  });

  it("/api/org at the member tier carries the gained fields whatever the map says", () => {
    const seat = projectSeat(role(), HELD, tierOrg({ viewPeople: true, mapStructure: false }), ctx("org"));
    expect(sorted(seat)).toEqual([...ORG_BEFORE, ...ORG_GAINED].sort());
  });

  it("the recruitment pack and the seating id stay at the editing tier", () => {
    const member = projectSeat(role(), HELD, ORG_MEMBER, ctx("org"));
    for (const k of PACK) expect(member, `${k} is not member reading`).not.toHaveProperty(k);
    for (const h of holdersOf(member)) expect(h).not.toHaveProperty("assignmentId");
    // The control: the editing tier carries every one of them.
    const editing = projectSeat(role(), HELD, ORG_EDITING, ctx("org"));
    for (const k of PACK) expect(editing).toHaveProperty(k);
    expect(editing.compensationReality).toBe("Unpaid this season");
    expect(holdersOf(editing).map((h) => h.assignmentId)).toEqual(["seating-1", "seating-2", "seating-3"]);
    // And the map never had an editing tier to begin with.
    const mapAsAdmin = projectSeat(role(), HELD, { ...MAP_MEMBER, editing: true }, ctx("map"));
    for (const k of PACK) expect(mapAsAdmin).not.toHaveProperty(k);
    for (const h of holdersOf(mapAsAdmin)) expect(h).not.toHaveProperty("assignmentId");
  });
});

describe("the holder rows on /api/org", () => {
  it("a stranger reads a first name and nothing else, and an agent reads as an agent", () => {
    const seat = projectSeat(role(), HELD, ORG_STRANGER_DARK, ctx("org"));
    const rows = holdersOf(seat);
    for (const h of rows) expect(Object.keys(h)).toEqual(["name"]);
    expect(rows.map((h) => h.name)).toEqual(["Mara", PUBLIC_AGENT_NAME, "Rowan"]);
    const wire = JSON.stringify(seat);
    for (const leak of [VENDOR, "Quill", "Ashfield", "u-mara", "mornings only", "Away and inactive", "upper spring"]) {
      expect(wire, `${leak} stays off the public row`).not.toContain(leak);
    }
    // The control: the member tier carries every key and string held back above.
    const member = projectSeat(role(), HELD, ORG_MEMBER, ctx("org"));
    const memberRow = holdersOf(member)[0];
    for (const k of ["userId", "focus", "note", "kind", "lapsed", "isAgent"]) {
      expect(memberRow, `${k} is a member-tier key`).toHaveProperty(k);
    }
    const memberWire = JSON.stringify(member);
    for (const leak of [VENDOR, "Ashfield", "u-mara", "mornings only", "Away and inactive", "upper spring"]) {
      expect(memberWire, `${leak} is in the member fixture`).toContain(leak);
    }
  });

  it("the public row for an agent is the literal the client reads back", () => {
    expect(PUBLIC_AGENT_NAME).toBe("An agent");
  });

  it("the member row gains isAgent, and nothing else changes", () => {
    const rows = holdersOf(projectSeat(role(), HELD, ORG_MEMBER, ctx("org")));
    for (const h of rows) {
      expect(sorted(h)).toEqual(["focus", "isAgent", "kind", "lapsed", "lapsedReason", "name", "note", "userId"]);
    }
    expect(rows.map((h) => h.isAgent)).toEqual([false, true, false]);
    // The name is served as before: a member's first name, a documented
    // holder's display name whole. isAgent is how a reader knows the second
    // row's name is a product's and not a person's.
    expect(rows.map((h) => h.name)).toEqual(["Mara", VENDOR, "Rowan Ashfield"]);
    expect(rows[1]).toMatchObject({ lapsed: true, lapsedReason: "term", kind: "documented" });
  });

  it("the lock with no member tier serves no rows; the count still answers", () => {
    const seat = projectSeat(role(), HELD, tierOrg({ peopleArePublic: false }), ctx("org"));
    expect(seat.holders).toEqual([]);
    expect(seat.holderCount).toBe(3);
    // The control: the same caller with the lock off reads three rows.
    expect(holdersOf(projectSeat(role(), HELD, tierOrg({ peopleArePublic: true }), ctx("org")))).toHaveLength(3);
  });
});

describe("parity: one seat, the same answer from both doors", () => {
  const pairs: Array<[string, SeatTier, SeatTier]> = [
    ["member", MAP_MEMBER, ORG_MEMBER],
    ["structure without people", MAP_STRUCTURE, tierOrg({ mapStructure: true, peopleArePublic: false })],
  ];
  for (const [label, mapTier, orgTier] of pairs) {
    it(`every key both routes send agrees, at the ${label} tier`, () => {
      for (const r of [role(), role({ statusOverride: "filled", statusOverrideExpiresAt: day(10) }), role({ seats: 5 })]) {
        const onMap = projectSeat(r, HELD, mapTier, ctx("map"));
        const onOrg = projectSeat(r, HELD, orgTier, ctx("org"));
        const shared = Object.keys(onMap).filter((k) => k in onOrg && k !== "holders");
        // The seat fields every card reads, named so a dropped one fails by name.
        for (const k of ["state", "holderCount", "seats", "criticality", "recruiting", ...ORG_GAINED]) {
          expect(shared, `${k} is on both routes`).toContain(k);
        }
        for (const k of shared) expect(onOrg[k], `${k} agrees`).toEqual(onMap[k]);
        // The aim is the one field spelled twice, and it is the same words.
        expect(onMap.description).toBe(onOrg.aim);
      }
    });
  }

  it("the member holder rows agree on every key both routes send", () => {
    const onMap = holdersOf(projectSeat(role(), HELD, MAP_MEMBER, ctx("map")));
    const onOrg = holdersOf(projectSeat(role(), HELD, ORG_MEMBER, ctx("org")));
    for (let i = 0; i < onMap.length; i++) {
      const shared = Object.keys(onMap[i]).filter((k) => k in onOrg[i]);
      expect(shared.sort()).toEqual(["focus", "isAgent", "kind", "lapsed", "name", "userId"]);
      for (const k of shared) expect(onOrg[i][k], `holder ${i} ${k}`).toEqual(onMap[i][k]);
    }
  });
});

describe("stateSource: where the state came from", () => {
  it("is declared while an override holds, and derived once it expires", () => {
    const set = role({ statusOverride: "filled", statusOverrideExpiresAt: day(10) });
    expect(stateSource(set, NOW)).toBe("declared");
    expect(projectSeat(set, [], MAP_STRUCTURE, ctx("map"))).toMatchObject({ state: "filled", stateSource: "declared" });
    const later = { ...ctx("map"), now: day(11) };
    expect(stateSource(set, day(11))).toBe("derived");
    expect(projectSeat(set, [], MAP_STRUCTURE, later)).toMatchObject({ state: "open", stateSource: "derived" });
  });

  it("is declared for an override with no expiry, even one the seatings would agree with", () => {
    const set = role({ seats: 1, statusOverride: "filled", statusOverrideExpiresAt: null });
    expect(projectSeat(set, [MARA], MAP_STRUCTURE, ctx("map"))).toMatchObject({ state: "filled", stateSource: "declared" });
  });

  it("is derived with no override at all", () => {
    expect(projectSeat(role(), HELD, MAP_STRUCTURE, ctx("map"))).toMatchObject({ state: "filled", stateSource: "derived" });
    // One of three is lapsed, two current against two seats.
    expect(projectSeat(role(), [MARA, AGENT], MAP_STRUCTURE, ctx("map"))).toMatchObject({ state: "partial", stateSource: "derived" });
  });
});

describe("termEnds: the earliest term on the seat", () => {
  it("is the earliest term among its live seatings, a lapsed one included", () => {
    expect(earliestLiveTerm(HELD)).toBe(day(-30).toISOString());
    expect(earliestLiveTerm([MARA, ROWAN])).toBe(day(41).toISOString());
    expect(projectSeat(role(), HELD, ORG_MEMBER, ctx("org")).termEnds).toBe(day(-30).toISOString());
  });

  it("is null when nobody seated has a term, and when nobody is seated", () => {
    expect(earliestLiveTerm([ROWAN])).toBeNull();
    expect(earliestLiveTerm([])).toBeNull();
  });
});

describe("the privacy rule: never more public on /api/org than on /api/map", () => {
  type Row = [string, Parameters<typeof mapShowsStructureTo>[0], boolean];
  const stranger = { signedIn: false, admin: false };
  const member = { signedIn: true, admin: false };
  const admin = { signedIn: true, admin: true };
  const rows: Row[] = [
    ["a stranger, map public, public structure on", { lifecycle: "public", publicStructure: true, ...stranger }, true],
    ["a stranger, map public, public structure off", { lifecycle: "public", publicStructure: false, ...stranger }, false],
    ["a stranger, map for members", { lifecycle: "members", publicStructure: true, ...stranger }, false],
    ["a stranger, map in preview", { lifecycle: "preview", publicStructure: true, ...stranger }, false],
    ["a stranger, map off", { lifecycle: "off", publicStructure: true, ...stranger }, false],
    ["a member, map public, public structure off", { lifecycle: "public", publicStructure: false, ...member }, true],
    ["a member, map for members", { lifecycle: "members", publicStructure: false, ...member }, true],
    ["a member, map in preview", { lifecycle: "preview", publicStructure: true, ...member }, false],
    ["a member, map off", { lifecycle: "off", publicStructure: true, ...member }, false],
    ["an admin, map in preview", { lifecycle: "preview", publicStructure: false, ...admin }, true],
    ["an admin, map off", { lifecycle: "off", publicStructure: true, ...admin }, false],
  ];
  for (const [label, input, expected] of rows) {
    it(`${label}: the map ${expected ? "shows" : "hides"} its structure`, () => {
      expect(mapShowsStructureTo(input)).toBe(expected);
    });
  }

  it("a stranger reads termEnds on /api/org exactly when the map would show it to them", () => {
    for (const [label, input, expected] of rows.filter(([, i]) => !i.signedIn)) {
      const tier = tierOrg({ mapStructure: mapShowsStructureTo(input) });
      const seat = projectSeat(role(), HELD, tier, ctx("org"));
      expect("termEnds" in seat, label).toBe(expected);
    }
  });

  it("the member tier reads it with the map off", () => {
    const tier = tierOrg({ viewPeople: true, mapStructure: mapShowsStructureTo({ lifecycle: "off", publicStructure: false, signedIn: true, admin: false }) });
    expect(tier.structure).toBe(true);
    // The control: the same caller without the member tier does not.
    expect(tierOrg({ viewPeople: false, mapStructure: false }).structure).toBe(false);
  });

  it("the tiers fall out of the three dials the way the route always read them", () => {
    expect(tierOrg({ viewPeople: false, peopleArePublic: false }).people).toBe("none");
    expect(tierOrg({ viewPeople: false, peopleArePublic: true }).people).toBe("public");
    expect(tierOrg({ viewPeople: true, peopleArePublic: false }).people).toBe("member");
    expect(tierOrg({ viewPeople: true, peopleArePublic: true }).people).toBe("member");
    expect(mapSeatTier(false)).toEqual({ structure: true, people: "none", editing: false, terms: false });
    expect(mapSeatTier(true)).toEqual({ structure: true, people: "member", editing: false, terms: false });
    // terms.read is its own flag: map.viewPeople never implies it.
    expect(mapSeatTier(true, true).terms).toBe(true);
    expect(tierOrg({ viewPeople: true, editing: true }).terms).toBe(false);
  });
});

describe("projectSeats: the whole list", () => {
  it("keeps active seats in the order they arrived, each with only its own seatings", () => {
    const other = role({ id: "seat-hearth", name: "Hearth Keeper", seats: 1 });
    const retired = role({ id: "seat-old", name: "Retired seat", active: false });
    const seats = projectSeats(
      [other, retired, role()],
      [seating({ id: "s-h", orgRoleId: "seat-hearth" }), ...HELD],
      ORG_MEMBER,
      ctx("org"),
    );
    expect(seats.map((s) => s.id)).toEqual(["seat-hearth", "seat-water"]);
    expect(seats.map((s) => s.holderCount)).toEqual([1, 3]);
    // The control: the retired seat is a real row the filter had to drop.
    expect([other, retired, role()].map((r) => r.id)).toContain("seat-old");
  });
});

/*
 * BOTH HANDLERS CALL IT. Read the server source, the way
 * shared/circleView.sources.test.ts holds the circle projection.
 */
const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(path.join(ROOT, "server/index.ts"), "utf8");
const lib = fs.readFileSync(path.join(ROOT, "server/lib/seatProjection.ts"), "utf8");

/** The body of one Express handler, from `app.METHOD("path"` to the closing `});` at its indentation. */
function handler(method: string, route: string): string {
  const open = src.indexOf(`app.${method}("${route}"`);
  expect(open, `${method.toUpperCase()} ${route} exists in server/index.ts`).toBeGreaterThan(-1);
  const end = src.indexOf("\n  });", open);
  expect(end, `${method.toUpperCase()} ${route} has a findable end`).toBeGreaterThan(open);
  return src.slice(open, end);
}

/** Keys that only a hand-written seat or holder literal would spell. */
const HAND_ROLLED = /\b(lapsedReason|howChosenGloss|termEndsAt|compensationReality|vacant):/;

describe("both handlers send the projection and write no seat of their own", () => {
  it("finds the handlers and the projection (the positive control for every check below)", () => {
    expect(handler("get", "/api/map")).toContain("res.json");
    expect(handler("get", "/api/org")).toContain("res.json");
    // The pattern below is not vacuous: the projection itself spells every key.
    expect(lib).toMatch(HAND_ROLLED);
    for (const k of ["lapsedReason:", "howChosenGloss:", "termEndsAt:", "compensationReality:", "vacant:"]) {
      expect(lib, k).toContain(k);
    }
  });

  it("/api/map projects its seats through projectSeats at the map tier", () => {
    expect(handler("get", "/api/map")).toMatch(/projectSeats\(\s*orgRoles,\s*orgAssignments,\s*mapSeatTier\(viewPeople,/);
  });

  it("/api/org projects its seats through projectSeats at the tier orgSeatTier decides", () => {
    const body = handler("get", "/api/org");
    expect(body).toContain("orgSeatTier(");
    expect(body).toContain("mapShowsStructureTo(");
    expect(body).toMatch(/projectSeats\(\s*roles,\s*assignments,\s*tier,/);
  });

  it("neither handler hand-rolls a seat or a holder row", () => {
    for (const route of ["/api/map", "/api/org"]) {
      expect(handler("get", route), `${route} writes no seat literal`).not.toMatch(HAND_ROLLED);
    }
  });

  it("the agent's public name has one spelling, in the projection", () => {
    expect(lib).toContain(`"${PUBLIC_AGENT_NAME}"`);
    expect(src, "server/index.ts carries no second copy").not.toContain(`"${PUBLIC_AGENT_NAME}"`);
  });

  it("the org export keys on the same rule as the stranger's tier", () => {
    const at = src.indexOf("const orgExportLive = () =>");
    expect(at, "orgExportLive exists").toBeGreaterThan(-1);
    expect(src.slice(at, at + 300)).toContain("mapShowsStructureTo(");
  });
});

describe("the village's way on /api/org", () => {
  it("carries the method and the village's own line for Other, as /api/map's power block does", () => {
    const line = "The village sits until it agrees";
    expect(villageWay({ decidesBy: "other", decidesByGloss: line })).toEqual({ decidesBy: "other", decidesByGloss: line });
    // Nothing declared reads as nothing declared, never as a guess.
    expect(villageWay(null)).toEqual({ decidesBy: null, decidesByGloss: null });
  });

  it("is sent through villageWay, and only at the structure tier", () => {
    const body = handler("get", "/api/org");
    expect(body).toMatch(/tier\.structure \? \{ village: villageWay\(villagePowerDeclared\(\)\) \}/);
    // Control: the map sends the same declared block, whole, in `power`.
    expect(handler("get", "/api/map")).toContain("villagePowerDeclared()");
  });
});

/*
 * ── THE OPEN BOOK: terms on offer ride the `terms.read` tier only (PR3) ────
 *
 * The tiers here are built the way the two handlers build them, from the
 * REAL gate over a visitor, a guest and a member, so a change to the rung or
 * to the gate moves these answers. A guest holds `map.viewPeople` and reads
 * holder names; that same guest must read no terms, which is the whole reason
 * `terms.read` is its own key. The figures are fake on purpose (XTS is the
 * ISO code reserved for testing).
 */
describe("the terms tier: no termsOffer below the member rung", () => {
  const LADDER = ["visitor", "guest", "member"];
  const capCtx = (stage: string) => ({
    stageIndex: LADDER.indexOf(stage),
    stageIndexOf: (id: string) => LADDER.indexOf(id),
    roleCapabilities: [] as string[],
  });
  const FAKE_OFFER = { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 12345, per: "month" } };
  const offered = role({ termsOffer: JSON.stringify(FAKE_OFFER), termsOfferAt: day(-2), termsOfferBy: "u-founder" });
  const TERMS_KEYS = ["termsOffer", "termsOfferAt", "termsOfferUnreadable"];

  /** The tiers each handler would build for this reader. */
  const tiersFor = (reader: "public" | "guest" | "member") => {
    const c = reader === "public" ? null : capCtx(reader);
    const viewPeople = c ? hasCapability("map.viewPeople", c) : false;
    const terms = c ? hasCapability("terms.read", c) : false;
    return {
      map: mapSeatTier(viewPeople, terms),
      org: orgSeatTier({ editing: false, viewPeople, peopleArePublic: true, mapStructure: true, terms }),
    };
  };

  for (const reader of ["public", "guest"] as const) {
    it(`${reader}: neither /api/map nor /api/org carries any terms key`, () => {
      const t = tiersFor(reader);
      for (const [route, tier] of [["map", t.map], ["org", t.org]] as const) {
        const seat = projectSeat(offered, HELD, tier, ctx(route));
        for (const k of TERMS_KEYS) expect(seat, `${route} ${reader} ${k}`).not.toHaveProperty(k);
        expect(JSON.stringify(seat), `${route} ${reader} carries no figure`).not.toContain("12345");
      }
    });
  }

  it("guest: names ride and terms do not, the control that makes the line above mean something", () => {
    const seat = projectSeat(offered, HELD, tiersFor("guest").map, ctx("map"));
    expect(holdersOf(seat)).toHaveLength(3);
    expect(seat).not.toHaveProperty("termsOffer");
  });

  it("member: the positive control, both routes carry the parsed offer and when it was set", () => {
    const t = tiersFor("member");
    for (const [route, tier] of [["map", t.map], ["org", t.org]] as const) {
      const seat = projectSeat(offered, HELD, tier, ctx(route));
      expect(seat.termsOffer, route).toMatchObject({ v: 1, pay: { kind: "fixed", amountMinor: 12345 } });
      expect(seat.termsOfferUnreadable).toBe(false);
      expect(seat.termsOfferAt).toBe(day(-2).toISOString());
      // Who set it is a user id, so it never rides with the terms.
      expect(seat).not.toHaveProperty("termsOfferBy");
    }
  });

  it("member: a seat with no offer reads null, so a member can be told there are none", () => {
    const seat = projectSeat(role(), HELD, tiersFor("member").org, ctx("org"));
    expect(seat.termsOffer).toBeNull();
    expect(seat.termsOfferUnreadable).toBe(false);
  });

  it("member: a stored offer the parser refuses is said to be unreadable, never sent half read", () => {
    const bad = role({ termsOffer: JSON.stringify({ v: 1, pay: { kind: "fixed", note: "IBAN GB29NWBK60161331926819" } }) });
    const seat = projectSeat(bad, HELD, tiersFor("member").org, ctx("org"));
    expect(seat.termsOffer).toBeNull();
    expect(seat.termsOfferUnreadable).toBe(true);
    expect(JSON.stringify(seat)).not.toContain("GB29");
  });

  it("the terms keys are the only thing the member tier gained", () => {
    const seat = projectSeat(offered, HELD, tierOrg({ viewPeople: true }), ctx("org"));
    expect(sorted(seat)).toEqual([...ORG_BEFORE, ...ORG_GAINED].sort());
    const withTerms = projectSeat(offered, HELD, tierOrg({ viewPeople: true, terms: true }), ctx("org"));
    expect(sorted(withTerms)).toEqual([...ORG_BEFORE, ...ORG_GAINED, ...TERMS_KEYS].sort());
  });

  it("carries the adopted terms a holder sits on, at the terms tier only (red team U2)", () => {
    const seated = { ...MARA, applicationId: "sa-0000000000000001" } as OrgAssignment;
    const heldTerms = new Map([["sa-0000000000000001", { applicationId: "sa-0000000000000001", settings: { v: 1 }, decidedOn: "2026-10-09" }]]);
    const withTerms = projectSeat(offered, [seated], tierOrg({ viewPeople: true, terms: true }), { ...ctx("org"), heldTerms });
    expect(withTerms.heldTerms).toEqual([{ holderName: "Mara", applicationId: "sa-0000000000000001", settings: { v: 1 }, decidedOn: "2026-10-09" }]);
    // CONTROL: below the terms tier, nothing of it travels.
    const without = projectSeat(offered, [seated], tierOrg({ viewPeople: true }), { ...ctx("org"), heldTerms });
    expect(without).not.toHaveProperty("heldTerms");
  });

  it("both handlers ask the one gate for terms.read, and nothing else decides it", () => {
    expect(handler("get", "/api/map")).toMatch(
      /mapSeatTier\(viewPeople, !!viewerCapCtx && hasCapability\("terms\.read", viewerCapCtx\)\)/,
    );
    expect(handler("get", "/api/org")).toMatch(/terms: viewerCtx \? hasCapability\("terms\.read", viewerCtx\) : false/);
    // Never the guest-rung key standing in for it.
    for (const route of ["/api/map", "/api/org"]) {
      expect(handler("get", route)).not.toMatch(/terms[^\n]*map\.viewPeople/);
    }
  });
});
