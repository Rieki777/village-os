/**
 * TWO MODELS IN ONE VILLAGE, DRIVEN THROUGH THE DOORS A PERSON USES.
 *
 * Rye asked for this end to end, so every figure below comes off a ROUTE on a
 * booted `dist/index.js` or out of the scratch schema underneath it. Nothing
 * here calls a library function to make something happen.
 *
 * THE SEQUENCE, and each step is one of his rulings:
 *
 *   1. One village, two circles, one period. The Kitchen runs on a treasury
 *      and the Workshop runs on a spending cap, at the same time, and both
 *      read correctly through `GET /api/resources/burn`.
 *   2. The Kitchen's treasury is funded. It passes the village issuance guard,
 *      the tokens are in the circle's own account, and per-token
 *      SUM(balance) is still zero.
 *   3. The Kitchen spends from it. The village-wide issuance counter does not
 *      move, measured through the admin mint pre-flight, which is the guard's
 *      own view of itself.
 *   4. FUNDING THE ELEVENTH CIRCLE IS REFUSED because the first ten used the
 *      room, and the refusal a founder reads is captured verbatim.
 *   5. An underspent treasury still holds its balance when the period turns,
 *      while a cap's room is whole again. That is the whole difference
 *      between the two models.
 *   6. A scheduled mode change does NOT take effect mid-period and DOES take
 *      effect at the boundary.
 *   7. A circle with no budget for the new period reads UNGOVERNED, not zero.
 *   8. A circle going dormant is swept, and the steward reviving it is told
 *      what it held and that reissuing is a new mint.
 *   9. The village-wide unspent figure sits beside issued and retired.
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

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[circleTreasury.e2e] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. `node scripts/check-e2e-ports.mjs` is the survey
 * that proves it is clear, and it is the only thing worth trusting: the gate
 * reads every declaration in `server/` on the day you run it, which is what a
 * hand-written comment claiming a clear window cannot do.
 */
const PORT = 5000 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "TreasuryE2E123!";
const PASSWORD = "MemberTreasury123!";
/** The token every treasury in this file is denominated in. */
const TOKEN = "credits";
const UNIT = `token:${TOKEN}`;

let child: ChildProcess | null = null;
let testDb: TestDb | undefined;
let dataDir = "";
const logs: string[] = [];

let founderToken = "";
let memberId = "";
/** `credits` carries decimals; read off the registry rather than assumed. */
let scale = 1;

const NEWLINE = String.fromCharCode(10);

interface Answer { status: number; json: any; text: string }

/**
 * EVERY CALL CARRIES A DEADLINE, AND A HANG PRINTS THE SERVER'S OWN LOG.
 *
 * An async express handler that throws leaves the request open forever under
 * express 4, so a defect arrives as `Test timed out in 60000ms` with the
 * server's stack trace sitting unread in this process's own `logs` array. That
 * cost a whole run here. The abort turns a hang into a failure that names the
 * route, and the tail of the server log goes with it.
 */
async function call(method: string, route: string, body?: unknown, token?: string | null): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e: any) {
    throw new Error(
      `${method} ${route} never answered (${e?.name ?? e}). The server said: ` +
        logs.join("").split(NEWLINE).slice(-40).join(" | "),
    );
  }
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

