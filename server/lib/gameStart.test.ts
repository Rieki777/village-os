/**
 * ISSUANCE WAITS FOR THE VILLAGE (R67), proven against a real MySQL.
 *
 * This is the ONE suite that provisions with `gameStarted: false`, so it is
 * the only place the closed gate is visible. Everything it asserts is the
 * behaviour a brand new fork gets on its first day:
 *
 *  - a faucet posting is refused, and refused with a sentence a steward can
 *    read, before the launch ballot carries;
 *  - the refusal is a ROLLBACK: no ledger row, no balance, nothing to clean up;
 *  - a posting between two ordinary accounts is untouched, because moving
 *    tokens that already exist is not issuance;
 *  - recording the start opens it, once, and a second record leaves the first
 *    row exactly as it was.
 *
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (house rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  balanceOf,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
  postTransferPair,
  RECOGNITION_FAUCET,
  TREASURY,
} from "./ledger";
import { readGameStart, recordGameStart, issuanceRefusal, plantingPhase } from "./gameStart";
import { launchedAtOf } from "./launch";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let n = 0;
const key = () => `gamestart-test:${++n}`;

describe.skipIf(!configured)("the Game's start gates issuance (MySQL)", () => {
  beforeAll(async () => {
    // The whole point of this suite: a village that has NOT started.
    db = await provisionTestDb({ gameStarted: false });
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads a village that has never voted as not started", async () => {
    const fact = await readGameStart(pool);
    expect(fact.started).toBe(false);
    expect(fact.startedAt).toBeNull();
    expect(fact.ballotId).toBeNull();
    expect(await issuanceRefusal(pool)).toContain("has not started its Game");
    // The setup game's planting rule reads the same fact: one founder may plant anything.
    expect(await plantingPhase(pool)).toBe("before-launch");
  });

  it("refuses a faucet posting before the launch vote carries, and writes nothing", async () => {
    const to = memberAccount("u-early");
    const idem = key();
    const r = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to,
      amount: 40,
      source: "quest_consent",
      idempotencyKey: idem,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("has not started its Game");
    expect(r.error).toContain("launch vote carries");

    // A refusal is a rollback. Nothing landed, so nothing has to be undone.
    const [rows] = await pool.query<any[]>("SELECT id FROM token_ledger WHERE idempotency_key = ?", [idem]);
    expect(rows.length).toBe(0);
    expect(await balanceOf(pool, to)).toBe(0);
  });

  it("refuses a PAIR whose leg issues, and leaves both legs unwritten", async () => {
    // Fund the treasury is exactly what a closed gate will not do, so the pair
    // under test issues on its first leg and moves nothing on its second.
    const a = key();
    const b = key();
    const r = await postTransferPair(pool, [
      {
        from: RECOGNITION_FAUCET,
        to: memberAccount("u-swap"),
        amount: 5,
        source: "manual_mint",
        idempotencyKey: a,
      },
      {
        from: memberAccount("u-swap"),
        to: TREASURY,
        amount: 5,
        source: "swap",
        idempotencyKey: b,
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("has not started its Game");
    const [rows] = await pool.query<any[]>(
      "SELECT id FROM token_ledger WHERE idempotency_key IN (?, ?)",
      [a, b],
    );
    expect(rows.length).toBe(0);
  });

  it("leaves an ordinary transfer alone: moving what exists is not issuing", async () => {
    // Two ordinary accounts, funded by hand so no faucet is involved. This is
    // the property that keeps the gate narrow: a village that has not started
    // has nothing to spend, so nothing is taken away from anybody.
    await pool.query(
      "INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?,?,?,?,0)", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      ["sys:test-vault", "system", null, "test vault"],
    );
    await pool.query(
      "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, idempotency_key) " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "VALUES (?,?,?,?,?,?,?)",
      ["led-fixture-1", RECOGNITION_FAUCET, "sys:test-vault", "gratitude", 100, "fixture", key()],
    );
    const moved = await postTransfer(pool, {
      from: "sys:test-vault",
      to: memberAccount("u-spend"),
      amount: 30,
      source: "manual",
      idempotencyKey: key(),
    });
    expect(moved.ok).toBe(true);
    expect(moved.toBalance).toBe(30);
  });

  it("opens issuance when the launch ballot carries, and starts once ever", async () => {
    const first = await recordGameStart(pool, {
      ballotId: "bal-launch-1",
      startedBy: "u-closer",
      note: "The village voted to start its Game.",
      at: new Date("2026-08-29T10:00:00.000Z"),
    });
    expect(first.started).toBe(true);
    expect(first.ballotId).toBe("bal-launch-1");
    expect(await issuanceRefusal(pool)).toBeNull();
    expect(await plantingPhase(pool)).toBe("after-launch");

    const paid = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount("u-early"),
      amount: 40,
      source: "quest_consent",
      idempotencyKey: key(),
    });
    expect(paid.ok).toBe(true);
    expect(paid.toBalance).toBe(40);

    // A second start is a no-op on the row that stands. The instant and the
    // ballot are the first ones, always.
    const second = await recordGameStart(pool, {
      ballotId: "bal-launch-2",
      startedBy: "u-someone-else",
      note: "A second close that should change nothing.",
      at: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(second.ballotId).toBe("bal-launch-1");
    expect(second.startedAt).toBe("2026-08-29T10:00:00.000Z");
    expect(second.startedBy).toBe("u-closer");
  });
});

/**
 * MIGRATION 0112 IS THE THING THAT DECIDES WHETHER A LIVE VILLAGE GOES DARK,
 * so its SQL is run here against a real database instead of read and trusted.
 *
 * Two villages, one file: one whose ledger proves it was already issuing
 * before the vote existed, and one that has never issued. The first is
 * recorded as started with no ballot behind it. The second is left alone.
 */
