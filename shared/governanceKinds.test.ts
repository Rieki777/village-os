/**
 * The two clocks, proven with no database at all.
 *
 * Every rule here is one sentence of the founder's, read literally:
 *
 *  - a token send chosen at_acceptance executes at close;
 *  - a Game change never executes at close, and chosen at_acceptance lands at
 *    closes_at + 72 hours;
 *  - anything chosen next_moon lands at the LATER of the next new moon and
 *    closes_at + 72 hours, which is the late-carry jump;
 *  - a bundle mixing the two is wholly a Game change;
 *  - the Birthing executes at pass with no window at all, and is now the only
 *    subject that does: a seating WAITS its window and admits no veto
 *    (Rye, 2026-09-04);
 *  - a veto at the landing instant is too late.
 */
import { describe, expect, it } from "vitest";
import {
  ADVISORY_SUBJECT,
  DEFAULT_TIMING,
  defaultTimingFor,
  noCloserRefusal,
  executesAtPassWithNoWindow,
  isSeatSubject,
  NO_WINDOW_SUBJECTS,
  kindOfItem,
  kindOfSet,
  kindOfSubject,
  landingFor,
  lateVetoRefusal,
  timingOf,
  payoutWaitsForWindow,
  vetoHoursFrom,
  vetoIsInTime,
  VETO_HOURS_FLOOR,
} from "./governanceKinds";
import { VARIABLES_BY_KEY } from "./gameVariables";

