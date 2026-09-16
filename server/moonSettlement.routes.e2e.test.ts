/**
 * THE MOON ASKED, THE VILLAGE ANSWERED, AND THE VALUE MOVED. END TO END.
 *
 * Rye's instruction on 2026-09-05, in full: "after you build it, I want you to
 * do a whole end to end test, see if it posts the proposal, see if users are
 * able to vote on that proposal, and if it distributes the value all in a test
 * cycle to make sure this is all working."
 *
 * So the harm metric for this file is one sentence with four clauses, and every
 * one of them is driven against the BUILT server over HTTP:
 *
 *   A moon ends; a proposal naming exactly what each member would receive is
 *   posted without a person touching it; the members vote on it; and the value
 *   arrives in their wallets when it lands — and NONE of it arrives one moment
 *   before the village said yes.
 *
 * ── WHY THE LANDING IS NOT TRIGGERED BY THE CYCLE CLOSE ──────────────────────
 *
 * Every other governance e2e file in this repo lands a passed ballot by calling
 * `POST /api/admin/cycles/close`, because that route runs `applyDueGovernance`
 * at its tail. For every other subject that is harmless. For THIS one it would
 * destroy the test: the close settles due cycles itself, first, so the value
 * would arrive by the founder's button and the assertion at the end would go
 * green without the ballot having done anything at all. The test would be
 * evidence for a feature that does not work.
 *
 * `POST /api/admin/governance/land-due` lands and settles nothing, so when the
 * balances move at the end of Case 4 there is exactly one thing that can have
 * moved them.
 *
 * ── THE CASES RUN IN ORDER ───────────────────────────────────────────────────
 *
 * One village walks the whole path: a moon that ended, a proposal posted, a
 * vote taken, the value released, and then a SECOND moon the village votes
 * down and watches nothing happen. Run the whole file, never a `-t` slice.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[moonSettlement.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/** This suite's port window. `scripts/check-e2e-ports.mjs` polices the map. */
const PORT = 4802 + (process.pid % 198);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "moonsettle-admin";
const PASSWORD = "MoonSettleTest123!";

/** The pool this village releases per moon. Chosen to divide without a remainder. */
const POOL = 100;
/** The stock pool token (`gratitude.pool_token` defaults to it) and its display name. */
const POOL_TOKEN = "credits";
const POOL_TOKEN_NAME = "Village Credits";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
let mayaToken = "";
let mayaId = "";
let ivoToken = "";
let ivoId = "";
/** Recipients are addressed by email, the way every other suite sends. */
const emailOf = (slug: string) => `${slug}-${PORT}@example.test`;

/** The two moons this village works through, oldest first. */
/** The moon that is open when the suite starts; every gift is stamped with it. */
let openMoon = "";
let firstMoon = "";
let secondMoon = "";
/** Carried between cases: the ballot the machine opened. */
let firstBallot = "";
let secondBallot = "";
/**
 * The pool token's decimals, read from the migrated schema and never assumed.
 *
 * `token_balances.balance` holds MINOR units. On a schema where credits carry
 * 0 decimals a share of 60 is 60 on the row; on one where they carry 2 it is
 * 6000. Asserting a literal 60 passes against a payment that forgot the
 * conversion on the second schema, which is a test defending an underpayment.
 */
let poolDecimals = 0;
const minor = (human: number) => human * 10 ** poolDecimals;

interface Answer { status: number; json: any }

async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Answer> {
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

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    token: "",
    body: { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/**
 * A member's balance in a token, read from the CACHE the engine maintains.
 *
 * `token_balances` is what every read path in the build answers from, so this
 * is the number a member would actually see in their wallet. The postings that
 * produced it are checked separately by `conserved` below, against the journal.
 */
async function balance(userId: string, token: string): Promise<number> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
    "SELECT balance FROM token_balances WHERE account_id = ? AND token_type = ?",
    [`mem:${userId}`, token],
  );
  return Number(rows[0]?.balance ?? 0);
}

