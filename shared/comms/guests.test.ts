import { describe, expect, it } from "vitest";
import {
  GUEST_LINK_DAYS,
  GUEST_REFUSALS,
  GUEST_REFUSAL_WORDS,
  GUEST_REQUEST_HOURS,
  guestNameProblem,
  guestRefusal,
  guestsOn,
  type GuestFacts,
} from "./guests";

const NOW = Date.parse("2026-10-05T12:00:00Z");

/** A free public gathering tomorrow, in a village open to guests: every condition holds. */
const open = (over: Partial<GuestFacts> = {}): GuestFacts => ({
  commsLifecycle: "public",
  eventsLifecycle: "public",
  rsvpEnabled: true,
  kind: "gathering",
  layer: "public",
  status: "scheduled",
  seatPrice: 0,
  guestSetting: null,
  guestsDefault: true,
  startsAt: NOW + 86_400_000,
  now: NOW,
  ...over,
});

describe("who may say yes with no account (5.8)", () => {
  it("opens the door when every condition holds", () => {
    expect(guestRefusal(open())).toBeNull();
    expect(guestRefusal(open({ kind: "festival" }))).toBeNull();
  });

  it("refuses each condition on its own, with its own reason", () => {
    expect(guestRefusal(open({ kind: "sky" }))).toBe("not_a_gathering");
    expect(guestRefusal(open({ commsLifecycle: "members" }))).toBe("comms_closed");
    expect(guestRefusal(open({ commsLifecycle: "preview" }))).toBe("comms_closed");
    expect(guestRefusal(open({ commsLifecycle: "off" }))).toBe("comms_closed");
    expect(guestRefusal(open({ eventsLifecycle: "members" }))).toBe("calendar_closed");
    expect(guestRefusal(open({ rsvpEnabled: false }))).toBe("rsvp_closed");
    expect(guestRefusal(open({ layer: "village" }))).toBe("not_public");
    expect(guestRefusal(open({ status: "postponed" }))).toBe("not_open");
    expect(guestRefusal(open({ status: "draft" }))).toBe("not_open");
    expect(guestRefusal(open({ status: "cancelled" }))).toBe("not_open");
    expect(guestRefusal(open({ startsAt: NOW }))).toBe("started");
    expect(guestRefusal(open({ startsAt: NOW - 1 }))).toBe("started");
    expect(guestRefusal(open({ seatPrice: 5 }))).toBe("priced");
    expect(guestRefusal(open({ guestSetting: false }))).toBe("guests_off");
    expect(guestRefusal(open({ guestSetting: null, guestsDefault: false }))).toBe("guests_off");
  });

  it("lets a gathering's own setting beat the village dial, both ways", () => {
    expect(guestsOn(null, true)).toBe(true);
    expect(guestsOn(null, false)).toBe(false);
    expect(guestsOn(true, false)).toBe(true);
    expect(guestsOn(false, true)).toBe(false);
    expect(guestRefusal(open({ guestSetting: true, guestsDefault: false }))).toBeNull();
  });

  it("names the village's switch before the gathering's, so a host is never blamed for one they do not hold", () => {
    // A village-layer, priced gathering in a village that is not taking guests at all.
    expect(guestRefusal(open({ commsLifecycle: "members", layer: "village", seatPrice: 5 }))).toBe("comms_closed");
    expect(guestRefusal(open({ rsvpEnabled: false, guestSetting: false }))).toBe("rsvp_closed");
  });

  it("has words for every refusal, and none of them names an address", () => {
    for (const r of GUEST_REFUSALS) {
      expect(GUEST_REFUSAL_WORDS[r], r).toMatch(/\.$/);
      expect(GUEST_REFUSAL_WORDS[r], r).not.toContain("@");
    }
  });

  it("keeps a confirmation link alive exactly as long as the request it confirms", () => {
    expect(GUEST_REQUEST_HOURS).toBe(48);
    expect(GUEST_LINK_DAYS * 24).toBe(GUEST_REQUEST_HOURS);
  });
});

describe("a guest's name", () => {
  it("takes a name and refuses nothing, too much, or an address", () => {
    expect(guestNameProblem("Gale Guest")).toBeNull();
    expect(guestNameProblem("  ")).not.toBeNull();
    expect(guestNameProblem(undefined)).not.toBeNull();
    expect(guestNameProblem("x".repeat(121))).not.toBeNull();
    expect(guestNameProblem("x".repeat(120))).toBeNull();
    // An address typed as a name would land on the organiser's list.
    expect(guestNameProblem("gale@example.test")).not.toBeNull();
  });
});
