/**
 * VILLAGE COMMS, LETTERS, DRIVEN THROUGH THE BUILT SERVER (the letters
 * lane's e2e; the comms build spec 5.12 and section 8).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. Time is driven the way the spec says:
 * "run now" for the letters job and the drain, and moments moved in SQL.
 *
 *   - the letters routes answer the comms module's 404 while it is off;
 *   - a letter is written, previewed with its count and first names, and
 *     tested to its author;
 *   - a stale confirmation is refused;
 *   - a confirmation for words that changed after the preview is refused;
 *   - the same letter confirmed twice, at once, sends once;
 *   - a recipient who unsubscribed between the preview and the send is skipped;
 *   - History's numbers match what the fake provider was handed and reported;
 *   - a scheduled letter can be moved and cancelled, and sends when it is due;
 *   - a send that stopped part way resumes;
 *   - the daily limit refuses the fourth letter in a day.
 *
 * The people are seeded in SQL before boot, with a yes to letters, the way
 * the people lane's own suite seeds what a village already held. The one
 * unsubscribe is the real one-click route, signed in this process with the
 * same VILLAGE_SECRETS_KEY the server holds; so is the stale confirmation.
 *
 * Run `pnpm build` first: this boots the BUILT server. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER and build on each other.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForHealth } from "./db/e2eBoot";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { signConfirm } from "./lib/comms/letters";
import { linkKey, signLink } from "./lib/comms/links";
import { makeWebhookSecret, startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.letters] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 32702 + (process.pid % 50);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-letters-admin";
const PASSWORD = "CommsLetters123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_d2";
const SENDER = "Test Village <hello@village.example.test>";
const SECRETS_KEY = "1f".repeat(32); // module-review-ok: fixture sealing key, same as every e2e suite
const WEBHOOK_SECRET = makeWebhookSecret();
const KEY = linkKey({ VILLAGE_SECRETS_KEY: SECRETS_KEY } as NodeJS.ProcessEnv);
const L = "/api/admin/comms/letters";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];
let founderToken = "";

const people = {
  ada: { userId: `ltr-ada-${PORT}`, contactId: `ct_ltr_ada_${PORT}`, email: `ada-${PORT}@example.test`, name: "Ada Member" },
  ben: { userId: `ltr-ben-${PORT}`, contactId: `ct_ltr_ben_${PORT}`, email: `ben-${PORT}@example.test`, name: "Ben Member" },
  cleo: { userId: null, contactId: `ct_ltr_cleo_${PORT}`, email: `cleo-${PORT}@example.test`, name: "Cleo Guest" },
};

interface Answer {
  status: number;
  json: any;
}

let ipSeq = 0;
async function call(method: string, route: string, opts: { body?: unknown; form?: string; token?: string | null } = {}): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const headers: Record<string, string> = { "X-Forwarded-For": `10.74.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (opts.form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(BASE + route, { method, headers, body }); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: reading back and arranging the scratch schema this suite provisioned
  return rows;
}

const run = (job: "letters" | "drain") => call("POST", "/api/admin/comms/run", { body: { job } });
const key = () => `send:${Math.random().toString(36).slice(2)}${Date.now()}`;
const letter = (subject: string, bodyMd = "The water tested clean. Come and see it on Saturday.") => ({
  subject,
  preheader: "",
  bodyMd,
  layout: "plain",
  audience: { kind: "everyone" },
});

/** Write a letter and preview it. Answers its id and the preview. */
async function previewed(subject: string): Promise<{ id: string; preview: any }> {
  const made = await call("POST", L, { body: letter(subject) });
  expect(made.status, JSON.stringify(made.json)).toBe(200);
  const id = String(made.json.letter.id);
  const preview = await call("POST", `${L}/${id}/preview`);
  expect(preview.status, JSON.stringify(preview.json)).toBe(200);
  return { id, preview: preview.json };
}

