/**
 * Companions over HTTP (0295). Boots the BUILT server against a scratch
 * schema, so a companion's yes runs through the real doors and nothing here
 * stands in for one:
 *
 *   rsvp            the "Your agent" RSVP confirm, and the RSVP row it makes
 *   token_payment   the wallet send, its balance check and its idempotency
 *   gratitude_note  the Gratitude send
 *   message         opening a direct conversation, then the message send
 *   quest           the member form's quest-idea door into the review inbox
 *   budget_spend    the circle budget spend, whose refusal is proved to come
 *                   from that door (the item opens again)
 *
 * Each has a control: a refusal from the door leaves the item open with
 * nothing recorded, and a second yes opens nothing. The kinds with no door are
 * refused with their sentence. The gate refuses a guest. Erasure takes every
 * companion row of the departed member and none of anybody else's.
 *
 * Order-dependent (fixtures build on each other): run the whole file, never a
 * -t slice. Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { DRAFT_DOORS } from "../shared/companionItems";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[companions.routes] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** 6567-6664: the clean stretch between the blocked 6566 and 6665, which no other suite holds. */
const PORT = 6567 + (process.pid % 98);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "companions-routes-admin";
const CREDITS = "credits";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let ana = { token: "", id: "" };
let ben = { token: "", id: "" };
let cara = { token: "", id: "" };
let dee = { token: "", id: "" };
let eventId = "";
let personal = "";
let n = 0;

async function call(method: string, route: string, body?: unknown, token = founderToken): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", { name, email: `${slug}-${PORT}@example.test`, password: "Companions123!", paths: ["resident"] }, "");
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** One open item on a companion, written the way `landItem` writes it, so each door can be asked on its own. */
async function item(companionId: string, owner: string, kind: string, payload: Record<string, unknown>, title = `A ${kind} draft`): Promise<string> {
  n += 1;
  const id = `citem-test-${n}`;
  await pool.query( // module-review-ok: a fixture item written the way landItem writes it, so each door is asked on its own
    "INSERT INTO companion_items (id, companion_id, owner_user_id, type, draft_kind, title, payload, quote, source_ref, origin, dedupe_key, day_key, status) " +
      "VALUES (?,?,?,'draft',?,?,?,?,?,'maia',?,CURDATE(),'open')",
    [id, companionId, owner, kind, title, JSON.stringify(payload), "the member asked for it", `chat:${n}`, `test:${id}`],
  );
  return id;
}

async function itemRow(id: string): Promise<any> {
  const [[row]] = await pool.query<any[]>("SELECT status, outcome_ref, edited_fields, payload FROM companion_items WHERE id = ?", [id]); // module-review-ok: reading back the companion rows the route or the erasure changed; asserting they are gone or untouched needs no product reader
  return row;
}

