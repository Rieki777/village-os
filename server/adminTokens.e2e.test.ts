/**
 * THE TOKENS TAB, AND WHAT A MEMBER SEES AFTERWARDS.
 *
 * Everything an admin does to a token in Admin, The Game, Tokens ends up in
 * somebody's hands, so this file drives the admin surface over HTTP against
 * the BUILT `dist/index.js` and then reads the member's own pages back.
 *
 * Run `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_BOOT_DEADLINE_MS, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
/*
 * THE CLIENT'S OWN FORMATTER, imported into a server test on purpose.
 *
 * The defect this file's last case is about lived in the SEAM: the payload was
 * right about the number and silent about its scale, and the page was right
 * about how to render a scale it was never given. A test on either side alone
 * passes while a member reads 10000. So the assertion runs the real payload
 * through the real renderer and checks the string a member actually sees.
 */
import { formatTokenAmount } from "@/lib/tokenAmount";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[adminTokens] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. It is checked, not asserted.
 *
 * A hand-written survey used to live here, ending with RE-GREP BEFORE
 * TRUSTING THIS. Nobody re-grepped, the tree moved, and the paragraph went on
 * claiming the window was clear when it had not been for over a week. Worse,
 * every one of those surveys grepped for `process.pid %` and so never saw the
 * stub ports (GOOGLE_PORT, BARE_PORT, STUB_PORT) or the fixed 8127 that
 * actually caused a failure.
 *
 * `scripts/check-e2e-ports.mjs` is that survey, executable, run in CI. It
 * refuses any two windows in different files that overlap at all, any fixed
 * port, and anything reaching into Linux's ephemeral range. Change the number
 * below and it will tell you.
 */
const PORT = 6500 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "AdminTokens123!";
const PASSWORD = "OraTokens123!";
/** A slug nothing seeds, so every assertion here is about a token this file made. */
const SLUG = "qa-needle";

let child: ChildProcess | null = null;
let testDb: TestDb | undefined;
let dataDir = "";
const logs: string[] = [];

let founderToken = "";
let oraToken = "";
let oraId = "";
let boToken = "";
let boId = "";
let founderId = "";

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

