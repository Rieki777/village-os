/**
 * RAISE A TENSION WITH A ROLE, end to end on a real schema (player role card,
 * PR 5 of 7; shared/roleTensions.ts is the contract).
 *
 * What is pinned:
 *
 *   - a member raises; every live holder hears once, the raiser never; a
 *     guest is refused and a visitor is asked to sign in; empty, long and
 *     payment-shaped words are refused; the hourly bound answers 429;
 *   - a member who holds nothing cannot respond, and learns nothing;
 *   - the words: a stranger member reads counts and no words, the raiser and
 *     the holder read them; the same through `tensionsForRoles`, the player
 *     card's feed, where a guest reads nothing at all;
 *   - an answer keeps the words private and shows a count;
 *   - bring_to_circle writes a `tension` entry into the circle's last session,
 *     the next room offers it under "From last time", and every member reads
 *     the words from then on; a circle that has not met refuses with a sentence;
 *   - the holder's own read (GET mine) carries open ones only;
 *   - the reminder after 2 business days, once, on the real notification spine;
 *   - erasure: the raiser comes off, unanswered words are cleared, answered
 *     words stay.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { loadModuleSettings } from "./lib/modules";
import { insertNotification, type NotifyInput } from "./lib/notify";
import { forgetRoleTensionsFor, isOverdue, remindTensionHolders, tensionsForRoles } from "./lib/roleTensions";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerTensions } from "./routes/roleTensions";
import { MY_TENSIONS_URL, TENSION_COPY, TENSION_REFUSALS, type RoleTensionsPayload } from "../shared/roleTensions";

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
    setHeader() {},
    send() {
      return res;
    },
    end() {
      return res;
    },
  };
  return { res, out };
}

const member = (id: string, name: string) => ({ id, name, handle: id.slice(2), membershipGranted: true });
const PEOPLE: Record<string, any> = {
  "m-ana": member("m-ana", "Ana Reyes"),
  "m-ben": member("m-ben", "Ben Ortiz"),
  "m-cai": member("m-cai", "Cai Moreno"),
  "m-gil": member("m-gil", "Gil Varga"),
  "m-dee": member("m-dee", "Dee Lund"),
  // Signed in, never admitted: the Guest stage.
  "g-gus": { id: "g-gus", name: "Gus Guest", handle: "gus", membershipGranted: false, stageGranted: "guest" },
};

const configured = testDbConfigured();
if (!configured) console.warn("[roleTensions.db] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe.skipIf(!configured)("raise a tension with a role, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  let limited = false;
  const notices: NotifyInput[] = [];

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const raise = (who: string | null, roleId: string, text: unknown) => as(who, "POST /api/roles/:id/tensions", { params: { id: roleId }, body: { text } });
  const read = async (who: string | null, roleId: string): Promise<RoleTensionsPayload> => {
    const out = await as(who, "GET /api/roles/:id/tensions", { params: { id: roleId } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body;
  };
  const respond = (who: string, id: string, body: Record<string, unknown>) => as(who, "POST /api/role-tensions/:id/respond", { params: { id }, body });

  /** The real spine on the scratch schema: nobody has an email, so nothing is mailed. */
  const notify = async (input: NotifyInput) => {
    notices.push(input);
    return insertNotification(
      { pool, memberById: async () => null, sendEmail: async () => ({ ok: false }) as any, origin: () => "http://127.0.0.1", projectName: () => "Test village", isPresent: () => true } as any,
      input,
    );
  };

  let closed = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await q("INSERT INTO `module_settings` (`module_id`, `lifecycle`) VALUES ('sessions', 'members')"); // module-review-ok: turns Live Sessions on in the scratch schema this suite provisioned, so a bring to the circle has a backlog
    await loadModuleSettings(pool);
    const c = collect();
    const deps = {
      authedUser: async () => (whoami ? (PEOPLE[whoami] ?? null) : null),
      isAdmin: async () => false,
      getPool: () => pool,
      overLimit: async () => limited,
      members: { byId: async (id: string) => PEOPLE[id] ?? null },
      notify,
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }] },
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
      seasonState: () => ({ current: null, seasons: [], timezone: "UTC" }),
    } as any;
    registerRoom(c.app, deps);
    registerTensions(c.app, deps);
    handlers = c.handlers;

    await q("INSERT INTO `circles` (`id`, `name`, `aliases`, `is_example`) VALUES ('c-garden', 'Garden circle', '[]', 0), ('c-new', 'New circle', '[]', 0)");
    // The water role, held by Cai and Gil; the compost role in a circle that never met, held by Gil.
    await q(
      "INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES " +
        "('seat-water', 'c-garden', 'Water keeper', 1, 0), ('seat-compost', 'c-new', 'Compost keeper', 1, 0), ('seat-empty', 'c-garden', 'Bee keeper', 1, 0)",
    );
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', NULL), ('ora-gil', 'seat-water', 'member', 'm-gil', 'm-gil', NULL), " +
        "('ora-gil2', 'seat-compost', 'member', 'm-gil', 'm-gil', NULL)",
    );
    // The garden circle met once: Ana and Ben, closed.
    const opened = await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 1", circleId: "c-garden", durationMin: 45 } });
    closed = Number(opened.body.id);
    expect((await as("m-ben", "POST /api/sessions/:id/join", { params: { id: String(closed) } })).status).toBe(200);
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: { id: String(closed) } })).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    limited = false;
    notices.length = 0;
  });

  it("a visitor is asked to sign in and a guest is refused, before anything is written", async () => {
    expect(await raise(null, "seat-water", "The water rota names nobody for Sundays.")).toEqual({ status: 401, body: { error: TENSION_REFUSALS.signIn } });
    expect(await raise("g-gus", "seat-water", "The water rota names nobody for Sundays.")).toEqual({ status: 403, body: { error: TENSION_REFUSALS.membersOnly } });
    expect(await q("SELECT `id` FROM `role_tensions`")).toEqual([]);
    // A guest reads no counts and may not raise.
    expect(await read("g-gus", "seat-water")).toEqual({ mayRaise: false, open: 0, answered: 0, tensions: [] });
    expect(await read(null, "seat-water")).toEqual({ mayRaise: false, open: 0, answered: 0, tensions: [] });
  });

  it("refuses empty, long and payment-shaped words, a role nobody holds, and the hourly bound", async () => {
    expect(await raise("m-ana", "seat-water", "   ")).toEqual({ status: 400, body: { error: TENSION_REFUSALS.textEmpty } });
    expect(await raise("m-ana", "seat-water", "x".repeat(601))).toEqual({ status: 400, body: { error: TENSION_REFUSALS.textLong } });
    expect(await raise("m-ana", "seat-water", "Pay me at 4111 1111 1111 1111 please")).toEqual({ status: 400, body: { error: TENSION_REFUSALS.paymentDetails } });
    expect(await raise("m-ana", "seat-nope", "Words")).toEqual({ status: 404, body: { error: TENSION_REFUSALS.noRole } });
    expect(await raise("m-ana", "seat-empty", "Nobody keeps the bees.")).toEqual({ status: 409, body: { error: TENSION_REFUSALS.noHolders } });
    limited = true;
    expect(await raise("m-ana", "seat-water", "The water rota names nobody for Sundays.")).toEqual({ status: 429, body: { error: TENSION_REFUSALS.tooMany } });
    limited = false;
    expect(await q("SELECT `id` FROM `role_tensions`")).toEqual([]);
    // Exactly 600 characters is allowed. The control for the 601 above.
    const full = await raise("m-dee", "seat-compost", "y".repeat(600));
    expect(full.status, JSON.stringify(full.body)).toBe(201);
    await q("DELETE FROM `role_tensions`");
  });

  let raised = "";

  it("raises one, and every live holder hears once in the bell, never the raiser", async () => {
    const out = await raise("m-ana", "seat-water", "The water rota leaves Sundays to whoever notices.");
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    raised = out.body.tension.id;
    expect(out.body.tension).toMatchObject({ roleId: "seat-water", status: "open", mine: true, text: "The water rota leaves Sundays to whoever notices." });
    expect(notices.map((n) => n.userId).sort()).toEqual(["m-cai", "m-gil"]);
    expect(notices.every((n) => n.type === "role_tension_raised" && n.title === TENSION_COPY.noticeTitle("Water keeper"))).toBe(true);
    // The notice never carries the words, nor who raised them.
    expect(JSON.stringify(notices)).not.toContain("Sundays");
    expect(notices.every((n) => n.actorUserId === null)).toBe(true);
    const rows = await q("SELECT `user_id` FROM `notifications` WHERE `type` = 'role_tension_raised' AND `dedupe_key` LIKE ? ORDER BY `user_id`", [`rt:${raised}:%`]);
    expect(rows.map((r: any) => r.user_id)).toEqual(["m-cai", "m-gil"]);
  });

  it("shows the words to the raiser and the holders, and a count to a stranger member", async () => {
    const stranger = await read("m-dee", "seat-water");
    expect(stranger).toEqual({ mayRaise: true, open: 1, answered: 0, tensions: [] });
    const raiser = await read("m-ana", "seat-water");
    expect(raiser.tensions).toHaveLength(1);
    expect(raiser.tensions[0]).toMatchObject({ id: raised, mine: true, text: "The water rota leaves Sundays to whoever notices." });
    const holder = await read("m-cai", "seat-water");
    expect(holder.tensions[0]).toMatchObject({ id: raised, mine: false });
    expect(JSON.stringify(holder)).not.toContain("m-ana");

    // The card's feed agrees, and gives a guest nothing at all.
    const forDee = (await tensionsForRoles(pool, ["seat-water"], { userId: "m-dee", member: true })).get("seat-water");
    expect(forDee).toEqual({ open: 1, answered: 0, broughtToCircle: 0, tensions: [{ id: raised, status: "open", raisedBy: "", text: "", broughtToCircle: false }] });
    const forAna = (await tensionsForRoles(pool, ["seat-water"], { userId: "m-ana", member: true })).get("seat-water");
    expect(forAna?.tensions[0]).toMatchObject({ raisedBy: "m-ana", text: "The water rota leaves Sundays to whoever notices." });
    const forCai = (await tensionsForRoles(pool, ["seat-water"], { userId: "m-cai", member: true })).get("seat-water");
    // The holder reads the words, and never the raiser's id.
    expect(forCai?.tensions[0]).toMatchObject({ raisedBy: "", text: "The water rota leaves Sundays to whoever notices." });
    expect((await tensionsForRoles(pool, ["seat-water"], { userId: "g-gus", member: false })).size).toBe(0);
  });

  it("lists it for the holders on their own read, and for nobody else", async () => {
    const cai = await as("m-cai", `GET ${MY_TENSIONS_URL}`);
    expect(cai.status).toBe(200);
    expect(cai.body.tensions).toEqual([
      expect.objectContaining({ id: raised, role: "Water keeper", circle: "Garden circle", status: "open", overdue: false }),
    ]);
    expect((await as("m-dee", `GET ${MY_TENSIONS_URL}`)).body.tensions).toEqual([]);
    expect((await as("g-gus", `GET ${MY_TENSIONS_URL}`)).status).toBe(403);
  });

  it("refuses a member who does not hold the role, and tells them nothing about the tension", async () => {
    expect(await respond("m-dee", raised, { action: "answer" })).toEqual({ status: 403, body: { error: TENSION_REFUSALS.notHolder } });
    expect(await respond("m-ana", raised, { action: "take" })).toEqual({ status: 403, body: { error: TENSION_REFUSALS.notHolder } });
    // Even a nonsense body gets the holder refusal first.
    expect(await respond("m-dee", raised, { action: "dance" })).toEqual({ status: 403, body: { error: TENSION_REFUSALS.notHolder } });
    expect((await q("SELECT `status` FROM `role_tensions` WHERE `id` = ?", [raised]))[0].status).toBe("open");
  });

  it("lets a holder take it once, then answer it: the words stay private and the card counts it", async () => {
    expect(await respond("m-cai", raised, { action: "fly" })).toEqual({ status: 400, body: { error: TENSION_REFUSALS.badAction } });
    const took = await respond("m-cai", raised, { action: "take" });
    expect(took.status, JSON.stringify(took.body)).toBe(200);
    expect(took.body.tension.status).toBe("taken");
    expect(await respond("m-gil", raised, { action: "take" })).toEqual({ status: 409, body: { error: TENSION_REFUSALS.alreadyTaken } });
    expect(await respond("m-gil", raised, { action: "answer", note: "z".repeat(301) })).toEqual({ status: 400, body: { error: TENSION_REFUSALS.noteLong } });
    const answered = await respond("m-gil", raised, { action: "answer", note: "Sundays are mine from next week." });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect(answered.body.tension).toMatchObject({ status: "answered", answerNote: "Sundays are mine from next week." });
    expect(await respond("m-cai", raised, { action: "answer" })).toEqual({ status: 409, body: { error: TENSION_REFUSALS.alreadyAnswered } });

    expect(await read("m-dee", "seat-water")).toEqual({ mayRaise: true, open: 0, answered: 1, tensions: [] });
    expect((await read("m-ana", "seat-water")).tensions[0]).toMatchObject({ id: raised, status: "answered" });
    // Off the holders' Waiting on you.
    expect((await as("m-cai", `GET ${MY_TENSIONS_URL}`)).body.tensions).toEqual([]);
  });

  it("brings it to the circle: a backlog entry the next room offers, and the words public to members", async () => {
    const out = await respond("m-cai", raised, { action: "bring_to_circle" });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.tension.status).toBe("brought_to_circle");
    const [row] = await q("SELECT `circle_entry_id` FROM `role_tensions` WHERE `id` = ?", [raised]);
    const entries = await q("SELECT `session_id`, `kind`, `status`, `text` FROM `live_session_entries` WHERE `id` = ?", [row.circle_entry_id]);
    expect(entries).toEqual([{ session_id: closed, kind: "tension", status: "open", text: "The water rota leaves Sundays to whoever notices." }]);
    // Brought once: a second bring is refused.
    expect(await respond("m-gil", raised, { action: "bring_to_circle" })).toEqual({ status: 409, body: { error: TENSION_REFUSALS.alreadyAnswered } });

    // The words are now every member's, and still nobody else's.
    const dee = await read("m-dee", "seat-water");
    expect(dee.tensions).toEqual([expect.objectContaining({ id: raised, status: "brought_to_circle", mine: false, text: "The water rota leaves Sundays to whoever notices." })]);
    expect((await tensionsForRoles(pool, ["seat-water"], { userId: "m-dee", member: true })).get("seat-water")).toMatchObject({
      answered: 1,
      broughtToCircle: 1,
      tensions: [{ status: "answered", broughtToCircle: true, raisedBy: "", text: "The water rota leaves Sundays to whoever notices." }],
    });
    expect((await read("g-gus", "seat-water")).tensions).toEqual([]);

    // The circle's next session carries it, under "From last time".
    const next = await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 2", circleId: "c-garden", durationMin: 45 } });
    expect(next.status, JSON.stringify(next.body)).toBeLessThan(300);
    const view = await as("m-ana", "GET /api/sessions/:id", { params: { id: String(next.body.id) } });
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.carried?.backlog?.map((e: any) => [e.kind, e.text])).toContainEqual(["tension", "The water rota leaves Sundays to whoever notices."]);
  });

  it("refuses a bring to a circle that has never met, with a sentence", async () => {
    const out = await raise("m-ana", "seat-compost", "The compost bays smell by the kitchen.");
    expect(out.status).toBe(201);
    expect(await respond("m-gil", out.body.tension.id, { action: "bring_to_circle" })).toEqual({ status: 409, body: { error: TENSION_REFUSALS.circleNotMet } });
    expect((await q("SELECT `status` FROM `role_tensions` WHERE `id` = ?", [out.body.tension.id]))[0].status).toBe("open");
  });

  it("reminds each holder once after 2 business days, never before, never twice", async () => {
    const out = await raise("m-dee", "seat-water", "The hose by the gate leaks.");
    const id = out.body.tension.id;
    // The tensions the cases above raised move past this case's clock, so only this one is aged.
    await q("UPDATE `role_tensions` SET `created_at` = ? WHERE `id` <> ?", [new Date("2026-12-01T10:00:00Z"), id]);
    // Raised on Friday 2026-10-16 at 10:00 UTC.
    await q("UPDATE `role_tensions` SET `created_at` = ? WHERE `id` = ?", [new Date("2026-10-16T10:00:00Z"), id]);
    notices.length = 0;
    const tz = () => "UTC";
    // Monday 10:00 is one business day on: nothing.
    expect(await remindTensionHolders({ pool, notify, timeZone: tz }, new Date("2026-10-19T10:00:00Z"))).toBe(0);
    // Tuesday 09:59 is a minute short of two.
    expect(await remindTensionHolders({ pool, notify, timeZone: tz }, new Date("2026-10-20T09:59:00Z"))).toBe(0);
    // Tuesday 10:00: Cai and Gil hear, and the raiser does not.
    expect(await remindTensionHolders({ pool, notify, timeZone: tz }, new Date("2026-10-20T10:00:00Z"))).toBe(2);
    await remindTensionHolders({ pool, notify, timeZone: tz }, new Date("2026-10-21T10:00:00Z"));
    const rows = await q("SELECT `user_id`, `title` FROM `notifications` WHERE `type` = 'role_tension_reminder' ORDER BY `user_id`");
    expect(rows.map((r: any) => r.user_id)).toEqual(["m-cai", "m-gil"]);
    expect(rows[0].title).toBe(TENSION_COPY.reminderTitle("Water keeper"));
    expect(rows[0].title).toContain("2 business days");
    // The holder's row says so too.
    const cai = await as("m-cai", `GET ${MY_TENSIONS_URL}`);
    expect(cai.body.tensions.find((t: any) => t.id === id)?.overdue).toBe(true);
    // A taken tension is nobody's reminder.
    expect((await respond("m-cai", id, { action: "take" })).status).toBe(200);
    await q("DELETE FROM `notifications` WHERE `type` = 'role_tension_reminder'");
    expect(await remindTensionHolders({ pool, notify, timeZone: tz }, new Date("2026-10-28T10:00:00Z"))).toBe(0);
  });

  it("erasure takes the raiser off, clears unanswered words, and keeps answered ones", async () => {
    const open = (await raise("m-ana", "seat-water", "Ben keeps forgetting the tap.")).body.tension.id;
    await forgetRoleTensionsFor(pool, "m-ana");
    const rows = await q("SELECT `id`, `raised_by`, `text`, `status` FROM `role_tensions` WHERE `id` IN (?, ?) ORDER BY `status`", [open, raised]);
    const byId = new Map(rows.map((r: any) => [r.id, r]));
    expect(byId.get(open)).toMatchObject({ raised_by: null, text: "", status: "open" });
    expect(byId.get(raised)).toMatchObject({ raised_by: null, text: "The water rota leaves Sundays to whoever notices.", status: "brought_to_circle" });
    // A cleared tension leaves the holders' rows: there is nothing to read.
    expect((await as("m-cai", `GET ${MY_TENSIONS_URL}`)).body.tensions.map((t: any) => t.id)).not.toContain(open);
    // Cai brought it with no note, so the note and its author stayed Gil's.
    const [before] = await q("SELECT `answered_by`, `answer_note` FROM `role_tensions` WHERE `id` = ?", [raised]);
    expect(before).toEqual({ answered_by: "m-gil", answer_note: "Sundays are mine from next week." });
    await forgetRoleTensionsFor(pool, "m-cai");
    expect((await q("SELECT `answered_by` FROM `role_tensions` WHERE `id` = ?", [raised]))[0].answered_by).toBe("m-gil");
    // The answerer comes off, with their note.
    await forgetRoleTensionsFor(pool, "m-gil");
    const [gone] = await q("SELECT `answered_by`, `answer_note` FROM `role_tensions` WHERE `id` = ?", [raised]);
    expect(gone).toEqual({ answered_by: null, answer_note: null });
  });
});

describe("the reminder line is two business days on the village's clock", () => {
  it("counts Monday to Friday only", () => {
    const friday = new Date("2026-10-16T10:00:00Z");
    expect(isOverdue(friday, new Date("2026-10-19T23:59:00Z"), "UTC")).toBe(false);
    expect(isOverdue(friday, new Date("2026-10-20T10:00:00Z"), "UTC")).toBe(true);
    // A Saturday start counts from Monday 00:00, so Wednesday 00:00 is the line.
    const saturday = new Date("2026-10-17T15:00:00Z");
    expect(isOverdue(saturday, new Date("2026-10-20T23:59:00Z"), "UTC")).toBe(false);
    expect(isOverdue(saturday, new Date("2026-10-21T00:00:00Z"), "UTC")).toBe(true);
  });
});
