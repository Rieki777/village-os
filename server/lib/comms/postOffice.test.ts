import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { enrollmentById } from "../../repos/commsJourneys";
import { messageById } from "../../repos/commsMessages";
import { enroll, stop, tick, touch } from "./journeys";
import { createMailer } from "./mailer";
import { drain, ledgerKey, post, type PostOfficeDeps } from "./postOffice";
import type { Transport, TransportMessage, TransportResult } from "./transport";

/**
 * The post office's door and its urgent path, the old mailer's answers kept
 * through it, and people put on and taken off journeys, all against a
 * provisioned scratch schema (docs/comms/BUILD_SPEC.md 5.1 and 5.6).
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

/** A provider that records what it is handed and answers what it is told. */
function recordingTransport(answer: () => TransportResult = () => ({ ok: true, providerId: `prov_${Math.random().toString(36).slice(2)}` })) {
  const sent: TransportMessage[] = [];
  const transport: Transport = {
    name: "resend",
    async send(m) {
      sent.push(m);
      return answer();
    },
  };
  return { sent, transport };
}

const office = (over: Partial<PostOfficeDeps> = {}): PostOfficeDeps => ({
  getPool: () => pool,
  transport: recordingTransport().transport,
  sender: () => "Village <hello@village.example.test>",
  hasApiKey: () => true,
  origin: () => "https://village.example.test",
  ...over,
});

const essential = (to: string, key: string) => ({
  idempotencyKey: key,
  kind: "essential" as const,
  origin: "auth.reset",
  to: { email: to },
  subject: "Set a new password",
  html: '<p><a href="https://village.example.test/set-password?token=SECRET">Set it</a></p>',
  text: "Set it: https://village.example.test/set-password?token=SECRET",
  urgent: true,
});

/** One scratch schema for the whole file: three would triple the provisioning and prove nothing more. */
beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

const row = async (id: string) =>
  (
    (await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT status, skip_reason, body_html, body_text, contact_id, last_error, provider_message_id FROM comms_messages WHERE id = ?",
      [id],
    )) as any
  )[0][0];