describe.skipIf(!DB_CONFIGURED)("the tokens tab, and what a member sees afterwards", () => {
  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before this drive.`);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-admin-tokens-"));
    testDb = await provisionTestDb();

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
        AUTH_TOKEN_SECRET: "admin-tokens-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Tokens Founder",
    }, null);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: ADMIN }, null);
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();
    const me = await call("GET", "/api/profile", undefined, founderToken);
    founderId = String(me.json?.id ?? "");
    expect(founderId, "the founder must have an id").toBeTruthy();

    const reg = await call("POST", "/api/auth/register", {
      name: "Ora", email: `ora-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(reg.status, "Ora must register").toBe(200);
    oraToken = String(reg.json?.token ?? "");
    oraId = String(reg.json?.user?.id ?? "");
    expect(oraId, "Ora must have an id").toBeTruthy();

    // Bo is the SECOND STEWARD. A village with one admin has nobody to ask,
    // which is the whole subject of the co-signature cases below.
    const bo = await call("POST", "/api/auth/register", {
      name: "Bo", email: `bo-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(bo.status, "Bo must register").toBe(200);
    boToken = String(bo.json?.token ?? "");
    boId = String(bo.json?.user?.id ?? "");
    const promote = await call("PUT", `/api/admin/users/${boId}/role`, { role: "admin" }, founderToken);
    expect(promote.status, `Bo must become an admin: ${promote.text.slice(0, 200)}`).toBe(200);

    // The wallet page reads `/api/exchange`, which is behind the module gate.
    const ex = await call("PUT", "/api/admin/modules/exchange/lifecycle", { lifecycle: "public" }, founderToken);
    expect(ex.status, `exchange must turn on: ${ex.text.slice(0, 200)}`).toBe(200);
  }, 180_000);

  afterAll(async () => {
    child?.kill();
    await testDb?.drop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /**
   * QA3-M4. The operator's sentence was "I renamed our currency to Seeds and
   * my wallet still calls it qa3needle."
   *
   * The rename saves correctly. What went wrong is downstream: both pages a
   * member opens to read what they hold were keyed on the SLUG and rendered
   * the slug as though it were the name. The slug is history's identity and
   * deliberately never changes, so it can never be the village's word for its
   * own currency.
   *
   * The control matters as much as the assertion: the name is read before the
   * rename too, so a pass proves the pages follow the registry rather than
   * proving they happen to show a string.
   */
  it("renames a token, and the member's wallet follows on both surfaces", async () => {
    const made = await call("POST", "/api/admin/tokens", {
      slug: SLUG, name: "Needle", kind: "credit",
    }, founderToken);
    expect(made.status, `create: ${made.text.slice(0, 200)}`).toBe(200);

    const minted = await call("POST", `/api/admin/tokens/${SLUG}/mint`, {
      toUserId: oraId, amount: 25, reason: "so she holds some of it",
    }, founderToken);
    expect(minted.status, `mint: ${minted.text.slice(0, 200)}`).toBe(200);

    // CONTROL, before the rename: both pages carry the name it was created
    // with, so what follows is a measurement of the rename and not of a
    // hard-coded string.
    const walletBefore = await call("GET", "/api/wallet", undefined, oraToken);
    expect(walletBefore.status).toBe(200);
    expect(walletBefore.json?.ledger?.[SLUG]).toBe(25);
    expect(walletBefore.json?.tokenNames?.[SLUG]).toBe("Needle");

    const renamed = await call("PUT", `/api/admin/tokens/${SLUG}`, { name: "Seeds" }, founderToken);
    expect(renamed.status, `rename: ${renamed.text.slice(0, 200)}`).toBe(200);
    expect(renamed.json?.token?.name).toBe("Seeds");

    // The wallet section on the member's own profile.
    const wallet = await call("GET", "/api/wallet", undefined, oraToken);
    expect(wallet.status).toBe(200);
    expect(wallet.json?.ledger?.[SLUG], "the balance is untouched by a rename").toBe(25);
    expect(wallet.json?.tokenNames?.[SLUG], "and the village's word for it follows").toBe("Seeds");

    // The Exchange page, which is the one the operator was looking at.
    const exchange = await call("GET", "/api/exchange", undefined, oraToken);
    expect(exchange.status).toBe(200);
    expect(exchange.json?.mine?.balances?.[SLUG]).toBe(25);
    expect(exchange.json?.mine?.tokenNames?.[SLUG], "the Exchange follows too").toBe("Seeds");

    // The slug is history's identity and a rename must never move it. If this
    // ever fails, every ledger row written before the rename has been orphaned.
    expect(Object.keys(wallet.json?.ledger ?? {})).toContain(SLUG);
  });

  /**
   * THE SLUG FREEZES ONCE SET (Rye, 2026-08-30), AND SAYS SO.
   *
   * The route above only ever wrote the name column, so a `slug` in the body
   * was already ignored. Ignored is not refused. The caller got 200 and a
   * token still answering to the old key, which reads as "the rename worked"
   * from every side, and the next thing they build assumes it did.
   *
   * The test is written from the ledger's end rather than the route's,
   * because a 409 alone would pass even if the write had happened first: the
   * assertion that matters is that the balance minted under the old slug is
   * still readable under the old slug afterwards.
   */
  it("refuses to move a slug, and says why, while the balance stays readable", async () => {
    const held = await call("GET", "/api/wallet", undefined, oraToken);
    expect(held.json?.ledger?.[SLUG], "the fixture from the rename test is still here").toBe(25);

    const moved = await call("PUT", `/api/admin/tokens/${SLUG}`, { slug: "qa-moved", name: "Seeds" }, founderToken);
    expect(moved.status, `expected a refusal, got: ${moved.text.slice(0, 200)}`).toBe(409);
    // The refusal has to carry the reason. A bare 409 teaches the operator
    // nothing and gets retried with a different spelling.
    expect(String(moved.json?.error)).toMatch(/never changes/i);
    expect(String(moved.json?.error)).toMatch(/ledger row/i);

    // Nothing moved: the old slug still resolves, the new one was never made.
    const after = await call("GET", "/api/admin/tokens", undefined, founderToken);
    const slugs = (after.json?.tokens ?? []).map((t: any) => t.slug);
    expect(slugs).toContain(SLUG);
    expect(slugs).not.toContain("qa-moved");
    const wallet = await call("GET", "/api/wallet", undefined, oraToken);
    expect(wallet.json?.ledger?.[SLUG], "the balance is still keyed where it was written").toBe(25);

    // And the door the freeze leaves open is still open: a plain rename with
    // no slug in the body works, so this guard costs the founder nothing.
    const renamed = await call("PUT", `/api/admin/tokens/${SLUG}`, { name: "Seeds" }, founderToken);
    expect(renamed.status, `rename: ${renamed.text.slice(0, 200)}`).toBe(200);
    // An echo of the token's OWN slug is not an attempt to move it.
    const echoed = await call("PUT", `/api/admin/tokens/${SLUG}`, { slug: SLUG, name: "Seeds" }, founderToken);
    expect(echoed.status, `echo: ${echoed.text.slice(0, 200)}`).toBe(200);
  });

  /**
   * QA2-03. "The person who runs the software paid themselves and nobody had
   * to agree."
   *
   * The route had real guards and none of them looked at WHO the tokens were
   * going to, so a single admin could send any platform token to their own
   * account up to the per-cycle cap, per token. The sharp edge is
   * `village-voice`: under `governance.weight_mode = token` that balance IS
   * voting weight, so the scaffolding could mint itself the electorate.
   *
   * A self-grant is refused outright rather than co-signed. Two admins taking
   * turns is a thing no software rule can stop, so the rule that earns its
   * place is the one with no ceremony to game: you cannot pay yourself, ask
   * somebody else to.
   */
  it("refuses a self-grant outright, at any amount", async () => {
    const before = await call("GET", "/api/wallet", undefined, founderToken);
    const held = Number(before.json?.ledger?.[SLUG] ?? 0);

    const self = await call("POST", `/api/admin/tokens/${SLUG}/mint`, {
      toUserId: founderId, amount: 25, reason: "paying myself",
    }, founderToken);
    expect(self.status, `self-grant: ${self.text.slice(0, 200)}`).toBe(403);
    expect(String(self.json?.error ?? ""), "and says what to do instead").toMatch(/another|someone else|second/i);

    const after = await call("GET", "/api/wallet", undefined, founderToken);
    expect(Number(after.json?.ledger?.[SLUG] ?? 0), "not one token moved").toBe(held);

    // Under the cap, to somebody else, from the same admin, in the same
    // breath. Without this the refusal above could be minting being broken.
    const other = await call("POST", `/api/admin/tokens/${SLUG}/mint`, {
      toUserId: oraId, amount: 5, reason: "a control, to a different person",
    }, founderToken);
    expect(other.status, "an ordinary grant still works").toBe(200);
  });

  it("refuses the mint route to an ordinary member", async () => {
    const asMember = await call("POST", `/api/admin/tokens/${SLUG}/mint`, {
      toUserId: oraId, amount: 5, reason: "a member tries",
    }, oraToken);
    expect(asMember.status).toBe(401);
  });

  /**
   * The second half of the same finding: a single call of 101 went through
   * where the specification, eighteen days old and never built, said grants
   * over 100 need a second steward.
   *
   * The approval pins the AMOUNT, the TOKEN and the RECIPIENT, because an
   * approval that does not pin the amount is an approval of nothing. Every one
   * of those is read from the stored row and never from the approver's
   * payload.
   */
  it("holds a grant over the threshold until a second steward signs it", async () => {
    const before = Number((await call("GET", "/api/wallet", undefined, oraToken)).json?.ledger?.[SLUG] ?? 0);

    const raised = await call("POST", `/api/admin/tokens/${SLUG}/mint`, {
      toUserId: oraId, amount: 101, reason: "over the stated threshold",
    }, founderToken);
    expect(raised.status, `raise: ${raised.text.slice(0, 200)}`).toBe(202);
    expect(raised.json?.pending, "the answer says plainly that nothing has moved").toBe(true);
    const requestId = String(raised.json?.requestId ?? "");
    expect(requestId, "and names the record").toBeTruthy();

    // NOTHING MOVED. A pending grant that quietly credited would be worse
    // than no rule at all.
    expect(
      Number((await call("GET", "/api/wallet", undefined, oraToken)).json?.ledger?.[SLUG] ?? 0),
      "a raised grant credits nobody",
    ).toBe(before);

    // The person who asked cannot be the person who agrees.
    const selfSign = await call("POST", `/api/admin/mint-requests/${requestId}/approve`, {}, founderToken);
    expect(selfSign.status, `self sign-off: ${selfSign.text.slice(0, 200)}`).toBe(409);
    expect(
      Number((await call("GET", "/api/wallet", undefined, oraToken)).json?.ledger?.[SLUG] ?? 0),
      "and a refused sign-off credits nobody either",
    ).toBe(before);

    // A member who is not an admin cannot sign it either.
    expect((await call("POST", `/api/admin/mint-requests/${requestId}/approve`, {}, oraToken)).status).toBe(401);

    // Both stewards can see what is waiting, which is what makes this a record
    // rather than a queue only its author knows about.
    const waiting = await call("GET", "/api/admin/mint-requests", undefined, boToken);
    expect(waiting.status).toBe(200);
    const mine = (waiting.json?.requests ?? []).find((r: any) => r.id === requestId);
    expect(mine, "the pending grant is on the list").toBeTruthy();
    expect(mine.amount).toBe(101);
    expect(mine.tokenSlug).toBe(SLUG);
    expect(mine.status).toBe("pending");

    // THE SECOND STEWARD SIGNS.
    const signed = await call("POST", `/api/admin/mint-requests/${requestId}/approve`, {}, boToken);
    expect(signed.status, `sign-off: ${signed.text.slice(0, 200)}`).toBe(200);
    expect(
      Number((await call("GET", "/api/wallet", undefined, oraToken)).json?.ledger?.[SLUG] ?? 0),
      "and exactly the amount that was approved is credited",
    ).toBe(before + 101);

    // THE RECORD NAMES THE SECOND PERSON, THE AMOUNT AND THE TOKEN.
    const after = await call("GET", "/api/admin/mint-requests", undefined, founderToken);
    const row = (after.json?.requests ?? []).find((r: any) => r.id === requestId);
    expect(row.status).toBe("approved");
    expect(row.requestedBy).toBe(founderId);
    expect(row.decidedBy, "who the second was").toBe(boId);
    expect(row.decidedAt, "when they agreed").toBeTruthy();
    expect(row.amount, "the exact amount they agreed to").toBe(101);
    expect(row.tokenSlug, "and which token").toBe(SLUG);
    expect(row.toUserId, "and who it went to").toBe(oraId);

    // Signing it again mints nothing. A record that can be replayed is not a
    // record of one decision.
    const twice = await call("POST", `/api/admin/mint-requests/${requestId}/approve`, {}, boToken);
    expect(twice.status, `second sign-off: ${twice.text.slice(0, 200)}`).toBe(409);
    expect(
      Number((await call("GET", "/api/wallet", undefined, oraToken)).json?.ledger?.[SLUG] ?? 0),
      "and the balance does not move twice",
    ).toBe(before + 101);
  });

  /**
   * A raised grant is spoken for. Without this, an admin who cannot mint one
   * over the cap in a single call can raise a hundred requests just under it
   * and hold a hundred times the cap, waiting for one signature each.
   */
  it("counts a grant that is waiting against the per-cycle cap", async () => {
    const cap = Number((await call("GET", "/api/admin/tokens", undefined, founderToken)).json?.mintCapPerCycle ?? 0);
    expect(cap, "the cap is a real number").toBeGreaterThan(0);

    const raised = await call("POST", `/api/admin/tokens/${SLUG}/mint`, {
      toUserId: oraId, amount: cap - 500, reason: "nearly all of it, and not yet minted",
    }, founderToken);
    expect(raised.status, `raise: ${raised.text.slice(0, 200)}`).toBe(202);
    const requestId = String(raised.json?.requestId ?? "");

    const overflow = await call("POST", `/api/admin/tokens/${SLUG}/mint`, {
      toUserId: boId, amount: 600, reason: "the waiting grant must be spoken for",
    }, founderToken);
    expect(overflow.status, `overflow: ${overflow.text.slice(0, 200)}`).toBe(409);

    // Declining gives the room back, so a mistaken request is not a lock on
    // the village's own cap until the moon turns.
    const declined = await call("POST", `/api/admin/mint-requests/${requestId}/decline`, {
      reason: "not this moon",
    }, boToken);
    expect(declined.status, `decline: ${declined.text.slice(0, 200)}`).toBe(200);

    const now = await call("POST", `/api/admin/tokens/${SLUG}/mint`, {
      toUserId: boId, amount: 600, reason: "the room came back",
    }, founderToken);
    expect(now.status, `after the decline: ${now.text.slice(0, 200)}`).toBe(202);
    await call("POST", `/api/admin/mint-requests/${String(now.json?.requestId)}/decline`, {
      reason: "tidying up after the case",
    }, boToken);
  });

  /**
   * A MEMBER WHO HOLDS TEN VILLAGE VOICE READS TEN. EVERYWHERE.
   *
   * `token_balances.balance` is an INT, so a token with decimals stores MINOR
   * units. Village Voice carries decimals 3, so ten Voice is 10000 on the row.
   * `loadStanding` has always shipped `decimals` and the profile chip has
   * always divided, so that chip read 10. `/api/wallet` and `/api/exchange`
   * shipped the row with no scale at all, and the wallet and the Tokens page
   * printed it: 10000. Same member, same second, two answers, and the wallet
   * is the one they believe.
   *
   * WHAT THIS ASSERTS, and why it is not an assertion about a payload key.
   * `expect(json.tokenDecimals["village-voice"]).toBe(3)` would pass against a
   * page that ignores the field, which is exactly the state this fix started
   * from. So every check below ends in the STRING a member reads, produced by
   * the same `formatTokenAmount` the wallet card calls.
   *
   * The control is the last two lines: the same balance formatted at scale 0,
   * which is what every one of these surfaces did before, reads "10000". If
   * the payloads stop carrying `decimals`, `decimals ?? 0` makes every
   * assertion above collapse onto that control and this case fails.
   *
   * THE AMOUNT IS IN MINOR UNITS because `POST /api/admin/tokens/:slug/mint`
   * takes ledger units, not human ones. The ROUTE still does, deliberately:
   * what changed since this was written is the admin SCREEN, which now
   * converts what a steward types before it posts, so nobody types 10 and
   * moves a hundredth. The handoff this comment recorded is taken.
   */
  it("shows ten Village Voice as ten on the wallet, the Exchange and the ledger", async () => {
    const VOICE = "village-voice";
    const TEN = 10_000; // ten Voice, in the thousandths the ledger stores

    // Seeded by `seedEconomy` at boot, with decimals 3. If this ever fails the
    // village has no voice token and the rest of the case is meaningless.
    const registry = await call("GET", "/api/admin/tokens", undefined, founderToken);
    const voiceRow = (registry.json?.tokens ?? []).find((t: any) => t.slug === VOICE);
    expect(voiceRow, "the village voice token is seeded at boot").toBeTruthy();
    expect(voiceRow.decimals, "and it is the one token that rides in thousandths").toBe(3);

    /*
     * MINTED OUTRIGHT, and it used to go through the two-steward flow here.
     *
     * `ledger.admin_mint_cosign_over` defaults to 100 and was compared raw
     * against a ledger amount, so for the one token that carries decimals it
     * meant a tenth of a Voice, and TEN sailed over it. Both hand-mint dials
     * are WHOLE tokens now, so the same 100 means a hundred Voice and a grant
     * of ten is what it reads like: small, and one steward's to make.
     *
     * NO COVERAGE IS LOST. The two-steward flow has three cases of its own
     * above, on tokens with no decimals where the dial's meaning did not
     * move: "holds a grant over the threshold until a second steward signs
     * it" and the two around it. This case was never about co-signing. It is
     * about what a member READS, and the raise was scaffolding to get a
     * balance in place.
     */
    const raised = await call("POST", `/api/admin/tokens/${VOICE}/mint`, {
      toUserId: oraId, amount: TEN, reason: "ten voice, so there is a real balance to read",
    }, founderToken);
    expect(raised.status, `raise: ${raised.text.slice(0, 200)}`).toBe(200);

    // 1. /api/wallet — behind the send card and the on-chain card.
    const wallet = await call("GET", "/api/wallet", undefined, oraToken);
    expect(wallet.status).toBe(200);
    expect(wallet.json?.ledger?.[VOICE], "the ledger row is minor units and stays that way").toBe(TEN);
    expect(
      formatTokenAmount(Number(wallet.json?.ledger?.[VOICE]), Number(wallet.json?.tokenDecimals?.[VOICE] ?? 0)),
      "and what a member reads off it is ten",
    ).toBe("10");

    // 2. /api/exchange — the Tokens page grid AND the profile wallet card.
    const exchange = await call("GET", "/api/exchange", undefined, oraToken);
    expect(exchange.status).toBe(200);
    expect(exchange.json?.mine?.balances?.[VOICE]).toBe(TEN);
    expect(
      formatTokenAmount(Number(exchange.json?.mine?.balances?.[VOICE]), Number(exchange.json?.mine?.tokenDecimals?.[VOICE] ?? 0)),
      "the wallet is the number a member believes, and it says ten",
    ).toBe("10");

    // 3. /api/game/ledger — the balances block and the journey feed's rows.
    const led = await call("GET", "/api/game/ledger", undefined, oraToken);
    expect(led.status).toBe(200);
    const held = led.json?.balances?.[VOICE];
    expect(held?.balance).toBe(TEN);
    expect(formatTokenAmount(Number(held?.balance), Number(held?.decimals ?? 0))).toBe("10");
    const row = (led.json?.entries ?? []).find((e: any) => e.tokenType === VOICE);
    expect(row, "the mint left a line in her ledger").toBeTruthy();
    expect(row.amount, "which is also minor units").toBe(TEN);
    expect(
      formatTokenAmount(Math.abs(Number(row.amount)), Number(row.decimals ?? 0)),
      "and reads as ten in the feed",
    ).toBe("10");

    // 4. The data export, which is the member's own copy of all of it.
    const exported = await call("GET", "/api/profile/export", undefined, oraToken);
    expect(exported.status).toBe(200);
    expect(
      formatTokenAmount(Number(exported.json?.balances?.[VOICE]), Number(exported.json?.tokenDecimals?.[VOICE] ?? 0)),
      "the file she downloads says ten too",
    ).toBe("10");

    // THE CONTROL. This is the sentence the fix was written against: the same
    // balance, rendered with no scale, is what every surface above showed.
    expect(formatTokenAmount(TEN, 0)).toBe("10000");
    expect(formatTokenAmount(TEN, 3)).not.toBe("10000");
  });
});
