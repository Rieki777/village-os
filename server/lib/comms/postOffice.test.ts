import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { OutgoingEmail } from "../../../shared/comms/contracts";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { enrollmentById } from "../../repos/commsJourneys";
import { insertMessage, messageById } from "../../repos/commsMessages";
import { startFakeResend, type FakeResend } from "../../testkit/fakeResend";
import { insertNotification, runNotificationDigest, runWeeklyBrief, type NotifyDeps } from "../notify";
import { enroll, stop, tick, touch } from "./journeys";
import { verifyLink } from "./links";
import { createMailer } from "./mailer";
import {
  defaultMode,
  drain,
  ledgerKey,
  post,
  RETRY_BACKOFF_SECONDS,
  runPostOfficeJob,
  type CommsMode,
  type PostOfficeDeps,
  type PostOfficeDial,
} from "./postOffice";
import { addSuppression } from "./suppressions";
import { resendTransport, type Transport, type TransportMessage, type TransportResult } from "./transport";

/**
 * The post office's door, its urgent path and its drain, the old mailer's
 * answers kept through it, and people put on and taken off journeys, all
 * against a provisioned scratch schema (the comms build spec 5.1, 5.2 and
 * 5.6). The sends that matter go to the fake provider through the real
 * transport, so what the provider was handed is read off the wire.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;
let fake: FakeResend;
const KEY = "re_test_lane_b1";

/** Live: the module is on, nothing is paused, nobody rehearses. */
const LIVE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };

/** The dials, at the platform's defaults except a send rate fast enough for a test. */
const DIALS: Record<PostOfficeDial, number> = {
  "comms.daily_cap": 2,
  "comms.send_rate_per_second": 50,
  "comms.notice_expiry_minutes": 120,
};

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
  mode: async () => LIVE,
  dial: (k) => DIALS[k],
  ...over,
});

/** The same office, sending through the real transport to the fake provider. */
const viaFake = (over: Partial<PostOfficeDeps> = {}): PostOfficeDeps =>
  office({ transport: resendTransport({ apiKey: () => KEY, baseUrl: () => fake.url }), ...over });

/** An email of any kind, unique by its key. */
const email = (kind: OutgoingEmail["kind"], to: string, key: string, over: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  idempotencyKey: key,
  kind,
  origin: kind === "notices" ? "notify.immediate" : kind === "letters" ? "letter" : "journey",
  to: { email: to },
  subject: `A ${kind} email`,
  html: `<p>A ${kind} email.</p>`,
  text: `A ${kind} email.`,
  ...over,
});

/** What the fake provider was asked to send under one row id, and what it accepted. */
const onTheWire = (rowId: string | null) => ({
  requests: fake.requests.filter((r) => r.method === "POST" && r.path === "/emails" && r.headers["idempotency-key"] === rowId),
  accepted: fake.emails().filter((e) => e.idempotencyKey === rowId),
});

/** Nothing left waiting from an earlier case, so a drain here sends only what this case wrote. */
async function clearQueue(): Promise<void> {
  await pool.query( // module-review-ok: resetting the scratch schema this suite provisioned between cases
    "UPDATE comms_messages SET status = 'cancelled' WHERE status IN ('queued', 'sending')",
  );
}

/** Move a row's clocks, the way the spec's suites drive time. */
async function dueNow(id: string): Promise<void> {
  await pool.query( // module-review-ok: moving an anchor in the scratch schema, the way the spec's suites drive time
    "UPDATE comms_messages SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL 1 SECOND, send_after = NULL WHERE id = ?",
    [id],
  );
}

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
  fake = await startFakeResend({ apiKey: KEY });
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
});

afterAll(async () => {
  await fake?.close();
  await pool?.end();
  await db?.drop();
});

