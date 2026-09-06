/**
 * A WHOLE DEPARTURE ON THE SHIPPED DIALS, POSTING FOR POSTING.
 *
 * The ten `Exit` dials landed with defaults chosen to reproduce today exactly.
 * `shared/gameVariables.test.ts` asserts each of those defaults by name, which
 * is a claim about a string in a registry. This file is the other half: it
 * runs a real exit against a scratch schema with every migration applied and
 * reads what actually reached `token_ledger`.
 *
 * WHY BOTH HALVES ARE NEEDED. A default asserted in the registry proves
 * nothing about the sweep, because `server/lib/exit.ts` does not read the
 * registry at all. A posting measured here proves nothing about the defaults,
 * because the same rows would appear whatever the dials said. Together they
 * say the sentence that matters: an untouched village's departure moves the
 * same value, from the same account, to the same account, under the same key,
 * as it did before these dials existed.
 *
 * HOW "THE SAME AS MAIN" IS MEASURED AND NOT ASSUMED. `EXPECTED` below is the
 * shape `origin/main`'s `sweepBalances` writes, read off that file. The runner
 * (`scripts/../X1-exit`, and the commit message) swaps `server/lib/exit.ts`
 * for `origin/main`'s copy and runs this file again; the `X1ROWS` line both
 * runs print is compared byte for byte. The two versions differ only in the
 * HUMAN number they return in `swept` and in comments, and this file asserts
 * both the minor integer that was posted and the human number that came back,
 * so a change to either end shows up here.
 *
 * THREE TOKENS AT THREE SCALES, for the reason `exit.test.ts` gives: at
 * decimals 0 a units bug is invisible, because a human number and a minor unit
 * are the same number.
 *
 * Runs against the S5 harness: a scratch schema, unique per provision. No
 * TEST_DATABASE_URL and it skips loudly.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { VARIABLES, VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { ensureVoiceToken, fromLedgerUnits, VILLAGE_VOICE } from "./economy";
import {
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  MINT_FAUCET,
  postTransfer,
  registerToken,
} from "./ledger";
import { createExit, EXIT_SETTLEMENT, exitOpenState, openExitFor, sweepBalances } from "./exit";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[exitDefaults] TEST_DATABASE_URL not set - this file SKIPPED. A skip is not a pass.");
}

/** decimals 0 by the registry's default, registered by 0007. */
const WHOLE = "credits";
/** decimals 3 today, registered by `ensureVoiceToken`. */
const VOICE = VILLAGE_VOICE;
/** decimals 4: the scale the ruling is moving everything to. */
const FINE = "exit-defaults-fine";
const TOKENS = [WHOLE, VOICE, FINE] as const;

/** One integer, three scales. Seeded as MINOR, which is what the sweep reads. */
const MINOR = 12_345;

const USER = "exit-defaults-leaver";

