import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { refInSubject } from "../../shared/invoiceTrack";
import type { InvoiceView } from "../../shared/moonRecap";
import { emailInvoiceToSera, retryUnsentInvoiceMail, type InvoiceMailDeps } from "./invoiceMail";
import { mailForRef } from "../repos/invoiceRails";

const configured = testDbConfigured();

const view = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  id: "mv-1", status: "waiting", statusLine: "Waiting on approval", memberNumber: "INV-12", billRef: "us-llc-0007",
  billTo: { payerKey: "us-llc", legalName: "Payer LLC", address: "2 Street", taxId: null, invoiceTo: "pay@example.test", invoiceCc: [] },
  from: { legalName: "A. Member", address: "1 Road" }, period: "6 Oct to 3 Nov 2026",
  lines: [{ key: "app-1", applicationId: "app-1", firstSeatId: "s1", kind: "pay", roleIds: ["r1"], roleNames: ["Steward"], basis: "per_moon", listedAs: null, currency: "USD", termsMinor: 120000, per: "moon", range: null, proposedMinor: null, finalMinor: null, daysInMoon: 28, daysHeld: 28, amountMinor: 120000, basisLine: "28 of 28 days", approvedItemIds: [], cashOwedId: null, held: false }] as InvoiceView["lines"],
  currency: "USD", totalMinor: 120000, expectedOn: null, paidOn: null, selfApproved: false, supportLine: "Support document.", externalInvoiceKey: null,
  workSummary: null, workSummaryHtml: null, sendRefusal: null, ...over,
});

