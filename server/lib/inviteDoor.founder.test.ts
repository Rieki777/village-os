/**
 * A FRESH VILLAGE ADMITS ITS FIRST MEMBERS THROUGH ITS OWN DOOR (readiness
 * R068, S2; merged R193).
 *
 * On a blank village the bar is 3 vouches (`membership.vouches_required`
 * defaults to the launch vote's minimum electorate), an invitation records one
 * arrival vouch, and before launch nobody but an admin can vouch. So the
 * founder's first invitees arrived as guests, the launch roll stayed at 1, and
 * the only ways out were admin acts no founder doc names.
 *
 * Before launch (`founderPowerStands`), a FOUNDER's invitation now admits the
 * person it was made for when they make their account. What is pinned:
 *
 *   - before launch, a founder's invitee is a member on arrival, and the
 *     arrival vouch is still recorded;
 *   - after launch, the same invitation is one vouch of three, as for anybody;
 *   - before launch, an invitation from somebody who is not a founder is one
 *     vouch of three: the rule is the founder's, never every inviter's;
 *   - a village that switched vouching off admits nobody on any vouch,
 *     the founder's included.
 */
import type mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { usersRepo } from "../repos/users";
import { vouchesFor } from "../repos/vouches";
import { makeInviteDoor } from "./inviteDoor";
import { loadVariables } from "./variables";

const configured = testDbConfigured();
if (!configured) console.warn("[inviteDoor.founder] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe.skipIf(!configured)("a founder's invitation before launch, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seq = 0;

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned
  const door = () => makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });

  /** An account, with a role when one is given. */
  const account = async (role?: "founder" | "admin") => {
    seq += 1;
    const id = `u-fd-${seq}`;
    // Through the repository, role and all: a raw UPDATE would sit under its cache, unseen.
    await usersRepo(pool).add({ id, name: `Person ${seq}`, email: `${id}@example.test`, passwordHash: "x", paths: [], ...(role ? { role } : {}) });
    return id;
  };

  const admitted = async (id: string) => (await usersRepo(pool).byId(id))?.membershipGranted === true;
  const launched = (yes: boolean) =>
    yes
      ? q("INSERT INTO app_config (config_key, value) VALUES ('game-start', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify({ startedAt: "2026-11-01T00:00:00.000Z" })])
      : q("DELETE FROM app_config WHERE config_key = 'game-start'");

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    // The S5 harness provisions a village whose Game has started; these cases begin before launch.
    await launched(false);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  afterEach(async () => {
    await launched(false);
    await q("DELETE FROM game_variables WHERE config_key = 'membership.vouches_required'");
    await loadVariables(pool);
  });

  it("before launch, a founder's invitee is a member on arrival, and the arrival vouch is still recorded", async () => {
    const founder = await account("founder");
    const newcomer = await account();
    await door().welcome(founder, newcomer);
    expect(await admitted(newcomer)).toBe(true);
    expect((await vouchesFor(pool, newcomer)).map((v) => [v.voucherUserId, v.kind])).toEqual([[founder, "arrival"]]);
  });

  it("after launch, the same invitation is one vouch of three, as for anybody", async () => {
    await launched(true);
    const founder = await account("founder");
    const newcomer = await account();
    await door().welcome(founder, newcomer);
    expect(await admitted(newcomer)).toBe(false);
    expect(await vouchesFor(pool, newcomer)).toHaveLength(1);
  });

  it("before launch, an invitation from somebody who is not a founder is one vouch of three", async () => {
    for (const role of [undefined, "admin"] as const) {
      const inviter = await account(role);
      const newcomer = await account();
      await door().welcome(inviter, newcomer);
      expect(await admitted(newcomer), String(role)).toBe(false);
      expect(await vouchesFor(pool, newcomer), String(role)).toHaveLength(1);
    }
  });

  it("a village that switched vouching off admits nobody on any vouch, the founder's included", async () => {
    // The dial as a village sets it: stored, then read back the way the server loads it at boot.
    await q("INSERT INTO game_variables (config_key, value, value_type) VALUES ('membership.vouches_required', '0', 'integer') ON DUPLICATE KEY UPDATE value = VALUES(value)");
    await loadVariables(pool);
    const founder = await account("founder");
    const newcomer = await account();
    await door().welcome(founder, newcomer);
    expect(await admitted(newcomer)).toBe(false);
  });
});
