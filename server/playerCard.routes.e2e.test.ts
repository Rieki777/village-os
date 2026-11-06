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
 * PR 9: tensions from role_tensions, as each reader may see them: a member
 * who neither raised nor holds reads the count only, the raiser and the
 * holder read the words, and once a tension is brought to the circle every
 * member reads them. The raise control goes to a member who does not hold the
 * role, Waiting on you to the holder's own card. The role tile on /api/org
 * counts the same rows.
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
import { CAPABILITY_LABELS } from "../shared/capabilities";

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
const RAISED = "Nobody answers the tank alarm at night";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let ownerToken = "";
let ownerId = "";
let readerToken = "";
let raiserToken = "";

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
  const raiser = await register("Ida Moss", `ida-${PORT}@example.test`);
  raiserToken = raiser.token;
  for (const id of [owner.id, reader.id, raiser.id]) {
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

  // A tension raised to the role by its holder, through the tension door (role_tensions, 0269).
  const raisedByOwner = await call("POST", `/api/roles/${ROLE}/tensions`, { body: { text: TENSION }, token: ownerToken });
  expect(raisedByOwner.status, JSON.stringify(raisedByOwner.json)).toBe(201);

  // A circle session, for the accomplished task below.
  const [m]: any = await pool.query("INSERT INTO live_session_members (user_id) VALUES (?)", [ownerId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const [s]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO live_sessions (title, circle_id, status, facilitator_no, created_by_no, duration_min, state, stamp) VALUES ('Call', NULL, 'closed', ?, ?, 60, '{}', '{}')",
    [m.insertId, m.insertId],
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
    expect(r.json.card.roles[0].tensionDoor).toBeNull();
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
    // The proposal itself, listed on the role for whoever decides it, with the words it would put live
    // (a draft opened from a card is on no review page). The propose answer no longer points at /review.
    expect(ok.json.review).toBeUndefined();
    expect(member.json.card.roles[0].proposals).toEqual([
      { draftId: ok.json.draftId, proposedOn: expect.stringMatching(/^Proposed on /), fields: [{ key: "purpose", label: "Purpose", lines: ["Water for all."] }] },
    ]);
    expect(self.json.links.review).toBeUndefined();
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

describe.skipIf(!DB_CONFIGURED)("PR 9: tensions on the card, as each reader may see them", () => {
  const tensionsOf = async (token: string | null) => (await card(token)).json.card.roles[0];
  const orgTile = async (token: string) => {
    const r = await call("GET", "/api/org", { token });
    expect(r.status).toBe(200);
    return (r.json.roles as any[]).find((x) => x.id === ROLE);
  };

  it("a member who did not raise it and does not hold the role reads the count only", async () => {
    const raised = await call("POST", `/api/roles/${ROLE}/tensions`, { body: { text: RAISED }, token: raiserToken });
    expect(raised.status, JSON.stringify(raised.json)).toBe(201);
    const role = await tensionsOf(readerToken);
    expect(role.tensions.kind).toBe("shown");
    expect(role.tensions.value.counts).toEqual(["2 open tensions, private to the role's holders"]);
    expect(role.tensions.value.open).toEqual([]);
    expect(JSON.stringify(role)).not.toContain(RAISED);
    expect(JSON.stringify(role)).not.toContain(TENSION);
    expect(role.tensionDoor).toBe("raise");
    // A stranger reads nothing, not even the count.
    const stranger = await tensionsOf(null);
    expect(stranger.tensions).toEqual({ kind: "unread" });
    expect(stranger.tensionDoor).toBeNull();
  });

  it("the raiser reads their own words, and the holder reads every open one", async () => {
    const raiser = await tensionsOf(raiserToken);
    expect(raiser.tensions.value.open).toEqual([RAISED]);
    expect(raiser.tensions.value.counts).toEqual(["2 open tensions, 1 private to the role's holders"]);
    expect(raiser.tensionDoor).toBe("raise");
    const holder = await tensionsOf(ownerToken);
    expect([...holder.tensions.value.open].sort()).toEqual([RAISED, TENSION].sort());
    expect(holder.tensions.value.counts).toEqual(["2 open tensions"]);
    // The holder answers through Waiting on you, and is never offered the raise.
    expect(holder.tensionDoor).toBe("waiting");
  });

  it("the role tile on /api/org counts the same open rows", async () => {
    const tile = await orgTile(readerToken);
    expect(tile.health, JSON.stringify(tile)).toBeTruthy();
    expect(tile.health.openTensions).toBe(2);
    expect(JSON.stringify(tile)).not.toContain(RAISED);
  });

  it("once brought to the circle, every member reads the words, and the count moves", async () => {
    // A bring needs a circle that has met; the state it leaves is what the card reads.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE role_tensions SET status = 'brought_to_circle', answered_at = UTC_TIMESTAMP() WHERE org_role_id = ? AND text = ?",
      [ROLE, RAISED],
    );
    const role = await tensionsOf(readerToken);
    expect(role.tensions.value.public).toEqual([RAISED]);
    expect(role.tensions.value.counts).toEqual(["1 open tension, private to the role's holders", "1 answered this moon"]);
    expect(JSON.stringify(role)).not.toContain(TENSION);
    expect((await orgTile(readerToken)).health.openTensions).toBe(1);
  });
});

/*
 * THE PORTRAIT IN THE GOLD RING (the approved design): the owner's own
 * character, never an initial once they have one, by the portrait's own
 * visibility rule. Before any character the card draws the initial; once the
 * owner walks a path it draws that character's stock art; an uploaded
 * portrait reaches the owner at once and everybody else only once published.
 */
describe.skipIf(!DB_CONFIGURED)("the approved design's portrait and hero", () => {
  const portraitOf = async (token: string | null) => (await card(token)).json.card.header.portrait;

  it("draws the initial until the owner has a character, then the character's own art", async () => {
    expect(await portraitOf(null)).toEqual({ kind: "sigil", letter: "W" });
    const made = await call("POST", "/api/me/characters", { body: { archetypeKey: "facilitating", presentation: "f", tone: "olive", primary: true }, token: ownerToken });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const stock = String(made.json.character.avatar);
    expect(stock).toMatch(/^\/images\/avatars\//);
    for (const t of [null, readerToken, ownerToken]) expect(await portraitOf(t)).toEqual({ kind: "photo", src: stock });
  });

  it("shows an uploaded portrait to its owner at once, and to anybody else only once it is published", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 60, height: 80, channels: 3, background: "#7a6a4a" } }).png().toBuffer();
    const form = new FormData();
    form.append("portrait", new Blob([new Uint8Array(png)], { type: "image/png" }), "me.png");
    const up = await fetch(`${BASE}/api/me/portraits/facilitating/upload`, { method: "POST", headers: { Authorization: `Bearer ${ownerToken}` }, body: form }); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    expect(up.status).toBe(200);
    const own = await portraitOf(ownerToken);
    expect(own.src).toMatch(/^\/api\/uploads\/portrait-/);
    // Private until published: a member and a stranger still see the stock art.
    for (const t of [null, readerToken]) expect((await portraitOf(t)).src).toMatch(/^\/images\/avatars\//);
    expect((await call("POST", "/api/me/portraits/facilitating/publish", { body: { published: true }, token: ownerToken })).status).toBe(200);
    for (const t of [null, readerToken]) expect(await portraitOf(t)).toEqual(own);
  });

  it("names the moon on the pill and gives each tile its icon", async () => {
    const r = (await card(readerToken)).json.card;
    expect(r.header.moon.words).toMatch(/^(January|February|March|April|May|June|July|August|September|October|November|December) Moon/);
    expect(r.header.tagline).toBe("One role");
    expect(r.tiles.items.value[0].icon).toBe("sprout");
  });
});

