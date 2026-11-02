/**
 * A DEPARTING MEMBER'S RECURRING PAYMENT STOPS WITH THEM (adversarial round 3,
 * finding 5).
 *
 * A recurring product opens a Stripe subscription, and nothing in the village
 * ever cancelled one. A member who bought a monthly membership and then deleted
 * their account went on being charged every month, and each renewal paid the
 * product's tokens out of the treasury into the tombstone's account. The
 * village gives a member no door to cancel a subscription themselves, so once
 * the account was gone their only way out was a chargeback.
 *
 * Three things are proved here, against a real scratch schema and a fake
 * Stripe that answers through a mocked `fetch` (no network):
 *
 *   THE STEP. `product-subscriptions-after-tombstone` cancels exactly the
 *   leaver's live subscriptions, never a neighbour's, never refunds and never
 *   moves a token; a second run cancels nothing; a Stripe that fails, with
 *   the key present, stops the sweep loudly at that step and a resume
 *   finishes it; and a member with no subscription needs no Stripe at all.
 *
 *   NO KEY. A village that holds subscription ids and has since removed its
 *   Stripe key used to stop every such erasure at this step for good, which
 *   held `external-stores` behind it unasked. The step now asks every admin
 *   to cancel each one by hand in the Stripe dashboard, writes the count and
 *   the ids to the audit trail, and counts itself done.
 *
 *   THE NOTICE. `exitOpenState` names each live subscription as a notice the
 *   erasure acts on, never as a block, and the member reads the same sentence
 *   from `GET /api/profile/leaving-notices` before they confirm.
 *
 * The renewal gate that refuses to pay a tombstone lives inside
 * `settleProductPurchase` in server/index.ts, so it is proved where it runs:
 * the S69 subscription block of server/loop.e2e.test.ts.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { anonymizeMember, resumeErasure, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { blockingStates, cancelExit, createExit, exitById, exitOpenState } from "./exit";
import { register as registerProfileRoutes } from "../routes/profile";
import { loadSecrets } from "./secrets";
import { BUYER_HAS_LEFT, refusedChargeAdvice } from "./payments";
import { subscriptionsState } from "./exit";
import { FORMER_MEMBER_HOLD, keepsAsFormerMember, resolveExit } from "./exitResolve";
import { insertCashOwedRow } from "../repos/cashOwed";
import { loadTokenRegistry, memberAccount, MINT_FAUCET, postTransfer } from "./ledger";
import {
  confirmOwedCancelsByHand,
  finishOwedCancels,
  finishOwedCancelsJob,
  owedCancels,
  owedCancelsSummary,
  settleLeaversSubscription,
} from "./owedCancels";
import { register as registerErasureQueueRoutes } from "../routes/erasureQueue";

const configured = testDbConfigured();
const STEP = "product-subscriptions-after-tombstone";
// A fixture key for the fake Stripe below. Nothing here reaches the network.
const KEY = "sk_test_erasure_subscriptions"; // module-review-ok: a throwaway fixture value the mocked fetch checks, never a real credential

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

/** The erasure's singletons with the real users repository. */
function deps(extra: Partial<ErasureDeps> = {}): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: (u: any) => void, opts?: { erasure?: boolean }) => real.update(id, fn, opts) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn: () => Promise<any>) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
    ...extra,
  } as ErasureDeps;
}

/** The admins' alarm when Stripe is not connected, word for word. */
const byHandTitle = (n: number) =>
  `Cancel ${n} recurring payment(s) by hand in the Stripe dashboard. A departed member's erasure could not cancel them, ` +
  "because Stripe is not connected, and Stripe may keep charging them.";
const byHandBody = (ids: string[]) =>
  `Subscription ids to find in the Stripe dashboard: ${ids.join(", ")}. ` +
  "Cancel each one still active, and refund any period charged after the account was deleted.";
const byHandKey = (userId: string) => `erasure-subscriptions-by-hand:${userId}`;

/**
 * The last sentence of the admins' "charged but NOT delivered" alarm for a
 * buyer who has left, word for word, one for each thing the erasure does with
 * the subscription: cancel it in Stripe, or hand it to the admins.
 */
const CANCELLED_ADVICE = "The subscription is now cancelled in Stripe; refund this period there.";
const ENDED_ADVICE = "The subscription had already ended in Stripe; refund this period there.";
const FAILED_ADVICE = "Stripe did not cancel it: cancel the subscription in the Stripe dashboard and refund this period.";
const BY_HAND_ADVICE = "Stripe is not connected: cancel the subscription in the Stripe dashboard and refund this period.";

/**
 * The alarm as `settleProductPurchase` composes it, for a renewal refused
 * because the buyer has left, with ids the length Stripe and the village
 * really mint: a `pp-<ms>-<6>` purchase and an `inv_in_...` period.
 */
const refusedAlarm = (productName: string, advice: string) =>
  `Renewal charged but NOT delivered: ${productName} (pp-1761300000000-abc123, inv_in_1PQrStUvWxYz0123456789ab), ${BUYER_HAS_LEFT}. ` + advice;

/** Every by-hand alarm about one leaver, on anybody's bell. */
const byHandBell = (userId: string) =>
  q("SELECT user_id, type, title, body, link, actor_user_id FROM notifications WHERE dedupe_key LIKE ? ORDER BY user_id", [`${byHandKey(userId)}:%`]);

/** The audit lines the step wrote about one leaver. */
const byHandAudit = (userId: string) =>
  q("SELECT text, audience FROM health_events WHERE kind = 'audit' AND entity_ref = ? AND text LIKE 'member:subscriptions-cancel-by-hand:%'", [userId]);

interface StripeCall { method: string; path: string; auth: string | null }

/**
 * A fake Stripe holding subscriptions by id, answering the two calls the step
 * makes the way the real API does: the subscription object on success, and a
 * 404 `resource_missing` for an id it does not hold. Anything else the code
 * asks for (a refund, a customer) is answered 400, so the call shows up in
 * `calls` and in the assertion that names every path.
 */
