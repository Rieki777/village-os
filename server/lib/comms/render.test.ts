import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { defaultTemplate } from "../../../shared/comms/defaults/templates";
import type { EmailVillage } from "../../../shared/comms/letterHtml";
import { GAME_CONFIG } from "../../../shared/gameConfig";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { verifyLink } from "./links";
import { derivedValues, loadEmailVillage, preferencesLink, renderLetter, renderLettersConfirm, renderTemplate } from "./render";
import { saveWords } from "./templates";

/**
 * Rendering: the village's own words when it holds them, the platform's when
 * not, an editor's draft when previewing, and the reader's own preferences
 * link signed for them (the comms build spec 5.5).
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

const VILLAGE: EmailVillage = {
  name: "Test Village",
  url: "https://village.example",
  logoUrl: null,
  seed: null,
  character: null,
  postalAddress: "1 Lane",
};

/** A context that must never reach the database: a draft is rendered from what it carries. */
const noDatabase = () => {
  throw new Error("this render should not have read the database");
};

describe("rendering without a database", () => {
  it("renders an editor's draft from the words it carries, as a draft with no version", async () => {
    const email = await renderTemplate(
      "gathering.confirm",
      { "person.firstName": "Ada", "gathering.title": "Supper" },
      { getPool: noDatabase as never, village: VILLAGE, words: { subject: "Draft for {{gathering.title}}", preheader: null, bodyMd: "Hi {{person.firstName}}." } },
    );
    expect(email).toMatchObject({ subject: "Draft for Supper", source: "draft", version: null, kind: "events", templateKey: "gathering.confirm" });
    expect(email.text).toContain("Hi Ada.");
  });

  it("signs the reader's preferences link for their contact, carrying the contact id and nothing else", async () => {
    const link = preferencesLink("https://village.example/", "ct_abc", Date.UTC(2026, 9, 2));
    const token = decodeURIComponent(link.split("?t=")[1]);
    expect(link.startsWith("https://village.example/email/preferences?t=")).toBe(true);
    expect(verifyLink("preferences", token, { now: Date.UTC(2026, 9, 3) })).toEqual({ c: "ct_abc" });
    expect(verifyLink("unsubscribe", token, { now: Date.UTC(2026, 9, 3) })).toBeNull();

    const email = await renderTemplate(
      "gathering.confirm",
      { "gathering.title": "Supper" },
      { getPool: noDatabase as never, village: VILLAGE, words: { subject: "S", preheader: null, bodyMd: "Body" }, contactId: "ct_abc", now: Date.UTC(2026, 9, 2) },
    );
    expect(email.html).toContain(`href="${link}"`);
    expect(email.text).toContain(`Choose which emails you get: ${link}`);
  });

  it("knows a path's own name and page from the path list", () => {
    const resident = GAME_CONFIG.paths.find((p) => p.id === "resident")!;
    expect(derivedValues("path.resident.welcome", "https://village.example")).toEqual({
      "path.name": resident.label,
      "path.pageUrl": `https://village.example${resident.route}`,
    });
    expect(derivedValues("gathering.confirm", "https://village.example")).toEqual({});
  });
});

