/**
 * What a consent actually moves, driven through the real handler into the real
 * ledger.
 *
 * A CONSENT IS A YES, AND THE QUEST PAYS WHAT IT SAYS (Rye, 2026-10-21).
 * Gratitude's only job is sharing out the cycle pool, so no quest pays it: the
 * witness confirms the work was done, and the quest pays the token amounts it
 * carries (0265) under the village's rule ceilings, or the village's standard
 * rules when it carries none. This file used to hold the arithmetic of a
 * Gratitude grant, its three dials and a badge's lift on it. All of that left
 * with the grant, and what is proved here instead is the property the cards
 * depend on: the ledger moves what the quest's card says, and no Gratitude
 * moves at all.
 *
 * NOTHING IS MOCKED. Everything that moves value is real: the claims repository
 * and its row lock, the owed rows and their settle, the faucet accounts the
 * migrations create, the token registry, the rules a fresh village boots with,
 * and the launch fact that opens issuance.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { CREDITS, HEARTS, VILLAGE_VOICE, toLedgerUnits, villageId } from "../lib/economy";
import { seedEconomy } from "../lib/economySeed";
import { recordGameStart } from "../lib/gameStart";
import { balanceOf, loadTokenRegistry, memberAccount } from "../lib/ledger";
import { ensureStayToken } from "../lib/stays";
import { claimsRepo, questsRepo, type ClaimsRepo, type QuestsRepo } from "../repos/quests";
import type { TokenAmount } from "../../shared/workValue";
import { register } from "./questClaims";

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

const consent = async (claimId: string, body: Record<string, unknown> = { approve: true }) => {
  const r = await fetch(`${base}/api/admin/quest-claims/${claimId}/consent`, { // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

/** A real quest and a real submitted claim on it, ready for a steward. */
const submittedOn = async (
  key: string,
  extra: { gratitude?: string; stayCreditReward?: number; valueMinor?: number; valueCurrency?: string; valueTokens?: TokenAmount[] | null } = {},
) => {
  const questId = `q-${key}`;
  const claimId = `claim-${key}`;
  await quests.add({ id: questId, title: `Quest ${key}`, gratitude: "", status: "Open", tags: [], order: 1, ...extra });
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

/** Every ledger posting keyed to this claim, as [token, units], read off the rows. */
const movedFor = async (claimId: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the route posted, on the S5 scratch schema this suite provisioned
    "SELECT token_type, amount, idempotency_key FROM token_ledger WHERE source_ref = ? ORDER BY token_type",
    [claimId],
  );
  return (rows as any[]).map((r) => [String(r.token_type), Number(r.amount)] as [string, number]);
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
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    // The rules a fresh village boots with: voice and credits on quest.completed.
    await seedEconomy(pool, villageId());
    // Boot registers the stay-credit token (`ensureStayToken`), and this harness does not boot.
    await ensureStayToken(pool);
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
    rung = [];
  });

  it("moves no Gratitude, whatever amount the body carries or the old label says", async () => {
    const heartsBefore = await balanceOf(pool, memberAccount(MEMBER.id), HEARTS);
    const id = await submittedOn("no-hearts", { gratitude: "50-100" });
    const out = await consent(id, { approve: true, amount: 999 });
    expect(out.status).toBe(200);
    // The claim records no grant, because there is none.
    expect(await claimRow(id)).toEqual({ status: "consented", amount: null });
    const moved = await movedFor(id);
    // DENOMINATOR FIRST: the consent did pay something, so the absence below is
    // about Gratitude and not about a consent that moved nothing at all.
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.map(([t]) => t)).not.toContain(HEARTS);
    expect(await balanceOf(pool, memberAccount(MEMBER.id), HEARTS)).toBe(heartsBefore);
  });

  it("pays a quest with no list of its own the village's standard rules, as it always did", async () => {
    const id = await submittedOn("standard");
    expect((await consent(id)).status).toBe(200);
    expect(await movedFor(id)).toEqual([
      [CREDITS, toLedgerUnits(CREDITS, 25)],
      [VILLAGE_VOICE, toLedgerUnits(VILLAGE_VOICE, 10)],
    ]);
  });

  it("pays a valued quest its own list and never the flat amounts, and tells the member what landed", async () => {
    const id = await submittedOn("own", { valueMinor: 2500000, valueCurrency: "CRC", valueTokens: [{ token: CREDITS, amount: 40 }] });
    expect((await consent(id)).status).toBe(200);
    expect(await movedFor(id)).toEqual([[CREDITS, toLedgerUnits(CREDITS, 40)]]);
    expect(consentedTitle()).toMatch(/^Your quest was consented: Quest own \(\+40 /);
  });

  it("pays an empty list nothing, and the work is still witnessed", async () => {
    const id = await submittedOn("empty", { valueMinor: 0, valueCurrency: "CRC", valueTokens: [] });
    expect((await consent(id)).status).toBe(200);
    expect(await claimRow(id)).toEqual({ status: "consented", amount: null });
    expect(await movedFor(id)).toEqual([]);
    expect(consentedTitle()).toBe("Your quest was consented: Quest empty");
  });

  it("holds a quest's own amount to the village's ceiling", async () => {
    // The seeded voice rule caps one quest at 100.
    const id = await submittedOn("over", { valueMinor: 1, valueCurrency: "CRC", valueTokens: [{ token: VILLAGE_VOICE, amount: 500 }] });
    expect((await consent(id)).status).toBe(200);
    expect(await movedFor(id)).toEqual([[VILLAGE_VOICE, toLedgerUnits(VILLAGE_VOICE, 100)]]);
  });

  it("releases a work-exchange quest's stay credits beside its list", async () => {
    const id = await submittedOn("exchange", { stayCreditReward: 3, valueMinor: 1, valueCurrency: "CRC", valueTokens: [{ token: CREDITS, amount: 5 }] });
    expect((await consent(id)).status).toBe(200);
    const moved = await movedFor(id);
    expect(moved).toContainEqual([CREDITS, toLedgerUnits(CREDITS, 5)]);
    expect(moved.map(([t]) => t)).toContain("stay-credit");
    expect(moved.map(([t]) => t)).not.toContain(VILLAGE_VOICE);
  });

  it("shows the queue what each consent will pay, and nothing for a quest that is gone", async () => {
    const id = await submittedOn("queue", { valueMinor: 500000, valueCurrency: "CRC", valueTokens: [{ token: CREDITS, amount: 12 }] });
    await claims.add({
      id: "claim-orphan",
      questId: "q-gone",
      questTitle: "Gone",
      userId: MEMBER.id,
      userName: MEMBER.name,
      status: "submitted",
      claimedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      artifactUrl: "",
      note: "",
    });
    const r = await fetch(`${base}/api/admin/quest-claims`); // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call
    const list = (await r.json()) as any[];
    const mine = list.find((c) => c.id === id);
    expect(mine.pay).toMatchObject({ value: { minor: 500000, currency: "CRC" }, source: "own", cadence: "once" });
    expect(mine.pay.lines.map((l: any) => [l.token, l.amount])).toEqual([[CREDITS, 12]]);
    expect(mine.bounds).toBeUndefined();
    expect(list.find((c) => c.id === "claim-orphan").pay).toBeNull();
  });
});
