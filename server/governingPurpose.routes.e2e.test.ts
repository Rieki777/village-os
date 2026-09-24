/**
 * THE GOVERNING PURPOSE STATEMENT, DRIVEN (0219), against the built server.
 *
 * Rye, 2026-09-23. Four rulings, and this file drives each of them rather
 * than asserting about them:
 *
 *  1. The proposer writes a line, on the subjects that change how the village
 *     works and on no others, and it stays on the ballot.
 *  2. It blocks the Birthing. A village runs and sets up normally without one
 *     and cannot launch.
 *  3. "Founder keeps the pen until they give over all steward powers to the
 *     village."
 *  4. The handover confirm warns on the LAST power, which is
 *     `remaining.length === 1`.
 *
 * ── WHAT IS FIXTURE AND WHAT IS PRODUCTION, SAID ONCE AND MEANT ────────────
 *
 * Every assertion below about a COMPLETED handover, and every assertion about
 * `remaining.length === 1`, runs against rows this file INSERTS into
 * `capability_holding`. No village on this platform has ever been in either
 * state: the table is created empty and nothing seeds it, so the live village
 * holds zero of its nineteen transferable powers and every admin action
 * short-circuits the capability gate before it reaches a holding check.
 *
 * So a green here says the code does the right thing when a village reaches
 * that state. It says nothing whatever about any village having reached it,
 * and it must not be quoted as though it did.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { HANDOVER_SET } from "../shared/capabilities";
import { purposeStatementProblem } from "../shared/governingPurpose";
import { writeGoverningPurpose } from "./lib/governingPurpose";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[governingPurpose.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// A window in the gap below the 10081 file, checked by
// scripts/check-e2e-ports.mjs, never claimed by hand here.
const PORT = 9900 + (process.pid % 180);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "gps-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";

/**
 * A statement of the shape the fill-in template produces: who it serves, what
 * they suffer, the move from X to Y, by what means, and what becomes true. It
 * carries no village's name, because the brand ratchet counts test files.
 */
const REAL_STATEMENT = [
  "This village exists for the people who want to live and work together on one piece of land",
  "and keep finding that every arrangement open to them asks them to choose between a home they",
  "can afford and neighbours they can count on, so it moves them from being tenants of a",
  "landlord nobody elected to being members of a place they hold in common, by pooling their",
  "labour and their money through agreements they write themselves and can change by a vote,",
  "so that a person who arrives with nothing but their hands can end up with a stake, a say,",
  "and somewhere their children would want to come back to.",
].join(" ");

const A_SECOND_STATEMENT = REAL_STATEMENT.replace("one piece of land", "one piece of land together");

const A_REAL_LINE =
  "This raises the quorum on rule changes, which serves the part of the purpose about agreements the members write and can change by a vote.";

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any; text: string }> {
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

/** The launch item this lane added, off the live checklist. */
async function gpsLaunchItem(): Promise<{ state: string; detail: string; severity: string }> {
  const r = await call("GET", "/api/admin/launch");
  expect(r.status, "the launch checklist must answer").toBe(200);
  const item = (r.json?.items ?? []).find((i: any) => i.id === "gps-written");
  expect(item, "the checklist must carry the gps-written row").toBeTruthy();
  return { state: String(item.state), detail: String(item.detail ?? ""), severity: String(item.severity) };
}

/**
 * Put `n` of the transferable powers in the village's hands.
 *
 * WRITTEN UNDERNEATH THE ROUTES ON PURPOSE. `moveCapabilityToVillage` refuses
 * a role that does not already carry the power, which is right and is a
 * different rule being tested elsewhere. What this suite needs is the STATE,
 * and the state is what a reader of these assertions has to understand is
 * fabricated. The gate and `villageHandoverState` both read this table live
 * with no cache above it, so no restart is needed for the change to be seen.
 */
async function seedHoldings(n: number): Promise<void> {
  await pool.query("DELETE FROM capability_holding"); // module-review-ok: a fixture on the scratch schema this suite provisioned
  for (const cap of HANDOVER_SET.slice(0, n)) {
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO capability_holding (capability, holder_role_id, moved_by_ballot_id) VALUES (?,?,?)",
      [cap, "keepers", "bal-fixture"],
    );
  }
}

const serverLogs: string[] = [];

