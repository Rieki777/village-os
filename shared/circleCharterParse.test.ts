import { describe, expect, it } from "vitest";
import { circleWordKeysOf, parseCharterList, parseCircleValues, parseCircleWord, parseCircleWords } from "./circleCharterParse";

describe("the one parser for a circle's words", () => {
  it("reads a list from text with a line each, trimmed, blank lines dropped", () => {
    expect(parseCharterList("domains", "  The food forest \n\n The seed library\r\n")).toEqual({ ok: true, value: ["The food forest", "The seed library"] });
    expect(parseCharterList("domains", ["A", " ", "B"])).toEqual({ ok: true, value: ["A", "B"] });
    expect(parseCharterList("domains", "  \n ")).toEqual({ ok: true, value: null });
    expect(parseCharterList("domains", null)).toEqual({ ok: true, value: null });
  });

  it("holds what the circle answers for to 3 to 6 lines once it is written", () => {
    expect(parseCharterList("accountabilities", "One\nTwo")).toEqual({ ok: false, problem: "Write 3 to 6 lines, or leave it empty for now." });
    expect(parseCharterList("accountabilities", "1\n2\n3\n4\n5\n6\n7")).toEqual({ ok: false, problem: "Up to 6 lines." });
    expect(parseCharterList("accountabilities", "1\n2\n3").ok).toBe(true);
    expect(parseCharterList("accountabilities", "")).toEqual({ ok: true, value: null });
  });

  it("refuses a line too long, a payment detail and a link that is not https", () => {
    expect(parseCharterList("tools", ["x".repeat(201)])).toEqual({ ok: false, problem: "Keep each line to 200 characters." });
    expect(parseCharterList("tools", ["Pay into 4111 1111 1111 1111"]).ok).toBe(false);
    expect(parseCharterList("tools", ["http://example.org/notes"]).ok).toBe(false);
    expect(parseCharterList("tools", ["https://example.org/notes"])).toEqual({ ok: true, value: ["https://example.org/notes"] });
  });

  it("reads up to two values, each the value, a colon, then its practice", () => {
    expect(parseCircleValues("Care: We check in first.\nPlay: We end with a song.")).toEqual({
      ok: true,
      value: [
        { value: "Care", practice: "We check in first." },
        { value: "Play", practice: "We end with a song." },
      ],
    });
    expect(parseCircleValues("Care with no practice")).toEqual({ ok: false, problem: "Write each value as the value, a colon, then the practice that shows it." });
    expect(parseCircleValues("A: 1\nB: 2\nC: 3")).toEqual({ ok: false, problem: "Up to 2 values of the circle's own." });
    expect(parseCircleValues([{ value: "Care", practice: "We listen." }]).ok).toBe(true);
  });

  it("keeps the purpose to 2000 characters and this circle exists while to one line of 300", () => {
    expect(parseCircleWord("purpose", "x".repeat(2001))).toEqual({ ok: false, problem: "Keep it to 2000 characters." });
    expect(parseCircleWord("existsWhile", "x".repeat(301))).toEqual({ ok: false, problem: "Keep it to 300 characters." });
    expect(parseCircleWord("existsWhile", "  the village eats from its land ")).toEqual({ ok: true, value: "the village eats from its land" });
  });

  it("parses a whole payload, drops unknown keys, and names the field a refusal is about", () => {
    expect(parseCircleWords({ domains: "A\nB", name: "Renamed" })).toEqual({ ok: true, value: { domains: ["A", "B"] } });
    expect(parseCircleWords({ accountabilities: "Only one" })).toEqual({
      ok: false,
      problem: "What you can count on us for: Write 3 to 6 lines, or leave it empty for now.",
    });
    expect(parseCircleWords({})).toEqual({ ok: false, problem: "This names no word this village can change on a circle." });
    expect(parseCircleWords({ tools: null })).toEqual({ ok: true, value: { tools: null } });
  });

  it("lists the keys a payload names, in the card's order", () => {
    expect(circleWordKeysOf({ values: [], purpose: "x", other: 1 })).toEqual(["purpose", "values"]);
  });
});
