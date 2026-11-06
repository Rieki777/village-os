/**
 * NOTHING IS SENT TO A MEMBER WHO HAS LEFT (`sendGratitude`).
 *
 * An erased member's row stays as a tombstone: "A departed member" at
 * `deleted-<id>@anonymized.invalid`, so the ledger and the history still have
 * somebody to point at. `sendGratitude` looked the recipient up by address or
 * by id and refused only the standing examples. So anybody who typed that
 * address, or hearted a departed member's old forum post, issued Gratitude
 * from the faucet into an account nobody holds: the giver's allowance spent,
 * and voting weight (Gratitude is the voting-weight token by default) piling up
 * in the name of somebody who is gone.
 *
 * Every door into the service is driven here: the address as a caller passes
 * it, in capitals, the id, the one field a member types on the wall (an
 * address, and the old `departed-` handle a tombstone from before round 2 still
 * wears until the boot backfill reaches it), and a forum heart. Each one is
 * measured by what moved, the log rows and the ledger legs, never by the
 * status alone. The first case is the control: the same giver, the same
 * amount, a living member, and the gift lands.
 *
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (house rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { loadTokenRegistry, memberAccount } from "./ledger";
import { loadVariables } from "./variables";
import { budgetFor, DEPARTED_RECIPIENT, mintRecipientRefusal, sendGratitude, type GratitudeDeps } from "./gratitude";
import { EXAMPLE_REFUSAL_BODY } from "./examples";
import { gratitudeLogRepo } from "../repos/gratitude";
import { usersRepo } from "../repos/users";

const configured = testDbConfigured();
if (!configured) console.warn("[gratitude.tombstone] TEST_DATABASE_URL not set. DB-backed tests SKIPPED. A skip is not a pass.");

let db: TestDb;
let pool: mysql.Pool;

const GIVER = "gt-giver";
const LIVING = "gt-living";
const GONE = "gt-gone";
const GONE_ADDRESS = `deleted-${GONE}@anonymized.invalid`;
/** The handle a tombstone from before round 2 still wears until the backfill takes it off. */
const GONE_HANDLE = `departed-${GONE.slice(-8)}`;

const q = async (sql: string, params: unknown[] = []): Promise<any[]> => {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows;
};

async function seedUser(id: string, name: string, email: string, handle: string | null): Promise<void> {
  await q(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?,?,?,?,?)", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    [id, name, email, id === GONE ? "" : "x", handle],
  );
  await q(
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    [memberAccount(id), "member", id, id],
  );
}

const deps = (): GratitudeDeps => ({
  pool,
  log: gratitudeLogRepo(pool),
  members: usersRepo(pool),
  stageMultiplierFor: async () => 1,
});

const giver = async () => usersRepo(pool).byId(GIVER);

/** What reached this member: acknowledgement rows and ledger legs. */
async function received(id: string): Promise<{ log: number; legs: number }> {
  const log = await q("SELECT COUNT(*) AS n FROM `gratitude_log` WHERE `to_id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const legs = await q("SELECT COUNT(*) AS n FROM `token_ledger` WHERE `to_account` = ?", [memberAccount(id)]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return { log: Number(log[0].n), legs: Number(legs[0].n) };
}

describe.skipIf(!configured)("gratitude and a member who has left (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await seedUser(GIVER, "Ada Giver", `${GIVER}@example.test`, "ada-giver");
    await seedUser(LIVING, "Lin Here", `${LIVING}@example.test`, "lin-here");
    await seedUser(GONE, "A departed member", GONE_ADDRESS, GONE_HANDLE);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("the control: the same gift to a living member lands", async () => {
    const out = await sendGratitude(deps(), { fromUser: await giver(), toEmail: `${LIVING}@example.test`, amount: 1, message: "For the bread." });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(await received(LIVING)).toEqual({ log: 1, legs: 1 });
  });

  const doors: Array<[string, () => Promise<Record<string, unknown>>]> = [
    ["by the address a caller passes", async () => ({ toEmail: GONE_ADDRESS })],
    ["by the address in capitals", async () => ({ toEmail: GONE_ADDRESS.toUpperCase() })],
    ["by id", async () => ({ toId: GONE })],
    ["by the address typed on the wall", async () => ({ to: GONE_ADDRESS })],
    ["by the old departed- handle typed on the wall", async () => ({ to: `@${GONE_HANDLE}` })],
    ["as a heart on their old forum post", async () => ({ toId: GONE, kind: "heart", contextType: "post", contextRef: "thread-gone-1" })],
  ];

  for (const [door, input] of doors) {
    it(`refuses ${door}, and nothing moves`, async () => {
      const spentBefore = (await budgetFor(deps(), await giver())).spent;
      const out = await sendGratitude(deps(), { fromUser: await giver(), amount: 1, message: "Thank you.", ...(await input()) });
      expect(out.ok, `nothing is sent to a tombstone ${door}: ${JSON.stringify(out)}`).toBe(false);
      if (out.ok) return;
      expect(out.status).toBe(404);
      expect(out.error, "the giver is told plainly").toMatch(/left the village/);
      expect(await received(GONE), "no acknowledgement and no ledger leg reach the tombstone").toEqual({ log: 0, legs: 0 });
      expect((await budgetFor(deps(), await giver())).spent, "and the giver's allowance is untouched").toBe(spentBefore);
    });
  }

  /*
   * THE ADMIN HAND-MINT ASKS THE SAME QUESTION (round 4). Its route and its
   * co-signed approval live in server/index.ts, where no test can call them,
   * and needsTombstone.routes.e2e drives both through the built server. This
   * case pins the question itself against rows exactly as the real repo reads
   * them back: the tombstone by its address, a standing example by its
   * is_example flag, and a living member, who is paid.
   */
  it("the hand-mint refuses the tombstone and a standing example as the repo reads them, and pays a living member", async () => {
    const EXAMPLE = "gt-example";
    await q(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `is_example`) VALUES (?, 'Sample Sorrel', ?, '', 1)", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      [EXAMPLE, `${EXAMPLE}@examples.invalid`],
    );
    const repo = usersRepo(pool);
    expect(mintRecipientRefusal(await repo.byId(GONE)), "a tombstone is refused with the sentence every send door gives").toEqual({
      status: 404,
      body: { error: DEPARTED_RECIPIENT },
    });
    expect(mintRecipientRefusal(await repo.byId(EXAMPLE)), "a standing example is refused as every admin door refuses it").toEqual({
      status: 409,
      body: EXAMPLE_REFUSAL_BODY,
    });
    expect(mintRecipientRefusal(await repo.byId(LIVING)), "the control: a living member is minted to").toBeNull();
    expect(mintRecipientRefusal(null), "a missing row is the route's own 404").toBeNull();
  });
});
