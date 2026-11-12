import { describe, expect, it } from "vitest";
import { effectiveTimeZone, isValidTimeZone, normalizeTimeZone, twoZones } from "./memberTimeZone";
import { NO_BOOKING_COPY, bookingOffer, bookingSteps, parseBookingUrl } from "./roleBooking";

describe("time zones", () => {
  it("accepts IANA names and refuses everything else", () => {
    expect(isValidTimeZone("America/Costa_Rica")).toBe(true);
    for (const bad of ["", "CST", "+02:00", "Mars/Olympus", "x".repeat(80), null, 5]) expect(isValidTimeZone(bad)).toBe(false);
    expect(normalizeTimeZone(" Europe/Lisbon ")).toBe("Europe/Lisbon");
  });
  it("defaults from the browser, then UTC", () => {
    expect(effectiveTimeZone(null, "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(effectiveTimeZone("Europe/Lisbon", "Asia/Tokyo")).toBe("Europe/Lisbon");
    expect(effectiveTimeZone("nonsense", null)).toBe("UTC");
  });
  it("shows both zones when they differ", () => {
    const t = twoZones("2026-11-17T01:00:00Z", "America/Costa_Rica", "Europe/Lisbon", "for them");
    expect(t.differ).toBe(true);
    expect(t.mine).toContain("7:00 PM");
    expect(t.theirs).toContain("1:00 AM");
    expect(t.line).toContain(t.mine);
    expect(t.line).toContain("for them");
  });
  it("shows one zone when they read the same", () => {
    const t = twoZones("2026-11-17T01:00:00Z", "Europe/Lisbon", "Europe/London");
    expect(t.differ).toBe(false);
    expect(t.theirs).toBeNull();
    expect(twoZones("2026-11-17T01:00:00Z", "UTC", null).line).toBe(twoZones("2026-11-17T01:00:00Z", "UTC", "UTC").line);
  });
});

describe("booking links", () => {
  it("refuses non-https links", () => {
    for (const bad of ["http://cal.example/x", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "//cal.example", "cal.example/x", "https://u:p@cal.example/x", "", null, 7, "https://" + "a".repeat(300) + ".example"]) {
      expect(parseBookingUrl(bad)).toBeNull();
    }
    expect(parseBookingUrl(" https://calendar.app.google/abc ")).toBe("https://calendar.app.google/abc");
  });
  it("says we'll write when there is no usable link", () => {
    expect(bookingOffer(null)).toEqual({ kind: "write", text: NO_BOOKING_COPY });
    expect(bookingOffer("http://cal.example/x").kind).toBe("write");
    expect(NO_BOOKING_COPY).toBe("We'll write to you with times");
  });
  it("orders the first conversation, interviews, then the access session", () => {
    const steps = bookingSteps([
      { step: "access_session", roleName: "Technical Operations", bookingUrl: "https://cal.example/t" },
      { step: "interview", roleName: "A", bookingUrl: "https://cal.example/a" },
      { step: "first_conversation", roleName: "Human Operations & Onboarding" },
      { step: "interview", roleName: "B", bookingUrl: "http://bad.example" },
    ]);
    expect(steps.map((s) => s.step)).toEqual(["first_conversation", "interview", "interview", "access_session"]);
    expect(steps.map((s) => s.order)).toEqual([null, 1, 2, null]);
    expect(steps[0].offer.kind).toBe("write");
    expect(steps[1].offer.kind).toBe("link");
    expect(steps[2].offer.kind).toBe("write");
  });
});
