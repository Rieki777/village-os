/**
 * A WHOLE DEPARTURE ON THE SHIPPED DIALS, POSTING FOR POSTING.
 *
 * `shared/gameVariables.test.ts` asserts each of the ten `Exit` defaults by
 * name, which is a claim about a string in a registry. This file is the other
 * half: it runs a real exit against a scratch schema with every migration
 * applied and reads what actually reached `token_ledger`.
 *
 * WHY BOTH HALVES ARE NEEDED. A default asserted in the registry proves
 * nothing about the sweep, because `server/lib/exit.ts` does not read the
 * registry at all. A posting measured here proves nothing about the defaults,
 * because the same rows would appear whatever the dials said. Together they
 * say the sentence that matters about an untouched village's departure.
 *
 * WHAT THAT SENTENCE IS CHANGED ON 2026-10-23, and this file changed with it.
 * Until then the defaults reproduced the departure the platform always had:
 * every positive balance moved in full to `sys:exit-settlement`, and this file
 * pinned those rows against `origin/main`'s own postings. The founder then
 * ruled that members keep their tokens ("a if b hasn't already happened"), so
 * the credit, Voice and equity shares default to 100 and Voice is kept. A test
 * that pins a behaviour proves it was intended, not that it is right; the
 * ruling changed what is intended, so the assertions below are the new
 * defaults and not the old ones.
 *
 * WHAT STAYED BYTE FOR BYTE. Recognition's share is still 0, so a recognition
 * balance still posts exactly the row every balance used to: the whole amount,
 * `mem:<user>` to `sys:exit-settlement`, source `exit_settlement`, description
 * "Balance settled at departure", key `exit:<exitId>:sweep:<token>`. `EXPECTED`
 * below is that shape, read off the sweep this file has always pinned.
 *
 * WHAT RESOLVE THEN DOES is not reachable from a ledger test: it needs the
 * users repository and every erasure dependency the server wires.
 * `server/exitLevers.routes.e2e.test.ts` drives it through the real door, and
 * proves both outcomes there: a holder kept as a former member, and an empty
 * account erased.
 *
 * THREE KEPT TOKENS AT THREE SCALES, for the reason `exit.test.ts` gives: at
 * decimals 0 a units bug is invisible, because a human number and a minor unit
 * are the same number.
 *
 * Runs against the S5 harness: a scratch schema, unique per provision. No
 * TEST_DATABASE_URL and it skips loudly.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { VARIABLES, VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { ensureVoiceToken, fromLedgerUnits, HEARTS, VILLAGE_VOICE } from "./economy";
import {
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  MINT_FAUCET,
  postTransfer,
  RECOGNITION_FAUCET,
  registerToken,
} from "./ledger";
import { createExit, EXIT_SETTLEMENT, exitOpenState, openExitFor, sweepBalances } from "./exit";
import { setExitResolution } from "../repos/exitNotes";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[exitDefaults] TEST_DATABASE_URL not set - this file SKIPPED. A skip is not a pass.");
}

/** decimals 0 by the registry's default, registered by 0007. */
const WHOLE = "credits";
/** Village Voice, registered by `ensureVoiceToken`. */
const VOICE = VILLAGE_VOICE;
/** decimals 4: the finest scale a platform token carries. */
const FINE = "exit-defaults-fine";
/** The three a leaver keeps on the shipped dials. */
const KEPT = [WHOLE, VOICE, FINE] as const;
/** Recognition, the one kind still settled at departure. */
const THANKS = HEARTS;

/** One integer, every scale. Seeded as MINOR, which is what the sweep reads. */
const MINOR = 12_345;

const USER = "exit-defaults-leaver";

