/**
 * Redemption over HTTP, against the built server.
 *
 * `server/redemption.test.ts` proves the ledger properties against the module.
 * This proves the DOORS, which is a different claim: that a member can reach
 * this, that the capability really gates the confirmation, and that the
 * founder's own sequence works end to end through the routes a person uses.
 *
 * The case that matters most is the last one and it is his: Wren asks on
 * Monday, the village hands over the bicycle on Tuesday, Wren tries to spend
 * the same credits on Wednesday and is refused BY THE SEND ROUTE ITSELF, and a
 * steward confirms on Thursday. Both figures at the end are read back off HTTP
 * and out of the database.
 *
 * `credits` ships `transferable = 0`, so the send door is opened first through
 * the token registry. That is a real village act and not a fixture hack: the
 * whole point of the Wednesday step is that a member can spend what they hold
 * through an ordinary door, so the door has to be open for the case to mean
 * anything. With it shut, `sendRefusal` would refuse for its own reason and the
 * case would prove nothing about the hold.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_BOOT_DEADLINE_MS, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[redemption routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window: 32002 to 32401, which sits above every other window
 * in the tree (the highest ended at 32001) and below the 32768 ephemeral range.
 * `node scripts/check-e2e-ports.mjs` is the survey that proves it, and it is
 * the only thing worth believing on the day you run it. The first window this
 * file tried, 31100, overlapped two suites at once.
 */
/*
 * MOVED FROM 32002 AT INTEGRATION, and the width is deliberate.
 *
 * Two sibling lanes each picked 32002 while neither could see the other, the
 * same collision two migration numbers hit today and for the same reason: a
 * free-number answer is only true at the moment you check it, and a lane cannot
 * see a lane.
 *
 * Every 400-wide band below the ephemeral range is taken. My own gap scan said
 * four bands were free and the guard refused all four, because that scan
 * matched "PORT =" while the guard also counts PORT_A, STUB_PORT,
 * PORT_NO_TOKEN and the rest. That is the narrow-pattern failure this codebase
 * has now met five times in a day, committed while fixing an instance of it.
 *
 * So this takes the last band and narrows to 300, which ends at 32701 and stays
 * clear of 32768. The next suite to need a window has to widen the range or
 * reclaim one, and there is no room left to take quietly.
 */
const PORT = 32402 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "Redeem123!";
const PASSWORD = "OraRedeem123!";
const CREDITS = "credits";

let child: ChildProcess | null = null;
let testDb: TestDb | undefined;
let dataDir = "";
const logs: string[] = [];

let founderToken = "";
let wrenToken = "";
let wrenId = "";
let ashToken = "";
let ashId = "";

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

const setVar = async (key: string, value: string) =>
  call("PUT", `/api/admin/variables/${key}`, { value }, founderToken);

async function mintTo(userId: string, amount: number): Promise<void> {
  const r = await call(
    "POST",
    `/api/admin/tokens/${CREDITS}/mint`,
    { toUserId: userId, amount, reason: "seed for the redemption drive" },
    founderToken,
  );
  expect(r.status, `the mint must land: ${r.text.slice(0, 300)}`).toBe(200);
}

/**
 * MINOR units, which is what `/api/exchange` reports and what the ledger holds.
 * Read the door table above `scaleOfCredits` before comparing this to anything.
 */
async function balanceOf(token: string): Promise<number> {
  const r = await call("GET", "/api/exchange", undefined, token);
  expect(r.status).toBe(200);
  return Number(r.json?.mine?.balances?.[CREDITS] ?? 0);
}

/**
 * THE SCALE, OFF THE REGISTRY, AND THE DOOR TABLE THAT GOES WITH IT.
 *
 * `0184` moved Village Credits to two decimals and this file was written when
 * it carried none, where every door's number looked the same. They are not the
 * same, and the difference is not uniform, so there is no single multiplier to
 * apply down the file:
 *
 *   HUMAN   `POST /api/redemptions` (`toLedgerUnits` once, at the route),
 *           `POST /api/admin/tokens/:slug/mint`, and every `amount` the
 *           redemption queue and history report back (`fromLedgerUnits`).
 *   MINOR   `POST /api/wallet/send`, because the client converts before it
 *           posts and the route refuses to convert twice, and `balanceOf`
 *           above, because `/api/exchange` reports the ledger's own number.
 *
 * WHAT GETTING THAT BACKWARDS COST, here, in this file. The Wednesday step
 * asserts a send is REFUSED because the credits are held. It sent a bare 500,
 * which reached the send route as five credits, five were affordable against
 * the unheld remainder, the send SUCCEEDED, and the assertion passed anyway.
 * The positive control above it had the same shape: a bare 10 moved a tenth of
 * a credit to Ash and the control read green. So the one door the whole hold
 * design exists to shut was reporting itself shut while standing open.
 */
