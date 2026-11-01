/**
 * GENE KEYS ROUTES: who may read what, and what a save refuses.
 *
 * The first block needs no database: every door answers 401 to a stranger,
 * a chart that breaks the sky's own rules is refused before anything is
 * written, and the batched read is capped. The second block runs against a
 * real scratch schema: hidden lines stay hidden from every other door, Maia
 * reads the lines only with the member's yes, erasure leaves nothing, the
 * "Lines found" badge comes only with shown lines, and "Who complements me"
 * lists only people who joined it, to people who joined it.
 *
 * Every person here is invented, and every chart is computed from an invented
 * birth by the same code the browser runs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { loadModuleSettings, setModuleLifecycle } from "../lib/modules";
import { assistantNoteFor, forgetMemberGeneKeys, geneKeysForAssistant } from "../lib/geneKeys";
import { viewOf } from "../../shared/geneKeys";
import { evaluateEarnedBadges } from "../lib/badges";
import { chartAt, zonedToUtc } from "../../shared/geneKeysSky";
import { register } from "./geneKeys";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const ROUTES = [
  "GET /api/gene-keys/me",
  "PUT /api/gene-keys/me",
  "PATCH /api/gene-keys/me",
  "DELETE /api/gene-keys/me",
  "GET /api/gene-keys/people",
  "GET /api/gene-keys/people/:handle",
  "GET /api/gene-keys/complements",
  "GET /api/gene-keys/places",
];

function collect() {
  const handlers = new Map<string, Handler>();
  const mounts: string[] = [];
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: (p: string) => mounts.push(p) } as any,
    handlers,
    mounts,
  };
}

function makeRes() {
  const out: { status: number; body: any; text: string | null; headers: Record<string, string> } = { status: 200, body: undefined, text: null, headers: {} };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; },
    type(t: string) { out.headers["content-type"] = t; return res; },
    send(text: string) { out.text = text; return res; },
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

/** Every notice the routes sent, newest last. */
const notices: Array<{ userId: string; title: string; dedupeKey?: string }> = [];

function deps(pool: any, who: () => string | null, limited = false) {
  return {
    authedUser: async () => (who() ? { id: who() } : null),
    getPool: () => pool,
    overLimit: async () => limited,
    notify: async (n: any) => {
      notices.push(n);
      return { sent: true };
    },
  } as any;
}

/** Wren's chart: New York, 15 June 1990, 14:30. A Manifestor, 2/5, Gene Key 12.2. */
const WREN = chartAt(zonedToUtc(1990, 6, 15, 14, 30, "America/New_York"));
/** Kai's chart: London, 10 July 2001, 04:02. A Generator, 3/6. */
const KAI = chartAt(zonedToUtc(2001, 7, 10, 4, 2, "Europe/London"));
/** Juno's chart: Tokyo, 3 March 1995, 14:54. A Generator, 1/3. */
const JUNO = chartAt(zonedToUtc(1995, 3, 3, 14, 54, "Asia/Tokyo"));

