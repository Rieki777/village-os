/**
 * The task emails and the gentle notes against a real schema: a circle's call
 * closes, each person holding a task gets one email listing their tasks, the
 * facilitator presses Send the task emails, and the hourly job writes near a
 * task's date.
 *
 * The post office is the real one (server/lib/comms/postOffice.ts) with a
 * provider that only records, so every email lands as a row in
 * `comms_messages` under its idempotency key, and a second post under the
 * same key comes back `duplicate` from the ledger itself. The notices go
 * through the real notification spine (`insertNotification`), so the job's
 * dedupe keys are held by the `notifications` table.
 *
 * WHAT THIS PROVES:
 *   - one email per person per send, their own tasks and their seats' together
 *   - the keys are `session-tasks:<session>:<user>:<send>`; the same send run
 *     again sends nothing new to anybody, and a press takes the next number
 *   - task emails off, daily or every email off are skipped and counted
 *   - a seat nobody sits in tells the admins and the facilitator
 *   - kind `notices`, origin `sessions.tasks`, and counts with no address
 *   - the close answers before its emails are posted
 *   - the job's two marks each fire once across runs, and nothing else fires
 *
 * The board and the answers are server/sessionTasks.db.test.ts.
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { usersRepo } from "./repos/users";
import { addEntry, closeSession, ensureMemberNo, joinSession, patchEntry, startSession } from "./lib/liveSessions";
import { insertNotification, type NotifyDeps } from "./lib/notify";
import type { CommsMode, PostOfficeDeps } from "./lib/comms/postOffice";
import type { Transport } from "./lib/comms/transport";
import { queueCloseMail, reserveSend, runTaskNotes, sendTaskEmails, type TaskMailDeps } from "./lib/sessionTaskMail";
import { register as registerRoom } from "./routes/liveSessions";
import { addCivilDays } from "../shared/sessionTasks";

const configured = testDbConfigured();
const ORIGIN = "https://village.example.test";
const LIVE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };
const LAPSE = { currentSeasonId: null, cadence: "never" };

/** The people. Prefs are the stored blob `resolveNotifyPrefs` reads. */
const PEOPLE: { id: string; name: string; prefs: Record<string, unknown> }[] = [
  { id: "tm-ana", name: "Ana Reyes", prefs: {} },
  { id: "tm-ben", name: "Ben Ortiz", prefs: {} },
  { id: "tm-cai", name: "Cai Moreno", prefs: {} },
  { id: "tm-dee", name: "Dee Lund", prefs: { notify: { emailsOff: true } } },
  { id: "tm-eve", name: "Eve Strand", prefs: { notify: { tasksEmail: "daily" } } },
  { id: "tm-fay", name: "Fay Moss", prefs: { notify: { tasksEmail: "off" } } },
  { id: "tm-gus", name: "Gus Hale", prefs: {} },
];
const emailOf = (id: string) => `${id}@village.example.test`;

