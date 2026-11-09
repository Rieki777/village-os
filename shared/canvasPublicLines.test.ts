/**
 * The canvas's public lines: the one parser the route and the form share, the
 * defensive read of the stored section, and what a member reads beside a line.
 * The name check lives on the server and has its own suite
 * (server/lib/canvasNames.test.ts).
 */
import { describe, expect, it } from "vitest";
import { CANVAS_BLOCK_IDS } from "./governanceCanvas";
import {
  ADMIN_ONLY_BRIEF_SECTIONS,
  CANVAS_PUBLIC_LINE_MAX,
  memberAnswersFrom,
  normalisePublicLine,
  parsePublicLine,
  PUBLIC_LINE_WORDS,
  readPublicLines,
} from "./canvasPublicLines";

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const SOFT_HYPHEN = String.fromCharCode(0x00ad);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("parsePublicLine", () => {
  it("keeps a line, trimmed", () => {
    expect(parsePublicLine({ line: "  Our care holder answers within two days.  " })).toEqual({
      ok: true,
      line: "Our care holder answers within two days.",
    });
  });

  it("takes an empty line as taking the block's line down", () => {
    expect(parsePublicLine({ line: "   " })).toEqual({ ok: true, line: "" });
  });

  it("refuses anything that is not text, in words", () => {
    for (const body of [{}, { line: 3 }, { line: null }, null, "a line"]) {
      expect(parsePublicLine(body)).toEqual({ ok: false, error: PUBLIC_LINE_WORDS.notText });
    }
  });

  it("refuses a line break of any kind, and keeps a line with none", () => {
    for (const broken of ["one\ntwo", "one\r\ntwo", `one${LINE_SEPARATOR}two`]) {
      expect(parsePublicLine({ line: broken })).toEqual({ ok: false, error: PUBLIC_LINE_WORDS.oneLine });
    }
    // Control: the same words on one line pass.
    expect(parsePublicLine({ line: "one two" }).ok).toBe(true);
  });

  it("counts characters as a person does, so the limit is exact and an emoji is one", () => {
    const atLimit = "a".repeat(CANVAS_PUBLIC_LINE_MAX);
    expect(parsePublicLine({ line: atLimit })).toEqual({ ok: true, line: atLimit });
    expect(parsePublicLine({ line: atLimit + "a" })).toEqual({ ok: false, error: PUBLIC_LINE_WORDS.tooLong });
    // Two UTF-16 units each; still one character each.
    const emoji = String.fromCodePoint(0x1f331).repeat(CANVAS_PUBLIC_LINE_MAX);
    expect(parsePublicLine({ line: emoji }).ok).toBe(true);
  });

  it("takes invisible characters out, so a name split by one is checked and stored whole", () => {
    expect(normalisePublicLine(`A${ZERO_WIDTH_SPACE}sh keeps the ke${SOFT_HYPHEN}ys`)).toBe("Ash keeps the keys");
    expect(parsePublicLine({ line: `A${ZERO_WIDTH_SPACE}sh` })).toEqual({ ok: true, line: "Ash" });
  });
});

describe("readPublicLines", () => {
  it("serves the twelve block ids only, strings only, blanks dropped", () => {
    expect(
      readPublicLines({
        purpose: "  We restore the watershed.  ",
        power: "",
        conflict: 7,
        people: "Not a block.",
      }),
    ).toEqual({ purpose: "We restore the watershed." });
  });

  it("reads anything that is not a keyed object as no lines at all", () => {
    for (const section of [undefined, null, "purpose", ["purpose"], 12]) expect(readPublicLines(section)).toEqual({});
  });
});

describe("memberAnswersFrom", () => {
  const row = (section: string, body: string, status = "confirmed") => ({ section, title: `Title of ${section}`, body, status });

  it("gives every block an entry, in canvas order", () => {
    expect(Object.keys(memberAnswersFrom([]))).toEqual([...CANVAS_BLOCK_IDS]);
  });

  it("reads a block's sections in the order the block lists them, confirmed words only", () => {
    const answers = memberAnswersFrom([
      row("vision", "A valley where the river runs clear."),
      row("aims", "  Restore the watershed.  "),
      row("decisions", "Proposed words nobody confirmed.", "proposed"),
      row("rhythm", "   "),
    ]);
    // Purpose draws on aims, vision and constraints, in that order.
    expect(answers.purpose).toEqual([
      { section: "aims", title: "Title of aims", body: "Restore the watershed." },
      { section: "vision", title: "Title of vision", body: "A valley where the river runs clear." },
    ]);
    expect(answers.power).toEqual([]);
    expect(answers.meetings).toEqual([]);
  });

  it("never carries an admin-only section, even one a row says members may read", () => {
    const answers = memberAnswersFrom([
      row("constraints", "The bank loan runs out in March."),
      row("people", "Ash Brook keeps the keys."),
      row("legal", "The title is held by one founder."),
      row("land", "Four hectares on the north slope."),
      // Control: a member-readable section of the same blocks does come through.
      row("membership", "Two members vouch for a newcomer."),
    ]);
    const all = JSON.stringify(answers);
    for (const secret of ["bank loan", "Ash Brook", "title is held", "north slope"]) expect(all).not.toContain(secret);
    expect(answers.team).toEqual([{ section: "membership", title: "Title of membership", body: "Two members vouch for a newcomer." }]);
    expect([...ADMIN_ONLY_BRIEF_SECTIONS].sort()).toEqual(["constraints", "land", "legal", "people"]);
  });
});