let creditScale = 0;
async function scaleOfCredits(): Promise<number> {
  if (creditScale) return creditScale;
  const r = await call("GET", "/api/admin/tokens", undefined, founderToken);
  expect(r.status, `the registry must answer: ${r.text.slice(0, 200)}`).toBe(200);
  const row = (r.json?.tokens ?? []).find((t: any) => t.slug === CREDITS);
  expect(row, "credits must be registered").toBeTruthy();
  creditScale = 10 ** Number(row.decimals ?? 0);
  return creditScale;
}

describe.skipIf(!DB_CONFIGURED)("the redemption doors", () => {
  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before this drive.`);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-redemption-"));
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
        AUTH_TOKEN_SECRET: "redemption-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Redeem Founder",
    }, null);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    founderToken = String((await call("POST", "/api/auth/set-password", { token: claim, password: ADMIN }, null)).json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();

    const wren = await call("POST", "/api/auth/register", {
      name: "Wren", email: `wren-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(wren.status, `Wren must register: ${wren.text.slice(0, 200)}`).toBe(200);
    wrenToken = String(wren.json?.token ?? "");
    wrenId = String(wren.json?.user?.id ?? "");

    const ash = await call("POST", "/api/auth/register", {
      name: "Ash", email: `ash-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(ash.status, `Ash must register: ${ash.text.slice(0, 200)}`).toBe(200);
    ashToken = String(ash.json?.token ?? "");
    ashId = String(ash.json?.user?.id ?? "");

    // The exchange module carries the balances read this file uses.
    expect((await call("PUT", "/api/admin/modules/exchange/lifecycle", { lifecycle: "public" }, founderToken)).status).toBe(200);
    // A self-grant is refused at any amount, so every mint here goes to
    // somebody else. That is the mint flow's own rule and this file obeys it.
    await setVar("ledger.admin_mint_cosign_over", "0");
    await setVar("redemption.per_member_per_cycle", "5");
  }, 300_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    await testDb?.drop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("tells a signed-out visitor nothing", async () => {
    expect((await call("GET", "/api/redemptions", undefined, null)).status).toBe(401);
    expect((await call("POST", "/api/redemptions", { token: CREDITS, amount: 1, askedFor: "x" }, null)).status).toBe(401);
  });

  it("offers a member the tokens this village redeems, and no others", async () => {
    const r = await call("GET", "/api/redemptions", undefined, wrenToken);
    expect(r.status).toBe(200);
    const slugs = (r.json?.tokens ?? []).map((t: any) => t.slug);
    expect(slugs).toContain(CREDITS);
    expect(slugs).not.toContain("gratitude");
    expect(slugs).not.toContain("equity");
    expect(slugs).not.toContain("voice");
    expect(r.json?.holds).toBe(true);
  });

  it("refuses a redemption of more than the member holds, in their own words", async () => {
    const r = await call("POST", "/api/redemptions", { token: CREDITS, amount: 10, askedFor: "cash" }, wrenToken);
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("You hold 0 Village Credits");
  });

  it("refuses a redemption with nothing asked for", async () => {
    await mintTo(wrenId, 50);
    const r = await call("POST", "/api/redemptions", { token: CREDITS, amount: 10, askedFor: "  " }, wrenToken);
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("Say what you would like these turned into");
  });

  it("keeps the queue away from a member who was given no key", async () => {
    const r = await call("GET", "/api/admin/redemptions", undefined, wrenToken);
    expect(r.status).toBe(401);
  });

  it(
    "carries the founder's own sequence end to end: ask, cannot spend, confirmed after the village paid",
    async () => {
      // Members cannot pass credits by default, and the Wednesday step needs a
      // door that really opens, so the village opens one.
      const opened = await call("PUT", `/api/admin/tokens/${CREDITS}`, { transferable: true }, founderToken);
      expect(opened.status, `sending must open: ${opened.text.slice(0, 200)}`).toBe(200);
      await mintTo(wrenId, 510);

      /*
       * A POSITIVE CONTROL BEFORE ANYTHING IS HELD.
       *
       * The Wednesday step below asserts that a send is REFUSED, and a refusal
       * assertion is worth nothing unless the same call succeeds when the
       * tokens are free: a shut door, a rate limit, a token left
       * non-transferable, or a typo in the body would all produce the same red
       * herring of a green. So ten credits go to Ash here, through the same
       * route with the same body shape, and they arrive.
       */
      const scale = await scaleOfCredits();
      const control = await call(
        "POST",
        "/api/wallet/send",
        { to: ashId, tokenType: CREDITS, amount: 10 * scale, note: "the control" },
        wrenToken,
      );
      expect(control.status, `the send door must really be open: ${control.text.slice(0, 300)}`).toBe(200);
      expect(await balanceOf(ashToken)).toBe(10 * scale);

      const before = await balanceOf(wrenToken);
      expect(before).toBeGreaterThanOrEqual(500 * scale);

      // MONDAY. Wren asks for 500 credits to become a bicycle.
      const asked = await call(
        "POST",
        "/api/redemptions",
        { token: CREDITS, amount: 500, askedFor: "a bicycle" },
        wrenToken,
      );
      expect(asked.status, asked.text.slice(0, 300)).toBe(201);
      const id = String(asked.json?.redemption?.id ?? "");
      expect(id).toBeTruthy();

      // TUESDAY. The bicycle changes hands off the platform. Nothing here.

      // WEDNESDAY. Wren tries to send the same credits to Ash through the
      // ordinary door. THIS is the step the whole design exists for.
      const sent = await call(
        "POST",
        "/api/wallet/send",
        // MINOR, and the same 500 whole credits the redemption above asked
        // for in HUMAN. Sending less than the hold would prove nothing.
        { to: ashId, tokenType: CREDITS, amount: 500 * scale, note: "for Ash" },
        wrenToken,
      );
      // THIS IS THE WHOLE CASE, and every assertion about the hold is placed
      // AFTER it on purpose. With the hold turned off this line is what goes
      // red, and the red then reads as the double spend it is instead of as a
      // missing field on a response.
      expect(sent.status, `the send must be refused: ${sent.text.slice(0, 300)}`).not.toBe(200);
      /*
       * THE MEMBER'S SENTENCE, NOT THE LEDGER'S, and the change is main's.
       *
       * This line read `toContain("insufficient")`, which is the raw ledger
       * refusal: `insufficient credits: "mem:..." holds N and cannot
       * overdraft`. `refusalForMember` in server/lib/ledger.ts now stands in
       * front of that and rewrites it, deliberately, so a member is never
       * shown an account id or the word overdraft. Asserting the raw form
       * would go green again on the day that rewriting broke, which is the
       * opposite of what this case wants.
       *
       * So both halves are asserted: the refusal is about funds, and the
       * account id does not reach the member.
       */
      expect(String(sent.json?.error ?? sent.text)).toContain("not enough to send");
      expect(String(sent.json?.error ?? sent.text)).not.toContain("mem:");
      // Ash still holds the control's ten and nothing more.
      expect(await balanceOf(ashToken)).toBe(10 * scale);

      expect(asked.json?.holds).toBe(true);
      expect(await balanceOf(wrenToken)).toBe(before - 500 * scale);
      const mine = await call("GET", "/api/redemptions", undefined, wrenToken);
      expect(Number(mine.json?.held?.[CREDITS] ?? 0)).toBe(500);

      // Wren cannot sign their own off, and the sentence says so.
      const self = await call("POST", `/api/redemptions/${id}/confirm`, { note: "I paid myself" }, wrenToken);
      expect(self.status).toBe(401);

      // Nor can Ash, who holds no key.
      expect((await call("POST", `/api/redemptions/${id}/confirm`, { note: "sure" }, ashToken)).status).toBe(401);

      // A confirmation with no reason is refused, following closeBallot.
      const bare = await call("POST", `/api/redemptions/${id}/confirm`, { note: "" }, founderToken);
      expect(bare.status).toBe(409);
      expect(String(bare.json?.error)).toContain("A decision with no stated reason is not a record");

      // THURSDAY. A steward confirms, and only now is anything destroyed.
      const done = await call(
        "POST",
        `/api/redemptions/${id}/confirm`,
        { note: "handed the bicycle over on Tuesday" },
        founderToken,
      );
      expect(done.status, done.text.slice(0, 300)).toBe(200);
      expect(done.json?.redemption?.state).toBe("confirmed");

      // The member's balance, read back off HTTP, and the retired figure, read
      // back off the admin panel's own route. Both MINOR: `retiredSupply`
      // returns the ledger's own units and `/api/admin/tokens` passes them
      // through without converting.
      expect(await balanceOf(wrenToken)).toBe(before - 500 * scale);
      const panel = await call("GET", "/api/admin/tokens", undefined, founderToken);
      expect(panel.status).toBe(200);
      const credits = (panel.json?.tokens ?? []).find((t: any) => t.slug === CREDITS);
      expect(Number(credits?.retired ?? 0)).toBe(500 * scale);

      // And the same two numbers straight out of the database.
      const [[held]] = await testDb!.conn.query<any[]>(
        "SELECT COALESCE(balance,0) AS n FROM token_balances WHERE account_id = 'sys:redemption-hold' AND token_type = ?",
        [CREDITS],
      );
      const [[retired]] = await testDb!.conn.query<any[]>(
        "SELECT COALESCE(balance,0) AS n FROM token_balances WHERE account_id = 'sys:redeemed' AND token_type = ?",
        [CREDITS],
      );
      // Straight out of `token_balances`, so minor with nothing in between.
      expect(Number(held.n)).toBe(0);
      expect(Number(retired.n)).toBe(500 * scale);

      // A second press destroys nothing.
      const again = await call("POST", `/api/redemptions/${id}/confirm`, { note: "again" }, founderToken);
      expect(again.status).toBe(409);
      const [[still]] = await testDb!.conn.query<any[]>(
        "SELECT COALESCE(balance,0) AS n FROM token_balances WHERE account_id = 'sys:redeemed' AND token_type = ?",
        [CREDITS],
      );
      expect(Number(still.n)).toBe(500 * scale);
    },
    420_000,
  );

  it("shows a steward the queue, with the member's name and the warnings that ride", async () => {
    await mintTo(wrenId, 60);
    const asked = await call("POST", "/api/redemptions", { token: CREDITS, amount: 60, askedFor: "a lathe" }, wrenToken);
    expect(asked.status, asked.text.slice(0, 300)).toBe(201);
    const id = String(asked.json?.redemption?.id ?? "");
    const q = await call("GET", "/api/admin/redemptions", undefined, founderToken);
    expect(q.status, q.text.slice(0, 300)).toBe(200);
    const row = (q.json?.redemptions ?? []).find((r: any) => r.id === id);
    expect(row, "the queue must carry the open redemption").toBeTruthy();
    expect(row.memberName).toBe("Wren");
    expect(row.askedFor).toBe("a lathe");
    expect(row.amount).toBe(60);
    // The warnings are an ARRAY on every row, including an empty one. A
    // missing field renders nothing on the steward's card and says nothing
    // about whether there was anything to say.
    expect(Array.isArray(row.warnings)).toBe(true);
    // This member has opened several this moon by now, so the frequency
    // warning is real rather than hypothetical, and it never blocks.
    expect(row.warnings.map((w: any) => w.key)).toContain("frequency");
    // Tidy up so the later cases start from a queue they own.
    expect((await call("POST", `/api/redemptions/${id}/withdraw`, undefined, wrenToken)).status).toBe(200);
  }, 300_000);

  it("gives the tokens back when a steward refuses, and tells the member why", async () => {
    await mintTo(wrenId, 40);
    const before = await balanceOf(wrenToken);
    const asked = await call("POST", "/api/redemptions", { token: CREDITS, amount: 40, askedFor: "a saw" }, wrenToken);
    expect(asked.status, asked.text.slice(0, 300)).toBe(201);
    const id = String(asked.json?.redemption?.id ?? "");
    // The ask was 40 HUMAN; the balance it moves is MINOR.
    expect(await balanceOf(wrenToken)).toBe(before - 40 * (await scaleOfCredits()));
    const no = await call("POST", `/api/redemptions/${id}/refuse`, { note: "the village has no saw to give" }, founderToken);
    expect(no.status, no.text.slice(0, 300)).toBe(200);
    expect(no.json?.released).toBe(true);
    expect(await balanceOf(wrenToken)).toBe(before);
    const mine = await call("GET", "/api/redemptions", undefined, wrenToken);
    const row = (mine.json?.history ?? []).find((r: any) => r.id === id);
    expect(row?.state).toBe("refused");
    expect(row?.decisionNote).toBe("the village has no saw to give");
  });

  it("lets a member take their own back, and the tokens come with them", async () => {
    await mintTo(wrenId, 25);
    const before = await balanceOf(wrenToken);
    const asked = await call("POST", "/api/redemptions", { token: CREDITS, amount: 25, askedFor: "a hat" }, wrenToken);
    expect(asked.status).toBe(201);
    const id = String(asked.json?.redemption?.id ?? "");
    expect(await balanceOf(wrenToken)).toBe(before - 25 * (await scaleOfCredits()));
    // Not somebody else's to withdraw.
    expect((await call("POST", `/api/redemptions/${id}/withdraw`, undefined, ashToken)).status).toBe(404);
    const back = await call("POST", `/api/redemptions/${id}/withdraw`, undefined, wrenToken);
    expect(back.status, back.text.slice(0, 300)).toBe(200);
    expect(await balanceOf(wrenToken)).toBe(before);
  });
});
