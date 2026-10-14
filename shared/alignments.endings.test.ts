/**
 * IN FORCE, WITH ENDINGS, AS A TABLE (seat settings PR8).
 *
 * `deriveAlignmentState` over every ending the spec names: a notice running
 * and a notice taken effect, a notice taken back, an ask to end by agreement
 * from one party and from both, superseded, a party leaving, and the order
 * between an ending and the term's own end. Plus where the notice's days come
 * from. Pure: no database, no clock but the one handed in.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_NOTICE_DAYS, deriveAlignmentState, noticeDaysOf, readEndings, type EndingInput, type StateInput } from "./alignments";

const NOW = "2027-03-01T12:00:00.000Z";
const BEFORE = "2027-02-20T12:00:00.000Z";
const AFTER = "2027-03-10T12:00:00.000Z";

const base: StateInput = {
  contentHash: "h1",
  parties: [
    { partyKey: "user:u-ana", required: true },
    { partyKey: "village", required: true },
  ],
  alignments: [
    { partyKey: "user:u-ana", contentHash: "h1" },
    { partyKey: "village", contentHash: "h1" },
  ],
  effectiveFrom: null,
  effectiveTo: "2029-06-29",
  today: "2027-03-01",
  seatings: { open: 1, total: 1 },
  closed: null,
  now: NOW,
  termEndAt: "2029-06-30T00:00:00.000Z",
};

const e = (id: string, kind: EndingInput["kind"], effectiveAt: string, extra: Partial<EndingInput> = {}): EndingInput => ({
  id,
  kind,
  refersTo: null,
  partyKey: kind === "notice" || kind === "mutual" || kind === "notice_withdrawn" ? "user:u-ana" : null,
  effectiveAt,
  ...extra,
});

describe("in force, with endings", () => {
  const cases: Array<[string, Partial<StateInput>, string, string | null, string | null]> = [
    ["no endings: in force", {}, "in-force", null, null],
    ["a notice still running keeps it in force", { endings: [e("n1", "notice", AFTER)] }, "in-force", null, null],
    ["a notice whose moment passed ends it", { endings: [e("n1", "notice", BEFORE)] }, "ended", "ending", "notice"],
    ["a notice taken back ends nothing", { endings: [e("n1", "notice", BEFORE), e("w1", "notice_withdrawn", BEFORE, { refersTo: "n1" })] }, "in-force", null, null],
    ["one ask to end by agreement keeps it in force", { endings: [e("m1", "mutual", BEFORE)] }, "in-force", null, null],
    [
      "both asks end it",
      { endings: [e("m1", "mutual", BEFORE), e("m2", "mutual", BEFORE, { partyKey: "village" })] },
      "ended",
      "ending",
      "mutual",
    ],
    [
      "an ask taken back leaves the other alone",
      { endings: [e("m1", "mutual", BEFORE), e("w1", "notice_withdrawn", BEFORE, { refersTo: "m1" }), e("m2", "mutual", BEFORE, { partyKey: "village" })] },
      "in-force",
      null,
      null,
    ],
    ["superseded ends it", { endings: [e("s1", "superseded", BEFORE, { refersTo: "at-v2" })] }, "ended", "ending", "superseded"],
    ["a party leaving ends it, aligned or not", { endings: [e("p1", "party_left", BEFORE)], alignments: [] }, "ended", "ending", "party_left"],
    ["an ending outranks an ended seating", { endings: [e("p1", "party_left", BEFORE)], seatings: { open: 0, total: 1 } }, "ended", "ending", "party_left"],
    [
      "a notice that ran out before the term reads as notice",
      { today: "2029-08-01", now: "2029-08-01T00:00:00.000Z", endings: [e("n1", "notice", "2029-05-01T00:00:00.000Z")] },
      "ended",
      "ending",
      "notice",
    ],
    [
      "a notice running past the term reads as the term",
      { today: "2029-08-01", now: "2029-08-01T00:00:00.000Z", endings: [e("n1", "notice", "2029-07-15T00:00:00.000Z")] },
      "ended",
      "term",
      "term_end",
    ],
    ["the withdrawn application still reads closed", { closed: "Withdrawn.", endings: [e("n1", "notice", BEFORE)] }, "ended", "closed", null],
  ];
  for (const [name, change, state, endedBy, kind] of cases) {
    it(name, () => {
      const d = deriveAlignmentState({ ...base, ...change });
      expect(d.state).toBe(state);
      expect(d.endedBy).toBe(endedBy);
      expect(d.ending?.kind ?? null).toBe(kind);
    });
  }

  it("running notices and open asks are served while in force, and cleared once ended", () => {
    const running = deriveAlignmentState({ ...base, endings: [e("n1", "notice", AFTER), e("m1", "mutual", BEFORE, { partyKey: "village" })] });
    expect(running.notices).toEqual([{ id: "n1", partyKey: "user:u-ana", at: AFTER }]);
    expect(running.asks).toEqual([{ id: "m1", partyKey: "village", at: BEFORE }]);
    const ended = deriveAlignmentState({ ...base, endings: [e("n1", "notice", AFTER), e("s1", "superseded", BEFORE)] });
    expect(ended.notices).toEqual([]);
    expect(ended.asks).toEqual([]);
  });

  it("agreement takes effect at the moment the last party asked", () => {
    const r = readEndings([e("m1", "mutual", "2027-02-01T00:00:00.000Z"), e("m2", "mutual", BEFORE, { partyKey: "village" })], ["user:u-ana", "village"], NOW);
    expect(r.ended).toEqual({ kind: "mutual", at: BEFORE, partyKey: null, refersTo: null });
  });
});

describe("the notice's days", () => {
  it("the ending group's, else the term group's, else the default, and says which", () => {
    expect(noticeDaysOf({ v: 1, ending: { noticeDays: 10 }, term: { noticeDays: 7 } })).toEqual({ days: 10, from: "ending" });
    expect(noticeDaysOf({ v: 1, term: { noticeDays: 7 } })).toEqual({ days: 7, from: "term" });
    expect(noticeDaysOf({ v: 1 })).toEqual({ days: DEFAULT_NOTICE_DAYS, from: "default" });
    expect(noticeDaysOf(null)).toEqual({ days: 14, from: "default" });
    // Zero is a number the terms chose: notice takes effect at once.
    expect(noticeDaysOf({ v: 1, ending: { noticeDays: 0 } })).toEqual({ days: 0, from: "ending" });
  });
});
