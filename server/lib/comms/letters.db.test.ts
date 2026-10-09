import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import crypto from "node:crypto";
import { pathJourney } from "../../../shared/comms/defaults/journeys";
import type { LetterAudience } from "../../../shared/comms/letters";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { upsertContact } from "../../repos/commsContacts";
import { applyReportStatus, insertMessage, markSent } from "../../repos/commsMessages";
import { upsertPermission } from "../../repos/commsPermissions";
import { usersRepo } from "../../repos/users";
import {
  createLetter,
  letterHistory,
  previewLetter,
  resolveAudience,
  runLettersJob,
  saveLetter,
  sendLetter,
  type LettersDeps,
  type PreviewAnswer,
} from "./letters";
import { journeyOutcomes } from "./outcomes";
import { createPermissionFor, suppressionsPortFor, unsubscribe, type PeopleDeps } from "./permissions";
import { drain, type CommsMode, type PostOfficeDeps } from "./postOffice";
import type { Transport, TransportMessage } from "./transport";

/**
 * Letters against a provisioned schema (the comms build spec 5.12): real
 * contacts and answers, a real snapshot and ledger, and a post office whose
 * provider records what it is handed. The acceptance list's guards are each
 * named by one test here and again in server/comms.letters.e2e.test.ts.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;
const LIVE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };
const KEY = crypto.randomBytes(32);

const sent: TransportMessage[] = [];
const transport: Transport = {
  name: "resend",
  async send(m) {
    sent.push(m);
    return { ok: true, providerId: `prov_${sent.length}` };
  },
};

let people: PeopleDeps;
let office: PostOfficeDeps;

function deps(over: Partial<LettersDeps> = {}): LettersDeps {
  return { getPool: () => pool, postOffice: office, people, lifecycle: () => "members", lettersPerDay: () => 3, key: KEY, ...over };
}

async function rows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [r] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: reading back the scratch schema this suite provisioned
  return r;
}

async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await pool.query(sql, params); // module-review-ok: arranging the scratch schema this suite provisioned
}

let seq = 0;
/** A contact, a member when `member` is set, with a yes to letters unless `letters` is false. */
async function person(name: string, opts: { member?: boolean; letters?: boolean } = {}): Promise<{ id: string; email: string; userId: string | null }> {
  seq += 1;
  const email = `letters-${seq}@example.test`;
  let userId: string | null = null;
  if (opts.member) {
    userId = `letters-member-${seq}`;
    await usersRepo(pool).add({ id: userId, name, email, passwordHash: "x", paths: [], prefs: {} } as any);
  }
  const { id } = await upsertContact(pool, { id: `ct_letters_${seq}`, emailKey: email, email, name, userId, source: "test", timezone: null });
  if (opts.letters !== false) {
    await upsertPermission(pool, { contactId: id, kind: "letters", state: "yes", basis: "asked", source: "test", evidence: { words: "Yes, send me village news" } });
  }
  return { id, email, userId };
}

const EVERYONE: LetterAudience = { kind: "everyone" };
const draft = (over: Partial<{ subject: string; bodyMd: string; audience: LetterAudience }> = {}) => ({
  subject: over.subject ?? "The well is finished",
  preheader: null,
  bodyMd: over.bodyMd ?? "The water tested clean. Come and see it on Saturday.",
  layout: "plain" as const,
  audience: over.audience ?? EVERYONE,
});

async function previewed(audience: LetterAudience = EVERYONE, d: LettersDeps = deps()): Promise<{ id: string; p: PreviewAnswer }> {
  const letter = await createLetter(d, draft({ audience }), "admin");
  const p = await previewLetter(d, letter.id, { name: "Ada Admin" });
  if (!p.ok) throw new Error(`preview: ${JSON.stringify(p)}`);
  return { id: letter.id, p };
}

const key = () => `send:${crypto.randomUUID()}`;

