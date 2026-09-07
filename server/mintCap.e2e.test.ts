/**
 * THE PER-CYCLE MINT CAP COUNTS ISSUANCE, NET, FROM EVERY DOOR.
 *
 * `MINT_CEILING_REPORT.md` (2026-09-04) measured `mintCapGuard` reading 600
 * while `GET /api/admin/tokens` beside it read 300, from `token_ledger` at the
 * same instant, because the guard summed GROSS outflow from `sys:mint` and
 * `spendSinkFor("stay-credit")` IS `sys:mint`: a credit a member spends comes
 * back to the faucet that issued it, and the old SUM counted the re-issue as a
 * second creation.
 *
 * Rye ruled that the cap bounds ALL ISSUANCE and not hand-mints alone, so the
 * fix subtracts returns instead of narrowing the SUM. Every case below is
 * about that one number.
 *
 * EVERY FIGURE IS READ BACK FROM THE DATABASE OR FROM A ROUTE, never from the
 * value a write returned. The guard's own view is read through the pre-flight
 * 409 on `POST /api/admin/tokens/:slug/mint`, which reports `minted` and
 * refuses without posting anything, so probing the counter cannot move it.
 *
 * WHAT IS RED HERE AGAINST THE OLD CODE: every step of the report's sequence
 * after the first spend, the reversal case, the boundary after a spend, and
 * the wording of the refusal. Drive it against a `dist/index.js` built from
 * the parent commit and the file fails on those.
 *
 * Run `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createHmac } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_BOOT_DEADLINE_MS, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { HAND_MINT_SOURCES } from "./lib/mintCap";
import { CYCLE_POOL_FAUCET, MINT_FAUCET, RECOGNITION_FAUCET } from "./lib/ledger";
import { LIBRARY_MINT, VOICE_MINT } from "./lib/economy";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[mintCap] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. `node scripts/check-e2e-ports.mjs` is the survey
 * that proves it is clear; it sat above every window in the tree when this
 * was written, and the gate says so on the day you run it.
 */
const PORT = 31602 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "MintCap123!";
const PASSWORD = "OraMintCap123!";
const WEBHOOK_SECRET = "whsec_mintcap_fixture";
const CREDIT = "stay-credit";
/** Bigger than any cap this file sets, so the probe always refuses. */
const PROBE = 9_000_000;

let child: ChildProcess | null = null;
let testDb: TestDb | undefined;
let dataDir = "";
const logs: string[] = [];

let founderToken = "";
let founderId = "";
let oraToken = "";
let oraId = "";
let boToken = "";
let boId = "";
let roomId = "";
/** stay-credit's scale, read off the registry rather than assumed. */
let scale = 1;

interface Answer { status: number; json: any; text: string }

async function call(method: string, route: string, body?: unknown, token?: string | null): Promise<Answer> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