describe.skipIf(!configured)("rendering against a village's words", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("renders the platform's words until the village saves its own, then the village's", async () => {
    const vars = { "person.firstName": "Ada", "gathering.title": "Supper", "gathering.when": "Saturday at 6:00 PM", "gathering.url": "https://village.example/events/1" };
    const before = await renderTemplate("gathering.reminder_day", vars, { getPool: () => pool, village: VILLAGE });
    expect(before).toMatchObject({ source: "platform", version: 1, subject: "Tomorrow: Supper" });

    await saveWords(pool, "gathering.reminder_day", { subject: "See you tomorrow at {{gathering.title}}", preheader: null, bodyMd: "Hi {{person.firstName}}." }, null);
    const after = await renderTemplate("gathering.reminder_day", vars, { getPool: () => pool, village: VILLAGE });
    expect(after).toMatchObject({ source: "village", version: 2, subject: "See you tomorrow at Supper" });
    expect(after.text.startsWith("Hi Ada.")).toBe(true);
  });

  it("refuses loudly a template nobody wrote", async () => {
    await expect(renderTemplate("no.such.template", {}, { getPool: () => pool, village: VILLAGE })).rejects.toThrow(/no words/);
  });

  it("sets a letter inside the village's letter frame, posted as a letter", async () => {
    const email = await renderLetter(
      "The well is **finished**.",
      { "letter.subject": "News of the well", "person.firstName": "Ada" },
      { getPool: () => pool, village: VILLAGE },
    );
    expect(email).toMatchObject({ templateKey: "letter.layout", kind: "letters", subject: "News of the well", preheader: "The well is finished." });
    expect(email.html).toContain("The well is <strong>finished</strong>.");
    expect(email.text).toContain("You're getting this because you said yes to letters from Test Village.");
    expect(defaultTemplate("letter.layout")?.bodyMd).toBe("{{letter.body}}");
  });

  it("reads the village's name, logo and colours from its brand, and its postal address from comms settings", async () => {
    const write = (key: string, value: unknown) =>
      pool.query( // module-review-ok: seeding this suite's own scratch schema with two stored documents
        "INSERT INTO app_config (config_key, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [key, JSON.stringify(value)],
      );
    const blank = await loadEmailVillage(pool, "https://village.example/");
    expect(blank).toEqual({ name: GAME_CONFIG.project.name, url: "https://village.example", logoUrl: null, seed: null, character: null, postalAddress: "" });

    await write("brand", { project: { name: "Riverbend" }, images: { logo: "/api/uploads/brand-1.webp" }, theme: { seed: "#2d6a4f", character: "field" } });
    await write("comms-settings", { postalAddress: "  1 Mill Lane, Riverbend  " });
    expect(await loadEmailVillage(pool, "https://village.example")).toEqual({
      name: "Riverbend",
      url: "https://village.example",
      logoUrl: "https://village.example/api/uploads/brand-1.webp",
      seed: "#2d6a4f",
      character: "field",
      postalAddress: "1 Mill Lane, Riverbend",
    });

    // A blank name inherits the platform's, the same rule as the site's merged config.
    await write("brand", { project: { name: "" }, images: { logo: "http://elsewhere.example/logo.png" } });
    const inherited = await loadEmailVillage(pool, "https://village.example");
    expect(inherited.name).toBe(GAME_CONFIG.project.name);
    // An http logo on somebody else's host is never loaded by an email.
    expect(inherited.logoUrl).toBeNull();
  });

  it("renders the letters confirmation for the people lane's hook, its link the one button and a clean token in the text", async () => {
    const link = "https://village.example/email/a?t=eyJwIjoibGV0dGVycyJ9.c2lnbmF0dXJl";
    const words = await renderLettersConfirm(
      () => pool,
      "https://village.example",
      { "person.firstName": "Ana", "links.lettersConfirm": link },
      "ct_letters",
    );
    expect(words.subject.startsWith("Confirm your letters from ")).toBe(true);
    const buttons = Array.from(words.html.matchAll(/<td align="center" bgcolor=[^>]*><a href="([^"]+)"/g)).map((m) => m[1]);
    expect(buttons).toEqual([link]);
    // The regex the people lane's e2e suite reads the token with, over the text part.
    const token = decodeURIComponent(words.text.match(/\/email\/a\?t=([^\s]+)/)?.[1] ?? "");
    expect(token).toBe("eyJwIjoibGV0dGVycyJ9.c2lnbmF0dXJl");
    // The footer carries the reader's own preferences link.
    expect(words.text).toMatch(/Choose which emails you get: https:\/\/village\.example\/email\/preferences\?t=/);
  });

  it("gives the same email for the same inputs, byte for byte", async () => {
    const vars = { "person.firstName": "Ada", "gathering.title": "Supper" };
    const ctx = { getPool: () => pool, village: VILLAGE, contactId: "ct_1", now: Date.UTC(2026, 9, 2) };
    const a = await renderTemplate("gathering.waitlisted", vars, ctx);
    const b = await renderTemplate("gathering.waitlisted", vars, ctx);
    const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
    expect(hash(a.html)).toBe(hash(b.html));
    expect(a.text).toBe(b.text);
  });
});
