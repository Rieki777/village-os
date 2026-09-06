/**
 * Standing examples: the refusals and the retirement triggers, over HTTP.
 *
 * `server/lib/examples.test.ts` proves the LIBRARY — seeding, retirement,
 * scoping, cache reload — by calling it directly. That leaves the part a
 * village actually meets untested: the ~20 route guards and the ~17
 * retirement triggers that live in `server/index.ts`. An adversarial review
 * (docs/STANDING_EXAMPLES_REVIEW_2026-08-01.md) put numbers on the gap:
 * twelve guards could be deleted with every gate still green, because
 * nothing exercised them.
 *
 * That is what this file closes. It boots the BUILT server against a
 * throwaway schema exactly like `loop.e2e.test.ts` does, seeds every
 * module's examples, and then tries to do the things the four rules say
 * cannot be done. A guard that gets reordered below its own side effect, or
 * deleted outright, fails here.
 *
 * Unlike the loop test this file is NOT one ordered journey: each case is
 * independent, so a failure names exactly one broken guard.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[examples.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 11500 + (process.pid % 1500);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "examples-routes-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";
let founderId = "";

/** One authenticated call. Returns status AND body: a guard is only correct
 *  if it refuses with the shared shape, not merely with some error. */
async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** The contract every refusal shares (server/lib/examples.ts EXAMPLE_REFUSAL_BODY). */
function expectRefused(r: { status: number; json: any }, what: string): void {
  expect(r.status, `${what} must be refused with 409`).toBe(409);
  expect(r.json?.code, `${what} must carry the shared refusal code`).toBe("example_immutable");
}

/** Ids the seed writes, asserted present so a rename fails loudly here rather
 *  than turning every guard case into a silent pass against a missing row. */
