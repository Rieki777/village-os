/**
 * FOUR DECIMALS, DRIVEN THROUGH THE ROUTES (sweep lane A).
 *
 * WRITTEN UNDER A RULING THAT WAS REVERSED, AND STILL EARNING ITS KEEP.
 *
 * The founder ruled every token to four decimals, this suite was built to prove
 * the routes survived it, and he then ruled the other way: currency-like tokens
 * at two, everything else whole, Voice down from three to two. So the sentence
 * that used to open this file was true when written and false by the time
 * anybody read it again, which is the defect class this build kept meeting.
 *
 * The suite outlived the ruling because what it actually proves is scale
 * INDEPENDENCE. `postTransfer` takes MINOR units, and a route handing it a human
 * number is correct by accident wherever the scale is 1, so it would pay a
 * hundredth of what it says at two decimals as surely as a ten-thousandth at
 * four. `server/index.ts` holds twelve of those callers plus the readouts that
 * carry a ledger number back to a person.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN ASSERTION IN loop.e2e. At `decimals: 0`
 * every one of these conversions is the identity, so a test run against the
 * seeded scales cannot tell a converted route from an unconverted one: it is
 * green over the bug and green over the fix. Each case here therefore moves a
 * token to a REAL scale first and then drives the route, which is the only
 * shape in which the assertion discriminates. Lane D found that no HTTP door
 * can create a token at four decimals (`registerToken` deliberately excludes
 * `decimals` from its upsert, `server/lib/ledger.ts`), so the scale is set in
 * the column and the server's in-memory registry is reloaded through
 * `PUT /api/admin/tokens/:slug`, which ends in `loadTokenRegistry`. That is
 * the same door an admin rename goes through; nothing here reaches past it.
 *
 * EVERY CASE SETS THE SCALE BEFORE ANY BALANCE EXISTS in that token. Moving a
 * token that already holds value is the migration's job (lane H rescales the
 * rows in the same transaction), and doing it here would be asserting over a
 * half-done flip rather than over the route.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, like
 * `loop.e2e.test.ts` and `tokenSinks.routes.e2e.test.ts`. Run `pnpm build`
 * first or you are testing stale code. Skips loudly without TEST_DATABASE_URL.
 *
 * The cases run IN ORDER: modules are switched on, tokens are created and
 * rescaled, and dials are moved as the file goes. Run the whole file, never a
 * `-t` slice.
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
  console.warn("[decimals.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. `scripts/check-e2e-ports.mjs` proves it is disjoint.
 *
 * It was 30500 + (pid % 300), which sat entirely INSIDE exitLevers' 30402 + (pid % 400).
 * Two sibling lanes each picked a base that was free when they looked, and neither could
 * see the other, so the overlap only appeared once both branches were in one tree. Within
 * a single run the pid is fixed and the two would have differed, which is exactly why the
 * guard checks windows and not the ports a run happens to compute.
 */
const PORT = 31202 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "decimals-routes-admin";
const WEBHOOK_SECRET = "whsec_decimalsroutes"; // module-review-ok: a throwaway value for the spawned scratch server, never a real credential

const CREDITS = "credits";
const GRATITUDE = "gratitude";
const STAY_CREDIT = "stay-credit";
/** Four decimals: ten thousand minor units to one whole token. */
const SCALE4 = 10_000;
/** Three, which is where `village-voice` already rides. */
const SCALE3 = 1_000;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
let annaToken = "";
let annaId = "";
let benToken = "";
let benId = "";
let calToken = "";
const annaEmail = () => `anna-${PORT}@example.test`;
const benEmail = () => `ben-${PORT}@example.test`;
const calEmail = () => `cal-${PORT}@example.test`;

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function register(name: string, email: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    body: { name, email, password: "DecimalsTest123!", paths: ["resident"] },
    token: null,
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/**
 * Move a token to a real scale, then make the SERVER believe it.
 *
 * The column write alone is invisible: the registry is a boot-loaded map and
 * a raw UPDATE leaves the old scale answering every route until reboot. The
 * rename door is the one production surface that reloads it.
 */
async function setDecimals(slug: string, decimals: number): Promise<void> {
  await pool.query("UPDATE tokens SET decimals = ? WHERE slug = ?", [decimals, slug]);
  const reloaded = await call("PUT", `/api/admin/tokens/${slug}`, { body: { active: true } });
  expect(reloaded.status, `reload the registry for ${slug}: ${JSON.stringify(reloaded.json)}`).toBe(200);
  expect(reloaded.json?.token?.decimals, `${slug} must answer at ${decimals} decimals`).toBe(decimals);
}

/** A fresh platform credit token nobody has ever held. */
async function makeToken(slug: string, name: string): Promise<void> {
  const r = await call("POST", "/api/admin/tokens", {
    body: { slug, name, kind: "credit", transferable: false },
  });
  expect(r.status, `create ${slug}: ${JSON.stringify(r.json)}`).toBe(200);
}

/** The raw MINOR sum this faucet has issued of one token. The ledger is the witness. */
async function mintedMinor(slug: string): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(amount),0) AS n FROM token_ledger WHERE from_account = 'sys:mint' AND token_type = ?",
    [slug],
  );
  return Number(row.n);
}

