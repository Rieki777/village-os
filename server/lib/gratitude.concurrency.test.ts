/**
 * The gratitude send door under concurrency (ECON lane, S3).
 *
 * `sendGratitude` checked the cycle's allowance as three separate, unlocked
 * reads and writes: `budgetFor` summed spent gratitude with a plain pool
 * query, the per-recipient running total was a second unlocked await, and the
 * `gratitude_log` row was a third write with nothing holding the giver's row
 * between the reads and the write. Five requests arriving together could each
 * read the same "nothing spent yet" snapshot and each commit, moving more
 * value than the cycle's allowance ever promised, and doing the identical
 * thing to the per-recipient concentration cap.
 *
 * `server/economy.test.ts`'s "holds the allowance against five simultaneous
 * gives" proves the OTHER door, the Hearts economy's `give()`, is immune to
 * exactly this shape of race: it reads the allowance and writes the note
 * under one SERIALIZABLE transaction with `FOR UPDATE` on the giver's row.
 * This is the same proof, aimed at `sendGratitude`.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied, unique per provision. No TEST_DATABASE_URL and the suite skips
 * loudly rather than passing hollowly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { loadTokenRegistry, memberAccount } from "./ledger";
import { loadVariables } from "./variables";
import { budgetFor, sendGratitude, type GratitudeDeps } from "./gratitude";
import { fullSendsIn, shareCapFor } from "./economy";
import { gratitudeLogRepo } from "../repos/gratitude";
import type { UsersRepo } from "../repos/users";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

async function makeMember(id: string): Promise<any> {
  await pool.query(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@village.test`],
  );
  await pool.query(
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  const [rows] = await pool.query<any[]>("SELECT * FROM `users` WHERE `id` = ?", [id]);
  return rows[0];
}

/** The users repo the gratitude service needs, over the scratch pool. */
function usersOver(p: mysql.Pool): UsersRepo {
  const load = async (where: string, v: string) => {
    const [rows] = await p.query<any[]>(`SELECT * FROM \`users\` WHERE ${where} = ? LIMIT 1`, [v]);
    return rows[0] ?? null;
  };
  return {
    async all() {
      const [rows] = await p.query<any[]>("SELECT * FROM `users`");
      return rows as any;
    },
    byId: (id: string) => load("`id`", id),
    byEmail: (email: string) => load("`email`", email),
    async update() {
      /* the recipient's cached balance is not what this suite measures */
    },
  } as unknown as UsersRepo;
}

const deps = (): GratitudeDeps => ({
  pool,
  log: gratitudeLogRepo(pool),
  members: usersOver(pool),
  stageMultiplierFor: async () => 1,
});

describe.skipIf(!configured)("the gratitude send door under concurrency", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 });
    await loadTokenRegistry(pool);
    await loadVariables(pool);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("holds the allowance against simultaneous sends, one more than it can hold", async () => {
    const giver = await makeMember("send-race-from");
    const before = await budgetFor(deps(), giver);
    // EXACTLY the per-recipient ceiling, read from the engine rather than
    // written down here. Any larger and that ceiling refuses these gifts before
    // the lock ever sees them, and the test proves nothing about the lock.
    //
    // This was `total / 4`, which was the ceiling only while the dial happened
    // to be a 25% share, and it stopped being true the moment the dial became
    // `gratitude.full_sends_per_cycle`. The suite then failed in CI having
    // passed everywhere else, because every send was refused by the ceiling and
    // `accepted` came back 0. Deriving it means the next dial change cannot
    // silently turn this into a test of the wrong thing.
    const each = shareCapFor(before.total);
    expect(each).toBeGreaterThan(0);

    // One more gift than the allowance can hold, whatever the dials say: it
    // holds `fullSendsIn` of these by definition, so asking for one more
    // guarantees the overflow the lock has to refuse. Different recipients
    // throughout, so the per-recipient ceiling never binds and only the
    // allowance can refuse the last.
    const n = fullSendsIn(before.total) + 1;
    const recipients = await Promise.all(
      Array.from({ length: n }, (_, i) => makeMember(`send-race-to-${i + 1}`)),
    );

    // Fired together, so the only thing that can refuse the last is the lock.
    const results = await Promise.all(
      recipients.map((to) =>
        sendGratitude(deps(), { fromUser: giver, toId: to.id, amount: each, message: "thank you" }),
      ),
    );

    const after = await budgetFor(deps(), giver);
    // THE ASSERTION. Broken code lets this go over `before.total`; the lock
    // makes it structurally impossible.
    expect(after.spent).toBeLessThanOrEqual(before.total);
    const accepted = results.filter((r) => r.ok).length;
    expect(accepted * each).toBeLessThanOrEqual(before.total);
    expect(accepted).toBeGreaterThan(0);
  });

  it("holds the per-recipient concentration cap against five simultaneous sends to one person", async () => {
    // Same shape, aimed at the OTHER unlocked read: the per-recipient running
    // total. Five sends of the whole share cap to the SAME person, fired
    // together: at most one may land if the share is enforced atomically;
    // broken code lets several land because each reads "0 given to them yet".
    const giver = await makeMember("share-race-from");
    const recipient = await makeMember("share-race-to");
    const before = await budgetFor(deps(), giver);
    // The ceiling itself, from the engine. Hardcoded as `total * 25 / 100`
    // before, which is the same twin as the one above: once the dial became a
    // count of full sends this asked for more than the ceiling allows, so all
    // five were refused by the ceiling and none by the lock, and `accepted`
    // came back 0 where the test wanted exactly 1.
    const share = shareCapFor(before.total);
    expect(share).toBeGreaterThan(0);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        sendGratitude(deps(), { fromUser: giver, toId: recipient.id, amount: share, message: "thank you" }),
      ),
    );

    const [[row]] = await pool.query<any[]>(
      "SELECT COALESCE(SUM(`amount`),0) AS s FROM `gratitude_log` WHERE `from_id` = ? AND `to_id` = ?",
      [giver.id, recipient.id],
    );
    const totalToRecipient = Number(row.s);
    expect(totalToRecipient).toBeLessThanOrEqual(share);
    const accepted = results.filter((r) => r.ok).length;
    expect(accepted).toBe(1);
  });
});