const row = async (id: string) =>
  (
    (await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT status, skip_reason, body_html, body_text, contact_id, last_error, provider_message_id, attempts, rehearsal_to, " +
        "UNIX_TIMESTAMP(next_attempt_at) - UNIX_TIMESTAMP(CURRENT_TIMESTAMP) AS retry_in, " +
        "UNIX_TIMESTAMP(send_after) - UNIX_TIMESTAMP(CURRENT_TIMESTAMP) AS send_in FROM comms_messages WHERE id = ?",
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
    // Not due for an hour, so a drain now leaves it where it is.
    expect(await drain(office())).toEqual({ sent: 0, rehearsed: 0, failed: 0, skipped: 0, expired: 0, requeued: 0 });
    expect(await row(result.messageId!)).toMatchObject({ status: "queued" });
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

  it("prints the old no-key line once per call however many recipients, and records each one skipped", async () => {
    /*
     * server/housing.routes.e2e.test.ts counts this exact line as one send per
     * call, and the move out of server/index.ts dropped it once: the e2e went
     * red after four minutes. This says it in a second.
     */
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    const m = mailer({ key: "" });
    let answer;
    try {
      answer = await m.sendResendEmail({ to: ["d1@example.test, d2@example.test"], subject: "x", html: "x" });
    } finally {
      spy.mockRestore();
    }
    expect(answer).toEqual({ sent: false, reason: "no_api_key" });
    expect(m.sent, "no provider was called").toEqual([]);
    expect(lines.filter((l) => l === "[RESEND] API key not set, skipping email")).toHaveLength(1);
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT status, skip_reason FROM comms_messages WHERE to_email IN ('d1@example.test', 'd2@example.test') ORDER BY to_email",
    );
    expect(rows.map((r) => [r.status, r.skip_reason])).toEqual([
      ["skipped", "not_configured"],
      ["skipped", "not_configured"],
    ]);
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

describe.skipIf(!configured)("the post office against the fake provider: lane B1's acceptance", () => {
  it("post twice with one key sends once", async () => {
    await clearQueue();
    const d = viaFake();
    const first = await post(d, email("events", "once@example.test", "acc:once:urgent", { urgent: true }));
    const second = await post(d, email("events", "once@example.test", "acc:once:urgent", { urgent: true }));
    expect(first.status).toBe("sent");
    expect(second).toEqual({ status: "duplicate", messageId: first.messageId });
    expect(onTheWire(first.messageId).requests).toHaveLength(1);
    // And through the queue: two posts, one row, one send, however many drains.
    const a = await post(d, email("letters", "once@example.test", "acc:once:queued"));
    const b = await post(d, email("letters", "once@example.test", "acc:once:queued"));
    expect(b).toEqual({ status: "duplicate", messageId: a.messageId });
    await drain(d);
    await drain(d);
    expect(onTheWire(a.messageId).accepted).toHaveLength(1);
    expect(await row(a.messageId!)).toMatchObject({ status: "sent" });
  });

  it("urgent essential reaches the fake and the row says sent", async () => {
    const r = await post(viaFake(), essential("urgent@example.test", "acc:urgent:essential"));
    expect(r).toMatchObject({ status: "sent" });
    const wire = onTheWire(r.messageId);
    expect(wire.accepted).toHaveLength(1);
    expect(wire.requests[0].body).toMatchObject({ to: ["urgent@example.test"], subject: "Set a new password" });
    expect(await row(r.messageId!)).toMatchObject({ status: "sent", provider_message_id: wire.accepted[0].id, body_html: null });
  });

  it("429 then 200 retries and sends once (the fake saw the same Idempotency-Key twice)", async () => {
    await clearQueue();
    const d = viaFake();
    const queued = await post(d, email("paths", "retry@example.test", "acc:429"));
    fake.failNext(429);
    expect(await drain(d)).toMatchObject({ sent: 0, requeued: 1 });
    const waiting = await row(queued.messageId!);
    expect(waiting).toMatchObject({ status: "queued", attempts: 1 });
    expect(String(waiting.last_error)).toContain("429");
    expect(Number(waiting.retry_in), "the first wait is a minute").toBeGreaterThan(50);
    await dueNow(queued.messageId!);
    expect(await drain(d)).toMatchObject({ sent: 1 });
    const wire = onTheWire(queued.messageId);
    expect(wire.requests, "the same row, asked twice under its own id").toHaveLength(2);
    expect(wire.accepted, "and accepted once").toHaveLength(1);
    expect(await row(queued.messageId!)).toMatchObject({ status: "sent", attempts: 2, last_error: null });
  });

  it("two drains at once send each row once", async () => {
    await clearQueue();
    const d = viaFake();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await post(d, email("notices", `twice${i}@example.test`, `acc:twice:${i}`))).messageId!);
    const [a, b] = await Promise.all([drain(d), drain(d)]);
    expect(a.sent + b.sent).toBe(6);
    for (const id of ids) {
      expect(onTheWire(id).requests, id).toHaveLength(1);
      expect(await row(id)).toMatchObject({ status: "sent" });
    }
  });

  it("an expired notice never sends", async () => {
    await clearQueue();
    const d = viaFake();
    const late = await post(d, email("notices", "late@example.test", "acc:expired:insert", { expiresAt: new Date(Date.now() - 1000) }));
    expect(late).toMatchObject({ status: "expired" });
    const waiting = await post(d, email("notices", "late@example.test", "acc:expired:queue", { expiresAt: new Date(Date.now() + 3_600_000) }));
    expect(waiting.status).toBe("queued");
    await pool.query( // module-review-ok: moving an anchor in the scratch schema, the way the spec's suites drive time
      "UPDATE comms_messages SET expires_at = CURRENT_TIMESTAMP - INTERVAL 1 SECOND WHERE id = ?",
      [waiting.messageId],
    );
    expect(await drain(d)).toMatchObject({ sent: 0, expired: 1 });
    for (const r of [late, waiting]) {
      expect(await row(r.messageId!)).toMatchObject({ status: "expired", skip_reason: "expired" });
      expect(onTheWire(r.messageId).requests).toHaveLength(0);
    }
  });

  it("a suppressed address skips non-essential with skip_reason suppressed and still sends essential", async () => {
    await clearQueue();
    const d = viaFake();
    await addSuppression(pool, { email: "Stopped@Example.test", reason: "unsubscribed_all" });
    for (const kind of ["events", "paths", "letters", "notices"] as const) {
      const r = await post(d, email(kind, "stopped@example.test", `acc:suppressed:${kind}`));
      expect(r, kind).toMatchObject({ status: "skipped", reason: "suppressed" });
      expect(await row(r.messageId!)).toMatchObject({ status: "skipped", skip_reason: "suppressed" });
    }
    const pw = await post(d, essential("stopped@example.test", "acc:suppressed:essential"));
    expect(pw, "the person just asked for it").toMatchObject({ status: "sent" });
    expect(onTheWire(pw.messageId).accepted).toHaveLength(1);
    // Asked again at send time: suppressed after it was queued, skipped by the drain.
    const queued = await post(d, email("letters", "later@example.test", "acc:suppressed:later"));
    expect(queued.status).toBe("queued");
    await addSuppression(pool, "later@example.test", "complained");
    await drain(d);
    expect(await row(queued.messageId!)).toMatchObject({ status: "skipped", skip_reason: "suppressed" });
    expect(onTheWire(queued.messageId).requests).toHaveLength(0);
  });

  it("rehearsal reroutes events, paths and letters to rehearsalTo and records rehearsal_to, while essential reaches the person", async () => {
    await clearQueue();
    const d = viaFake({
      mode: async () => ({ lifecycle: "preview", paused: false, rehearsalTo: ["rehearse@example.test", "Rehearse@Example.test"] }),
    });
    const confirm = await post(d, email("events", "ana@example.test", "acc:rehearse:events", { urgent: true, subject: "Seed swap: you are coming" }));
    expect(confirm).toMatchObject({ status: "rehearsed" });
    const req = onTheWire(confirm.messageId).requests[0];
    expect(req.body.to, "to the rehearsal inbox, each address once").toEqual(["rehearse@example.test"]);
    expect(req.body.subject).toBe("Rehearsal: Seed swap: you are coming");
    expect(String(req.body.html)).toContain("would have gone to ana@example.test");
    expect(String(req.body.text)).toContain("would have gone to ana@example.test");
    expect(req.body.headers, "no unsubscribe link signed for Ana lands in an admin's inbox").toBeUndefined();
    expect(await row(confirm.messageId!)).toMatchObject({ status: "rehearsed", rehearsal_to: "rehearse@example.test" });

    const path = await post(d, email("paths", "ana@example.test", "acc:rehearse:paths"));
    const letter = await post(d, email("letters", "ana@example.test", "acc:rehearse:letters"));
    expect(await drain(d)).toMatchObject({ rehearsed: 2, sent: 0 });
    for (const r of [path, letter]) {
      expect(await row(r.messageId!)).toMatchObject({ status: "rehearsed", rehearsal_to: "rehearse@example.test" });
      expect(onTheWire(r.messageId).requests[0].body.to).toEqual(["rehearse@example.test"]);
    }

    const pw = await post(d, essential("ana@example.test", "acc:rehearse:essential"));
    expect(pw).toMatchObject({ status: "sent" });
    expect(onTheWire(pw.messageId).requests[0].body.to, "essential mail reaches the person").toEqual(["ana@example.test"]);
    const notice = await post(d, email("notices", "ana@example.test", "acc:rehearse:notice"));
    await drain(d);
    expect(onTheWire(notice.messageId).requests[0].body.to, "and so do notices").toEqual(["ana@example.test"]);
    expect(await row(notice.messageId!)).toMatchObject({ status: "sent", rehearsal_to: null });
  });

  it("pause holds letters and lets notices through", async () => {
    await clearQueue();
    let paused = true;
    const d = viaFake({ mode: async () => ({ ...LIVE, paused }) });
    const letter = await post(d, email("letters", "paused@example.test", "acc:pause:letter"));
    expect(letter).toMatchObject({ status: "queued", reason: "paused" });
    const confirm = await post(d, email("events", "paused@example.test", "acc:pause:event", { urgent: true }));
    expect(confirm, "even an urgent gathering email waits").toMatchObject({ status: "queued", reason: "paused" });
    const notice = await post(d, email("notices", "paused@example.test", "acc:pause:notice"));
    const pw = await post(d, essential("paused@example.test", "acc:pause:essential"));
    expect(pw).toMatchObject({ status: "sent" });
    expect(await drain(d)).toMatchObject({ sent: 1 });
    expect(await row(notice.messageId!)).toMatchObject({ status: "sent" });
    expect(await row(letter.messageId!)).toMatchObject({ status: "queued" });
    expect(onTheWire(letter.messageId).requests).toHaveLength(0);
    paused = false;
    expect(await drain(d)).toMatchObject({ sent: 2 });
    expect(await row(letter.messageId!)).toMatchObject({ status: "sent" });
    expect(await row(confirm.messageId!)).toMatchObject({ status: "sent" });
  });

  it("the header pair is present on a non-essential send and absent on essential", async () => {
    const d = viaFake();
    const ev = await post(d, email("events", "headers@example.test", "acc:headers:events", { urgent: true }));
    const headers = onTheWire(ev.messageId).requests[0].body.headers;
    expect(headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/village\.example\.test\/api\/comms\/unsubscribe\?t=[^>]+>, <mailto:hello@village\.example\.test\?subject=unsubscribe>$/,
    );
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // The link is signed for this contact and this kind, and nothing else.
    const token = decodeURIComponent(String(headers["List-Unsubscribe"]).match(/\?t=([^>]+)>/)![1]);
    expect(verifyLink("unsubscribe", token)).toEqual({ c: (await row(ev.messageId!)).contact_id, k: "events" });
    const pw = await post(d, essential("headers@example.test", "acc:headers:essential"));
    expect(onTheWire(pw.messageId).requests[0].body.headers).toBeUndefined();
  });
});

describe.skipIf(!configured)("the drain's rules", () => {
  it("backs a retryable failure off 1 minute, 5, 30, 2 hours and 6 hours, then fails it", async () => {
    await clearQueue();
    const { transport } = recordingTransport(() => ({ ok: false, retryable: true, status: 503, error: "Resend answered 503: busy" }));
    const d = office({ transport });
    const r = await post(d, email("paths", "backoff@example.test", "rules:backoff"));
    for (const wait of RETRY_BACKOFF_SECONDS) {
      await drain(d);
      const now = await row(r.messageId!);
      expect(now.status).toBe("queued");
      expect(Number(now.retry_in), `waits ${wait}s`).toBeGreaterThanOrEqual(wait - 5);
      expect(Number(now.retry_in), `waits ${wait}s`).toBeLessThanOrEqual(wait + 1);
      await dueNow(r.messageId!);
    }
    await drain(d);
    expect(await row(r.messageId!)).toMatchObject({ status: "failed", attempts: 6, last_error: "Resend answered 503: busy" });
  });

  it("fails a 4xx at once, in the provider's words", async () => {
    await clearQueue();
    const d = viaFake();
    const r = await post(d, email("letters", "refused@example.test", "rules:422"));
    fake.failNext(422);
    expect(await drain(d)).toMatchObject({ failed: 1, requeued: 0 });
    const failed = await row(r.messageId!);
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(String(failed.last_error)).toContain("The fake provider refused this email.");
  });

  it("puts a row stuck in sending for ten minutes back in the queue, and sends it once", async () => {
    await clearQueue();
    const d = viaFake();
    const stale = await post(d, email("notices", "stuck@example.test", "rules:stale"));
    const fresh = await post(d, email("notices", "stuck@example.test", "rules:fresh-claim"));
    await pool.query( // module-review-ok: a drain that died ten minutes ago, staged in the scratch schema
      "UPDATE comms_messages SET status = 'sending', updated_at = CURRENT_TIMESTAMP - INTERVAL 11 MINUTE WHERE id = ?",
      [stale.messageId],
    );
    await pool.query( // module-review-ok: a drain still working, staged in the scratch schema
      "UPDATE comms_messages SET status = 'sending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [fresh.messageId],
    );
    expect(await drain(d)).toMatchObject({ requeued: 1, sent: 1 });
    expect(await row(stale.messageId!)).toMatchObject({ status: "sent" });
    expect(onTheWire(stale.messageId).accepted).toHaveLength(1);
    expect(await row(fresh.messageId!), "a claim younger than ten minutes is left to its drain").toMatchObject({ status: "sending" });
  });

  it("marks an essential row its request left unsent as failed, in words, and never drains it", async () => {
    await clearQueue();
    const { sent, transport } = recordingTransport();
    await insertMessage(pool, {
      id: "msg_stale_essential",
      idempotencyKey: "rules:stale-essential",
      contactId: null,
      userId: null,
      toEmail: "gone@example.test",
      emailKey: "gone@example.test",
      kind: "essential",
      origin: "auth.reset",
      subject: "Set a new password",
      templateKey: null,
      templateVersion: null,
      journeyKey: null,
      stepKey: null,
      enrollmentId: null,
      letterId: null,
      bodyHtml: null,
      bodyText: null,
      attachments: null,
      replyTo: null,
      status: "sending",
      skipReason: null,
      sendAfter: null,
      expiresAt: null,
    });
    await pool.query( // module-review-ok: a request that died eleven minutes ago, staged in the scratch schema
      "UPDATE comms_messages SET created_at = CURRENT_TIMESTAMP - INTERVAL 11 MINUTE WHERE id = 'msg_stale_essential'",
    );
    expect(await drain(office({ transport }))).toMatchObject({ failed: 1 });
    const stale = await row("msg_stale_essential");
    expect(stale.status).toBe("failed");
    expect(String(stale.last_error)).toContain("never kept");
    expect(sent).toHaveLength(0);
  });

  it("defers a third path email over the daily cap to the next window, and never drops it", async () => {
    await clearQueue();
    const d = viaFake();
    const to = "capped@example.test";
    await post(d, email("paths", to, "rules:cap:1", { urgent: true }));
    await post(d, email("letters", to, "rules:cap:2", { urgent: true }));
    expect((await post(d, email("events", to, "rules:cap:events", { urgent: true }))).status, "gathering emails do not count").toBe("sent");
    expect((await post(d, email("notices", to, "rules:cap:notice"))).status, "notices do not count").toBe("queued");
    const third = await post(d, email("paths", to, "rules:cap:3"));
    expect(third).toMatchObject({ status: "queued", reason: "over_cap" });
    const waiting = await row(third.messageId!);
    // The oldest send leaves the window a day after it went, and that opens the next one.
    expect(Number(waiting.send_in)).toBeGreaterThan(86_400 - 60);
    expect(Number(waiting.send_in)).toBeLessThanOrEqual(86_400 + 1);
    await drain(d);
    expect(await row(third.messageId!)).toMatchObject({ status: "queued" });
    expect(onTheWire(third.messageId).requests).toHaveLength(0);
    // A caller allowed past the cap is not held by it.
    expect(await post(d, email("letters", to, "rules:cap:bypass", { urgent: true, bypassCap: true }))).toMatchObject({ status: "sent" });
  });

  it("counts the cap again at send time", async () => {
    await clearQueue();
    const d = viaFake();
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await post(d, email("letters", "capped-later@example.test", `rules:cap-later:${i}`)));
    expect(rows.map((r) => r.status), "nothing sent yet, so nothing over the cap when written").toEqual(["queued", "queued", "queued"]);
    expect(await drain(d)).toMatchObject({ sent: 2, requeued: 1 });
    // Three rows written in one second tie on created_at, so WHICH one waits is
    // the drain's choice. That exactly one does, until the next window, is the rule.
    const after = await Promise.all(rows.map((r) => row(r.messageId!)));
    expect(after.map((a) => a.status).sort()).toEqual(["queued", "sent", "sent"]);
    expect(Number(after.find((a) => a.status === "queued").send_in)).toBeGreaterThan(86_400 - 60);
  });

  it("skips gathering, path and letter emails while the module is off, and still sends notices and essential mail", async () => {
    await clearQueue();
    // No mode and no lifecycle handed in: the default reads off, which is how every module ships.
    const d = viaFake({ mode: undefined });
    for (const kind of ["events", "paths", "letters"] as const) {
      expect(await post(d, email(kind, "off@example.test", `rules:off:${kind}`)), kind).toMatchObject({ status: "skipped", reason: "module_off" });
    }
    expect(await post(d, email("notices", "off@example.test", "rules:off:notices"))).toMatchObject({ status: "queued" });
    expect(await post(d, essential("off@example.test", "rules:off:essential"))).toMatchObject({ status: "sent" });
  });

  it("rehearses to the admins by default while the module is in preview", async () => {
    const admins = async () => ["founder@example.test"];
    expect(await defaultMode({ adminEmails: admins, lifecycle: () => "preview" })).toEqual({
      lifecycle: "preview",
      paused: false,
      rehearsalTo: ["founder@example.test"],
    });
    // The admins are only read while rehearsing.
    let asked = 0;
    const counted = async () => {
      asked += 1;
      return [] as string[];
    };
    await defaultMode({ adminEmails: counted, lifecycle: () => "members" });
    expect(asked).toBe(0);
    expect(await defaultMode({})).toEqual({ lifecycle: "off", paused: false, rehearsalTo: [] });

    await clearQueue();
    const d = viaFake({ mode: undefined, lifecycle: () => "preview", adminEmails: admins });
    const r = await post(d, email("events", "bo@example.test", "rules:default-rehearsal", { urgent: true }));
    expect(r).toMatchObject({ status: "rehearsed" });
    expect(onTheWire(r.messageId).requests[0].body.to).toEqual(["founder@example.test"]);
    // The mailer hands both readers to the post office it builds.
    const m = createMailer({
      emailConfig: () => ({ sender: "Village <hello@village.example.test>" }),
      secretValue: (k) => (k === "resend_api_key" ? KEY : ""),
      projectName: () => "Test Village",
      getPool: () => pool,
      origin: () => "https://village.example.test",
      transport: resendTransport({ apiKey: () => KEY, baseUrl: () => fake.url }),
      lifecycle: () => "preview",
      adminEmails: admins,
    });
    const viaMailer = await post(m.postOffice, email("letters", "cy@example.test", "rules:default-rehearsal:mailer", { urgent: true }));
    expect(viaMailer).toMatchObject({ status: "rehearsed" });
  });

  it("skips an email nobody said yes to, and leaves one waiting when the answer cannot be read", async () => {
    await clearQueue();
    const no = viaFake({ permissionFor: async () => ({ allowed: false }) });
    expect(await post(no, email("letters", "nope@example.test", "rules:perm:no"))).toMatchObject({ status: "skipped", reason: "no_permission" });
    const broken = viaFake({
      permissionFor: async () => {
        throw new Error("the address book is unreachable");
      },
    });
    const held = await post(broken, email("letters", "unknown@example.test", "rules:perm:throws"));
    expect(held).toMatchObject({ status: "queued", reason: "unavailable" });
    expect(await drain(broken)).toMatchObject({ sent: 0, requeued: 1 });
    expect(await row(held.messageId!)).toMatchObject({ status: "queued" });
  });

  it("returns early from the job with a reason when nothing is configured, and touches no row", async () => {
    await clearQueue();
    const queued = await post(office(), email("notices", "waits@example.test", "rules:job"));
    const { sent, transport } = recordingTransport();
    expect(await runPostOfficeJob(office({ transport, hasApiKey: () => false }))).toBe("nothing sent: no provider key is set");
    expect(await runPostOfficeJob(office({ transport, sender: () => "" }))).toBe("nothing sent: no sender address is configured");
    expect(sent).toHaveLength(0);
    expect(await row(queued.messageId!)).toMatchObject({ status: "queued" });
    expect(await runPostOfficeJob(office({ transport }))).toMatch(/^sent 1, rehearsed 0, failed 0,/);
  });

  it("stops at its limit and leaves the rest for the next run", async () => {
    await clearQueue();
    const d = viaFake();
    for (let i = 0; i < 3; i++) await post(d, email("notices", `limit${i}@example.test`, `rules:limit:${i}`));
    expect(await drain(d, { limit: 2 })).toMatchObject({ sent: 2 });
    expect(await drain(d, { limit: 2 })).toMatchObject({ sent: 1 });
  });
});

