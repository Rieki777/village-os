/**
 * LEAVING WELL, FOR EVERY COMMS TABLE (the comms build spec 5.17).
 *
 * A member is seeded with a row in every table from 0228, 0229 and 0230 that
 * names a person, under both of the keys a person has there (their user id,
 * and `guest:<contactId>` for an address they used before they had an
 * account), and a second person is seeded beside them as the control. Then
 * the real erasure runs, and the assertions are about COMPLETENESS: every row
 * of theirs is gone or blanked, and every row of the other person's is
 * exactly where it was. "It did not throw" is what an incomplete sweep also
 * reports, which is why each table is asked separately.
 *
 * The same seed answers the export (everything held, before the erasure) and
 * the retention sweep (only contacts nothing refers to, and only old ones).
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../../db/testDb";
import { anonymizeMember, type ErasureDeps } from "../erasure";
import { clearMemberDrivers } from "../memberDrivers";
import { usersRepo } from "../../repos/users";
import { ERASED_ADDRESS, ERASED_SUBJECT, exportCommsForMember, sweepIdleContacts } from "../../repos/commsPeople";
import { ensureContact } from "./contacts";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

const MEMBER = "comms-erase-wren";
const EMAIL = "wren.halloway@example.test";
const OLD_EMAIL = "wren.old@example.test";
const OTHER = "control.person@example.test";

let current = "";
let old = "";
let control = "";

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: any) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

/** One row in every comms table, for a contact and its person keys. */
async function footprint(tag: string, contactId: string, emailKey: string, personKey: string, guestKey: string): Promise<void> {
  await q("INSERT INTO comms_permissions (contact_id, kind, state, basis, source) VALUES (?, 'letters', 'yes', 'asked', 'letters_confirm')", [contactId]);
  for (const i of [1, 2]) {
    await q(
      "INSERT INTO comms_messages (id, idempotency_key, contact_id, user_id, to_email, email_key, kind, origin, subject, " +
        "body_html, body_text, headers, attachments, status, provider_message_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'letters', 'letter', ?, '<p>Hello</p>', 'Hello', '{\"x\":1}', '[]', 'sent', ?)",
      [`msg-${tag}-${i}`, `key-${tag}-${i}`, contactId, personKey.startsWith("guest:") ? null : personKey, emailKey, emailKey, `Welcome, ${tag}`, `prov-${tag}-${i}`],
    );
  }
  await q("INSERT INTO comms_provider_events (id, type, provider_message_id, message_id, payload) VALUES (?, 'email.delivered', ?, ?, ?)", [
    `evt-${tag}-linked`,
    `prov-${tag}-1`,
    `msg-${tag}-1`,
    JSON.stringify({ type: "email.delivered", data: { email_id: `prov-${tag}-1` } }),
  ]);
  // A report that matched no ledger row, holding the address in its payload.
  await q("INSERT INTO comms_provider_events (id, type, payload) VALUES (?, 'email.bounced', ?)", [
    `evt-${tag}-loose`,
    JSON.stringify({ type: "email.bounced", data: { to: [emailKey.toUpperCase()] } }),
  ]);
  await q("INSERT INTO comms_enrollments (id, journey_key, journey_version, contact_id, subject_ref) VALUES (?, 'path.resident', 1, ?, 'path:resident')", [
    `enr-${tag}`,
    contactId,
  ]);
  await q("INSERT INTO comms_letter_recipients (letter_id, email_key, contact_id) VALUES (?, ?, ?)", [`letter-${tag}`, emailKey, contactId]);
  await q("INSERT INTO path_enrollments (id, person_key, user_id, contact_id, path_id, source) VALUES (?, ?, ?, ?, 'resident', 'signup')", [
    `pe-${tag}`,
    personKey,
    personKey.startsWith("guest:") ? null : personKey,
    contactId,
  ]);
  await q("INSERT INTO event_attendance (event_id, occurrence_key, person_key, status, marked_by) VALUES ('ev-1', '', ?, 'came', 'host-1')", [personKey]);
  await q("INSERT INTO event_attendance (event_id, occurrence_key, person_key, status, marked_by) VALUES ('ev-2', '', ?, 'missed', 'host-1')", [guestKey]);
  await q("INSERT INTO event_feedback (event_id, occurrence_key, person_key, question_key, answer) VALUES ('ev-1', '', ?, 'q2', ?)", [
    personKey,
    `Words from ${tag}`,
  ]);
  await q("INSERT INTO event_time_poll_votes (poll_id, option_id, person_key) VALUES ('poll-1', 'opt-1', ?)", [personKey]);
}

