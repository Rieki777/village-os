/**
 * THE VILLAGE VOTES ON THE RULES THAT MINT, DRIVEN OVER HTTP (R81, R84, R85).
 *
 * R81, in the founder's words: "all minting of tokens go through the
 * governance process" once a village has voted to start its Game. An audit
 * found that this was not merely unbuilt, it was unreachable: `mint_rules` is
 * its own table, its only writer sat behind `isAdmin`, and `validateChangeSet`
 * refuses any key absent from `VARIABLES_BY_KEY`, so no ballot in the product
 * could name a minting rule at all.
 *
 * The harm metric for this file is one sentence, and every clause is driven
 * against the built server:
 *
 *   A village changes what it mints by VOTING, an ordinary admin cannot change
 *   it any other way once the Game has started, and a named founder still can
 *   with the whole village able to see that they did.
 *
 * ── THE CASE THAT WOULD OTHERWISE BE INVISIBLE ──────────────────────────────
 *
 * The threshold seam is opt-in. Of the six routes that open a village-wide
 * ballot, five call `dialsForMethod` and never look at the subject registry.
 * A minting vote opened through one of those would conduct at the ordinary
 * quorum, pass on a quiet week, and look completely correct doing it. Nothing
 * in a happy-path test would notice. So this suite sets the village's own
 * quorum LOW and asserts the ballot froze the higher floor anyway, which is
 * the only observable difference between the seam being wired and not.
 *
 * The cases run IN ORDER: one village goes from before its Game to after it.
 * Run the whole file, never a `-t` slice. Boots the BUILT `dist/index.js`
 * against a throwaway schema, so run `pnpm build` first or you are testing
 * stale code. Skips loudly without TEST_DATABASE_URL.
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
  console.warn("[mintVote.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
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
const PORT = 21502 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "mintvote-admin";
const PASSWORD = "MintVote123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
const voters: Array<{ name: string; token: string; id: string }> = [];

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

async function register(name: string, slug: string): Promise<{ name: string; token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    token: null,
    body: { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { name, token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** One rule exactly as the table holds it. Read raw, never off a payload. */
const ruleRow = async (id: string): Promise<any | null> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT * FROM `mint_rules` WHERE `id` = ?",
    [id],
  );
  return rows[0] ?? null;
};

/** The amendment ledger rows for one key, newest first. */
const ledgerFor = async (key: string): Promise<any[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT * FROM mechanics_changes WHERE config_key = ? ORDER BY at DESC",
    [key],
  );
  return rows;
};

/** Every line on the public pulse mentioning a rule, with its audience. */
const pulseFor = async (ref: string): Promise<Array<{ kind: string; text: string; audience: string | null }>> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `kind`, `text`, `audience` FROM `health_events` WHERE `entity_ref` = ? ORDER BY `at` DESC, `id` DESC",
    [ref],
  );
  return rows.map((r) => ({ kind: String(r.kind), text: String(r.text), audience: r.audience ? String(r.audience) : null }));
};