describe("what Maia is told", () => {
  const wren = viewOf(WREN);

  it("says when she shapes something, keeps the offer the same, and nudges the circle rather than inviting", () => {
    const text = assistantNoteFor(wren, false);
    expect(text).toMatch(/2\/5 \(Dancer · Fixer\)/);
    expect(text).toMatch(/Strategy: Inform\./);
    expect(text).toMatch(/say so in a few plain words/);
    expect(text).toMatch(/the same options everyone gets/);
    expect(text).toMatch(/Never send an invitation on a circle's behalf/);
  });

  it("talking plainly keeps the facts for choosing and takes every trace out of her wording", () => {
    const text = assistantNoteFor(wren, true);
    expect(text).toMatch(/talk to them plainly/);
    expect(text).toMatch(/do not mention their profile, type or authority/);
    expect(text).not.toMatch(/Strategy:|say so in a few plain words/);
  });
});

describe("the gene keys doors, without a database", () => {
  const deadPool = { query: async () => [[], []] };

  it("mounts behind the module gate and registers every door", () => {
    const c = collect();
    register(c.app, deps(deadPool, () => null));
    expect(c.mounts).toEqual(["/api/gene-keys"]);
    expect([...c.handlers.keys()].sort()).toEqual([...ROUTES].sort());
  });

  it("answers 401 to a stranger at every door", async () => {
    const c = collect();
    register(c.app, deps(deadPool, () => null));
    for (const r of ROUTES) expect((await call(c.handlers, r)).status, r).toBe(401);
  });

  it("refuses a chart that breaks the sky's rules, a typed profile, and a bad setting", async () => {
    const c = collect();
    register(c.app, deps(deadPool, () => "m-wren"));
    const bent = structuredClone(WREN);
    bent.personality.Earth = { gate: 1, line: 1 };
    const refused = await call(c.handlers, "PUT /api/gene-keys/me", { body: { chart: bent, source: "exact" } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/does not add up/);
    expect((await call(c.handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "typed" } })).status).toBe(400);
    expect((await call(c.handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact", visibility: "everyone" } })).status).toBe(400);
    expect((await call(c.handlers, "PATCH /api/gene-keys/me", { body: {} })).status).toBe(400);
  });

  it("serves the birth-town list to a member, biggest towns first, with its credit", async () => {
    const c = collect();
    register(c.app, deps(deadPool, () => "m-wren"));
    const got = await call(c.handlers, "GET /api/gene-keys/places");
    expect(got.status).toBe(200);
    expect(got.headers["cache-control"]).toMatch(/^private, max-age=/);
    const lines = (got.text ?? "").split(/\r?\n/);
    expect(lines[0]).toMatch(/GeoNames.*CC BY 4\.0/);
    const blank = lines.indexOf("");
    expect(lines.slice(1, blank)).toContain("America/Costa_Rica");
    expect(lines.length - blank).toBeGreaterThan(30000);
  });

  it("bounds saves, and caps the batched read at sixty people", async () => {
    const limited = collect();
    register(limited.app, deps(deadPool, () => "m-wren", true));
    expect((await call(limited.handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } })).status).toBe(429);
    const c = collect();
    register(c.app, deps(deadPool, () => "m-wren"));
    const ids = Array.from({ length: 61 }, (_, i) => `m-${i}`).join(",");
    expect((await call(c.handlers, "GET /api/gene-keys/people", { query: { ids } })).status).toBe(400);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("gene keys against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let handlers: Map<string, Handler>;
  const as = (id: string | null) => { whoami = id; };
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadModuleSettings(pool);
    await setModuleLifecycle("gene-keys", "members", null, { sharedPasswordPosture: () => false });
    await setModuleLifecycle("badges", "members", null, { sharedPasswordPosture: () => false });
    await q( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?,?,?,'x',?), (?,?,?,'x',?), (?,?,?,'x',?)",
      ["m-wren", "Wren Alder", "wren@example.test", "wren", "m-kai", "Kai Moss", "kai@example.test", "kai", "m-juno", "Juno Ash", "juno@example.test", "juno"],
    );
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
    notices.length = 0;
    await q("DELETE FROM `member_gene_keys`"); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("DELETE FROM `badge_awards` WHERE `badge_id` = 'lines-found'"); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("DELETE FROM `badge_events` WHERE `badge_id` = 'lines-found'"); // module-review-ok: fixture SQL against the S5 scratch schema
  });

  it("saves a chart, derives the type on the server, and shows it back to its owner", async () => {
    const saved = await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } });
    expect(saved.status).toBe(200);
    const g = saved.body.geneKeys;
    expect({ profile: g.profile, names: g.names, type: g.type, authority: g.authority, visibility: g.visibility, maia: g.maia }).toEqual({
      profile: "2/5", names: "Dancer · Fixer", type: "Manifestor", authority: "Emotional", visibility: "show", maia: false,
    });
    expect(g.spheres.map((s: any) => `${s.name} ${s.keyLine} ${s.word}`)).toEqual([
      "Life's Work 12.2 Dancer", "Evolution 11.2 Passion & Relationship", "Radiance 36.5 Impact", "Purpose 6.5 Voice",
    ]);
    const [row] = await q("SELECT `profile`, `hd_type`, `chart` FROM `member_gene_keys` WHERE `user_id` = 'm-wren'"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect([row.profile, row.hd_type]).toEqual(["2/5", "Manifestor"]);
    expect(Object.keys(JSON.parse(row.chart)).sort()).toEqual(["design", "personality"]);
  });

  it("takes the card's own yes in the same save when it is sent, and leaves an earlier choice alone when it is not", async () => {
    const yes = await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact", maia: true, cards: true } });
    expect(yes.status).toBe(200);
    expect(yes.body.geneKeys.inCards).toBe(true);
    // Finding them again from the profile sends no card answer: the yes stands.
    const again = await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact", maia: true } });
    expect(again.body.geneKeys.inCards).toBe(true);
    const no = await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact", cards: false } });
    expect(no.body.geneKeys.inCards).toBe(false);
    expect((await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact", cards: "yes" } })).status).toBe(400);
    // A first save that says nothing about cards is not read on them.
    await q("DELETE FROM `member_gene_keys`"); // module-review-ok: fixture SQL against the S5 scratch schema
    const first = await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact", maia: true } });
    expect(first.body.geneKeys.inCards).toBe(false);
  });

  it("stores nothing a client sends beyond the 26 activations", async () => {
    const extra = { ...structuredClone(WREN), birth: { date: "1990-06-15", city: "New York" } } as any;
    extra.personality.Sun.note = "born at home";
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: extra, source: "exact", birthTime: "14:30" } });
    const [row] = await q("SELECT `chart` FROM `member_gene_keys` WHERE `user_id` = 'm-wren'"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(row.chart).not.toMatch(/1990|New York|born at home|14:30/);
  });

  it("keeps hidden lines from every other door", async () => {
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact", visibility: "hide" } });
    as("m-kai");
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: KAI, source: "chosen" } });
    as("m-juno");
    const people = await call(handlers, "GET /api/gene-keys/people", { query: { ids: "m-wren,m-kai" } });
    expect(Object.keys(people.body.people)).toEqual(["m-kai"]);
    expect(people.body.people["m-kai"].profile).toBe("3/6");
    expect((await call(handlers, "GET /api/gene-keys/people/:handle", { params: { handle: "wren" } })).body.geneKeys).toBeNull();
    expect((await call(handlers, "GET /api/gene-keys/people/:handle", { params: { handle: "kai" } })).body.geneKeys.type).toBe("Generator");

    as("m-wren");
    const shown = await call(handlers, "PATCH /api/gene-keys/me", { body: { visibility: "show" } });
    expect(shown.body.geneKeys.visibility).toBe("show");
    as("m-juno");
    expect((await call(handlers, "GET /api/gene-keys/people/:handle", { params: { handle: "wren" } })).body.geneKeys.profile).toBe("2/5");
  });

  it("lets Maia read the lines only after the member says yes", async () => {
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } });
    expect(await geneKeysForAssistant(pool, "m-wren")).toBeNull();
    await call(handlers, "PATCH /api/gene-keys/me", { body: { maia: true } });
    const text = await geneKeysForAssistant(pool, "m-wren");
    expect(text).toMatch(/2\/5 \(Dancer · Fixer\)/);
    expect(text).toMatch(/a Manifestor/);
    await setModuleLifecycle("gene-keys", "off", null, { sharedPasswordPosture: () => false });
    expect(await geneKeysForAssistant(pool, "m-wren")).toBeNull();
    await setModuleLifecycle("gene-keys", "members", null, { sharedPasswordPosture: () => false });
  });

  it("removes the row on the member's word, and on erasure", async () => {
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } });
    expect((await call(handlers, "DELETE /api/gene-keys/me")).body.removed).toBe(true);
    expect((await call(handlers, "GET /api/gene-keys/me")).body.geneKeys).toBeNull();
    expect((await call(handlers, "PATCH /api/gene-keys/me", { body: { maia: true } })).status).toBe(404);

    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } });
    expect(await forgetMemberGeneKeys(pool, "m-wren")).toBe(1);
    expect(await q("SELECT * FROM `member_gene_keys` WHERE `user_id` = 'm-wren'")).toEqual([]); // module-review-ok: fixture SQL against the S5 scratch schema
  });

  it("shows Love and Prosperity beside the Activation Sequence", async () => {
    const g = (await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } })).body.geneKeys;
    expect(g.love.map((s: any) => s.name)).toEqual(["Attraction", "IQ", "EQ", "SQ", "Core"]);
    expect(g.prosperity.map((s: any) => s.name)).toEqual(["Culture", "Pearl"]);
    expect(g.love.every((s: any) => s.word && /^\d+\.\d$/.test(s.keyLine))).toBe(true);
    expect([g.complement, g.maiaPlain]).toEqual([false, false]);
  });

  it("awards Lines found once, the moment lines are saved and shown, with one notice and no multiplier", async () => {
    const [badge] = await q("SELECT `kind`, `multiplier`, `multipliers`, `rule` FROM `badges` WHERE `id` = 'lines-found'"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(badge.kind).toBe("earned");
    expect([badge.multiplier, badge.multipliers]).toEqual([null, null]);

    const first = await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } });
    expect(first.body.badgeEarned).toBe("Lines found");
    const again = await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } });
    expect(again.body.badgeEarned).toBeNull();
    expect(await q("SELECT `count` FROM `badge_awards` WHERE `badge_id` = 'lines-found' AND `user_id` = 'm-wren'")).toEqual([{ count: 1 }]); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(notices.map((n) => [n.userId, n.title])).toEqual([["m-wren", "Badge earned: Lines found"]]);
  });

  it("never marks a hidden member, and awards it when they show their lines", async () => {
    as("m-kai");
    expect((await call(handlers, "PUT /api/gene-keys/me", { body: { chart: KAI, source: "exact", visibility: "hide" } })).body.badgeEarned).toBeNull();
    expect(await q("SELECT * FROM `badge_awards` WHERE `badge_id` = 'lines-found'")).toEqual([]); // module-review-ok: fixture SQL against the S5 scratch schema
    expect((await call(handlers, "PATCH /api/gene-keys/me", { body: { maia: true } })).body.badgeEarned).toBeNull();
    expect((await call(handlers, "PATCH /api/gene-keys/me", { body: { visibility: "show" } })).body.badgeEarned).toBe("Lines found");

    await setModuleLifecycle("badges", "off", null, { sharedPasswordPosture: () => false });
    as("m-juno");
    expect((await call(handlers, "PUT /api/gene-keys/me", { body: { chart: JUNO, source: "exact" } })).body.badgeEarned).toBeNull();
    await setModuleLifecycle("badges", "members", null, { sharedPasswordPosture: () => false });
  });

  it("the cycle-close engine counts shown lines only and never awards a second time what a save already awarded", async () => {
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } });
    as("m-kai");
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: KAI, source: "exact", visibility: "hide" } });
    await q("DELETE FROM `badge_awards` WHERE `badge_id` = 'lines-found' AND `user_id` = 'm-juno'"); // module-review-ok: fixture SQL against the S5 scratch schema
    as("m-juno");
    // Juno shows lines with the badges module off, so only the engine can award hers.
    await setModuleLifecycle("badges", "off", null, { sharedPasswordPosture: () => false });
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: JUNO, source: "exact" } });
    await setModuleLifecycle("badges", "members", null, { sharedPasswordPosture: () => false });

    const ran = await evaluateEarnedBadges(pool);
    expect(ran.newTiers.filter((t) => t.badgeId === "lines-found").map((t) => t.userId)).toEqual(["m-juno"]);
    const held = await q("SELECT `user_id`, `count` FROM `badge_awards` WHERE `badge_id` = 'lines-found' ORDER BY `user_id`"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(held).toEqual([{ user_id: "m-juno", count: 1 }, { user_id: "m-wren", count: 1 }]);
  });

  it("lists only people who joined Who complements me, to people who joined, ranked by the gaps they fill", async () => {
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact" } });
    as("m-kai");
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: KAI, source: "exact" } });
    await call(handlers, "PATCH /api/gene-keys/me", { body: { complement: true } });
    as("m-juno");
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: JUNO, source: "exact" } });

    as("m-wren");
    expect((await call(handlers, "GET /api/gene-keys/complements")).body).toEqual({ state: "not-joined" });
    await call(handlers, "PATCH /api/gene-keys/me", { body: { complement: true } });
    let got = (await call(handlers, "GET /api/gene-keys/complements")).body;
    expect(got.state).toBe("joined");
    // Juno has not joined, so only Kai, who brings both of Wren's missing lines 3 and 6.
    expect(got.people.map((p: any) => [p.name, p.handle, p.fills])).toEqual([["Kai Moss", "kai", [3, 6]]]);

    as("m-juno");
    await call(handlers, "PATCH /api/gene-keys/me", { body: { complement: true } });
    as("m-wren");
    got = (await call(handlers, "GET /api/gene-keys/complements")).body;
    // Juno is 1/3: line 3 and line 1, both missing from Wren's 2/5. A tie on gaps and type, so by name.
    expect(got.people.map((p: any) => [p.name, p.fills])).toEqual([["Juno Ash", [1, 3]], ["Kai Moss", [3, 6]]]);

    as("m-kai");
    await call(handlers, "PATCH /api/gene-keys/me", { body: { visibility: "hide" } });
    as("m-wren");
    expect((await call(handlers, "GET /api/gene-keys/complements")).body.people.map((p: any) => p.name)).toEqual(["Juno Ash"]);
    await call(handlers, "PATCH /api/gene-keys/me", { body: { visibility: "hide" } });
    expect((await call(handlers, "GET /api/gene-keys/complements")).body).toEqual({ state: "hidden" });
    as("m-kai");
    expect((await call(handlers, "GET /api/gene-keys/complements")).body).toEqual({ state: "hidden" });
    as("m-ash");
    expect((await call(handlers, "GET /api/gene-keys/complements")).body).toEqual({ state: "no-lines" });
  });

  it("talks plainly once the member asks, and only then", async () => {
    await call(handlers, "PUT /api/gene-keys/me", { body: { chart: WREN, source: "exact", maia: true } });
    expect(await geneKeysForAssistant(pool, "m-wren")).toMatch(/Strategy: Inform/);
    const plain = await call(handlers, "PATCH /api/gene-keys/me", { body: { maiaPlain: true } });
    expect(plain.body.geneKeys.maiaPlain).toBe(true);
    expect(await geneKeysForAssistant(pool, "m-wren")).toMatch(/talk to them plainly/);
    expect((await call(handlers, "PATCH /api/gene-keys/me", { body: { maiaPlain: "yes" } })).status).toBe(400);
  });
});