describe.skipIf(!configured)("migration 0112 grandfathers a village that was already issuing", () => {
  const sql = () =>
    fs.readFileSync(path.join(process.cwd(), "drizzle", "0112_game_start.sql"), "utf8");

  it("records a start, with no ballot, for a ledger that already shows issuance", async () => {
    const live = await provisionTestDb({ gameStarted: false });
    try {
      await live.conn.query(
        "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, idempotency_key, `at`) " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "VALUES (?,?,?,?,?,?,?,?)",
        [
          "led-old-1",
          RECOGNITION_FAUCET,
          memberAccount("u-veteran"),
          "gratitude",
          12,
          "quest_consent",
          "old:1",
          "2026-03-04 09:00:00",
        ],
      );
      await live.conn.query(sql());
      const fact = await readGameStart(live.conn as any);
      expect(fact.started).toBe(true);
      // The evidence is the earliest faucet posting, and it says so in words.
      expect(fact.startedAt).toBe("2026-03-04T09:00:00Z");
      expect(fact.ballotId).toBeNull();
      expect(fact.startedBy).toBeNull();
      expect(fact.note).toContain("already issuing tokens before the launch vote existed");
      // THE REASON plantingPhase reads this row and never launchedAt: a village
      // that was live before the ballot existed has no launchedAt at all, and
      // must still ask for a co-sign on a production key.
      expect(await launchedAtOf(live.conn as any)).toBeNull();
      expect(await plantingPhase(live.conn as any)).toBe("after-launch");

      // Re-running the migration leaves the row exactly where it was.
      await live.conn.query(sql());
      expect((await readGameStart(live.conn as any)).startedAt).toBe("2026-03-04T09:00:00Z");
    } finally {
      await live.drop();
    }
  });

  it("leaves a village that has never issued un-started", async () => {
    const fresh = await provisionTestDb({ gameStarted: false });
    try {
      await fresh.conn.query(sql());
      expect((await readGameStart(fresh.conn as any)).started).toBe(false);
    } finally {
      await fresh.drop();
    }
  });
});

describe.skipIf(!configured)("the harness fixture starts a village by default", () => {
  it("provisions an ordinary mid-life village, so the rest of the suite mints", async () => {
    const started = await provisionTestDb();
    try {
      const p = mysql.createPool({ uri: started.url, timezone: "Z", connectionLimit: 2 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
      try {
        const fact = await readGameStart(p);
        expect(fact.started).toBe(true);
        // A fixture marker nobody can mistake for a vote a village held.
        expect(fact.ballotId).toBe("bal-fixture");
      } finally {
        await p.end();
      }
    } finally {
      await started.drop();
    }
  });
});
