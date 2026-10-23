/**
 * WHAT AN ERASED MEMBER STILL LEFT BEHIND, after the sweep ran (lane E2).
 *
 * Six findings from the adversarial round on the erasure flow, one block each.
 * Every block makes the same claim, about ROWS and never about a step having
 * run: something the member wrote, or something written about them in their
 * name, was readable by other people after the sweep finished.
 *
 *   8. A meet-me window ("Meet Wren", the place, the note) stayed on the
 *      public calendar, and the answers other members gave it stayed too.
 *   9. A notification that names the member to somebody else, written with no
 *      actor ("Wren Halloway has begun a departure" on every admin's bell),
 *      which the notifications step never matched, and the emailed copy of a
 *      notice, which nothing reached at all.
 *  10. The note a member wrote when they opened their own departure stayed on
 *      the exit record.
 *  11. An email that carried the member's words to somebody else kept its
 *      subject: the comms step only cleared the reply-to.
 *  17. A steward's check-in note about the member stayed on event_checkins,
 *      and a steward could still write one against the departed id.
 *  18. The address book's one-time backfill made contacts out of housing rows
 *      that belong to an erased member.
 *
 * EVERY COUNT HAS A NON-ZERO READING IN FRONT OF IT. A zero after the erasure
 * over a fixture that never landed would prove nothing, so each case reads the
 * leftover first, and each one carries a bystander whose rows of the same shape
 * must come through untouched: a sweep with a broken WHERE would pass every
 * assertion about the leaver and empty the village.
 *
 * A real database, for the reason `erasure.test.ts` gives: every claim here is
 * about rows. No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { createMeetMe } from "./calendarCommunity";
import { listCalendarItems } from "./calendar";
import { rsvp } from "./gatherings";
import { insertNotification, type NotifyDeps } from "./notify";
import { capturedSplit, createExit, exitById, sweepBalances, type ExitSplitPolicy } from "./exit";
import { loadTokenRegistry, memberAccount, MINT_FAUCET, postTransfer } from "./ledger";
import { CREDITS, checkIn, checkinCount } from "./economy";
import { ERASED_SUBJECT } from "../repos/commsPeople";
import { backfillContacts } from "./comms/backfill";
import { register as registerStays } from "../routes/stays";

const configured = testDbConfigured();
const VILLAGE = "local";
const DEPARTED = "A message from a departed member";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

/** The submissions a case hands the sweep, by member. Only the ids and owners matter here. */
let submissions: any[] = [];

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: (u: any) => void) => real.update(id, fn) },
    submissionsRepo: { all: () => submissions, replaceAll: async (rows: unknown[]) => void (submissions = rows as any[]) },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

async function person(id: string, name: string, email = `${id}@example.test`): Promise<void> {
  await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, name, email]);
}

async function erase(id: string): Promise<void> {
  const target = await usersRepo(pool).byId(id);
  expect(target, `${id} must exist before it is erased`).toBeTruthy();
  await anonymizeMember(pool, target, "e2-admin", deps());
  expect((await erasureRecord(pool, id))?.finishedAt, `${id}'s sweep must finish`).toBeTruthy();
}

/** The spine's own dependencies, minus email: nobody here has an address the test wants mailed. */
const notifyDeps = (): NotifyDeps =>
  ({
    get pool() {
      return pool;
    },
    memberById: async () => null,
    sendEmail: async () => ({ accepted: false, status: "skipped" }),
    isPresent: () => false,
    origin: () => "http://localhost",
    projectName: () => "Village",
  }) as unknown as NotifyDeps;

/** A notification row exactly as a producer writes it, read back by id. */
async function bell(input: { userId: string; type: string; title: string; body?: string | null; dedupeKey: string; actorUserId?: string | null }): Promise<string> {
  const r = await insertNotification(notifyDeps(), { link: "/admin", ...input });
  expect(r.fresh, `the bell row ${input.dedupeKey} must land`).toBe(true);
  return String(r.id);
}

