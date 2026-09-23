/**
 * The governing purpose statement's pure half.
 *
 * The assertions worth having here are the REFUSALS, and one of them was
 * asked for by name: the minimum length has to pin that a plausible
 * NON-ANSWER fails, and not only that an empty box does. "TBD" and one
 * ordinary sentence are the real failure modes, and a floor set low passes
 * both of them while reading as a floor.
 */
import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_MIN_WORDS,
  countWords,
  EMPTY_PURPOSE,
  GPS_CHANGE,
  GPS_DOC_KEY,
  hasGoverningPurpose,
  purposeAlignmentProblem,
  purposeAlignmentRequired,
  PURPOSE_ALIGNMENT_SUBJECTS,
  PURPOSE_MIN_WORDS,
  purposeDocFrom,
  purposeStatementProblem,
} from "./governingPurpose";

/**
 * A statement of the shape the template produces: who it serves, what they
 * suffer, the move from X to Y, by what means, and what becomes true. Carries
 * no village's name, because the brand ratchet counts test files.
 */
const A_REAL_STATEMENT = [
  "This village exists for the people who want to live and work together on one piece of land",
  "and keep finding that every arrangement open to them asks them to choose between a home they",
  "can afford and neighbours they can count on, so it moves them from being tenants of a",
  "landlord nobody elected to being members of a place they hold in common, by pooling their",
  "labour and their money through agreements they write themselves and can change by a vote,",
  "so that a person who arrives with nothing but their hands can end up with a stake, a say,",
  "and somewhere their children would want to come back to.",
].join(" ");

describe("the statement's shape", () => {
  it("is keyed gps and carries three fields", () => {
    expect(GPS_DOC_KEY).toBe("gps");
    expect(Object.keys(EMPTY_PURPOSE).sort()).toEqual(["statement", "writtenAt", "writtenBy"]);
  });

  it("back-fills an absent key on read, so a document written before a field existed is whole", () => {
    // The shape every village stores today: three keys. Tomorrow's reader
    // wants a fourth, and this is the read that stops the third going
    // undefined when somebody adds it.
    expect(purposeDocFrom({ statement: "x" })).toEqual({ statement: "x", writtenAt: "", writtenBy: "" });
  });

  it("reads a wrong-typed field as absent instead of handing it on", () => {
    expect(purposeDocFrom({ statement: 7, writtenAt: null, writtenBy: ["a"] })).toEqual(EMPTY_PURPOSE);
  });

  it("reads a missing row, a string and an array as the empty document", () => {
    expect(purposeDocFrom(null)).toEqual(EMPTY_PURPOSE);
    expect(purposeDocFrom("statement")).toEqual(EMPTY_PURPOSE);
    expect(purposeDocFrom([{ statement: "x" }])).toEqual(EMPTY_PURPOSE);
  });
});

describe("the minimum length refuses a plausible non-answer", () => {
  it("refuses an empty box", () => {
    expect(purposeStatementProblem("")).toMatch(/cannot be empty/);
    expect(purposeStatementProblem("   ")).toMatch(/cannot be empty/);
  });

  /*
   * THE TWO THIS FLOOR EXISTS FOR. Neither is an empty box, and a character
   * floor low enough to be fair to a terse village would take both.
   */
  it("refuses TBD", () => {
    expect(purposeStatementProblem("TBD")).toMatch(/at least 80 words/);
  });

  it("refuses one ordinary sentence", () => {
    const oneSentence =
      "Our purpose is to build a thriving community on shared land where everybody has a home and a say in what happens next.";
    expect(countWords(oneSentence)).toBeLessThan(PURPOSE_MIN_WORDS);
    expect(purposeStatementProblem(oneSentence)).toMatch(/at least 80 words/);
  });

  it("takes a statement that answers the template's five parts", () => {
    expect(countWords(A_REAL_STATEMENT)).toBeGreaterThanOrEqual(PURPOSE_MIN_WORDS);
    expect(purposeStatementProblem(A_REAL_STATEMENT)).toBeNull();
    expect(hasGoverningPurpose({ statement: A_REAL_STATEMENT, writtenAt: "", writtenBy: "" })).toBe(true);
  });

  it("sits exactly on the floor: one word short fails, the floor itself passes", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    expect(purposeStatementProblem(words(PURPOSE_MIN_WORDS - 1))).toMatch(/at least 80 words/);
    expect(purposeStatementProblem(words(PURPOSE_MIN_WORDS))).toBeNull();
  });

  it("refuses a document wearing a statement's clothes", () => {
    expect(purposeStatementProblem("x ".repeat(20_000))).toMatch(/stops at 20000 characters/);
  });

  it("says a village with nothing written has no purpose statement", () => {
    expect(hasGoverningPurpose(EMPTY_PURPOSE)).toBe(false);
  });
});

describe("the judgement line, and the subjects that carry one", () => {
  it("is required on the five subjects that change how the village works", () => {
    expect([...PURPOSE_ALIGNMENT_SUBJECTS].sort()).toEqual(
      ["gps_change", "mechanics", "power_grant", "power_return", "power_transfer"],
    );
    expect(GPS_CHANGE).toBe("gps_change");
  });

  /*
   * THE SCOPING IS PART OF THE RULING. A field on every proposal becomes a
   * ritual people fill with "it does", so the subjects a village runs every
   * week are deliberately outside it.
   */
  it("is required nowhere else, and a subject a later lane adds inherits nothing", () => {
    for (const subject of ["quest_payout", "role_seat", "role_unseat", "cycle_settlement", "village_launch", "something_new"]) {
      expect(purposeAlignmentRequired(subject), subject).toBe(false);
      expect(purposeAlignmentProblem(subject, ""), subject).toBeNull();
    }
  });

  it("refuses a missing line on a subject that needs one", () => {
    expect(purposeAlignmentProblem("mechanics", "")).toMatch(/how it serves the governing purpose/);
  });

  it("refuses the ritual answer the ruling was scoped against", () => {
    expect(purposeAlignmentProblem("mechanics", "it does")).toMatch(/at least 12 words/);
    expect(countWords("it does")).toBeLessThan(ALIGNMENT_MIN_WORDS);
  });

  it("takes a line that names what changes and which part of the purpose it serves", () => {
    const line =
      "This raises the quorum on rule changes, which serves the part of the purpose about agreements the members write and can change themselves.";
    expect(purposeAlignmentProblem("mechanics", line)).toBeNull();
    expect(purposeAlignmentProblem(GPS_CHANGE, line)).toBeNull();
  });

  it("stops a judgement line at a paragraph", () => {
    expect(purposeAlignmentProblem("power_return", "word ".repeat(2_000))).toMatch(/stops at 2000 characters/);
  });
});