describe.skipIf(!configured)("notices through the post office: the notification spine", () => {
  const SENDER = "Village <hello@village.example.test>";
  const mailer = (key = KEY) =>
    createMailer({
      emailConfig: () => ({ sender: SENDER }),
      secretValue: (k) => (k === "resend_api_key" ? key : ""),
      projectName: () => "Test Village",
      getPool: () => pool,
      origin: () => "https://village.example.test",
      transport: resendTransport({ apiKey: () => key, baseUrl: () => fake.url }),
    });
  const spine = (key = KEY): NotifyDeps => ({
    pool,
    memberById: async (id: string) => ({ id, email: `${id}@example.test`, passwordHash: "hash", prefs: {} }),
    sendEmail: mailer(key).sendNotice,
    origin: () => "https://village.example.test",
    projectName: () => "Test Village",
    isPresent: () => true,
  });
  const ledger = async (key: string) =>
    (
      (await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
        "SELECT kind, origin, user_id, status, skip_reason, UNIX_TIMESTAMP(expires_at) - UNIX_TIMESTAMP(created_at) AS life " +
          "FROM comms_messages WHERE idempotency_key = ?",
        [key],
      )) as any
    )[0];
  const stamped = async (id: string) =>
    (
      (await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
        "SELECT emailed_at FROM notifications WHERE id = ?",
        [id],
      )) as any
    )[0][0]?.emailed_at ?? null;

  it("posts a notice under the spine's key, waiting for the drain with its expiry, and says it was accepted", async () => {
    const m = mailer();
    const notice = { to: ["member@example.test"], subject: "A ballot opened", html: "<p>Vote</p>", idempotencyKey: "notify:ntf-spine-1", origin: "notify.immediate", userId: "u-member" };
    expect(await m.sendNotice(notice)).toEqual({ accepted: true, status: "queued" });
    const [r] = await ledger("notify:ntf-spine-1");
    expect(r).toMatchObject({ kind: "notices", origin: "notify.immediate", user_id: "u-member", status: "queued" });
    expect(Number(r.life), "comms.notice_expiry_minutes, 120 by default").toBeGreaterThanOrEqual(120 * 60 - 2);
    expect(Number(r.life)).toBeLessThanOrEqual(120 * 60 + 2);
    expect(await m.sendNotice(notice), "the same key twice is one row").toEqual({ accepted: true, status: "duplicate" });
    expect(await mailer("").sendNotice({ ...notice, idempotencyKey: "notify:ntf-spine-2" })).toMatchObject({ accepted: false, status: "skipped" });
  });

  it("stamps emailed_at when the post office took the notice, and never when it refused it", async () => {
    const taken = await insertNotification(spine(), { userId: "u-taken", type: "quest_consented", title: "Your work was consented", dedupeKey: "spine:taken" });
    expect(taken.fresh).toBe(true);
    expect((await ledger(`notify:${taken.id}`))[0]).toMatchObject({ origin: "notify.immediate", status: "queued", user_id: "u-taken" });
    expect(await stamped(taken.id!)).not.toBeNull();
    // No provider key: the post office records the email as skipped, and the notification is not stamped as emailed.
    const refused = await insertNotification(spine(""), { userId: "u-refused", type: "quest_consented", title: "Your work was consented", dedupeKey: "spine:refused" });
    expect((await ledger(`notify:${refused.id}`))[0]).toMatchObject({ status: "skipped", skip_reason: "not_configured" });
    expect(await stamped(refused.id!)).toBeNull();
  });

  it("posts the daily digest under digest:<user>:<day>, and stamps nothing a second digest that day would leave out", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const add = async (id: string) =>
      pool.query( // module-review-ok: fixture SQL against the scratch schema this suite provisioned
        "INSERT INTO notifications (id, user_id, type, title, dedupe_key) VALUES (?, 'u-digest', 'gratitude', 'Thanks came in', ?)",
        [id, `spine:${id}`],
      );
    await add("ntf-digest-1");
    expect(await runNotificationDigest(spine())).toMatchObject({ users: 1, rows: 1 });
    expect((await ledger(`digest:u-digest:${day}`))[0]).toMatchObject({ origin: "notify.digest", status: "queued" });
    expect(await stamped("ntf-digest-1")).not.toBeNull();
    await add("ntf-digest-2");
    expect(await runNotificationDigest(spine()), "today's digest already went").toMatchObject({ users: 0 });
    expect(await stamped("ntf-digest-2"), "so the new row waits for tomorrow's").toBeNull();
  });

  it("posts the weekly brief under brief:<week>:<user>", async () => {
    const summary = await runWeeklyBrief(spine(), {
      weekKey: "2026-W40",
      members: [{ id: "u-brief" }],
      gather: async () => ({ subject: "Your week", line: "Two gatherings", text: "Two gatherings", html: "<p>Two gatherings</p>", data: {} }),
    });
    expect(summary).toMatchObject({ fresh: 1, emailed: 1 });
    expect((await ledger("brief:2026-W40:u-brief"))[0]).toMatchObject({ origin: "notify.brief", kind: "notices", status: "queued" });
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
    // The module is off, how every module ships, so the tick reads nothing (journeys.db.test.ts drives it on).
    expect(await tick({ ...deps, postOffice: office(), lifecycle: () => "off" })).toMatchObject({ checked: 0, posted: 0, stopped: 0 });
  });

  it("refuses a malformed enrollment as a caller's bug", async () => {
    await expect(enroll(deps, { journeyKey: "", contactId: "ct_5", subjectRef: "account" })).rejects.toThrow(RangeError);
    await expect(stop(deps, { contactId: "ct_5" }, "")).rejects.toThrow(RangeError);
  });
});