/** A member's raw MINOR balance, straight off the column, never off a payload. */
async function minorBalance(userId: string, slug: string): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COALESCE(balance,0) AS b FROM token_balances WHERE account_id = ? AND token_type = ?",
    [`mem:${userId}`, slug],
  );
  return Number(row?.b ?? 0);
}

async function setVar(key: string, value: string): Promise<void> {
  const r = await call("PUT", `/api/admin/variables/${key}`, { body: { value } });
  expect(r.status, `set ${key}=${value}: ${JSON.stringify(r.json)}`).toBe(200);
}

/** The invariant, read where an admin reads it. */
async function conserves(): Promise<void> {
  const r = await call("GET", "/api/admin/ledger/reconciliation");
  expect(r.status).toBe(200);
  expect(r.json?.invariants?.problems).toEqual([]);
  expect(r.json?.invariants?.ok).toBe(true);
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the decimals route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-decimals-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: its first tick runs every unscheduled job in
      // series against the schema this suite is asserting on.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "decimals-routes-token-secret", // module-review-ok: a throwaway value for the spawned scratch server, never a real credential
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch { /* not up yet */ }
    await settle(400);
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Decimals Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", {
    body: { token: claim, password: "DecimalsTest123!" },
    token: null,
  });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const anna = await register("Anna Vale", annaEmail());
  annaToken = anna.token; annaId = anna.id;
  const ben = await register("Ben Orr", benEmail());
  benToken = ben.token; benId = ben.id;
  // A SECOND STEWARD. A co-signed grant is refused to the steward who asked
  // for it, so proving the third mint door needs somebody else at the desk.
  const cal = await register("Cal Reed", calEmail());
  calToken = cal.token;
  expect((await call("PUT", `/api/admin/users/${cal.id}/role`, { body: { role: "admin" } })).status).toBe(200);
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe("the ratchet on the one big file", () => {
  it("reports server/index.ts at or below its baseline, from the guard's own JSON", async () => {
    /*
     * Read from the guard rather than from `wc -l`. The measured number
     * subtracts one import and one register call per route module, so a raw
     * line count reads about fifty lines high, and two sessions have already
     * called a green file red by eye.
     */
    const { execFileSync } = await import("child_process");
    // The guard EXITS NON-ZERO when it fails, and `--json` prints the report
    // first either way. Reading only the happy path made a deliberate red fail
    // with "Command failed" and never reach the comparison below, so the two
    // numbers that matter never appeared. Take stdout from the throw as well.
    let out = "";
    try {
      out = execFileSync(process.execPath, ["scripts/check-server-index-size.mjs", "--json"], {
        cwd: process.cwd(), encoding: "utf8",
      });
    } catch (e: any) {
      out = String(e?.stdout ?? "");
    }
    const report = JSON.parse(out.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}");
    expect(typeof report?.current?.lines, "the guard must report a line count").toBe("number");
    expect(report.current.lines, "server/index.ts lines against the ratchet").toBeLessThanOrEqual(report.baseline.lines);
    expect(report.current.routes, "route registrations against the ratchet").toBeLessThanOrEqual(report.baseline.routes);
  });
});

