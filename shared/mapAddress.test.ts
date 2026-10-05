/**
 * The address plane's one rule: a creator is never overwritten by a guess.
 *
 * These tests are the enforcement. The rule is easy to state and easy to lose
 * in a resolver written six months from now, so the predicate it has to call
 * is pinned here rather than left as a comment in a migration.
 */
import { describe, expect, it } from "vitest";
import {
  ADDRESS_SOURCES,
  ADDRESS_SOURCE_MAX,
  DEFAULT_MAP_VOCABULARY,
  isAddressSource,
  isCreatorAuthored,
  mayOverwriteAddress,
  normaliseAddressSource,
  sanitiseMapVocabulary,
  sanitiseWalk,
  unknownWireSources,
  WIRE_ADDRESS_SOURCES,
} from "./mapAddress";

describe("the vocabulary", () => {
  it("is exactly the three values the plane recognises", () => {
    expect([...ADDRESS_SOURCES]).toEqual(["creator", "resolver-guess", "creator-board"]);
    for (const v of ADDRESS_SOURCES) expect(isAddressSource(v)).toBe(true);
    expect(isAddressSource("pool")).toBe(false);
    expect(isAddressSource("")).toBe(false);
    expect(isAddressSource(null)).toBe(false);
  });

  it("stores three values and accepts four off the wire", () => {
    // `pool` is legal to RECEIVE and never legal to STORE. That asymmetry is
    // the whole mapping, so it is pinned rather than left to a comment.
    expect([...WIRE_ADDRESS_SOURCES]).toEqual(["creator", "resolver-guess", "creator-board", "pool"]);
    expect(isAddressSource("pool")).toBe(false);
  });

  it("fits the column the migration declares", () => {
    // varchar(24) in 0060. A value longer than the column would be truncated
    // on write and then fail every check that reads it back.
    for (const v of ADDRESS_SOURCES) expect(v.length).toBeLessThanOrEqual(ADDRESS_SOURCE_MAX);
  });
});

describe("normaliseAddressSource", () => {
  it("passes through what it recognises", () => {
    expect(normaliseAddressSource("creator")).toBe("creator");
    expect(normaliseAddressSource("creator-board")).toBe("creator-board");
    expect(normaliseAddressSource("resolver-guess")).toBe("resolver-guess");
  });

  it("reads the artifact's 'pool' as silence, NOT as a board decision", () => {
    /*
     * The scene writes `pool` as its derived default when no structure was
     * set. Mapping it to creator-board would invent a decision nobody made,
     * and would then make that invented decision immovable by a resolver.
     */
    expect(normaliseAddressSource("pool")).toBeNull();
    expect(mayOverwriteAddress(normaliseAddressSource("pool"), "resolver-guess")).toBe(true);
  });

  it("carries the legacy 'lexicon guess' through as a guess", () => {
    /*
     * The map normalises this at its export boundary now, so fresh scenes
     * never carry it. A scene file exported before that fix still does, and
     * dropping it to NULL would discard a real guess, which then lets the next
     * resolver overwrite something it should only have refined.
     */
    expect(normaliseAddressSource("lexicon guess")).toBe("resolver-guess");
    expect(mayOverwriteAddress(normaliseAddressSource("lexicon guess"), "creator")).toBe(true);
  });

  it("drops anything it does not recognise rather than storing it raw", () => {
    expect(normaliseAddressSource("vibes")).toBeNull();
    expect(normaliseAddressSource(42)).toBeNull();
    expect(normaliseAddressSource(undefined)).toBeNull();
  });
});

describe("unknownWireSources: the declared contract", () => {
  it("agrees with the vocabulary the artifact publishes", () => {
    // Verbatim from map_scene.address_source_vocabulary in grounds-v0.html.
    const declared = { values: ["creator", "resolver-guess", "creator-board", "pool"] };
    expect(unknownWireSources(declared)).toEqual([]);
  });

  it("names a value the scene declares and this importer cannot handle", () => {
    expect(unknownWireSources({ values: ["creator", "oracle-hunch"] })).toEqual(["oracle-hunch"]);
  });

  it("treats a scene with no declared vocabulary as agreement, not conflict", () => {
    // Anything exported before the contract was published. Absence is not
    // disagreement, and the importer falls back to the mapping it has.
    expect(unknownWireSources(undefined)).toEqual([]);
    expect(unknownWireSources({})).toEqual([]);
    expect(unknownWireSources({ values: "creator" })).toEqual([]);
  });

  it("accepts the legacy alias as known, since it is handled", () => {
    expect(unknownWireSources({ values: ["lexicon guess"] })).toEqual([]);
  });
});

