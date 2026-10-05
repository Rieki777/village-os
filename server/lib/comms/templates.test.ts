import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { defaultTemplate } from "../../../shared/comms/defaults/templates";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import {
  adoptPlatformWords,
  ensureAdopted,
  listWords,
  readDraft,
  readLiveWords,
  restoreWords,
  saveWords,
  upgradeAvailable,
  wordsDetail,
} from "./templates";

/**
 * A village's words: saving makes a new version, restoring brings an old one
 * back, adopting takes the platform's, and the upgrade flag appears only when
 * the platform's words are newer than the copy the village holds (the comms
 * build spec 5.5). Against a provisioned scratch schema.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 6 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

const draft = (subject: string, bodyMd = "Hi {{person.firstName}},\n\nSee you there.") => ({ subject, preheader: null, bodyMd });

async function rowsOf(key: string) {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
    "SELECT version, state, subject, platform_version, edited_by FROM comms_templates WHERE template_key = ? ORDER BY version",
    [key],
  );
  return rows.map((r) => ({ version: Number(r.version), state: String(r.state), subject: String(r.subject), platformVersion: r.platform_version == null ? null : Number(r.platform_version), editedBy: r.edited_by == null ? null : String(r.edited_by) }));
}

describe("upgradeAvailable", () => {
  it("is true only when the village holds a copy and the platform's version is higher", () => {
    expect(upgradeAvailable({ source: "village", platformVersion: 1 }, { version: 2 })).toBe(true);
    expect(upgradeAvailable({ source: "village", platformVersion: 2 }, { version: 2 })).toBe(false);
    expect(upgradeAvailable({ source: "village", platformVersion: 3 }, { version: 2 })).toBe(false);
    // A village still reading the platform's words already has the newest.
    expect(upgradeAvailable({ source: "platform", platformVersion: 1 }, { version: 2 })).toBe(false);
    // Words that came from no platform default have nothing to upgrade to.
    expect(upgradeAvailable({ source: "village", platformVersion: null }, { version: 2 })).toBe(false);
    expect(upgradeAvailable({ source: "village", platformVersion: 1 }, null)).toBe(false);
    expect(upgradeAvailable(null, { version: 2 })).toBe(false);
  });
});

describe("readDraft", () => {
  it("refuses a field that does not exist and one this email never knows, naming each", () => {
    const read = readDraft("gathering.confirm", { subject: "Hi {{gathering.titel}}", bodyMd: "{{path.name}}" });
    expect("problems" in read && read.problems).toEqual([
      "{{gathering.titel}} is not a field. Pick one from the list.",
      "{{path.name}} is never known when this email is sent. Pick one from the list.",
    ]);
  });

  it("refuses an empty subject or body and trims what it keeps", () => {
    const empty = readDraft("gathering.confirm", { subject: " ", bodyMd: "" });
    expect("problems" in empty && empty.problems).toEqual(["Write a subject line.", "Write the email itself."]);
    const ok = readDraft("gathering.confirm", { subject: "  Hello  ", preheader: "  ", bodyMd: "Body\r\n" });
    expect(ok).toEqual({ draft: { subject: "Hello", preheader: null, bodyMd: "Body" } });
  });
});

describe.skipIf(!configured)("a village's words, stored", () => {
  it("reads the platform's words while the village holds none", async () => {
    const live = await readLiveWords(pool, "gathering.reminder_day");
    expect(live).toMatchObject({ source: "platform", version: 1, platformVersion: 1, subject: defaultTemplate("gathering.reminder_day")!.subject });
    expect(await readLiveWords(pool, "no.such.template")).toBeNull();
  });

  it("makes a new version on every save and brings an old one back on restore", async () => {
    const key = "gathering.confirm";
    expect(await saveWords(pool, key, draft("First edit"), "u-1")).toBe(2);
    // The first save adopts the platform's words as version 1, then saves the edit.
    expect(await rowsOf(key)).toEqual([
      { version: 1, state: "retired", subject: defaultTemplate(key)!.subject, platformVersion: 1, editedBy: null },
      { version: 2, state: "live", subject: "First edit", platformVersion: 1, editedBy: "u-1" },
    ]);
    expect(await saveWords(pool, key, draft("Second edit"), "u-2")).toBe(3);
    expect((await readLiveWords(pool, key))?.subject).toBe("Second edit");

    expect(await restoreWords(pool, key, 2)).toBe(true);
    expect(await readLiveWords(pool, key)).toMatchObject({ source: "village", version: 2, subject: "First edit" });
    const rows = await rowsOf(key);
    expect(rows.filter((r) => r.state === "live").map((r) => r.version)).toEqual([2]);
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);

    // The platform's own words are one restore away.
    expect(await restoreWords(pool, key, 1)).toBe(true);
    expect((await readLiveWords(pool, key))?.subject).toBe(defaultTemplate(key)!.subject);
    expect(await restoreWords(pool, key, 99)).toBe(false);
  });

  it("keeps exactly one live version when two saves race", async () => {
    const key = "gathering.changed";
    const [a, b] = await Promise.all([saveWords(pool, key, draft("Racer A"), "u-a"), saveWords(pool, key, draft("Racer B"), "u-b")]);
    expect(a).not.toBe(b);
    const rows = await rowsOf(key);
    expect(rows.filter((r) => r.state === "live")).toHaveLength(1);
    expect(new Set(rows.map((r) => r.version)).size).toBe(rows.length);
  });

  it("raises the upgrade flag only when the platform's words are newer than the village's copy", async () => {
    const key = "gathering.cancelled";
    await saveWords(pool, key, draft("Our own words"), "u-1");
    expect((await wordsDetail(pool, key))?.upgradeAvailable).toBe(false);
    // As if the copy came from an older platform default.
    await pool.query("UPDATE comms_templates SET platform_version = 0 WHERE template_key = ?", [key]); // module-review-ok: ageing the copy in this suite's own scratch schema
    const detail = await wordsDetail(pool, key);
    expect(detail?.upgradeAvailable).toBe(true);
    expect(detail?.platform?.subject).toBe(defaultTemplate(key)!.subject);
    expect((await listWords(pool, [key]))[0]).toMatchObject({ key, source: "village", upgradeAvailable: true });

    const adopted = await adoptPlatformWords(pool, key, "u-1");
    const after = await wordsDetail(pool, key);
    expect(after?.live).toMatchObject({ version: adopted, subject: defaultTemplate(key)!.subject, platformVersion: 1 });
    expect(after?.upgradeAvailable).toBe(false);
    // Their own words are still in the history.
    expect(after?.versions.some((v) => v.subject === "Our own words")).toBe(true);
  });

  it("adopts the platform's words for a journey without touching words the village already holds", async () => {
    await saveWords(pool, "gathering.reminder_soon", draft("Ours"), "u-1");
    const copied = await ensureAdopted(pool, ["gathering.reminder_soon", "gathering.waitlisted", "no.such.template"]);
    expect(copied).toEqual(["gathering.waitlisted"]);
    expect((await readLiveWords(pool, "gathering.reminder_soon"))?.subject).toBe("Ours");
    expect(await readLiveWords(pool, "gathering.waitlisted")).toMatchObject({ source: "village", version: 1, platformVersion: 1 });
    expect(await ensureAdopted(pool, ["gathering.waitlisted"])).toEqual([]);
  });

  it("lists every key it is given, then any key only the village holds, with the editor's name in the history", async () => {
    await pool.query( // module-review-ok: a member row in this suite's own scratch schema, for the editor's name
      "INSERT INTO users (id, name, email, password_hash) VALUES ('u-named', 'Robin Editor', 'robin@example.test', 'x')",
    );
    await saveWords(pool, "poll.locked", draft("Set"), "u-named");
    const list = await listWords(pool, ["poll.locked", "poll.moved"]);
    expect(list.map((s) => [s.key, s.source])).toEqual([
      ["poll.locked", "village"],
      ["poll.moved", "platform"],
      ...list.slice(2).map((s) => [s.key, "village"]),
    ]);
    const detail = await wordsDetail(pool, "poll.locked");
    expect(detail?.versions[0]).toMatchObject({ state: "live", editedBy: "u-named", editedByName: "Robin Editor" });
  });
});
