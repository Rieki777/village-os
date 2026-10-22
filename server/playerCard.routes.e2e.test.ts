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
 * PR 8: the accomplishments (by accomplishmentsOf's viewer rule), the role's
 * handover words and the four-check meter, the owner's card words and this
 * moon's load, each read back through the card.
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
const ACCOMPLISHED = "Mend the spring cover";
const ACCEPT_NOTE = "Done well, and early.";
const RUNBOOK = "https://example.org/lower-tanks";

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

  // PR 8: a task the owner held in person, done and accepted, in a session the reader was never in.
  const [task]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO live_session_entries (session_id, kind, text, status, author_no) VALUES (?, 'action', ?, 'done', ?)",
    [s.insertId, ACCOMPLISHED, m.insertId],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO live_session_task_state (entry_id, session_id, circle_id, status, owner_no, latest_kind, changed_by_no, done_at) VALUES (?, ?, NULL, 'done', ?, 'accepted', 999, UTC_TIMESTAMP())",
    [task.insertId, s.insertId, m.insertId],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO live_session_task_events (entry_id, session_id, kind, by_no, status, owner_no, note) VALUES (?, ?, 'done', ?, 'done', ?, NULL), (?, ?, 'accepted', 999, 'done', ?, ?)",
    [task.insertId, s.insertId, m.insertId, m.insertId, task.insertId, s.insertId, m.insertId, ACCEPT_NOTE],
  );
  // PR 8: the role's handover words (#534), and the owner's card words from an earlier season (#530).
  await pool.query("UPDATE org_roles SET bring_me = ?, runbook = ? WHERE id = ?", [JSON.stringify(["Readings from the spring"]), RUNBOOK, ROLE]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO season_plans (id, user_id, season_id, version, card_words_json, created_at) VALUES ('sp-card-words', ?, 'season-before', 1, ?, NOW() - INTERVAL 1 DAY)",
    [ownerId, JSON.stringify({ howIHold: "In the open, one moon at a time.", growingEdge: "Asking for help early." })],
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

describe.skipIf(!DB_CONFIGURED)("PR 8: the pieces wired onto the live card", () => {
  it("carries the owner's accomplishments, by accomplishmentsOf's viewer rule", async () => {
    const own = await card(ownerToken);
    const moons = own.json.card.accomplished.moons;
    expect(moons.kind, JSON.stringify(own.json.card.accomplished)).toBe("shown");
    const items = moons.value.flatMap((m: any) => m.items);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: ACCOMPLISHED, note: ACCEPT_NOTE });
    expect(items[0].accepted).toMatch(/^Accepted on /);
    expect(moons.value[0].label).toMatch(/ to /);
    // An admin reads every one.
    const admin = await call("GET", "/api/people/wren-card/role-card");
    expect(admin.json.card.accomplished.moons.kind).toBe("shown");
    // A member who was never in the session reads none of it.
    const member = await card(readerToken);
    expect(member.json.card.accomplished.moons).toEqual({ kind: "empty", words: "Nothing accepted as accomplished yet" });
    expect(JSON.stringify(member.json)).not.toContain(ACCOMPLISHED);
    // A stranger reads no tasks at all.
    expect((await card(null)).json.card.accomplished.moons).toEqual({ kind: "unread" });
  });

  it("reads the role's handover words and counts the four-check meter", async () => {
    for (const token of [null, readerToken, ownerToken]) {
      const role = (await card(token)).json.card.roles[0];
      const stranger = token === null;
      expect(role.bringMe.items).toEqual({ kind: "shown", value: ["Readings from the spring"] });
      expect(role.runbook).toEqual({ heading: "Runbook", text: { kind: "shown", value: RUNBOOK } });
      expect(role.notMine.items).toEqual({ kind: "empty", words: "Not written yet" });
      // Four checks: the card is one part short, the runbook is written, the role sits in no
      // circle, and one live holder with no cover. Never a percentage.
      expect(role.handover.summary).toBe("1 of 4 ready");
      expect(role.handover.checks.map((c: any) => c.key)).toEqual(["card", "runbook", "decisions", "stepIn"]);
      expect(role.handover.checks[0]).toMatchObject({ state: "not-yet", words: "4 of 5 parts written: Not mine to hold missing" });
      expect(role.handover.checks[0].parts.find((p: any) => p.key === "notMine").words).toBe("Not mine to hold is not written yet");
      expect(role.handover.checks[1]).toMatchObject({ state: "ready", words: "Runbook written" });
      // A stranger reads no decisions count, so it is not counted for them.
      expect(role.handover.checks[2].words).toBe(stranger ? "Not counted yet" : "The role sits in no circle");
      expect(role.handover.checks[3]).toMatchObject({ state: "not-yet", words: "Nobody named yet" });
      expect(JSON.stringify(role.handover)).not.toContain("%");
    }
  });

  it("feeds the owner's card words to the card, whatever the season, at the member tier and up", async () => {
    const own = (await card(ownerToken)).json.card;
    expect(own.across.growingEdge.text).toEqual({ kind: "shown", value: "Asking for help early." });
    expect(own.howIHold.items).toEqual({ kind: "shown", value: [{ label: "How I hold my roles", text: "In the open, one moon at a time." }] });
    const member = (await card(readerToken)).json.card;
    expect(member.across.growingEdge.text.kind).toBe("shown");
    const stranger = (await card(null)).json.card;
    expect(stranger.across.growingEdge.text).toEqual({ kind: "unread" });
    expect(JSON.stringify(stranger)).not.toContain("Asking for help early.");
  });

  it("saves the load and the card words through the season plan routes, and the card reads both back", async () => {
    const on = await call("PUT", "/api/admin/modules/governance/lifecycle", { body: { lifecycle: "members", examples: false } });
    expect(on.status, "governance must be on for the season plan routes").toBe(200);
    expect((await card(ownerToken)).json.card.across.load.own).toEqual({ kind: "empty", words: "Not set this moon" });
    const load = await call("PUT", "/api/season-plans/mine/load", { body: { level: 4 }, token: ownerToken });
    expect(load.status, JSON.stringify(load.json)).toBe(200);
    expect((await card(ownerToken)).json.card.across.load.own).toEqual({ kind: "shown", value: { step: 4, words: "Leaning heavy" } });
    expect((await card(readerToken)).json.card.across.load.own.kind).toBe("shown");
    // The card's own editor sends the whole group, merged; the newest words win on the card.
    const mine = await call("GET", "/api/season-plans/mine", { token: ownerToken });
    expect(mine.status).toBe(200);
    if (mine.json.season === null) {
      // No planning window: the route says so with a 409 the card puts in a plain sentence.
      const words = await call("PUT", "/api/season-plans/mine/card", { body: { cardWords: { growingEdge: "x" } }, token: ownerToken });
      expect(words.status).toBe(409);
      expect(words.json.error).toBe("no_season");
      return;
    }
    const words = await call("PUT", "/api/season-plans/mine/card", {
      body: { cardWords: { ...(mine.json.cardWords ?? {}), growingEdge: "Saying no kindly." }, seasonalGoals: [{ title: "Clean water for all", doneWhen: "every house tested" }] },
      token: ownerToken,
    });
    expect(words.status, JSON.stringify(words.json)).toBe(200);
    const after = (await card(ownerToken)).json.card;
    expect(after.across.growingEdge.text).toEqual({ kind: "shown", value: "Saying no kindly." });
    expect(after.howIHold.items.value[0].text).toBe("In the open, one moon at a time.");
    expect(after.across.seasonalGoals.items).toEqual({ kind: "shown", value: [{ title: "Clean water for all", doneWhen: "Done when every house tested" }] });
  });

  it("proposes the handover words as one update_seat change, and refuses a link that is not https", async () => {
    const bad = await call("POST", `/api/people/me/role-card/roles/${ROLE}/propose`, { body: { key: "runbook", text: "http://example.org/run" }, token: ownerToken });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("Links need to start with https://.");
    const ok = await call("POST", `/api/people/me/role-card/roles/${ROLE}/propose`, { body: { key: "notMine", text: "Money\nHiring" }, token: ownerToken });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT c.op, c.org_role_id, c.payload FROM org_draft_changes c WHERE c.draft_id = ?",
      [ok.json.draftId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ op: "update_seat", org_role_id: ROLE });
    const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
    expect(payload).toEqual({ notMine: ["Money", "Hiring"] });
    const self = await card(ownerToken);
    expect(self.json.card.roles[0].pending).toContain("notMine");
    // Nothing changes on the role until the draft is adopted.
    expect(self.json.card.roles[0].notMine.items).toEqual({ kind: "empty", words: "Not written yet" });
  });
});
