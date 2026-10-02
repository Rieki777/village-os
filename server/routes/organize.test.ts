/**
 * THE STEWARDS' GUIDE READS THE BRIEF (Wave 4, defect 10), over real HTTP,
 * against a real database.
 *
 * The Brain tab (client/src/pages/Admin.tsx) tells an admin: the guide reads
 * this before it suggests anything, ranks it above the shipped literature and
 * below what is live in the game, names which section it drew on, and asks
 * about what is still blank. Until this lane the organize route never read the
 * brief at all. This suite reads the prompt the engine would have sent
 * upstream (a fetch stub handed to `wireAssistant`) and checks each clause:
 *
 *   the confirmed section is IN the prompt, fenced as the village's data;
 *   the heading says where it ranks;
 *   the blanks are listed with the instruction to ask about one at a time;
 *   a proposed section (the guide's own guess) is NOT there;
 *   the answer names the section that rode along.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import type { CapabilityCtx } from "../../shared/capabilities";
import { wireAssistant } from "../lib/assistant";
import { ensureInstanceIdentity } from "../lib/identity";
import { wireReaders } from "../lib/villageReaders";
import { register } from "./organize";

const configured = testDbConfigured();
if (!configured) console.warn("[organize.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

const PEOPLE: Record<string, { id: string; role: string }> = {
  admin: { id: "org-admin", role: "admin" },
  member: { id: "org-member", role: "member" },
};

const BRIEF_WORDS = "BRIEF-SENTINEL: we fire the kiln on Thursdays and the pottery circle holds the keys.";
const GUESS_WORDS = "PROPOSED-GUESS: dues are probably forty a moon.";

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
let upstream: any[] = [];

async function organize(as: string | null, content: string) {
  const r = await fetch(`${base}/api/admin/assistant/organize`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method: "POST",
    headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

describe.skipIf(!configured)("the stewards' guide, organize mode", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await ensureInstanceIdentity(pool);
    wireReaders({ moduleIsOn: () => false, boolVar: () => false });
    wireAssistant({
      villageKey: () => "vk-test-organize",
      rateLimited: async () => false,
      fetchImpl: (async (_url: string, init: any) => {
        upstream.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: JSON.stringify({ reply: "Start from the work section." }) }],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });
    for (const [id, section, title, body, status] of [
      ["b-work", "work", "The work", BRIEF_WORDS, "confirmed"],
      ["b-economy", "economy", "Economy", GUESS_WORDS, "proposed"],
    ]) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO village_brief (id, section, title, body, audience, source, status) VALUES (?,?,?,?,'admin','admin',?)",
        [id, section, title, body, status],
      );
    }

    const who = (req: express.Request) => PEOPLE[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;
    const app = express();
    app.use(express.json());
    register(app, {
      isAdmin: async (req) => who(req)?.role === "admin",
      authedUser: async (req) => who(req),
      capabilityCtx: async (): Promise<CapabilityCtx> => ({ stageIndex: 0, stageIndexOf: () => -1, roleCapabilities: [], isAdmin: true, isFounder: false, villageHeld: [] }),
      getPool: () => pool,
      clientIp: () => "127.0.0.1",
      villageName: () => "Riverbend",
      assistantName: () => "the guide",
      noteAssistantUsage: async () => {},
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    wireAssistant({ villageKey: () => "", rateLimited: async () => false });
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop?.();
  });

  beforeEach(() => {
    upstream = [];
  });

  it("reads the brief before it suggests anything: the confirmed section is in the prompt, fenced, and named in the answer", async () => {
    const r = await organize("admin", "how should we organize the kiln work?");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.reply).toBe("Start from the work section.");
    expect(upstream).toHaveLength(1);
    const system = String(upstream[0].system);
    // Where it ranks, in the words the model reads.
    expect(system).toContain("THIS VILLAGE'S BRIEF");
    expect(system).toContain("It ranks above the village's calls and the shared shelf, and below what the readers show is live now.");
    // The section itself, inside the village-data fence.
    const fence = system.indexOf('<village-data reader="brief.sections">');
    expect(fence).toBeGreaterThan(-1);
    expect(system.indexOf(BRIEF_WORDS)).toBeGreaterThan(fence);
    expect(system.indexOf(BRIEF_WORDS)).toBeLessThan(system.indexOf("</village-data>", fence));
    // The blanks, with the one-at-a-time instruction the Brain tab promises.
    expect(system).toMatch(/Still blank: [^\n]*people[^\n]*\. Ask about one of these when the conversation touches it, one at a time\./);
    // The guide's own guess is not the village's word.
    expect(system).not.toContain("PROPOSED-GUESS");
    // Names which section it drew on.
    expect(r.body.consulted.brief).toEqual(["work"]);
  });

  it("stays the admins' door", async () => {
    expect((await organize("member", "how should we organize?")).status).toBe(401);
    expect((await organize(null, "how should we organize?")).status).toBe(401);
    expect(upstream).toHaveLength(0);
  });

  it("tells a steward the truth about a confirmed Legal section on the road with no model (second review, 2026-10-01)", async () => {
    // Seeded here, after the prompt test above, so it does not join that test's brief.
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO village_brief (id, section, title, body, audience, source, status) VALUES ('b-legal','legal','What exists on paper',?,'admin','admin','confirmed')",
      ["LEGAL-WORDS: a cooperative holds the deed."],
    );
    const r = await organize("admin", "what did we answer for legal?");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.path).toBe("deterministic");
    expect(upstream).toHaveLength(0);
    // It used to say "The village has not adopted an answer for Legal yet." to the admin who confirmed it.
    expect(r.body.reply).toContain('For Legal, "What exists on paper" is adopted, and its words stay with the administrators.');
    expect(r.body.reply).not.toContain("has not adopted");
  });
});
