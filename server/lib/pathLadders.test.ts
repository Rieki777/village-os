/**
 * The four ladders, derived.
 *
 * The assertions worth having here are not "a rung can light". They are the
 * properties the whole design rests on, and every one of them is the kind that
 * rots silently:
 *
 *  1. A POSITION FALLS WITH NO UPDATE PATH. Ending a fact, withdrawing a
 *     reservation, closing a venture and letting a season turn each lower the
 *     answer with nothing written anywhere. Every ladder gets that case.
 *  2. HISTORY SURVIVES THE FALL, and only where a column proves it. Three
 *     places the record genuinely cannot say, and all three are asserted to
 *     stay silent rather than guess.
 *  3. NO NUMBER IS INVENTED. No ladder carries an amount, and the rungs are
 *     traceable to columns that exist.
 *  4. AN EXAMPLE ROW NEVER PROMOTES A REAL MEMBER.
 *
 * Pure, so none of it needs a database or a clock: `laddersFor` takes rows, a
 * lapse context and a moon resolver, and answers.
 */
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../../shared/gameConfig";
import {
  LADDER_PATH_IDS,
  PATH_LADDERS,
  type LadderRung,
  type PathLadder,
} from "../../shared/pathLadders";
import { INVESTOR_FACTS } from "../repos/investorPath";
import { RESERVATION_STATUSES } from "./housing";
import type { LapseContext } from "./orgChart";
import {
  investorLadder,
  laddersFor,
  prosperityLadder,
  residentLadder,
  stewardLadder,
  NO_MOONS,
  type SeatingFacts,
} from "./pathLadders";

/** A village whose seatings lapse at a season turn, currently in season two. */
const CTX: LapseContext = { currentSeasonId: "s2", cadence: "season_turn", now: new Date("2026-06-01T00:00:00Z") };

const seating = (over: Partial<SeatingFacts> = {}): SeatingFacts => ({
  orgRoleId: "role-1",
  holderKind: "member",
  seasonId: "s2",
  termEndsAt: null,
  startedAt: new Date("2026-03-01T00:00:00Z"),
  endedAt: null,
  endedReason: null,
  isExample: false,
  roleExpiresEachSeason: null,
  roleRepresentsCircle: false,
  roleActive: true,
  roleIsExample: false,
  ...over,
});

/** Which rung ids are lit, so a case reads as the fact it is checking. */
const lit = (ladder: PathLadder): string[] => ladder.rungs.filter((r) => r.lit).map((r) => r.id);

const rung = (ladder: PathLadder, id: string): LadderRung => ladder.rungs.find((r) => r.id === id)!;

describe("the ladders are defined against things that exist", () => {
  it("only names paths this village actually offers", () => {
    const offered = GAME_CONFIG.paths.map((p) => p.id);
    for (const id of LADDER_PATH_IDS) expect(offered).toContain(id);
  });

  /*
   * The investor rungs are matched to rows BY ID, so a rung id that is not a
   * fact string matches nothing and sits dark forever while looking exactly
   * like a rung somebody could climb. This is the assertion that catches it.
   */
  it("gives the investor path one rung per recorded fact, in order", () => {
    expect(PATH_LADDERS.investor.rungs.map((r) => r.id)).toEqual([...INVESTOR_FACTS]);
  });

  it("gives every rung on every ladder a column to read", () => {
    for (const id of LADDER_PATH_IDS) {
      for (const r of PATH_LADDERS[id].rungs) {
        expect(r.column.length).toBeGreaterThan(0);
        expect(r.name.length).toBeGreaterThan(0);
        expect(r.meaning.length).toBeGreaterThan(0);
      }
    }
  });

  /*
   * Four paths, four different lengths. A shared ladder would have to invent
   * the rungs the shorter paths do not have, which is the thing this design
   * exists to refuse. If somebody later flattens them into one list, this
   * fails.
   */
  it("gives each path its own shape", () => {
    expect(PATH_LADDERS.steward.rungs).toHaveLength(3);
    expect(PATH_LADDERS.resident.rungs).toHaveLength(3);
    expect(PATH_LADDERS.investor.rungs).toHaveLength(4);
    expect(PATH_LADDERS["prosperity-creator"].rungs).toHaveLength(2);
  });

  /*
   * No amount, no unit count, no currency, no valuation. `investor_path_facts`
   * has no numeric column and a database test holds that against
   * information_schema; this holds the same line on the words the member reads,
   * where a figure could arrive without any schema change at all.
   */
  it("puts no money on the investor ladder", () => {
    const words = PATH_LADDERS.investor.rungs
      .map((r) => `${r.name} ${r.meaning} ${r.column}`)
      .join(" ")
      .concat(" ", PATH_LADDERS.investor.empty.mechanic);
    expect(words).not.toMatch(/\d/);
    // ASCII escapes on purpose: a literal currency glyph in a source file is
    // one re-encoding away from being a different character.
    expect(words).not.toMatch(/[$£€]/);
    expect(words.toLowerCase()).not.toMatch(/amount|valuation|invested|holdings/);
  });
});