describe.skipIf(!configured)("a departure on the shipped Exit defaults", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let exitId = "";

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the exit.test.ts shape
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
    for (const token of KEPT) {
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
    const thanks = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount(USER),
      tokenType: THANKS,
      amount: MINOR,
      source: "test_seed",
      idempotencyKey: `exit-defaults:seed:${THANKS}`,
    });
    if (!thanks.ok) throw new Error(`could not seed ${THANKS}: ${thanks.error}`);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("the ten dials this village runs on are the platform's own, untouched, and they are the ruling", async () => {
    /*
     * An empty state and a real zero are different facts, and this case is
     * about the empty one: NO row exists in `game_variables` for any Exit key,
     * so every reading below is the platform default inherited, which is the
     * state every village that never touched a dial is in.
     */
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `config_key` FROM `game_variables` WHERE `config_key` LIKE 'exit.%'",
    );
    expect(rows).toEqual([]);
    const exitDials = VARIABLES.filter((v) => v.category === "Exit");
    expect(exitDials).toHaveLength(10);
    expect(VARIABLES_BY_KEY["exit.keep_pct.credit"].default).toBe("100");
    expect(VARIABLES_BY_KEY["exit.keep_pct.voice"].default).toBe("100");
    expect(VARIABLES_BY_KEY["exit.keep_pct.equity"].default).toBe("100");
    expect(VARIABLES_BY_KEY["exit.keep_pct.recognition"].default).toBe("0");
    expect(VARIABLES_BY_KEY["exit.remainder_account"].default).toBe("settlement");
    expect(VARIABLES_BY_KEY["exit.cooling_days"].default).toBe("0");
    expect(VARIABLES_BY_KEY["exit.voice_on_exit"].default).toBe("keep");
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

  it("the balances domain is enumerated, it does not block, and it says what resolve will do", async () => {
    const states = await exitOpenState(pool, USER, []);
    const balances = states.find((s) => s.domain === "balances");
    expect(balances?.count).toBe(4);
    expect(balances?.blocking).toBe(false);
    // The sentence an admin reads before pressing Sweep, in HUMAN numbers.
    expect(balances?.description).toContain(`${fromLedgerUnits(FINE, MINOR)} ${FINE}`);
    expect(balances?.description).toContain("Settled by the village's exit shares in an explicit admin act");
    expect(balances?.description).toContain("the account stays on as a former member");
    expect(states.find((s) => s.domain === "debts")?.count).toBe(0);
  });

  it("the sweep keeps every credit, Voice and equity balance and posts one row, for recognition", async () => {
    const result = await sweepBalances(pool, { exitId, userId: USER });
    expect(result.errors).toEqual([]);

    // The MINOR half: what actually reached token_ledger. Every field of every
    // row, so a change to any one of them is visible.
    const rows = await sweepRowsFor(pool, exitId);
    expect(rows).toEqual(EXPECTED(exitId));

    // The HUMAN half of the boundary: what a person is told was moved.
    expect(result.swept).toEqual({ [THANKS]: fromLedgerUnits(THANKS, MINOR) });

    // Kept means untouched: the three balances are exactly what was seeded.
    for (const token of KEPT) {
      expect(await balanceOf(pool, memberAccount(USER), token), token).toBe(MINOR);
    }
    expect(await balanceOf(pool, memberAccount(USER), THANKS)).toBe(0);
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);

    // The split of record says the same, line by line, in HUMAN numbers.
    const byToken = new Map((result.captured?.lines ?? []).map((l) => [l.token, l]));
    for (const token of KEPT) {
      const line = byToken.get(token);
      expect(line?.kept, token).toBe(fromLedgerUnits(token, MINOR));
      expect(line?.moved, token).toBe(0);
    }
    expect(byToken.get(THANKS)?.moved).toBe(fromLedgerUnits(THANKS, MINOR));
    expect(byToken.get(THANKS)?.to).toBe(EXIT_SETTLEMENT);

    // What the settle route does with the note, on a row that had none: the
    // capture is now on the exit, and the next sweep reads it back. With
    // balances KEPT this matters, because a retry still finds them there.
    await setExitResolution(pool, exitId, result.note);
  });

  it("the settle act is not held, and a second one moves nothing", async () => {
    /*
     * The sweep returns a REFUSAL slot and a NOTE, and the settle route reads
     * both. On the shipped dials the refusal is absent (cooling is 0, so
     * nothing gates the settle) and the note opens with the line the route has
     * always written.
     */
    const result = await sweepBalances(pool, { exitId, userId: USER });
    expect(result.refusal).toBeNull();
    expect(result.swept).toEqual({});

    const day = new Date().toISOString().slice(0, 10);
    const [first, second, ...rest] = result.note.split("\n").filter((l) => l.length);
    expect(rest).toEqual([]);
    /*
     * Nothing moved on this re-read, so the second line is the no-op line and
     * not a fresh capture. The kept balances split, by the CAPTURED policy, to
     * a remainder of zero, which posts nothing and meets no key, and
     * recognition was already emptied, so this run sees NOTHING OUTSTANDING.
     * The capture the first sweep wrote stays the split of record.
     */
    expect(first).toBe(`[${day}] balances swept: {}`);
    expect(second).toBe(`[${day}] no balance moved: nothing was outstanding`);
  });

  it("a fresh exit on the same defaults captures the defaults, even with nothing to post", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'h')",
      ["exit-defaults-second", "exit-defaults-second", "exit-defaults-second@example.test"],
    );
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
    // A village whose dials keep everything still records the policy it
    // applied: nothing posted, nothing was already settled, and no earlier
    // capture exists, so this run IS the first application of a policy.
    expect(fresh.captured).toEqual({
      keep: { credit: 100, voice: 100, recognition: 0, equity: 100 },
      to: "settlement",
      voice: "keep",
      rate: "0",
      cooling: 0,
      lines: [{
        token: WHOLE, kind: "credit", to: EXIT_SETTLEMENT,
        held: fromLedgerUnits(WHOLE, 100), kept: fromLedgerUnits(WHOLE, 100), moved: 0,
      }],
    });
    expect(fresh.swept).toEqual({});
    // The reading came off the registry with no `exit.%` row anywhere, which
    // is the inherited-default state the first case in this file pinned.
    expect(fresh.policy).toEqual({
      keepPct: { credit: 100, voice: 100, recognition: 0, equity: 100 },
      remainderAccount: "settlement",
      coolingDays: 0,
      voiceOnExit: "keep",
      voiceConvertRate: "0",
    });
    expect(await balanceOf(pool, memberAccount("exit-defaults-second"), WHOLE)).toBe(100);
  });

  it("nothing was deleted: the seeds and the one sweep are all still on the books", async () => {
    // Value rows are never deleted, so conservation holds through a departure.
    const [[all]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM `token_ledger`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    // Four seeds and one recognition sweep for the leaver above, plus the one
    // seed the capture case opened a second departure for, which kept it all.
    expect(Number(all.n)).toBe(6);
  });
});

