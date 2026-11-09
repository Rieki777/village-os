/**
 * A PROPOSAL FOR THIS MOON (Rye, 9 Nov 2026): "for this batch of roles going
 * out this week they'll be making proposals that start at this new moon
 * (today) for the next new moon". A village chooses, in the open-proposals
 * desk, whether its public proposals are for next season (the default, as
 * before) or for the moon. A moon proposal runs from the moon it is sent in
 * to the next new moon; late in a moon it is for the next one, so nobody is
 * adopted into a role with days left on it.
 */
import { describe, expect, it } from "vitest";
import { LUNAR_CLOCK } from "./cycleClock";
import { MOON_TERM_MIN_DAYS, moonTermFor, moonTermWords } from "./openProposalTerm";
import { confirmLetter, openBodyOf } from "./openProposals";
import { adoptedInviteLetter } from "./openProposalDecide";

const TZ = "America/Costa_Rica";

describe("moonTermFor", () => {
  it("is the moon it is asked in, from its new moon to the next, as civil days", () => {
    // 9 Nov 2026: a new moon that morning (07:03 UTC); the next is 9 Dec 00:53 UTC (8 Dec in Costa Rica).
    const t = moonTermFor(new Date("2026-11-09T18:00:00Z"), LUNAR_CLOCK, TZ);
    expect(t).toEqual({ kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" });
  });

  it("is the next moon when fewer than the minimum days are left", () => {
    const late = new Date("2026-12-05T18:00:00Z");
    const t = moonTermFor(late, LUNAR_CLOCK, TZ);
    expect(t.startsOn >= "2026-12-08").toBe(true);
    expect(t.endsOn > "2027-01-01").toBe(true);
    expect(MOON_TERM_MIN_DAYS).toBeGreaterThan(0);
  });
});

describe("the words", () => {
  it("names the days, never 'next season'", () => {
    expect(moonTermWords({ kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" })).toBe("this moon, from 9 November 2026 to 8 December 2026");
  });

  it("puts the moon in the confirmation and the adoption letters", () => {
    const when = moonTermWords({ kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" });
    expect(confirmLetter({ firstName: "Juno", village: "Amora", roleNames: ["Lead Financial Steward"], link: "https://x", when }).text).toContain(
      "You proposed to hold Lead Financial Steward in Amora for this moon, from 9 November 2026 to 8 December 2026.",
    );
    const yes = adoptedInviteLetter({ firstName: "Juno", village: "Amora", roleNames: ["Lead Financial Steward"], season: null, startsOn: "9 November 2026", moon: { from: "9 November 2026", to: "8 December 2026" }, link: "https://x", days: 14 });
    expect(yes.text).toContain("adopted your proposal to hold Lead Financial Steward this moon.");
    expect(yes.text).toContain("Your roles run from 9 November 2026 to the next new moon, 8 December 2026.");
    expect(yes.text).not.toContain("next season");
  });

  it("keeps a season proposal's words as they were", () => {
    expect(confirmLetter({ firstName: null, village: "Amora", roleNames: ["Cook"], link: "https://x" }).text).toContain("in Amora next season.");
  });
});

describe("the stored body keeps a valid term and drops anything else", () => {
  it("round-trips a moon term", () => {
    const body = openBodyOf({ roles: [{ roleId: "r1", note: "" }], why: "w", aim: "", term: { kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" } });
    expect(body.term).toEqual({ kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" });
  });

  it("drops a malformed term, so the proposal reads as a season one", () => {
    expect(openBodyOf({ roles: [], why: "", aim: "", term: { kind: "moon", startsOn: "soon", endsOn: "later" } }).term).toBeUndefined();
    expect(openBodyOf({ roles: [], why: "", aim: "", term: { kind: "decade" } }).term).toBeUndefined();
  });
});
