/**
 * Messaging over HTTP: the module gate and the 404 posture.
 *
 * `server/messaging.test.ts` proves the repo layer by calling it directly.
 * That leaves the part an attacker actually meets untested: the route guards
 * in `server/index.ts`. The property this file exists to pin is a single
 * sentence, and it is the one worth breaking a build over:
 *
 *   a conversation id in a URL proves nothing, and the refusal is
 *   indistinguishable from a miss.
 *
 * Which means all four of these answer with the SAME body:
 *   - the module is off;
 *   - the conversation does not exist;
 *   - the conversation exists and you were never in it;
 *   - the conversation exists and you left it.
 *
 * The strongest case here is the FOUNDER, who is an admin and passes every
 * capability gate, reading a thread they are not a member of. Admin is not a
 * key to other people's private conversations, and this proves it.
 *
 * Boots the BUILT server, like loop.e2e and examples.routes.e2e. The cases
 * run in order (off, then on, then off again) because the module lifecycle is
 * itself under test; run the whole file, never a `-t` slice. Skips loudly
 * without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[messaging.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/**
 * Provably clear of the other two boot-a-server suites, so all three can share
 * one vitest run. loop.e2e holds 3781-5780 and examples.routes holds 6100-7599;
 * this window starts above both. The first draft used 6700 + (pid % 700),
 * which lands on examples.routes' port for about 7% of process ids: a flake
 * that would have shown up as an unrelated boot timeout a few runs from now.
 */
