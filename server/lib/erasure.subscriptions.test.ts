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
 *   moves a token; a second run cancels nothing; a village with Stripe
 *   unconnected, or a Stripe that fails, stops the sweep loudly at that step
 *   and a resume finishes it; and a member with no subscription needs no
 *   Stripe at all.
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
import { loadSecrets } from "./secrets";

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
function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: (u: any) => void, opts?: { erasure?: boolean }) => real.update(id, fn, opts) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn: () => Promise<any>) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  } as ErasureDeps;
}

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
    impl,
  };
}

async function member(id: string, name: string): Promise<any> {
  await usersRepo(pool).add({ id, name, email: `${id}@example.test`, passwordHash: "x", paths: [] });
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

  it("stops loudly at the step when Stripe is not connected, and a resume once it is finishes the job", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const wren = await member("subs-nokey", "Wren Unconnected");
    await purchase("pp-n1", wren.id, "prod-month", { status: "paid", sub: "sub_nokey", at: "2026-03-01 10:00:00" });
    const s = useStripe({ sub_nokey: "active" });

    await expect(anonymizeMember(pool, wren, "admin-1", deps())).rejects.toThrow(/Stripe is not connected/);
    const stopped = await erasureRecord(pool, wren.id);
    expect(stopped?.failedStep).toBe(STEP);
    expect(stopped?.lastError).toContain("sub_nokey");
    expect(stopped?.finishedAt).toBeNull();
    // Past the tombstone: the account is closed, and the hourly job resumes a sweep stopped here.
    expect(stopped?.stepsDone).toContain("tombstone");
    expect((await usersRepo(pool).byId(wren.id))!.name).toBe("A departed member");
    expect(s.calls, "no key, so nothing was sent anywhere").toEqual([]);

    process.env.STRIPE_SECRET_KEY = KEY;
    const out = await resumeErasure(pool, wren.id, deps());
    expect(out.finished).toBe(true);
    expect(out.ran[0], "the resume starts at the step that stopped").toBe(STEP);
    expect(s.deletes()).toEqual(["sub_nokey"]);
    expect(s.subs.sub_nokey).toBe("canceled");
  });

  it("stops loudly when Stripe fails, and the retry cancels it", async () => {
    const wren = await member("subs-down", "Wren Unlucky");
    await purchase("pp-d1", wren.id, "prod-month", { status: "paid", sub: "sub_down", at: "2026-04-01 10:00:00" });
    const s = useStripe({ sub_down: "active" });
    s.failNext(500);

    await expect(anonymizeMember(pool, wren, "admin-1", deps())).rejects.toThrow(/Stripe could not read subscription sub_down/);
    expect((await erasureRecord(pool, wren.id))?.failedStep).toBe(STEP);
    expect(s.subs.sub_down).toBe("active");

    const out = await resumeErasure(pool, wren.id, deps());
    expect(out.finished).toBe(true);
    expect(s.subs.sub_down).toBe("canceled");
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
});
