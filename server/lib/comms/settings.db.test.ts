/**
 * THE COMMS SETTINGS DOCUMENT, THE MODE, THE READINESS READER AND THE LAUNCH
 * ROWS, AGAINST A REAL SCHEMA (the comms build spec 5.15, 5.16 and 5.18).
 *
 * Acceptance lines this file carries, each a named test below:
 *   - an old stored comms-settings document reads with every new default
 *     filled and is not rewritten by the read;
 *   - pause and rehearsal values reach commsMode();
 *   - the readiness reader is not ready until items 1 to 5 and 13 are green,
 *     and then it is (with real rows behind every fact);
 *   - the launch checks go red with a key and no sender.
 *
 * Skips loudly without TEST_DATABASE_URL.
 */
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { COMMS_SETTINGS_KEY, DEFAULT_CONSENT_TEXT, DEFAULT_RECAP_QUESTIONS } from "../../../shared/comms/settings";
import { LAUNCH_REQUIREMENTS } from "../../../shared/launchRequirements";
import { provisionTestDb, testDbConfigured, type TestDb } from "../../db/testDb";
import { insertMessage, markSent, storeProviderEvent } from "../../repos/commsMessages";
import { makeWebhookSecret } from "../../testkit/fakeResend";
import { launchStatus, type LaunchDeps } from "../launch";
import { loadSecrets } from "../secrets";
import { commsMode, readCommsSettings, recordCommsSettings, writeCommsSettings } from "./settings";
import { commsLaunchCheck, commsReadiness, type SecretFacts } from "./setup";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[comms settings.db] TEST_DATABASE_URL not set. The settings document is UNCHECKED here.");
}

let db: TestDb;
let pool: mysql.Pool;
const PATHS = ["resident", "investor", "steward", "prosperity-creator"];

async function rawDocument(): Promise<{ value: any; text: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT value FROM app_config WHERE config_key = ?",
    [COMMS_SETTINGS_KEY],
  );
  if (!rows[0]) return null;
  const v = rows[0].value;
  const value = typeof v === "string" ? JSON.parse(v) : v;
  return { value, text: JSON.stringify(value) };
}

async function storeDocument(doc: unknown): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO app_config (config_key, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [COMMS_SETTINGS_KEY, JSON.stringify(doc)],
  );
}

