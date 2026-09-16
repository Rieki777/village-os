/**
 * The table for `lostConcurrencyRace`: which driver errors mean "this
 * transaction lost a race and may be run again", and which do not.
 *
 * The retryable rows are the three codes the engines were measured raising
 * under contention. The refused rows are the neighbours a careless widening
 * would sweep in, each of which a blind retry would get wrong.
 */
import { describe, expect, it } from "vitest";
import { LOST_RACE_CODES, lostConcurrencyRace } from "./concurrency";

const driverError = (code: string, errno: number, message: string) =>
  Object.assign(new Error(message), { code, errno, sqlState: "HY000" });

describe("lostConcurrencyRace", () => {
  it.each([
    ["ER_LOCK_DEADLOCK", 1213, "Deadlock found when trying to get lock; try restarting transaction"],
    ["ER_LOCK_WAIT_TIMEOUT", 1205, "Lock wait timeout exceeded; try restarting transaction"],
    // MariaDB 11.8+ with innodb_snapshot_isolation ON, measured 2026-09-14.
    ["ER_CHECKREAD", 1020, "Record has changed since last read in table 'token_balances'; try restarting transaction"],
  ])("retries %s (%i)", (code, errno, message) => {
    expect(lostConcurrencyRace(driverError(code, errno, message))).toBe(true);
  });

  it.each([
    // A unique index answered a question about the data; the caller decides.
    ["ER_DUP_ENTRY", 1062, "Duplicate entry 'x' for key 'PRIMARY'"],
    // Whether the commit landed is unknown, so a blind retry could double-post.
    ["PROTOCOL_CONNECTION_LOST", 0, "Connection lost: The server closed the connection."],
    ["ECONNRESET", 0, "read ECONNRESET"],
    ["ER_PARSE_ERROR", 1064, "You have an error in your SQL syntax"],
  ])("does not retry %s", (code, errno, message) => {
    expect(lostConcurrencyRace(driverError(code, errno, message))).toBe(false);
  });

  it("does not match on the message alone, or on a number where the code belongs", () => {
    expect(lostConcurrencyRace(new Error("Deadlock found when trying to get lock"))).toBe(false);
    expect(lostConcurrencyRace({ code: 1213 })).toBe(false);
    expect(lostConcurrencyRace({ errno: 1020 })).toBe(false);
  });

  it("answers false for things that are not errors at all", () => {
    for (const v of [undefined, null, 0, "", "ER_CHECKREAD", {}, []]) {
      expect(lostConcurrencyRace(v)).toBe(false);
    }
  });

  it("keeps its list closed to runtime widening", () => {
    expect(Object.isFrozen(LOST_RACE_CODES)).toBe(true);
    expect(() => (LOST_RACE_CODES as string[]).push("ER_DUP_ENTRY")).toThrow();
    expect(lostConcurrencyRace({ code: "ER_DUP_ENTRY" })).toBe(false);
  });
});