/** Push a ballot's window into the past: the clock, never a status change. */
const expire = async (ballotId: string) => {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

/**
 * Mark the Game as started, which is the precondition every case below the
 * first one stands on. It writes the same row `recordGameStart` writes and
 * `readGameStart` reads. The launch ballot itself has its own suite
 * (`server/launchVote.routes.e2e.test.ts`); driving it again here would test
 * that file's subject and not this one.
 */
const startTheGame = async () => {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO app_config (config_key, value) VALUES ('game-start', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [JSON.stringify({
      startedAt: new Date().toISOString(),
      ballotId: "bal-fixture-mintvote",
      startedBy: "test-harness",
      note: "Marked started by the mint vote suite so the post-launch door can be driven.",
    })],
  );
};

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The mint rule ids this village actually seeded, read rather than assumed. */
let seatGratitude = "";
let questVoice = "";

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the mint vote route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-mintvote-"));
  /*
   * A village that has NOT started its Game, because the first case is what
   * this route does BEFORE launch and the harness default is a village
   * mid-life. The suite starts the Game itself when it is ready to.
   */
  testDb = await provisionTestDb({ gameStarted: false });
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

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
      AUTH_TOKEN_SECRET: "mintvote-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try {
      if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
    } catch { /* not up yet */ }
    await settle(400);
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    token: null,
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Mint Founder" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: null, body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const on = await call("PUT", "/api/admin/modules/governance/lifecycle", {
    body: { lifecycle: "members", examples: false },
  });
  expect(on.status, "governance must be on for this suite").toBe(200);

  for (const name of ["Anna Vale", "Ben Orr", "Cara Lin"]) {
    const who = await register(name, name.split(" ")[0].toLowerCase());
    // ballot.vote unlocks at the member stage, so the electorate builder needs
    // these three to have joined. Nothing here reaches around the one gate.
    const staged = await call("PUT", `/api/admin/players/${who.id}/stage`, { body: { stageId: "member" } });
    expect(staged.status, `${name} reaches member stage`).toBe(200);
    voters.push(who);
  }

  /*
   * The rules this village seeded, READ rather than assumed. A hardcoded id
   * here would pass on the day it was written and quietly stop covering the
   * seat payment the moment somebody renamed a trigger.
   */
  const [rules] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `id`, `trigger`, `token_slug` FROM `mint_rules` ORDER BY `id`",
  );
  expect(rules.length, "this village must have seeded minting rules to vote on").toBeGreaterThan(1);
  seatGratitude = String(rules.find((r) => r.trigger === "role.cycle" && r.token_slug === "gratitude")?.id ?? "");
  questVoice = String(rules.find((r) => r.trigger === "quest.completed")?.id ?? "");
  expect(seatGratitude, "the seat payment rule must exist").toBeTruthy();
  expect(questVoice, "the quest payout rule must exist").toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the village votes on what it mints", () => {
  let proposalId = "";
  let ballotId = "";
  let liveAmountBefore = "";

  it("BEFORE THE GAME STARTS the mint route is exactly what it was, because nothing issues yet (R67)", async () => {
    const before = await ruleRow(seatGratitude);
    liveAmountBefore = String(before.amount);

    const queued = await call("PATCH", `/api/admin/economy/rules/${seatGratitude}`, { body: { ceiling: 400 } });
    expect(queued.status, JSON.stringify(queued.json)).toBe(200);
    expect(queued.json?.fromCycle).toBeGreaterThan(0);

    // And it is SILENT on the public pulse. A village with no members governing
    // anything does not need a feed line per dial a founder touches in setup.
    const pulse = await pulseFor(seatGratitude);
    expect(pulse.filter((p) => p.kind === "governance").length).toBe(0);
    expect(pulse.some((p) => p.kind === "audit"), "the admin trail still records it").toBe(true);

    // Clear the queue again so the vote below starts from a rule with nothing
    // pending, which is what makes the later assertion about pending_* honest.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE `mint_rules` SET `pending_amount` = NULL, `pending_ceiling` = NULL, `pending_enabled` = NULL, " +
        "`pending_from_cycle` = NULL, `pending_by` = NULL, `pending_at` = NULL WHERE `id` = ?",
      [seatGratitude],
    );
  });

  it("BEFORE THE GAME STARTS a give is refused WHOLE, and costs the giver nothing (TESTRUN, round 7)", async () => {
    /*
     * `give()` committed the note and spent the allowance, then asked the
     * ledger. `postTransfer` refuses every faucet posting until the launch
     * vote carries, and the route gates on `economyReady` rather than on that,
     * so for a founder setting up their Game this did not fail rarely. It
     * failed every time: allowance gone, permanent record of a gift, recipient
     * paid nothing. The note is the allowance, so an empty log IS an unspent
     * allowance and one assertion covers both.
     */
    const gave = await call("POST", "/api/gratitude", {
      token: voters[0].token,
      body: { toId: voters[1].id, amount: 3, note: "For carrying the water up the hill." },
    });
    expect(gave.status, JSON.stringify(gave.json)).toBe(400);
    expect(String(gave.json?.error)).toContain("has not started its Game");

    const [log] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM `gratitude_log`",
    );
    expect(Number(log[0]?.n), "a refused give writes nothing and spends nothing").toBe(0);
  });

  it("a proposal can NAME a minting rule, which is the thing no ballot could do", async () => {
    await startTheGame();
    // A quorum the ordinary vote would run at. The floor below is what proves
    // the seam is wired, so the village's own number has to be under it.
    const dial = await call("PUT", "/api/admin/variables/governance.quorum_pct", { body: { value: "20" } });
    expect(dial.status).toBe(200);

    const made = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "Pay a seat more for the season it holds",
        rationale: "The seats carry more than they did when the number was set, and the people holding them are the ones who noticed.",
        changes: [{ key: `mint:${seatGratitude}:amount`, to: "35" }],
      },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    proposalId = String(made.json?.id ?? "");
    expect(proposalId).toBeTruthy();
    expect(made.json?.status).toBe("open");

    /*
     * THE CARD MUST NOT SAY THE VILLAGE STARTS PAYING THIS ON THE DAY.
     *
     * `applyTiming` used to fall to "instant" for any key with no registry
     * entry, and the proposal card shows its deferral note only for a
     * cycle-close change, so a minting change would have rendered with no note
     * at all. A minting rule is ALWAYS deferred.
     */
    const list = await call("GET", "/api/game/mechanics/proposals");
    expect(list.status).toBe(200);
    const card = (list.json ?? []).find((x: any) => x.id === proposalId);
    expect(card, "the proposal must be on the public list").toBeTruthy();
    expect(card.changes.length).toBe(1);
    expect(card.changes[0].applyTiming, "a minting rule is never instant").toBe("cycle-close");
    expect(card.changes[0].label).toContain("role.cycle in gratitude");
    expect(card.changes[0].label).not.toContain("mint:");
    expect(card.changes[0].toDisplay).toBe("35");
    expect(Number(card.changes[0].currentValue)).toBe(Number(liveAmountBefore));
  });

  it("REFUSES a set that mixes dials with minting rules: two subjects have no one price", async () => {
    const mixed = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "Move the budget and the seat payment together",
        rationale: "Both numbers came from the same afternoon and both are wrong in the same direction.",
        changes: [
          { key: "gratitude.base_budget", to: "140" },
          { key: `mint:${seatGratitude}:ceiling`, to: "300" },
        ],
      },
    });
    expect(mixed.status).toBe(400);
    expect(JSON.stringify(mixed.json)).toContain("two proposals");
  });

  it("refuses a rule this village does not have, and a value the rule could never take", async () => {
    const invented = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "Change a rule nobody wrote",
        rationale: "This one names a minting rule this village has never had.",
        changes: [{ key: "mint:rule-invented-thing:amount", to: "5" }],
      },
    });
    expect(invented.status).toBe(400);
    expect(JSON.stringify(invented.json)).toContain("no minting rule by that name");

    const impossible = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "Pay a seat nothing at all",
        rationale: "Zero is not an amount, it is turning the rule off, and the rule has a switch for that.",
        changes: [{ key: `mint:${seatGratitude}:amount`, to: "0" }],
      },
    });
    expect(impossible.status).toBe(400);
    expect(JSON.stringify(impossible.json)).toContain("greater than zero");
  });

  it("THE FLOOR IS APPLIED, not silently inherited: the ballot freezes 50 over the village's 20", async () => {
    const opened = await call("POST", `/api/governance/mechanics/${proposalId}/open-ballot`);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const ballot = opened.json?.ballot;
    ballotId = String(ballot?.id ?? "");
    expect(ballotId).toBeTruthy();

    // THE WHOLE CASE. Five of the six open routes never consult the subject
    // registry, so a mint route that forgot to opt in would freeze 20 here,
    // pass, and look completely right.
    expect(ballot.quorumPct, "the minting floor must beat the village's own quorum").toBe(50);
    expect(ballot.subjectType).toBe("mint_rule");
    // It BINDS. `ballotBinds` is a read on the executor table, so this is the
    // same sentence as "closing this changes the rule".
    expect(ballot.binding).toBe(true);
    expect(ballot.status).toBe("open");
    expect(ballot.electorateCount).toBeGreaterThanOrEqual(3);

    // The frozen document says what the rule pays for, in the village's words.
    expect(String(ballot.docMarkdown)).toContain("role.cycle in gratitude: how much it pays");
    expect(String(ballot.docMarkdown)).toContain("takes effect at the next moon");
  });

  it("AN ORDINARY DIAL IS UNTOUCHED by the floor: a mechanics proposal still runs at the village's own quorum", async () => {
    const made = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "Raise the gratitude budget for the winter cycle",
        rationale: "The cold months are when people carry each other and the budget runs out before the moon does.",
        changes: [{ key: "gratitude.base_budget", to: "120" }],
      },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const opened = await call("POST", `/api/governance/mechanics/${String(made.json?.id)}/open-ballot`);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    expect(opened.json?.ballot?.subjectType).toBe("mechanics");
    expect(opened.json?.ballot?.quorumPct, "a dial keeps the village's own number").toBe(20);
    // Called off, so it cannot interfere with the minting vote's close below.
    await call("POST", `/api/governance/ballots/${String(opened.json?.ballot?.id)}/withdraw`, {
      body: { reason: "Opened only to show that an ordinary dial keeps the village's own quorum." },
    });
  });

  it("A CARRIED BALLOT CHANGES THE RULE, and it changes it at the next moon and not today", async () => {
    for (const who of [{ token: founderToken }, ...voters]) {
      const v = await call("POST", `/api/governance/ballots/${ballotId}/vote`, {
        token: who.token,
        body: { choice: "yes" },
      });
      expect(v.status, JSON.stringify(v.json)).toBe(200);
    }
    await expire(ballotId);
    const closed = await call("POST", `/api/governance/ballots/${ballotId}/close`, {
      body: { outcomeNote: "Everyone on the roll answered and everyone agreed. A seat is paid 35 from the next moon." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");

    /*
     * REWRITTEN BY THE DISPATCHER LANE, because the rule it pinned is now wrong.
     *
     * It used to assert that a carried minting ballot queues the rule AT THE
     * CLOSE. The 2026-09-03 ruling gives every Game change a landing instant and
     * a window a steward can stop it inside, and a minting rule is a Game
     * change. So the close stamps the instant and writes nothing, and the
     * landing path writes the pending row when the instant comes.
     *
     * What has NOT changed, and is still asserted below, is the deferral this
     * case exists for: the LIVE number never moves, and the new one lands on a
     * moon rather than today.
     */
    const stamped = await ruleRow(seatGratitude);
    expect(String(stamped.amount), "the live amount must not move").toBe(liveAmountBefore);
    expect(stamped.pending_amount, "nothing is queued at the close any more").toBeNull();
    expect(closed.json?.applied, "a queued rule is not an applied dial").toEqual([]);
    expect(String(closed.json?.held)).toContain("lands at");

    // The window runs out. Nobody stopped it, so the next pass of the landing
    // path applies it. The human cycle close is one of that path's two callers.
    await pool.query("UPDATE ballots SET lands_at = DATE_SUB(NOW(), INTERVAL 1 HOUR), veto_closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the suite's own scratch schema
    const landed = await call("POST", "/api/admin/cycles/close", { body: {} });
    expect(landed.status, JSON.stringify(landed.json)).toBe(200);
    expect(landed.json?.governanceLanding?.ran, "the landing path has to say whether it ran").toBe(true);

    const after = await ruleRow(seatGratitude);
    expect(String(after.amount), "the live amount still must not move").toBe(liveAmountBefore);
    expect(Number(after.pending_amount)).toBe(35);
    expect(Number(after.pending_from_cycle)).toBeGreaterThan(0);
    expect(String(after.pending_by)).toBeTruthy();

    // The amendment ledger carries it, sourced to governance and pointing at
    // the ballot, so the record survives the browser session that closed it.
    const ledger = await ledgerFor(`mint:${seatGratitude}:amount`);
    expect(ledger.length).toBe(1);
    expect(String(ledger[0].source)).toBe("governance");
    expect(String(ledger[0].new_value)).toBe("35");
    expect(String(ledger[0].proposal_ref)).toContain(ballotId);
    expect(String(ledger[0].note)).toContain("takes effect at cycle");
  });

  it("AFTER LAUNCH AN ORDINARY ADMIN CANNOT change a minting rule, and is told where the door is", async () => {
    const anna = voters[0];
    const promoted = await call("PUT", `/api/admin/users/${anna.id}/role`, { body: { role: "admin" } });
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);

    const refused = await call("PATCH", `/api/admin/economy/rules/${questVoice}`, {
      token: anna.token,
      body: { amount: 99 },
    });
    expect(refused.status).toBe(403);
    expect(String(refused.json?.error)).toContain("Put the change up on the Game Mechanics page");

    // Refused means nothing was written. A 403 that had already queued the
    // change would be the worst of both.
    const untouched = await ruleRow(questVoice);
    expect(untouched.pending_amount).toBeNull();
    expect(untouched.pending_from_cycle).toBeNull();

    // The admin surface itself is still readable, because R84 says the admin
    // section becomes readable by every member after launch. Only the WRITE
    // moved to the village.
    const view = await call("GET", "/api/admin/economy", { token: anna.token });
    expect(view.status).toBe(200);
  });

  /*
   * ── THE CASE THAT USED TO STAND HERE (R85), AND WHY IT DOES NOT ──────────
   *
   * This file shipped with "A NAMED FOUNDER STILL CAN", driven against the
   * back door R85 asked for: "all named founders have this back door ability
   * until it is taken away", with a second handover event that would take it.
   * It passed, it was right about the ruling it was written against, and it
   * was correct for a few hours.
   *
   * R90 SUPERSEDES R85 and removes the second event: "The founder role
   * disappears once the game starts and a minimum of 3 people vote the game to
   * start." So there is one moment and not two, the moment is launch, and
   * after it a founder is an administrator and nothing more.
   *
   * The public pulse assertion went with it. It read "A founder changed what
   * the village mints ... without a village vote", and after R90 no such
   * change can happen, so a line announcing one would be the product saying
   * something that did not occur.
   */
  it("A NAMED FOUNDER TAKES THE SAME REFUSAL (R90), and nothing is written either way", async () => {
    const before = await ruleRow(questVoice);

    const key = await call("PATCH", `/api/admin/economy/rules/${questVoice}`, { body: { amount: 12 } });
    expect(key.status, JSON.stringify(key.json)).toBe(403);
    expect(String(key.json?.error)).toContain("Put the change up on the Game Mechanics page");

    // The refusal is the whole of it. A 403 that had already queued the change
    // would be the worst of both, and it is exactly what an actor-shaped guard
    // gets wrong when it is moved.
    const after = await ruleRow(questVoice);
    expect(after.pending_amount).toEqual(before.pending_amount);
    expect(after.pending_from_cycle).toEqual(before.pending_from_cycle);
    expect(after.pending_by).toEqual(before.pending_by);

    /*
     * AND THE VILLAGE IS TOLD NOTHING, because nothing happened. The pulse
     * lines about this rule are the ones the CARRIED VOTE put there earlier in
     * this file, and no line anywhere says a founder changed the mint.
     */
    const pulse = await pulseFor(questVoice);
    expect(pulse.some((p) => p.text.includes("A founder changed what the village mints"))).toBe(false);
    expect(pulse.some((p) => p.text.includes("without a village vote"))).toBe(false);
  });

  it("and the founder reads the mint the same way an ordinary member does", async () => {
    // R84 keeps the surface readable after launch. Only the WRITE moved, and
    // it moved for everybody rather than for everybody except one account.
    const view = await call("GET", "/api/admin/economy");
    expect(view.status).toBe(200);
  });
});
