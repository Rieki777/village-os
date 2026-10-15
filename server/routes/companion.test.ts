/**
 * THE MEMBER COMPANION over real HTTP, against a real database (Wave 4,
 * plan 5.4). What a member meets:
 *
 *   NO KEY AT ALL. A question asked from a canvas block is answered from the
 *   record, says so in its first sentence, gives our answer, our last reading
 *   and the shelf, buys nothing upstream, and writes a zero-token usage row.
 *   It used to be a 503.
 *
 *   THE LINE BEFORE A MODEL. With a key, nothing the member typed goes
 *   upstream until they say yes to the one line naming the provider and whoever
 *   holds the key. A yes to a line they were not shown is refused; a yes to
 *   the village's key is not a yes to a borrowed one; taking it back closes
 *   the door again.
 *
 *   THE CANVAS'S DOOR HOLDS. An account the village has not admitted is told
 *   so, and never reads the members' answers through the assistant.
 *
 * The model is a fetch stub handed to the engine (`wireAssistant`), which
 * records every request it would have sent, so "nothing went upstream" is a
 * count of zero rather than an absence of errors.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import type { CapabilityCtx } from "../../shared/capabilities";
import { saveAgentProfile } from "../lib/agentProfile";
import { wireAssistant } from "../lib/assistant";
import { LEGAL_PROMPT_RULE, RECORD_REASON_SENTENCE } from "../lib/companionCanvas";
import { CONSENT_PREFS_KEY } from "../lib/companionConsent";
import { ensureInstanceIdentity } from "../lib/identity";
import { wireReaders } from "../lib/villageReaders";
import { recordCanvasReading } from "../repos/canvasReadings";
import { usersRepo } from "../repos/users";
import { CANVAS_MEMBERS_ONLY } from "./canvas";
import { CONSENT_STALE, NEVER_INVENT, register } from "./companion";

const configured = testDbConfigured();
if (!configured) console.warn("[companion.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

const PEOPLE = {
  member: { id: "comp-member", name: "Ash Brook", role: "member", membership: 1 },
  stranger: { id: "comp-stranger", name: "Rook Talbot", role: "member", membership: 0 },
  noted: { id: "comp-noted", name: "Fern Oakes", role: "member", membership: 1 },
} as const;
type Who = keyof typeof PEOPLE;

const DECIDE_WORDS = "We decide by consent at the Saturday circle and write each decision down the same day.";
const READING_WORDS = "Two people decide most things and the rest of us hear about it afterwards.";
const ECONOMY_SECRET = "ADMIN-ECONOMY: the land lease costs the founders more than members know.";

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
/** The village's own key, as the secrets store would answer. Empty is no key. */
let villageKey = "";
/** Every request the engine would have sent upstream. */
let upstream: Array<{ url: string; body: any }> = [];
const usage: Array<{ mode: string; keySource: string; path?: string }> = [];
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["PLATFORM_ASSISTANT_KEY", "PLATFORM_ASSISTANT_OPERATOR", "MEMBER_SECRETS_KEY", "ANTHROPIC_API_KEY"];

