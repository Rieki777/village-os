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
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

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
 * `0202` moved Village Credits to two decimals and this file was written when
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

    // Reports the last /health answer and when the server logged that it was
    // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
    await waitForHealth({ base: BASE, logs, child });

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

    /*
     * THIS VILLAGE HAS A STEWARD, and after 2026-09-15 that is setup rather
     * than decoration. Who confirms a redemption is DERIVED from who holds
     * `redemption.confirm`, and the count deliberately excludes admins, so a
     * fixture whose only key-holder is the founder's admin role is a village
     * with no steward: every ask below would be refused into the unbuilt vote
     * path. Measured, on the run that added this: nine cases went red with
     * that one sentence.
     *
     * Rowan holds it, and neither Wren nor Ash does, because two cases below
     * assert exactly that a member without the key is turned away.
     */
    const rowan = await call("POST", "/api/auth/register", {
      name: "Rowan", email: `rowan-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(rowan.status, `Rowan must register: ${rowan.text.slice(0, 200)}`).toBe(200);
    const rowanId = String(rowan.json?.user?.id ?? "");
    const roles = await call("GET", "/api/roles", undefined, founderToken);
    const steward = (roles.json ?? []).find((r: any) => r.id === "steward-circle");
    expect(steward, "the seeded Steward Circle must exist").toBeTruthy();
    const granted = await call("PUT", "/api/admin/roles/steward-circle/capabilities", {
      capabilities: [...(steward.capabilities ?? []), "redemption.confirm"],
      grantedEscalations: ["redemption.confirm"],
    }, founderToken);
    expect(granted.status, granted.text.slice(0, 300)).toBe(200);
    await call("PUT", `/api/admin/players/${rowanId}/stage`, { stageId: "member" }, founderToken);
    const seated = await call("POST", "/api/admin/roles/steward-circle/holders", { userId: rowanId, action: "add" }, founderToken);
    expect(seated.status, seated.text.slice(0, 300)).toBe(200);

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

  /*
   * RULING 22: REDEMPTION IS A MODULE THAT SHIPS OFF. This runs FIRST, before
   * anything here turns it on, so it proves the shipped default rather than a
   * state the file arranged. Every case below it needs the module on, which is
   * the correct setup for them and not a workaround.
   */
  it("ships off: its doors 404 until a founder turns it on, and withdraw still answers", async () => {
    const mine = await call("GET", "/api/redemptions", undefined, wrenToken);
    expect(mine.status).toBe(404);
    expect(mine.json?.error).toBe("module_disabled");
    expect((await call("POST", "/api/redemptions", { token: CREDITS, amount: 1, askedFor: "x" }, wrenToken)).status).toBe(404);
    expect((await call("GET", "/api/admin/redemptions", undefined, founderToken)).json?.error).toBe("module_disabled");
    // Withdraw is registered above the gate: it answers from its own handler,
    // and the same body a village with the module on would give.
    const withdraw = await call("POST", "/api/redemptions/rdm-nobody/withdraw", undefined, wrenToken);
    expect(withdraw.status).toBe(404);
    expect(withdraw.json?.error).toBe("no such redemption");

    const on = await call("PUT", "/api/admin/modules/redemption/lifecycle", { lifecycle: "members" }, founderToken);
    expect(on.status, on.text.slice(0, 300)).toBe(200);
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
      const [[held]] = await testDb!.conn.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT COALESCE(balance,0) AS n FROM token_balances WHERE account_id = 'sys:redemption-hold' AND token_type = ?",
        [CREDITS],
      );
      const [[retired]] = await testDb!.conn.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT COALESCE(balance,0) AS n FROM token_balances WHERE account_id = 'sys:redeemed' AND token_type = ?",
        [CREDITS],
      );
      // Straight out of `token_balances`, so minor with nothing in between.
      expect(Number(held.n)).toBe(0);
      expect(Number(retired.n)).toBe(500 * scale);

      // A second press destroys nothing.
      const again = await call("POST", `/api/redemptions/${id}/confirm`, { note: "again" }, founderToken);
      expect(again.status).toBe(409);
      const [[still]] = await testDb!.conn.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
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

  /*
   * RULING 23, DRIVEN THROUGH THE DOOR. Gates and tests do not see a refusal
   * path unless something drives one, so both money refusals are driven here
   * against the real server, with a POSITIVE CONTROL first: the same ask, at a
   * size the caps allow, must succeed. Without that control a refusal
   * assertion passes just as well when the rate is missing and nothing is
   * being measured at all.
   */
  it("prices a redemption, then refuses one below the floor and one over the cap", async () => {
    /*
     * THE COUNT CAP IS RAISED FIRST, and it is not incidental. This file's
     * setup allows five opens a moon and the cases above have spent most of
     * them, so without this the COUNT refusal answers every ask below and each
     * money assertion would be reading a sentence about a different rule. A
     * refusal test that passes for the wrong reason is worse than none.
     */
    await setVar("redemption.per_member_per_cycle", "50");
    await setVar("redemption.rate_source", "set");
    await setVar("redemption.rate_per_token", "2");
    await setVar("redemption.fee_pct", "10");
    await setVar("redemption.fee_fixed", "1");
    await mintTo(wrenId, 100);

    // The control: 20 credits at 2 a token is 40, which no cap refuses yet.
    const ok = await call("POST", "/api/redemptions", { token: CREDITS, amount: 20, askedFor: "a saw" }, wrenToken);
    expect(ok.status, `the priced ask must land: ${ok.text.slice(0, 300)}`).toBe(201);
    const money = ok.json?.redemption?.money;
    expect(money, "a priced redemption carries its money").toBeTruthy();
    // 40.00 gross, 10% is 4.00, plus the 1.00 flat fee, so 35.00 is received.
    expect(money.grossMinor).toBe(4000);
    expect(money.feeMinor).toBe(500);
    expect(money.netMinor).toBe(3500);
    expect((await call("POST", `/api/redemptions/${ok.json.redemption.id}/withdraw`, undefined, wrenToken)).status).toBe(200);

    // BELOW THE FLOOR. 5 credits comes to 10, under a floor of 25.
    await setVar("redemption.min_amount", "25");
    const small = await call("POST", "/api/redemptions", { token: CREDITS, amount: 5, askedFor: "a nail" }, wrenToken);
    expect(small.status, small.text.slice(0, 300)).toBe(409);
    expect(String(small.json?.error)).toContain("smallest redemption here is");
    await setVar("redemption.min_amount", "0");

    // OVER THE VILLAGE'S OWN CAP for the moon.
    await setVar("redemption.max_village_per_cycle", "30");
    const big = await call("POST", "/api/redemptions", { token: CREDITS, amount: 20, askedFor: "a lathe" }, wrenToken);
    expect(big.status, big.text.slice(0, 300)).toBe(409);
    expect(String(big.json?.error)).toContain("left to redeem this moon");
    await setVar("redemption.max_village_per_cycle", "0");

    // AN UNVALUED TOKEN IS REFUSED WHILE A CAP STANDS, and allowed once it is
    // lifted. This is the decision the design had to make out loud.
    await setVar("redemption.rate_per_token", "0");
    await setVar("redemption.max_per_request", "100");
    const unpriced = await call("POST", "/api/redemptions", { token: CREDITS, amount: 5, askedFor: "a day of help" }, wrenToken);
    expect(unpriced.status, unpriced.text.slice(0, 300)).toBe(409);
    expect(String(unpriced.json?.error)).toContain("no rate for this token");
    await setVar("redemption.max_per_request", "0");
    const services = await call("POST", "/api/redemptions", { token: CREDITS, amount: 5, askedFor: "a day of help" }, wrenToken);
    expect(services.status, services.text.slice(0, 300)).toBe(201);
    expect(services.json?.redemption?.money, "an unvalued request carries no figures").toBeNull();
    expect((await call("POST", `/api/redemptions/${services.json.redemption.id}/withdraw`, undefined, wrenToken)).status).toBe(200);

    await setVar("redemption.fee_pct", "0");
    await setVar("redemption.fee_fixed", "0");
    await setVar("redemption.rate_source", "exchange");
  }, 300_000);

  it("shows the member the village's own process, as text and never as markup", async () => {
    await setVar("redemption.process_text", "Call Suzy on 555 0101.\nShe sends a bank transfer: https://example.test/how <b>bold</b>");
    const mine = await call("GET", "/api/redemptions", undefined, wrenToken);
    expect(mine.status).toBe(200);
    // Served verbatim. The CLIENT renders it through LongText, which escapes by
    // construction, so the markup arrives as characters and never as HTML.
    expect(String(mine.json?.money?.processText)).toContain("<b>bold</b>");
    expect(String(mine.json?.money?.processText)).toContain("\n");
    await setVar("redemption.process_text", "");
  });

  /*
   * THE SNAPSHOT LAW, DRIVEN THROUGH THE DOORS.
   *
   * `held_account` has followed this law since 0201: what a request was opened
   * with is what it settles by. Ruling 23 puts MONEY on the row, which makes the
   * law load-bearing in a new way: a member agreed to a number, and a founder
   * editing a rate afterwards must not change what that member is owed, or what
   * the steward confirming it reads.
   *
   * So this opens one request, moves EVERY dial ruling 23 added, and then reads
   * the same request back from the member's door and the steward's queue.
   */
  it("freezes what a request is worth at the ask, however the dials move afterwards", async () => {
    await setVar("redemption.per_member_per_cycle", "50");
    await setVar("redemption.rate_source", "set");
    await setVar("redemption.rate_per_token", "2");
    await setVar("redemption.fee_pct", "10");
    await setVar("redemption.fee_fixed", "1");
    await setVar("redemption.process_text", "Call Suzy, she sends a bank transfer.");
    await mintTo(wrenId, 100);

    const asked = await call("POST", "/api/redemptions", { token: CREDITS, amount: 20, askedFor: "a kiln" }, wrenToken);
    expect(asked.status, asked.text.slice(0, 300)).toBe(201);
    const id = String(asked.json?.redemption?.id ?? "");
    const opened = asked.json?.redemption?.money;
    expect(opened.grossMinor).toBe(4000);
    expect(opened.feeMinor).toBe(500);
    expect(opened.netMinor).toBe(3500);

    // Every dial moves, including the ones that would have refused this ask.
    await setVar("redemption.rate_per_token", "10");
    await setVar("redemption.fee_pct", "50");
    await setVar("redemption.fee_fixed", "7");
    await setVar("redemption.currencies", "CHF");
    await setVar("redemption.min_amount", "500");
    await setVar("redemption.max_per_request", "600");
    await setVar("redemption.max_per_member_per_cycle", "600");
    await setVar("redemption.max_village_per_cycle", "600");
    await setVar("redemption.process_text", "Everything about this has changed.");

    // The member's own view of the open request: unmoved.
    const mine = await call("GET", "/api/redemptions", undefined, wrenToken);
    const row = (mine.json?.open ?? []).find((r: any) => r.id === id);
    expect(row, "the request must still be open").toBeTruthy();
    expect(row.money.grossMinor).toBe(4000);
    expect(row.money.feeMinor).toBe(500);
    expect(row.money.netMinor).toBe(3500);
    expect(row.processText).toBe("Call Suzy, she sends a bank transfer.");

    // And the steward's queue, which is what somebody confirms against.
    const queue = await call("GET", "/api/admin/redemptions", undefined, founderToken);
    const waiting = (queue.json?.redemptions ?? []).find((r: any) => r.id === id);
    expect(waiting.money.grossMinor).toBe(4000);
    expect(waiting.money.netMinor).toBe(3500);
    expect(waiting.processText).toBe("Call Suzy, she sends a bank transfer.");

    // Settling it destroys the TOKENS asked for, in full, whatever the fee said.
    const before = await balanceOf(wrenToken);
    const done = await call("POST", `/api/redemptions/${id}/confirm`, { note: "paid by transfer" }, founderToken);
    expect(done.status, done.text.slice(0, 300)).toBe(200);
    expect(done.json?.redemption?.money?.netMinor).toBe(3500);
    expect(await balanceOf(wrenToken)).toBe(before);

    await setVar("redemption.currencies", "");
    await setVar("redemption.min_amount", "0");
    await setVar("redemption.max_per_request", "0");
    await setVar("redemption.max_per_member_per_cycle", "0");
    await setVar("redemption.max_village_per_cycle", "0");
    await setVar("redemption.fee_pct", "0");
    await setVar("redemption.fee_fixed", "0");
    await setVar("redemption.rate_source", "exchange");
    await setVar("redemption.process_text", "");
  }, 300_000);

  it("refuses to switch off while a member is waiting, and serves withdraw once it is off", async () => {
    await mintTo(wrenId, 15);
    const asked = await call("POST", "/api/redemptions", { token: CREDITS, amount: 15, askedFor: "a lamp" }, wrenToken);
    expect(asked.status, asked.text.slice(0, 300)).toBe(201);
    const id = String(asked.json?.redemption?.id ?? "");

    // Invariant #13: open state blocks the switch, and the sentence counts it.
    const refused = await call("PUT", "/api/admin/modules/redemption/lifecycle", { lifecycle: "off" }, founderToken);
    expect(refused.status, refused.text.slice(0, 300)).toBe(409);
    expect(Number(refused.json?.count)).toBe(1);
    expect(String(refused.json?.description)).toContain("still waiting on an answer");

    expect((await call("POST", `/api/redemptions/${id}/withdraw`, undefined, wrenToken)).status).toBe(200);
    const off = await call("PUT", "/api/admin/modules/redemption/lifecycle", { lifecycle: "off" }, founderToken);
    expect(off.status, off.text.slice(0, 300)).toBe(200);

    expect((await call("GET", "/api/redemptions", undefined, wrenToken)).status).toBe(404);
    // Off, and the withdraw door still reaches its own handler: the row's own
    // answer (already withdrawn), never the module's 404.
    const again = await call("POST", `/api/redemptions/${id}/withdraw`, undefined, wrenToken);
    expect(again.status, again.text.slice(0, 300)).toBe(409);
    expect(again.json?.error).not.toBe("module_disabled");
  });
});