const yes = (id: string, body: unknown = {}, token = ana.token) => call("POST", `/api/me/companion-items/${id}/confirm`, body, token);

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the companions route test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-companions-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "companions-routes-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      PLATFORM_ASSISTANT_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Companion Founder" }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "Companions123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken).toBeTruthy();

  ana = await register("Ana Ruiz", "ana");
  ben = await register("Ben Ortiz", "ben");
  cara = await register("Cara Diaz", "cara");
  dee = await register("Dee Lund", "dee");
  for (const who of [ana, ben, dee]) {
    expect((await call("PUT", `/api/admin/players/${who.id}/stage`, { stageId: "member" })).status).toBe(200);
  }
  expect((await call("PUT", "/api/admin/modules/events/lifecycle", { lifecycle: "public" })).status).toBe(200);
  const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const made = await call("POST", "/api/admin/events", { title: "Seed bank shelves party", startsAt, capacity: 10, status: "scheduled" });
  expect(made.status, "the founder can put a gathering on the calendar").toBe(200);
  eventId = String(made.json?.event?.id ?? "");
  expect(eventId).toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("companions over HTTP", () => {
  it("asks the one gate: a guest is refused with a sentence, a member reads their army", async () => {
    const guest = await call("GET", "/api/me/companions", undefined, cara.token);
    expect(guest.status).toBe(403);
    expect(guest.json.error).toBe("Companions open when you become a member of the village.");
    const signedOut = await call("GET", "/api/me/companions", undefined, "");
    expect(signedOut.status).toBe(401);
    // Control: a member reads it.
    const mine = await call("GET", "/api/me/companions", undefined, ana.token);
    expect(mine.status, JSON.stringify(mine.json)).toBe(200);
    const p = mine.json.companions.find((c: any) => c.scope === "personal");
    expect(p).toBeTruthy();
    expect(p.engine).toBeTruthy();
    personal = p.id;
    // No key on this server, so there is no line to agree to and the record answers.
    expect(mine.json.consent).toBeNull();
  });

  it("fills the personal companion from the record: a gathering not answered becomes an RSVP draft, once", async () => {
    const a = await call("GET", "/api/me/companions", undefined, ana.token);
    const drafts = a.json.companions.find((c: any) => c.id === personal).drafts;
    const rsvp = drafts.filter((d: any) => d.kind === "rsvp" && d.payload.eventId === eventId);
    expect(rsvp).toHaveLength(1);
    expect(rsvp[0].source).toContain("the gathering's page");
    // Reading again drafts nothing new, and proposes no second member draft.
    await call("GET", "/api/me/companions", undefined, ana.token);
    const [[{ c }]] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM member_drafts WHERE user_id = ? AND kind = 'event_rsvp'", [ana.id]); // module-review-ok: reading back the member draft behind the RSVP, which the confirm route decided
    expect(Number(c)).toBe(1);
  });

  it("rsvp: the yes runs the RSVP confirm, the row exists, and a second yes opens nothing", async () => {
    const a = await call("GET", "/api/me/companions", undefined, ana.token);
    const id = a.json.companions.find((c: any) => c.id === personal).drafts.find((d: any) => d.kind === "rsvp").id;
    const r = await yes(id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const [rsvps] = await pool.query<any[]>("SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?", [eventId, ana.id]); // module-review-ok: reading back the RSVP row the door wrote, to prove one yes made one answer
    expect(rsvps.map((x) => x.status)).toEqual(["going"]);
    const row = await itemRow(id);
    expect(row.status).toBe("confirmed");
    expect(String(row.outcome_ref)).toMatch(/^rsvp:mdr-/);
    const [[md]] = await pool.query<any[]>("SELECT status FROM member_drafts WHERE user_id = ? AND kind = 'event_rsvp'", [ana.id]); // module-review-ok: reading back the member draft behind the RSVP, which the confirm route decided
    expect(md.status).toBe("confirmed");
    // Control: the second yes is refused and writes nothing.
    const again = await yes(id);
    expect(again.status).toBe(409);
    const [after] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM event_rsvps WHERE event_id = ? AND user_id = ?", [eventId, ana.id]); // module-review-ok: reading back the RSVP row the door wrote, to prove one yes made one answer
    expect(Number(after[0].c)).toBe(1);
  });

  it("token_payment: the wallet's own refusal leaves the draft open; with a balance it pays once", async () => {
    const id = await item(personal, ana.id, "token_payment", { tokenType: CREDITS, amountMinor: 250, toUserId: ben.id, note: "For the shelves" });
    // Control first: Ana holds nothing, so the WALLET refuses, and that refusal is what she reads.
    const broke = await yes(id);
    expect(broke.status).toBe(409);
    expect((await itemRow(id)).status, "a refused door gives the draft back").toBe("open");
    const [none] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM token_ledger WHERE idempotency_key LIKE ?", [`send:${ana.id}:companion-${id}%`]); // module-review-ok: proving the refused send wrote no ledger row
    expect(Number(none[0].c)).toBe(0);

    expect((await call("POST", `/api/admin/tokens/${CREDITS}/mint`, { toUserId: ana.id, amount: 100, reason: "test float" })).status).toBe(200);
    const paid = await yes(id);
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.outcome).toMatch(/^wallet_transfer:/);
    const wallet = await call("GET", "/api/wallet", undefined, ben.token);
    expect(Number(wallet.json?.ledger?.[CREDITS] ?? 0)).toBe(250);
    expect((await yes(id)).status).toBe(409);
    const wallet2 = await call("GET", "/api/wallet", undefined, ben.token);
    expect(Number(wallet2.json?.ledger?.[CREDITS] ?? 0), "a second yes pays nothing").toBe(250);
  });

  it("token_payment, edited first: the member's amount is the one that moves, and the edit is recorded", async () => {
    const id = await item(personal, ana.id, "token_payment", { tokenType: CREDITS, amountMinor: 500, toUserId: ben.id });
    // Only the kind's editable fields may change.
    const wrong = await yes(id, { edits: { toUserId: ana.id } });
    expect(wrong.status).toBe(400);
    expect((await itemRow(id)).status).toBe("open");
    const r = await yes(id, { edits: { amountMinor: 100 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.edited).toEqual(["amountMinor"]);
    const wallet = await call("GET", "/api/wallet", undefined, ben.token);
    expect(Number(wallet.json?.ledger?.[CREDITS] ?? 0)).toBe(350);
    expect(JSON.parse((await itemRow(id)).edited_fields)).toEqual(["amountMinor"]);
  });

  it("gratitude_note: the yes is the Gratitude send, and it counts only then", async () => {
    const id = await item(personal, ana.id, "gratitude_note", { amount: 5, message: "Thank you for the shelves.", toUserId: ben.id });
    const [[before]] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM gratitude_log WHERE to_id = ?", [ben.id]); // module-review-ok: reading back the Gratitude row the send door wrote, and that a draft wrote none
    expect(Number(before.c), "a draft sends nothing").toBe(0);
    const r = await yes(id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const [rows] = await pool.query<any[]>("SELECT from_id, message FROM gratitude_log WHERE to_id = ?", [ben.id]); // module-review-ok: reading back the Gratitude row the send door wrote, and that a draft wrote none
    expect(rows).toHaveLength(1);
    expect(rows[0].from_id).toBe(ana.id);
    expect(rows[0].message).toBe("Thank you for the shelves.");
  });

  it("message: the yes opens the direct conversation and sends as the member", async () => {
    const id = await item(personal, ana.id, "message", { body: "Shall we build on Saturday?", toUserId: ben.id });
    // Control: messaging is off on a fresh village, and the door's own module gate is what refuses.
    const off = await yes(id);
    expect(off.status).toBe(404);
    expect(off.json.error).toBe("module_disabled");
    expect((await itemRow(id)).status).toBe("open");
    expect((await call("PUT", "/api/admin/modules/messaging/lifecycle", { lifecycle: "members" })).status).toBe(200);
    const r = await yes(id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const inbox = await call("GET", "/api/messages", undefined, ben.token);
    expect(JSON.stringify(inbox.json)).toContain("Shall we build on Saturday?");
  });

  it("quest: the yes puts the idea in the review inbox, and nothing goes on the board", async () => {
    const [[q0]] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM quests"); // module-review-ok: proving the quest idea did not reach the board, which only a steward's approval does
    const id = await item(personal, ana.id, "quest", { title: "Oven roof", description: "Build a small roof over the pizza oven.", firstStep: "Measure the oven." });
    const r = await yes(id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.outcome).toMatch(/^quest_proposal:qprop-/);
    const [rows] = await pool.query<any[]>("SELECT title, status, proposed_by, module_id FROM quest_proposals WHERE source_ref = ?", [`companion:${id}`]); // module-review-ok: reading back the review-inbox row the quest-idea door wrote
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Oven roof", status: "proposed", proposed_by: ana.id, module_id: "propose-quest" });
    const [[q1]] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM quests"); // module-review-ok: proving the quest idea did not reach the board, which only a steward's approval does
    expect(Number(q1.c), "one approval puts it live, and that is a steward's").toBe(Number(q0.c));
  });

  it("budget_spend: the circle budget door answers, and its refusal gives the draft back", async () => {
    // The budgets live in the resources module, which needs the map.
    expect((await call("PUT", "/api/admin/modules/map/lifecycle", { lifecycle: "members" })).status).toBe(200);
    const on = await call("PUT", "/api/admin/modules/resources/lifecycle", { lifecycle: "members" });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    const id = await item(personal, ana.id, "budget_spend", { budgetId: "no-such-budget", amountMinor: 100, toUserId: ben.id });
    const r = await yes(id);
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("No such budget");
    expect((await itemRow(id)).status).toBe("open");
  });

  it("refuses every kind with no door, by its own sentence, and the draft stays as it was", async () => {
    for (const kind of ["cash_payment", "ask"] as const) {
      const id = await item(personal, ana.id, kind, { amountMinor: 100 });
      const r = await yes(id);
      expect(r.status, kind).toBe(409);
      expect(r.json.error).toBe(DRAFT_DOORS[kind].refusal);
      expect((await itemRow(id)).status).toBe("open");
    }
  });

  it("email: nothing is sent; the yes hands back the member's own mail", async () => {
    const id = await item(personal, ana.id, "email", { subject: "Six seed trays", text: "Could you hold six trays for Friday?" });
    const r = await yes(id);
    expect(r.status).toBe(200);
    expect(r.json.mailto).toBe(`mailto:?subject=${encodeURIComponent("Six seed trays")}&body=${encodeURIComponent("Could you hold six trays for Friday?")}`);
  });

  it("a member cannot decide another member's item", async () => {
    const id = await item(personal, ana.id, "message", { body: "hello", toUserId: ben.id });
    expect((await yes(id, {}, ben.token)).status).toBe(404);
    expect((await call("POST", `/api/me/companion-items/${id}/decline`, {}, ben.token)).status).toBe(404);
    expect((await itemRow(id)).status).toBe("open");
    // Control: the owner declines it.
    expect((await call("POST", `/api/me/companion-items/${id}/decline`, {}, ana.token)).status).toBe(200);
    expect((await itemRow(id)).status).toBe("declined");
  });

  it("chat with no key says so, and stores nothing", async () => {
    const r = await call("POST", `/api/me/companions/${personal}/chat`, { message: "What is on this week?" }, ana.token);
    expect(r.status).toBe(409);
    expect(r.json.error).toContain("has no key in this village yet");
    const [[m]] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM companion_messages WHERE owner_user_id = ?", [ana.id]); // module-review-ok: reading back the companion rows the route or the erasure changed; asserting they are gone or untouched needs no product reader
    expect(Number(m.c)).toBe(0);
  });

  it("erasure takes every companion row of the departed member, and none of anybody else's", async () => {
    const d = await call("GET", "/api/me/companions", undefined, dee.token);
    expect(d.status).toBe(200);
    const deePersonal = d.json.companions.find((c: any) => c.scope === "personal").id;
    await item(deePersonal, dee.id, "message", { body: "a note", toUserId: ben.id });
    await pool.query("INSERT INTO companion_messages (companion_id, owner_user_id, speaker, engine, body) VALUES (?,?,?,?,?)", [deePersonal, dee.id, "member", "village", "my words"]); // module-review-ok: a chat line for the departed member, which this server cannot write without a model key
    const count = async (who: string) => {
      const [[a]] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM companions WHERE owner_user_id = ?", [who]); // module-review-ok: reading back the companion rows the route or the erasure changed; asserting they are gone or untouched needs no product reader
      const [[b]] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM companion_items WHERE owner_user_id = ?", [who]); // module-review-ok: reading back the companion rows the route or the erasure changed; asserting they are gone or untouched needs no product reader
      const [[c]] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM companion_messages WHERE owner_user_id = ?", [who]); // module-review-ok: reading back the companion rows the route or the erasure changed; asserting they are gone or untouched needs no product reader
      return [Number(a.c), Number(b.c), Number(c.c)];
    };
    expect((await count(dee.id)).every((x) => x > 0)).toBe(true);
    const anaBefore = await count(ana.id);

    const gone = await call("DELETE", `/api/admin/players/${dee.id}`);
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
    expect(await count(dee.id)).toEqual([0, 0, 0]);
    // Control: Ana's companions are untouched.
    expect(await count(ana.id)).toEqual(anaBefore);
  });
});
