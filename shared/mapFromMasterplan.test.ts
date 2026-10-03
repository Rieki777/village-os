/**
 * The blank slate, the masterplan record, and the gate a drafted scene passes.
 *
 * The draft cases are each one rule broken on an otherwise good scene, so a
 * case that passes for the wrong reason (a second rule tripping) shows up as
 * an extra line in its own assertion. `good()` is asserted clean first, which
 * is the positive control every refusal below leans on.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRAFT_SCENE_VERSION,
  MAP_ARCHETYPES,
  RECORD_BLOCKS,
  SCENE_WORLD,
  blankScene,
  draftSceneProblems,
  readMasterplan,
} from "./mapFromMasterplan";
import { SCENE_BLOCKS, isSupportedSceneVersion, sceneProblem } from "./mapScene";

const ARTIFACT = fs.readFileSync(path.resolve(__dirname, "../docs/prototypes/grounds-v0.html"), "utf8");

/** A scene a careful generator would send: two buildings, a road, a flow. */
function good(): Record<string, any> {
  return {
    map_scene: { key: "village-grounds", name: "Test village", status: "draft", version: DRAFT_SCENE_VERSION },
    map_structures: [
      {
        key: "hall", name: "Common House", archetype: "bighall", anchor: { x: 1200, y: 800 }, phase: 1,
        circle_id: null, blurb: "", origin_story: "", state_inputs: { fund: null, activity: "steady", event: null },
        bindings: { doors: [{ label: "Gatherings", route: "/events" }] },
      },
      {
        key: "tank", name: "Cistern", archetype: "tank", anchor: { x: 1000, y: 700 }, phase: 2,
        state_inputs: { fund: null, event: null },
      },
    ],
    map_zones: [
      { id: "f1", kind: "road", geom: "line", path: [[900, 600], [1200, 800]], phase: 1, owner_structure_key: null },
      { id: "f2", kind: "zone", geom: "area", polygon: [[1100, 700], [1300, 700], [1300, 900]], phase: 1, owner_structure_key: "hall" },
      { kind: "forest", geom: "area", polygon: "default ground", phase: 1 },
    ],
    map_flows: [{ id: 1, from_key: "tank", to_key: "hall", medium: "water", note: "", phase: 1 }],
    map_edits: [
      { seq: 1, actor: "agent", action: "place", target: "structure:hall", diff: {}, at: "2026-10-02T10:00:00.000Z" },
      { seq: 2, actor: "agent", action: "place", target: "structure:tank", diff: {}, at: "2026-10-02T10:00:01.000Z" },
    ],
    boundary: { scene_units: [[400, 300], [2000, 300], [2000, 1300], [400, 1300]] },
    org_roles: [],
    quests: [],
  };
}

describe("the blank slate", () => {
  it("is a scene this deployment stores, at a version it knows", () => {
    expect(isSupportedSceneVersion(DRAFT_SCENE_VERSION)).toBe(true);
    expect(sceneProblem(blankScene())).toBeNull();
  });

  it("names every block the map would otherwise keep from the seed, each one empty", () => {
    const b = blankScene() as Record<string, any>;
    // restoreScene keeps whatever block it is NOT handed, so absent means seed.
    for (const block of ["map_structures", "map_zones", "map_flows", "map_edits", "org_roles", "quests", "journeys", "forum_threads"]) {
      expect(b[block], block).toEqual([]);
    }
    expect(b.vital_overrides).toEqual({});
  });

  it("draws its property line on the frame's own edge, so the board can be built on", () => {
    const { w, h } = SCENE_WORLD;
    expect((blankScene() as any).boundary.scene_units).toEqual([[0, 0], [w, 0], [w, h], [0, h]]);
  });

  it("is a fresh object each time, so a caller cannot edit the next one", () => {
    const a = blankScene() as any;
    a.map_structures.push({ key: "x" });
    expect((blankScene() as any).map_structures).toEqual([]);
  });
});

