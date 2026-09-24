/**
 * THE ROW IS THE FOSSIL OF A CHOICE, for the dials where nothing else is.
 *
 * `game_variables` stores deltas: write the platform default and the row is
 * DELETED, so the village keeps inheriting later defaults. That is right for a
 * tuning knob and wrong for a dial whose default depends on where the village
 * is, because it throws away the only evidence that a human ever answered.
 *
 * Measured on main before this changed, with the real `setVariable` against a
 * recording pool: setting `calendar.hemisphere` to "north" issued a DELETE;
 * north, then south, then north again ended with no row at all, byte for byte
 * identical to a village that never opened the dial. The admin route writes a
 * mechanics-change record only when the value CHANGES, so re-affirming the
 * default left no audit trail either, and the card's Save button is disabled
 * while the draft equals the value, so a founder could not even try.
 *
 * So `placeDependent` keeps the row. These tests hold both halves of that:
 * the flagged dial keeps its row, and every other dial still deletes, because
 * "stores deltas only" is a promise to every fork about inheriting defaults
 * and this bends it for one named family rather than quietly for all.
 *
 * No database. `setVariable` takes the pool as an argument, so a recorder that
 * answers nothing is enough to see which statement it chose.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { allVariables, isAnswered, setVariable, storedOverride } from "./variables";

/** Every statement `setVariable` reaches for, in order, with its arguments. */
const statements: Array<{ sql: string; args: unknown[] }> = [];

const recordingPool = {
  query: async (sql: string, args: unknown[]) => {
    statements.push({ sql: String(sql).trim().split(/\s+/).slice(0, 3).join(" "), args });
    return [[], []];
  },
} as unknown as Pool;

const HEMISPHERE = "calendar.hemisphere";
/** An ordinary delta dial, for the half of the rule that did not change. */
const ORDINARY = "events.upcoming_days";

describe("a place-dependent dial keeps its row", () => {
  beforeEach(async () => {
    statements.length = 0;
    // Back to a clean slate through the real write path, so no test inherits
    // another's cache. The ordinary dial's default write clears its row.
    await setVariable(recordingPool, ORDINARY, VARIABLES_BY_KEY[ORDINARY].default);
    statements.length = 0;
  });

  it("is declared on the hemisphere, which is the dial the ruling was about", () => {
    expect(VARIABLES_BY_KEY[HEMISPHERE].placeDependent).toBe(true);
  });

  it("writes a row when the answer equals the platform default", async () => {
    const result = await setVariable(recordingPool, HEMISPHERE, "north");
    expect(result.ok).toBe(true);
    expect(statements.map((s) => s.sql)).toEqual(["INSERT INTO game_variables"]);
    expect(storedOverride(HEMISPHERE)).toBe("north");
    expect(isAnswered(HEMISPHERE)).toBe(true);
  });

  it("still reads as the default value, because answering is not changing", async () => {
    await setVariable(recordingPool, HEMISPHERE, "north");
    const row = allVariables().find((v) => v.key === HEMISPHERE)!;
    // The two facts that used to be one. `isDefault` says what the value is;
    // `answered` says whether anybody here said so. A village in Costa Rica
    // confirming "north" is both at once, and before this pair existed that
    // village was indistinguishable from one that never looked.
    expect(row.value).toBe("north");
    expect(row.isDefault).toBe(true);
    expect(row.answered).toBe(true);
  });

  it("keeps the answer when a village moves off the default and back again", async () => {
    await setVariable(recordingPool, HEMISPHERE, "south");
    expect(storedOverride(HEMISPHERE)).toBe("south");
    await setVariable(recordingPool, HEMISPHERE, "north");
    // On main this second write issued a DELETE and the village fell back to
    // unanswered, having answered twice.
    expect(statements.map((s) => s.sql)).toEqual([
      "INSERT INTO game_variables",
      "INSERT INTO game_variables",
    ]);
    expect(isAnswered(HEMISPHERE)).toBe(true);
  });

  it("leaves every other dial deleting its row on a default write", async () => {
    await setVariable(recordingPool, ORDINARY, "120");
    expect(storedOverride(ORDINARY)).toBe("120");
    statements.length = 0;
    await setVariable(recordingPool, ORDINARY, VARIABLES_BY_KEY[ORDINARY].default);
    expect(statements.map((s) => s.sql)).toEqual(["DELETE FROM game_variables"]);
    expect(storedOverride(ORDINARY)).toBeUndefined();
    expect(isAnswered(ORDINARY)).toBe(false);
  });

  it("refuses a value outside the dial's own choices, flag or no flag", async () => {
    const result = await setVariable(recordingPool, HEMISPHERE, "up");
    expect(result.ok).toBe(false);
    expect(statements).toEqual([]);
  });
});