describe.skipIf(!configured)("the post office", () => {
  it("records an urgent essential email, sends it now under the row's id, and keeps no words", async () => {
    const { sent, transport } = recordingTransport(() => ({ ok: true, providerId: "prov_1" }));
    const result = await post(office({ transport }), essential("Ana@Example.test", "auth.reset:u-1:1"));
    expect(result).toMatchObject({ status: "sent", messageId: expect.stringMatching(/^msg_[0-9a-f]{24}$/) });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: result.messageId, kind: "essential", to: "Ana@Example.test", from: "Village <hello@village.example.test>" });
    // A password link never carries an unsubscribe header.
    expect(sent[0].listUnsubscribe).toBeNull();
    const stored = await row(result.messageId!);
    expect(stored).toMatchObject({ status: "sent", provider_message_id: "prov_1" });
    // The words of an essential email are never kept: they carry a link that acts for the person.
    expect(stored.body_html).toBeNull();
    expect(stored.body_text).toBeNull();
    expect(stored.contact_id).toMatch(/^ct_/);
    const read = await messageById(pool, result.messageId!);
    expect(read).toMatchObject({ toEmail: "Ana@Example.test", kind: "essential", origin: "auth.reset", attempts: 1 });
  });

  it("files one contact per address, however the address is cased, and keeps where it was first met", async () => {
    await post(office(), { ...essential("bo@example.test", "k-bo-1"), origin: "first.place" });
    await post(office(), { ...essential("  BO@example.test ", "k-bo-2"), origin: "second.place", to: { email: "  BO@example.test ", name: "Bo" } });
    const [contacts] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT email_key, first_source, name FROM comms_contacts WHERE email_key = 'bo@example.test'",
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ first_source: "first.place", name: "Bo" });
  });

  it("answers a used idempotency key as a duplicate naming the first row, and sends nothing twice", async () => {
    const { sent, transport } = recordingTransport();
    const first = await post(office({ transport }), essential("cy@example.test", "same-key"));
    const second = await post(office({ transport }), essential("cy@example.test", "same-key"));
    expect(second).toEqual({ status: "duplicate", messageId: first.messageId });
    expect(sent).toHaveLength(1);
  });

  it("keeps a key longer than the index as its hash, stably", async () => {
    const long = `journey:${"x".repeat(300)}`;
    expect(ledgerKey(long)).toMatch(/^[0-9a-f]{64}$/);
    expect(ledgerKey(long)).toBe(ledgerKey(long));
    const a = await post(office(), essential("dee@example.test", long));
    const b = await post(office(), essential("dee@example.test", long));
    expect(b).toEqual({ status: "duplicate", messageId: a.messageId });
  });

  it("records a skip, and calls no provider, when there is no key or no sender, and says which", async () => {
    const { sent, transport } = recordingTransport();
    const noKey = await post(office({ transport, hasApiKey: () => false }), essential("eve@example.test", "k-nokey"));
    expect(noKey).toMatchObject({ status: "skipped", reason: "no_api_key" });
    expect(await row(noKey.messageId!)).toMatchObject({ status: "skipped", skip_reason: "not_configured" });
    const noSender = await post(office({ transport, sender: () => "" }), essential("eve@example.test", "k-nosender"));
    expect(noSender).toMatchObject({ status: "skipped", reason: "no_sender" });
    expect(sent).toHaveLength(0);
  });

  it("records an address nobody can write to as skipped, with no contact and no call", async () => {
    const { sent, transport } = recordingTransport();
    const result = await post(office({ transport }), essential("not an address", "k-bad"));
    expect(result).toMatchObject({ status: "skipped", reason: "bad_address" });
    expect(await row(result.messageId!)).toMatchObject({ status: "skipped", skip_reason: "bad_address", contact_id: null });
    expect(sent).toHaveLength(0);
  });

  it("records a provider's refusal as failed, in the provider's words", async () => {
    const { transport } = recordingTransport(() => ({ ok: false, retryable: false, status: 422, error: "Resend answered 422: bad from" }));
    const result = await post(office({ transport }), essential("fin@example.test", "k-refused"));
    expect(result).toMatchObject({ status: "failed", reason: "rejected" });
    expect(await row(result.messageId!)).toMatchObject({ status: "failed", last_error: "Resend answered 422: bad from" });
  });

  it("leaves an email that is not urgent queued for the drain, with its words kept", async () => {
    const { sent, transport } = recordingTransport();
    const result = await post(office({ transport }), {
      idempotencyKey: "j:gathering.going:day:enr_1",
      kind: "events",
      origin: "journey",
      to: { email: "gus@example.test" },
      subject: "Seed swap is tomorrow",
      html: "<p>See you tomorrow.</p>",
      text: "See you tomorrow.",
      sendAfter: new Date(Date.now() + 3_600_000),
    });
    expect(result).toMatchObject({ status: "queued" });
    expect(sent).toHaveLength(0);
    expect(await row(result.messageId!)).toMatchObject({ status: "queued", body_html: "<p>See you tomorrow.</p>", body_text: "See you tomorrow." });
    expect(await drain(office())).toEqual({ sent: 0, failed: 0, skipped: 0, expired: 0, requeued: 0 });
  });

  it("puts a one-click unsubscribe on an urgent email of any other kind", async () => {
    const { sent, transport } = recordingTransport();
    await post(office({ transport }), {
      idempotencyKey: "confirm:ev-1:hal",
      kind: "events",
      origin: "journey",
      to: { email: "hal@example.test" },
      subject: "Seed swap: you are coming",
      html: "<p>You said yes.</p>",
      text: "You said yes.",
      urgent: true,
    });
    expect(sent[0].listUnsubscribe).toEqual({
      url: expect.stringMatching(/^https:\/\/village\.example\.test\/api\/comms\/unsubscribe\?t=[A-Za-z0-9_.%-]+$/),
      mailto: "hello@village.example.test",
    });
  });

  it("sends an urgent essential email even when the ledger cannot be written, and refuses anything else", async () => {
    const broken = { query: async () => { throw new Error("the database is gone"); } } as unknown as Pool;
    const { sent, transport } = recordingTransport(() => ({ ok: true, providerId: "prov_lockout" }));
    const reset = await post(office({ transport, getPool: () => broken }), essential("ivy@example.test", "k-fault"));
    expect(reset, "a person asking to get back in is never locked out by a table").toEqual({ status: "sent", messageId: null });
    expect(sent).toHaveLength(1);
    const letter = await post(office({ transport, getPool: () => broken }), {
      idempotencyKey: "letter:1:ivy", kind: "letters", origin: "letter", to: { email: "ivy@example.test" },
      subject: "News", html: "<p>News</p>", text: "News", urgent: true,
    });
    expect(letter).toEqual({ status: "failed", messageId: null, reason: "ledger_unavailable" });
    expect(sent, "nothing else goes out unrecorded").toHaveLength(1);
  });
});