/** Every letter so far went more than a day ago: the daily limit and the gap start fresh. */
const forgetWindow = () => q("UPDATE comms_letters SET sent_at = sent_at - INTERVAL 2 DAY WHERE sent_at IS NOT NULL");

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms letters test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-letters-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  // Two members and one guest, each of whom said yes to letters.
  for (const p of Object.values(people)) {
    if (p.userId) await q("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, ?, ?, 'x', '[]')", [p.userId, p.name, p.email]);
    await q("INSERT INTO comms_contacts (id, email_key, email, name, user_id, first_source) VALUES (?, ?, ?, ?, ?, 'test')", [p.contactId, p.email, p.email, p.name, p.userId]);
    await q("INSERT INTO comms_permissions (contact_id, kind, state, basis, source, evidence) VALUES (?, 'letters', 'yes', 'asked', 'test', ?)", [
      p.contactId,
      JSON.stringify({ words: "Yes, send me village news" }),
    ]);
  }

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: "run now" drives the letters job here.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      // Short on purpose: a throwaway test value, and the intake scan reads lengths.
      AUTH_TOKEN_SECRET: "comms-d2-token",
      VILLAGE_SECRETS_KEY: SECRETS_KEY,
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
      EMAIL_FROM: SENDER,
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Letters Founder" }, token: null });
  if (boot.status !== 200) throw new Error(`bootstrap: ${JSON.stringify(boot.json)}`);
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  if (!founderToken) throw new Error("the founder holds no session");
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, letters", () => {
  let first = { id: "", preview: null as any };

  it("answers the comms module's 404 on the letters routes while the module is off, and refuses somebody signed out", async () => {
    const off = await call("GET", L);
    expect(off.status, JSON.stringify(off.json)).toBe(404);
    expect(off.json).toMatchObject({ error: "module_disabled", module: "comms" });
    const on = await call("PUT", "/api/admin/modules/comms/lifecycle", { body: { lifecycle: "members", examples: false } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    expect((await call("GET", L, { token: null })).status).toBe(401);
    const list = await call("GET", L);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    expect(list.json).toMatchObject({ letters: [], ready: true, limit: { perDay: 3, today: 0 } });
  });

  it("writes a letter, previews it with the count and the first names, and sends the author a test", async () => {
    first = await previewed("The well is finished");
    expect(first.preview).toMatchObject({ count: 3, inGroup: 3, leftOut: 0 });
    expect(first.preview.names).toEqual(["Ada Member", "Ben Member", "Cleo Guest"]);
    expect(first.preview.html).toContain("The water tested clean.");
    expect(first.preview.confirmToken).toBeTruthy();

    const before = fake!.emails().length;
    const test = await call("POST", `${L}/${first.id}/test`);
    expect(test.status, JSON.stringify(test.json)).toBe(200);
    expect(test.json).toMatchObject({ status: "sent", sentTo: FOUNDER_EMAIL });
    const handed = fake!.emails().slice(before);
    expect(handed.map((e) => e.body.to).flat()).toEqual([FOUNDER_EMAIL]);
    expect(handed[0].body.subject).toBe("The well is finished");
  });

  it("refuses a stale confirmation", async () => {
    const stale = signConfirm({ l: first.id, h: "0".repeat(64), n: 3, x: Math.floor(Date.now() / 1000) - 60 }, KEY);
    const r = await call("POST", `${L}/${first.id}/send`, { body: { confirmToken: stale, idempotencyKey: key() } });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json.error).toMatch(/ran out/);
  });

  it("refuses a confirmation when the letter changed after the preview", async () => {
    const changed = await call("PUT", `${L}/${first.id}`, { body: letter("The well is finished", "The water tested clean. Bring a cup.") });
    expect(changed.status, JSON.stringify(changed.json)).toBe(200);
    const r = await call("POST", `${L}/${first.id}/send`, { body: { confirmToken: first.preview.confirmToken, idempotencyKey: key() } });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json.error).toMatch(/changed since the preview/);
    expect((await q("SELECT COUNT(*) AS n FROM comms_messages WHERE letter_id = ?", [first.id]))[0].n).toBe(0);
  });

  it("sends the same letter confirmed twice once, and skips a recipient who unsubscribed between the preview and the send", async () => {
    const again = await call("POST", `${L}/${first.id}/preview`);
    expect(again.json.count).toBe(3);
    // Cleo presses the one-click unsubscribe in an earlier letter, signed out.
    const link = signLink("unsubscribe", { c: people.cleo.contactId, k: "letters" }, 30, { key: KEY });
    const stop = await call("POST", `/api/comms/unsubscribe?t=${encodeURIComponent(link)}`, { form: "List-Unsubscribe=One-Click", token: null });
    expect(stop.status, JSON.stringify(stop.json)).toBe(200);

    const k = key();
    const body = { confirmToken: again.json.confirmToken, idempotencyKey: k };
    const [a, b] = await Promise.all([call("POST", `${L}/${first.id}/send`, { body }), call("POST", `${L}/${first.id}/send`, { body })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.json.duplicate, b.json.duplicate].sort()).toEqual([false, true]);
    const once = a.json.duplicate ? b.json : a.json;
    expect(once).toMatchObject({ state: "sent", counts: { posted: 2, skipped: 1, pending: 0 } });

    const snap = await q("SELECT contact_id, status, skip_reason FROM comms_letter_recipients WHERE letter_id = ? ORDER BY contact_id", [first.id]);
    expect(snap.find((r) => r.contact_id === people.cleo.contactId)).toMatchObject({ status: "skipped", skip_reason: "no_permission" });
    const rows = await q("SELECT status FROM comms_messages WHERE letter_id = ? AND kind = 'letters'", [first.id]);
    expect(rows.map((r) => r.status).sort()).toEqual(["queued", "queued", "skipped"]);
  });

  it("matches History's numbers to what the fake provider was handed and reported", async () => {
    const drained = await run("drain");
    expect(drained.status, JSON.stringify(drained.json)).toBe(200);
    const mine = await q("SELECT id, provider_message_id, to_email FROM comms_messages WHERE letter_id = ? AND status = 'sent' ORDER BY to_email", [first.id]);
    const handed = fake!.emails().filter((e) => mine.some((m) => m.id === e.idempotencyKey));
    expect(handed.map((e) => e.body.to).flat().sort()).toEqual([people.ada.email, people.ben.email].sort());
    // Every letter carries the one-click unsubscribe header.
    expect(handed.every((e) => JSON.stringify(e.body.headers ?? {}).includes("List-Unsubscribe"))).toBe(true);

    const hook = `${BASE}/api/comms/webhooks/resend`;
    const delivered = await fake!.deliverWebhook(hook, "delivered", { emailId: String(mine[0].provider_message_id), secret: WEBHOOK_SECRET });
    expect(delivered.status).toBe(200);
    const bounced = await fake!.deliverWebhook(hook, "bounced", { emailId: String(mine[1].provider_message_id), secret: WEBHOOK_SECRET });
    expect(bounced.status).toBe(200);

    const list = await call("GET", L);
    const view = list.json.letters.find((l: any) => l.id === first.id);
    expect(view).toMatchObject({ state: "sent", audienceLabel: "Everyone who said yes to letters" });
    expect(view.numbers).toMatchObject({ sent: handed.length, delivered: 1, bounced: 1, complained: 0, skipped: 1, waiting: 0 });
    // Cleo's yes back, for the cases below. Ben's address bounced, so it takes no more letters.
    await q("UPDATE comms_permissions SET state = 'yes' WHERE contact_id = ? AND kind = 'letters'", [people.cleo.contactId]);
  });

  it("moves and cancels a scheduled letter, and sends it when it is due", async () => {
    await forgetWindow();
    const s = await previewed("Harvest supper");
    expect(s.preview).toMatchObject({ count: 2, inGroup: 3, leftOut: 1 });
    expect(s.preview.names).toEqual(["Ada Member", "Cleo Guest"]);
    const at = new Date(Date.now() + 10 * 60_000).toISOString();
    const scheduled = await call("POST", `${L}/${s.id}/send`, { body: { confirmToken: s.preview.confirmToken, idempotencyKey: key(), scheduledFor: at } });
    expect(scheduled.status, JSON.stringify(scheduled.json)).toBe(200);
    expect(scheduled.json).toMatchObject({ state: "scheduled", duplicate: false });
    // Its words are held while it waits.
    expect((await call("PUT", `${L}/${s.id}`, { body: letter("Harvest supper!") })).status).toBe(409);

    const moved = await call("POST", `${L}/${s.id}/reschedule`, { body: { scheduledFor: new Date(Date.now() + 20 * 60_000).toISOString() } });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect((await call("POST", `${L}/${s.id}/reschedule`, { body: { scheduledFor: new Date(Date.now() - 60_000).toISOString() } })).status).toBe(400);
    expect((await run("letters")).json.summary).toMatchObject({ sent: 0 });

    expect((await call("POST", `${L}/${s.id}/cancel`)).status).toBe(200);
    const again = await call("POST", `${L}/${s.id}/preview`);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const rescheduled = await call("POST", `${L}/${s.id}/send`, { body: { confirmToken: again.json.confirmToken, idempotencyKey: key(), scheduledFor: at } });
    expect(rescheduled.json).toMatchObject({ state: "scheduled" });
    await q("UPDATE comms_letters SET scheduled_for = CURRENT_TIMESTAMP - INTERVAL 1 MINUTE WHERE id = ?", [s.id]);
    const due = await run("letters");
    expect(due.json.summary).toMatchObject({ sent: 1 });
    expect((await q("SELECT state, posted_count FROM comms_letters WHERE id = ?", [s.id]))[0]).toMatchObject({ state: "sent", posted_count: 2 });
  });

  it("resumes a send that stopped part way", async () => {
    await forgetWindow();
    const r = await previewed("Work day on Sunday");
    // The claim happened two days ago by the window's clock, and its heartbeat stopped eleven minutes ago.
    await q(
      "UPDATE comms_letters SET state = 'sending', sent_at = CURRENT_TIMESTAMP - INTERVAL 2 DAY, updated_at = CURRENT_TIMESTAMP - INTERVAL 11 MINUTE WHERE id = ?",
      [r.id],
    );
    const resumed = await run("letters");
    expect(resumed.json.summary).toMatchObject({ resumed: 1 });
    const snap = await q("SELECT status FROM comms_letter_recipients WHERE letter_id = ?", [r.id]);
    expect(snap.map((x) => x.status)).toEqual(["posted", "posted"]);
    expect((await q("SELECT state FROM comms_letters WHERE id = ?", [r.id]))[0].state).toBe("sent");
    expect((await run("letters")).json.summary).toMatchObject({ resumed: 0 });
  });

  it("refuses the fourth letter in a day, and a second inside ten minutes", async () => {
    await forgetWindow();
    for (let i = 1; i <= 3; i += 1) {
      const l = await previewed(`Note ${i}`);
      const sent = await call("POST", `${L}/${l.id}/send`, { body: { confirmToken: l.preview.confirmToken, idempotencyKey: key() } });
      expect(sent.status, JSON.stringify(sent.json)).toBe(200);
      if (i === 1) {
        const soon = await previewed("Too soon");
        const refused = await call("POST", `${L}/${soon.id}/send`, { body: { confirmToken: soon.preview.confirmToken, idempotencyKey: key() } });
        expect(refused.status).toBe(409);
        expect(refused.json.error).toMatch(/10 minutes apart/);
      }
      await q("UPDATE comms_letters SET sent_at = sent_at - INTERVAL 11 MINUTE WHERE sent_at > CURRENT_TIMESTAMP - INTERVAL 1 DAY");
    }
    const fourth = await previewed("Note 4");
    const refused = await call("POST", `${L}/${fourth.id}/send`, { body: { confirmToken: fourth.preview.confirmToken, idempotencyKey: key() } });
    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json.error).toMatch(/at most 3 letters a day/);
    const list = await call("GET", L);
    expect(list.json.limit).toMatchObject({ perDay: 3, today: 3 });
  });
});
