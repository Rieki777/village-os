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
import { createReservation } from "./housing";
import { ensureContact } from "./comms/contacts";
import { handlePathTrigger } from "./comms/paths";
import { noticePathHandoff } from "./comms/notices";
import { handleGatheringTrigger, type EventEmailDeps } from "./comms/eventEmails";
import type { CommsMode, PostOfficeDeps } from "./comms/postOffice";
import type { Transport } from "./comms/transport";
import { castVote, openBallot } from "./ballots";
import { notifyRollRows } from "./ballotNotices";
import { recordEvent } from "./events";

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

/** A post office whose provider takes every message and keeps nothing, for the producers that post through one. */
const transport: Transport = { name: "resend", send: async () => ({ ok: true, providerId: `prov_${Math.random().toString(36).slice(2)}` }) };
const LIVE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };
const office = (): PostOfficeDeps => ({
  getPool: () => pool,
  transport,
  sender: () => "Test Village <hello@village.example.test>",
  hasApiKey: () => true,
  origin: () => "http://localhost",
  mode: async () => LIVE,
  dial: (k) => (k === "comms.send_rate_per_second" ? 50 : k === "comms.daily_cap" ? 50 : 120),
});
const eventDeps = (): EventEmailDeps => ({ getPool: () => pool, postOffice: office(), timezone: () => "UTC", reminderMinutes: () => [1440] });

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

    /*
     * ROUND 2, FINDING 13. The window went, and every guest's own copy of it
     * stayed: the journey the yes enrolled them on keeps what they were told
     * (the title and the place) in its facts, and the confirmation it posted
     * keeps the title in its subject, the place, the note and the host's full
     * name in its words, and all three again in the calendar file.
     */
    it("takes its title, place and note out of every guest's journey and every email about it, and sends nothing", async () => {
      const leaver = "e2-mm2-wren";
      const guest = "e2-mm2-bay";
      const host = "e2-mm2-ida";
      await person(leaver, "Wren Halloway");
      await person(guest, "Bay Holt");
      await person(host, "Ida Fenn");
      await q("INSERT INTO comms_journeys (village_id, journey_key, state, version) VALUES (?, 'gathering.going', 'on', 1) ON DUPLICATE KEY UPDATE state = 'on'", [VILLAGE]);

      const mine = await createMeetMe(pool, { userId: leaver, firstName: "Wren Halloway", layer: "village", place: "the bakery on Calle 3", note: "come say hi, I'll be in the red jacket", ...window() });
      const theirs = await createMeetMe(pool, { userId: host, firstName: "Ida Fenn", layer: "village", place: "the old mill", note: "bring a mug", ...window() });
      const mineId = (mine as { id: string }).id;
      const theirsId = (theirs as { id: string }).id;
      // The guest says yes to both, through the same door and the same trigger the server uses.
      for (const id of [mineId, theirsId]) {
        expect((await rsvp(pool, id, guest, "going")).ok).toBe(true);
        const going: any = await handleGatheringTrigger(eventDeps(), { type: "rsvp_changed", eventId: id, occurrenceKey: "", personKey: guest, status: "going" });
        expect(going.enrollmentId, `the yes to ${id} enrolled the guest`).toBeTruthy();
      }
      // A letter about the window that no journey owns (a time or place change), keyed on the evening.
      await mail({ id: "msg-mm2-changed", key: `ev:${mineId}::changed:1:${guest}`, to: `${guest}@example.test`, kind: "events", origin: "gathering.changed", subject: "Meet Wren moved to the bakery on Calle 3", bodyHtml: "<p>Meet Wren is now at the bakery on Calle 3</p>" });
      // One still waiting in the queue: a reminder held for later.
      const [enr] = await q("SELECT id FROM comms_enrollments WHERE journey_key = 'gathering.going' AND subject_ref = ?", [`event:${mineId}:`]);
      await q(
        "INSERT INTO comms_messages (id, village_id, idempotency_key, to_email, email_key, kind, origin, subject, body_html, status, enrollment_id) VALUES ('msg-mm2-queued', ?, ?, ?, ?, 'events', 'journey', 'Tomorrow: Meet Wren', '<p>the bakery on Calle 3</p>', 'queued', ?)",
        [VILLAGE, `j:gathering.going:remind:${enr.id}`, `${guest}@example.test`, `${guest}@example.test`, enr.id],
      );

      const facts = async (eventId: string) => (await q("SELECT CAST(facts AS CHAR) AS f FROM comms_enrollments WHERE subject_ref LIKE ?", [`event:${eventId}:%`])).map((r) => String(r.f));
      const lettersAbout = async (eventId: string) =>
        q(
          "SELECT m.id, m.status, m.subject, m.body_html, m.body_text, CAST(m.attachments AS CHAR) AS attachments FROM comms_messages m " +
            "WHERE m.idempotency_key LIKE ? OR m.enrollment_id IN (SELECT id FROM comms_enrollments WHERE subject_ref LIKE ?) ORDER BY m.id",
          [`ev:${eventId}:%`, `event:${eventId}:%`],
        );
      // The control: today the guest's journey and their emails carry the window's words.
      expect((await facts(mineId)).join(" ")).toContain("Meet Wren");
      expect((await facts(mineId)).join(" ")).toContain("the bakery on Calle 3");
      const before = await lettersAbout(mineId);
      const confirmation = before.find((m) => m.attachments);
      expect(confirmation?.subject, "the confirmation names the window").toContain("Meet Wren");
      expect(confirmation?.body_html, "its words carry the place").toContain("the bakery on Calle 3");
      expect(confirmation?.body_html, "and the note, in the calendar links").toContain("red%20jacket");
      const ics = Buffer.from(String(JSON.parse(String(confirmation?.attachments))[0].contentBase64), "base64").toString("utf8");
      expect(ics, "and the calendar file names the window").toContain("SUMMARY:Meet Wren");
      const theirsBefore = { facts: await facts(theirsId), letters: await lettersAbout(theirsId) };
      expect(theirsBefore.letters.length, "the bystander's window has its own confirmation").toBeGreaterThan(0);
      const rowsBefore = Number((await q("SELECT COUNT(*) AS n FROM comms_messages"))[0].n);

      await erase(leaver);

      const left = await facts(mineId);
      expect(left.length, "the guest's journey rows stay, as the record that they were on it").toBeGreaterThan(0);
      for (const f of left) {
        expect(f).not.toContain("Meet Wren");
        expect(f).not.toContain("Calle 3");
        expect(f).not.toContain('"told"');
      }
      expect(await q("SELECT state FROM comms_enrollments WHERE subject_ref LIKE ?", [`event:${mineId}:%`])).toEqual(left.map(() => ({ state: "stopped" })));
      const after = await lettersAbout(mineId);
      expect(after.map((m) => m.id).sort()).toEqual(before.map((m) => m.id).sort());
      for (const m of after) {
        expect(m, `${m.id} keeps no word of the window`).toMatchObject({ subject: ERASED_SUBJECT, body_html: null, body_text: null, attachments: null });
      }
      expect(after.find((m) => m.id === "msg-mm2-queued")?.status, "a reminder still waiting does not go").toBe("cancelled");
      expect(Number((await q("SELECT COUNT(*) AS n FROM comms_messages"))[0].n), "nothing was sent about the erasure").toBe(rowsBefore);
      // The bystander's window, its guest's journey and their confirmation, exactly as they were.
      expect({ facts: await facts(theirsId), letters: await lettersAbout(theirsId) }).toEqual(theirsBefore);
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

    /*
     * ROUND 2, FINDINGS 3 AND 16. An address the leaver typed on a request of
     * their own can be somebody else's too: a partner's account address, or a
     * porch inbox a stranger's own public request also uses. Each of those
     * people's own requests sent its own team alert, with the same reply-to,
     * and the step blanked every alert at the address. The rule now reads the
     * requests: an alert is the leaver's when nobody else asked under its
     * address, or when its subject names what the leaver typed and nothing
     * anybody else typed there. And at the leaver's own account address, a
     * partner's household request (Ash typing the leaver's address for the
     * two of them) loses the leaver's address and keeps Ash's name.
     */
    it("keeps a living person's own housing alert at an address the leaver also typed, and still blanks the leaver's own", async () => {
      const leaver = "e2-mail2-wren";
      const ash = "e2-mail2-ash";
      const wrenMail = "wren.two@example.test";
      const ashMail = "ash.two@example.test";
      const porch = "porch.two@example.test";
      await person(leaver, "Wren Halloway", wrenMail);
      await person(ash, "Ash Moreno", ashMail);
      const alert = (id: string, from: string, replyTo: string) =>
        mail({ id, key: `essential:${id}`, to: "resident@village.test", kind: "essential", origin: "housing.team_alert", subject: `[Village] Home reservation request from ${from}`, replyTo });

      // Ash's own request, signed in, and the stranger Ida's from the public form, each with its alert.
      await createReservation(pool, { structureKey: null, homeType: "villa", name: "Ash Moreno", email: ashMail, phone: null, notes: null, userId: ash });
      await alert("msg-a2-ash", "Ash Moreno", ashMail);
      await createReservation(pool, { structureKey: null, homeType: "cabin", name: "Ida Fenn", email: porch, phone: null, notes: null });
      await alert("msg-a2-ida", "Ida Fenn", porch.toUpperCase());
      // The leaver, signed in, typed both of those addresses on requests of their own, and each sent its alert.
      await createReservation(pool, { structureKey: null, homeType: "casita", name: "Wren Halloway", email: ashMail, phone: null, notes: null, userId: leaver });
      await alert("msg-a2-wren-at-ash", "Wren Halloway", ashMail);
      await createReservation(pool, { structureKey: null, homeType: "casita", name: "Wren Halloway", email: porch, phone: null, notes: null, userId: leaver });
      await alert("msg-a2-wren-at-porch", "Wren Halloway", porch);
      // Ash's household request, signed in, typed with the leaver's account address.
      await createReservation(pool, { structureKey: null, homeType: "villa", name: "Ash Moreno", email: wrenMail, phone: null, notes: null, userId: ash });
      await alert("msg-a2-ash-at-wren", "Ash Moreno", wrenMail);

      const read = () => q("SELECT id, subject, reply_to FROM comms_messages WHERE id LIKE 'msg-a2-%' ORDER BY id");
      const before = new Map((await read()).map((r) => [r.id, r]));
      expect(before.size, "every alert landed").toBe(5);

      await erase(leaver);

      const after = new Map((await read()).map((r) => [r.id, r]));
      expect(after.get("msg-a2-ash"), "Ash's own alert is Ash's").toEqual(before.get("msg-a2-ash"));
      expect(after.get("msg-a2-ida"), "the stranger's own alert is hers").toEqual(before.get("msg-a2-ida"));
      for (const id of ["msg-a2-wren-at-ash", "msg-a2-wren-at-porch"]) {
        expect(after.get(id), `${id} was the leaver's`).toEqual({ id, subject: ERASED_SUBJECT, reply_to: null });
      }
      expect(after.get("msg-a2-ash-at-wren"), "the household alert loses the leaver's address and keeps Ash's request").toEqual({
        id: "msg-a2-ash-at-wren",
        subject: "[Village] Home reservation request from Ash Moreno",
        reply_to: null,
      });
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

  // ── Round 2, 12 ───────────────────────────────────────────────────────────
  /*
   * Day 21 on a path asks the path's contact person to write: "Wren has been
   * on the resident path for three weeks. Write to them." On their bell with
   * no actor, keyed on the walker's enrollment, emailed at once, or sent to
   * their inbox as essential mail when they have no account. The comms step
   * deleted the enrollment, the one thing that tied those rows to the walker,
   * and left all three naming them.
   */
  describe("round 2, 12: the day-21 hand-off that names the member to the path's contact person", () => {
    const notify = (input: any) => insertNotification(notifyDeps(), input);
    const handoff = async (enrollmentId: string, firstName: string, contactId: string, to: string) => {
      const r: any = await noticePathHandoff(notify, { contactUserId: to, enrollmentId, firstName, pathName: "resident", link: `/admin?tab=comms-people&person=${contactId}` });
      expect(r.fresh, `the hand-off for ${enrollmentId} landed`).toBe(true);
      return String(r.id);
    };

    it("loses its words, its link and its emailed copies, and the inbox copy keeps its living recipient", async () => {
      const leaver = "e2-ho-wren";
      const bystander = "e2-ho-bay";
      const guide = "e2-ho-guide";
      await person(leaver, "Wren Halloway");
      await person(bystander, "Bay Holt");
      await person(guide, "Juno Guide");
      const contactOf = async (who: string, name: string) => (await ensureContact({ getPool: () => pool }, { email: `${who}@example.test`, name, userId: who, source: "account" }))!.id;
      const mineContact = await contactOf(leaver, "Wren Halloway");
      const theirsContact = await contactOf(bystander, "Bay Holt");
      for (const [id, cid] of [["enr-ho-w", mineContact], ["enr-ho-b", theirsContact]]) {
        await q("INSERT INTO comms_enrollments (id, journey_key, journey_version, contact_id, subject_ref) VALUES (?, 'path.resident', 1, ?, 'path:resident')", [id, cid]);
      }
      const mine = await handoff("enr-ho-w", "Wren", mineContact, guide);
      const theirs = await handoff("enr-ho-b", "Bay", theirsContact, guide);
      const [notice] = await q("SELECT title FROM notifications WHERE id = ?", [mine]);
      await mail({ id: "msg-ho-imm-w", key: `notify:${mine}`, to: "juno@example.test", userId: guide, kind: "notices", origin: "notify.immediate", subject: notice.title, bodyHtml: `<h2>${notice.title}</h2>` });
      await mail({ id: "msg-ho-imm-b", key: `notify:${theirs}`, to: "juno@example.test", userId: guide, kind: "notices", origin: "notify.immediate", subject: "Bay has been on the resident path for three weeks. Write to them.", bodyHtml: "<h2>Bay</h2>" });
      // The essential copy a path contact with no account gets instead, linked to the enrollment and addressed to them.
      await q(
        "INSERT INTO comms_messages (id, village_id, idempotency_key, to_email, email_key, kind, origin, subject, status, enrollment_id) VALUES ('msg-ho-inbox-w', ?, 'comms_path_handoff:enr-ho-w', 'pathfolk@village.test', 'pathfolk@village.test', 'essential', 'comms.path_handoff', ?, 'sent', 'enr-ho-w')",
        [VILLAGE, notice.title],
      );
      expect(notice.title, "the control: the hand-off names the walker").toContain("Wren");
      const theirsBefore = await q("SELECT id, title, body, link FROM notifications WHERE id = ?", [theirs]);
      const theirMailBefore = await q("SELECT id, subject, body_html FROM comms_messages WHERE id = 'msg-ho-imm-b'");

      await erase(leaver);

      expect(await q("SELECT title, body, link, actor_user_id FROM notifications WHERE id = ?", [mine])).toEqual([{ title: DEPARTED, body: null, link: null, actor_user_id: null }]);
      expect(await q("SELECT id, to_email, subject, body_html, body_text FROM comms_messages WHERE id IN ('msg-ho-imm-w', 'msg-ho-inbox-w') ORDER BY id")).toEqual([
        { id: "msg-ho-imm-w", to_email: "juno@example.test", subject: ERASED_SUBJECT, body_html: null, body_text: null },
        { id: "msg-ho-inbox-w", to_email: "pathfolk@village.test", subject: ERASED_SUBJECT, body_html: null, body_text: null },
      ]);
      expect(await q("SELECT id, title, body, link FROM notifications WHERE id = ?", [theirs]), "the bystander's hand-off is theirs").toEqual(theirsBefore);
      expect(await q("SELECT id, subject, body_html FROM comms_messages WHERE id = 'msg-ho-imm-b'")).toEqual(theirMailBefore);
    });

    it("loses its words when the walker was a second address the member typed into a housing request", async () => {
      const leaver = "e2-ho2-wren";
      const guide = "e2-ho2-guide";
      const typed = "wren.walks@example.test";
      await person(leaver, "Wren Halloway");
      await person(guide, "Juno Guide");
      const { id: reservationId } = await createReservation(pool, { structureKey: null, homeType: "casita", name: "Wren Halloway", email: typed, phone: null, notes: null, userId: leaver });
      await handlePathTrigger({ getPool: () => pool, members: usersRepo(pool) } as any, { type: "housing_status", reservationId, status: "new", email: typed, name: "Wren Halloway", consentPaths: true } as any);
      const [walker] = await q("SELECT e.id, e.contact_id FROM comms_enrollments e JOIN comms_contacts c ON c.id = e.contact_id WHERE c.email_key = ?", [typed]);
      expect(walker, "the ticked box walked the typed address onto the resident path").toBeTruthy();
      const notice = await handoff(String(walker.id), "Wren", String(walker.contact_id), guide);

      await erase(leaver);

      expect(await q("SELECT title, link FROM notifications WHERE id = ?", [notice])).toEqual([{ title: DEPARTED, link: null }]);
    });
  });

  // ── Round 2, 6 ────────────────────────────────────────────────────────────
  /*
   * A ballot ABOUT a member (a vote to seat them, or to take a role back from
   * them) names them in its title, its document, the roll's notices, those
   * notices' emails and the public pulse, although `subject_ref` ties every
   * one of them to the member. And a ballot a member OPENED ends "Asked by
   * <first name> on <date>". The decision itself must come through whole.
   */
  describe("round 2, 6: a ballot about the member", () => {
    it("stops naming them in its words, the roll's notices and the pulse, and what was decided stays", async () => {
      const leaver = "e2-bal-wren";
      const ann = "e2-bal-ann";
      const bo = "e2-bal-bo";
      const sage = "e2-bal-wren-2"; // the leaver's id is a prefix of this one, which must not match
      await person(leaver, "Wren Halloway");
      await person(ann, "Ann Pryor");
      await person(bo, "Bo Lind");
      await person(sage, "Sage Okafor");
      const electorate = [ann, bo, sage].map((userId) => ({ userId, weight: 1 }));
      const open = async (input: { subjectType: string; subjectRef: string; title: string; doc: string; openedBy: string }) => {
        const r = await openBallot(pool, {
          subjectType: input.subjectType, subjectRef: input.subjectRef, title: input.title, docMarkdown: input.doc, method: "majority",
          weightMode: "equal", unityPct: 50, quorumPct: 10, durationDays: 7, openedBy: input.openedBy, electorate,
        } as any);
        if (!r.ok) throw new Error(`ballot refused to open: ${r.error}`);
        return r.ballot;
      };
      // Exactly the words the two doors write (server/index.ts role-unseats, server/routes/powerHands.ts openSeatVote).
      const unseatDoc = (first: string, asker: string) =>
        [
          `# Steward: the village asks to take the role back from ${first}`, "",
          "## What changes if this carries", "",
          `${first} stops sitting in Steward. The role carries no powers today, so nothing anybody can do changes.`, "",
          "Steward keeps everything it carries, and anybody else sitting in it is untouched.", "",
          "## Why now", "",
          `${first} has missed the last four circles, and the Wrenfield orchard group asked for a new steward.`, "",
          `Asked by ${asker} on 2026-10-01.`, "",
        ].join("\n");
      const about = await open({ subjectType: "role_unseat", subjectRef: `${leaver}@role-steward`, title: "Steward: the village asks to take the role back from Wren", doc: unseatDoc("Wren", "Ann"), openedBy: ann });
      const seat = await open({
        subjectType: "role_seat", subjectRef: `${leaver}@role-garden`, title: "Gardener: the village asks Wren to sit in it", openedBy: ann,
        doc: ["# Gardener: the village asks Wren to sit in it", "", "## What Wren would be able to do", "", "Gardener carries no powers today.", "", "Asked by Ann on 2026-10-02.", ""].join("\n"),
      });
      const opened = await open({ subjectType: "advisory", subjectRef: "e2-bal-adv", title: "Should the orchard have a second gate?", doc: "# Should the orchard have a second gate?\n\nThe Wrenfield path floods.\n\nAsked by Wren on 2026-10-03.\n", openedBy: leaver });
      const control = await open({ subjectType: "role_unseat", subjectRef: `${sage}@role-steward`, title: "Steward: the village asks to take the role back from Sage", doc: unseatDoc("Sage", "Ann"), openedBy: ann });
      expect((await castVote(pool, about.id, bo, "yes")).ok, "a vote is cast on the ballot about the leaver").toBe(true);

      // The roll's notices and the pulse lines, as the doors and the close write them.
      const rollDeps = { pool, notify: (input: any) => insertNotification(notifyDeps(), input), link: () => "/governance" };
      for (const [b, first] of [[about, "Wren"], [seat, "Wren"], [control, "Sage"]] as const) {
        await notifyRollRows(rollDeps, b, { type: "ballot_opened", title: `The village is asked whether ${first} keeps the role in Steward`, keySuffix: "open", except: [ann], roll: [bo] });
        await recordEvent(pool, { kind: "governance", text: `The village is deciding whether ${first} keeps the role in Steward.`, actorUserId: ann, entityType: "ballot", entityRef: b.id });
        await recordEvent(pool, { kind: "governance", text: `A village vote carried: ${b.title}`, actorUserId: bo, entityType: "ballot", entityRef: b.id });
      }
      await notifyRollRows(rollDeps, about, { type: "ballot_carried", title: `Carried: ${about.title}`, keySuffix: "outcome", roll: [bo] });
      const [boOpen] = await q("SELECT id, title FROM notifications WHERE dedupe_key = ?", [`bal:${about.id}:open:u${bo}`]);
      await mail({ id: "msg-bal-open-w", key: `notify:${boOpen.id}`, to: "bo@example.test", userId: bo, kind: "notices", origin: "notify.immediate", subject: boOpen.title, bodyHtml: `<h2>${boOpen.title}</h2>` });

      const decided = (id: string) => q("SELECT subject_type, subject_ref, status, opened_by, closes_at, electorate_count FROM ballots WHERE id = ?", [id]);
      const decidedBefore = { about: await decided(about.id), seat: await decided(seat.id), opened: await decided(opened.id) };
      const votesBefore = await q("SELECT user_id, choice FROM ballot_votes WHERE ballot_id = ?", [about.id]);
      const ballot = async (id: string) => (await q("SELECT title, doc_markdown FROM ballots WHERE id = ?", [id]))[0];
      const controlBefore = { ballot: await ballot(control.id), bell: await q("SELECT title FROM notifications WHERE dedupe_key LIKE ?", [`bal:${control.id}:%`]), pulse: await q("SELECT text FROM health_events WHERE entity_type = 'ballot' AND entity_ref = ? ORDER BY text", [control.id]) };
      expect(JSON.stringify(await ballot(about.id)), "the control: the ballot names the leaver today").toMatch(/\bWren\b/);

      await erase(leaver);

      const names = /\bWren\b|Halloway/;
      for (const b of [about, seat]) {
        const row = await ballot(b.id);
        expect(row.title, `${b.id}'s title`).not.toMatch(names);
        expect(row.doc_markdown, `${b.id}'s document`).not.toMatch(names);
        expect(await q("SELECT title FROM notifications WHERE dedupe_key LIKE ?", [`bal:${b.id}:%`]), `${b.id}'s notices`).toEqual(
          (await q("SELECT title FROM notifications WHERE dedupe_key LIKE ?", [`bal:${b.id}:%`])).map(() => ({ title: DEPARTED })),
        );
        expect(await q("SELECT text FROM health_events WHERE audience = 'public' AND entity_type = 'ballot' AND entity_ref = ?", [b.id]), `${b.id}'s public lines`).toEqual([]);
      }
      expect((await ballot(about.id)).title).toBe("Steward: the village asks to take the role back from a departed member");
      expect((await ballot(seat.id)).title).toBe("Gardener: the village asks a departed member to sit in it");
      expect((await ballot(about.id)).doc_markdown, "a longer word that holds the name is not a name").toContain("the Wrenfield orchard group");
      expect((await ballot(about.id)).doc_markdown, "the person who asked is still named").toContain("Asked by Ann on 2026-10-01.");
      expect((await ballot(about.id)).doc_markdown).toContain("A departed member stops sitting in Steward.");
      expect((await ballot(opened.id)).doc_markdown, "a ballot they opened no longer says so by name").toBe("# Should the orchard have a second gate?\n\nThe Wrenfield path floods.\n\nAsked by a departed member on 2026-10-03.\n");
      expect(await q("SELECT subject, body_html FROM comms_messages WHERE id = 'msg-bal-open-w'")).toEqual([{ subject: ERASED_SUBJECT, body_html: null }]);
      expect(await q("SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key LIKE ?", [`bal:${about.id}:%`]), "the notices stay, as rows").toEqual([{ n: 2 }]);
      // What was decided, and who voted how, came through whole.
      expect({ about: await decided(about.id), seat: await decided(seat.id), opened: await decided(opened.id) }).toEqual(decidedBefore);
      expect(await q("SELECT user_id, choice FROM ballot_votes WHERE ballot_id = ?", [about.id])).toEqual(votesBefore);
      // The ballot about the member whose id begins with the leaver's, exactly as it was.
      expect({ ballot: await ballot(control.id), bell: await q("SELECT title FROM notifications WHERE dedupe_key LIKE ?", [`bal:${control.id}:%`]), pulse: await q("SELECT text FROM health_events WHERE entity_type = 'ballot' AND entity_ref = ? ORDER BY text", [control.id]) }).toEqual(controlBefore);

      // A second sweep finds nothing left to change.
      const settled = { about: await ballot(about.id), seat: await ballot(seat.id), opened: await ballot(opened.id) };
      await erase(leaver);
      expect({ about: await ballot(about.id), seat: await ballot(seat.id), opened: await ballot(opened.id) }).toEqual(settled);
    });

    /*
     * ROUND 3, THE GUARD FROM FINDING 0'S FIX. A door that opens a ballot about
     * a member who is already a tombstone titles it with the tombstone's first
     * name, which is "A" ("...take the role back from A"). Read back off the
     * title as a spelling, "A" rewrites every standalone "A" in the words of a
     * living member who opened it. A title written about a tombstone names
     * nobody the sweep should look for.
     */
    it("reads no name off a title written about a tombstone, so the living opener's reason keeps every word", async () => {
      const leaver = "e2-bal3-wren";
      const ann = "e2-bal3-ann";
      await person(leaver, "Wren Halloway");
      await person(ann, "Ann Pryor");
      await erase(leaver);
      // Exactly the words the role-unseats door writes for a member whose name is the tombstone's.
      const title = "Steward: the village asks to take the role back from A";
      const doc = [
        `# ${title}`, "",
        "## What changes if this carries", "",
        "A stops sitting in Steward. The role carries no powers today, so nothing anybody can do changes.", "",
        "Steward keeps everything it carries, and anybody else sitting in it is untouched.", "",
        "## Why now", "",
        "A cleanup vote. A role held by nobody who lives here keeps the circle from filling it.", "",
        "Asked by Ann on 2026-10-04.", "",
      ].join("\n");
      const r = await openBallot(pool, {
        subjectType: "role_unseat", subjectRef: `${leaver}@role-steward`, title, docMarkdown: doc, method: "majority",
        weightMode: "equal", unityPct: 50, quorumPct: 10, durationDays: 7, openedBy: ann, electorate: [{ userId: ann, weight: 1 }],
      } as any);
      if (!r.ok) throw new Error(`ballot refused to open: ${r.error}`);
      const words = async () => (await q("SELECT title, doc_markdown, outcome_note FROM ballots WHERE id = ?", [r.ballot.id]))[0];
      expect(await words(), "the control: the ballot is stored as the door wrote it").toEqual({ title, doc_markdown: doc, outcome_note: null });

      // The erasure asked again, which is the sweep a tombstone target gets.
      await erase(leaver);

      expect(await words(), "the living opener's reason, every standalone A in it, is untouched").toEqual({ title, doc_markdown: doc, outcome_note: null });
    });
  });
});
