/**
 * The scene envelope (0063).
 *
 * The load-bearing assertion in this file is the last one: a scene goes in and
 * comes out byte for byte. Everything else here is a guard on the envelope,
 * and the envelope is allowed to be strict precisely because the body is not
 * touched.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SCENE_BYTES,
  SCENE_BLOCKS,
  changeSummary,
  isSupportedSceneVersion,
  sceneProblem,
  sceneSizeProblem,
  sceneSummary,
} from "./mapScene";

/** The smallest thing this module will accept, for tests to build on. */
function scene(over: Record<string, unknown> = {}) {
  return {
    map_scene: { key: "village-grounds", version: "v0.8-roundD" },
    map_structures: [{ key: "gate", name: "Gateway" }],
    ...over,
  };
}

describe("scene versions", () => {
  it("takes the legacy exact version and the checked families", () => {
    expect(isSupportedSceneVersion("v0.6-buildmode")).toBe(true);
    expect(isSupportedSceneVersion("v0.7-roundC1")).toBe(true);
    expect(isSupportedSceneVersion("v0.8-roundD")).toBe(true);
  });

  it("refuses a family nobody has diffed, which is the whole point", () => {
    expect(isSupportedSceneVersion("v0.9-roundE")).toBe(false);
    expect(isSupportedSceneVersion("v1.0")).toBe(false);
  });

  it("refuses junk without throwing", () => {
    for (const v of [undefined, null, "", 7, {}, []]) {
      expect(isSupportedSceneVersion(v)).toBe(false);
    }
  });
});

describe("sceneProblem", () => {
  it("passes a real scene", () => {
    expect(sceneProblem(scene())).toBeNull();
  });

  it("names the likely mistake first: this is not a scene at all", () => {
    expect(sceneProblem(null)).toMatch(/not a scene/i);
    expect(sceneProblem("{}")).toMatch(/not a scene/i);
    expect(sceneProblem([])).toMatch(/not a scene/i);
  });

  it("catches the wrong JSON file before it mentions a version", () => {
    const problem = sceneProblem({ hello: "world" });
    expect(problem).toMatch(/map_scene/);
    expect(problem).not.toMatch(/version/);
  });

  it("refuses a scene with no land to draw", () => {
    expect(sceneProblem({ map_scene: { version: "v0.8-roundD" } })).toMatch(/no `map_structures`/);
  });

  it("refuses an unknown version and says what it knows", () => {
    const problem = sceneProblem(scene({ map_scene: { version: "v0.9-roundE" } }));
    expect(problem).toMatch(/v0\.9-roundE/);
    expect(problem).toMatch(/v0\.7/);
  });

  /* N28 (2026-10-02). The map looks places up by key, so a second "gate" is
     drawn over the first and one place is missing for every visitor. It was
     stored: the check read only the envelope. */
  it("refuses two places with one key, and names the key", () => {
    const twin = scene({
      map_structures: [
        { key: "gate", name: "Gateway" },
        { key: "kitchen", name: "Kitchen" },
        { key: "gate", name: "Gateway (twin)" },
      ],
    });
    expect(sceneProblem(twin)).toBe('Two places in this scene share the key "gate", so one of them would vanish from the map.');
  });

  it("still passes places with distinct keys, and rows with no key at all", () => {
    expect(sceneProblem(scene({ map_structures: [{ key: "gate" }, { key: "kitchen" }, { name: "keyless" }, null] }))).toBeNull();
  });
});

describe("sceneSizeProblem", () => {
  it("passes an honest scene and refuses a runaway one", () => {
    expect(sceneSizeProblem(400 * 1024)).toBeNull();
    expect(sceneSizeProblem(MAX_SCENE_BYTES)).toBeNull();
    expect(sceneSizeProblem(MAX_SCENE_BYTES + 1)).toMatch(/ceiling/);
  });
});

