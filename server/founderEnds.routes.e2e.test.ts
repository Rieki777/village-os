/**
 * THE FOUNDER ROLE ENDS AT LAUNCH (R90), driven across the moment itself.
 *
 * R90, in the founder's words: "The founder role disappears once the game
 * starts and a minimum of 3 people vote the game to start. After that they can
 * optionally vote in a steward role and give various powers to this steward to
 * immediately act." It SUPERSEDES R85, which had named founders keeping a back
 * door until a second handover event. There is no second event.
 *
 * The harm metric for this file is one sentence, and every clause of it is
 * driven over HTTP against the built server:
 *
 *   A founder builds a village alone with every power the role carries, three
 *   members vote the Game to start, and from that moment the founder holds
 *   nothing an administrator does not, while the village is never for one
 *   request without somebody able to administer it.
 *
 * WHY ONE VILLAGE AND NOT TWO. The before and the after are the same
 * deployment either side of one ballot, and the only honest way to show a
 * power ending is to hold it, then watch the vote take it. A suite that
 * provisioned a started village and asserted the refusals would prove the
 * refusals and prove nothing at all about the moment.
 *
 * THE CASES RUN IN ORDER, and the launch vote sits in the middle of them. Run
 * the whole file, never a `-t` slice.
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
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[founderEnds.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
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
const PORT = 13400 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "founderends-admin";
const PASSWORD = "FounderEndsTest123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

/** The founder. Holds everything the role carries, until it does not. */
let founderToken = "";
let founderId = "";
/** An ordinary administrator, appointed before launch. The control. */
let annaToken = "";
let annaId = "";
/** A member with no admin anything. */
let benToken = "";
let benId = "";

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

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    token: "",
    body: { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** Push a ballot's window into the past: the clock, never a status change. */
const expire = async (ballotId: string) => {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

/** The game-start document exactly as it stands, read raw. */
const gameStartRow = async (): Promise<any | null> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT value FROM app_config WHERE config_key = 'game-start'",
  );
  if (!rows[0]) return null;
  return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
};

/** One rule's pending fields, read from the table and never off a payload. */
const ruleRow = async (id: string): Promise<any> => {
  const [rows] = await pool.query<any[]>("SELECT * FROM `mint_rules` WHERE `id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0];
};

/** Every line the VILLAGE can read. Audience public, examples out. */
const publicPulse = async (): Promise<string[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT text FROM health_events WHERE audience = 'public' AND is_example = 0 ORDER BY at DESC, id DESC LIMIT 100",
  );
  return rows.map((r) => String(r.text));
};