describe.skipIf(!DB_CONFIGURED)("four decimals, through the routes that post and report", () => {
  it("moves the tokens this file uses to a real scale, before any of them holds value", async () => {
    // Every flip below happens while the token's balance is zero everywhere,
    // which is the only honest moment for a scale change outside a migration.
    expect(await mintedMinor(CREDITS), "credits must be untouched before the flip").toBe(0);
    expect(await mintedMinor(GRATITUDE), "recognition must be untouched before the flip").toBe(0);

    await setDecimals(CREDITS, 4);
    await setDecimals(GRATITUDE, 4);
    await setDecimals(STAY_CREDIT, 4);

    // And the registry says so on the door an admin reads.
    const tokens = await call("GET", "/api/admin/tokens");
    expect(tokens.status).toBe(200);
    const byslug: Record<string, any> = Object.fromEntries((tokens.json?.tokens ?? []).map((t: any) => [t.slug, t]));
    expect(byslug[CREDITS]?.decimals).toBe(4);
    expect(byslug[GRATITUDE]?.decimals).toBe(4);
    expect(byslug[STAY_CREDIT]?.decimals).toBe(4);
    // `village-voice` is the control: if these assertions ever collapse onto
    // decimals 0, this line fails too and says so. It reads 2 since the
    // 2026-09-04 scale ruling and 0184, which is the scale it now carries
    // everywhere, and it is deliberately NOT the 4 the cases above set.
    expect(byslug["village-voice"]?.decimals).toBe(2);
    await conserves();
  });

  it("STOCKS a hundred at four decimals, and the treasury reads a hundred back", async () => {
    /*
     * The stock route posted `amount: amt` — a human number the admin typed —
     * straight into a MINOR ledger. Lane D moved `treasuryStock` to HUMAN, so
     * without the conversion here the treasury would read one ten-thousandth
     * of what was stocked and every stock guard would refuse. That direction
     * fails CLOSED, which is why nothing would have shouted.
     */
    await call("PUT", "/api/admin/modules/exchange/lifecycle", { body: { lifecycle: "public" } });
    await makeToken("dec-tok", "Decimal Token");
    await setDecimals("dec-tok", 4);

    const stocked = await call("POST", "/api/admin/exchange/stock", {
      body: { tokenSlug: "dec-tok", amount: 100 },
    });
    expect(stocked.status, JSON.stringify(stocked.json)).toBe(200);

    // 1. THE LEDGER, which is the fact. A hundred whole tokens at four
    //    decimals is a million minor units and nothing else.
    expect(await mintedMinor("dec-tok")).toBe(100 * SCALE4);

    // 2. WHAT THE TREASURY REPORTS. `treasuryStock` divides (lane D), so the
    //    stocked figure must come back as the number the admin typed.
    const desk = await call("GET", "/api/admin/exchange");
    expect(desk.status).toBe(200);
    expect(desk.json?.stock?.["dec-tok"]).toBe(100);

    // 3. WHAT THE ROUTE ITSELF SAID, which reaches an admin toast and is the
    //    third place the same fact could have disagreed with itself.
    expect(stocked.json?.treasuryBalance).toBe(100);
    await conserves();
  });

  it("holds ONE cap across all three mint doors, and the guard binds under a stampede", async () => {
    /*
     * `mintCapGuard` has three callers: the stock route, the hand-mint route
     * and the co-signed approval. After the conversions above, two of them
     * post minor and one passes a column, so the guard's own contract had to
     * be stated once — MINOR, with the human dial converted inside it — or
     * the cap would bind in one unit and be counted in another.
     */
    await makeToken("cap-four", "Cap Four");
    await setDecimals("cap-four", 4);
    await setVar("ledger.admin_mint_cycle_cap", "30");
    await setVar("ledger.admin_mint_cosign_over", "5");

    // Door 3 asks first, while the whole cap is free. Over the co-sign
    // threshold, so nothing moves yet and the request is spoken for.
    const raised = await call("POST", "/api/admin/tokens/cap-four/mint", {
      body: { toUserId: annaId, amount: 20, reason: "twenty, waiting for a second steward" },
    });
    expect(raised.status, JSON.stringify(raised.json)).toBe(202);
    const requestId = String(raised.json?.requestId ?? "");
    expect(requestId).toBeTruthy();

    // Door 1 takes ten of the thirty.
    expect((await call("POST", "/api/admin/exchange/stock", {
      body: { tokenSlug: "cap-four", amount: 10 },
    })).status).toBe(200);
    expect(await mintedMinor("cap-four")).toBe(10 * SCALE4);

    // Door 3 signs: ten already minted plus twenty asked for is exactly
    // thirty, the cap, and a cap that refuses its own boundary is a cap of
    // twenty-nine.
    const signed = await call("POST", `/api/admin/mint-requests/${requestId}/approve`, { body: {}, token: calToken });
    expect(signed.status, JSON.stringify(signed.json)).toBe(200);
    expect(await mintedMinor("cap-four")).toBe(30 * SCALE4);

    // AND NOW NOTHING MORE, THROUGH ANY DOOR. One token, one lunation, one
    // total. With the guard's callers in two units, the stock door's minor
    // post against a human cap would have let ten thousand times this
    // through here.
    const overStock = await call("POST", "/api/admin/exchange/stock", {
      body: { tokenSlug: "cap-four", amount: 1 },
    });
    expect(overStock.status, JSON.stringify(overStock.json)).toBe(409);
    // The refusal speaks in whole tokens on BOTH sides of the sentence.
    expect(String(overStock.json?.error)).toContain("30 of 30 cap-four");
    const overMint = await call("POST", "/api/admin/tokens/cap-four/mint", {
      body: { toUserId: benId, amount: 1, reason: "one over" },
    });
    expect(overMint.status, JSON.stringify(overMint.json)).toBe(409);
    expect(await mintedMinor("cap-four")).toBe(30 * SCALE4);

    // THE GUARD, not the pre-flight. Ten simultaneous stockings against a
    // fresh cap of thirty can only be decided inside the transaction, so
    // this is the one shape in which the pre-flight cannot be what held.
    await makeToken("cap-race", "Cap Race");
    await setDecimals("cap-race", 4);
    const stampede = await Promise.all(
      Array.from({ length: 10 }, () =>
        call("POST", "/api/admin/exchange/stock", { body: { tokenSlug: "cap-race", amount: 10 } })),
    );
    const accepted = stampede.filter((r) => r.status === 200).length;
    expect(accepted + stampede.filter((r) => r.status === 409).length).toBe(10);
    expect(await mintedMinor("cap-race")).toBeLessThanOrEqual(30 * SCALE4);
    expect(await mintedMinor("cap-race")).toBe(accepted * 10 * SCALE4);
    await conserves();
  });

  it("reports ONE yourBalance: the swap pairs and the swap quote agree", async () => {
    /*
     * D21. `GET /api/exchange` shipped `yourBalance` from `balancesFor`,
     * which is MINOR, while `POST /api/exchange/swap/quote` ships the same
     * field name from `swappableBalance`, which lane D moved to HUMAN.
     * `SwapCard.tsx` renders both, so at four decimals one card would have
     * shown the same holding two ways, ten thousand apart.
     */
    // The case above left the cap at thirty, deliberately. Stocking a market
    // is not what that boundary is about, so give this one room.
    await setVar("ledger.admin_mint_cycle_cap", "100000");
    for (const slug of ["swap-x", "swap-y"]) {
      await makeToken(slug, `Swap ${slug.slice(-1).toUpperCase()}`);
      await setDecimals(slug, 4);
      expect((await call("POST", "/api/admin/exchange/stock", { body: { tokenSlug: slug, amount: 1000 } })).status).toBe(200);
      expect((await call("PUT", `/api/admin/exchange/tokens/${slug}`, {
        body: { swappable: true, purchasable: true, maxSwapOutPerCycle: 500, maxSwapOutPerMemberPerCycle: 100 },
      })).status).toBe(200);
    }
    await call("POST", "/api/admin/exchange/tokens/swap-x/price", { body: { priceMinor: 500, note: "Opening rate for X" } });
    await call("POST", "/api/admin/exchange/tokens/swap-y/price", { body: { priceMinor: 200, note: "Opening rate for Y" } });
    expect((await call("PUT", "/api/admin/modules/exchange/config", {
      body: { config: { tradingEnabled: true, legalAck: { cardVersion: "2026-07-27", acceptedBy: founderId, acceptedAt: new Date().toISOString() } } },
    })).status).toBe(200);

    // The holder gets swap-x the way a member actually gets it: out of the
    // stocked treasury through a settled purchase. A faucet mint would taint
    // the token and it could never be swappable again. The founder holds it
    // because swapping opens at the member stage and this case is about the
    // unit a payload reports, not about who may reach the door.
    await pool.query(
      "INSERT INTO exchange_orders (id, receipt_no, user_id, token_slug, quantity, price_minor_each, amount_minor, status) " +
        "VALUES ('xo-dec-seed', 951, ?, 'swap-x', 100, 500, 50000, 'pending')",
      [founderId],
    );
    const { createHmac } = await import("crypto");
    const event = { id: "evt_dec_seed", type: "checkout.session.completed", data: { object: { id: "cs_dec_seed", payment_intent: "pi_dec_seed", metadata: { module: "exchange", orderId: "xo-dec-seed" } } } };
    const payload = JSON.stringify(event);
    const at = Math.floor(Date.now() / 1000);
    const hook = await fetch(`${BASE}/api/webhooks/stripe`, { // module-review-ok: the test client dialling the built server on localhost
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": `t=${at},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${at}.${payload}`).digest("hex")}` },
      body: payload,
    });
    expect(hook.status, "the settlement webhook must be accepted").toBeLessThan(300);

    // The ledger says a hundred whole tokens, in minor units.
    expect(await minorBalance(founderId, "swap-x")).toBe(100 * SCALE4);

    const market = await call("GET", "/api/exchange");
    expect(market.status).toBe(200);
    const pair = (market.json?.swap?.myPairs ?? []).find((p: any) => p.payToken === "swap-x" && p.receiveToken === "swap-y");
    expect(pair, "the viewer holds swap-x and swap-y is stocked, so the pair is offered").toBeTruthy();

    const quote = await call("POST", "/api/exchange/swap/quote", {
      body: { payToken: "swap-x", receiveToken: "swap-y", receiveQuantity: 1 },
    });
    expect(quote.status, JSON.stringify(quote.json)).toBe(200);

    // THE ASSERTION. One field name, two payloads, one card: one number.
    expect(pair.yourBalance).toBe(quote.json?.yourBalance);
    // And it is the human number, not the ledger's. Asserting only equality
    // would be satisfied by both sides being wrong in the same direction.
    expect(pair.yourBalance).toBe(100);
  });

  it("keeps the Hypha proposer gate shut at one ten-thousandth of its threshold", async () => {
    /*
     * `mechanicsStandingFor` compared a raw `recognitionBalance` — the cached
     * MINOR column — against `governance.hypha_threshold`, whose declared
     * unit is Gratitude. At four decimals a member holding one whole
     * recognition would have cleared a bar set at a hundred.
     */
    await setVar("governance.hypha_threshold", "100");
    await setVar("ledger.admin_mint_cosign_over", "0");
    await setVar("ledger.admin_mint_cycle_cap", "10000");

    const one = await call("POST", `/api/admin/tokens/${GRATITUDE}/mint`, {
      body: { toUserId: annaId, amount: 1, reason: "one whole recognition" },
    });
    expect(one.status, JSON.stringify(one.json)).toBe(200);
    // The cache and the ledger agree, and both are minor.
    expect(await minorBalance(annaId, GRATITUDE)).toBe(1 * SCALE4);

    const shut = await call("GET", "/api/game/mechanics/standing", { token: annaToken });
    expect(shut.status).toBe(200);
    expect(shut.json?.recognitionRequired).toBe(100);
    // ONE, not ten thousand. This is the whole case.
    expect(shut.json?.recognitionHeld).toBe(1);
    expect(shut.json?.qualified).toBe(false);

    // And the bar is a real bar rather than an unreachable one: cross it and
    // the number the gate reads crosses with it.
    const more = await call("POST", `/api/admin/tokens/${GRATITUDE}/mint`, {
      body: { toUserId: annaId, amount: 120, reason: "over the bar" },
    });
    expect(more.status, JSON.stringify(more.json)).toBe(200);
    const open = await call("GET", "/api/game/mechanics/standing", { token: annaToken });
    expect(open.json?.recognitionHeld).toBe(121);
    expect(open.json?.recognitionHeld).toBeGreaterThanOrEqual(open.json?.recognitionRequired);
    await conserves();
  });

  it("RELEASES a work-exchange stay reward in the token's own units, and says the human number", async () => {
    /*
     * `quests.stay_credit_reward` is whole credits typed on the quest form,
     * and the release handed it to `mintStayCredits`, whose contract lane E
     * declared MINOR. The notification stays human, so the member reads
     * three and the ledger holds thirty thousand.
     */
    await call("PUT", "/api/admin/modules/stays/lifecycle", { body: { lifecycle: "public" } });
    const quest = await call("POST", "/api/admin/quests", {
      body: { title: `Rebuild the beds ${PORT}`, gratitude: "10", stayCreditReward: 3, tags: ["work-exchange"] },
    });
    expect(quest.status, JSON.stringify(quest.json)).toBe(200);
    const questId = String(quest.json?.id ?? "");
    const claim = await call("POST", `/api/game/quests/${questId}/claim`, { token: benToken, body: {} });
    expect(claim.status, JSON.stringify(claim.json)).toBe(200);
    await call("POST", `/api/game/quests/${questId}/submit`, { token: benToken, body: { note: "Beds rebuilt." } });

    const before = await minorBalance(benId, STAY_CREDIT);
    const gratBefore = await minorBalance(benId, GRATITUDE);
    const consent = await call("POST", `/api/admin/quest-claims/${claim.json.id}/consent`, {
      body: { approve: true, amount: 10 },
    });
    expect(consent.status, JSON.stringify(consent.json)).toBe(200);

    // Three whole stay credits, at four decimals.
    expect(await minorBalance(benId, STAY_CREDIT)).toBe(before + 3 * SCALE4);
    // And the consent credit on the same act, in recognition's own units.
    expect(await minorBalance(benId, GRATITUDE)).toBe(gratBefore + 10 * SCALE4);

    // The member is told the human number, which is the whole point of
    // converting at the boundary rather than inside the ledger.
    const bell = await call("GET", "/api/notifications", { token: benToken });
    const note = (bell.json?.notifications ?? []).find((n: any) => String(n.title ?? "").includes("stay credit"));
    expect(note, "the release rings").toBeTruthy();
    expect(String(note.title)).toContain("+3 stay credit(s)");
    await conserves();
  });

  it("RELEASES 1000.000 from a three-decimal pool for a dial of 1000, and freezes the allowance metrics", async () => {
    /*
     * `numberVar("gratitude.pool_per_cycle")` reached `postTransfer` with no
     * conversion, so a pool retargeted at a token with a scale released one
     * thousandth of the dial. `distributions.credited` stays HUMAN on
     * purpose: the sticky split is re-read on retry and
     * `GET /api/admin/cycles/pending` renders the persisted number beside a
     * freshly computed one, so moving the column would put two numbers under
     * one field name in two units. The conversion is at the post.
     */
    // The case ABOVE is what makes Ben an eligible sender: `eligibleSenderIds`
    // admits a member with at least one consented claim, and the split follows
    // that same Sybil filter. Without it the pool has a recipient and no
    // eligible recognition, and every share floors to nothing.
    await makeToken("pool-three", "Pool Three");
    await setDecimals("pool-three", 3);
    await setVar("gratitude.pool_token", "pool-three");
    await setVar("gratitude.pool_per_cycle", "1000");

    const current = await call("GET", "/api/game/cycle");
    expect(current.status).toBe(200);
    const prevNumber = Number(current.json.cycleNumber) - 1;
    const prevId = `lunar-${String(prevNumber).padStart(6, "0")}`;
    await pool.query(
      "INSERT INTO gratitude_log (id, kind, from_id, from_name, to_id, to_name, amount, message, cycle_id, cycle_number, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        "grat-decimals-prev", "gratitude", benId, "Ben Orr", annaId, "Anna Vale", 8,
        "Backdated acknowledgment for the decimals close.", prevId, prevNumber,
        new Date(Date.parse(String(current.json.startsAt)) - 1000 * 60 * 60 * 24),
      ],
    );

    // The desk reads the split in WHOLE tokens before it presses anything.
    const preview = await call("GET", "/api/admin/cycles/pending");
    expect(preview.status).toBe(200);
    expect(preview.json?.pool?.problem, "a healthy pool names no problem").toBeNull();
    const duePrev = (preview.json?.due ?? []).find((c: any) => c.cycleNumber === prevNumber);
    expect(duePrev, "the finished lunation is due").toBeTruthy();
    expect(duePrev.credited, "the preview is human, and it is the dial").toBe(1000);

    const closed = await call("POST", "/api/admin/cycles/close", { body: {} });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.cycles?.map((c: any) => c.cycleNumber)).toContain(prevNumber);
    expect(closed.json?.poolCredited, "and the deed reports the same human number").toBe(1000);

    // THE LEDGER. A thousand whole tokens at three decimals is a million
    // minor units: 1000.000, not 1.000, which is what the dial released
    // before the conversion.
    const [[row]] = await pool.query<any[]>(
      "SELECT amount, token_type FROM token_ledger WHERE source = 'gratitude_pool' AND to_account = ?",
      [`mem:${annaId}`],
    );
    expect(row, "the pool paid the one member who was thanked").toBeTruthy();
    expect(String(row.token_type)).toBe("pool-three");
    expect(Number(row.amount)).toBe(1000 * SCALE3);
    expect(Number(row.amount) / SCALE3, "which reads as 1000.000 to a person").toBe(1000);

    // R9: the close is the only moment these are true, and they are written
    // only when the close hands `snapshotCycle` a stage source. Without that
    // wiring line the three rows are ABSENT — deliberately not zero, because
    // a zero here reads as "this village gave its whole allowance away".
    const [metrics] = await pool.query<any[]>(
      "SELECT metric_key, value FROM health_snapshots WHERE cycle_number = ? AND metric_key LIKE 'gratitude_allowance_%'",
      [prevNumber],
    );
    const keys = metrics.map((m: any) => String(m.metric_key)).sort();
    expect(keys).toEqual(["gratitude_allowance_given", "gratitude_allowance_total", "gratitude_allowance_unspent"]);
    const total = metrics.find((m: any) => String(m.metric_key) === "gratitude_allowance_total");
    expect(Number(total.value), "a real roster has a real allowance").toBeGreaterThan(0);
    await conserves();
  });

  it("CHARGES a seat and REFUNDS it in numbers a member can read", async () => {
    /*
     * Lane C moved `ChargeResult.charged`, `RefundResult.refunded` and
     * `SeatChargeRow.amount` to MINOR in one edit inside `seatPriceFor`. Both
     * numbers reach the browser (`Events.tsx`, `CommunityCalendarCard.tsx`),
     * so the routes divide.
     */
    await call("PUT", "/api/admin/modules/events/lifecycle", { body: { lifecycle: "public" } });
    // Credits into Anna's hands. The route takes whole tokens now.
    expect((await call("POST", `/api/admin/tokens/${CREDITS}/mint`, {
      body: { toUserId: annaId, amount: 50, reason: "seat float" },
    })).status).toBe(200);
    expect(await minorBalance(annaId, CREDITS)).toBe(50 * SCALE4);

    const made = await call("POST", "/api/admin/events", {
      body: {
        title: `Paid supper ${PORT}`,
        startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        status: "scheduled", kind: "gathering", layer: "village",
        seatPrice: 12, seatToken: CREDITS,
      },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const eventId = String(made.json?.event?.id ?? made.json?.id ?? "");

    const going = await call("POST", `/api/events/${eventId}/rsvp`, { token: annaToken, body: { status: "going" } });
    expect(going.status, JSON.stringify(going.json)).toBe(200);
    // TWELVE, the price on the card, not a hundred and twenty thousand.
    expect(going.json?.charged).toBe(12);
    // And the ledger moved the token's own units for it.
    expect(await minorBalance(annaId, CREDITS)).toBe(50 * SCALE4 - 12 * SCALE4);

    const cancelled = await call("DELETE", `/api/events/${eventId}/rsvp`, { token: annaToken });
    expect(cancelled.status).toBe(200);
    expect(cancelled.json?.refunded).toBe(12);
    expect(await minorBalance(annaId, CREDITS)).toBe(50 * SCALE4);

    // A second press moves nothing and says so. An empty refund and a real
    // zero are different facts, and this is the real zero.
    const retry = await call("DELETE", `/api/events/${eventId}/rsvp`, { token: annaToken });
    expect(retry.status).toBe(200);
    expect(retry.json?.refunded).toBe(0);
    await conserves();
  });
});
