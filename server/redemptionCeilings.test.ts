/**
 * REDEMPTION'S THREE MONEY CEILINGS FAIL CLOSED (Rye, 2026-11-05, relayed by
 * the master coordinator: "BUILD it now exactly as you planned").
 *
 * They used to read 0 as "no ceiling", the one place redemption broke the
 * platform's rule that a cap of 0 means zero. Now blank means no ceiling and
 * 0 means zero: nobody may redeem past it. A village that stored a 0 meant
 * "no ceiling" when it did, so a once-only boot step turns a stored 0 into
 * blank and nothing a village chose changes on deploy. HELD FOR RYE'S OWN
 * WORD, because that step writes to live data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { VARIABLES_BY_KEY, validateVariable } from "../shared/gameVariables";
import { loadVariables, optionalNumberVar, setVariable, storedOverride } from "./lib/variables";
import { CEILING_BLANK_NOTE, REDEMPTION_CEILINGS, blankZeroRedemptionCeilings } from "./lib/redemptionCeilings";
import { ledgerRowsThatMayCarryKeys } from "./repos/mechanicsChanges";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[redemptionCeilings] TEST_DATABASE_URL not set. The database half SKIPPED.");
}

describe("the three money ceilings", () => {
  it("are exactly the per-request, per-member and village ceilings", () => {
    expect([...REDEMPTION_CEILINGS]).toEqual([
      "redemption.max_per_request",
      "redemption.max_per_member_per_cycle",
      "redemption.max_village_per_cycle",
    ]);
  });

  it("ship blank, say that blank is no ceiling, and say that 0 is zero", () => {
    for (const key of REDEMPTION_CEILINGS) {
      const def = VARIABLES_BY_KEY[key];
      expect(def.default, key).toBe("");
      expect(def.blank, key).toBe("no ceiling");
      expect(validateVariable(def, ""), key).toBeNull();
      expect(validateVariable(def, "0"), key).toBeNull();
      expect(validateVariable(def, "250.5"), key).toBeNull();
      expect(def.description, key).toContain("Leave it blank for no ceiling");
      expect(def.description, key).toContain("0 means zero");
      expect(def.description, key).not.toContain("0 means there is no ceiling");
    }
  });
});

describe.skipIf(!configured)("reading the ceilings, and the boot step", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const [PER_REQUEST, PER_MEMBER, VILLAGE] = REDEMPTION_CEILINGS;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadVariables(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads blank as no ceiling, 0 as zero, and a number as itself", async () => {
    expect(optionalNumberVar(PER_REQUEST), "the shipped default").toBeNull();
    await setVariable(pool, PER_REQUEST, "0");
    expect(optionalNumberVar(PER_REQUEST)).toBe(0);
    await setVariable(pool, PER_REQUEST, "250.5");
    expect(optionalNumberVar(PER_REQUEST)).toBe(250.5);
    await setVariable(pool, PER_REQUEST, "");
    expect(optionalNumberVar(PER_REQUEST)).toBeNull();
  });

  it("refuses to read a dial as optional unless the dial says what blank means", () => {
    expect(() => optionalNumberVar("redemption.min_amount")).toThrow(/blank/);
  });

  it("turns a stored 0 into blank, and leaves every other value alone", async () => {
    await setVariable(pool, PER_REQUEST, "0");
    await setVariable(pool, PER_MEMBER, "0.00");
    await setVariable(pool, VILLAGE, "500");
    expect(await blankZeroRedemptionCeilings(pool)).toEqual([PER_REQUEST, PER_MEMBER]);

    // Read back from the table, so the rows themselves are proven gone.
    await loadVariables(pool);
    expect(storedOverride(PER_REQUEST)).toBeUndefined();
    expect(storedOverride(PER_MEMBER)).toBeUndefined();
    expect(storedOverride(VILLAGE)).toBe("500");
    expect(optionalNumberVar(PER_REQUEST)).toBeNull();
    expect(optionalNumberVar(PER_MEMBER)).toBeNull();
    expect(optionalNumberVar(VILLAGE)).toBe(500);

    // The dial's own history says what moved and why: from 0 to the platform
    // default (NULL in the ledger), by the platform.
    const history = (await ledgerRowsThatMayCarryKeys(pool, [...REDEMPTION_CEILINGS])).filter((r) => r.note === CEILING_BLANK_NOTE);
    expect(history.map((r) => [r.configKey, r.oldValue, r.newValue]).sort()).toEqual([
      [PER_MEMBER, "0.00", null],
      [PER_REQUEST, "0", null],
    ]);

    expect(await blankZeroRedemptionCeilings(pool), "a second run changes nothing").toEqual([]);
  });

  it("changes nothing in a village that never set a ceiling", async () => {
    await setVariable(pool, VILLAGE, "");
    expect(REDEMPTION_CEILINGS.map((k) => storedOverride(k))).toEqual([undefined, undefined, undefined]);
    expect(await blankZeroRedemptionCeilings(pool)).toEqual([]);
  });
});
