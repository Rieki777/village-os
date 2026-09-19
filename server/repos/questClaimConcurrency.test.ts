/**
 * The two quest-claim races, driven concurrently against a real MySQL.
 *
 * WHY EVERY CASE HERE FIRES MORE THAN ONE REQUEST AT ONCE. Both defects are
 * invisible to a test that acts once: the old code passed every single-actor
 * assertion it had, because each of these is a read-then-write whose gap only
 * exists when a second actor is inside it. A sequential version of any test
 * below is green against the bug.
 *
 * RACE 1, THE CLAIM. `POST /api/game/quests/:id/claim` read the member's
 * claims, looked for a live one, and inserted several awaits later, with no
 * unique index behind it (and, per drizzle/0196, none that could be added).
 * Two taps arriving together both read no claim and both inserted, so the
 * member held two rows on one quest and a steward could consent each of them.
 *
 * RACE 2, THE CONSENT. `POST /api/admin/quest-claims/:id/consent` read the
 * claim through a plain SELECT, checked the status, and flipped it in a
 * SEPARATE transaction that then committed before the ledger was asked. Two
 * stewards both read `submitted`, both passed, and both wrote: the ledger
 * answered the second `duplicate: true` on the claim-keyed idempotency and
 * moved nothing, leaving `amount` and `consented_by` naming a figure and a
 * witness with no posting behind them.
 *
 * AND THE THIRD CASE, WHICH IS NOT A RACE. A credit the ledger refused used to
 * leave the claim permanently `consented` with the member paid nothing and no
 * way back in, because re-consent answers 409 on a claim that is no longer
 * `submitted` and `remove` only deletes a `claimed` one. The rollback case
 * below is that one, and it needs only one actor.
 *
 * RACE 3, THE DOORS BESIDE CONSENT. The decline branch and the submit route
 * kept writing through a generic `update` that locked the row and then wrote
 * over whatever it found, so a decline or a resubmit arriving while a consent
 * held the claim waited for the lock and then overwrote a consented, paid
 * claim. And the quest delete counted in-flight claims outside any lock, so a
 * claim could land between the count and the delete. Each case below starts
 * the second actor while the first is demonstrably holding the lock. The same
 * doors driven through their real handlers are in
 * `server/routes/questClaimTransitions.test.ts`.
 *
 * The post callback is a stub rather than the real ledger on purpose. What is
 * under test is whether the flip and the movement are ONE commit and whether
 * the movement is asked for exactly once; the ledger's own idempotency and
 * conservation are `server/ledger.test.ts`'s subject and are asserted there.
 * A stub also lets the refusal case be driven deterministically.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, untilALockIsAwaited, type TestDb } from "../db/testDb";
import {
  claimsRepo,
  questsRepo,
  type ClaimRecord,
  type ClaimsRepo,
  type QuestsRepo,
} from "./quests";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questClaimConcurrency.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

/** The literal shape both claim routes build, so a drift there fails here. */
const claimOn = (id: string, questId: string, userId: string): ClaimRecord => ({
  id,
  questId,
  questTitle: "Tend the swale",
  userId,
  userName: "Ada Wren",
  status: "claimed",
  claimedAt: new Date().toISOString(),
  artifactUrl: "",
  note: "",
});

