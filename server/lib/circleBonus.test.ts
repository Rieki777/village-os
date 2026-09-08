/**
 * THE BONUS, AGAINST A REAL LEDGER, AND THE ROLLOVER IT EXISTS BECAUSE OF.
 *
 * Every posting goes through this module's own function, which goes through
 * `postTransfer`. There are no raw ledger writes: the invariant is that all
 * movement goes through the posting functions, and a test that wrote rows by
 * hand would prove something about a table nobody's code produces. The ballot
 * and commitment rows ARE fixtures, because no code in this build writes a
 * completion ballot yet and none writes a commitment record at all.
 *
 * WHAT IS UNDER TEST, in the order Rye's rulings raise it:
 *   1. AN UNSPENT TREASURY SURVIVES A PERIOD BOUNDARY UNCHANGED WHILE AN
 *      UNSPENT CAP RESETS TO FULL, with a real spend under each, which is the
 *      whole distinction and is the half the existing proof cannot see;
 *   2. no de-issuing happens at the boundary: the account, the balance and the
 *      village's issued total all stand;
 *   3. a bonus is computed from unminted capacity under the CAP mode and PAID,
 *      with conservation checked after;
 *   4. it refuses under the treasury mode, on the same figures;
 *   5. it refuses when the village has not voted the work complete;
 *   6. it refuses when a steward vetoed, which the completion gate cannot see;
 *   7. the village-wide issuance cap binds the bonus door with NO treasurer
 *      set, which is the posture Rye settled for an ungoverned circle;
 *   8. a retried payment pays once.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { MINT_FAUCET, loadTokenRegistry, memberAccount, postTransfer } from "./ledger";
import {
  burnFor,
  circleSpendRef,
  type BurnDeps,
  type CircleEnvelope,
  type SeasonSpan,
} from "./circleBurn";
import {
  circleTreasuryAccount,
  fundTreasury,
  spendTreasury,
  treasuryHoldings,
  type TreasuryPermit,
} from "./circleTreasury";
import { bonusIdempotencyKey, payCircleBonus, vetoVerdictFor } from "./circleBonus";
import { bonusGateFor } from "./circleBonusGate";
import { readCycleIssuance } from "./mintCap";
import { setVariable } from "./variables";
import { bonusFor, type BonusOutcome } from "../../shared/circleBonus";
import type { CommitmentRecord } from "../../shared/circleBonusGate";
import type { BudgetMode } from "../../shared/circleTreasury";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[circleBonus.test] TEST_DATABASE_URL not set. The bonus is UNCHECKED here.");
}

const TOKEN = "credits";
const UNIT = "token:credits";
const TZ = "America/Costa_Rica";
/*
 * THE SEASONS ARE MEASURED FROM THE DAY THE SUITE RUNS, AND NEVER TYPED.
 *
 * `token_ledger.at` defaults to the instant of the write and `postTransfer`
 * offers no way to backdate one, so every row this file makes lands NOW. A
 * hard-coded calendar therefore stops meaning what it meant the moment the
 * real date walks past it: the same assertions would keep running and would
 * quietly be about a window holding no rows. So the first season is built
 * around today, and the second one after it.
 */
const DAY = 86_400_000;
const civilDay = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const SEASONS: SeasonSpan[] = [
  { id: "rooting", startsOn: civilDay(-30), endsOn: civilDay(30) },
  { id: "tending", startsOn: civilDay(30), endsOn: civilDay(120) },
];
/** Inside the first season and after every row this file writes. */
const IN_SEASON = new Date(Date.now() + 20 * DAY);
/**
 * The instant a finished period is read at. Inside the first season, because
 * a season window is half open and its own end instant belongs to the next
 * one, which would read the whole cap as unspent.
 */
const AT_PERIOD_END = new Date(Date.now() + 25 * DAY);
/** Inside the second season. The other side of the boundary. */
const NEXT_SEASON = new Date(Date.now() + 60 * DAY);

/** Nobody is refused in this file. Permission is another lane's ruling. */
const ALLOW: TreasuryPermit = () => null;

let db: TestDb;
let pool: mysql.Pool;
let n = 0;
const key = (label: string) => `bo-${label}-${++n}`;

async function conservation(token = TOKEN): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(balance), 0) AS n FROM token_balances WHERE token_type = ?",
    [token],
  );
  return Number(row?.n ?? 0);
}

