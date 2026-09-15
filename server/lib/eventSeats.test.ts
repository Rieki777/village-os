/**
 * Seat fees, against a real schema, with conservation re-proved after every
 * one of them.
 *
 * The refund IS the feature, so the suite is mostly about giving money back:
 * changing an answer, leaving a queue, a gathering cancelled, a gathering
 * deleted. Each one is then RETRIED, because "idempotent" is a claim about the
 * second call and testing only the first proves nothing.
 *
 * Everything runs through `postTransfer` against a scratch schema, because the
 * whole point is what the ledger does under an atomic claim, and a mocked pool
 * would only prove the mock. Skips loudly without TEST_DATABASE_URL.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  CYCLE_POOL_FAUCET,
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
  tokenDef,
} from "./ledger";
import { toLedgerUnits } from "./economy";
import { EVENT_ESCROW } from "./spending";
import {
  chargeForPlace,
  heldSeatValue,
  refundPlace,
  seatChargeFor,
  seatEscrowDrift,
  seatPriceFor,
  settleFinishedSeats,
} from "./eventSeats";
import { deleteGathering, rsvp, updateGathering, withdrawRsvp } from "./gatherings";
import { joinWaitlist, leaveWaitlist, setPromotionSink } from "./calendarCommunity";

const configured = testDbConfigured();
const TOKEN = "credits";

/**
 * Every money assertion below is written as `units(<the number a host typed>)`
 * rather than as a bare integer, because a bare integer restates a scale the
 * registry owns and goes on passing when the scale moves under it. At
 * `decimals = 0` this changes nothing; the second describe in this file sets
 * `credits` to 4 and re-proves the same outcomes against explicit arithmetic,
 * so neither block can green a conversion that is missing.
 */
const units = (human: number) => toLedgerUnits(TOKEN, human);

