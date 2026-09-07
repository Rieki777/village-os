/**
 * A CIRCLE'S TREASURY, AGAINST A REAL LEDGER, WITH CONSERVATION CHECKED AFTER
 * EVERY MOVE.
 *
 * Every posting here goes through the module's own functions, which go through
 * `postTransfer`. There are no raw ledger writes and no stub of one: the
 * invariant is that all movement goes through the posting functions, and a
 * test that wrote rows by hand would be proving something about a table
 * nobody's code produces.
 *
 * WHAT IS UNDER TEST, in the order Rye's rulings raise it:
 *   1. per token, SUM(balance) over every account is identically zero, after a
 *      funding, after a spend, after a return and after a dormancy sweep;
 *   2. FUNDING IS ISSUANCE and the village-wide cap counts it, measured
 *      through `readCycleIssuance` and through the guard's own refusal;
 *   3. SPENDING IS NOT ISSUANCE and the same counter does not move;
 *   4. a treasury persists across a period boundary while a cap resets, which
 *      is the whole difference between the two models;
 *   5. a dormant circle holds NOTHING, and where its tokens went is recorded;
 *   6. the two attribution namespaces never meet, so a treasury funding is
 *      invisible to the cap meter;
 *   7. a circle with no budget for the period reads UNGOVERNED and not zero;
 *   8. the village-wide unspent figure, and the difference between its zeros.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { MINT_FAUCET, TREASURY, loadTokenRegistry, memberAccount, postTransfer } from "./ledger";
import { REDEEMED } from "./redemption";
import {
  burnFor,
  circleSpendIn,
  circleSpendRef,
  cycleWindowAt,
  type BurnDeps,
  type CircleEnvelope,
  type SeasonSpan,
} from "./circleBurn";
import {
  applyPendingModes,
  circleFundingClause,
  circleFundingSince,
  circleTreasuryAccount,
  dormantHoldings,
  fundTreasury,
  masterTreasuryExists,
  queueModeChange,
  returnTreasury,
  revivalNote,
  spendTreasury,
  sweepDormantCircle,
  treasuryAccountProblem,
  treasuryHoldings,
  treasuryStandings,
  villageTreasuryTotal,
  type TreasuryPermit,
} from "./circleTreasury";
import { readCycleIssuance } from "./mintCap";
import { modeAt } from "../../shared/circleTreasury";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[circleTreasury.test] TEST_DATABASE_URL not set. A circle's treasury is UNCHECKED here.");
}

const TOKEN = "credits";
const UNIT = "token:credits";
const TZ = "America/Costa_Rica";
const SEASONS: SeasonSpan[] = [
  { id: "rooting-2026", startsOn: "2026-06-01", endsOn: "2026-12-01" },
  { id: "tending-2027", startsOn: "2026-12-01", endsOn: "2027-06-01" },
];

/** Nobody is refused in this file. Permission is another lane's ruling. */
const ALLOW: TreasuryPermit = () => null;
/** And one that refuses, so the seam is proven to be load bearing. */
const DENY: TreasuryPermit = (action, circleId) => `no: ${action} on ${circleId}`;

let db: TestDb;
let pool: mysql.Pool;
let n = 0;
const key = (label: string) => `tr-${label}-${++n}`;

/** Per token, SUM(balance) over every account. The platform invariant. */
async function conservation(token = TOKEN): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(balance), 0) AS n FROM token_balances WHERE token_type = ?",
    [token],
  );
  return Number(row?.n ?? 0);
}

/** What the village-wide issuance counter says, net, this cycle. */
async function issuanceNet(): Promise<number> {
  const since = new Date(Date.now() - 400 * 86_400_000);
  return (await readCycleIssuance(pool, TOKEN, since)).net;
}

const envelope = (over: Partial<CircleEnvelope> = {}): CircleEnvelope => ({
  circleId: "kitchen",
  unit: UNIT,
  seasonCapMinor: 1000,
  cycleCapMinor: 400,
  seasonId: null,
  mode: "cap",
  pending: null,
  dormant: null,
  ...over,
});

