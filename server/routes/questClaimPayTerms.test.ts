/**
 * A CLAIM KEEPS THE PRICE IT WAS TAKEN AT (valuation spec C8; Rye, 2026-11-06).
 *
 * A quest's price can change while somebody is doing it: the Treasurer
 * re-prices the board (quest-reprice spec, 2026-11-09). Once a member has
 * taken a quest on, its price is fixed: only the worker's agreement or a vote
 * changes it. Until this, consent priced the claim off the quest row as it
 * stood at consent (`server/routes/questClaims.ts`), so a re-price moved what
 * an active claim was paid, up or down, with nobody asked.
 *
 * Now `openClaim` writes the quest's terms onto the claim under the quest's
 * row lock (`pay_terms`, drizzle/0342), and consent pays from those:
 *
 *   1. A quest with its own list, re-priced after the claim, pays the claim's
 *      list and cash, never the new ones.
 *   2. A quest priced by the village's standard (no list of its own), given a
 *      list after the claim, still pays the claim at the standard.
 *   3. A claim taken before this shipped carries no terms and pays the quest
 *      as it stands, which is what it always did.
 *
 * NOTHING IS MOCKED that moves value. Runs against the S5 harness.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { seedEconomy } from "../lib/economySeed";
import { villageId } from "../lib/economy";
import { recordGameStart } from "../lib/gameStart";
import { loadTokenRegistry } from "../lib/ledger";
import { ensureStayToken } from "../lib/stays";
import { claimsRepo, questsRepo, type ClaimsRepo, type QuestsRepo } from "../repos/quests";
import { register } from "./questClaims";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questClaimPayTerms.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

const STEWARD = { id: "u-terms-steward", name: "Mara Voss" };
const MEMBER = { id: "u-terms-member", name: "Ada Wren" };

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
const consent = (claimId: string) => call("POST", `/api/admin/quest-claims/${claimId}/consent`, { approve: true, amount: 0 });

type Terms = {
  valueMinor?: number;
  valueCurrency?: string;
  valueTokens?: Array<{ token: string; amount: number }> | null;
  cashMinor?: number;
  cashCurrency?: string;
};

/** A quest, taken on through the claim door the route uses, and handed in. */
const takenAndSubmitted = async (key: string, terms: Terms) => {
  const questId = `q-${key}`;
  const claimId = `claim-${key}`;
  await quests.add({ id: questId, title: `Quest ${key}`, gratitude: "", status: "Open", tags: [], order: 1, ...terms } as any);
  const taken = await claims.openClaim({
    id: claimId,
    questId,
    questTitle: `Quest ${key}`,
    userId: MEMBER.id,
    userName: MEMBER.name,
    status: "claimed",
    claimedAt: new Date().toISOString(),
    artifactUrl: "",
    note: "",
  });
  expect(taken.ok).toBe(true);
  const handed = await claims.submitOnce(claimId, { artifactUrl: "", note: "Done.", at: new Date().toISOString() });
  expect(handed.ok).toBe(true);
  return { questId, claimId };
};

/** The Treasurer re-prices the quest while the claim is open. */
const reprice = (questId: string, terms: Terms) => quests.update(questId, (q: any) => Object.assign(q, terms));

/** What the consent paid in tokens, by slug, read off the ledger. */
const paidTokens = async (claimId: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the consent posted, on the S5 scratch schema this suite provisioned
    "SELECT o.token_slug, l.amount FROM quest_owed_postings o JOIN token_ledger l ON l.idempotency_key = o.idempotency_key WHERE o.claim_id = ? AND l.amount > 0",
    [claimId],
  );
  const out: Record<string, number> = {};
  for (const r of rows as any[]) out[String(r.token_slug)] = Number(r.amount);
  return out;
};
/** The cash the consent left owed, read off the table. */
const cashOwed = async (claimId: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the consent recorded, on the S5 scratch schema this suite provisioned
    "SELECT amount_minor, currency FROM cash_owed WHERE occurrence_key LIKE ?",
    [`%${claimId}%`],
  );
  return (rows as any[]).map((r) => ({ minor: Number(r.amount_minor), currency: String(r.currency) }));
};

describe.skipIf(!configured)("a claim keeps the price it was taken at (C8; MySQL, real ledger)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
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

  it("a quest re-priced after the claim pays the claim its list and cash, never the new ones (C8)", async () => {
    const { questId, claimId } = await takenAndSubmitted("repriced", {
      valueMinor: 100000,
      valueCurrency: "CRC",
      valueTokens: [{ token: "credits", amount: 5 }],
      cashMinor: 20000,
      cashCurrency: "CRC",
    });
    await reprice(questId, { valueMinor: 9000000, valueTokens: [{ token: "credits", amount: 500 }], cashMinor: 4000000 });
    expect((await consent(claimId)).status).toBe(200);
    const paid = await paidTokens(claimId);
    // Ledger units: Credits carry two decimals, so 5 Credits post as 500.
    expect(paid.credits, "the claim's 5 Credits, never the re-price's 500").toBe(500);
    expect(await cashOwed(claimId)).toEqual([{ minor: 20000, currency: "CRC" }]);
  });

  it("a quest on the village's standard, given a list after the claim, still pays the claim at the standard", async () => {
    // What the standard pays, measured on a twin nobody re-priced.
    const twin = await takenAndSubmitted("standard-twin", {});
    expect((await consent(twin.claimId)).status).toBe(200);
    const atStandard = await paidTokens(twin.claimId);
    expect(Object.keys(atStandard).length, "the village's standard pays something").toBeGreaterThan(0);

    const { questId, claimId } = await takenAndSubmitted("standard", {});
    await reprice(questId, { valueMinor: 1468900, valueCurrency: "CRC", valueTokens: [{ token: "credits", amount: 7694 }] });
    expect((await consent(claimId)).status).toBe(200);
    expect(await paidTokens(claimId)).toEqual(atStandard);
  });

  it("a claim taken before claims kept their terms pays the quest as it stands", async () => {
    const questId = "q-legacy";
    const claimId = "claim-legacy";
    await quests.add({ id: questId, title: "Quest legacy", gratitude: "", status: "Open", tags: [], order: 1, valueTokens: [{ token: "credits", amount: 5 }] } as any);
    // `add` writes the row with no terms: the shape of every claim made before 0342.
    await claims.add({
      id: claimId,
      questId,
      questTitle: "Quest legacy",
      userId: MEMBER.id,
      userName: MEMBER.name,
      status: "submitted",
      claimedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      artifactUrl: "",
      note: "Done.",
    });
    expect((await claims.byId(claimId))?.payTerms ?? null).toBeNull();
    await reprice(questId, { valueTokens: [{ token: "credits", amount: 8 }] });
    expect((await consent(claimId)).status).toBe(200);
    expect((await paidTokens(claimId)).credits, "the quest's 8 Credits as it stands").toBe(800);
  });
});