describe("the copies of the artifact's own facts", () => {
  it("SCENE_WORLD is the artifact's W and H", () => {
    const m = /const W=(\d+), H=(\d+);/.exec(ARTIFACT);
    expect(m, "the artifact still declares its world size on one line").toBeTruthy();
    expect({ w: Number(m![1]), h: Number(m![2]) }).toEqual(SCENE_WORLD);
  });

  it("MAP_ARCHETYPES is exactly the keys of the artifact's REG", () => {
    const start = ARTIFACT.indexOf("const REG=[");
    const end = ARTIFACT.indexOf("window.ARCHMAP={}", start);
    expect(start, "the artifact still has its registry").toBeGreaterThan(0);
    const keys = [...ARTIFACT.slice(start, end).matchAll(/\['([a-z]+)','[^']*','[^']*','[a-z]+'\]/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(50);
    expect([...MAP_ARCHETYPES]).toEqual(keys);
  });

  it("RECORD_BLOCKS are all blocks a scene is known to carry", () => {
    for (const b of RECORD_BLOCKS) expect(SCENE_BLOCKS, b).toContain(b);
  });
});

describe("a drafted scene", () => {
  it("passes when it is sound (the positive control)", () => {
    expect(draftSceneProblems(good())).toEqual([]);
  });

  it("reports the envelope first, and only the envelope, when it is not a scene", () => {
    expect(draftSceneProblems([])).toEqual(["That is not a scene: expected a JSON object."]);
    const s = good();
    s.map_scene.version = "v9.9-future";
    expect(draftSceneProblems(s)).toHaveLength(1);
    expect(draftSceneProblems(s)[0]).toMatch(/is not one this village knows/);
  });

  /* The publish check refuses a repeated key on its own (N28, sceneProblem).
     A draft lists it with the rows instead, beside every other fault, so an
     agent that got two things wrong hears about both in one answer. */
  it("lists a repeated key beside the other faults, where the publish check would name only the key", () => {
    const s = good();
    s.map_structures[1].key = "hall";
    s.map_structures[0].phase = 4;
    const problems = draftSceneProblems(s);
    expect(problems.some((p) => /"hall" is used twice/.test(p)), problems.join("\n")).toBe(true);
    expect(problems.some((p) => /phase must be 1, 2 or 3/.test(p)), problems.join("\n")).toBe(true);
    expect(sceneProblem(s), "the publish check still refuses it").toMatch(/share the key "hall"/);
  });

  const broken: [string, (s: Record<string, any>) => void, RegExp][] = [
    ["a building with no anchor", (s) => delete s.map_structures[0].anchor, /map_structures\[0\]\.anchor must be/],
    ["an anchor in metres or degrees", (s) => (s.map_structures[0].anchor = { x: -83.83, y: 9.23 }), /outside the world/],
    ["a building outside its own property line", (s) => (s.map_structures[1].anchor = { x: 200, y: 200 }), /"tank" stands outside the property line/],
    ["a kind the map cannot draw", (s) => (s.map_structures[0].archetype = "castle"), /archetype "castle" is not a kind the map draws/],
    ["two buildings with one key", (s) => (s.map_structures[1].key = "hall"), /"hall" is used twice/],
    ["a key with spaces in it", (s) => (s.map_structures[0].key = "the hall"), /key must be a short id/],
    ["a phase outside 1 to 3", (s) => (s.map_structures[0].phase = 4), /phase must be 1, 2 or 3/],
    ["an invented origin story", (s) => (s.map_structures[0].origin_story = "Raised by everyone in nine days."), /origin_story must be empty/],
    ["an invented funding level", (s) => (s.map_structures[0].state_inputs.fund = 0.4), /fund must be null/],
    ["an invented gathering", (s) => (s.map_structures[0].state_inputs.event = "Feast tonight"), /event must be null/],
    ["a door to another site", (s) => (s.map_structures[0].bindings.doors = [{ label: "x", route: "//evil.example" }]), /routes on this site/],
    ["a road of one point", (s) => (s.map_zones[0].path = [[900, 600]]), /a path of two or more/],
    ["a feature owned by no building", (s) => (s.map_zones[1].owner_structure_key = "barn"), /"barn" names no building/],
    ["a flow to nowhere", (s) => (s.map_flows[0].to_key = "barn"), /to_key must name a building/],
    ["an empty journal", (s) => (s.map_edits = []), /map_edits is empty/],
    ["two journal lines with one number", (s) => (s.map_edits[1].seq = 1), /seq 1 is used twice/],
    ["a journal line with no time", (s) => (s.map_edits[0].at = "yesterday"), /at must be an ISO date/],
    ["no property line", (s) => delete s.boundary, /boundary\.scene_units must be the property line/],
    ["an invented quest", (s) => (s.quests = [{ title: "Plant the beds" }]), /quests must be empty/],
    ["an invented seat", (s) => (s.org_roles = [{ role: "Water Steward" }]), /org_roles must be empty/],
    ["invented vitals", (s) => (s.vital_overrides = { people: 24 }), /vital_overrides must be empty/],
    ["an embedded picture", (s) => (s.map_scene.art = "data:image/png;base64,iVBORw0KGgo="), /embedded file/],
    ["nothing at all to draw", (s) => { s.map_structures = []; s.map_zones = []; s.map_flows = []; }, /draws nothing/],
  ];

  for (const [what, breakIt, says] of broken) {
    it(`refuses ${what}, and says which rule`, () => {
      const s = good();
      breakIt(s);
      const problems = draftSceneProblems(s);
      expect(problems.some((p) => says.test(p)), problems.join("\n")).toBe(true);
    });
  }

  it("reads the text it was sent for the embedded-file check, when it has it", () => {
    const s = good();
    expect(draftSceneProblems(s, JSON.stringify(s) + ' "data:application/pdf;base64,JVBER"')).toEqual([
      expect.stringMatching(/embedded file/),
    ]);
  });

  it("lists at most twenty problems however many rows are wrong", () => {
    const s = good();
    s.map_structures = Array.from({ length: 60 }, (_, i) => ({ key: `b${i}`, name: "", archetype: "castle", anchor: { x: 1200, y: 800 }, phase: 1 }));
    expect(draftSceneProblems(s)).toHaveLength(20);
  });
});

describe("the masterplan record, read back", () => {
  const rec = {
    url: "/api/uploads/masterplan-1790000000000-abcde.pdf",
    filename: "masterplan-1790000000000-abcde.pdf",
    originalName: "Plan V7.pdf",
    kind: "pdf",
    mimeType: "application/pdf",
    bytes: 1234,
    width: null,
    height: null,
    uploadedBy: "u1",
    uploadedAt: "2026-10-02T10:00:00.000Z",
  };

  it("keeps a sound record as it was written", () => {
    expect(readMasterplan(rec)).toEqual(rec);
  });

  it("reads anything pointing outside the uploads volume as no masterplan at all", () => {
    expect(readMasterplan({ ...rec, url: "https://elsewhere.example/plan.pdf" })).toBeNull();
    expect(readMasterplan({ ...rec, url: "/api/uploads/../secrets" })).toBeNull();
    expect(readMasterplan({ ...rec, kind: "html" })).toBeNull();
    expect(readMasterplan(null)).toBeNull();
    expect(readMasterplan([])).toBeNull();
  });
});