/**
 * Every token's balances sum to zero, or the ledger has been broken.
 *
 * The invariant the whole build boots on. It is asserted after every movement
 * in this file because a settlement is the largest single set of postings the
 * engine ever makes, and a release that paid the right people the right amounts
 * out of nowhere would satisfy every other assertion here.
 */
async function conserved(): Promise<boolean> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
    "SELECT token_type, SUM(balance) AS n FROM token_balances GROUP BY token_type HAVING SUM(balance) <> 0",
  );
  return rows.length === 0;
}

/** One cycle's recorded status, read raw. Absent means never tracked. */
async function cycleStatus(cycleId: string): Promise<string | null> {
  const [rows] = await pool.query<any[]>("SELECT status FROM gratitude_cycles WHERE id = ?", [cycleId]); // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
  return rows[0] ? String(rows[0].status) : null;
}

/** The frozen split for a moon, exactly as it sits in the table. */
async function frozen(cycleId: string): Promise<Array<{ userId: string; credited: number; received: number }>> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
    "SELECT user_id, credited, received FROM gratitude_distributions WHERE cycle_id = ? ORDER BY credited DESC, user_id",
    [cycleId],
  );
  return rows.map((r) => ({ userId: String(r.user_id), credited: Number(r.credited ?? 0), received: Number(r.received ?? 0) }));
}

async function ballotRow(id: string): Promise<any | null> {
  const [rows] = await pool.query<any[]>("SELECT * FROM ballots WHERE id = ?", [id]); // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
  return rows[0] ?? null;
}

/**
 * Move a moon's gratitude into the PAST, which is the only way to make a cycle
 * due inside a test that cannot wait a lunation.
 *
 * The clock is what moves, never a status: the rows keep their amounts, their
 * senders and their recipients, and `dueCycles` then sees exactly what it would
 * see a month from now. Nothing here writes a settlement, a distribution or a
 * cycle record — the engine still has to decide all three.
 */
async function backdateSendsTo(cycleId: string): Promise<void> {
  const [r] = await pool.query<any>( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
    // ONLY the open moon's gifts. This moved every row not already in the target,
    // which dragged an earlier, already settled moon's gifts into the next one
    // and made that moon's split something no village would ever have.
    "UPDATE gratitude_log SET cycle_id = ? WHERE cycle_id = ? AND is_example = 0",
    [cycleId, openMoon],
  );
  expect(Number(r.affectedRows), "some sends must have been moved into the past moon").toBeGreaterThan(0);
}

/** The vote window runs out, and the close route is asked for a real outcome. */
async function closeBallotNow(id: string, outcomeNote: string): Promise<Answer> {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [id]); // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
  return await call("POST", `/api/governance/ballots/${id}/close`, { body: { outcomeNote } });
}

/**
 * The steward's window runs out with nobody stopping it, and the landing runs.
 *
 * The clock moves and nothing else: `lands_at` is derived from the ballot's
 * frozen `closes_at` plus the veto hours, so pushing it into the past is
 * exactly what waiting three days does. The landing routine still decides
 * whether the row is due, whether a steward said no, and what to execute.
 */
async function landDue(id: string): Promise<Answer> {
  await pool.query( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
    "UPDATE ballots SET lands_at = DATE_SUB(NOW(), INTERVAL 1 HOUR), veto_closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) " +
      "WHERE id = ? AND lands_at IS NOT NULL",
    [id],
  );
  return await call("POST", "/api/admin/governance/land-due", { body: {} });
}

/**
 * The moons a member's profile lists under "By moon", read off the route the
 * profile calls. Only SETTLED moons belong there, and a frozen split on a moon
 * the village is still voting on is not one.
 */
async function flowMoons(token: string): Promise<Array<{ cycleId: string; received: number }>> {
  const r = await call("GET", "/api/game/gratitude/flows", { token });
  expect(r.status, "a member can read their own flows").toBe(200);
  return (r.json?.byCycle ?? []).map((c: any) => ({ cycleId: String(c.cycleId), received: Number(c.received) }));
}

/** One finished moon on the Cycles desk, as a founder reads it before pressing Close. */
async function deskMoon(cycleId: string): Promise<any | null> {
  const r = await call("GET", "/api/admin/cycles/pending");
  expect(r.status, "the founder can read the Cycles desk").toBe(200);
  return (r.json?.due ?? []).find((c: any) => String(c.id) === cycleId) ?? null;
}

