import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { insertMessage, storeProviderEvent, type NewMessageRow } from "../../repos/commsMessages";
import { sweepCommsRetention } from "./retention";
import { addSuppression, isSuppressed, listSuppressions, removeSuppression, suppressionOf } from "./suppressions";
import { applyDeliveryReport, processStoredReport } from "./webhook";

/**
 * Delivery reports applied to the rows they name, the suppressions they
 * write, the suppression list itself, and the retention sweep, against a
 * provisioned scratch schema (the comms build spec 5.3 and 5.17).
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

let seq = 0;
/** A row the post office has already sent, the way a report finds it. */
async function sentRow(
  over: Omit<Partial<NewMessageRow>, "status"> & { to: string; providerId?: string | null; status?: string },
): Promise<string> {
  const id = `msg_report_${++seq}`;
  const { to, providerId, status, ...rest } = over;
  await insertMessage(pool, {
    id,
    idempotencyKey: `report:${id}`,
    contactId: null,
    userId: null,
    toEmail: to,
    emailKey: to.toLowerCase(),
    kind: "letters",
    origin: "letter",
    subject: "News",
    templateKey: null,
    templateVersion: null,
    journeyKey: null,
    stepKey: null,
    enrollmentId: null,
    letterId: null,
    bodyHtml: "<p>News</p>",
    bodyText: "News",
    attachments: null,
    replyTo: null,
    status: "queued",
    skipReason: null,
    sendAfter: null,
    expiresAt: null,
    ...rest,
  });
  await pool.query( // module-review-ok: staging a sent row in the scratch schema this suite provisioned
    "UPDATE comms_messages SET status = ?, provider_message_id = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?",
    [status ?? "sent", providerId === undefined ? `prov_${id}` : providerId, id],
  );
  return id;
}

const row = async (id: string) =>
  (
    (await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT status, last_error, provider_message_id, delivered_at, bounced_at, complained_at, body_html, body_text, attachments " +
        "FROM comms_messages WHERE id = ?",
      [id],
    )) as any
  )[0][0];

const report = (type: string, data: Record<string, unknown>) => ({ type, data });

/** Store one report the way the route does, then apply it from the stored row. */
async function deliver(svixId: string, payload: { type: string; data: Record<string, any> }) {
  const tags = payload.data.tags as Record<string, string> | undefined;
  const stored = await storeProviderEvent(pool, {
    id: svixId,
    type: payload.type,
    providerMessageId: (payload.data.email_id as string) ?? null,
    messageId: tags?.msg ?? null,
    payload,
  });
  const processed = await processStoredReport(pool, svixId);
  return { ...stored, ...processed };
}

