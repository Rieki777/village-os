/**
 * THE ONE VOTE A FOUNDER MUST NOT BE ABLE TO CARRY ALONE, driven over HTTP
 * against the built server, with the state that made it possible turned ON.
 *
 * R74 sets the launch ballot at 100% unity, 100% quorum and a floor of three
 * people, because starting the Game turns on token issuance and a token issued
 * is a claim on everybody. Measured on 2026-08-30, all three could be reported
 * true while one person decided:
 *
 *   `governance.weight_mode` is a founder dial. In `custom` mode a member with
 *   no row in `governance_weights` weighs 0. The founder allocates 1 to
 *   themselves and nothing to the other two. The floor of three counts HEADS,
 *   so it passes. `openBallot` accepts a roll of three whose total weight is
 *   1. The founder votes yes. The engine divides 1 by 1 twice and reports
 *   100% participation and 100% agreement, and the frozen document tells the
 *   village that three people held a voice and every one of them agreed.
 *   Issuance opens and does not close again.
 *
 * The same file drives the second half of the same idea, because they are one
 * question asked twice: a platform VOICE token could be listed on the
 * exchange, priced, stocked out of `sys:mint` and sold for a card payment, and
 * `governance.weight_token` could name any listed token at all.
 *
 * THE CASES RUN IN ORDER. One village walks the whole path: a roll where two
 * people weigh nothing, then a roll where everybody does, then a vote one
 * person answered, then the one that carried, then the market. Run the whole
 * file, never a `-t` slice.
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
  console.warn("[launchWeight.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
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
const PORT = 17500 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "launchweight-admin";
const PASSWORD = "LaunchWeightTest123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
let wrenToken = "";
let wrenId = "";
let idaToken = "";
let idaId = "";

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

/** Every launch ballot this village has, read raw and never off a payload. */
const launchBallots = async (): Promise<Array<{ id: string; status: string; unity: number; quorum: number; roll: number; total: number; doc: string }>> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT id, status, unity_pct, quorum_pct, electorate_count, total_weight, doc_markdown " +
      "FROM ballots WHERE subject_type = 'village_launch' ORDER BY created_at, id",
  );
  return rows.map((r) => ({
    id: String(r.id), status: String(r.status), unity: Number(r.unity_pct), quorum: Number(r.quorum_pct),
    roll: Number(r.electorate_count), total: Number(r.total_weight), doc: String(r.doc_markdown ?? ""),
  }));
};

/** The frozen roll of one ballot, so a weight is read where it was stored. */
const frozenRoll = async (ballotId: string): Promise<number[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT weight FROM ballot_electorate WHERE ballot_id = ? ORDER BY weight DESC",
    [ballotId],
  );
  return rows.map((r) => Number(r.weight));
};

