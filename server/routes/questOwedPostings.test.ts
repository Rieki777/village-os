/**
 * What a consent owes beyond recognition, recorded in its own commit and paid
 * after it, driven through the real routes into the real ledger (drizzle/0210,
 * server/repos/questOwedPostings.ts).
 *
 * Rye asked for a repair path and set its one condition on 2026-09-14: guard
 * against duplicate payments. So every case reads the LEDGER and the owed table,
 * never only a response:
 *
 *  - a consent records what it owes and pays all of it before it answers;
 *  - a consent at 0 owes the stay credits and no rule token;
 *  - two presses at once pay each still-owed row exactly once;
 *  - a posting that already landed pays nothing on a press, and its row reads posted;
 *  - a refusal no retry can change marks the row refused, and the next press
 *    does not try it again.
 *
 * WHAT IS MOCKED: the three module-scope seams questConsentPayout.test.ts mocks
 * for the same reason (the badges lifecycle, a member's multiplier and the
 * dials). Everything that moves value is real.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { owedForClaim, postOwed, villageId, type OwedPosting } from "../lib/economy";
import { seedEconomy } from "../lib/economySeed";
import { recordGameStart } from "../lib/gameStart";
import { loadTokenRegistry } from "../lib/ledger";
import { ensureStayToken } from "../lib/stays";
import { recordOwed } from "../repos/questOwedPostings";
import { claimsRepo, questsRepo, type ClaimsRepo, type QuestsRepo } from "../repos/quests";
import { register } from "./questClaims";

const ctl = vi.hoisted(() => ({
  /** `effectiveLifecycle("badges")`. */
  badges: "public",
  /** What `rewardMultiplierFor` answers for the member. */
  multiplier: 1,
  /** Dial values by key; a key absent here reads the platform default. */
  vars: {} as Record<string, string>,
}));

vi.mock("../lib/modules", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    effectiveLifecycle: (id: string) => (id === "badges" ? ctl.badges : actual.effectiveLifecycle(id)),
  };
});
vi.mock("../lib/seasonPatterns", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, rewardMultiplierFor: async () => ctl.multiplier };
});
vi.mock("../lib/variables", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    stringVar: (k: string) => (k in ctl.vars ? ctl.vars[k] : actual.stringVar(k)),
    numberVar: (k: string) => (k in ctl.vars ? Number(ctl.vars[k]) : actual.numberVar(k)),
    boolVar: (k: string) => (k in ctl.vars ? ctl.vars[k] === "true" : actual.boolVar(k)),
  };
});

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questOwedPostings.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

const STEWARD = { id: "u-owed-steward", name: "Mara Voss" };
const MEMBER = { id: "u-owed-member", name: "Ada Wren" };
const STAY = "stay-credit";

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let claims: ClaimsRepo;
let quests: QuestsRepo;
let rung: Array<{ userId: string; type: string; title: string }> = [];

const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};
const consent = (claimId: string, amount: number) =>
  call("POST", `/api/admin/quest-claims/${claimId}/consent`, { approve: true, amount });
const pay = (claimId: string) => call("POST", `/api/admin/quest-claims/${claimId}/owed/pay`);

/** A real quest and a real submitted claim on it, ready for a steward. */
const submittedOn = async (key: string, label: string, extra: { stayCreditReward?: number } = {}) => {
  const questId = `q-${key}`;
  const claimId = `claim-${key}`;
  await quests.add({ id: questId, title: `Quest ${key}`, gratitude: label, status: "Open", tags: [], order: 1, ...extra });
  await claims.add({
    id: claimId,
    questId,
    questTitle: `Quest ${key}`,
    userId: MEMBER.id,
    userName: MEMBER.name,
    status: "submitted",
    claimedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    artifactUrl: "",
    note: "Done.",
  });
  return claimId;
};

/** A claim already consented, with nothing in the ledger, for cases that record what it owes by hand. */
const consentedOn = async (key: string) => {
  const questId = `q-${key}`;
  const claimId = `claim-${key}`;
  await quests.add({ id: questId, title: `Quest ${key}`, gratitude: "50-100", status: "Open", tags: [], order: 1, stayCreditReward: 2 });
  await claims.add({
    id: claimId,
    questId,
    questTitle: `Quest ${key}`,
    userId: MEMBER.id,
    userName: MEMBER.name,
    status: "consented",
    amount: 60,
    claimedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
    artifactUrl: "",
    note: "Done.",
  });
  return { claimId, questId };
};

/** Price and record what a consented claim owes, on one connection, the way the consent's own commit does. */
const recordAsTheConsentDoes = async (claimId: string, questId: string): Promise<OwedPosting[]> => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const priced = await owedForClaim(conn, {
      id: claimId,
      questId,
      userId: MEMBER.id,
      granted: 60,
      stay: { reward: 2, questTitle: `Quest for ${claimId}` },
    });
    await recordOwed(conn, claimId, priced.owed);
    await conn.commit();
    return priced.owed;
  } finally {
    conn.release();
  }
};