describe("sceneSummary", () => {
  it("counts every block it reports", () => {
    const s = sceneSummary(
      scene({
        map_structures: [1, 2, 3],
        map_zones: [1, 2],
        map_flows: [1],
        quests: [1, 2, 3, 4],
        org_roles: [1, 2],
        map_edits: [1, 2, 3, 4, 5],
      }),
    );
    expect(s).toEqual({
      version: "v0.8-roundD",
      buildings: 3,
      features: 2,
      flows: 1,
      quests: 4,
      seats: 2,
      edits: 5,
    });
  });

  it("survives a scene missing every optional block", () => {
    expect(() => sceneSummary({})).not.toThrow();
    expect(sceneSummary({}).buildings).toBe(0);
    expect(sceneSummary({}).version).toBe("unknown");
  });
});

describe("changeSummary", () => {
  const edits = [
    { seq: 1, action: "place", target: "Bridge", at: "2026-08-10T10:00:00Z" },
    { seq: 2, action: "move", target: "Great Hall", at: "2026-08-10T10:05:00Z" },
    { seq: 3, action: "quest-add", target: "quest:Plant the dry season beds", at: "2026-08-10T10:09:00Z" },
  ];

  it("reads newest first, in plain words", () => {
    const out = changeSummary(scene({ map_edits: edits }));
    expect(out.map((c) => c.text)).toEqual([
      "created a quest Plant the dry season beds",
      "moved Great Hall",
      "placed Bridge",
    ]);
  });

  it("strips the namespace off a target and keeps the name", () => {
    const [first] = changeSummary(scene({ map_edits: [edits[2]] }));
    expect(first.target).toBe("Plant the dry season beds");
  });

  it("shows an unmapped action instead of hiding it", () => {
    // A changelog that omits the change you were unsure about is worse than
    // one with an ugly word in it, so a new verb degrades to its own key.
    const [only] = changeSummary(scene({ map_edits: [{ seq: 9, action: "teleport", target: "Kitchen" }] }));
    expect(only.text).toBe("teleport Kitchen");
  });

  it("caps what it returns without touching the journal in the scene", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ seq: i + 1, action: "move", target: `S${i}` }));
    const s = scene({ map_edits: many });
    expect(changeSummary(s, 10)).toHaveLength(10);
    expect((s as any).map_edits).toHaveLength(50);
  });

  it("survives a scene with no journal", () => {
    expect(changeSummary(scene())).toEqual([]);
    expect(changeSummary(null)).toEqual([]);
  });
});

describe("the body is never rewritten", () => {
  /*
   * The scar this module is built around. `sanitiseMapSkin` dropped
   * `flow_style` and `label_style` by rebuilding its output field by field,
   * and the same rebuild dropped `vocabulary.media` and `vocabulary.phases`.
   * Nothing raised, and a village drew its land in the platform's default
   * words. A scene has twenty blocks and hundreds of nested fields, so the
   * same mistake here would be that bug with twenty times the surface.
   *
   * This asserts the property directly: read every accessor in this module,
   * then check the object is unchanged, INCLUDING a block nobody here has
   * ever heard of.
   */
  it("keeps blocks this module does not know about", () => {
    const original = scene({
      map_edits: [{ seq: 1, action: "move", target: "Great Hall" }],
      a_block_from_a_later_build: { deeply: { nested: ["value", 1, null] } },
      map_scene: { version: "v0.8-roundD", vision_bound: [[1, 2], [3, 4]] },
    });
    const before = JSON.stringify(original);

    expect(sceneProblem(original)).toBeNull();
    sceneSummary(original);
    changeSummary(original);

    expect(JSON.stringify(original)).toBe(before);
    expect((original as any).a_block_from_a_later_build.deeply.nested).toEqual(["value", 1, null]);
  });

  it("SCENE_BLOCKS is a description and never a filter", () => {
    // If this list were used to pick blocks, a scene carrying only an unknown
    // one would fail. It does not, because nothing filters on it.
    expect(SCENE_BLOCKS).toContain("map_structures");
    expect(SCENE_BLOCKS).not.toContain("a_block_from_a_later_build");
    expect(sceneProblem(scene({ a_block_from_a_later_build: {} }))).toBeNull();
  });
});