/*
 * A10 (2026-10-31): the role card names what the role holds, or what it suits.
 * Run against the built server, so the affinity map, the module switches and
 * capability_holding are the real ones, read on every request.
 */
describe.skipIf(!DB_CONFIGURED)("A10: a role's powers on its card", () => {
  const powersOf = async () => (await card(readerToken)).json.card.roles[0].powers;
  const setClasses = (keys: string[]) =>
    pool.query("UPDATE org_roles SET archetypes = ? WHERE id = ?", [JSON.stringify(keys), ROLE]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const label = (k: string) => (CAPABILITY_LABELS as Record<string, string>)[k];

  it("control: a role with no classes and nothing handed over says No powers held", async () => {
    await setClasses([]);
    const powers = await powersOf();
    expect(powers.items).toEqual({ kind: "empty", words: "No powers held" });
    expect(powers.note).toBeNull();
  });

  it("leaves out a power the village's own setup denies: one whose module is off here", async () => {
    // The storyteller suits photos and announcements too, and both modules are off on this village.
    await setClasses(["storytelling"]);
    expect((await powersOf()).items).toEqual({ kind: "shown", value: [label("story.tell")] });
  });

  it("names what the role's classes suit, as information, when nothing is handed over", async () => {
    await setClasses(["building"]);
    const powers = await powersOf();
    expect(powers.heading).toBe("Suited to");
    expect(powers.items).toEqual({ kind: "shown", value: [label("org.seatAgent"), label("dial.set")] });
    expect(powers.note).toBe("The village has not handed these over.");
  });

  it("shows a power suited through two classes once, and follows a map edit on the next request", async () => {
    await setClasses(["building", "storytelling"]);
    const before = await powersOf();
    expect(before.items.value).toEqual([label("org.seatAgent"), label("dial.set"), label("story.tell")]);
    // The map changes while the card is open: dial.set now suits the storyteller too.
    const put = await call("PUT", "/api/admin/power-affinity/dial.set", { body: { classes: ["building", "storytelling"] } });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    const after = await powersOf();
    expect(after.items.value.filter((v: string) => v === label("dial.set"))).toHaveLength(1);
    // And back to the platform's suggestion, so the cases below read the default map.
    expect((await call("PUT", "/api/admin/power-affinity/dial.set", { body: { classes: null } })).status).toBe(200);
  });

  it("never lists as suited a power the village has handed to another role", async () => {
    await setClasses(["building"]);
    await pool.query("INSERT INTO capability_holding (capability, holder_role_id) VALUES ('org.seatAgent', 'another-role')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    try {
      expect((await powersOf()).items).toEqual({ kind: "shown", value: [label("dial.set")] });
    } finally {
      await pool.query("DELETE FROM capability_holding WHERE capability = 'org.seatAgent'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
  });

  it("marks a power handed to this role as handed, and then lists nothing as suited", async () => {
    await setClasses(["building"]);
    await pool.query("INSERT INTO capability_holding (capability, holder_role_id) VALUES ('org.seatAgent', ?)", [ROLE]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    try {
      const powers = await powersOf();
      expect(powers.heading).toBe("Powers handed to this role");
      expect(powers.items).toEqual({ kind: "shown", value: [label("org.seatAgent")] });
      expect(powers.note).toBeNull();
    } finally {
      await pool.query("DELETE FROM capability_holding WHERE capability = 'org.seatAgent'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await setClasses([]);
    }
  });
});