async function bootServer(): Promise<void> {
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "gps-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child!.stdout?.on("data", (d) => serverLogs.push(String(d)));
  child!.stderr?.on("data", (d) => serverLogs.push(String(d)));
  await waitForHealth({ base: BASE, logs: serverLogs, child });
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the governing purpose route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-gps-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
    "INSERT INTO roles (id, name, capabilities) VALUES ('keepers','The Keepers',?)",
    [JSON.stringify([])],
  );
  await bootServer();

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Purpose Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "PurposeTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  const founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  // The governance module ships OFF like every non-core module, and every
  // route under /api/governance is mounted behind `requireModule`.
  const mods = await call("GET", "/api/admin/modules");
  for (const m of mods.json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }

  /*
   * The founder stands as a MEMBER for the ceremonies below. The change
   * route asks `capabilityDecision` with `isAdmin: false` on purpose, so an
   * account whose only path to `proposal.open` is the admin plane is refused,
   * and `co-creator` is the rung that unlocks it.
   */
  await call("PUT", `/api/admin/players/${founderId}/stage`, { stageId: "co-creator" });
}, 180_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the governing purpose statement", () => {
  /*
   * ── RULING 2: IT BLOCKS THE BIRTHING ──────────────────────────────────────
   */
  it("a village with no statement cannot launch, and the row is blocking", async () => {
    const item = await gpsLaunchItem();
    expect(item.severity).toBe("blocking");
    expect(item.state).toBe("missing");
    expect(item.detail).toMatch(/Nothing is written yet/);

    const launch = await call("GET", "/api/admin/launch");
    expect(launch.json?.readyToLaunch, "no statement means the launch vote cannot be put").toBe(false);
    expect(
      (launch.json?.items ?? []).filter((i: any) => i.severity === "blocking" && i.state !== "ok").map((i: any) => i.id),
    ).toContain("gps-written");
  });

  /*
   * ── THE MINIMUM LENGTH REFUSES A PLAUSIBLE NON-ANSWER ─────────────────────
   *
   * Not an empty box, which anybody would notice. The two things a founder in
   * a hurry actually types.
   */
  it("refuses TBD from the founder, in words that name the floor", async () => {
    const r = await call("PUT", "/api/admin/purpose", { statement: "TBD" });
    expect(r.status).toBe(400);
    expect(String(r.json?.error)).toMatch(/at least 80 words/);
  });

  it("refuses one ordinary sentence", async () => {
    const r = await call("PUT", "/api/admin/purpose", {
      statement: "Our purpose is to build a thriving community on shared land where everybody has a home and a say in what happens next.",
    });
    expect(r.status).toBe(400);
    expect(String(r.json?.error)).toMatch(/at least 80 words/);
  });

  /*
   * ── THE FOUNDER PATH AND THE CLOSER PATH REACH THE SAME VALIDATION ────────
   *
   * Asked for by the Saberra lane, and the reason is the delay: the wizard
   * writes the first statement and the closer writes later ones, and under
   * the pen ruling the second may not happen for years. A drift between them
   * would not surface until a village actually voted one through, and by then
   * both answers would look deliberate.
   *
   * Proven two ways, because neither is enough alone. The SENTENCES are
   * compared, driven through the live route and through the writer the closer
   * calls, so a second validator would have to produce identical words by
   * accident. And the closer's own wiring is read, so a closer that stopped
   * calling the writer would fail here rather than passing on the strength of
   * a comparison it no longer participates in.
   */
  it("the founder's route and the writer the closer calls refuse in the same words", async () => {
    const throughTheRoute = await call("PUT", "/api/admin/purpose", { statement: "TBD" });
    const throughTheWriter = await writeGoverningPurpose(pool, { statement: "TBD", writtenBy: "bal-test" });
    expect(throughTheWriter.ok).toBe(false);
    expect(String(throughTheRoute.json?.error)).toBe((throughTheWriter as { error: string }).error);
    expect(String(throughTheRoute.json?.error)).toBe(purposeStatementProblem("TBD"));
  });

  it("the gps_change closer writes through that same writer", () => {
    // The chain, both links, because the executor lives in its own file and
    // the subject table points at it. Either link breaking is a closer that
    // no longer participates in the comparison the case above makes.
    const dispatcher = fs.readFileSync(path.resolve(process.cwd(), "server/index.ts"), "utf8");
    expect(dispatcher.slice(dispatcher.indexOf("[GPS_CHANGE]: twoPhase("), dispatcher.indexOf("[GPS_CHANGE]: twoPhase(") + 400))
      .toContain("gpsChangeCloser(");
    const closer = fs.readFileSync(path.resolve(process.cwd(), "server/lib/gpsChangeCloser.ts"), "utf8");
    expect(closer).toContain("writeGoverningPurpose(deps.getPool()");
  });

  /*
   * ── THE FOUNDER WRITES IT WHILE THE HANDOVER IS INCOMPLETE ────────────────
   */
  it("the founder writes it, and the launch row turns", async () => {
    const r = await call("PUT", "/api/admin/purpose", { statement: REAL_STATEMENT });
    expect(r.status, r.text).toBe(200);

    const item = await gpsLaunchItem();
    expect(item.state).toBe("ok");
    expect(item.detail).toMatch(/Written, \d+ words/);
  });

  it("the founder rewrites it, because the pen is still theirs", async () => {
    const r = await call("PUT", "/api/admin/purpose", { statement: A_SECOND_STATEMENT });
    expect(r.status, r.text).toBe(200);
    const read = await call("GET", "/api/governance/purpose");
    expect(read.json?.statement).toBe(A_SECOND_STATEMENT);
    expect(read.json?.writtenAt).toBeTruthy();
  });

  it("reports the pen and the handover it follows, with nothing held", async () => {
    const read = await call("GET", "/api/governance/purpose");
    expect(read.status).toBe(200);
    expect(read.json?.founderHoldsPen).toBe(true);
    expect(read.json?.handover?.complete).toBe(false);
    expect(read.json?.handover?.held).toEqual([]);
    // Re-measured rather than pinned to a number typed in a brief: the set is
    // derived from TRANSFERABLE, so this reads whatever that map says today.
    expect(read.json?.handover?.total).toBe(HANDOVER_SET.length);
    expect(read.json?.handover?.remaining?.length).toBe(HANDOVER_SET.length);
  });

  /*
   * ── RULING 1: THE PROPOSER WRITES A LINE, AND THE SCOPING IS THE RULING ───
   */
  it("refuses a rule change with no judgement line, once the village has a statement", async () => {
    const made = await call("POST", "/api/game/mechanics/proposals", {
      title: "Give a proposal longer to be read",
      rationale: "Three proposals in a row closed before the people they affected had read them, so the sensing window should be longer.",
      changes: [{ key: "governance.sensing_days", to: "10" }],
    });
    expect(made.status, made.text).toBe(200);
    expect(made.json?.status, "the founder stands high enough to open one").toBe("open");
    const proposalId = String(made.json?.id ?? "");
    expect(proposalId, made.text).toBeTruthy();

    const bare = await call("POST", `/api/governance/mechanics/${proposalId}/open-ballot`, {});
    expect(bare.status, bare.text).toBe(409);
    expect(String(bare.json?.error)).toMatch(/how it serves the governing purpose/);

    const ritual = await call("POST", `/api/governance/mechanics/${proposalId}/open-ballot`, {
      purposeAlignment: "it does",
    });
    expect(ritual.status, ritual.text).toBe(409);
    expect(String(ritual.json?.error)).toMatch(/at least 12 words/);

    const good = await call("POST", `/api/governance/mechanics/${proposalId}/open-ballot`, {
      purposeAlignment: A_REAL_LINE,
    });
    expect(good.status, good.text).toBe(200);

    const [rows] = await pool.query<any[]>( // module-review-ok: a readback on the scratch schema this suite provisioned
      "SELECT purpose_alignment FROM ballots WHERE subject_type = 'mechanics' AND subject_ref = ?",
      [proposalId],
    );
    expect(String(rows[0]?.purpose_alignment), "the line is frozen onto the ballot").toBe(A_REAL_LINE);

    const ballotId = String(good.json?.ballot?.id ?? "");
    const served = await call("GET", `/api/governance/ballots/${ballotId}`);
    expect(served.json?.purposeAlignment, "and it renders beside the proposal").toBe(A_REAL_LINE);
  });

  it("asks nothing of a small proposal, which is the half of the ruling most easily lost", async () => {
    const advisory = await call("POST", "/api/governance/advisory", {
      question: "Should the village plant the orchard on the south slope this season?",
      detail: "We have the trees and two weekends of help offered.",
    });
    expect(advisory.status, advisory.text).toBe(200);
    const [rows] = await pool.query<any[]>( // module-review-ok: a readback on the scratch schema this suite provisioned
      "SELECT purpose_alignment FROM ballots WHERE id = ?",
      [String(advisory.json?.ballot?.id ?? advisory.json?.id ?? "")],
    );
    expect(rows[0]?.purpose_alignment, "an advisory vote carries no judgement line").toBeNull();
  });

  /*
   * ── RULING 4: THE WARNING FIRES ON THE LAST POWER AND ON NO OTHER ─────────
   *
   * A seeded state. No village has ever been one power from a finished
   * handover.
   */
  it("says one power remains when one power remains, and names it", async () => {
    await seedHoldings(HANDOVER_SET.length - 1);
    const r = await call("GET", "/api/admin/capabilities/holding");
    expect(r.status).toBe(200);
    expect(r.json?.handover?.complete).toBe(false);
    expect(r.json?.handover?.remaining).toEqual([HANDOVER_SET[HANDOVER_SET.length - 1]]);
    expect(r.json?.handover?.remaining?.length, "this is what the confirm dialog warns on").toBe(1);
    expect(r.json?.handover?.held?.length).toBe(HANDOVER_SET.length - 1);
  });

  it("does not say one remains while two do", async () => {
    await seedHoldings(HANDOVER_SET.length - 2);
    const r = await call("GET", "/api/admin/capabilities/holding");
    expect(r.json?.handover?.remaining?.length).toBe(2);
  });

  it("the founder still holds the pen with eighteen of nineteen across", async () => {
    await seedHoldings(HANDOVER_SET.length - 1);
    const read = await call("GET", "/api/governance/purpose");
    expect(read.json?.founderHoldsPen, "one power of nineteen is not all steward powers").toBe(true);
    const write = await call("PUT", "/api/admin/purpose", { statement: REAL_STATEMENT });
    expect(write.status, write.text).toBe(200);
  });

  /*
   * ── RULING 3: THE PEN FOLLOWS THE HANDOVER ────────────────────────────────
   *
   * The control this lane exists to prove. The same write that succeeded one
   * assertion ago is refused now, and the only thing that changed is the
   * holding table.
   */
  it("refuses the founder's write once every power is in the village's hands", async () => {
    await seedHoldings(HANDOVER_SET.length);
    const read = await call("GET", "/api/governance/purpose");
    expect(read.json?.handover?.complete).toBe(true);
    expect(read.json?.founderHoldsPen).toBe(false);

    const write = await call("PUT", "/api/admin/purpose", { statement: A_SECOND_STATEMENT });
    expect(write.status, write.text).toBe(409);
    expect(String(write.json?.error)).toMatch(/the village's to change/);
    expect(String(write.json?.error)).toMatch(/put it to the whole roll/);

    const stillReads = await call("GET", "/api/governance/purpose");
    expect(stillReads.json?.statement, "a refused write changes nothing").toBe(REAL_STATEMENT);
  });

  /*
   * ── THE CHANGE BALLOT IS DORMANT UNTIL THE HANDOVER COMPLETES ─────────────
   */
  it("refuses a change ballot while the founder holds the pen, and counts what is left", async () => {
    await seedHoldings(0);
    const r = await call("POST", "/api/governance/purpose-changes", {
      statement: A_SECOND_STATEMENT,
      purposeAlignment: A_REAL_LINE,
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toMatch(new RegExp(`${HANDOVER_SET.length} of ${HANDOVER_SET.length} are still on the admin panel`));
  });

  it("opens the change ballot once the handover is complete, carrying the line and the statement", async () => {
    await seedHoldings(HANDOVER_SET.length);
    const r = await call("POST", "/api/governance/purpose-changes", {
      statement: A_SECOND_STATEMENT,
      purposeAlignment: A_REAL_LINE,
    });
    expect(r.status, r.text).toBe(200);
    const ballotId = String(r.json?.ballot?.id ?? "");
    expect(ballotId).toBeTruthy();

    const [ballots] = await pool.query<any[]>( // module-review-ok: a readback on the scratch schema this suite provisioned
      "SELECT subject_type, subject_ref, purpose_alignment FROM ballots WHERE id = ?",
      [ballotId],
    );
    expect(String(ballots[0]?.subject_type)).toBe("gps_change");
    expect(String(ballots[0]?.subject_ref)).toBe("statement");
    expect(String(ballots[0]?.purpose_alignment)).toBe(A_REAL_LINE);

    const [payload] = await pool.query<any[]>( // module-review-ok: a readback on the scratch schema this suite provisioned
      "SELECT statement FROM gps_change_proposals WHERE ballot_id = ?",
      [ballotId],
    );
    expect(String(payload[0]?.statement), "the statement lives in a row and never in the markdown").toBe(A_SECOND_STATEMENT);
  });

  it("refuses a change ballot carrying a statement the founder could not have saved", async () => {
    await seedHoldings(HANDOVER_SET.length);
    const r = await call("POST", "/api/governance/purpose-changes", {
      statement: "TBD",
      purposeAlignment: A_REAL_LINE,
    });
    expect(r.status).toBe(400);
    expect(String(r.json?.error)).toBe(purposeStatementProblem("TBD"));
  });
});
