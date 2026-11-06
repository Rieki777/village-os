/**
 * A circle's decisions and their review dates, without a database: reading a
 * review date, the date arithmetic, and the words. The doors and the job run
 * against a real schema in server/sessionDecisions.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { DECISION_LIMITS, DECISION_REFUSALS, REVIEW_ITEM_LEAD, addDaysTo, addMonthsTo, cleanReviewOn, dateWords } from "./sessionDecisions";
import { LIBRARY_LIMITS, LIBRARY_SOURCE_LINE, addedByCircle, tensionAsItem } from "./sessionLibrary";

const TODAY = "2026-10-22";

describe("reading a review date", () => {
  it("takes a date after today, up to three years ahead, or none", () => {
    expect(cleanReviewOn({ reviewOn: "2027-04-22" }, TODAY)).toEqual({ ok: true, value: "2027-04-22" });
    expect(cleanReviewOn({ reviewOn: null }, TODAY)).toEqual({ ok: true, value: null });
    expect(cleanReviewOn({ reviewOn: addDaysTo(TODAY, DECISION_LIMITS.reviewMaxDays) }, TODAY)).toMatchObject({ ok: true });
  });

  it("refuses today, a date gone, one too far, and one that does not read", () => {
    expect(cleanReviewOn({ reviewOn: TODAY }, TODAY)).toEqual({ ok: false, error: DECISION_REFUSALS.pastDate });
    expect(cleanReviewOn({ reviewOn: "2026-01-01" }, TODAY)).toEqual({ ok: false, error: DECISION_REFUSALS.pastDate });
    expect(cleanReviewOn({ reviewOn: addDaysTo(TODAY, DECISION_LIMITS.reviewMaxDays + 1) }, TODAY)).toEqual({ ok: false, error: DECISION_REFUSALS.tooFar });
    expect(cleanReviewOn({ reviewOn: "2027-02-30" }, TODAY)).toEqual({ ok: false, error: DECISION_REFUSALS.dateNeeded });
    expect(cleanReviewOn({}, TODAY)).toEqual({ ok: false, error: DECISION_REFUSALS.dateNeeded });
  });
});

describe("the date arithmetic", () => {
  it("adds months and keeps the day where the month has it", () => {
    expect(addMonthsTo("2026-10-22", 3)).toBe("2027-01-22");
    expect(addMonthsTo("2026-10-22", 12)).toBe("2027-10-22");
    expect(addMonthsTo("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsTo("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("adds days across a year", () => {
    expect(addDaysTo("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("the words", () => {
  it("names a review's agenda item, a date, where the item came from, and who added it", () => {
    expect(tensionAsItem("  We fill the tanks\non Mondays. ", REVIEW_ITEM_LEAD)).toEqual({ title: "Review: We fill the tanks on Mondays.", note: null });
    expect(dateWords("2027-04-22")).toBe("22 April 2027");
    expect(LIBRARY_SOURCE_LINE.decision_review("Garden")).toBe("A decision the Garden circle set a date to review");
    expect(addedByCircle("decision_review", "Garden")).toBe("the Garden circle");
    expect(addedByCircle("decision_review", "Kitchen circle")).toBe("the Kitchen circle");
    expect(addedByCircle("room_tension", "Garden")).toBeNull();
  });

  it("opens only the title with the lead, so a long decision reaches the note whole", () => {
    const words = `${"We water the beds by the gate at dawn. ".repeat(60)}End.`.slice(-LIBRARY_LIMITS.note);
    const out = tensionAsItem(words, REVIEW_ITEM_LEAD);
    expect(out.title.startsWith(REVIEW_ITEM_LEAD)).toBe(true);
    expect(out.title.length).toBeLessThanOrEqual(LIBRARY_LIMITS.title);
    expect(out.note).toBe(words.trim());
    expect(out.note!.endsWith("End.")).toBe(true);
  });
});