describe.skipIf(!configured)("sendResendEmail, through the post office", () => {
  // The sender falls back to EMAIL_FROM, so the shell running this suite must
  // not decide what "no sender" means here.
  const savedFrom = process.env.EMAIL_FROM;
  beforeAll(() => {
    delete process.env.EMAIL_FROM;
  });
  afterAll(() => {
    if (savedFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = savedFrom;
  });

  const mailer =(over: { key?: string; sender?: string; answer?: () => TransportResult } = {}) => {
    const { sent, transport } = recordingTransport(over.answer);
    const m = createMailer({
      emailConfig: () => ({ sender: over.sender ?? "Village <hello@village.example.test>" }),
      secretValue: (k) => (k === "resend_api_key" ? (over.key ?? "re_test_key") : ""),
      projectName: () => "Test Village",
      getPool: () => pool,
      origin: () => "https://village.example.test",
      transport,
    });
    return { ...m, sent };
  };

  it("answers sent, and writes one essential row per recipient, splitting a comma list", async () => {
    const m = mailer();
    expect(await m.sendResendEmail({ to: ["a1@example.test, a2@example.test", "a1@example.test"], subject: "Hello", html: "<p>Hi</p>" })).toEqual({ sent: true });
    expect(m.sent.map((s) => s.to)).toEqual(["a1@example.test", "a2@example.test"]);
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT kind, origin, status FROM comms_messages WHERE to_email IN ('a1@example.test', 'a2@example.test')",
    );
    expect(rows.map((r) => [r.kind, r.origin, r.status])).toEqual([
      ["essential", "mail.direct", "sent"],
      ["essential", "mail.direct", "sent"],
    ]);
  });

  it("keeps the old order of answers: no key, then no sender, before no recipients", async () => {
    expect(await mailer({ key: "" }).sendResendEmail({ to: [], subject: "x", html: "x" })).toEqual({ sent: false, reason: "no_api_key" });
    expect(await mailer({ sender: "not a sender" }).sendResendEmail({ to: [], subject: "x", html: "x" })).toEqual({ sent: false, reason: "no_sender" });
    expect(await mailer().sendResendEmail({ to: ["nobody"], subject: "x", html: "x" })).toEqual({ sent: false, reason: "no_recipients" });
    expect(await mailer({ key: "" }).sendResendEmail({ to: ["b1@example.test"], subject: "x", html: "x" })).toEqual({ sent: false, reason: "no_api_key" });
    expect(await mailer({ sender: "" }).sendResendEmail({ to: ["b1@example.test"], subject: "x", html: "x" })).toEqual({ sent: false, reason: "no_sender" });
  });

  it("answers a refusal as rejected and an unreachable provider as failed, as it always did", async () => {
    expect(
      await mailer({ answer: () => ({ ok: false, retryable: false, status: 422, error: "no" }) }).sendResendEmail({ to: ["c1@example.test"], subject: "x", html: "x" }),
    ).toEqual({ sent: false, reason: "rejected" });
    expect(
      await mailer({ answer: () => ({ ok: false, retryable: true, error: "unreachable" }) }).sendResendEmail({ to: ["c2@example.test"], subject: "x", html: "x" }),
    ).toEqual({ sent: false, reason: "failed" });
  });
});