const deps = (over: Partial<BurnDeps> = {}): BurnDeps => ({
  conn: pool,
  moduleOn: true,
  envelopes: [],
  clockMode: "lunar",
  seasons: SEASONS,
  timeZone: TZ,
  tokenTypeFor: (u: string) => (u === UNIT ? TOKEN : null),
  circleStatusFor: () => "active",
  ...over,
});

describe.skipIf(!configured)("a circle's treasury", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
    await loadTokenRegistry(pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ── 1. Conservation, after every kind of move ─────────────────────────────

  it("conserves the token through a funding, a spend and a return", async () => {
    const circleId = "cons";
    expect(await conservation()).toBe(0);

    const funded = await fundTreasury(pool, {
      circleId, circleName: "Conservation", circleStatus: "active",
      tokenSlug: TOKEN, amountMinor: 900, actorId: null, note: "up front",
      idempotencyKey: key("fund"), permit: ALLOW,
    });
    expect(funded.ok, funded.error).toBe(true);
    expect(await conservation(), "a mint into a circle still sums to zero").toBe(0);

    const spent = await spendTreasury(pool, {
      circleId, circleStatus: "active", tokenSlug: TOKEN,
      toUserId: "usr-paid", amountMinor: 300, actorId: null, note: "paid a member",
      idempotencyKey: key("spend"), permit: ALLOW,
    });
    expect(spent.ok, spent.error).toBe(true);
    expect(await conservation()).toBe(0);

    const back = await returnTreasury(pool, {
      circleId, tokenSlug: TOKEN, amountMinor: 100, actorId: null,
      note: "over-funded", idempotencyKey: key("return"), permit: ALLOW,
    });
    expect(back.ok, back.error).toBe(true);
    expect(await conservation()).toBe(0);

    const held = await treasuryHoldings(pool, circleId, TOKEN);
    expect(held.balanceMinor).toBe(500);
    expect(held.fundedMinor).toBe(900);
    expect(held.spentMinor).toBe(300);
    expect(held.returnedMinor).toBe(100);
    // The balance comes off the CACHE and the flows off the ledger, and the
    // two have to agree without either being derived from the other.
    expect(held.fundedMinor - held.spentMinor - held.returnedMinor).toBe(held.balanceMinor);
  }, 60_000);

  it("refuses an overdraft, because a treasury account is not a faucet", async () => {
    const r = await spendTreasury(pool, {
      circleId: "cons", circleStatus: "active", tokenSlug: TOKEN,
      toUserId: "usr-paid", amountMinor: 5_000, actorId: null, note: "more than it has",
      idempotencyKey: key("over"), permit: ALLOW,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("insufficient");
    expect(await conservation()).toBe(0);
  }, 30_000);

  it("calls the permit before it moves anything, on all three doors", async () => {
    const before = await treasuryHoldings(pool, "cons", TOKEN);
    for (const move of [
      () => fundTreasury(pool, {
        circleId: "cons", circleName: "c", circleStatus: "active", tokenSlug: TOKEN,
        amountMinor: 10, actorId: null, note: "x", idempotencyKey: key("dfund"), permit: DENY,
      }),
      () => spendTreasury(pool, {
        circleId: "cons", circleStatus: "active", tokenSlug: TOKEN, toUserId: "usr-paid",
        amountMinor: 10, actorId: null, note: "x", idempotencyKey: key("dspend"), permit: DENY,
      }),
      () => returnTreasury(pool, {
        circleId: "cons", tokenSlug: TOKEN, amountMinor: 10, actorId: null,
        note: "x", idempotencyKey: key("dret"), permit: DENY,
      }),
    ]) {
      const r = await move();
      expect(r.ok).toBe(false);
      expect(r.error).toContain("no: ");
    }
    const after = await treasuryHoldings(pool, "cons", TOKEN);
    expect(after.balanceMinor, "a refused permit moves nothing").toBe(before.balanceMinor);
    expect(after.rows).toBe(before.rows);
  }, 60_000);

  // ── 2 and 3. Funding is issuance; spending is not ─────────────────────────

  it("FUNDING IS ISSUANCE and the village-wide counter sees it", async () => {
    const before = await issuanceNet();
    const r = await fundTreasury(pool, {
      circleId: "issuance", circleName: "Issuance", circleStatus: "active",
      tokenSlug: TOKEN, amountMinor: 250, actorId: null, note: "a treasury",
      idempotencyKey: key("iss"), permit: ALLOW,
    });
    expect(r.ok, r.error).toBe(true);
    expect(await issuanceNet(), "the cap's own counter must move by the funding").toBe(before + 250);
  }, 30_000);

  it("SPENDING IS NOT ISSUANCE and the same counter does not move", async () => {
    const before = await issuanceNet();
    const r = await spendTreasury(pool, {
      circleId: "issuance", circleStatus: "active", tokenSlug: TOKEN,
      toUserId: "usr-spend-target", amountMinor: 200, actorId: null, note: "paid",
      idempotencyKey: key("nospend"), permit: ALLOW,
    });
    expect(r.ok, r.error).toBe(true);
    expect(await issuanceNet(), "a treasury spend moves tokens that already exist").toBe(before);
    // And the tokens really did move, so this is not a no-op reading as a pass.
    expect((await treasuryHoldings(pool, "issuance", TOKEN)).balanceMinor).toBe(50);
  }, 30_000);

  it("a RETURN gives the village its issuance room back", async () => {
    const before = await issuanceNet();
    const r = await returnTreasury(pool, {
      circleId: "issuance", tokenSlug: TOKEN, amountMinor: 50, actorId: null,
      note: "not needed", idempotencyKey: key("giveback"), permit: ALLOW,
    });
    expect(r.ok, r.error).toBe(true);
    expect(await issuanceNet(), "a return cancels this cycle's own issuance").toBe(before - 50);
    expect(await conservation()).toBe(0);
  }, 30_000);

  // ── 5. Dormancy: Rye's ruling, carried out ────────────────────────────────

  it("has a MASTER TREASURY, measured rather than assumed", async () => {
    // `sys:treasury` is created by drizzle/0009 in every village. Rye's ruling
    // is conditional on there being one, so the code asks instead of knowing.
    expect(await masterTreasuryExists(pool)).toBe(true);
  }, 30_000);

  it("EMPTIES A CIRCLE'S TREASURY WHEN IT GOES DORMANT, and records what left", async () => {
    const circleId = "sleepy";
    const budgetId = "bud-sleepy";
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO circle_budgets (id, circle_id, season_id, amount_minor, unit, mode) VALUES (?,?,?,?,?,?)",
      [budgetId, circleId, null, 1000, UNIT, "treasury"],
    );
    const funded = await fundTreasury(pool, {
      circleId, circleName: "Sleepy", circleStatus: "active", tokenSlug: TOKEN,
      amountMinor: 640, actorId: null, note: "its season", idempotencyKey: key("sleep"), permit: ALLOW,
    });
    expect(funded.ok, funded.error).toBe(true);

    const masterBefore = await balanceOf(TREASURY);
    const swept = await sweepDormantCircle(pool, {
      circleId,
      budgets: [{ id: budgetId, unit: UNIT }],
      tokenTypeFor: (u) => (u === UNIT ? TOKEN : null),
      at: new Date("2026-09-20T00:00:00Z"),
      actorId: null,
    });

    expect(swept).toHaveLength(1);
    expect(swept[0]!.movedMinor).toBe(640);
    expect(swept[0]!.destination, "the village has one, so the tokens go there").toBe("master_treasury");
    // THE OBJECTION, ANSWERED: a dormant circle holds nothing.
    expect((await treasuryHoldings(pool, circleId, TOKEN)).balanceMinor).toBe(0);
    expect(await balanceOf(TREASURY)).toBe(masterBefore + 640);
    expect(await conservation()).toBe(0);

    // And the record, because reissuing what it had is a different act from
    // funding it afresh, and after the sweep the account remembers nothing.
    const [[row]] = await pool.query<any[]>(
      "SELECT dormant_held_minor, dormant_at, dormant_to FROM circle_budgets WHERE id = ?",
      [budgetId],
    );
    expect(Number(row.dormant_held_minor)).toBe(640);
    expect(String(row.dormant_to)).toBe("master_treasury");
    expect(row.dormant_at).toBeTruthy();
  }, 60_000);

  it("is idempotent across a retried status write and still posts a SECOND real dormancy", async () => {
    const circleId = "sleepy";
    const at = new Date("2026-09-20T00:00:00Z");
    const again = await sweepDormantCircle(pool, {
      circleId, budgets: [{ id: "bud-sleepy", unit: UNIT }],
      tokenTypeFor: (u) => (u === UNIT ? TOKEN : null), at, actorId: null,
    });
    // Nothing left to move, so nothing posted, and the record still stands.
    expect(again[0]!.movedMinor).toBe(0);
    expect(await conservation()).toBe(0);

    /*
     * SAME DAY, DIFFERENT BALANCE: a real second sweep, and the key has to let
     * it through. Before the amount joined the key this posted nothing and the
     * tokens stayed in the account, which is the stranding the whole file
     * exists to prevent arriving through the idempotency key.
     */
    const sameDay = await fundTreasury(pool, {
      circleId, circleName: "Sleepy", circleStatus: "active", tokenSlug: TOKEN,
      amountMinor: 33, actorId: null, note: "same day", idempotencyKey: key("sameday"), permit: ALLOW,
    });
    expect(sameDay.ok, sameDay.error).toBe(true);
    const sameDaySweep = await sweepDormantCircle(pool, {
      circleId, budgets: [{ id: "bud-sleepy", unit: UNIT }],
      tokenTypeFor: (u) => (u === UNIT ? TOKEN : null), at, actorId: null,
    });
    expect(sameDaySweep[0]!.movedMinor, "a different balance on the same day is not a duplicate").toBe(33);
    expect((await treasuryHoldings(pool, circleId, TOKEN)).balanceMinor).toBe(0);
    expect(await conservation()).toBe(0);

    // Revived, funded again, dormant again on a later day: a real second sweep.
    const refund = await fundTreasury(pool, {
      circleId, circleName: "Sleepy", circleStatus: "active", tokenSlug: TOKEN,
      amountMinor: 120, actorId: null, note: "awake again", idempotencyKey: key("rewake"), permit: ALLOW,
    });
    expect(refund.ok, refund.error).toBe(true);
    const second = await sweepDormantCircle(pool, {
      circleId, budgets: [{ id: "bud-sleepy", unit: UNIT }],
      tokenTypeFor: (u) => (u === UNIT ? TOKEN : null),
      at: new Date("2026-10-05T00:00:00Z"), actorId: null,
    });
    expect(second[0]!.movedMinor, "a genuine second dormancy is not a duplicate").toBe(120);
    expect((await treasuryHoldings(pool, circleId, TOKEN)).balanceMinor).toBe(0);
    expect(await conservation()).toBe(0);
  }, 60_000);

  it("REFUSES TO FUND A DORMANT CIRCLE, so nothing lands in a swept account", async () => {
    const r = await fundTreasury(pool, {
      circleId: "sleepy", circleName: "Sleepy", circleStatus: "dormant", tokenSlug: TOKEN,
      amountMinor: 50, actorId: null, note: "no", idempotencyKey: key("nofund"), permit: ALLOW,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("dormant");
    expect(r.error, "and it says what reviving costs").toContain("issuance cap");
    expect((await treasuryHoldings(pool, "sleepy", TOKEN)).balanceMinor).toBe(0);
  }, 30_000);

  it("tells a steward reviving a circle what it held and what reissuing costs", async () => {
    const note = revivalNote(
      { heldMinor: 640, at: "2026-09-20T00:00:00.000Z", destination: "master_treasury" },
      TOKEN,
      "Sleepy",
    );
    /*
     * 6.4 AND NOT 640. `credits` carries two decimals (drizzle/0007), and
     * everything this codebase hands to a PERSON is divided through
     * `fromLedgerUnits`. A note reading "640 credits" over a balance card
     * printing 6.4 is the exact defect server/lib/exit.ts records against
     * Village Voice, and the assertion is written in the human unit so it
     * would fail if the division were dropped.
     */
    expect(note).toContain("6.4");
    expect(note).not.toContain("640");
    expect(note).toContain("2026-09-20");
    expect(note).toContain("returned to the village treasury");
    expect(note, "the refusal a steward can meet, said before they meet it").toContain("issuance cap");
    // A circle that never went dormant gets no sentence at all.
    expect(revivalNote({ heldMinor: null, at: null, destination: null }, TOKEN, "Fresh")).toBeNull();
  }, 30_000);

  it("destroys through the redemption door when a village has no master treasury", async () => {
    /*
     * The other half of Rye's ruling. `sys:treasury` exists in every village
     * today, so the only way to exercise this branch is to take the row away,
     * which is what a fork that never ran 0009's insert would look like.
     */
    const circleId = "nomaster";
    const budgetId = "bud-nomaster";
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO circle_budgets (id, circle_id, season_id, amount_minor, unit, mode) VALUES (?,?,?,?,?,?)",
      [budgetId, circleId, null, 1000, UNIT, "treasury"],
    );
    const funded = await fundTreasury(pool, {
      circleId, circleName: "No Master", circleStatus: "active", tokenSlug: TOKEN,
      amountMinor: 77, actorId: null, note: "x", idempotencyKey: key("nomaster"), permit: ALLOW,
    });
    expect(funded.ok, funded.error).toBe(true);

    const retiredBefore = await balanceOf(REDEEMED);
    await pool.query("DELETE FROM ledger_accounts WHERE id = ?", [TREASURY]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(await masterTreasuryExists(pool)).toBe(false);
    const swept = await sweepDormantCircle(pool, {
      circleId, budgets: [{ id: budgetId, unit: UNIT }],
      tokenTypeFor: (u) => (u === UNIT ? TOKEN : null),
      at: new Date("2026-09-21T00:00:00Z"), actorId: null,
    });
    expect(swept[0]!.destination).toBe("retired");
    expect(swept[0]!.movedMinor).toBe(77);
    // Destroyed means destroyed, and the retired figure accounts for it: this
    // is the same account `postBurn` in redemptionStore.ts burns to.
    expect(await balanceOf(REDEEMED)).toBe(retiredBefore + 77);
    expect((await treasuryHoldings(pool, circleId, TOKEN)).balanceMinor).toBe(0);
    expect(await conservation()).toBe(0);

    // Put the village back the way every real village is.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?,?,?,?,0)",
      [TREASURY, "system", null, "Treasury"],
    );
    expect(await masterTreasuryExists(pool)).toBe(true);
  }, 60_000);

  // ── 6. The two namespaces never meet ──────────────────────────────────────

  it("keeps a treasury funding invisible to the CAP meter, which is a boundary bug avoided", async () => {
    const circleId = "namespaces";
    const window = cycleWindowAt(new Date(), "lunar");
    const from = new Date(window.startsAt);
    const to = new Date(window.endsAt);

    const before = await circleSpendIn(pool, circleId, TOKEN, from, to);
    const r = await fundTreasury(pool, {
      circleId, circleName: "Namespaces", circleStatus: "active", tokenSlug: TOKEN,
      amountMinor: 400, actorId: null, note: "x", idempotencyKey: key("ns"), permit: ALLOW,
    });
    expect(r.ok, r.error).toBe(true);

    const after = await circleSpendIn(pool, circleId, TOKEN, from, to);
    expect(after.issuedMinor, "a treasury funding is not a cap spend").toBe(before.issuedMinor);
    expect(after.rows).toBe(before.rows);

    // The cap meter's own key still works, so this is a namespace separation
    // and not a meter that stopped counting.
    const capSpend = await postTransfer(pool, {
      from: MINT_FAUCET, to: memberAccount("usr-cap-check"), tokenType: TOKEN,
      amount: 30, source: "admin_mint", sourceRef: circleSpendRef(circleId),
      idempotencyKey: key("capspend"),
    });
    expect(capSpend.ok).toBe(true);
    expect((await circleSpendIn(pool, circleId, TOKEN, from, to)).issuedMinor).toBe(before.issuedMinor + 30);
  }, 60_000);

  // ── 4 and 7. The reading, both models, and the ungoverned case ────────────

  it("reads a treasury as a BALANCE and never as a share of a cap", async () => {
    const at = new Date();
    const r = await burnFor(
      { circleId: "cons", at, plus: 100 },
      deps({ envelopes: [envelope({ circleId: "cons", mode: "treasury" })] }),
    );
    expect(r.kind).toBe("treasury");
    if (r.kind !== "treasury") return;
    expect(r.balanceMinor).toBe(500);
    expect(r.fits).toBe(true);
    expect(r.account).toBe(circleTreasuryAccount("cons"));
    // The ask is tested against what it HOLDS, with no ceiling anywhere.
    const tooBig = await burnFor(
      { circleId: "cons", at, plus: 501 },
      deps({ envelopes: [envelope({ circleId: "cons", mode: "treasury" })] }),
    );
    expect(tooBig.kind === "treasury" && tooBig.fits).toBe(false);
  }, 30_000);

  it("A TREASURY PERSISTS ACROSS A PERIOD BOUNDARY WHILE A CAP RESETS", async () => {
    /*
     * The whole difference between the two models, in one case. The same
     * circle, the same instant, read once under each mode: the cap's room is
     * full again in the new season and the treasury's balance is unchanged.
     */
    const circleId = "cons";
    const inSeason = new Date("2026-09-15T12:00:00Z");
    const nextSeason = new Date("2026-12-15T12:00:00Z");

    const capNow = await burnFor({ circleId, at: inSeason }, deps({ envelopes: [envelope({ circleId })] }));
    const capNext = await burnFor({ circleId, at: nextSeason }, deps({ envelopes: [envelope({ circleId })] }));
    expect(capNow.kind).toBe("metered");
    expect(capNext.kind).toBe("metered");
    if (capNow.kind !== "metered" || capNext.kind !== "metered") return;
    // Different seasons, and the season's room is whole again in the second.
    expect(capNext.season.window!.id).not.toBe(capNow.season.window!.id);
    expect(capNext.season.spentMinor).toBe(0);
    expect(capNext.season.remainingMinor).toBe(1000);

    const treasuryNow = await burnFor(
      { circleId, at: inSeason }, deps({ envelopes: [envelope({ circleId, mode: "treasury" })] }),
    );
    const treasuryNext = await burnFor(
      { circleId, at: nextSeason }, deps({ envelopes: [envelope({ circleId, mode: "treasury" })] }),
    );
    if (treasuryNow.kind !== "treasury" || treasuryNext.kind !== "treasury") throw new Error("expected treasuries");
    expect(treasuryNext.balanceMinor, "a treasury does not reset").toBe(treasuryNow.balanceMinor);
    expect(treasuryNext.balanceMinor).toBe(500);
  }, 30_000);

  it("reads UNGOVERNED, and not zero, for a circle with no budget for this period", async () => {
    /*
     * The distinction this codebase already paid for. A circle whose only
     * budget was written for a season that has ended has no envelope for the
     * one it is in, and reporting a cap of zero would say "this circle may
     * issue nothing" when the truth is that nothing caps it at all.
     */
    const lastSeasonOnly = envelope({ circleId: "seasonal", seasonId: "rooting-2026" });
    const inThatSeason = await burnFor(
      { circleId: "seasonal", at: new Date("2026-09-15T12:00:00Z") },
      deps({ envelopes: [lastSeasonOnly] }),
    );
    expect(inThatSeason.kind, "its own season still governs it").toBe("metered");

    const afterIt = await burnFor(
      { circleId: "seasonal", at: new Date("2027-01-15T12:00:00Z") },
      deps({ envelopes: [lastSeasonOnly] }),
    );
    expect(afterIt.kind, "the next season has no envelope for this circle").toBe("ungoverned");

    // A standing row (season_id NULL) still governs every season, so this is
    // about the season column and not about losing budgets generally.
    const standing = await burnFor(
      { circleId: "seasonal", at: new Date("2027-01-15T12:00:00Z") },
      deps({ envelopes: [lastSeasonOnly, envelope({ circleId: "seasonal" })] }),
    );
    expect(standing.kind).toBe("metered");
  }, 30_000);

  // ── The scheduled mode change, against the table ──────────────────────────

  it("QUEUES a mode change without applying it, and promotes it at the boundary", async () => {
    const budgetId = "bud-sched";
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO circle_budgets (id, circle_id, season_id, amount_minor, unit, mode) VALUES (?,?,?,?,?,?)",
      [budgetId, "sched", null, 1000, UNIT, "cap"],
    );
    const boundary = new Date("2026-12-01T00:00:00Z");
    expect(await queueModeChange(pool, budgetId, "treasury", boundary, "usr-steward")).toBe(true);

    const read = async () => {
      const [[row]] = await pool.query<any[]>(
        "SELECT mode, pending_mode, pending_from FROM circle_budgets WHERE id = ?",
        [budgetId],
      );
      return row;
    };
    const queued = await read();
    expect(queued.mode, "the live column is untouched mid-period").toBe("cap");
    expect(queued.pending_mode).toBe("treasury");

    // And the reading agrees, without any sweep having run.
    const pending = { mode: "treasury" as const, from: boundary.toISOString(), by: "usr-steward", at: null };
    expect(modeAt("cap", pending, new Date("2026-11-30T23:59:59Z"))).toBe("cap");
    expect(modeAt("cap", pending, boundary)).toBe("treasury");

    // A sweep before the boundary promotes nothing.
    expect(await applyPendingModes(pool, new Date("2026-11-01T00:00:00Z"))).toBe(0);
    expect((await read()).mode).toBe("cap");

    // And one after it promotes and clears in the same write.
    expect(await applyPendingModes(pool, new Date("2026-12-02T00:00:00Z"))).toBe(1);
    const landed = await read();
    expect(landed.mode).toBe("treasury");
    expect(landed.pending_mode).toBeNull();
    expect(landed.pending_from).toBeNull();
  }, 60_000);

  // ── 8. The village-wide figure ────────────────────────────────────────────

  it("sums what sits unspent across every circle treasury, off the balances", async () => {
    const rows = [
      { circleId: "cons", unit: UNIT, mode: "treasury" as const },
      { circleId: "issuance", unit: UNIT, mode: "treasury" as const },
      { circleId: "sleepy", unit: UNIT, mode: "treasury" as const },
    ];
    const standings = await treasuryStandings(
      pool, rows, (u) => (u === UNIT ? TOKEN : null),
      (id) => (id === "sleepy" ? "dormant" : "active"),
    );
    expect(standings.map((s) => s.circleId).sort()).toEqual(["cons", "issuance", "sleepy"]);

    const total = await villageTreasuryTotal(pool, {
      moduleOn: true, slug: TOKEN, budgetsOnTreasury: rows.length,
    });
    expect(total.state).toBe("held");

    /*
     * THE FIGURE IS A SUM OF REAL BALANCES AND IT COUNTS EVERY CIRCLE
     * ACCOUNT, which is WIDER than the budget rows a caller happens to pass.
     *
     * That is deliberate and it is the honest direction. A circle whose budget
     * row was later moved to a cap, or deleted, can still be holding tokens,
     * and a village-wide figure that only counted rows currently saying
     * `treasury` would under-report exactly the balances nobody is watching.
     * `held` winning over every other state is the same decision one level up.
     *
     * So the assertion is against the balances table itself, which is what
     * "read the accounts, never funded minus spent" means, and separately
     * against the standings as a floor.
     */
    const [[direct]] = await pool.query<any[]>(
      "SELECT COALESCE(SUM(balance), 0) AS n FROM token_balances " +
        "WHERE token_type = ? AND account_id LIKE 'sys:circle:%'",
      [TOKEN],
    );
    expect(total.heldMinor).toBe(Number(direct.n));
    expect(total.heldMinor).toBeGreaterThanOrEqual(
      standings.reduce((n, s) => n + s.balanceMinor, 0),
    );
    expect(total.heldMinor).toBeGreaterThan(0);
    expect(total.accountsHolding).toBeGreaterThan(0);

    // A dormant circle contributes nothing, because it was swept.
    expect(dormantHoldings(standings), "a dormant circle holds nothing").toEqual([]);
  }, 60_000);

  it("separates a village with no treasuries from one whose treasuries are empty", async () => {
    const noneOn = await villageTreasuryTotal(pool, {
      moduleOn: true, slug: "no-such-token", budgetsOnTreasury: 0,
    });
    expect(noneOn.state).toBe("none_on_treasury");
    expect(noneOn.heldMinor, "a measured zero carries a number").toBe(0);

    const allEmpty = await villageTreasuryTotal(pool, {
      moduleOn: true, slug: "no-such-token", budgetsOnTreasury: 3,
    });
    expect(allEmpty.state).toBe("all_empty");

    const off = await villageTreasuryTotal(pool, {
      moduleOn: false, slug: "no-such-token", budgetsOnTreasury: 0,
    });
    expect(off.state).toBe("module_off");
    expect(off.heldMinor, "an absence carries no number at all").toBeNull();
  }, 30_000);

  it("names which circles used the cycle's issuance, for the refusal a founder meets", async () => {
    const funding = await circleFundingSince(pool, TOKEN, new Date(Date.now() - 400 * 86_400_000));
    expect(funding.length).toBeGreaterThan(1);
    const clause = circleFundingClause(funding, TOKEN, (id) => `The ${id} Circle`);
    expect(clause).toContain("went into circle");
    expect(clause).toContain("The cons Circle");
    expect(clause).toContain("Funding a treasury mints tokens");
    // Nothing funded, nothing said: a "0 went to circle treasuries" line on a
    // refusal a steward is trying to act on is noise.
    expect(circleFundingClause([], TOKEN, (id) => id)).toBe("");
  }, 30_000);

  it("refuses a circle id too wide for the account column BEFORE it offers a row", async () => {
    const wide = "c".repeat(70);
    expect(treasuryAccountProblem(wide)).toContain("account id");
    const r = await fundTreasury(pool, {
      circleId: wide, circleName: "Wide", circleStatus: "active", tokenSlug: TOKEN,
      amountMinor: 10, actorId: null, note: "x", idempotencyKey: key("wide"), permit: ALLOW,
    });
    expect(r.ok).toBe(false);
    const [[row]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM ledger_accounts WHERE id LIKE 'sys:circle:cc%'",
    );
    expect(Number(row.n), "nothing was written at all").toBe(0);
  }, 30_000);

  /** One account's cached balance, minor units. */
  async function balanceOf(account: string): Promise<number> {
    const [[row]] = await pool.query<any[]>(
      "SELECT COALESCE(balance, 0) AS n FROM token_balances WHERE account_id = ? AND token_type = ?",
      [account, TOKEN],
    );
    return Number(row?.n ?? 0);
  }
});
