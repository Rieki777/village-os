/**
 * THE PLAYER ROLE CARD, DRIVEN AGAINST THE BUILT SERVER, AT ITS THREE TIERS.
 *
 *   stranger  public structure only: never the terms, never a tension's words,
 *             never a sign's sheet.
 *   member    also the terms, pay small at the bottom; still no tension words.
 *   self      also the full text of their own tensions, a wallet link, and the
 *             role words their proposal is waiting on consent for.
 *
 * And the one write: a holder proposes new words for their role, which opens
 * an org draft (`update_seat`) and changes nothing on the role until it is
 * adopted. Somebody who does not hold the role is refused.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first. Skips loudly without TEST_DATABASE_URL. In order.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[playerCard.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs.
const PORT = 1024 + (process.pid % 26);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "player-card-admin";
const PASSWORD = "PlayerCard123!";
const ROLE = "card-water-keeper";
const TENSION = "The tank valve sticks on cold mornings";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let ownerToken = "";
let ownerId = "";
let readerToken = "";

interface Answer { status: number; json: any }

async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function register(name: string, email: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", { body: { name, email, password: PASSWORD, paths: ["resident"] }, token: null });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

const card = (token: string | null, handle = "wren-card") => call("GET", `/api/people/${handle}/role-card`, { token });

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the player card test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-player-card-"));
  testDb = await provisionTestDb();
  // testPool rather than createPool: it sets the same timezone AND pins the
  // session zone, which is the property check-test-pool-timezone holds a total
  // for. The hand-rolled form read green locally and took the ratchet from 187
  // to 188 on CI, in a test file that never mentions a timezone.
  pool = testPool(testDb, { connectionLimit: 4 });
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "player-card-secret",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch { /* not up yet */ }
    await settle(400);
  }

  const boot = await call("POST", "/api/admin/bootstrap", { body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Card Founder" }, token: null });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const owner = await register("Wren Ash", `wren-${PORT}@example.test`);
  ownerToken = owner.token;
  ownerId = owner.id;
  const reader = await register("Tomas Reed", `tomas-${PORT}@example.test`);
  readerToken = reader.token;
  for (const id of [owner.id, reader.id]) {
    expect((await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: "member" } })).status).toBe(200);
  }
  await pool.query("UPDATE users SET handle = 'wren-card' WHERE id = ?", [ownerId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  const made = await call("POST", "/api/admin/org/roles", {
    body: { id: ROLE, name: "Water Keeper of the Lower Tanks", aim: "Clean water for every house.", domain: "The tanks and the lines.", accountabilities: ["Testing the spring"], seats: 2 },
  });
  expect(made.status, JSON.stringify(made.json)).toBe(200);
  const seated = await call("POST", `/api/admin/org/roles/${ROLE}/holders`, { body: { userId: ownerId, termEndsAt: new Date(Date.now() + 60 * 86400000).toISOString() } });
  expect(seated.status, JSON.stringify(seated.json)).toBe(200);
  const offer = {
    v: 1,
    term: { reviewOn: "2030-01-15" },
    pay: { kind: "fixed", currency: "USD", amountMinor: 50000, per: "month" },
    scoreboard: { measures: [{ measure: "Applications answered", countedBy: "applications-answered", targetCount: 3 }] },
  };
  await pool.query("UPDATE org_roles SET terms_offer = ? WHERE id = ?", [JSON.stringify(offer), ROLE]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  // A tension raised to the role, by its holder, in a circle session.
  const [m]: any = await pool.query("INSERT INTO live_session_members (user_id) VALUES (?)", [ownerId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const [s]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO live_sessions (title, circle_id, status, facilitator_no, created_by_no, duration_min, state, stamp) VALUES ('Call', NULL, 'closed', ?, ?, 60, '{}', '{}')",
    [m.insertId, m.insertId],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO live_session_entries (session_id, kind, text, status, author_no, owner_seat_id) VALUES (?, 'tension', ?, 'open', ?, ?)",
    [s.insertId, TENSION, m.insertId, ROLE],
  );
}, E2E_BOOT_DEADLINE_MS + 60_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the player role card at three tiers", () => {
  it("shows a stranger public structure only: the role, never its terms, a tension's words or a sheet", async () => {
    const r = await card(null);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.viewer).toEqual({ level: "stranger", isSelf: false });
    expect(r.json.card.tiles.items.value.map((t: any) => t.title)).toEqual(["Water Keeper of the Lower Tanks"]);
    expect(r.json.card.roles[0].purpose.text).toEqual({ kind: "shown", value: "Clean water for every house." });
    expect(r.json.card.agreements.roles[0].rows).toEqual({ kind: "unread" });
    expect(r.json.card.roles[0].tensions).toEqual({ kind: "unread" });
    const text = JSON.stringify(r.json);
    expect(text).not.toContain("Fixed pay");
    expect(text).not.toContain(TENSION);
    expect(r.json.sheets).toEqual({});
    expect(r.json.links.wallet).toBeUndefined();
  });

  it("shows a member the terms, pay small and last, and still never a tension's words", async () => {
    const r = await card(readerToken);
    expect(r.status).toBe(200);
    expect(r.json.viewer.level).toBe("member");
    const rows = r.json.card.agreements.roles[0].rows.value;
    expect(rows[rows.length - 1]).toMatchObject({ label: "Pay", small: true });
    expect(rows[rows.length - 1].lines[0]).toBe("Fixed pay per month");
    expect(JSON.stringify(r.json)).not.toContain(TENSION);
    // Read at this tier, and its words withheld: an open tension is the holder's and the raiser's.
    expect(r.json.card.roles[0].tensions.kind).not.toBe("unread");
    // The one person the card names is its owner.
    expect(JSON.stringify(r.json)).not.toContain("Tomas");
  });

  it("shows the owner their own tension in full and a wallet link, at /me as well as their handle", async () => {
    for (const handle of ["wren-card", "me"]) {
      const r = await card(ownerToken, handle);
      expect(r.status, handle).toBe(200);
      expect(r.json.viewer).toEqual({ level: "self", isSelf: true });
      expect(r.json.card.roles[0].tensions.value.open).toEqual([TENSION]);
      expect(r.json.links.wallet).toBe("/wallet");
    }
    expect((await card(null, "me")).status).toBe(401);
    expect((await card(null, "nobody-has-this-handle")).status).toBe(404);
  });

  it("lets the holder propose new words, which wait for consent and change nothing yet", async () => {
    const refused = await call("POST", `/api/people/me/role-card/roles/${ROLE}/propose`, { body: { key: "purpose", text: "Water for all." }, token: readerToken });
    expect(refused.status).toBe(403);
    const noColumn = await call("POST", `/api/people/me/role-card/roles/${ROLE}/propose`, { body: { key: "bringMe", text: "x" }, token: ownerToken });
    expect(noColumn.status).toBe(400);
    const ok = await call("POST", `/api/people/me/role-card/roles/${ROLE}/propose`, { body: { key: "purpose", text: "Water for all." }, token: ownerToken });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT d.status, d.created_by, c.op, c.payload FROM org_drafts d JOIN org_draft_changes c ON c.draft_id = d.id WHERE d.id = ?",
      [ok.json.draftId],
    );
    expect(rows[0]).toMatchObject({ status: "open", created_by: ownerId, op: "update_seat" });
    const self = await card(ownerToken);
    expect(self.json.card.roles[0].pending).toEqual(["purpose"]);
    expect(self.json.card.roles[0].purpose.text.value).toBe("Clean water for every house.");
    const member = await card(readerToken);
    expect(member.json.card.roles[0].pending).toEqual([]);
  });
});