/** Every ledger row under one key. */
const ledgerRows = async (key: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the routes posted, on the S5 scratch schema this suite provisioned
    "SELECT amount, token_type FROM token_ledger WHERE idempotency_key = ?",
    [key],
  );
  return (rows as any[]).map((r) => ({ amount: Number(r.amount), token: String(r.token_type) }));
};

/** The owed table's rows for one claim, straight off the table. */
const owedRows = async (claimId: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the routes recorded, on the S5 scratch schema this suite provisioned
    "SELECT idempotency_key, token_slug, state, refusal_reason, attempts FROM quest_owed_postings WHERE claim_id = ? ORDER BY idempotency_key",
    [claimId],
  );
  return (rows as any[]).map((r) => ({
    key: String(r.idempotency_key),
    token: String(r.token_slug),
    state: String(r.state),
    reason: r.refusal_reason == null ? null : String(r.refusal_reason),
    attempts: Number(r.attempts),
  }));
};

describe.skipIf(!configured)("what a consent owes, and paying it (MySQL, real ledger)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [MEMBER.id, MEMBER.name, `${MEMBER.id}@examples.invalid`],
    );
    await loadTokenRegistry(pool);
    // Issuance waits for the launch vote. This village has cast it.
    await recordGameStart(pool, { ballotId: "ballot-owed", startedBy: STEWARD.id, note: "test village" });
    // The rules a fresh village boots with: voice and credits on quest.completed.
    await seedEconomy(pool, villageId());
    // Boot registers the stay-credit token (`ensureStayToken`), and this harness does not boot.
    await ensureStayToken(pool);
    await loadTokenRegistry(pool);
    claims = claimsRepo(pool);
    quests = questsRepo(pool);

    const app = express();
    app.use(express.json());
    register(app, {
      isAdmin: async () => false,
      authedUser: async () => STEWARD,
      mayStillSee: async () => true,
      consentActor: async () => ({ ok: true, userId: STEWARD.id, isAdminActor: false }),
      getPool: () => pool,
      members: {
        all: async () => [],
        byId: async (id: string) => (id === MEMBER.id ? { ...MEMBER } : null),
        update: async (_id: string, fn: (u: any) => void) => {
          const u: any = { ...MEMBER };
          fn(u);
          return u;
        },
      },
      claimsRepo: claims,
      questsRepo: quests,
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async (n: any) => {
        rung.push({ userId: n.userId, type: n.type, title: String(n.title) });
      },
      notifyAdmins: async () => {},
      stageOf: async () => "member",
      recordStageEvent: async () => {},
      addActivity: async () => {},
      dormantBadgeIds: async () => [],
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    ctl.badges = "public";
    ctl.multiplier = 1;
    ctl.vars = {};
    rung = [];
  });

  it("a consent records everything it owes beyond recognition, and pays all of it before it answers", async () => {
    const id = await submittedOn("owed-paid", "50-100", { stayCreditReward: 2 });
    expect((await consent(id, 60)).status).toBe(200);

    const rows = await owedRows(id);
    expect(rows.map((r) => r.token).sort()).toEqual(["credits", STAY, "village-voice"]);
    expect(rows.every((r) => r.state === "posted")).toBe(true);
    for (const r of rows) expect(await ledgerRows(r.key)).toHaveLength(1);

    // Nothing is left for a steward to pay, and the stay credits rang once.
    const list = await call("GET", "/api/admin/quest-claims/owed");
    expect(list.status).toBe(200);
    expect(list.body.filter((x: any) => x.claimId === id)).toEqual([]);
    expect(rung.filter((n) => n.type === "stays")).toHaveLength(1);
  });

  it("a consent at 0 owes the stay credits and no rule token", async () => {
    ctl.vars = { "quest.allow_zero_consent": "true" };
    const id = await submittedOn("owed-zero", "50-100", { stayCreditReward: 2 });
    expect((await consent(id, 0)).status).toBe(200);
    const rows = await owedRows(id);
    expect(rows.map((r) => r.token)).toEqual([STAY]);
    expect(rows[0]?.state).toBe("posted");
  });

  it("two presses at once pay each still-owed row exactly once", async () => {
    const { claimId, questId } = await consentedOn("owed-race");
    const owed = await recordAsTheConsentDoes(claimId, questId);
    expect(owed.map((o) => o.tokenSlug).sort()).toEqual(["credits", STAY, "village-voice"]);
    expect((await owedRows(claimId)).every((r) => r.state === "owed")).toBe(true);

    const [a, b] = await Promise.all([pay(claimId), pay(claimId)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    for (const o of owed) expect(await ledgerRows(o.idempotencyKey)).toHaveLength(1);
    expect((await owedRows(claimId)).every((r) => r.state === "posted")).toBe(true);
    // Across both answers, every row was paid by exactly one of the presses.
    const paidKeys = [...a.body.outcomes, ...b.body.outcomes]
      .filter((o: any) => o.outcome === "posted" || o.outcome === "duplicate")
      .map((o: any) => o.key)
      .sort();
    expect(paidKeys).toEqual(owed.map((o) => o.idempotencyKey).sort());
    expect(rung.filter((n) => n.type === "stays")).toHaveLength(1);
  });

  it("a posting that already landed pays nothing on a press, and its row then reads posted", async () => {
    const { claimId, questId } = await consentedOn("owed-landed");
    const owed = await recordAsTheConsentDoes(claimId, questId);
    const stay = owed.find((o) => o.tokenSlug === STAY)!;
    // The ledger already holds this posting, as the old direct path could leave it.
    expect((await postOwed(pool, stay)).outcome).toBe("posted");

    const r = await pay(claimId);
    expect(r.status).toBe(200);
    expect(r.body.outcomes.find((o: any) => o.key === stay.idempotencyKey)?.outcome).toBe("duplicate");
    expect(await ledgerRows(stay.idempotencyKey)).toHaveLength(1);
    expect((await owedRows(claimId)).find((x) => x.key === stay.idempotencyKey)?.state).toBe("posted");
  });

  it("a refusal no retry can change marks the row refused, and the next press does not try it again", async () => {
    const { claimId } = await consentedOn("owed-refused");
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await recordOwed(conn, claimId, [
        {
          toUserId: MEMBER.id,
          tokenSlug: "no-such-token",
          units: 100,
          decimals: 2,
          from: "sys:cycle-pool",
          source: "quest_consent",
          sourceRef: claimId,
          description: "A token nobody registered",
          idempotencyKey: `owed-test:${claimId}:no-such-token`,
        },
      ]);
      await conn.commit();
    } finally {
      conn.release();
    }

    const first = await pay(claimId);
    expect(first.status).toBe(200);
    expect(first.body.outcomes).toEqual([expect.objectContaining({ outcome: "refused", reason: "rule" })]);
    expect((await owedRows(claimId))[0]).toMatchObject({ state: "refused", reason: "rule", attempts: 1 });

    const second = await pay(claimId);
    expect(second.body.outcomes).toEqual([]);
    expect((await owedRows(claimId))[0]?.attempts).toBe(1);

    const list = await call("GET", "/api/admin/quest-claims/owed");
    expect(list.body.find((x: any) => x.claimId === claimId)).toMatchObject({
      state: "refused",
      refusalReason: "rule",
      questTitle: "Quest owed-refused",
      holder: MEMBER.name,
    });

    // THE PROMISE, not a literal: the owed tail names the payee exactly as the
    // consent queue on the same page does, so a steward reading both sees one
    // person. A first name alone made two members who share one
    // indistinguishable at the one place a steward pays somebody.
    const queue = await call("GET", "/api/admin/quest-claims");
    const queued = queue.body.find((c: any) => c.id === claimId);
    expect(queued, "the queue carries this claim").toBeTruthy();
    expect(list.body.find((x: any) => x.claimId === claimId)?.holder).toBe(queued.userName);
  });

  it("before the Game starts, a consent at 0 leaves its stay credits owed, and after launch two presses pay them once", async () => {
    ctl.vars = { "quest.allow_zero_consent": "true" };
    const id = await submittedOn("owed-unlaunched", "50-100", { stayCreditReward: 2 });
    const stayKey = `queststay:${id}`;
    const [saved] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `value` FROM `app_config` WHERE `config_key` = 'game-start'",
    );
    expect(saved.length, "provisioning started the Game, which this case undoes").toBe(1);
    await pool.query("DELETE FROM `app_config` WHERE `config_key` = 'game-start'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    try {
      // A consent at 0 posts no recognition, so the launch gate does not refuse it,
      // and the stay credits it owes cannot issue yet.
      expect((await consent(id, 0)).status).toBe(200);
      expect(await owedRows(id)).toEqual([
        expect.objectContaining({ token: STAY, state: "owed", reason: "not_launched", attempts: 1 }),
      ]);
      expect(await ledgerRows(stayKey)).toEqual([]);

      const early = await pay(id);
      expect(early.body.outcomes).toEqual([expect.objectContaining({ outcome: "still_owed", reason: "not_launched" })]);
      expect(await ledgerRows(stayKey)).toEqual([]);
    } finally {
      const value = saved[0].value;
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `app_config` (`config_key`, `value`) VALUES ('game-start', ?)",
        [typeof value === "string" ? value : JSON.stringify(value)],
      );
    }

    const [a, b] = await Promise.all([pay(id), pay(id)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await ledgerRows(stayKey)).toHaveLength(1);
    expect((await owedRows(id))[0]).toMatchObject({ state: "posted", reason: null });
    expect(rung.filter((n) => n.type === "stays")).toHaveLength(1);
  });

  it("answers 404 for a claim that does not exist, and pays nothing", async () => {
    expect((await pay("claim-nobody-owes")).status).toBe(404);
  });
});