describe.skipIf(!configured)("a departure on the shipped Exit defaults", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let exitId = "";

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the exit.test.ts shape
    await loadTokenRegistry(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await registerToken(pool, {
      slug: FINE,
      name: "Fine Grained Credit",
      kind: "credit",
      governance: "platform",
      transferable: false,
      decimals: 4,
    });
    await loadTokenRegistry(pool);
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'h')",
      [USER, USER, `${USER}@example.test`],
    );
    for (const token of TOKENS) {
      const r = await postTransfer(pool, {
        from: MINT_FAUCET,
        to: memberAccount(USER),
        tokenType: token,
        amount: MINOR,
        source: "test_seed",
        idempotencyKey: `exit-defaults:seed:${token}`,
      });
      if (!r.ok) throw new Error(`could not seed ${token}: ${r.error}`);
    }
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("the ten dials this village runs on are the platform's own, untouched", async () => {
    /*
     * An empty state and a real zero are different facts, and this case is
     * about the empty one: NO row exists in `game_variables` for any Exit key,
     * so every reading below is the platform default inherited, which is the
     * state every village is in on the day these dials land.
     */
    const [rows] = await pool.query<any[]>(
      "SELECT `config_key` FROM `game_variables` WHERE `config_key` LIKE 'exit.%'",
    );
    expect(rows).toEqual([]);
    const exitDials = VARIABLES.filter((v) => v.category === "Exit");
    expect(exitDials).toHaveLength(10);
    expect(VARIABLES_BY_KEY["exit.keep_pct.credit"].default).toBe("0");
    expect(VARIABLES_BY_KEY["exit.keep_pct.voice"].default).toBe("0");
    expect(VARIABLES_BY_KEY["exit.remainder_account"].default).toBe("settlement");
    expect(VARIABLES_BY_KEY["exit.cooling_days"].default).toBe("0");
    expect(VARIABLES_BY_KEY["exit.voice_on_exit"].default).toBe("forfeit");
  });

  it("opening the exit writes no notice date at zero days, and no posting at all", async () => {
    const before = await ledgerRows(pool);
    const made = await createExit(pool, { userId: USER, kind: "voluntary", openedBy: "admin", noticeDays: 0 });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    exitId = made.exit.id;
    // `noticeDays: 0` is what the published policy's cooling lever reproduces:
    // no date is written, so nothing downstream can gate on one.
    expect(made.exit.noticeEndsAt).toBeNull();
    expect(made.exit.status).toBe("open");
    expect(await ledgerRows(pool)).toEqual(before);
    expect(await openExitFor(pool, USER)).not.toBeNull();
  });

  it("the balances domain is enumerated, and it does not block", async () => {
    const states = await exitOpenState(pool, USER, []);
    const balances = states.find((s) => s.domain === "balances");
    expect(balances?.count).toBe(3);
    expect(balances?.blocking).toBe(false);
    // The sentence an admin reads before pressing Sweep, in HUMAN numbers.
    expect(balances?.description).toContain("Swept to exit settlement by an explicit admin act");
    expect(states.find((s) => s.domain === "debts")?.count).toBe(0);
  });

  it("the sweep posts three rows, and they are the rows origin/main writes", async () => {
    const result = await sweepBalances(pool, { exitId, userId: USER });
    expect(result.errors).toEqual([]);

    // The MINOR half: what actually reached token_ledger. Every field of every
    // row, in a stable order, so a change to any one of them is visible.
    const rows = await sweepRowsFor(pool, exitId);

    /*
     * PRINTED BEFORE ANY ASSERTION, on purpose. The comparison run swaps in
     * origin/main's exit.ts, whose `swept` map is in MINOR units and fails the
     * human assertion below; a log line after that expect would never run in
     * the very run it exists to measure, and the two dumps could not be
     * compared at all.
     */
    console.log(`X1ROWS ${JSON.stringify(rows).split(exitId).join("<exitId>")}`);
    expect(rows).toEqual(EXPECTED(exitId));

    // The HUMAN half of the boundary: what a person is told was moved. This
    // is the ONE thing this branch changed against origin/main, and the
    // comparison run is expected to fail exactly here and nowhere else.
    expect(result.swept).toEqual({
      [WHOLE]: fromLedgerUnits(WHOLE, MINOR),
      [VOICE]: fromLedgerUnits(VOICE, MINOR),
      [FINE]: fromLedgerUnits(FINE, MINOR),
    });

    for (const token of TOKENS) {
      expect(await balanceOf(pool, memberAccount(USER), token), token).toBe(0);
    }
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);
  });

  it("the settle act is not held, and the note it hands the route still opens with the line the route always wrote", async () => {
    /*
     * The sweep now returns a REFUSAL slot and a NOTE, and the settle route
     * reads both. On the shipped dials the refusal is absent (cooling is 0, so
     * nothing gates the settle) and the note's first line is the one
     * `origin/main`'s route composed inline, character for character, so an
     * exit row read by any existing surface still says what it said.
     *
     * The capture is the new half, and it is written even here: a reader has
     * to be able to tell "this village settled on the platform's defaults"
     * from "this exit predates the split", and an absent line cannot say the
     * first of those.
     */
    const result = await sweepBalances(pool, { exitId, userId: USER });
    expect(result.refusal).toBeNull();

    const day = new Date().toISOString().slice(0, 10);
    const [first, second, ...rest] = result.note.split("\n").filter((l) => l.length);
    expect(rest).toEqual([]);
    /*
     * Nothing moved on this re-read, so the second line is the no-op line and
     * not a fresh capture. WHICH no-op line is a fact about the defaults: at a
     * keep share of zero the first sweep emptied the account, so this run sees
     * NOTHING OUTSTANDING and never reaches a duplicate key. A village keeping
     * a share leaves a positive balance behind, so its retry meets the
     * duplicate instead and says so; `exitSplit.test.ts` asserts that sentence.
     */
    expect(first).toBe(`[${day}] balances swept: {}`);
    expect(second).toBe(`[${day}] no balance moved: nothing was outstanding`);

    // And a fresh exit on the same defaults captures the defaults.
    const other = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'h')",
      ["exit-defaults-second", "exit-defaults-second", "exit-defaults-second@example.test"],
    );
    expect(other).toBeTruthy();
    await postTransfer(pool, {
      from: MINT_FAUCET, to: memberAccount("exit-defaults-second"), tokenType: WHOLE, amount: 100,
      source: "test_seed", idempotencyKey: "exit-defaults:seed:second",
    });
    const made = await createExit(pool, {
      userId: "exit-defaults-second", kind: "voluntary", openedBy: "admin", noticeDays: 0,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const fresh = await sweepBalances(pool, { exitId: made.exit.id, userId: "exit-defaults-second" });
    expect(fresh.captured).toEqual({
      keep: { credit: 0, voice: 0, recognition: 0, equity: 0 },
      to: "settlement",
      voice: "forfeit",
      rate: "0",
      cooling: 0,
      // HUMAN. The fixture posts 100 MINOR and the captured line reports the
      // figure a person reads off the exit record; the two coincided only while
      // `credits` carried no decimals.
      lines: [{
        token: WHOLE, kind: "credit", to: EXIT_SETTLEMENT,
        held: fromLedgerUnits(WHOLE, 100), kept: 0, moved: fromLedgerUnits(WHOLE, 100),
      }],
    });
    // The reading came off the registry with no `exit.%` row anywhere, which
    // is the inherited-default state the first case in this file pinned.
    expect(fresh.policy).toEqual({
      keepPct: { credit: 0, voice: 0, recognition: 0, equity: 0 },
      remainderAccount: "settlement",
      coolingDays: 0,
      voiceOnExit: "forfeit",
      voiceConvertRate: "0",
    });
  });

  it("a second sweep on the same exit posts nothing, whatever the dials say later", async () => {
    // The idempotency key carries no policy, so a re-run is the same key and
    // the same no-op, and that property survived the split: with nothing kept
    // the account is empty, so this run finds no balance rather than a
    // duplicate key. A village keeping a share meets the duplicate instead.
    const before = await sweepRowsFor(pool, exitId);
    const again = await sweepBalances(pool, { exitId, userId: USER });
    expect(again.swept).toEqual({});
    expect(again.errors).toEqual([]);
    expect(await sweepRowsFor(pool, exitId)).toEqual(before);
  });

  it("nothing was deleted: the seeds and the sweeps are all still on the books", async () => {
    // Value rows are never deleted, so conservation holds through a departure.
    // Resolve itself is not reachable from here: `anonymizeMember` is a
    // module-private function inside server/index.ts, so what resolve does to
    // the LEDGER (nothing) is asserted as the absence of any further row.
    const [[all]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM `token_ledger`");
    // Three seeds and three sweeps for the leaver above, plus the one seed and
    // one sweep the capture case opened a second departure for. Every re-run
    // of an already-settled sweep added nothing, which is the other half of
    // what this count is watching.
    expect(Number(all.n)).toBe(8);
  });
});