async function vote(ballotId: string, token: string, choice: string): Promise<Answer> {
  return await call("POST", `/api/governance/ballots/${ballotId}/vote`, { token, body: { choice } });
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the moon settlement route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-moonsettle-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: this suite triggers the moon proposer by hand
      // through its admin door, so the proposal happens at a moment the test
      // can assert either side of. See the note in launchVote's harness.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "moonsettle-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    token: "",
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Moon Founder" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: "", body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const on = await call("PUT", "/api/admin/modules/governance/lifecycle", { body: { lifecycle: "members", examples: false } });
  expect(on.status, "governance must be on for this suite").toBe(200);

  const maya = await register("Maya Okonjo", "maya");
  mayaToken = maya.token; mayaId = maya.id;
  const ivo = await register("Ivo Brandt", "ivo");
  ivoToken = ivo.token; ivoId = ivo.id;

  // Everybody reaches member, the rung `ballot.vote` unlocks at, so the frozen
  // roll is real and a settlement can actually be decided.
  for (const id of [founderId, mayaId, ivoId]) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: "member" } });
    expect(r.status, `${id} reaches member`).toBe(200);
  }

  // A pool worth arguing about. Without this the village would vote on a
  // settlement that releases nothing, and the last clause of the harm metric
  // would have nothing to measure.
  const [tok] = await pool.query<any[]>("SELECT decimals FROM tokens WHERE slug = ?", [POOL_TOKEN]); // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
  poolDecimals = Number(tok[0]?.decimals ?? 0);

  const dial = await call("PUT", "/api/admin/variables/gratitude.pool_per_cycle", { body: { value: String(POOL) } });
  expect(dial.status, "the cycle pool must be set for this suite").toBe(200);
}, 180_000);