async function ask(as: Who, content: string, block?: string) {
  const r = await fetch(`${base}/api/agent/ask`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${as}` },
    body: JSON.stringify({ messages: [{ role: "user", content }], ...(block ? { block } : {}) }),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

async function call(method: string, route: string, as: Who, body?: unknown) {
  const r = await fetch(`${base}${route}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${as}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

async function storedPrefs(id: string): Promise<any> {
  const [rows] = await pool.query<any[]>("SELECT prefs FROM users WHERE id = ?", [id]); // module-review-ok: reading back the scratch schema this suite provisioned
  const raw = rows[0]?.prefs;
  return typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
}

describe.skipIf(!configured)("the member companion", () => {
  beforeAll(async () => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await ensureInstanceIdentity(pool);
    wireReaders({ moduleIsOn: () => false, boolVar: () => false });
    wireAssistant({
      villageKey: () => villageKey,
      rateLimited: async () => false,
      fetchImpl: (async (url: string, init: any) => {
        upstream.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: JSON.stringify({ reply: "MODEL-REPLY", aboutYou: "", draft: null }) }],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });
    for (const p of Object.values(PEOPLE)) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role, membership_granted) VALUES (?,?,?,?,?,?)",
        [p.id, p.name, `${p.id}@example.invalid`, "x", p.role, p.membership],
      );
    }
    for (const row of [
      ["b-decisions", "decisions", "Decisions", DECIDE_WORDS, "member"],
      ["b-economy", "economy", "Economy", ECONOMY_SECRET, "admin"],
    ]) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO village_brief (id, section, title, body, audience, source, status) VALUES (?,?,?,?,?,'admin','confirmed')",
        row,
      );
    }
    await recordCanvasReading(pool, { blockId: "power", level: 2, sentence: READING_WORDS, moment: "baseline", recordedBy: PEOPLE.member.id });

    const members = usersRepo(pool);
    const who = async (req: express.Request) => {
      const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "") as Who;
      return PEOPLE[token] ? members.byId(PEOPLE[token].id) : null;
    };
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: who,
      isAdmin: async (req) => ["admin", "founder"].includes((await who(req))?.role ?? ""),
      hasMembership: (user) => !!(user as { membershipGranted?: boolean }).membershipGranted,
      capabilityCtx: async (): Promise<CapabilityCtx> => ({ stageIndex: 0, stageIndexOf: () => -1, roleCapabilities: [], isAdmin: false, isFounder: false, villageHeld: [] }),
      getPool: () => pool,
      members,
      clientIp: () => "127.0.0.1",
      villageName: () => "Riverbend",
      assistantName: () => "the guide",
      noteAssistantUsage: async (mode, _model, callResult, _userId, path) => {
        usage.push({ mode, keySource: callResult.ok ? callResult.keySource : "refused", path });
      },
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    wireAssistant({ villageKey: () => "", rateLimited: async () => false });
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop?.();
  });

  beforeEach(() => {
    upstream = [];
  });

  describe("with no key at all", () => {
    beforeEach(() => {
      villageKey = "";
      delete process.env.PLATFORM_ASSISTANT_KEY;
    });

    it("answers a question asked from a block from the record, says so, and buys nothing", async () => {
      const r = await ask("member", "how do we decide things here?", "power");
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.path).toBe("deterministic");
      expect(r.body.fromRecord).toBe("no-key");
      const lines = String(r.body.reply).split("\n");
      expect(lines[0]).toBe(RECORD_REASON_SENTENCE["no-key"]);
      expect(r.body.reply).toContain(`Our answer for Power, from Decisions: "${DECIDE_WORDS}"`);
      expect(r.body.reply).toContain(`Our last reading of Power: Forming, "${READING_WORDS}"`);
      expect(r.body.consulted.readers).toEqual(["canvas.answers", "canvas.library"]);
      expect(r.body.consent).toBeUndefined();
      expect(upstream, "nothing went to a model").toHaveLength(0);
      const [[row]] = await pool.query<any[]>( // module-review-ok: reading back the scratch schema this suite provisioned
        "SELECT path, key_source, input_tokens, output_tokens, iterations FROM assistant_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
        [PEOPLE.member.id],
      );
      expect(row).toMatchObject({ path: "deterministic", key_source: "none", input_tokens: 0, output_tokens: 0, iterations: 0 });
    });

    it("never reads an admin-audience answer back, and says it is written and not opened to members, never that there is none", async () => {
      // The village HAS adopted Resourcing's section, at the admin audience
      // (the seed above). This test used to assert "has not adopted", which
      // was the falsehood (second review, 2026-10-01).
      const r = await ask("member", "where does our money come from?", "resourcing");
      expect(r.status).toBe(200);
      expect(r.body.reply).toContain('For Resourcing, "How value moves" is written, and not opened to members, so the guide cannot read it to you.');
      expect(r.body.reply).not.toContain("has not adopted");
      expect(r.body.reply).not.toContain("ADMIN-ECONOMY");
    });

    it("tells an account the village has not admitted that the canvas is for members, and shows it nothing of it", async () => {
      const r = await ask("stranger", "how do we decide things here?", "power");
      expect(r.status).toBe(200);
      expect(r.body.reply).toContain(CANVAS_MEMBERS_ONLY);
      expect(r.body.reply).not.toContain(DECIDE_WORDS);
      expect(r.body.reply).not.toContain(READING_WORDS);
      expect(upstream).toHaveLength(0);
    });

    it("refuses a visitor with no session", async () => {
      const r = await fetch(`${base}/api/agent/ask`, { // module-review-ok: the test client dialling its own in-process server on localhost
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      });
      expect(r.status).toBe(401);
    });
  });

  describe("the line before a model", () => {
    beforeEach(() => {
      villageKey = "vk-test-village-key";
      delete process.env.PLATFORM_ASSISTANT_KEY;
      delete process.env.PLATFORM_ASSISTANT_OPERATOR;
    });

    it("sends nothing upstream until the member agrees to the line that names the provider and the operator", async () => {
      const before = await ask("member", "how should we decide spending?", "power");
      expect(before.status).toBe(200);
      expect(before.body.path).toBe("deterministic");
      expect(before.body.fromRecord).toBe("no-consent");
      expect(String(before.body.reply).split("\n")[0]).toBe(RECORD_REASON_SENTENCE["no-consent"]);
      expect(before.body.consent).toEqual({
        required: true,
        provider: "Anthropic",
        operator: "Riverbend",
        source: "village",
        sentence: "To answer in its own words, the guide sends your question, and what it reads from the village's record for you, to Anthropic, on Riverbend's own key.",
      });
      expect(upstream, "the question stayed on this server").toHaveLength(0);

      const state = await call("GET", "/api/agent/companion", "member");
      expect(state.body).toMatchObject({ connected: true, consent: null, disclosure: { provider: "Anthropic", operator: "Riverbend" } });

      // A yes to a line the member was not shown is refused, and records nothing.
      const stale = await call("POST", "/api/agent/companion/consent", "member", { provider: "Anthropic", operator: "Someone else", source: "village" });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toBe(CONSENT_STALE);
      expect((await storedPrefs(PEOPLE.member.id))[CONSENT_PREFS_KEY]).toBeUndefined();

      const yes = await call("POST", "/api/agent/companion/consent", "member", { provider: "Anthropic", operator: "Riverbend", source: "village" });
      expect(yes.status, JSON.stringify(yes.body)).toBe(200);
      expect((await storedPrefs(PEOPLE.member.id))[CONSENT_PREFS_KEY]).toEqual([
        { provider: "Anthropic", operator: "Riverbend", source: "village", at: expect.any(String) },
      ]);

      const after = await ask("member", "how should we decide spending?", "power");
      expect(after.status, JSON.stringify(after.body)).toBe(200);
      expect(after.body.reply).toBe("MODEL-REPLY");
      expect(after.body.path).toBe("prefetch");
      expect(upstream).toHaveLength(1);
      const system = String(upstream[0].body.system);
      expect(system).toContain(NEVER_INVENT);
      expect(system).toContain("The member is asking from the Power block of the village's governance canvas.");
      expect(system).toContain("Authority, highest first");
      // Second review: a closed section is never called blank, and legal counsel keeps its framing.
      expect(system).toContain('When canvas.answers lists a section under "others" as kept with the administrators or not opened to members, say exactly that, never call it blank or unadopted');
      expect(system).toContain(LEGAL_PROMPT_RULE);
      // The village's answer reached the model, fenced as data.
      const fence = system.indexOf('<village-data reader="canvas.answers">');
      expect(fence).toBeGreaterThan(-1);
      expect(system.indexOf(DECIDE_WORDS)).toBeGreaterThan(fence);
      expect(system).not.toContain("ADMIN-ECONOMY");
      expect(usage.at(-1)).toMatchObject({ mode: "member", keySource: "village", path: "prefetch" });
    });

    it("asks again when the key changes hands: a yes to the village's key is not a yes to a borrowed one", async () => {
      villageKey = "";
      process.env.PLATFORM_ASSISTANT_KEY = "pk-test-borrowed";
      process.env.PLATFORM_ASSISTANT_OPERATOR = "Hosting Co-op";
      const r = await ask("member", "how should we decide spending?", "power");
      expect(r.body.fromRecord).toBe("no-consent");
      expect(r.body.consent).toMatchObject({ provider: "Anthropic", operator: "Hosting Co-op", source: "platform" });
      expect(r.body.consent.sentence).toContain("on a key Hosting Co-op shares with Riverbend");
      expect(upstream).toHaveLength(0);
    });

    it("names the member's own note in the line whenever the note would go upstream with the question", async () => {
      // First review: the line listed the question and the record and left out
      // the note, which rides in the prompt at the assistant tier or wider.
      const NOTE = "NOTE-SENTINEL: I can only do mornings and I am learning to keep bees.";
      const withNote = "To answer in its own words, the guide sends your question, your note to your agent, and what it reads from the village's record for you, to Anthropic, on Riverbend's own key.";
      // A private note stays out of the prompt, so the line does not name it.
      expect((await saveAgentProfile(pool, PEOPLE.noted.id, { aboutMe: NOTE, aboutTier: "private" })).ok).toBe(true);
      const quiet = await ask("noted", "how should we decide spending?", "power");
      expect(quiet.body.consent.sentence).not.toContain("your note");
      // At the assistant tier it goes upstream after the yes, so the line names it.
      expect((await saveAgentProfile(pool, PEOPLE.noted.id, { aboutTier: "assistant" })).ok).toBe(true);
      const before = await ask("noted", "how should we decide spending?", "power");
      expect(before.body.consent.sentence).toBe(withNote);
      expect((await call("GET", "/api/agent/companion", "noted")).body.disclosure.sentence).toBe(withNote);
      expect(upstream).toHaveLength(0);
      const yes = await call("POST", "/api/agent/companion/consent", "noted", { provider: "Anthropic", operator: "Riverbend", source: "village" });
      expect(yes.status, JSON.stringify(yes.body)).toBe(200);
      await ask("noted", "how should we decide spending?", "power");
      expect(upstream).toHaveLength(1);
      expect(String(upstream[0].body.system), "the note the line named is the note that went").toContain(NOTE);
    });

    /*
     * Audit of Wave 4: a yes given while the note stayed private covered the
     * note once the member moved it to the assistant tier, and the note went
     * upstream under a line that never named it.
     */
    it("asks again before a note written after the yes goes upstream", async () => {
      expect((await call("DELETE", "/api/agent/companion/consent", "noted")).status).toBe(200);
      expect((await saveAgentProfile(pool, PEOPLE.noted.id, { aboutTier: "private" })).ok).toBe(true);
      const yes = await call("POST", "/api/agent/companion/consent", "noted", { provider: "Anthropic", operator: "Riverbend", source: "village" });
      expect(yes.status, JSON.stringify(yes.body)).toBe(200);
      await ask("noted", "how should we decide spending?", "power");
      expect(upstream, "the yes covers the line it named").toHaveLength(1);
      expect(String(upstream[0].body.system)).not.toContain("NOTE-SENTINEL");

      expect((await saveAgentProfile(pool, PEOPLE.noted.id, { aboutTier: "assistant" })).ok).toBe(true);
      const r = await ask("noted", "how should we decide spending?", "power");
      expect(r.body.fromRecord).toBe("no-consent");
      expect(r.body.consent.sentence).toContain("your note to your agent");
      expect(upstream, "nothing more went upstream").toHaveLength(1);
    });

    it("closes the door again when the member takes their yes back", async () => {
      const gone = await call("DELETE", "/api/agent/companion/consent", "member");
      expect(gone.status).toBe(200);
      expect((await storedPrefs(PEOPLE.member.id))[CONSENT_PREFS_KEY]).toBeUndefined();
      const r = await ask("member", "how should we decide spending?", "power");
      expect(r.body.fromRecord).toBe("no-consent");
      expect(upstream).toHaveLength(0);
    });
  });
});