describe.skipIf(!DB_CONFIGURED)("the per-cycle cap counts issuance, net, from every door", () => {
  /** What the guard itself believes has been issued, in whole tokens. */
  const guardView = async (): Promise<{ minted: number; cap: number; error: string }> => {
    const r = await call("POST", `/api/admin/tokens/${CREDIT}/mint`, {
      toUserId: oraId, amount: PROBE, reason: "probe: read the counter without moving it",
    }, founderToken);
    expect(r.status, `the probe must refuse: ${r.text.slice(0, 300)}`).toBe(409);
    return { minted: Number(r.json?.minted), cap: Number(r.json?.cap), error: String(r.json?.error ?? "") };
  };

  /** The admin panel's own arithmetic, straight off its route. MINOR units. */
  const panelIssuance = async (): Promise<number> => {
    const r = await call("GET", "/api/admin/tokens", undefined, founderToken);
    expect(r.status).toBe(200);
    const t = (r.json?.tokens ?? []).find((x: any) => x.slug === CREDIT);
    return Number(t?.issuedBy?.["sys:mint"] ?? 0);
  };

  /** The faucet's negative balance, from the cache the panel derives from. */
  const faucetOutstanding = async (): Promise<number> => {
    const [[row]] = await testDb!.conn.query<any[]>(
      "SELECT COALESCE(-balance, 0) AS n FROM token_balances WHERE account_id = 'sys:mint' AND token_type = ?",
      [CREDIT],
    );
    return Number(row?.n ?? 0);
  };

  /** The OLD counter, verbatim, kept so the divergence stays measured. */
  const grossOut = async (): Promise<number> => {
    const [[row]] = await testDb!.conn.query<any[]>(
      "SELECT COALESCE(SUM(amount), 0) AS n FROM token_ledger WHERE from_account = 'sys:mint' AND token_type = ?",
      [CREDIT],
    );
    return Number(row?.n ?? 0);
  };

  const rowsFor = async (source: string): Promise<any[]> => {
    const [rows] = await testDb!.conn.query<any[]>(
      "SELECT id, from_account, to_account, amount, source, idempotency_key FROM token_ledger " +
        "WHERE token_type = ? AND source = ? ORDER BY at, id",
      [CREDIT, source],
    );
    return rows;
  };

  const setVar = async (key: string, value: string) => {
    const r = await call("PUT", `/api/admin/variables/${key}`, { value }, founderToken);
    expect(r.status, `${key} := ${value}: ${r.text.slice(0, 200)}`).toBe(200);
  };

  /**
   * Both surfaces, at one moment, in one unit. The panel reports MINOR and the
   * guard reports whole tokens, so the comparison converts by the registry's
   * own scale. Written as a multiplication on the whole-token side: `10 ** -d`
   * is exact on Node 25 and wrong on Node 22, and CI runs 22.
   */
  const bothAgree = async (label: string) => {
    const guard = await guardView();
    const panel = await panelIssuance();
    const outstanding = await faucetOutstanding();
    // eslint-disable-next-line no-console
    console.log(`[mintCap] ${label}: guard=${guard.minted} panel=${panel} outstanding=${outstanding} gross=${await grossOut()}`);
    expect(panel, `${label}: the panel and the balance cache must agree`).toBe(outstanding);
    expect(guard.minted * scale, `${label}: the guard and the admin panel must read one number`).toBe(panel);
    return guard;
  };

  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before this drive.`);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-mint-cap-"));
    testDb = await provisionTestDb();
    await waitForPortFree(PORT);
    child = spawn(process.execPath, [DIST], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
        SCHEDULER_ENABLED: "0",
        DATA_DIR: dataDir,
        DATABASE_URL: testDb.url,
        ADMIN_PASSWORD: ADMIN,
        AUTH_TOKEN_SECRET: "mint-cap-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, // module-review-ok: a fixture webhook secret for a throwaway server on a scratch schema
        RESEND_API_KEY: "",
        ANTHROPIC_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => logs.push(String(d)));
    child.stderr?.on("data", (d) => logs.push(String(d)));

    const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s:\n${logs.join("")}`);
      }
      try {
        if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 400));
    }

    const boot = await call("POST", "/api/admin/bootstrap", {
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Cap Founder",
    }, null);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: ADMIN }, null);
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();
    founderId = String((await call("GET", "/api/profile", undefined, founderToken)).json?.id ?? "");
    expect(founderId).toBeTruthy();

    const reg = await call("POST", "/api/auth/register", {
      name: "Ora", email: `ora-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(reg.status, `Ora must register: ${reg.text.slice(0, 200)}`).toBe(200);
    oraToken = String(reg.json?.token ?? "");
    oraId = String(reg.json?.user?.id ?? "");
    expect(oraId).toBeTruthy();

    // Bo is the SECOND STEWARD, so the co-signed approval, which is the third
    // door that meets the guard, can actually be driven.
    const bo = await call("POST", "/api/auth/register", {
      name: "Bo", email: `bo-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(bo.status, `Bo must register: ${bo.text.slice(0, 200)}`).toBe(200);
    boToken = String(bo.json?.token ?? "");
    boId = String(bo.json?.user?.id ?? "");
    expect((await call("PUT", `/api/admin/users/${boId}/role`, { role: "admin" }, founderToken)).status).toBe(200);

    // Stays ships OFF. Every door this file drives mounts behind it.
    const on = await call("PUT", "/api/admin/modules/stays/lifecycle", { lifecycle: "public" }, founderToken);
    expect(on.status, `stays must turn on: ${on.text.slice(0, 200)}`).toBe(200);
    expect((await call("PUT", "/api/admin/modules/exchange/lifecycle", { lifecycle: "public" }, founderToken)).status).toBe(200);

    // A second steward is not what this file is about, so the co-sign door
    // stays shut and every hand-mint below decides in one call.
    await setVar("ledger.admin_mint_cosign_over", "0");

    const acc = await call("POST", "/api/admin/stays/accommodations", {
      name: "The Barn", capacity: 2,
    }, founderToken);
    expect(acc.status, `accommodation: ${acc.text.slice(0, 200)}`).toBe(200);
    roomId = String(acc.json?.id ?? acc.json?.accommodation?.id ?? "");
    expect(roomId, `the room must have an id: ${acc.text.slice(0, 300)}`).toBeTruthy();

    const tokens = await call("GET", "/api/admin/tokens", undefined, founderToken);
    const def = (tokens.json?.tokens ?? []).find((t: any) => t.slug === CREDIT);
    expect(def, "stay-credit is registered at boot").toBeTruthy();
    scale = 10 ** Number(def.decimals ?? 0);
  }, 240_000);

  afterAll(async () => {
    child?.kill();
    await testDb?.drop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /**
   * THE REPORT'S SEQUENCE, STEP FOR STEP.
   *
   * start 0, three comps of 100, the member sleeps through all 300, one more
   * issue of 300. The report measured guard 600 against panel 300 at the end.
   * Here the two must be one number at every step.
   */
  it("reads the same number as the admin panel at every step of the report's sequence", async () => {
    await setVar("ledger.admin_mint_cycle_cap", "100000");
    const start = await bothAgree("start");
    const grossStart = await grossOut();

    for (const n of [1, 2, 3]) {
      const comp = await call("POST", "/api/admin/stays/comp", {
        userId: oraId, credits: 100, note: `issue ${n}`,
      }, founderToken);
      expect(comp.status, `comp ${n}: ${comp.text.slice(0, 200)}`).toBe(200);
    }
    const afterIssues = await bothAgree("three issues of 100");
    expect(afterIssues.minted).toBe(start.minted + 300);

    // The member spends the lot, and the sink IS the faucet. One night at a
    // rate of 300, posted through the same code path the nightly job runs.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await testDb!.conn.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on, autopay, rate_snapshot_credits, rate_snapshot_token, audience_snapshot) " +
        "VALUES ('stay-mintcap-1', ?, ?, 'active', ?, 1, ?, ?, 'member')",
      [oraId, roomId, yesterday, 300 * scale, CREDIT],
    );
    const nights = await call("POST", "/api/admin/stays/post-nights", {}, founderToken);
    expect(nights.status, `post-nights: ${nights.text.slice(0, 200)}`).toBe(200);
    expect(Number(nights.json?.posted ?? 0), "one night must have been charged").toBe(1);

    const afterSpend = await bothAgree("member spends all 300");
    // THE ASSERTION THE OLD COUNTER FAILED. A spend returns credits to the
    // faucet, so the cycle's issuance falls. It could only rise before.
    expect(afterSpend.minted).toBe(start.minted);
    expect(afterSpend.minted).toBeLessThan(afterIssues.minted);
    // And the gross figure the old guard read has not moved, which is what
    // makes this a measurement of the fix and not of the fixture.
    expect(await grossOut()).toBe(grossStart + 300 * scale);

    const reissue = await call("POST", "/api/admin/stays/comp", {
      userId: oraId, credits: 300, note: "re-issue",
    }, founderToken);
    expect(reissue.status, `re-issue: ${reissue.text.slice(0, 200)}`).toBe(200);

    const afterReissue = await bothAgree("re-issue 300");
    expect(afterReissue.minted).toBe(start.minted + 300);
    // The old counter's number at this exact point, the report's 600 against
    // the panel's 300.
    expect(await grossOut()).toBe(grossStart + 600 * scale);
  }, 120_000);

  /**
   * A LAWFUL REVERSAL LOWERS THE CYCLE'S FIGURE.
   *
   * The report named this as its own defect: reversals post from the member
   * toward the faucet, the old SUM subtracted nothing, so the counter was
   * monotone inside a cycle and no lever cleared it. Under the subtraction it
   * resolves, and this asserts it instead of assuming it.
   */
  it("lets a lawful reversal lower the cycle's issuance figure", async () => {
    // Prices arrive as WHOLE tokens and `priceToStored` converts them, so 50
    // here is fifty credits a night at any scale. Both audiences are posted
    // because `stayAudienceFor` decides which one this member reads.
    const priced = await call("PUT", `/api/admin/stays/accommodations/${roomId}/prices`, {
      prices: [
        { tokenType: CREDIT, audience: "member", amountMinor: 50 },
        { tokenType: CREDIT, audience: "guest", amountMinor: 50 },
      ],
    }, founderToken);
    expect(priced.status, `prices: ${priced.text.slice(0, 300)}`).toBe(200);
    const before = (await guardView()).minted;

    const bought = await call("POST", "/api/admin/stays/purchases/manual", {
      userId: oraId, accommodationId: roomId, nights: 2, amountMinor: 0, audience: "member",
    }, founderToken);
    expect(bought.status, `manual purchase: ${bought.text.slice(0, 300)}`).toBe(200);
    const orderId = String(bought.json?.id ?? bought.json?.purchase?.id ?? "");
    expect(orderId, `the purchase must have an id: ${bought.text.slice(0, 300)}`).toBeTruthy();

    const afterBuy = (await guardView()).minted;
    expect(afterBuy, "a purchase issues, so the figure rises").toBe(before + 100);

    const refund = await call("POST", `/api/admin/stays/purchases/${orderId}/refund`, {}, founderToken);
    expect(refund.status, `refund: ${refund.text.slice(0, 300)}`).toBe(200);

    const afterRefund = (await guardView()).minted;
    // THE ASSERTION. The reversal is a lever on the counter, which the old
    // monotone SUM did not have.
    expect(afterRefund).toBe(before);
    expect(afterRefund).toBeLessThan(afterBuy);
    // The reversal really did post toward the faucet.
    const reversals = await rowsFor("payment_reversal");
    expect(reversals.some((r) => r.to_account === "sys:mint" && Number(r.amount) === 100 * scale)).toBe(true);
  }, 120_000);

  /**
   * EVERY DOOR, AND THE COUNTER SEES EVERY ONE.
   *
   * Six writers reach `sys:mint` without meeting `mintCapGuard`. Under Rye's
   * ruling their issuance counts, so each one has to still write AND still
   * move the number. Two of the six share a source (`stay_purchase`), and
   * they are driven separately because they are different code paths: the
   * manual purchase route and the Stripe settle handler.
   */
  it("counts all six doors that never meet the guard, and each still writes", async () => {
    await setVar("ledger.admin_mint_cycle_cap", "100000");

    const step = async (label: string, source: string, expected: number, drive: () => Promise<void>) => {
      const before = (await guardView()).minted;
      const rowsBefore = (await rowsFor(source)).length;
      await drive();
      const rowsAfter = await rowsFor(source);
      expect(rowsAfter.length, `${label}: the door must have written a row`).toBe(rowsBefore + 1);
      const written = rowsAfter[rowsAfter.length - 1];
      expect(written.from_account, `${label}: the row leaves the mint faucet`).toBe("sys:mint");
      const after = (await guardView()).minted;
      expect(after - before, `${label}: the counter must see it`).toBe(expected);
    };

    await step("stays comp", "stay_comp", 40, async () => {
      const r = await call("POST", "/api/admin/stays/comp", { userId: oraId, credits: 40, note: "door 1" }, founderToken);
      expect(r.status, r.text.slice(0, 200)).toBe(200);
    });

    await step("stays adjust", "stay_manual_override", 15, async () => {
      const r = await call("POST", "/api/admin/stays/adjust", { userId: oraId, credits: 15, note: "door 2" }, founderToken);
      expect(r.status, r.text.slice(0, 200)).toBe(200);
    });

    await step("stays manual purchase", "stay_purchase", 100, async () => {
      const r = await call("POST", "/api/admin/stays/purchases/manual", {
        userId: oraId, accommodationId: roomId, nights: 2, amountMinor: 0, audience: "member",
      }, founderToken);
      expect(r.status, r.text.slice(0, 300)).toBe(200);
    });

    await step("Stripe stay-purchase settle", "stay_purchase", 50, async () => {
      const orderId = `sp-hook-${Date.now()}`;
      await testDb!.conn.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO stay_purchases (id, user_id, accommodation_id, nights, amount_minor, credits_granted, status) " +
          "VALUES (?, ?, ?, 1, 1000, ?, 'pending')",
        [orderId, oraId, roomId, 50 * scale],
      );
      const event = {
        id: `evt_${orderId}`,
        type: "checkout.session.completed",
        data: { object: { id: `cs_${orderId}`, payment_intent: `pi_${orderId}`, metadata: { module: "stays", orderId } } },
      };
      const payload = JSON.stringify(event);
      const at = Math.floor(Date.now() / 1000);
      const hook = await fetch(`${BASE}/api/webhooks/stripe`, { // module-review-ok: the test client dialling the built server on localhost
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": `t=${at},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${at}.${payload}`).digest("hex")}`,
        },
        body: payload,
      });
      expect(hook.status, "the settle webhook must be accepted").toBeLessThan(300);
    });

    // The two quest doors ride one consent, so they are driven together and
    // asserted apart.
    const beforeQuests = (await guardView()).minted;
    await testDb!.conn.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mint_rules (id, village_id, `trigger`, token_slug, amount, ceiling, recipient, enabled, effective_from_cycle) " +
        "VALUES ('mr-mintcap', 'local', 'quest.completed', ?, 25, 25, 'claimant', 1, 0) " +
        "ON DUPLICATE KEY UPDATE enabled = 1",
      [CREDIT],
    );
    const quest = await call("POST", "/api/admin/quests", {
      title: "Rebuild the swale", description: "Work exchange", gratitude: "10", stayCreditReward: 30, status: "Open",
    }, founderToken);
    expect(quest.status, `quest: ${quest.text.slice(0, 200)}`).toBe(200);
    const questId = String(quest.json?.id ?? "");
    const claim = await call("POST", `/api/game/quests/${questId}/claim`, {}, oraToken);
    expect(claim.status, `claim: ${claim.text.slice(0, 200)}`).toBe(200);
    const claimId = String(claim.json?.id ?? "");
    expect((await call("POST", `/api/game/quests/${questId}/submit`, {
      artifactUrl: "https://example.test/evidence", note: "Done",
    }, oraToken)).status).toBe(200);
    const consent = await call("POST", `/api/admin/quest-claims/${claimId}/consent`, {
      approve: true, amount: 10,
    }, founderToken);
    expect(consent.status, `consent: ${consent.text.slice(0, 300)}`).toBe(200);

    const workExchange = await rowsFor("quest_stay_reward");
    expect(workExchange.length, "the work-exchange release must have written").toBe(1);
    expect(Number(workExchange[0].amount)).toBe(30 * scale);
    const ruleMint = (await rowsFor("quest_consent")).filter((r) => r.from_account === "sys:mint");
    expect(ruleMint.length, "the mint rule on stay-credit must have written").toBe(1);
    expect(Number(ruleMint[0].amount)).toBe(25 * scale);

    const afterQuests = (await guardView()).minted;
    expect(afterQuests - beforeQuests, "both quest doors count").toBe(30 + 25);
  }, 180_000);

  /**
   * TWO WAYS OF NAMING THE FAUCETS, AGREEING BY COINCIDENCE.
   *
   * `GET /api/admin/tokens` derives its faucet set from `ledger_accounts.faucet
   * = 1`. `publicSupply` and the admin per-source breakdown in
   * `server/lib/economy.ts` name five accounts by hand instead. The two sets
   * are equal today and nothing makes them equal: a sixth faucet account would
   * drop silently out of both supply surfaces while the tokens route kept
   * counting it, and no error would say so anywhere.
   *
   * NOT FIXED HERE. The one-line fix is `SELECT id FROM ledger_accounts WHERE
   * faucet = 1` at both call sites, in a file two other lanes are working in.
   * This is the tripwire instead: the lane that adds the sixth faucet gets a
   * red pointing at the two hand-kept lists.
   */
  it("agrees with the hand-kept faucet list the supply surfaces use", async () => {
    const [rows] = await testDb!.conn.query<any[]>(
      "SELECT id FROM ledger_accounts WHERE faucet = 1 ORDER BY id",
    );
    const inDatabase = rows.map((r: any) => String(r.id)).sort();
    const byHand = [RECOGNITION_FAUCET, VOICE_MINT, MINT_FAUCET, LIBRARY_MINT, CYCLE_POOL_FAUCET].sort();
    expect(inDatabase, "a faucet the hand-kept list does not know about is invisible to two supply surfaces").toEqual(byHand);
  }, 60_000);

  /**
   * THE FOUR DOORS THAT DO MEET THE GUARD WRITE ONLY HAND SOURCES.
   *
   * `HAND_MINT_SOURCES` is what the refusal subtracts before it tells a
   * founder how much of the lunation came from somewhere other than an
   * admin's hand. Hardcoded, so it is asserted against the doors themselves:
   * a guarded door with a new source would otherwise be reported to a
   * founder as somebody else's issuance, quietly and wrongly.
   *
   * DOOR 4 IS 0181's CIRCLE TREASURY FUNDING and it is here because this
   * assertion went red when it landed, which is the tripwire working. Minting
   * a circle its treasury is a steward deciding to issue, so it belongs beside
   * the hand-mint instead of beside the stays doors nobody clicks.
   */
  it("holds the hand-mint source list against the four doors that meet the guard", async () => {
    await setVar("ledger.admin_mint_cycle_cap", "100000");
    const slug = "cap-probe";
    expect((await call("POST", "/api/admin/tokens", {
      slug, name: "Cap Probe", kind: "credit", transferable: false,
    }, founderToken)).status).toBe(200);

    // Door 1: treasury stocking.
    expect((await call("POST", "/api/admin/exchange/stock", {
      tokenSlug: slug, amount: 10,
    }, founderToken)).status).toBe(200);

    // Door 2: the hand-mint, decided in one call.
    await setVar("ledger.admin_mint_cosign_over", "0");
    expect((await call("POST", `/api/admin/tokens/${slug}/mint`, {
      toUserId: oraId, amount: 5, reason: "one steward alone",
    }, founderToken)).status).toBe(200);

    // Door 3: the same grant over the threshold, signed by a second steward.
    await setVar("ledger.admin_mint_cosign_over", "5");
    const raised = await call("POST", `/api/admin/tokens/${slug}/mint`, {
      toUserId: oraId, amount: 20, reason: "over what one steward may grant",
    }, founderToken);
    expect(raised.status, `raise: ${raised.text.slice(0, 300)}`).toBe(202);
    const approved = await call("POST", `/api/admin/mint-requests/${raised.json.requestId}/approve`, {}, boToken);
    expect(approved.status, `approve: ${approved.text.slice(0, 300)}`).toBe(200);
    await setVar("ledger.admin_mint_cosign_over", "0");

    // Door 4 (0181): a circle treasury funded from the same faucet.
    expect((await call("PUT", "/api/admin/modules/resources/lifecycle", {
      lifecycle: "public",
    }, founderToken)).status).toBe(200);
    const circle = await call("POST", "/api/admin/circles", { name: "Cap Probe Circle" }, founderToken);
    expect(circle.status, `circle: ${circle.text.slice(0, 300)}`).toBe(200);
    const circleId = String(circle.json?.id ?? "");
    const budget = await call("POST", "/api/admin/resources/budgets", {
      circleId, unit: `token:${slug}`, amountMinor: 100, mode: "treasury",
    }, founderToken);
    expect(budget.status, `budget: ${budget.text.slice(0, 300)}`).toBe(200);
    const funded = await call("POST", `/api/admin/resources/budgets/${budget.json.id}/fund`, {
      amountMinor: 7, note: "door 4", requestId: "mintcap-door-4",
    }, founderToken);
    expect(funded.status, `fund: ${funded.text.slice(0, 300)}`).toBe(200);

    const [rows] = await testDb!.conn.query<any[]>(
      "SELECT DISTINCT source FROM token_ledger WHERE from_account = 'sys:mint' AND token_type = ?",
      [slug],
    );
    const written = rows.map((r: any) => String(r.source)).sort();
    expect(written, "four guarded doors, and only the sources the refusal knows about").toEqual(
      [...HAND_MINT_SOURCES].sort(),
    );
  }, 180_000);

  /**
   * THE BOUNDARY, MEASURED EXACTLY AT THE CAP AND ONE PAST IT.
   *
   * Also the case the floor exists for: the credits spent back in the FIRST
   * case were issued in the same cycle, so they cancel; nothing here may buy
   * a founder room above the cap.
   */
  it("admits exactly the cap and refuses one past it", async () => {
    const issued = (await guardView()).minted;
    const cap = issued + 40;
    await setVar("ledger.admin_mint_cycle_cap", String(cap));

    const toTheEdge = await call("POST", `/api/admin/tokens/${CREDIT}/mint`, {
      toUserId: oraId, amount: 40, reason: "exactly the cap",
    }, founderToken);
    expect(toTheEdge.status, `at the cap: ${toTheEdge.text.slice(0, 300)}`).toBe(200);
    expect((await guardView()).minted, "the cap is now exactly used").toBe(cap);

    const onePast = await call("POST", `/api/admin/tokens/${CREDIT}/mint`, {
      toUserId: oraId, amount: 1, reason: "one past the cap",
    }, founderToken);
    expect(onePast.status, "one past the cap refuses").toBe(409);
    expect(String(onePast.json?.error ?? "")).toContain("mint cap");

    // And nothing was written by the refusal.
    expect((await guardView()).minted).toBe(cap);
  }, 120_000);

  /**
   * A RETURN OF LAST MOON'S CREDITS BUYS NO ROOM THIS MOON.
   *
   * The floor is the whole window decision. Issuance dated BEFORE the cycle
   * start, returned INSIDE it, must not drive the figure below zero: a
   * negative would hand a founder headroom above the cap that no cycle ever
   * issued. The backdating moves only `token_ledger.at`, so balances and
   * conservation stay exactly as the ledger wrote them.
   */
  it("floors the figure at zero when a return outruns this cycle's issuance", async () => {
    await setVar("ledger.admin_mint_cycle_cap", "100000");
    const comp = await call("POST", "/api/admin/stays/comp", {
      userId: oraId, credits: 500, note: "last moon's issue",
    }, founderToken);
    expect(comp.status, comp.text.slice(0, 200)).toBe(200);
    const issue = (await rowsFor("stay_comp")).filter((r) => Number(r.amount) === 500 * scale);
    expect(issue.length).toBe(1);
    // Two lunations back, which is before any plausible cycle start.
    await testDb!.conn.query( // module-review-ok: moving one row's timestamp is the whole point of this case
      "UPDATE token_ledger SET at = NOW() - INTERVAL 60 DAY WHERE id = ?",
      [issue[0].id],
    );

    const before = (await guardView()).minted;
    const back = await call("POST", "/api/admin/stays/adjust", {
      userId: oraId, credits: -500, note: "spent back this moon",
    }, founderToken);
    expect(back.status, `adjust back: ${back.text.slice(0, 200)}`).toBe(200);

    const after = (await guardView()).minted;
    expect(after, "a return can cancel this cycle's issuance and no more").toBe(Math.max(0, before - 500));
    expect(after, "and it can never go below zero").toBeGreaterThanOrEqual(0);

    // The proof that matters: with the figure at its floor, the cap still
    // admits exactly the cap and no more.
    await setVar("ledger.admin_mint_cycle_cap", String(after + 10));
    expect((await call("POST", `/api/admin/tokens/${CREDIT}/mint`, {
      toUserId: oraId, amount: 10, reason: "the last of the room",
    }, founderToken)).status).toBe(200);
    expect((await call("POST", `/api/admin/tokens/${CREDIT}/mint`, {
      toUserId: oraId, amount: 1, reason: "room the previous cycle would have bought",
    }, founderToken)).status).toBe(409);
  }, 120_000);

  /**
   * THE REFUSAL NAMES THE TRUE CAUSE.
   *
   * Rye accepted that a busy stays month can exhaust a founder's ability to
   * hand-mint. What he did not accept is that it arrive as a surprise, so the
   * sentence a founder meets has to say the issuance came from somewhere other
   * than their own hand, and name where.
   */
  it("tells a founder which doors spent the cap", async () => {
    await setVar("ledger.admin_mint_cycle_cap", "100000");
    const before = (await guardView()).minted;
    const comp = await call("POST", "/api/admin/stays/comp", {
      userId: oraId, credits: 60, note: "a busy month",
    }, founderToken);
    expect(comp.status, comp.text.slice(0, 200)).toBe(200);
    const now = (await guardView()).minted;
    expect(now).toBe(before + 60);
    await setVar("ledger.admin_mint_cycle_cap", String(now));

    const refused = await call("POST", `/api/admin/tokens/${CREDIT}/mint`, {
      toUserId: oraId, amount: 1, reason: "the founder's own hand",
    }, founderToken);
    expect(refused.status).toBe(409);
    const sentence = String(refused.json?.error ?? "");
    expect(sentence).toContain("mint cap");
    expect(sentence).toContain("already issued this lunation");
    // It names a door the founder did not open. The doors are read back off
    // the ledger rather than typed here, so this cannot pass by agreeing with
    // a list the test wrote.
    // The exclusion is HAND_MINT_SOURCES itself and no longer a copy of it.
    // Typed out, this list went stale the day a fourth guarded door landed,
    // and a stale exclusion here reports a guarded door as an unguarded one.
    const [others] = await testDb!.conn.query<any[]>(
      "SELECT DISTINCT source FROM token_ledger WHERE from_account = 'sys:mint' AND token_type = ? " +
        `AND source NOT IN (${HAND_MINT_SOURCES.map(() => "?").join(",")})`,
      [CREDIT, ...HAND_MINT_SOURCES],
    );
    expect(others.length, "the fixture must have issued through a door no admin opened").toBeGreaterThan(0);
    expect(others.some((r: any) => sentence.includes(String(r.source))), sentence).toBe(true);
    expect(sentence).toContain("no admin minted by hand");
    // And it says the consequence Rye accepted, so it cannot arrive as a
    // surprise: the cap is spendable by doors a steward never touches.
    expect(sentence).toContain("every door that issues");
  }, 120_000);

  /**
   * WHAT THE ADVERSARY COULD NOT BREAK, RE-RUN.
   *
   * Six consents fired together on one claim. The claim-keyed idempotency is
   * what makes this safe, and the counter's new subtraction must not have
   * moved it: exactly one recognition row and exactly one work-exchange row,
   * and the member paid once.
   */
  it("survives six concurrent consents on one claim with exactly two rows", async () => {
    await setVar("ledger.admin_mint_cycle_cap", "100000");
    await testDb!.conn.query("UPDATE mint_rules SET enabled = 0 WHERE id = 'mr-mintcap'"); // module-review-ok: the rule door is proven above; this case counts the two claim-keyed rows

    const quest = await call("POST", "/api/admin/quests", {
      title: "Clear the north path", description: "Work exchange", gratitude: "10", stayCreditReward: 20, status: "Open",
    }, founderToken);
    expect(quest.status, quest.text.slice(0, 200)).toBe(200);
    const questId = String(quest.json?.id ?? "");
    const claim = await call("POST", `/api/game/quests/${questId}/claim`, {}, oraToken);
    expect(claim.status, claim.text.slice(0, 200)).toBe(200);
    const claimId = String(claim.json?.id ?? "");
    expect((await call("POST", `/api/game/quests/${questId}/submit`, {
      artifactUrl: "https://example.test/evidence", note: "Done",
    }, oraToken)).status).toBe(200);

    const before = (await guardView()).minted;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        call("POST", `/api/admin/quest-claims/${claimId}/consent`, { approve: true, amount: 10 }, founderToken)),
    );
    // THE MONEY IS THE ASSERTION. Two rows, keyed on the claim, whatever the
    // concurrency, and the member's stay credits move once.
    const [rows] = await testDb!.conn.query<any[]>(
      "SELECT idempotency_key, token_type, amount FROM token_ledger WHERE idempotency_key IN (?, ?)",
      [`quest_consent:${claimId}`, `queststay:${claimId}`],
    );
    expect(rows.length, "one claim, two rows, whatever the concurrency").toBe(2);

    const after = (await guardView()).minted;
    expect(after - before, "the work exchange paid once").toBe(20);

    /*
     * WHAT THIS MEASURED AND DID NOT FIX. Two of the six answered 200 on this
     * machine, not one. The ledger still wrote two rows and the member was
     * still paid once, because both value legs are keyed on the claim, so the
     * duplicate lives in the RESPONSE and never in the money. It is a
     * check-then-act on the claim's own status in the consent route, which is
     * the quests surface and not this lane's, and it is reported rather than
     * quietly asserted away. The bound here is the honest one: at least one
     * steward is told the consent landed, and nobody is paid twice.
     */
    const accepted = results.filter((r) => r.status === 200).length;
    expect(accepted, "somebody must be told the consent landed").toBeGreaterThanOrEqual(1);
    expect(accepted, "and the duplicate is a response, so it cannot outnumber the callers").toBeLessThanOrEqual(6);
  }, 180_000);
});
