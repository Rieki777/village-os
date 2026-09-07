/**
 * WHAT A CIRCLE SPENT, READ OFF A REAL LEDGER.
 *
 * Every figure in this file comes back out of `token_ledger` on a scratch
 * schema, and every posting goes in through `postTransfer`. There are no raw
 * ledger writes here and there is no stub of one: the invariant is that all
 * movement goes through the posting functions, and a test that wrote rows by
 * hand would be proving something about a table nobody's code produces.
 *
 * ONE UPDATE IS RAW AND IT MOVES NO VALUE. `at` is stamped
 * `CURRENT_TIMESTAMP` and `postTransfer` takes no instant, so a row cannot be
 * born in a window that has passed. The backdate is the same one
 * `server/mintCap.e2e.test.ts` and `server/lib/exchange.units.test.ts` already
 * use, it touches only the timestamp, and per-token SUM(balance) is untouched
 * by it.
 *
 * WHAT IS UNDER TEST, in the order the questions were asked:
 *   1. a spend attributed to one circle appears in that circle's figure and in
 *      no other's, and an unattributed row appears in none;
 *   2. the attribution key fits the column AT THE WIDEST ID THE SCHEMA ALLOWS,
 *      and the column really is the limit, proven by a refused write;
 *   3. the cycle figure and the season figure move independently;
 *   4. the reading answers for an INSTANT, and a cycle boundary resets the
 *      cycle figure without touching the season's;
 *   5. a season turn inside a cycle resets the season figure without touching
 *      the cycle's;
 *   6. each cap binds on its own, and the one that binds is named.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { loadTokenRegistry, memberAccount, MINT_FAUCET, postTransfer } from "./ledger";
import {
  burnFor,
  circleIdFromSpendRef,
  circleSpendIn,
  circleSpendRef,
  circleSpendRefProblem,
  cycleWindowAt,
  seasonWindowAt,
  type BurnDeps,
  type CircleEnvelope,
  type SeasonSpan,
} from "./circleBurn";
import { MAX_SOURCE_REF } from "./economy";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[circleBurn.test] TEST_DATABASE_URL not set. A circle's spent side is UNCHECKED here.");
}

const DAY = 86_400_000;
const TOKEN = "credits";
const UNIT = "token:credits";
/** UTC-6 with no daylight change, so a civil date is one instant and only one. */
const TZ = "America/Costa_Rica";

const SEASONS: SeasonSpan[] = [{ id: "rooting-2026", startsOn: "2026-06-01", endsOn: "2026-12-01" }];

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

/**
 * The instant every reading in this file answers for: eight days into a real
 * lunation, so a whole season turn still fits between it and the cycle's end.
 * Derived from the clock and never typed, because the lunar table decides
 * where a boundary is and a hardcoded date would drift off it.
 */
const PROBE = new Date("2026-09-15T12:00:00Z");
const CYCLE = cycleWindowAt(PROBE, "lunar");
const CYCLE_START = Date.parse(CYCLE.startsAt);
const CYCLE_END = Date.parse(CYCLE.endsAt);
const AT = new Date(CYCLE_START + 8 * DAY);

