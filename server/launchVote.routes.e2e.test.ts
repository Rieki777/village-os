/**
 * THE BUTTON THAT STOPPED MARKING AND STARTED ASKING (R74), driven over HTTP.
 *
 * The founder's ruling: "the 'mark the village launched' button actually
 * generates the first proposal that requires 100% unity and 100% quorum to
 * launch and a minimum of 3 people." R67 says what the vote is FOR: "a game
 * needs 3 people minimum to play (to actually issue tokens) so they can do
 * everything else to set up the game on their own."
 *
 * The harm metric for this file is one sentence, and every clause of it is
 * driven against the built server:
 *
 *   A village sets its whole Game up alone and can issue nothing; three
 *   members vote unanimously; issuance opens; and a vote one person did not
 *   answer never carries.
 *
 * THE CASES RUN IN ORDER. One village walks the whole path: too few people,
 * then a vote that missed, then a vote that was answered no, then the one that
 * carried. Run the whole file, never a `-t` slice.
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
import { HANDOVER_SET } from "../shared/capabilities";
import { PURPOSE_EXAMPLE } from "../shared/governingPurpose";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[launchVote.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
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
const PORT = 17100 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "launchvote-admin";
const PASSWORD = "LaunchVoteTest123!";

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
/** Wren's claim on a quest, carried between the first case and the last. */
let claimId = "";

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
const launchBallots = async (): Promise<Array<{ id: string; status: string; unity: string; quorum: string; roll: number }>> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT id, status, unity_pct, quorum_pct, electorate_count FROM ballots WHERE subject_type = 'village_launch' ORDER BY created_at, id",
  );
  return rows.map((r) => ({
    id: String(r.id),
    status: String(r.status),
    unity: String(r.unity_pct),
    quorum: String(r.quorum_pct),
    roll: Number(r.electorate_count),
  }));
};

/** The game-start document exactly as it stands, read raw. */
const gameStartRow = async (): Promise<any | null> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT value FROM app_config WHERE config_key = 'game-start'",
  );
  if (!rows[0]) return null;
  return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
};

/**
 * Every steward seat this village holds, read raw.
 *
 * THIS IS THE ASSERTION THAT THE CLOSER ACTUALLY CALLS THE SEATING, and it is
 * here rather than beside the unit tests for a reason worth writing down.
 * `seatCatalystsAsStewards` said in its own header for eight weeks that the
 * launch closer called it, was covered by a whole passing suite, and was
 * called by nothing outside that suite. A green function nobody calls is a
 * green about code that never runs, so the wiring gets driven over HTTP,
 * through a real vote, against the built server.
 */
const stewardSeats = async (): Promise<Array<{ userId: string; endsAt: number | null; grantedBy: string | null }>> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT user_id, UNIX_TIMESTAMP(term_ends_at) AS ends, granted_by FROM role_holders WHERE role_id = 'steward' ORDER BY user_id",
  );
  return rows.map((r) => ({
    userId: String(r.user_id),
    endsAt: r.ends === null ? null : Number(r.ends) * 1000,
    grantedBy: r.granted_by === null ? null : String(r.granted_by),
  }));
};

