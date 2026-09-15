import { describe, expect, it } from "vitest";
import {
  CLOSE_CONSEQUENCES,
  closeReport,
  joinNumbers,
  settlementBlocked,
  settlementIntent,
  type CloseResult,
  type PendingSettlement,
} from "./settlement";

/**
 * The settlement desk's words, as arithmetic.
 *
 * The one that earns its keep is the double press. `POST /api/admin/cycles/close`
 * skips a lunation already recorded as closed, so the second press answers 200
 * with `closed: 0` and a desk that trusted the status code would tell a founder
 * they had just settled the month a second time.
 */

const pending = (over: Partial<PendingSettlement> = {}): PendingSettlement => ({
  pool: { size: 1000, token: "credits", tokenName: "Village Credits", problem: null },
  unreadableCycles: null,
  due: [
    {
      id: "lunar-000328",
      cycleNumber: 328,
      startsAt: "2026-07-14T00:00:00.000Z",
      endsAt: "2026-08-12T00:00:00.000Z",
      recipients: 2,
      received: 14,
      credited: 1000,
      token: "credits",
      fromPersistedSplit: false,
      shares: [
        { name: "Ana", received: 9, distinctSenders: 3, credited: 642 },
        { name: "Ben", received: 5, distinctSenders: 1, credited: 357 },
      ],
    },
  ],
  ...over,
});

describe("settlementIntent", () => {
  it("says nothing at all before the preview lands", () => {
    expect(settlementIntent(null)).toEqual([]);
  });

  it("names the lunation, the money and the finality", () => {
    const lines = settlementIntent(pending());
    expect(lines[0]).toBe("Closing 1 finished lunation: 328.");
    expect(lines[1]).toBe("2 members share 1000 Village Credits, credited the moment you confirm.");
    expect(lines.at(-1)).toBe("Settlement cannot be undone from this desk.");
  });

  it("lists several due lunations in order", () => {
    const p = pending();
    const older = { ...p.due[0], id: "lunar-000326", cycleNumber: 326, credited: 0, recipients: 1 };
    const middle = { ...p.due[0], id: "lunar-000327", cycleNumber: 327, credited: 0, recipients: 1 };
    const lines = settlementIntent({ ...p, due: [older, middle, p.due[0]] });
    expect(lines[0]).toBe("Closing 3 finished lunations: 326, 327 and 328.");
    expect(lines[1]).toBe("4 members share 1000 Village Credits, credited the moment you confirm.");
  });

  it("does not promise value when the pool is switched off", () => {
    const p = pending();
    const lines = settlementIntent({
      ...p,
      pool: { ...p.pool, size: 0 },
      due: [{ ...p.due[0], credited: 0, shares: [] }],
    });
    expect(lines[1]).toBe("2 members are recorded as acknowledged. The pool releases nothing this time.");
  });

  it("warns that a half-finished close already fixed the split", () => {
    const p = pending();
    const lines = settlementIntent({ ...p, due: [{ ...p.due[0], fromPersistedSplit: true }] });
    expect(lines).toContain(
      "An earlier close already wrote the split for 328. This pays from that record, and anything already paid pays once.",
    );
  });

  it("warns a founder, in the confirmation, that the village said no to a moon", () => {
    // Rye, 2026-09-14: Close may overrule the village, and never by accident.
    const p = pending();
    const lines = settlementIntent({
      ...p,
      due: [{ ...p.due[0], villageRefused: { ballotId: "bal-1", at: "2026-09-14T10:00:00.000Z", vetoed: false } }],
    });
    expect(lines).toContain(
      "Lunation 328: The village voted this moon's settlement down on 14 September 2026. Closing it pays this split anyway.",
    );
    // A moon nobody said no to carries no such line.
    expect(settlementIntent(p).some((l) => l.includes("settlement down"))).toBe(false);
  });

  it("carries the server's own refusal into the confirmation", () => {
    const p = pending();
    const problem = "credits is hypha-governed and cannot be minted by the pool";
    const blocked = { ...p, pool: { ...p.pool, problem } };
    expect(settlementIntent(blocked)).toContain(problem);
    expect(settlementBlocked(blocked)).toBe(true);
    expect(settlementBlocked(p)).toBe(false);
    expect(settlementBlocked(null)).toBe(false);
  });

  it("says so plainly when there is nothing to settle", () => {
    expect(settlementIntent({ ...pending(), due: [] })).toEqual([
      "Nothing is due. Every finished lunation is already settled.",
    ]);
  });

  it("falls back to the token slug when a persisted split used another token", () => {
    const p = pending();
    const lines = settlementIntent({
      ...p,
      due: [{ ...p.due[0], token: "seeds", fromPersistedSplit: true }],
    });
    expect(lines[1]).toBe("2 members share 1000 seeds, credited the moment you confirm.");
  });
});

