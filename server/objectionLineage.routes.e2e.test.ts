/**
 * THE LINEAGE EDGE, DRIVEN OVER HTTP AGAINST THE BUILT SERVER (0102).
 *
 * `server/lib/objectionLineage.test.ts` proves the storage rules. What it
 * cannot see is the route, and the route is where the two decisions that
 * matter live:
 *
 *   1. NAMING AN OBJECTION IS OPTIONAL. A proposer who names nothing still
 *      opens their vote, exactly as before. If that ever stops being true this
 *      feature has made the engine worse for every village that will never use
 *      it, and most villages will never use it: objections exist only on
 *      consent ballots and the default method is this village's own dials.
 *
 *   2. A NAME THAT CANNOT BE HONOURED IS REFUSED, NOT DROPPED. A proposer who
 *      names an objection has made a claim about the village's record.
 *      Opening anyway with the link quietly unwritten would leave them
 *      believing the record says something it does not. So a bad name comes
 *      back as a sentence, the vote does not open, and the same proposal opens
 *      on the next attempt without it.
 *
 * The cases run IN ORDER: one objection walks the whole path, from raised, to
 * upheld, to the vote the amended version ran as. Run the whole file, never a
 * `-t` slice.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, like
 * `governance.routes.e2e.test.ts`. Run `pnpm build` first or you are testing
 * stale code. Skips loudly without TEST_DATABASE_URL.
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
  // eslint-disable-next-line no-console
  console.warn("[objectionLineage.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
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
const PORT = 22302 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "lineage-admin";
const PASSWORD = "Lineage123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
const voters: Array<{ name: string; token: string; id: string }> = [];

interface Answer {
  status: number;
  json: any;
}

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

const expire = async (ballotId: string) => {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

const proposalStatus = async (id: string): Promise<string> => {
  const [rows] = await pool.query<any[]>("SELECT status FROM mechanics_proposals WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return String(rows[0]?.status ?? "gone");
};

const ballotsOn = async (proposalId: string): Promise<number> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT COUNT(*) AS n FROM ballots WHERE subject_type = 'mechanics' AND subject_ref = ?",
    [proposalId],
  );
  return Number(rows[0]?.n ?? 0);
};

/** The frozen snapshot columns, read straight off the row the open wrote. */
const snapshotOf = async (ballotId: string) => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT method, weight_mode, unity_pct, quorum_pct, total_weight, electorate_count FROM ballots WHERE id = ?",
    [ballotId],
  );
  const [roll] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT user_id, weight FROM ballot_electorate WHERE ballot_id = ? ORDER BY user_id",
    [ballotId],
  );
  return {
    row: rows[0],
    roll: roll.map((r) => `${r.user_id}:${Number(r.weight)}`).join(","),
  };
};

async function makeProposal(title: string, to: string): Promise<string> {
  const made = await call("POST", "/api/game/mechanics/proposals", {
    body: {
      title,
      rationale: "The wet season takes the track out, and the deliveries stop with it. This is the version the village asked for.",
      changes: [{ key: "gratitude.base_budget", to }],
    },
  });
  expect(made.status, JSON.stringify(made.json)).toBe(200);
  return String(made.json?.id ?? "");
}