describe("isCreatorAuthored", () => {
  it("counts both creator spellings", () => {
    expect(isCreatorAuthored("creator")).toBe(true);
    // A person choosing the Board is still a person choosing.
    expect(isCreatorAuthored("creator-board")).toBe(true);
    expect(isCreatorAuthored("resolver-guess")).toBe(false);
    expect(isCreatorAuthored(null)).toBe(false);
  });
});

describe("mayOverwriteAddress: the doctrine", () => {
  it("refuses to move anything a person placed", () => {
    expect(mayOverwriteAddress("creator", "resolver-guess")).toBe(false);
    expect(mayOverwriteAddress("creator", "creator")).toBe(false);
    // Even an incoming creator claim does not overwrite automatically: a
    // person changes it through the surface that owns it, not by re-import.
    expect(mayOverwriteAddress("creator-board", "creator")).toBe(false);
    expect(mayOverwriteAddress("creator-board", "resolver-guess")).toBe(false);
  });

  it("fills silence and replaces a stale guess", () => {
    expect(mayOverwriteAddress(null, "creator")).toBe(true);
    expect(mayOverwriteAddress(null, "resolver-guess")).toBe(true);
    expect(mayOverwriteAddress("resolver-guess", "creator")).toBe(true);
    expect(mayOverwriteAddress("resolver-guess", "resolver-guess")).toBe(true);
  });

  it("treats an unrecognised stored value as replaceable, not as authority", () => {
    // A junk value must not become immovable simply by being unreadable.
    expect(mayOverwriteAddress("pool", "creator")).toBe(true);
    expect(mayOverwriteAddress("nonsense", "creator")).toBe(true);
  });

  it("refuses an incoming value it does not recognise", () => {
    expect(mayOverwriteAddress(null, "pool")).toBe(false);
    expect(mayOverwriteAddress("resolver-guess", "vibes")).toBe(false);
  });
});

describe("sanitiseWalk", () => {
  const step = (over: Record<string, unknown> = {}) => ({
    id: "s1", structure_key: "greenhouse", title: "The greenhouse",
    body: "Where seedlings start.", gesture: "tap", ...over,
  });

  it("keeps a well-formed walk, per language", () => {
    const w = sanitiseWalk({ en: [step()], es: [step({ title: "El invernadero" })] });
    expect(Object.keys(w).sort()).toEqual(["en", "es"]);
    expect(w.en[0].title).toBe("The greenhouse");
    expect(w.en[0].gesture).toBe("tap");
  });

  it("drops a step with no title, because a step with nothing to say is not a step", () => {
    const w = sanitiseWalk({ en: [step(), step({ title: "   " }), step({ title: "Third" })] });
    expect(w.en).toHaveLength(2);
    expect(w.en[1].title).toBe("Third");
  });

  it("keeps array order as the walk order", () => {
    const w = sanitiseWalk({ en: [step({ title: "A" }), step({ title: "B" }), step({ title: "C" })] });
    expect(w.en.map((s) => s.title)).toEqual(["A", "B", "C"]);
  });

  it("falls back to a no-op gesture rather than storing one the map cannot gate on", () => {
    expect(sanitiseWalk({ en: [step({ gesture: "somersault" })] }).en[0].gesture).toBe("none");
    expect(sanitiseWalk({ en: [step({ gesture: "pinch" })] }).en[0].gesture).toBe("pinch");
  });

  it("gives every step an id, so walk.log can be joined back to a step", () => {
    const w = sanitiseWalk({ en: [step({ id: undefined }), step({ id: "" })] });
    expect(w.en.every((s) => !!s.id)).toBe(true);
    expect(new Set(w.en.map((s) => s.id)).size).toBe(2);
  });

  it("omits an empty language instead of storing a walk with no steps", () => {
    /*
     * An absent or empty walk means the village has written none, and the
     * map offers no walk at all (Rye, 2026-10-02). It never means the
     * artifact's seed. Storing an empty language would read as a walk that
     * exists and has nothing in it.
     */
    expect(sanitiseWalk({ en: [] })).toEqual({});
    expect(sanitiseWalk({ en: [step({ title: "" })] })).toEqual({});
  });

  it("ignores junk languages and junk input", () => {
    expect(sanitiseWalk({ "not-a-lang!": [step()] })).toEqual({});
    expect(sanitiseWalk({ en: "nope" })).toEqual({});
    expect(sanitiseWalk(undefined)).toEqual({});
  });

  it("caps a step's prose and the number of steps", () => {
    expect(sanitiseWalk({ en: [step({ body: "x".repeat(900) })] }).en[0].body).toHaveLength(600);
    const many = Array.from({ length: 90 }, (_, i) => step({ title: `Step ${i}` }));
    expect(sanitiseWalk({ en: many }).en).toHaveLength(40);
  });

  it("drops a blank gate hint instead of storing an empty nudge", () => {
    expect(sanitiseWalk({ en: [step({ gate_hint: "  " })] }).en[0]).not.toHaveProperty("gate_hint");
    expect(sanitiseWalk({ en: [step({ gate_hint: " drag the land " })] }).en[0].gate_hint).toBe("drag the land");
  });
});

