/**
 * VILLAGE COMMS, THE ADDRESS BOOK, DRIVEN THROUGH THE BUILT SERVER
 * (the comms build spec 5.3, 5.4 and 5.17; lane B2's suite).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. The scratch schema is seeded BEFORE
 * the boot with a member, a form and a housing request, so the boot's own
 * one-time backfill has something to find. Then, in order:
 *
 *   - the backfill ran at boot, made a contact of each, and granted nothing;
 *   - a one-click unsubscribe works with no sign-in, a GET never acts, and a
 *     tampered, expired or wrong-purpose link is refused;
 *   - preferences work for an address with no account, and letters are
 *     confirmed by an email that reaches the provider, from a link it carries;
 *   - all of that while the comms module is OFF, which can only happen while
 *     the public routes sit outside every module gate;
 *   - stop everything suppresses, and the People screen shows the person,
 *     their stop and their emails, to the founder and to nobody signed out;
 *   - a member chooses from their own account, their export carries it, and
 *     deleting their account takes every comms row of theirs with it.
 *
 * Links are signed in this process with the same VILLAGE_SECRETS_KEY the
 * server is given, which is exactly the key the server derives its own from.
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
import { linkKey, signLink, type LinkPayload } from "./lib/comms/links";
import type { LinkPurpose } from "../shared/comms/kinds";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.people] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 3500 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-people-admin";
const PASSWORD = "CommsPeople123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
const PROVIDER_KEY = "re_test_lane_b2";
const SENDER = "Test Village <hello@village.example.test>";
/** The fixture sealing key every e2e suite uses (server/loop.e2e.test.ts). */
const SECRETS_KEY = "1f".repeat(32); // module-review-ok: fixture sealing key, same as every e2e suite

const MEMBER_BEFORE = "people-e2e-early";
const EARLY_EMAIL = "early.member@example.test";
const FORM_EMAIL = "form.person@example.test";
const HOUSING_EMAIL = "housing.person@example.test";
const LEAVER_EMAIL = `leaver-${PORT}@example.test`;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];
let founderToken = "";

interface Answer {
  status: number;
  json: any;
  text: string;
}

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; form?: string; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let body: string | undefined;
  if (opts.form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(BASE + route, { method, headers, body }); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: reading back the scratch schema this suite provisioned
  return rows;
}

const KEY = linkKey({ VILLAGE_SECRETS_KEY: SECRETS_KEY } as NodeJS.ProcessEnv);
const sign = (purpose: LinkPurpose, payload: LinkPayload, opts: { days?: number; now?: number } = {}) =>
  signLink(purpose, payload, opts.days ?? 30, { key: KEY, now: opts.now });
