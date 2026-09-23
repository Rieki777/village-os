/**
 * What the village holds, at the column level (0098).
 *
 * This table is the one place in the product where a row can close a door on
 * the person who would have to open it again, so the interesting assertions
 * here are about what it REFUSES: a key that may never move, a role that does
 * not exist, and a role that carries no such power and therefore could not
 * act if it were handed one.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import {
  assertCapabilityHoldingInvariants,
  capabilityHoldings,
  moveCapabilityToVillage,
  returnCapabilityToScaffolding,
  villageHandoverState,
  villageHeldCapabilities,
} from "./capabilityHolding";
import { ALL_CAPABILITIES, HANDOVER_SET } from "../../shared/capabilities";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

describe.skipIf(!configured)("capability holding", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO roles (id, name, capabilities) VALUES " +
        "('keepers','The Library Keepers',?), ('greeters','The Greeters',?)",
      [JSON.stringify(["library.keep"]), JSON.stringify([])],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM capability_holding"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  it("is empty on a fresh village, which is what makes the gate change safe to ship", async () => {
    expect(await villageHeldCapabilities(pool)).toEqual([]);
  });

  it("moves a power onto a role that already carries it", async () => {
    const r = await moveCapabilityToVillage(pool, {
      capability: "library.keep", holderRoleId: "keepers", movedByUserId: "u-founder",
    });
    expect(r).toEqual({ ok: true });
    expect(await villageHeldCapabilities(pool)).toEqual(["library.keep"]);
    const rows = await capabilityHoldings(pool);
    expect(rows).toHaveLength(1);
    expect(rows[0].holderRoleName).toBe("The Library Keepers");
    // An admin handed it over; a ballot did not. Both are real and they read
    // differently a year later, which is why the ballot id is a column.
    expect(rows[0].movedByBallotId).toBeNull();
  });

  it("refuses a role that could not act, because that state belongs to nobody at all", async () => {
    // The worst state this table can reach: the admin stops passing the gate,
    // the named holder never passed it either, and the village reads a
    // sentence naming a holder whose members all get a 403.
    const r = await moveCapabilityToVillage(pool, {
      capability: "library.keep", holderRoleId: "greeters",
    });
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("does not carry library.keep");
    expect(await villageHeldCapabilities(pool)).toEqual([]);
  });

  it("refuses a capability that may never move", async () => {
    const r = await moveCapabilityToVillage(pool, {
      capability: "message.send", holderRoleId: "keepers",
    });
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("not a power that can move");
  });

  it("refuses a key the platform does not know about", async () => {
    const r = await moveCapabilityToVillage(pool, { capability: "nope.invented", holderRoleId: "keepers" });
    expect(r.ok).toBe(false);
  });

  it("refuses a role that does not exist", async () => {
    const r = await moveCapabilityToVillage(pool, { capability: "library.keep", holderRoleId: "ghosts" });
    expect(r.ok).toBe(false);
  });

  it("is idempotent on the capability, which is what a double-closed ballot needs", async () => {
    await moveCapabilityToVillage(pool, { capability: "library.keep", holderRoleId: "keepers" });
    await moveCapabilityToVillage(pool, {
      capability: "library.keep", holderRoleId: "keepers", movedByBallotId: "b-1",
    });
    const rows = await capabilityHoldings(pool);
    expect(rows).toHaveLength(1);
    expect(rows[0].movedByBallotId).toBe("b-1");
  });

  it("hands a power back, and says whether there was one to hand back", async () => {
    await moveCapabilityToVillage(pool, { capability: "library.keep", holderRoleId: "keepers" });
    expect(await returnCapabilityToScaffolding(pool, "library.keep")).toBe(true);
    expect(await villageHeldCapabilities(pool)).toEqual([]);
    expect(await returnCapabilityToScaffolding(pool, "library.keep")).toBe(false);
  });

  describe("a hand-written row, which is the case the boot assertion exists for", () => {
    it("naming a non-transferable key is filtered out of the gate's answer", async () => {
      await pool.query( // module-review-ok: the hand-written row this test exists to catch, on the scratch schema this suite provisioned
        "INSERT INTO capability_holding (capability, holder_role_id) VALUES ('message.send','keepers')",
      );
      // Two locks on the same door: the read filters it, and the boot refuses.
      expect(await villageHeldCapabilities(pool)).toEqual([]);
      await expect(assertCapabilityHoldingInvariants(pool)).rejects.toThrow(/refusing to serve/);
    });

    it("naming a role that no longer exists is a warning and never a refusal", async () => {
      // Reachable by an ordinary admin act (retire a role), locks nobody out
      // permanently because the break-glass is right there, and refusing the
      // boot over it would turn a tidy-up into an outage.
      await pool.query( // module-review-ok: the hand-written row this test exists to catch, on the scratch schema this suite provisioned
        "INSERT INTO capability_holding (capability, holder_role_id) VALUES ('library.keep','gone')",
      );
      await expect(assertCapabilityHoldingInvariants(pool)).resolves.toBeUndefined();
      expect((await capabilityHoldings(pool))[0].holderRoleName).toBeNull();
    });

    it("a clean table boots", async () => {
      await moveCapabilityToVillage(pool, { capability: "library.keep", holderRoleId: "keepers" });
      await expect(assertCapabilityHoldingInvariants(pool)).resolves.toBeUndefined();
    });
  });

  /**
   * HOW FAR THE HANDOVER HAS GOT (0217).
   *
   * Two readers depend on the shape of this answer and neither can see the
   * other: the governing purpose statement's pen moves when `complete` turns
   * true, and the handover confirm screen warns when `remaining.length` is
   * exactly one.
   *
   * EVERY STATE BELOW EXCEPT THE FIRST IS FABRICATED. `capability_holding` is
   * created empty and nothing seeds it, so a live village holds nothing and
   * no village has ever been one power from done. These assertions say what
   * the code does when a village gets there, and nothing at all about any
   * village having got there.
   */
  describe("the handover state the pen and the confirm screen both read", () => {
    it("reads nothing held as the live posture: incomplete, and everything remaining", async () => {
      const state = await villageHandoverState(pool);
      expect(state.complete).toBe(false);
      expect(state.held).toEqual([]);
      expect(state.remaining).toEqual([...HANDOVER_SET]);
      expect(state.total).toBe(HANDOVER_SET.length);
    });

    it("counts what is held and what is left, from the same map the gate reads", async () => {
      await moveCapabilityToVillage(pool, { capability: "library.keep", holderRoleId: "keepers" });
      const state = await villageHandoverState(pool);
      expect(state.held).toEqual(["library.keep"]);
      expect(state.complete).toBe(false);
      expect(state.remaining).not.toContain("library.keep");
      expect(state.held.length + state.remaining.length).toBe(state.total);
    });

    it("says one remains when one remains, which is what the confirm warns on", async () => {
      for (const cap of HANDOVER_SET.slice(0, HANDOVER_SET.length - 1)) {
        await pool.query( // module-review-ok: a fabricated handover state on the scratch schema this suite provisioned
          "INSERT INTO capability_holding (capability, holder_role_id) VALUES (?, 'keepers')",
          [cap],
        );
      }
      const state = await villageHandoverState(pool);
      expect(state.remaining).toEqual([HANDOVER_SET[HANDOVER_SET.length - 1]]);
      expect(state.remaining.length).toBe(1);
      expect(state.complete, "one short is not complete").toBe(false);
    });

    /*
     * THE DENOMINATOR, PINNED BY NAME.
     *
     * `total` counts the HANDOVER SET and never `ALL_CAPABILITIES`, and the
     * difference is the kind of number nobody questions. `villageHeldCapabilities`
     * already filters what it returns through `TRANSFERABLE`, so a denominator
     * taken from the full list could never be reached: a village would hold 19
     * of 34 with nothing left to hand over, `complete` would rest on a
     * comparison that never balances, and every progress readout would say the
     * handover was permanently unfinished.
     *
     * So all three fields come from one derived set, and this case is what
     * says so out loud.
     */
    it("is complete only when every transferable power is across, counted against the handover set", async () => {
      for (const cap of HANDOVER_SET) {
        await pool.query( // module-review-ok: a fabricated handover state on the scratch schema this suite provisioned
          "INSERT INTO capability_holding (capability, holder_role_id) VALUES (?, 'keepers')",
          [cap],
        );
      }
      const state = await villageHandoverState(pool);
      expect(state.complete).toBe(true);
      expect(state.remaining).toEqual([]);
      expect(state.held.length).toBe(state.total);
      expect(state.total).toBe(HANDOVER_SET.length);
      expect(state.total, "the whole capability list is the wrong denominator").toBeLessThan(
        ALL_CAPABILITIES.length,
      );
    });

    /*
     * THE CASE THE FIRST READING OF THE PEN RULING GOT WRONG, pinned so it
     * cannot come back. `founderPowerStands` answers whether the GAME has
     * started, and Rye tied the pen to whether the POWERS have been handed
     * over. They diverge the day a launch vote carries and hands the village
     * `steward.veto`: one power of nineteen is not all steward powers.
     */
    it("a village holding only the steward's veto has not completed its handover", async () => {
      await pool.query( // module-review-ok: a fabricated handover state on the scratch schema this suite provisioned
        "INSERT INTO capability_holding (capability, holder_role_id) VALUES ('steward.veto','keepers')",
      );
      const state = await villageHandoverState(pool);
      expect(state.held).toEqual(["steward.veto"]);
      expect(state.complete).toBe(false);
    });

    it("ignores a hand-written row naming a key that may never move", async () => {
      for (const cap of HANDOVER_SET) {
        await pool.query( // module-review-ok: a fabricated handover state on the scratch schema this suite provisioned
          "INSERT INTO capability_holding (capability, holder_role_id) VALUES (?, 'keepers')",
          [cap],
        );
      }
      await pool.query( // module-review-ok: the hand-written row this test exists to catch, on the scratch schema this suite provisioned
        "INSERT INTO capability_holding (capability, holder_role_id) VALUES ('message.send','keepers')",
      );
      const state = await villageHandoverState(pool);
      expect(state.held).not.toContain("message.send");
      expect(state.total).toBe(HANDOVER_SET.length);
    });
  });
});