/** Every letter so far went more than a day ago: the daily limit and the gap start fresh. */
const forgetWindow = () => exec("UPDATE comms_letters SET sent_at = sent_at - INTERVAL 2 DAY WHERE sent_at IS NOT NULL");

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
  people = { getPool: () => pool, members: usersRepo(pool) as any, suppressions: suppressionsPortFor(() => pool) };
  office = {
    getPool: () => pool,
    transport,
    sender: () => "Test Village <hello@village.example.test>",
    hasApiKey: () => true,
    origin: () => "https://village.example.test",
    mode: async () => LIVE,
    permissionFor: createPermissionFor(people),
    dial: (k) => (k === "comms.send_rate_per_second" ? 50 : k === "comms.daily_cap" ? 100 : 120),
  };
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("letters, against a provisioned schema", () => {
  let ada: Awaited<ReturnType<typeof person>>;
  let ben: Awaited<ReturnType<typeof person>>;
  let cleo: Awaited<ReturnType<typeof person>>;
  let dev: Awaited<ReturnType<typeof person>>;

  beforeAll(async () => {
    if (!configured) return;
    ada = await person("Ada Member", { member: true });
    ben = await person("Ben Member", { member: true });
    cleo = await person("Cleo Guest");
    dev = await person("Dev Member", { member: true, letters: false });
  });

  beforeEach(async () => {
    if (configured) await forgetWindow();
  });

  it("resolves each audience to the people who said yes, and says how many it left out", async () => {
    const everyone = await resolveAudience(deps(), { kind: "everyone" });
    expect(everyone.recipients.map((c) => c.email).sort()).toEqual([ada.email, ben.email, cleo.email].sort());

    const members = await resolveAudience(deps(), { kind: "members" });
    expect(members.recipients.map((c) => c.email).sort()).toEqual([ada.email, ben.email].sort());

    await exec(
      "INSERT INTO path_enrollments (id, person_key, user_id, contact_id, path_id, source, state) VALUES " +
        "('pe1', ?, ?, NULL, 'resident', 'test', 'active'), ('pe2', ?, NULL, ?, 'resident', 'test', 'active'), ('pe3', ?, ?, NULL, 'resident', 'test', 'active')",
      [ada.userId, ada.userId, `guest:${cleo.id}`, cleo.id, dev.userId, dev.userId],
    );
    const path = await resolveAudience(deps(), { kind: "path", pathId: "resident" });
    expect(path.recipients.map((c) => c.email).sort()).toEqual([ada.email, cleo.email].sort());
    expect(path).toMatchObject({ inGroup: 3, leftOut: 1 });

    // Nobody marked as having come: everyone who said yes.
    await exec("INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key) VALUES ('r1', 'ev-l', ?, 'going', 'k1'), ('r2', 'ev-l', ?, 'going', 'k2')", [
      ben.userId,
      `guest:${cleo.id}`,
    ]);
    const going = await resolveAudience(deps(), { kind: "gathering", eventId: "ev-l" });
    expect(going.recipients.map((c) => c.email).sort()).toEqual([ben.email, cleo.email].sort());
    expect(going.note).toMatch(/Nobody was marked/);
    // Marked: only the people who came.
    await exec("INSERT INTO event_attendance (event_id, person_key, status, marked_by) VALUES ('ev-l', ?, 'came', 'host'), ('ev-l', ?, 'missed', 'host')", [
      ben.userId,
      `guest:${cleo.id}`,
    ]);
    const came = await resolveAudience(deps(), { kind: "gathering", eventId: "ev-l" });
    expect(came.recipients.map((c) => c.email)).toEqual([ben.email]);
    expect(came.note).toBeNull();
  });

  it("refuses a stale confirmation", async () => {
    const t0 = Date.now();
    const { id, p } = await previewed(EVERYONE, deps({ now: () => t0 }));
    const late = await sendLetter(deps({ now: () => t0 + 16 * 60_000 }), id, { confirmToken: p.confirmToken, idempotencyKey: key() });
    expect(late).toMatchObject({ ok: false, status: 409 });
    expect((late as any).error).toMatch(/ran out/);
    expect((await rows("SELECT state FROM comms_letters WHERE id = ?", [id]))[0].state).toBe("draft");
    // A forged one is refused too.
    const forged = await sendLetter(deps(), id, { confirmToken: `${p.confirmToken}x`, idempotencyKey: key() });
    expect(forged).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a confirmation when the letter changed after the preview", async () => {
    const { id, p } = await previewed();
    // Changed behind the screen's back: the stored hash and count still match the preview.
    await exec("UPDATE comms_letters SET body_md = CONCAT(body_md, ' And bring a cup.') WHERE id = ?", [id]);
    const changed = await sendLetter(deps(), id, { confirmToken: p.confirmToken, idempotencyKey: key() });
    expect(changed).toMatchObject({ ok: false, status: 409 });
    expect((changed as any).error).toMatch(/changed since the preview/);

    // Changed through the screen: the save itself throws the preview away.
    const again = await previewLetter(deps(), id, { name: "Ada Admin" });
    if (!again.ok) throw new Error("preview");
    expect((await saveLetter(deps(), id, draft({ subject: "The well, finished" }))).ok).toBe(true);
    const saved = await sendLetter(deps(), id, { confirmToken: again.confirmToken, idempotencyKey: key() });
    expect(saved).toMatchObject({ ok: false, status: 409 });
    expect((await rows("SELECT COUNT(*) AS n FROM comms_messages WHERE letter_id = ?", [id]))[0].n).toBe(0);
  });

  it("sends the same letter confirmed twice once", async () => {
    const { id, p } = await previewed();
    const k = key();
    const first = await sendLetter(deps(), id, { confirmToken: p.confirmToken, idempotencyKey: k });
    expect(first).toMatchObject({ ok: true, state: "sent", duplicate: false, counts: { posted: 3, skipped: 0, pending: 0 } });
    const second = await sendLetter(deps(), id, { confirmToken: p.confirmToken, idempotencyKey: k });
    expect(second).toMatchObject({ ok: true, duplicate: true, state: "sent" });
    const third = await sendLetter(deps(), id, { confirmToken: p.confirmToken, idempotencyKey: key() });
    expect(third).toMatchObject({ ok: true, duplicate: true });
    expect((await rows("SELECT COUNT(*) AS n FROM comms_messages WHERE letter_id = ? AND kind = 'letters'", [id]))[0].n).toBe(3);
  });

  it("skips a recipient who said no between the preview and the send", async () => {
    const { id, p } = await previewed();
    expect(p.count).toBe(3);
    const out = await unsubscribe(people, { contactId: cleo.id, kind: "letters", basis: "asked", source: "test" });
    expect(out.ok).toBe(true);
    const done = await sendLetter(deps(), id, { confirmToken: p.confirmToken, idempotencyKey: key() });
    expect(done).toMatchObject({ ok: true, counts: { posted: 2, skipped: 1, pending: 0 } });
    const snap = await rows("SELECT contact_id, status, skip_reason FROM comms_letter_recipients WHERE letter_id = ? AND contact_id = ?", [id, cleo.id]);
    expect(snap[0]).toMatchObject({ status: "skipped", skip_reason: "no_permission" });
    // Put Cleo's yes back for the cases below.
    await upsertPermission(pool, { contactId: cleo.id, kind: "letters", state: "yes", basis: "asked", source: "test", evidence: null });
  });

  it("matches History to what the provider was handed and what it reported", async () => {
    sent.length = 0;
    const { id, p } = await previewed();
    await sendLetter(deps(), id, { confirmToken: p.confirmToken, idempotencyKey: key() });
    await drain(office);
    const ids = (await rows("SELECT id FROM comms_messages WHERE letter_id = ? ORDER BY id", [id])).map((r) => String(r.id));
    const handed = sent.filter((m) => ids.includes(m.id));
    expect(handed).toHaveLength(3);
    await applyReportStatus(pool, ids[0], { status: "delivered", from: ["sent"], stamp: "delivered_at", lastError: null, providerMessageId: null });
    await applyReportStatus(pool, ids[1], { status: "bounced", from: ["sent"], stamp: "bounced_at", lastError: null, providerMessageId: null });
    const view = (await letterHistory(deps())).find((l) => l.id === id)!;
    expect(view.numbers).toMatchObject({ posted: 3, sent: handed.length, delivered: 1, bounced: 1, complained: 0, skipped: 0, waiting: 0 });
    expect(view.audienceLabel).toBe("Everyone who said yes to letters");
  });

  it("refuses a second letter inside ten minutes of the last", async () => {
    const a = await previewed();
    expect((await sendLetter(deps(), a.id, { confirmToken: a.p.confirmToken, idempotencyKey: key() })).ok).toBe(true);
    const b = await previewed();
    const soon = await sendLetter(deps(), b.id, { confirmToken: b.p.confirmToken, idempotencyKey: key() });
    expect(soon).toMatchObject({ ok: false, status: 409 });
    expect((soon as any).error).toMatch(/10 minutes apart/);
  });

  it("refuses the fourth letter in a day", async () => {
    for (let i = 0; i < 3; i += 1) {
      const l = await previewed();
      const r = await sendLetter(deps(), l.id, { confirmToken: l.p.confirmToken, idempotencyKey: key() });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      // Past the ten-minute gap, still inside the day.
      await exec("UPDATE comms_letters SET sent_at = sent_at - INTERVAL 11 MINUTE WHERE sent_at > CURRENT_TIMESTAMP - INTERVAL 1 DAY");
    }
    const fourth = await previewed();
    const refused = await sendLetter(deps(), fourth.id, { confirmToken: fourth.p.confirmToken, idempotencyKey: key() });
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect((refused as any).error).toMatch(/at most 3 letters a day/);
    expect((await rows("SELECT state FROM comms_letters WHERE id = ?", [fourth.id]))[0].state).toBe("draft");
  });

  it("sends a scheduled letter when it is due, and not before", async () => {
    const { id, p } = await previewed();
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    const scheduled = await sendLetter(deps(), id, { confirmToken: p.confirmToken, idempotencyKey: key(), scheduledFor: at });
    expect(scheduled).toMatchObject({ ok: true, state: "scheduled" });
    expect(await runLettersJob(deps())).toMatchObject({ sent: 0 });
    await exec("UPDATE comms_letters SET scheduled_for = CURRENT_TIMESTAMP - INTERVAL 1 MINUTE WHERE id = ?", [id]);
    expect(await runLettersJob(deps({ lifecycle: () => "off" }))).toMatchObject({ sent: 0 });
    expect(await runLettersJob(deps())).toMatchObject({ sent: 1 });
    const letter = (await rows("SELECT state, posted_count FROM comms_letters WHERE id = ?", [id]))[0];
    expect(letter).toMatchObject({ state: "sent", posted_count: 3 });
  });

  it("resumes a send that stopped part way, once its claim is stale", async () => {
    const { id } = await previewed();
    // The claim happened and the process died with every recipient still pending.
    await exec("UPDATE comms_letters SET state = 'sending', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    expect(await runLettersJob(deps())).toMatchObject({ resumed: 0 });
    await exec("UPDATE comms_letters SET updated_at = CURRENT_TIMESTAMP - INTERVAL 11 MINUTE WHERE id = ?", [id]);
    expect(await runLettersJob(deps())).toMatchObject({ resumed: 1 });
    const snap = await rows("SELECT status FROM comms_letter_recipients WHERE letter_id = ?", [id]);
    expect(snap.map((r) => r.status)).toEqual(["posted", "posted", "posted"]);
    expect((await rows("SELECT state FROM comms_letters WHERE id = ?", [id]))[0].state).toBe("sent");
    expect((await rows("SELECT COUNT(*) AS n FROM comms_messages WHERE letter_id = ?", [id]))[0].n).toBe(3);
  });

  it("counts a journey step's outcomes: sent, delivered, said no after, came, reached the goal", async () => {
    const def = pathJourney("resident");
    const step = def.steps[0].key;
    const msg = async (n: number, contact: { id: string; email: string; userId: string | null }, enrollmentId: string) => {
      const mid = `msg_out_${n}`;
      await insertMessage(pool, {
        id: mid, idempotencyKey: `out-${n}`, contactId: contact.id, userId: contact.userId, toEmail: contact.email, emailKey: contact.email,
        kind: "paths", origin: "journey", subject: "Welcome", templateKey: null, templateVersion: null, journeyKey: def.key, stepKey: step,
        enrollmentId, letterId: null, bodyHtml: null, bodyText: null, attachments: null, replyTo: null, status: "queued", skipReason: null, sendAfter: null, expiresAt: null,
      });
      await markSent(pool, mid, { provider: "resend", providerMessageId: `p-out-${n}` });
      await exec("UPDATE comms_messages SET sent_at = CURRENT_TIMESTAMP - INTERVAL 2 DAY WHERE id = ?", [mid]);
      return mid;
    };
    await exec(
      "INSERT INTO comms_enrollments (id, journey_key, journey_version, contact_id, subject_ref, state, stop_reason, updated_at) VALUES " +
        "('en-out-1', ?, 1, ?, 'path:resident', 'stopped', 'resident_reserved', CURRENT_TIMESTAMP - INTERVAL 1 DAY), ('en-out-2', ?, 1, ?, 'path:resident', 'active', NULL, NULL)",
      [def.key, ada.id, def.key, ben.id],
    );
    const m1 = await msg(1, ada, "en-out-1");
    await msg(2, ben, "en-out-2");
    await applyReportStatus(pool, m1, { status: "delivered", from: ["sent"], stamp: "delivered_at", lastError: null, providerMessageId: null });
    await exec("INSERT INTO event_attendance (event_id, person_key, status, marked_by, marked_at) VALUES ('ev-out', ?, 'came', 'host', CURRENT_TIMESTAMP - INTERVAL 1 DAY)", [ada.userId]);
    await upsertPermission(pool, { contactId: ben.id, kind: "paths", state: "no", basis: "asked", source: "test", evidence: null });

    const out = await journeyOutcomes({ getPool: () => pool }, def);
    const first = out.steps.find((s) => s.stepKey === step)!;
    // Ada came to ev-out a day ago; Ben was marked at ev-l in the first case, today: both inside the 7 days.
    expect(first).toMatchObject({ sent: 2, delivered: 1, bounced: 0, unsubscribed: 1, came: 2, reachedGoal: 1 });
    // A mark from before the email does not count.
    await exec("UPDATE event_attendance SET marked_at = CURRENT_TIMESTAMP - INTERVAL 3 DAY WHERE event_id = 'ev-out'");
    expect((await journeyOutcomes({ getPool: () => pool }, def)).steps.find((s) => s.stepKey === step)).toMatchObject({ came: 1 });
    expect(out.goals).toContain("resident_reserved");
    expect(out.windowDays).toBe(7);
    // Its first-step rule is the paths lane's; with no answer it is "not measured", never a zero.
    expect(out.nextStepRule).toBe("resident_first_step_done");
  });
});