const gameStartRow = async (): Promise<any | null> => {
  const [rows] = await pool.query<any[]>("SELECT value FROM app_config WHERE config_key = 'game-start'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  if (!rows[0]) return null;
  return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
};

const allocate = (userId: string, weight: number) =>
  call("PUT", `/api/admin/governance/weights/${userId}`, {
    body: { weight, note: "Setting up the allocation table before the launch vote." },
  });

const vote = (ballotId: string, token: string, choice: string) =>
  call("POST", `/api/governance/ballots/${ballotId}/vote`, { token, body: { choice } });

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the launch weight route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-launchweight-"));
  // A village that has NOT started its Game, which is the whole premise.
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
      AUTH_TOKEN_SECRET: "launchweight-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Weight Founder" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: "", body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  expect((await call("PUT", "/api/admin/modules/governance/lifecycle", {
    body: { lifecycle: "members", examples: false },
  })).status, "governance must be on for this suite").toBe(200);

  const wren = await register("Wren Ashby", "lwwren");
  wrenToken = wren.token; wrenId = wren.id;
  const ida = await register("Ida Kestrel", "lwida");
  idaToken = ida.token; idaId = ida.id;
  for (const id of [founderId, wrenId, idaId]) {
    expect((await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: "member" } })).status).toBe(200);
  }

  // The journey, cleared: the founder's solitary setup that R67 puts before
  // the vote. These are the blocking items a fresh village of this shape holds.
  expect((await call("PUT", "/api/admin/brand", {
    body: { project: { name: "Larksfield", tagline: "A village on the fen", location: "Norfolk" } },
  })).status).toBe(200);
  expect((await call("PUT", "/api/admin/exit-policy", {
    body: {
      placeholder: false,
      voluntary: {
        noticePeriodDays: 21,
        valuationMethod: "Larksfield pays out a leaving member at the value the last cycle settled, in full, within one lunation.",
        unwindSteps: [
          "Bring back anything borrowed from the barn",
          "Finish or hand on the work you are holding",
          "The stewards settle what is owed and write it down",
        ],
      },
      involuntary: {
        decidingDomainId: "", appealDomainId: "",
        process: "Two stewards sit with the person first. Nothing formal begins until that conversation has happened.",
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
  })).status).toBe(200);
  expect((await call("POST", "/api/admin/launch/confirm", { body: { id: "backups-drilled", done: true } })).status).toBe(200);
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("three heads on the roll, and two of them weigh nothing", () => {
  it("takes the whole weight, which the platform lets a founder do", async () => {
    // Custom mode is a founder dial and allocating is a founder act. Neither
    // is the defect, and neither is refused: R56 says the village sets this.
    expect((await call("PUT", "/api/admin/variables/governance.weight_mode", {
      body: { value: "custom" },
    })).status).toBe(200);
    expect((await allocate(founderId, 1)).status).toBe(200);
    // Wren and Ida are never allocated. An absent row resolves to weight 0.
  });

  it("says on the journey page that two members carry no weight", async () => {
    const page = await call("GET", "/api/admin/launch");
    expect(page.status).toBe(200);
    // The head count is fine, which is exactly why the head count was not enough.
    expect(page.json?.vote?.onTheRoll).toBe(3);
    expect(String(page.json?.vote?.tooFew)).toContain("2 of the 3 members on the roll carry no voting weight");
    // And the card now says which rule turned members into weights, so a
    // founder reads it before pressing rather than after.
    expect(String(page.json?.vote?.why)).toContain("allocation table");
  });

  it("REFUSES to open the vote, and writes no ballot at all", async () => {
    const early = await call("POST", "/api/admin/launch/propose");
    expect(early.status, JSON.stringify(early.json)).toBe(409);
    expect(String(early.json?.error)).toContain("no voting weight");
    expect(early.json?.onTheRoll).toBe(3);
    expect(await launchBallots()).toEqual([]);
    expect(await gameStartRow()).toBeNull();
  });

  it("still refuses when only one of the two is given weight", async () => {
    expect((await allocate(wrenId, 5)).status).toBe(200);
    const still = await call("POST", "/api/admin/launch/propose");
    expect(still.status).toBe(409);
    expect(String(still.json?.error)).toContain("One of the 3 members");
    expect(await launchBallots()).toEqual([]);
  });
});

describe.skipIf(!DB_CONFIGURED)("everybody carries weight, and skew is left alone", () => {
  it("opens at 100/100 on an uneven allocation, because skew is the village's business", async () => {
    // 1, 5 and 20. Nothing here flattens that; R56 says the village decides
    // how weight is assigned, and zero was the hole, not inequality.
    expect((await allocate(idaId, 20)).status).toBe(200);
    const page = await call("GET", "/api/admin/launch");
    expect(page.json?.vote?.tooFew).toBeNull();

    const asked = await call("POST", "/api/admin/launch/propose");
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);

    const rows = await launchBallots();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("open");
    expect(rows[0].unity).toBe(100);
    expect(rows[0].quorum).toBe(100);
    expect(rows[0].roll).toBe(3);
    expect(rows[0].total).toBe(26);
    expect(await frozenRoll(rows[0].id)).toEqual([20, 5, 1]);
    // The document says how weight was assigned, in the frozen text itself.
    expect(rows[0].doc).toContain("allocation table");
  });

  it("does not carry on the heaviest member's yes alone", async () => {
    // 20 of 26 is 77% participation against a 100% quorum. This is the whole
    // point: with every seat above zero, 100% of the weight is 100% of the
    // people, so silence is still not consent however the weights are shaped.
    const [running] = await launchBallots();
    expect((await vote(running.id, idaToken, "yes")).status).toBe(200);
    await expire(running.id);
    const closed = await call("POST", `/api/governance/ballots/${running.id}/close`, {
      body: { outcomeNote: "Only one of us answered." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("no_quorum");
    expect(await gameStartRow()).toBeNull();
  });

  it("does not carry when the lightest member objects", async () => {
    expect((await call("POST", "/api/admin/launch/propose")).status).toBe(200);
    const rows = await launchBallots();
    const running = rows[rows.length - 1];
    expect((await vote(running.id, idaToken, "yes")).status).toBe(200);
    expect((await vote(running.id, wrenToken, "yes")).status).toBe(200);
    expect((await vote(running.id, founderToken, "no")).status).toBe(200);
    await expire(running.id);
    const closed = await call("POST", `/api/governance/ballots/${running.id}/close`, {
      body: { outcomeNote: "One of us is not ready." },
    });
    // 25 of 26 in favour is not unity, and one unit of weight is a whole person.
    expect(closed.json?.outcome).toBe("failed");
    expect(await gameStartRow()).toBeNull();
  });

  it("carries when all three answer and all three agree, and issuance opens", async () => {
    expect((await call("POST", "/api/admin/launch/propose")).status).toBe(200);
    const rows = await launchBallots();
    const running = rows[rows.length - 1];
    for (const t of [founderToken, wrenToken, idaToken]) {
      expect((await vote(running.id, t, "yes")).status).toBe(200);
    }
    await expire(running.id);
    const closed = await call("POST", `/api/governance/ballots/${running.id}/close`, {
      body: { outcomeNote: "All three of us agreed. Larksfield starts today." },
    });
    expect(closed.json?.outcome).toBe("passed");
    expect((await gameStartRow())?.ballotId).toBe(running.id);
    const mint = await call("POST", "/api/admin/tokens/gratitude/mint", {
      body: { toUserId: wrenId, amount: 5, reason: "The village started its Game." },
    });
    expect(mint.status, JSON.stringify(mint.json)).toBe(200);
  });
});

describe.skipIf(!DB_CONFIGURED)("voice is not the platform's to sell", () => {
  it("lets the village create its own voice token, which was never the problem", async () => {
    expect((await call("PUT", "/api/admin/modules/exchange/lifecycle", {
      body: { lifecycle: "members", examples: false },
    })).status).toBe(200);
    const made = await call("POST", "/api/admin/tokens", {
      body: { slug: "assembly-voice", name: "Assembly Voice", kind: "voice", transferable: false },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    expect(made.json?.token).toMatchObject({ kind: "voice", governance: "platform" });
  });

  it("REFUSES to list it, to stock it, and to sell it", async () => {
    const listed = await call("PUT", "/api/admin/exchange/tokens/assembly-voice", {
      body: { purchasable: true, swappable: false, active: true, sortOrder: 1 },
    });
    expect(listed.status, JSON.stringify(listed.json)).toBe(409);
    expect(String(listed.json?.error)).toContain("not the platform's to sell");

    // Stocking IS minting, and it used to run without asking whether the shop
    // could ever sell what it was minting.
    const stocked = await call("POST", "/api/admin/exchange/stock", {
      body: { tokenSlug: "assembly-voice", amount: 100 },
    });
    expect(stocked.status, JSON.stringify(stocked.json)).toBe(409);
    expect(String(stocked.json?.error)).toContain("not the platform's to sell");
    const [[minted]] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema
      "SELECT COUNT(*) AS n FROM token_ledger WHERE token_type = 'assembly-voice'",
    );
    expect(Number(minted.n), "no voice was minted for a shop that cannot sell it").toBe(0);

    const buy = await call("POST", "/api/exchange/buy", {
      token: wrenToken,
      body: { tokenSlug: "assembly-voice", quantity: 3 },
    });
    expect(buy.status).toBe(404);
  });

  it("keeps selling ordinary credits, so the firewall is not a wall", async () => {
    expect((await call("POST", "/api/admin/tokens", {
      body: { slug: "fen-credit", name: "Fen Credits", kind: "credit", transferable: true },
    })).status).toBe(200);
    expect((await call("PUT", "/api/admin/exchange/tokens/fen-credit", {
      body: { purchasable: true, active: true, sortOrder: 2 },
    })).status).toBe(200);
    expect((await call("POST", "/api/admin/exchange/stock", {
      body: { tokenSlug: "fen-credit", amount: 50 },
    })).status).toBe(200);
  });
});

describe.skipIf(!DB_CONFIGURED)("after the Birthing, what weighs a vote is the village's", () => {
  /*
   * REWRITTEN BY THE DISPATCHER LANE.
   *
   * Three cases used to live here, and all three began by flipping
   * `governance.weight_mode` and `governance.weight_token` from the admin panel
   * after the Game had started. The 2026-09-03 model closes that door: what one
   * vote MEANS is the village's own decision from the Birthing on, and its one
   * remaining route is a `governance_mode` ballot that lands at an instant a
   * steward can stop it inside.
   *
   * The rule those cases proved (a token money can buy cannot weigh a vote) is
   * NOT lost. It is pinned where it lives, in `server/lib/exchange.test.ts`,
   * against `weightTokenProblem` and `weightTokenListingProblem` directly, and
   * the change-set executor now runs the same refusal before it will switch a
   * village into token mode (`server/lib/changeset.test.ts`). What is proved
   * here is the door itself.
   */
  it("refuses the admin flip of the vote mode and names the vote instead", async () => {
    const refused = await call("PUT", "/api/admin/variables/governance.weight_mode", {
      body: { value: "token" },
    });
    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(String(refused.json?.error)).toContain("the village's to decide");

    // Refused means nothing was written. A 409 that had already flipped the
    // mode would be the worst of both.
    const now = await call("GET", "/api/admin/variables");
    const mode = (now.json?.variables ?? []).find((v: any) => v.key === "governance.weight_mode");
    expect(String(mode?.value ?? mode?.default)).not.toBe("token");
  });

  it("refuses the admin weight-allocation writes too, and points at the proposal", async () => {
    const one = await call("PUT", `/api/admin/governance/weights/${wrenId}`, {
      body: { weight: 99, note: "Trying it from the panel." },
    });
    expect(one.status, JSON.stringify(one.json)).toBe(409);
    expect(String(one.json?.proposeInstead)).toBe("weight_allocation");

    const bulk = await call("POST", "/api/admin/governance/weights/bulk", {
      body: { note: "All of us at once.", changes: [{ userId: wrenId, weight: 5 }] },
    });
    expect(bulk.status).toBe(409);
  });
});
