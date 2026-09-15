// @vitest-environment jsdom
/**
 * A carried decision never reads as settled before it lands.
 *
 * Rye, 2026-09-08: vetoed proposals "need to clearly show that they didn't pass",
 * and a decision "should never pass until the veto window expires". Rye,
 * 2026-09-14: "a member can see a countdown timer until it passes". The chip
 * word and the countdown are the two places a member reads that, so both are
 * pinned here against the landing the server sends.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import LandingClock, { landingReading } from "./LandingClock";
import { outcomeFor } from "./DecisionOutcome";
import type { Landing } from "./governanceApi";

const NOW = Date.parse("2026-09-14T12:00:00Z");
const CONSENT = "Every steward already said yes, so nobody can stop this one.";

const landing = (over: Partial<Landing> = {}): Landing => ({
  landsAt: "2026-09-15T12:00:00Z",
  landingStatus: "pending",
  vetoedAt: null,
  vetoLocked: true,
  lockedByConsent: true,
  countdownSentence: CONSENT,
  ...over,
});

describe("the word on a carried decision", () => {
  it("says carried and not yet in effect while the countdown runs, and is not law", () => {
    const o = outcomeFor("passed", landing(), NOW);
    expect(o.word).toBe("Carried, not yet in effect");
    expect(o.law).toBe(false);
  });

  it("reads as carried law once the instant has passed, once it has landed, or when no landing was read", () => {
    expect(outcomeFor("passed", landing({ landsAt: "2026-09-13T12:00:00Z" }), NOW).word).toBe("Carried");
    expect(outcomeFor("passed", landing({ landingStatus: "applied" }), NOW).law).toBe(true);
    expect(outcomeFor("passed", null, NOW).word).toBe("Carried");
  });

  it("reads as stopped when a steward stopped it, even on a build where the ballot still says passed", () => {
    const o = outcomeFor("passed", landing({ landingStatus: "vetoed", vetoedAt: "2026-09-14T10:00:00Z" }), NOW);
    expect(o.word).toBe("Stopped by a steward");
    expect(o.law).toBe(false);
  });

  it("says carried and not yet in effect when the server says its landing failed, whatever the instant", () => {
    const sentence = "The vote carried and the decision has not taken effect yet.";
    const stalled = outcomeFor("passed", landing({ landsAt: null, landingStatus: "stalled", notYetInEffect: sentence }), NOW);
    expect(stalled.word).toBe("Carried, not yet in effect");
    expect(stalled.law).toBe(false);
    // A row the landing job is retrying carries an instant already behind it.
    const retrying = outcomeFor("passed", landing({ landsAt: "2026-09-13T12:00:00Z", notYetInEffect: sentence }), NOW);
    expect(retrying.word).toBe("Carried, not yet in effect");
    expect(retrying.law).toBe(false);
    // A vote that did not carry is untouched by it.
    expect(outcomeFor("failed", landing({ notYetInEffect: sentence }), NOW).word).toBe("Did not carry");
  });

  it("leaves every status that did not carry exactly as the card had it", () => {
    expect(outcomeFor("failed", landing(), NOW).word).toBe("Did not carry");
    expect(outcomeFor("no_quorum", landing(), NOW).word).toBe("Too few spoke");
  });
});

describe("the countdown", () => {
  it("counts to the landing in words for a screen reader", () => {
    const r = landingReading("2026-09-15T15:00:00Z", NOW);
    expect(r.ended).toBe(false);
    expect(r.reading).toBe("1 day 3 hours until it takes effect");
    expect(landingReading("2026-09-14T11:00:00Z", NOW).ended).toBe(true);
  });

  it("renders the server's sentence under the clock", () => {
    render(<LandingClock landsAt={new Date(Date.now() + 26 * 3_600_000).toISOString()} sentence={CONSENT} />);
    expect(screen.getByText(/until it takes effect/, { selector: ".sr-only" })).toBeTruthy();
    expect(screen.getByText(/Every steward already said yes/)).toBeTruthy();
  });
});
