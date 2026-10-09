/**
 * The two decisions the config push makes about the land, and the slate's one
 * rule, without a frame.
 *
 * The rule both share: only what the server actually SAID decides anything.
 * A missing field, a failed read or a string where a number belongs is never
 * read as "nothing published", because that would hide a real village's map.
 */
import { describe, expect, it } from "vitest";
import { configScene, seedGroundOf } from "./configPush";
import { slateFrom } from "./MapSlate";

describe("the scene a config push carries", () => {
  it("parses a published scene once and keeps its version", () => {
    const told = configScene({ scene: '{"map_structures":[{"key":"a"}]}', sceneVersion: 6 }, false);
    expect(told).toEqual({ scene: { map_structures: [{ key: "a" }] }, sceneVersion: 6, blank: false });
  });

  it("sends nothing for a published scene that will not parse, so the map keeps its land", () => {
    expect(configScene({ scene: "{broken", sceneVersion: 6 }, false)).toBeNull();
  });

  it("sends the blank land when the server says nothing is published", () => {
    const told = configScene({ scene: null, sceneVersion: 0 }, false)!;
    expect(told.blank).toBe(true);
    expect(told.sceneVersion).toBe(0);
    expect((told.scene as any).map_structures).toEqual([]);
  });

  it("sends the blank once per frame", () => {
    expect(configScene({ scene: null, sceneVersion: 0 }, true)).toBeNull();
  });

  it("reads silence as silence: no version, or a failed answer, sends no scene", () => {
    expect(configScene({ scene: null }, false)).toBeNull();
    expect(configScene(null, false)).toBeNull();
    expect(configScene({ scene: null, sceneVersion: "0" }, false)).toBeNull();
  });
});

describe("where the village stands", () => {
  it("passes the server's verdict through, either way", () => {
    expect(seedGroundOf({ seedFrame: true })).toBe(true);
    expect(seedGroundOf({ seedFrame: false })).toBe(false);
  });

  it("says nothing when the land could not be read", () => {
    expect(seedGroundOf(null)).toBeNull();
    expect(seedGroundOf({})).toBeNull();
    expect(seedGroundOf({ seedFrame: "false" })).toBeNull();
  });
});

describe("the slate", () => {
  it("is blank only on a liveVersion of exactly 0", () => {
    expect(slateFrom(true, { liveVersion: 0, canEdit: false, canPublish: false, draft: null })).toEqual({
      state: "blank", canEdit: false, canPublish: false, draft: null,
    });
    expect(slateFrom(true, { liveVersion: 3 })).toEqual({ state: "published" });
  });

  it("decides nothing on a failed read or an answer without the number", () => {
    expect(slateFrom(false, { liveVersion: 0 })).toEqual({ state: "unknown" });
    expect(slateFrom(true, {})).toEqual({ state: "unknown" });
    expect(slateFrom(true, { liveVersion: "0" })).toEqual({ state: "unknown" });
    expect(slateFrom(true, null)).toEqual({ state: "unknown" });
  });

  it("counts a waiting draft from its own lines, and treats one that will not parse as none", () => {
    const scene = { map_structures: [{}, {}, {}], map_zones: [{}], map_flows: [], map_edits: [{}, {}] };
    expect(slateFrom(true, { liveVersion: 0, canEdit: true, canPublish: true, draft: { scene: JSON.stringify(scene) } })).toMatchObject({
      draft: { buildings: 3, features: 1, flows: 0, changes: 2 },
    });
    expect(slateFrom(true, { liveVersion: 0, canEdit: true, draft: { scene: "{nope" } })).toMatchObject({ draft: null });
  });
});
