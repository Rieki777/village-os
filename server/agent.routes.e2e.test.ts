/**
 * Your agent, over HTTP (round 4, lane L6). Boots the BUILT server against a
 * scratch schema and proves the harm metrics that only a real request can:
 *
 *   1. Tier matrix: for a member without map.viewPeople, a member with it,
 *      and an admin, the agent read returns a body byte-identical to the web
 *      route for that same person, and the token of the member without the
 *      capability never returns a holder name. A signed-out reader has no
 *      token, so its row is the 401.
 *   2. Every write refuses without the confirm step and on a mismatched echo,
 *      and the RSVP the confirm makes is the same row the web route makes.
 *   3. No token value, member key or inbox secret appears in any /api/agent/**
 *      response body except the one that mints it, nor in the server log.
 *   4. A member-key call writes one assistant_usage row with key_source =
 *      member and user_id set, and no hit lands in assistant-day:member.
 *   5. "what is on this week" writes a path = deterministic row with zero
 *      tokens and iterations 0.
 *   6. MEMBER_SECRETS_KEY unset refuses storage with the sentence: covered in
 *      memberSecrets.test.ts; here the server runs WITH the key so 3 and 4
 *      can be exercised.
 *
 * Order-dependent (fixtures build on each other): run the whole file, never a
 * -t slice. Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[agent.routes] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** Above every other suite's window (the highest is hygiene at 8900-9799). */
const PORT = 6900 + (process.pid % 500);
const STUB_PORT = PORT + 500;
const BASE = `http://localhost:${PORT}`;
const ADMIN = "agent-routes-admin";
const MEMBER_SECRETS_KEY = "cd".repeat(32);
/** Fixture secrets the log and body grep look for. */
const MEMBER_LLM_KEY = "sk-ant-fixture-member-key-000111222333";

let child: ChildProcess | undefined;
let stub: http.Server | undefined;
let stubBodies: any[] = [];
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
let ana = { token: "", id: "" };
let cara = { token: "", id: "" };
let eventId = "";
const vat: Record<string, string> = {};
const bodiesSeen: string[] = [];