/** What the village-wide issuance counter says, net, over a wide window. */
async function issuanceNet(): Promise<number> {
  const since = new Date(Date.now() - 400 * 86_400_000);
  return (await readCycleIssuance(pool, TOKEN, since)).net;
}

const envelope = (over: Partial<CircleEnvelope> = {}): CircleEnvelope => ({
  circleId: "kitchen",
  unit: UNIT,
  seasonCapMinor: 1000,
  cycleCapMinor: null,
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

/**
 * A commitment record, which NO TABLE IN THIS SCHEMA STORES.
 *
 * `server/lib/circleBonusGate.ts` says so in its own header, measured across a
 * fully migrated schema, and `server/routes/circleBonusGate.ts` wires a reader
 * that finds none. So it arrives here as a fixture through the same injected
 * seam the gate already takes, which is the only way any of this can be
 * exercised until a village has somewhere to write one down.
 */
const record = (over: Partial<CommitmentRecord> = {}): CommitmentRecord => ({
  id: "rec-kitchen-rooting",
  circleId: "kitchen",
  periodId: "rooting",
  startsAt: new Date(Date.now() - 30 * DAY).toISOString(),
  endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
  statement: "feed the village three days a week",
  // Written while the period could still be shaped by it, which is what makes
  // the commitment `recorded` and never `retrospective`.
  recordedAt: new Date(Date.now() - 29 * DAY).toISOString(),
  ...over,
});

/** A closed completion ballot on one record. A fixture, because nothing writes one. */
async function completionBallot(
  ballotId: string,
  recordId: string,
  status: "passed" | "failed" | "no_quorum",
): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, " +
      "weight_mode, unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, " +
      "closes_at, status, outcome_note, closed_by, closed_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),?,?,?,UTC_TIMESTAMP())",
    [
      ballotId, "circle_completion", recordId, `circle_completion:${recordId}:${ballotId}`,
      "Did this circle complete what it took on", "the village decided", "consent", "equal",
      100, 50, 9, 9, "usr-steward", status, "recorded", "usr-steward",
    ],
  );
  return ballotId;
}

/** One steward's veto, written the way `server/lib/stewardship.ts` writes it. */
async function veto(ballotId: string): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO ballot_vetoes (id, ballot_id, act, decided_by, reason) VALUES (?,?,?,?,?)",
    [`veto-${ballotId}`, ballotId, "veto", "usr-steward", "this was not what we agreed"],
  );
  await pool.query("UPDATE ballots SET vetoed_at = UTC_TIMESTAMP() WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
}

/** The whole standing for one circle: the gate, the veto, the mode, the amount. */
async function standing(
  circleId: string,
  mode: BudgetMode,
  rec: CommitmentRecord | null,
  pct = 10,
  at: Date = AT_PERIOD_END,
  seasonCapMinor = 1000,
): Promise<BonusOutcome> {
  const gate = await bonusGateFor(
    { circleId, periodId: "rooting", at },
    {
      conn: pool,
      commitmentFor: async () => rec,
      burnFor: (id, instant) =>
        burnFor(
          { circleId: id, at: instant },
          deps({ envelopes: [envelope({ circleId, mode, seasonCapMinor })] }),
        ),
      electorate: "village",
    },
  );
  const verdict = await vetoVerdictFor(pool, gate.vote.ballotId);
  return bonusFor({ gate, mode, pct, veto: verdict });
}

