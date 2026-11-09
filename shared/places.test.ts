/**
 * Living places, the pure rules (places lane S1). Every place here is invented
 * (III.12), except the last block, which reads the first village's own seed
 * record to prove it holds together against its live map keys.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkStageMove,
  findPermitCycle,
  isLegacyPlaceKey,
  isPlaceKey,
  keyCollision,
  parseStewardClaim,
  permitGrantRefusal,
  permitsComplete,
  placeInDoubt,
  PLACE_STAGES,
  preserveCounts,
  seedProblems,
  stageAdopterRefusal,
  stewardState,
  type PermitItem,
  type PlacesSeed,
  type StageMoveInput,
} from "./places";

const ready = { complete: true, missing: [] as string[] };
const move = (over: Partial<StageMoveInput> = {}): StageMoveInput => ({
  kind: "building",
  from: "idea",
  to: "sited",
  via: "holder",
  inPreserve: "no",
  inRiparianBuffer: "no",
  permits: ready,
  steward: "filled",
  setAside: false,
  ...over,
});

describe("the lifecycle", () => {
  it("lists the nine stages in order", () => {
    expect(PLACE_STAGES).toEqual(["idea", "sited", "designed", "permitted", "funded", "building", "built", "in_use", "needs_care"]);
  });

  it("moves one stage at a time, and only the highest vote skips", () => {
    expect(checkStageMove(move()).ok).toBe(true);
    const skip = checkStageMove(move({ from: "idea", to: "designed" }));
    expect(skip.ok).toBe(false);
    if (!skip.ok) {
      expect(skip.code).toBe("skips_stages");
      expect(skip.votePath).toMatch(/highest vote/);
    }
    expect(checkStageMove(move({ from: "idea", to: "designed", via: "highest_vote" })).ok).toBe(true);
  });

  it("moves back only with a reason", () => {
    const r = checkStageMove(move({ from: "permitted", to: "designed" }));
    expect(r.ok).toBe(false);
    expect(checkStageMove(move({ from: "permitted", to: "designed", reason: "the permit was refused" })).ok).toBe(true);
  });

  it("lets only a built place need care, and care returns to in use", () => {
    expect(checkStageMove(move({ from: "designed", to: "needs_care" })).ok).toBe(false);
    expect(checkStageMove(move({ from: "in_use", to: "needs_care" })).ok).toBe(true);
    expect(checkStageMove(move({ from: "needs_care", to: "in_use" })).ok).toBe(true);
    expect(checkStageMove(move({ from: "needs_care", to: "built", reason: "x" })).ok).toBe(false);
  });

  it("gives land, the preserve and features no stages, and refuses set-aside places", () => {
    expect(checkStageMove(move({ kind: "preserve" })).ok).toBe(false);
    const r = checkStageMove(move({ setAside: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.votePath).toBeTruthy();
  });
});

describe("the building gate", () => {
  const toBuilding = (over: Partial<StageMoveInput> = {}) => move({ from: "funded", to: "building", ...over });

  it("passes with permits complete and a steward filled or held", () => {
    expect(checkStageMove(toBuilding()).ok).toBe(true);
    expect(checkStageMove(toBuilding({ steward: "held" })).ok).toBe(true);
  });

  it("names each missing piece and the vote that gets past it", () => {
    const r = checkStageMove(toBuilding({ steward: "open", permits: { complete: false, missing: ["Power letter"] } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("building_gate");
      expect(r.reason).toContain("Power letter");
      expect(r.reason).toContain("steward");
      expect(r.votePath).toMatch(/highest vote/);
    }
  });

  it("refuses on the steward half alone (control for the permits half)", () => {
    const r = checkStageMove(toBuilding({ steward: "paused" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain("permits");
  });

  it("lets the highest vote move it anyway, and keeps the warning", () => {
    const r = checkStageMove(toBuilding({ via: "highest_vote", steward: "open" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(" ")).toContain("steward");
  });
});

describe("the preserve", () => {
  it("refuses siting while the answers are unknown", () => {
    const r = checkStageMove(move({ inPreserve: "unknown" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("preserve_unknown");
  });

  it("needs consent to site inside the preserve or a buffer", () => {
    const r = checkStageMove(move({ inRiparianBuffer: "yes" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("preserve_consent");
    const c = checkStageMove(move({ inRiparianBuffer: "yes", via: "consent" }));
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.warnings.length).toBe(1);
  });

  it("counts absolutely and never ranks", () => {
    const c = preserveCounts([
      { inPreserve: "yes", inRiparianBuffer: "no", footprintM2: 40 },
      { inPreserve: "no", inRiparianBuffer: "unknown", footprintM2: null },
    ]);
    expect(c).toEqual({ footprintM2: 40, withFootprint: 1, inPreserve: 1, inBuffer: 0, unanswered: 1 });
  });
});

describe("permits", () => {
  const items: PermitItem[] = [
    { id: "layout", place: "whole", title: "Electrical layout", state: "needed" },
    { id: "letter", place: "whole", title: "Power letter", state: "needed", waitsOn: ["layout"] },
    { id: "own", place: "hall", title: "Building permit", state: "granted", waitsOn: ["letter"] },
  ];

  it("treats an empty checklist as incomplete", () => {
    expect(permitsComplete("barn", items).complete).toBe(false);
  });

  it("follows what a place's items wait on", () => {
    const r = permitsComplete("hall", items);
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(["Power letter", "Electrical layout"]);
    const done = items.map((i) => ({ ...i, state: "granted" as const }));
    expect(permitsComplete("hall", done).complete).toBe(true);
  });

  it("refuses a grant while what it waits on is open, naming a vote", () => {
    const r = permitGrantRefusal("letter", items);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Electrical layout");
    expect(permitGrantRefusal("layout", items).ok).toBe(true);
  });

  it("finds a cycle", () => {
    expect(findPermitCycle(items)).toBeNull();
    const loop = [...items, { id: "layout", place: "whole", title: "x", state: "needed" as const, waitsOn: ["own"] }];
    expect(findPermitCycle(loop.slice(1))).not.toBeNull();
  });
});

describe("who adopts a stage change", () => {
  it("never the proposer, never the approver of its source", () => {
    expect(stageAdopterRefusal({ actorId: "a", proposerId: "a", actorHoldsPlaceTend: true }).ok).toBe(false);
    expect(stageAdopterRefusal({ actorId: "b", proposerId: "a", sourceApproverId: "b", actorHoldsPlaceTend: true }).ok).toBe(false);
    expect(stageAdopterRefusal({ actorId: "c", proposerId: "a", sourceApproverId: "b", actorHoldsPlaceTend: true }).ok).toBe(true);
  });

  it("sends a member without the power to a village vote", () => {
    const r = stageAdopterRefusal({ actorId: "c", proposerId: "a", actorHoldsPlaceTend: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.votePath).toMatch(/village vote/);
  });
});

describe("place keys", () => {
  it("takes lowercase slugs for new places, up to 64", () => {
    expect(isPlaceKey("event-space")).toBe(true);
    expect(isPlaceKey("EventSpace")).toBe(false);
    expect(isPlaceKey("a".repeat(64))).toBe(true);
    expect(isPlaceKey("a".repeat(65))).toBe(false);
    expect(isPlaceKey("-lead")).toBe(false);
  });

  it("keeps a mixed-case key already on a map", () => {
    expect(isLegacyPlaceKey("ridgeA")).toBe(true);
  });

  it("finds a collision that differs only by case", () => {
    expect(keyCollision("ridgea", ["gate", "ridgeA"])).toBe("ridgeA");
    expect(keyCollision("ridge-a", ["ridgeA"])).toBeNull();
  });
});

describe("the steward position", () => {
  it("is open when no role exists yet", () => {
    expect(stewardState({ roleId: null, seat: null, held: false, paused: false })).toBe("open");
  });
  it("reads held and paused from the place, and fills from the role", () => {
    expect(stewardState({ roleId: null, seat: null, held: true, paused: false })).toBe("held");
    expect(stewardState({ roleId: "r", seat: "open", held: false, paused: true })).toBe("paused");
    expect(stewardState({ roleId: "r", seat: "filled", held: false, paused: false })).toBe("filled");
    expect(stewardState({ roleId: "r", seat: "expired", held: false, paused: false })).toBe("expired");
  });
});

describe("a claim", () => {
  const good = { build: "A yoga shala first.", timeline: "Two seasons", funds: { amountMinor: 500, unit: "CRC", note: "" } };
  it("needs what you'll build and your timeline", () => {
    expect(parseStewardClaim(good).ok).toBe(true);
    expect(parseStewardClaim({ ...good, build: " " }).ok).toBe(false);
    expect(parseStewardClaim({ ...good, timeline: "" }).ok).toBe(false);
  });
  it("holds its limits and names a unit for an amount", () => {
    expect(parseStewardClaim({ ...good, team: "x".repeat(1001) }).ok).toBe(false);
    expect(parseStewardClaim({ ...good, funds: { amountMinor: 5, note: "" } }).ok).toBe(false);
    expect(parseStewardClaim({ ...good, funds: { amountMinor: -1, unit: "CRC", note: "" } }).ok).toBe(false);
    const none = parseStewardClaim({ ...good, funds: undefined });
    expect(none.ok && none.claim.funds.amountMinor).toBeNull();
  });
});

describe("a village seed", () => {
  const seed = (): PlacesSeed => ({
    version: 1,
    zones: [{ key: "north", name: "North", order: 1, positionText: "Up the hill" }],
    places: [
      { key: "whole", name: "The land", zone: null, kind: "land", stage: null, confirmed: true, positionText: "All", description: "" },
      { key: "barn", name: "Barn", onMap: true, zone: "north", kind: "building", stage: "built", confirmed: true, positionText: "", description: "" },
      { key: "hall", name: "Hall", zone: "north", kind: "building", stage: "idea", confirmed: true, positionText: "", description: "" },
    ],
    permits: [],
  });

  it("passes a sound seed", () => {
    expect(seedProblems(seed(), ["barn"])).toEqual([]);
  });

  it("refuses a seed that drops a key on the map", () => {
    expect(seedProblems(seed(), ["barn", "mill"]).join()).toContain("mill");
  });

  it("refuses a place in doubt marked confirmed", () => {
    const s = seed();
    s.places[2].disputes = [{ kind: "exists", topic: "t", sources: [], toSettle: "" }];
    expect(seedProblems(s, ["barn"]).join()).toContain("in doubt");
    s.places[2].disputes = [{ kind: "count", topic: "t", sources: [], toSettle: "" }];
    expect(seedProblems(s, ["barn"])).toEqual([]);
    expect(placeInDoubt(s.places[2].disputes)).toBe(false);
  });

  it("refuses a standing stage on an unconfirmed place", () => {
    const s = seed();
    s.places[1].confirmed = false;
    expect(seedProblems(s, ["barn"]).join()).toContain("unconfirmed");
  });

  it("refuses two keys that differ only by case", () => {
    const s = seed();
    s.places.push({ ...s.places[2], key: "Hall", onMap: true });
    expect(seedProblems(s, ["barn", "Hall"]).join()).toContain("only by case");
  });
});

describe("the first village's own seed record", () => {
  // brand-ok: the first village's own record, read to prove it holds together
  const file = path.resolve(process.cwd(), "server/seeds/amora/places-seed.json"); // brand-ok: the first village's own record
  const seed = JSON.parse(fs.readFileSync(file, "utf8")) as PlacesSeed;
  // The keys on that village's published map, read from its live scene on 2026-11-08.
  const LIVE = ["gate", "welcome", "market", "pondhomes", "ponds", "greenhouse", "community", "kitchen", "library", "council", "foodforest", "tank", "spring3", "spring2", "spring4", "possiblespring", "ridgeA", "ridgeB", "sanctuary", "guest", "healing", "trailhead", "new-food-forest"];

  it("holds together against its live map", () => {
    expect(seedProblems(seed, LIVE)).toEqual([]);
  });

  it("draws nothing the record calls planned as standing", () => {
    const standing = seed.places.filter((p) => p.stage && ["building", "built", "in_use", "needs_care"].includes(p.stage));
    expect(standing.every((p) => p.confirmed)).toBe(true);
  });

  it("keeps every disputed place unconfirmed", () => {
    for (const p of seed.places) if (placeInDoubt(p.disputes)) expect(p.confirmed).toBe(false);
  });
});