describe.skipIf(!configured)("people on journeys", () => {
  const deps = { getPool: () => pool };

  it("enrolls a person once per journey and subject, at the platform default's version", async () => {
    const a = await enroll(deps, { journeyKey: "gathering.going", contactId: "ct_1", subjectRef: "event:ev-1:", facts: { why: "rsvp" } });
    const b = await enroll(deps, { journeyKey: "gathering.going", contactId: "ct_1", subjectRef: "event:ev-1:" });
    expect(a.created).toBe(true);
    expect(b).toEqual({ enrollmentId: a.enrollmentId, created: false });
    const row = await enrollmentById(pool, a.enrollmentId);
    expect(row).toMatchObject({ journeyKey: "gathering.going", journeyVersion: 1, state: "active", subjectRef: "event:ev-1:" });
    expect(row!.nextCheckAt, "the next tick plans it").not.toBeNull();
  });

  it("stops by a subject that ends where an id does, and never by a longer id that starts the same", async () => {
    const one = await enroll(deps, { journeyKey: "gathering.going", contactId: "ct_2", subjectRef: "event:ev-2:" });
    const evening = await enroll(deps, { journeyKey: "gathering.going", contactId: "ct_2", subjectRef: "event:ev-2:2026-10-09" });
    const neighbour = await enroll(deps, { journeyKey: "gathering.going", contactId: "ct_2", subjectRef: "event:ev-20:" });
    expect(await stop(deps, { subjectRef: "event:ev-2" }, "gathering_cancelled")).toBe(2);
    expect((await enrollmentById(pool, one.enrollmentId))?.state).toBe("stopped");
    expect((await enrollmentById(pool, evening.enrollmentId))?.stopReason).toBe("gathering_cancelled");
    expect((await enrollmentById(pool, neighbour.enrollmentId))?.state, "ev-20 is not ev-2").toBe("active");
    // With no condition, nothing at all.
    expect(await stop(deps, {}, "everything")).toBe(0);
    expect((await enrollmentById(pool, neighbour.enrollmentId))?.state).toBe("active");
  });

  it("picks a stopped enrollment up again when the person comes back", async () => {
    const first = await enroll(deps, { journeyKey: "path.resident", contactId: "ct_3", subjectRef: "path:resident" });
    expect(await stop(deps, { journeyKey: "path.resident", contactId: "ct_3" }, "left_path")).toBe(1);
    const again = await enroll(deps, { journeyKey: "path.resident", contactId: "ct_3", subjectRef: "path:resident" });
    expect(again).toEqual({ enrollmentId: first.enrollmentId, created: false });
    expect(await enrollmentById(pool, first.enrollmentId)).toMatchObject({ state: "active", stopReason: null });
  });

  it("touches every active enrollment on a subject so the next tick re-plans it", async () => {
    const a = await enroll(deps, { journeyKey: "gathering.going", contactId: "ct_4", subjectRef: "event:ev-4:" });
    await pool.query( // module-review-ok: moving an anchor in the scratch schema, the way the spec's suites drive time
      "UPDATE comms_enrollments SET next_check_at = CURRENT_TIMESTAMP + INTERVAL 1 DAY WHERE id = ?",
      [a.enrollmentId],
    );
    const later = (await enrollmentById(pool, a.enrollmentId))!.nextCheckAt!;
    expect(await touch(deps, "event:ev-4")).toBe(1);
    expect((await enrollmentById(pool, a.enrollmentId))!.nextCheckAt!).toBeLessThan(later);
    expect(await touch(deps, "event:ev-40")).toBe(0);
    expect(await tick(deps)).toEqual({ checked: 0, posted: 0, stopped: 0 });
  });

  it("refuses a malformed enrollment as a caller's bug", async () => {
    await expect(enroll(deps, { journeyKey: "", contactId: "ct_5", subjectRef: "account" })).rejects.toThrow(RangeError);
    await expect(stop(deps, { contactId: "ct_5" }, "")).rejects.toThrow(RangeError);
  });
});