const CLOSE = new Date("2026-09-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
/** A moon far away, so the window is never the later of the two. */
const farMoon = () => new Date(CLOSE.getTime() + 20 * 24 * HOUR);
/** A moon inside the window, so the 72 hours wins. */
const nearMoon = () => new Date(CLOSE.getTime() + 6 * HOUR);

describe("what kind of decision this is", () => {
  it("classifies an unknown subject as a Game change, which is the fail-safe direction", () => {
    expect(kindOfSubject("something_a_later_lane_added")).toBe("game_change");
    expect(kindOfSubject("mechanics")).toBe("game_change");
    expect(kindOfSubject("token_send")).toBe("token_send");
  });

  it("calls a weight allocation a Game change, because it writes a number and never a token", () => {
    expect(kindOfItem("weight_allocation")).toBe("game_change");
    expect(kindOfItem("mint_rule")).toBe("game_change");
    expect(kindOfItem("token_send")).toBe("token_send");
  });

  it("makes a bundle mixing the two wholly a Game change", () => {
    expect(kindOfSet(["token_send"])).toBe("token_send");
    expect(kindOfSet(["token_send", "dial"])).toBe("game_change");
    expect(kindOfSet([])).toBe("game_change");
  });
});

describe("the timing choice", () => {
  it("defaults to the new moon and reads anything else back total", () => {
    expect(DEFAULT_TIMING).toBe("next_moon");
    expect(timingOf(undefined)).toBe("next_moon");
    expect(timingOf("AT_ACCEPTANCE")).toBe("at_acceptance");
    expect(timingOf("whatever")).toBe("next_moon");
  });

  it("floors the window at 72 hours and lets a village give longer", () => {
    expect(vetoHoursFrom(1)).toBe(VETO_HOURS_FLOOR);
    expect(vetoHoursFrom(undefined)).toBe(72);
    expect(vetoHoursFrom(168)).toBe(168);
  });
});

describe("when a carried decision lands", () => {
  it("executes a token send chosen at_acceptance at the close, with no window", () => {
    const l = landingFor({ closesAt: CLOSE, kind: "token_send", timing: "at_acceptance", vetoHours: 72, nextBoundaryAfter: farMoon });
    expect(l.executesAtClose).toBe(true);
    expect(l.landsAt).toBeNull();
    expect(l.vetoClosesAt).toBeNull();
  });

  it("never executes a Game change at the close, even chosen at_acceptance", () => {
    const l = landingFor({ closesAt: CLOSE, kind: "game_change", timing: "at_acceptance", vetoHours: 72, nextBoundaryAfter: farMoon });
    expect(l.executesAtClose).toBe(false);
    expect(l.landsAt?.toISOString()).toBe(new Date(CLOSE.getTime() + 72 * HOUR).toISOString());
    expect(l.vetoClosesAt?.toISOString()).toBe(l.landsAt?.toISOString());
  });

  it("lands on the new moon when the vote closes with more than 72 hours of the lunation left", () => {
    const l = landingFor({ closesAt: CLOSE, kind: "game_change", timing: "next_moon", vetoHours: 72, nextBoundaryAfter: farMoon });
    expect(l.landsAt?.toISOString()).toBe(farMoon().toISOString());
  });

  it("lands at closes_at plus 72 hours when the vote closes on the last day", () => {
    const l = landingFor({ closesAt: CLOSE, kind: "game_change", timing: "next_moon", vetoHours: 72, nextBoundaryAfter: nearMoon });
    expect(l.landsAt?.toISOString()).toBe(new Date(CLOSE.getTime() + 72 * HOUR).toISOString());
    expect(l.because).toContain("72");
  });

  it("gives a token send chosen next_moon a window like anything else", () => {
    const l = landingFor({ closesAt: CLOSE, kind: "token_send", timing: "next_moon", vetoHours: 72, nextBoundaryAfter: farMoon });
    expect(l.executesAtClose).toBe(false);
    expect(l.landsAt?.toISOString()).toBe(farMoon().toISOString());
  });

  it("honours a village that gives its stewards longer than the floor", () => {
    const l = landingFor({ closesAt: CLOSE, kind: "game_change", timing: "at_acceptance", vetoHours: 168, nextBoundaryAfter: farMoon });
    expect(l.landsAt?.toISOString()).toBe(new Date(CLOSE.getTime() + 168 * HOUR).toISOString());
  });

  it("makes a seating WAIT its window and admit no veto, so a seat cannot hold its own removal", () => {
    /*
     * THIS TEST USED TO ASSERT THE OPPOSITE, and the change is Rye's, 2026-09-04:
     * a seating takes the window and stays un-vetoable instead of skipping both.
     *
     * The PROTECTION in the old title is what survives and is what this still
     * proves. A steward whose removal waits inside a window they hold is a seat
     * nobody can remove; skipping the window closed that by deleting the wait,
     * and closing the door closes it by deleting the veto. The second is the
     * narrower cut and it is the one 20.11 had already made for the veto map.
     */
    expect(isSeatSubject("role_unseat")).toBe(true);
    expect(isSeatSubject("role_seat")).toBe(true);
    expect(isSeatSubject("mechanics")).toBe(false);
    // And they are no longer in the no-window set, which is the half that moved.
    expect(executesAtPassWithNoWindow("role_unseat")).toBe(false);
    expect(executesAtPassWithNoWindow("role_seat")).toBe(false);
    expect(executesAtPassWithNoWindow("mechanics")).toBe(false);

    const seating = landingFor({
      closesAt: CLOSE, kind: "game_change", timing: "next_moon", vetoHours: 72,
      nextBoundaryAfter: farMoon, notVetoable: true,
    });
    expect(seating.executesAtClose, "it waits now").toBe(false);
    expect(seating.landsAt, "with an instant the village can read").not.toBeNull();
    expect(seating.vetoable, "and no door, which is the protection").toBe(false);
  });

  it("still lets the Birthing carry the moment it passes, and it is the only one left", () => {
    // Rye, 2026-09-04: "Leave it exempt! It passes the moment everyone votes
    // yes!" Before the Birthing there is no seat, so a window would be 72 hours
    // nobody could use, and it already needs every seat to vote and every one
    // to say yes.
    expect(executesAtPassWithNoWindow("village_launch")).toBe(true);
    expect(Array.from(NO_WINDOW_SUBJECTS)).toEqual(["village_launch"]);
    const l = landingFor({ closesAt: CLOSE, kind: "game_change", timing: "next_moon", vetoHours: 72, nextBoundaryAfter: farMoon, noWindow: true });
    expect(l.executesAtClose).toBe(true);
    expect(l.landsAt).toBeNull();
  });
});

describe("the window's edge", () => {
  const landsAt = new Date(CLOSE.getTime() + 72 * HOUR);

  it("allows a veto a second before the instant", () => {
    expect(vetoIsInTime(landsAt, new Date(landsAt.getTime() - 1000))).toBe(true);
  });

  it("refuses one AT the instant, so a tie is never decided by tick phase", () => {
    expect(vetoIsInTime(landsAt, landsAt)).toBe(false);
    expect(vetoIsInTime(landsAt, new Date(landsAt.getTime() + 1000))).toBe(false);
  });

  it("refuses a veto on something with no window at all", () => {
    expect(vetoIsInTime(null, CLOSE)).toBe(false);
  });

  it("names the instant it missed", () => {
    expect(lateVetoRefusal(landsAt)).toContain(landsAt.toISOString());
  });
});

/**
 * ── THE FIX WAVE OF 2026-09-03 ─────────────────────────────────────────────
 *
 * Four rules the dispatcher lane's first pass got wrong, each one a sentence of
 * section 20.11 or of the second audit.
 */
describe("the timing default is per kind", () => {
  it("defaults a token send to at acceptance and a Game change to the moon", () => {
    // Before this, one flat default sent every payout to the next moon, so a
    // quest payout voted on day two waited twenty-seven days and then gained a
    // post-close steward window 19D says a token send cannot have.
    expect(defaultTimingFor("token_send")).toBe("at_acceptance");
    expect(defaultTimingFor("game_change")).toBe("next_moon");
  });

  it("reads an unreadable timing as the kind's default, and a stated one as itself", () => {
    expect(timingOf(undefined, defaultTimingFor("token_send"))).toBe("at_acceptance");
    expect(timingOf("nonsense", defaultTimingFor("token_send"))).toBe("at_acceptance");
    expect(timingOf("next_moon", defaultTimingFor("token_send"))).toBe("next_moon");
    // The bare call keeps the Game-change default, which is the fail-safe one.
    expect(timingOf(undefined)).toBe(DEFAULT_TIMING);
  });
});

describe("not vetoable is not the same fact as no window", () => {
  it("keeps the instant, the countdown and the wait, and takes away only the door", () => {
    const l = landingFor({
      closesAt: CLOSE, kind: "game_change", timing: "next_moon", vetoHours: 72,
      nextBoundaryAfter: farMoon, notVetoable: true,
    });
    expect(l.executesAtClose, "it still waits").toBe(false);
    expect(l.landsAt?.toISOString()).toBe(farMoon().toISOString());
    expect(l.vetoable).toBe(false);
    expect(l.because).toContain("Nobody can stop this one");
  });

  it("says a steward can stop an ordinary Game change", () => {
    const l = landingFor({ closesAt: CLOSE, kind: "game_change", timing: "next_moon", vetoHours: 72, nextBoundaryAfter: farMoon });
    expect(l.vetoable).toBe(true);
    expect(l.because).toContain("A steward can stop it");
  });
});

describe("a set that moves a number the running cycle is settled against", () => {
  const boundary = () => new Date(CLOSE.getTime() + 20 * 24 * HOUR);

  it("snaps forward to the next boundary even when the proposer chose at acceptance", () => {
    const l = landingFor({
      closesAt: CLOSE, kind: "game_change", timing: "at_acceptance", vetoHours: 72,
      nextBoundaryAfter: boundary, snapToBoundary: true,
    });
    expect(l.landsAt?.toISOString()).toBe(boundary().toISOString());
    expect(l.because).toContain("waits for the cycle to turn");
  });

  it("snaps a token send at acceptance too, rather than executing at the close", () => {
    const l = landingFor({
      closesAt: CLOSE, kind: "token_send", timing: "at_acceptance", vetoHours: 72,
      nextBoundaryAfter: boundary, snapToBoundary: true,
    });
    expect(l.executesAtClose).toBe(false);
    expect(l.landsAt?.toISOString()).toBe(boundary().toISOString());
  });

  it("leaves an instant that already sits on a boundary where it is", () => {
    // `nextBoundaryAfter` is strict, so asking it about the instant itself
    // would push a decision a whole cycle further out for no reason.
    const windowShuts = new Date(CLOSE.getTime() + 72 * HOUR);
    const l = landingFor({
      closesAt: CLOSE, kind: "game_change", timing: "at_acceptance", vetoHours: 72,
      nextBoundaryAfter: (after: Date) => (after.getTime() < windowShuts.getTime() ? windowShuts : boundary()),
      snapToBoundary: true,
    });
    expect(l.landsAt?.toISOString()).toBe(windowShuts.toISOString());
  });
});

describe("a binding ballot cannot open on a subject nobody can close", () => {
  it("refuses, names the subject and points at the practice-vote door", () => {
    const refusal = noCloserRefusal("weather_forecast", false);
    expect(refusal).toContain("weather_forecast");
    expect(refusal).toContain("advisory");
  });

  it("lets an advisory vote through, which is the one honest shape of no closer", () => {
    expect(noCloserRefusal(ADVISORY_SUBJECT, false)).toBeNull();
  });

  it("lets every subject with a closer through", () => {
    expect(noCloserRefusal("mechanics", true)).toBeNull();
  });
});

describe("weight_allocation is a Game change, and the table says so once", () => {
  it("classifies it as a Game change, so a rewrite of the weight table waits inside a window", () => {
    // Both of the plan's prose lists could claim this one by name ("a founding
    // allocation" and "a structural change of any kind"), and a guess of
    // token_send would let a self-serving rewrite of the voting-weight table
    // execute at close with no window and nobody told.
    expect(kindOfItem("weight_allocation")).toBe("game_change");
    expect(kindOfSet(["weight_allocation"])).toBe("game_change");
    expect(kindOfSet(["token_send", "weight_allocation"])).toBe("game_change");
  });
});

describe("which payouts wait, and which go at once", () => {
  /*
   * Rye, 2026-09-04: payouts go the moment they pass, and a village can name an
   * amount above which one waits the three days instead, default 1000.
   */
  it("sends at or below the threshold and holds above it", () => {
    expect(payoutWaitsForWindow(999, 1000)).toBe(false);
    // Exactly the threshold GOES, because the setting reads "above this amount"
    // and a founder typing 1000 should get what that sentence says.
    expect(payoutWaitsForWindow(1000, 1000)).toBe(false);
    expect(payoutWaitsForWindow(1001, 1000)).toBe(true);
  });

  it("holds every payout at zero, which is how every cap here fails closed", () => {
    expect(payoutWaitsForWindow(1, 0)).toBe(true);
    expect(payoutWaitsForWindow(0, 0)).toBe(false);
  });

  it("holds rather than sends when either number is unreadable", () => {
    // The costs are not symmetric: holding a payout costs a delay, releasing
    // one costs a send nobody could stop.
    for (const bad of [undefined, null, "", "lots", NaN]) {
      expect(payoutWaitsForWindow(bad, 1000), `amount ${String(bad)} must hold`).toBe(true);
      expect(payoutWaitsForWindow(5000, bad), `threshold ${String(bad)} must hold`).toBe(true);
    }
  });

  it("ships the founder's default, read from the registry so it cannot drift", () => {
    expect(VARIABLES_BY_KEY["governance.payout_delay_over"]?.default).toBe("1000");
  });
});
