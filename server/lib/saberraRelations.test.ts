/**
 * Reading a field that points at another record, in every shape a
 * Notion-backed store plausibly sends it.
 *
 * The live sync of 2026-10-09 lost the circle of all 56 seats because the
 * translator read only a string, and every fixture sent one. These fixtures are
 * the other shapes: lists of page ids (with and without dashes), lists of
 * `{ id }` and `{ id, name }` objects, a single object, Notion's own
 * `{ type: "relation", relation: [...] }` property, and a plain string, which
 * must keep working.
 */
import { describe, expect, it } from "vitest";
import { labelOf, looksLikeAnId, normaliseId, plainText, resolveRelation, shapeOf } from "./saberraRelations";

const LAND = "3ed0a88e-f36a-8104-80fa-cd2bfe15c001";
const MONEY = "3ed0a88e-f36a-8104-80fa-cd2bfe15c002";
const byId = new Map([
  [normaliseId(LAND), "Land & Ecology"],
  [normaliseId(MONEY), "Economics & Finance"],
]);

describe("a relation, in every shape it plausibly arrives", () => {
  it("resolves a list of page ids against the read", () => {
    expect(resolveRelation([LAND], byId)).toEqual({ names: ["Land & Ecology"], unresolved: 0, present: true });
  });

  it("resolves an id written without its dashes, and in capitals", () => {
    expect(resolveRelation([normaliseId(LAND).toUpperCase()], byId).names).toEqual(["Land & Ecology"]);
  });

  it("resolves a list of { id } objects, and prefers the read's name over the object's", () => {
    expect(resolveRelation([{ id: LAND }], byId).names).toEqual(["Land & Ecology"]);
    expect(resolveRelation([{ id: LAND, name: "Old name" }], byId).names).toEqual(["Land & Ecology"]);
  });

  it("takes an object's own name when its id is not in the read", () => {
    expect(resolveRelation([{ id: "3ed0a88ef36a810480facd2bfe15c999", name: "Hearth" }], byId).names).toEqual(["Hearth"]);
    expect(resolveRelation({ title: "Hearth" }, byId).names).toEqual(["Hearth"]);
  });

  it("reads Notion's own relation property shape", () => {
    expect(resolveRelation({ type: "relation", relation: [{ id: MONEY }] }, byId).names).toEqual(["Economics & Finance"]);
  });

  it("keeps every circle a relation names, in order, once each", () => {
    expect(resolveRelation([LAND, MONEY, LAND], byId).names).toEqual(["Land & Ecology", "Economics & Finance"]);
  });

  it("NEVER TURNS AN UNRESOLVED ID INTO A NAME, which would invent a circle", () => {
    const r = resolveRelation(["3ed0a88e-f36a-8104-80fa-cd2bfe15c999", { id: "nope-not-here-0000" }], byId);
    expect(r.names).toEqual([]);
    // The id-shaped string is unresolved; the object with a non-id id and no
    // name is unresolved too.
    expect(r.unresolved).toBe(2);
    expect(r.present).toBe(true);
  });

  it("still reads a plain name, the shape the old fixtures sent", () => {
    expect(resolveRelation("Land & Ecology", byId)).toEqual({ names: ["Land & Ecology"], unresolved: 0, present: true });
  });

  it("says a field that is absent or empty carried nothing", () => {
    expect(resolveRelation(undefined, byId).present).toBe(false);
    expect(resolveRelation([], byId).present).toBe(false);
    expect(resolveRelation("  ", byId).present).toBe(false);
  });
});

describe("the other readers", () => {
  it("knows a page id when it sees one", () => {
    expect(looksLikeAnId(LAND)).toBe(true);
    expect(looksLikeAnId(normaliseId(LAND))).toBe(true);
    expect(looksLikeAnId("Land & Ecology")).toBe(false);
  });

  it("reads prose from a string or a rich-text list, and nothing else", () => {
    expect(plainText("  Holds the water.  ")).toBe("Holds the water.");
    expect(plainText([{ plain_text: "Holds " }, { text: { content: "the water." } }])).toBe("Holds the water.");
    expect(plainText({ rich_text: [{ plain_text: "Holds the water." }] })).toBe("Holds the water.");
    expect(plainText(42)).toBeNull();
    expect(plainText({ start: "2026-10-01" })).toBeNull();
  });

  it("reads a status from a string or a select", () => {
    expect(labelOf("Archived")).toBe("Archived");
    expect(labelOf({ name: "Vacant", color: "gray" })).toBe("Vacant");
    expect(labelOf(null)).toBeNull();
  });

  it("DESCRIBES A SHAPE AND NEVER A VALUE, so it is safe to show", () => {
    expect(shapeOf(undefined)).toBe("absent");
    expect(shapeOf("Land & Ecology")).toBe("text");
    expect(shapeOf([LAND, MONEY])).toBe("list of 2 id");
    expect(shapeOf([{ id: LAND, name: "Land & Ecology" }])).toBe("list of 1 object (id, name)");
    expect(shapeOf([{ id: LAND, name: "Land & Ecology" }])).not.toContain("Land");
  });
});
