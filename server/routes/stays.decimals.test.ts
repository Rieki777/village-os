/**
 * The stays module's ledger doors, driven over real HTTP, at TWO token scales.
 *
 * WHY THIS FILE EXISTS. Every stay-credit test in the tree runs against tokens
 * at `decimals: 0`, where a human number and a ledger unit are the same number.
 * At that scale a `toLedgerUnits` call and no call at all are byte-identical,
 * so a suite full of green assertions says nothing whatever about which unit
 * these routes speak. Three of them measured the posted amount with the same
 * unconverted quantity the code posted, and all three stayed green through the
 * whole defect.
 *
 * So this file asks the question at four decimals, which is where the platform
 * is going, and it asks it through `register()` rather than around it: the
 * price write, the activation snapshot, the nightly burn, the comp, the
 * adjustment, the manual purchase and the refund are the seven places a stay
 * credit is created or destroyed, and six of them take a number a person typed.
 *
 * THE SCALE SEAM is `UPDATE tokens SET decimals` plus `loadTokenRegistry`,
 * which is exactly what the flip migration will do. `registerToken` cannot do
 * it: it leaves `decimals` out of its upsert on purpose, so that re-registering
 * a token at boot can never rescale one that already holds a balance.
 *
 * NO PORT WINDOW. The server binds port 0 and reads the assigned port back, the
 * shape `scripts/check-e2e-ports.mjs` asks for, so this file can never collide
 * with an e2e suite however many run beside it.
 *
 * Every expected number is written as its decimals arithmetic (2 credits is
 * 2 x 10^4 = 20_000 units), never as a call to the conversion under test.
 *
 * The catalog is read through `GET /api/admin/stays` and not through
 * `GET /api/stays`, which is the door the admin price form uses anyway. The
 * guest route calls `stripeConfigured()`, and the secrets cache refuses to be
 * read before a boot has filled it, so reaching it would mean standing up the
 * secrets spine for a question about units.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  MINT_FAUCET,
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
} from "../lib/ledger";
import { loadModuleSettings } from "../lib/modules";
import { STAY_CREDIT, ensureStayToken } from "../lib/stays";
import { loadVariables } from "../lib/variables";
import { register } from "./stays";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[stays.decimals] TEST_DATABASE_URL not set — this suite SKIPPED.");
}

/** 10^4, written once so no assertion below has to restate the scale. */
const ONE = 10_000;