describe.skipIf(!configured)("seat fees and the refunds that make them honest", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

  /** A gathering with a price, or without one when `price` is 0. */
  const gathering = async (
    id: string,
    opts: { price?: number; capacity?: number | null; startsAt?: Date; endsAt?: Date | null } = {},
  ) => {
    const starts = opts.startsAt ?? new Date(Date.now() + 7 * 86_400_000);
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO events (id, title, starts_at, ends_at, status, kind, layer, capacity, seat_price, seat_token) " +
        "VALUES (?,?,?,?, 'scheduled', 'gathering', 'village', ?, ?, ?)",
      [
        id, `Gathering ${id}`, iso(starts), opts.endsAt ? iso(opts.endsAt) : null,
        opts.capacity === undefined ? null : opts.capacity,
        opts.price ?? 0, (opts.price ?? 0) > 0 ? TOKEN : null,
      ],
    );
  };

  /**
   * A member with credits in hand, issued the way the cycle pool issues them.
   *
   * `credits` is the HUMAN number, and `postTransfer` takes MINOR units, so the
   * seed converts. Handing the raw number over was right by accident while
   * every token sat at `decimals = 0`; at 4 it seeds a member with 0.0040
   * credits while a 12-credit gathering asks 120000, and every case in this
   * file would fail on an unaffordable seat rather than on the thing it is
   * about.
   */
  const member = async (id: string, credits: number) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)",
      [id, id, `${id}@example.test`, "h"],
    );
    if (credits > 0) {
      const r = await postTransfer(pool, {
        from: CYCLE_POOL_FAUCET, to: memberAccount(id), tokenType: TOKEN, amount: units(credits),
        source: "gratitude_pool", idempotencyKey: `seed:${id}:${credits}:${Math.random()}`,
      });
      expect(r.ok).toBe(true);
    }
  };

  const held = (id: string) => balanceOf(pool, memberAccount(id), TOKEN);
  const escrow = () => balanceOf(pool, EVENT_ESCROW, TOKEN);

  /**
   * THE INVARIANT, after every single scenario. Conservation is the thing that
   * must never break, and the escrow's own drift check is folded in because
   * conservation alone cannot see a DISTRIBUTION error: a fee charged and not
   * recorded still sums to zero.
   */
  const conserves = async () => {
    const inv = await checkLedgerInvariants(pool);
    expect(inv.problems).toEqual([]);
    expect(await seatEscrowDrift(pool)).toEqual([]);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    setPromotionSink(null);
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    setPromotionSink(null);
    await pool.query("DELETE FROM event_seat_charges"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM event_rsvps"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM event_waitlist"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM events"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM token_ledger"); // module-review-ok: scratch-schema teardown between cases, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM token_balances"); // module-review-ok: scratch-schema teardown between cases, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM users"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("takes the fee when a seat is taken, and the balance moves", async () => {
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);

    const out = await rsvp(pool, "ev-1", "u-1", "going");
    expect(out.ok).toBe(true);
    expect(out.ok && out.charged).toBe(units(12));
    expect(await held("u-1")).toBe(units(28));
    expect(await escrow()).toBe(units(12));
    await conserves();
  });

  it("charges NOTHING for a free gathering", async () => {
    await gathering("ev-free");
    await member("u-1", 40);
    const out = await rsvp(pool, "ev-free", "u-1", "going");
    expect(out.ok && out.charged).toBe(0);
    expect(await held("u-1")).toBe(units(40));
    expect(await seatChargeFor(pool, "ev-free", "u-1", "")).toBeNull();
    await conserves();
  });

  it("REFUSES the seat when the balance does not cover it, and seats nobody", async () => {
    await gathering("ev-1", { price: 50 });
    await member("u-poor", 10);

    const out = await rsvp(pool, "ev-1", "u-poor", "going");
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe("unpaid");
    // The compensation: no seat, no charge row, no movement at all. A member
    // is never out of pocket for a step that did not finish, and never holds a
    // place they did not pay for.
    const [seats]: any = await pool.query("SELECT COUNT(*) n FROM event_rsvps WHERE event_id = 'ev-1'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(seats[0].n)).toBe(0);
    expect(await seatChargeFor(pool, "ev-1", "u-poor", "")).toBeNull();
    expect(await held("u-poor")).toBe(units(10));
    expect(await escrow()).toBe(0);
    await conserves();
  });

  it("re-confirming the same answer charges once, not twice", async () => {
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);
    await rsvp(pool, "ev-1", "u-1", "going");
    const again = await rsvp(pool, "ev-1", "u-1", "going");
    expect(again.ok).toBe(true);
    expect(await held("u-1")).toBe(units(28));
    await conserves();
  });

  it("returns the exact amount when the answer changes, and a retry moves nothing", async () => {
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);
    await rsvp(pool, "ev-1", "u-1", "going");
    expect(await held("u-1")).toBe(units(28));

    await rsvp(pool, "ev-1", "u-1", "declined");
    expect(await held("u-1")).toBe(units(40));
    expect(await escrow()).toBe(0);
    await conserves();

    // THE RETRY. A second refund on the same place is a no-op at the claim and
    // a no-op at the ledger key, so the balance cannot climb past what was
    // taken.
    const second = await refundPlace(pool, "ev-1", "u-1", "", "retry");
    expect(second.refunded).toBe(0);
    expect(await held("u-1")).toBe(units(40));
    await conserves();
  });

  it("returns the fee on withdraw, and a second withdraw pays nothing", async () => {
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);
    await rsvp(pool, "ev-1", "u-1", "going");

    expect(await withdrawRsvp(pool, "ev-1", "u-1", "")).toBe(true);
    expect(await held("u-1")).toBe(units(40));
    // The second withdraw finds no answer and returns false, having moved
    // nothing. Pressing cancel twice is the ordinary case, not the exotic one.
    expect(await withdrawRsvp(pool, "ev-1", "u-1", "")).toBe(false);
    expect(await held("u-1")).toBe(units(40));
    expect(await escrow()).toBe(0);
    await conserves();
  });

  it("charges a QUEUE place, and gives it back when they step out", async () => {
    // Capacity 1, taken, so the queue is genuinely open. Paying to queue is
    // what lets a paid gathering have a waitlist at all: promotion writes a
    // seat with nobody present to agree to a charge.
    await gathering("ev-1", { price: 12, capacity: 1 });
    await member("u-seat", 40);
    await member("u-queue", 40);
    await rsvp(pool, "ev-1", "u-seat", "going");

    const q = await joinWaitlist(pool, "ev-1", "u-queue");
    expect(q.ok).toBe(true);
    expect(q.ok && q.charged).toBe(units(12));
    expect(await held("u-queue")).toBe(units(28));
    expect(await escrow()).toBe(units(24));
    await conserves();

    expect(await leaveWaitlist(pool, "ev-1", "u-queue", "")).toBe(true);
    expect(await held("u-queue")).toBe(units(40));
    expect(await escrow()).toBe(units(12));
    // Retry: leaving a queue you already left frees nothing and refunds
    // nothing.
    expect(await leaveWaitlist(pool, "ev-1", "u-queue", "")).toBe(false);
    expect(await held("u-queue")).toBe(units(40));
    await conserves();
  });

  it("promotion off the queue moves NO money: the place was already paid for", async () => {
    await gathering("ev-1", { price: 12, capacity: 1 });
    await member("u-seat", 40);
    await member("u-queue", 40);
    await rsvp(pool, "ev-1", "u-seat", "going");
    await joinWaitlist(pool, "ev-1", "u-queue");
    expect(await held("u-queue")).toBe(units(28));

    // The seat frees, the queue is served inside that same transaction.
    await withdrawRsvp(pool, "ev-1", "u-seat", "");

    const [seated]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT user_id, status FROM event_rsvps WHERE event_id = 'ev-1'",
    );
    expect(seated.map((r: any) => `${r.user_id}:${r.status}`)).toEqual(["u-queue:going"]);
    // Charged once, when they took the queue place. Not again on promotion.
    expect(await held("u-queue")).toBe(units(28));
    expect(await held("u-seat")).toBe(units(40));
    expect(await escrow()).toBe(units(12));
    await conserves();
  });

  it("REFUSES a queue place the member cannot afford, and leaves no place behind", async () => {
    await gathering("ev-1", { price: 50, capacity: 1 });
    await member("u-seat", 60);
    await member("u-poor", 10);
    await rsvp(pool, "ev-1", "u-seat", "going");

    const q = await joinWaitlist(pool, "ev-1", "u-poor");
    expect(q.ok).toBe(false);
    expect(!q.ok && q.reason).toBe("unpaid");
    const [live]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) n FROM event_waitlist WHERE event_id = 'ev-1' AND left_at IS NULL AND promoted_at IS NULL",
    );
    expect(Number(live[0].n)).toBe(0);
    expect(await held("u-poor")).toBe(units(10));
    await conserves();
  });

  it("a CANCELLED gathering refunds everybody, and saving it again refunds nobody twice", async () => {
    await gathering("ev-1", { price: 12, capacity: 1 });
    await member("u-seat", 40);
    await member("u-queue", 40);
    await rsvp(pool, "ev-1", "u-seat", "going");
    await joinWaitlist(pool, "ev-1", "u-queue");
    expect(await escrow()).toBe(units(24));

    await updateGathering(pool, "ev-1", { status: "cancelled" });
    expect(await held("u-seat")).toBe(units(40));
    expect(await held("u-queue")).toBe(units(40));
    expect(await escrow()).toBe(0);
    await conserves();

    // Saving the cancellation again finds no held charges and posts nothing.
    await updateGathering(pool, "ev-1", { status: "cancelled" });
    expect(await held("u-seat")).toBe(units(40));
    expect(await held("u-queue")).toBe(units(40));
    await conserves();
  });

  it("taking a gathering back to draft refunds it too", async () => {
    // Un-publishing removes it from the calendar as completely as cancelling,
    // and `settleFinishedSeats` skips anything not scheduled, so a fee held
    // against a draft would rest in escrow forever.
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);
    await rsvp(pool, "ev-1", "u-1", "going");
    await updateGathering(pool, "ev-1", { status: "draft" });
    expect(await held("u-1")).toBe(units(40));
    await conserves();
  });

  it("DELETING a gathering refunds before it destroys the rows", async () => {
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);
    await rsvp(pool, "ev-1", "u-1", "going");
    expect(await escrow()).toBe(units(12));

    expect(await deleteGathering(pool, "ev-1")).toBe(true);
    expect(await held("u-1")).toBe(units(40));
    expect(await escrow()).toBe(0);
    const [rows]: any = await pool.query("SELECT COUNT(*) n FROM event_seat_charges WHERE event_id = 'ev-1'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(rows[0].n)).toBe(0);
    await conserves();
  });

  it("a member who queues, leaves and queues again pays twice and is owed twice", async () => {
    // The sequence one row per place plus a sequence counter exists for. Two
    // charges and two refunds share no ledger key, so neither collapses into
    // the other.
    await gathering("ev-1", { price: 12, capacity: 1 });
    await member("u-seat", 40);
    await member("u-queue", 40);
    await rsvp(pool, "ev-1", "u-seat", "going");

    await joinWaitlist(pool, "ev-1", "u-queue");
    await leaveWaitlist(pool, "ev-1", "u-queue", "");
    const again = await joinWaitlist(pool, "ev-1", "u-queue");
    expect(again.ok && again.charged).toBe(units(12));
    expect(await held("u-queue")).toBe(units(28));

    const row = await seatChargeFor(pool, "ev-1", "u-queue", "");
    expect(row?.chargeSeq).toBe(2);
    expect(row?.status).toBe("held");
    await conserves();

    await leaveWaitlist(pool, "ev-1", "u-queue", "");
    expect(await held("u-queue")).toBe(units(40));
    await conserves();
  });

  it("settles a gathering that has HAPPENED to the treasury, once", async () => {
    const past = new Date(Date.now() - 5 * 86_400_000);
    await gathering("ev-1", { price: 12, startsAt: past, endsAt: past });
    await member("u-1", 40);
    // The charge is taken directly: rsvp() would refuse a past gathering no
    // more than a future one, but taking it here keeps the test about the
    // settle rather than about answering.
    const c = await chargeForPlace(pool, "ev-1", "u-1", "", "seat");
    expect(c.ok).toBe(true);
    expect(await escrow()).toBe(units(12));

    const first = await settleFinishedSeats(pool);
    expect(first).toEqual({ settled: 1, amount: units(12) });
    expect(await escrow()).toBe(0);
    expect(await balanceOf(pool, "sys:treasury", TOKEN)).toBe(units(12));
    await conserves();

    // A second sweep finds nothing held and moves nothing.
    expect(await settleFinishedSeats(pool)).toEqual({ settled: 0, amount: 0 });
    expect(await balanceOf(pool, "sys:treasury", TOKEN)).toBe(units(12));
    await conserves();
  });

  it("leaves a gathering still to come alone", async () => {
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);
    await rsvp(pool, "ev-1", "u-1", "going");
    expect(await settleFinishedSeats(pool)).toEqual({ settled: 0, amount: 0 });
    expect(await escrow()).toBe(units(12));
    await conserves();
  });

  it("counts held fees as open state, so the module cannot be switched off over them", async () => {
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);
    expect(await heldSeatValue(pool)).toEqual({ count: 0, amount: 0, byToken: [] });
    await rsvp(pool, "ev-1", "u-1", "going");
    // The open-state figure is what an admin READS, so it is in whole tokens
    // per token, never the ledger's minor units summed across all of them.
    expect(await heldSeatValue(pool)).toEqual({
      count: 1, amount: 12, byToken: [{ tokenType: TOKEN, amount: 12 }],
    });
    await withdrawRsvp(pool, "ev-1", "u-1", "");
    expect(await heldSeatValue(pool)).toEqual({ count: 0, amount: 0, byToken: [] });
    await conserves();
  });

  it("sees an escrow that does not match its open charges", async () => {
    // The one failure conservation cannot see: a charge row with no ledger leg
    // behind it sums to zero across all accounts and is still wrong.
    await gathering("ev-1", { price: 12 });
    await member("u-1", 40);
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO event_seat_charges (id, event_id, user_id, occurrence_key, token_type, amount, status) " +
        "VALUES ('sc-fake','ev-1','u-1','', ?, ?, 'held')",
      [TOKEN, units(12)],
    );
    const drift = await seatEscrowDrift(pool);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatch(/seat escrow drift/);
    // Conservation itself still holds, which is exactly the point.
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
  });

  /**
   * ── THE SAME OUTCOMES, AT FOUR DECIMALS ──────────────────────────────────
   *
   * Everything above runs against `credits` at `decimals = 0`, where a human
   * number and a minor unit are the same number. That is what makes the suite
   * above unable to tell a converted path from an unconverted one on its own:
   * a caller handing `postTransfer` the host's raw 12 is right by accident.
   *
   * This block moves the registry to 4 and re-reads the same outcomes, one
   * layer lower: the ledger rows, the stored mirror, the balances. The
   * expectations are written as explicit arithmetic against a named SCALE
   * rather than through `toLedgerUnits`, so a conversion that agreed with
   * itself and with nothing else could not green them.
   *
   * Removing the `toLedgerUnits` call from `seatPriceFor` turns every case
   * here red, which is what makes them a test of the fix rather than a
   * description of it.
   */
  describe("at four decimals, where a human number and a minor unit are ten thousand apart", () => {
    const SCALE = 10_000;
    const PRICE = 12;
    const PURSE = 40;

    beforeAll(async () => {
      await pool.query("UPDATE tokens SET decimals = 4 WHERE slug = ?", [TOKEN]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await loadTokenRegistry(pool);
      // The premise of every case below. If the registry did not move, they
      // would all pass for the wrong reason.
      expect(tokenDef(TOKEN)?.decimals).toBe(4);
      expect(units(1)).toBe(SCALE);
    });

    afterAll(async () => {
      await pool.query("UPDATE tokens SET decimals = 0 WHERE slug = ?", [TOKEN]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await loadTokenRegistry(pool);
    });

    /** The amounts on the ledger rows carrying one key suffix, oldest first. */
    const legs = async (suffix: string): Promise<number[]> => {
      const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT amount FROM token_ledger WHERE idempotency_key LIKE ? ORDER BY id",
        [`seat:%:${suffix}`],
      );
      return rows.map((r: any) => Number(r.amount));
    };

    /** What the mirror column holds for one place. */
    const storedAmount = async (): Promise<number | null> => {
      const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT amount FROM event_seat_charges WHERE event_id = 'ev-1' AND user_id = 'u-1'",
      );
      return rows[0] ? Number(rows[0].amount) : null;
    };

    it("reads the host's whole number and hands back MINOR units", async () => {
      await gathering("ev-1", { price: PRICE });
      expect(await seatPriceFor(pool, "ev-1")).toEqual({ tokenType: TOKEN, amount: PRICE * SCALE });
    });

    it("holds exactly the price in minor units, on the leg AND on the stored row", async () => {
      await gathering("ev-1", { price: PRICE });
      await member("u-1", PURSE);

      const c = await chargeForPlace(pool, "ev-1", "u-1", "", "seat");
      expect(c.ok).toBe(true);
      expect(c.ok && c.charged).toBe(PRICE * SCALE);

      // The three places the number lands, all read back independently.
      expect(await legs("pay")).toEqual([PRICE * SCALE]);
      expect(await storedAmount()).toBe(PRICE * SCALE);
      expect(await escrow()).toBe(PRICE * SCALE);
      expect(await held("u-1")).toBe((PURSE - PRICE) * SCALE);
      await conserves();
    });

    it("quotes the refusal in whole tokens, never in ten-thousandths", async () => {
      await gathering("ev-1", { price: PRICE });
      await member("u-poor", 5);
      const c = await chargeForPlace(pool, "ev-1", "u-poor", "", "seat");
      expect(c.ok).toBe(false);
      // The sentence a member reads. `120000 Village Credits` is the shape of
      // the bug this whole lane is about, so it is asserted against by name.
      expect(!c.ok && c.error).toContain(`asks for ${PRICE} `);
      expect(!c.ok && c.error).not.toContain(String(PRICE * SCALE));
      await conserves();
    });

    it("refunds the identical minor number the pay leg posted", async () => {
      await gathering("ev-1", { price: PRICE });
      await member("u-1", PURSE);
      await chargeForPlace(pool, "ev-1", "u-1", "", "seat");

      const back = await refundPlace(pool, "ev-1", "u-1", "", "changed answer");
      expect(back.refunded).toBe(PRICE * SCALE);
      expect(await legs("refund")).toEqual(await legs("pay"));
      expect(await held("u-1")).toBe(PURSE * SCALE);
      expect(await escrow()).toBe(0);
      await conserves();

      // The retry still moves nothing, so a double conversion on either leg
      // cannot hide behind the round trip netting to zero.
      expect((await refundPlace(pool, "ev-1", "u-1", "", "retry")).refunded).toBe(0);
      expect(await held("u-1")).toBe(PURSE * SCALE);
      await conserves();
    });

    it("settles the identical minor number to the treasury", async () => {
      const past = new Date(Date.now() - 5 * 86_400_000);
      await gathering("ev-1", { price: PRICE, startsAt: past, endsAt: past });
      await member("u-1", PURSE);
      await chargeForPlace(pool, "ev-1", "u-1", "", "seat");

      expect(await settleFinishedSeats(pool)).toEqual({ settled: 1, amount: PRICE * SCALE });
      expect(await legs("keep")).toEqual(await legs("pay"));
      expect(await balanceOf(pool, "sys:treasury", TOKEN)).toBe(PRICE * SCALE);
      expect(await escrow()).toBe(0);
      await conserves();
    });

    it("reports held value in whole tokens per token, not in summed minor units", async () => {
      await gathering("ev-1", { price: PRICE });
      await member("u-1", PURSE);
      await rsvp(pool, "ev-1", "u-1", "going");

      // The escrow really does hold ten thousand times the printed figure, and
      // the printed figure is the one the host set.
      expect(await escrow()).toBe(PRICE * SCALE);
      expect(await heldSeatValue(pool)).toEqual({
        count: 1, amount: PRICE, byToken: [{ tokenType: TOKEN, amount: PRICE }],
      });
      await conserves();
    });

    it("keeps the escrow reconciliation honest, and still catches a corrupted row", async () => {
      await gathering("ev-1", { price: PRICE });
      await member("u-1", PURSE);
      await rsvp(pool, "ev-1", "u-1", "going");
      expect(await seatEscrowDrift(pool)).toEqual([]);

      // Both sides of the comparison are minor units, so writing the HOST'S
      // number into the mirror is exactly the corruption a half-converted fix
      // would leave behind, and it has to be caught.
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "UPDATE event_seat_charges SET amount = ? WHERE event_id = 'ev-1' AND user_id = 'u-1'",
        [PRICE],
      );
      const drift = await seatEscrowDrift(pool);
      expect(drift).toHaveLength(1);
      expect(drift[0]).toMatch(/seat escrow drift/);
      // Conservation still holds over the corrupted row, which is why this
      // check exists at all.
      expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
    });
  });
});
