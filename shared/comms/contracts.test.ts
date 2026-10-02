import { describe, expect, it } from "vitest";
import { FORM_CONSENT_FIELD, formSubmittedTrigger, subjectRef } from "./contracts";
import {
  EMAIL_KINDS,
  LINK_PURPOSES,
  MESSAGE_STATUSES,
  PERMISSION_KINDS,
  SKIP_REASONS,
  contactIdOfGuestKey,
  guestPersonKey,
  isGuestKey,
} from "./kinds";

describe("the comms vocabulary", () => {
  it("holds exactly the words the spec fixes, in its order", () => {
    // docs/comms/BUILD_SPEC.md section 4. These strings are stored, so a
    // renamed one reads as unknown on every row written before the rename.
    expect([...EMAIL_KINDS]).toEqual(["essential", "events", "paths", "letters", "notices"]);
    expect([...MESSAGE_STATUSES]).toEqual([
      "queued", "sending", "sent", "delivered", "bounced", "complained", "failed", "skipped", "expired", "rehearsed", "cancelled",
    ]);
    expect([...SKIP_REASONS]).toEqual([
      "no_permission", "suppressed", "over_cap", "paused", "module_off", "not_configured", "bad_address", "expired", "duplicate",
    ]);
    expect([...LINK_PURPOSES]).toEqual([
      "unsubscribe", "preferences", "guest_confirm", "cant_make_it", "time_vote", "recap_answer", "letters_confirm", "rsvp_next",
    ]);
  });

  it("never asks permission for essential mail", () => {
    expect(PERMISSION_KINDS as readonly string[]).not.toContain("essential");
    expect([...PERMISSION_KINDS]).toEqual(EMAIL_KINDS.filter((k) => k !== "essential"));
  });
});

describe("person keys", () => {
  it("round-trips a guest and leaves a member's user id alone", () => {
    expect(guestPersonKey("ct-1")).toBe("guest:ct-1");
    expect(contactIdOfGuestKey("guest:ct-1")).toBe("ct-1");
    expect(isGuestKey("guest:ct-1")).toBe(true);
    expect(contactIdOfGuestKey("user-123")).toBeNull();
    expect(isGuestKey("user-123")).toBe(false);
    // A bare prefix names nobody.
    expect(contactIdOfGuestKey("guest:")).toBeNull();
  });
});

describe("a submitted form's trigger", () => {
  it("carries the address, the name and a yes only when the box was really ticked", () => {
    expect(formSubmittedTrigger("resident", "sub-1", { email: " ana@example.test ", name: "Ana", [FORM_CONSENT_FIELD]: true })).toEqual({
      type: "form_submitted",
      formType: "resident",
      submissionId: "sub-1",
      email: "ana@example.test",
      name: "Ana",
      consentPaths: true,
    });
    // A string "true" is not a ticked box, and neither is anything else.
    for (const notAYes of ["true", 1, "on", null, undefined]) {
      expect(formSubmittedTrigger("resident", "sub-2", { [FORM_CONSENT_FIELD]: notAYes }).type).toBe("form_submitted");
      expect((formSubmittedTrigger("resident", "sub-2", { [FORM_CONSENT_FIELD]: notAYes }) as any).consentPaths).toBe(false);
    }
  });

  it("reads a first name when there is no full name, and survives data that is not an object", () => {
    expect((formSubmittedTrigger("contact", "sub-3", { firstName: "Bo" }) as any).name).toBe("Bo");
    expect(formSubmittedTrigger("contact", "sub-4", "garbage")).toMatchObject({ email: null, name: null, consentPaths: false });
  });
});

describe("subject references", () => {
  it("spell every subject one way, so a prefix stops where an id does", () => {
    expect(subjectRef.event("ev-1", "")).toBe("event:ev-1:");
    expect(subjectRef.event("ev-1", "2026-10-09")).toBe("event:ev-1:2026-10-09");
    expect(subjectRef.eventPrefix("ev-1")).toBe("event:ev-1");
    expect(subjectRef.path("resident")).toBe("path:resident");
    expect(subjectRef.form("sub-1")).toBe("form:sub-1");
    expect(subjectRef.account()).toBe("account");
    expect(subjectRef.poll("pl-1")).toBe("poll:pl-1");
  });
});
