/**
 * THE END-OF-MOON REVIEW'S MEMBER DOORS (lane B): the module gate stands in
 * front of every door, a stranger is turned away at each, gather reads the
 * board first (check 36) and twice adds nothing (check 5), a recap sends with
 * no pay route (check 7) and takes back to Draft (check 9), and another
 * member's view carries no amount, route, invoice, review note, suggested or
 * Approvers only item, and a room item only where the reader may see it
 * (check 12). The privacy test asserts on the response object, never on a
 * missing substring.
 *
 * The first block needs no database. The second runs against a real scratch
 * schema and skips without TEST_DATABASE_URL. Every person here is invented.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { MOON_API_PREFIXES, MOON_ROUTES, SERA_CLOSED_NOTE } from "../../shared/moonRecap";
import { requireModule } from "../lib/modules";
import { gatherMoon, loadFrame, memberMoon, moonOf } from "../lib/moonRecap";
import { MEMBER_MOON_PATH, register } from "./moonRecaps";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const order: string[] = [];
  const record = (method: string) => (p: string, handler: Handler) => {
    order.push(`${method} ${p}`);
    handlers.set(`${method} ${p}`, handler);
  };
  const use = (p: string) => order.push(`USE ${p}`);
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use } as any, handlers, order };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
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

const TZ = "America/Costa_Rica";
const deps = (pool: any, who: () => string | null, seasons: any[] = []) => ({
  authedUser: async () => (who() ? { id: who() } : null),
  getPool: () => pool,
  overLimit: async () => false,
  seasonState: () => ({ current: null, seasons, timezone: TZ }),
  lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
  members: { byId: async (id: string) => ({ id, name: id }) } as any,
  notify: async () => ({}) as any,
  cashKeyHolders: async () => [] as string[],
});

const ROUTES = [
  `GET ${MOON_ROUTES.myMoon}`,
  `POST ${MOON_ROUTES.gather}`,
  `POST ${MOON_ROUTES.askSera}`,
  `POST ${MOON_ROUTES.addItem}`,
  `PATCH ${MOON_ROUTES.editItem}`,
  `POST ${MOON_ROUTES.sendRecap}`,
  `POST ${MOON_ROUTES.takeBack}`,
  `GET ${MOON_ROUTES.payRoute}`,
  `PUT ${MOON_ROUTES.payRoute}`,
  `GET ${MOON_ROUTES.memberMoon}`,
];

describe("the member doors without a database", () => {
  it("mounts the module gate on every prefix before any door, and every door sits behind one", () => {
    const c = collect();
    register(c.app, deps(null, () => null));
    const gates = [...MOON_API_PREFIXES, MEMBER_MOON_PATH].map((p) => `USE ${p}`);
    expect(c.order.slice(0, gates.length)).toEqual(gates);
    const doors = c.order.slice(gates.length);
    expect(doors.some((d) => d.startsWith("USE "))).toBe(false);
    expect(doors.sort()).toEqual([...ROUTES].sort());
    for (const d of doors) {
      const path = d.split(" ")[1];
      expect([...MOON_API_PREFIXES, MEMBER_MOON_PATH].some((p) => path === p || path.startsWith(`${p}/`)), d).toBe(true);
    }
  });

  it("is a 404 at the gate while the module is off, which is how it ships", async () => {
    const { res, out } = makeRes();
    let passed = false;
    await requireModule("moon-review")({ headers: {} } as any, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(out).toEqual({ status: 404, body: { error: "module_disabled", module: "moon-review" } });
  });

  it("answers 401 at every door to a stranger", async () => {
    const c = collect();
    register(c.app, deps(null, () => null));
    for (const r of ROUTES) expect((await call(c.handlers, r, { params: { cycle: "open", id: "x", handle: "wren" } })).status, r).toBe(401);
  });

  it("does not offer the in-app Sera draft, and calls nothing to say so", async () => {
    const c = collect();
    register(c.app, deps(null, () => "m-wren"));
    const out = await call(c.handlers, `POST ${MOON_ROUTES.askSera}`, { params: { cycle: "open" } });
    expect(out).toEqual({ status: 404, body: { error: "not_offered" } });
  });

  it("refuses a moon that is not one of the clock's, or one not begun", async () => {
    const c = collect();
    register(c.app, deps(null, () => "m-wren"));
    const next = LUNAR_CLOCK.boundsFor(new Date(Date.now() + 40 * 86_400_000)).id;
    for (const cycle of ["2026-10", "nonsense", next]) {
      expect((await call(c.handlers, `POST ${MOON_ROUTES.gather}`, { params: { cycle } })).body, cycle).toEqual({ error: "unknown_moon" });
    }
  });
});

const configured = testDbConfigured();

// The moon of 10 October to 8 November 2026.
const MOON = moonOf(LUNAR_CLOCK.boundsFor(new Date("2026-10-20T12:00:00Z")), TZ);
const CYCLE = MOON.bounds.id;
const SEASONS = [{ id: "season-f", startsOn: "2026-06-21", endsOn: "2027-01-01", goals: [{ id: "g-ready", text: "Ready to take reservations", done: false }] }];

describe.skipIf(!configured)("the member doors against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let handlers: Map<string, Handler>;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const frameDeps = { timeZone: TZ, seasons: SEASONS };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    for (const [id, name, handle] of [["m-wren", "Wren Alder", "wren"], ["m-rook", "Rook Vale", "rook"]]) {
      await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?,?,?,'x',?)", [id, name, `${handle}@example.test`, handle]); // module-review-ok: fixture SQL against the S5 scratch schema
    }
    await q( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO `org_roles` (`id`, `name`, `accountabilities`) VALUES ('r-water', 'Water keeper', ?), ('r-other', 'Gate keeper', ?)",
      [JSON.stringify(["Keep the water clean"]), JSON.stringify(["Open the gate"])],
    );
    await q( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `started_at`) VALUES ('a-wren', 'r-water', 'member', 'm-wren', 'm-wren', '2026-09-01 12:00:00')",
    );
    const c = collect();
    register(c.app, deps(pool, () => whoami, SEASONS));
    handlers = c.handlers;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    whoami = "m-wren";
    for (const t of ["moon_recap_items", "moon_recaps", "moon_review_events", "member_tasks", "member_task_feedback", "role_tensions"]) {
      await q(`DELETE FROM \`${t}\``); // module-review-ok: fixture SQL against the S5 scratch schema
    }
  });

  const addTask = (id: string, over: { title?: string; source?: string; externalId?: string | null; status?: string; createdOn: string; doneAt?: string | null; removeReason?: string | null; detail?: string | null }) =>
    q( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO `member_tasks` (`id`, `user_id`, `title`, `private_detail`, `minutes`, `status`, `remove_reason`, `source`, `external_id`, `created_on`, `done_at`) VALUES (?,?,?,?,45,?,?,?,?,?,?)",
      [id, "m-wren", over.title ?? `Task ${id}`, over.detail ?? null, over.status ?? "open", over.removeReason ?? null, over.source ?? "self", over.externalId ?? null, over.createdOn, over.doneAt ?? null],
    );
  const pressDone = (taskId: string, action = "done", reason: string | null = null) =>
    q( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO `member_task_feedback` (`feedback_id`, `user_id`, `task_id`, `action`, `screen_reason`) VALUES (?,?,?,?,?)",
      [`fb-${taskId}-${action}`, "m-wren", taskId, action, reason],
    );

  it("check 36: gathers the board's own marks, titles only, and a second gather adds nothing", async () => {
    await addTask("t-pressed", { title: "Tested the well", status: "done", createdOn: "2026-10-12", doneAt: "2026-10-20 15:00:00", detail: "call 555 0101 0101" });
    await pressDone("t-pressed");
    await addTask("t-synced", { title: "Library task", source: "sera", externalId: "lib-1", status: "done", createdOn: "2026-10-12", doneAt: "2026-10-21 15:00:00" });
    await addTask("t-open", { title: "Map the springs", createdOn: "2026-10-15" });
    await addTask("t-before", { title: "Old work", status: "done", createdOn: "2026-10-01", doneAt: "2026-10-20 15:00:00" });
    await pressDone("t-before");
    await addTask("t-gone", { title: "Not a task really", status: "removed", removeReason: "not_a_task", createdOn: "2026-10-16" });
    await pressDone("t-gone", "remove", "not_a_task");

    const first = await call(handlers, `POST ${MOON_ROUTES.gather}`, { params: { cycle: CYCLE } });
    expect(first.status).toBe(200);
    expect(first.body.added).toBe(4);
    const byText = new Map<string, any>(first.body.items.map((i: any) => [i.text, i]));
    expect(byText.get("Tested the well")).toMatchObject({ origin: "task", state: "kept", doneOn: "2026-10-20" });
    expect(byText.get("Library task")).toMatchObject({ origin: "sera", state: "suggested", originNote: SERA_CLOSED_NOTE });
    expect(byText.get("Map the springs")).toMatchObject({ state: "suggested" });
    expect(byText.get("Not a task really")).toMatchObject({ state: "suggested" });
    expect(byText.has("Old work")).toBe(false);
    for (const item of first.body.items) expect(Object.keys(item)).not.toContain("minutes");
    // Titles and nothing else: each item's words are exactly its task's title.
    expect(first.body.items.map((i: any) => i.text).sort()).toEqual(["Library task", "Map the springs", "Not a task really", "Tested the well"]);

    const again = await call(handlers, `POST ${MOON_ROUTES.gather}`, { params: { cycle: CYCLE } });
    expect(again.body.added).toBe(0);
    expect(again.body.items).toHaveLength(4);
    const keys = await q("SELECT `dedupe_key` FROM `moon_recap_items` ORDER BY `dedupe_key`"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(keys.map((r: any) => r.dedupe_key)).toEqual(["sera:lib-1", "task:t-gone", "task:t-open", "task:t-pressed"]);
  });

  it("reads the member's roles, the season's goals and their filed seasonal goals into My moon", async () => {
    await q( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO season_plans (id, user_id, season_id, version, aim, serves_goal, commitments_json, handing_back, seasonal_goals_json, filed_at) VALUES ('sp-1','m-wren','season-f',1,NULL,NULL,'{}','[]',?,UTC_TIMESTAMP())",
      [JSON.stringify([{ title: "Clean water for every home", doneWhen: null }])],
    );
    const out = await call(handlers, `GET ${MOON_ROUTES.myMoon}`, { query: { cycle: CYCLE } });
    expect(out.status).toBe(200);
    expect(out.body.moon).toMatchObject({ cycleId: CYCLE, endOfMoonFriday: "2026-11-06" });
    expect(out.body.roles.map((r: any) => r.roleId)).toEqual(["r-water"]);
    expect(out.body.seasonGoals).toEqual([{ id: "g-ready", words: "Ready to take reservations" }]);
    expect(out.body.ownGoals).toEqual(["Clean water for every home"]);
    expect(out.body.recap).toBeNull();
    expect(out.body.invoice).toBeNull();
    await q("DELETE FROM season_plans"); // module-review-ok: fixture SQL against the S5 scratch schema
  });

  it("check 7 and 9: sends with no pay route, raises the role audit as a tension, locks, and takes back to Draft", async () => {
    const add = await call(handlers, `POST ${MOON_ROUTES.addItem}`, { params: { cycle: CYCLE }, body: { text: "Fixed the pump", roleId: "r-water" } });
    expect(add.status).toBe(201);
    expect(add.body.item).toMatchObject({ origin: "hand", state: "kept", roleId: "r-water" });

    const sent = await call(handlers, `POST ${MOON_ROUTES.sendRecap}`, {
      params: { cycle: CYCLE },
      body: { ownWords: "A good moon.", roleAudit: { roles: [{ roleId: "r-water", choice: "expand", note: "The springs too" }], newRoles: [] } },
    });
    expect(sent.status).toBe(200);
    expect(sent.body.recap).toMatchObject({ status: "waiting", round: 1, waitingOn: "work" });
    expect(sent.body.tensionsRaised).toBe(1);
    const events = await q("SELECT `kind` FROM `moon_review_events`"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(events.map((e: any) => e.kind)).toEqual(["sent"]);

    const locked = await call(handlers, `PATCH ${MOON_ROUTES.editItem}`, { params: { id: add.body.item.id }, body: { text: "Changed" } });
    expect(locked).toEqual({ status: 409, body: { error: "not_editable" } });

    const back = await call(handlers, `POST ${MOON_ROUTES.takeBack}`, { params: { cycle: CYCLE } });
    expect(back.status).toBe(200);
    expect(back.body.recap).toMatchObject({ status: "draft", workApprovedAt: null, financeApprovedAt: null });
    const edited = await call(handlers, `PATCH ${MOON_ROUTES.editItem}`, { params: { id: add.body.item.id }, body: { text: "Fixed the pump twice" } });
    expect(edited.status).toBe(200);

    whoami = "m-rook";
    const theirs = await call(handlers, `PATCH ${MOON_ROUTES.editItem}`, { params: { id: add.body.item.id }, body: { text: "Mine now" } });
    expect(theirs.status).toBe(404);
  });

  it("check 12: another member reads kept Members items only, a count of the private ones, and a room item only where they may see it", async () => {
    const frame = await loadFrame(pool, "m-wren", MOON, frameDeps);
    const { recap } = await gatherMoon(pool, "m-wren", MOON, frame, { ...frameDeps, accomplishments: async () => [] });
    const put = (id: string, origin: string, key: string, text: string, state: string, visibility: string, review = "pending", url: string | null = null) =>
      q( // module-review-ok: fixture SQL against the S5 scratch schema
        "INSERT INTO `moon_recap_items` (`id`, `recap_id`, `origin`, `dedupe_key`, `text`, `evidence_url`, `role_id`, `state`, `visibility`, `review`, `review_note`, `position`) VALUES (?,?,?,?,?,?,'r-water',?,?,?,?,0)",
        [id, recap.id, origin, key, text, url, state, visibility, review, review === "returned" ? "Name the deliverable" : null],
      );
    await put("mi-0000000000000001", "hand", "hand:1", "Shown to members", "kept", "members", "pending", "https://example.test/proof");
    await put("mi-0000000000000002", "hand", "hand:2", "Held for approvers", "kept", "approvers");
    await put("mi-0000000000000003", "hand", "hand:3", "Still a suggestion", "suggested", "members");
    await put("mi-0000000000000004", "hand", "hand:4", "Dropped", "dropped", "members");
    await put("mi-0000000000000005", "hand", "hand:5", "Returned by the approver", "kept", "members", "returned");
    await put("mi-0000000000000006", "room", "room:71", "Room work they may see", "kept", "members");
    await put("mi-0000000000000007", "room", "room:72", "Room work they may not see", "kept", "members");
    await put("mi-0000000000000008", "sera", "sera:lib-8", "Sera work", "kept", "members", "pending", "https://example.test/sera");

    const draft = await memberMoon(pool, "m-wren", MOON, { ...frameDeps, visibleRoomEntries: async () => new Set([71]) });
    expect(draft.roles).toEqual([]);

    await q("UPDATE `moon_recaps` SET `status` = 'waiting', `round` = 1, `sent_at` = UTC_TIMESTAMP() WHERE `id` = ?", [recap.id]); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("INSERT INTO `member_pay_routes` (`user_id`, `route`, `legal_name`, `tax_form_kind`, `invoice_seq`) VALUES ('m-wren', 'abroad', 'Wren Alder', 'none', 0)"); // module-review-ok: fixture SQL against the S5 scratch schema

    whoami = "m-rook";
    const out = await call(handlers, `GET ${MOON_ROUTES.memberMoon}`, { params: { handle: "wren" }, query: { cycle: CYCLE } });
    expect(out.status).toBe(200);
    expect(Object.keys(out.body).sort()).toEqual(["moon", "roles"]);
    expect(Object.keys(out.body.moon).sort()).toEqual(["cycleId", "endOfMoonFriday", "firstDay", "lastDay", "periodWords"]);
    expect(out.body.roles).toHaveLength(1);
    const role = out.body.roles[0];
    expect(Object.keys(role).sort()).toEqual(["heldPrivately", "items", "name", "roleId"]);
    expect(role).toMatchObject({ roleId: "r-water", name: "Water keeper", heldPrivately: 1 });
    for (const item of role.items) expect(Object.keys(item).sort()).toEqual(["evidenceUrl", "id", "seasonGoalId", "text"]);
    // The real reader is m-rook, who reads no room task at all in this fixture.
    expect(role.items.map((i: any) => i.text).sort()).toEqual(["Sera work", "Shown to members"]);
    expect(role.items.find((i: any) => i.text === "Sera work").evidenceUrl).toBeNull();

    // The room filter, with a reader who may see entry 71 and not 72.
    const viaFilter = await memberMoon(pool, "m-wren", MOON, { ...frameDeps, visibleRoomEntries: async () => new Set([71]) });
    expect(viaFilter.roles[0].items.map((i) => i.text).sort()).toEqual(["Room work they may see", "Sera work", "Shown to members"]);
    await q("DELETE FROM `member_pay_routes`"); // module-review-ok: fixture SQL against the S5 scratch schema
  });
});