describe.skipIf(!configured)("the task emails against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the scratch schema this suite provisioned, never a production table

  /** What the provider was handed. `post` only queues, so this stays empty unless a send is urgent. */
  const handed: unknown[] = [];
  const transport: Transport = {
    name: "resend",
    async send(m) {
      handed.push(m);
      return { ok: true, providerId: `prov_${handed.length}` };
    },
  };
  /**
   * The post office's own pool, which a case can make wait. Only `post` reads
   * it, so a hold here stops the emails and nothing else a close does.
   */
  let holdPost: Promise<void> | null = null;
  const postPool = () =>
    new Proxy(pool, {
      get(target, key) {
        const v = (target as any)[key];
        if (key !== "query" && key !== "execute") return typeof v === "function" ? v.bind(target) : v;
        return async (...args: unknown[]) => {
          if (holdPost) await holdPost;
          return v.apply(target, args);
        };
      },
    });
  const office = (): PostOfficeDeps => ({
    getPool: postPool,
    transport,
    sender: () => "Test Village <hello@village.example.test>",
    hasApiKey: () => true,
    origin: () => ORIGIN,
    mode: async () => LIVE,
    dial: (k) => (k === "comms.send_rate_per_second" ? 50 : k === "comms.daily_cap" ? 50 : 120),
  });

  const immediate: unknown[] = [];
  const spine = (): NotifyDeps => ({
    pool,
    memberById: async (id: string) => usersRepo(pool).byId(id),
    sendEmail: async (opts: any) => {
      immediate.push(opts);
      return { status: "queued" } as any;
    },
    origin: () => ORIGIN,
    projectName: () => "Test Village",
    isPresent: (m: any) => Boolean(m),
  });

  const notices: any[] = [];
  const toAdmins: [string, string, string, string | undefined][] = [];
  const deps = (): TaskMailDeps => ({
    getPool: () => pool,
    commsPostOffice: office(),
    notifyDeps: spine(),
    notify: async (n: any) => {
      notices.push(n);
      return insertNotification(spine(), n);
    },
    notifyAdmins: async (type: string, title: string, key: string, link?: string) => {
      toAdmins.push([type, title, key, link]);
    },
    lapseContext: () => LAPSE,
    deploymentOrigin: () => ORIGIN,
    projectName: () => "Test Village",
  });

  const taskMail = () => q("SELECT `idempotency_key`, `kind`, `origin`, `to_email`, `user_id`, `subject`, `body_text` FROM `comms_messages` WHERE `origin` = 'sessions.tasks' ORDER BY `idempotency_key`");
  const keysOf = (rows: any[]) => rows.map((r) => String(r.idempotency_key)).sort();

  const no: Record<string, number> = {};
  const actor = (id: string) => ({ no: no[id], admin: false });
  const ctx = { lookup: async (id: string) => usersRepo(pool).byId(id), circleName: () => "Garden circle" };

  let sid = 0;
  let bees = 0;

  /** One action, written by `writer` (the facilitator, Ana, unless named) and claimed by `holder` (or held by a seat). */
  const action = async (session: number, text: string, opts: { holder?: string; seat?: string; dueOn?: string; writer?: string } = {}): Promise<number> => {
    const out = await addEntry(pool, session, actor(opts.writer ?? "tm-ana"), { kind: "action", text, ownerSeatId: opts.seat, dueOn: opts.dueOn });
    if (!out.ok) throw new Error(`the fixture could not write "${text}": ${out.error}`);
    if (opts.holder) {
      const claimed = await patchEntry(pool, session, actor(opts.holder), out.value.id, { claim: true });
      if (!claimed.ok) throw new Error(`the fixture could not claim "${text}": ${claimed.error}`);
    }
    return out.value.id;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    for (const p of PEOPLE) {
      await usersRepo(pool).add({ id: p.id, name: p.name, email: emailOf(p.id), passwordHash: "x", paths: [], prefs: p.prefs } as any);
      no[p.id] = await ensureMemberNo(pool, p.id);
    }
    // Ben and Cai sit in the water seat. Nobody sits in the bee seat.
    await q(
      "INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES " +
        "('tm-seat-water', 'c-garden', 'Water keeper', 1, 0), ('tm-seat-bees', 'c-garden', 'Bee keeper', 1, 0)",
    );
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('tm-ora-ben', 'tm-seat-water', 'member', 'tm-ben', 'tm-ben', NULL), ('tm-ora-cai', 'tm-seat-water', 'member', 'tm-cai', 'tm-cai', NULL)",
    );

    // Garden circle, week 1. Ana facilitates; Ben, Dee, Eve and Fay are in the
    // room; Cai sits in the water seat and never joined.
    sid = await startSession(pool, no["tm-ana"], { title: "Garden circle, week 1", circleId: "c-garden", durationMin: 45 });
    for (const id of ["tm-ben", "tm-dee", "tm-eve", "tm-fay"]) expect((await joinSession(pool, sid, no[id])).ok).toBe(true);
    await action(sid, "Order the seed", { holder: "tm-ana" });
    await action(sid, "Mend the fence", { holder: "tm-ben", dueOn: "2099-03-01" });
    await action(sid, "Fix the tap", { holder: "tm-ben" });
    await action(sid, "Fix the water tank", { seat: "tm-seat-water" });
    bees = await action(sid, "Feed the bees", { seat: "tm-seat-bees" });
    await action(sid, "Sweep the shed", { holder: "tm-dee" });
    await action(sid, "Turn the compost", { holder: "tm-eve" });
    await action(sid, "Oil the hinges", { holder: "tm-fay" });
    const closed = await closeSession(pool, sid, actor("tm-ana"), ctx);
    expect(closed.ok, "the fixture must close").toBe(true);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("sends one email per person at close, their own tasks and their seats' together, and skips the ones who said no", async () => {
    const out = await queueCloseMail(deps(), sid);
    expect(out).toEqual({ sendNo: 1, people: 6, queued: 3, skipped: { emails_off: 1, pref_daily: 1, pref_off: 1 } });

    const rows = await taskMail();
    expect(keysOf(rows)).toEqual(["tm-ana", "tm-ben", "tm-cai"].map((u) => `session-tasks:${sid}:${u}:1`).sort());
    for (const r of rows) expect(r).toMatchObject({ kind: "notices", origin: "sessions.tasks", to_email: emailOf(String(r.user_id)) });
    // Nobody who said no has a row.
    expect(rows.some((r: any) => ["tm-dee", "tm-eve", "tm-fay"].includes(String(r.user_id)))).toBe(false);

    // Ben's one email carries both of his and the one his seat holds.
    const ben = rows.find((r: any) => r.user_id === "tm-ben");
    expect(ben.subject).toBe("Your tasks from Garden circle, week 1");
    for (const text of ["Mend the fence", "Fix the tap", "Fix the water tank", "Water keeper"]) expect(ben.body_text).toContain(text);
    expect(ben.body_text).toContain(`${ORIGIN}/sessions/${sid}`);
    // Cai was never in the room: the seat opening, and no link to the record.
    const cai = rows.find((r: any) => r.user_id === "tm-cai");
    expect(cai.body_text).toContain("Fix the water tank");
    expect(cai.body_text).not.toContain("Mend the fence");
    expect(cai.body_text).not.toContain(`/sessions/${sid}`);
    expect(cai.body_text).toContain(`${ORIGIN}/profile#my-tasks`);
    // The emails wait for the drain; nothing went to the provider inside the call.
    expect(handed).toEqual([]);
  });

  it("tells the admins and the facilitator about a task whose seat nobody sits in", () => {
    expect(toAdmins).toEqual([["session_task_unheld", expect.stringContaining("Bee keeper"), `session-task-unheld:${bees}:1`, `/sessions/${sid}`]]);
    expect(notices.filter((n) => n.type === "session_task_unheld")).toEqual([
      expect.objectContaining({ userId: "tm-ana", dedupeKey: `session-task-unheld:${bees}:1:tm-ana`, link: `/sessions/${sid}` }),
    ]);
    // Its email cadence is the digest: nothing went out immediately.
    expect(immediate).toEqual([]);
  });

  it("writes the counts on the send's row, numbers by reason and never an address", async () => {
    const [send] = await q("SELECT `send_no`, `sent_by_no`, `counts` FROM `live_session_task_sends` WHERE `session_id` = ?", [sid]);
    expect(send).toMatchObject({ send_no: 1, sent_by_no: 0 });
    expect(JSON.parse(send.counts)).toEqual({ people: 6, queued: 3, skipped: { emails_off: 1, pref_daily: 1, pref_off: 1 } });
    expect(send.counts).not.toContain("@");
  });

  it("sends nothing new when the close's send runs again, or the same send is posted twice", async () => {
    // A second close-time start finds number 1 taken.
    expect(await queueCloseMail(deps(), sid)).toBeNull();
    // The same send posted again: every email is already in the ledger under its key.
    const again = await sendTaskEmails(deps(), sid, { sendNo: 1, sentByNo: 0 });
    expect(again).toEqual({ sendNo: 1, people: 6, queued: 0, skipped: { duplicate: 3, emails_off: 1, pref_daily: 1, pref_off: 1 } });
    expect(await taskMail()).toHaveLength(3);
    expect(JSON.stringify(again)).not.toContain("@");
  });

  it("takes the next number on a press, so the emails go again, with who asked for them", async () => {
    const sendNo = await reserveSend(pool, sid, no["tm-ana"]);
    expect(sendNo).toBe(2);
    const out = await sendTaskEmails(deps(), sid, { sendNo, sentByNo: no["tm-ana"] });
    expect(out).toMatchObject({ sendNo: 2, people: 6, queued: 3 });
    const rows = await taskMail();
    expect(keysOf(rows)).toEqual(
      ["tm-ana", "tm-ben", "tm-cai"].flatMap((u) => [1, 2].map((n) => `session-tasks:${sid}:${u}:${n}`)).sort(),
    );
    const ben = rows.find((r: any) => r.idempotency_key === `session-tasks:${sid}:tm-ben:2`);
    expect(ben.body_text).toContain("Ana asked for this list to go out again");
    // The same press posted twice is still one email each.
    const twice = await sendTaskEmails(deps(), sid, { sendNo, sentByNo: no["tm-ana"] });
    expect(twice).toMatchObject({ queued: 0, skipped: expect.objectContaining({ duplicate: 3 }) });
    expect(await taskMail()).toHaveLength(6);
    // The admins hear about the empty seat once per send.
    expect(toAdmins.map((a) => a[2])).toEqual([`session-task-unheld:${bees}:1`, `session-task-unheld:${bees}:1`, `session-task-unheld:${bees}:2`, `session-task-unheld:${bees}:2`]);
    expect(await q("SELECT COUNT(*) AS `n` FROM `notifications` WHERE `type` = 'session_task_unheld'")).toEqual([{ n: 2 }]);
  });

  it("gives two presses at once a number each", async () => {
    const [a, b] = await Promise.all([reserveSend(pool, sid, no["tm-ana"]), reserveSend(pool, sid, no["tm-ana"])]);
    expect([a, b].sort()).toEqual([3, 4]);
  });

  it("lists only the open tasks on a press", async () => {
    await q("UPDATE `live_session_task_state` SET `status` = 'done' WHERE `session_id` = ? AND `owner_no` = ?", [sid, no["tm-ana"]]);
    const sendNo = await reserveSend(pool, sid, no["tm-ben"]);
    const out = await sendTaskEmails(deps(), sid, { sendNo, sentByNo: no["tm-ben"] });
    // Ana's only task is done, so she is not among the people this time.
    expect(out).toMatchObject({ people: 5, queued: 2 });
    expect((await taskMail()).some((r: any) => r.idempotency_key === `session-tasks:${sid}:tm-ana:${sendNo}`)).toBe(false);
  });

  it("answers the close before its emails are posted", async () => {
    let release: () => void = () => undefined;
    holdPost = new Promise<void>((r) => {
      release = r;
    });
    const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
    const app: any = { use: () => undefined };
    for (const m of ["get", "post", "put", "patch", "delete"]) app[m] = (p: string, h: any) => handlers.set(`${m.toUpperCase()} ${p}`, h);
    const people = Object.fromEntries(PEOPLE.map((p) => [p.id, { id: p.id, name: p.name, membershipGranted: true }]));
    registerRoom(app, {
      authedUser: async () => people["tm-gus"],
      isAdmin: async () => false,
      overLimit: async () => false,
      members: { byId: async (id: string) => people[id] ?? null },
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }] },
      ...deps(),
    } as any);
    const room = await startSession(pool, no["tm-gus"], { title: "Garden circle, week 2", circleId: "c-garden", durationMin: 45 });
    await action(room, "Stake the beans", { holder: "tm-gus", writer: "tm-gus" });
    const out: { status: number; body: unknown } = { status: 200, body: null };
    const res: any = {
      status: (c: number) => ((out.status = c), res),
      json: (b: unknown) => ((out.body = b), res),
      setHeader: () => undefined,
    };
    /** Ask `check` every 50ms for up to five seconds. */
    const eventually = async (check: () => Promise<boolean>): Promise<boolean> => {
      for (let i = 0; i < 100; i++) {
        if (await check()) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    try {
      // A close that waited for its emails would still be waiting here.
      const closing = handlers.get("POST /api/sessions/:id/close")!({ params: { id: String(room) }, body: {}, query: {}, headers: {} }, res);
      const answered = await Promise.race([Promise.resolve(closing).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
      expect(answered, "the close answers without waiting for its emails").toBe(true);
      expect(out).toEqual({ status: 200, body: { ok: true } });
      // The close answered while its send was still on the way: the send takes
      // its number, and then waits on the post office.
      const taken = await eventually(async () => (await q("SELECT 1 FROM `live_session_task_sends` WHERE `session_id` = ? AND `send_no` = 1", [room])).length === 1);
      expect(taken, "the close starts its send").toBe(true);
      expect((await taskMail()).some((r: any) => String(r.idempotency_key).startsWith(`session-tasks:${room}:`))).toBe(false);
    } finally {
      release();
      holdPost = null;
    }
    const posted = await eventually(async () => (await taskMail()).some((r: any) => r.idempotency_key === `session-tasks:${room}:tm-gus:1`));
    expect(posted, "the close's email lands once the post office answers").toBe(true);
  });

  describe("the gentle notes", () => {
    /** Today in the village (UTC in a suite), at ten in the morning. */
    const morning = (() => {
      const d = new Date();
      d.setUTCHours(10, 0, 0, 0);
      return d;
    })();
    const today = morning.toISOString().slice(0, 10);
    const noteDeps = (over: Record<string, unknown> = {}) => ({ ...deps(), lifecycle: () => "members" as const, window: () => ({ start: 8, end: 20 }), ...over });
    const dueNotes = () => q("SELECT `user_id`, `dedupe_key`, `title` FROM `notifications` WHERE `type` = 'session_action_due' ORDER BY `dedupe_key`");
    const noteMail = () => q("SELECT `idempotency_key` FROM `comms_messages` WHERE `idempotency_key` LIKE 'session-due:%' ORDER BY `idempotency_key`");

    let soon = 0;
    let late = 0;
    let seatSoon = 0;

    beforeAll(async () => {
      const s = await startSession(pool, no["tm-ana"], { title: "Garden circle, week 3", circleId: "c-garden", durationMin: 45 });
      expect((await joinSession(pool, s, no["tm-ben"])).ok).toBe(true);
      expect((await joinSession(pool, s, no["tm-eve"])).ok).toBe(true);
      soon = await action(s, "Book the trailer", { holder: "tm-ben", dueOn: addCivilDays(today, 2) });
      late = await action(s, "Return the ladder", { holder: "tm-eve", dueOn: addCivilDays(today, -1) });
      seatSoon = await action(s, "Clean the filter", { seat: "tm-seat-water", dueOn: addCivilDays(today, 2) });
      await action(s, "Plan the harvest", { holder: "tm-ben", dueOn: addCivilDays(today, 1) });
      await action(s, "Paint the gate", { holder: "tm-ben" });
      const done = await action(s, "Fill the trough", { holder: "tm-ben", dueOn: addCivilDays(today, 2) });
      expect((await closeSession(pool, s, actor("tm-ana"), ctx)).ok).toBe(true);
      await q("UPDATE `live_session_task_state` SET `status` = 'done' WHERE `entry_id` = ?", [done]);
    });

    it("does nothing with the module off, or outside the village's daytime window", async () => {
      expect(await runTaskNotes(noteDeps({ lifecycle: () => "off" }), morning)).toBe("the sessions module is off");
      expect(await runTaskNotes(noteDeps({ window: () => ({ start: 11, end: 20 }) }), morning)).toBe("outside the village's daytime window");
      expect(await dueNotes()).toEqual([]);
    });

    it("writes once two days before and once the morning after, to whoever holds it now, across runs", async () => {
      await runTaskNotes(noteDeps(), morning);
      await runTaskNotes(noteDeps(), new Date(morning.getTime() + 60 * 60 * 1000));
      const keys = [
        `session-due:${soon}:tm-ben:${addCivilDays(today, 2)}:before`,
        `session-due:${seatSoon}:tm-ben:${addCivilDays(today, 2)}:before`,
        `session-due:${seatSoon}:tm-cai:${addCivilDays(today, 2)}:before`,
        `session-due:${late}:tm-eve:${addCivilDays(today, -1)}:after`,
      ].sort();
      // One notice per task, person and mark: no undated task, no task a day
      // away, and nothing for the one that is done.
      expect((await dueNotes()).map((r: any) => r.dedupe_key).sort()).toEqual(keys);
      // The email goes to the immediate people only: Eve reads hers in the digest.
      expect((await noteMail()).map((r: any) => r.idempotency_key).sort()).toEqual(keys.filter((k) => !k.includes(":tm-eve:")));
      const [before] = (await dueNotes()).filter((r: any) => r.dedupe_key.startsWith(`session-due:${soon}:`));
      expect(before.title).toMatch(/^Coming up \w+: Book the trailer$/);
      // Each notice and each note opens that one task on the board.
      const links = await q("SELECT `dedupe_key`, `link` FROM `notifications` WHERE `type` = 'session_action_due'");
      for (const r of links) expect(r.link, r.dedupe_key).toBe(`/profile#task-${String(r.dedupe_key).split(":")[1]}`);
      const [benMail] = await q("SELECT `body_text` FROM `comms_messages` WHERE `idempotency_key` = ?", [`session-due:${soon}:tm-ben:${addCivilDays(today, 2)}:before`]);
      expect(benMail.body_text).toContain(`${ORIGIN}/profile#task-${soon}`);
      // Immediate reads "off" for this notice, so the spine sent no second email.
      expect(immediate).toEqual([]);
    });

    it("writes again for a new date, and not for a date already written about", async () => {
      await q("UPDATE `live_session_task_state` SET `due_on` = ? WHERE `entry_id` = ?", [addCivilDays(today, 2), late]);
      await runTaskNotes(noteDeps(), morning);
      const keys = (await dueNotes()).map((r: any) => r.dedupe_key);
      expect(keys).toContain(`session-due:${late}:tm-eve:${addCivilDays(today, 2)}:before`);
      expect(keys).toHaveLength(5);
    });
  });
});
