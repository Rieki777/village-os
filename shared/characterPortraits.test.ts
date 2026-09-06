/**
 * The forge budget, proved as arithmetic.
 *
 * No database and no clock here on purpose. Every rule Rye stated is a claim
 * about numbers, and a claim about numbers that can only be checked by booting
 * a server is a claim nobody checks. The database half (the atomic spend, the
 * conditional accrual, the privacy filter) is proved in
 * `server/characterPortraits.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  BUDGET_TOKEN_SLOTS,
  MOON_GRANT_CEILING,
  SETUP_GRANTS,
  accrueMoonGrants,
  daysUntil,
  forgeBudget,
  grantsHeldSentence,
  isPortraitSource,
  nextGrantSentence,
  spendOne,
} from "./characterPortraits";

const counters = (setup: number, moon: number, cycle: number | null, spent = 0) => ({
  setupRemaining: setup,
  moonRemaining: moon,
  moonCycle: cycle,
  spent,
});

describe("the numbers Rye gave", () => {
  it("grants three at setup and caps the moon half at three", () => {
    expect(SETUP_GRANTS).toBe(3);
    expect(MOON_GRANT_CEILING).toBe(3);
    expect(BUDGET_TOKEN_SLOTS).toBe(6);
  });
});

describe("accruing the moon half", () => {
  it("grants one when one moon has turned", () => {
    const out = accrueMoonGrants(0, 400, 401);
    expect(out).toEqual({ moonRemaining: 1, moonCycle: 401, granted: 1 });
  });

  it("grants nothing inside the same moon", () => {
    expect(accrueMoonGrants(2, 400, 400)).toEqual({ moonRemaining: 2, moonCycle: 400, granted: 0 });
  });

  it("STOPS AT THREE after a year away, which is the whole point of the ceiling", () => {
    // Twelve moons of absence. The rule says nobody comes back with twelve.
    const out = accrueMoonGrants(0, 400, 412);
    expect(out.moonRemaining).toBe(3);
    expect(out.granted).toBe(3);
    // And the marker moves to now, so the nine it did not grant are gone for
    // good and cannot be collected by reading again.
    expect(out.moonCycle).toBe(412);
    expect(accrueMoonGrants(out.moonRemaining, out.moonCycle, 412).granted).toBe(0);
  });

  it("grants nothing on a first read, so a new member does not collect since the epoch", () => {
    const out = accrueMoonGrants(0, null, 412);
    expect(out).toEqual({ moonRemaining: 0, moonCycle: 412, granted: 0 });
  });

  it("grants nothing when the clock moves backwards", () => {
    expect(accrueMoonGrants(1, 400, 399)).toEqual({ moonRemaining: 1, moonCycle: 400, granted: 0 });
  });

  it("does not overflow the ceiling from an already full counter", () => {
    expect(accrueMoonGrants(3, 400, 405).moonRemaining).toBe(3);
  });

  it("survives a cycle number it cannot read", () => {
    expect(accrueMoonGrants(2, 400, Number.NaN).moonRemaining).toBe(2);
  });
});

describe("spending", () => {
  it("takes the moon half first, so the next accrual has room to land", () => {
    const after = spendOne(counters(3, 2, 400));
    expect(after).toEqual({ setupRemaining: 3, moonRemaining: 1, moonCycle: 400, spent: 1 });
  });

  it("falls through to the setup half once the moon half is empty", () => {
    const after = spendOne(counters(3, 0, 400));
    expect(after).toEqual({ setupRemaining: 2, moonRemaining: 0, moonCycle: 400, spent: 1 });
  });

  it("refuses when both halves are empty", () => {
    expect(spendOne(counters(0, 0, 400))).toBeNull();
  });

  it("BANKS the setup grants: three moons of absence do not touch them", () => {
    // Somebody who spent nothing at setup and came back three moons later.
    let c = counters(SETUP_GRANTS, 0, 400);
    const accrued = accrueMoonGrants(c.moonRemaining, c.moonCycle, 403);
    c = { ...c, moonRemaining: accrued.moonRemaining, moonCycle: accrued.moonCycle };
    expect(c.setupRemaining).toBe(3);
    expect(forgeBudget(c, null, new Date()).total).toBe(6);
  });

  it("spends three attempts on one class, which is the flexibility Rye asked for", () => {
    let c: ReturnType<typeof counters> | null = counters(SETUP_GRANTS, 0, 400);
    for (let i = 0; i < 3; i++) c = spendOne(c!);
    expect(c).not.toBeNull();
    expect(c!.setupRemaining).toBe(0);
    expect(c!.spent).toBe(3);
    expect(spendOne(c!)).toBeNull();
  });
});

describe("the countdown", () => {
  const now = new Date("2026-09-03T00:00:00Z");

  it("counts whole days and rounds up, so a moon with hours left is not already here", () => {
    expect(daysUntil("2026-09-03T06:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-09-13T00:00:00Z", now)).toBe(10);
  });

  it("never reports a negative count", () => {
    expect(daysUntil("2026-09-01T00:00:00Z", now)).toBe(0);
  });

  it("answers null for a window it cannot read, which the unanchored case produces", () => {
    // `villageMoon` returns "" for an instant it could not format, and the
    // caller passes `moon.endsAt || null` straight through.
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil("", now)).toBeNull();
  });

  it("says when the next gift arrives", () => {
    const b = forgeBudget(counters(1, 0, 400), "2026-09-13T00:00:00Z", now);
    expect(b.moonAtCeiling).toBe(false);
    expect(nextGrantSentence(b)).toContain("in 10 days");
  });

  it("says the moon half is full instead of promising a gift the ceiling will eat", () => {
    const b = forgeBudget(counters(0, 3, 400), "2026-09-13T00:00:00Z", now);
    expect(b.moonAtCeiling).toBe(true);
    expect(nextGrantSentence(b)).toContain("full at three");
  });

  it("still says something useful with no readable window", () => {
    const b = forgeBudget(counters(1, 0, 400), null, now);
    expect(nextGrantSentence(b)).toBe("One more arrives when the moon turns.");
  });

  it("AT ZERO it still names the day, which is what replaces the dead button", () => {
    const b = forgeBudget(counters(0, 0, 400), "2026-09-05T00:00:00Z", now);
    expect(b.total).toBe(0);
    expect(nextGrantSentence(b)).toContain("2 days");
    expect(grantsHeldSentence(0)).toBe("You have no forge gifts waiting.");
  });

  it("counts the gifts in words that match the tokens", () => {
    expect(grantsHeldSentence(1)).toContain("one forge gift");
    expect(grantsHeldSentence(4)).toContain("4 forge gifts");
  });
});

describe("the source union", () => {
  it("is closed", () => {
    expect(isPortraitSource("forged")).toBe(true);
    expect(isPortraitSource("uploaded")).toBe(true);
    expect(isPortraitSource("generated")).toBe(false);
    expect(isPortraitSource(null)).toBe(false);
  });
});

describe("a budget read out of a hand-edited row", () => {
  it("clamps a moon half above the ceiling instead of paying it out", () => {
    expect(forgeBudget(counters(0, 99, 400), null, new Date()).total).toBe(3);
  });

  it("floors a negative setup half at zero", () => {
    expect(forgeBudget(counters(-5, 0, 400), null, new Date()).total).toBe(0);
  });
});