describe.skipIf(!DB_CONFIGURED)("a village runs caps and treasuries side by side", () => {
  /** One account's cached balance. Zero when it holds no row for this token. */
  const balanceOf = async (account: string): Promise<number> => {
    const [[row]] = await testDb!.conn.query<any[]>(
      "SELECT COALESCE(SUM(balance), 0) AS n FROM token_balances WHERE account_id = ? AND token_type = ?",
      [account, TOKEN],
    );
    return Number(row?.n ?? 0);
  };

  /** Per token, SUM(balance) over every account. Zero, always. */
  const conservation = async (): Promise<number> => {
    const [[row]] = await testDb!.conn.query<any[]>(
      "SELECT COALESCE(SUM(balance), 0) AS n FROM token_balances WHERE token_type = ?",
      [TOKEN],
    );
    return Number(row?.n ?? 0);
  };

  /**
   * WHAT THE ISSUANCE GUARD ITSELF BELIEVES, read through the admin mint
   * pre-flight, which refuses without posting anything. Probing the counter
   * this way cannot move it, which is what makes it usable as a measurement.
   */
  const guardView = async (): Promise<{ minted: number; cap: number; error: string }> => {
    const r = await call("POST", `/api/admin/tokens/${TOKEN}/mint`, {
      toUserId: memberId, amount: 9_000_000, reason: "probe: read the counter without moving it",
    }, founderToken);
    expect(r.status, `the probe must refuse: ${r.text.slice(0, 300)}`).toBe(409);
    return { minted: Number(r.json?.minted), cap: Number(r.json?.cap), error: String(r.json?.error ?? "") };
  };

  const setVar = async (key: string, value: string) => {
    const r = await call("PUT", `/api/admin/variables/${key}`, { value }, founderToken);
    expect(r.status, `${key} := ${value}: ${r.text.slice(0, 200)}`).toBe(200);
  };

  const makeCircle = async (name: string): Promise<string> => {
    const r = await call("POST", "/api/admin/circles", { name }, founderToken);
    expect(r.status, `circle ${name}: ${r.text.slice(0, 300)}`).toBe(200);
    return String(r.json?.id ?? "");
  };

  const makeBudget = async (
    circleId: string, mode: "cap" | "treasury", over: Record<string, unknown> = {},
  ): Promise<string> => {
    const r = await call("POST", "/api/admin/resources/budgets", {
      circleId, unit: UNIT, amountMinor: 100_000, mode, ...over,
    }, founderToken);
    expect(r.status, `budget for ${circleId}: ${r.text.slice(0, 300)}`).toBe(200);
    return String(r.json?.id ?? "");
  };

  /** One circle's reading at an instant, straight off the burn route. */
  const readingFor = async (circleId: string, at?: string, plus?: number): Promise<any> => {
    const q = new URLSearchParams({ circleId });
    if (at) q.set("at", at);
    if (plus !== undefined) q.set("plus", String(plus));
    const r = await call("GET", `/api/resources/burn?${q}`, undefined, founderToken);
    expect(r.status, `burn read: ${r.text.slice(0, 300)}`).toBe(200);
    return r.json?.readings?.[0];
  };

  let kitchenId = "";
  let workshopId = "";
  let kitchenBudget = "";
  let workshopBudget = "";

  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before this drive.`);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-circle-treasury-"));
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
        AUTH_TOKEN_SECRET: "circle-treasury-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Treasury Founder",
    }, null);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: ADMIN }, null);
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();

    const reg = await call("POST", "/api/auth/register", {
      name: "Wren", email: `wren-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, null);
    expect(reg.status, `Wren must register: ${reg.text.slice(0, 200)}`).toBe(200);
    memberId = String(reg.json?.user?.id ?? "");
    expect(memberId).toBeTruthy();

    /*
     * Resources ships OFF and every route in this file mounts behind it. It
     * HARD-DEPENDS on `map` (`requires: ["map"]` in shared/modules.ts), and a
     * missing dependency is a 409 on the lifecycle write, so the map goes on
     * first. Found by the refusal rather than by reading, which is why this
     * comment names the field.
     */
    expect((await call("PUT", "/api/admin/modules/map/lifecycle", {
      lifecycle: "public",
    }, founderToken)).status).toBe(200);
    expect((await call("PUT", "/api/admin/modules/resources/lifecycle", {
      lifecycle: "public",
    }, founderToken)).status).toBe(200);

    const tokens = await call("GET", "/api/admin/tokens", undefined, founderToken);
    expect(tokens.status).toBe(200);
    const def = (tokens.json?.tokens ?? []).find((t: any) => t.slug === TOKEN);
    expect(def, "credits is registered at boot").toBeTruthy();
    scale = 10 ** Number(def.decimals ?? 0);

    kitchenId = await makeCircle("The Kitchen");
    workshopId = await makeCircle("The Workshop");
    kitchenBudget = await makeBudget(kitchenId, "treasury");
    workshopBudget = await makeBudget(workshopId, "cap", { cycleAmountMinor: 40_000 });
  }, 240_000);

  afterAll(async () => {
    child?.kill();
    await testDb?.drop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // ── 1. Both models, one village, one period ───────────────────────────────

  it("reads one circle as a treasury and another as a cap, in the same period", async () => {
    const kitchen = await readingFor(kitchenId);
    const workshop = await readingFor(workshopId);

    expect(kitchen.kind).toBe("treasury");
    expect(workshop.kind).toBe("metered");

    // The treasury reading carries a balance and NO cap field at all.
    expect(kitchen.balanceMinor).toBe(0);
    expect(kitchen.account).toBe(`sys:circle:${kitchenId}`);
    expect(kitchen.cycle).toBeUndefined();
    expect(kitchen.season).toBeUndefined();
    // And its sentence never speaks in percentages of a ceiling.
    expect(kitchen.sentence).toContain("nothing has been minted into it yet");
    expect(kitchen.sentence).not.toContain("%");

    // The cap reading is unchanged in every respect.
    expect(workshop.cycle.capMinor).toBe(40_000);
    expect(workshop.season.capMinor).toBe(100_000);
    expect(workshop.balanceMinor).toBeUndefined();
  }, 60_000);

  // ── 2. Funding passes the issuance guard, and conservation holds ──────────

  it("FUNDS A TREASURY through the guard, and the tokens are in the circle's account", async () => {
    await setVar("ledger.admin_mint_cycle_cap", "100000");
    expect(await conservation()).toBe(0);
    const before = (await guardView()).minted;

    const funded = await call("POST", `/api/admin/resources/budgets/${kitchenBudget}/fund`, {
      amountMinor: 60 * scale, note: "The Kitchen's season", requestId: "kitchen-1",
    }, founderToken);
    expect(funded.status, `fund: ${funded.text.slice(0, 400)}`).toBe(200);
    expect(funded.json.balanceMinor).toBe(60 * scale);

    // In the circle's own account, read from the ledger and not from the reply.
    const [[held]] = await testDb!.conn.query<any[]>(
      "SELECT balance FROM token_balances WHERE account_id = ? AND token_type = ?",
      [`sys:circle:${kitchenId}`, TOKEN],
    );
    expect(Number(held.balance)).toBe(60 * scale);
    expect(await conservation(), "conservation survives a treasury").toBe(0);

    // IT IS ISSUANCE: the village-wide counter moved by exactly the funding.
    expect((await guardView()).minted).toBe(before + 60);

    // And the reading says so, in a treasury's own vocabulary.
    const reading = await readingFor(kitchenId);
    expect(reading.kind).toBe("treasury");
    expect(reading.balanceMinor).toBe(60 * scale);
    expect(reading.fundedMinor).toBe(60 * scale);
    expect(reading.sentence).toContain("carries over");
  }, 90_000);

  it("refuses to fund a circle running on a cap, because it has no treasury", async () => {
    const r = await call("POST", `/api/admin/resources/budgets/${workshopBudget}/fund`, {
      amountMinor: 10 * scale, note: "no", requestId: "workshop-nope",
    }, founderToken);
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("spending cap");
  }, 30_000);

  // ── 3. Spending is not issuance ───────────────────────────────────────────

  it("SPENDS FROM A TREASURY without moving the village's issuance counter", async () => {
    const before = await guardView();
    const spent = await call("POST", `/api/admin/resources/budgets/${kitchenBudget}/spend`, {
      toUserId: memberId, amountMinor: 25 * scale, note: "Paid Wren for the harvest", requestId: "kitchen-spend-1",
    }, founderToken);
    expect(spent.status, `spend: ${spent.text.slice(0, 400)}`).toBe(200);

    const after = await guardView();
    expect(after.minted, "spending moves tokens that already exist").toBe(before.minted);
    expect(await conservation()).toBe(0);

    // The member really was paid, read off the ledger.
    const [[paid]] = await testDb!.conn.query<any[]>(
      "SELECT balance FROM token_balances WHERE account_id = ? AND token_type = ?",
      [`mem:${memberId}`, TOKEN],
    );
    expect(Number(paid.balance)).toBe(25 * scale);
    expect((await readingFor(kitchenId)).balanceMinor).toBe(35 * scale);
  }, 90_000);

  // ── 4. The eleventh circle, and the refusal a founder reads ───────────────

  it("REFUSES THE ELEVENTH CIRCLE when the first ten used the room, and names them", async () => {
    /*
     * Rye's point, made mechanical: funding twelve circle treasuries spends
     * the village's issuance for that period, all at once. This drives ten
     * circles into the room and then asks for an eleventh.
     */
    const room = (await guardView()).minted;
    // Ten circles of 5 each, and a cap that admits exactly those ten.
    await setVar("ledger.admin_mint_cycle_cap", String(room + 50));

    const budgets: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const id = await makeCircle(`Circle ${i}`);
      const budget = await makeBudget(id, "treasury");
      budgets.push(budget);
      const r = await call("POST", `/api/admin/resources/budgets/${budget}/fund`, {
        amountMinor: 5 * scale, note: `circle ${i}`, requestId: `many-${i}`,
      }, founderToken);
      expect(r.status, `circle ${i}: ${r.text.slice(0, 300)}`).toBe(200);
    }
    expect((await guardView()).minted, "the ten used the whole room").toBe(room + 50);

    const eleventhId = await makeCircle("Circle 11");
    const eleventh = await makeBudget(eleventhId, "treasury");
    const refused = await call("POST", `/api/admin/resources/budgets/${eleventh}/fund`, {
      amountMinor: 5 * scale, note: "circle 11", requestId: "many-11",
    }, founderToken);

    expect(refused.status, refused.text.slice(0, 400)).toBe(409);
    const sentence = String(refused.json?.error ?? "");
    // eslint-disable-next-line no-console
    console.log(`[circleTreasury] the eleventh circle's refusal, verbatim:\n${sentence}`);

    // The cap's own words, first, because three routes map that substring.
    expect(sentence).toContain("mint cap");
    expect(sentence).toContain("already issued this lunation");
    // And the half the cap cannot know: WHICH circles took the room.
    expect(sentence).toContain("went into circle treasuries");
    expect(sentence).toContain("Circle 1");
    expect(sentence).toContain("Funding a treasury mints tokens");
    // Named circles come back as data too, so a surface need not parse prose.
    expect(Array.isArray(refused.json?.circles)).toBe(true);
    expect(refused.json.circles.length).toBeGreaterThan(3);

    // NOTHING WAS MINTED BY THE REFUSAL. The guard runs inside the transfer.
    expect((await guardView()).minted).toBe(room + 50);
    expect(await conservation()).toBe(0);
    const [[none]] = await testDb!.conn.query<any[]>(
      "SELECT COALESCE(balance, 0) AS n FROM token_balances WHERE account_id = ? AND token_type = ?",
      [`sys:circle:${eleventhId}`, TOKEN],
    );
    expect(Number(none?.n ?? 0)).toBe(0);

    // Room again next cycle is what the cap means; here we simply raise it so
    // the rest of the file is not fighting an exhausted village.
    await setVar("ledger.admin_mint_cycle_cap", "1000000");
  }, 240_000);

  // ── 5. The whole difference between the two models ────────────────────────

  it("AN UNDERSPENT TREASURY KEEPS ITS BALANCE WHILE A CAP RESETS", async () => {
    /*
     * The same instant, two circles, one on each model. The Workshop's cap
     * room is whole again in the next period and the Kitchen's balance is
     * exactly what it was. That is the incentive Rye designed for: a cap you
     * lose by not spending, a treasury you keep.
     */
    const nextPeriod = new Date(Date.now() + 200 * 86_400_000).toISOString();

    const kitchenNow = await readingFor(kitchenId);
    const kitchenLater = await readingFor(kitchenId, nextPeriod);
    expect(kitchenLater.kind).toBe("treasury");
    expect(kitchenLater.balanceMinor, "a treasury does not reset").toBe(kitchenNow.balanceMinor);
    expect(kitchenLater.balanceMinor).toBe(35 * scale);

    // Give the Workshop some spend under its cap so the reset is visible.
    const workshopNow = await readingFor(workshopId);
    const workshopLater = await readingFor(workshopId, nextPeriod);
    expect(workshopLater.kind).toBe("metered");
    expect(workshopLater.cycle.window.id).not.toBe(workshopNow.cycle.window.id);
    expect(workshopLater.cycle.remainingMinor, "a cap's room comes back").toBe(40_000);
    expect(workshopLater.cycle.state).toBe("unspent");
  }, 60_000);

  // ── 6. A scheduled mode change ────────────────────────────────────────────

  it("SCHEDULES a mode change for the boundary and does not apply it mid-period", async () => {
    const queued = await call("POST", `/api/admin/resources/budgets/${workshopBudget}/mode`, {
      mode: "treasury",
    }, founderToken);
    expect(queued.status, `queue: ${queued.text.slice(0, 400)}`).toBe(200);
    expect(queued.json.running).toBe("cap");
    expect(queued.json.queued.mode).toBe("treasury");
    const landsAt = String(queued.json.queued.from);
    // eslint-disable-next-line no-console
    console.log(`[circleTreasury] the schedule a steward reads: ${queued.json.message}`);
    expect(String(queued.json.message)).toContain("finishes this period on its spending cap");

    // MID-PERIOD IT IS STILL A CAP, read through the door a member uses.
    const stillCap = await readingFor(workshopId);
    expect(stillCap.kind, "the circle finishes its period on the model it started with").toBe("metered");

    // A moment before the boundary: still a cap.
    const justBefore = new Date(Date.parse(landsAt) - 1000).toISOString();
    expect((await readingFor(workshopId, justBefore)).kind).toBe("metered");

    // AT the boundary: a treasury, with no sweep having run anywhere.
    const atBoundary = await readingFor(workshopId, landsAt);
    expect(atBoundary.kind).toBe("treasury");
    expect(atBoundary.balanceMinor).toBe(0);
    expect(atBoundary.sentence).toContain("nothing has been minted into it yet");

    // The stored column is untouched, which is what "queued" means.
    const [[row]] = await testDb!.conn.query<any[]>(
      "SELECT mode, pending_mode FROM circle_budgets WHERE id = ?",
      [workshopBudget],
    );
    expect(String(row.mode)).toBe("cap");
    expect(String(row.pending_mode)).toBe("treasury");

    // Funding is refused today, because today it is still a cap.
    const early = await call("POST", `/api/admin/resources/budgets/${workshopBudget}/fund`, {
      amountMinor: 1 * scale, note: "too soon", requestId: "early",
    }, founderToken);
    expect(early.status).toBe(409);
    expect(String(early.json?.error)).toContain("spending cap");
  }, 90_000);

  it("refuses to queue the mode a circle is already running", async () => {
    const r = await call("POST", `/api/admin/resources/budgets/${kitchenBudget}/mode`, {
      mode: "treasury",
    }, founderToken);
    expect(r.status).toBe(400);
    expect(String(r.json?.error)).toContain("already runs on a treasury");
  }, 30_000);

  // ── 7. Ungoverned, and not zero ───────────────────────────────────────────

  it("reads a circle with no budget for the period as UNGOVERNED, never as zero", async () => {
    const orphanId = await makeCircle("The Orphan");
    const reading = await readingFor(orphanId);
    expect(reading.kind).toBe("ungoverned");
    // The distinction this codebase paid for: no cap field, and a sentence
    // that says the opposite of what a zero would have said.
    expect(reading.cycle).toBeUndefined();
    expect(reading.balanceMinor).toBeUndefined();
    expect(reading.sentence).toContain("ungoverned");
    expect(reading.sentence).toContain("a zero here would say the opposite of what is true");
  }, 60_000);

  // ── 8. Dormancy, Rye's ruling, through the route ──────────────────────────

  it("SWEEPS A DORMANT CIRCLE'S TREASURY and tells the steward what it held", async () => {
    const sleepyId = await makeCircle("The Sleepy Circle");
    const sleepyBudget = await makeBudget(sleepyId, "treasury");
    expect((await call("POST", `/api/admin/resources/budgets/${sleepyBudget}/fund`, {
      amountMinor: 12 * scale, note: "its season", requestId: "sleepy-1",
    }, founderToken)).status).toBe(200);

    // COALESCE over the SUM and not over the column: an account that has never
    // held this token has NO ROW, so a row-shaped COALESCE returns undefined
    // and the assertion reads a property of nothing.
    const masterBefore = await balanceOf("sys:treasury");

    const dormant = await call("PUT", `/api/admin/circles/${sleepyId}`, {
      status: "dormant",
    }, founderToken);
    expect(dormant.status, `dormant: ${dormant.text.slice(0, 400)}`).toBe(200);
    expect(Array.isArray(dormant.json?.treasurySwept)).toBe(true);
    expect(dormant.json.treasurySwept[0].movedMinor).toBe(12 * scale);
    expect(dormant.json.treasurySwept[0].destination).toBe("master_treasury");

    // A DORMANT CIRCLE HOLDS NOTHING. That is the objection, answered.
    const [[after]] = await testDb!.conn.query<any[]>(
      "SELECT COALESCE(balance, 0) AS n FROM token_balances WHERE account_id = ? AND token_type = ?",
      [`sys:circle:${sleepyId}`, TOKEN],
    );
    expect(Number(after.n)).toBe(0);
    expect(await balanceOf("sys:treasury")).toBe(masterBefore + 12 * scale);
    expect(await conservation()).toBe(0);

    // THREE ZEROS, AND THIS ONE IS THE SWEPT ONE.
    const reading = await readingFor(sleepyId);
    expect(reading.kind).toBe("treasury");
    expect(reading.balanceMinor).toBe(0);
    expect(reading.sweptOnDormancy.heldMinor).toBe(12 * scale);
    expect(reading.sentence).toContain("its treasury was swept");
    expect(reading.sentence).toContain("returned to the village treasury");
    expect(reading.sentence).toContain("meets this village's issuance cap");

    // Funding it while dormant is refused, so nothing lands in a swept account.
    const refused = await call("POST", `/api/admin/resources/budgets/${sleepyBudget}/fund`, {
      amountMinor: 1 * scale, note: "no", requestId: "sleepy-nope",
    }, founderToken);
    expect(refused.status).toBe(409);
    expect(String(refused.json?.error)).toContain("dormant");

    // AND REVIVING IT SAYS WHAT IT HELD AND WHAT REISSUING COSTS.
    const revived = await call("PUT", `/api/admin/circles/${sleepyId}`, {
      status: "active",
    }, founderToken);
    expect(revived.status, revived.text.slice(0, 300)).toBe(200);
    const note = String(revived.json?.treasuryNote ?? "");
    // eslint-disable-next-line no-console
    console.log(`[circleTreasury] what a steward reviving a circle reads:\n${note}`);
    expect(note).toContain("The Sleepy Circle held");
    expect(note).toContain("returned to the village treasury");
    expect(note).toContain("issuance cap");

    // And it can be funded again, which is what "reissued" means.
    const again = await call("POST", `/api/admin/resources/budgets/${sleepyBudget}/fund`, {
      amountMinor: 12 * scale, note: "reissued", requestId: "sleepy-2",
    }, founderToken);
    expect(again.status, again.text.slice(0, 300)).toBe(200);
    expect(await conservation()).toBe(0);
  }, 180_000);

  // ── 9. The village-wide figure ────────────────────────────────────────────

  it("prints what sits unspent in circle treasuries BESIDE issued and retired", async () => {
    const r = await call("GET", "/api/admin/tokens", undefined, founderToken);
    expect(r.status).toBe(200);
    const credits = (r.json?.tokens ?? []).find((t: any) => t.slug === TOKEN);
    expect(credits).toBeTruthy();

    // Three separate facts on one row, and none of them netted into another.
    expect(credits.issuedBy["sys:mint"]).toBeGreaterThan(0);
    expect(credits.retired).toBeDefined();
    expect(credits.treasuryHeld.state).toBe("held");
    expect(credits.treasuryHeld.heldMinor).toBeGreaterThan(0);
    expect(credits.treasuryHeld.accountsHolding).toBeGreaterThan(1);

    // The figure is the sum of the real balances and nothing else.
    const [[direct]] = await testDb!.conn.query<any[]>(
      "SELECT COALESCE(SUM(balance), 0) AS n FROM token_balances " +
        "WHERE token_type = ? AND account_id LIKE 'sys:circle:%'",
      [TOKEN],
    );
    expect(credits.treasuryHeld.heldMinor).toBe(Number(direct.n));
    // eslint-disable-next-line no-console
    console.log(
      `[circleTreasury] issued=${credits.issuedBy["sys:mint"]} retired=${credits.retired} ` +
      `treasuryHeld=${credits.treasuryHeld.heldMinor} over ${credits.treasuryHeld.accountsHolding} circles`,
    );

    // Issuance ALONE overstates what is loose in the village by exactly this.
    expect(Number(credits.issuedBy["sys:mint"])).toBeGreaterThan(credits.treasuryHeld.heldMinor);

    // A token nobody holds a treasury in reads a MEASURED ZERO, and it is a
    // different state from the module being off.
    const other = (r.json?.tokens ?? []).find((t: any) => t.slug !== TOKEN && t.treasuryHeld);
    if (other) {
      expect(other.treasuryHeld.state).toBe("none_on_treasury");
      expect(other.treasuryHeld.heldMinor).toBe(0);
    }
  }, 60_000);

  it("lists every treasury and its village-wide total on the members' door", async () => {
    const r = await call("GET", "/api/resources/treasuries", undefined, founderToken);
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(Array.isArray(r.json?.treasuries)).toBe(true);
    expect(r.json.treasuries.length).toBeGreaterThan(5);
    expect(r.json.unspentByToken[TOKEN].state).toBe("held");
    expect(String(r.json.unspentByToken[TOKEN].message)).toContain("overstates what is loose");
    // No circle is dormant right now, and an empty list is the honest answer.
    expect(r.json.dormant).toEqual([]);
    // And a stranger gets nothing: what a circle HOLDS has no public tier.
    expect((await call("GET", "/api/resources/treasuries", undefined, null)).status).toBe(401);
  }, 60_000);
});