async function register(name: string, email: string) {
  const r = await call("POST", "/api/auth/register", {
    body: { name, email, password: PASSWORD, paths: ["resident"] },
    token: null,
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { name, token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the objection lineage route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-lineage-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

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
      AUTH_TOKEN_SECRET: "lineage-secret",
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
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Lineage Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", {
    body: { token: claim, password: PASSWORD },
    token: null,
  });
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  for (const name of ["Ada Vale", "Ben Orr", "Cara Lin"]) {
    const slug = name.split(" ")[0].toLowerCase();
    const who = await register(name, `${slug}-${PORT}@example.test`);
    const staged = await call("PUT", `/api/admin/players/${who.id}/stage`, { body: { stageId: "member" } });
    expect(staged.status, `${name} reaches member stage`).toBe(200);
    voters.push(who);
  }

  const on = await call("PUT", "/api/admin/modules/governance/lifecycle", {
    body: { lifecycle: "members", examples: false },
  });
  expect(on.status).toBe(200);
  // Objections exist only on consent ballots, so this village decides by
  // consent. Every other village never meets this feature at all.
  const method = await call("PUT", "/api/admin/variables/governance.default_method", { body: { value: "consent" } });
  expect(method.status, JSON.stringify(method.json)).toBe(200);
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

/**
 * THE PICKER MAY ONLY EVER OFFER WHAT THE ROUTE WILL ACCEPT.
 *
 * `GET /api/governance/objections/answerable` is the read a proposer's picker
 * is built from, and its whole reason for existing is that a name the route
 * refuses must never be offered. Finding out by being told no is not how
 * anybody should learn what they are allowed to do.
 *
 * So the offer is checked at three points of the SAME objection's walk below,
 * against the same three conditions `objectionLineageProblem` asks: absent
 * while its own vote is still running, present once that vote has closed, and
 * gone again the moment it has taken its one successor.
 */
async function answerableIds(): Promise<string[]> {
  const res = await call("GET", "/api/governance/objections/answerable");
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  expect(Array.isArray(res.json)).toBe(true);
  return res.json.map((o: any) => String(o.id));
}

describe.skipIf(!DB_CONFIGURED)("an objection that changed a proposal says so", () => {
  let firstProposal = "";
  let firstBallot = "";
  let objectionId = "";
  let secondProposal = "";
  let secondBallot = "";
  let plainSnapshot: Awaited<ReturnType<typeof snapshotOf>>;

  it("opens a vote with no objection named, which is how every vote is opened", async () => {
    firstProposal = await makeProposal("Widen the track before the wet season", "120");
    const opened = await call("POST", `/api/governance/mechanics/${firstProposal}/open-ballot`);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    firstBallot = String(opened.json?.ballot?.id ?? "");
    expect(firstBallot).toBeTruthy();
    expect(opened.json?.ballot?.method).toBe("consent");
    plainSnapshot = await snapshotOf(firstBallot);
    expect(Number(plainSnapshot.row.electorate_count)).toBeGreaterThanOrEqual(4);
  });

  it("carries an objection to a ruling, and integrated leaves it standing", async () => {
    const filed = await call("POST", `/api/governance/ballots/${firstBallot}/objections`, {
      token: voters[1].token,
      body: { text: "If we do this in the wet season the track will not carry the load, and we lose the deliveries." },
    });
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    objectionId = String(filed.json?.id ?? "");
    expect(objectionId).toBeTruthy();

    const ruled = await call("POST", `/api/governance/ballots/${firstBallot}/objections/${objectionId}/rule`, {
      body: { ruling: "integrated", note: "It stands. The proposal has to change and come back." },
    });
    expect(ruled.status, JSON.stringify(ruled.json)).toBe(200);

    const read = await call("GET", `/api/governance/ballots/${firstBallot}`);
    expect(read.status).toBe(200);
    expect(read.json?.standingObjections, "integrated still blocks").toBe(1);
  });

  it("offers nothing while the objection's own vote is still running", async () => {
    // Same condition the route refuses on, asked from the other side. The
    // objection is ruled and has no successor, so the only thing keeping it
    // off the list is the open ballot underneath it.
    expect(await answerableIds()).not.toContain(objectionId);
  });

  it("refuses to say what is answerable to somebody with no account", async () => {
    const stranger = await call("GET", "/api/governance/objections/answerable", { token: null });
    expect(stranger.status).toBe(401);
  });

  it("refuses to link an objection whose own vote is still running", async () => {
    const spare = await makeProposal("A version nobody has taken to a vote yet", "121");
    const refused = await call("POST", `/api/governance/mechanics/${spare}/open-ballot`, {
      body: { answersObjectionId: objectionId },
    });
    expect(refused.status).toBe(409);
    expect(String(refused.json?.error)).toContain("still running");
    expect(await ballotsOn(spare), "a refused link opens no vote at all").toBe(0);
    expect(await proposalStatus(spare)).toBe("open");
  });

  it("closes the first vote, which the objection is what failed", async () => {
    for (const who of voters) {
      const cast = await call("POST", `/api/governance/ballots/${firstBallot}/vote`, {
        token: who.token,
        body: { choice: "yes" },
      });
      expect(cast.status, JSON.stringify(cast.json)).toBe(200);
    }
    await expire(firstBallot);
    const closed = await call("POST", `/api/governance/ballots/${firstBallot}/close`, {
      body: { outcomeNote: "The objection stands, so the proposal goes back to be changed." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    // Everybody said yes and it still did not carry. That is consent.
    expect(closed.json?.outcome).toBe("failed");
    expect(await proposalStatus(firstProposal)).toBe("failed");
  });

  it("offers the objection once the vote it was raised on has finished", async () => {
    const offered = await call("GET", "/api/governance/objections/answerable");
    expect(offered.status).toBe(200);
    const mine = offered.json.find((o: any) => String(o.id) === objectionId);
    expect(mine, "a ruled objection on a closed vote must be nameable").toBeTruthy();
    // Enough to recognise it by, and no person in it. The picker shows the
    // objection's words and the decision it was raised on.
    expect(mine.status).toBe("integrated");
    expect(mine.ballotId).toBe(firstBallot);
    expect(mine.ballotTitle).toBe("Widen the track before the wet season");
    expect(String(mine.text)).toContain("wet season");
    expect(JSON.stringify(offered.json), "the offer names nobody").not.toMatch(/user_?id/i);
  });

  it("says nothing about lineage until somebody names one", async () => {
    const before = await call("GET", `/api/governance/objections/lineage?ids=${objectionId}`);
    expect(before.status).toBe(200);
    expect(before.json).toEqual([]);
  });

  it("refuses a name it cannot honour, and the same proposal opens on the next try", async () => {
    secondProposal = await makeProposal("Widen the track, and do it before the rain", "130");
    const bogus = await call("POST", `/api/governance/mechanics/${secondProposal}/open-ballot`, {
      body: { answersObjectionId: "obj-nothing-here" },
    });
    expect(bogus.status).toBe(409);
    expect(String(bogus.json?.error)).toContain("No objection on this village's record");
    expect(await ballotsOn(secondProposal), "a refused link opens no vote at all").toBe(0);
    expect(await proposalStatus(secondProposal)).toBe("open");
  });

  it("writes the edge when the proposer names the objection they answered", async () => {
    const opened = await call("POST", `/api/governance/mechanics/${secondProposal}/open-ballot`, {
      body: { answersObjectionId: objectionId },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    secondBallot = String(opened.json?.ballot?.id ?? "");
    expect(secondBallot).toBeTruthy();

    const lineage = await call("GET", `/api/governance/objections/lineage?ids=${objectionId}`);
    expect(lineage.status).toBe(200);
    expect(lineage.json).toHaveLength(1);
    expect(lineage.json[0].objectionId).toBe(objectionId);
    expect(lineage.json[0].ballotId).toBe(secondBallot);
    expect(lineage.json[0].title).toBe("Widen the track, and do it before the rain");
    // The lineage answer names no person, and it never may.
    expect(JSON.stringify(lineage.json)).not.toMatch(/user_?id/i);
  });

  it("stops offering an objection that has taken its one successor", async () => {
    // The third condition, and the one a stale picker would get wrong: the
    // record keeps the first answer forever, so continuing to offer this would
    // walk the next proposer into "already points at".
    expect(await answerableIds()).not.toContain(objectionId);
  });

  it("leaves the snapshot exactly as a vote opened without the field", async () => {
    const withField = await snapshotOf(secondBallot);
    for (const column of ["method", "weight_mode", "unity_pct", "quorum_pct", "total_weight", "electorate_count"]) {
      expect(String(withField.row[column]), `${column} must be untouched by the new field`).toBe(
        String(plainSnapshot.row[column]),
      );
    }
    expect(withField.roll, "the frozen roll must be untouched by the new field").toBe(plainSnapshot.roll);
  });

  it("keeps the first answer when a later proposal names the same objection", async () => {
    const third = await makeProposal("A third go at the track", "140");
    const taken = await call("POST", `/api/governance/mechanics/${third}/open-ballot`, {
      body: { answersObjectionId: objectionId },
    });
    expect(taken.status).toBe(409);
    expect(String(taken.json?.error)).toContain("already points at");
    expect(await ballotsOn(third)).toBe(0);

    const lineage = await call("GET", `/api/governance/objections/lineage?ids=${objectionId}`);
    expect(lineage.json[0].ballotId, "the record keeps the first answer").toBe(secondBallot);

    // And without the name, the very same proposal opens.
    const opened = await call("POST", `/api/governance/mechanics/${third}/open-ballot`);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
  });

  it("takes fifty ids at a time, which is why the panel asks in batches", async () => {
    // The cap is real and a village can reach it: in consent mode a `no` vote
    // files an objection by itself, so a large village voting one down puts
    // dozens on a single decision. Fifty-first in the list, the route does not
    // reach it; first in the list, it does. `fetchObjectionLineage` splits the
    // ask for exactly this reason, and objectionLineageBatch.test.ts holds it.
    const filler = Array.from({ length: 50 }, (_, i) => `obj-filler-${i}`);
    const past = await call("GET", `/api/governance/objections/lineage?ids=${[...filler, objectionId].join(",")}`);
    expect(past.status).toBe(200);
    expect(past.json, "the fifty first id is past the cap").toEqual([]);

    const within = await call("GET", `/api/governance/objections/lineage?ids=${[objectionId, ...filler].join(",")}`);
    expect(within.status).toBe(200);
    expect(within.json).toHaveLength(1);
  });

  it("answers an unknown id with nothing about it, and asks for nothing when asked for nothing", async () => {
    const unknown = await call("GET", "/api/governance/objections/lineage?ids=obj-nothing-here,obj-nor-this");
    expect(unknown.status).toBe(200);
    expect(unknown.json).toEqual([]);
    const empty = await call("GET", "/api/governance/objections/lineage?ids=");
    expect(empty.status).toBe(200);
    expect(empty.json).toEqual([]);
  });
});