const t = (token: string) => `?t=${encodeURIComponent(token)}`;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const contactIdOf = async (email: string): Promise<string> =>
  String((await q("SELECT id FROM comms_contacts WHERE email_key = ?", [email.toLowerCase()]))[0]?.id ?? "");

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms people test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-people-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  // What the village already held before Village Comms shipped.
  await q("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, 'Early Member', ?, 'x', ?)", [
    MEMBER_BEFORE,
    EARLY_EMAIL,
    JSON.stringify(["resident"]),
  ]);
  await q("INSERT INTO submissions (id, type, status, data) VALUES ('sub-people-e2e', 'resident', 'new', ?)", [
    JSON.stringify({ email: FORM_EMAIL, name: "Fran Form", commsConsent: true }),
  ]);
  await q("INSERT INTO housing_reservations (id, home_type, name, email) VALUES ('res-people-e2e', 'casita', 'Hal Housing', ?)", [HOUSING_EMAIL]);

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
      AUTH_TOKEN_SECRET: "comms-people-secret",
      VILLAGE_SECRETS_KEY: SECRETS_KEY,
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: SENDER,
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
    } catch {
      /* not up yet */
    }
    await settle(400);
  }
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, the address book", () => {
  it("filled the address book at boot from what the village already held, and granted nothing", async () => {
    const rows = await q(
      "SELECT email_key, user_id, first_source FROM comms_contacts WHERE email_key IN (?) ORDER BY email_key",
      [[EARLY_EMAIL, FORM_EMAIL, HOUSING_EMAIL]],
    );
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { email_key: EARLY_EMAIL, user_id: MEMBER_BEFORE, first_source: "account" },
      { email_key: FORM_EMAIL, user_id: null, first_source: "resident" },
      { email_key: HOUSING_EMAIL, user_id: null, first_source: "housing" },
    ]);
    // The old form's consent field predates the box, so it is not a yes.
    expect(await q("SELECT contact_id FROM comms_permissions")).toHaveLength(0);
    expect(logs.join("")).toMatch(/\[comms\] address book backfill: \d+ address\(es\) seen, \d+ new contact\(s\).*No permission was granted\./);
    const ledger = await q("SELECT value FROM app_config WHERE config_key = 'data-migrations'");
    expect(JSON.stringify(ledger[0]?.value ?? "")).toContain("comms-address-book-backfill-2026-10");
  });

  it("bootstraps the founder who reads the People screen", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", {
      body: { password: ADMIN, email: FOUNDER_EMAIL, name: "People Founder" },
      token: null,
    });
    expect(boot.status, boot.text).toBe(200);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder holds a session").toBeTruthy();
    // The module stays OFF for the whole suite: everything below is plumbing.
    expect((await call("GET", "/api/admin/comms/status")).json?.module?.lifecycle).toBe("off");
  });

  it("unsubscribes on the one-click POST with no sign-in, never acts on a GET, and refuses a bad link", async () => {
    const contactId = await contactIdOf(FORM_EMAIL);
    expect(contactId).toBeTruthy();
    const link = sign("unsubscribe", { c: contactId, k: "events" });
    const count = async () => (await q("SELECT COUNT(*) AS n FROM comms_permissions WHERE contact_id = ?", [contactId]))[0].n;

    for (let i = 0; i < 2; i++) {
      const look = await call("GET", `/api/comms/unsubscribe${t(link)}`, { token: null });
      expect(look.status, look.text).toBe(200);
      expect(look.json.view).toMatchObject({ kind: "events", done: false });
    }
    expect(await count(), "a GET wrote nothing").toBe(0);

    const [body, sig] = link.split(".");
    const tampered = `${body}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    const expired = sign("unsubscribe", { c: contactId, k: "events" }, { days: 1, now: Date.now() - 3 * 86_400_000 });
    const wrongPurpose = sign("preferences", { c: contactId });
    for (const bad of [tampered, expired, wrongPurpose]) {
      const refused = await call("POST", `/api/comms/unsubscribe${t(bad)}`, { form: "List-Unsubscribe=One-Click", token: null });
      expect(refused.status, refused.text).toBe(400);
    }
    expect(await count()).toBe(0);

    // Exactly what a mail app sends for RFC 8058.
    const stop = await call("POST", `/api/comms/unsubscribe${t(link)}`, { form: "List-Unsubscribe=One-Click", token: null });
    expect(stop.status, stop.text).toBe(200);
    expect(await q("SELECT state, basis, source FROM comms_permissions WHERE contact_id = ? AND kind = 'events'", [contactId])).toEqual([
      expect.objectContaining({ state: "no", basis: "asked", source: "unsubscribe" }),
    ]);
  });

  it("works for an address with no account, and confirms letters by an email that reaches the provider", async () => {
    const contactId = await contactIdOf(FORM_EMAIL);
    const link = sign("preferences", { c: contactId });
    const page = await call("GET", `/api/comms/preferences${t(link)}`, { token: null });
    expect(page.status, page.text).toBe(200);
    expect(page.json.view).toMatchObject({ member: false, stopped: false });
    expect(page.text).not.toContain(FORM_EMAIL);

    const sendsBefore = fake!.requests.filter((r) => r.method === "POST" && r.path === "/emails").length;
    const ask = await call("POST", `/api/comms/preferences${t(link)}`, { body: { kind: "letters", on: true }, token: null });
    expect(ask.status, ask.text).toBe(200);
    const sends = fake!.requests.filter((r) => r.method === "POST" && r.path === "/emails");
    expect(sends.length).toBe(sendsBefore + 1);
    const confirmation = sends[sends.length - 1];
    expect(confirmation.body).toMatchObject({ to: [FORM_EMAIL] });
    // Essential: the person just asked for it, so it offers no unsubscribe.
    expect(confirmation.body.headers).toBeUndefined();
    const token = decodeURIComponent(String(confirmation.body.text ?? "").match(/\/email\/a\?t=([^\s]+)/)?.[1] ?? "");
    expect(token, "the email carries the confirm link").toBeTruthy();
    expect(await q("SELECT kind FROM comms_permissions WHERE contact_id = ? AND kind = 'letters'", [contactId])).toHaveLength(0);

    const shown = await call("GET", `/api/comms/action${t(token)}`, { token: null });
    expect(shown.status, shown.text).toBe(200);
    expect(shown.json.purpose).toBe("letters_confirm");
    const yes = await call("POST", `/api/comms/action${t(token)}`, { body: { choice: "yes" }, token: null });
    expect(yes.status, yes.text).toBe(200);
    expect(await q("SELECT state, basis, source FROM comms_permissions WHERE contact_id = ? AND kind = 'letters'", [contactId])).toEqual([
      expect.objectContaining({ state: "yes", basis: "asked", source: "letters_confirm" }),
    ]);
  });

  it("stops everything, and the People screen shows the person, the stop and every email, to the founder alone", async () => {
    const contactId = await contactIdOf(FORM_EMAIL);
    const stop = await call("POST", `/api/comms/preferences${t(sign("preferences", { c: contactId }))}`, {
      body: { stopEverything: true },
      token: null,
    });
    expect(stop.status, stop.text).toBe(200);
    expect(await q("SELECT reason FROM comms_suppressions WHERE email_key = ?", [FORM_EMAIL])).toEqual([
      expect.objectContaining({ reason: "unsubscribed_all" }),
    ]);

    const list = await call("GET", `/api/admin/comms/people?q=${encodeURIComponent("form.person")}`);
    expect(list.status, list.text).toBe(200);
    expect(list.json.people.map((p: any) => p.id)).toEqual([contactId]);
    const person = await call("GET", `/api/admin/comms/people/${contactId}`);
    expect(person.status, person.text).toBe(200);
    expect(person.json.suppression).toMatchObject({ reason: "unsubscribed_all" });
    expect(person.json.emails).toEqual([expect.objectContaining({ origin: "comms.letters_confirm", status: "sent", kind: "essential" })]);
    expect((await call("GET", `/api/admin/comms/people/${contactId}`, { token: null })).status).toBe(401);

    const lift = await call("POST", `/api/admin/comms/people/${contactId}/restore`, { body: {} });
    expect(lift.status, lift.text).toBe(200);
    expect(await q("SELECT reason FROM comms_suppressions WHERE email_key = ?", [FORM_EMAIL])).toHaveLength(0);
  });

  it("lets a member choose from their account, carries it in their export, and takes it with them when they leave", async () => {
    const reg = await call("POST", "/api/auth/register", {
      body: { name: "Lee Leaving", email: LEAVER_EMAIL, password: PASSWORD, paths: ["resident"] },
      token: null,
    });
    expect(reg.status, reg.text).toBe(200);
    const memberToken = String(reg.json?.token ?? "");
    const userId = String(reg.json?.user?.id ?? "");

    const mine = await call("GET", "/api/comms/me", { token: memberToken });
    expect(mine.status, mine.text).toBe(200);
    expect(mine.json.view.member).toBe(true);
    expect(mine.json.view.kinds.find((k: any) => k.kind === "paths")).toMatchObject({ on: true, basis: "account" });
    const letters = await call("PUT", "/api/comms/me", { body: { kind: "letters", on: true }, token: memberToken });
    expect(letters.status, letters.text).toBe(200);
    // An email of theirs on the ledger: the password link they ask for.
    expect((await call("POST", "/api/auth/forgot-password", { body: { email: LEAVER_EMAIL }, token: null })).status).toBe(200);
    const contactId = await contactIdOf(LEAVER_EMAIL);
    const theirEmails = await q("SELECT id FROM comms_messages WHERE contact_id = ?", [contactId]);
    expect(theirEmails.length).toBeGreaterThanOrEqual(1);

    const exported = await call("GET", "/api/profile/export", { token: memberToken });
    expect(exported.status).toBe(200);
    expect(exported.json.comms.contacts).toHaveLength(1);
    expect(exported.json.comms.permissions).toEqual([expect.objectContaining({ kind: "letters", state: "yes", basis: "account" })]);
    expect(exported.json.comms.emails.length).toBe(theirEmails.length);

    const gone = await call("POST", "/api/profile/delete-account", { body: { password: PASSWORD }, token: memberToken });
    expect(gone.status, gone.text).toBe(200);
    expect(await q("SELECT id FROM comms_contacts WHERE id = ? OR user_id = ? OR email_key = ?", [contactId, userId, LEAVER_EMAIL])).toHaveLength(0);
    expect(await q("SELECT kind FROM comms_permissions WHERE contact_id = ?", [contactId])).toHaveLength(0);
    const blanked = await q("SELECT to_email, subject, contact_id FROM comms_messages WHERE id IN (?)", [theirEmails.map((r) => r.id)]);
    expect(blanked.map((r) => ({ ...r }))).toEqual(
      theirEmails.map(() => ({ to_email: "[removed]", subject: "[removed with the person]", contact_id: null })),
    );
    expect(await q("SELECT email_key FROM comms_suppressions WHERE email_key = ?", [LEAVER_EMAIL])).toHaveLength(0);
  });
});