const PORT = 20802 + (process.pid % 300);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "messaging-routes-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";
let anaToken = "";
let anaId = "";
let benToken = "";
let benId = "";
/** Deliberately never advanced: the capability refusal needs a fresh member. */
let caraToken = "";

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: "MessagingTest123!", paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** The one shape every refusal shares. Nothing here may name the thread. */
function expectHidden(r: { status: number; json: any }, what: string): void {
  expect(r.status, `${what} must answer 404`).toBe(404);
  expect(r.json?.error, `${what} must not describe what it refused`).toBe("Not found");
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the messaging route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-messaging-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 });

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "messaging-routes-token-secret",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call(
    "POST",
    "/api/admin/bootstrap",
    { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Messaging Founder" },
    "",
  );
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "MessagingTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const ana = await register("Ana Ruiz", "ana");
  anaToken = ana.token;
  anaId = ana.id;
  const ben = await register("Ben Cole", "ben");
  benToken = ben.token;
  benId = ben.id;
  const cara = await register("Cara Diaz", "cara");
  caraToken = cara.token;
  // NO local hook budget: inherit the global 600s from vitest.config.ts.
  //
  // This hook used to say 180_000, which broke the config's own stated rule
  // (`hookTimeout > provisioning + the boot deadline`) and made this file the
  // only one of six e2e suites below the floor. Measured here on 2026-08-11
  // against the hosted MySQL:
  //
  //     migrations     71 files
  //     provisioning   118.9s      (1.67s per file, up from the config's 1.25s)
  //     boot deadline  E2E_BOOT_DEADLINE_MS (180s then; 120s now, and the wait
  //                    itself moved to waitForHealth in ./db/e2eBoot.ts)
  //     worst case     298.9s      against the global 600s hook budget
  //
  // Provisioning ALONE was 66% of the old budget, so the hook could expire
  // before the server was even started. CI never caught it because CI runs
  // MySQL as a local service container where provisioning is fast; it only
  // failed against the hosted database, which is the reverse of the usual
  // asymmetry and means green CI could not protect this file.
  //
  // Inheriting rather than picking a bigger number is deliberate. Provisioning
  // grows with the migration count and never shrinks, so any figure written
  // here is a future timeout with a date on it. The global is one place to
  // raise, and it carries the arithmetic.
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("messaging routes: the gate and the 404 posture", () => {
  it("serves nothing at all while the module is off, even to the founder", async () => {
    // Absent module_settings row = off. This runs FIRST, before the enable
    // below, so it proves the shipped default rather than a state this file
    // arranged for itself.
    const inbox = await call("GET", "/api/messages");
    expect(inbox.status).toBe(404);
    expect(inbox.json?.error).toBe("module_disabled");
    expect(inbox.json?.module).toBe("messaging");

    const thread = await call("GET", "/api/messages/cnv-anything");
    expect(thread.status).toBe(404);
    expect(thread.json?.error).toBe("module_disabled");
  });

  it("turns on as a deliberate admin act", async () => {
    const on = await call("PUT", "/api/admin/modules/messaging/lifecycle", { lifecycle: "public" });
    expect(on.status).toBe(200);
    const inbox = await call("GET", "/api/messages");
    expect(inbox.status).toBe(200);
    expect(Array.isArray(inbox.json?.conversations)).toBe(true);
  });

  it("holds writing behind the one capability gate, and reading behind none", async () => {
    // Cara just registered, so she sits below the member stage and does not
    // hold message.send. She may still READ her own (empty) inbox: taking
    // away someone's ability to see what was sent TO them is a different and
    // harsher act than suspending their ability to write.
    expect((await call("GET", "/api/messages", undefined, caraToken)).status).toBe(200);
    const refused = await call("POST", "/api/messages/direct", { userId: benId }, caraToken);
    expect(refused.status, "a member below the stage cannot start a conversation").toBe(403);
    expect((await call("POST", "/api/messages/groups", { name: "Nope", memberIds: [benId] }, caraToken)).status).toBe(403);

    // Ana and Ben are moved to the member stage so the rest of this file can
    // exercise the surface as ordinary members rather than as the admin.
    for (const id of [anaId, benId]) {
      const granted = await call("PUT", `/api/admin/players/${id}/stage`, { stageId: "member" });
      expect(granted.status, "an admin can grant a stage").toBe(200);
    }
    expect((await call("GET", "/api/messages", undefined, anaToken)).status).toBe(200);
  });

  it("hides a thread from someone who was never in it, admin included", async () => {
    const made = await call("POST", "/api/messages/groups", { name: "Private crew", memberIds: [anaId, benId] });
    expect(made.status, "the founder can start a conversation").toBe(200);
    const id = String(made.json?.id);

    // Positive control: while the founder IS a member, the thread reads.
    const asMember = await call("GET", `/api/messages/${id}`);
    expect(asMember.status).toBe(200);
    expect(asMember.json?.name).toBe("Private crew");

    // The founder steps out. They are still an admin, and the thread still
    // exists, and neither fact is a key to it.
    expect((await call("POST", `/api/messages/${id}/leave`)).status).toBe(200);
    expectHidden(await call("GET", `/api/messages/${id}`), "a thread the founder left");

    // A conversation id that never existed answers identically, so comparing
    // the two responses tells an attacker nothing.
    expectHidden(await call("GET", "/api/messages/cnv-never-existed"), "a conversation that does not exist");

    // And it is genuinely still there for the people actually in it: without
    // this the case above would pass against a deleted row.
    const stillThere = await call("GET", `/api/messages/${id}`, undefined, anaToken);
    expect(stillThere.status, "a member still reads the thread").toBe(200);
    expect(stillThere.json?.name).toBe("Private crew");
  });

  it("refuses every write on a thread the caller is not in, with the same 404", async () => {
    const made = await call("POST", "/api/messages/groups", { name: "Closed room", memberIds: [benId] }, anaToken);
    expect(made.status, "Ana can start her own conversation").toBe(200);
    const id = String(made.json?.id);

    // The founder is an admin who was never invited to this one.
    expectHidden(await call("POST", `/api/messages/${id}/messages`, { body: "let me in" }), "sending into a closed thread");
    expectHidden(await call("POST", `/api/messages/${id}/read`, { seq: 1 }), "marking a closed thread read");
    expectHidden(await call("PATCH", `/api/messages/${id}`, { muted: true }), "muting a closed thread");
    expectHidden(await call("POST", `/api/messages/${id}/leave`), "leaving a closed thread");
    expectHidden(await call("POST", `/api/messages/${id}/members`, { userIds: [benId] }), "adding to a closed thread");
    expectHidden(await call("DELETE", `/api/messages/${id}/members/${anaId}`), "removing from a closed thread");
    expectHidden(await call("POST", `/api/messages/${id}/owner`, { userId: benId }), "taking a closed thread over");
  });

  it("edits a line, marks it, and refuses everyone who is not its author", async () => {
    const room = await call("POST", "/api/messages/groups", { name: "Edit room", memberIds: [benId] }, anaToken);
    const id = String(room.json?.id);
    const line = await call("POST", `/api/messages/${id}/messages`, { body: "teh meeting is at 4" }, anaToken);
    const messageId = String(line.json?.id);

    // The founder is an admin and a non-member: same 404 as everything else.
    expectHidden(
      await call("PATCH", `/api/messages/${id}/messages/${messageId}`, { body: "rewritten" }),
      "editing inside a thread the caller is not in",
    );

    const ok = await call("PATCH", `/api/messages/${id}/messages/${messageId}`, { body: "the meeting is at 4" }, anaToken);
    expect(ok.status, "the author can edit their own line").toBe(200);

    const read = await call("GET", `/api/messages/${id}`, undefined, anaToken);
    const edited = read.json?.messages?.find((m: any) => m.id === messageId);
    expect(edited?.body).toBe("the meeting is at 4");
    expect(edited?.editedAt, "the edit marker must reach the client").toBeTruthy();

    // An empty body is a refusal, not a silent delete.
    expect((await call("PATCH", `/api/messages/${id}/messages/${messageId}`, { body: "   " }, anaToken)).status).toBe(400);
  });

  it("will not delete a line in one conversation through membership of another", async () => {
    // The security review's finding, over HTTP. Proving membership of thread
    // B must not authorize a destructive write against thread A, or the
    // membership check on the URL is decorative and a removed member can
    // still erase the messages a report was filed about.
    const roomA = await call("POST", "/api/messages/groups", { name: "Room A", memberIds: [benId] }, anaToken);
    const idA = String(roomA.json?.id);
    const line = await call("POST", `/api/messages/${idA}/messages`, { body: "on the record" }, anaToken);
    const messageId = String(line.json?.id);

    const roomB = await call("POST", "/api/messages/groups", { name: "Room B", memberIds: [benId] }, anaToken);
    const idB = String(roomB.json?.id);

    // Ana authored the line and is a member of both rooms. The id still has
    // to belong to the conversation in the URL.
    //
    // 404 without expectHidden: this route answers "No message of yours with
    // that id", which is deliberate and safe. The caller has already proven
    // membership of the conversation in the URL, and the body is identical
    // whether the id belongs to another thread or to nothing at all, so it
    // separates nothing an attacker could use. What matters is the status and
    // the line surviving.
    const refused = await call("DELETE", `/api/messages/${idB}/messages/${messageId}`, undefined, anaToken);
    expect(refused.status, "deleting a line that lives in another conversation").toBe(404);

    const stillThere = await call("GET", `/api/messages/${idA}`, undefined, anaToken);
    expect(stillThere.json?.messages?.at(-1)?.body).toBe("on the record");
    expect(stillThere.json?.messages?.at(-1)?.deleted).toBe(false);
  });

  it("carries a message end to end, and counts it once", async () => {
    const opened = await call("POST", "/api/messages/direct", { userId: benId }, anaToken);
    expect(opened.status, "Ana can open a direct thread with Ben").toBe(200);
    const id = String(opened.json?.id);

    const sent = await call("POST", `/api/messages/${id}/messages`, { body: "are you at the meeting?" }, anaToken);
    expect(sent.status).toBe(200);
    expect(Number(sent.json?.seq)).toBeGreaterThan(0);

    const read = await call("GET", `/api/messages/${id}`, undefined, anaToken);
    expect(read.status).toBe(200);
    expect(read.json?.messages?.at(-1)?.body).toBe("are you at the meeting?");
    // Writing is reading: Ana's own line is not waiting for her.
    const inbox = await call("GET", "/api/messages", undefined, anaToken);
    expect(inbox.json?.unreadTotal).toBe(0);
  });

  it("opens the same direct thread however many times either side asks", async () => {
    const first = await call("POST", "/api/messages/direct", { userId: benId }, anaToken);
    const again = await call("POST", "/api/messages/direct", { userId: benId }, anaToken);
    expect(again.json?.id).toBe(first.json?.id);
  });

  it("refuses to open a conversation with yourself or with nobody", async () => {
    expect((await call("POST", "/api/messages/direct", { userId: anaId }, anaToken)).status).toBe(400);
    expect((await call("POST", "/api/messages/direct", { userId: "usr-not-real" }, anaToken)).status).toBe(404);
    expect((await call("POST", "/api/messages/groups", { name: "", memberIds: [benId] }, anaToken)).status).toBe(400);
    expect((await call("POST", "/api/messages/groups", { name: "Alone", memberIds: [] }, anaToken)).status).toBe(400);
  });

  it("asks anonymous callers to sign in and never shows them an inbox", async () => {
    const anon = await call("GET", "/api/messages", undefined, "");
    expect(anon.status).toBe(401);
    expect(anon.json?.conversations).toBeUndefined();
  });

  it("needs two characters before it will search for people", async () => {
    expect((await call("GET", "/api/messages/people?q=a", undefined, anaToken)).json).toEqual([]);
    const found = await call("GET", "/api/messages/people?q=ben", undefined, anaToken);
    expect(found.status).toBe(200);
    expect(found.json?.[0]?.userId).toBe(benId);
    // A search never returns the searcher to themselves.
    expect((found.json ?? []).some((p: any) => p.userId === anaId)).toBe(false);
  });

  it("goes back to serving nothing the moment it is switched off", async () => {
    const off = await call("PUT", "/api/admin/modules/messaging/lifecycle", { lifecycle: "off" });
    // Messaging holds no value, so nothing blocks the switch. This is the
    // openStateCheck decision, asserted rather than only written down.
    expect(off.status, "messaging may be disabled freely: it holds no outstanding value").toBe(200);

    const inbox = await call("GET", "/api/messages", undefined, anaToken);
    expect(inbox.status).toBe(404);
    expect(inbox.json?.error).toBe("module_disabled");

    // Switched back on, the conversations are all still there: off hides a
    // surface, it never deletes history.
    expect((await call("PUT", "/api/admin/modules/messaging/lifecycle", { lifecycle: "public" })).status).toBe(200);
    const back = await call("GET", "/api/messages", undefined, anaToken);
    expect(back.status).toBe(200);
    expect(back.json?.conversations?.length).toBeGreaterThan(0);
  });

  /**
   * A REPORT ON A PRIVATE MESSAGE REACHES A HUMAN.
   *
   * The flag button, the store, the queue and the resolution have all existed
   * since messaging shipped, and the last two had no caller in the client: a
   * member reporting harassment got a success path into nothing. This pins the
   * whole run, end to end, and pins the two limits the Admin queue is built
   * around, because a later change that widened either of them would make the
   * surface show a moderator more of a private conversation than the report is
   * about.
   */
  it("carries a report on a private message to a moderator and back", async () => {
    const opened = await call("POST", "/api/messages/direct", { userId: benId }, anaToken);
    expect(opened.status).toBe(200);
    const id = String(opened.json?.id);

    const line = await call("POST", `/api/messages/${id}/messages`, { body: "you should not be here" }, benToken);
    expect(line.status, "Ben can write in his own direct thread").toBe(200);
    const messageId = String(line.json?.id);

    const flagged = await call(
      "POST",
      `/api/messages/${id}/messages/${messageId}/report`,
      { reason: "This has happened three times now." },
      anaToken,
    );
    expect(flagged.status).toBe(200);
    expect(flagged.json?.fresh, "the first flag is a new report").toBe(true);
    // Once per person per message. The second press is accepted and stores
    // nothing, so a member pressing twice never doubles the queue.
    const twice = await call(
      "POST",
      `/api/messages/${id}/messages/${messageId}/report`,
      { reason: "still happening" },
      anaToken,
    );
    expect(twice.status).toBe(200);
    expect(twice.json?.fresh).toBe(false);

    // The queue is admin only. A member who can read the conversation still
    // cannot read the moderation view of it.
    expect((await call("GET", "/api/admin/messages/reports", undefined, anaToken)).status).toBe(401);

    const queue = await call("GET", "/api/admin/messages/reports");
    expect(queue.status).toBe(200);
    const mine = (queue.json ?? []).filter((r: any) => r.messageId === messageId);
    expect(mine, "one report, however many times it was pressed").toHaveLength(1);
    const report = mine[0];
    expect(report.body).toBe("you should not be here");
    expect(report.reason).toBe("This has happened three times now.");
    expect(report.reporter).toBe("Ana Ruiz");
    expect(report.status).toBe("open");
    expect(report.conversationKind).toBe("direct");
    expect(report.deleted).toBe(false);

    // THE TWO LIMITS THE ADMIN QUEUE IS BUILT AROUND.
    //
    // The author is an id and never a name, and the payload carries no other
    // line from the thread. A moderator judges the reported message, and a
    // private conversation stays private around it. Asserting the SHAPE, so
    // a later widening of the payload fails here and gets argued about.
    expect(report.authorId).toBe(benId);
    expect(Object.keys(report).sort()).toEqual([
      "at", "authorId", "body", "conversationId", "conversationKind", "conversationName",
      "deleted", "id", "messageId", "reason", "reporter", "resolvedAt", "resolvedBy", "status",
    ]);
    // Open, so nobody has closed it and the queue says so.
    expect(report.resolvedBy).toBeNull();
    expect(report.resolvedAt).toBeNull();

    /*
     * THE REPORT RANG SOMEBODY. This is the half that was missing: the row
     * landed in the queue and no human was told it existed, so time to first
     * look was however often an admin happened to open the panel.
     */
    const adminInbox = await call("GET", "/api/notifications");
    const alerts = (adminInbox.json?.notifications ?? []).filter((n: any) => n.type === "moderation");
    expect(alerts, "the admin hears once, however many times the flag was pressed").toHaveLength(1);
    expect(alerts[0].link, "and it lands on the queue, not the admin front door").toBe("/admin?tab=message-reports");
    /*
     * THE PRIVACY LINE. A notification is read on a lock screen, so the alert
     * carries the fact of a report and nothing else: not the reported words,
     * not the author, not the reporter, not the thread. Asserted against the
     * WHOLE row, so a later "helpful" body or actor stamp fails here.
     */
    const said = `${alerts[0].title} ${alerts[0].body ?? ""}`;
    for (const leak of ["you should not be here", "This has happened three times now.", "Ana", "Ruiz", "Ben", "Cole", id]) {
      expect(said, `the alert must not carry ${leak}`).not.toContain(leak);
    }
    expect(alerts[0].body, "no body at all is the safest body").toBeNull();
    expect(alerts[0].actorUserId, "and the reporter is not stamped on it either").toBeNull();
    // A direct thread has no name to carry, which is what keeps the queue
    // from printing the two people in it.
    expect(report.conversationName).toBeNull();

    // Resolving: admin only, one of two words, and exactly once.
    expect((await call("PUT", `/api/admin/messages/reports/${report.id}`, { status: "resolved" }, anaToken)).status).toBe(401);
    expect((await call("PUT", `/api/admin/messages/reports/${report.id}`, { status: "ignored" })).status).toBe(400);
    expect((await call("PUT", `/api/admin/messages/reports/${report.id}`, { status: "resolved" })).status).toBe(200);
    // Pressed again it finds no OPEN report and says so. The queue hides its
    // buttons on a handled card for exactly this reason.
    expect((await call("PUT", `/api/admin/messages/reports/${report.id}`, { status: "resolved" })).status).toBe(404);

    const open = await call("GET", "/api/admin/messages/reports?status=open");
    expect((open.json ?? []).some((r: any) => r.id === report.id)).toBe(false);
    const resolved = await call("GET", "/api/admin/messages/reports?status=resolved");
    const closed = (resolved.json ?? []).find((r: any) => r.id === report.id);
    expect(closed, "a handled report moves tabs, it does not vanish").toBeTruthy();
    // Written on every close since the queue shipped and read by nobody. The
    // founder resolved this one, so the queue can name them.
    expect(closed.resolvedBy).toBe("Messaging Founder");
    expect(Date.parse(closed.resolvedAt), "and when").toBeGreaterThan(0);

    /*
     * AND THE LOOP CLOSES WHERE IT STARTED. Ana reported; Ana is told it was
     * reviewed. Before this the resolve route wrote three columns and
     * answered `{ success: true }` to the moderator alone.
     */
    const anaInbox = await call("GET", "/api/notifications", undefined, anaToken);
    const backToAna = (anaInbox.json?.notifications ?? []).filter((n: any) => n.type === "moderation");
    expect(backToAna, "the reporter hears exactly once").toHaveLength(1);
    expect(backToAna[0].title).toBe("Your report has been reviewed");
    expect(backToAna[0].link).toBe("/messages");
    /*
     * WHAT IT REFUSES TO TELL HER. A reporter learns that a human looked and
     * closed it. Whether the other member was warned, muted or found to have
     * done nothing wrong is a judgement about somebody else, and handing it
     * to the reporter turns a moderation queue into a verdict feed. The word
     * "dismissed" is as much a disclosure as "removed" is.
     */
    const toHer = `${backToAna[0].title} ${backToAna[0].body ?? ""}`.toLowerCase();
    for (const verdict of ["dismissed", "resolved", "removed", "warned", "ben", "cole"]) {
      expect(toHer, `the reporter must not be told "${verdict}"`).not.toContain(verdict);
    }

    // Ben, who wrote the reported line, is told nothing by this route at all.
    const benInbox = await call("GET", "/api/notifications", undefined, benToken);
    expect(
      (benInbox.json?.notifications ?? []).filter((n: any) => n.type === "moderation"),
      "being reported is not a notification the platform sends",
    ).toHaveLength(0);
    // An unknown status word reads as `open` instead of leaking another tab.
    const junk = await call("GET", "/api/admin/messages/reports?status=everything");
    expect((junk.json ?? []).some((r: any) => r.id === report.id)).toBe(false);
  });

  it("shows a moderator a tombstone when the author deleted the line first", async () => {
    // The race a moderation queue always loses: the author takes the message
    // down before anyone reads the report. The row survives, the body does
    // not, and the queue has to say which of the two happened.
    const opened = await call("POST", "/api/messages/direct", { userId: benId }, anaToken);
    const id = String(opened.json?.id);
    const line = await call("POST", `/api/messages/${id}/messages`, { body: "said in anger" }, benToken);
    const messageId = String(line.json?.id);
    expect((await call("POST", `/api/messages/${id}/messages/${messageId}/report`, { reason: "cruel" }, anaToken)).status).toBe(200);
    expect((await call("DELETE", `/api/messages/${id}/messages/${messageId}`, undefined, benToken)).status).toBe(200);

    const queue = await call("GET", "/api/admin/messages/reports");
    const report = (queue.json ?? []).find((r: any) => r.messageId === messageId);
    expect(report, "a report outlives the message it is about").toBeTruthy();
    expect(report.deleted).toBe(true);
    expect(report.body, "a tombstone carries no text").toBe("");
    expect(report.reason, "the reporter's words are all that is left").toBe("cruel");
  });
});