function fakeStripe(subs: Record<string, string>) {
  const calls: StripeCall[] = [];
  const failures: number[] = [];
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const impl = async (input: any, init?: any): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = String(init?.method ?? "GET").toUpperCase();
    const h = init?.headers ?? {};
    const auth = h instanceof Headers ? h.get("Authorization") : (h.Authorization ?? h.authorization ?? null);
    calls.push({ method, path: url.pathname, auth });
    if (url.host !== "api.stripe.com") throw new Error(`the test reached a host it never should: ${url.host}`);
    const status = failures.shift();
    if (status) return answer(status, { error: { type: "api_error", message: "Stripe could not be reached just now" } });
    const m = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/);
    if (!m) return answer(400, { error: { type: "invalid_request_error", message: `the step has no business calling ${url.pathname}` } });
    const id = decodeURIComponent(m[1]);
    if (!(id in subs)) {
      return answer(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such subscription: '${id}'` } });
    }
    if (method === "DELETE") {
      if (subs[id] === "canceled") {
        return answer(400, { error: { type: "invalid_request_error", message: "This subscription has already been canceled." } });
      }
      subs[id] = "canceled";
    }
    return answer(200, { id, object: "subscription", status: subs[id] });
  };
  return {
    subs,
    calls,
    deletes: () => calls.filter((c) => c.method === "DELETE").map((c) => decodeURIComponent(c.path.split("/").pop()!)),
    /** The next call answers with this HTTP status and an error body. */
    failNext: (status: number) => failures.push(status),
    /** The next read answers as normal and the cancel after it answers 500. */
    failCancel: () => failures.push(0, 500),
    impl,
  };
}

async function member(id: string, name: string, role = "member"): Promise<any> {
  await usersRepo(pool).add({ id, name, email: `${id}@example.test`, passwordHash: "x", paths: [], role } as any);
  return usersRepo(pool).byId(id);
}

async function product(id: string, name: string, recurring: "none" | "month" | "year"): Promise<void> {
  await q(
    "INSERT INTO payment_products (id, name, kind, amount_minor, recurring, active, created_by) VALUES (?,?,?,?,?,1,'founder')",
    [id, name, recurring === "none" ? "fee" : "membership", 500, recurring],
  );
}

let receipt = 7000;
async function purchase(
  id: string,
  userId: string,
  productId: string,
  opts: { status: "pending" | "paid" | "reversed" | "cancelled"; sub?: string | null; at: string },
): Promise<void> {
  await q(
    "INSERT INTO product_purchases (id, product_id, user_id, amount_minor, receipt_no, status, stripe_subscription_id, periods_paid, created_at) " +
      "VALUES (?,?,?,500,?,?,?,?,?)",
    [id, productId, userId, receipt++, opts.status, opts.sub ?? null, opts.status === "paid" || opts.status === "reversed" ? 1 : 0, opts.at],
  );
}

const purchaseRows = (userId: string) =>
  q("SELECT id, status, stripe_subscription_id AS sub, periods_paid FROM product_purchases WHERE user_id = ? ORDER BY id", [userId]);

describe.skipIf(!configured)("a departing member's recurring payments", () => {
  let stripe: ReturnType<typeof fakeStripe>;
  const savedKey = process.env.STRIPE_SECRET_KEY;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-subs-"));
    // Nothing stored in this schema, so the key resolves from the environment, as on an env-only deployment.
    await loadSecrets(pool);
    await product("prod-month", "Monthly membership", "month");
    await product("prod-year", "Garden share", "year");
    await product("prod-once", "Application fee", "none");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
  });

  beforeEach(() => {
    clearMemberDrivers();
    process.env.STRIPE_SECRET_KEY = KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Fake Stripe in place of `fetch` for this case. */
  function useStripe(subs: Record<string, string>) {
    stripe = fakeStripe(subs);
    vi.spyOn(globalThis, "fetch").mockImplementation(stripe.impl as typeof fetch);
    return stripe;
  }

  it("cancels exactly the leaver's live subscriptions, refunds nothing and moves no token", async () => {
    const wren = await member("subs-wren", "Wren Halloway");
    const ash = await member("subs-ash", "Ash Moreno");
    // Wren's purchases, one of each shape a subscription id can sit on.
    await purchase("pp-w1", wren.id, "prod-month", { status: "paid", sub: "sub_wren_month", at: "2026-01-01 10:00:00" });
    // A disputed only month: the purchase reads reversed and the subscription still runs.
    await purchase("pp-w2", wren.id, "prod-year", { status: "reversed", sub: "sub_wren_disputed", at: "2026-01-02 10:00:00" });
    // Already cancelled in Stripe's own dashboard, and one Stripe no longer has at all.
    await purchase("pp-w3", wren.id, "prod-month", { status: "paid", sub: "sub_wren_ended", at: "2026-01-03 10:00:00" });
    await purchase("pp-w4", wren.id, "prod-month", { status: "paid", sub: "sub_wren_gone", at: "2026-01-04 10:00:00" });
    // No subscription: a one-time fee, and a checkout that never completed.
    await purchase("pp-w5", wren.id, "prod-once", { status: "paid", at: "2026-01-05 10:00:00" });
    await purchase("pp-w6", wren.id, "prod-month", { status: "pending", at: "2026-01-06 10:00:00" });
    // Ash stays, and so does Ash's subscription.
    await purchase("pp-a1", ash.id, "prod-month", { status: "paid", sub: "sub_ash_month", at: "2026-01-01 11:00:00" });
    const s = useStripe({ sub_wren_month: "active", sub_wren_disputed: "past_due", sub_wren_ended: "canceled", sub_ash_month: "active" });
    const rowsBefore = await purchaseRows(wren.id);
    const ledgerBefore = (await q("SELECT COUNT(*) AS n FROM token_ledger"))[0].n;

    await anonymizeMember(pool, wren, "admin-1", deps());

    const record = await erasureRecord(pool, wren.id);
    expect(record?.finishedAt, "the sweep finished").not.toBeNull();
    expect(record?.stepsDone).toContain(STEP);
    // The two that could still charge are cancelled, in purchase order, and nothing else.
    expect(s.deletes()).toEqual(["sub_wren_month", "sub_wren_disputed"]);
    expect(s.subs).toEqual({ sub_wren_month: "canceled", sub_wren_disputed: "canceled", sub_wren_ended: "canceled", sub_ash_month: "active" });
    // Every call was a subscription read or cancel, under the village's key. No refund, no customer.
    expect(s.calls.every((c) => /^\/v1\/subscriptions\/sub_wren_/.test(c.path))).toBe(true);
    expect(s.calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    // The orders are the village's record of money that came in, and they stay as they were.
    expect(await purchaseRows(wren.id)).toEqual(rowsBefore);
    expect((await q("SELECT COUNT(*) AS n FROM token_ledger"))[0].n).toBe(ledgerBefore);
  });

  it("cancels nothing on a second run: a sweep run again over the same tombstone is a no-op", async () => {
    const wren = await member("subs-rerun", "Wren Again");
    await purchase("pp-r1", wren.id, "prod-month", { status: "paid", sub: "sub_rerun", at: "2026-02-01 10:00:00" });
    const s = useStripe({ sub_rerun: "active" });
    await anonymizeMember(pool, wren, "admin-1", deps());
    expect(s.deletes()).toEqual(["sub_rerun"]);
    const rows = await purchaseRows(wren.id);

    // An erasure asked for a second time runs every step again, this one included.
    s.calls.length = 0;
    await anonymizeMember(pool, await usersRepo(pool).byId(wren.id), "admin-1", deps());
    expect(s.deletes(), "a cancelled subscription is read, never cancelled twice").toEqual([]);
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v1/subscriptions/sub_rerun"]);
    expect(await purchaseRows(wren.id)).toEqual(rows);
    expect((await erasureRecord(pool, wren.id))?.finishedAt).not.toBeNull();

    // And a resume of a finished record has nothing left to run.
    s.calls.length = 0;
    expect((await resumeErasure(pool, wren.id, deps())).ran).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  describe("a village with no Stripe key", () => {
    let ada: any;
    let fen: any;
    beforeAll(async () => {
      // Two people who administer the village, one of each tier the admin alarm reaches.
      ada = await member("subs-admin-ada", "Ada Steward", "admin");
      fen = await member("subs-admin-fen", "Fen Founder", "founder");
    });

    it("asks every admin to cancel each one by hand, records it, and counts the step done", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const wren = await member("subs-nokey", "Wren Unconnected");
      await purchase("pp-n1", wren.id, "prod-month", { status: "paid", sub: "sub_nokey_month", at: "2026-03-01 10:00:00" });
      await purchase("pp-n2", wren.id, "prod-year", { status: "reversed", sub: "sub_nokey_year", at: "2026-03-02 10:00:00" });
      const s = useStripe({ sub_nokey_month: "active", sub_nokey_year: "active" });

      await anonymizeMember(pool, wren, "admin-1", deps());

      // The sweep is no longer held open at this step, and the outside stores behind it were asked.
      const record = await erasureRecord(pool, wren.id);
      expect(record?.finishedAt, "the sweep finished").not.toBeNull();
      expect(record?.failedStep).toBeNull();
      expect(record?.stepsDone).toEqual(expect.arrayContaining([STEP, "external-stores"]));
      expect(s.calls, "no key, so nothing was sent anywhere").toEqual([]);

      // Every admin and founder hears once: the count, every id, and where to cancel. The leaver is not named.
      const bell = await byHandBell(wren.id);
      expect(bell).toEqual([ada, fen].map((a) => ({
        user_id: a.id, type: "payments_alert", title: byHandTitle(2), body: byHandBody(["sub_nokey_month", "sub_nokey_year"]),
        link: "/admin", actor_user_id: null,
      })));
      expect(bell.every((n) => !`${n.title} ${n.body}`.includes("Wren"))).toBe(true);
      // The step's result is on the audit trail, for the admins only.
      expect(await byHandAudit(wren.id)).toEqual([
        { text: "member:subscriptions-cancel-by-hand:2:sub_nokey_month,sub_nokey_year", audience: "admin" },
      ]);

      // An erasure asked for again with the key still missing tells nobody twice.
      await anonymizeMember(pool, await usersRepo(pool).byId(wren.id), "admin-1", deps());
      expect((await byHandBell(wren.id)).length).toBe(2);
      expect((await erasureRecord(pool, wren.id))?.finishedAt).not.toBeNull();
      expect(s.calls).toEqual([]);
    });

    it("rings through the host's own notice spine when the host hands one over", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const wren = await member("subs-nokey-host", "Wren Hosted");
      await purchase("pp-h1", wren.id, "prod-month", { status: "paid", sub: "sub_hosted", at: "2026-03-03 10:00:00" });
      useStripe({ sub_hosted: "active" });
      const sent: any[] = [];

      await anonymizeMember(pool, wren, "admin-1", deps({ notify: async (input) => { sent.push(input); } }));

      expect(sent.filter((n) => String(n.dedupeKey).startsWith(byHandKey(wren.id)))).toEqual([ada, fen].map((a) => ({
        userId: a.id, type: "payments_alert", title: byHandTitle(1), body: byHandBody(["sub_hosted"]),
        link: "/admin", dedupeKey: `${byHandKey(wren.id)}:${a.id}`,
      })));
      expect(await byHandBell(wren.id), "the host's spine wrote it, so the sweep wrote no bell row of its own").toEqual([]);
      expect((await erasureRecord(pool, wren.id))?.finishedAt).not.toBeNull();
    });

    it("tells the admins of a charge after the delete what became of the subscription, with the key and without", async () => {
      // No key: the erasure hands the cancel to the admins, and the
      // subscription is still live in Stripe, so a renewal can land. The alarm
      // for that renewal used to say the erasure cancels it in Stripe.
      delete process.env.STRIPE_SECRET_KEY;
      const wren = await member("subs-alarm-nokey", "Wren Alarmed");
      await purchase("pp-al1", wren.id, "prod-month", { status: "paid", sub: "sub_alarm_nokey", at: "2026-04-02 10:00:00" });
      const s = useStripe({ sub_alarm_nokey: "active" });
      await anonymizeMember(pool, wren, "admin-1", deps());
      expect(await byHandAudit(wren.id), "the erasure handed this one to the admins").toEqual([
        { text: "member:subscriptions-cancel-by-hand:1:sub_alarm_nokey", audience: "admin" },
      ]);
      expect(s.subs.sub_alarm_nokey, "nothing cancelled it, so a renewal can still land").toBe("active");
      expect(refusedChargeAdvice("by-hand-no-key", BUYER_HAS_LEFT)).toBe(BY_HAND_ADVICE);

      // The key: the erasure cancels it in Stripe, and the alarm says so.
      process.env.STRIPE_SECRET_KEY = KEY;
      const ash = await member("subs-alarm-key", "Ash Alarmed");
      await purchase("pp-al2", ash.id, "prod-month", { status: "paid", sub: "sub_alarm_key", at: "2026-04-03 10:00:00" });
      const k = useStripe({ sub_alarm_key: "active" });
      await anonymizeMember(pool, ash, "admin-1", deps());
      expect(k.deletes()).toEqual(["sub_alarm_key"]);
      expect(refusedChargeAdvice("cancelled", BUYER_HAS_LEFT)).toBe(CANCELLED_ADVICE);

      // Every other refusal reads as it always did, key or no key.
      for (const key of [KEY, undefined]) {
        if (key) process.env.STRIPE_SECRET_KEY = key;
        else delete process.env.STRIPE_SECRET_KEY;
        expect(refusedChargeAdvice("none", BUYER_HAS_LEFT)).toBe("Refund this payment.");
        expect(refusedChargeAdvice("none", "the product is no longer active")).toBe("Refund this payment.");
        expect(refusedChargeAdvice("kept", "the product is no longer active")).toBe("Cancel the subscription in Stripe and refund this period.");
        expect(refusedChargeAdvice("kept", "the buyer's purchasing is suspended")).toBe("Cancel the subscription in Stripe and refund this period.");
      }

      // The whole alarm is the notice title, which the bell cuts at 255
      // characters, so the advice must survive a product name of 30 either way.
      const name = "Garden share and monthly meals";
      expect(name.length).toBe(30);
      for (const advice of [CANCELLED_ADVICE, ENDED_ADVICE, FAILED_ADVICE, BY_HAND_ADVICE]) {
        expect(refusedAlarm(name, advice).length, advice).toBeLessThanOrEqual(255);
      }
    });

    it("stops loudly when Stripe fails with the key present, rings nobody, and the retry cancels it", async () => {
      const wren = await member("subs-down", "Wren Unlucky");
      await purchase("pp-d1", wren.id, "prod-month", { status: "paid", sub: "sub_down", at: "2026-04-01 10:00:00" });
      const s = useStripe({ sub_down: "active" });
      s.failNext(500);

      await expect(anonymizeMember(pool, wren, "admin-1", deps())).rejects.toThrow(/Stripe could not read subscription sub_down/);
      const stopped = await erasureRecord(pool, wren.id);
      expect(stopped?.failedStep).toBe(STEP);
      expect(stopped?.finishedAt).toBeNull();
      // Past the tombstone: the account is closed, and the hourly job resumes a sweep stopped here.
      expect(stopped?.stepsDone).toContain("tombstone");
      expect(s.subs.sub_down).toBe("active");
      expect(await byHandBell(wren.id), "a failing Stripe is retried, never handed to a person").toEqual([]);
      expect(await byHandAudit(wren.id)).toEqual([]);

      // The read answers and the cancel fails: still loud, still open.
      s.failCancel();
      const again = await resumeErasure(pool, wren.id, deps()).then(() => null, (err: Error) => err);
      expect(again?.message).toMatch(/Stripe could not cancel subscription sub_down/);
      expect((await erasureRecord(pool, wren.id))?.failedStep).toBe(STEP);

      const out = await resumeErasure(pool, wren.id, deps());
      expect(out.finished).toBe(true);
      expect(out.ran[0], "the resume starts at the step that stopped").toBe(STEP);
      expect(s.subs.sub_down).toBe("canceled");
      expect(await byHandBell(wren.id)).toEqual([]);
    });
  });

  it("asks nothing of Stripe for a member with no subscription, even where Stripe was never connected", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const wren = await member("subs-none", "Wren Plain");
    await purchase("pp-o1", wren.id, "prod-once", { status: "paid", at: "2026-05-01 10:00:00" });
    const s = useStripe({});

    await anonymizeMember(pool, wren, "admin-1", deps());

    expect((await erasureRecord(pool, wren.id))?.finishedAt).not.toBeNull();
    expect(s.calls).toEqual([]);
  });

  describe("the notice before the delete", () => {
    it("names each live subscription on the exit desk as a notice, never a block", async () => {
      const kit = await member("subs-desk", "Kit Arden");
      await purchase("pp-k1", kit.id, "prod-month", { status: "paid", sub: "sub_kit_month", at: "2026-06-01 10:00:00" });
      await purchase("pp-k2", kit.id, "prod-year", { status: "reversed", sub: "sub_kit_year", at: "2026-06-02 10:00:00" });
      await purchase("pp-k3", kit.id, "prod-once", { status: "paid", at: "2026-06-03 10:00:00" });

      const states = await exitOpenState(pool, kit.id, [], { formerMember: FORMER_MEMBER_HOLD });
      const subs = states.find((st) => st.domain === "subscriptions");
      expect(subs).toEqual({
        domain: "subscriptions",
        count: 2,
        description:
          "2 recurring payment(s) still renewing through Stripe: Monthly membership (every month), Garden share (every year). " +
          "Deleting the account cancels each one in Stripe, and nothing already paid is refunded",
        blocking: false,
      });
      // Nothing in the app lets a member cancel one, so a block would trap them.
      expect(blockingStates(states).map((st) => st.domain)).not.toContain("subscriptions");

      // With no Stripe key the deletion cannot cancel them, and the notice says who will.
      delete process.env.STRIPE_SECRET_KEY;
      expect((await exitOpenState(pool, kit.id, [], { formerMember: FORMER_MEMBER_HOLD })).find((st) => st.domain === "subscriptions")).toEqual({
        domain: "subscriptions",
        count: 2,
        description:
          "2 recurring payment(s) still renewing through Stripe: Monthly membership (every month), Garden share (every year). " +
          "Stripe is not connected to this village, so deleting the account asks the admins to cancel each one by hand in Stripe, " +
          "and nothing already paid is refunded",
        blocking: false,
      });
      process.env.STRIPE_SECRET_KEY = KEY;

      const none = await member("subs-desk-none", "Lee Plain");
      expect((await exitOpenState(pool, none.id, [], { formerMember: FORMER_MEMBER_HOLD })).find((st) => st.domain === "subscriptions")).toEqual({
        domain: "subscriptions", count: 0, description: "no recurring payments", blocking: false,
      });
    });

    it("tells the member the same sentence before they confirm, and nobody else's", async () => {
      const kit = await member("subs-self", "Kit Self");
      await purchase("pp-s1", kit.id, "prod-month", { status: "paid", sub: "sub_self", at: "2026-07-01 10:00:00" });
      const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
      const app: any = { get: (p: string, h: any) => handlers.set(`GET ${p}`, h), put: () => undefined, post: () => undefined };
      let signedIn: any = kit;
      registerProfileRoutes(app, {
        authedUser: async () => signedIn,
        members: usersRepo(pool) as any,
        publicUser: (u: any) => u,
        getPool: () => pool,
      } as any);
      const call = async () => {
        const out: { status: number; body: any } = { status: 200, body: undefined };
        const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
        await handlers.get("GET /api/profile/leaving-notices")!({ headers: {} }, res);
        return out;
      };

      const mine = await call();
      expect(mine.status).toBe(200);
      const desk = (await exitOpenState(pool, kit.id, [], { formerMember: FORMER_MEMBER_HOLD })).find((st) => st.domain === "subscriptions");
      expect(mine.body).toEqual({ notices: [desk] });

      signedIn = await member("subs-self-other", "Other Plain");
      expect((await call()).body, "a member with none is shown nothing").toEqual({ notices: [] });

      signedIn = null;
      expect((await call()).status).toBe(401);
    });
  });
  /** Every obligation row about one leaver, oldest first: what /review derives what is owed from. */
  const cancelRows = (userId: string) =>
    q(
      "SELECT text, audience, actor_user_id FROM health_events WHERE kind = 'audit' AND entity_ref = ? " +
        "AND (text LIKE 'member:subscriptions-cancel-by-hand:%' OR text LIKE 'member:subscriptions-cancelled:%') ORDER BY at, id",
      [userId],
    );
  const owedOf = async (userId: string) => (await owedCancels(pool)).find((o) => o.userId === userId)?.subscriptionIds ?? [];

  describe("a recurring checkout that completes after the account was erased (round 4, finding 2)", () => {
    it("is cancelled in Stripe by the refused charge, and a redelivery only reads it", async () => {
      const wren = await member("subs-late", "Wren Late");
      // Opened before the delete: pending, and Stripe has not made the subscription yet.
      await purchase("pp-late1", wren.id, "prod-month", { status: "pending", at: "2026-08-01 10:00:00" });
      const s = useStripe({});
      await anonymizeMember(pool, wren, wren.id, deps());
      expect((await erasureRecord(pool, wren.id))?.stepsDone).toContain(STEP);
      expect(s.calls, "the step found no subscription to cancel").toEqual([]);

      // They pay after the delete. Stripe makes sub_late and the checkout completes.
      s.subs.sub_late = "active";
      const first = await settleLeaversSubscription(pool, { userId: wren.id, subscriptionId: "sub_late", refusal: BUYER_HAS_LEFT });
      expect(first).toBe("cancelled");
      expect(s.deletes()).toEqual(["sub_late"]);
      expect(s.subs.sub_late).toBe("canceled");
      expect(refusedChargeAdvice(first, BUYER_HAS_LEFT)).toBe(CANCELLED_ADVICE);
      expect(await cancelRows(wren.id)).toEqual([{ text: "member:subscriptions-cancelled:1:sub_late", audience: "admin", actor_user_id: null }]);

      // The first period's other event (invoice.paid) lands too: a read, no second cancel.
      s.calls.length = 0;
      expect(await settleLeaversSubscription(pool, { userId: wren.id, subscriptionId: "sub_late", refusal: BUYER_HAS_LEFT })).toBe("ended");
      expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v1/subscriptions/sub_late"]);
      expect(await owedOf(wren.id)).toEqual([]);
    });

    it("never throws for a failing Stripe: the charge hands the cancel to a person, and the next charge asks again", async () => {
      const wren = await member("subs-late-down", "Wren Late Down");
      await anonymizeMember(pool, wren, wren.id, deps());
      const s = useStripe({ sub_late_down: "active" });
      s.failNext(500);
      const out = await settleLeaversSubscription(pool, { userId: wren.id, subscriptionId: "sub_late_down", refusal: BUYER_HAS_LEFT });
      expect(out).toBe("by-hand-failed");
      expect(refusedChargeAdvice(out, BUYER_HAS_LEFT)).toBe(FAILED_ADVICE);
      expect(await owedOf(wren.id)).toEqual(["sub_late_down"]);

      // Next period: Stripe answers, the cancel lands, and nothing is owed.
      expect(await settleLeaversSubscription(pool, { userId: wren.id, subscriptionId: "sub_late_down", refusal: BUYER_HAS_LEFT })).toBe("cancelled");
      expect(s.subs.sub_late_down).toBe("canceled");
      expect(await owedOf(wren.id)).toEqual([]);
    });

    it("with no key, says so and leaves the cancel owed; any other refusal leaves the subscription alone", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const wren = await member("subs-late-nokey", "Wren Late Unconnected");
      await anonymizeMember(pool, wren, wren.id, deps());
      const s = useStripe({ sub_late_nokey: "active" });
      const out = await settleLeaversSubscription(pool, { userId: wren.id, subscriptionId: "sub_late_nokey", refusal: BUYER_HAS_LEFT });
      expect(out).toBe("by-hand-no-key");
      expect(refusedChargeAdvice(out, BUYER_HAS_LEFT)).toBe(BY_HAND_ADVICE);
      expect(await owedOf(wren.id)).toEqual(["sub_late_nokey"]);
      expect(s.calls).toEqual([]);

      process.env.STRIPE_SECRET_KEY = KEY;
      const ash = await member("subs-late-other", "Ash Suspended");
      expect(await settleLeaversSubscription(pool, { userId: ash.id, subscriptionId: "sub_other", refusal: "the buyer's purchasing is suspended" })).toBe("kept");
      expect(await settleLeaversSubscription(pool, { userId: wren.id, subscriptionId: null, refusal: BUYER_HAS_LEFT })).toBe("none");
      expect(s.calls).toEqual([]);
    });
  });

  describe("the cancels a no-key erasure owes, derived from the audit trail", () => {
    /** The erasure queue's routes, on a fake app, as a steward holding intake.moderate. */
    function queue(actor: any) {
      const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
      const app: any = {
        get: (p: string, h: any) => handlers.set(`GET ${p}`, h),
        post: (p: string, h: any) => handlers.set(`POST ${p}`, h),
      };
      registerErasureQueueRoutes(app, {
        guardCapability: (async () => true) as any,
        getPool: () => pool,
        erasureDeps: deps(),
        authedUser: async () => actor,
      });
      return async (key: string, body: unknown = {}) => {
        const out: { status: number; body: any } = { status: 200, body: undefined };
        const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
        await handlers.get(key)!({ headers: {}, body }, res);
        return out;
      };
    }

    /** Settle every other case's owed cancels, so a case reads only its own. */
    async function settleOthers(except: string) {
      const asOf = (await owedCancelsSummary(pool)).asOf;
      if (asOf) await confirmOwedCancelsByHand(pool, "subs-admin-ada", asOf);
      expect(await owedCancels(pool), `nothing owed before ${except} begins`).toEqual([]);
    }

    it("counts a no-key erasure as owed, and a re-erasure and its public-row delete leave the row", async () => {
      await settleOthers("subs-owed");
      delete process.env.STRIPE_SECRET_KEY;
      const wren = await member("subs-owed", "Wren Owed");
      await purchase("pp-ow1", wren.id, "prod-month", { status: "paid", sub: "sub_owed", at: "2026-09-01 10:00:00" });
      useStripe({ sub_owed: "active" });
      // A self-delete: the leaver is the by-hand row's actor, which is exactly
      // the row shape the erasure's public-row DELETE matches on actor.
      await anonymizeMember(pool, wren, wren.id, deps());
      expect(await cancelRows(wren.id)).toEqual([{ text: "member:subscriptions-cancel-by-hand:1:sub_owed", audience: "admin", actor_user_id: wren.id }]);
      expect(await owedOf(wren.id)).toEqual(["sub_owed"]);
      expect((await erasureRecord(pool, wren.id))?.finishedAt, "the record still reads finished").not.toBeNull();

      // A second erasure runs every step again, `public-health-events` among
      // them, BEFORE this step writes its own row. The first row is still
      // there: audience admin is what keeps it. The re-run's row would hide a
      // loss for an id `liveSubscriptionsOf` still finds, so the first row is
      // read by its id, and a late charge's row (actor null) has no re-run at all.
      const [firstRow] = await q("SELECT id FROM health_events WHERE entity_ref = ? AND text LIKE 'member:subscriptions-cancel-by-hand:%'", [wren.id]);
      await anonymizeMember(pool, await usersRepo(pool).byId(wren.id), wren.id, deps());
      expect(await q("SELECT text, audience, actor_user_id FROM health_events WHERE id = ?", [firstRow.id]), "audience admin is what keeps it").toEqual([
        { text: "member:subscriptions-cancel-by-hand:1:sub_owed", audience: "admin", actor_user_id: wren.id },
      ]);
      expect((await cancelRows(wren.id)).length, "the re-run's own hand-off joins it").toBe(2);
      expect(await owedOf(wren.id)).toEqual(["sub_owed"]);

      // /review counts it, naming nobody, and Finish with no key leaves it owed.
      const call = queue({ id: "subs-admin-ada" });
      const read = await call("GET /api/review/erasure");
      expect(read.status).toBe(200);
      expect(read.body.subscriptions).toMatchObject({ count: 1 });
      expect(JSON.stringify(read.body)).not.toContain(wren.id);
      expect(JSON.stringify(read.body)).not.toContain("sub_owed");
      const pressed = await call("POST /api/review/erasure/retry");
      expect(pressed.body.cancels).toEqual({ owed: 1, cleared: 0, connected: false });
      expect(await finishOwedCancelsJob(pool, Date.now() + 60_000)).toBeNull();
      expect(await owedOf(wren.id)).toEqual(["sub_owed"]);
    });

    it("with the key connected, Finish cancels what is owed and clears it", async () => {
      await settleOthers("subs-owed-finish");
      delete process.env.STRIPE_SECRET_KEY;
      const wren = await member("subs-owed-finish", "Wren Finished");
      await purchase("pp-of1", wren.id, "prod-month", { status: "paid", sub: "sub_owed_finish", at: "2026-09-02 10:00:00" });
      await anonymizeMember(pool, wren, "admin-1", deps());
      expect(await owedOf(wren.id)).toEqual(["sub_owed_finish"]);

      process.env.STRIPE_SECRET_KEY = KEY;
      const s = useStripe({ sub_owed_finish: "active" });
      const call = queue({ id: "subs-admin-ada" });
      const pressed = await call("POST /api/review/erasure/retry");
      expect(pressed.status).toBe(200);
      expect(pressed.body.cancels).toEqual({ owed: 1, cleared: 1, connected: true });
      expect(s.subs.sub_owed_finish).toBe("canceled");
      expect(await owedOf(wren.id)).toEqual([]);
      expect((await cancelRows(wren.id)).at(-1)).toEqual({
        text: "member:subscriptions-cancelled:1:sub_owed_finish", audience: "admin", actor_user_id: "subs-admin-ada",
      });
      expect(pressed.body.subscriptions.count).toBe(0);
    });

    it("the hourly job does the same with nobody pressing, and a Stripe failure stays owed", async () => {
      await settleOthers("subs-owed-hourly");
      delete process.env.STRIPE_SECRET_KEY;
      const wren = await member("subs-owed-hourly", "Wren Hourly");
      await purchase("pp-oh1", wren.id, "prod-month", { status: "paid", sub: "sub_owed_hourly", at: "2026-09-03 10:00:00" });
      await anonymizeMember(pool, wren, "admin-1", deps());

      process.env.STRIPE_SECRET_KEY = KEY;
      const s = useStripe({ sub_owed_hourly: "active" });
      s.failNext(500);
      expect(await finishOwedCancelsJob(pool, Date.now() + 60_000)).toBe("cancelled the owed subscriptions of 0 of 1 departed members");
      expect(await owedOf(wren.id), "a failure stays owed").toEqual(["sub_owed_hourly"]);
      expect(await finishOwedCancelsJob(pool, Date.now() + 60_000)).toBe("cancelled the owed subscriptions of 1 of 1 departed members");
      expect(s.subs.sub_owed_hourly).toBe("canceled");
      expect(await owedOf(wren.id)).toEqual([]);
      expect((await cancelRows(wren.id)).at(-1)?.actor_user_id, "the job is nobody").toBeNull();
      expect(await finishOwedCancelsJob(pool, Date.now() + 60_000), "nothing owed, nothing said").toBeNull();
    });

    it("a person's confirm clears what they saw, with their id, and never what arrived after", async () => {
      await settleOthers("subs-owed-confirm");
      delete process.env.STRIPE_SECRET_KEY;
      const wren = await member("subs-owed-confirm", "Wren Confirmed");
      await purchase("pp-oc1", wren.id, "prod-month", { status: "paid", sub: "sub_owed_confirm", at: "2026-09-04 10:00:00" });
      await anonymizeMember(pool, wren, "admin-1", deps());
      const call = queue({ id: "subs-admin-fen" });
      const seen = (await call("GET /api/review/erasure")).body.subscriptions;
      expect(seen.count).toBe(1);

      // A late charge for another leaver lands after the card was read.
      const ash = await member("subs-owed-after", "Ash After");
      await anonymizeMember(pool, ash, ash.id, deps());
      await settleLeaversSubscription(pool, { userId: ash.id, subscriptionId: "sub_owed_after", refusal: BUYER_HAS_LEFT });

      expect((await call("POST /api/review/erasure/subscriptions-cancelled", {})).status, "no asOf, no confirm").toBe(400);
      expect((await call("POST /api/review/erasure/subscriptions-cancelled", { asOf: "evt-0-none" })).status).toBe(409);
      const confirmed = await call("POST /api/review/erasure/subscriptions-cancelled", { asOf: seen.asOf });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.cleared).toBe(1);
      expect(await owedOf(wren.id)).toEqual([]);
      expect((await cancelRows(wren.id)).at(-1)).toEqual({
        text: "member:subscriptions-cancelled:1:sub_owed_confirm", audience: "admin", actor_user_id: "subs-admin-fen",
      });
      expect(await owedOf(ash.id), "arrived after the card was read, so still owed").toEqual(["sub_owed_after"]);
      expect(confirmed.body.subscriptions.count).toBe(1);
    });

    /*
     * A FORMER MEMBER'S EXIT CANCELS THEIR SUBSCRIPTIONS (Rye, 2026-10-31,
     * ruling 8). A leaver who still holds tokens, or is owed cash, is kept on
     * as a former member and never erased, so the erasure's step never ran
     * for them and their card was charged every period. The resolve now runs
     * the same cancel as a step of its own, with the same no-key hand-off.
     */
    describe("a former member's exit (Rye, 2026-10-31, ruling 8)", () => {
      /** A member who holds credits, so resolving their departure keeps them as a former member. */
      async function holder(id: string, name: string, sub: string): Promise<{ who: any; exitId: string }> {
        await loadTokenRegistry(pool);
        const who = await member(id, name);
        await purchase(`pp-${id}`, who.id, "prod-month", { status: "paid", sub, at: "2026-10-05 10:00:00" });
        const seeded = await postTransfer(pool, {
          from: MINT_FAUCET, to: memberAccount(who.id), tokenType: "credits", amount: 5_000,
          source: "test_seed", idempotencyKey: `subs-former:seed:${who.id}`,
        });
        expect(seeded.ok, String(seeded.error)).toBe(true);
        const opened = await createExit(pool, { userId: who.id, kind: "voluntary", openedBy: "admin-1", noticeDays: 0 });
        if (!opened.ok) throw new Error(opened.error);
        return { who, exitId: opened.exit.id };
      }
      const resolveFor = async (exitId: string, id: string) =>
        resolveExit(pool, { exitId, target: await usersRepo(pool).byId(id), actorId: "admin-1", deps: deps() });

      it("with Stripe connected, resolving a former member cancels their subscriptions and leaves a neighbour's", async () => {
        await settleOthers("subs-former-key");
        const { who, exitId } = await holder("subs-former-key", "Kit Former", "sub_former_key");
        const ash = await member("subs-former-neighbour", "Ash Neighbour");
        await purchase("pp-subs-former-neighbour", ash.id, "prod-month", { status: "paid", sub: "sub_former_neighbour", at: "2026-10-05 11:00:00" });
        const s = useStripe({ sub_former_key: "active", sub_former_neighbour: "active" });

        const out = await resolveFor(exitId, who.id);

        expect(out.outcome, "the control: they hold credits, so they are kept as a former member").toBe("former");
        expect(s.deletes(), "a former member's exit left their subscription charging").toEqual(["sub_former_key"]);
        expect(s.subs.sub_former_neighbour).toBe("active");
        expect((await cancelRows(who.id)).at(-1)).toEqual({
          text: "member:subscriptions-cancelled:1:sub_former_key", audience: "admin", actor_user_id: "admin-1",
        });
        expect(await owedOf(who.id)).toEqual([]);
        expect(String((await exitById(pool, exitId))!.resolution)).toMatch(/resolve began ending: subscriptions/);
      });

      it("with no key, hands each one to the admins by hand, and /review owes it", async () => {
        await settleOthers("subs-former-nokey");
        delete process.env.STRIPE_SECRET_KEY;
        await member("subs-admin-exit", "Oak Steward", "admin");
        const { who, exitId } = await holder("subs-former-nokey", "Kit Unconnected", "sub_former_nokey");
        const s = useStripe({ sub_former_nokey: "active" });

        expect((await resolveFor(exitId, who.id)).outcome).toBe("former");

        expect(s.calls, "no key, so nothing was sent anywhere").toEqual([]);
        expect(await cancelRows(who.id)).toEqual([
          { text: "member:subscriptions-cancel-by-hand:1:sub_former_nokey", audience: "admin", actor_user_id: "admin-1" },
        ]);
        expect(await owedOf(who.id)).toEqual(["sub_former_nokey"]);
        const bell = await q("SELECT title, body FROM notifications WHERE user_id = 'subs-admin-exit' AND dedupe_key = ?", [
          `exit-subscriptions-by-hand:${who.id}:subs-admin-exit`,
        ]);
        expect(bell).toEqual([{
          title: "Cancel 1 recurring payment(s) by hand in the Stripe dashboard. A departed member's exit could not cancel them, " +
            "because Stripe is not connected, and Stripe may keep charging them.",
          body: "Subscription ids to find in the Stripe dashboard: sub_former_nokey. Cancel each one still active.",
        }]);
        const read = await queue({ id: "subs-admin-ada" })("GET /api/review/erasure");
        expect(read.body.subscriptions).toMatchObject({ count: 1 });
        expect(JSON.stringify(read.body)).not.toContain(who.id);
      });

      it("a Stripe failure never holds the departure: the cancel is handed over and the hourly job finishes it", async () => {
        await settleOthers("subs-former-fail");
        const { who, exitId } = await holder("subs-former-fail", "Kit Failing", "sub_former_fail");
        const s = useStripe({ sub_former_fail: "active" });
        s.failNext(500);

        expect((await resolveFor(exitId, who.id)).outcome).toBe("former");
        expect(await owedOf(who.id), "a failed cancel is a person's job, and owed").toEqual(["sub_former_fail"]);
        expect(await finishOwedCancelsJob(pool, Date.now() + 60_000)).toBe("cancelled the owed subscriptions of 1 of 1 departed members");
        expect(s.subs.sub_former_fail).toBe("canceled");
        expect(await owedOf(who.id)).toEqual([]);
      });

      it("the control: a member the admins keep with They're staying keeps their subscription", async () => {
        await settleOthers("subs-former-stays");
        const { who, exitId } = await holder("subs-former-stays", "Kit Stays", "sub_former_stays");
        const s = useStripe({ sub_former_stays: "active" });
        expect((await cancelExit(pool, exitId, { memberById: (id) => usersRepo(pool).byId(id), actorId: "admin-1" })).status).toBe(200);

        expect((await resolveFor(exitId, who.id)).outcome).toBe("stopped");

        expect(s.calls, "a member who stays was asked nothing of Stripe").toEqual([]);
        expect(s.subs.sub_former_stays).toBe("active");
        expect(await cancelRows(who.id)).toEqual([]);
      });
    });
  });

  describe("the departure's notice for a member who holds tokens (round 4, finding 1)", () => {
    it("says on the exit path that resolving the departure cancels the payments, and the delete panel keeps its sentence", async () => {
      await loadTokenRegistry(pool);
      const kit = await member("subs-holder", "Kit Holder");
      await purchase("pp-hd1", kit.id, "prod-month", { status: "paid", sub: "sub_holder", at: "2026-10-01 10:00:00" });
      const seeded = await postTransfer(pool, {
        from: MINT_FAUCET, to: memberAccount(kit.id), tokenType: "credits", amount: 5_000,
        source: "test_seed", idempotencyKey: `subs-holder:seed:${kit.id}`,
      });
      expect(seeded.ok, String(seeded.error)).toBe(true);
      const renewing = "1 recurring payment(s) still renewing through Stripe: Monthly membership (every month). ";
      const deleting = `${renewing}Deleting the account cancels each one in Stripe, and nothing already paid is refunded`;

      const exit = await subscriptionsState(pool, kit.id, "exit", FORMER_MEMBER_HOLD);
      expect(exit.description).toBe(
        renewing +
          "Holding tokens, or being owed cash by the village, when the departure is resolved keeps the account as a former member. " +
          "Resolving the departure cancels each one in Stripe, and nothing already paid is refunded",
      );
      expect(exit.blocking).toBe(false);
      // The exit desk reads the exit path.
      expect((await exitOpenState(pool, kit.id, [], { formerMember: FORMER_MEMBER_HOLD })).find((st) => st.domain === "subscriptions")).toEqual(exit);
      // A delete always erases, and the erasure cancels: that sentence stays.
      expect((await subscriptionsState(pool, kit.id, "delete")).description).toBe(deleting);

      // The departure page's read of the same route, and the delete panel's.
      const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
      const app: any = { get: (p: string, h: any) => handlers.set(`GET ${p}`, h), put: () => undefined, post: () => undefined };
      registerProfileRoutes(app, { authedUser: async () => kit, members: usersRepo(pool) as any, publicUser: (u: any) => u, getPool: () => pool } as any);
      const read = async (query: Record<string, string>) => {
        const out: { body: any } = { body: undefined };
        const res: any = { status() { return res; }, json(b: unknown) { out.body = b; return res; } };
        await handlers.get("GET /api/profile/leaving-notices")!({ headers: {}, query }, res);
        return out.body.notices.map((n: any) => n.description);
      };
      expect(await read({ for: "exit" })).toEqual([exit.description]);
      expect(await read({})).toEqual([deleting]);
    });

    it("tells a leaver kept only for cash owed that resolving cancels the payments, the rule resolve uses (round 6, R5-0/R5-1)", async () => {
      const rue = await member("subs-cash-only", "Rue Cash");
      await purchase("pp-co1", rue.id, "prod-month", { status: "paid", sub: "sub_cash_only", at: "2026-10-03 10:00:00" });
      await insertCashOwedRow(pool, {
        id: "cash-subs-cash-only", occurrenceKey: "test:cash-subs-cash-only", userId: rue.id,
        workKind: "quest", workRef: "quest-1", workTitle: "Mend the east fence", amountMinor: 20000, currency: "USD",
      });
      const renewing = "1 recurring payment(s) still renewing through Stripe: Monthly membership (every month). ";
      const deleting = `${renewing}Deleting the account cancels each one in Stripe, and nothing already paid is refunded`;
      // No tokens at all: only the cash keeps Rue, and resolve's own rule says so.
      expect(await keepsAsFormerMember(pool, rue.id)).toBe(true);
      const exit = await subscriptionsState(pool, rue.id, "exit", FORMER_MEMBER_HOLD);
      expect(exit.description).toBe(
        renewing +
          "Holding tokens, or being owed cash by the village, when the departure is resolved keeps the account as a former member. " +
          "Resolving the departure cancels each one in Stripe, and nothing already paid is refunded",
      );
      expect(exit.description).not.toContain("Deleting the account cancels");
      expect((await exitOpenState(pool, rue.id, [], { formerMember: FORMER_MEMBER_HOLD })).find((st) => st.domain === "subscriptions")).toEqual(exit);
      // The delete panel: a delete always erases, owed cash or not.
      expect((await subscriptionsState(pool, rue.id, "delete", FORMER_MEMBER_HOLD)).description).toBe(deleting);
      // Paid out, nothing keeps Rue, and the departure erases and cancels.
      await q("UPDATE `cash_owed` SET `state` = 'paid' WHERE `id` = 'cash-subs-cash-only'");
      expect(await keepsAsFormerMember(pool, rue.id)).toBe(false);
      expect((await subscriptionsState(pool, rue.id, "exit", FORMER_MEMBER_HOLD)).description).toBe(deleting);
    });

    it("takes the former-member rule and its reason from the caller, and names the resolve without one (round 5)", async () => {
      const ash = await member("subs-hold-injected", "Ash Injected");
      await purchase("pp-hi1", ash.id, "prod-month", { status: "paid", sub: "sub_injected", at: "2026-10-02 10:00:00" });
      const renewing = "1 recurring payment(s) still renewing through Stripe: Monthly membership (every month). ";
      const asked: string[] = [];
      // A wider rule, the shape the composition passes: Ash holds no tokens, and is kept anyway.
      const owedCash = {
        keptAsFormerMember: async (_pool: unknown, userId: string) => (asked.push(userId), true),
        reason: "Holding tokens, or being owed cash by the village",
      };
      expect((await subscriptionsState(pool, ash.id, "exit", owedCash)).description).toBe(
        renewing +
          "Holding tokens, or being owed cash by the village when the departure is resolved keeps the account as a former member. " +
          "Resolving the departure cancels each one in Stripe, and nothing already paid is refunded",
      );
      expect(asked).toEqual([ash.id]);
      // The delete panel never asks the rule: a delete always erases.
      expect((await subscriptionsState(pool, ash.id, "delete", owedCash)).description).toBe(
        `${renewing}Deleting the account cancels each one in Stripe, and nothing already paid is refunded`,
      );
      expect(asked).toEqual([ash.id]);
      // The shipped rule: no tokens held, so the departure erases and cancels.
      expect((await subscriptionsState(pool, ash.id, "exit", FORMER_MEMBER_HOLD)).description).toBe(
        `${renewing}Deleting the account cancels each one in Stripe, and nothing already paid is refunded`,
      );
      // A caller that only reads the blocking list passes no rule: both outcomes cancel (Rye, 2026-10-31, ruling 8).
      const blind = (await exitOpenState(pool, ash.id, [])).find((st) => st.domain === "subscriptions");
      expect(blind).toEqual({
        domain: "subscriptions",
        count: 1,
        description: `${renewing}Resolving the departure cancels each one in Stripe, and nothing already paid is refunded`,
        blocking: false,
      });
    });
  });
});
