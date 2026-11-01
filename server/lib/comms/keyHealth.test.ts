/**
 * The Resend key's health, read from the post office's own test send: green
 * only once the latest `comms.test` email is reported delivered, the same
 * answer as item 13 of the comms setup checklist.
 */
import { describe, expect, it } from "vitest";
import type { TestEmailRow } from "../../repos/commsOverview";
import { resendKeyHealth, resendKeyLaunchCheck } from "./keyHealth";
import { testEmailDelivered } from "./setup";

const row = (over: Partial<TestEmailRow>): TestEmailRow => ({
  id: "msg_1",
  toEmail: "founder@example.test",
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

describe("the Resend key's health", () => {
  it("is missing with no key, whatever the ledger says", () => {
    expect(resendKeyHealth({ configured: false }, row({ status: "delivered" })).state).toBe("missing");
  });

  it("is never green for a key that is only set", () => {
    expect(resendKeyHealth({ configured: true }, null).state).toBe("partial");
    expect(resendKeyHealth({ configured: true }, row({})).state).toBe("partial");
    expect(resendKeyHealth({ configured: true }, row({ status: "sending", sentAt: null })).state).toBe("partial");
  });

  it("is green exactly when item 13 is: the latest test reported delivered", () => {
    for (const t of [row({ status: "delivered" }), row({ deliveredReport: true }), row({}), row({ status: "bounced" })]) {
      expect(resendKeyHealth({ configured: true }, t).state === "ok", t.status).toBe(testEmailDelivered(t));
    }
  });

  it("is red after a test that did not arrive, in the provider's words", () => {
    expect(resendKeyHealth({ configured: true }, row({ status: "failed", lastError: "403: domain not verified" }))).toEqual({
      state: "missing",
      detail: "The last test email did not arrive: 403: domain not verified",
    });
    expect(resendKeyHealth({ configured: true }, row({ status: "bounced" })).detail).toContain("bounced");
  });

  it("asks again once a new key is saved, so an old key's test never speaks for it", () => {
    const savedAt = new Date((1_800_000_000 + 60) * 1000).toISOString();
    const typed = { configured: true, source: "admin", setAt: savedAt };
    const old = resendKeyHealth(typed, row({ status: "delivered" }));
    expect(old.state).toBe("partial");
    expect(old.detail).toContain("saved after the last test email");
    expect(resendKeyHealth(typed, row({ status: "delivered", createdAt: 1_800_000_000 + 120 })).state).toBe("ok");
  });

  it("reads the ledger only when there is a key to check", async () => {
    let asked = 0;
    const pool = { query: async () => { asked += 1; return [[]]; } } as any;
    expect((await resendKeyLaunchCheck(pool, { configured: false })).state).toBe("missing");
    expect(asked).toBe(0);
    expect((await resendKeyLaunchCheck(pool, { configured: true })).state).toBe("partial");
    expect(asked).toBe(1);
  });
});