/**
 * Every file a module loads at runtime, following relative imports and
 * skipping type-only ones (they are erased). Read with the TypeScript parser,
 * so a multi-line import and a dynamic import call are both edges.
 */
function runtimeReach(entry: string): Set<string> {
  const ROOT = path.resolve(import.meta.dirname, "../../..");
  const seen = new Set<string>();
  const queue = [path.resolve(entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const specs: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        specs.push(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specs.push(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        specs.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file), spec);
      for (const candidate of [`${base}.ts`, path.join(base, "index.ts"), base]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return new Set(Array.from(seen, (f) => path.relative(ROOT, f).split(path.sep).join("/")));
}

describe("the post office's imports", () => {
  it("never reach the module registry, server/lib/modules.ts, by any runtime path", () => {
    const reach = runtimeReach(path.resolve(import.meta.dirname, "postOffice.ts"));
    expect(reach.has("server/lib/comms/postOffice.ts"), "the walk starts where it says").toBe(true);
    expect(reach.has("server/lib/comms/suppressions.ts"), "and follows the post office's own imports").toBe(true);
    expect(reach.has("server/lib/modules.ts")).toBe(false);
    // A control: the same walk from a file that does import the registry finds it.
    expect(runtimeReach(path.resolve(import.meta.dirname, "../../routes/comms.ts")).has("server/lib/modules.ts")).toBe(true);
  });
});
