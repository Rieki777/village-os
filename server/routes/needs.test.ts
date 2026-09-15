/**
 * The needs routes: the refusals without a database, the round trip with one.
 *
 * TWO HALVES, ON PURPOSE. What the handlers decide (who may write, what a bad
 * body earns, that a PUT retires nothing) is decision logic and runs against a
 * stub pool, fast and everywhere. What the store does under a real schema is
 * proved in server/lib/needs.test.ts; the round trip below is the seam between
 * the two, so it takes a scratch schema and exercises the actual SQL through
 * the actual handlers.
 *
 * `register` is called against a fake Express that records handlers by method
 * and path, the shape server/routes/land.test.ts uses, so what runs is the
 * real registration and the real handler bodies.
 *
 * THE LAST TWO CASES ASSERT WITH THE GATES THEMSELVES rather than restating
 * their numbers. A test that hardcoded "under 2000 lines" would keep passing
 * on the day somebody raised the cap.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { NEEDS_AGGREGATE_FLOOR } from "../lib/needs";
import { loadVariables } from "../lib/variables";
import { register } from "./needs";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the handlers `register` hands it. */
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

/** Captures what a handler answered. */
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
  };
  return { res, out };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, ...req }, res);
  return out;
};

/** A pool that answers nothing, for the cases that refuse before touching it. */
function deadPool() {
  const queries: string[] = [];
  return {
    queries,
    pool: {
      async query(sql: string) {
        queries.push(sql);
        return [[], []];
      },
    } as any,
  };
}

const ADMIN_WRITES = [
  "PUT /api/admin/needs/scope",
  "POST /api/admin/needs/retire",
  "POST /api/admin/needs/links",
  "DELETE /api/admin/needs/links/:id",
];

const MEMBER_READS = ["GET /api/needs/scope", "GET /api/needs/coverage"];

/**
 * Lane N4's four. Three of them read or write the signed-in member's OWN card
 * and one is the count the whole village may read.
 */
const MEMBER_CARD = [
  "GET /api/needs/mine",
  "PUT /api/needs/mine",
  "DELETE /api/needs/mine",
  "GET /api/needs/aggregate",
];

describe("who may reach the needs routes", () => {
  it("registers exactly the ten doors, and no more", () => {
    const { app, handlers } = collect();
    const { pool } = deadPool();
    register(app, { isAdmin: async () => true, authedUser: async () => ({ id: "u" }), getPool: () => pool } as any);
    // Six from lane N1 and four from lane N4, on ONE module, because
    // server/index.ts exempts exactly one import and one register call per
    // module and a second module would have cost a second pair.
    expect([...handlers.keys()].sort()).toEqual([...ADMIN_WRITES, ...MEMBER_READS, ...MEMBER_CARD].sort());
  });

  it.each(ADMIN_WRITES)("refuses a member on %s, and never touches the database", async (key) => {
    const { app, handlers } = collect();
    const { pool, queries } = deadPool();
    register(app, {
      // A signed-in member who is not admin or founder. `isAdmin` is the one
      // gate these four writes ask, so this is the whole refusal.
      isAdmin: async () => false,
      authedUser: async () => ({ id: "member-1", role: "member" }),
      getPool: () => pool,
    } as any);
    const out = await call(handlers, key, { params: { id: "nlink-1" }, body: { needs: [] } });
    expect(out.status).toBe(401);
    expect(out.body).toEqual({ error: "auth_required" });
    expect(queries, "a refused write must not reach the pool").toEqual([]);
  });

  it.each(MEMBER_READS)("refuses a stranger on %s", async (key) => {
    const { app, handlers } = collect();
    const { pool, queries } = deadPool();
    register(app, { isAdmin: async () => false, authedUser: async () => null, getPool: () => pool } as any);
    const out = await call(handlers, key);
    expect(out.status).toBe(401);
    expect(queries).toEqual([]);
  });
});