describe.skipIf(!configured)("what a circle has spent", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
    await loadTokenRegistry(pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /** Issue `amount` out of the faucet, attributed to `circleId`, stamped `at`. */
  async function issue(circleId: string | null, amount: number, at: Date): Promise<string> {
    const key = `br-issue-${++n}`;
    const r = await postTransfer(pool, {
      from: MINT_FAUCET,
      to: memberAccount(`usr-br-${n}`),
      tokenType: TOKEN,
      amount,
      source: "admin_mint",
      sourceRef: circleId ? circleSpendRef(circleId) : undefined,
      idempotencyKey: key,
    });
    expect(r.ok).toBe(true);
    await backdate(key, at);
    return key;
  }

  /** Send `amount` back into the faucet, attributed to `circleId`, stamped `at`. */
  async function giveBack(circleId: string, fromUser: string, amount: number, at: Date): Promise<void> {
    const key = `br-back-${++n}`;
    const r = await postTransfer(pool, {
      from: memberAccount(fromUser),
      to: MINT_FAUCET,
      tokenType: TOKEN,
      amount,
      source: "exchange_stock",
      sourceRef: circleSpendRef(circleId),
      idempotencyKey: key,
    });
    expect(r.ok).toBe(true);
    await backdate(key, at);
  }

  async function backdate(key: string, at: Date): Promise<void> {
    await pool.query("UPDATE token_ledger SET at = ? WHERE idempotency_key = ?", [at, key]); // module-review-ok: the test-only backdate, the mintCap.e2e.test.ts shape; it moves no value and touches no balance
  }

  const wholeSeason = () => ({
    from: new Date(Date.parse(seasonWindowAt(AT, SEASONS, TZ)!.startsAt)),
    to: new Date(Date.parse(seasonWindowAt(AT, SEASONS, TZ)!.endsAt)),
  });

  // ── 1. Attribution ────────────────────────────────────────────────────────

  describe("a spend lands in one circle's figure and no other's", () => {
    beforeAll(async () => {
      await issue("kitchen", 300, new Date(CYCLE_START + 4 * DAY));
      await issue("garden", 500, new Date(CYCLE_START + 4 * DAY));
      // A gift with no circle behind it. It must belong to nobody.
      await issue(null, 900, new Date(CYCLE_START + 4 * DAY));
    });

    it("counts the kitchen's spend and not the garden's", async () => {
      const w = wholeSeason();
      const kitchen = await circleSpendIn(pool, "kitchen", TOKEN, w.from, w.to);
      const garden = await circleSpendIn(pool, "garden", TOKEN, w.from, w.to);
      expect(kitchen.issuedMinor).toBe(300);
      expect(kitchen.netMinor).toBe(300);
      expect(garden.issuedMinor).toBe(500);
      // The unattributed 900 is in neither, and the row counts prove it.
      expect(kitchen.rows).toBe(1);
      expect(garden.rows).toBe(1);
    });

    it("gives a circle nobody has spent for a zero with zero rows behind it", async () => {
      const w = wholeSeason();
      const none = await circleSpendIn(pool, "library", TOKEN, w.from, w.to);
      expect(none.netMinor).toBe(0);
      expect(none.rows).toBe(0);
    });

    it("nets a return against issuance in the same window, and floors at zero", async () => {
      const w = wholeSeason();
      // Two hundred of the kitchen's three hundred comes back.
      await giveBack("kitchen", "usr-br-1", 200, new Date(CYCLE_START + 5 * DAY));
      const after = await circleSpendIn(pool, "kitchen", TOKEN, w.from, w.to);
      expect(after.issuedMinor).toBe(300);
      expect(after.returnedMinor).toBe(200);
      expect(after.netMinor).toBe(100);
      // Put the rest back and the figure stops at zero, never below it.
      await giveBack("kitchen", "usr-br-1", 100, new Date(CYCLE_START + 5 * DAY));
      const zeroed = await circleSpendIn(pool, "kitchen", TOKEN, w.from, w.to);
      expect(zeroed.returnedMinor).toBe(300);
      expect(zeroed.netMinor).toBe(0);
    });
  });

  // ── 2. The key, at the widest id the schema permits ───────────────────────

  describe("the attribution key against the real column", () => {
    const widest = "c".repeat(64); // circles.id is varchar(64) and slugs are capped there

    it("MEASURED: two ids cannot both fit, so the key carries one", () => {
      // circles.id varchar(64) plus circle_budgets.season_id varchar(64) is 128
      // characters of ids before any prefix or separator at all.
      expect(64 + 1 + 64).toBeGreaterThan(MAX_SOURCE_REF);
      // And one id plus this prefix has room to spare.
      expect(circleSpendRef(widest).length).toBe(71);
      expect(circleSpendRef(widest).length).toBeLessThanOrEqual(MAX_SOURCE_REF);
    });

    it("posts and reads back at the widest id the schema permits", async () => {
      const at = new Date(CYCLE_START + 4 * DAY);
      await issue(widest, 77, at);
      const w = wholeSeason();
      const spend = await circleSpendIn(pool, widest, TOKEN, w.from, w.to);
      expect(spend.issuedMinor).toBe(77);
      const [rows]: any = await pool.query(
        "SELECT source_ref FROM token_ledger WHERE source_ref = ?",
        [circleSpendRef(widest)],
      );
      expect(rows.length).toBe(1);
      // Nothing was silently shortened on the way in.
      expect(String(rows[0].source_ref).length).toBe(71);
    });

    it("refuses an id that would not fit BEFORE the row is offered to MySQL", () => {
      const justFits = "c".repeat(MAX_SOURCE_REF - "circle:".length);
      expect(circleSpendRefProblem(justFits)).toBeNull();
      const oneTooLong = `${justFits}c`;
      const problem = circleSpendRefProblem(oneTooLong);
      expect(problem).toContain("121");
      expect(problem).toContain(String(MAX_SOURCE_REF));
      expect(() => circleSpendRef(oneTooLong)).toThrow();
    });

    it("THE COLUMN REALLY IS THE LIMIT: an over-width ref LOSES the row", async () => {
      const key = "br-overwide";
      let threw = false;
      let ok = true;
      try {
        const r = await postTransfer(pool, {
          from: MINT_FAUCET,
          to: memberAccount("usr-br-overwide"),
          tokenType: TOKEN,
          amount: 5,
          source: "admin_mint",
          sourceRef: "x".repeat(MAX_SOURCE_REF + 1),
          idempotencyKey: key,
        });
        ok = r.ok;
      } catch {
        threw = true;
      }
      // Strict MySQL refuses it outright. Either shape is a failure, and what
      // matters is the third assertion: the spend is simply not there.
      expect(threw || !ok).toBe(true);
      const [rows]: any = await pool.query(
        "SELECT COUNT(*) AS n FROM token_ledger WHERE idempotency_key = ?",
        [key],
      );
      expect(Number(rows[0].n)).toBe(0);
    });

    it("reads a circle back off a row, and reads nothing off a row that names none", () => {
      expect(circleIdFromSpendRef(circleSpendRef("kitchen"))).toBe("kitchen");
      expect(circleIdFromSpendRef("gr-2831")).toBeNull();
      expect(circleIdFromSpendRef(null)).toBeNull();
      expect(circleIdFromSpendRef("circle:")).toBeNull();
    });
  });

  // ── 3 to 6. The reading ───────────────────────────────────────────────────

  describe("the reading, at an instant", () => {
    const CIRCLE = "workshop";
    const envelope: CircleEnvelope = {
      circleId: CIRCLE,
      unit: UNIT,
      seasonCapMinor: 1000,
      cycleCapMinor: 400,
      seasonId: null,
      mode: "cap",
      pending: null,
      dormant: null,
    };

    const deps = (over: Partial<BurnDeps> = {}): BurnDeps => ({
      conn: pool,
      moduleOn: true,
      envelopes: [envelope],
      clockMode: "lunar",
      seasons: SEASONS,
      timeZone: TZ,
      tokenTypeFor: (u: string) => (u === UNIT ? TOKEN : null),
      circleStatusFor: () => "active",
      ...over,
    });

    beforeAll(async () => {
      // 600 in the PREVIOUS cycle, inside the same season.
      await issue(CIRCLE, 600, new Date(CYCLE_START - 3 * DAY));
      // 300 in THIS cycle, four days in.
      await issue(CIRCLE, 300, new Date(CYCLE_START + 4 * DAY));
    });

    it("reads the two windows independently off the same rows", async () => {
      const r = await burnFor({ circleId: CIRCLE, at: AT }, deps());
      expect(r.kind).toBe("metered");
      if (r.kind !== "metered") return;
      expect(r.cycle.spentMinor).toBe(300);
      expect(r.season.spentMinor).toBe(900);
      // Independent figures, and the caps they answer to are independent too.
      expect(r.cycle.capMinor).toBe(400);
      expect(r.season.capMinor).toBe(1000);
      expect(r.cycle.remainingMinor).toBe(100);
      expect(r.season.remainingMinor).toBe(100);
    });

    it("carries a rate on each window, and the rates differ because the windows do", async () => {
      const r = await burnFor({ circleId: CIRCLE, at: AT }, deps());
      if (r.kind !== "metered") throw new Error("expected a metered reading");
      // Eight days into the cycle, 300 spent: 37.5 a day.
      expect(r.cycle.perDayMinor).toBeCloseTo(300 / 8, 6);
      // The season began 2026-06-01 in the village's zone, far longer ago, so
      // the same circle burns far more slowly measured against it.
      expect(r.season.perDayMinor as number).toBeLessThan(r.cycle.perDayMinor as number);
    });

    it("COUNTS UP TO THE INSTANT AND NOT TO THE WINDOW'S END", async () => {
      /*
       * Its own circle, so nothing here disturbs the 300 / 900 picture the
       * rest of this block reads, and so the row can stay posted: a DELETE
       * against `token_ledger` to tidy a fixture would break the one invariant
       * this whole file is careful to keep.
       *
       * AN ADVERSARIAL PASS FOUND THIS GAP. Removing the window's upper bound
       * from the query changed no figure any other test asserted, because no
       * other test had put a row between the reading instant and the window's
       * end. The rate divides by time elapsed up to `at`, so the sum has to
       * stop at `at` as well or the two disagree by exactly that row.
       */
      const late = "workshop-late";
      const lateEnvelope: CircleEnvelope = { ...envelope, circleId: late };
      const later = new Date(AT.getTime() + 2 * DAY);
      expect(later.getTime()).toBeLessThan(CYCLE_END);
      await issue(late, 300, new Date(CYCLE_START + 4 * DAY));
      await issue(late, 40, later);

      const lateDeps = deps({ envelopes: [lateEnvelope] });
      const now = await burnFor({ circleId: late, at: AT }, lateDeps);
      const after = await burnFor({ circleId: late, at: new Date(later.getTime() + 1) }, lateDeps);
      if (now.kind !== "metered" || after.kind !== "metered") throw new Error("metered");

      expect(now.cycle.spentMinor).toBe(300);
      expect(after.cycle.spentMinor).toBe(340);
      // Same window on both readings, so the instant is doing all the work.
      expect(after.cycle.window!.id).toBe(now.cycle.window!.id);
      // The rate agrees with the sum it is taken from, on both readings.
      expect(now.cycle.perDayMinor).toBeCloseTo(300 / 8, 6);
      expect(after.cycle.perDayMinor as number).toBeCloseTo(340 / 10, 4);
    });

    it("A CYCLE BOUNDARY RESETS THE CYCLE FIGURE AND DOES NOT TOUCH THE SEASON'S", async () => {
      const justBefore = await burnFor({ circleId: CIRCLE, at: new Date(CYCLE_END - 1) }, deps());
      const atBoundary = await burnFor({ circleId: CIRCLE, at: new Date(CYCLE_END) }, deps());
      if (justBefore.kind !== "metered" || atBoundary.kind !== "metered") throw new Error("metered");

      // One millisecond apart, and the cycle figure is a different fact.
      expect(justBefore.cycle.spentMinor).toBe(300);
      expect(atBoundary.cycle.spentMinor).toBe(0);
      expect(atBoundary.cycle.state).toBe("unspent");
      // IT DOES NOT SMEAR: the next cycle carries none of this one's spend, and
      // it carries no rate either, because a rate needs a spend to measure.
      expect(atBoundary.cycle.perDayMinor).toBeNull();
      expect(atBoundary.cycle.window!.id).not.toBe(justBefore.cycle.window!.id);

      // The season straddles the boundary and reads the same on both sides.
      expect(justBefore.season.spentMinor).toBe(900);
      expect(atBoundary.season.spentMinor).toBe(900);
      expect(atBoundary.season.window!.id).toBe(justBefore.season.window!.id);
    });

    it("A SEASON TURN INSIDE A CYCLE RESETS THE SEASON FIGURE AND NOT THE CYCLE'S", async () => {
      // Turn the season on a civil date between the reading instant and the
      // cycle's end, so the two boundaries provably do not coincide.
      const turnMs = (AT.getTime() + CYCLE_END) / 2;
      const turnDay = new Date(turnMs).toISOString().slice(0, 10);
      const twoSeasons: SeasonSpan[] = [
        { id: "rooting-2026", startsOn: "2026-06-01", endsOn: turnDay },
        { id: "building-2026", startsOn: turnDay, endsOn: "2027-03-01" },
      ];
      const turnAt = Date.parse(seasonWindowAt(new Date(turnMs), twoSeasons, TZ)!.startsAt);
      expect(turnAt).toBeGreaterThan(AT.getTime());
      expect(turnAt).toBeLessThan(CYCLE_END);

      const before = await burnFor({ circleId: CIRCLE, at: AT }, deps({ seasons: twoSeasons }));
      const after = await burnFor({ circleId: CIRCLE, at: new Date(turnAt) }, deps({ seasons: twoSeasons }));
      if (before.kind !== "metered" || after.kind !== "metered") throw new Error("metered");

      expect(before.season.window!.id).toBe("rooting-2026");
      expect(after.season.window!.id).toBe("building-2026");
      expect(before.season.spentMinor).toBe(900);
      expect(after.season.spentMinor).toBe(0);
      expect(after.season.state).toBe("unspent");
      // Same cycle on both sides of the season turn, same cycle figure.
      expect(after.cycle.window!.id).toBe(before.cycle.window!.id);
      expect(after.cycle.spentMinor).toBe(300);
    });

    it("says the season cap has no window once every configured season has ended", async () => {
      const past: SeasonSpan[] = [{ id: "old", startsOn: "2025-01-01", endsOn: "2025-06-01" }];
      const r = await burnFor({ circleId: CIRCLE, at: AT }, deps({ seasons: past }));
      if (r.kind !== "metered") throw new Error("metered");
      expect(r.season.state).toBe("no_window");
      // It never reads as unlimited room.
      expect(r.season.remainingMinor).toBeNull();
      expect(r.season.askFits).toBeNull();
      expect(r.binds).toBe("cycle");
    });

    it("EACH CAP BINDS ON ITS OWN, and the reading names which one", async () => {
      // Cycle: 300 of 400. Season: 900 of 1000.
      // An ask of 50 fits both, and eats more of the season.
      const small = await burnFor({ circleId: CIRCLE, at: AT, plus: 50 }, deps());
      if (small.kind !== "metered") throw new Error("metered");
      expect(small.fits).toBe(true);
      expect(small.binds).toBe("season"); // 95% against 87.5%

      // An ask of 150 breaks both, and now the CYCLE is the tighter one.
      const big = await burnFor({ circleId: CIRCLE, at: AT, plus: 150 }, deps());
      if (big.kind !== "metered") throw new Error("metered");
      expect(big.fits).toBe(false);
      expect(big.cycle.askFits).toBe(false);
      expect(big.season.askFits).toBe(false);
      expect(big.binds).toBe("cycle"); // 112.5% against 105%
    });

    it("SHIFTING THE INSTANT PAST THE CYCLE BOUNDARY MAKES AN INFEASIBLE ASK FEASIBLE", async () => {
      // 150 does not fit this cycle's 400 with 300 already spent.
      const today = await burnFor({ circleId: CIRCLE, at: AT, plus: 150 }, deps());
      if (today.kind !== "metered") throw new Error("metered");
      expect(today.cycle.askFits).toBe(false);

      // The same ask landing next cycle meets a cap that has reset. This is the
      // false warning the instant parameter exists to prevent.
      const nextCycle = await burnFor(
        { circleId: CIRCLE, at: new Date(CYCLE_END + DAY), plus: 150 },
        deps(),
      );
      if (nextCycle.kind !== "metered") throw new Error("metered");
      expect(nextCycle.cycle.askFits).toBe(true);
      // And the season has not reset, so the season still says no.
      expect(nextCycle.season.spentMinor).toBe(900);
      expect(nextCycle.season.askFits).toBe(false);
      expect(nextCycle.binds).toBe("season");
    });

    it("reports the module being off without touching the database", async () => {
      const r = await burnFor({ circleId: CIRCLE, at: AT }, deps({ moduleOn: false }));
      expect(r.kind).toBe("module_off");
    });

    it("reports a circle with no envelope as UNGOVERNED, which is not an empty state", async () => {
      const r = await burnFor({ circleId: "no-such-circle", at: AT }, deps());
      expect(r.kind).toBe("ungoverned");
      // Nothing about it can be mistaken for a metered zero.
      expect(r).not.toHaveProperty("cycle");
      expect(r).not.toHaveProperty("season");
    });

    it("reports an envelope in a currency as unmeasurable, never as unspent", async () => {
      const fiat: CircleEnvelope = { ...envelope, unit: "CHF" };
      const r = await burnFor(
        { circleId: CIRCLE, at: AT, unit: "CHF" },
        deps({ envelopes: [fiat], tokenTypeFor: () => null }),
      );
      if (r.kind !== "metered") throw new Error("metered");
      expect(r.cycle.state).toBe("unmeasurable");
      expect(r.cycle.spentMinor).toBeNull();
      expect(r.binds).toBeNull();
    });

    it("reports a cycle cap of zero as exhausted, because caps fail closed", async () => {
      const frozen: CircleEnvelope = { ...envelope, cycleCapMinor: 0 };
      const r = await burnFor({ circleId: CIRCLE, at: AT, plus: 1 }, deps({ envelopes: [frozen] }));
      if (r.kind !== "metered") throw new Error("metered");
      expect(r.cycle.state).toBe("exhausted");
      expect(r.cycle.askFits).toBe(false);
      expect(r.fits).toBe(false);
    });

    it("reports no cycle cap as no_cap, which is every village until it sets one", async () => {
      const seasonOnly: CircleEnvelope = { ...envelope, cycleCapMinor: null };
      const r = await burnFor({ circleId: CIRCLE, at: AT }, deps({ envelopes: [seasonOnly] }));
      if (r.kind !== "metered") throw new Error("metered");
      expect(r.cycle.state).toBe("no_cap");
      expect(r.cycle.askFits).toBeNull();
      expect(r.binds).toBe("season");
    });
  });
});