/** A `comms_messages` row of the given shape. Every NOT NULL column is supplied. */
async function mail(row: {
  id: string;
  key: string;
  to: string;
  userId?: string | null;
  kind: string;
  origin: string;
  subject: string;
  bodyHtml?: string | null;
  replyTo?: string | null;
  createdAt?: string;
}): Promise<void> {
  await q(
    "INSERT INTO comms_messages (id, village_id, idempotency_key, user_id, to_email, email_key, kind, origin, subject, body_html, reply_to, status" +
      (row.createdAt ? ", created_at" : "") +
      ") VALUES (?,?,?,?,?,?,?,?,?,?,?,'sent'" +
      (row.createdAt ? ",?" : "") +
      ")",
    [
      row.id,
      VILLAGE,
      row.key,
      row.userId ?? null,
      row.to,
      row.to.toLowerCase(),
      row.kind,
      row.origin,
      row.subject,
      row.bodyHtml ?? null,
      row.replyTo ?? null,
      ...(row.createdAt ? [row.createdAt] : []),
    ],
  );
}

describe.skipIf(!configured)("what an erased member left behind after the sweep", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-leftovers-"));
    clearMemberDrivers();
    await loadTokenRegistry(pool);
    await person("e2-admin", "Avery Steward");
    await person("e2-steward", "Sam Steward");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  // ── 8 ─────────────────────────────────────────────────────────────────────
  describe("8: a meet-me window", () => {
    const window = () => {
      const starts = new Date(Date.now() + 26 * 3600 * 1000);
      return { startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 2 * 3600 * 1000).toISOString() };
    };
    const publicWindows = async () =>
      listCalendarItems(pool, {
        from: new Date(),
        to: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        viewer: { userId: null, isAdmin: false },
        timezone: "UTC",
        kinds: ["meet-me"],
      });

    it("goes with the member who opened it, with every answer given to it, and a neighbour's stays", async () => {
      const leaver = "e2-mm-wren";
      const neighbour = "e2-mm-bay";
      await person(leaver, "Wren Halloway");
      await person(neighbour, "Bay Holt");

      const mine = await createMeetMe(pool, {
        userId: leaver,
        firstName: "Wren Halloway",
        layer: "village",
        place: "the bakery on Calle 3",
        note: "come say hi, I'll be in the red jacket",
        ...window(),
      });
      const theirs = await createMeetMe(pool, { userId: neighbour, firstName: "Bay Holt", layer: "village", place: "the well", ...window() });
      expect(mine.ok && theirs.ok, "both windows must open").toBe(true);
      const mineId = (mine as { id: string }).id;
      const theirsId = (theirs as { id: string }).id;
      // Each answers the other's window, so the answers on both sides are real rows.
      expect((await rsvp(pool, mineId, neighbour, "going")).ok).toBe(true);
      expect((await rsvp(pool, theirsId, leaver, "going")).ok).toBe(true);

      // The control: a signed-out visitor reads both windows today, by first name, with the place.
      const before = await publicWindows();
      expect(before.map((i) => i.title).sort()).toEqual(["Meet Bay", "Meet Wren"]);
      expect(before.find((i) => i.title === "Meet Wren")?.locationText).toBe("the bakery on Calle 3");

      await erase(leaver);

      const after = await publicWindows();
      expect(after.map((i) => i.title), "no window of theirs is on the public calendar").toEqual(["Meet Bay"]);
      expect(await q("SELECT id FROM events WHERE kind = 'meet-me' AND (created_by = ? OR owner_user_id = ?)", [leaver, leaver])).toEqual([]);
      // The neighbour's answer to the window that went is not left pointing at nothing.
      expect(await q("SELECT id FROM event_rsvps WHERE event_id = ?", [mineId])).toEqual([]);
      // The neighbour's own window is the neighbour's and stays. The answer the leaver gave it is
      // their own place, which "event-places-after-tombstone" releases, so only the window is left.
      expect(await q("SELECT title, location_text FROM events WHERE id = ?", [theirsId])).toEqual([{ title: "Meet Bay", location_text: "the well" }]);
      expect(await q("SELECT user_id FROM event_rsvps WHERE event_id = ?", [theirsId])).toEqual([]);
    });
  });

  // ── 9 ─────────────────────────────────────────────────────────────────────
  describe("9: a notice that names the member to somebody else", () => {
    it("loses its words, old rows written with no actor included, and its emailed copies go blank", async () => {
      const leaver = "e2-ntf-wren";
      const bystander = "e2-ntf-bay";
      const admin = "e2-admin";
      await person(leaver, "Wren Halloway");
      await person(bystander, "Bay Holt");

      /*
       * Every family of producer that put a member's name in a bell row with
       * no actor, written the way the producer wrote it: the record the key
       * points at, then the row under the producer's key, suffixed per admin
       * the way notifyAdmins suffixes it. The bystander gets the same shapes,
       * so a match that is too wide shows up as a changed bystander row.
       */
      const familiesFor = async (who: string, name: string, tag: string): Promise<string[]> => {
        const first = name.split(" ")[0];
        const exit = await createExit(pool, { userId: who, kind: "voluntary", openedBy: who, noticeDays: 0 });
        if (!exit.ok) throw new Error(exit.error);
        await q("INSERT INTO stays (id, user_id, accommodation_id, status) VALUES (?,?,?,'requested')", [`stay-${tag}`, who, "acc-e2"]);
        await q("INSERT INTO library_loans (id, item_id, user_id) VALUES (?,?,?)", [`loan-${tag}`, "item-e2", who]);
        await q("INSERT INTO quest_claims (id, quest_id, quest_title, user_id, user_name) VALUES (?,?,?,?,?)", [`claim-${tag}`, "q-e2", "Mend the bench", who, name]);
        for (const [type, id] of [["role-application", `sub-ra-${tag}`], ["comms-change", `sub-cc-${tag}`], ["power-application", `sub-pa-${tag}`]]) {
          submissions.push({ id, type, userId: who, userName: name, data: {} });
        }
        return [
          await bell({ userId: admin, type: "exit_opened", title: `${name} has begun a departure`, dedupeKey: `exit:${exit.exit.id}:opened:${admin}` }),
          await bell({ userId: admin, type: "stays", title: `${name} requested a stay in Cabin`, dedupeKey: `stay:stay-${tag}:requested:${admin}` }),
          await bell({ userId: admin, type: "library", title: `${name} reserved Drill`, dedupeKey: `loan:loan-${tag}:reserved:${admin}` }),
          await bell({ userId: admin, type: "library", title: `${name} cancelled a reservation, the item is free again`, dedupeKey: `loan:loan-${tag}:cancelled:${admin}` }),
          await bell({ userId: admin, type: "library", title: `${name} returned an item, settle the loan`, dedupeKey: `loan:loan-${tag}:returned:${admin}` }),
          await bell({ userId: admin, type: "quest_help", title: `${first} is stuck on Mend the bench`, dedupeKey: `quest-confidence:claim-${tag}:stuck:${admin}` }),
          await bell({ userId: admin, type: "quest_submitted", title: `${first} submitted work on Mend the bench`, dedupeKey: `quest-submission:claim-${tag}:${admin}` }),
          await bell({ userId: admin, type: "submission", title: `${first} raised a hand for Treasurer`, dedupeKey: `role-application:sub-ra-${tag}:${admin}` }),
          await bell({ userId: admin, type: "submission", title: `${first} proposed a change to the village's email: Welcome`, dedupeKey: `comms-change:sub-cc-${tag}:${admin}` }),
          await bell({ userId: admin, type: "submission", title: `${first} raised a hand to hold the keys`, dedupeKey: `power-application:sub-pa-${tag}:${admin}` }),
          await bell({ userId: admin, type: "submission", title: `${first} asks to be confirmed as Treasurer`, dedupeKey: `seat-claim:org-treasurer:${who}:${admin}` }),
          // A send rings the person paid. The leaver pays the bystander; the bystander pays the admin, so no bystander row is addressed to the leaver.
          await bell({ userId: who === leaver ? bystander : admin, type: "wallet", title: `${name} sent you 5 Credits`, body: `for the soup, from ${first}`, dedupeKey: `send:${who}:nonce-${tag}` }),
        ];
      };
      const leaverRows = await familiesFor(leaver, "Wren Halloway", "w");
      const bystanderRows = await familiesFor(bystander, "Bay Holt", "b");
      // The shape every producer writes from now on: the member is the actor.
      leaverRows.push(await bell({ userId: admin, type: "library", title: "Wren Halloway reserved a Ladder", dedupeKey: `library-actor-shape:${admin}`, actorUserId: leaver }));

      // Two emailed copies of the leaver's rows and two of the bystander's.
      const [stuck] = await q("SELECT id, title FROM notifications WHERE dedupe_key = ?", [`quest-confidence:claim-w:stuck:${admin}`]);
      await mail({ id: "msg-ntf-imm-w", key: `notify:${stuck.id}`, to: "avery@example.test", userId: admin, kind: "notices", origin: "notify.immediate", subject: stuck.title, bodyHtml: `<h2>${stuck.title}</h2>` });
      const [sent] = await q("SELECT id, title, user_id FROM notifications WHERE dedupe_key = 'send:e2-ntf-wren:nonce-w'");
      await q("UPDATE notifications SET emailed_at = '2026-10-20 08:00:01' WHERE id = ?", [sent.id]);
      await mail({ id: "msg-ntf-dig-w", key: `digest:${sent.user_id}:2026-10-20`, to: "bay@example.test", userId: sent.user_id, kind: "notices", origin: "notify.digest", subject: sent.title, bodyHtml: `<li>${sent.title}</li>`, createdAt: "2026-10-20 08:00:01" });
      const [bayStuck] = await q("SELECT id, title FROM notifications WHERE dedupe_key = ?", [`quest-confidence:claim-b:stuck:${admin}`]);
      await mail({ id: "msg-ntf-imm-b", key: `notify:${bayStuck.id}`, to: "avery@example.test", userId: admin, kind: "notices", origin: "notify.immediate", subject: bayStuck.title, bodyHtml: `<h2>${bayStuck.title}</h2>` });
      // The recipient's digest of the day before carries somebody else's news and is not theirs to lose.
      await mail({ id: "msg-ntf-dig-b", key: `digest:${sent.user_id}:2026-10-19`, to: "bay@example.test", userId: sent.user_id, kind: "notices", origin: "notify.digest", subject: "Rowan sent you appreciation", bodyHtml: "<li>Rowan sent you appreciation</li>", createdAt: "2026-10-19 08:00:01" });

      const read = (ids: string[]) => q("SELECT id, title, body, actor_user_id FROM notifications WHERE id IN (?) ORDER BY id", [ids]);
      const named = await read(leaverRows);
      expect(named, "every family landed").toHaveLength(13);
      expect(named.every((r) => /wren/i.test(r.title)), "the control: each row names the leaver today").toBe(true);
      const bystanderBefore = await read(bystanderRows);
      const bystanderMailBefore = await q("SELECT id, subject, body_html FROM comms_messages WHERE id IN ('msg-ntf-imm-b', 'msg-ntf-dig-b') ORDER BY id");

      await erase(leaver);

      // Every one of them sits on somebody else's bell, so each stays as a row and loses its words.
      const survivors = await read(leaverRows);
      expect(survivors.length, "the rows on other people's bells stay, as rows").toBe(13);
      for (const row of survivors) {
        expect(row, `${row.id} must not name the leaver`).toEqual({ id: row.id, title: DEPARTED, body: null, actor_user_id: null });
      }
      expect(JSON.stringify(await q("SELECT title, body FROM notifications"))).not.toMatch(/wren/i);
      // The emailed copies: the subject and the words go, the row stays for the counts.
      expect(await q("SELECT id, subject, body_html, body_text FROM comms_messages WHERE id IN ('msg-ntf-imm-w', 'msg-ntf-dig-w') ORDER BY id")).toEqual([
        { id: "msg-ntf-dig-w", subject: ERASED_SUBJECT, body_html: null, body_text: null },
        { id: "msg-ntf-imm-w", subject: ERASED_SUBJECT, body_html: null, body_text: null },
      ]);
      // The bystander, exactly as they were.
      expect(await read(bystanderRows)).toEqual(bystanderBefore);
      expect(await q("SELECT id, subject, body_html FROM comms_messages WHERE id IN ('msg-ntf-imm-b', 'msg-ntf-dig-b') ORDER BY id")).toEqual(bystanderMailBefore);
    });

    it("is written with the member as its actor by a route module's producer", async () => {
      const leaver = "e2-ntf-stay-wren";
      const admin = "e2-admin";
      await person(leaver, "Wren Halloway");
      await q("INSERT INTO accommodations (id, name) VALUES ('acc-e2-cabin', 'Cabin')");

      // notifyAdmins exactly as server/index.ts builds it: one row per admin, the key suffixed, the actor passed through.
      const notifyAdmins = async (type: string, title: string, dedupeKey: string, link = "/admin", _except: readonly string[] = [], opts: { actorUserId?: string | null } = {}) => {
        await insertNotification(notifyDeps(), { userId: admin, type, title, link, dedupeKey: `${dedupeKey}:${admin}`, actorUserId: opts.actorUserId ?? null });
      };
      const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
      const keep = (method: string) => (p: string, h: any) => void handlers.set(`${method} ${p}`, h);
      registerStays({ get: keep("GET"), post: keep("POST"), put: keep("PUT"), delete: keep("DELETE"), use: () => {} } as any, {
        adminActor: () => null,
        authedUser: async () => ({ id: leaver, name: "Wren Halloway", email: `${leaver}@example.test` }),
        capabilityCtx: async () => ({ stageIndex: 0, stageIndexOf: () => 0, roleCapabilities: ["stay.member_rate"] }),
        isAdmin: async () => false,
        members: { byId: async () => null },
        notify: async () => ({ fresh: false }),
        notifyAdmins,
        notifyDeps: { origin: () => "http://localhost" },
        overLimit: async () => false,
        questsRepo: { all: async () => [] },
        stayPostingHooks: () => ({ onLowBalance: async () => {}, onStopped: async () => {} }),
        getPool: () => pool,
      } as any);
      const out: { status: number; body: any } = { status: 200, body: null };
      const res: any = { status: (c: number) => ((out.status = c), res), json: (b: unknown) => ((out.body = b), res) };
      await handlers.get("POST /api/stays/request")!({ body: { accommodationId: "acc-e2-cabin" } }, res);
      expect(out.status, JSON.stringify(out.body)).toBe(200);

      const [row] = await q("SELECT title, actor_user_id FROM notifications WHERE dedupe_key = ?", [`stay:${out.body.id}:requested:${admin}`]);
      expect(row.title).toBe("Wren Halloway requested a stay in Cabin");
      expect(row.actor_user_id, "the admin's row records whose request it is").toBe(leaver);

      await erase(leaver);
      expect((await q("SELECT title FROM notifications WHERE dedupe_key = ?", [`stay:${out.body.id}:requested:${admin}`]))[0].title).toBe(DEPARTED);
    });
  });

  // ── 10 ────────────────────────────────────────────────────────────────────
  describe("10: the note a member wrote when they opened their own departure", () => {
    const keepNothing: ExitSplitPolicy = {
      keepPct: { credit: 0, voice: 0, recognition: 0, equity: 0 },
      remainderAccount: "settlement",
      coolingDays: 0,
      voiceOnExit: "forfeit",
      voiceConvertRate: "0",
    };

    it("goes, and the record of leaving and the split of record stay byte for byte", async () => {
      const leaver = "e2-exit-wren";
      await person(leaver, "Wren Halloway");

      // A departure a steward opened and the village then cancelled, with the steward's grounds on it.
      const steward = await createExit(pool, { userId: leaver, kind: "involuntary", openedBy: "e2-steward", noticeDays: 0, note: "Grounds: three missed repair meetings" });
      if (!steward.ok) throw new Error(steward.error);
      await q("UPDATE exits SET status = 'cancelled', resolved_at = NOW() WHERE id = ?", [steward.exit.id]);

      // Their own departure, with their own words, then settled the way the settle route settles it.
      const own = await createExit(pool, { userId: leaver, kind: "voluntary", openedBy: leaver, noticeDays: 0, note: "Leaving because of how Sam treated me in the kitchen circle" });
      if (!own.ok) throw new Error(own.error);
      const seeded = await postTransfer(pool, { from: MINT_FAUCET, to: memberAccount(leaver), tokenType: CREDITS, amount: 1200, source: "test_seed", idempotencyKey: "e2-exit-seed" });
      expect(seeded.ok, "the leaver must hold a balance, or the sweep writes no split of record").toBe(true);
      const swept = await sweepBalances(pool, { exitId: own.exit.id, userId: leaver, policy: keepNothing });
      expect(swept.refusal).toBeNull();
      await q("UPDATE exits SET status = 'settling', resolution = CONCAT(COALESCE(resolution,''), ?) WHERE id = ?", [swept.note, own.exit.id]);

      const before = (await exitById(pool, own.exit.id))!;
      expect(before.resolution, "the control: the note is on the record today").toContain("Sam");
      const split = capturedSplit(before.resolution);
      expect(split, "the control: the sweep wrote a split of record").not.toBeNull();
      const machineLines = String(before.resolution).split("\n").filter((l) => /^\[\d{4}-\d{2}-\d{2}\] /.test(l));
      expect(machineLines.length).toBeGreaterThanOrEqual(2);

      await erase(leaver);

      const after = (await exitById(pool, own.exit.id))!;
      expect(after.resolution, "their words do not outlive them").not.toContain("Sam");
      expect(after.resolution).not.toContain("kitchen");
      for (const line of machineLines) expect(after.resolution, "every line the sweep wrote stays").toContain(line);
      expect(capturedSplit(after.resolution)).toEqual(split);
      expect({ kind: after.kind, status: after.status, openedAt: after.openedAt, openedBy: after.openedBy }).toEqual({
        kind: before.kind,
        status: before.status,
        openedAt: before.openedAt,
        openedBy: before.openedBy,
      });

      // A second sweep finds nothing left to change, byte for byte.
      await erase(leaver);
      expect((await exitById(pool, own.exit.id))!.resolution).toBe(after.resolution);
    });
  });

  // ── 11 ────────────────────────────────────────────────────────────────────
  describe("11: an email that carried the member's words to somebody else", () => {
    it("loses its subject with the reply-to, including a housing alert sent under an address they typed", async () => {
      const leaver = "e2-mail-wren";
      const email = "Wren.Mail@Example.test";
      const typed = "wren.elsewhere@example.test";
      await person(leaver, "Wren Halloway", email);
      // A housing request they made while signed in, under a second address they typed into the form.
      await q("INSERT INTO housing_reservations (id, village_id, home_type, name, email, user_id) VALUES ('hr-e2-w', ?, 'cabin', 'Wren Halloway', ?, ?)", [VILLAGE, typed.toUpperCase(), leaver]);

      // Both are essential mail, which never stores its words: what is left is the subject and the reply-to.
      await mail({ id: "msg-relay-w", key: "essential:relay-w", to: "rowan@example.test", kind: "essential", origin: "map.contact_relay", subject: "[Village] Wren wants to connect", replyTo: email });
      await mail({ id: "msg-alert-w", key: "essential:alert-w", to: "resident@village.test", kind: "essential", origin: "housing.team_alert", subject: "[Village] Home reservation request from Wren Halloway", replyTo: email });
      await mail({ id: "msg-alert-typed-w", key: "essential:alert-typed-w", to: "resident@village.test", kind: "essential", origin: "housing.team_alert", subject: "[Village] Home reservation request from Wren H", replyTo: typed });
      // A neighbour's relay and alert, the control.
      await mail({ id: "msg-relay-b", key: "essential:relay-b", to: "rowan@example.test", kind: "essential", origin: "map.contact_relay", subject: "[Village] Bay wants to connect", replyTo: "bay.mail@example.test" });
      await mail({ id: "msg-alert-b", key: "essential:alert-b", to: "resident@village.test", kind: "essential", origin: "housing.team_alert", subject: "[Village] Home reservation request from Bay Holt", replyTo: "bay.mail@example.test" });
      const neighbourBefore = await q("SELECT id, subject, reply_to FROM comms_messages WHERE id IN ('msg-relay-b', 'msg-alert-b') ORDER BY id");

      const ids = ["msg-relay-w", "msg-alert-w", "msg-alert-typed-w"];
      const readMine = () => q("SELECT id, to_email, subject, reply_to FROM comms_messages WHERE id IN (?) ORDER BY id", [ids]);
      expect((await readMine()).every((r) => /wren/i.test(r.subject)), "the control: every subject names them today").toBe(true);

      await erase(leaver);

      expect(await readMine()).toEqual([
        { id: "msg-alert-typed-w", to_email: "resident@village.test", subject: ERASED_SUBJECT, reply_to: null },
        { id: "msg-alert-w", to_email: "resident@village.test", subject: ERASED_SUBJECT, reply_to: null },
        { id: "msg-relay-w", to_email: "rowan@example.test", subject: ERASED_SUBJECT, reply_to: null },
      ]);
      expect(await q("SELECT id, subject, reply_to FROM comms_messages WHERE id IN ('msg-relay-b', 'msg-alert-b') ORDER BY id")).toEqual(neighbourBefore);
    });

    it("loses its words when it was the emailed copy of a notice the member caused", async () => {
      const leaver = "e2-mail-relay-wren";
      const recipient = "e2-mail-rowan";
      await person(leaver, "Wren Halloway");
      await person(recipient, "Rowan Field");
      // The contact relay's bell, as the relay route writes it, and the copy the spine emails at once.
      const id = await bell({ userId: recipient, type: "contact_request", title: "Wren wants to connect", body: "my number is 555-0100, call after six", dedupeKey: "contact:e2-cr-1", actorUserId: leaver });
      await mail({ id: "msg-contact-copy", key: `notify:${id}`, to: "rowan@example.test", userId: recipient, kind: "notices", origin: "notify.immediate", subject: "Wren wants to connect", bodyHtml: "<h2>Wren wants to connect</h2><p>my number is 555-0100, call after six</p>" });
      expect((await q("SELECT body_html FROM comms_messages WHERE id = 'msg-contact-copy'"))[0].body_html, "the control").toContain("555-0100");

      await erase(leaver);

      expect(await q("SELECT to_email, subject, body_html, body_text FROM comms_messages WHERE id = 'msg-contact-copy'")).toEqual([
        { to_email: "rowan@example.test", subject: ERASED_SUBJECT, body_html: null, body_text: null },
      ]);
      expect(await q("SELECT title, body FROM notifications WHERE id = ?", [id])).toEqual([{ title: DEPARTED, body: null }]);
    });
  });

  // ── 17 ────────────────────────────────────────────────────────────────────
  describe("17: a steward's check-in note about the member", () => {
    it("is cleared, the attendance stays, a note the member wrote about somebody else stays, and no new one can land", async () => {
      const leaver = "e2-chk-wren";
      const bystander = "e2-chk-bay";
      await person(leaver, "Wren Halloway");
      await person(bystander, "Bay Holt");
      expect((await checkIn(pool, { eventId: "ev-e2-build", userId: leaver, confirmedBy: "e2-steward", note: "came with her daughter, needs step-free access" })).ok).toBe(true);
      // The leaver, as a steward, checked somebody else in: that note is about the bystander.
      expect((await checkIn(pool, { eventId: "ev-e2-build", userId: bystander, confirmedBy: leaver, note: "brought the long ladder" })).ok).toBe(true);
      expect((await q("SELECT note FROM event_checkins WHERE user_id = ?", [leaver]))[0].note, "the control").toContain("step-free");

      await erase(leaver);

      expect(await q("SELECT note FROM event_checkins WHERE user_id = ?", [leaver])).toEqual([{ note: null }]);
      expect(await checkinCount(pool, leaver), "the attendance is the village's record").toBe(1);
      expect(await q("SELECT note, confirmed_by FROM event_checkins WHERE user_id = ?", [bystander])).toEqual([{ note: "brought the long ladder", confirmed_by: leaver }]);

      // After the step has run, a steward who knows the departed id cannot write a fresh note against it.
      const late = await checkIn(pool, { eventId: "ev-e2-later", userId: leaver, confirmedBy: "e2-steward", note: "asked after her again" });
      expect(late.ok, "a departed member is not checked in to anything").toBe(false);
      expect(await q("SELECT id FROM event_checkins WHERE user_id = ? AND event_id = 'ev-e2-later'", [leaver])).toEqual([]);
    });
  });

  // ── 18 ────────────────────────────────────────────────────────────────────
  describe("18: the address book's one-time backfill", () => {
    it("makes no contact out of a housing row that belongs to an erased member, and still makes one for everybody else", async () => {
      // An erased member's account, as the tombstone leaves it.
      await person("e2-bf-gone", "A departed member", "deleted-e2-bf-gone@anonymized.invalid");
      // A row the housing scrub already reached, holding the tombstone address.
      await q("INSERT INTO housing_reservations (id, village_id, home_type, name, email, user_id) VALUES ('hr-bf-scrubbed', ?, 'cabin', 'A departed member', 'deleted-e2-bf-gone@anonymized.invalid', NULL)", [VILLAGE]);
      // A row from before any housing scrub existed: the real address, still linked to the tombstone.
      await q("INSERT INTO housing_reservations (id, village_id, home_type, name, email, user_id) VALUES ('hr-bf-old', ?, 'cabin', 'Wren Halloway', 'wren.backfill@example.test', 'e2-bf-gone')", [VILLAGE]);
      // A guest who asked and never joined, the control.
      await q("INSERT INTO housing_reservations (id, village_id, home_type, name, email, user_id) VALUES ('hr-bf-guest', ?, 'cabin', 'Juniper Guest', 'juniper.guest@example.test', NULL)", [VILLAGE]);

      await backfillContacts({ getPool: () => pool, members: { all: async () => [] }, submissions: { all: () => [] }, log: () => {} });

      const contacts = await q(
        "SELECT email_key FROM comms_contacts WHERE email_key IN ('deleted-e2-bf-gone@anonymized.invalid', 'wren.backfill@example.test', 'juniper.guest@example.test') ORDER BY email_key",
      );
      expect(contacts.map((r) => r.email_key)).toEqual(["juniper.guest@example.test"]);
    });
  });
});
