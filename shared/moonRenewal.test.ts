/**
 * A term of one moon warns in its last week and never on its first day (G11),
 * and the next moon's term is the moon after the one the term ends in.
 */
import { describe, expect, it } from "vitest";
import { LUNAR_CLOCK, SHORT_TERM_WARNING_DAYS, termWarningOpensAt, termWarningOpensFor } from "./cycleClock";
import { nextMoonTermEnd } from "./moonRenewal";

const DAY = 86_400_000;

describe("the warning for a one-moon term", () => {
  // A term that starts on a new moon and ends on the next one.
  const n = LUNAR_CLOCK.cycleNumberAt(new Date("2026-11-20T00:00:00Z"));
  const starts = LUNAR_CLOCK.startOf(n);
  const ends = LUNAR_CLOCK.startOf(n + 1);

  it("the old rule would have warned on day one", () => {
    expect(Math.abs(termWarningOpensAt(ends, LUNAR_CLOCK).getTime() - starts.getTime())).toBeLessThanOrEqual(1);
  });

  it("opens in the last 7 days, never on day one", () => {
    const opens = termWarningOpensFor(starts, ends, LUNAR_CLOCK);
    expect(ends.getTime() - opens.getTime()).toBe(SHORT_TERM_WARNING_DAYS * DAY);
    expect(opens.getTime()).toBeGreaterThan(starts.getTime() + 20 * DAY);
  });

  it("is not due in the first weeks and is due in the last", () => {
    const opens = termWarningOpensFor(starts, ends, LUNAR_CLOCK);
    expect(starts.getTime() + 3 * DAY < opens.getTime()).toBe(true);
    expect(ends.getTime() - 3 * DAY >= opens.getTime()).toBe(true);
  });

  it("never opens before the term starts", () => {
    const lateStart = new Date(ends.getTime() - 2 * DAY);
    expect(termWarningOpensFor(lateStart, ends, LUNAR_CLOCK).getTime()).toBe(lateStart.getTime());
  });

  it("a term of two or more moons keeps the one-cycle warning", () => {
    const longEnds = LUNAR_CLOCK.startOf(n + 3);
    expect(termWarningOpensFor(starts, longEnds, LUNAR_CLOCK).getTime()).toBe(termWarningOpensAt(longEnds, LUNAR_CLOCK).getTime());
  });

  it("an unknown start keeps the one-cycle warning", () => {
    expect(termWarningOpensFor(null, ends, LUNAR_CLOCK).getTime()).toBe(termWarningOpensAt(ends, LUNAR_CLOCK).getTime());
  });
});

describe("renewal writes the next moon", () => {
  it("is the moon after the one the term ends in", () => {
    const n = LUNAR_CLOCK.cycleNumberAt(new Date("2026-11-20T00:00:00Z"));
    const ends = LUNAR_CLOCK.startOf(n + 1);
    expect(nextMoonTermEnd(ends, LUNAR_CLOCK).getTime()).toBe(LUNAR_CLOCK.startOf(n + 2).getTime());
  });
});
