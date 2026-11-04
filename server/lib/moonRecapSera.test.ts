/**
 * THE SERA DRAFT (spec section 7; Rye, 3 November: on). One ask_sera call with
 * a fixed question, each bullet or paragraph one suggested item with its first
 * link as evidence, contact details stripped, links already gathered dropped,
 * at most 40, and a 90-second cap that the client's `timeoutMs` now enforces.
 * Check 46 (no route calls ask_sera) is retired by that decision.
 *
 * The first block needs no database. The second runs against a scratch schema.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { LIMITS, SERA_WORDS } from "../../shared/moonRecap";
import { callSignal, openSession, type ClientOptions } from "./saberraClient";
import { answerText, askSera, questionArgs, seraDraftItems, seraQuestion } from "./moonRecapSera";
import { loadFrame, moonOf } from "./moonRecap";

const sse = (payload: unknown) => `event: message\ndata: ${JSON.stringify(payload)}\n\n`;

/** A fake library: a session, a tool list with ask_sera, and one answer. Records what it was asked. */
function fakeLibrary(answer: string, asked: Array<Record<string, unknown>>): ClientOptions {
  return {
    baseUrl: "https://library.example.test/mcp",
    token: "t",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return new Response("", { status: 200, headers: { "mcp-session-id": "s-1" } });
      if (body.method === "tools/list") {
        return new Response(sse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "ask_sera", inputSchema: { type: "object", properties: { question: { type: "string" }, owner_id: { type: "string" } }, required: ["question"] } }] } }), { status: 200 });
      }
      asked.push(body.params);
      return new Response(sse({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: answer }] } }), { status: 200 });
    },
  };
}

const ANSWER = [
  "Here is what Wren took part in:",
  "- Decided the spring water budget, https://docs.example.test/decision-1",
  "- Met the well crew, call +1 555 010 0101 or wren@example.test (https://notes.example.test/m-2).",
  "- Already gathered work https://example.test/already",
  "",
  "Wrote the pump manual, a long paragraph",
  "that runs over two lines. https://docs.example.test/manual",
].join("\n");

