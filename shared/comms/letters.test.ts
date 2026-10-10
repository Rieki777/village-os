import { describe, expect, it } from "vitest";
import {
  audienceLabel,
  capProblem,
  letterCanonical,
  LETTER_GAP_MINUTES,
  MAX_SCHEDULE_AHEAD_MS,
  parseLetterAudience,
  readLetterDraft,
  scheduleProblem,
  type LetterDraft,
} from "./letters";

describe("letter audiences", () => {
  it("parses each kind, keeping only its own fields", () => {
    expect(parseLetterAudience({ kind: "members", pathId: "x" })).toEqual({ kind: "members" });
    expect(parseLetterAudience({ kind: "everyone" })).toEqual({ kind: "everyone" });
    expect(parseLetterAudience({ kind: "path", pathId: "resident", extra: 1 })).toEqual({ kind: "path", pathId: "resident" });
    expect(parseLetterAudience('{"kind":"gathering","eventId":"ev-1"}')).toEqual({ kind: "gathering", eventId: "ev-1" });
  });

  it("refuses an audience it does not know, or one missing its id", () => {
    expect(parseLetterAudience(null)).toBeNull();
    expect(parseLetterAudience({ kind: "all" })).toBeNull();
    expect(parseLetterAudience({ kind: "path" })).toBeNull();
    expect(parseLetterAudience({ kind: "gathering", eventId: "has spaces" })).toBeNull();
    expect(parseLetterAudience("not json")).toBeNull();
  });

  it("names each audience in a plain line", () => {
    expect(audienceLabel({ kind: "members" })).toBe("Members who said yes to letters");
    expect(audienceLabel({ kind: "path", pathId: "resident" }, { path: "Resident" })).toBe("People on the Resident path");
    expect(audienceLabel({ kind: "gathering", eventId: "e" }, { gathering: "Supper" })).toBe("People who came to Supper");
  });
});

describe("a letter's draft", () => {
  const ok = { subject: " News ", preheader: "", bodyMd: "Hello\r\nthere", layout: "plain", audience: { kind: "everyone" } };

  it("reads a good draft, trimming the subject and dropping an empty preview line", () => {
    const read = readLetterDraft(ok);
    expect(read).toEqual({ draft: { subject: "News", preheader: null, bodyMd: "Hello\nthere", layout: "plain", audience: { kind: "everyone" } } });
  });

  it("says every problem in a sentence", () => {
    const read = readLetterDraft({ subject: "", bodyMd: " ", layout: "fancy", audience: { kind: "nobody" } });
    expect("problems" in read && read.problems).toEqual([
      "Give the letter a subject.",
      "Write the letter before saving it.",
      "Choose a layout this village has.",
      "Choose who the letter is for.",
    ]);
  });

  it("binds a confirmation to the words, the layout and the audience", () => {
    const d: LetterDraft = { subject: "S", preheader: null, bodyMd: "B", layout: "plain", audience: { kind: "everyone" } };
    expect(letterCanonical(d)).toBe(letterCanonical({ ...d }));
    expect(letterCanonical({ ...d, bodyMd: "B." })).not.toBe(letterCanonical(d));
    expect(letterCanonical({ ...d, audience: { kind: "members" } })).not.toBe(letterCanonical(d));
    expect(letterCanonical({ ...d, preheader: "P" })).not.toBe(letterCanonical(d));
  });
});

describe("when a letter may go", () => {
  const now = Date.UTC(2026, 9, 9, 12);

  it("schedules between a minute and 90 days ahead", () => {
    expect(scheduleProblem(now + 30_000, now)).toMatch(/at least one minute/);
    expect(scheduleProblem(now + 2 * 60_000, now)).toBeNull();
    expect(scheduleProblem(now + MAX_SCHEDULE_AHEAD_MS + 1, now)).toMatch(/90 days/);
    expect(scheduleProblem(Number.NaN, now)).toMatch(/not a date/);
  });

  it("refuses past the daily limit, and inside the gap, and allows otherwise", () => {
    expect(capProblem(3, 120, 3)).toMatch(/at most 3 letters a day/);
    expect(capProblem(1, 120, 1)).toMatch(/at most 1 letter a day/);
    expect(capProblem(1, 4, 3)).toMatch(new RegExp(`${LETTER_GAP_MINUTES} minutes apart. Try again in 6 minutes`));
    expect(capProblem(2, 11, 3)).toBeNull();
    expect(capProblem(0, null, 3)).toBeNull();
  });
});
