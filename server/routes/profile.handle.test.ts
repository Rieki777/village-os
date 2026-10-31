/**
 * A LIVING MEMBER NEVER TAKES A DEPARTED HANDLE (`PUT /api/profile`).
 *
 * Releases before round 2 gave every tombstone the handle `departed-` and the
 * last eight characters of its id, and forum bylines and old links print it.
 * The sweep step `handle-after-tombstone` (server/lib/erasure.ts) takes that
 * handle off, which frees it. Until this check, the next living member to ask
 * for `departed-xxxxxxxx` got it, and every old link to the departed member's
 * page reached them instead: a stranger's name on a dead person's link.
 *
 * So a living member may not choose a handle that starts with `departed-`.
 * A member who already wears one (chosen before this rule, and never a
 * tombstone's, because handles are unique) keeps saving their profile with it:
 * nothing a living member relies on breaks.
 *
 * Driven through the real handler with the real users repository, on a scratch
 * schema. No TEST_DATABASE_URL: skips loudly, never passes hollowly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { usersRepo } from "../repos/users";
import { register as registerProfileRoutes } from "./profile";

const configured = testDbConfigured();
if (!configured) console.warn("[profile.handle] TEST_DATABASE_URL not set. DB-backed tests SKIPPED. A skip is not a pass.");

let db: TestDb;
let pool: mysql.Pool;

const q = async (sql: string, params: unknown[] = []): Promise<any[]> => {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows;
};

async function seedMember(id: string, handle: string): Promise<void> {
  await q(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`, `bio`) VALUES (?,?,?,'x',?,'')", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    [id, `Member ${id}`, `${id}@example.test`, handle],
  );
}

async function handleOf(id: string): Promise<string | null> {
  return (await q("SELECT `handle` FROM `users` WHERE `id` = ?", [id]))[0]?.handle ?? null; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
}

/** `PUT /api/profile` as this member, called with a plain request. */
async function save(id: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  let put: ((req: any, res: any) => Promise<unknown>) | undefined;
  const app = {
    get: () => undefined,
    post: () => undefined,
    put: (p: string, h: any) => { if (p === "/api/profile") put = h; },
  } as any;
  registerProfileRoutes(app, {
    authedUser: (async () => usersRepo(pool).byId(id)) as any,
    members: usersRepo(pool),
    publicUser: (u: any) => u,
    getPool: () => pool,
  });
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status: (s: number) => ((out.status = s), res),
    json: (b: any) => ((out.body = b), res),
  };
  await put!({ body, headers: {} }, res);
  return out;
}

describe.skipIf(!configured)("a living member and the departed- handles (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("refuses a handle that starts with departed-, in plain words, and writes nothing", async () => {
    await seedMember("ph-mira", "mira-h");
    const out = await save("ph-mira", { handle: "departed-gone-old", bio: "Bees by the pond." });
    expect(out.status, `a living member may not take a departed handle: ${JSON.stringify(out.body)}`).toBe(400);
    expect(String(out.body?.error), "the member is told why").toMatch(/"departed-".*members who have left/);
    expect(await handleOf("ph-mira"), "their handle did not move").toBe("mira-h");
    const [row] = await q("SELECT `bio` FROM `users` WHERE `id` = ?", ["ph-mira"]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(row?.bio, "and nothing else in the save was written").toBe("");
  });

  it("refuses it in capitals and with spaces around it too", async () => {
    await seedMember("ph-ivo", "ivo-h");
    const out = await save("ph-ivo", { handle: "  Departed-Gone-Old " });
    expect(out.status).toBe(400);
    expect(await handleOf("ph-ivo")).toBe("ivo-h");
  });

  it("the control: an ordinary handle saves, and so does one with departed in the middle", async () => {
    await seedMember("ph-tam", "tam-h");
    const plain = await save("ph-tam", { handle: "tam-fern" });
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    expect(await handleOf("ph-tam")).toBe("tam-fern");
    const middle = await save("ph-tam", { handle: "tam-departed-not" });
    expect(middle.status, JSON.stringify(middle.body)).toBe(200);
    expect(await handleOf("ph-tam")).toBe("tam-departed-not");
  });

  it("a member who already wears one keeps saving their profile, and cannot move to another", async () => {
    await seedMember("ph-old", "departed-ab12cd34");
    const same = await save("ph-old", { handle: "departed-ab12cd34", bio: "Still here." });
    expect(same.status, `sending back the handle they hold breaks nothing: ${JSON.stringify(same.body)}`).toBe(200);
    expect(await handleOf("ph-old")).toBe("departed-ab12cd34");
    const other = await save("ph-old", { handle: "departed-ef56gh78" });
    expect(other.status).toBe(400);
    expect(await handleOf("ph-old")).toBe("departed-ab12cd34");
  });

  it("the handle a name gives drops a leading departed-, and only a leading one", async () => {
    const { livingHandle } = await import("../lib/profile");
    expect(livingHandle("departed-gone-old")).toBe("gone-old");
    expect(livingHandle("departed-departed-x")).toBe("x");
    expect(livingHandle("departed")).toBe("departed");
    expect(livingHandle("a-departed-member")).toBe("a-departed-member");
    expect(livingHandle("departed-")).toBe("member");
  });
});