describe("the Sera draft without a database", () => {
  it("asks one fixed question naming the member and the moon's dates, under the argument the schema declares", () => {
    const q = seraQuestion("Wren Alder", "2026-10-10", "2026-11-08");
    expect(q).toContain("Wren Alder");
    expect(q).toContain("10 October 2026 and 8 November 2026");
    const args = questionArgs({ name: "ask_sera", inputSchema: { properties: { query: { type: "string" }, person_id: { type: "string" } } } }, q, "owner-7");
    expect(args).toEqual({ query: q, person_id: "owner-7" });
  });

  it("makes one suggestion per bullet or paragraph, first link as evidence, contact details stripped, gathered links dropped", () => {
    const out = seraDraftItems(ANSWER, [{ evidenceUrl: "https://example.test/already", dedupeKey: "task:t-1" }]);
    expect(out).toEqual([
      { text: "Decided the spring water budget", link: "https://docs.example.test/decision-1" },
      { text: "Met the well crew, call [number removed] or [email removed].", link: "https://notes.example.test/m-2" },
      { text: "Wrote the pump manual, a long paragraph that runs over two lines.", link: "https://docs.example.test/manual" },
    ]);
  });

  it("drops a suggestion whose link names a Sera task the recap already holds, and caps at 40", () => {
    const many = Array.from({ length: 60 }, (_, i) => `- Item ${i} https://library.example.test/tasks/lib-${i}`).join("\n");
    const out = seraDraftItems(many, [{ evidenceUrl: null, dedupeKey: "sera:lib-3" }]);
    expect(out).toHaveLength(LIMITS.seraItems);
    expect(out.some((o) => o.link?.endsWith("/lib-3"))).toBe(false);
  });

  it("reads the answer whether it came back as words or as JSON", () => {
    expect(answerText("plain")).toBe("plain");
    expect(answerText({ answer: "from json" })).toBe("from json");
    expect(answerText(42)).toBe("");
  });

  it("the client's timeoutMs is applied: a call that never answers stops", async () => {
    expect(callSignal({})).toBeUndefined();
    const hanging: ClientOptions = {
      baseUrl: "https://library.example.test/mcp", token: "t", timeoutMs: 50,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const started = Date.now();
    expect(await openSession(hanging)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

const configured = testDbConfigured();
const TZ = "America/Costa_Rica";
const MOON = moonOf(LUNAR_CLOCK.boundsFor(new Date("2026-10-20T12:00:00Z")), TZ);
const frameDeps = { timeZone: TZ, seasons: [] };

describe.skipIf(!configured)("the Sera draft against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES ('m-wren', 'Wren Alder', 'wren@example.test', 'x', 'wren')"); // module-review-ok: fixture SQL
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    for (const t of ["moon_recap_items", "moon_recaps", "sera_person_links"]) await q(`DELETE FROM \`${t}\``); // module-review-ok: fixture SQL
  });

  it("with no Sera person linked, says so and calls nothing", async () => {
    let called = 0;
    const frame = await loadFrame(pool, "m-wren", MOON, frameDeps);
    const out = await askSera(pool, "m-wren", MOON, frame, { client: () => { called += 1; return null; }, nameOf: async () => "Wren Alder" }, true);
    expect(out.ok && out.value.sera).toMatchObject({ state: "not_linked", line: SERA_WORDS.notLinked });
    expect(called).toBe(0);
  });

  it("writes each suggestion private to the member, keyed so the outbox never closes it, and a second run adds nothing", async () => {
    await q("INSERT INTO `sera_person_links` (`sera_owner_id`, `user_id`, `linked_by_user_id`, `how`) VALUES ('owner-7', 'm-wren', NULL, 'steward')"); // module-review-ok: fixture SQL
    const asked: Array<Record<string, unknown>> = [];
    const frame = await loadFrame(pool, "m-wren", MOON, frameDeps);
    const deps = { client: () => fakeLibrary(ANSWER, asked), nameOf: async () => "Wren Alder" };
    const out = await askSera(pool, "m-wren", MOON, frame, deps, true);
    expect(out.ok && out.value.sera).toMatchObject({ state: "done", added: 4, line: SERA_WORDS.done });
    expect(asked).toHaveLength(1);
    const args = asked[0].arguments as Record<string, unknown>;
    expect(args.owner_id).toBe("owner-7");
    expect(String(args.question)).toContain("Wren Alder");
    const items = await q("SELECT `origin`, `state`, `visibility`, `dedupe_key`, `evidence_url`, `text` FROM `moon_recap_items` ORDER BY `position`"); // module-review-ok: fixture SQL
    for (const i of items) expect(i).toMatchObject({ origin: "sera", state: "suggested", visibility: "approvers" });
    for (const i of items) expect(String(i.dedupe_key).startsWith("sera:")).toBe(false);
    expect(items.map((i: any) => i.text).join(" ")).not.toMatch(/555|@example/);
    const again = await askSera(pool, "m-wren", MOON, frame, deps, true);
    expect(again.ok && again.value.sera.added).toBe(0);
  });

  it("stops at its deadline and says Sera did not answer in time", async () => {
    await q("INSERT INTO `sera_person_links` (`sera_owner_id`, `user_id`, `linked_by_user_id`, `how`) VALUES ('owner-7', 'm-wren', NULL, 'steward')"); // module-review-ok: fixture SQL
    const frame = await loadFrame(pool, "m-wren", MOON, frameDeps);
    const hanging: ClientOptions = {
      baseUrl: "https://library.example.test/mcp", token: "t",
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const out = await askSera(pool, "m-wren", MOON, frame, { client: () => hanging, nameOf: async () => "Wren Alder", timeoutMs: 100 }, true);
    expect(out.ok && out.value.sera).toMatchObject({ state: "failed", line: SERA_WORDS.failed });
  });
});