describe.skipIf(!configured)("the rollover, and the bonus that follows from it", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
    await loadTokenRegistry(pool);
    // Room to work in. Every posting below is issuance and meets this.
    await setVariable(pool, "ledger.admin_mint_cycle_cap", "100000");
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // 1 and 2. The one difference, with a real spend under each model

  it("AN UNSPENT TREASURY SURVIVES A PERIOD BOUNDARY WHILE AN UNSPENT CAP RESETS TO FULL", async () => {
    /*
     * BOTH SIDES SPEND, AND THAT IS WHY THIS TEST IS HERE.
     *
     * A version of this case that spends nothing passes whether or not the cap
     * meter resets, because zero equals zero in both windows. It proves the
     * window ids differ and nothing about the money. This one issues under the
     * cap and spends out of the treasury first, so the numbers on either side
     * of the boundary are different if anything is wrong.
     */
    const capCircle = "capside";
    const treasuryCircle = "treasuryside";

    // A real cap spend: a row leaving the faucet under the cap meter's own key.
    const spent = await postTransfer(pool, {
      from: MINT_FAUCET, to: memberAccount("usr-paid-by-cap"), tokenType: TOKEN,
      amount: 250, source: "admin_mint", sourceRef: circleSpendRef(capCircle),
      idempotencyKey: key("capspend"),
    });
    expect(spent.ok, "the cap side has to actually issue something").toBe(true);

    // A real treasury, funded and then partly spent, so a balance stands.
    const funded = await fundTreasury(pool, {
      circleId: treasuryCircle, circleName: "Treasury Side", circleStatus: "active",
      tokenSlug: TOKEN, amountMinor: 900, actorId: null, note: "up front",
      idempotencyKey: key("fund"), permit: ALLOW,
    });
    expect(funded.ok, funded.error).toBe(true);
    const paidOut = await spendTreasury(pool, {
      circleId: treasuryCircle, circleStatus: "active", tokenSlug: TOKEN,
      toUserId: "usr-paid-by-treasury", amountMinor: 250, actorId: null, note: "work",
      idempotencyKey: key("tspend"), permit: ALLOW,
    });
    expect(paidOut.ok, paidOut.error).toBe(true);

    const capNow = await burnFor(
      { circleId: capCircle, at: IN_SEASON }, deps({ envelopes: [envelope({ circleId: capCircle })] }),
    );
    const capNext = await burnFor(
      { circleId: capCircle, at: NEXT_SEASON }, deps({ envelopes: [envelope({ circleId: capCircle })] }),
    );
    if (capNow.kind !== "metered" || capNext.kind !== "metered") throw new Error("expected caps");

    // THIS SEASON: the spend is visible and the room is short by it.
    expect(capNow.season.spentMinor, "the cap side spent, and this season sees it").toBe(250);
    expect(capNow.season.remainingMinor).toBe(750);
    // NEXT SEASON: the room is WHOLE again. This is what "resets" means, and
    // it is the assertion a spend-free version of this test cannot make.
    expect(capNext.season.window!.id).not.toBe(capNow.season.window!.id);
    expect(capNext.season.spentMinor, "unspent room does not carry, and spend does not either").toBe(0);
    expect(capNext.season.remainingMinor).toBe(1000);

    const held = await treasuryHoldings(pool, treasuryCircle, TOKEN);
    const issuedBefore = await issuanceNet();

    const treasuryNow = await burnFor(
      { circleId: treasuryCircle, at: IN_SEASON },
      deps({ envelopes: [envelope({ circleId: treasuryCircle, mode: "treasury" })] }),
    );
    const treasuryNext = await burnFor(
      { circleId: treasuryCircle, at: NEXT_SEASON },
      deps({ envelopes: [envelope({ circleId: treasuryCircle, mode: "treasury" })] }),
    );
    if (treasuryNow.kind !== "treasury" || treasuryNext.kind !== "treasury") {
      throw new Error("expected treasuries");
    }

    expect(treasuryNow.balanceMinor).toBe(650);
    expect(treasuryNext.balanceMinor, "a treasury carries over unchanged").toBe(650);
    expect(treasuryNext.fundedMinor, "and so does what was minted into it").toBe(900);
    expect(treasuryNext.spentMinor, "the spent side is a fact about the whole life of it").toBe(250);
    // THE PERIOD IS REPORTED AND IS NOT A WINDOW THE BALANCE RESETS ON.
    expect(treasuryNext.period!.id).not.toBe(treasuryNow.period!.id);

    /*
     * NO DE-ISSUING AT THE BOUNDARY, MEASURED THREE WAYS. The account still
     * holds it, the ledger still holds it, and the village's issued total has
     * not fallen. Rye: "those stay issued and can roll over to the next cycle".
     */
    expect((await treasuryHoldings(pool, treasuryCircle, TOKEN)).balanceMinor).toBe(held.balanceMinor);
    expect(await issuanceNet(), "nothing was handed back at the turn of the period").toBe(issuedBefore);
    expect(await conservation()).toBe(0);
  }, 90_000);

  // 3. The bonus, under the cap, paid

  it("computes a bonus from UNMINTED CAPACITY under the cap mode, and pays it", async () => {
    const circleId = "capside";
    const ballotId = await completionBallot("bal-capside", "rec-kitchen-rooting", "passed");
    expect(await vetoVerdictFor(pool, ballotId), "no steward has objected").toBe("none");

    const outcome = await standing(circleId, "cap", record({ circleId }));
    expect(outcome.kind, JSON.stringify(outcome)).toBe("payable");
    if (outcome.kind !== "payable") return;

    /*
     * THE CIRCLE ISSUED 250 OF ITS 1000 SEASON ROOM in the test above, so 750
     * is what it held back and 10% of that is 75. Every figure is read off the
     * ledger by the burn meter; nothing here is a constant.
     */
    expect(outcome.award.capMinor).toBe(1000);
    expect(outcome.award.spentMinor).toBe(250);
    expect(outcome.award.unmintedMinor).toBe(750);
    expect(outcome.award.amountMinor).toBe(75);

    const before = await issuanceNet();
    const paid = await payCircleBonus(pool, {
      circleId, circleName: "Cap Side", circleStatus: "active", tokenSlug: TOKEN,
      award: outcome.award, recordId: "rec-kitchen-rooting", actorId: "usr-steward",
      note: "finished under its cap", permit: ALLOW,
    });
    expect(paid.ok, paid.error).toBe(true);

    // THE MONEY IS REAL, AND IT LANDED IN THE CIRCLE'S OWN ACCOUNT.
    const held = await treasuryHoldings(pool, circleId, TOKEN);
    expect(held.account).toBe(circleTreasuryAccount(circleId));
    expect(held.balanceMinor).toBe(75);
    // A BONUS IS ISSUANCE and the village-wide counter sees it.
    expect(await issuanceNet()).toBe(before + 75);
    expect(await conservation()).toBe(0);
  }, 90_000);

  it("keeps the bonus OUT of the cap meter, so next season is not billed for it", async () => {
    /*
     * The boundary bug 0181 avoided, one namespace along. A bonus wearing the
     * cap meter's key would be counted as issuance the circle made, against
     * the cap of whichever period it was paid in.
     */
    const at = new Date();
    const reading = await burnFor(
      { circleId: "capside", at }, deps({ envelopes: [envelope({ circleId: "capside" })] }),
    );
    if (reading.kind !== "metered") throw new Error("expected a cap");
    expect(reading.season.spentMinor, "the bonus is not a cap spend").toBe(250);
  }, 60_000);

  it("pays once on a retry, because the key is the record and the unit", async () => {
    expect(bonusIdempotencyKey("rec-kitchen-rooting", UNIT)).toBe(
      `circle-bonus:rec-kitchen-rooting:${UNIT}`,
    );
    const outcome = await standing("capside", "cap", record({ circleId: "capside" }));
    if (outcome.kind !== "payable") throw new Error(`expected payable, got ${outcome.kind}`);
    const again = await payCircleBonus(pool, {
      circleId: "capside", circleName: "Cap Side", circleStatus: "active", tokenSlug: TOKEN,
      award: outcome.award, recordId: "rec-kitchen-rooting", actorId: "usr-steward",
      note: "a double click", permit: ALLOW,
    });
    expect(again.ok, again.error).toBe(true);
    expect(again.duplicate, "the ledger remembered").toBe(true);
    expect((await treasuryHoldings(pool, "capside", TOKEN)).balanceMinor, "and paid nothing twice").toBe(75);
  }, 60_000);

  // 4. The treasury mode refuses, on the same figures

  it("REFUSES UNDER THE TREASURY MODE, because that value already carries", async () => {
    /*
     * The same circle, the same cap figures, the same passed vote. One field
     * apart, and the answer is the ruling: what a treasury circle did not
     * spend it still has, so there is nothing to compensate.
     */
    const asCap = await standing("capside", "cap", record({ circleId: "capside" }));
    const asTreasury = await standing("capside", "treasury", record({ circleId: "capside" }));
    expect(asCap.kind).toBe("payable");
    expect(asTreasury.kind).toBe("carries_over");
  }, 60_000);

  // 5. The verdict this lane does not make

  it("REFUSES WHEN THE VILLAGE HAS NOT VOTED THE WORK COMPLETE", async () => {
    const recordId = "rec-notvoted";
    const outcome = await standing("capside", "cap", record({ id: recordId, circleId: "capside" }));
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind !== "blocked") return;
    expect(outcome.reasons.join(" ")).toContain("has not been asked");
  }, 60_000);

  it("refuses when the village voted NO, in the gate's own words", async () => {
    const recordId = "rec-saidno";
    await completionBallot("bal-saidno", recordId, "failed");
    const outcome = await standing("capside", "cap", record({ id: recordId, circleId: "capside" }));
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind !== "blocked") return;
    expect(outcome.reasons.join(" ")).toContain("did not complete");
  }, 60_000);

  it("refuses on NO QUORUM, because silence is not a refusal and is not a yes", async () => {
    const recordId = "rec-quiet";
    await completionBallot("bal-quiet", recordId, "no_quorum");
    const outcome = await standing("capside", "cap", record({ id: recordId, circleId: "capside" }));
    expect(outcome.kind).toBe("blocked");
  }, 60_000);

  it("refuses when nothing recorded what the circle took on", async () => {
    const outcome = await standing("capside", "cap", null);
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind !== "blocked") return;
    expect(outcome.reasons[0]).toContain("Nothing records");
  }, 60_000);

  // 6. The veto, which the completion gate cannot see

  it("REFUSES ON A VETO, WHICH THE COMPLETION GATE DOES NOT REPORT", async () => {
    const recordId = "rec-vetoed";
    const ballotId = await completionBallot("bal-vetoed", recordId, "passed");
    await veto(ballotId);

    /*
     * THE GAP, MEASURED. The gate reads `ballots.status`, which a veto never
     * changes, so its vote component still says the village said yes and its
     * refusal list is empty. Paying on that reading would pay a decision a
     * steward set aside.
     */
    const gate = await bonusGateFor(
      { circleId: "capside", periodId: "rooting", at: AT_PERIOD_END },
      {
        conn: pool,
        commitmentFor: async () => record({ id: recordId, circleId: "capside" }),
        burnFor: (id, instant) =>
          burnFor({ circleId: id, at: instant }, deps({ envelopes: [envelope({ circleId: id })] })),
        electorate: "village",
      },
    );
    expect(gate.vote.state, "the gate cannot see the veto").toBe("said_yes");
    expect(gate.blocking, "and it raises no objection of its own").toEqual([]);

    expect(await vetoVerdictFor(pool, ballotId)).toBe("vetoed");
    const outcome = await standing("capside", "cap", record({ id: recordId, circleId: "capside" }));
    expect(outcome.kind, "and the bonus refuses anyway").toBe("vetoed");
    if (outcome.kind !== "vetoed") return;
    expect(outcome.reason).toContain("completion finding");
  }, 90_000);

  it("answers UNKNOWN for a ballot it cannot find, and unknown refuses", async () => {
    // An id that names no row is a veto this reader has not shown to be absent.
    expect(await vetoVerdictFor(pool, "bal-does-not-exist")).toBe("unknown");
    const outcome = bonusFor({
      gate: {
        circleId: "capside", periodId: "rooting", takenAt: new Date().toISOString(),
        commitment: { state: "recorded", recordId: "r", periodId: "p", statement: "s", recordedAt: new Date(Date.now() - DAY).toISOString() },
        vote: { state: "said_yes", ballotId: "bal-does-not-exist", onTheRoll: 3, rollWeight: 3, closedAt: null, outcomeNote: null, attempts: 1, judgedBy: "village" },
        spend: { state: "under_cap", scope: "season", capMinor: 1000, spentMinor: 250, remainingMinor: 750, unit: UNIT },
        blocking: [], blindSpot: "x",
      },
      mode: "cap", pct: 10, veto: "unknown",
    });
    expect(outcome.kind).toBe("veto_unknown");
  }, 60_000);

  // 7. The village-wide cap, with nobody governing the circle

  it("THE VILLAGE-WIDE ISSUANCE CAP BINDS THE BONUS DOOR WITH NO TREASURER SET", async () => {
    /*
     * Rye settled that with no treasurer role set, circles are ungoverned and
     * the village-wide cap still binds every door. `ALLOW` is exactly that
     * posture at this seam: nothing circle-scoped refuses anything, and the
     * cap refuses anyway, because the bonus leaves `sys:mint`.
     */
    const circleId = "capped";
    const recordId = "rec-capped";
    await completionBallot("bal-capped", recordId, "passed");

    const spent = await postTransfer(pool, {
      from: MINT_FAUCET, to: memberAccount("usr-capped"), tokenType: TOKEN,
      amount: 100, source: "admin_mint", sourceRef: circleSpendRef(circleId),
      idempotencyKey: key("cappedspend"),
    });
    expect(spent.ok).toBe(true);

    // A big envelope, so the bonus is larger than any rounding in the cap.
    const outcome = await standing(circleId, "cap", record({ id: recordId, circleId }), 10, AT_PERIOD_END, 100_000);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("payable");
    if (outcome.kind !== "payable") return;
    expect(outcome.award.unmintedMinor).toBe(99_900);
    expect(outcome.award.amountMinor).toBe(9_990);

    const before = await treasuryHoldings(pool, circleId, TOKEN);

    /*
     * ROOM MEASURED, THEN CLOSED TO LESS THAN THE BONUS.
     *
     * The dial is in WHOLE TOKENS and the ledger works in minor units, so the
     * cap is computed from what the village has already issued rather than
     * typed: a hand-picked number would be a guess about how much this file
     * has minted above it, and that changes every time a case is added.
     * Rounding up to the next whole token leaves at most 99 minor of room,
     * against a bonus of 9990.
     */
    const issued = await issuanceNet();
    const tight = Math.ceil(issued / 100);
    expect(await setVariable(pool, "ledger.admin_mint_cycle_cap", String(tight))).toMatchObject({ ok: true });
    const refused = await payCircleBonus(pool, {
      circleId, circleName: "Capped", circleStatus: "active", tokenSlug: TOKEN,
      award: outcome.award, recordId, actorId: "usr-steward",
      note: "should not land", permit: ALLOW,
    });
    expect(refused.ok, "a bonus mints, so the cap binds it").toBe(false);
    expect(String(refused.error)).toContain("mint cap");
    expect((await treasuryHoldings(pool, circleId, TOKEN)).balanceMinor, "and nothing moved").toBe(
      before.balanceMinor,
    );
    expect(await conservation()).toBe(0);

    /*
     * AND A CAP OF ZERO IS ITS OWN REFUSAL, in the guard's own words. "Caps
     * fail closed: 0 means zero, never unlimited" is the ledger's rule, and
     * the sentence a steward meets says which dial did it.
     */
    await setVariable(pool, "ledger.admin_mint_cycle_cap", "0");
    const atZero = await payCircleBonus(pool, {
      circleId, circleName: "Capped", circleStatus: "active", tokenSlug: TOKEN,
      award: outcome.award, recordId, actorId: "usr-steward",
      note: "still should not land", permit: ALLOW,
    });
    expect(atZero.ok).toBe(false);
    expect(String(atZero.error)).toContain("ledger.admin_mint_cycle_cap is 0");
    expect((await treasuryHoldings(pool, circleId, TOKEN)).balanceMinor).toBe(before.balanceMinor);

    // Put the room back and the same payment lands, so the refusal was the cap
    // and never something else that happened to fail.
    await setVariable(pool, "ledger.admin_mint_cycle_cap", "100000");
    const paid = await payCircleBonus(pool, {
      circleId, circleName: "Capped", circleStatus: "active", tokenSlug: TOKEN,
      award: outcome.award, recordId, actorId: "usr-steward",
      note: "room again", permit: ALLOW,
    });
    expect(paid.ok, paid.error).toBe(true);
    expect((await treasuryHoldings(pool, circleId, TOKEN)).balanceMinor).toBe(before.balanceMinor + 9_990);
    expect(await conservation()).toBe(0);
  }, 120_000);

  it("calls the permit before it moves anything", async () => {
    const outcome = await standing("capside", "cap", record({ circleId: "capside" }));
    if (outcome.kind !== "payable") throw new Error("expected payable");
    const before = await treasuryHoldings(pool, "denied", TOKEN);
    const r = await payCircleBonus(pool, {
      circleId: "denied", circleName: "Denied", circleStatus: "active", tokenSlug: TOKEN,
      award: outcome.award, recordId: "rec-denied", actorId: null, note: "no",
      permit: (action, id) => `no: ${action} on ${id}`,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no: fund on denied");
    expect((await treasuryHoldings(pool, "denied", TOKEN)).rows).toBe(before.rows);
  }, 60_000);

  it("refuses to pay a DORMANT circle, so nothing lands in a swept account", async () => {
    const outcome = await standing("capside", "cap", record({ circleId: "capside" }));
    if (outcome.kind !== "payable") throw new Error("expected payable");
    const r = await payCircleBonus(pool, {
      circleId: "sleepy", circleName: "Sleepy", circleStatus: "dormant", tokenSlug: TOKEN,
      award: outcome.award, recordId: "rec-sleepy", actorId: null, note: "no", permit: ALLOW,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("dormant");
    expect(r.error, "and it says what paying it would cost").toContain("issuance cap");
  }, 60_000);
});
