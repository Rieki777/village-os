/**
 * Seat fees on a RECURRING gathering, against a real schema: each held fee
 * settles by its own evening, never by the series' first one.
 *
 * A recurring row's `starts_at` / `ends_at` are the base (first) evening, and
 * every later evening is expanded from them (`expandOccurrences`). `rsvp()`
 * charges each evening on its own, under that evening's village-time date.
 * The settle job used to compare the BASE evening against the clock, so once
 * a weekly supper's first evening was a day old, every fee held on the series
 * went to the treasury within six hours, including fees for evenings still
 * weeks ahead, and the member who then gave their place back got nothing.
 *
 * Every case re-proves conservation and the escrow reconciliation, the same
 * invariant eventSeats.test.ts closes every scenario with.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { civilDateKey } from "../../shared/lunar";
import {
  CYCLE_POOL_FAUCET,
  TREASURY,
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
} from "./ledger";
import { toLedgerUnits } from "./economy";
import { EVENT_ESCROW } from "./spending";
import { seatChargeFor, seatEscrowDrift, settleFinishedSeats } from "./eventSeats";
import { rsvp, withdrawRsvp } from "./gatherings";
import { setPromotionSink } from "./calendarCommunity";
import { wireReaders } from "./villageReaders";

const configured = testDbConfigured();
const TOKEN = "credits";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const units = (human: number) => toLedgerUnits(TOKEN, human);

describe.skipIf(!configured)("seat fees on a recurring gathering settle by their own evening", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

  /**
   * Today's evening at `hourUtc`, as the anchor every evening in a case is a
   * whole number of weeks from. Weeks keep the weekday, so one `byWeekday`
   * entry covers every evening the case names.
   */
  const anchorAt = (hourUtc: number) => {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), hourUtc);
  };

  /** A weekly gathering priced 5, whose first evening was two weeks before the anchor. */
  const weekly = async (
    id: string,
    anchor: number,
    zone: string,
    extra: { exceptions?: string[]; overrides?: Record<string, unknown> } = {},
  ) => {
    const base = new Date(anchor - 14 * DAY);
    const weekday = new Date(Date.parse(`${civilDateKey(base, zone)}T12:00:00Z`)).getUTCDay();
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO events (id, title, starts_at, ends_at, status, kind, layer, recurrence, seat_price, seat_token) " +
        "VALUES (?,?,?,?, 'scheduled', 'gathering', 'village', ?, 5, ?)",
      [
        id, `Weekly ${id}`, sql(base), sql(new Date(base.getTime() + 2 * HOUR)),
        JSON.stringify({ freq: "weekly", byWeekday: [weekday], interval: 1, ...extra }),
        TOKEN,
      ],
    );
  };

  const member = async (id: string, credits: number) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)",
      [id, id, `${id}@example.test`, "h"],
    );
    const r = await postTransfer(pool, {
      from: CYCLE_POOL_FAUCET, to: memberAccount(id), tokenType: TOKEN, amount: units(credits),
      source: "gratitude_pool", idempotencyKey: `seed:${id}:${credits}:${Math.random()}`,
    });
    expect(r.ok).toBe(true);
  };

  const going = async (eventId: string, userId: string, key: string) => {
    const r = await rsvp(pool, eventId, userId, "going", undefined, key);
    expect(r.ok).toBe(true);
  };

  const held = (id: string) => balanceOf(pool, memberAccount(id), TOKEN);
  const escrow = () => balanceOf(pool, EVENT_ESCROW, TOKEN);
  const treasury = () => balanceOf(pool, TREASURY, TOKEN);
  const statusOf = async (eventId: string, userId: string, key: string) =>
    (await seatChargeFor(pool, eventId, userId, key))?.status;

  const conserves = async () => {
    const inv = await checkLedgerInvariants(pool);
    expect(inv.problems).toEqual([]);
    expect(await seatEscrowDrift(pool)).toEqual([]);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    setPromotionSink(null);
    wireReaders({ moduleIsOn: () => false, boolVar: () => false });
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    setPromotionSink(null);
    wireReaders({ moduleIsOn: () => false, boolVar: () => false });
    // Each case starts from an empty book, so a sweep's count and the
    // treasury's balance are about that case alone.
    await pool.query("DELETE FROM event_seat_charges"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM event_rsvps"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM events"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM token_ledger"); // module-review-ok: scratch-schema teardown between cases, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM token_balances"); // module-review-ok: scratch-schema teardown between cases, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM users"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("keeps the fee for an evening that has passed and holds the one for an evening ahead", async () => {
    const zone = "UTC";
    const anchor = anchorAt(18);
    await weekly("ev-w", anchor, zone);
    await member("u-past", 40);
    await member("u-ahead", 40);
    const pastKey = civilDateKey(new Date(anchor - 7 * DAY), zone);
    const aheadKey = civilDateKey(new Date(anchor + 7 * DAY), zone);
    await going("ev-w", "u-past", pastKey);
    await going("ev-w", "u-ahead", aheadKey);
    expect(await escrow()).toBe(units(10));

    const r = await settleFinishedSeats(pool, { now: new Date() });
    expect(r, "only the evening that happened is settled").toEqual({ settled: 1, amount: units(5) });
    expect(await statusOf("ev-w", "u-past", pastKey)).toBe("kept");
    expect(await statusOf("ev-w", "u-ahead", aheadKey), "a fee for an evening ahead stays held").toBe("held");
    expect(await escrow()).toBe(units(5));
    expect(await treasury()).toBe(units(5));
    await conserves();

    // The member ahead gives the place back and the fee comes back whole.
    expect(await withdrawRsvp(pool, "ev-w", "u-ahead", aheadKey)).toBe(true);
    expect(await held("u-ahead")).toBe(units(40));
    expect(await statusOf("ev-w", "u-ahead", aheadKey)).toBe("released");
    expect(await escrow()).toBe(0);
    await conserves();

    // Taking it again charges once more, so across the whole story one fee is
    // held for one evening, and a sweep still leaves it alone.
    await going("ev-w", "u-ahead", aheadKey);
    expect(await held("u-ahead")).toBe(units(35));
    expect(await settleFinishedSeats(pool, { now: new Date() })).toEqual({ settled: 0, amount: 0 });
    expect(await statusOf("ev-w", "u-ahead", aheadKey)).toBe("held");
    expect(await escrow()).toBe(units(5));
    await conserves();

    // Once that evening is over and the grace has run, it settles like any other.
    const after = new Date(anchor + 7 * DAY + 2 * HOUR + 25 * HOUR);
    expect(await settleFinishedSeats(pool, { now: after })).toEqual({ settled: 1, amount: units(5) });
    expect(await statusOf("ev-w", "u-ahead", aheadKey)).toBe("kept");
    expect(await treasury()).toBe(units(10));
    await conserves();
  });

  it("an evening the host moved later settles by the time it moved to", async () => {
    const zone = "UTC";
    const anchor = anchorAt(18);
    const movedKey = civilDateKey(new Date(anchor - 7 * DAY), zone);
    const movedTo = anchor + 3 * DAY;
    await weekly("ev-m", anchor, zone, {
      overrides: { [movedKey]: { startsAt: new Date(movedTo).toISOString(), endsAt: new Date(movedTo + 2 * HOUR).toISOString() } },
    });
    await member("u-1", 40);
    await going("ev-m", "u-1", movedKey);

    // Its date is a week gone, the evening itself is three days ahead.
    expect(await settleFinishedSeats(pool, { now: new Date() })).toEqual({ settled: 0, amount: 0 });
    expect(await statusOf("ev-m", "u-1", movedKey)).toBe("held");

    const after = new Date(movedTo + 2 * HOUR + 25 * HOUR);
    expect(await settleFinishedSeats(pool, { now: after })).toEqual({ settled: 1, amount: units(5) });
    expect(await statusOf("ev-m", "u-1", movedKey)).toBe("kept");
    await conserves();
  });

  it("never keeps a fee for an evening that was called off or taken out of the series", async () => {
    const zone = "UTC";
    const anchor = anchorAt(18);
    const cancelledKey = civilDateKey(new Date(anchor - 7 * DAY), zone);
    const exceptedKey = civilDateKey(new Date(anchor - 14 * DAY), zone);
    await weekly("ev-c", anchor, zone, {
      overrides: { [cancelledKey]: { cancelled: true } },
      exceptions: [exceptedKey],
    });
    await member("u-c", 40);
    await member("u-x", 40);
    await going("ev-c", "u-c", cancelledKey);
    await going("ev-c", "u-x", exceptedKey);

    expect(await settleFinishedSeats(pool, { now: new Date() })).toEqual({ settled: 0, amount: 0 });
    expect(await statusOf("ev-c", "u-c", cancelledKey)).toBe("held");
    expect(await statusOf("ev-c", "u-x", exceptedKey)).toBe("held");
    expect(await treasury()).toBe(0);

    // Held, so giving the place back still returns it.
    expect(await withdrawRsvp(pool, "ev-c", "u-c", cancelledKey)).toBe(true);
    expect(await held("u-c")).toBe(units(40));
    await conserves();
  });

  it("reads each evening in the village's own zone", async () => {
    // 02:00 UTC is 20:00 the evening before in Regina (UTC-6 all year), so every key here
    // is a day earlier than the UTC date. A job reading UTC would find no
    // such evening and keep nothing; one reading the base row would keep both.
    const zone = "America/Regina";
    wireReaders({ moduleIsOn: () => false, boolVar: () => false, timezone: () => zone });
    const anchor = anchorAt(2);
    await weekly("ev-z", anchor, zone);
    await member("u-zp", 40);
    await member("u-za", 40);
    const pastKey = civilDateKey(new Date(anchor - 7 * DAY), zone);
    const aheadKey = civilDateKey(new Date(anchor + 7 * DAY), zone);
    expect(pastKey).not.toBe(civilDateKey(new Date(anchor - 7 * DAY), "UTC"));
    await going("ev-z", "u-zp", pastKey);
    await going("ev-z", "u-za", aheadKey);

    expect(await settleFinishedSeats(pool, { now: new Date() })).toEqual({ settled: 1, amount: units(5) });
    expect(await statusOf("ev-z", "u-zp", pastKey)).toBe("kept");
    expect(await statusOf("ev-z", "u-za", aheadKey)).toBe("held");
    await conserves();
  });
});
