/**
 * The village pulse never shows a setting key to a visitor. Pure rules first,
 * then the public and admin reads against stored lines, old and new.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { PUBLIC_RULE_PREFIX, publicPulseText, publicSettingLabel, settingsPulseLine } from "./pulseWords";
import { recentEvents, recordEvent } from "./events";

const OPEN = "org.start_after_paid_terms";
const SENSITIVE = "agents.lead_approved_writes";
const DOTTED = /\b[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)+\b/;

describe("the words a new settings line gets", () => {
  it("uses the human label for an ordinary setting and keeps it public", () => {
    const line = settingsPulseLine(OPEN);
    expect(line.audience).toBe("public");
    expect(line.text).toBe(`${PUBLIC_RULE_PREFIX}${VARIABLES_BY_KEY[OPEN].label}`);
    expect(line.text).not.toContain(OPEN);
  });

  it("keeps a sensitive, withheld or unlabelled setting to admins, with the key", () => {
    for (const key of [SENSITIVE, "agents.anything_new", "tokens.base_rpc_url", "no.such_setting"]) {
      const line = settingsPulseLine(key);
      expect(line.audience, key).toBe("admin");
      expect(line.text, key).toContain(key);
    }
    expect(publicSettingLabel("tokens.base_rpc_url")).toBeNull();
  });
});

describe("the read-time rewrite of stored lines", () => {
  it("turns an old key line into the label, drops any value, and hides a sensitive one", () => {
    const old = (key: string, tail = "") => ({ kind: "settings", text: `A game rule changed: ${key}${tail}`, entityType: "variable", entityRef: key });
    expect(publicPulseText(old(OPEN))).toBe(`${PUBLIC_RULE_PREFIX}${VARIABLES_BY_KEY[OPEN].label}`);
    expect(publicPulseText(old(OPEN, " is now secret-value"))).not.toContain("secret-value");
    expect(publicPulseText(old(SENSITIVE))).toBeNull();
  });

  it("leaves every other line alone", () => {
    const other = { kind: "gratitude", text: "Ann appreciated Wren", entityType: "user", entityRef: "u1" };
    expect(publicPulseText(other)).toBe(other.text);
  });
});

describe("stage lines and capitalisation, pure", () => {
  it("hides every stage or level line from the public, whatever its kind", () => {
    expect(publicPulseText({ kind: "stage", text: "Rick advanced to Role Holder", entityType: "stage" })).toBeNull();
    expect(publicPulseText({ kind: "misc", text: "Ann advanced to Steward" })).toBeNull();
    expect(publicPulseText({ kind: "misc", text: "Ann levelled up" })).toBeNull();
  });
  it("capitalises a lowercase first letter", () => {
    expect(publicPulseText({ kind: "quest", text: "made version 7 of the living map" })).toBe("Made version 7 of the living map");
    expect(publicPulseText({ kind: "quest", text: "Already fine" })).toBe("Already fine");
  });
});

describe.skipIf(!testDbConfigured())("public and admin reads", () => {
  let db: TestDb;
  let pool: Pool;
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = await testPool(db);
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM health_events WHERE kind IN ('settings','stage','quest')"); // module-review-ok: scratch schema teardown
  });

  const seedOld = (id: string, key: string) =>
    pool.query( // module-review-ok: seeding the line an older release wrote is the only way to test its rewrite
      "INSERT INTO health_events (id, kind, text, entity_type, entity_ref, audience) VALUES (?,?,?,?,?, 'public')",
      [id, "settings", `A game rule changed: ${key}`, "variable", key],
    );

  it("a public read never carries a key from a settings line, old or new, and shows the label", async () => {
    await seedOld("old1", OPEN);
    await seedOld("old2", SENSITIVE);
    for (const key of [OPEN, SENSITIVE]) {
      const line = settingsPulseLine(key);
      await recordEvent(pool, { kind: "settings", text: line.text, entityType: "variable", entityRef: key, audience: line.audience });
    }
    const lines = (await recentEvents(pool, "public", 50)).filter((e) => e.kind === "settings");
    expect(lines.length).toBe(2); // the old and the new line for the open setting
    const all = lines.map((e) => e.text).join("\n");
    expect(all).toContain(VARIABLES_BY_KEY[OPEN].label);
    expect(all).not.toMatch(DOTTED);
    expect(all).not.toContain(SENSITIVE);
  });

  it("an admin read still shows the key", async () => {
    const line = settingsPulseLine(SENSITIVE);
    await recordEvent(pool, { kind: "settings", text: line.text, entityType: "variable", entityRef: SENSITIVE, audience: line.audience });
    const admin = (await recentEvents(pool, "admin", 50)).filter((e) => e.kind === "settings");
    expect(admin.map((e) => e.text).join("\n")).toContain(SENSITIVE);
  });

  it("a public read never carries a stage line, old or new; admins still do", async () => {
    await pool.query( // module-review-ok: seeding the public stage line an older release wrote
      "INSERT INTO health_events (id, kind, text, entity_type, entity_ref, audience) VALUES ('old-stage','stage','Rick advanced to Role Holder','stage','role-holder','public')",
    );
    await recordEvent(pool, { kind: "stage", text: "Wren advanced to Steward", entityType: "stage", entityRef: "steward", audience: "admin" });
    await recordEvent(pool, { kind: "quest", text: "made version 7 of the living map" });
    const pub = (await recentEvents(pool, "public", 50)).map((e) => e.text);
    expect(pub.join("\n")).not.toContain("advanced to");
    expect(pub).toContain("Made version 7 of the living map");
    const admin = (await recentEvents(pool, "admin", 50)).map((e) => e.text);
    expect(admin).toContain("Wren advanced to Steward");
  });
});
