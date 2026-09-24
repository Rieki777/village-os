/**
 * Which character suits which power: the ruling, the village's own map, and
 * who a power is put to.
 *
 * The map joins two sets of identifiers that fail silently. A class key or a
 * capability key that stops matching simply resolves to nothing, and a member
 * reads no suggestion with no error anywhere. So the first block pins every key
 * against the sets it has to match, and the ruling itself is written out as a
 * table, so changing a line means coming here and saying why.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, CAPABILITY_LABELS, STAGE_UNLOCKS, type Capability } from "./capabilities";
import { ARCHETYPE_KEYS } from "./archetypes";
import { GAME_CONFIG } from "./gameConfig";
import {
  affinityEditProblem,
  DEFAULT_POWER_AFFINITY,
  isRecommended,
  powersSuitedTo,
  RECOMMENDS_FROM,
  resolvePowerAffinity,
  storedOverrides,
  withAffinityEdit,
} from "./powerAffinity";

const FIVE = ["building", "researching", "facilitating", "catalyzing", "storytelling"];

describe("the platform's suggestion", () => {
  it("is Rye's ruling of 2026-09-09, power by power", () => {
    expect(DEFAULT_POWER_AFFINITY).toEqual({
      "forum.moderate": ["facilitating"], // "The Space Holder for moderating the forum"
      "event.manage": ["facilitating"], // "manage events, = space holding"
      "map.edit": ["researching"], // "draft the map in build mode, = architecting"
      "map.publish": ["researching"], // "The Architect for publishing the Map"
      "library.keep": ["researching"], // "keep the library, = architecting"
      "health.record": ["researching"], // "log the land (health records), = architecting"
      "map.curatePhotos": ["storytelling"], // "Curate photos, = storytelling"
      "feed.announce": ["storytelling"], // "The Story Teller for posting announcements"
      "story.tell": ["storytelling"], // "tell the village's story publicly = storytelling"
      "intake.moderate": ["catalyzing"], // the queue half of "the welcome aboard work"
      // 2026-09-23. Building is making in EVERY form, code included: "like
      // developers for code are building the game, same builder archetype".
      "org.seatAgent": ["building"], // wiring the software agents that do the work
      "dial.set": ["building"], // tuning the machine, within the ring the village left open
    });
  });

  it("names only real powers, each with the words a member reads", () => {
    for (const cap of Object.keys(DEFAULT_POWER_AFFINITY)) {
      expect(ALL_CAPABILITIES, cap).toContain(cap);
      expect(CAPABILITY_LABELS[cap as Capability], cap).toBeTruthy();
    }
  });

  it("names only the platform's own classes, by key", () => {
    // ARCHETYPE_KEYS is the cast the seed writes. A class key here that the
    // seed does not write would match nobody.
    expect([...ARCHETYPE_KEYS].sort()).toEqual([...FIVE].sort());
    for (const classes of Object.values(DEFAULT_POWER_AFFINITY)) {
      for (const k of classes ?? []) expect(ARCHETYPE_KEYS).toContain(k);
    }
  });

  it("suggests only powers the village entrusts, never ones a member climbs to", () => {
    // A power the ladder opens needs nobody to suggest it. If a rung ever moves
    // one of these onto the ladder, this map should hear about it.
    for (const cap of Object.keys(DEFAULT_POWER_AFFINITY)) {
      expect(STAGE_UNLOCKS[cap as Capability], `${cap} opens by climbing`).toBeUndefined();
    }
  });

  it("gives every class something, The Builder included since 2026-09-23", () => {
    // It asserted The Builder had nothing, which was the ruling of 2026-09-09.
    // The correction is that building means making in every form, so the powers
    // that wire and tune the machine are a builder's. In capability order.
    const map = resolvePowerAffinity({}, FIVE);
    expect(powersSuitedTo("building", map)).toEqual(["org.seatAgent", "dial.set"]);
    for (const k of FIVE) {
      expect(powersSuitedTo(k, map).length, k).toBeGreaterThan(0);
    }
  });

  it("starts recommending at a rung the ladder actually has", () => {
    expect(GAME_CONFIG.stages.map((s) => s.id)).toContain(RECOMMENDS_FROM);
  });

  it("is never reached from the gate's imports, so a suggestion can never become a permission", () => {
    // Every relative import, followed file to file: static, re-exported,
    // side-effect and dynamic, with or without an extension. A regex over the
    // gate's own file saw none of the indirect routes.
    const reach = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [path.resolve(process.cwd(), entry)];
      while (stack.length) {
        const file = stack.pop() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        const src = fs.readFileSync(file, "utf8");
        const re = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          const base = path.resolve(path.dirname(file), m[1]);
          const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
          const hit = candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
          if (hit) stack.push(hit);
        }
      }
      return seen;
    };
    const gate = path.resolve(process.cwd(), "shared/capabilities.ts");
    const map = path.resolve(process.cwd(), "shared/powerAffinity.ts");
    // The walker has to be seen following an import, or its empty answer below means nothing.
    expect(reach("shared/powerAffinity.ts").has(gate), "the walk follows the map's own import of the gate").toBe(true);
    expect(reach("shared/capabilities.ts").has(map)).toBe(false);
  });
});

describe("a village's own map", () => {
  it("follows the platform where the village decided nothing", () => {
    expect(resolvePowerAffinity({}, FIVE)["library.keep"]).toEqual(["researching"]);
  });

  it("takes the village's decision over the platform's, power by power", () => {
    const map = resolvePowerAffinity({ "library.keep": ["storytelling", "researching"] }, FIVE);
    expect(map["library.keep"]).toEqual(["storytelling", "researching"]);
    expect(map["map.publish"], "a power it did not touch still follows the platform").toEqual(["researching"]);
  });

  it("reads an empty list as a decision that the power suits no class", () => {
    const map = resolvePowerAffinity({ "story.tell": [] }, FIVE);
    expect(map["story.tell"]).toBeUndefined();
    expect(powersSuitedTo("storytelling", map)).not.toContain("story.tell");
    expect(powersSuitedTo("storytelling", map)).toContain("feed.announce");
  });

  it("resolves a class the village added, and drops one it no longer has", () => {
    const map = resolvePowerAffinity({ "health.record": ["gardening", "researching"] }, [...FIVE, "gardening"]);
    expect(map["health.record"]).toEqual(["gardening", "researching"]);
    expect(resolvePowerAffinity({ "health.record": ["gardening"] }, FIVE)["health.record"]).toBeUndefined();
  });

  it("degrades a hand-edited document to the platform, and never throws", () => {
    for (const doc of [null, undefined, "text", 7, ["library.keep"], { "library.keep": "researching" }]) {
      expect(resolvePowerAffinity(doc, FIVE)["library.keep"], JSON.stringify(doc)).toEqual(["researching"]);
    }
    expect(storedOverrides({ "not.a.power": ["researching"] }), "a key naming no power is dropped").toEqual({});
  });

  it("keeps each class once, trimmed, in the order the village gave", () => {
    const map = resolvePowerAffinity({ "event.manage": [" catalyzing ", "facilitating", "catalyzing", ""] }, FIVE);
    expect(map["event.manage"]).toEqual(["catalyzing", "facilitating"]);
  });

  it("lists a class's powers in the platform's own capability order", () => {
    const mine = powersSuitedTo("researching", resolvePowerAffinity({}, FIVE));
    expect(mine).toEqual(ALL_CAPABILITIES.filter((c) => mine.includes(c)));
    expect([...mine].sort()).toEqual(["health.record", "library.keep", "map.edit", "map.publish"]);
  });
});

describe("an edit", () => {
  it("is refused by name when the power does not exist", () => {
    expect(affinityEditProblem("library.burn", ["researching"], FIVE)).toContain("library.burn");
  });

  it("is refused by name when a class is not one the village has", () => {
    expect(affinityEditProblem("library.keep", ["researching", "gardening"], FIVE)).toContain("gardening");
  });

  it("is refused when the classes are not a list", () => {
    expect(affinityEditProblem("library.keep", "researching", FIVE)).toBeTruthy();
  });

  it("accepts an empty list, and null to follow the platform again", () => {
    expect(affinityEditProblem("library.keep", [], FIVE)).toBeNull();
    expect(affinityEditProblem("library.keep", null, FIVE)).toBeNull();
  });

  it("keeps a decision that matches today's suggestion, so a later suggestion cannot move it", () => {
    expect(withAffinityEdit({}, "library.keep", ["researching"])).toEqual({ "library.keep": ["researching"] });
  });

  it("forgets the decision on null, and leaves every other decision alone", () => {
    const doc = withAffinityEdit({ "library.keep": [], "story.tell": ["catalyzing"] }, "library.keep", null);
    expect(doc).toEqual({ "story.tell": ["catalyzing"] });
    expect(resolvePowerAffinity(doc, FIVE)["library.keep"]).toEqual(["researching"]);
  });
});

describe("who a power is put to", () => {
  const entrusted = { held: false, opens: { via: "appointment" } };

  it("is a member at the rung who plays a class it suits", () => {
    expect(isRecommended(entrusted, ["researching"], ["building", "researching"], true)).toBe(true);
  });

  it("is nobody below the rung, however well the class fits", () => {
    expect(isRecommended(entrusted, ["researching"], ["researching"], false)).toBe(false);
  });

  it("is nobody who plays no class it suits", () => {
    expect(isRecommended(entrusted, ["researching"], ["storytelling"], true)).toBe(false);
    expect(isRecommended(entrusted, ["researching"], [], true)).toBe(false);
  });

  it("is nobody who already holds it", () => {
    expect(isRecommended({ ...entrusted, held: true }, ["researching"], ["researching"], true)).toBe(false);
  });

  it("is nobody when climbing opens it anyway", () => {
    expect(isRecommended({ held: false, opens: { via: "stage" } }, ["researching"], ["researching"], true)).toBe(false);
  });
});
