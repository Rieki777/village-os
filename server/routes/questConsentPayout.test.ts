/**
 * What a consent actually moves, driven through the real handler into the real
 * ledger.
 *
 * `server/lib/questConsent.test.ts` holds the dial arithmetic as a table. This
 * file proves the route feeds that arithmetic the right numbers and posts what it
 * returns: the grant a steward typed is what the claim records, the ledger moves
 * the payout, and a refusal moves nothing. A route that kept the old uncapped
 * multiplication, or passed the request where it meant the grant, is green in the
 * table and red here.
 *
 * WHAT IS MOCKED, AND WHY ONLY THAT. Three seams the route reads from module
 * scope instead of from its deps: the badges module's lifecycle, a member's
 * badge multiplier, and the consent dials. Everything that moves value is real:
 * the claims repository and its row lock, `postTransferOn`, the faucet accounts
 * the migrations create, the token registry, and the launch fact that opens
 * issuance.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { recordGameStart } from "../lib/gameStart";
import { loadTokenRegistry } from "../lib/ledger";
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
  console.warn("[questConsentPayout.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

const STEWARD = { id: "u-mara", name: "Mara Voss" };
const MEMBER = { id: "u-ada", name: "Ada Wren" };

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let claims: ClaimsRepo;
let quests: QuestsRepo;
let rung: Array<{ userId: string; type: string; title: string }> = [];

const consent = async (claimId: string, amount: number) => {
  const r = await fetch(`${base}/api/admin/quest-claims/${claimId}/consent`, { // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approve: true, amount }),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

/** A real quest and a real submitted claim on it, ready for a steward. */
const submittedOn = async (key: string, label: string) => {
  const questId = `q-${key}`;
  const claimId = `claim-${key}`;
  await quests.add({ id: questId, title: `Quest ${key}`, gratitude: label, status: "Open", tags: [], order: 1 });
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

/** Every recognition posting keyed to this claim, in ledger amounts. */
const posted = async (claimId: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the route posted, on the S5 scratch schema this suite provisioned
    "SELECT amount FROM token_ledger WHERE idempotency_key = ?",
    [`quest_consent:${claimId}`],
  );
  return (rows as any[]).map((r) => Number(r.amount));
};

const claimRow = async (claimId: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the route wrote, on the S5 scratch schema this suite provisioned
    "SELECT status, amount FROM quest_claims WHERE id = ?",
    [claimId],
  );
  const row = rows[0];
  return row ? { status: String(row.status), amount: row.amount == null ? null : Number(row.amount) } : null;
};

const consentedTitle = () => rung.find((n) => n.type === "quest_consented")?.title ?? "";

describe.skipIf(!configured)("what a quest consent moves (MySQL, real ledger)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await loadTokenRegistry(pool);
    // Issuance waits for the launch vote. This village has cast it.
    await recordGameStart(pool, { ballotId: "ballot-test", startedBy: STEWARD.id, note: "test village" });
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

  it("posted: a badge lifts the grant to the top of the range and not past it", async () => {
    const id = await submittedOn("posted-lift", "50-100");
    ctl.multiplier = 2;
    expect((await consent(id, 60)).status).toBe(200);
    // The steward's decision is what the claim records...
    expect(await claimRow(id)).toEqual({ status: "consented", amount: 60 });
    // ...and the ledger moved the lifted payout, stopped at the top of the
    // range. The old multiplication posted 120 on a quest advertising 50 to 100.
    expect(await posted(id)).toEqual([100]);
    expect(consentedTitle()).toContain("+100, including your badge bonus");
  });

  it("posted: at the top of the range a badge adds nothing, and the member is not told it did", async () => {
    const id = await submittedOn("posted-top", "50-100");
    ctl.multiplier = 3;
    expect((await consent(id, 100)).status).toBe(200);
    expect(await posted(id)).toEqual([100]);
    expect(consentedTitle()).toContain("(+100)");
    expect(consentedTitle()).not.toContain("badge");
  });

  it("capped: the lift stops at the bonus ceiling", async () => {
    ctl.vars = { "quest.consent_cap_mode": "capped", "quest.consent_cap_multiplier": "2" };
    const id = await submittedOn("capped-lift", "50-100");
    ctl.multiplier = 2;
    expect((await consent(id, 150)).status).toBe(200);
    expect(await claimRow(id)).toEqual({ status: "consented", amount: 150 });
    expect(await posted(id)).toEqual([200]);
  });

  it("capped: below the advertised floor is refused, and nothing moves", async () => {
    ctl.vars = { "quest.consent_cap_mode": "capped", "quest.consent_cap_multiplier": "2" };
    const id = await submittedOn("capped-floor", "50-100");
    const r = await consent(id, 40);
    expect(r.status).toBe(409);
    expect(String(r.body?.error)).toContain("below what this quest advertises");
    expect(await posted(id)).toEqual([]);
    expect(await claimRow(id)).toEqual({ status: "submitted", amount: null });
  });

  it("zero with the dial on: a quest with a floor completes, and no recognition moves", async () => {
    ctl.vars = { "quest.allow_zero_consent": "true" };
    const id = await submittedOn("zero-dial", "50-100");
    expect((await consent(id, 0)).status).toBe(200);
    expect(await claimRow(id)).toEqual({ status: "consented", amount: 0 });
    expect(await posted(id)).toEqual([]);
  });

  it("zero with the dial off: a quest that advertises 0 completes, which it could not before", async () => {
    const id = await submittedOn("zero-quest", "0");
    expect((await consent(id, 0)).status).toBe(200);
    expect(await claimRow(id)).toEqual({ status: "consented", amount: 0 });
    expect(await posted(id)).toEqual([]);
  });

  it("zero with the dial off: a quest with a floor still refuses it", async () => {
    const id = await submittedOn("zero-refused", "50-100");
    expect((await consent(id, 0)).status).toBe(400);
    expect(await claimRow(id)).toEqual({ status: "submitted", amount: null });
    expect(await posted(id)).toEqual([]);
  });

  it("with the badges module off, exactly the grant moves", async () => {
    ctl.badges = "off";
    ctl.multiplier = 3; // never asked while the module is off
    const id = await submittedOn("no-badges", "50-100");
    expect((await consent(id, 60)).status).toBe(200);
    expect(await posted(id)).toEqual([60]);
  });
});