describe.skipIf(!configured)("quest claims under concurrent actors (MySQL)", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let quests: QuestsRepo;
  let claims: ClaimsRepo;

  beforeAll(async () => {
    db = await provisionTestDb();
    // Room for every racer to hold its own connection at once. A pool smaller
    // than the fan-out below would serialise the test rather than the code,
    // which is the quiet way a concurrency test stops testing concurrency.
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 12 });
    /*
     * PRE-WARM, AND IT IS NOT A DETAIL. mysql2 opens connections lazily, so an
     * unwarmed fan-out is serialised by the DRIVER: the first racer's write
     * lands before the later racers have a socket to read on, every one of
     * them sees it, and the suite goes green against code that has no lock at
     * all. Measured on the pre-fix algorithm: unwarmed, five simultaneous
     * claims left ONE row and the probe passed; warmed, the same five left
     * FIVE rows. Without this line every assertion below is decoration.
     */
    const warm = await Promise.all(Array.from({ length: 8 }, () => pool.getConnection()));
    warm.forEach((c) => c.release());
    quests = questsRepo(pool);
    claims = claimsRepo(pool);
    await quests.add({
      id: "q-swale",
      title: "Tend the swale",
      gratitude: "50-100",
      status: "Open",
      tags: [],
      order: 1,
    });
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM quest_claims WHERE quest_id = ?", ["q-swale"]);
  });

  const rowsFor = async (userId: string) => {
    const [rows]: any = await pool.query(
      "SELECT id, status, amount, consented_by FROM quest_claims WHERE quest_id = ? AND user_id = ? ORDER BY id",
      ["q-swale", userId],
    );
    return rows as Array<{ id: string; status: string; amount: number | null; consented_by: string | null }>;
  };

  // ── Race 1: one live claim per member per quest ────────────────────────────

  it("five simultaneous taps on the same quest leave the member holding ONE claim", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => claims.openClaim(claimOn(`claim-tap-${n}`, "q-swale", "u-ada"))),
    );
    const rows = await rowsFor("u-ada");
    // The assertion the old path failed: it inserted one row per tap.
    expect(rows).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // Every loser is told what it collided with, not handed a bare failure,
    // because the route answers 409 with that claim.
    const losers = results.filter((r) => !r.ok);
    expect(losers).toHaveLength(4);
    for (const l of losers) {
      expect(l.ok).toBe(false);
      if (!l.ok && l.reason === "already") expect(l.existing.questId).toBe("q-swale");
      else expect(l).toMatchObject({ reason: "already" });
    }
  });

  it("two members claiming the same quest at once both get their claim", async () => {
    // The lock is on the quest row, so this is the case that proves it
    // serialises without refusing: the rule is per member, never per quest.
    const [ada, bo] = await Promise.all([
      claims.openClaim(claimOn("claim-ada", "q-swale", "u-ada")),
      claims.openClaim(claimOn("claim-bo", "q-swale", "u-bo")),
    ]);
    expect(ada.ok).toBe(true);
    expect(bo.ok).toBe(true);
    expect(await rowsFor("u-ada")).toHaveLength(1);
    expect(await rowsFor("u-bo")).toHaveLength(1);
  });

  it("a declined claim frees the quest, so the member may take it again", async () => {
    // THE REASON THERE IS NO UNIQUE INDEX ON (quest_id, user_id). A decline
    // hands the quest back and the member is expected to pick it up, so the
    // second row here is correct and a unique key would refuse it. Two decline
    // cycles are asserted, because `(quest_id, user_id, status)` would admit
    // the first and refuse the second.
    for (const n of [1, 2]) {
      const taken = await claims.openClaim(claimOn(`claim-cycle-${n}`, "q-swale", "u-ada"));
      expect(taken.ok).toBe(true);
      expect((await claims.declineOnce(`claim-cycle-${n}`, new Date().toISOString())).ok).toBe(true);
    }
    const again = await claims.openClaim(claimOn("claim-cycle-3", "q-swale", "u-ada"));
    expect(again.ok).toBe(true);
    expect(await rowsFor("u-ada")).toHaveLength(3);
  });

  it("refuses the claim when the quest is gone by the time the lock is taken", async () => {
    const orphan = await claims.openClaim(claimOn("claim-orphan", "q-vanished", "u-ada"));
    expect(orphan).toEqual({ ok: false, reason: "gone" });
    const [rows]: any = await pool.query("SELECT id FROM quest_claims WHERE id = ?", ["claim-orphan"]);
    expect(rows).toHaveLength(0);
  });

  // ── Race 2: one consent per claim, and one movement behind it ──────────────

  /** A submitted claim, ready for a steward. */
  const submitted = async (id: string) => {
    await claims.add({ ...claimOn(id, "q-swale", "u-ada"), status: "submitted", submittedAt: new Date().toISOString() });
  };

  it("two stewards consenting at once: one wins, and value is asked for ONCE", async () => {
    await submitted("claim-witness");
    const asked: Array<{ amount: number; by: string }> = [];
    const consentAs = (by: string, amount: number) =>
      claims.consentOnce(
        "claim-witness",
        ["submitted"],
        (c) => {
          c.status = "consented";
          c.amount = amount;
          c.resolvedAt = new Date().toISOString();
          c.consentedBy = by;
        },
        async (_conn, c) => {
          asked.push({ amount: Number(c.amount ?? 0), by: String(c.consentedBy ?? "") });
          // Hold the transaction open until the other steward is demonstrably
          // inside the window, blocked on the claim's row lock, instead of
          // arriving politely after the commit.
          await untilALockIsAwaited(pool);
          return { ok: true };
        },
      );

    const [first, second] = await Promise.all([consentAs("u-mara", 60), consentAs("u-tomas", 90)]);
    const winners = [first, second].filter((r) => r.ok);
    const losers = [first, second].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    // The loser is told the status it actually found, which is what the route
    // turns into its 409. The old code overwrote instead.
    expect(losers[0]).toMatchObject({ ok: false, reason: "status", status: "consented" });

    // THE ASSERTION THE DEFECT WAS ABOUT: the row's figure and witness have
    // exactly one movement behind them, and it is the SAME one.
    expect(asked).toHaveLength(1);
    const rows = await rowsFor("u-ada");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("consented");
    expect(Number(rows[0].amount)).toBe(asked[0].amount);
    expect(rows[0].consented_by).toBe(asked[0].by);
  });

  it("a refused credit writes NOTHING, so the claim can be consented again", async () => {
    await submitted("claim-refused");
    const flip = (c: ClaimRecord) => {
      c.status = "consented";
      c.amount = 75;
      c.resolvedAt = new Date().toISOString();
      c.consentedBy = "u-mara";
    };
    const refused = await claims.consentOnce("claim-refused", ["submitted"], flip, async () => ({
      ok: false,
      error: "issuance has not started in this village",
    }));
    expect(refused).toMatchObject({ ok: false, reason: "post" });

    // The whole point: the claim is untouched, so the member is still owed and
    // the steward's second try is a real retry. The old code left it
    // `consented` with nothing paid and no route back to this state.
    let rows = await rowsFor("u-ada");
    expect(rows[0].status).toBe("submitted");
    expect(rows[0].amount).toBeNull();
    expect(rows[0].consented_by).toBeNull();

    const retried = await claims.consentOnce("claim-refused", ["submitted"], flip, async () => ({ ok: true }));
    expect(retried.ok).toBe(true);
    rows = await rowsFor("u-ada");
    expect(rows[0].status).toBe("consented");
    expect(Number(rows[0].amount)).toBe(75);
  });

  it("refuses a claim whose status is not one the caller named", async () => {
    await submitted("claim-resolved");
    expect((await claims.declineOnce("claim-resolved", new Date().toISOString())).ok).toBe(true);
    let posted = 0;
    const outcome = await claims.consentOnce(
      "claim-resolved",
      ["submitted"],
      (c) => { c.status = "consented"; },
      async () => { posted += 1; return { ok: true }; },
    );
    expect(outcome).toMatchObject({ ok: false, reason: "status", status: "declined" });
    // A refusal on the status must never reach the ledger.
    expect(posted).toBe(0);
    expect((await rowsFor("u-ada"))[0].status).toBe("declined");
  });

  it("answers missing for a claim id that is not there", async () => {
    const outcome = await claims.consentOnce("claim-nowhere", ["submitted"], () => {}, null);
    expect(outcome).toEqual({ ok: false, reason: "missing" });
  });

  // ── Race 3: the doors beside consent ───────────────────────────────────────

  /** A consent that holds the claim's row lock for a moment, and says when it is inside. */
  const consentHolding = (id: string) => {
    let inside!: () => void;
    const holding = new Promise<void>((r) => (inside = r));
    const done = claims.consentOnce(
      id,
      ["submitted"],
      (c) => {
        c.status = "consented";
        c.amount = 60;
        c.resolvedAt = new Date().toISOString();
        c.consentedBy = "u-mara";
      },
      async () => {
        inside();
        // Until the second actor is queued on the row lock, not arriving
        // politely after the commit.
        await untilALockIsAwaited(pool);
        return { ok: true };
      },
    );
    return { holding, done };
  };

  it("a decline arriving while a consent holds the claim does not undo it", async () => {
    await submitted("claim-contested");
    const consent = consentHolding("claim-contested");
    await consent.holding;
    const decline = await claims.declineOnce("claim-contested", new Date().toISOString());
    expect((await consent.done).ok).toBe(true);
    // The old write waited for the lock and then declined a consented claim.
    expect(decline).toMatchObject({ ok: false, reason: "status", status: "consented" });
    const rows = await rowsFor("u-ada");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("consented");
    expect(rows[0].consented_by).toBe("u-mara");
  });

  it("a submit arriving while a consent holds the claim does not reopen it", async () => {
    await submitted("claim-late-evidence");
    const consent = consentHolding("claim-late-evidence");
    await consent.holding;
    const evidence = await claims.submitOnce("claim-late-evidence", {
      artifactUrl: "",
      note: "A corrected link.",
      at: new Date().toISOString(),
    });
    expect((await consent.done).ok).toBe(true);
    expect(evidence).toMatchObject({ ok: false, reason: "status", status: "consented" });
    const rows = await rowsFor("u-ada");
    expect(rows[0].status).toBe("consented");
    expect(Number(rows[0].amount)).toBe(60);
  });

  it("a delete waits for a claim that holds the quest, then counts it", async () => {
    await quests.add({ id: "q-held", title: "Tend the swale", gratitude: "50-100", status: "Open", tags: [], order: 2 });
    // A claim mid-flight: the lock `openClaim` takes and the row it inserts,
    // not yet committed. `openClaim` itself cannot be paused inside.
    const holder = await pool.getConnection();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM quests WHERE id = ? FOR UPDATE", ["q-held"]); // module-review-ok: fixture SQL taking the row lock openClaim takes, on the S5 scratch schema
      await holder.query( // module-review-ok: fixture SQL making the insert openClaim makes, on the S5 scratch schema
        "INSERT INTO quest_claims (id, quest_id, quest_title, user_id, user_name, status) VALUES (?,?,?,?,?,'claimed')",
        ["claim-held", "q-held", "Tend the swale", "u-ada", "Ada Wren"],
      );
      const removal = quests.remove("q-held");
      // Commit only once the delete is queued on the quest row. A delete that
      // counted outside the lock has counted zero by then.
      await untilALockIsAwaited(pool);
      await holder.commit();
      expect(await removal).toMatchObject({ ok: false, reason: "in_flight", count: 1 });
    } finally {
      holder.release();
    }
    expect(await quests.byId("q-held")).not.toBeNull();
  });
});
