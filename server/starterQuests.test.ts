/**
 * A NEW VILLAGE'S STARTER QUESTS, END TO END ON A REAL SCHEMA (A8 / 19g).
 *
 * Rye, sheet A8 / 19g: "a new village starts with a neutral, fully editable
 * starter set". Until 2026-10-31 the boot wrote fourteen LIVE quests onto any
 * empty board, claimable and paid from the ledger, and nobody reviewed them.
 * Now a fresh board's starters are standing examples, a founder keeps the
 * ones that fit (POST /api/admin/quests/:id/keep) and clears the rest, and
 * the Journey to Launch row `starter-quests` stays open until they have.
 *
 * What runs here is the real seeder, the real retirement, the real repos and
 * the real route bodies (registered on a recording app, the way
 * server/workPay.test.ts mounts them), and the launch row's own resolver.
 * The boot itself, which no longer writes live quests, is walked by
 * server/loop.e2e.test.ts against the built server.
 *
 * Each case states its starting village, because these share one schema.
 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import {
  exampleState,
  isRetired,
  isSeeded,
  loadExampleSeed,
  loadExampleState,
  modulesWithExamples,
  refreshExamples,
  retireExamplesWithPair,
  seedExamples,
} from "./lib/examples";
import { villageFactFor } from "./lib/launch";
import { acceptQuestProposal, proposeQuest } from "./lib/questProposals";
import { backfillQuestStories, LEGACY_QUESTS_SEED, repairSeededQuestCopy } from "./lib/legacyQuestSeed";
import { loadVariables } from "./lib/variables";
import { exampleQuestCount } from "./repos/questExamples";
import { claimsRepo as makeClaimsRepo, questsRepo as makeQuestsRepo } from "./repos/quests";
import { register as registerQuestRoutes } from "./routes/quests";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[starterQuests.test] TEST_DATABASE_URL not set. DB-backed tests SKIPPED.");
}

const SEEDS_DIR = new URL("./seeds", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const FROZEN = path.join(SEEDS_DIR, LEGACY_QUESTS_SEED);

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

let db: TestDb;
let pool: mysql.Pool;
let seed: any;
let starterIds: string[];
const handlers = new Map<string, Handler>();
let admin = true;

const call = async (key: string, req: any = {}) => {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    setHeader() { return res; },
    header() { return res; },
    type() { return res; },
    set() { return res; },
    send(b: unknown) { out.body = b; return res; },
  };
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
  return out;
};

const KEEP = "POST /api/admin/quests/:id/keep";
const VALUE = { valueMinor: 1500000 };

const row = async (id: string) => {
  const [rows] = await pool.query<any[]>("SELECT * FROM quests WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0] ?? null;
};

const boardSnapshot = async () => {
  const [rows] = await pool.query<any[]>("SELECT * FROM quests ORDER BY id"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return JSON.stringify(rows);
};

/** An empty village: no quest, no claim, and no memory of examples. */
async function emptyVillage(): Promise<void> {
  await pool.query("DELETE FROM quest_claims"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  await pool.query("DELETE FROM quests"); // module-review-ok: same
  await pool.query("DELETE FROM quest_proposals"); // module-review-ok: same
  await pool.query("DELETE FROM example_state"); // module-review-ok: same
  // The seeder no-ops on a module-level cache; this is the reset.
  await loadExampleState(pool);
}

/** What the boot does for quests on a fresh village since 2026-10-31. */
const boot = () => seedExamples(pool, "quests", seed, { baseCycle: 0 });

const journey = () => villageFactFor(pool, "starter-quests");

describe.skipIf(!configured)("a new village's starter quests", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    await loadVariables(pool);
    seed = loadExampleSeed(SEEDS_DIR);
    starterIds = (seed?.quests?.quests ?? []).map((q: any) => String(q.id));
    expect(starterIds.length, "the examples seed must carry the starter set").toBeGreaterThan(5);
    const record = (m: string) => (p: string, h: Handler) => void handlers.set(`${m} ${p}`, h);
    registerQuestRoutes({ get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") } as any, {
      isAdmin: async () => admin,
      authedUser: async () => ({ id: "u-member", name: "Ada Member" }),
      adminActor: () => (admin ? { id: "u-founder" } : null),
      getPool: () => pool,
      uploadsDir: ".",
      members: { all: async () => [], byId: async () => null },
      questsRepo: makeQuestsRepo(pool),
      claimsRepo: makeClaimsRepo(pool),
      crewsRepo: { all: async () => [] },
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async () => {},
      stageOf: async () => "member",
      loadRoles: () => [],
      roleIdsFor: () => [],
      currentPatternId: () => null,
      questConsentRecipients: async () => [],
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
      limitState: async () => "ok",
      projectCurrency: () => "USD",
    } as any);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    admin = true;
    await emptyVillage();
  });

  it("seeds a fresh village with the starters as inert examples, and opens the Journey row", async () => {
    expect(await journey(), "an empty board has nothing waiting").toMatchObject({ state: "ok" });

    expect(await boot()).toBeGreaterThanOrEqual(starterIds.length);
    expect(await exampleQuestCount(pool)).toBe(starterIds.length);
    expect(modulesWithExamples()).toContain("quests");

    const [rows] = await pool.query<any[]>("SELECT * FROM quests"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows.map((r) => r.id).sort()).toEqual([...starterIds].sort());
    for (const r of rows) {
      expect(Number(r.is_example), r.id).toBe(1);
      // No value and no label: the village sets that when it keeps one.
      expect(r.value_minor, r.id).toBeNull();
      expect(String(r.gratitude ?? ""), r.id).toBe("");
      // The whole story layer arrived, so a founder reads a complete quest.
      expect(String(r.story ?? "").length, r.id).toBeGreaterThan(20);
      expect(Array.isArray(r.steps) ? r.steps.length : JSON.parse(r.steps ?? "[]").length, r.id).toBeGreaterThan(2);
    }

    // Inert: nobody can claim one, and the admin save and delete refuse it.
    const [first] = starterIds;
    const claim = await call("POST /api/game/quests/:id/claim", { params: { id: first } });
    expect(claim.status).toBe(409);
    expect(claim.body.code).toBe("example_immutable");
    expect((await call("PUT /api/admin/quests/:id", { params: { id: first }, body: { title: "Mine" } })).status).toBe(409);
    expect((await call("DELETE /api/admin/quests/:id", { params: { id: first } })).status).toBe(409);
    const [[claims]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM quest_claims"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(claims.n)).toBe(0);

    const open = await journey();
    expect(open.state).toBe("missing");
    expect(open.detail).toContain(`${starterIds.length} starter quests are still waiting`);
  });

  it("keeps one starter as a real open quest, with the founder's words and value, and the example is gone", async () => {
    await boot();
    const id = starterIds[0];

    // A keep is a publish: an admin, a value, and the village's own upload.
    admin = false;
    expect((await call(KEEP, { params: { id }, body: VALUE })).status).toBe(401);
    admin = true;
    const noValue = await call(KEEP, { params: { id }, body: {} });
    expect(noValue.status).toBe(400);
    expect(noValue.body.error).toMatch(/says what it is worth/);
    expect((await call(KEEP, { params: { id }, body: { ...VALUE, imageUrl: "https://elsewhere.example/p.png" } })).status).toBe(400);
    expect(Number((await row(id)).is_example), "a refused keep changes nothing").toBe(1);

    const kept = await call(KEEP, { params: { id }, body: { ...VALUE, title: "Welcome whoever arrives" } });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(kept.body.id).toBe(id);
    expect(kept.body.isExample).toBe(false);
    expect(kept.body.startersLeft).toBe(true);

    const r = await row(id);
    expect(Number(r.is_example)).toBe(0);
    expect(String(r.status).toLowerCase()).toBe("open");
    expect(r.title).toBe("Welcome whoever arrives");
    expect(Number(r.value_minor)).toBe(1500000);
    expect(r.value_currency).toBe("USD");
    // The rest of the starter came with it, untouched.
    const authored = seed.quests.quests.find((q: any) => q.id === id);
    expect(r.story).toBe(authored.story);

    // Real now: a member can claim it, and the admin save reaches it.
    const claim = await call("POST /api/game/quests/:id/claim", { params: { id } });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
    expect((await call("PUT /api/admin/quests/:id", { params: { id }, body: { title: "Welcome a newcomer" } })).status).toBe(200);

    // Keeping one decides that one. The others still stand and the row is open.
    expect(await exampleQuestCount(pool)).toBe(starterIds.length - 1);
    expect(modulesWithExamples()).toContain("quests");
    expect(isRetired("quests")).toBe(false);
    expect((await journey()).detail).toContain(`${starterIds.length - 1} starter quests are still waiting`);
  });

  it("closes the row when the rest are cleared, and the kept quest survives the clearing", async () => {
    await boot();
    const [keep] = starterIds;
    expect((await call(KEEP, { params: { id: keep }, body: VALUE })).status).toBe(200);
    expect(await exampleQuestCount(pool), "examples present before the clear").toBe(starterIds.length - 1);

    // What Admin > Quests "Clear the starters you have not kept" calls.
    const cleared = await retireExamplesWithPair(pool, "quests", "admin_cleared", "u-founder");
    expect(cleared.retired).toBe(true);
    expect(cleared.removed).toBe(starterIds.length - 1);

    expect(await exampleQuestCount(pool)).toBe(0);
    expect(Number((await row(keep)).is_example), "the kept quest is the village's own").toBe(0);
    expect(await journey()).toEqual({ state: "ok", detail: "No starter quests are waiting. The board is the village's own" });
    expect(modulesWithExamples()).not.toContain("quests");
  });

  it("re-seeds nothing on a second boot, whether starters stand, were cleared, or were all kept", async () => {
    await boot();
    const standing = await boardSnapshot();
    await loadExampleState(pool);
    expect(await boot(), "starters already standing").toBe(0);
    expect(await boardSnapshot()).toBe(standing);

    await retireExamplesWithPair(pool, "quests", "admin_cleared", "u-founder");
    await loadExampleState(pool);
    expect(await boot(), "starters cleared").toBe(0);
    expect(await exampleQuestCount(pool)).toBe(0);
  });

  it("stamps the tombstone when the LAST starter is kept, so no refresh can ever seed them back", async () => {
    await boot();
    for (const [i, id] of starterIds.entries()) {
      const r = await call(KEEP, { params: { id }, body: VALUE });
      expect(r.status, `${id}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.startersLeft, id).toBe(i < starterIds.length - 1);
    }
    expect(await exampleQuestCount(pool)).toBe(0);
    expect(isRetired("quests")).toBe(true);
    expect(exampleState("quests")?.retiredReason).toBe("all_kept");
    expect((await journey()).state).toBe("ok");

    // The two paths that could otherwise bring the set back over a village
    // that decided every one of them.
    expect(await refreshExamples(pool, "quests", seed, { baseCycle: 0 })).toBe(0);
    await loadExampleState(pool);
    expect(await boot()).toBe(0);
    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM quests WHERE is_example = 0"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(n.n)).toBe(starterIds.length);
  });

  it("retires the starters when the village posts a quest of its own, and the row closes", async () => {
    await boot();
    const posted = await call("POST /api/admin/quests", { body: { title: "Fix the water tank", ...VALUE } });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    // Retirement rides the publish fire-and-forget; wait on the board itself.
    for (let i = 0; i < 40 && (await exampleQuestCount(pool)) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await exampleQuestCount(pool)).toBe(0);
    expect((await journey()).state).toBe("ok");
    expect(await row(posted.body.id)).toBeTruthy();
  });

  it("retires them too when the village approves a quest proposal onto its board", async () => {
    await boot();
    const p = await proposeQuest(pool, {
      villageId: "v1", moduleId: "saberra", batchId: "b1",
      prose: { title: "Mend the long bench", description: "An afternoon with a drill." }, batchCap: 10,
    } as any);
    expect(p.ok).toBe(true);
    const r = await acceptQuestProposal(pool, makeQuestsRepo(pool), {
      id: p.ok ? p.id : "", decidedBy: "u-founder", reward: { valueMinor: 900000, valueCurrency: "USD" },
    });
    expect(r.ok).toBe(true);
    for (let i = 0; i < 40 && (await exampleQuestCount(pool)) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await exampleQuestCount(pool)).toBe(0);
    expect((await journey()).state).toBe("ok");
  });

  it("leaves an existing village's live quests exactly as they are, with the row already satisfied", async () => {
    // The first tenant's shape: the fourteen from the frozen file, written
    // live the way the old boot block wrote them, then edited by the village.
    const repo = makeQuestsRepo(pool);
    const legacy = JSON.parse(fs.readFileSync(FROZEN, "utf-8")) as any[];
    for (const q of legacy) await repo.add({ tags: [], order: 0, status: "open", gratitude: "", ...q });
    await repo.update(legacy[0].id, (q) => { q.title = "Welcome Host"; q.story = "In our own words."; });
    await repo.update(legacy[1].id, (q) => { q.subtitle = ""; q.tips = []; });
    const before = await boardSnapshot();

    // The boot, as it now runs on that village.
    await loadExampleState(pool);
    expect(await boot()).toBe(0);
    expect(isSeeded("quests"), "decided without seeding, and asked again each boot").toBe(false);
    expect(await exampleQuestCount(pool)).toBe(0);
    expect(await journey()).toMatchObject({ state: "ok" });

    // The repair pass that matches by id against the frozen file: the
    // village's words stand, field by field.
    expect(await repairSeededQuestCopy(repo, FROZEN)).toBe(0);
    expect(await boardSnapshot()).toBe(before);

    // The fill pass touches only the two fields this village emptied, and
    // fills them from the FROZEN file, never from the starter set.
    expect(await backfillQuestStories(repo, FROZEN, "test-story")).toBe(1);
    const filled = await row(legacy[1].id);
    expect(filled.subtitle).toBe(legacy[1].subtitle);
    expect((await row(legacy[0].id)).title).toBe("Welcome Host");
    expect((await row(legacy[0].id)).story).toBe("In our own words.");
  });

  it("never layers starters over a village that worked its board and then emptied it", async () => {
    // Every quest deleted, one claim left from the work. The old live seed
    // put fourteen quests back on every boot of exactly this village.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO quest_claims (id, quest_id, quest_title, user_id, user_name, status) VALUES ('c-old','q-gone','Gone','u-member','Ada','consented')",
    );
    expect(await boot()).toBe(0);
    expect(await exampleQuestCount(pool)).toBe(0);
    expect((await journey()).state).toBe("ok");
  });

  // ── The adversarial pass ─────────────────────────────────────────────────

  it("lets only one of two simultaneous keeps of the same starter win", async () => {
    await boot();
    const id = starterIds[1];
    const [a, b] = await Promise.all([
      call(KEEP, { params: { id }, body: { ...VALUE, title: "First press" } }),
      call(KEEP, { params: { id }, body: { ...VALUE, title: "Second press" } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM quests WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(n.n)).toBe(1);
    expect((await row(id)).title).toBe(a.status === 200 ? "First press" : "Second press");
  });

  it("refuses to 'keep' a quest that is already real, and changes none of its words", async () => {
    await boot();
    const posted = await call("POST /api/admin/quests", { body: { title: "Our own quest", ...VALUE } });
    const id = posted.body.id;
    const r = await call(KEEP, { params: { id }, body: { ...VALUE, title: "Overwritten" } });
    expect(r.status).toBe(409);
    expect((await row(id)).title).toBe("Our own quest");
    expect((await call(KEEP, { params: { id: "ex-quest-nope" }, body: VALUE })).status).toBe(404);
  });

  it("cannot be steered by the body: the id and the flag are the server's", async () => {
    await boot();
    const id = starterIds[2];
    const r = await call(KEEP, { params: { id }, body: { ...VALUE, id: "q-hijack", isExample: true } });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(id);
    expect(Number((await row(id)).is_example)).toBe(0);
    expect(await row("q-hijack")).toBeNull();
  });
});