describe("what a bad body earns", () => {
  const mount = () => {
    const { app, handlers } = collect();
    const { pool, queries } = deadPool();
    register(app, { isAdmin: async () => true, authedUser: async () => ({ id: "founder" }), getPool: () => pool } as any);
    return { handlers, queries };
  };

  it("asks for a needs array", async () => {
    const { handlers } = mount();
    const out = await call(handlers, "PUT /api/admin/needs/scope", { body: { needs: "play" } });
    expect(out.status).toBe(400);
    expect(out.body.error).toContain("needs");
  });

  it("refuses a rung that is not one of the five, by name", async () => {
    const { handlers } = mount();
    const out = await call(handlers, "PUT /api/admin/needs/scope", {
      body: { needs: [{ needKey: "play", depthTarget: "flourishing" }] },
    });
    expect(out.status).toBe(400);
    expect(out.body.error).toContain("Thriving");
  });

  it("refuses the whole save when one row is bad, so a half scope never lands", async () => {
    const { handlers, queries } = mount();
    const out = await call(handlers, "PUT /api/admin/needs/scope", {
      body: { needs: [{ needKey: "play" }, { needKey: "custom:love", label: "Love" }] },
    });
    expect(out.status).toBe(400);
    expect(out.body.error).toContain("one of the ten needs");
    // Not one INSERT ran: validation finishes before any write starts.
    expect(queries.filter((q) => /INSERT/i.test(q))).toEqual([]);
  });

  it("refuses a subject kind it does not know", async () => {
    const { handlers } = mount();
    const out = await call(handlers, "POST /api/admin/needs/links", {
      body: { needKey: "play", subjectType: "vibe", subjectRef: "x" },
    });
    expect(out.status).toBe(400);
    expect(out.body.error).toContain("quest");
  });

  it("asks the retire route to name a need", async () => {
    const { handlers } = mount();
    const out = await call(handlers, "POST /api/admin/needs/retire", { body: {} });
    expect(out.status).toBe(400);
  });
});

/* ========================================================================== *
 * The round trip, against a scratch schema.
 * ========================================================================== */

const configured = testDbConfigured();