/** Every posting on this schema, ordered so two runs are comparable. */
async function ledgerRows(pool: mysql.Pool): Promise<unknown[]> {
  const [rows] = await pool.query<any[]>(
    "SELECT `from_account`, `to_account`, `token_type`, `amount`, `source`, `description`, `idempotency_key` " +
      "FROM `token_ledger` ORDER BY `idempotency_key`",
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** The sweep's own rows for one exit, in token order. */
async function sweepRowsFor(pool: mysql.Pool, exitId: string): Promise<unknown[]> {
  const [rows] = await pool.query<any[]>(
    "SELECT `from_account`, `to_account`, `token_type`, `amount`, `source`, `source_ref`, `description`, `idempotency_key` " +
      "FROM `token_ledger` WHERE `source_ref` = ? ORDER BY `token_type`",
    [exitId],
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/**
 * What `origin/main`'s `sweepBalances` writes, read off that file: the whole
 * positive balance, `mem:<user>` to `sys:exit-settlement`, source
 * `exit_settlement`, description "Balance settled at departure", key
 * `exit:<exitId>:sweep:<token>`. Ordered by token_type, which is the SQL's
 * order and not the map iteration order, so the comparison does not depend on
 * how `balancesFor` happened to yield.
 */
const EXPECTED = (exitId: string): unknown[] =>
  [...TOKENS]
    .sort()
    .map((token) => ({
      from_account: memberAccount(USER),
      to_account: EXIT_SETTLEMENT,
      token_type: token,
      amount: MINOR,
      source: "exit_settlement",
      source_ref: exitId,
      description: "Balance settled at departure",
      idempotency_key: `exit:${exitId}:sweep:${token}`,
    }));