describe("closeReport", () => {
  const settled: CloseResult = {
    closed: 1,
    cycles: [{ cycleNumber: 328 }],
    poolCredited: 1000,
    governanceApplied: 0,
  };

  it("reports the settlement it actually made", () => {
    const out = closeReport(settled, "Village Credits");
    expect(out.settled).toBe(true);
    expect(out.headline).toBe("Settled 1 lunation");
    expect(out.lines[0]).toBe("1 lunation is now closed: 328.");
    expect(out.lines[1]).toBe("The pool released 1000 Village Credits.");
  });

  it("tells a founder the second press settled nothing", () => {
    const again = closeReport(
      { closed: 0, cycles: [], poolCredited: 0, governanceApplied: 0 },
      "Village Credits",
    );
    expect(again.settled).toBe(false);
    expect(again.headline).toBe("Nothing was due");
    expect(again.lines[0]).toBe(
      "Every finished lunation was already settled. No value moved, and nothing paid twice.",
    );
  });

  it("keeps recognition honest when the pool paid nothing", () => {
    const out = closeReport({ ...settled, poolCredited: 0 }, "Village Credits");
    expect(out.lines[1]).toBe("The pool released nothing. Recognition was recorded all the same.");
  });

  it("names governance that took effect at the boundary", () => {
    const out = closeReport({ ...settled, governanceApplied: 2 }, "Village Credits");
    expect(out.lines.at(-1)).toBe("2 passed proposals took effect at the boundary.");
  });

  it("pluralises a multi-lunation settlement", () => {
    const out = closeReport(
      { closed: 2, cycles: [{ cycleNumber: 327 }, { cycleNumber: 328 }], poolCredited: 40, governanceApplied: 0 },
      "Village Credits",
    );
    expect(out.headline).toBe("Settled 2 lunations");
    expect(out.lines[0]).toBe("2 lunations are now closed: 327 and 328.");
  });
});

describe("what the confirmation promises", () => {
  it("names every consequence of a close, not only the money", () => {
    expect(CLOSE_CONSEQUENCES).toHaveLength(5);
    const all = CLOSE_CONSEQUENCES.join(" ");
    for (const subject of ["pool", "health snapshot", "badges", "proposals"]) {
      expect(all).toContain(subject);
    }
  });

  it("joins numbers the way a person reads them", () => {
    expect(joinNumbers([])).toBe("");
    expect(joinNumbers([7])).toBe("7");
    expect(joinNumbers([7, 8])).toBe("7 and 8");
    expect(joinNumbers([6, 7, 8])).toBe("6, 7 and 8");
  });
});

/**
 * The empty list has two causes and they are different news. A preview that
 * stopped because it met a cycle id it cannot read has NOT established that
 * every lunation is settled, and saying so would be the desk stating a fact it
 * does not have.
 */
describe("a cycle id the server cannot read", () => {
  const trouble = "2 recognition row(s) carry a cycle id this build cannot read: 2026-07, moon-x.";

  it("blocks the press, the same as a misconfigured pool", () => {
    expect(settlementBlocked(pending({ unreadableCycles: trouble, due: [] }))).toBe(true);
  });

  it("says why, instead of saying everything is settled", () => {
    const lines = settlementIntent(pending({ unreadableCycles: trouble, due: [] }));
    expect(lines).toEqual([trouble]);
  });

  it("leaves the ordinary empty case exactly as it was", () => {
    expect(settlementIntent(pending({ due: [] }))).toEqual([
      "Nothing is due. Every finished lunation is already settled.",
    ]);
    expect(settlementBlocked(pending({ due: [] }))).toBe(false);
  });
});