describe.skipIf(!configured)("the invoice is emailed to the village's Sera inbox, once per content", () => {
  let db: TestDb;
  let pool: Pool;
  let posted: OutgoingEmail[];
  let answer: PostResult["status"];
  let inbox: string | null;
  let audits: string[];
  const deps = (): InvoiceMailDeps => ({
    getPool: () => pool,
    post: async (e) => { posted.push(e); return { status: answer, messageId: `msg-${posted.length}` } as PostResult; },
    seraInbox: async () => inbox,
    projectName: () => "Test Village",
    audit: async (t) => { audits.push(t); },
  });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
  });
  afterAll(async () => { await pool?.end(); await db?.drop(); });
  beforeEach(async () => {
    await pool.query("DELETE FROM `invoice_mail` WHERE `id` IS NOT NULL");
    posted = []; answer = "sent"; inbox = "sera-inbox@example.test"; audits = [];
  });

  it("sends one essential email to the inbox, the reference in its subject and a PDF attached", async () => {
    expect(await emailInvoiceToSera(deps(), "u1", view())).toBe("sent");
    expect(posted).toHaveLength(1);
    const e = posted[0];
    expect(e.to.email).toBe("sera-inbox@example.test");
    expect(e.kind).toBe("essential");
    expect(refInSubject(e.subject)).toBe("us-llc-0007");
    expect(e.attachments?.[0]).toMatchObject({ filename: "invoice-us-llc-0007.pdf", contentType: "application/pdf" });
    expect(Buffer.from(e.attachments![0].contentBase64, "base64").toString("latin1")).toContain("Reference: us-llc-0007");
    const rows = await mailForRef(pool, "us-llc-0007");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 1, toEmail: "sera-inbox@example.test" });
    expect(rows[0].sentAt).not.toBeNull();
    expect(audits).toEqual(["invoice:emailed:us-llc-0007:sent:attempt-1"]);
  });

  it("the same invoice pressed twice is one email", async () => {
    await emailInvoiceToSera(deps(), "u1", view());
    expect(await emailInvoiceToSera(deps(), "u1", view())).toBe("duplicate");
    await Promise.all([emailInvoiceToSera(deps(), "u1", view()), emailInvoiceToSera(deps(), "u1", view())]);
    expect(posted).toHaveLength(1);
  });

  it("two presses racing write one row and send one email", async () => {
    const outs = await Promise.all([emailInvoiceToSera(deps(), "u1", view()), emailInvoiceToSera(deps(), "u1", view())]);
    expect(outs.filter((o) => o === "sent")).toHaveLength(1);
    expect(posted).toHaveLength(1);
    expect(await mailForRef(pool, "us-llc-0007")).toHaveLength(1);
  });

  it("a changed invoice under the same reference is one more email, marked updated", async () => {
    await emailInvoiceToSera(deps(), "u1", view());
    await emailInvoiceToSera(deps(), "u1", view({ totalMinor: 110000 }));
    expect(posted).toHaveLength(2);
    expect(posted[1].subject).toContain("updated");
    expect(refInSubject(posted[1].subject)).toBe("us-llc-0007");
  });

  it("no inbox set sends nothing and writes nothing", async () => {
    inbox = null;
    expect(await emailInvoiceToSera(deps(), "u1", view())).toBe("no_inbox");
    expect(posted).toHaveLength(0);
    expect(await mailForRef(pool, "us-llc-0007")).toHaveLength(0);
  });

  it("a failed email never throws, keeps the row unsent, and the daily retry sends it", async () => {
    answer = "failed";
    expect(await emailInvoiceToSera(deps(), "u1", view())).toBe("failed");
    expect((await mailForRef(pool, "us-llc-0007"))[0]).toMatchObject({ status: "failed", sentAt: null, attempts: 1 });
    answer = "sent";
    expect(await retryUnsentInvoiceMail(deps(), async () => view())).toContain("1 of 1");
    expect((await mailForRef(pool, "us-llc-0007"))[0]).toMatchObject({ status: "sent", attempts: 2 });
    expect(posted[1].idempotencyKey).not.toBe(posted[0].idempotencyKey);
  });

  it("a post office that throws is a failed email, never a failed send", async () => {
    const throwing = { ...deps(), post: async () => { throw new Error("boom"); } };
    expect(await emailInvoiceToSera(throwing, "u1", view())).toBe("failed");
  });

  it("the retry stops after three attempts", async () => {
    answer = "failed";
    await emailInvoiceToSera(deps(), "u1", view());
    await retryUnsentInvoiceMail(deps(), async () => view());
    await retryUnsentInvoiceMail(deps(), async () => view());
    await retryUnsentInvoiceMail(deps(), async () => view());
    expect(posted).toHaveLength(3);
  });

  it("the retry leaves a row whose invoice changed since", async () => {
    answer = "failed";
    await emailInvoiceToSera(deps(), "u1", view());
    answer = "sent";
    await retryUnsentInvoiceMail(deps(), async () => view({ totalMinor: 1 }));
    expect(posted).toHaveLength(1);
  });

  it("an unsent invoice view (no id or no reference) sends nothing", async () => {
    expect(await emailInvoiceToSera(deps(), "u1", view({ id: null }))).toBe("no_reference");
    expect(await emailInvoiceToSera(deps(), "u1", view({ billRef: null }))).toBe("no_reference");
    expect(posted).toHaveLength(0);
  });

  it("the row keeps no body: only who, where, when and what became of it", async () => {
    await emailInvoiceToSera(deps(), "u1", view());
    const [cols] = await pool.query<any[]>("SHOW COLUMNS FROM `invoice_mail`");
    expect(cols.map((c) => c.Field).sort()).toEqual(["attempts", "content_hash", "id", "invoice_id", "invoice_ref", "message_id", "queued_at", "sent_at", "status", "to_email", "user_id"]);
  });

  it("clearing or changing the inbox stops every unsent email to the old address", async () => {
    answer = "failed";
    await emailInvoiceToSera(deps(), "u1", view());
    answer = "sent";
    inbox = null;
    await retryUnsentInvoiceMail(deps(), async () => view());
    inbox = "someone-else@example.test";
    await retryUnsentInvoiceMail(deps(), async () => view());
    expect(posted).toHaveLength(1);
  });

  it("the retry never emails an invoice the member took back, or one already approved", async () => {
    answer = "failed";
    await emailInvoiceToSera(deps(), "u1", view());
    answer = "sent";
    for (const status of ["draft", "returned", "approved", "paid"] as const) await retryUnsentInvoiceMail(deps(), async () => view({ status }));
    expect(posted).toHaveLength(1);
  });

  it("a row being sent cannot be claimed again by a second press", async () => {
    let release!: () => void;
    const slow = { ...deps(), post: async (e: OutgoingEmail) => { posted.push(e); await new Promise<void>((ok) => { release = ok; }); return { status: "sent", messageId: "m" } as PostResult; } };
    const first = emailInvoiceToSera(slow, "u1", view());
    await new Promise((ok) => setTimeout(ok, 100));
    expect(await emailInvoiceToSera(deps(), "u1", view())).toBe("duplicate");
    release();
    expect(await first).toBe("sent");
    expect(posted).toHaveLength(1);
  });

  it("the daily retry is audited as the system, never as the member", async () => {
    const who: Array<boolean | undefined> = [];
    const d = { ...deps(), audit: async (_t: string, _u: string, system?: boolean) => { who.push(system); } };
    answer = "failed";
    await emailInvoiceToSera(d, "u1", view());
    answer = "sent";
    await retryUnsentInvoiceMail(d, async () => view());
    expect(who).toEqual([false, true]);
  });
});
