/**
 * The key's live check, without a database: the email it builds can only go
 * to Resend's test address, and a ledger row reads back as the right health.
 */
import { describe, expect, it } from "vitest";
import { PROBE_EMAIL_ORIGIN, type TestEmailRow } from "../../repos/commsOverview";
import { RESEND_PROBE_RECIPIENT, probeEmail, probeReading, resendKeyLaunchCheck } from "./probe";

const row = (over: Partial<TestEmailRow>): TestEmailRow => ({
  id: "msg_1",
  toEmail: RESEND_PROBE_RECIPIENT,
  status: "sent",
  skipReason: null,
  lastError: null,
  providerMessageId: "re_1",
  createdAt: 1_800_000_000,
  sentAt: 1_800_000_001,
  deliveredAt: null,
  deliveredReport: false,
  ...over,
});

/** A pool that answers the one SELECT `latestTestEmail` makes, then the report lookup. */
const poolWith = (rows: any[]) =>
  ({ query: async (sql: string) => [String(sql).includes("comms_provider_events") ? [] : rows] }) as any;

describe("the probe email", () => {
  it("goes to Resend's test address and nowhere else, and takes no address to change that", () => {
    expect(RESEND_PROBE_RECIPIENT).toBe("delivered@resend.dev");
    expect(probeEmail.length).toBe(2);
    const e = probeEmail("Hill Valley <script>", "n1");
    expect(e.to).toEqual({ email: "delivered@resend.dev", name: null, userId: null });
    expect(e).toMatchObject({ kind: "essential", origin: PROBE_EMAIL_ORIGIN, urgent: true, idempotencyKey: `${PROBE_EMAIL_ORIGIN}:n1` });
    expect(e.html).not.toContain("<script>");
  });

  it("is its own email every time it runs", () => {
    expect(probeEmail("V", "a").idempotencyKey).not.toBe(probeEmail("V", "b").idempotencyKey);
  });
});

describe("reading the last probe", () => {
  it("is alive only when Resend accepted it", () => {
    expect(probeReading(null)).toEqual({ state: "none", at: null, reason: null });
    expect(probeReading(row({}))).toEqual({ state: "alive", at: 1_800_000_001, reason: null });
    expect(probeReading(row({ status: "delivered" })).state).toBe("alive");
    expect(probeReading(row({ status: "sending", sentAt: null }))).toEqual({ state: "pending", at: 1_800_000_000, reason: null });
  });

  it("keeps the provider's own words when it did not go", () => {
    expect(probeReading(row({ status: "failed", lastError: "The domain is not verified" }))).toEqual({
      state: "failed",
      at: 1_800_000_001,
      reason: "The domain is not verified",
    });
    expect(probeReading(row({ status: "skipped", skipReason: "not_configured", sentAt: null })).reason).toBe("not_configured");
  });
});

describe("the resend-key launch row", () => {
  const sql = (r: TestEmailRow) => ({
    id: r.id, to_email: r.toEmail, status: r.status, skip_reason: r.skipReason, last_error: r.lastError,
    provider_message_id: r.providerMessageId, created_at: r.createdAt, sent_at: r.sentAt, delivered_at: r.deliveredAt,
  });

  it("is missing with no key, whatever the ledger says", async () => {
    expect((await resendKeyLaunchCheck(poolWith([sql(row({}))]), { configured: false })).state).toBe("missing");
  });

  it("is only partial when a key is set and nothing has shown it works", async () => {
    expect((await resendKeyLaunchCheck(poolWith([]), { configured: true })).state).toBe("partial");
  });

  it("is green after a send Resend accepted, and red after one it refused", async () => {
    expect((await resendKeyLaunchCheck(poolWith([sql(row({}))]), { configured: true })).state).toBe("ok");
    const red = await resendKeyLaunchCheck(poolWith([sql(row({ status: "failed", lastError: "403: not allowed" }))]), { configured: true });
    expect(red).toEqual({ state: "missing", detail: "The last test send did not go: 403: not allowed" });
  });
});