/** Every posting on this schema, ordered so two runs are comparable. */
async function ledgerRows(pool: mysql.Pool): Promise<unknown[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `from_account`, `to_account`, `token_type`, `amount`, `source`, `description`, `idempotency_key` " +
      "FROM `token_ledger` ORDER BY `idempotency_key`",
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** The sweep's own rows for one exit, in token order. */
async function sweepRowsFor(pool: mysql.Pool, exitId: string): Promise<unknown[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `from_account`, `to_account`, `token_type`, `amount`, `source`, `source_ref`, `description`, `idempotency_key` " +
      "FROM `token_ledger` WHERE `source_ref` = ? ORDER BY `token_type`",
    [exitId],
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/**
 * The one posting the shipped defaults still make: recognition's whole
 * balance, `mem:<user>` to `sys:exit-settlement`, source `exit_settlement`,
 * description "Balance settled at departure", key `exit:<exitId>:sweep:<token>`.
 * That is the shape every balance was swept in before the ruling of 2026-10-23.
 */
const EXPECTED = (exitId: string): unknown[] => [
  {
    from_account: memberAccount(USER),
    to_account: EXIT_SETTLEMENT,
    token_type: THANKS,
    amount: MINOR,
    source: "exit_settlement",
    source_ref: exitId,
    description: "Balance settled at departure",
    idempotency_key: `exit:${exitId}:sweep:${THANKS}`,
  },
];
