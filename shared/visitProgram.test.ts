/**
 * The visit program's own check (shared/visitProgram.ts), asked by Admin,
 * Pages, Visit and by `PUT /api/admin/visit-config` alike.
 */
import { describe, expect, it } from "vitest";
import siteSeed from "../server/seeds/site-content-seed.json";
import {
  MAX_VISIT_TYPES,
  VISIT_TYPE_FIELDS,
  newVisitTypeId,
  normalizeVisitProgram,
  renumberVisitTypes,
  visitProgramProblems,
} from "./visitProgram";

const card = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Card ${id}`,
  duration: "",
  format: "",
  cost: "",
  description: "",
  cta_label: "",
  cta_url: "",
  order: 1,
  ...over,
});

describe("what the visit program accepts", () => {
  it("accepts the program a new village starts with", () => {
    expect(visitProgramProblems(siteSeed.visitConfig)).toEqual([]);
  });

  it("accepts a program with no ways to visit at all", () => {
    expect(visitProgramProblems({ hero_subtitle: "", visit_types: [], logistics: {} })).toEqual([]);
  });

  it("holds each box to its limit, and says which box", () => {
    const max = VISIT_TYPE_FIELDS.find((f) => f.key === "description")!.max;
    const problems = visitProgramProblems({ visit_types: [card("a", { description: "x".repeat(max + 1) })] });
    expect(problems).toEqual([`Way to visit 1: What happens holds ${max} characters at most (it has ${max + 1}).`]);
  });

  it("counts an accented letter once", () => {
    const max = VISIT_TYPE_FIELDS.find((f) => f.key === "title")!.max;
    expect(visitProgramProblems({ visit_types: [card("a", { title: "é".repeat(max) })] })).toEqual([]);
  });

  it(`refuses more than ${MAX_VISIT_TYPES} ways to visit, a nameless card, and two cards with one id`, () => {
    const many = Array.from({ length: MAX_VISIT_TYPES + 1 }, (_, i) => card(`c${i}`));
    expect(visitProgramProblems({ visit_types: many }).length).toBeGreaterThan(0);
    expect(visitProgramProblems({ visit_types: [card("a", { title: "  " })] })).toEqual(["Way to visit 1: Name cannot be blank."]);
    expect(visitProgramProblems({ visit_types: [card("a"), card("a")] })).toEqual(["Way to visit 2: another card already has the id a."]);
  });

  it("refuses a shape the page cannot draw", () => {
    for (const body of [null, [], { visit_types: {} }, { visit_types: ["x"] }, { logistics: [] }, { hero_subtitle: 4 }]) {
      expect(visitProgramProblems(body).length, JSON.stringify(body)).toBeGreaterThan(0);
    }
  });
});

describe("reading and ordering the program", () => {
  it("fills a box saved before it existed, keeps what it does not know, and sorts by order", () => {
    const doc = normalizeVisitProgram({ extra: 1, visit_types: [{ id: "b", title: "B", order: 2 }, { id: "a", title: "A", order: 1, colour: "x" }] });
    expect(doc.visit_types.map((t) => t.id)).toEqual(["a", "b"]);
    expect(doc.visit_types[0]).toMatchObject({ cta_label: "", colour: "x" });
    expect((doc as unknown as { extra: number }).extra).toBe(1);
    expect(doc.logistics.contact_note).toBe("");
  });

  it("gives a card with no id, or another card's id, one of its own, so what was read can be saved", () => {
    const doc = normalizeVisitProgram({ visit_types: [{ id: "a", title: "A" }, { id: "a", title: "B" }, { title: "C" }, { id: "Ünïcode id", title: "D" }] });
    const ids = doc.visit_types.map((t) => t.id);
    expect(ids[0]).toBe("a");
    expect(ids[3]).toBe("Ünïcode id");
    expect(new Set(ids).size).toBe(4);
    expect(visitProgramProblems(doc)).toEqual([]);
  });

  it("numbers the cards in the order they are listed", () => {
    expect(renumberVisitTypes([card("b", { order: 9 }), card("a", { order: 3 })] as never).map((t) => [t.id, t.order])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("gives a new card an id nobody has", () => {
    expect(newVisitTypeId(["visit-x", "visit-x-1"], "x")).toBe("visit-x-2");
  });
});