describe.skipIf(!configured)("delivery reports, applied", () => {
  it("bounced and complained reports suppress", async () => {
    const bounced = await sentRow({ to: "Dead@Example.test" });
    await deliver("svix_bounce_1", report("email.bounced", { email_id: `prov_${bounced}`, bounce: { type: "Permanent", message: "No such user" } }));
    expect(await row(bounced)).toMatchObject({ status: "bounced", last_error: "The provider reported a permanent bounce: No such user" });
    expect((await row(bounced)).bounced_at).not.toBeNull();
    expect(await suppressionOf(pool, "dead@example.test")).toMatchObject({ reason: "bounced", createdBy: "provider" });

    const complained = await sentRow({ to: "angry@example.test" });
    await deliver("svix_complaint_1", report("email.complained", { email_id: `prov_${complained}` }));
    expect(await row(complained)).toMatchObject({ status: "complained" });
    expect(await suppressionOf(pool, "angry@example.test")).toMatchObject({ reason: "complained" });

    // A bounce whose type the provider could not tell is treated as permanent.
    const unknown = await sentRow({ to: "maybe@example.test" });
    await deliver("svix_bounce_unknown", report("email.bounced", { email_id: `prov_${unknown}`, bounce: { type: "Undetermined" } }));
    expect(await isSuppressed(pool, "maybe@example.test")).toBe(true);

    // A temporary one leaves the address open.
    const soft = await sentRow({ to: "full-inbox@example.test" });
    const out = await deliver("svix_bounce_soft", report("email.bounced", { email_id: `prov_${soft}`, bounce: { type: "Transient" } }));
    expect(out.outcome).toBe("bounced_temporary");
    expect(await row(soft)).toMatchObject({ status: "bounced" });
    expect(await isSuppressed(pool, "full-inbox@example.test")).toBe(false);

    // The provider's own suppression list: failed here, and suppressed as bounced.
    const held = await sentRow({ to: "held@example.test" });
    await deliver("svix_suppressed_1", report("email.suppressed", { email_id: `prov_${held}` }));
    expect(await row(held)).toMatchObject({ status: "failed" });
    expect(await suppressionOf(pool, "held@example.test")).toMatchObject({ reason: "bounced" });
  });

  it("a report sent twice applies once", async () => {
    const id = await sentRow({ to: "twice@example.test" });
    const first = await deliver("svix_twice", report("email.complained", { email_id: `prov_${id}` }));
    expect(first).toMatchObject({ stored: true, applied: true, outcome: "complained_suppressed" });
    const before = await suppressionOf(pool, "twice@example.test");
    const second = await deliver("svix_twice", report("email.complained", { email_id: `prov_${id}` }));
    expect(second, "stored once, applied once").toMatchObject({ stored: false, applied: false, outcome: "complained_suppressed" });
    expect(await suppressionOf(pool, "twice@example.test")).toEqual(before);
    const [events] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT outcome, message_id, processed_at FROM comms_provider_events WHERE id = 'svix_twice'",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "complained_suppressed", message_id: id });
  });

  it("applies a stored report that was never processed when it comes again", async () => {
    const id = await sentRow({ to: "late@example.test" });
    const payload = report("email.delivered", { email_id: `prov_${id}` });
    // Stored by a delivery whose server died before it applied anything.
    await storeProviderEvent(pool, { id: "svix_orphan", type: payload.type, providerMessageId: `prov_${id}`, messageId: null, payload });
    expect(await row(id)).toMatchObject({ status: "sent" });
    // The provider retries, because it never heard a 2xx.
    expect(await deliver("svix_orphan", payload)).toMatchObject({ stored: false, applied: true, outcome: "delivered" });
    expect(await row(id)).toMatchObject({ status: "delivered" });
  });

  it("finds the row by the provider's id, then by the msg tag, and never by guessing", async () => {
    // Accepted with no provider id recorded yet: the tag finds it, and fills the id in.
    const tagged = await sentRow({ to: "tagged@example.test", providerId: null });
    await deliver("svix_tag", report("email.delivered", { email_id: "prov_late_id", tags: { msg: tagged } }));
    expect(await row(tagged)).toMatchObject({ status: "delivered", provider_message_id: "prov_late_id" });
    // Neither matches: nothing changes and nobody is suppressed, even though the address is ours.
    const ours = await sentRow({ to: "ours@example.test" });
    const out = await deliver("svix_stranger", report("email.bounced", { email_id: "prov_someone_else", to: ["ours@example.test"], bounce: { type: "Permanent" } }));
    expect(out.outcome).toBe("unmatched");
    expect(await row(ours)).toMatchObject({ status: "sent" });
    expect(await isSuppressed(pool, "ours@example.test")).toBe(false);
  });

  it("never lets a late delivered undo a complaint", async () => {
    const id = await sentRow({ to: "order@example.test" });
    await deliver("svix_order_complaint", report("email.complained", { email_id: `prov_${id}` }));
    const late = await deliver("svix_order_delivered", report("email.delivered", { email_id: `prov_${id}` }));
    expect(late.outcome).toBe("unchanged");
    expect(await row(id)).toMatchObject({ status: "complained" });
  });

  it("corrects an essential row the drain gave up on when the provider says it went", async () => {
    const id = await sentRow({ to: "gaveup@example.test", kind: "essential", status: "failed", providerId: null });
    await deliver("svix_corrected", report("email.delivered", { email_id: "prov_corrected", tags: { msg: id } }));
    expect(await row(id)).toMatchObject({ status: "delivered" });
  });

  it("notes a report about a rehearsal and never suppresses the person the row names", async () => {
    const id = await sentRow({ to: "real-person@example.test", kind: "events", status: "rehearsed" });
    const out = await deliver("svix_rehearsal", report("email.bounced", { email_id: `prov_${id}`, bounce: { type: "Permanent" } }));
    expect(out.outcome).toBe("noted_rehearsal");
    expect(await row(id)).toMatchObject({ status: "rehearsed" });
    expect((await row(id)).bounced_at).not.toBeNull();
    expect(await isSuppressed(pool, "real-person@example.test")).toBe(false);
  });

  it("records a delay and an opened report without moving the row", async () => {
    const id = await sentRow({ to: "slow@example.test" });
    expect((await applyDeliveryReport(pool, { type: "email.delivery_delayed", providerMessageId: `prov_${id}`, messageId: null, payload: {} })).outcome).toBe("delayed");
    expect(await row(id)).toMatchObject({ status: "sent" });
    expect(String((await row(id)).last_error)).toContain("delayed");
    expect((await applyDeliveryReport(pool, { type: "email.opened", providerMessageId: `prov_${id}`, messageId: null, payload: {} })).outcome).toBe("ignored");
  });
});