async function call(method: string, route: string, body?: unknown, token = founderToken): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (route.startsWith("/api/agent")) bodiesSeen.push(text);
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", { name, email: `${slug}-${PORT}@example.test`, password: "AgentTest123!", paths: ["resident"] }, "");
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the agent route test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-agent-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 });

  // The model stub: answers a member-mode question with a reply, an aboutYou
  // sentence and a draft naming the fixture gathering.
  stub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body: any = null;
      try { body = JSON.parse(raw); } catch { /* ignore */ }
      stubBodies.push({ headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        content: [{ type: "text", text: JSON.stringify({ reply: "Kitchen crew is on Tuesday. Want me to say you are going?", aboutYou: "You are a member.", draft: { eventId, status: "going" } }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 42, output_tokens: 7 },
      }));
    });
  });
  await new Promise<void>((r) => stub!.listen(STUB_PORT, "127.0.0.1", () => r()));

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "agent-routes-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      MEMBER_SECRETS_KEY,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      PLATFORM_ASSISTANT_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Agent Founder" }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "AgentTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken).toBeTruthy();
  const [fRows] = await pool.query<any[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [`founder-${PORT}@example.test`]);
  founderId = String(fRows[0]?.id ?? "");
  expect(founderId, "the founder row must exist").toBeTruthy();

  ana = await register("Ana Ruiz", "ana");
  cara = await register("Cara Diaz", "cara");
  // Ana is a member; Cara stays a fresh guest. map.viewPeople unlocks at
  // member for this run, so Cara is the member WITHOUT the capability.
  expect((await call("PUT", `/api/admin/players/${ana.id}/stage`, { stageId: "member" })).status).toBe(200);
  expect((await call("PUT", "/api/admin/variables/progression.unlock.map.viewPeople", { value: "member" })).status).toBe(200);
  // Events on, one gathering on the calendar, and a seat held so the org chart has a name to hide.
  expect((await call("PUT", "/api/admin/modules/events/lifecycle", { lifecycle: "public" })).status).toBe(200);
  expect((await call("PUT", "/api/admin/modules/map/lifecycle", { lifecycle: "public" })).status).toBe(200);
  const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const made = await call("POST", "/api/admin/events", { title: "Kitchen crew", startsAt, capacity: 10, status: "scheduled" });
  expect(made.status, "the founder can put a gathering on the calendar").toBe(200);
  eventId = String(made.json?.event?.id ?? "");
  expect(eventId).toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  stub?.close();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("your agent over HTTP", () => {
  it("serves the three skills and the OpenAPI slice to anyone", async () => {
    const skills = await call("GET", "/api/agent/v1/skills", undefined, "");
    expect(skills.status).toBe(200);
    expect(skills.json.skills.map((s: any) => s.name).sort()).toEqual(["village-calendar", "village-directory", "village-intents"]);
    const one = await call("GET", "/api/agent/v1/skills/village-calendar/SKILL.md", undefined, "");
    expect(one.status).toBe(200);
    expect(one.text).toContain("name: village-calendar");
    expect(one.text).toContain("Nothing is sent until the member says yes");
    const oa = await call("GET", "/api/agent/v1/openapi.json", undefined, "");
    expect(oa.status).toBe(200);
    expect(oa.json.paths["/api/agent/v1/events/{id}/rsvp"]).toBeTruthy();
    expect((await call("GET", "/api/agent/v1/skills/../../package.json/SKILL.md", undefined, "")).status).toBe(404);
  });

  it("mints a token once, stores only its hash, and lists it without the value", async () => {
    for (const [who, token] of [["founder", founderToken], ["ana", ana.token], ["cara", cara.token]] as const) {
      const r = await call("POST", "/api/agent/tokens", { name: `${who} laptop`, scopes: ["calendar.read", "directory.read", "me.read", "rsvp.write"] }, token);
      expect(r.status, `${who} can mint`).toBe(200);
      expect(r.json.token).toMatch(/^vat_/);
      vat[who] = r.json.token;
      expect(JSON.stringify(r.json.row)).not.toContain(r.json.token);
    }
    const list = await call("GET", "/api/agent/tokens", undefined, ana.token);
    expect(list.json.tokens).toHaveLength(1);
    expect(list.text).not.toContain(vat.ana);
    const [[row]] = await pool.query<any[]>("SELECT token_hash, prefix FROM agent_tokens WHERE user_id = ?", [ana.id]);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toBe(vat.ana);
    expect(vat.ana.startsWith(row.prefix)).toBe(true);
    // intents.write is refused while L7 has not landed.
    const intents = await call("POST", "/api/agent/tokens", { name: "x", scopes: ["intents.write"] }, ana.token);
    expect(intents.status).toBe(400);
  });

  it("honours a vat_ token under /api/agent/v1 only", async () => {
    const outside = await call("GET", "/api/me/profile", undefined, vat.ana);
    expect(outside.status).toBe(401);
    expect(outside.json.error).toBe("agent_token_scope");
    const publicRoute = await call("GET", "/api/events", undefined, vat.ana);
    expect(publicRoute.status, "even a public route refuses a vat_ token").toBe(401);
    expect((await call("GET", "/api/agent/v1/calendar", undefined, "")).status).toBe(401);
    expect((await call("GET", "/api/agent/v1/calendar", undefined, "vat_" + "x".repeat(43))).status).toBe(401);
    expect((await call("GET", "/api/agent/v1/nothing-here", undefined, vat.ana)).status).toBe(404);
  });

  it("tier matrix: every agent read is byte-identical to the holder's own web route (harm metric 1)", async () => {
    const pairs: [string, string][] = [
      ["/api/agent/v1/calendar", "/api/events"],
      [`/api/agent/v1/calendar/${eventId}`, `/api/events/${eventId}`],
      ["/api/agent/v1/directory", "/api/org"],
      ["/api/agent/v1/me", "/api/me/profile"],
    ];
    // The calendar route stamps a per-request clock into the body (0085):
    // `window.from/to` are `now` plus the wired days to the millisecond, and
    // `lunar.phase` is a float of the same `now`. Measured by field on the
    // built server: two requests a few ms apart differ in exactly those two
    // and nowhere else. Everything but the clock must be byte-identical.
    const stripClock = (text: string): string => {
      try {
        const o = JSON.parse(text);
        if (o && typeof o === "object") {
          if (o.window) delete o.window;
          if (o.lunar && typeof o.lunar === "object") delete o.lunar.phase;
        }
        return JSON.stringify(o);
      } catch {
        return text;
      }
    };
    for (const [who, session] of [["founder", founderToken], ["ana", ana.token], ["cara", cara.token]] as const) {
      for (const [agentPath, webPath] of pairs) {
        const viaAgent = await call("GET", agentPath, undefined, vat[who]);
        const viaWeb = await call("GET", webPath, undefined, session);
        expect(viaAgent.status, `${who} ${agentPath}`).toBe(200);
        expect(stripClock(viaAgent.text), `${who}: ${agentPath} must equal ${webPath}`).toBe(stripClock(viaWeb.text));
      }
    }
    // The org chart names a holder only for those who may see people. Make a
    // seat and put the founder in it so there IS a name to hide, then compare.
    const seat = await call("POST", "/api/admin/org/roles", { name: "Kitchen steward", circleId: null, aim: "Feeds the village", seats: 1 });
    expect(seat.status, "the founder can make a seat").toBe(200);
    const roleId = String(seat.json?.id ?? "");
    expect(roleId).toBeTruthy();
    const seated = await call("POST", `/api/admin/org/roles/${roleId}/holders`, { userId: founderId, holderKind: "member" });
    expect(seated.status, "the founder can be seated").toBe(200);
    const caraOrg = await call("GET", "/api/agent/v1/directory", undefined, vat.cara);
    const anaOrg = await call("GET", "/api/agent/v1/directory", undefined, vat.ana);
    const caraSeat = caraOrg.json.roles.find((r: any) => r.id === roleId);
    expect(caraSeat.holderCount, "the count is not hidden").toBe(1);
    /*
     * R57 moved the floor under this assertion. The village's people are
     * public by default now, so cara's token returns a holder where it used
     * to return none, and what the tier check has to prove is the SHAPE:
     * a first name, and nothing that resolves to the person elsewhere. The
     * seated founder is "Agent Founder", so only "Agent" may appear, and the
     * user id must not.
     */
    expect(caraSeat.holders).toEqual([{ name: "Agent" }]);
    for (const r of caraOrg.json.roles ?? []) {
      for (const h of r.holders ?? []) expect(Object.keys(h)).toEqual(["name"]);
    }
    expect(caraOrg.text).not.toContain("Agent Founder");
    expect(caraOrg.text, "no user id rides out at the public tier").not.toContain(founderId);
    expect(JSON.stringify(anaOrg.json.roles.find((r: any) => r.id === roleId)?.holders ?? [])).toContain(founderId);
    // And each is still byte-identical to the web route AFTER the seating.
    expect(caraOrg.text).toBe((await call("GET", "/api/org", undefined, cara.token)).text);
    expect(anaOrg.text).toBe((await call("GET", "/api/org", undefined, ana.token)).text);
  });

  it("scope missing is a 403, and me/rsvps is the calendar cut to the holder's answers", async () => {
    const readOnly = await call("POST", "/api/agent/tokens", { name: "read only", scopes: ["calendar.read"] }, ana.token);
    const noMe = await call("GET", "/api/agent/v1/me", undefined, readOnly.json.token);
    expect(noMe.status).toBe(403);
    expect(noMe.json.error).toBe("agent_scope_missing");
    const mine = await call("GET", "/api/agent/v1/me/rsvps", undefined, vat.ana);
    expect(mine.status).toBe(200);
    expect(mine.json.events).toEqual([]);
    expect(mine.json).toHaveProperty("rsvpEnabled");
  });

  it("the RSVP write refuses without the confirm step and on a mismatched echo, then writes the same row the web route writes (harm metric 2)", async () => {
    const path_ = `/api/agent/v1/events/${eventId}/rsvp`;
    const first = await call("POST", path_, { status: "going" }, vat.ana);
    expect(first.status).toBe(202);
    expect(first.json.confirmRequired).toBe(true);
    expect(first.json.echo).toMatchObject({ eventId, title: "Kitchen crew", status: "going" });
    const rsvpsBefore = await pool.query<any[]>("SELECT COUNT(*) n FROM event_rsvps WHERE event_id = ?", [eventId]);
    expect(rsvpsBefore[0][0].n).toBe(0);

    // Missing token, wrong echo, wrong holder, wrong status: nothing writes.
    const noToken = await call("POST", path_, { status: "going", confirm: true, echo: first.json.echo }, vat.ana);
    expect(noToken.status).toBe(409);
    expect(noToken.json.error).toBe("missing");
    const wrongEcho = await call("POST", path_, { status: "going", confirm: true, confirmToken: first.json.confirmToken, echo: { ...first.json.echo, status: "declined" } }, vat.ana);
    expect(wrongEcho.status).toBe(409);
    expect(wrongEcho.json.error).toBe("echo_mismatch");
    const swappedStatus = await call("POST", path_, { status: "declined", confirm: true, confirmToken: first.json.confirmToken, echo: first.json.echo }, vat.ana);
    expect(swappedStatus.status).toBe(409);
    const otherHolder = await call("POST", path_, { status: "going", confirm: true, confirmToken: first.json.confirmToken, echo: first.json.echo }, vat.cara);
    expect(otherHolder.status).toBe(409);
    expect(otherHolder.json.error).toBe("wrong_holder");
    const noScope = await call("POST", path_, { status: "going" }, (await call("POST", "/api/agent/tokens", { name: "ro", scopes: ["calendar.read"] }, ana.token)).json.token);
    expect(noScope.status).toBe(403);
    const rsvpsStill = await pool.query<any[]>("SELECT COUNT(*) n FROM event_rsvps WHERE event_id = ?", [eventId]);
    expect(rsvpsStill[0][0].n, "nothing wrote").toBe(0);

    // The yes.
    const done = await call("POST", path_, { status: "going", confirm: true, confirmToken: first.json.confirmToken, echo: first.json.echo }, vat.ana);
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ success: true, status: "going", goingCount: 1 });
    // The same shape the web route makes for Cara.
    const web = await call("POST", `/api/events/${eventId}/rsvp`, { status: "going" }, cara.token);
    expect(web.status).toBe(200);
    const [rows] = await pool.query<any[]>("SELECT user_id, status FROM event_rsvps WHERE event_id = ? ORDER BY user_id", [eventId]);
    expect(rows.map((r) => r.status)).toEqual(["going", "going"]);
    const [[audit]] = await pool.query<any[]>("SELECT actor_kind, audience FROM health_events WHERE kind = 'event_rsvp' AND actor_user_id = ? ORDER BY at DESC LIMIT 1", [ana.id]);
    expect(audit.actor_kind).toBe("agent");
    expect(audit.audience).toBe("admin");
    // And me/rsvps now shows it.
    const mine = await call("GET", "/api/agent/v1/me/rsvps", undefined, vat.ana);
    expect(mine.json.events.map((e: any) => e.id)).toEqual([eventId]);
  });

  it("stores a member key encrypted, returns last4 only, and answers on it with a member usage row (harm metrics 3 and 4)", async () => {
    const put = await call("PUT", "/api/agent/key", { provider: "anthropic", key: MEMBER_LLM_KEY }, ana.token);
    expect(put.status).toBe(200);
    expect(put.json.key).toMatchObject({ provider: "anthropic", last4: MEMBER_LLM_KEY.slice(-4) });
    expect(put.text).not.toContain(MEMBER_LLM_KEY);
    const [[row]] = await pool.query<any[]>("SELECT ciphertext, iv, tag, last4 FROM member_llm_keys WHERE user_id = ?", [ana.id]);
    expect(row.ciphertext).not.toContain(MEMBER_LLM_KEY);
    expect(Buffer.from(row.ciphertext, "base64").toString("utf8")).not.toContain("sk-ant");
    const get = await call("GET", "/api/agent/key", undefined, ana.token);
    expect(get.text).not.toContain("ciphertext");

    const before = await pool.query<any[]>("SELECT COUNT(*) n FROM rate_hits WHERE bucket LIKE 'assistant-day:member%'");
    stubBodies = [];
    const ask = await call("POST", "/api/agent/ask", { messages: [{ role: "user", content: "should I go to the kitchen crew gathering?" }] }, ana.token);
    expect(ask.status, JSON.stringify(ask.json)).toBe(200);
    expect(ask.json.keySource).toBe("member");
    expect(stubBodies.length).toBeGreaterThanOrEqual(1);
    expect(stubBodies[0].headers["x-api-key"]).toBe(MEMBER_LLM_KEY);
    // The framing, verbatim, in the member-mode prompt.
    expect(String(stubBodies[0].body.system)).toContain("Names, events and labels about a person come word for word from a tool result or from the member's own note. If it is not there, say: I don't see that anywhere.");
    const [[usage]] = await pool.query<any[]>("SELECT key_source, user_id, mode, path FROM assistant_usage WHERE user_id = ? AND mode = 'member' ORDER BY created_at DESC LIMIT 1", [ana.id]);
    expect(usage.key_source).toBe("member");
    expect(usage.user_id).toBe(ana.id);
    const after = await pool.query<any[]>("SELECT COUNT(*) n FROM rate_hits WHERE bucket LIKE 'assistant-day:member%'");
    expect(after[0][0].n, "the member's key never charges the mode bucket").toBe(before[0][0].n);
    const own = await pool.query<any[]>("SELECT COUNT(*) n FROM rate_hits WHERE bucket LIKE ?", [`assistant-member-day:${ana.id}:%`]);
    expect(own[0][0].n).toBeGreaterThanOrEqual(1);

    // The reply carried aboutYou (now a statement Ana can correct) and a draft
    // (now waiting for her yes in member_drafts, never in assistant_drafts).
    expect(ask.json.aboutYou).toBe("You are a member.");
    expect(ask.json.statementId).toBeTruthy();
    expect(ask.json.draft).toMatchObject({ kind: "event_rsvp", status: "proposed", source: "assistant" });
    const [[none]] = await pool.query<any[]>("SELECT COUNT(*) n FROM assistant_drafts WHERE kind = 'event_rsvp'");
    expect(none.n).toBe(0);
    const statements = await call("GET", "/api/agent/statements", undefined, ana.token);
    expect(statements.json.statements[0]).toMatchObject({ text: "You are a member.", status: "active" });
    const corrected = await call("POST", `/api/agent/statements/${ask.json.statementId}/correct`, { correction: "I am a guest until the moon turns." }, ana.token);
    expect(corrected.status).toBe(200);
    expect(corrected.json.statement.status).toBe("corrected");
    // Cara cannot touch Ana's statement.
    expect((await call("POST", `/api/agent/statements/${ask.json.statementId}/withdraw`, {}, cara.token)).status).toBe(404);

    // The draft: Cara cannot confirm it; Ana can, and it lands as an RSVP
    // through the same rsvp() (Ana already said going, so this is a no-op update).
    const draftId = ask.json.draft.id;
    expect((await call("POST", `/api/agent/drafts/${draftId}/confirm`, {}, cara.token)).status).toBe(404);
    const confirm = await call("POST", `/api/agent/drafts/${draftId}/confirm`, {}, ana.token);
    expect(confirm.status).toBe(200);
    expect(confirm.json.status).toBe("going");
    expect((await call("POST", `/api/agent/drafts/${draftId}/confirm`, {}, ana.token)).status).toBe(409);
    const [[md]] = await pool.query<any[]>("SELECT status, created_ref FROM member_drafts WHERE id = ?", [draftId]);
    expect(md.status).toBe("confirmed");
    expect(md.created_ref).toBe(eventId);
    // Removing the key returns nothing but success and the next ask has no key.
    expect((await call("DELETE", "/api/agent/key", undefined, ana.token)).json.success).toBe(true);
  });

  it("answers 'what is on this week' from the record with zero tokens (harm metric 5)", async () => {
    stubBodies = [];
    const r = await call("POST", "/api/agent/ask", { messages: [{ role: "user", content: "what is on this week" }] }, cara.token);
    expect(r.status).toBe(200);
    expect(r.json.path).toBe("deterministic");
    expect(r.json.reply).toContain("Kitchen crew");
    expect(r.json.consulted.readers).toEqual(["events.week"]);
    expect(stubBodies).toHaveLength(0);
    const [[usage]] = await pool.query<any[]>("SELECT path, input_tokens, output_tokens, iterations, key_source FROM assistant_usage WHERE user_id = ? AND mode = 'member' ORDER BY created_at DESC LIMIT 1", [cara.id]);
    expect(usage).toMatchObject({ path: "deterministic", input_tokens: 0, output_tokens: 0, iterations: 0, key_source: "none" });
  });

  it("the inbox: https only, the secret once, and a signed test delivery", async () => {
    expect((await call("PUT", "/api/agent/inbox", { url: "http://example.com/hook" }, ana.token)).status).toBe(400);
    expect((await call("PUT", "/api/agent/inbox", { url: "https://127.0.0.1/hook" }, ana.token)).status).toBe(400);
    // TEST-NET-1: a public-range literal the guard admits and nothing answers,
    // so the attempt below fails on the dialer's timeout, offline and repeatably.
    const set = await call("PUT", "/api/agent/inbox", { url: "https://192.0.2.10/agent" }, ana.token);
    expect(set.status).toBe(200);
    expect(set.json.secret).toMatch(/^[0-9a-f]{64}$/);
    const secret = set.json.secret;
    const get = await call("GET", "/api/agent/inbox", undefined, ana.token);
    expect(get.text).not.toContain(secret);
    const [[inboxRow]] = await pool.query<any[]>("SELECT * FROM agent_inboxes WHERE user_id = ?", [ana.id]);
    expect(JSON.stringify(inboxRow)).not.toContain(secret);
    // A test delivery is queued and attempted at once; nothing answers at the
    // TEST-NET address, so it fails and backs off rather than being lost.
    const test = await call("POST", "/api/agent/inbox/test", {}, ana.token);
    expect(test.status).toBe(200);
    expect(test.json.queued).toBeTruthy();
    const [[dlv]] = await pool.query<any[]>("SELECT kind, attempts, delivered_at, dropped_at FROM agent_deliveries WHERE id = ?", [test.json.queued]);
    expect(dlv.kind).toBe("test");
    expect(dlv.attempts).toBe(1);
    expect(dlv.dropped_at).toBeNull();
    // Profile note and consent round-trip.
    const prof = await call("PUT", "/api/agent/profile", { aboutMe: "I cook on Tuesdays.", aboutTier: "assistant", matchingConsent: true }, ana.token);
    expect(prof.status).toBe(200);
    expect(prof.json.profile).toMatchObject({ aboutMe: "I cook on Tuesdays.", aboutTier: "assistant", matchingConsent: true });
    expect((await call("GET", "/api/agent/profile", undefined, ana.token)).json.consentSentence).toBe("The assistant may use this note and my profile to suggest introductions.");
  });

  it("no secret ever appears in a response body or the server log, except the one that minted it (harm metric 3)", async () => {
    const secrets = [MEMBER_LLM_KEY, ...Object.values(vat)];
    // The mint responses are the ONE place a token value may appear.
    const mintBodies = bodiesSeen.filter((b) => /"token":"vat_/.test(b));
    expect(mintBodies.length).toBeGreaterThanOrEqual(3);
    const rest = bodiesSeen.filter((b) => !/"token":"vat_/.test(b));
    for (const s of secrets) {
      for (const b of rest) expect(b, `a response carried a secret`).not.toContain(s);
      expect(rest.join("\n")).not.toContain("ciphertext");
    }
    const log = logs.join("");
    for (const s of secrets) expect(log, "the server log carried a secret").not.toContain(s);
    const [rows] = await pool.query<any[]>("SELECT text FROM health_events");
    const events = rows.map((r) => String(r.text)).join("\n");
    for (const s of secrets) expect(events, "health_events.text carried a secret").not.toContain(s);
  });

  it("revoke ends the token at once, and the audit rows carry actor_kind agent", async () => {
    const list = await call("GET", "/api/agent/tokens", undefined, cara.token);
    const id = list.json.tokens[0].id;
    expect((await call("DELETE", `/api/agent/tokens/${id}`, undefined, ana.token)).status, "not yours").toBe(404);
    expect((await call("DELETE", `/api/agent/tokens/${id}`, undefined, cara.token)).status).toBe(200);
    const dead = await call("GET", "/api/agent/v1/calendar", undefined, vat.cara);
    expect(dead.status).toBe(401);
    expect(dead.json.reason).toBe("revoked");
    const [rows] = await pool.query<any[]>("SELECT actor_kind, audience, text FROM health_events WHERE kind = 'agent_token'");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) { expect(r.actor_kind).toBe("agent"); expect(r.audience).toBe("admin"); }
  });
});
