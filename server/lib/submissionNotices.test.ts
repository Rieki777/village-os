/**
 * The words somebody hears when the thing they sent in moves.
 *
 * These run WITHOUT a database on purpose. Everything asserted here is a
 * judgement about copy and about what a member is owed, and both are provable
 * on any machine, including a worktree with no .env where every DB-backed
 * suite skips.
 *
 * The load-bearing assertion is the last one: none of the pipeline's five
 * status words may appear in anything a person reads. `PUT
 * /api/admin/submissions/:id/status` drives an offer to hold a seat, a
 * proposal to work together, a request to visit and an investor enquiry
 * through one vocabulary that exists for the founder's filing, and a member
 * should never have to learn that their raised hand is "in-conversation".
 */
import { describe, expect, it } from "vitest";
import { submissionStatusNotice, submissionSubject } from "./submissionNotices";

const PIPELINE_WORDS = ["new", "reviewing", "in-conversation", "accepted", "declined"];
const SPEAKING = ["reviewing", "accepted", "declined"];
const TYPES = [
  "role-application",
  "power-application",
  "work-with-us",
  "quest-proposal",
  "visit-inquiry",
  "membership-508",
  "steward-interest",
  "steward",
  "resident",
  "investor",
  "investor-call",
  "investor-pack",
  "investor-doc-request",
  "prosperity",
  "contact",
  "a-type-no-village-has-invented-yet",
];

describe("submissionSubject", () => {
  it("names the thing they actually did, per kind", () => {
    expect(submissionSubject("work-with-us")).toBe("your proposal to work together");
    expect(submissionSubject("quest-proposal")).toBe("the quest you proposed");
    expect(submissionSubject("visit-inquiry")).toBe("your request to visit");
  });

  it("names the seat on a raised hand, because a member may have raised several", () => {
    expect(submissionSubject("role-application", { roleName: "Water Steward" })).toBe(
      "your offer to hold Water Steward",
    );
  });

  it("falls back to the seat-less phrase when the row carries no name", () => {
    expect(submissionSubject("role-application", {})).toBe("your offer to hold a seat");
    expect(submissionSubject("role-application", { roleName: "   " })).toBe("your offer to hold a seat");
    expect(submissionSubject("role-application", null)).toBe("your offer to hold a seat");
  });

  it("names the power on a hand raised for one, in the words of its label", () => {
    expect(submissionSubject("power-application", { powerLabel: "Keep the shared library and its loans" })).toBe(
      "your offer to keep the shared library and its loans",
    );
    expect(
      submissionStatusNotice("power-application", "accepted", { powerLabel: "Post announcements to the village feed" })!
        .headline,
    ).toBe("Yes to your offer to post announcements to the village feed");
  });

  it("falls back to the power-less phrase when the row carries no label", () => {
    expect(submissionSubject("power-application", {})).toBe("your offer to take on a power");
    expect(submissionSubject("power-application", { powerLabel: "  " })).toBe("your offer to take on a power");
    expect(submissionSubject("power-application", null)).toBe("your offer to take on a power");
  });

  it("is plain instead of wrong for a form this platform has never seen", () => {
    expect(submissionSubject("a-type-no-village-has-invented-yet")).toBe("what you sent us");
  });

  it("quotes nothing a stranger typed", () => {
    const said = submissionSubject("work-with-us", { note: "PLEASE CALL ME", name: "Mallory" });
    expect(said).not.toContain("PLEASE CALL ME");
    expect(said).not.toContain("Mallory");
  });
});

describe("submissionStatusNotice", () => {
  it("says nothing about a founder correcting their own filing", () => {
    for (const type of TYPES) expect(submissionStatusNotice(type, "new")).toBeNull();
  });

  it("says nothing about a conversation the person is already holding one end of", () => {
    for (const type of TYPES) expect(submissionStatusNotice(type, "in-conversation")).toBeNull();
  });

  it("speaks for every move a person is waiting on, whatever the form", () => {
    for (const type of TYPES) {
      for (const status of SPEAKING) {
        const notice = submissionStatusNotice(type, status);
        expect(notice, `${type} at ${status} said nothing`).toBeTruthy();
        expect(notice!.headline.length).toBeGreaterThan(10);
        expect(notice!.line.length).toBeGreaterThan(10);
      }
    }
  });

  it("says yes plainly and no plainly", () => {
    expect(submissionStatusNotice("work-with-us", "accepted")!.headline).toBe(
      "Yes to your proposal to work together",
    );
    expect(submissionStatusNotice("work-with-us", "declined")!.line).toContain("Thank you for sending it");
  });

  it("never leaks a pipeline word into anything a person reads", () => {
    for (const type of TYPES) {
      for (const status of SPEAKING) {
        const notice = submissionStatusNotice(type, status)!;
        const whole = `${notice.headline} ${notice.line}`.toLowerCase();
        for (const word of PIPELINE_WORDS) {
          expect(whole, `${type} at ${status} said "${word}" at the member`).not.toContain(word);
        }
      }
    }
  });

  it("refuses to speak for a status it does not know", () => {
    expect(submissionStatusNotice("work-with-us", "archived")).toBeNull();
    expect(submissionStatusNotice("work-with-us", "")).toBeNull();
  });
});
