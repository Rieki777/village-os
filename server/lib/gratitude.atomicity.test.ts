/**
 * BOTH GRATITUDE DOORS: THE NOTE AND ITS CREDIT LAND TOGETHER, OR NEITHER
 * LANDS.
 *
 * A gratitude note IS the charge — the cycle's allowance is a SUM over
 * `gratitude_log`, so the row that records the gift is the row that spends the
 * budget — and the ledger posting is the delivery. Both doors used to write
 * the note, commit it, and only then call `postTransfer` on a fresh
 * connection. `postTransfer` rolls back and RETHROWS on any database error, so
 * a lock wait or a dropped connection at that moment left the note committed,
 * the allowance spent, and nothing in the recipient's hands: a record saying
 * gratitude was given, and no gratitude. A retry does not heal it, because a
 * retry writes a NEW note id and is therefore a second charge.
 *
 * `give()` in server/lib/economy.ts was fixed first, through the `post`
 * callback on `writeGratitudeRow`. `sendGratitude()` in
 * server/lib/gratitude.ts was still on the old shape and did not even wrap the
 * throw. It now passes the same callback, so both doors post the credit on the
 * note's own connection inside the note's own transaction.
 *
 * THESE TESTS READ THE OUTCOME, not the call. What they measure is what is in
 * `gratitude_log`, what the giver's remaining budget is, and what the
 * recipient's ledger balance is, after a ledger write that fails the way the
 * real one fails. Remove the fix on either door and its case shows a note that
 * exists, a budget that is spent, and a balance that never moved.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied, unique per provision, with issuance already open (R67). No
 * TEST_DATABASE_URL and the suite skips loudly rather than passing hollowly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { balanceOf, loadTokenRegistry, memberAccount } from "./ledger";
import { loadVariables } from "./variables";
import { budgetFor, sendGratitude, type GratitudeDeps } from "./gratitude";
import { allowanceFor, give, HEARTS } from "./economy";
import { gratitudeLogRepo } from "../repos/gratitude";
import type { UsersRepo } from "../repos/users";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

async function makeMember(id: string): Promise<any> {
  await pool.query(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@village.test`],
  );
  await pool.query(
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    [memberAccount(id), "member", id, id],
  );
  const [rows] = await pool.query<any[]>("SELECT * FROM `users` WHERE `id` = ?", [id]);
  return rows[0];
}

/** The users repo the gratitude service needs, over the scratch pool. */
function usersOver(p: mysql.Pool): UsersRepo {
  const load = async (where: string, v: string) => {
    const [rows] = await p.query<any[]>("SELECT * FROM `users` WHERE " + where + " = ? LIMIT 1", [v]);
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
      /* the cached column is not what this suite measures; the ledger is */
    },
  } as unknown as UsersRepo;
}

/**
 * The service's dependencies. `p` is the pool the DOOR writes through, which
 * the failure cases replace with the proxy below; the repos deliberately stay
 * on the real pool, so the measurement afterwards is not taken through the
 * same broken connection that caused the failure.
 */
const deps = (p: mysql.Pool = pool): GratitudeDeps => ({
  pool: p,
  log: gratitudeLogRepo(pool),
  members: usersOver(pool),
  stageMultiplierFor: async () => 1,
});

/**
 * A pool whose connections fail the ledger INSERT the way MySQL fails it under
 * contention, and pass every other statement straight through.
 *
 * The failure is injected at the STATEMENT rather than by stubbing a module,
 * so the transaction is real, the note has genuinely been written when the
 * ledger write dies, and what the test reads afterwards is what a member's
 * village would actually hold. `ER_LOCK_WAIT_TIMEOUT` because that is one of
 * the two errors the writer already names as worth retrying, which makes it
 * the one most likely to arrive on a busy evening — and it also drives the
 * retry, so each case reads the outcome after all three attempts rather than
 * after a single unlucky one.
 */
function poolThatFailsTheLedgerWrite(real: mysql.Pool): mysql.Pool {
  const wrapConn = (conn: any) =>
    new Proxy(conn, {
      get(target: any, prop: string | symbol) {
        if (prop === "query" || prop === "execute") {
          return async (sql: any, params?: any) => {
            const text = typeof sql === "string" ? sql : String(sql?.sql ?? "");
            if (text.includes("INSERT INTO token_ledger")) {
              const err: any = new Error("Lock wait timeout exceeded; try restarting transaction");
              err.code = "ER_LOCK_WAIT_TIMEOUT";
              throw err;
            }
            return target[prop](sql, params);
          };
        }
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(real, {
    get(target: any, prop: string | symbol) {
      if (prop === "getConnection") return async () => wrapConn(await target.getConnection());
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as mysql.Pool;
}

async function notesBetween(from: string, to: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM `gratitude_log` WHERE `from_id` = ? AND `to_id` = ?",
    [from, to],
  );
  return Number(rows[0]?.n ?? 0);
}

describe.skipIf(!configured)("a gratitude note and its credit", () => {
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

  it("charges nobody when the acknowledgement door's ledger write dies", async () => {
    const giver = await makeMember("atomic-ack-from");
    const recipient = await makeMember("atomic-ack-to");
    const before = await budgetFor(deps(), giver);

    const out = await sendGratitude(deps(poolThatFailsTheLedgerWrite(pool)), {
      fromUser: giver,
      toId: recipient.id,
      amount: 5,
      message: "thank you for the harvest",
    });

    // The refusal is reported rather than thrown, which is the small half.
    expect(out.ok).toBe(false);

    // THE OUTCOME, which is the half that matters. The note is not there, the
    // budget was never spent, and no recognition was issued. Post the credit
    // after the commit again and all three of these move: one note, five
    // spent, and still a zero balance, because the credit is what failed.
    expect(await notesBetween(giver.id, recipient.id)).toBe(0);
    const after = await budgetFor(deps(), giver);
    expect(after.spent).toBe(before.spent);
    expect(after.remaining).toBe(before.remaining);
    expect(await balanceOf(pool, memberAccount(recipient.id))).toBe(0);
  });

  it("charges nobody when the Hearts economy's ledger write dies", async () => {
    // The same proof aimed at `give()`, the other door onto the same allowance.
    const giver = await makeMember("atomic-give-from");
    const recipient = await makeMember("atomic-give-to");
    const before = await allowanceFor(pool, giver.id, 1);

    const out = await give(
      poolThatFailsTheLedgerWrite(pool),
      { fromUserId: giver.id, toUserId: recipient.id, amount: 5, note: "for the fence" },
      async () => 1,
    );

    expect(out.ok).toBe(false);
    expect(await notesBetween(giver.id, recipient.id)).toBe(0);
    const after = await allowanceFor(pool, giver.id, 1);
    expect(after.spent).toBe(before.spent);
    expect(await balanceOf(pool, memberAccount(recipient.id), HEARTS)).toBe(0);
  });

  it("still delivers both when the ledger is well", async () => {
    // The control. Without this the two tests above would pass just as happily
    // against a door that refuses every send there has ever been.
    const giver = await makeMember("atomic-ok-from");
    const recipient = await makeMember("atomic-ok-to");
    const before = await budgetFor(deps(), giver);

    const out = await sendGratitude(deps(), {
      fromUser: giver,
      toId: recipient.id,
      amount: 5,
      message: "thank you for the harvest",
    });

    expect(out.ok).toBe(true);
    expect(await notesBetween(giver.id, recipient.id)).toBe(1);
    expect((await budgetFor(deps(), giver)).spent).toBe(before.spent + 5);
    expect(await balanceOf(pool, memberAccount(recipient.id))).toBe(5);
  });
});