describe("steward", () => {
  it("lights nothing and names the mechanic when there is no seat", () => {
    const ladder = stewardLadder([], CTX, NO_MOONS);
    expect(ladder.position).toBe(0);
    expect(ladder.empty?.doorHref).toBe("/roles");
  });

  it("stands on a live seating whose season is the one running", () => {
    const ladder = stewardLadder([seating()], CTX, NO_MOONS);
    expect(lit(ladder)).toEqual(["seated", "mandate"]);
    expect(ladder.position).toBe(2);
    expect(ladder.empty).toBeNull();
  });

  /*
   * THE PUREST DROP IN THE PRODUCT. Nothing is written when a season turns:
   * the same row, read against a later season, answers one rung lower.
   */
  it("drops the mandate rung when the season turns, with the row untouched", () => {
    const rows = [seating({ seasonId: "s1" })];
    const before = stewardLadder(rows, { ...CTX, currentSeasonId: "s1" }, NO_MOONS);
    const after = stewardLadder(rows, { ...CTX, currentSeasonId: "s2" }, NO_MOONS);
    expect(before.position).toBe(2);
    expect(after.position).toBe(1);
    expect(rung(after, "mandate").note).toMatch(/season/i);
    // NOT claimed as reached: proving it was once current needs the season that
    // was running the day the seating was made, and nothing stores that.
    expect(rung(after, "mandate").fell).toBe(false);
  });

  it("drops the mandate rung when the term runs out", () => {
    const ladder = stewardLadder(
      [seating({ termEndsAt: new Date("2026-05-01T00:00:00Z") })],
      CTX,
      NO_MOONS,
    );
    expect(ladder.position).toBe(1);
    expect(rung(ladder, "mandate").note).toMatch(/term/i);
  });

  /*
   * `mayDeclare` opens for a LAPSED holder in as many words, so the top rung
   * must stay lit under a dark middle one. Dimming it would tell a member a
   * power had been taken away that the code has not taken away.
   */
  it("keeps the circle's pen lit while the mandate below it is dark", () => {
    const ladder = stewardLadder(
      [seating({ seasonId: "s1", roleRepresentsCircle: true })],
      CTX,
      NO_MOONS,
    );
    expect(lit(ladder)).toEqual(["seated", "speaks"]);
    expect(ladder.position).toBe(3);
  });

  it("falls to nothing when the seating ends, and still says it happened", () => {
    const ladder = stewardLadder(
      [seating({ endedAt: new Date("2026-05-01T00:00:00Z"), endedReason: "stood down" })],
      CTX,
      NO_MOONS,
    );
    expect(ladder.position).toBe(0);
    expect(rung(ladder, "seated").fell).toBe(true);
    expect(rung(ladder, "seated").note).toBe("stood down");
    // Something happened here, so this is not the empty state.
    expect(ladder.empty).toBeNull();
  });

  it("never lets an example seating promote anybody", () => {
    expect(stewardLadder([seating({ isExample: true })], CTX, NO_MOONS).position).toBe(0);
    expect(stewardLadder([seating({ roleIsExample: true })], CTX, NO_MOONS).position).toBe(0);
  });

  it("ignores a documented holder that is not this member's own seating", () => {
    expect(stewardLadder([seating({ holderKind: "documented" })], CTX, NO_MOONS).position).toBe(0);
  });

  /* A seat that has been deactivated no longer speaks for its circle. */
  it("drops the pen when the seat is no longer active", () => {
    const ladder = stewardLadder(
      [seating({ roleRepresentsCircle: true, roleActive: false })],
      CTX,
      NO_MOONS,
    );
    expect(lit(ladder)).toEqual(["seated", "mandate"]);
  });
});

