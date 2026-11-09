/**
 * THE CLOSING WORDS AFTER THE BIRTHING (sweep decision D6, Rye 2026-11-06),
 * over real HTTP against a real database.
 *
 * Before the Game starts the exit policy's writers adopt what closing means
 * (`PUT /api/admin/exit-policy/closing`). After it, that write answers 409
 * naming the vote, and a member holding `proposal.open` opens a
 * `closing_policy` ballot at the structural tier; the closer adopts the words
 * stamped `ballot:<id>`. Built on server/routes/conflictAgreement.test.ts.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import type { CapabilityCtx } from "../../shared/capabilities";
import { CLOSING_POLICY, PROPORTIONAL_CLOSING_STATEMENT } from "../../shared/closingPolicies";
import { dbDocument } from "../repos/store-db";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { recordGameStart } from "../lib/gameStart";
import { ballotById } from "../lib/ballots";
import { CLOSING_BALLOT_NOW, CLOSING_FOUNDERS_NOW, CLOSING_PROPOSAL_KEY, closingProposalKeyFor } from "../lib/closingPolicy";
import { closingPolicyCloser } from "../lib/closingPolicyCloser";
import { register } from "./closingPolicy";

const configured = testDbConfigured();
if (!configured) console.warn("[closingPolicyBallot.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

type Person = { id: string; name: string; role: string; roleCapabilities: string[] };
const PEOPLE: Record<string, Person> = {
  member: { id: "cp-member", name: "Mara Lind", role: "member", roleCapabilities: [] },
  proposer: { id: "cp-proposer", name: "Tomas Vey", role: "member", roleCapabilities: ["proposal.open"] },
  admin: { id: "cp-admin", name: "Moss Fielding", role: "admin", roleCapabilities: [] },
};

const OWN_WORDS =
  "If the village closes, the land passes to a community land trust and the cash is shared equally among whoever still lives here.";
const ADOPTED = {
  policyId: "proportional-closing-balance",
  statement: PROPORTIONAL_CLOSING_STATEMENT,
  adoptedBy: "cp-admin",
  adoptedAt: "2026-10-01T00:00:00.000Z",
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
let exitPolicyRepo: ReturnType<typeof dbDocument<any>>;
const notices: Array<{ userId: string; type: string; title: string }> = [];

const who = (req: express.Request) => PEOPLE[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;
const ctxFor = (p: Person): CapabilityCtx => ({
  stageIndex: 0,
  stageIndexOf: () => -1,
  roleCapabilities: p.roleCapabilities,
  isAdmin: p.role === "admin",
  isFounder: false,
});

async function call(method: string, route: string, as: keyof typeof PEOPLE | null, body?: unknown) {
  const r = await fetch(`${base}${route}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

async function reset() {
  await pool.query("DELETE FROM app_config WHERE config_key IN (?,?) OR config_key LIKE ?", [ // module-review-ok: each case starts from the same village, on the scratch schema this suite provisioned
    "game-start",
    "exit-policy",
    `${CLOSING_PROPOSAL_KEY}:%`,
  ]);
  await pool.query("DELETE FROM ballots WHERE subject_type = ?", [CLOSING_POLICY]); // module-review-ok: fixture cleanup on the scratch schema this suite provisioned
  await writeConfigDocument(pool, "exit-policy", { placeholder: true, closing: ADOPTED });
  await exitPolicyRepo.load();
  notices.length = 0;
}

describe.skipIf(!configured)("the closing words' pen (D6)", () => {
  beforeAll(async () => {
    db = await provisionTestDb({ gameStarted: false });
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    for (const p of Object.values(PEOPLE)) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
        [p.id, p.name, `${p.id}@example.invalid`, "x", p.role],
      );
    }
    exitPolicyRepo = dbDocument<any>(pool, "exit-policy", {} as any);
    const app = express();
    app.use(express.json());
    register(app, {
      isAdmin: async (req) => who(req)?.role === "admin",
      adminActor: (req) => {
        const p = who(req);
        return p ? ({ id: p.id, name: p.name } as any) : null;
      },
      getPool: () => pool,
      exitPolicy: exitPolicyRepo,
      ballot: {
        authedUser: async (req) => who(req),
        capabilityCtx: async (user: any) => ctxFor(user),
        notify: async (n: any) => {
          notices.push(n);
          return { fresh: true } as any;
        },
        weightModeNow: () => ({ mode: "equal", token: null }) as any,
        buildElectorate: async () => Object.values(PEOPLE).map((p) => ({ userId: p.id, weight: 1 })),
        addActivity: async () => {},
      },
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop?.();
  });

  beforeEach(reset);

  it("before the Birthing: an admin adopts, and nobody opens a vote", async () => {
    const vote = await call("POST", "/api/governance/closing-policy-changes", "proposer", { policyId: "own-words", statement: OWN_WORDS });
    expect(vote).toEqual({ status: 409, body: { error: CLOSING_FOUNDERS_NOW } });
    const adopt = await call("PUT", "/api/admin/exit-policy/closing", "admin", { policyId: "own-words", statement: OWN_WORDS, adopt: true });
    expect(adopt.status, JSON.stringify(adopt.body)).toBe(200);
    expect(exitPolicyRepo.get().closing.statement).toBe(OWN_WORDS);
  });

  it("after the Birthing: the admin adoption answers 409 naming the vote, and the closing words do not move", async () => {
    await recordGameStart(pool, { ballotId: "b-birth", startedBy: "cp-admin", note: "The village began." });
    const adopt = await call("PUT", "/api/admin/exit-policy/closing", "admin", { policyId: "own-words", statement: OWN_WORDS, adopt: true });
    expect(adopt).toEqual({ status: 409, body: { error: "closing_policy_ballot_now", message: CLOSING_BALLOT_NOW } });
    expect(exitPolicyRepo.get().closing).toEqual(ADOPTED);
    expect((await readConfigDocument<any>(pool, "exit-policy"))?.closing).toEqual(ADOPTED);
  });

  it("after the Birthing: a proposal.open holder opens a closing_policy ballot at 80/50 custom, and a plain member cannot", async () => {
    await recordGameStart(pool, { ballotId: "b-birth", startedBy: "cp-admin", note: "The village began." });
    expect((await call("POST", "/api/governance/closing-policy-changes", null, {})).status).toBe(401);
    expect((await call("POST", "/api/governance/closing-policy-changes", "member", { policyId: "own-words", statement: OWN_WORDS })).status).toBe(403);
    // An admin account on its own is not a member holding proposal.open.
    expect((await call("POST", "/api/governance/closing-policy-changes", "admin", { policyId: "own-words", statement: OWN_WORDS })).status).toBe(403);
    expect((await call("POST", "/api/governance/closing-policy-changes", "proposer", { policyId: "own-words", statement: "TBD" })).status).toBe(400);
    expect(
      (await call("POST", "/api/governance/closing-policy-changes", "proposer", { policyId: ADOPTED.policyId, statement: ADOPTED.statement })).status,
    ).toBe(409);

    const opened = await call("POST", "/api/governance/closing-policy-changes", "proposer", { policyId: "own-words", statement: OWN_WORDS });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const ballot = (await ballotById(pool, opened.body.ballot.id))!;
    expect(ballot.subjectType).toBe(CLOSING_POLICY);
    expect(ballot.unityPct).toBeGreaterThanOrEqual(80);
    expect(ballot.quorumPct).toBeGreaterThanOrEqual(50);
    expect(ballot.method).toBe("custom");
    expect(ballot.docMarkdown).toContain(OWN_WORDS);
    const asked = await readConfigDocument<any>(pool, closingProposalKeyFor(ballot.id));
    expect(asked).toMatchObject({ ballotId: ballot.id, policyId: "own-words", statement: OWN_WORDS, proposedBy: "cp-proposer" });
    // Nothing moved yet.
    expect(exitPolicyRepo.get().closing).toEqual(ADOPTED);

    const second = await call("POST", "/api/governance/closing-policy-changes", "proposer", { policyId: "own-words", statement: `${OWN_WORDS} Again.` });
    expect(second.status).toBe(409);
    expect(second.body.ballotId).toBe(ballot.id);
  });

  it("a carried ballot writes the words stamped ballot:<id>, keeping the rest of the policy; a failed one changes nothing", async () => {
    await recordGameStart(pool, { ballotId: "b-birth", startedBy: "cp-admin", note: "The village began." });
    const opened = await call("POST", "/api/governance/closing-policy-changes", "proposer", { policyId: "own-words", statement: OWN_WORDS });
    const ballot = (await ballotById(pool, opened.body.ballot.id))!;
    const NOW = new Date("2026-11-20T09:00:00.000Z");
    const closer = closingPolicyCloser({
      getPool: () => pool,
      exitPolicy: exitPolicyRepo,
      notify: async (n) => {
        notices.push(n);
      },
      notifyAdmins: async () => {},
      addActivity: async () => {},
      recordAudit: () => {},
      ballotLink: (b) => `/decisions/${b.id}`,
      now: () => NOW,
    });

    const failed = await closer(ballot, "failed", "Too few agreed.", "system");
    expect(failed.applied).toEqual([]);
    expect(exitPolicyRepo.get().closing).toEqual(ADOPTED);

    const other = await closer({ ...ballot, id: "some-other-ballot" }, "passed", "", "system");
    expect(other.held).toContain("not recorded against it");
    expect(exitPolicyRepo.get().closing).toEqual(ADOPTED);

    const carried = await closer(ballot, "passed", "", "system");
    expect(carried.applied).toEqual(["closing-policy"]);
    const want = { policyId: "own-words", statement: OWN_WORDS, adoptedBy: `ballot:${ballot.id}`, adoptedAt: NOW.toISOString() };
    expect(exitPolicyRepo.get().closing).toEqual(want);
    expect(exitPolicyRepo.get().placeholder).toBe(true);
    expect((await readConfigDocument<any>(pool, "exit-policy"))?.closing).toEqual(want);
  });
});