describe.skipIf(!configured)("stay credits across a decimals flip", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  const notices: Array<{ title?: string }> = [];
  const users = new Map<string, { id: string; name: string }>();

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => undefined) as any };
  };

  /** The scale seam. What the flip migration does, minus the rescale. */
  const setDecimals = async (slug: string, decimals: number) => {
    await pool.query("UPDATE tokens SET decimals = ? WHERE slug = ?", [decimals, slug]); // module-review-ok: the decimals seam this suite exists to exercise, against the S5 scratch schema
    await loadTokenRegistry(pool);
  };

  const storedPrice = async (accId: string, token: string, audience = "guest") => {
    const [rows] = await pool.query<any[]>(
      "SELECT amount_minor FROM accommodation_prices WHERE accommodation_id = ? AND token_type = ? AND audience = ?",
      [accId, token, audience],
    );
    return rows[0] == null ? null : Number(rows[0].amount_minor);
  };

  const legFor = async (key: string) => {
    const [rows] = await pool.query<any[]>(
      "SELECT amount, from_account, to_account FROM token_ledger WHERE idempotency_key = ?",
      [key],
    );
    return rows[0] ?? null;
  };

  const conserves = async () => {
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
  };

  /** A room with no posted price yet. Returns its id. */
  const room = async (id: string) => {
    await pool.query("INSERT INTO accommodations (id, name, capacity) VALUES (?,?,2)", [id, `Room ${id}`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return id;
  };

  const guest = async (id: string) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)",
      [id, id, `${id}@example.test`, "h"],
    );
    users.set(id, { id, name: id });
    return id;
  };

  /** Seed a member in MINOR units, which is the only unit the ledger has. */
  const fund = async (userId: string, units: number) => {
    const r = await postTransfer(pool, {
      from: MINT_FAUCET,
      to: memberAccount(userId),
      tokenType: STAY_CREDIT,
      amount: units,
      source: "stay_comp",
      idempotencyKey: `seed:${userId}:${units}:${Math.random().toString(36).slice(2, 8)}`,
    });
    expect(r.ok).toBe(true);
  };

  const requestedStay = async (id: string, userId: string, accId: string, daysAgo: number) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on, autopay) VALUES (?,?,?, 'requested', ?, 1)",
      [id, userId, accId, new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)],
    );
    return id;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadVariables(pool);
    await loadTokenRegistry(pool);
    await ensureStayToken(pool);
    // The module ships OFF, and every route in this file mounts behind
    // `requireModule('stays')`, so the suite has to open it the way an admin does.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO module_settings (module_id, lifecycle) VALUES ('stays','public') " +
        "ON DUPLICATE KEY UPDATE lifecycle = 'public'",
    );
    await loadModuleSettings(pool);

    const app = express();
    app.use(express.json());
    register(app, {
      adminActor: () => ({ id: "steward-1", name: "Steward" }),
      authedUser: async () => null,
      capabilityCtx: async () => ({ stageIndex: 0, stageIndexOf: () => 0, roleCapabilities: [] }),
      isAdmin: async () => true,
      members: { byId: async (id: string) => users.get(id) ?? null },
      notify: async (input: any) => {
        notices.push(input);
        return { ok: true };
      },
      notifyAdmins: async () => {},
      notifyDeps: { origin: () => base },
      overLimit: async () => false,
      questsRepo: { all: async () => [] },
      stayPostingHooks: () => ({ onLowBalance: async () => {}, onStopped: async () => {} }),
      getPool: () => pool,
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  /*
   * ── Half one: WHOLE UNITS. Every conversion below is the identity at zero
   * places, and the point of this half is that it STAYS the identity. A units
   * fix that moved a number at decimals 0 would be re-denominating any village
   * whose token has no scale.
   *
   * The scale is SET here and no longer inherited. This half used to be called
   * "at today's scale" and leaned on stay credits happening to carry 0, which
   * the 2026-09-04 scale ruling ended: a credit token is currency-like and
   * `0184` gives it two places. Leaning on a platform default made this half
   * silently change what it was asking the day that default moved, so it now
   * names the scale it is about.
   */
  describe("at whole units, nothing moves", () => {
    beforeAll(async () => {
      await setDecimals(STAY_CREDIT, 0);
    });

    it("stores a typed token price verbatim and hands it back verbatim", async () => {
      const accId = await room("acc-d0");
      const put = await api("PUT", `/api/admin/stays/accommodations/${accId}/prices`, {
        prices: [
          { tokenType: STAY_CREDIT, audience: "guest", amountMinor: 2 },
          { tokenType: "usd", audience: "guest", amountMinor: 5_000 },
        ],
      });
      expect(put.status).toBe(200);
      expect(await storedPrice(accId, STAY_CREDIT)).toBe(2);
      // usd was already cents on the way in and is untouched by any of this.
      expect(await storedPrice(accId, "usd")).toBe(5_000);

      const catalog = await api("GET", "/api/admin/stays");
      const row = catalog.json.accommodations.find((a: any) => a.id === accId);
      expect(row.prices[STAY_CREDIT].guest).toBe(2);
      expect(row.prices.usd.guest).toBe(5_000);
    });

    it("comps, adjusts and refunds the same numbers it always did", async () => {
      const accId = await room("acc-d0b");
      await api("PUT", `/api/admin/stays/accommodations/${accId}/prices`, {
        prices: [{ tokenType: STAY_CREDIT, audience: "guest", amountMinor: 2 }],
      });
      const uid = await guest("u-d0");

      expect((await api("POST", "/api/admin/stays/comp", { userId: uid, credits: 5 })).json.balance).toBe(5);
      expect((await api("POST", "/api/admin/stays/adjust", { userId: uid, credits: -2 })).status).toBe(200);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(3);

      const manual = await api("POST", "/api/admin/stays/purchases/manual", {
        userId: uid, accommodationId: accId, nights: 3, amountMinor: 0,
      });
      expect(manual.status).toBe(200);
      expect(manual.json.creditsGranted).toBe(6); // 3 nights x 2
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(9);

      expect((await api("POST", `/api/admin/stays/purchases/${manual.json.id}/refund`)).status).toBe(200);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(3);
      await conserves();
    });
  });

  /*
   * ── Half two: after the flip. Every number below is ten thousand times the
   * one above, and each case names the wrong answer it would read instead.
   */
  describe("at four decimals", () => {
    beforeAll(async () => {
      await setDecimals(STAY_CREDIT, 4);
    });

    it("stores a typed token price in MINOR units and shows it back whole", async () => {
      const accId = await room("acc-d4");
      const put = await api("PUT", `/api/admin/stays/accommodations/${accId}/prices`, {
        prices: [
          { tokenType: STAY_CREDIT, audience: "guest", amountMinor: 2 },
          { tokenType: "usd", audience: "guest", amountMinor: 5_000 },
        ],
      });
      expect(put.status).toBe(200);
      // 2 credits is 2 x 10^4 units. Unconverted this column would hold 2, and
      // a night would cost two ten-thousandths of a credit.
      expect(await storedPrice(accId, STAY_CREDIT)).toBe(2 * ONE);
      // usd is not a token and is not rescaled by a token's decimals.
      expect(await storedPrice(accId, "usd")).toBe(5_000);

      // The catalog is a reading surface and the admin price form posts what it
      // reads straight back, so a token price leaves in whole units. Shipping
      // the stored 20000 here would make every save multiply the room's rate.
      const catalog = await api("GET", "/api/admin/stays");
      const row = catalog.json.accommodations.find((a: any) => a.id === accId);
      expect(row.prices[STAY_CREDIT].guest).toBe(2);
      expect(row.prices.usd.guest).toBe(5_000);
    });

    it("snapshots the rate in minor, burns nights at that rate, and counts nights right", async () => {
      const accId = await room("acc-d4-night");
      await api("PUT", `/api/admin/stays/accommodations/${accId}/prices`, {
        prices: [{ tokenType: STAY_CREDIT, audience: "guest", amountMinor: 8 }],
      });
      const uid = await guest("u-d4-night");
      await fund(uid, 20 * ONE);
      const stayId = await requestedStay("stay-d4", uid, accId, 2);

      const activated = await api("POST", `/api/admin/stays/${stayId}/activate`, { audience: "guest" });
      expect(activated.status).toBe(200);
      expect(activated.json.rateSnapshotCredits).toBe(8 * ONE);
      expect(activated.json.rateSnapshotDecimals).toBe(4);
      // The guest is told the rate in the unit a person uses.
      expect(notices.some((n) => String(n.title).includes("active, 8 Stay Credits per night"))).toBe(true);

      const posted = await api("POST", "/api/admin/stays/post-nights");
      expect(posted.status).toBe(200);
      expect(posted.json.posted).toBe(2);
      expect(posted.json.stopped).toBe(0);
      // 200_000 - 2 x 80_000. An unconverted rate takes 16 units and leaves
      // 199_984, which buys 12,499 more nights on twenty credits.
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(4 * ONE);

      // The steward's desk reads the same unit as the money.
      const desk = await api("GET", "/api/admin/stays");
      const deskRow = desk.json.stays.find((s: any) => s.id === stayId);
      expect(deskRow.balance).toBe(4 * ONE);
      expect(deskRow.rateSnapshotCredits).toBe(8 * ONE);
      expect(deskRow.rateSnapshotDecimals).toBe(4);
      // 4 credits left will not buy an 8 credit night. The mixed comparison
      // this replaces reported 5,000.
      expect(deskRow.nightsRemaining).toBe(0);
      await conserves();
    });

    it("comps in the unit a steward typed", async () => {
      const uid = await guest("u-d4-comp");
      const comp = await api("POST", "/api/admin/stays/comp", { userId: uid, credits: 2, note: "Storm helper" });
      expect(comp.status).toBe(200);
      expect(comp.json.balance).toBe(2 * ONE);
      expect(comp.json.balanceDecimals).toBe(4);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(2 * ONE);
      await conserves();
    });

    it("adjusts in that unit BOTH ways, and still refuses the overdraft", async () => {
      const uid = await guest("u-d4-adj");
      // The positive leg, which nothing anywhere exercised.
      expect((await api("POST", "/api/admin/stays/adjust", { userId: uid, credits: 4 })).status).toBe(200);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(4 * ONE);
      // And the correction the route exists for. Unconverted this removes
      // 0.0003 credits and answers `{ success: true }` with no amount in it.
      expect((await api("POST", "/api/admin/stays/adjust", { userId: uid, credits: -3 })).status).toBe(200);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(1 * ONE);
      /*
       * THE REFUSAL THAT WAS HOLLOW. `-999` against a balance of one credit is
       * an overdraft in whole credits and in minor units alike, so the 409 is
       * about the same fact at both scales. Unconverted it compares 999 units
       * against 10_000 and the debit SUCCEEDS: the test that used to guard this
       * flipped from 409 to 200 with nobody touching it.
       */
      expect((await api("POST", "/api/admin/stays/adjust", { userId: uid, credits: -999 })).status).toBe(409);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(1 * ONE);
      await conserves();
    });

    it("grants a purchase in minor, records it in minor, and reverses that same number", async () => {
      const accId = await room("acc-d4-buy");
      await api("PUT", `/api/admin/stays/accommodations/${accId}/prices`, {
        prices: [{ tokenType: STAY_CREDIT, audience: "guest", amountMinor: 2 }],
      });
      const uid = await guest("u-d4-buy");

      const manual = await api("POST", "/api/admin/stays/purchases/manual", {
        userId: uid, accommodationId: accId, nights: 3, amountMinor: 0,
      });
      expect(manual.status).toBe(200);
      // The RECEIPT is whole credits: 3 nights x 2. The column behind it is not.
      expect(manual.json.creditsGranted).toBe(6);
      expect(manual.json.balanceDecimals).toBe(4);
      expect(manual.json.balance).toBe(6 * ONE);
      expect(notices.some((n) => String(n.title).startsWith("6 stay credit(s) added"))).toBe(true);

      /*
       * THE CONTRACT, stated as an assertion. `stay_purchases.credits_granted`
       * is MINOR, the same unit as the ledger leg it produced, and the same
       * unit the two clawbacks read it back in. Those three read one column
       * with no conversion on any of them, which is what makes an asymmetric
       * reversal impossible rather than merely untested.
       */
      const [[purchase]] = await pool.query<any[]>(
        "SELECT credits_granted, status FROM stay_purchases WHERE id = ?",
        [manual.json.id],
      );
      expect(Number(purchase.credits_granted)).toBe(6 * ONE);
      const mint = await legFor(`ord:${manual.json.id}:leg1`);
      expect(Number(mint.amount)).toBe(Number(purchase.credits_granted));
      expect(String(mint.to_account)).toBe(memberAccount(uid));

      const refund = await api("POST", `/api/admin/stays/purchases/${manual.json.id}/refund`);
      expect(refund.status).toBe(200);
      /*
       * The reversal leg carries the SAME KEY the Stripe chargeback handler
       * uses, so whichever of the two lands first is the one that prevails and
       * the other can never correct it. `payment_reversal` is on
       * ALLOW_NEGATIVE_SOURCES, so a wrong number here is refused by nothing.
       */
      const back = await legFor(`ord:${manual.json.id}:reversal-leg1`);
      expect(Number(back.amount)).toBe(Number(purchase.credits_granted));
      expect(String(back.from_account)).toBe(memberAccount(uid));
      expect(String(back.to_account)).toBe(MINT_FAUCET);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(0);

      // Pressing it again moves nothing: the row is no longer paid.
      expect((await api("POST", `/api/admin/stays/purchases/${manual.json.id}/refund`)).status).toBe(409);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(0);
      await conserves();
    });

    it("holds the grace floor at the platform's two nights, measured in minor", async () => {
      /*
       * The grace floor is the failure with no upper bound: it is built from
       * the snapshot rate and compared against a `token_balances` figure, so a
       * human rate against a minor balance makes the stop condition
       * unsatisfiable and the loop runs to the 366-night runaway guard.
       *
       * 10 credits held, 8 a night, `stay.grace_nights` at its platform default
       * of 2, five nights owed. The floor is -(2 x 80_000) = -160_000:
       *   night 1  100_000 -> 20_000
       *   night 2   20_000 -> -60_000
       *   night 3  -60_000 -> -140_000   (still inside the floor)
       *   night 4  -140_000 - 80_000 is past it  -> STOP
       */
      const accId = await room("acc-d4-grace");
      await api("PUT", `/api/admin/stays/accommodations/${accId}/prices`, {
        prices: [{ tokenType: STAY_CREDIT, audience: "guest", amountMinor: 8 }],
      });
      const uid = await guest("u-d4-grace");
      await fund(uid, 10 * ONE);
      const stayId = await requestedStay("stay-d4-grace", uid, accId, 5);
      expect((await api("POST", `/api/admin/stays/${stayId}/activate`, { audience: "guest" })).status).toBe(200);

      const posted = await api("POST", "/api/admin/stays/post-nights");
      expect(posted.json.posted).toBe(3);
      expect(posted.json.stopped).toBe(1);
      expect(await balanceOf(pool, memberAccount(uid), STAY_CREDIT)).toBe(-140_000);
      // Never auto-ended: the debt is a visible negative, not a hidden tab.
      const desk = await api("GET", "/api/admin/stays");
      expect(desk.json.stays.find((s: any) => s.id === stayId).status).toBe("active");
      await conserves();
    });
  });
});