describe("resident", () => {
  it("names the mechanic and the door when there is no request", () => {
    const ladder = residentLadder([], NO_MOONS);
    expect(ladder.position).toBe(0);
    expect(ladder.empty?.doorHref).toBe("/reserve");
  });

  it("climbs with the status the village files it under", () => {
    const asked = residentLadder([{ status: "new", createdAt: "2026-03-01T00:00:00Z" }], NO_MOONS);
    const spoken = residentLadder([{ status: "contacted", createdAt: "2026-03-01T00:00:00Z" }], NO_MOONS);
    const held = residentLadder([{ status: "reserved", createdAt: "2026-03-01T00:00:00Z" }], NO_MOONS);
    expect(asked.position).toBe(1);
    expect(spoken.position).toBe(2);
    expect(held.position).toBe(3);
  });

  it("drops every rung when the request is withdrawn, and keeps the asking", () => {
    const ladder = residentLadder(
      [{ status: "withdrawn", createdAt: "2026-03-01T00:00:00Z" }],
      NO_MOONS,
    );
    expect(ladder.position).toBe(0);
    expect(rung(ladder, "enquired").fell).toBe(true);
    // NO DATE. `status` is one mutable column with no history, so nothing on
    // this table says when the request was closed, and nothing invents it.
    expect(rung(ladder, "enquired").moon).toBeNull();
    // And nothing above it is claimed either: a row withdrawn from `reserved`
    // leaves no trace that it ever was.
    expect(rung(ladder, "contacted").fell).toBe(false);
    expect(rung(ladder, "held").fell).toBe(false);
  });

  it("takes the furthest request when a member holds several", () => {
    const ladder = residentLadder(
      [
        { status: "new", createdAt: "2026-04-01T00:00:00Z" },
        { status: "reserved", createdAt: "2026-03-01T00:00:00Z" },
      ],
      NO_MOONS,
    );
    expect(ladder.position).toBe(3);
  });

  /* A status this build does not know holds no rung. Fail closed, never up. */
  it("gives an unrecognised status no rung at all", () => {
    const ladder = residentLadder([{ status: "escrow", createdAt: "2026-03-01T00:00:00Z" }], NO_MOONS);
    expect(ladder.position).toBe(0);
    expect(RESERVATION_STATUSES).not.toContain("escrow");
  });
});

describe("investor", () => {
  const fact = (name: string, endedAt: string | null = null, endedReason: string | null = null) => ({
    fact: name,
    startedAt: "2026-03-01T00:00:00Z",
    endedAt,
    endedReason,
  });

  it("says nothing at all before a fact is recorded", () => {
    const ladder = investorLadder([], NO_MOONS);
    expect(ladder.position).toBe(0);
    expect(ladder.empty).not.toBeNull();
    // Two of the four leave the door blank: the tile already carries the
    // path's own, and a second link to it two lines below is noise.
    expect(ladder.empty?.doorHref).toBe("");
  });

  it("stands on the furthest live fact", () => {
    const ladder = investorLadder([fact("interest_registered"), fact("packet_released")], NO_MOONS);
    expect(ladder.position).toBe(2);
  });

  /*
   * The requirement in one case: end the fact, and the next read finds one
   * fewer live row and answers lower. Nothing was written to say so.
   */
  it("falls when a fact ends, and the record still carries why", () => {
    const live = investorLadder([fact("packet_released")], NO_MOONS);
    const ended = investorLadder(
      [fact("packet_released", "2026-05-01T00:00:00Z", "access withdrawn")],
      NO_MOONS,
    );
    expect(live.position).toBe(2);
    expect(ended.position).toBe(0);
    expect(rung(ended, "packet_released").fell).toBe(true);
    expect(rung(ended, "packet_released").note).toBe("access withdrawn");
  });

  /*
   * A GAP IS A REAL STATE, and the position is the highest LIT rung and never
   * a count of them. A member whose packet was withdrawn under a signed
   * agreement is at the agreement, and counting would report them two rungs
   * further back than they are.
   */
  it("reads the highest live fact even with a dark rung under it", () => {
    const ladder = investorLadder(
      [
        fact("interest_registered"),
        fact("packet_released", "2026-05-01T00:00:00Z", "expired"),
        fact("agreement_signed"),
      ],
      NO_MOONS,
    );
    expect(ladder.position).toBe(4);
    expect(lit(ladder)).toEqual(["interest_registered", "agreement_signed"]);
    expect(rung(ladder, "packet_released").fell).toBe(true);
  });

  it("never counts an example fact", () => {
    const ladder = investorLadder([{ ...fact("agreement_signed"), isExample: true }], NO_MOONS);
    expect(ladder.position).toBe(0);
  });
});

