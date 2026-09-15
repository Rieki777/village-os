/**
 * A quest says what need it meets, and the tag stays out of the claim gate.
 *
 * FOUR OUTCOMES, each measured against the table and not against the handler's
 * own return value:
 *
 *   1. One quest carries TWO needs, and the detail read lists both with the
 *      weight each was tagged with.
 *   2. Deleting a quest leaves NO ORPHAN LINK. Counted in `need_links` before
 *      and after, with a second quest's tag counted alongside so the delete is
 *      shown to be a scalpel and not a broom.
 *   3. A quest that refuses its delete keeps its tags. The empty state and the
 *      real zero are different facts, and this is the case that separates them.
 *   4. THE TAG NEVER REACHES A CLAIM GATE. A member with nothing recorded
 *      about their own needs claims a quest tagged to Vitality and gets exactly
 *      what they get from an untagged one: same status, same claim shape.
 *
 * WHY 4 IS WORTH A TEST AT ALL, given that nothing in the claim handler reads
 * a tag today. That is the assertion. Design rule A.1.7 says the tag is a
 * description and never a gate, and a rule with no test is a comment. The day
 * somebody wires `need_links` into the claim path for a plausible reason, this
 * goes red and names the ruling it broke.
 *
 * `register` runs against a fake Express that records handlers by method and
 * path, the shape server/routes/needs.test.ts and server/routes/land.test.ts
 * both use, so what runs is the real registration and the real handler bodies.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { claimsRepo as makeClaimsRepo, questsRepo as makeQuestsRepo } from "../repos/quests";
import { linkNeed, upsertScopeNeed } from "../lib/needs";
import { register } from "./quests";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") },
    handlers,
  };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader() {
      return res;
    },
    send(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
};

const configured = testDbConfigured();

describe.skipIf(!configured)("a quest carries the needs it meets", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let signedIn = true;

  /** How many tags this subject carries, read from the table itself. */
  const linkCount = async (subjectRef: string): Promise<number> => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM `need_links` WHERE `subject_type` = 'quest' AND `subject_ref` = ?",
      [subjectRef],
    );
    return Number(rows[0].n);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const { app, handlers: h } = collect();
    register(app, {
      isAdmin: async () => true,
      authedUser: async () => (signedIn ? { id: "u-claimer", name: "A Member" } : null),
      adminActor: () => ({ id: "founder-1" }),
      getPool: () => pool,
      uploadsDir: ".",
      members: { all: async () => [] },
      questsRepo: makeQuestsRepo(pool),
      claimsRepo: makeClaimsRepo(pool),
      crewsRepo: { all: async () => [] },
      firstName: (n: string) => n,
      notify: async () => {},
      // Every gate the claim handler DOES read, set to the permissive answer,
      // so a refusal in the claim tests can only have come from the tag.
      stageOf: async () => "seed",
      loadRoles: () => [],
      roleIdsFor: () => [],
      currentPatternId: () => null,
      questConsentRecipients: async () => [],
    } as any);
    handlers = h;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    signedIn = true;
    await pool.query("DELETE FROM `quest_claims`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `quests`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `need_links`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `village_needs`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await upsertScopeNeed(pool, { needKey: "vitality" });
    await upsertScopeNeed(pool, { needKey: "play" });
  });

  const makeQuest = async (id: string, title: string) => {
    const out = await call(handlers, "POST /api/admin/quests", {
      body: { id, title, gratitude: "50", status: "Open" },
    });
    expect(out.status).toBe(200);
    return id;
  };

  it("lists both needs one quest meets, each with the weight it was given", async () => {
    await makeQuest("q-forest", "Food forest build day");
    expect(await linkCount("q-forest"), "no tags before either is made").toBe(0);

    const first = await linkNeed(pool, {
      needKey: "vitality",
      subjectType: "quest",
      subjectRef: "q-forest",
      weight: "primary",
    });
    const second = await linkNeed(pool, {
      needKey: "play",
      subjectType: "quest",
      subjectRef: "q-forest",
      weight: "partial",
    });
    expect(first.ok && second.ok).toBe(true);
    expect(await linkCount("q-forest")).toBe(2);

    const read = await call(handlers, "GET /api/quests/:id", { params: { id: "q-forest" } });
    expect(read.status).toBe(200);
    const byKey = new Map(read.body.needs.map((n: any) => [n.needKey, n]));
    expect([...byKey.keys()].sort()).toEqual(["play", "vitality"]);
    expect((byKey.get("vitality") as any).weight).toBe("primary");
    expect((byKey.get("play") as any).weight).toBe("partial");
    // The label rides with the link, so a chip needs no second read.
    expect((byKey.get("vitality") as any).needLabel).toBeTruthy();
  });

  it("sends a stranger no tags at all, which is not the same as none", async () => {
    await makeQuest("q-forest", "Food forest build day");
    await linkNeed(pool, { needKey: "vitality", subjectType: "quest", subjectRef: "q-forest" });
    signedIn = false;
    const read = await call(handlers, "GET /api/quests/:id", { params: { id: "q-forest" } });
    expect(read.status).toBe(200);
    // The quest itself is public and stays public. `GET /api/needs/scope`
    // withholds the same facts at the same tier, and reading the tag off every
    // quest one at a time would rebuild the scope from outside.
    expect(read.body.quest.title).toBe("Food forest build day");
    expect("needs" in read.body, "the key is absent, so a real zero stays distinguishable").toBe(false);
  });

  it("answers an untagged quest with an empty list, which is a real zero", async () => {
    await makeQuest("q-bare", "Sweep the path");
    const read = await call(handlers, "GET /api/quests/:id", { params: { id: "q-bare" } });
    expect(read.body.needs).toEqual([]);
  });

  it("takes a quest's tags with it, and leaves its neighbour's alone", async () => {
    await makeQuest("q-forest", "Food forest build day");
    await makeQuest("q-keep", "Weekly kitchen");
    await linkNeed(pool, { needKey: "vitality", subjectType: "quest", subjectRef: "q-forest" });
    await linkNeed(pool, { needKey: "play", subjectType: "quest", subjectRef: "q-forest" });
    await linkNeed(pool, { needKey: "vitality", subjectType: "quest", subjectRef: "q-keep" });
    expect(await linkCount("q-forest")).toBe(2);
    expect(await linkCount("q-keep")).toBe(1);

    const gone = await call(handlers, "DELETE /api/admin/quests/:id", { params: { id: "q-forest" } });
    expect(gone.status).toBe(200);
    expect(await linkCount("q-forest"), "no orphan link survives the quest").toBe(0);
    expect(await linkCount("q-keep"), "the neighbour keeps every tag it had").toBe(1);
  });

  it("keeps every tag on a quest whose delete was refused", async () => {
    await makeQuest("q-flight", "Harvest week");
    await linkNeed(pool, { needKey: "play", subjectType: "quest", subjectRef: "q-flight" });
    // A claim in flight refuses the delete. The tag has to survive that, or a
    // failed delete would quietly strip what the village said the work was for.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO quest_claims (id, quest_id, quest_title, user_id, user_name, status) VALUES (?,?,?,?,?,?)",
      ["c-1", "q-flight", "Harvest week", "u-other", "Someone", "claimed"],
    );
    const refused = await call(handlers, "DELETE /api/admin/quests/:id", { params: { id: "q-flight" } });
    expect(refused.status).toBe(409);
    expect(await linkCount("q-flight")).toBe(1);
  });

  it("claims a tagged quest exactly the way it claims an untagged one", async () => {
    await makeQuest("q-tagged", "Water the seedlings");
    await makeQuest("q-untagged", "Fix the gate");
    await linkNeed(pool, {
      needKey: "vitality",
      subjectType: "quest",
      subjectRef: "q-tagged",
      weight: "primary",
    });
    /*
     * THE MEMBER HAS RECORDED NOTHING ABOUT VITALITY ON THEIR OWN CARD, which
     * is the condition a needs gate would most plausibly be built out of.
     * `member_needs` is a later lane's table, so this asks the schema whether
     * it exists yet and counts the member's rows when it does. Either way the
     * count is zero and the claim below has to go through.
     */
    const [tables] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'member_needs'",
    );
    if (Number(tables[0].n) > 0) {
      const [mine] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT COUNT(*) AS n FROM `member_needs` WHERE `user_id` = 'u-claimer'",
      );
      expect(Number(mine[0].n), "the claimer has said nothing about their own needs").toBe(0);
    }

    const tagged = await call(handlers, "POST /api/game/quests/:id/claim", { params: { id: "q-tagged" } });
    const untagged = await call(handlers, "POST /api/game/quests/:id/claim", { params: { id: "q-untagged" } });
    expect(tagged.status).toBe(200);
    expect(untagged.status).toBe(200);
    expect(tagged.body.status).toBe("claimed");
    expect(untagged.body.status).toBe("claimed");
    // Same shape, key for key. A tag that reached the gate would show up here
    // as an extra field, a missing one, or a different status.
    expect(Object.keys(tagged.body).sort()).toEqual(Object.keys(untagged.body).sort());
    const [claims] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT quest_id FROM quest_claims WHERE user_id = 'u-claimer' ORDER BY quest_id",
    );
    expect(claims.map((c: any) => String(c.quest_id))).toEqual(["q-tagged", "q-untagged"]);
  });
});