/** One claim's status, read from the table and never off a payload. */
const claimStatus = async (id: string): Promise<string | null> => {
  const [rows] = await pool.query<any[]>("SELECT status FROM quest_claims WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0] ? String(rows[0].status) : null;
};

/** Ask the founder to hand-mint. The simplest issuance a route can be told to do. */
const tryToIssue = (reason: string) =>
  call("POST", "/api/admin/tokens/gratitude/mint", {
    body: { toUserId: wrenId, amount: 5, reason },
  });

/**
 * One vote, and on the Birthing, whether this member stands for the seat.
 *
 * Rye, 2026-09-24: a founding member says at the launch vote that they want the
 * inaugural steward's seat. This drives that over HTTP, against the built
 * server, which is the only way to know the route actually carries the field:
 * a unit test writing the column by hand proves the seating and nothing about
 * the door in.
 */
async function vote(
  ballotId: string,
  token: string,
  choice: string,
  standsForSteward?: boolean,
): Promise<Answer> {
  return await call("POST", `/api/governance/ballots/${ballotId}/vote`, {
    token,
    body: standsForSteward === undefined ? { choice } : { choice, standsForSteward },
  });
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the launch vote route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-launchvote-"));
  /*
   * A village that has NOT started its Game, which is the whole premise. Every
   * other DB-backed suite gets the harness default, which is a village mid-life.
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
      AUTH_TOKEN_SECRET: "launchvote-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Launch Founder" },
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

  const wren = await register("Wren Ashby", "wren");
  wrenToken = wren.token; wrenId = wren.id;

  // Everybody reaches member, which is the rung `ballot.vote` unlocks at, so
  // the roll is real. The founder is on it too: this vote asks EVERYONE.
  for (const id of [founderId, wrenId]) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: "member" } });
    expect(r.status, `${id} reaches member`).toBe(200);
  }

  /*
   * THE JOURNEY, CLEARED. These are the blocking items a fresh village of this
   * shape still holds, and clearing them is exactly the founder's solitary
   * setup that R67 says comes before the vote.
   */
  const brand = await call("PUT", "/api/admin/brand", {
    body: { project: { name: "Larksfield", tagline: "A village on the fen", location: "Norfolk" } },
  });
  expect(brand.status, JSON.stringify(brand.json)).toBe(200);

  const policy = await call("PUT", "/api/admin/exit-policy", {
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
        decidingDomainId: "",
        appealDomainId: "",
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
  });
  expect(policy.status, JSON.stringify(policy.json)).toBe(200);

  const backups = await call("POST", "/api/admin/launch/confirm", {
    body: { id: "backups-drilled", done: true },
  });
  expect(backups.status, JSON.stringify(backups.json)).toBe(200);

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

  /*
   * THE GOVERNING PURPOSE STATEMENT, WHICH BLOCKS THE LAUNCH VOTE (0219).
   *
   * Rye ruled that a village writes what it is for before it births, and the
   * row is BLOCKING, so a suite that launches a village has to satisfy it the
   * way a real founder does. There is no manual confirm to tick here: the
   * check reads the document and runs the same validator the wizard runs, so
   * the statement has to actually be written.
   *
   * That refusal is not left unobserved by satisfying it here. It has its own
   * case in `server/governingPurpose.routes.e2e.test.ts`, which drives the
   * door shut and asserts the sentence a founder reads, plus the two
   * plausible non-answers the floor exists to refuse.
   */
  expect((await call("PUT", "/api/admin/purpose", {
    body: { statement: PURPOSE_EXAMPLE },
  })).status).toBe(200);
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("a village sets itself up alone, and can issue nothing", () => {
  it("refuses every issuance before the vote, and says why in words a steward can read", async () => {
    const before = await tryToIssue("A hand-mint before the village has started its Game");
    expect(before.status).toBe(400);
    expect(String(before.json?.error)).toContain("has not started its Game");
    expect(String(before.json?.error)).toContain("launch vote carries");
    expect(await gameStartRow()).toBeNull();
  });

  it("tells every member the Game has not started, with no admin login", async () => {
    const anon = await call("GET", "/api/game/mechanics", { token: null });
    expect(anon.status).toBe(200);
    expect(anon.json?.gameStart?.started).toBe(false);
    expect(anon.json?.gameStart?.ballotId).toBeNull();
  });

  it("refuses to consent a quest, and leaves the claim where a later consent can find it", async () => {
    /*
     * THE ONE ISSUING PATH THAT COULD LOSE A MEMBER'S WORK. Every other faucet
     * caller finds out late and says so; this one would have flipped the claim
     * to `consented` first, and consenting again is a 409 on a claim that is
     * no longer submitted. So the route asks before it writes, and this drives
     * that: the refusal, and the claim still standing at `submitted`.
     */
    const quest = await call("POST", "/api/admin/quests", {
      body: { title: "Clear the beck", gratitude: "10" },
    });
    expect(quest.status, JSON.stringify(quest.json)).toBe(200);
    const claimed = await call("POST", `/api/game/quests/${quest.json.id}/claim`, { token: wrenToken, body: {} });
    expect(claimed.status, JSON.stringify(claimed.json)).toBe(200);
    claimId = String(claimed.json.id);
    expect((await call("POST", `/api/game/quests/${quest.json.id}/submit`, {
      token: wrenToken,
      body: { note: "Beck cleared and the banks reseeded." },
    })).status).toBe(200);

    const consent = await call("POST", `/api/admin/quest-claims/${claimId}/consent`, {
      body: { approve: true, amount: 10 },
    });
    expect(consent.status).toBe(409);
    expect(String(consent.json?.error)).toContain("has not started its Game");
    expect(await claimStatus(claimId)).toBe("submitted");
  });

  it("will not open the vote with two people on the roll, and says how many more", async () => {
    const status = await call("GET", "/api/admin/launch");
    expect(status.status).toBe(200);
    expect(status.json?.blockingOpen, JSON.stringify(status.json?.items?.filter((i: any) => i.severity === "blocking" && i.state !== "ok"))).toBe(0);
    expect(status.json?.vote?.onTheRoll).toBe(2);
    expect(String(status.json?.vote?.tooFew)).toContain("One more member");

    const early = await call("POST", "/api/admin/launch/propose");
    expect(early.status).toBe(409);
    expect(String(early.json?.error)).toContain("One more member");
    expect(early.json?.onTheRoll).toBe(2);
    expect(await launchBallots()).toEqual([]);
  });
});

describe.skipIf(!DB_CONFIGURED)("the third member arrives and the vote can be asked", () => {
  it("opens at 100 and 100, with the roll frozen at three", async () => {
    const ida = await register("Ida Kestrel", "ida");
    idaToken = ida.token; idaId = ida.id;
    const staged = await call("PUT", `/api/admin/players/${idaId}/stage`, { body: { stageId: "member" } });
    expect(staged.status).toBe(200);

    /*
     * THE SLATE IS PART OF THE PROPOSAL (0220). Rye, 2026-09-24: "whoever is
     * clicking the 'launch village' button then selects from a list of members
     * in the proposal to carry the steward role so then it's there in the
     * proposal to be voted on." Driven through the real door, because a unit
     * test writing the rows by hand proves the seating and nothing about the
     * route that writes them.
     */
    const asked = await call("POST", "/api/admin/launch/propose", { body: { slate: [founderId] } });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);

    const rows = await launchBallots();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("open");
    expect(Number(rows[0].unity)).toBe(100);
    expect(Number(rows[0].quorum)).toBe(100);
    expect(rows[0].roll).toBe(3);
  });

  it("puts the slate IN the frozen document, so a member votes on it", async () => {
    // "so it's there in the proposal to be voted on" is a requirement about
    // `ballots.doc_markdown`, which is the string every member reads.
    const [running] = await launchBallots();
    const read = await call("GET", `/api/governance/ballots/${running.id}`, { token: idaToken });
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    const doc = String(read.json?.docMarkdown);
    expect(doc).toContain("Who carries the steward's seat");
    expect(doc, "the person who chose the list is named in it").toContain("chose who it puts forward");
    expect(doc, "and what accepting costs is in it too").toContain(
      `all ${HANDOVER_SET.length} of the powers this village has to give`,
    );
  });

  it("shows a DECLINE to an ordinary member, which is what Rye asked for", async () => {
    /*
     * Rye, 2026-09-24: "founders only for this first season ... and show the
     * declines". SHOWN means shown to the VILLAGE. Ida is an ordinary member
     * who is not on the slate and did not choose it, and she is the reader
     * this control is about.
     */
    const [running] = await launchBallots();
    const declined = await call("POST", `/api/governance/ballots/${running.id}/steward-slate`, {
      token: founderToken,
      body: { accept: false },
    });
    expect(declined.status, JSON.stringify(declined.json)).toBe(200);
    expect(declined.json?.answer).toBe("declined");

    const seen = await call("GET", `/api/governance/ballots/${running.id}/steward-slate`, { token: idaToken });
    expect(seen.status, JSON.stringify(seen.json)).toBe(200);
    expect(seen.json?.members?.length).toBe(1);
    expect(seen.json?.members?.[0]?.answer, "an ordinary member can see it").toBe("declined");
    expect(seen.json?.members?.[0]?.declinedAt, "with the time it was given").toBeTruthy();
    expect(seen.json?.members?.[0]?.mine, "and it is not hers").toBe(false);
    expect(String(seen.json?.proposedBy), "the page can say whose list this was").toBeTruthy();
    expect(seen.json?.powerCount).toBe(HANDOVER_SET.length);

    // AND SOMEBODY THE PROPOSAL NEVER NAMED HAS NOTHING TO ANSWER. The known
    // positive is the 200 four lines up, from the same route.
    const notNamed = await call("POST", `/api/governance/ballots/${running.id}/steward-slate`, {
      token: idaToken,
      body: { accept: true },
    });
    expect(notNamed.status).toBe(409);
    expect(String(notNamed.json?.error)).toContain("did not name you");
  });

  it("refuses a second one while the first is running", async () => {
    const again = await call("POST", "/api/admin/launch/propose");
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain("already voting");
    expect((await launchBallots()).length).toBe(1);
  });

  it("is a founder's act to open, and nobody else's", async () => {
    const notFounder = await call("POST", "/api/admin/launch/propose", { token: wrenToken });
    expect(notFounder.status).toBe(403);
  });
});

describe.skipIf(!DB_CONFIGURED)("a vote one person never answered does not carry", () => {
  it("closes as no_quorum, and nothing about the village changed", async () => {
    const [running] = await launchBallots();
    // Two of three answer. This is the whole engineering constraint of a 100%
    // quorum: silence is not a no, and it is not a yes either.
    expect((await vote(running.id, founderToken, "yes")).status).toBe(200);
    expect((await vote(running.id, wrenToken, "yes")).status).toBe(200);
    await expire(running.id);

    const closed = await call("POST", `/api/governance/ballots/${running.id}/close`, {
      body: { outcomeNote: "Ida was away and this one asks for everybody." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("no_quorum");

    expect(await gameStartRow()).toBeNull();
    const status = await call("GET", "/api/admin/launch");
    expect(status.json?.launchedAt).toBeNull();
    const stillRefused = await tryToIssue("A hand-mint after a vote that missed");
    expect(stillRefused.status).toBe(400);
    expect(String(stillRefused.json?.error)).toContain("has not started its Game");
  });

  it("can be asked again the same hour, on a new freeze", async () => {
    /*
     * FOUNDERS ONLY, FOR THIS FIRST SEASON, refused at the door. Wren is a
     * member, and the known positive is the proposal two lines below, which
     * opens with no slate at all.
     */
    const badSlate = await call("POST", "/api/admin/launch/propose", { body: { slate: [wrenId] } });
    expect(badSlate.status, JSON.stringify(badSlate.json)).toBe(409);
    expect(String(badSlate.json?.error)).toContain("Only founding members");
    expect((await launchBallots()).length, "and it opened nothing on its way out").toBe(1);

    const again = await call("POST", "/api/admin/launch/propose");
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const rows = await launchBallots();
    expect(rows.length).toBe(2);
    expect(rows[0].status).toBe("no_quorum");
    expect(rows[1].status).toBe("open");
    // The ballot that missed keeps its own frozen roll and its own dials.
    expect(rows[0].roll).toBe(3);
    expect(Number(rows[1].quorum)).toBe(100);

    // The journey page can say the village asked before.
    const status = await call("GET", "/api/admin/launch");
    expect(status.json?.vote?.past?.length).toBe(1);
    expect(status.json?.vote?.past?.[0]?.status).toBe("no_quorum");
    expect(status.json?.vote?.openBallot?.id).toBe(rows[1].id);
  });
});

describe.skipIf(!DB_CONFIGURED)("everybody answers and one says no", () => {
  it("does not carry, and the Game stays where it was", async () => {
    const rows = await launchBallots();
    const running = rows[rows.length - 1];
    expect((await vote(running.id, founderToken, "yes")).status).toBe(200);
    expect((await vote(running.id, wrenToken, "yes")).status).toBe(200);
    expect((await vote(running.id, idaToken, "no")).status).toBe(200);
    await expire(running.id);

    const closed = await call("POST", `/api/governance/ballots/${running.id}/close`, {
      body: { outcomeNote: "Ida wants the exit terms rewritten before we begin." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("failed");
    expect(await gameStartRow()).toBeNull();
  });
});

describe.skipIf(!DB_CONFIGURED)("everybody answers and everybody agrees", () => {
  it("carries, and that is the moment token issuance opens", async () => {
    const opened = await call("POST", "/api/admin/launch/propose", { body: { slate: [founderId] } });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const rows = await launchBallots();
    const running = rows[rows.length - 1];
    expect(running.status).toBe("open");

    /*
     * THE FOUNDER ACCEPTS THE NOMINATION AND WREN SETS THE FLAG WITHOUT ONE,
     * which is the whole of 0220 driven through the real door. Since the slate
     * exists, `standsForSteward` means "I accept the nomination this proposal
     * made of me", so Wren's is an answer to a question nobody asked her and
     * the seating below has to ignore it. She is also not a founding member,
     * so two separate rules would each stop her; the unit control that
     * isolates the slate rule from the founder rule is in
     * `server/stewardSlate.db.test.ts`.
     */
    const stood = await vote(running.id, founderToken, "yes", true);
    expect(stood.status, JSON.stringify(stood.json)).toBe(200);
    expect(stood.json?.standsForSteward, "the route recorded the acceptance, and said so").toBe(true);
    const wrenStood = await vote(running.id, wrenToken, "yes", true);
    expect(wrenStood.status).toBe(200);
    expect(wrenStood.json?.standsForSteward, "anybody may set it; the seating is where it is weighed").toBe(true);
    expect((await vote(running.id, idaToken, "yes")).status).toBe(200);
    await expire(running.id);
    const closed = await call("POST", `/api/governance/ballots/${running.id}/close`, {
      body: { outcomeNote: "All three of us agreed. Larksfield starts today." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");

    // The two facts, written by the close and by nothing else.
    const started = await gameStartRow();
    expect(started?.ballotId).toBe(running.id);
    expect(String(started?.startedAt)).toBeTruthy();
    const status = await call("GET", "/api/admin/launch");
    expect(String(status.json?.launchedAt)).toBeTruthy();
    expect(status.json?.launchedByBallotId).toBe(running.id);
    expect(status.json?.gameStart?.started).toBe(true);

    // And the thing the whole vote was about.
    const now = await tryToIssue("The village started its Game, so this can land");
    expect(now.status, JSON.stringify(now.json)).toBe(200);
    expect(now.json?.toBalance).toBe(5);
  });

  it("seats the founder who STOOD for it, with a term, and leaves the members where they were", async () => {
    /*
     * Rye, 2026-09-23: "Seat them at launch." Rye, 2026-09-24: for "whomever of
     * the founding members ... carry the inaugural role", who say so by "self
     * signaling at founding". The close is the only thing that has run since
     * the previous case, so a seat here was written by the closer and by
     * nothing else.
     *
     * Larksfield's roll is a founder and two members, and BOTH the founder and
     * Wren asked for the seat. So this drives both halves of the filter at
     * once: the stored role `founder` and the signal on the vote, and neither
     * on its own would produce this answer.
     */
    const rows = await launchBallots();
    const carried = rows[rows.length - 1];
    expect(carried.status).toBe("passed");

    const seats = await stewardSeats();
    expect(seats.map((s) => s.userId), "the founder who stood, and nobody else").toEqual([founderId]);
    expect(seats[0].endsAt, "no seat may enter with an indefinite time").not.toBeNull();
    expect(seats[0].endsAt!).toBeGreaterThan(Date.now());
    expect(seats[0].grantedBy, "the village put them here, not an administrator").toBe(carried.id);

    // Wren asked and is not a founding member. The known positive for that
    // empty answer is the seat above, written by the same call.
    const [wrenAsked] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT stands_for_steward FROM ballot_votes WHERE ballot_id = ? AND user_id = ?",
      [carried.id, wrenId],
    );
    expect(Number(wrenAsked[0]?.stands_for_steward), "they really did set it, through the route").toBe(1);

    /*
     * THE SEAT IS WORTH SOMETHING, AND IT IS WORTH ALL NINETEEN.
     *
     * Rye, 2026-09-24: the founding stewards "hold all powers at launch", which
     * he confirmed means all nineteen entrustable powers. Two facts and not
     * one: the role CARRIES each power, or nobody in it could act, and the
     * village HOLDS each power, or an administrator walks through the gate
     * with nothing anywhere saying they reached past anybody.
     *
     * Compared as whole sets against `HANDOVER_SET`, because `toContain` on one
     * key is green on a seat carrying eighteen, and eighteen is the shape of
     * the defect this lane closes.
     */
    const [roles] = await pool.query<any[]>("SELECT capabilities FROM roles WHERE id = 'steward'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const caps = typeof roles[0]?.capabilities === "string" ? JSON.parse(roles[0].capabilities) : roles[0]?.capabilities;
    expect([...caps].sort(), "the role carries every one of them").toEqual([...HANDOVER_SET].sort());
    const [holdings] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT capability, holder_role_id, moved_by_ballot_id FROM capability_holding ORDER BY capability",
    );
    expect(
      holdings.map((h: any) => String(h.capability)),
      "and every one of them is the village's, from this vote",
    ).toEqual([...HANDOVER_SET].sort());
    for (const h of holdings) {
      expect(String(h.holder_role_id)).toBe("steward");
      expect(String(h.moved_by_ballot_id)).toBe(carried.id);
    }

    // And the founder was told, on the same spine every other seating uses.
    const [rung] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT title FROM notifications WHERE user_id = ? AND type = 'role_appointed'",
      [founderId],
    );
    expect(rung, "a seat nobody was told about is not a seating").toHaveLength(1);
    expect(String(rung[0].title)).toContain("Steward");

    /*
     * AND THE RUNNING PROCESS KNOWS, which is a separate fact from the rows
     * above. `roles` and `role_holders` are served from an in-process cache
     * built at boot, the capability gate reads it, and the seating writes
     * underneath it. Without the reload this payload would still be serving
     * the pre-launch answer while the database says otherwise, and the founder
     * would hold a seat nothing could see until somebody restarted the server.
     */
    const me = await call("GET", "/api/game/me");
    expect(me.status, JSON.stringify(me.json)).toBe(200);
    expect(
      ((me.json?.roles ?? []) as Array<{ id: string }>).map((r) => r.id),
      "the cache the gate reads, not the table",
    ).toContain("steward");
  });

  it("pays the work that was waiting, because the claim was never stranded", async () => {
    // The other half of the guard three cases back. Wren's quest was submitted
    // before the village started and is consented now, at full value.
    const consent = await call("POST", `/api/admin/quest-claims/${claimId}/consent`, {
      body: { approve: true, amount: 10 },
    });
    expect(consent.status, JSON.stringify(consent.json)).toBe(200);
    expect(await claimStatus(claimId)).toBe("consented");
  });

  it("says so to every member, with no admin login", async () => {
    const anon = await call("GET", "/api/game/mechanics", { token: null });
    expect(anon.json?.gameStart?.started).toBe(true);
    expect(String(anon.json?.gameStart?.ballotId)).toMatch(/^bal-/);
  });

  it("keeps the record when a manual checklist item is ticked afterwards", async () => {
    /*
     * The clobber this file exists to catch. Every other write to the
     * launch-state document reads it whole and puts it back whole, so an admin
     * ticking a checklist item after the vote carried would have erased the
     * launch if `recordLaunchCarried` wrote the same way. It writes the three
     * fields in place instead, and this drives the exact sequence.
     */
    const before = (await call("GET", "/api/admin/launch")).json;
    expect(String(before.launchedAt)).toBeTruthy();

    expect((await call("POST", "/api/admin/launch/confirm", { body: { id: "backups-drilled", done: false } })).status).toBe(200);
    expect((await call("POST", "/api/admin/launch/confirm", { body: { id: "backups-drilled", done: true } })).status).toBe(200);

    const after = (await call("GET", "/api/admin/launch")).json;
    expect(after.launchedAt).toBe(before.launchedAt);
    expect(after.launchedByBallotId).toBe(before.launchedByBallotId);
    expect(after.gameStart?.started).toBe(true);
  });

  it("cannot be started twice", async () => {
    const again = await call("POST", "/api/admin/launch/propose");
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain("already started its Game");
  });
});
