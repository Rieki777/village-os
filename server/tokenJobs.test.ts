/**
 * WHICH TOKEN DOES WHICH JOB (Rye, 2026-10-22), read from the places that decide it.
 *
 * The property: every answer comes from the one place that already decides that
 * job, so the list moves when that place moves and never disagrees with the
 * engine. Each case changes the deciding place and reads the list back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { CREDITS, EARNED_EQUITY, HEARTS, VILLAGE_VOICE, villageId } from "./lib/economy";
import { seedEconomy } from "./lib/economySeed";
import { loadTokenRegistry } from "./lib/ledger";
import { tokenJobs } from "./lib/tokenJobs";
import { loadVariables, setVariable } from "./lib/variables";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register } from "./routes/tokenJobs";
import { TOKEN_JOB_IDS, TOKEN_JOB_LABELS, type TokenJob, type TokenJobId } from "../shared/tokenJobs";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const byId = async (): Promise<Record<TokenJobId, TokenJob>> =>
  Object.fromEntries((await tokenJobs(pool)).map((j) => [j.id, j])) as Record<TokenJobId, TokenJob>;
const slugs = (j: TokenJob) => j.tokens.map((t) => t.slug);

describe.skipIf(!configured)("which token does which job", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadVariables(pool);
    await seedEconomy(pool, villageId());
    await loadTokenRegistry(pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("lists every job once, in order, under its own label", async () => {
    const jobs = await tokenJobs(pool);
    expect(jobs.map((j) => j.id)).toEqual([...TOKEN_JOB_IDS]);
    for (const j of jobs) expect(j.label).toBe(TOKEN_JOB_LABELS[j.id]);
  });

  it("reads quest and role pay off the enabled rules, and never offers Gratitude", async () => {
    const jobs = await byId();
    expect(slugs(jobs["work.quest"])).toEqual(expect.arrayContaining([CREDITS, VILLAGE_VOICE]));
    expect(slugs(jobs["work.quest"])).not.toContain(HEARTS);
    expect(jobs["work.quest"].setBy).toEqual({ kind: "mint_rules", trigger: "quest.completed" });
    // A Gratitude rule switched on for roles pays nobody, so it does not do the job.
    await pool.query("UPDATE `mint_rules` SET `enabled` = 1 WHERE `trigger` = 'role.cycle' AND `token_slug` = ?", [HEARTS]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    try {
      expect(slugs((await byId())["work.role"])).not.toContain(HEARTS);
    } finally {
      await pool.query("UPDATE `mint_rules` SET `enabled` = 0 WHERE `trigger` = 'role.cycle' AND `token_slug` = ?", [HEARTS]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
  });

  it("says plainly which jobs are fixed in code, with no control to offer", async () => {
    const jobs = await byId();
    for (const id of ["thanks", "pool.basis", "hypha.claim"] as const) {
      expect(jobs[id].assignable, id).toBe(false);
      expect(jobs[id].setBy.kind, id).toBe("code");
    }
    expect(slugs(jobs.thanks)).toEqual([HEARTS]);
    expect(slugs(jobs["hypha.claim"])).toEqual(expect.arrayContaining([VILLAGE_VOICE, EARNED_EQUITY]));
  });

  it("follows the dials: the pool's token, and vote weight only when votes are weighted", async () => {
    let jobs = await byId();
    expect(slugs(jobs["pool.payout"])).toEqual([CREDITS]);
    expect(jobs["pool.payout"].setBy).toEqual({ kind: "dial", key: "gratitude.pool_token" });
    // One person, one vote is no token at all.
    expect(jobs["vote.weight"].tokens).toEqual([]);
    expect((await setVariable(pool, "governance.weight_mode", "token")).ok).toBe(true);
    try {
      jobs = await byId();
      expect(slugs(jobs["vote.weight"])).toEqual([HEARTS]);
    } finally {
      await setVariable(pool, "governance.weight_mode", "equal");
    }
  });

  it("answers none for a job no token does, which is a real answer", async () => {
    const jobs = await byId();
    for (const id of ["dues", "revenue.share"] as const) {
      expect(jobs[id].tokens, id).toEqual([]);
      expect(jobs[id].setBy, id).toEqual({ kind: "nothing" });
    }
    expect(jobs["proposal.award"].setBy).toEqual({ kind: "dial", key: "gratitude.proposal_accept_award" });
    expect((await setVariable(pool, "gratitude.proposal_accept_award", "0")).ok).toBe(true);
    try {
      expect((await byId())["proposal.award"].tokens).toEqual([]);
    } finally {
      await setVariable(pool, "gratitude.proposal_accept_award", "100");
    }
  });

  it("names each token by its live registry name, so a rename reaches the screen", async () => {
    await pool.query("UPDATE `tokens` SET `name` = 'Commons Credits' WHERE `slug` = ?", [CREDITS]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadTokenRegistry(pool);
    try {
      expect((await byId())["pool.payout"].tokens).toEqual([{ slug: CREDITS, name: "Commons Credits" }]);
    } finally {
      await pool.query("UPDATE `tokens` SET `name` = 'Village Credits' WHERE `slug` = ?", [CREDITS]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await loadTokenRegistry(pool);
    }
  });

  it("serves the list to an admin only", async () => {
    const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
    let admin = false;
    register({ get: (p: string, h: any) => void handlers.set(p, h) } as any, { isAdmin: async () => admin, getPool: () => pool } as any);
    const call = async () => {
      const out: { status: number; body: any } = { status: 200, body: undefined };
      const res: any = {
        status(c: number) { out.status = c; return res; },
        json(b: unknown) { out.body = b; return res; },
      };
      await handlers.get("/api/admin/token-jobs")!({}, res);
      return out;
    };
    expect((await call()).status).toBe(401);
    admin = true;
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(ok.body.jobs.map((j: TokenJob) => j.id)).toEqual([...TOKEN_JOB_IDS]);
  });
});