async function clearAll(): Promise<void> {
  for (const key of [COMMS_SETTINGS_KEY, "email-config", "launch-state"]) {
    await pool.query("DELETE FROM app_config WHERE config_key = ?", [key]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  }
  await pool.query("DELETE FROM comms_messages"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  await pool.query("DELETE FROM comms_provider_events"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
  // The secrets store reads this schema's (empty) document, so the launch
  // rows below resolve keys from the environment the tests set.
  await loadSecrets(pool);
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("the comms settings document, against a real schema", () => {
  it("reads an old stored comms-settings document with every new default filled, and the read does not rewrite it", async () => {
    await clearAll();
    // What a village that saved two fields in an earlier release holds: no
    // recap questions, no consent words, no pause, no rehearsal inbox.
    await storeDocument({ postalAddress: "1 Orchard Lane", senderName: "Hill Village" });
    const before = await rawDocument();

    const s = await readCommsSettings(pool);
    expect(s.postalAddress).toBe("1 Orchard Lane");
    expect(s.senderName).toBe("Hill Village");
    expect(s.consentText).toBe(DEFAULT_CONSENT_TEXT);
    expect(s.recapQuestions).toEqual([...DEFAULT_RECAP_QUESTIONS]);
    expect(s.paused).toBe(false);
    expect(s.rehearsalTo).toEqual([]);
    expect(s.pathContacts).toEqual({});

    // The row is exactly what was stored: the defaults were filled on the way
    // out and never written back, so a later platform default still reaches
    // this village.
    const after = await rawDocument();
    expect(after?.text).toBe(before?.text);
    expect(Object.keys(after!.value).sort()).toEqual(["postalAddress", "senderName"]);
  });

  it("reads defaults when nothing was ever saved, and writes nothing to do it", async () => {
    await clearAll();
    const s = await readCommsSettings(pool);
    expect(s.consentText).toBe(DEFAULT_CONSENT_TEXT);
    expect(await rawDocument()).toBeNull();
  });

  it("stores only what was changed, and two saves of different fields at once both land", async () => {
    await clearAll();
    const [a, b] = await Promise.all([
      writeCommsSettings(pool, { postalAddress: "2 Orchard Lane" }, { pathIds: PATHS }),
      writeCommsSettings(pool, { paused: true }, { pathIds: PATHS }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const raw = await rawDocument();
    expect(raw?.value).toEqual({ postalAddress: "2 Orchard Lane", paused: true });
    // And a later save of a third field keeps both.
    await writeCommsSettings(pool, { rehearsalTo: ["r@example.test"] }, { pathIds: PATHS });
    expect((await rawDocument())?.value).toEqual({ postalAddress: "2 Orchard Lane", paused: true, rehearsalTo: ["r@example.test"] });
  });

  it("takes a field back to the platform's default by removing it", async () => {
    await clearAll();
    await writeCommsSettings(pool, { consentText: "Send me the next steps, please." }, { pathIds: PATHS });
    expect((await readCommsSettings(pool)).consentText).toBe("Send me the next steps, please.");
    await writeCommsSettings(pool, { consentText: "" }, { pathIds: PATHS });
    expect((await rawDocument())?.value).toEqual({});
    expect((await readCommsSettings(pool)).consentText).toBe(DEFAULT_CONSENT_TEXT);
  });

  it("removes one path contact and keeps the others", async () => {
    await clearAll();
    await writeCommsSettings(pool, { pathContacts: { resident: "u1", investor: "u2" } }, { pathIds: PATHS });
    await writeCommsSettings(pool, { pathContacts: { investor: "" } }, { pathIds: PATHS });
    expect((await readCommsSettings(pool)).pathContacts).toEqual({ resident: "u1" });
  });

  it("refuses an edit it cannot check, and stores nothing", async () => {
    await clearAll();
    const r = await writeCommsSettings(pool, { paused: "yes" }, { pathIds: PATHS });
    expect(r.ok).toBe(false);
    expect(await rawDocument()).toBeNull();
  });

  it("records what the server learned through the same merge", async () => {
    await clearAll();
    await writeCommsSettings(pool, { postalAddress: "3 Orchard Lane" }, { pathIds: PATHS });
    const s = await recordCommsSettings(pool, {
      domain: "Village.Example.TEST",
      domainId: "dom_1",
      domainStatus: "Pending",
      domainCheckedAt: "2026-10-02T12:00:00.000Z",
    });
    expect(s).toMatchObject({ domain: "village.example.test", domainId: "dom_1", domainStatus: "pending", postalAddress: "3 Orchard Lane" });
    await recordCommsSettings(pool, { domainId: null });
    expect((await rawDocument())?.value.domainId).toBeUndefined();
  });

  it("hands pause and rehearsal values to commsMode(), and the admins when nobody is named", async () => {
    await clearAll();
    const deps = { getPool: () => pool, lifecycle: () => "preview" as const, adminEmails: async () => ["admin@example.test", "ADMIN@example.test"] };
    expect(await commsMode(deps)).toEqual({ lifecycle: "preview", paused: false, rehearsalTo: ["admin@example.test"] });

    await writeCommsSettings(pool, { paused: true, rehearsalTo: ["rehearse@example.test"] }, { pathIds: PATHS });
    expect(await commsMode(deps)).toEqual({ lifecycle: "preview", paused: true, rehearsalTo: ["rehearse@example.test"] });

    await writeCommsSettings(pool, { paused: false, rehearsalTo: [] }, { pathIds: PATHS });
    expect(await commsMode({ ...deps, lifecycle: () => "members" as const })).toEqual({
      lifecycle: "members",
      paused: false,
      rehearsalTo: ["admin@example.test"],
    });
  });

  it("holds automated email when the settings cannot be read, and says so", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const broken = {
        getPool: () => ({ query: async () => { throw new Error("the database is gone"); } }) as unknown as mysql.Pool,
        lifecycle: () => "public" as const,
        adminEmails: () => ["admin@example.test"],
      };
      expect(await commsMode(broken)).toEqual({ lifecycle: "public", paused: true, rehearsalTo: ["admin@example.test"] });
      expect(said).toHaveBeenCalled();
    } finally {
      said.mockRestore();
    }
  });
});

/** Secrets as the readiness reader sees them, set per test. */
function secrets(key: boolean, hook: boolean) {
  return (name: "resend_api_key" | "resend_webhook_secret"): SecretFacts => {
    const on = name === "resend_api_key" ? key : hook;
    return { configured: on, source: on ? "admin" : "none", last4: on ? "abcd" : null };
  };
}

async function storeEmailConfig(doc: Record<string, unknown>): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO app_config (config_key, value) VALUES ('email-config', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [JSON.stringify(doc)],
  );
}

/** A sent test email in the real ledger, through the post office's own writers. */
async function sentTestEmail(id: string): Promise<void> {
  await insertMessage(pool, {
    id,
    idempotencyKey: `comms.test:${id}`,
    contactId: null,
    userId: "u-founder",
    toEmail: "founder@example.test",
    emailKey: "founder@example.test",
    kind: "essential",
    origin: "comms.test",
    subject: "A test email",
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
    status: "queued",
    skipReason: null,
    sendAfter: null,
    expiresAt: null,
  });
  await markSent(pool, id, { provider: "resend", providerMessageId: `prov_${id}` });
}

describe.skipIf(!configured)("the readiness reader and the launch rows, over real rows", () => {
  const savedEnv = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, hook: process.env.RESEND_WEBHOOK_SECRET };

  afterEach(() => {
    for (const [name, v] of [["RESEND_API_KEY", savedEnv.key], ["EMAIL_FROM", savedEnv.from], ["RESEND_WEBHOOK_SECRET", savedEnv.hook]] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  });

  it("is not ready until items 1 to 5 and 13 are green, then ready, with a real row behind every fact", async () => {
    await clearAll();
    const deps = (key: boolean, hook: boolean) => ({ getPool: () => pool, secretStatus: secrets(key, hook), env: {} as NodeJS.ProcessEnv });

    let r = await commsReadiness(deps(false, false));
    expect(r.ready).toBe(false);
    expect(r.open).toEqual(["api-key", "domain", "sender", "delivery-reports", "postal-address", "test-email"]);
    expect(r.hint).toContain("Finish the checklist in Comms Settings first");

    // 1, the key.
    r = await commsReadiness(deps(true, false));
    expect(r.open).not.toContain("api-key");
    // 2, a domain the provider said is verified.
    await recordCommsSettings(pool, { domain: "village.example.test", domainId: "dom_1", domainStatus: "verified" });
    // 3, a sender with a name, on that domain, in the email-config document.
    await storeEmailConfig({ sender: "Hill Village <hello@village.example.test>" });
    // 5, the postal address.
    await writeCommsSettings(pool, { postalAddress: "1 Orchard Lane" }, { pathIds: PATHS });
    r = await commsReadiness(deps(true, false));
    expect(r.open).toEqual(["delivery-reports", "test-email"]);
    // 4, delivery reports.
    r = await commsReadiness(deps(true, true));
    expect(r.open).toEqual(["test-email"]);
    expect(r.ready).toBe(false);

    // 13, a test email: sent is not enough.
    await sentTestEmail("msg_test_1");
    r = await commsReadiness(deps(true, true));
    expect(r.ready, "sent and not yet reported delivered").toBe(false);
    // The provider's report arrives, tied to our row by the tag every send carries.
    await storeProviderEvent(pool, {
      id: "svix_test_1",
      type: "email.delivered",
      providerMessageId: "prov_msg_test_1",
      messageId: "msg_test_1",
      payload: { type: "email.delivered" },
    });
    r = await commsReadiness(deps(true, true));
    expect(r).toMatchObject({ ready: true, open: [] });

    // And it follows the newest test: a later one still waiting is not ready.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await sentTestEmail("msg_test_2");
    expect((await commsReadiness(deps(true, true))).open).toEqual(["test-email"]);
  }, 60_000);

  it("turns the launch journey's sender row red with a key and no sender", async () => {
    await clearAll();
    process.env.RESEND_API_KEY = "re_test_lane_b4";
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_WEBHOOK_SECRET;
    const launchDeps = (): LaunchDeps => {
      const checks: LaunchDeps["checks"] = {};
      for (const req of LAUNCH_REQUIREMENTS) checks[req.checkKey] = () => ({ state: "missing" as const, detail: "not in this test" });
      return { checks, moduleLifecycle: () => "off" };
    };
    const row = async (id: string) => (await launchStatus(pool, launchDeps())).items.find((i) => i.id === id)!;

    const sender = await row("email-sender");
    expect(sender.checkKey).toBe("comms:sender");
    expect(sender.state).toBe("missing");
    expect(sender.detail).toBe("No sender yet. With none, nothing is sent.");
    expect((await row("email-domain")).state).toBe("missing");
    expect((await row("email-delivery-reports")).state).toBe("missing");
    // The key itself is checked by server/index.ts and is not this file's.
    expect(await commsLaunchCheck({ getPool: () => pool }, "api-key")).toBeNull();

    // Supplied, every row turns green, and from the same checklist items.
    await recordCommsSettings(pool, { domain: "village.example.test", domainId: "dom_1", domainStatus: "verified" });
    await storeEmailConfig({ sender: "Hill Village <hello@village.example.test>" });
    process.env.RESEND_WEBHOOK_SECRET = makeWebhookSecret();
    expect((await row("email-sender")).state).toBe("ok");
    expect((await row("email-domain")).state).toBe("ok");
    expect((await row("email-delivery-reports")).state).toBe("ok");
  }, 60_000);
});
