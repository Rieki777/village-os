/**
 * SESSION CARD ROUTES: who may pull, who is read, and who sees whose line.
 *
 * The first block needs no database: every door answers 401 to a stranger and
 * a sky that was not read from the sky is refused before anything is read.
 * The second runs against a real scratch schema with a real live session:
 *   - only a person who shows their lines, lets Maia use them and is not left
 *     out of cards is read; everyone else present is welcomed by name;
 *   - a person's own line reaches only them until they share it;
 *   - anyone in the room may pull, again and again, and a double tap is one card;
 *   - somebody not in the room cannot pull or read;
 *   - a closed session's cards are deleted, and so is every card naming a
 *     member who is erased;
 *   - Maia's weaving is served when it keeps the card's promises, and the
 *     plain card when it does not.
 *
 * Every person is invented, and every chart is computed from an invented birth.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { loadModuleSettings, setModuleLifecycle } from "../lib/modules";
import { ensureMemberNo, joinSession, startSession } from "../lib/liveSessions";
import { forgetMemberCards, weaveReading, type CardDeps } from "../lib/sessionCard";
import { updateGeneKeysSettings, writeGeneKeys } from "../repos/geneKeys";
import { analyse, profileOf, type Chart } from "../../shared/geneKeys";
import { chartAt, skyAt, zonedToUtc } from "../../shared/geneKeysSky";
import { CARD_LIMITS, plainReading, readRoom } from "../../shared/sessionCard";
import { register } from "./sessionCard";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const ROUTES = ["GET /api/session-card/:sessionId", "POST /api/session-card/:sessionId", "POST /api/session-card/:sessionId/cards/:cardId/share"];

function collect() {
  const handlers = new Map<string, Handler>();
  const mounts: string[] = [];
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return { app: { get: record("GET"), post: record("POST"), use: (p: string) => mounts.push(p) } as any, handlers, mounts };
}

function makeRes() {
  const out: { status: number; body: any; headers: Record<string, string> } = { status: 200, body: undefined, headers: {} };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; },
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

const NAMES: Record<string, string> = { "m-wren": "Wren Alder", "m-kai": "Kai Moss", "m-juno": "Juno Ash", "m-sam": "Sam Reed", "m-ivy": "Ivy Lane" };

function deps(pool: any, who: () => string | null, limited = false) {
  return {
    authedUser: async () => (who() ? { id: who() } : null),
    isAdmin: async () => false,
    getPool: () => pool,
    overLimit: async () => limited,
    members: { byId: async (id: string) => (NAMES[id] ? { id, name: NAMES[id] } : null) },
  } as any;
}

const WREN = chartAt(zonedToUtc(1990, 6, 15, 14, 30, "America/New_York"));
const KAI = chartAt(zonedToUtc(2001, 7, 10, 4, 2, "Europe/London"));
const JUNO = chartAt(zonedToUtc(1995, 3, 3, 14, 54, "Asia/Tokyo"));
const SAM = chartAt(zonedToUtc(1988, 11, 2, 9, 15, "Europe/Paris"));

const skyNow = () => JSON.parse(JSON.stringify(skyAt(new Date())));

describe("the session card doors, without a database", () => {
  const deadPool = { query: async () => [[], []] };

  it("mounts behind the module gate and registers every door", () => {
    const c = collect();
    register(c.app, deps(deadPool, () => null));
    expect(c.mounts).toEqual(["/api/session-card"]);
    expect([...c.handlers.keys()].sort()).toEqual([...ROUTES].sort());
  });

  it("answers 401 to a stranger at every door", async () => {
    const c = collect();
    register(c.app, deps(deadPool, () => null));
    for (const r of ROUTES) expect((await call(c.handlers, r, { params: { sessionId: "1", cardId: "1" } })).status, r).toBe(401);
  });

  it("refuses a sky that was not read from the sky before reading anything, and bounds pulls", async () => {
    const c = collect();
    register(c.app, deps(deadPool, () => "m-wren"));
    const bent = { ...skyNow(), moonPhase: 7 };
    const got = await call(c.handlers, "POST /api/session-card/:sessionId", { params: { sessionId: "1" }, body: { sky: bent } });
    expect(got.status).toBe(400);
    const limited = collect();
    register(limited.app, deps(deadPool, () => "m-wren", true));
    expect((await call(limited.handlers, "POST /api/session-card/:sessionId", { params: { sessionId: "1" }, body: { sky: skyNow() } })).status).toBe(429);
  });
});

describe("Maia's weaving", () => {
  const facts = readRoom(
    [
      { userId: "m-wren", name: "Wren Alder", chart: WREN },
      { userId: "m-kai", name: "Kai Moss", chart: KAI },
    ],
    skyAt(new Date("2026-10-31T17:00:00Z")),
  );
  const draft = plainReading(facts);
  const pool = { query: async () => [[], []] } as any;
  const woven = (text: string, stopReason = "end_turn"): CardDeps => ({
    getPool: () => pool,
    nameOf: async () => null,
    ready: () => true,
    call: async (req) => {
      expect(req.mode).toBe("card");
      // Maia is handed people by a key, never by their member id.
      expect(JSON.stringify(req.prefetch)).not.toMatch(/m-wren|m-kai/);
      return { ok: true, text, keySource: "platform", usage: { inputTokens: 1, outputTokens: 1 } as any, stopReason, iterations: 1, toolsUsed: [] };
    },
  });
  const good = JSON.stringify({
    collective: [
      { system: "human-design", text: "Wren and Kai, the Sun sits in gate 44 today, and the two of you make channel 8-1 together." },
      { system: "western", text: "The Moon is in Cancer, a water sign, so the room may want a slower start." },
    ],
    lines: { p1: "Wren, sleep on the big things today.", p2: "Kai, the Sun is in your gate 44: let it be seen." },
  });

  it("serves her words when they name everyone and give each person a line", async () => {
    const card = await weaveReading(woven(good), facts, draft, "m-wren");
    expect(card?.source).toBe("maia");
    expect(card?.lines["m-kai"]).toMatch(/gate 44/);
    expect(card?.suggestions).toEqual(draft.suggestions);
  });

  it("falls back to the plain card when she leaves somebody out, runs out of room, or writes a dash", async () => {
    const missing = JSON.parse(good);
    missing.collective = missing.collective.map((c: any) => ({ ...c, text: c.text.replace("Wren and Kai", "Friends") }));
    expect(await weaveReading(woven(JSON.stringify(missing)), facts, draft, "m-wren")).toBeNull();
    expect(await weaveReading(woven(good, "max_tokens"), facts, draft, "m-wren")).toBeNull();
    const noLine = JSON.parse(good);
    delete noLine.lines.p2;
    expect(await weaveReading(woven(JSON.stringify(noLine)), facts, draft, "m-wren")).toBeNull();
    expect(await weaveReading(woven("not json"), facts, draft, "m-wren")).toBeNull();
  });

  it("is not asked at all without a key, or when nobody present was read", async () => {
    let asked = false;
    const d: CardDeps = { getPool: () => pool, nameOf: async () => null, ready: () => false, call: async () => { asked = true; throw new Error("no"); } };
    expect(await weaveReading(d, facts, draft, "m-wren")).toBeNull();
    const empty = readRoom([{ userId: "m-sam", name: "Sam", chart: null }], skyAt(new Date()));
    expect(await weaveReading({ ...d, ready: () => true }, empty, plainReading(empty), "m-wren")).toBeNull();
    expect(asked).toBe(false);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("session cards against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let handlers: Map<string, Handler>;
  let sessionId = 0;
  const as = (id: string | null) => { whoami = id; };
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const pull = () => call(handlers, "POST /api/session-card/:sessionId", { params: { sessionId: String(sessionId) }, body: { sky: skyNow() } });
  const read = () => call(handlers, "GET /api/session-card/:sessionId", { params: { sessionId: String(sessionId) } });
  const save = async (userId: string, chart: Chart, maia: boolean, visibility: "show" | "hide" = "show") => {
    const d = analyse(chart);
    await writeGeneKeys(pool, { userId, chart, profile: profileOf(chart), hdType: d.type, hdAuthority: d.authority, visibility, maia, source: "exact", calcVersion: 1 });
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadModuleSettings(pool);
    for (const m of ["sessions", "gene-keys", "session-card"]) await setModuleLifecycle(m, "members", null, { sharedPasswordPosture: () => false });
    for (const [id, name] of Object.entries(NAMES)) {
      await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?,?,?,'x',?)", [id, name, `${id}@example.test`, id]); // module-review-ok: fixture SQL against the S5 scratch schema
    }
    const c = collect();
    register(c.app, deps(pool, () => whoami));
    handlers = c.handlers;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    as("m-wren");
    await q("DELETE FROM `session_card_lines`"); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("DELETE FROM `session_cards`"); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("DELETE FROM `member_gene_keys`"); // module-review-ok: fixture SQL against the S5 scratch schema
    // Wren and Juno say yes to everything; Kai keeps Maia out; Sam is left out of cards; Ivy has no lines.
    await save("m-wren", WREN, true);
    await save("m-kai", KAI, false);
    await save("m-juno", JUNO, true);
    await save("m-sam", SAM, true);
    await updateGeneKeysSettings(pool, "m-sam", { cardOut: true });
    const nos: Record<string, number> = {};
    for (const id of Object.keys(NAMES)) nos[id] = await ensureMemberNo(pool, id);
    sessionId = await startSession(pool, nos["m-wren"], { title: "Card circle", circleId: null, durationMin: 60 });
    for (const id of ["m-kai", "m-juno", "m-sam", "m-ivy"]) await joinSession(pool, sessionId, nos[id]);
  });

  it("reads only the people who said yes to all three, and welcomes the rest by name", async () => {
    const got = await pull();
    expect(got.status).toBe(200);
    const card = got.body.cards[0];
    expect(card.n).toBe(1);
    expect(card.pulledByName).toBe("Wren");
    expect(card.welcomed.sort()).toEqual(["Ivy", "Kai", "Sam"]);
    const all = card.collective.map((c: any) => c.text).join(" ");
    expect(all).toMatch(/Wren/);
    expect(all).toMatch(/Juno/);
    expect(card.mine).toBeTruthy();
    const rows = await q("SELECT `user_id`, `line` FROM `session_card_lines` ORDER BY `user_id`"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(rows.map((r: any) => [r.user_id, r.line != null])).toEqual([
      ["m-ivy", false], ["m-juno", true], ["m-kai", false], ["m-sam", false], ["m-wren", true],
    ]);
  });

  it("keeps each person's line theirs until they share it", async () => {
    await pull();
    as("m-juno");
    const juno = (await read()).body.cards[0];
    expect(juno.mine).toBeTruthy();
    expect(juno.shared).toEqual([]);
    as("m-kai");
    const kai = await read();
    expect(kai.body.cards[0].mine).toBeNull();
    expect(kai.body.notRead).toBe("no-maia");
    expect(kai.body.cards[0].shared).toEqual([]);

    as("m-juno");
    const shared = await call(handlers, "POST /api/session-card/:sessionId/cards/:cardId/share", {
      params: { sessionId: String(sessionId), cardId: String(juno.id) },
      body: { shared: true },
    });
    expect(shared.body.cards[0].mineShared).toBe(true);
    as("m-kai");
    expect((await read()).body.cards[0].shared).toEqual([{ name: "Juno", line: juno.mine }]);

    // Somebody the card did not read has no line to share.
    const none = await call(handlers, "POST /api/session-card/:sessionId/cards/:cardId/share", {
      params: { sessionId: String(sessionId), cardId: String(juno.id) },
      body: { shared: true },
    });
    expect(none.status).toBe(404);
    as("m-sam");
    expect((await read()).body.notRead).toBe("left-out");
    as("m-ivy");
    expect((await read()).body.notRead).toBe("no-lines");
  });

  it("lets anyone in the room pull again, makes a double tap one card, and stops at the session's limit", async () => {
    expect((await pull()).status).toBe(200);
    as("m-kai");
    const tap = await pull();
    expect(tap.status).toBe(429);
    await q("UPDATE `session_cards` SET `created_at` = DATE_SUB(`created_at`, INTERVAL 1 MINUTE)"); // module-review-ok: fixture SQL against the S5 scratch schema
    const second = await pull();
    expect(second.status).toBe(200);
    expect(second.body.cards.map((c: any) => c.n)).toEqual([2, 1]);
    expect(second.body.cards[0].pulledByName).toBe("Kai");

    await q( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO `session_cards` (`session_id`, `n`, `pulled_by`, `sky`, `reading`, `created_at`) SELECT `session_id`, `n` + 100, `pulled_by`, `sky`, `reading`, DATE_SUB(NOW(), INTERVAL 1 HOUR) FROM `session_cards` WHERE `session_id` = ? LIMIT 1",
      [sessionId],
    );
    for (let i = 0; i < CARD_LIMITS.perSession; i++) {
      await q( // module-review-ok: fixture SQL against the S5 scratch schema
        "INSERT INTO `session_cards` (`session_id`, `n`, `pulled_by`, `sky`, `reading`, `created_at`) SELECT `session_id`, ? , `pulled_by`, `sky`, `reading`, DATE_SUB(NOW(), INTERVAL 1 HOUR) FROM `session_cards` WHERE `session_id` = ? LIMIT 1",
        [200 + i, sessionId],
      );
    }
    expect((await pull()).status).toBe(409);
  });

  it("refuses somebody who has not joined the room", async () => {
    await q("DELETE FROM `live_session_people` WHERE `session_id` = ? AND `member_no` = (SELECT `no` FROM `live_session_members` WHERE `user_id` = 'm-ivy')", [sessionId]); // module-review-ok: fixture SQL against the S5 scratch schema
    as("m-ivy");
    expect((await pull()).status).toBe(403);
    expect((await read()).status).toBe(403);
  });

  it("leaves out somebody who joined but is no longer present", async () => {
    await q("UPDATE `live_session_people` SET `last_seen_at` = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE `session_id` = ? AND `member_no` = (SELECT `no` FROM `live_session_members` WHERE `user_id` = 'm-juno')", [sessionId]); // module-review-ok: fixture SQL against the S5 scratch schema
    const card = (await pull()).body.cards[0];
    expect(card.collective.map((c: any) => c.text).join(" ")).not.toMatch(/Juno/);
    expect(card.welcomed).not.toContain("Juno");
  });

  it("deletes a closed session's cards, and every card naming an erased member", async () => {
    await pull();
    expect(await forgetMemberCards(pool, "m-ivy")).toBe(1);
    expect((await q("SELECT COUNT(*) AS n FROM `session_card_lines`"))[0].n).toBe(0); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("UPDATE `session_cards` SET `created_at` = DATE_SUB(`created_at`, INTERVAL 1 MINUTE)"); // module-review-ok: fixture SQL against the S5 scratch schema
    await pull();
    await q("UPDATE `live_sessions` SET `status` = 'closed' WHERE `id` = ?", [sessionId]); // module-review-ok: fixture SQL against the S5 scratch schema
    const closed = await read();
    expect(closed.body).toEqual({ cards: [], mayPull: false, notRead: null });
    expect((await q("SELECT COUNT(*) AS n FROM `session_cards`"))[0].n).toBe(0); // module-review-ok: fixture SQL against the S5 scratch schema
    expect((await pull()).status).toBe(409);
  });
});
