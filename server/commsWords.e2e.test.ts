/**
 * VILLAGE COMMS, THE WORDS, DRIVEN THROUGH THE BUILT SERVER
 * (the comms build spec 5.5 and 8, lane B3).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. Then, in order:
 *
 *   - the Words routes answer the comms module's 404 while it is off, which
 *     can only happen while each one carries the module gate, and answer the
 *     founder once the module rehearses in preview;
 *   - every default email is listed in its group, on the platform's words;
 *   - a preview escapes HTML typed into the words and carries every link in
 *     its plain-text part;
 *   - "Send me a test" hands the provider exactly the subject, HTML and text
 *     the preview showed, posted as essential with origin `comms.test`;
 *   - saving makes a new version, restoring brings an old one back, and the
 *     upgrade flag appears when the platform's words are newer than the
 *     village's copy and goes when they are adopted;
 *   - a field the email cannot use is refused with its name.
 *
 * Run `pnpm build` first: this boots the BUILT server. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";
import { startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.words] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 3500 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-words-admin";
const PASSWORD = "CommsWords123!";
const FOUNDER_EMAIL = `words-founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_b3";
const SENDER = "Test Village <hello@village.example.test>";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WORDS = "/api/admin/comms/words";

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms words test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-words-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler, for the reason selfMembership.routes.e2e.test.ts gives.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "comms-words-secret",
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: SENDER,
      FRONTEND_URL: "https://village.example.test",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch { /* not up yet */ }
    await settle(400);
  }

  // The founder, signed in through the set-password link their bootstrap email carried.
  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Ada Lovelace" },
    token: null,
  });
  if (boot.status !== 200) throw new Error(`bootstrap failed: ${JSON.stringify(boot.json)}`);
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  if (!founderToken) throw new Error(`the founder holds no session: ${JSON.stringify(setPw.json)}`);
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, the words", () => {
  it("answers the comms module's 404 on every Words route while the module is off, and the founder once it rehearses", async () => {
    const off = await call("GET", WORDS);
    expect(off.status, JSON.stringify(off.json)).toBe(404);
    expect(off.json).toMatchObject({ error: "module_disabled", module: "comms" });
    expect((await call("POST", `${WORDS}/gathering.confirm/preview`, { body: {} })).status).toBe(404);
    expect((await call("PUT", `${WORDS}/gathering.confirm`, { body: { subject: "x", bodyMd: "y" } })).status).toBe(404);

    const on = await call("PUT", "/api/admin/modules/comms/lifecycle", { body: { lifecycle: "preview", examples: false } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    const list = await call("GET", WORDS);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    // A stranger is told nothing exists while the module only rehearses.
    expect((await call("GET", WORDS, { token: null })).status).toBe(404);
  });

  it("lists every default email in its group, each on the platform's words", async () => {
    const list = await call("GET", WORDS);
    const items = list.json.groups.flatMap((g: any) => g.items);
    expect(items.length).toBeGreaterThanOrEqual(43);
    expect(items.every((i: any) => i.source === "platform" && i.upgradeAvailable === false)).toBe(true);
    expect(list.json.groups.map((g: any) => g.id)).toEqual(expect.arrayContaining(["gathering.going", "polls", "path.investor", "letters"]));
    expect(list.json.postalAddressSet).toBe(false);
  });

  it("escapes HTML typed into the words, and carries every link of the email in its text part", async () => {
    const preview = await call("POST", `${WORDS}/gathering.confirm/preview`, {
      body: {
        draft: {
          subject: "Coming to {{gathering.title}}",
          preheader: "",
          bodyMd: "Hi {{person.firstName}}, <script>alert('x')</script> <b>bold</b>\n\n- **Where:** {{gathering.where}}\n\n[See the gathering]({{gathering.url}})\n\nOr [tell us you can't]({{gathering.cantMakeIt}}).",
        },
      },
    });
    expect(preview.status, JSON.stringify(preview.json)).toBe(200);
    const html: string = preview.json.html;
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(preview.json.text).toContain("<script>alert('x')</script>");
    expect(preview.json.text.startsWith("Hi Ada,")).toBe(true);
    const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1].replace(/&amp;/g, "&"));
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const href of hrefs) {
      expect(href.startsWith("https://village.example.test"), href).toBe(true);
      expect(preview.json.text, href).toContain(href);
    }
    expect(preview.json.unknown).toEqual([]);
  });

  it("sends the test with exactly the subject, HTML and text the preview showed", async () => {
    const body = { draft: { subject: "A seat for {{person.firstName}}", preheader: "Preview line", bodyMd: "Hi {{person.firstName}},\n\n[See the gathering]({{gathering.url}})" } };
    const preview = await call("POST", `${WORDS}/gathering.confirm/preview`, { body });
    const before = fake!.emails().length;
    const test = await call("POST", `${WORDS}/gathering.confirm/test`, { body });
    expect(test.status, JSON.stringify(test.json)).toBe(200);
    expect(test.json).toMatchObject({ status: "sent", sentTo: FOUNDER_EMAIL });

    const sent = fake!.emails().slice(before);
    expect(sent, "exactly one email reached the provider").toHaveLength(1);
    expect(sent[0].body.to).toEqual([FOUNDER_EMAIL]);
    expect(sent[0].body.subject).toBe(preview.json.subject);
    expect(sent[0].body.html).toBe(preview.json.html);
    expect(sent[0].body.text).toBe(preview.json.text);
    // Essential: it never offers to unsubscribe.
    expect(sent[0].body.headers).toBeUndefined();

    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT kind, origin, status, template_key, body_html FROM comms_messages WHERE id = ?",
      [test.json.messageId],
    );
    expect(rows[0]).toMatchObject({ kind: "essential", origin: "comms.test", status: "sent", template_key: "gathering.confirm", body_html: null });
  });

  it("saves a new version, brings an old one back, and refuses a field the email cannot use", async () => {
    const refused = await call("PUT", `${WORDS}/gathering.reminder_day`, { body: { subject: "Hi {{poll.leading}}", bodyMd: "x" } });
    expect(refused.status).toBe(400);
    expect(refused.json.problems).toEqual(["{{poll.leading}} is never known when this email is sent. Pick one from the list."]);

    const saved = await call("PUT", `${WORDS}/gathering.reminder_day`, {
      body: { subject: "See you tomorrow at {{gathering.title}}", preheader: "", bodyMd: "Hi {{person.firstName}}, see you tomorrow." },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json.saved).toBe(2);
    expect(saved.json.detail.versions.map((v: any) => [v.version, v.state])).toEqual([[2, "live"], [1, "retired"]]);
    const after = await call("POST", `${WORDS}/gathering.reminder_day/preview`, { body: {} });
    expect(after.json).toMatchObject({ source: "village", version: 2, subject: "See you tomorrow at Community supper" });

    const restored = await call("POST", `${WORDS}/gathering.reminder_day/restore`, { body: { version: 1 } });
    expect(restored.status, JSON.stringify(restored.json)).toBe(200);
    expect(restored.json.detail.live).toMatchObject({ version: 1, subject: "Tomorrow: {{gathering.title}}" });
    const back = await call("POST", `${WORDS}/gathering.reminder_day/preview`, { body: {} });
    expect(back.json.subject).toBe("Tomorrow: Community supper");
  });

  it("raises the upgrade flag when the platform's words are newer than the village's copy, and lowers it on adopting", async () => {
    // As if the village's copy came from an older platform default.
    await pool.query("UPDATE comms_templates SET platform_version = 0 WHERE template_key = 'gathering.reminder_day'"); // module-review-ok: ageing a copy in this suite's own scratch schema
    const flagged = await call("GET", `${WORDS}/gathering.reminder_day`);
    expect(flagged.json.upgradeAvailable).toBe(true);
    expect(flagged.json.platform.subject).toBe("Tomorrow: {{gathering.title}}");
    const listed = (await call("GET", WORDS)).json.groups.flatMap((g: any) => g.items).find((i: any) => i.key === "gathering.reminder_day");
    expect(listed).toMatchObject({ source: "village", upgradeAvailable: true });

    const adopted = await call("POST", `${WORDS}/gathering.reminder_day/adopt`);
    expect(adopted.status, JSON.stringify(adopted.json)).toBe(200);
    expect(adopted.json.detail).toMatchObject({ upgradeAvailable: false, live: { version: 3, platformVersion: 1 } });
  });
});
