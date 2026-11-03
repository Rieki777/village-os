import { describe, expect, it } from "vitest";
import { LIBRARY_CODES, LIBRARY_CODE_OF, SCREEN_REASONS, libraryCode, parseFeedback, reviewOf, stripContact } from "./memberTaskFeedback";

describe("the eight library codes", () => {
  it("maps every screen reason onto one of the eight, or none for other", () => {
    for (const r of SCREEN_REASONS) {
      const c = LIBRARY_CODE_OF[r];
      if (r === "other") expect(c).toBeNull();
      else expect(LIBRARY_CODES).toContain(c);
    }
    expect(LIBRARY_CODE_OF.not_my_role).toBe("wrong_role");
    expect(LIBRARY_CODE_OF.better_for_someone_else).toBe("wrong_role");
    expect(LIBRARY_CODE_OF.needs_named_person).toBe("wrong_role");
    expect(LIBRARY_CODE_OF.wrong_timing).toBe("not_now");
    expect(libraryCode("done", null)).toBe("already_done");
    expect(libraryCode("priority_changed", null)).toBe("wrong_priority");
  });
  it("lets the library apply done, already-done removals, person redirects and priority; the rest wait for a steward", () => {
    expect(reviewOf("done", null, false)).toBe("auto");
    expect(reviewOf("priority_changed", null, false)).toBe("auto");
    expect(reviewOf("remove", "already_done", false)).toBe("auto");
    expect(reviewOf("redirect", "needs_named_person", true)).toBe("auto");
    expect(reviewOf("redirect", "not_my_role", false)).toBe("steward");
    expect(reviewOf("remove", "merged", false)).toBe("steward");
    expect(reviewOf("remove", "heard_wrong", false)).toBe("steward");
    expect(reviewOf("remove", "other", false)).toBe("steward");
  });
});

describe("notes", () => {
  it("strips emails and phone numbers, and leaves short numbers alone", () => {
    const s = stripContact("Ask jo.smith@example.org or call +506 8888-1234 about the 3 beds");
    expect(s).not.toContain("example.org");
    expect(s).not.toContain("8888");
    expect(s).toContain("3 beds");
    expect(s).toContain("[email removed]");
    expect(s).toContain("[number removed]");
  });
});

describe("parsing a press", () => {
  it("needs a feedback id, and a reason for remove and redirect", () => {
    expect(parseFeedback({ reason: "not_mine" }, "remove").ok).toBe(false);
    expect(parseFeedback({ feedbackId: "fb-12345678" }, "remove").ok).toBe(false);
    expect(parseFeedback({ feedbackId: "fb-12345678" }, "done").ok).toBe(true);
    const p = parseFeedback({ feedbackId: "fb-12345678", reason: "duplicate", note: " x ", context: { shownIn: "today", rankScore: 4.2, daysOnList: 3, surface: "profile" } }, "remove");
    expect(p.ok && p.value).toMatchObject({ reason: "duplicate", note: "x", context: { shownIn: "today", rankScore: 4.2, daysOnList: 3 } });
  });
describe("stripping contact details from a note", () => {
  it("takes out phones in the shapes members write them, and keeps a date", () => {
    for (const n of ["(506) 8888 1234", "88881234", "whatsapp: 506-8888-1234", "+1 (415) 555-0100"]) expect(stripContact(n)).not.toMatch(/8888|555/);
    expect(stripContact("due 2026-11-03")).toBe("due 2026-11-03");
    expect(stripContact("A.B+tag@sub.example.co.cr")).toBe("[email removed]");
  });
});
});