describe.skipIf(!configured)("the scope round trips through the routes", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const { app, handlers: h } = collect();
    register(app, {
      isAdmin: async () => true,
      authedUser: async () => ({ id: "founder-1" }),
      getPool: () => pool,
    } as any);
    handlers = h;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `need_links`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `village_needs`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `org_role_assignments`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `org_roles`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("an unanswered village reads as unanswered, and carries the ten to choose from", async () => {
    const out = await call(handlers, "GET /api/needs/scope");
    expect(out.status).toBe(200);
    expect(out.body.scope).toEqual([]);
    expect(out.body.summary.answered).toBe(false);
    expect(out.body.needs).toHaveLength(10);
    expect(out.body.depths).toEqual(["deprived", "unmet", "alive", "satisfied", "thriving"]);
  });

  it("saves a scope, reads it back, and reports what nothing meets", async () => {
    const saved = await call(handlers, "PUT /api/admin/needs/scope", {
      body: {
        needs: [
          { needKey: "vitality", depthTarget: "thriving" },
          { needKey: "play" },
          { needKey: "custom:childcare", label: "Childcare", breadthTargetPct: 30 },
        ],
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toHaveLength(3);

    const read = await call(handlers, "GET /api/needs/scope");
    expect(read.body.scope.map((r: any) => r.needKey)).toEqual(["vitality", "play", "custom:childcare"]);
    expect(read.body.summary.adopted).toBe(3);
    expect(read.body.summary.customAdopted).toBe(1);

    await call(handlers, "POST /api/admin/needs/links", {
      body: { needKey: "vitality", subjectType: "quest", subjectRef: "q-well" },
    });
    const coverage = await call(handlers, "GET /api/needs/coverage");
    expect(coverage.body.answered).toBe(true);
    expect(coverage.body.uncovered).toEqual(["play", "custom:childcare"]);
  });

  it("a PUT retires nothing, so a half-loaded screen is not an act of policy", async () => {
    await call(handlers, "PUT /api/admin/needs/scope", {
      body: { needs: [{ needKey: "vitality" }, { needKey: "play" }] },
    });
    // A second save carrying only one of them leaves the other in scope.
    await call(handlers, "PUT /api/admin/needs/scope", { body: { needs: [{ needKey: "vitality" }] } });
    const read = await call(handlers, "GET /api/needs/scope");
    expect(read.body.summary.adopted).toBe(2);
  });

  it("retiring through the route keeps the links, and says so the second time", async () => {
    await call(handlers, "PUT /api/admin/needs/scope", { body: { needs: [{ needKey: "play" }] } });
    const link = await call(handlers, "POST /api/admin/needs/links", {
      body: { needKey: "play", subjectType: "quest", subjectRef: "q-solstice" },
    });
    expect(link.status).toBe(200);

    const first = await call(handlers, "POST /api/admin/needs/retire", { body: { needKey: "play" } });
    expect(first.body.changed).toBe(true);
    const second = await call(handlers, "POST /api/admin/needs/retire", { body: { needKey: "play" } });
    expect(second.status).toBe(200);
    expect(second.body.changed).toBe(false);

    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM `need_links`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(rows[0].n), "a retired need keeps its links").toBe(1);
  });

  it("names a seat the scope leans on that nobody is in", async () => {
    await call(handlers, "PUT /api/admin/needs/scope", { body: { needs: [{ needKey: "vitality" }] } });
    await pool.query("INSERT INTO `org_roles` (`id`, `name`, `seats`, `active`) VALUES ('r-water','Water Steward',1,1)"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await call(handlers, "POST /api/admin/needs/links", {
      body: { needKey: "vitality", subjectType: "role", subjectRef: "r-water" },
    });
    const coverage = await call(handlers, "GET /api/needs/coverage");
    const seating = coverage.body.seatings.find((s: any) => s.needKey === "vitality");
    expect(seating.seatsNeeded).toBe(1);
    expect(seating.seatsFilled).toBe(0);
    expect(seating.rolesWithNobodyInThem.map((r: any) => r.name)).toEqual(["Water Steward"]);
  });

  it("takes a link off again", async () => {
    await call(handlers, "PUT /api/admin/needs/scope", { body: { needs: [{ needKey: "play" }] } });
    const made = await call(handlers, "POST /api/admin/needs/links", {
      body: { needKey: "play", subjectType: "quest", subjectRef: "q-solstice" },
    });
    const gone = await call(handlers, "DELETE /api/admin/needs/links/:id", { params: { id: made.body.link.id } });
    expect(gone.status).toBe(200);
    const missing = await call(handlers, "DELETE /api/admin/needs/links/:id", { params: { id: "nope" } });
    expect(missing.status).toBe(404);
  });
});

/* ========================================================================== *
 * The two ratchets this lane promised to leave alone.
 * ========================================================================== */

describe("the module pays its own way in server/index.ts", () => {
  const root = path.resolve(__dirname, "..", "..");
  // `--json` prints the machine line FIRST and then goes on to print its own
  // human summary, so only the first line is JSON. Parsing the whole thing
  // fails on the second line, which is what the guard is for.
  const measured = () =>
    JSON.parse(
      execFileSync(process.execPath, [path.join(root, "scripts", "check-server-index-size.mjs"), "--json"], {
        cwd: root,
        encoding: "utf8",
      }).split("\n")[0],
    );

  it("is under the route-module cap the guard itself declares", () => {
    const m = measured();
    expect(m.routeFiles["server/routes/needs.ts"]).toBeLessThanOrEqual(m.cap);
  });

  it("leaves server/index.ts no longer than the ratchet already allows", () => {
    // The import line and the register call are both exempt, so registering a
    // module costs the monolith nothing. This asserts the measured number, not
    // `wc -l`, which is the number the guard reads.
    const m = measured();
    expect(m.current.lines).toBeLessThanOrEqual(m.baseline.lines);
    expect(m.current.routes).toBeLessThanOrEqual(m.baseline.routes);
  });
});

/* ========================================================================== *
 * Lane N4's four doors: the member's own card, and the count the village gets.
 * ========================================================================== */

/** The one thing an attacker wants, spelled so a grep finds this line. */
const SOMEBODY_ELSE = "member-ana";

/** Mount the module as one signed-in identity. */
const asMember = (id: string, admin = false) => {
  const { app, handlers } = collect();
  const { pool, queries } = deadPool();
  register(app, {
    isAdmin: async () => admin,
    authedUser: async () => (id ? { id } : null),
    getPool: () => pool,
  } as any);
  return { handlers, queries };
};

describe("who may reach the member's own card", () => {
  it.each(MEMBER_CARD)("refuses a stranger on %s, and never touches the database", async (key) => {
    const { handlers, queries } = asMember("");
    const out = await call(handlers, key, { body: { needKey: "love", depth: "unmet" } });
    expect(out.status).toBe(401);
    expect(out.body).toEqual({ error: "auth_required" });
    expect(queries, "a refused read must not reach the pool").toEqual([]);
  });

  /**
   * THE REFUSAL IS A MISSING HANDLER, and that is stronger than a gate.
   *
   * There is no route on this module that takes a user id from a request, so
   * an admin has no URL to ask with. Express answers 404 for a path nothing
   * registered, which is why the assertion below is about the handler map: a
   * test that mocked a 404 would prove nothing about the router.
   */
  it("registers no door that names another member, so an admin read is a 404", () => {
    const { app, handlers } = collect();
    const { pool } = deadPool();
    register(app, { isAdmin: async () => true, authedUser: async () => ({ id: "founder" }), getPool: () => pool } as any);
    const doors = [...handlers.keys()];
    expect(doors).not.toContain("GET /api/admin/needs/mine");
    expect(doors).not.toContain("GET /api/admin/needs/members");
    expect(doors.filter((d) => /:userId|:user|:memberId|\/members\//.test(d))).toEqual([]);
    // And no door on this module carries a path parameter at all except the
    // link id, which names a tag and never a person.
    expect(doors.filter((d) => d.includes(":"))).toEqual(["DELETE /api/admin/needs/links/:id"]);
  });

  it("gives an admin their OWN card on /api/needs/mine, never the member they are looking at", async () => {
    const rowsByUser: Record<string, any[]> = {
      [SOMEBODY_ELSE]: [{ need_key: "love", depth: "deprived", note: "I am lonely" }],
    };
    const seen: any[][] = [];
    const pool = {
      async query(_sql: string, params: any[]) {
        seen.push(params);
        return [rowsByUser[params?.[0]] ?? [], []];
      },
    } as any;
    const { app, handlers } = collect();
    register(app, {
      isAdmin: async () => true,
      authedUser: async () => ({ id: "founder-1", role: "admin" }),
      getPool: () => pool,
    } as any);

    const out = await call(handlers, "GET /api/needs/mine");
    expect(out.status).toBe(200);
    // The id the SELECT filtered on came off the token and nowhere else.
    expect(seen[0][0]).toBe("founder-1");
    expect(JSON.stringify(out.body)).not.toContain(SOMEBODY_ELSE);
    expect(JSON.stringify(out.body)).not.toContain("lonely");
    expect(out.body.mine).toEqual([]);
    expect(out.body.answered).toBe(false);
  });
});

describe("what the card may send", () => {
  it("refuses a visibility of village with a sentence, before any write", async () => {
    const { handlers, queries } = asMember("member-1");
    const out = await call(handlers, "PUT /api/needs/mine", {
      body: { needKey: "love", depth: "unmet", visibility: "village" },
    });
    expect(out.status).toBe(400);
    expect(out.body.error).toContain("private");
    expect(queries.filter((q) => /INSERT/i.test(q)), "a refused save writes nothing").toEqual([]);
  });

  it("refuses stewards the same way", async () => {
    const { handlers } = asMember("member-1");
    const out = await call(handlers, "PUT /api/needs/mine", {
      body: { needKey: "love", depth: "unmet", visibility: "stewards" },
    });
    expect(out.status).toBe(400);
  });

  it("refuses a rung that is not one of the five, by name", async () => {
    const { handlers } = asMember("member-1");
    const out = await call(handlers, "PUT /api/needs/mine", {
      body: { needKey: "love", depth: "flourishing" },
    });
    expect(out.status).toBe(400);
    expect(out.body.error).toContain("Thriving");
  });

  it("asks the delete route to name the need, so an empty body erases nothing", async () => {
    const { handlers, queries } = asMember("member-1");
    const out = await call(handlers, "DELETE /api/needs/mine", { body: {} });
    expect(out.status).toBe(400);
    expect(queries.filter((q) => /DELETE/i.test(q))).toEqual([]);
  });
});

describe.skipIf(!configured)("the member's card round trips through the routes", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  /** Whose token the module thinks it is holding. Reassigned per case. */
  let whoami: string;
  let handlers: Map<string, Handler>;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const { app, handlers: h } = collect();
    register(app, {
      isAdmin: async () => true,
      authedUser: async () => ({ id: whoami }),
      getPool: () => pool,
    } as any);
    handlers = h;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    whoami = SOMEBODY_ELSE;
    await pool.query("DELETE FROM `member_needs`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `need_links`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `village_needs`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("saves a row as private when the body carries no visibility field", async () => {
    const saved = await call(handlers, "PUT /api/needs/mine", {
      body: { needKey: "love", depth: "unmet", feeling: "lonely" },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.need.visibility).toBe("private");

    const [rows] = await pool.query<any[]>("SELECT `visibility` FROM `member_needs`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe("private");
  });

  it("tells a member who has not been asked apart from one who has answered", async () => {
    const before = await call(handlers, "GET /api/needs/mine");
    expect(before.body.answered).toBe(false);
    expect(before.body.mine).toEqual([]);

    await call(handlers, "PUT /api/needs/mine", { body: { needKey: "play", depth: "thriving" } });
    const after = await call(handlers, "GET /api/needs/mine");
    // Answered, and nothing below the target. A count alone would read the
    // same as the empty state above.
    expect(after.body.answered).toBe(true);
    expect(after.body.mine.filter((r: any) => r.depth === "deprived")).toEqual([]);
  });

  it("carries the ladder and the floor, so the card never writes its own copy", async () => {
    const out = await call(handlers, "GET /api/needs/mine");
    expect(out.body.depths).toEqual(["deprived", "unmet", "alive", "satisfied", "thriving"]);
    expect(out.body.depthLabels.deprived).toBe("Deprived");
    expect(out.body.floor).toBe(NEEDS_AGGREGATE_FLOOR);
    expect(out.body.cycleId).toMatch(/^lunar-\d{6}$/);
  });

  /**
   * THE SENTENCE THE MEMBER READS AND THE SUPPRESSION THE SERVER PERFORMS,
   * off one payload and one vote.
   *
   * NeedCard prints `mine.floor` into "A count appears only once at least N
   * members have answered", so this number IS that sentence. A village that
   * moved its floor to 5 was told 3 here while the aggregate also released at
   * 3; both halves now read the same dial. The override is torn down inside
   * the test because the variables cache is module-level and every case after
   * this one asserts the untouched default.
   */
  it("states the floor the village voted, not the one the platform ships", async () => {
    try {
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `game_variables` (`config_key`, `value`, `value_type`) VALUES ('needs.aggregate_floor','5','text') " +
          "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      );
      await loadVariables(pool);

      const voted = await call(handlers, "GET /api/needs/mine");
      expect(voted.body.floor).toBe(5);

      await call(handlers, "PUT /api/admin/needs/scope", {
        body: { needs: [{ needKey: "love", depthTarget: "satisfied" }] },
      });
      for (const who of ["m-1", "m-2", "m-3", "m-4"]) {
        whoami = who;
        await call(handlers, "PUT /api/needs/mine", { body: { needKey: "love", depth: "satisfied" } });
      }
      const four = await call(handlers, "GET /api/needs/aggregate");
      expect(four.body.floor).toBe(5);
      expect(four.body.needs.find((n: any) => n.needKey === "love")?.suppressed).toBe(true);

      whoami = "m-5";
      await call(handlers, "PUT /api/needs/mine", { body: { needKey: "love", depth: "satisfied" } });
      const five = await call(handlers, "GET /api/needs/aggregate");
      expect(five.body.needs.find((n: any) => n.needKey === "love")?.suppressed).toBe(false);
      expect(five.body.needs.find((n: any) => n.needKey === "love")?.answers).toBe(5);
    } finally {
      await pool.query("DELETE FROM `game_variables` WHERE `config_key` = 'needs.aggregate_floor'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await loadVariables(pool);
    }
  });

  it("shows one member their own card and nobody else's", async () => {
    await call(handlers, "PUT /api/needs/mine", { body: { needKey: "love", depth: "deprived", note: "I am lonely" } });
    whoami = "member-ben";
    const ben = await call(handlers, "GET /api/needs/mine");
    expect(ben.body.mine).toEqual([]);
    expect(JSON.stringify(ben.body)).not.toContain("lonely");
  });

  it("takes one answer back, and says so when there was nothing to take", async () => {
    await call(handlers, "PUT /api/needs/mine", { body: { needKey: "love", depth: "unmet" } });
    const gone = await call(handlers, "DELETE /api/needs/mine", { body: { needKey: "love" } });
    expect(gone.status).toBe(200);
    const again = await call(handlers, "DELETE /api/needs/mine", { body: { needKey: "love" } });
    expect(again.status).toBe(404);
  });

  it("answers the aggregate with counts and never a row", async () => {
    await call(handlers, "PUT /api/admin/needs/scope", {
      body: { needs: [{ needKey: "love", depthTarget: "satisfied" }] },
    });
    for (const [who, depth] of [
      [SOMEBODY_ELSE, "satisfied"],
      ["member-ben", "thriving"],
      ["member-cai", "deprived"],
    ] as const) {
      whoami = who;
      await call(handlers, "PUT /api/needs/mine", { body: { needKey: "love", depth, note: `${who} wrote this` } });
    }

    whoami = "member-dee";
    const out = await call(handlers, "GET /api/needs/aggregate");
    expect(out.status).toBe(200);
    const love = out.body.needs.find((n: any) => n.needKey === "love");
    expect(love.atOrAbove).toBe(2);
    expect(love.below).toBe(1);
    const wire = JSON.stringify(out.body);
    for (const who of [SOMEBODY_ELSE, "member-ben", "member-cai"]) expect(wire).not.toContain(who);
    expect(wire).not.toContain("wrote this");
  });

  it("withholds the counts below the floor", async () => {
    await call(handlers, "PUT /api/admin/needs/scope", { body: { needs: [{ needKey: "play" }] } });
    whoami = SOMEBODY_ELSE;
    await call(handlers, "PUT /api/needs/mine", { body: { needKey: "play", depth: "deprived" } });
    const out = await call(handlers, "GET /api/needs/aggregate");
    const play = out.body.needs.find((n: any) => n.needKey === "play");
    expect(play.suppressed).toBe(true);
    expect(play.atOrAbove).toBeNull();
    expect(play.below).toBeNull();
  });

  /**
   * ONE MEMBER'S OWN WORDS NEVER REACH ANOTHER MEMBER'S PAYLOAD.
   *
   * A custom key is the member's phrase, and the aggregate labels a row with
   * it. So a need nobody adopted may not have a row at all until enough people
   * answered on it, and this reads that off the wire a second member receives.
   */
  it("sends no row for a need nobody adopted until its answers reach the floor", async () => {
    await call(handlers, "PUT /api/admin/needs/scope", { body: { needs: [{ needKey: "play" }] } });
    whoami = SOMEBODY_ELSE;
    const own = await call(handlers, "PUT /api/needs/mine", {
      body: { needKey: "custom:leaving-my-husband", depth: "deprived" },
    });
    expect(own.status, "the answer has to land, or the absence below proves nothing").toBe(200);
    await call(handlers, "PUT /api/needs/mine", { body: { needKey: "love", depth: "unmet" } });

    whoami = "member-ben";
    const one = await call(handlers, "GET /api/needs/aggregate");
    expect(one.status).toBe(200);
    expect(one.body.needs.map((n: any) => n.needKey)).toEqual(["play"]);
    expect(one.body.needs[0].suppressed).toBe(true);
    const wire = JSON.stringify(one.body);
    expect(wire).not.toContain("leaving");
    expect(wire).not.toContain("love");

    for (const who of ["member-ben", "member-cai"]) {
      whoami = who;
      await call(handlers, "PUT /api/needs/mine", { body: { needKey: "custom:leaving-my-husband", depth: "unmet" } });
      await call(handlers, "PUT /api/needs/mine", { body: { needKey: "love", depth: "thriving" } });
    }
    whoami = "member-dee";
    const three = await call(handlers, "GET /api/needs/aggregate");
    const custom = three.body.needs.find((n: any) => n.needKey === "custom:leaving-my-husband");
    expect(custom?.inScope).toBe(false);
    expect(custom?.suppressed).toBe(false);
    expect(custom?.answers).toBe(3);
    expect(three.body.needs.find((n: any) => n.needKey === "love")?.answers).toBe(3);
    expect(three.body.needs.find((n: any) => n.needKey === "play")?.suppressed).toBe(true);
  });

  it("names what meets a need, and says plainly when nothing does", async () => {
    await call(handlers, "PUT /api/admin/needs/scope", {
      body: { needs: [{ needKey: "vitality" }, { needKey: "play" }] },
    });
    await call(handlers, "POST /api/admin/needs/links", {
      body: { needKey: "vitality", subjectType: "quest", subjectRef: "q-well" },
    });
    // The card reads this payload for the line under each need.
    const coverage = await call(handlers, "GET /api/needs/coverage");
    expect(coverage.body.coverage.find((c: any) => c.needKey === "vitality").counts.quest).toBe(1);
    expect(coverage.body.uncovered).toEqual(["play"]);
  });
});