afterAll(async () => {
  await pool?.end();
  if (child && !child.killed) child.kill();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("a moon ends and the village decides", () => {
  it("Case 1: a moon ends with gratitude in it, and nothing has settled", async () => {
    const cycle = await call("GET", "/api/game/cycle");
    expect(cycle.status).toBe(200);
    const openNumber = Number(cycle.json?.cycleNumber);
    expect(Number.isFinite(openNumber), "the village must know what moon it is in").toBe(true);
    openMoon = String(cycle.json?.id ?? "");
    expect(openMoon, "the open moon has an id").toMatch(/^lunar-\d{6}$/);
    firstMoon = `lunar-${String(openNumber - 1).padStart(6, "0")}`;
    secondMoon = `lunar-${String(openNumber - 2).padStart(6, "0")}`;

    /*
     * Six and four, so the split is unmistakable: Maya must end with 60 of the
     * pool and Ivo with 40, and no rounding can hide a wrong denominator.
     *
     * Small on purpose. `gratitude.full_sends_per_cycle` is 7, so the most any
     * one person may receive from one giver in a moon is a seventh of that
     * giver's allowance — about 15 at the stock dials. Sending 60 would be
     * REFUSED by the engine, and a fixture that fights a rule the village
     * actually has is a fixture testing a village that does not exist.
     */
    const a = await call("POST", "/api/game/gratitude/send", {
      token: founderToken,
      body: { toEmail: emailOf("maya"), amount: 6, message: "For walking the riverbed with me" },
    });
    expect(a.status, `founder thanks Maya: ${JSON.stringify(a.json)}`).toBe(200);
    const b = await call("POST", "/api/game/gratitude/send", {
      token: founderToken,
      body: { toEmail: emailOf("ivo"), amount: 4, message: "For the fire ceremony" },
    });
    expect(b.status, `founder thanks Ivo: ${JSON.stringify(b.json)}`).toBe(200);

    await backdateSendsTo(firstMoon);

    // The premise, asserted rather than assumed: the moon is over and NOTHING
    // has happened about it.
    expect(await cycleStatus(firstMoon), "the moon must not be recorded as closed").not.toBe("closed");
    expect(await frozen(firstMoon)).toEqual([]);
    expect(await balance(mayaId, POOL_TOKEN), "Maya holds none of the pool yet").toBe(0);
    expect(await balance(ivoId, POOL_TOKEN), "Ivo holds none of the pool yet").toBe(0);
  });

  it("Case 2: the machine posts a proposal naming exactly what each member would get, and moves nothing", async () => {
    const r = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(r.status, `the proposer must answer: ${JSON.stringify(r.json)}`).toBe(200);
    expect(r.json?.posted, `the proposer must post: ${r.json?.why}`).toBe(true);
    expect(String(r.json?.cycleId)).toBe(firstMoon);
    firstBallot = String(r.json?.ballotId ?? "");
    expect(firstBallot).toBeTruthy();

    const row = await ballotRow(firstBallot);
    expect(String(row.subject_type), "the ballot is a settlement").toBe("cycle_settlement");
    expect(String(row.subject_ref), "on this moon and no other").toBe(firstMoon);
    expect(String(row.status)).toBe("open");
    // Nobody opened it. That is the whole of what has been automated.
    expect(String(row.opened_by)).toBe("sys:moon");
    expect(Number(row.electorate_count), "the whole village is asked").toBe(3);

    // THE DOCUMENT IS THE SPLIT. A member voting on this reads the amounts,
    // not a summary of them.
    const doc = String(row.doc_markdown);
    expect(doc).toContain(`100 ${POOL_TOKEN_NAME}`);
    expect(doc).toContain(`  Maya: 60 ${POOL_TOKEN_NAME}, for 6 gratitude`);
    expect(doc).toContain(`  Ivo: 40 ${POOL_TOKEN_NAME}, for 4 gratitude`);
    expect(doc).toContain("pays exactly them");

    // The split is frozen, and NOT ONE UNIT HAS MOVED. This is the assertion
    // that separates "asking" from "deciding".
    expect(await frozen(firstMoon)).toEqual([
      { userId: mayaId, credited: 60, received: 6 },
      { userId: ivoId, credited: 40, received: 4 },
    ]);
    expect(await balance(mayaId, POOL_TOKEN), "asking must not pay").toBe(0);
    expect(await balance(ivoId, POOL_TOKEN), "asking must not pay").toBe(0);
    expect(await cycleStatus(firstMoon), "asking must not close the moon").not.toBe("closed");
    // The split is written down, but the moon has not settled, so Maya's
    // profile must not list it as a settled moon yet.
    expect((await flowMoons(mayaToken)).map((m) => m.cycleId), "a moon under vote is not listed as settled").not.toContain(firstMoon);
  });

  it("Case 2b: it does not ask twice about a moon the village is still answering", async () => {
    const again = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(again.status).toBe(200);
    expect(again.json?.posted).toBe(false);
    expect(String(again.json?.why)).toContain("already voting");
  });

  it("Case 3: the members can see it and vote on it", async () => {
    // A member reads the decision on its own page, which is where the notice
    // they were sent points.
    const seen = await call("GET", `/api/governance/ballots/${firstBallot}`, { token: mayaToken });
    expect(seen.status, `a member must be able to read the decision: ${JSON.stringify(seen.json)}`).toBe(200);
    expect(String(seen.json?.ballot?.subjectType ?? seen.json?.subjectType)).toBe("cycle_settlement");

    for (const [who, token] of [["founder", founderToken], ["Maya", mayaToken], ["Ivo", ivoToken]] as const) {
      const v = await vote(firstBallot, token, "yes");
      expect(v.status, `${who} must be able to vote: ${JSON.stringify(v.json)}`).toBe(200);
    }

    const [votes] = await pool.query<any[]>( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
      "SELECT choice FROM ballot_votes WHERE ballot_id = ?",
      [firstBallot],
    );
    expect(votes.length, "three votes are on the record").toBe(3);
    expect(votes.every((v: any) => String(v.choice) === "yes")).toBe(true);

    const closed = await closeBallotNow(firstBallot, "The village settles the moon.");
    expect(closed.status, `the ballot must close: ${JSON.stringify(closed.json)}`).toBe(200);
    expect(String((await ballotRow(firstBallot)).status), "carried").toBe("passed");

    /*
     * STILL NOTHING HAS MOVED, and this is not an oversight in the test.
     *
     * A settlement is a Game change, so it waits inside the steward's veto
     * window rather than executing the moment the vote closes. A village that
     * has just carried a settlement has three days in which a steward can stop
     * it, and a build where the money left at close would have taken that
     * window away without anybody noticing.
     */
    expect(await balance(mayaId, POOL_TOKEN), "a carried vote is not yet a payment").toBe(0);
    expect(await cycleStatus(firstMoon)).not.toBe("closed");
  });

  it("Case 4: the window runs out, the decision lands, and the value arrives", async () => {
    const landed = await landDue(firstBallot);
    expect(landed.status, `the landing must run: ${JSON.stringify(landed.json)}`).toBe(200);

    // THE HARM METRIC'S LAST CLAUSE. Exactly the frozen amounts, to exactly
    // the people the document named.
    expect(await balance(mayaId, POOL_TOKEN), `Maya is paid the 60 the ballot showed, in minor units at ${poolDecimals} decimals`).toBe(minor(60));
    expect(await balance(ivoId, POOL_TOKEN), `Ivo is paid the 40 the ballot showed, in minor units at ${poolDecimals} decimals`).toBe(minor(40));
    expect(await cycleStatus(firstMoon), "and the moon is settled").toBe("closed");
    expect(await flowMoons(mayaToken), "and now Maya's profile lists it, with what she received").toContainEqual({ cycleId: firstMoon, received: 6 });

    // The close froze the three allowance figures, which it writes only when it
    // is handed each member's stage. Absent is not zero here, and a landing
    // that dropped the stage source would lose all three with no error.
    const [snaps] = await pool.query<any[]>( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
      "SELECT metric_key FROM health_snapshots WHERE cycle_number = ? AND metric_key IN ('gratitude_allowance_total', 'gratitude_allowance_given', 'gratitude_allowance_unspent')",
      [Number(firstMoon.replace("lunar-", ""))],
    );
    expect(snaps.map((r: any) => String(r.metric_key)).sort(), "the vote-landed close wrote the allowance snapshots").toEqual([
      "gratitude_allowance_given",
      "gratitude_allowance_total",
      "gratitude_allowance_unspent",
    ]);
    expect(await conserved(), "the ledger still balances to zero per token").toBe(true);

    // The people it settled for were told, in their own bell.
    const [notes] = await pool.query<any[]>( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
      "SELECT user_id FROM notifications WHERE type = 'cycle_settled'",
    );
    expect(new Set(notes.map((n: any) => String(n.user_id)))).toEqual(new Set([mayaId, ivoId]));
  });

  it("Case 4b: landing twice pays nothing twice", async () => {
    const again = await landDue(firstBallot);
    expect(again.status).toBe(200);
    expect(await balance(mayaId, POOL_TOKEN), "idempotent").toBe(minor(60));
    expect(await balance(ivoId, POOL_TOKEN), "idempotent").toBe(minor(40));
    expect(await conserved()).toBe(true);
  });

  it("Case 5: a moon the village votes DOWN releases nothing and stays open", async () => {
    /*
     * The other half of "the village decides". A feature that can only be
     * proven to pay has not been proven to be a decision at all.
     */
    const c = await call("POST", "/api/game/gratitude/send", {
      token: founderToken,
      body: { toEmail: emailOf("maya"), amount: 5, message: "For the seed swap" },
    });
    expect(c.status, `founder thanks Maya again: ${JSON.stringify(c.json)}`).toBe(200);
    await backdateSendsTo(secondMoon);

    const posted = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(posted.json?.posted, `a second moon must be proposed: ${posted.json?.why}`).toBe(true);
    expect(String(posted.json?.cycleId)).toBe(secondMoon);
    secondBallot = String(posted.json?.ballotId ?? "");

    for (const token of [founderToken, mayaToken, ivoToken]) {
      expect((await vote(secondBallot, token, "no")).status).toBe(200);
    }
    const closed = await closeBallotNow(secondBallot, "Not this moon.");
    expect(closed.status, `the ballot must close: ${JSON.stringify(closed.json)}`).toBe(200);
    expect(String((await ballotRow(secondBallot)).status), "refused").toBe("failed");

    const before = await balance(mayaId, POOL_TOKEN);
    await landDue(secondBallot);
    expect(await balance(mayaId, POOL_TOKEN), "a refused settlement pays nobody").toBe(before);
    expect(await cycleStatus(secondMoon), "and leaves the moon open").not.toBe("closed");
    expect((await flowMoons(mayaToken)).map((m) => m.cycleId), "a moon the village voted down never appears as settled").not.toContain(secondMoon);
    // The founder's desk now warns before a Close would overrule that no.
    const desk = await deskMoon(secondMoon);
    expect(desk, "the voted-down moon is still due on the desk").toBeTruthy();
    expect(desk.villageRefused, "the card carries the village's no").toMatchObject({ ballotId: secondBallot, vetoed: false });
    expect(await conserved()).toBe(true);
  });

  it("Case 5b: the machine never asks again about a moon the village refused", async () => {
    const again = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(again.status).toBe(200);
    expect(again.json?.posted, "a machine that re-asks until it wins is not holding a vote").toBe(false);
    expect(String(again.json?.why)).toContain("voted not to settle");
  });

  it("Case 5c: a moon nobody answered CAN be asked again, on the same moon", async () => {
    /*
     * THE ONE RISK THE UNIT TESTS CANNOT SEE.
     *
     * `ballots.open_key` is UNIQUE and holds `<subjectType>:<subjectRef>`, so
     * a second settlement ballot on the same moon is a duplicate key unless the
     * close actually released it. `closeBallot` rewrites the key to append the
     * ballot id for exactly this reason, and the re-ask branch in
     * `settlementProposalDecision` is worthless if that rewrite ever stops.
     * The decision test proves the RULE; only a database proves the ROW.
     *
     * The fixture writes the outcome the engine itself would have written had
     * nobody voted. It touches `status` and nothing else: the votes, the roll,
     * the dials and the released `open_key` are all left exactly as the close
     * left them.
     */
    await pool.query("UPDATE ballots SET status = 'no_quorum' WHERE id = ?", [secondBallot]); // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table

    const again = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(again.json?.posted, `silence must be re-asked once: ${again.json?.why}`).toBe(true);
    expect(String(again.json?.cycleId), "on the same moon").toBe(secondMoon);
    const reasked = String(again.json?.ballotId ?? "");
    expect(reasked).not.toBe(secondBallot);

    // And that is the LAST time. Two silences and the moon waits for a person.
    await pool.query("UPDATE ballots SET status = 'no_quorum' WHERE id = ?", [reasked]); // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
    const third = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(third.json?.posted, "a machine that asks forever has learned to nag").toBe(false);
    expect(String(third.json?.why)).toContain("nobody answered");
    // A later ask answered that no, so the desk stops calling it the village's word.
    expect((await deskMoon(secondMoon))?.villageRefused ?? null, "a superseded no no longer warns").toBeNull();

    // Nothing about any of this moved a single unit of value.
    expect(await cycleStatus(secondMoon)).not.toBe("closed");
    expect(await conserved()).toBe(true);
  });

  it("Case 6: a village that settles by hand is never asked at all", async () => {
    const dial = await call("PUT", "/api/admin/variables/cycle.settlement_mode", { body: { value: "manual" } });
    expect(dial.status, `the mode must be settable: ${JSON.stringify(dial.json)}`).toBe(200);
    const r = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(r.json?.posted).toBe(false);
    expect(String(r.json?.why)).toContain("by hand");
    // Put it back, so the dial's default is what the next reader of this
    // schema sees.
    await call("PUT", "/api/admin/variables/cycle.settlement_mode", { body: { value: "proposal" } });
  });

  it("Case 7: a founder can overrule a village no, is warned first, and the override is recorded", async () => {
    /*
     * Rye, 2026-09-14: "A founder has the power to overrule the village on this".
     * The card warns so it is never an accident, and the close still pays. The
     * fixture writes the outcome the engine itself writes for a no, on the
     * moon's latest settlement ballot, and touches nothing else.
     */
    await pool.query( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
      "UPDATE ballots SET status = 'failed' WHERE subject_type = 'cycle_settlement' AND subject_ref = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      [secondMoon],
    );
    expect((await deskMoon(secondMoon))?.villageRefused, "warned before the press").toMatchObject({ vetoed: false });

    // THE PROMISE IS THE FROZEN SPLIT, so that is what the payment is held to.
    const mayaFrozen = (await frozen(secondMoon)).find((d) => d.userId === mayaId);
    expect(mayaFrozen?.credited, "Maya's 5 was the whole moon, so her frozen share is the whole pool").toBe(100);

    const before = await balance(mayaId, POOL_TOKEN);
    const closed = await call("POST", "/api/admin/cycles/close", { body: {} });
    expect(closed.status, `the override is allowed: ${JSON.stringify(closed.json)}`).toBe(200);
    expect(await cycleStatus(secondMoon), "the founder's close settled it").toBe("closed");
    // It pays the split frozen when the village was asked, exactly.
    expect((await balance(mayaId, POOL_TOKEN)) - before, "the frozen split, paid anyway").toBe(minor(mayaFrozen!.credited));
    expect(await conserved()).toBe(true);

    const [audit] = await pool.query<any[]>( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
      "SELECT text, actor_user_id FROM health_events WHERE kind = 'audit' AND entity_ref = ? AND text LIKE 'cycle:settled-over-village-no:%'",
      [secondMoon],
    );
    expect(audit.length, "the override left a trace").toBe(1);
    expect(String(audit[0].text)).toBe(`cycle:settled-over-village-no:${Number(secondMoon.replace("lunar-", ""))}:voted-down`);
    expect(String(audit[0].actor_user_id), "naming who overrode").toBe(founderId);
  });

  it("Case 8: a vetoed settlement reads as a steward's no, even while its row still says passed", async () => {
    /*
     * `outcomeStatusOf` reads a carried row a steward stopped as failed: the row
     * can still say `passed` with `vetoed_at` and `landing_status = 'vetoed'`
     * beside it. A reader of `status` alone calls that moon carried, so the card
     * would show no warning and the job would wait forever for a landing that
     * never comes.
     */
    const thirdMoon = `lunar-${String(Number(openMoon.replace("lunar-", "")) - 3).padStart(6, "0")}`;
    const gift = await call("POST", "/api/game/gratitude/send", {
      token: founderToken,
      body: { toEmail: emailOf("ivo"), amount: 3, message: "For the washhouse roof" },
    });
    expect(gift.status, `founder thanks Ivo: ${JSON.stringify(gift.json)}`).toBe(200);
    await backdateSendsTo(thirdMoon);

    const asked = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(asked.json?.posted, `the third moon is asked about: ${asked.json?.why}`).toBe(true);
    expect(String(asked.json?.cycleId)).toBe(thirdMoon);
    const id = String(asked.json?.ballotId ?? "");
    for (const token of [founderToken, mayaToken, ivoToken]) {
      expect((await vote(id, token, "yes")).status).toBe(200);
    }
    expect((await closeBallotNow(id, "The village settles the third moon.")).status).toBe(200);
    expect(String((await ballotRow(id)).status), "carried").toBe("passed");

    // A steward stops it inside the window, in the shape the veto path stores.
    await pool.query( // module-review-ok: fixture SQL against the suite's own scratch schema, never a production table
      "UPDATE ballots SET vetoed_at = NOW(), landing_status = 'vetoed' WHERE id = ?",
      [id],
    );
    expect(String((await ballotRow(id)).status), "the row itself still says passed").toBe("passed");

    expect((await deskMoon(thirdMoon))?.villageRefused, "the card names a steward's veto").toMatchObject({ ballotId: id, vetoed: true });
    const again = await call("POST", "/api/admin/cycles/settlement-proposal", { body: {} });
    expect(again.json?.posted, "a vetoed moon is not asked about again by the machine").toBe(false);
    expect(await cycleStatus(thirdMoon), "and it stays open").not.toBe("closed");
  });
});
