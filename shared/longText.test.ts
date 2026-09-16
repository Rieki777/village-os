/**
 * The `longtext` seam: what a paragraph becomes on its way into storage, and
 * what the registry refuses.
 *
 * WHY THIS FILE EXISTS SEPARATELY from shared/gameVariables.test.ts. No dial in
 * the registry is a `longtext` yet: this type landed as a seam for the lanes
 * that need it (a village's own process text is the first). So these tests are
 * written against a DEFINITION rather than against a live key, which is also
 * the honest shape for a seam: the contract holds for whatever dial arrives
 * first, and it keeps holding when that dial is renamed.
 */
import { describe, expect, it } from "vitest";
import {
  LONGTEXT_MAX,
  normaliseLongText,
  parseVariable,
  validateVariable,
  type VariableDef,
} from "./gameVariables";

const DIAL: VariableDef = {
  key: "demo.process_text",
  category: "Demo",
  label: "How this village does a thing",
  description: "Words a member reads.",
  type: "longtext",
  default: "",
};

describe("normaliseLongText", () => {
  it("keeps the line breaks and the tabs somebody typed", () => {
    expect(normaliseLongText("one\n\ttwo\n\nthree")).toBe("one\n\ttwo\n\nthree");
  });

  it("folds CRLF and a lone CR into one newline", () => {
    // The delta store deletes a row whose value equals the default, so an
    // invisible carriage return is the difference between inheriting future
    // platform defaults and being frozen on today's.
    expect(normaliseLongText("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("strips control characters that no person typed", () => {
    expect(normaliseLongText("safe\x00[31m words")).toBe("safe[31m words");
  });

  it("strips the bidi overrides and isolates that reorder what is around them", () => {
    expect(normaliseLongText("pay ‮reverse‬ me")).toBe("pay reverse me");
  });

  it("trims the ends and leaves the middle alone", () => {
    expect(normaliseLongText("  \n words  in  the  middle \n ")).toBe("words  in  the  middle");
  });

  it("answers an empty string for nothing at all", () => {
    expect(normaliseLongText("")).toBe("");
    expect(normaliseLongText(undefined as unknown as string)).toBe("");
  });
});

describe("validateVariable on a longtext dial", () => {
  it("accepts several lines", () => {
    expect(validateVariable(DIAL, "First we gather.\n\nThen we decide.")).toBeNull();
  });

  it("accepts a value that is only over the cap before it is normalised", () => {
    // The point of measuring after normalising: the carriage returns come off
    // before the length is judged, so this is 4,000 characters as stored.
    const lines = Array.from({ length: LONGTEXT_MAX / 2 }, () => "a").join("\r\n");
    expect(normaliseLongText(lines).length).toBe(LONGTEXT_MAX - 1);
    expect(validateVariable(DIAL, lines)).toBeNull();
  });

  it("refuses a value over the cap, and says how long it actually is", () => {
    const tooLong = "x".repeat(LONGTEXT_MAX + 1);
    expect(validateVariable(DIAL, tooLong)).toMatch(
      new RegExp(`${LONGTEXT_MAX} characters maximum, this is ${LONGTEXT_MAX + 1}`),
    );
  });

  it("applies none of the text type's per-key grammar to a paragraph", () => {
    // `text` refuses a non-https value on a key ending in _url. A paragraph
    // that happens to mention one is prose and stays prose.
    const urlish: VariableDef = { ...DIAL, key: "demo.process_url" };
    expect(validateVariable(urlish, "See http://example.org, or ask Mira.")).toBeNull();
  });
});

describe("parseVariable on a longtext dial", () => {
  it("answers the stored string, and the default when nothing is stored", () => {
    expect(parseVariable(DIAL, "words")).toBe("words");
    expect(parseVariable({ ...DIAL, default: "fallback" }, undefined)).toBe("fallback");
  });
});