describe.skipIf(!configured)("the suppression list", () => {
  it("keeps one row per address, holding the strongest reason it was given", async () => {
    expect(await addSuppression(pool, "strong@example.test", "manual", "An admin asked")).toEqual({ added: true, reason: "manual" });
    expect(await addSuppression(pool, { email: "STRONG@example.test", reason: "complained", detail: "Marked as spam" })).toEqual({ added: false, reason: "complained" });
    // A weaker reason later never overwrites it.
    expect(await addSuppression(pool, { emailKey: "strong@example.test", reason: "unsubscribed_all" })).toEqual({ added: false, reason: "complained" });
    expect(await suppressionOf(pool, "strong@example.test")).toMatchObject({ reason: "complained", detail: "Marked as spam" });
    expect(await addSuppression(pool, "strong@example.test", "erased")).toEqual({ added: false, reason: "erased" });
  });

  it("lifts a complaint only with a reason, and anything else on request", async () => {
    await addSuppression(pool, "spam-clicker@example.test", "complained");
    const refused = await removeSuppression(pool, "spam-clicker@example.test");
    expect(refused).toMatchObject({ removed: false, previous: { reason: "complained" } });
    expect(refused.refused).toContain("Say why");
    expect(await isSuppressed(pool, "spam-clicker@example.test")).toBe(true);
    expect(await removeSuppression(pool, "spam-clicker@example.test", { reason: "They wrote to ask back in", by: "u-admin" })).toMatchObject({ removed: true });
    expect(await isSuppressed(pool, "spam-clicker@example.test")).toBe(false);
    await addSuppression(pool, "manual@example.test", "manual");
    expect(await removeSuppression({ getPool: () => pool }, "manual@example.test")).toMatchObject({ removed: true });
    expect(await removeSuppression(pool, "never@example.test")).toEqual({ removed: false, previous: null });
  });

  it("lists by reason and by a part of the address, with % and _ matched as themselves", async () => {
    await addSuppression(pool, "per_cent%@example.test", "manual");
    await addSuppression(pool, "perxcentx@example.test", "manual");
    const literal = await listSuppressions(pool, { search: "per_cent%" });
    expect(literal.rows.map((r) => r.emailKey)).toEqual(["per_cent%@example.test"]);
    const complaints = await listSuppressions(pool, { reason: "complained" });
    expect(complaints.rows.every((r) => r.reason === "complained")).toBe(true);
    expect(complaints.total).toBe(complaints.rows.length);
    await expect(addSuppression(pool, "x@example.test", "nope" as never)).rejects.toThrow(RangeError);
  });
});

describe.skipIf(!configured)("retention", () => {
  it("clears words after 30 days, deletes rows after the retention months, and raw reports after 30 days, never a row still waiting", async () => {
    const old = await sentRow({ to: "old@example.test" });
    const waiting = await sentRow({ to: "waiting@example.test", status: "queued" });
    const ancient = await sentRow({ to: "ancient@example.test" });
    const fresh = await sentRow({ to: "fresh@example.test" });
    await pool.query( // module-review-ok: ageing rows in the scratch schema, the way the spec's suites drive time
      "UPDATE comms_messages SET created_at = CURRENT_TIMESTAMP - INTERVAL 31 DAY WHERE id IN (?, ?)",
      [old, waiting],
    );
    await pool.query( // module-review-ok: ageing rows in the scratch schema, the way the spec's suites drive time
      "UPDATE comms_messages SET created_at = CURRENT_TIMESTAMP - INTERVAL 19 MONTH WHERE id = ?",
      [ancient],
    );
    await storeProviderEvent(pool, { id: "svix_old_report", type: "email.delivered", providerMessageId: null, messageId: null, payload: {} });
    await pool.query( // module-review-ok: ageing a report in the scratch schema
      "UPDATE comms_provider_events SET received_at = CURRENT_TIMESTAMP - INTERVAL 31 DAY WHERE id = 'svix_old_report'",
    );

    const parts = await sweepCommsRetention(pool, 18);
    expect(parts.join(", ")).toMatch(/email body\(ies\)/);
    expect(await row(old)).toMatchObject({ status: "sent", body_html: null, body_text: null, attachments: null });
    expect(await row(waiting), "still waiting to go, so its words stay").toMatchObject({ body_html: "<p>News</p>" });
    expect(await row(ancient), "older than the retention months").toBeUndefined();
    expect(await row(fresh)).toMatchObject({ body_html: "<p>News</p>" });
    const [reports] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT id FROM comms_provider_events WHERE id = 'svix_old_report'",
    );
    expect(reports).toHaveLength(0);
  });
});
