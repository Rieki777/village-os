/**
 * A START OF "NOW" HAS COME, whichever way the database stores its fraction.
 * `seat_applications.starts_at` keeps whole seconds: MySQL 8 rounds an
 * instant's milliseconds, MariaDB truncates them. The role journey e2e found
 * the MySQL half on CI (an adopted arrival left unseated until the hourly
 * turn); these cases hold both halves without a database.
 */
import { describe, expect, it } from "vitest";
import { startReached } from "./seatApplicationCloser";

const now = new Date("2026-11-09T23:26:11.700Z");

describe("startReached", () => {
  it("a start that MySQL rounded up into the next second has come", () => {
    expect(startReached(new Date("2026-11-09T23:26:12.000Z"), now)).toBe(true);
  });
  it("a start that MariaDB truncated has come", () => {
    expect(startReached(new Date("2026-11-09T23:26:11.000Z"), now)).toBe(true);
  });
  it("a start in the past has come", () => {
    expect(startReached(new Date("2026-11-01T00:00:00.000Z"), now)).toBe(true);
  });
  it("a start two seconds ahead, or a moon's first day, has not", () => {
    expect(startReached(new Date("2026-11-09T23:26:13.700Z"), now)).toBe(false);
    expect(startReached(new Date("2026-12-09T00:00:00.000Z"), now)).toBe(false);
  });
});
