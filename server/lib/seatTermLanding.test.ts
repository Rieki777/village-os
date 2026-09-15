/**
 * WHEN A SEAT VOTE LANDS, which is when a voted seat starts.
 *
 * `seatVoteLandsAt` has to answer the instant the close path will stamp, so
 * the cases hold it to `landingOf` over the ballot `openBallot` would write,
 * and the last case shows the defect it exists for on a real calendar. Every
 * instant is fixed; nothing here reads the clock.
 */
import { describe, expect, it } from "vitest";
import { seatVoteLandsAt } from "./seatTermLanding";
import { landingOf } from "./applyDue";
import { ballotWindow, type BallotRow } from "./ballots";
import { defaultTimingFor, kindOfSubject } from "../../shared/governanceKinds";
import { resolveSeatTerm, type SeatCalendar } from "../../shared/seatTerms";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Part way through a second, so the whole-second open shows. */
const NOW = new Date("2026-12-10T09:30:15.678Z");
const OPENED = new Date("2026-12-10T09:30:15.000Z");
const CLOSE = OPENED.getTime() + 7 * DAY;

const clock = (boundary: (after: Date) => Date, vetoHours = 72, consentNoticeHours?: unknown) => ({
  vetoHours: () => vetoHours,
  nextBoundaryAfter: boundary,
  consentNoticeHours: () => consentNoticeHours,
});
const at = (ms: number) => () => new Date(ms);

describe("the vote's close, shared with openBallot", () => {
  it("opens on the whole second and runs whole days between one and ninety", () => {
    expect(ballotWindow(7, NOW.getTime())).toEqual({ days: 7, opensAt: OPENED, closesAt: new Date(CLOSE) });
    expect(ballotWindow(0.4, NOW.getTime()).days).toBe(1);
    expect(ballotWindow(400, NOW.getTime()).days).toBe(90);
  });
});

describe("seatVoteLandsAt", () => {
  it("lands on the next boundary after the CLOSE when that is later than the window", () => {
    const moon = CLOSE + 20 * DAY;
    let asked: Date | null = null;
    const lands = seatVoteLandsAt(clock((after) => { asked = after; return new Date(moon); }), 7, NOW);
    expect(lands.getTime()).toBe(moon);
    expect(asked!.getTime(), "the boundary is asked after the close, never the open").toBe(CLOSE);
  });

  it("lands the whole window after the close when the boundary is nearer", () => {
    expect(seatVoteLandsAt(clock(at(CLOSE + DAY)), 7, NOW).getTime()).toBe(CLOSE + 72 * HOUR);
  });

  it("floors the window at 72 hours and honours a longer one", () => {
    expect(seatVoteLandsAt(clock(at(CLOSE + HOUR), 10), 7, NOW).getTime()).toBe(CLOSE + 72 * HOUR);
    expect(seatVoteLandsAt(clock(at(CLOSE + HOUR), 120), 7, NOW).getTime()).toBe(CLOSE + 120 * HOUR);
  });

  it("matches what the close path stamps, whatever the extra facts it passes say", () => {
    // The close path adds consent, the two tier facts and a snap it reads as
    // false for a subject with no change set. None of them may move a seat.
    const deps = clock(at(CLOSE + 2 * DAY), 96, 0);
    const ballot = {
      subjectType: "role_seat",
      opensAt: OPENED.toISOString(),
      closesAt: new Date(CLOSE).toISOString(),
      timing: defaultTimingFor(kindOfSubject("role_seat")),
    } as BallotRow;
    const forecast = seatVoteLandsAt(deps, 7, NOW).getTime();
    expect(forecast).toBe(CLOSE + 96 * HOUR);
    for (const stewardConsent of [false, true]) {
      for (const outOfTierReach of [false, true]) {
        for (const editsVetoMap of [false, true]) {
          const stamped = landingOf(deps, { ballot, stewardConsent, outOfTierReach, editsVetoMap, snapToBoundary: false });
          expect(stamped.landsAt?.getTime(), JSON.stringify({ stewardConsent, outOfTierReach, editsVetoMap })).toBe(forecast);
        }
      }
    }
  });

  it("THE DEFECT: measured from the close, a vote across the turn froze a season end its seat never reaches", () => {
    // Autumn turns on 2026-12-21. The vote opens on the 10th and closes on the
    // 17th, and the boundary after the close is the 29th, so it lands in winter.
    const calendar: SeatCalendar = {
      timezone: "UTC",
      currentSeasonId: "autumn",
      seasons: [
        { id: "autumn", startsOn: "2026-09-22", endsOn: "2026-12-21" },
        { id: "winter", startsOn: "2026-12-21", endsOn: "2027-03-20" },
      ],
    };
    const lands = seatVoteLandsAt(clock(at(Date.parse("2026-12-29T00:00:00Z"))), 7, NOW);
    expect(lands.toISOString()).toBe("2026-12-29T00:00:00.000Z");

    const fromClose = resolveSeatTerm({ calendar, capAtSeasonEnd: true, now: NOW, startsNoEarlierThan: new Date(CLOSE) });
    expect(fromClose.ok && fromClose.endsOn, "the close still sits in autumn").toBe("2026-12-21");
    expect(fromClose.ok && fromClose.endsAt.getTime() < lands.getTime(), "so the term is over before the seat lands").toBe(true);

    const fromLanding = resolveSeatTerm({ calendar, capAtSeasonEnd: true, now: NOW, startsNoEarlierThan: lands });
    expect(fromLanding.ok && fromLanding.endsOn).toBe("2027-03-20");
    expect(fromLanding.ok && fromLanding.seasonId).toBe("winter");
  });
});
