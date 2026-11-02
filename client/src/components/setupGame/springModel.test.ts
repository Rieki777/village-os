import { describe, expect, it } from "vitest";
import type { SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import { springBeats, springJournal, stoneWeather, suggestedDomain } from "./springModel";
import { keyRightsFingerprint } from "@shared/comms/settings";

const KEYS = ["api-key", "domain", "sender", "delivery-reports", "postal-address", "test-email"] as const;

function payload(done: Partial<Record<(typeof KEYS)[number], boolean>>, extra: Partial<SettingsPayload> = {}): SettingsPayload {
  return {
    lifecycle: "off",
    ready: false,
    checklist: KEYS.map((key, i) => ({ key, n: i + 1, label: key, done: !!done[key], required: true, detail: "" })),
    settings: { domain: "", domainStatus: "none", domainCheckedAt: null, domainConfirmedBy: null } as SettingsPayload["settings"],
    key: { configured: !!done["api-key"], source: "admin", last4: done["api-key"] ? "a9f2" : null, setAt: null, setBy: null },
    webhook: { configured: false, source: "none", url: "", events: [], connectedAt: null, connectedBy: null, byHand: false, lastReportAt: null },
    sender: { line: "", source: "none", name: "", address: "" },
    paths: [],
    members: [],
    holders: [],
    admins: [],
    testEmail: null,
    me: { email: null },
    secretsKeySet: true,
    ...extra,
  } as SettingsPayload;
}

describe("the Spring plot reads the comms checklist, and nothing else decides", () => {
  it("starts at the account, and a planted key proves the account", () => {
    expect(springBeats(payload({}), { account: false }).current).toBe("account");
    const keyed = springBeats(payload({ "api-key": true }), { account: false });
    expect(keyed.beats.find((b) => b.id === "account")?.done).toBe(true);
    expect(keyed.current).toBe("stones");
  });

  it("needs both the sender and the postal address to sign the letters", () => {
    const half = springBeats(payload({ "api-key": true, domain: true, "delivery-reports": true, sender: true }), { account: true });
    expect(half.current).toBe("sign");
  });

  it("is done only when the test letter is delivered, the post office is on, and the key can only send", () => {
    const all = { "api-key": true, domain: true, sender: true, "delivery-reports": true, "postal-address": true, "test-email": true };
    expect(springBeats(payload(all), { account: true }).current).toBe("transplant");
    expect(springBeats(payload(all, { lifecycle: "preview" }), { account: true }).current).toBe("transplant");
    // The post office is open, and the setup key still has full access.
    expect(springBeats(payload(all, { lifecycle: "members" }), { account: true }).current).toBe("trade");
    const key = { configured: true, source: "admin", last4: "a9f2", setAt: "2026-10-31T10:00:00Z", setBy: null };
    const traded = (rights: "full" | "sending", fingerprint: string) =>
      payload(all, { lifecycle: "members", key, settings: { domain: "village.example", domainStatus: "verified", keyRights: rights, keyRightsFor: fingerprint } as SettingsPayload["settings"] });
    const mine = keyRightsFingerprint(key);
    expect(springBeats(traded("full", mine), { account: true }).current).toBe("trade");
    expect(springBeats(traded("sending", mine), { account: true }).current).toBe("done");
    // An answer about an earlier key never speaks for this one.
    expect(springBeats(traded("sending", keyRightsFingerprint({ ...key, last4: "0000" })), { account: true }).current).toBe("trade");
  });

  it("shows a storm only while a named domain waits, counting what Resend has seen", () => {
    expect(stoneWeather(payload({}), null).storm).toBe(false);
    const waiting = payload({ "api-key": true }, { settings: { domain: "village.example", domainStatus: "pending" } as SettingsPayload["settings"] });
    const records = [
      { record: "SPF", type: "TXT", name: "send", value: "v=spf1", ttl: "Auto", priority: null, status: "verified" },
      { record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=", ttl: "Auto", priority: null, status: "pending" },
    ];
    const w = stoneWeather(waiting, { domain: "village.example", status: "pending", records, byHand: false, steps: [] });
    expect(w).toEqual({ storm: true, seen: 1, total: 2 });
    const verified = payload({ "api-key": true, domain: true }, { settings: { domain: "village.example", domainStatus: "verified" } as SettingsPayload["settings"] });
    expect(stoneWeather(verified, null).storm).toBe(false);
  });

  it("suggests the founders' own domain and never a mail provider's", () => {
    expect(suggestedDomain(payload({}, { me: { email: "someone@gmail.com" }, admins: ["ops@village.example"] }))).toBe("village.example");
    expect(suggestedDomain(payload({}, { me: { email: "someone@outlook.com" } }))).toBe("");
  });

  it("writes the journal only from what the server recorded, newest first", () => {
    expect(springJournal(payload({}))).toEqual([]);
    const p = payload(
      { "api-key": true },
      {
        key: { configured: true, source: "admin", last4: "a9f2", setAt: "2026-10-31T10:00:00Z", setBy: "A founder" },
        webhook: { configured: true, source: "admin", url: "", events: [], connectedAt: "2026-10-31T11:00:00Z", connectedBy: null, byHand: false, lastReportAt: null },
      },
    );
    const lines = springJournal(p);
    expect(lines.map((l) => l.text)).toEqual(["Delivery reports connected.", "Sending key planted in the root cellar by A founder, ending a9f2."]);
  });
});