async function guestRows(tag: string, guestContactId: string, guestKey: string): Promise<void> {
  await q("INSERT INTO event_guest_requests (id, event_id, contact_id, token_hash) VALUES (?, 'ev-2', ?, ?)", [
    `gr-${tag}`,
    guestContactId,
    tag.padEnd(64, "0").slice(0, 64),
  ]);
  await q("INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key) VALUES (?, 'ev-2', ?, 'going', ?)", [
    `rsvp-${tag}`,
    guestKey,
    `rsvp-key-${tag}`,
  ]);
  await q("INSERT INTO event_waitlist (id, event_id, user_id) VALUES (?, 'ev-3', ?)", [`wl-${tag}`, guestKey]);
}

describe.skipIf(!configured)("a person's comms rows, exported, erased and swept", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-erasure-"));
    clearMemberDrivers();

    await usersRepo(pool).add({ id: MEMBER, name: "Wren Halloway", email: EMAIL, passwordHash: "x", paths: ["resident"] });
    const c = { getPool: () => pool };
    current = (await ensureContact(c, { email: EMAIL, userId: MEMBER, name: "Wren Halloway", source: "account" }))!.id;
    // An address they used as a guest before they joined: linked to them, filed under another key.
    old = (await ensureContact(c, { email: OLD_EMAIL, userId: MEMBER, source: "guest" }))!.id;
    control = (await ensureContact(c, { email: OTHER, name: "Control Person", source: "resident" }))!.id;

    await footprint("wren", current, EMAIL, MEMBER, `guest:${old}`);
    await guestRows("wren", old, `guest:${old}`);
    await footprint("control", control, OTHER, `guest:${control}`, `guest:${control}`);
    await guestRows("control", control, `guest:${control}`);

    await q("INSERT INTO comms_suppressions (email_key, reason) VALUES (?, 'bounced')", [OLD_EMAIL]);
    await q("INSERT INTO comms_suppressions (email_key, reason) VALUES (?, 'complained')", [OTHER]);
    // Wren wrote to somebody through the relay, so their address is the reply-to of an email to someone else.
    await q(
      "INSERT INTO comms_messages (id, idempotency_key, to_email, email_key, kind, origin, subject, reply_to, status) " +
        "VALUES ('msg-relay', 'key-relay', ?, ?, 'essential', 'map.contact_relay', 'A note', ?, 'sent')",
      [OTHER, OTHER, "Wren.Halloway@Example.test"],
    );
    // Wren's own yes to a gathering is a member's row, kept like every other
    // member trace (the tombstone covers it), and Wren hosts a gathering.
    await q("INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key) VALUES ('rsvp-member', 'ev-9', ?, 'going', 'rsvp-key-member')", [MEMBER]);
    await q("INSERT INTO event_comms (event_id, host_user_id) VALUES ('ev-9', ?)", [MEMBER]);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  it("exports everything the comms tables hold about the member, and nothing about anybody else", async () => {
    const doc = await exportCommsForMember(pool, { id: MEMBER, email: EMAIL });
    const count = (k: string) => (doc[k] as unknown[]).length;
    expect(count("contacts")).toBe(2);
    expect(count("permissions")).toBe(1);
    expect(count("suppressions")).toBe(1);
    expect(count("emails")).toBe(2);
    expect(count("journeys")).toBe(1);
    expect(count("paths")).toBe(1);
    expect(count("guestRequests")).toBe(1);
    expect(count("guestRsvps")).toBe(1);
    expect(count("guestWaitlist")).toBe(1);
    expect(count("attendance")).toBe(2);
    expect(count("feedback")).toBe(1);
    expect(count("timeVotes")).toBe(1);
    expect(count("letters")).toBe(1);
    const text = JSON.stringify(doc);
    expect(text).not.toContain(OTHER);
    expect(text).not.toContain("Words from control");
  });

  it("takes every comms row of the member's with them, blanks their emails, and leaves the other person exactly as they were", async () => {
    const controlBefore = {
      contacts: await q("SELECT * FROM comms_contacts WHERE id = ?", [control]),
      messages: await q("SELECT * FROM comms_messages WHERE contact_id = ? ORDER BY id", [control]),
      events: await q("SELECT id FROM comms_provider_events WHERE id LIKE 'evt-control-%' ORDER BY id"),
      rest: await q(
        "SELECT (SELECT COUNT(*) FROM comms_permissions WHERE contact_id = ?) AS p, (SELECT COUNT(*) FROM comms_enrollments WHERE contact_id = ?) AS e, " +
          "(SELECT COUNT(*) FROM event_attendance WHERE person_key = ?) AS a, (SELECT COUNT(*) FROM event_rsvps WHERE user_id = ?) AS r, " +
          "(SELECT COUNT(*) FROM comms_suppressions WHERE email_key = ?) AS s",
        [control, control, `guest:${control}`, `guest:${control}`, OTHER],
      ),
    };

    const target = await usersRepo(pool).byId(MEMBER);
    await anonymizeMember(pool, target, "admin-1", deps());

    const keys = [MEMBER, `guest:${current}`, `guest:${old}`];
    const ids = [current, old];
    const none = async (sql: string, params: unknown[]) => expect(await q(sql, params), sql).toHaveLength(0);
    await none("SELECT id FROM comms_contacts WHERE id IN (?) OR user_id = ?", [ids, MEMBER]);
    await none("SELECT kind FROM comms_permissions WHERE contact_id IN (?)", [ids]);
    await none("SELECT email_key FROM comms_suppressions WHERE email_key IN (?)", [[EMAIL, OLD_EMAIL]]);
    await none("SELECT id FROM comms_enrollments WHERE contact_id IN (?)", [ids]);
    await none("SELECT letter_id FROM comms_letter_recipients WHERE contact_id IN (?) OR email_key IN (?)", [ids, [EMAIL, OLD_EMAIL]]);
    await none("SELECT id FROM path_enrollments WHERE person_key IN (?) OR user_id = ?", [keys, MEMBER]);
    await none("SELECT id FROM event_guest_requests WHERE contact_id IN (?)", [ids]);
    await none("SELECT person_key FROM event_attendance WHERE person_key IN (?)", [keys]);
    await none("SELECT person_key FROM event_feedback WHERE person_key IN (?)", [keys]);
    await none("SELECT person_key FROM event_time_poll_votes WHERE person_key IN (?)", [keys]);
    await none("SELECT id FROM event_rsvps WHERE user_id IN (?)", [[`guest:${current}`, `guest:${old}`]]);
    await none("SELECT id FROM event_waitlist WHERE user_id IN (?)", [[`guest:${current}`, `guest:${old}`]]);
    await none("SELECT id FROM comms_provider_events WHERE id LIKE 'evt-wren-%'", []);

    // The ledger rows stay, so the village's counts still add up, and lose the person.
    const theirs = await q("SELECT to_email, email_key, subject, contact_id, body_html, body_text, headers, attachments FROM comms_messages WHERE id LIKE 'msg-wren-%'");
    expect(theirs).toHaveLength(2);
    for (const row of theirs) {
      expect(row).toEqual({
        to_email: ERASED_ADDRESS,
        email_key: ERASED_ADDRESS,
        subject: ERASED_SUBJECT,
        contact_id: null,
        body_html: null,
        body_text: null,
        headers: null,
        attachments: null,
      });
    }
    // Every column that can carry a person, across the whole ledger.
    expect(JSON.stringify(await q("SELECT to_email, email_key, subject, body_html, body_text, reply_to FROM comms_messages"))).not.toMatch(/wren/i);
    const relay = (await q("SELECT to_email, reply_to FROM comms_messages WHERE id = 'msg-relay'"))[0];
    expect(relay).toEqual({ to_email: OTHER, reply_to: null });

    // A member's own yes is a member's row and stays with the tombstone; hosting ends.
    expect(await q("SELECT id FROM event_rsvps WHERE user_id = ?", [MEMBER])).toHaveLength(1);
    expect((await q("SELECT host_user_id FROM event_comms WHERE event_id = 'ev-9'"))[0].host_user_id).toBeNull();

    // The other person, untouched.
    expect(await q("SELECT * FROM comms_contacts WHERE id = ?", [control])).toEqual(controlBefore.contacts);
    expect(await q("SELECT * FROM comms_messages WHERE contact_id = ? ORDER BY id", [control])).toEqual(controlBefore.messages);
    expect(await q("SELECT id FROM comms_provider_events WHERE id LIKE 'evt-control-%' ORDER BY id")).toEqual(controlBefore.events);
    expect(
      await q(
        "SELECT (SELECT COUNT(*) FROM comms_permissions WHERE contact_id = ?) AS p, (SELECT COUNT(*) FROM comms_enrollments WHERE contact_id = ?) AS e, " +
          "(SELECT COUNT(*) FROM event_attendance WHERE person_key = ?) AS a, (SELECT COUNT(*) FROM event_rsvps WHERE user_id = ?) AS r, " +
          "(SELECT COUNT(*) FROM comms_suppressions WHERE email_key = ?) AS s",
        [control, control, `guest:${control}`, `guest:${control}`, OTHER],
      ),
    ).toEqual(controlBefore.rest);
  });

  it("is a step a resumed erasure can run again with nothing left to find", async () => {
    // The sweep's resume guarantee: a second full run over an erased member is uneventful.
    const tomb = await usersRepo(pool).byId(MEMBER);
    await anonymizeMember(pool, tomb, null, deps());
    expect(await q("SELECT id FROM comms_messages WHERE id LIKE 'msg-wren-%'")).toHaveLength(2);
    expect(await q("SELECT id FROM comms_contacts WHERE id = ?", [control])).toHaveLength(1);
  });

  it("sweeps only old contacts nothing refers to", async () => {
    const c = { getPool: () => pool };
    const idle = (await ensureContact(c, { email: "idle.old@example.test", source: "contact" }))!.id;
    const answered = (await ensureContact(c, { email: "answered.old@example.test", source: "contact" }))!.id;
    const going = (await ensureContact(c, { email: "going.old@example.test", source: "guest" }))!.id;
    const fresh = (await ensureContact(c, { email: "idle.new@example.test", source: "contact" }))!.id;
    await q("INSERT INTO comms_permissions (contact_id, kind, state, basis, source) VALUES (?, 'letters', 'no', 'asked', 'unsubscribe')", [answered]);
    await q("INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key) VALUES ('rsvp-going-old', 'ev-4', ?, 'going', 'rsvp-key-going-old')", [
      `guest:${going}`,
    ]);
    await q(
      "UPDATE comms_contacts SET created_at = CURRENT_TIMESTAMP - INTERVAL 20 MONTH, updated_at = NULL WHERE id IN (?)",
      [[idle, answered, going]],
    );

    expect(await sweepIdleContacts(pool, 18)).toBe(1);
    expect((await q("SELECT id FROM comms_contacts WHERE id IN (?)", [[idle, answered, going, fresh, control]])).map((r) => r.id).sort()).toEqual(
      [answered, going, fresh, control].sort(),
    );
  });
});