describe("sanitiseMapVocabulary", () => {
  it("returns empty lists for junk", () => {
    expect(sanitiseMapVocabulary(undefined)).toEqual(DEFAULT_MAP_VOCABULARY);
    expect(sanitiseMapVocabulary("lane")).toEqual(DEFAULT_MAP_VOCABULARY);
    expect(sanitiseMapVocabulary({ road: "lane" })).toEqual(DEFAULT_MAP_VOCABULARY);
  });

  it("trims, drops blanks, and dedupes", () => {
    expect(sanitiseMapVocabulary({ road: ["  lane ", "lane", "", "  ", "track"] }).road)
      .toEqual(["lane", "track"]);
  });

  it("keeps the named sections and ignores anything else", () => {
    const v = sanitiseMapVocabulary({ road: ["lane"], water: ["swale"], zone: ["grove"], sky: ["x"] });
    expect(v).toEqual({ road: ["lane"], water: ["swale"], zone: ["grove"], media: [], phases: {} });
  });

  it("caps a word and a list rather than storing an essay", () => {
    expect(sanitiseMapVocabulary({ road: ["x".repeat(200)] }).road[0]).toHaveLength(48);
    const many = Array.from({ length: 200 }, (_, i) => `road-${i}`);
    expect(sanitiseMapVocabulary({ road: many }).road).toHaveLength(60);
  });

  /*
   * The v0.8 export carries media and phases. They were dropped on the way
   * through for one artifact version, because the sanitiser rebuilds the
   * object field by field and nobody added the lines. These pin the shape
   * against the real export so the same silence cannot happen twice.
   */
  it("carries a medium whole, colour and glyph included", () => {
    const v = sanitiseMapVocabulary({
      media: [{ key: "water", name: "acequia", color: "#7cc4d8", glyph: "droplet" }],
    });
    expect(v.media).toEqual([{ key: "water", name: "acequia", color: "#7cc4d8", glyph: "droplet" }]);
  });

  it("drops a medium rather than drawing it in a colour nobody chose", () => {
    const bad = [
      { key: "water", name: "water", color: "red", glyph: "droplet" },
      { key: "water", name: "water", color: "javascript:x", glyph: "droplet" },
      { key: "a b", name: "spaced key", color: "#ffffff", glyph: "droplet" },
      { key: "energy", name: "energy", color: "#ffdf8a", glyph: "url(#x)" },
      { key: "money", name: "", color: "#e3c15c", glyph: "coin" },
    ];
    expect(sanitiseMapVocabulary({ media: bad }).media).toEqual([]);
  });

  it("keeps one medium per key and caps the list", () => {
    const dupes = [
      { key: "water", name: "first", color: "#111111", glyph: "droplet" },
      { key: "water", name: "second", color: "#222222", glyph: "droplet" },
    ];
    expect(sanitiseMapVocabulary({ media: dupes }).media).toEqual([
      { key: "water", name: "first", color: "#111111", glyph: "droplet" },
    ]);
    const many = Array.from({ length: 50 }, (_, i) => ({
      key: `m${i}`, name: `m${i}`, color: "#123456", glyph: "droplet",
    }));
    expect(sanitiseMapVocabulary({ media: many }).media).toHaveLength(24);
  });

  it("keeps phases keyed by the number the scene stores", () => {
    const v = sanitiseMapVocabulary({ phases: { 1: "Built", 2: " Building ", 3: "Planned" } });
    expect(v.phases).toEqual({ "1": "Built", "2": "Building", "3": "Planned" });
  });

  it("drops a phase key that names nothing the map can draw", () => {
    const v = sanitiseMapVocabulary({ phases: { 1: "Built", soon: "Someday", 2: "" } });
    expect(v.phases).toEqual({ "1": "Built" });
    expect(sanitiseMapVocabulary({ phases: ["Built"] }).phases).toEqual({});
  });
});
