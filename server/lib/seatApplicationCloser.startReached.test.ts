/**
 * A START OF "NOW" HAS COME, WHICHEVER ENGINE STORES IT.
 *
 * `seat_applications.starts_at` is a whole-second `datetime`. MySQL 8 ROUNDS
 * an instant's milliseconds on the way in (11.7 s is stored as 12 s, in the
 * future); MariaDB TRUNCATES them (11.7 s is stored as 11 s). An open
 * proposal adopted for this moon writes its start as "now", and adoption then
 * reads it back and asks whether it has come. On MySQL, in the second half of
 * any second, it had not: the person was adopted and seated nobody until the
 * hourly turn. CI's mysql:8 showed it through the role journey e2e; a
 * developer's MariaDB never could.
 *
 * Two defences, each held here on BOTH engines without a database, by
 * storing through a model of each:
 *   1. `wholeSecond`: placeOnRoles writes "now" at the column's precision, so
 *      both engines store exactly what was written.
 *   2. `startReached`: a start less than a second ahead has come, so any other
 *      writer of a raw "now" is read right on both engines.
 */
import { describe, expect, it } from "vitest";
import { startReached, wholeSecond } from "./seatApplicationCloser";

/** What each engine keeps of an instant in a whole-second column. */
const ENGINES = {
  "MySQL 8 (rounds)": (d: Date) => new Date(Math.round(d.getTime() / 1000) * 1000),
  "MariaDB (truncates)": (d: Date) => new Date(Math.floor(d.getTime() / 1000) * 1000),
} as const;

const SECOND = Date.parse("2026-11-09T23:26:11.000Z");
const MILLIS = [0, 1, 250, 499, 500, 501, 700, 999];

describe.each(Object.entries(ENGINES))("on %s", (_engine, store) => {
  it.each(MILLIS)("a raw now at .%i ms, stored and read back, has come", (ms) => {
    const now = new Date(SECOND + ms);
    expect(startReached(store(now), now)).toBe(true);
  });

  it.each(MILLIS)("a whole-second now at .%i ms is stored exactly, and has come even by a strict comparison", (ms) => {
    const now = new Date(SECOND + ms);
    const written = wholeSecond(now);
    expect(store(written).getTime()).toBe(written.getTime());
    expect(store(written).getTime() <= now.getTime()).toBe(true);
  });
});

describe("startReached still waits for a start that is really ahead", () => {
  const now = new Date(SECOND + 700);
  it("two seconds ahead has not come", () => {
    expect(startReached(new Date(SECOND + 2700), now)).toBe(false);
  });
  it("a moon's first day ahead has not come", () => {
    expect(startReached(new Date("2026-12-09T00:00:00.000Z"), now)).toBe(false);
  });
  it("a start in the past has come", () => {
    expect(startReached(new Date("2026-11-01T00:00:00.000Z"), now)).toBe(true);
  });
});