describe("prosperity creator", () => {
  const venture = (over: Record<string, unknown> = {}) => ({
    openedAt: "2026-03-01T00:00:00Z",
    listedAt: null as string | null,
    closedAt: null as string | null,
    closedReason: null as string | null,
    ...over,
  });

  it("says nothing before a venture exists", () => {
    expect(prosperityLadder([], NO_MOONS).position).toBe(0);
    expect(prosperityLadder([], NO_MOONS).empty).not.toBeNull();
  });

  it("separates opening from publishing, because the dates do", () => {
    expect(prosperityLadder([venture()], NO_MOONS).position).toBe(1);
    expect(prosperityLadder([venture({ listedAt: "2026-04-01T00:00:00Z" })], NO_MOONS).position).toBe(2);
  });

  it("falls to nothing when the venture closes, and keeps both facts", () => {
    const ladder = prosperityLadder(
      [
        venture({
          listedAt: "2026-04-01T00:00:00Z",
          closedAt: "2026-05-01T00:00:00Z",
          closedReason: "wound up",
        }),
      ],
      NO_MOONS,
    );
    expect(ladder.position).toBe(0);
    expect(rung(ladder, "opened").fell).toBe(true);
    expect(rung(ladder, "listed").fell).toBe(true);
    expect(rung(ladder, "listed").note).toBe("wound up");
  });

  /*
   * UNLISTING ERASES ITS OWN EVIDENCE. `setVentureListed(false)` writes NULL
   * back into `listed_at`, so nothing on the row says it was ever published.
   * The rung goes dark and claims nothing, which is the honest answer and the
   * one a stored rung could not give.
   */
  it("claims nothing about a venture that was taken back down", () => {
    const ladder = prosperityLadder([venture()], NO_MOONS);
    expect(rung(ladder, "listed").lit).toBe(false);
    expect(rung(ladder, "listed").fell).toBe(false);
    expect(rung(ladder, "listed").note).toBeNull();
  });

  it("never counts an example venture", () => {
    expect(prosperityLadder([venture({ isExample: true })], NO_MOONS).position).toBe(0);
  });
});

describe("which ladders a member is handed", () => {
  it("gives no ladder for a path the member does not walk", () => {
    const out = laddersFor(
      ["investor"],
      { seatings: [seating()], investorFacts: [] },
      CTX,
      NO_MOONS,
    );
    expect(out.map((l) => l.pathId)).toEqual(["investor"]);
  });

  it("gives no ladder for a path this build has no columns for", () => {
    expect(laddersFor(["elder"], {}, CTX, NO_MOONS)).toEqual([]);
  });

  it("draws them in the member's own order and never twice", () => {
    const out = laddersFor(["resident", "steward", "resident"], {}, CTX, NO_MOONS);
    expect(out.map((l) => l.pathId)).toEqual(["resident", "steward"]);
  });

  /* A rung is never stored, so nothing on the way out may look like one. */
  it("sends no stored position anywhere in the payload", () => {
    const wire = JSON.stringify(laddersFor(["steward"], { seatings: [seating()] }, CTX, NO_MOONS));
    expect(wire).not.toMatch(/"rung"/);
    expect(wire).not.toMatch(/"toRung"/);
  });
});
