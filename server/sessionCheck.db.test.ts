/**
 * A proposal is checked in a live session (0297), against a real schema,
 * through the real handlers (the harness server/sessionVotes.db.test.ts uses).
 *
 * Rye, 2026-10-30: a "Check Sera" button runs a live proposal against the
 * village's purpose so the room sees the result in the meeting. Rye,
 * 2026-10-31: the facilitator and the proposer press it, and the village's own
 * half is built now. What this proves:
 *
 *   WHO       the facilitator and the proposer check; anybody else is refused
 *   WHAT      only an open proposal; a note, and a decided proposal, refused
 *   THE READ  the season's priorities the words name, the roles they name with
 *             where each holder was, and when the purpose was written, and no
 *             person anywhere in what is stored
 *   THE ROOM  everybody in the room sees the same read; a second check
 *             replaces the first; new words mark it changed
 *   GONE      removing the proposal, a member's erasure and discarding the
 *             session each take the check with them
 *   OFF       with the module that offers checks off, the door answers 404
 *             and the room carries no check
 *
 * THE CASES RUN IN ORDER and share one room. No TEST_DATABASE_URL and the
 * suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register } from "./routes/liveSessions";
import { forgetMemberSessions } from "./lib/liveSessions";
import { loadModuleSettings } from "./lib/modules";
import { writeGoverningPurpose } from "./lib/governingPurpose";
import { CHECK_REFUSALS } from "../shared/sessionCheck";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: () => undefined },
    handlers,
  };
}

function makeRes() {
  const out: { status: number; body: any; headers: Record<string, string> } = { status: 200, body: undefined, headers: {} };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    send() {
      return res;
    },
    end() {
      return res;
    },
  };
  return { res, out };
}

const PEOPLE: Record<string, any> = {
  "m-ana": { id: "m-ana", name: "Ana Reyes", handle: "ana" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", handle: "ben" },
  "m-cai": { id: "m-cai", name: "Cai Moreno", handle: "cai" },
  "m-dee": { id: "m-dee", name: "Dee Lund", handle: "dee" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin" },
};

const SEASON = {
  current: { id: "rains-2026", name: "Rains", startsOn: "2026-09-01", goals: [{ text: "Fix the water system" }, { text: "Open the guest house" }] },
  seasons: [],
  timezone: "UTC",
};

const PURPOSE = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");

describe.skipIf(!testDbConfigured())("a proposal is checked in a live session", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };

  let sid = 0;
  const room = (extra: Record<string, string> = {}) => ({ id: String(sid), ...extra });
  const view = async (who: string) => (await as(who, "GET /api/sessions/:id", { params: room() })).body;
  const propose = async (who: string, text: string, kind = "decision") =>
    (await as(who, "POST /api/sessions/:id/entries", { params: room(), body: { kind, text } })).body.id as number;
  const check = (who: string, entryId: number) => as(who, "POST /api/sessions/:id/entries/:entryId/check", { params: room({ entryId: String(entryId) }) });
  const checkRow = async (entryId: number) => (await q("SELECT * FROM `live_session_checks` WHERE `entry_id` = ?", [entryId]))[0] ?? null;
  const noOf = async (userId: string) => Number((await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = ?", [userId]))[0].no);

  let tank = 0;
  let note = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    // The module that offers checks, open to members, and the roles a proposal may name.
    await q("INSERT INTO `module_settings` (`module_id`, `lifecycle`) VALUES ('saberra', 'members')"); // module-review-ok: turns the module that offers checks on in this scratch schema
    await loadModuleSettings(pool);
    await q(
      "INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES " + // module-review-ok: fixture seats in this scratch schema
        "('seat-tre', 'c-garden', 'Treasurer', 1, 0), ('seat-water', 'c-garden', 'Water Keeper', 1, 0), ('seat-kit', 'c-garden', 'Kitchen', 1, 0)",
    );
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`) VALUES " + // module-review-ok: fixture seatings in this scratch schema
        "('ora-dee', 'seat-tre', 'member', 'm-dee', 'm-dee'), ('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai')",
    );
    expect((await writeGoverningPurpose(pool, { statement: PURPOSE, writtenBy: "m-founder", at: new Date("2026-09-23T10:00:00Z") })).ok).toBe(true);

    const c = collect();
    register(c.app, {
      authedUser: async () => (whoami ? { ...(PEOPLE[whoami] ?? { id: whoami }), id: whoami } : null),
      isAdmin: async () => whoami === "m-founder",
      getPool: () => pool,
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null },
      notify: async () => ({ inserted: true }),
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }] },
      seasonState: () => SEASON,
    } as any);
    handlers = c.handlers;

    sid = (await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 6", circleId: "c-garden" } })).body.id;
    for (const w of ["m-ben", "m-cai"]) expect((await as(w, "POST /api/sessions/:id/join", { params: room() })).status).toBe(200);
    // Cai, who holds the Water Keeper role, is in the room right now. Dee, the Treasurer, never came.
    expect((await as("m-cai", "POST /api/sessions/:id/here", { params: room() })).status).toBe(200);
    tank = await propose("m-ben", "The Treasurer releases the budget, and the Water Keeper and the Kitchen fix the water system");
    note = await propose("m-cai", "Bring gloves", "note");
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("offers checks in the room, and none is made yet", async () => {
    const v = await view("m-cai");
    expect(v.check).toEqual({ agent: "Sera", purpose: null, byEntry: {} });
  });

  it("refuses anybody but the facilitator and the proposer", async () => {
    const out = await check("m-cai", tank);
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(CHECK_REFUSALS.notYours);
    // Dee never joined the room.
    expect((await check("m-dee", tank)).status).toBe(403);
    expect(await checkRow(tank)).toBeNull();
  });

  it("refuses anything but a proposal", async () => {
    const out = await check("m-ana", note);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe(CHECK_REFUSALS.notAProposal);
  });

  it("lets the proposer check, and reads the priorities, the roles and the purpose, with no person in it", async () => {
    expect((await check("m-ben", tank)).status).toBe(200);
    const read = JSON.parse((await checkRow(tank)).read_json);
    expect(read.season).toBe("Rains");
    expect(read.priorities).toEqual([
      { text: "Fix the water system", named: true },
      { text: "Open the guest house", named: false },
    ]);
    expect(read.roles).toEqual([
      { seatId: "seat-tre", name: "Treasurer", holder: "away" },
      { seatId: "seat-water", name: "Water Keeper", holder: "here" },
      { seatId: "seat-kit", name: "Kitchen", holder: "open" },
    ]);
    expect(read.hasPurpose).toBe(true);
    expect(read.purposeWrittenAt).toBe("2026-09-23T10:00:00.000Z");
    const stored = JSON.stringify(await checkRow(tank));
    for (const person of ["m-dee", "m-cai", "Dee", "Cai", "Lund", "Moreno"]) expect(stored).not.toContain(person);
    // Nor the proposer's words: only a hash of them, so a reword leaves no earlier draft here.
    expect(stored).not.toContain("releases the budget");
    expect((await checkRow(tank)).checked_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows the same read to everybody in the room, with the purpose", async () => {
    for (const who of ["m-ana", "m-cai"]) {
      const v = await view(who);
      expect(v.check.purpose).toBe(PURPOSE);
      const c = v.check.byEntry[String(tank)];
      expect(c.changed).toBe(false);
      expect(c.purposeChanged).toBe(false);
      expect(c.read.roles.map((r: any) => r.holder)).toEqual(["away", "here", "open"]);
    }
  });

  it("lets the facilitator check again, which replaces the first, and marks new words as changed", async () => {
    expect((await as("m-ben", "PATCH /api/sessions/:id/entries/:entryId", { params: room({ entryId: String(tank) }), body: { text: "The Kitchen opens the guest house" } })).status).toBe(200);
    expect((await view("m-cai")).check.byEntry[String(tank)].changed).toBe(true);
    expect((await check("m-ana", tank)).status).toBe(200);
    expect(await q("SELECT * FROM `live_session_checks` WHERE `session_id` = ?", [sid])).toHaveLength(1);
    const c = (await view("m-cai")).check.byEntry[String(tank)];
    expect(c.changed).toBe(false);
    expect(c.read.priorities).toEqual([
      { text: "Fix the water system", named: false },
      { text: "Open the guest house", named: true },
    ]);
    expect(c.read.roles).toEqual([{ seatId: "seat-kit", name: "Kitchen", holder: "open" }]);
  });

  it("says when the purpose was rewritten after the check", async () => {
    expect((await writeGoverningPurpose(pool, { statement: `${PURPOSE} more`, writtenBy: "m-founder" })).ok).toBe(true);
    expect((await view("m-ana")).check.byEntry[String(tank)].purposeChanged).toBe(true);
  });

  it("refuses a decided proposal", async () => {
    const done = await propose("m-ben", "We keep the gate closed at night");
    await q("UPDATE `live_session_entries` SET `status` = 'done' WHERE `id` = ?", [done]); // module-review-ok: marks a fixture proposal decided without running a consent round
    const out = await check("m-ana", done);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe(CHECK_REFUSALS.decided);
  });

  it("refuses a parked proposal", async () => {
    const parked = await propose("m-ben", "We paint the shed");
    await q("UPDATE `live_session_entries` SET `status` = 'parked' WHERE `id` = ?", [parked]); // module-review-ok: parks a fixture proposal
    const out = await check("m-ben", parked);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe(CHECK_REFUSALS.notOpen);
  });

  it("lets an admin who is in the room check, never one outside it, and never the secretary", async () => {
    const shed = await propose("m-ben", "The Kitchen moves to the shed");
    // The admin has not joined: refused before anything is read.
    expect((await check("m-founder", shed)).status).toBe(403);
    expect((await as("m-founder", "POST /api/sessions/:id/join", { params: room() })).status).toBe(200);
    expect((await check("m-founder", shed)).status).toBe(200);
    // The secretary keeps the notes; checking is the facilitator's and the proposer's.
    expect((await as("m-ana", "POST /api/sessions/:id/hosts", { params: room(), body: { secretaryUserId: await noOf("m-cai") } })).status).toBe(200);
    const out = await check("m-cai", shed);
    expect(out.status).toBe(403);
    expect(out.body.error).toBe(CHECK_REFUSALS.notYours);
  });

  it("takes the check with a proposal the facilitator filled in and then took back", async () => {
    const added = await as("m-ana", "POST /api/sessions/:id/entries", { params: room(), body: { kind: "decision", text: "The Kitchen closes on Mondays", forUserId: await noOf("m-ben") } });
    expect(added.status).toBe(200);
    expect((await check("m-ana", added.body.id)).status).toBe(200);
    const fill = (await view("m-ana")).entries.find((e: any) => e.id === added.body.id).filledIn;
    expect(fill?.canUndo).toBe(true);
    expect((await as("m-ana", "POST /api/sessions/:id/on-behalf/:fillId/undo", { params: room({ fillId: String(fill.id) }) })).status).toBe(200);
    expect(await checkRow(added.body.id)).toBeNull();
  });

  it("takes the check with the proposal when it is removed", async () => {
    const gone = await propose("m-ben", "The Treasurer buys a pump");
    expect((await check("m-ben", gone)).status).toBe(200);
    expect(await checkRow(gone)).not.toBeNull();
    expect((await as("m-ben", "DELETE /api/sessions/:id/entries/:entryId", { params: room({ entryId: String(gone) }) })).status).toBe(200);
    expect(await checkRow(gone)).toBeNull();
  });

  it("takes the checks on a member's proposals with them when they are erased, sweeps up any orphan, and leaves the rest", async () => {
    const anas = await propose("m-ana", "The Kitchen cooks on Fridays");
    expect((await check("m-ana", anas)).status).toBe(200);
    // A check whose proposal went under an older release, which knew nothing of checks.
    await q("INSERT INTO `live_session_checks` (`entry_id`, `session_id`, `checked_hash`, `read_json`) VALUES (987654, ?, ?, '{}')", [sid, "0".repeat(64)]); // module-review-ok: a fixture orphan in this scratch schema
    await forgetMemberSessions(pool, "m-ben", async (id) => PEOPLE[id] ?? null);
    expect(await checkRow(tank)).toBeNull();
    expect(await checkRow(987654)).toBeNull();
    expect(await checkRow(anas)).not.toBeNull();
  });

  it("answers 404 and carries no check while the module that offers checks is off", async () => {
    await q("UPDATE `module_settings` SET `lifecycle` = 'off' WHERE `module_id` = 'saberra'"); // module-review-ok: turns the module off in this scratch schema
    await loadModuleSettings(pool);
    const [left] = await q("SELECT `entry_id` FROM `live_session_checks` WHERE `session_id` = ?", [sid]);
    const out = await check("m-ana", Number(left.entry_id));
    expect(out.status).toBe(404);
    expect(out.body.error).toBe(CHECK_REFUSALS.off);
    expect((await view("m-ana")).check).toBeNull();
    await q("UPDATE `module_settings` SET `lifecycle` = 'members' WHERE `module_id` = 'saberra'"); // module-review-ok: turns the module back on for the last case
    await loadModuleSettings(pool);
  });

  it("takes every check with the session when it is discarded", async () => {
    expect((await q("SELECT * FROM `live_session_checks` WHERE `session_id` = ?", [sid])).length).toBeGreaterThan(0);
    expect((await as("m-ana", "DELETE /api/sessions/:id", { params: room() })).status).toBe(200);
    expect(await q("SELECT * FROM `live_session_checks` WHERE `session_id` = ?", [sid])).toEqual([]);
  });
});