async function exampleId(table: string, like = "ex-%"): Promise<string> {
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM \`${table}\` WHERE is_example = 1 AND id LIKE ? ORDER BY id LIMIT 1`,
    [like],
  );
  const id = rows[0]?.id;
  expect(id, `an example row must exist in ${table} (seeding changed?)`).toBeTruthy();
  return String(id);
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the examples route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-examples-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 });

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "examples-routes-token-secret",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      // Stripe stays unconfigured: the checkout guards must refuse the
      // EXAMPLE before they ever reach the "no Stripe" 503, which is
      // precisely the ordering the review found broken once.
      STRIPE_WEBHOOK_SECRET: "whsec_examplesroutes",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Shared with every other e2e suite; see E2E_BOOT_DEADLINE_MS.
  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // A founder, then every module on — examples seed on the enable, which is
  // the same path a real village walks.
  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN,
    email: `founder-${PORT}@example.test`,
    name: "Examples Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "ExamplesTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();
  const [fRows] = await pool.query<any[]>(
    "SELECT id FROM users WHERE email = ? LIMIT 1", [`founder-${PORT}@example.test`],
  );
  founderId = String(fRows[0]?.id ?? "");
  expect(founderId, "the founder row must exist").toBeTruthy();

  const mods = await call("GET", "/api/admin/modules");
  for (const m of mods.json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }
  // No per-hook timeout on purpose. This hook CONTAINS the 180s boot wait
  // above, so a local ceiling of 180s could never outlast it: the hook always
  // died first and threw away the server log the boot deadline exists to
  // print, while loop.e2e (which has no override) passed on the same tree.
  // The ceiling lives in vitest.config.ts, once, and this inherits it.
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("standing examples: every guard, over HTTP", () => {
  it("seeded examples exist to be guarded (a hollow pass would prove nothing)", async () => {
    const shown = await call("GET", "/api/examples");
    expect(Array.isArray(shown.json?.modules)).toBe(true);
    expect(shown.json.modules.length, "modules must be showing examples").toBeGreaterThan(3);
  });

  // ── Rule 1: examples never become economic state ────────────────────────

  it("refuses to reserve an example library item", async () => {
    const id = await exampleId("library_items");
    expectRefused(await call("POST", `/api/library/items/${id}/reserve`, {}), "library reserve");
  });

  it("refuses to request an example room", async () => {
    const id = await exampleId("accommodations");
    expectRefused(
      await call("POST", "/api/stays/request", { accommodationId: id, nights: 2 }),
      "stay request",
    );
  });

  it("refuses to CHECKOUT an example room — before any Stripe object exists", async () => {
    const id = await exampleId("accommodations");
    const r = await call("POST", "/api/stays/checkout", { accommodationId: id, nights: 2 });
    expectRefused(r, "stay checkout");
    // The refusal must precede the row, not follow it.
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) n FROM stay_purchases");
    expect(Number(rows[0].n), "no stay_purchases row may exist for an example room").toBe(0);
  });

  it("refuses an ADMIN manual stay purchase against an example room", async () => {
    const id = await exampleId("accommodations");
    const r = await call("POST", "/api/admin/stays/purchases/manual", {
      userId: founderId, accommodationId: id, nights: 1, amountMinor: 1000,
    });
    expectRefused(r, "manual stay purchase");
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) n FROM stay_purchases");
    expect(Number(rows[0].n)).toBe(0);
  });

  it("refuses to buy an example product", async () => {
    const id = await exampleId("payment_products");
    expectRefused(await call("POST", `/api/products/${id}/checkout`, {}), "product checkout");
  });

  it("refuses to heart an example feed post — hearts move real budget", async () => {
    const id = await exampleId("forum_threads", "ex-feed-%");
    expectRefused(await call("POST", `/api/feed/threads/${id}/heart`, {}), "feed heart");
  });

  /**
   * Quests is core and ships with a real starter board, so hasRealContent
   * correctly suppresses example quests on this instance — which would make
   * a seeded-row probe a silent pass. The guard still has to hold for the
   * forks whose board IS empty, so the row is written here directly, exactly
   * as the module would have seeded it.
   */
  it("refuses to claim an example quest, and mints nothing", async () => {
    await pool.query(
      `INSERT INTO quests (id, title, description, impact, gratitude, duration, difficulty,
         circle, status, icon, sort_order, is_example)
       VALUES ('ex-quest-probe','Example quest','For the guard test','Proves the refusal',
         '60-120','1 hour','easy','General','open','sparkles',999,1)
       ON DUPLICATE KEY UPDATE is_example = 1`,
    );
    try {
      expectRefused(await call("POST", "/api/game/quests/ex-quest-probe/claim", {}), "quest claim");
      const [rows] = await pool.query<any[]>(
        "SELECT COUNT(*) n FROM quest_claims WHERE quest_id = 'ex-quest-probe'",
      );
      expect(Number(rows[0].n), "no claim may exist against an example quest").toBe(0);

      // The submit guard exists for the claim that predates it: seed exactly
      // that state, because otherwise the route stops at "no active claim"
      // and the guard is never reached.
      await pool.query(
        "INSERT INTO quest_claims (id, quest_id, quest_title, user_id, user_name, status) " +
          "VALUES ('ex-claim-probe','ex-quest-probe','Example quest',?, 'Examples Founder','claimed')",
        [founderId],
      );
      expectRefused(
        await call("POST", "/api/game/quests/ex-quest-probe/submit", { note: "done" }),
        "quest submit on a pre-existing claim",
      );
      const [still] = await pool.query<any[]>(
        "SELECT status FROM quest_claims WHERE id = 'ex-claim-probe'",
      );
      expect(still[0]?.status, "the claim must not advance toward consent").toBe("claimed");
    } finally {
      await pool.query("DELETE FROM quest_claims WHERE id = 'ex-claim-probe'");
      await pool.query("DELETE FROM quests WHERE id = 'ex-quest-probe'");
    }
  });

  it("refuses to award an example badge", async () => {
    const id = await exampleId("badges");
    const r = await call("POST", `/api/admin/badges/${id}/award`, { userId: founderId });
    expectRefused(r, "badge award");
    // Seeded example awards exist by design; what the refusal must guarantee
    // is that no award of any kind reached the REAL member.
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM badge_awards WHERE user_id = ?", [founderId],
    );
    expect(Number(rows[0].n), "the founder holds nothing").toBe(0);
  });

  it("refuses to buy the example exchange listing", async () => {
    const [rows] = await pool.query<any[]>(
      "SELECT token_slug FROM token_exchange_settings WHERE is_example = 1 LIMIT 1",
    );
    if (!rows[0]) return; // exchange examples are optional per seed
    const r = await call("POST", "/api/exchange/buy", { tokenSlug: rows[0].token_slug, quantity: 1 });
    expectRefused(r, "exchange buy");
  });

  /**
   * The three doors onto an example TOKEN, all of which write real ledger
   * rows against a slug retirement then deletes — after which
   * checkLedgerInvariants refuses the next boot on "ledger rows exist for
   * unregistered token". A founder's first real listing bricking the
   * deployment is the worst failure this set can produce.
   */
  it("refuses to stock, mint or list an example token, and offers it nowhere", async () => {
    const [rows] = await pool.query<any[]>("SELECT slug FROM tokens WHERE is_example = 1 LIMIT 1");
    if (!rows[0]) return; // exchange examples are optional per seed
    const slug = String(rows[0].slug);

    expectRefused(await call("POST", "/api/admin/exchange/stock", { tokenSlug: slug, amount: 10 }), "stock");
    expectRefused(
      await call("POST", `/api/admin/tokens/${slug}/mint`, { toUserId: founderId, amount: 5, reason: "no" }),
      "hand-mint",
    );
    expectRefused(await call("PUT", `/api/admin/tokens/${slug}`, { name: "Renamed" }), "rename");
    expectRefused(
      await call("PUT", `/api/admin/exchange/tokens/${slug}`, { purchasable: true }),
      "listing toggle",
    );

    // Not one ledger row, and the admin surface never offered it in the first
    // place: listableTokens feeds both the Tokens table and the stock picker.
    const [led] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM token_ledger WHERE token_type = ?", [slug],
    );
    expect(Number(led[0].n), "an example token must never carry a ledger row").toBe(0);
    const admin = await call("GET", "/api/admin/exchange");
    const offered = (admin.json?.listableTokens ?? []).map((t: any) => t.slug);
    expect(offered, "an example token must not be offered for listing or stocking").not.toContain(slug);
  });

  it("refuses gratitude sent TO an example identity", async () => {
    const [rows] = await pool.query<any[]>("SELECT email FROM users WHERE is_example = 1 LIMIT 1");
    if (!rows[0]?.email) return;
    const r = await call("POST", "/api/game/gratitude/send", {
      toEmail: rows[0].email, amount: 5, message: "for the test",
    });
    expect(r.status, "gratitude to an example identity must be refused").toBe(409);
    const [led] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM token_ledger WHERE source LIKE 'gratitude%'",
    );
    expect(Number(led[0].n), "no ledger row may be born from an example recipient").toBe(0);
  });

  /*
   * THE SAME REFUSAL THROUGH THE HANDLE DOOR.
   *
   * The wall's recipient field takes an @handle now, so the example guard has
   * a second way in to cover. It is covered twice over: `userIdForHandle`
   * matches `is_example = 0` and so never hands an example's id back, and the
   * `isExampleUser` check inside `sendGratitude` still runs on whatever row
   * does come back. The handle is read out of the seed rather than typed here,
   * so a fork that renames its examples renames this test with them.
   */
  it("refuses gratitude sent TO an example identity by handle", async () => {
    const seed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "server/seeds/examples-seed.json"), "utf8"),
    );
    const handle = seed?._identities?.users?.[0]?.handle;
    expect(typeof handle, "the seed still names an example handle").toBe("string");

    const r = await call("POST", "/api/game/gratitude/send", {
      to: `@${handle}`, amount: 5, message: "for the test",
    });
    // 404 and not 409: the resolver treats an example as somebody who is not
    // there, which is the same answer `/api/profiles/:handle` and the forum's
    // own handle lookup give. An example is a demonstration and never a
    // villager, so it has no handle anybody can reach.
    expect(r.status, "an example handle must not resolve to a recipient").toBe(404);
    expect(String(r.json?.error)).toContain("No villager with that handle");
  });

  // ── Rule 1, second half: no example may hold open economic state ────────

  it("leaves every economic table empty after all that refusing", async () => {
    for (const table of [
      "token_ledger", "library_loans", "stay_purchases", "product_purchases",
      "fiat_charges", "exchange_orders",
    ]) {
      const [rows] = await pool.query<any[]>(`SELECT COUNT(*) n FROM \`${table}\``);
      expect(Number(rows[0].n), `${table} must hold nothing`).toBe(0);
    }
    // badge_awards is allowed to hold EXAMPLE awards (seeded, held by example
    // identities). What must never exist is a real one, or an example one on
    // a real member.
    const [real] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM badge_awards WHERE is_example = 0",
    );
    expect(Number(real[0].n), "no real award may exist on this instance").toBe(0);
    // LEFT JOIN: an inner join can only see awards whose holder EXISTS, so it
    // reported clean over awards pointing at users nobody had created. Both a
    // real holder and a missing one have to fail.
    const [bad] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM badge_awards a LEFT JOIN users u ON u.id = a.user_id " +
        "WHERE a.is_example = 1 AND NOT (u.id IS NOT NULL AND u.is_example = 1)",
    );
    expect(Number(bad[0].n), "every example award must be held by an example identity that exists").toBe(0);
  });

  /**
   * The rule-1 corollary: an example must never leave open state behind that
   * traps the founder in the module it was demoing. A module that still has
   * DEPENDENTS is a different, legitimate 409 (feed requires forum), so the
   * refusal only counts as a failure when it names open state.
   */
  it("lets every module with examples still be turned off (no trapped open state)", async () => {
    const shown = await call("GET", "/api/examples");
    /*
     * The loop below used to iterate `shown.json?.modules ?? []`, with no
     * status assertion on the call above and a response helper that swallows a
     * JSON parse failure into `json = undefined`. A 404 on /api/examples
     * therefore ran the body zero times and passed a test whose name claims
     * something about EVERY module. Assert the collection first: an empty list
     * is a different fact from a list that is fine.
     */
    expect(shown.status, "the examples index must answer").toBe(200);
    expect(Array.isArray(shown.json?.modules), "and answer with a list of modules").toBe(true);
    expect(shown.json.modules.length, "which must not be empty, or this test proves nothing").toBeGreaterThan(3);
    for (const id of shown.json.modules) {
      if (["quests", "gratitude", "progression", "profiles"].includes(id)) continue;
      const off = await call("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: "off" });
      if (off.status !== 200) {
        expect(
          off.json?.dependents,
          `${id} refused to turn off for a reason other than dependents: ${JSON.stringify(off.json)}`,
        ).toBeTruthy();
        continue;
      }
      await call("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: "public" });
    }
  });

  // ── Rule 2: an example is never mistaken for real ───────────────────────

  it("refuses to reply to an example thread", async () => {
    const id = await exampleId("forum_threads", "ex-thread-%");
    expectRefused(await call("POST", `/api/forum/threads/${id}/replies`, { body: "hello" }), "forum reply");
  });

  /**
   * The flag has to reach the CLIENT, not merely exist in the table.
   *
   * ThreadView reads `thread.isExample` to render the label and to take the
   * reply composer, Follow, Report and the decision recorder off an example.
   * forumThreadById builds its record from an explicit column list, so the
   * column simply never arrived and every one of those guards was dead code:
   * the member still learned what the thread was by pressing Reply and reading
   * the 409 below. The other suites walk the refusal; this walks the payload.
   */
  it("tells the client an example thread is an example, on every read path", async () => {
    const id = await exampleId("forum_threads", "ex-thread-%");
    const one = await call("GET", `/api/forum/threads/${id}`);
    expect(one.status).toBe(200);
    expect(one.json?.isExample, "the thread detail payload must carry the flag").toBe(true);

    const list = await call("GET", "/api/forum/threads");
    const row = (list.json ?? []).find((t: any) => t.id === id);
    expect(row?.isExample, "the list payload must carry it too, for the row chip").toBe(true);

    const feedId = await exampleId("forum_threads", "ex-feed-%");
    const feed = await call("GET", "/api/feed");
    const post = (feed.json?.items ?? []).find((i: any) => i.id === feedId);
    expect(post?.isExample, "the feed lens must carry it").toBe(true);

    // And a real thread must not be labelled: a false positive here would put
    // "this is a standing example" over a member's own words. Written straight
    // to the table rather than posted, because posting is the forum's
    // retirement trigger and would delete the rows the cases below still need.
    await pool.query(
      "INSERT INTO forum_threads (id, category, author_id, title, body, kind) " +
        "VALUES ('thr-real-flag','village-life',?,'A real thread','Written by an actual person.','discussion')",
      [founderId],
    );
    try {
      const real = await call("GET", "/api/forum/threads/thr-real-flag");
      expect(real.json?.isExample, "a real thread must never carry the label").toBe(false);
    } finally {
      await pool.query("DELETE FROM forum_threads WHERE id = 'thr-real-flag'");
    }
  });

  it("refuses an admin EDIT of an example row", async () => {
    const id = await exampleId("library_items");
    const r = await call("PUT", `/api/admin/library/items/${id}`, { title: "renamed" });
    expectRefused(r, "library item edit");
  });

  it("refuses an admin EDIT of an example quest (editing one would launder it)", async () => {
    await pool.query(
      `INSERT INTO quests (id, title, description, impact, gratitude, duration, difficulty,
         circle, status, icon, sort_order, is_example)
       VALUES ('ex-quest-edit','Example quest','d','i','10','1 hour','easy','General','open','sparkles',998,1)
       ON DUPLICATE KEY UPDATE is_example = 1`,
    );
    try {
      expectRefused(
        await call("PUT", "/api/admin/quests/ex-quest-edit", { title: "Mine now" }),
        "admin quest edit",
      );
      const [rows] = await pool.query<any[]>("SELECT title FROM quests WHERE id = 'ex-quest-edit'");
      expect(rows[0]?.title, "the example keeps its own title").toBe("Example quest");
    } finally {
      await pool.query("DELETE FROM quests WHERE id = 'ex-quest-edit'");
    }
  });

  /**
   * The stays admin surface was the outlier: every sibling edit route guarded
   * and these two did not. The price one is the worse of the pair — it
   * deactivates every posted rate for the room before re-inserting, so a
   * half-filled form left the demo's rates switched off for good.
   */
  it("refuses an admin edit of an example room, and keeps its posted rates", async () => {
    const id = await exampleId("accommodations");
    const [before] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM accommodation_prices WHERE accommodation_id = ? AND active = 1", [id],
    );
    expect(Number(before[0].n), "the example room must post rates to protect").toBeGreaterThan(0);

    expectRefused(
      await call("PUT", `/api/admin/stays/accommodations/${id}`, { name: "Mine now", active: false }),
      "example room edit",
    );
    expectRefused(
      await call("PUT", `/api/admin/stays/accommodations/${id}/prices`, {
        prices: [{ tokenType: "stay-credit", audience: "guest", amountMinor: 1 }],
      }),
      "example room prices",
    );
    const [after] = await pool.query<any[]>(
      "SELECT name, active FROM accommodations WHERE id = ?", [id],
    );
    expect(after[0]?.name, "the example keeps its own name").not.toBe("Mine now");
    expect(Number(after[0]?.active), "and stays active").toBe(1);
    const [rates] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM accommodation_prices WHERE accommodation_id = ? AND active = 1", [id],
    );
    expect(Number(rates[0].n), "not one posted rate may be switched off").toBe(Number(before[0].n));
  });

  it("refuses to price, halt or resume an example token", async () => {
    const [rows] = await pool.query<any[]>("SELECT slug FROM tokens WHERE is_example = 1 LIMIT 1");
    if (!rows[0]) return; // exchange examples are optional per seed
    const slug = String(rows[0].slug);
    const [before] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM currency_prices WHERE token_slug = ?", [slug],
    );

    expectRefused(
      await call("POST", `/api/admin/exchange/tokens/${slug}/price`, { priceMinor: 999, note: "no" }),
      "example token price",
    );
    expectRefused(
      await call("POST", `/api/admin/exchange/tokens/${slug}/halt`, { reason: "no" }),
      "example token halt",
    );
    expectRefused(
      await call("POST", `/api/admin/exchange/tokens/${slug}/resume`, {
        note: "This sentence is long enough to pass the resume gate.",
      }),
      "example token resume",
    );
    const [after] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM currency_prices WHERE token_slug = ?", [slug],
    );
    expect(Number(after[0].n), "no price row may be appended to the example market").toBe(Number(before[0].n));
    const [halted] = await pool.query<any[]>(
      "SELECT swap_halted_at FROM token_exchange_settings WHERE token_slug = ?", [slug],
    );
    expect(halted[0]?.swap_halted_at ?? null, "the example listing keeps its halt state").toBeNull();
  });

  /**
   * Both directions of "attach a real thing to an example identity". The
   * bootstrap guard already refuses making one a founder; these two are the
   * doors that reached the same state from inside the admin surface.
   */
  it("refuses to promote an example identity, or place a real badge on one", async () => {
    const [rows] = await pool.query<any[]>("SELECT id FROM users WHERE is_example = 1 LIMIT 1");
    if (!rows[0]) return;
    const exampleUserId = String(rows[0].id);

    expectRefused(
      await call("PUT", `/api/admin/users/${exampleUserId}/role`, { role: "founder" }),
      "role change on an example identity",
    );
    const [check] = await pool.query<any[]>("SELECT role FROM users WHERE id = ?", [exampleUserId]);
    expect(check[0]?.role, "the example identity keeps its role").not.toBe("founder");

    // A REAL warning badge on an example identity writes an is_example = 0
    // award, which badgesOpenState counts — and it survives the holder's
    // deletion at retirement, blocking module-off with nothing to revoke.
    // Written to the table rather than posted: creating a badge is the
    // module's retirement trigger, and the cases below still need its rows.
    await pool.query(
      "INSERT INTO badges (id, name, description, kind, capabilities, denies) " +
        "VALUES ('badge-real-warning','A real warning','For the guard test','warning','[]','[]')",
    );
    try {
      expectRefused(
        await call("POST", "/api/admin/badges/badge-real-warning/award", {
          userId: exampleUserId, note: "no",
        }),
        "real badge awarded to an example identity",
      );
      const [awards] = await pool.query<any[]>(
        "SELECT COUNT(*) n FROM badge_awards WHERE user_id = ? AND is_example = 0", [exampleUserId],
      );
      expect(Number(awards[0].n), "no real award may attach to an identity retirement deletes").toBe(0);
    } finally {
      await pool.query("DELETE FROM badge_awards WHERE badge_id = 'badge-real-warning'");
      await pool.query("DELETE FROM badges WHERE id = 'badge-real-warning'");
    }
  });

  it("refuses to claim an example seating, and never offers one", async () => {
    // `unclaimedSeatingsFor` matches a member's name against documented
    // holders and `claimSeating` took whatever it was handed, so a member
    // whose name matched a demo holder could become the real holder of a demo
    // seat, and the village's first org chart would be part illustration and
    // part fact with nothing to tell them apart.
    //
    // The rows are WRITTEN HERE rather than read from the seed, the same way
    // the example-quest case above writes its own. `progression`'s example
    // block does not actually seed on this platform: `hasRealContent` reads
    // `roles`, the starter seed fills it with four real permission groups
    // before `seedExamplesAtBoot` runs, and the module is skipped every boot.
    // That is worth knowing and it is not what this guard is about — an
    // example seating can exist (the dev seeder forces one, a fork that
    // empties `roles` gets them), and the guard has to hold when it does.
    const seatId = "ex-seat-guard";
    const seatingId = "ex-seat-guard-holder";
    const name = "Guarded Holder";
    await pool.query(
      "INSERT INTO org_roles (id, name, aim, seats, sort_order, is_example) " +
        "VALUES (?, 'Guarded Seat', 'Prove the guard holds.', 1, 997, 1) " +
        "ON DUPLICATE KEY UPDATE is_example = 1",
      [seatId],
    );
    await pool.query(
      "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, display_name, holder_key, is_example) " +
        "VALUES (?, ?, 'documented', ?, 'doc:guarded-holder', 1) " +
        "ON DUPLICATE KEY UPDATE is_example = 1",
      [seatingId, seatId, name],
    );

    try {
      // A real member whose name matches the documented holder EXACTLY, which
      // is the easiest version of the match to hit.
      const email = `claimer-${PORT}@example.test`;
      const reg = await call("POST", "/api/auth/register",
        { email, password: "ExamplesTest123!", name, paths: ["resident"] }, "");
      const token = String(reg.json?.token ?? "");
      expect(token, `the claimer must hold a session: ${JSON.stringify(reg.json)}`).toBeTruthy();

      const offered = await call("GET", "/api/org/my-unclaimed-seats", undefined, token);
      expect(offered.status).toBe(200);
      expect(
        (offered.json as any[]).some((o) => o.assignmentId === seatingId),
        "an example seating is never offered",
      ).toBe(false);

      expectRefused(
        await call("POST", `/api/org/seatings/${seatingId}/claim`, {}, token),
        "claiming an example seating",
      );
      const [[after]] = await pool.query<any[]>(
        "SELECT holder_kind, user_id, is_example FROM org_role_assignments WHERE id = ?", [seatingId],
      );
      expect(after.holder_kind, "the example seating stays documented").toBe("documented");
      expect(after.user_id, "no real account may end up holding it").toBeNull();
      expect(Number(after.is_example)).toBe(1);
    } finally {
      await pool.query("DELETE FROM org_role_assignments WHERE id = ?", [seatingId]);
      await pool.query("DELETE FROM org_roles WHERE id = ?", [seatId]);
    }
  });

  it("refuses acting on an example call task", async () => {
    const [rows] = await pool.query<any[]>(
      "SELECT id FROM call_tasks WHERE is_example = 1 LIMIT 1",
    );
    if (!rows[0]) return;
    expectRefused(
      await call("POST", `/api/admin/call-tasks/${rows[0].id}/accept`),
      "call task accept",
    );
    const [after] = await pool.query<any[]>(
      "SELECT status FROM call_tasks WHERE id = ?", [rows[0].id],
    );
    expect(after[0]?.status, "the example task keeps its status").toBe("suggested");
  });

  it("refuses rewriting an example synthesis body", async () => {
    const [rows] = await pool.query<any[]>(
      "SELECT id FROM call_syntheses WHERE is_example = 1 LIMIT 1",
    );
    if (!rows[0]) return;
    expectRefused(
      await call("PUT", `/api/admin/syntheses/${rows[0].id}/body`, { body: "rewritten" }),
      "synthesis body edit",
    );
  });

  it("refuses to bootstrap an example identity into a founder", async () => {
    const [rows] = await pool.query<any[]>("SELECT email FROM users WHERE is_example = 1 LIMIT 1");
    if (!rows[0]?.email) return;
    const r = await call("POST", "/api/admin/bootstrap", {
      password: ADMIN, email: rows[0].email, name: "Impostor",
    }, "");
    expect(r.status, "an example identity must never become a founder").toBeGreaterThanOrEqual(400);
    const [check] = await pool.query<any[]>(
      "SELECT role FROM users WHERE email = ? LIMIT 1", [rows[0].email],
    );
    expect(check[0]?.role, "the example identity keeps its role").not.toBe("founder");
  });

  // ── Rule 3: publishing something real retires that module, one way ──────

  it("retires a module when something real is published, and only that module", async () => {
    const before = await call("GET", "/api/examples");
    expect(before.json.modules, "tools must be showing examples first").toContain("tools");
    const otherBefore = (before.json.modules as string[]).filter((m) => m !== "tools");

    const made = await call("POST", "/api/admin/tools", {
      name: "A real tool", purpose: "Proving retirement", url: "https://example.invalid/t",
      category: "coordination", visibility: "public",
    });
    expect(made.status, `publishing a real tool must succeed: ${JSON.stringify(made.json)}`).toBeLessThan(400);

    // Retirement rides the create as fire-and-forget, and the tombstone is
    // stamped BEFORE the cache reload — so polling /api/examples would exit
    // while the served collection is still stale. Poll the collection itself,
    // which is what a member actually sees.
    let names: string[] = [];
    for (let i = 0; i < 60; i++) {
      const tools = await call("GET", "/api/tools");
      names = (tools.json?.tools ?? []).map((t: any) => t.name);
      if (names.length === 1) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    // The rows must leave the SERVED collection, not merely the table — the
    // cache bug this feature already paid for once.
    expect(names, "only the real tool remains").toEqual(["A real tool"]);

    const after = await call("GET", "/api/examples");
    expect(after.json.modules, "tools examples are gone").not.toContain("tools");
    for (const m of otherBefore) {
      expect(after.json.modules, `${m} must be untouched by tools retirement`).toContain(m);
    }
  });

  it("does not resurrect retired examples when the module is toggled off and on", async () => {
    await call("PUT", "/api/admin/modules/tools/lifecycle", { lifecycle: "off" });
    await call("PUT", "/api/admin/modules/tools/lifecycle", { lifecycle: "public" });
    const after = await call("GET", "/api/examples");
    expect(after.json.modules).not.toContain("tools");
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) n FROM tools WHERE is_example = 1");
    expect(Number(rows[0].n), "a retired module stays retired").toBe(0);
  });

  /**
   * The clear button is not exempt from RETIRE_TOGETHER.
   *
   * The forum and the feed are two lenses over one table in one category, and
   * the forum's "All" tab sends no category at all. The route used to retire
   * exactly the module its label named, so clearing the forum dropped the
   * forum banner and left ex-feed-1..3 rendering on the same list — the
   * unlabelled platform fiction the pairing exists to prevent.
   */
  it("clears the forum and the feed together, and leaves no thread behind", async () => {
    const before = await call("GET", "/api/examples");
    const showing: string[] = before.json?.modules ?? [];
    if (!showing.includes("forum") && !showing.includes("feed")) return;

    const cleared = await call("POST", "/api/admin/modules/forum/examples/clear");
    expect(cleared.status, JSON.stringify(cleared.json)).toBeLessThan(400);
    expect(cleared.json?.retired).toBe(true);

    const after = await call("GET", "/api/examples");
    expect(after.json.modules, "the named module is retired").not.toContain("forum");
    expect(after.json.modules, "and so is its twin").not.toContain("feed");
    // The rows are what a member actually meets: an unlabelled example thread
    // on a page whose banner has gone is the failure, not the tombstone.
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM forum_threads WHERE is_example = 1",
    );
    expect(Number(rows[0].n), "neither module's example threads may survive").toBe(0);
  });

  it("clears examples on admin request, permanently", async () => {
    const before = await call("GET", "/api/examples");
    const target = (before.json.modules as string[]).find((m) => m !== "tools");
    if (!target) return;
    const cleared = await call("POST", `/api/admin/modules/${target}/examples/clear`);
    expect(cleared.status).toBeLessThan(400);
    // The route used to answer 200 {success:true} on the failure path too, so
    // the toast said "N row(s) cleared" over rows still on the page with the
    // tombstone deliberately unstamped. The tombstone is now what it reports.
    expect(cleared.json?.retired, "success means the tombstone was stamped").toBe(true);
    const after = await call("GET", "/api/examples");
    expect(after.json.modules).not.toContain(target);
  });
});