/** One account's role, read from the users table and never off a payload. */
const roleOf = async (id: string): Promise<string> => {
  const [rows] = await pool.query<any[]>("SELECT role FROM users WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return String(rows[0]?.role ?? "");
};

/** A minting rule this village actually seeded, read rather than assumed. */
let questRule = "";

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the founder-ends route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-founderends-"));
  /*
   * A village that has NOT started its Game, which is the whole premise. The
   * harness default is a village mid-life, and this file has to begin before
   * the moment it is about.
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
      AUTH_TOKEN_SECRET: "founderends-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s:\n${logs.join("")}`);
    try {
      if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    token: "",
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Mara Fenn" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: "", body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const on = await call("PUT", "/api/admin/modules/governance/lifecycle", {
    body: { lifecycle: "members", examples: false },
  });
  expect(on.status, "governance must be on for this suite").toBe(200);

  const anna = await register("Anna Boyd", "anna");
  annaToken = anna.token; annaId = anna.id;
  const ben = await register("Ben Ilsley", "ben");
  benToken = ben.token; benId = ben.id;

  // Everybody reaches member, the rung `ballot.vote` unlocks at, so the roll is
  // real and the launch vote can ask all three of them.
  for (const id of [founderId, annaId, benId]) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: "member" } });
    expect(r.status, `${id} reaches member`).toBe(200);
  }

  const [rules] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `id`, `trigger` FROM `mint_rules` ORDER BY `id`",
  );
  questRule = String(rules.find((r) => r.trigger === "quest.completed")?.id ?? "");
  expect(questRule, "this village must have seeded a quest payout rule").toBeTruthy();

  /*
   * THE JOURNEY, CLEARED. These are the blocking items a fresh village of this
   * shape still holds, and clearing them is the founder's solitary setup that
   * R67 says comes before the vote.
   */
  expect((await call("PUT", "/api/admin/brand", {
    body: { project: { name: "Wealden", tagline: "A village in the weald", location: "Sussex" } },
  })).status).toBe(200);

  const policy = await call("PUT", "/api/admin/exit-policy", {
    body: {
      placeholder: false,
      voluntary: {
        noticePeriodDays: 21,
        valuationMethod: "Wealden pays a leaving member what the last cycle settled, in full, within one lunation.",
        unwindSteps: [
          "Bring back anything borrowed from the workshop",
          "Finish or hand on the work you are holding",
          "The stewards settle what is owed and write it down",
        ],
      },
      involuntary: {
        decidingDomainId: "",
        appealDomainId: "",
        process: "Two members sit with the person first. Nothing formal begins until that conversation has happened.",
      },
      restorative: {
        intakeContactRole: "",
        steps: [
          "Somebody who was not involved hears both people",
          "The village agrees what would put it right",
          "Whoever asked for this says whether it did",
        ],
      },
    },
  });
  expect(policy.status, JSON.stringify(policy.json)).toBe(200);

  expect((await call("POST", "/api/admin/launch/confirm", {
    body: { id: "backups-drilled", done: true },
  })).status).toBe(200);

  /*
   * THE FOUNDER'S ANSWER ABOUT THE VILLAGE-WIDE ISSUANCE CAP, WHICH IS NEW AND
   * BLOCKS THE VOTE UNTIL IT IS GIVEN.
   *
   * Rye ruled that founders are asked for the cap on this journey and "can opt
   * to not set a cap at that moment". This village declines, which is the
   * second real answer: it names no number of its own and the platform's cap
   * keeps binding every door. The row is BLOCKING precisely so that declining
   * and never looking cannot be the same outcome, so a setup that greens the
   * checklist has to answer it, exactly as a founder does.
   */
  expect((await call("POST", "/api/admin/launch/confirm", {
    body: { id: "issuance-cap", done: "declined" },
  })).status).toBe(200);
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("before the vote, the founder holds everything the role carries", () => {
  it("changes what the village will mint, because nothing issues yet (R67)", async () => {
    expect(await gameStartRow(), "this village has not started its Game").toBeNull();

    const queued = await call("PATCH", `/api/admin/economy/rules/${questRule}`, { body: { ceiling: 400 } });
    expect(queued.status, JSON.stringify(queued.json)).toBe(200);
    expect(queued.json?.fromCycle).toBeGreaterThan(0);
    expect(Number((await ruleRow(questRule)).pending_ceiling)).toBe(400);
  });

  it("is the only account that can change a role, and appoints an administrator", async () => {
    const madeAdmin = await call("PUT", `/api/admin/users/${annaId}/role`, { body: { role: "admin" } });
    expect(madeAdmin.status, JSON.stringify(madeAdmin.json)).toBe(200);
    expect(await roleOf(annaId)).toBe("admin");

    // The administrator cannot: before launch, founders run the admins.
    const coup = await call("PUT", `/api/admin/users/${benId}/role`, {
      token: annaToken,
      body: { role: "admin" },
    });
    expect(coup.status).toBe(403);
    expect(String(coup.json?.error)).toContain("Only a founder can change roles");
    expect(await roleOf(benId)).toBe("member");
  });

  it("cannot be demoted while they are the last founder, and cannot be password-reset by an admin", async () => {
    const strand = await call("PUT", `/api/admin/users/${founderId}/role`, { body: { role: "member" } });
    expect(strand.status).toBe(409);
    expect(String(strand.json?.error)).toContain("last founder");

    const reach = await call("POST", `/api/admin/users/${founderId}/send-password-link`, { token: annaToken });
    expect(reach.status).toBe(403);
    expect(String(reach.json?.error)).toContain("Only a founder can send a founder a password link");
  });
});

describe.skipIf(!DB_CONFIGURED)("three members vote the Game to start", () => {
  it("carries, and that one close is the whole of the moment", async () => {
    const opened = await call("POST", "/api/admin/launch/propose");
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const ballotId = String(opened.json?.ballot?.id ?? "");
    expect(ballotId).toMatch(/^bal-/);

    for (const t of [founderToken, annaToken, benToken]) {
      const v = await call("POST", `/api/governance/ballots/${ballotId}/vote`, { token: t, body: { choice: "yes" } });
      expect(v.status, JSON.stringify(v.json)).toBe(200);
    }
    await expire(ballotId);
    const closed = await call("POST", `/api/governance/ballots/${ballotId}/close`, {
      body: { outcomeNote: "All three of us agreed. Wealden starts today." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");
    expect((await gameStartRow())?.ballotId).toBe(ballotId);
  });

  it("and the launch vote cannot be opened again on a Game that has started", async () => {
    /*
     * TWO FACTS, AND THIS DRIVES THE ONE THAT LOOKS BACK CORRECTLY. The
     * journey document refuses a second vote by reading `launched_at`, which
     * only this vote writes. Migration 0112 recorded a started Game with no
     * launch state at all for every village that was already issuing before
     * the vote existed, so the route reads `game-start` beside it.
     */
    const again = await call("POST", "/api/admin/launch/propose");
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain("already started its Game");
  });
});

describe.skipIf(!DB_CONFIGURED)("after the vote the founder holds nothing an administrator does not", () => {
  it("takes the same mint refusal an ordinary administrator takes (R90 removes R85's key)", async () => {
    const before = await ruleRow(questRule);

    const asFounder = await call("PATCH", `/api/admin/economy/rules/${questRule}`, { body: { amount: 12 } });
    expect(asFounder.status, JSON.stringify(asFounder.json)).toBe(403);
    expect(String(asFounder.json?.error)).toContain("Put the change up on the Game Mechanics page");

    const asAdmin = await call("PATCH", `/api/admin/economy/rules/${questRule}`, {
      token: annaToken,
      body: { amount: 12 },
    });
    expect(asAdmin.status).toBe(403);
    // THE SAME SENTENCE, WORD FOR WORD. Two different refusals for the same
    // act would be a difference between the accounts by another name.
    expect(String(asAdmin.json?.error)).toBe(String(asFounder.json?.error));

    // Refused means nothing was written, on either path.
    const after = await ruleRow(questRule);
    expect(after.pending_amount).toEqual(before.pending_amount);
    expect(after.pending_ceiling).toEqual(before.pending_ceiling);
  });

  it("and the village is told nothing, because nothing happened", async () => {
    /*
     * R85's door was LOUD by design: a founder's use of it wrote a public line
     * saying the mint changed with no vote behind it. R90 shut the door, so
     * that line can no longer be true, and a feed that carried it would be the
     * product saying something that did not occur.
     */
    const pulse = await publicPulse();
    expect(pulse.some((t) => t.includes("A founder changed what the village mints"))).toBe(false);
    expect(pulse.some((t) => t.includes("without a village vote"))).toBe(false);
    // The control: this village's pulse is not empty, so the two negatives
    // above are about the sentences and not about an empty table.
    expect(pulse.some((t) => t.includes("started its Game"))).toBe(true);
  });

  it("no longer has the only key to the roster, and nobody can be made a founder", async () => {
    // The administrator who was refused before launch is refused no longer.
    const byAdmin = await call("PUT", `/api/admin/users/${benId}/role`, {
      token: annaToken,
      body: { role: "admin" },
    });
    expect(byAdmin.status, JSON.stringify(byAdmin.json)).toBe(200);
    expect(await roleOf(benId)).toBe("admin");

    // And the one change that would put the ended role back is refused, from
    // the founder's own account.
    const minted = await call("PUT", `/api/admin/users/${benId}/role`, { body: { role: "founder" } });
    expect(minted.status).toBe(409);
    expect(String(minted.json?.error)).toContain("founder role ended");
    expect(await roleOf(benId)).toBe("admin");
  });

  it("keeps no personal immunity: an administrator may now send them a password link", async () => {
    const reach = await call("POST", `/api/admin/users/${founderId}/send-password-link`, { token: annaToken });
    // 200 or a 409 about the address, never the 403 that named the founder.
    expect(reach.status, JSON.stringify(reach.json)).toBe(200);
    expect(String(reach.json?.error ?? "")).not.toContain("Only a founder");
  });

  it("can be stood down now, because the tier it guarded has ended", async () => {
    /*
     * The last-founder rule was never about the tier. Its stated reason is
     * that a deployment must never strand itself, and after launch the
     * accounts that can administer this village are its admins and its
     * founders together. Anna and Ben both hold reach, so this is safe.
     */
    const down = await call("PUT", `/api/admin/users/${founderId}/role`, {
      token: annaToken,
      body: { role: "member" },
    });
    expect(down.status, JSON.stringify(down.json)).toBe(200);
    expect(await roleOf(founderId)).toBe("member");

    // The founder's own token still works as a member's, and the panel is shut
    // to them, which is the whole of what the demotion means.
    const shut = await call("GET", "/api/admin/players");
    expect(shut.status).toBe(401);
  });
});

describe.skipIf(!DB_CONFIGURED)("the village is never for one request without somebody able to administer it", () => {
  it("holds the journey item open rather than reporting a fault, once no founder is left", async () => {
    /*
     * R90 asks for exactly this state, so the operator's own dashboard must
     * not read it as a red line. The item beside it, which asks whether
     * anybody at all can reach the panel with their own credential, keeps its
     * meaning forever and is asserted here as the control.
     */
    const launch = await call("GET", "/api/admin/launch", { token: annaToken });
    expect(launch.status, JSON.stringify(launch.json)).toBe(200);
    const founderItem = launch.json.items.find((i: any) => i.id === "founder-appointed");
    expect(founderItem.state).toBe("ok");
    expect(String(founderItem.detail)).toContain("ended when this village started its Game");
    expect(launch.json.items.find((i: any) => i.id === "admin-identities").state).toBe("ok");
  });

  it("refuses to stand down the last account that can administer it", async () => {
    // Down to one: Ben goes back to member, leaving Anna alone with reach.
    expect((await call("PUT", `/api/admin/users/${benId}/role`, {
      token: annaToken, body: { role: "member" },
    })).status).toBe(200);

    const roster = await call("GET", "/api/admin/players", { token: annaToken });
    const reach = roster.json.filter((u: any) => u.role === "admin" || u.role === "founder");
    expect(reach.map((u: any) => u.id), "one account left with admin reach").toEqual([annaId]);

    const strand = await call("PUT", `/api/admin/users/${annaId}/role`, {
      token: annaToken, body: { role: "member" },
    });
    expect(strand.status).toBe(409);
    expect(String(strand.json?.error)).toContain("last account that can administer");
    expect(await roleOf(annaId)).toBe("admin");
  });

  it("refuses to let that last account walk out of the village either", async () => {
    /*
     * THE HOLE THIS CLOSES, and it is one this lane opened. The exit routes
     * refused a FOUNDER, on the stated reason that a deployment must never
     * strand itself. After R90 a founder can stand themselves down to
     * administrator, so an exit guard that still named the tier would have let
     * the last way in walk out through a door the old rule had shut.
     */
    const leaving = await call("POST", "/api/profile/request-exit", {
      token: annaToken,
      body: { password: PASSWORD, note: "Handing on." },
    });
    expect(leaving.status).toBe(409);
    expect(String(leaving.json?.error)).toContain("last account that can administer");

    const deleting = await call("POST", "/api/profile/delete-account", {
      token: annaToken,
      body: { password: PASSWORD },
    });
    expect(deleting.status).toBe(409);
    expect(String(deleting.json?.error)).toContain("last account that can administer");
  });

  it("and an ordinary member is untouched by any of it", async () => {
    // The control for the three refusals above: the guard is about admin
    // reach, so a member with none of it opens their departure normally.
    const ben = await call("POST", "/api/profile/request-exit", {
      token: benToken,
      body: { password: PASSWORD, note: "Moving to the coast." },
    });
    expect(ben.status, JSON.stringify(ben.json)).toBe(200);
  });
});
