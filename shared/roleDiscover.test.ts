import { describe, expect, it } from "vitest";
import {
  EMPTY_IKIGAI,
  IKIGAI_ANSWER_MAX,
  clipAnswer,
  hasIkigai,
  ikigaiFromStored,
  mappingIsEmpty,
  parseGuideAsk,
  parseMapping,
  suggestCharacters,
  whyFromIkigai,
} from "./roleDiscover";
import { OPEN_WHY_MAX } from "./openProposals";

describe("R-Ikigai answers, re-read safely", () => {
  it("keeps strings only, trims, and caps each answer", () => {
    const s = ikigaiFromStored({ answers: { love: "  sing  ", good: 7, needs: "x".repeat(IKIGAI_ANSWER_MAX + 50), pays: null, extra: "no" }, carry: true });
    expect(s.answers.love).toBe("sing");
    expect(s.answers.good).toBe("");
    expect(s.answers.needs).toHaveLength(IKIGAI_ANSWER_MAX);
    expect(s.carry).toBe(true);
  });
  it("reads anything unreadable as empty", () => {
    for (const bad of [null, undefined, "x", 4, [], { answers: "no" }]) expect(ikigaiFromStored(bad)).toEqual(EMPTY_IKIGAI);
  });
  it("clips while typing", () => {
    expect(clipAnswer("y".repeat(999))).toHaveLength(IKIGAI_ANSWER_MAX);
  });
});

describe("what is carried into Why you", () => {
  const full = { love: "a".repeat(IKIGAI_ANSWER_MAX), good: "b".repeat(IKIGAI_ANSWER_MAX), needs: "c".repeat(IKIGAI_ANSWER_MAX), pays: "d".repeat(IKIGAI_ANSWER_MAX) };
  it("is empty without the tick, however much was written", () => {
    expect(whyFromIkigai({ answers: full, carry: false })).toBe("");
  });
  it("is empty with the tick and nothing written", () => {
    expect(whyFromIkigai({ answers: EMPTY_IKIGAI.answers, carry: true })).toBe("");
    expect(hasIkigai(EMPTY_IKIGAI)).toBe(false);
  });
  it("fits the field with all four at their cap", () => {
    const w = whyFromIkigai({ answers: full, carry: true });
    expect(w.length).toBeGreaterThan(0);
    expect(w.length).toBeLessThanOrEqual(OPEN_WHY_MAX);
  });
});

describe("the village's mapping", () => {
  it("is empty when the village never said anything, and then suggests nothing", () => {
    const m = parseMapping(undefined);
    expect(mappingIsEmpty(m)).toBe(true);
    expect(suggestCharacters(m, { type: "Projector", lines: [1, 3] }, ["building"])).toEqual([]);
  });
  it("reads strictly: unknown line keys and non-strings drop out", () => {
    const m = parseMapping({ humanDesign: { Projector: ["building", 5, "building"] }, lines: { "3": ["catalyzing"], "9": ["x"], seven: ["y"] } });
    expect(m.humanDesign).toEqual({ Projector: ["building"] });
    expect(m.lines).toEqual({ "3": ["catalyzing"] });
  });
  it("suggests only characters in the cast, each once", () => {
    const m = parseMapping({ humanDesign: { Projector: ["building", "ghost"] }, lines: { "3": ["building", "catalyzing"] } });
    expect(suggestCharacters(m, { type: "Projector", lines: [3, 5] }, ["building", "catalyzing"])).toEqual(["building", "catalyzing"]);
  });
});

describe("the guide's request", () => {
  it("reads only the answers and the roles, and ignores anything else", () => {
    const ask = parseGuideAsk({ answers: { love: "soil" }, roles: [{ id: "r1", name: "Gardener", aim: "grow" }], humanDesign: "Projector", chart: { a: 1 } });
    expect(ask).not.toBeNull();
    expect(Object.keys(ask as object).sort()).toEqual(["answers", "roles"]);
  });
  it("is null with no answer or no role", () => {
    expect(parseGuideAsk({ answers: {}, roles: [{ id: "r1", name: "G" }] })).toBeNull();
    expect(parseGuideAsk({ answers: { love: "x" }, roles: [] })).toBeNull();
  });
});
