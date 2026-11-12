/**
 * PROPOSED CHANGES, over real HTTP and the scratch schema.
 *
 *   - a never-proposable change and a broken one are refused at proposal time, with a reason, and nothing is filed
 *   - accept runs each change through its target route AS THE PERSON; one that fails leaves the others landed
 *   - a missing capability at accept is the route's own refusal, shown on the change, which can be fixed and accepted again
 *   - an edited text is accepted exactly as edited, and the lesson records the difference
 *   - drafts save on the server; the connector and an agent account cannot accept
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { usersRepo } from "../repos/users";
import { register } from "./proposedChanges";

const configured = testDbConfigured();
if (!configured) console.warn("[proposedChanges] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ADMIN = { id: "u-admin", name: "Fern Oak", email: "fern@example.test" };
const AGENT = { id: "u-agent", name: "Helper Agent", email: "agent@example.test" };
const STRANGER = { id: "u-str", name: "Sam Field", email: "sam@example.test" };

describe.skipIf(!configured)("proposed changes, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let target: http.Server;
  let base = "";
  let targetPort = 0;
  const content: Record<string, any> = { "page-home": { hero: { headline: "Welcome home", badge: "Open" } } };
  const faqs: Record<string, any[]> = { steward: [{ id: "ste-1", question: "Who decides?", answer: "The circle." }] };
  // Which routes say no, as the one capability gate would for a person without the power.
  const refuse = new Set<string>();
  const hits: Array<{ method: string; path: string; auth: string; body: any }> = [];

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 });
    const users = usersRepo(pool);
    for (const p of [ADMIN, AGENT, STRANGER]) await users.add({ id: p.id, name: p.name, email: p.email, passwordHash: "x", paths: [] } as any);
    await q("UPDATE users SET is_agent = 1 WHERE id = ?", [AGENT.id]);

    // A stand-in for the target routes: it records who called, and refuses where the person lacks the power.
    const fake = express();
    fake.use(express.json());
    fake.use((req, res) => {
      hits.push({ method: req.method, path: req.path, auth: String(req.headers.authorization ?? ""), body: req.body });
      if (refuse.has(req.path)) return res.status(403).json({ error: "capability_required", message: "This needs the power to turn the village's dials." });
      if (req.method === "PUT" && req.path.startsWith("/api/admin/content/")) content[req.path.split("/").pop()!] = req.body;
      if (req.method === "POST" && req.path === "/api/admin/faqs/steward") faqs.steward.push({ id: `ste-${faqs.steward.length + 1}`, ...req.body });
      res.json({ success: true });
    });
    target = http.createServer(fake);
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    targetPort = (target.address() as { port: number }).port;

    const authedUser = async (req: any) => {
      const who = String(req.headers.authorization ?? "").replace("Bearer ", "");
      return who ? await usersRepo(pool).byId(who) : null;
    };
    const app = express();
    app.use(express.json());
    app.put("/api/admin/brand", (_req, res) => res.json({ success: true })); // a route a `setting` may name
    register(app, {
      authedUser,
      getPool: () => pool,
      isAdmin: async (req: any) => [ADMIN.id, AGENT.id].includes(String((await authedUser(req))?.id ?? "")),
      overLimit: async () => false,
      members: usersRepo(pool),
      contentRepo: { get: () => content } as any,
      faqsRepo: { get: () => faqs } as any,
      seasonState: () => ({ current: null, seasons: [], timezone: "UTC" }),
      liveHoldersOf: async () => [],
      port: () => targetPort,
      clientIp: () => "203.0.113.9",
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await new Promise<void>((resolve) => target?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    refuse.clear();
    hits.length = 0;
    await q("DELETE FROM proposed_changes");
    await q("DELETE FROM proposed_change_batches");
  });

  const call = async (method: string, path: string, body?: unknown, as: string | null = ADMIN.id, extra: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { // module-review-ok: a test calling its own local server, never an outside host
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(as ? { authorization: `Bearer ${as}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  const PAGE = { kind: "page_content", target: { section: "page-home" }, body: { hero: { headline: "A home for families on the land" } }, summary: "Reword the homepage headline." };
  const FAQ = { kind: "faq_add", target: { pathway: "steward" }, body: { question: "How do I start?", answer: "Write to the circle." }, summary: "Add an FAQ on starting." };
  const DIAL = { kind: "variable", target: { key: "org.applicant_reply_days" }, body: { value: "10" }, summary: "Promise a reply within ten days." };

  it("a never-proposable change is refused with its reason, and nothing is filed", async () => {
    const r = await call("POST", "/api/admin/proposals", { batch: "Keys", items: [PAGE, { kind: "setting", target: { method: "PUT", path: "/api/admin/integrations/resend" }, body: { key: "x" }, summary: "Set the mail key." }] }, AGENT.id);
    expect(r.status).toBe(400);
    expect(r.body.refused).toEqual([expect.objectContaining({ index: 1, code: "never_secrets" })]);
    expect(await q("SELECT id FROM proposed_changes")).toHaveLength(0);
  });

  it("the target's validator refuses a broken proposal when it is proposed, naming the field", async () => {
    const r = await call("POST", "/api/admin/proposals", {
      batch: "Broken",
      items: [
        { ...DIAL, body: { value: "900" } },
        { ...PAGE, body: { hero: { nonsense: "x" } } },
        { kind: "setting", target: { method: "PUT", path: "/api/admin/no-such-route" }, body: {}, summary: "Change nothing real." },
      ],
    }, AGENT.id);
    expect(r.status).toBe(400);
    expect(r.body.refused.map((x: any) => [x.index, x.field])).toEqual([[0, "value"], [1, "body"], [2, "target.path"]]);
    expect(await q("SELECT id FROM proposed_changes")).toHaveLength(0);
  });

  it("files a batch, then a bulk accept lands two and leaves the refused one, which is fixed and accepted again", async () => {
    const filed = await call("POST", "/api/admin/proposals", { batch: "Phase A content", items: [PAGE, FAQ, DIAL] }, AGENT.id);
    expect(filed.status).toBe(200);
    expect(filed.body.applied).toBe(false);
    const [pageId, faqId, dialId] = filed.body.ids;
    expect(hits).toHaveLength(0); // proposing changed nothing live

    const page = await call("GET", "/api/admin/proposals");
    expect(page.body.changes.map((c: any) => c.targetLabel)).toEqual(["Home page", "Steward FAQ", "Days we promise to reply to a role proposal"]);
    expect(page.body.changes[0].live).toEqual({ hero: { headline: "Welcome home", badge: "Open" } });
    expect(page.body.changes[0].byKind).toBe("agent");

    refuse.add("/api/admin/variables/org.applicant_reply_days");
    const acc = await call("POST", "/api/admin/proposals/accept", { items: [{ id: pageId }, { id: faqId }, { id: dialId }] });
    expect(acc.status).toBe(200);
    expect(acc.body.results.map((x: any) => x.ok)).toEqual([true, true, false]);
    expect(acc.body.results[2].error).toContain("power");
    // Each call went through its own route as the person who pressed Accept, never as the agent.
    expect(hits.map((h) => `${h.method} ${h.path}`)).toEqual(["PUT /api/admin/content/page-home", "POST /api/admin/faqs/steward", "PUT /api/admin/variables/org.applicant_reply_days"]);
    expect(hits.every((h) => h.auth === `Bearer ${ADMIN.id}`)).toBe(true);
    // The page is merged onto what is live: the badge stays.
    expect(content["page-home"]).toEqual({ hero: { headline: "A home for families on the land", badge: "Open" } });
    const rows = await q("SELECT id, status, error_text, approved_by, approval_note FROM proposed_changes ORDER BY position");
    expect(rows.map((r) => r.status)).toEqual(["accepted", "accepted", "failed"]);
    expect(rows[0]).toMatchObject({ approved_by: "Fern Oak", approval_note: "accepted on the review page" });
    const events = await q("SELECT text FROM health_events WHERE kind = 'proposed_change' ORDER BY at");
    expect(events.some((e) => /accepted by Fern/.test(e.text))).toBe(true);

    // Still on the page with its reason; fixed (the power is now held) and accepted again.
    const again = await call("GET", "/api/admin/proposals");
    expect(again.body.changes.map((c: any) => [c.id, c.status])).toEqual([[dialId, "failed"]]);
    refuse.clear();
    const fixed = await call("POST", "/api/admin/proposals/accept", { items: [{ id: dialId, body: { value: "12" } }] });
    expect(fixed.body.results).toEqual([{ id: dialId, ok: true }]);
    expect(hits.at(-1)!.body).toEqual({ value: "12" });
  });

  it("an edited text is accepted exactly as edited, and the lesson records the difference", async () => {
    const filed = await call("POST", "/api/admin/proposals", { batch: "Words", items: [PAGE] }, AGENT.id);
    const id = filed.body.ids[0];
    const edited = { hero: { headline: "A home on the land, held together" } };
    expect((await call("PUT", `/api/admin/proposals/${id}/draft`, { body: edited })).status).toBe(200);
    // Leaving and coming back keeps the draft.
    expect((await call("GET", "/api/admin/proposals")).body.changes[0].draft).toEqual(edited);
    // Accepted without resending the body: the saved draft is what lands.
    const acc = await call("POST", "/api/admin/proposals/accept", { items: [{ id }] });
    expect(acc.body.results[0].ok).toBe(true);
    expect(hits[0].body.hero.headline).toBe("A home on the land, held together");
    const [row] = await q("SELECT accepted_json FROM proposed_changes WHERE id = ?", [id]);
    expect(JSON.parse(row.accepted_json)).toEqual(edited);
    const lessons = await call("GET", "/api/admin/proposals/lessons", undefined, AGENT.id);
    expect(lessons.body.groups).toEqual([
      { kind: "page_content", fields: [{ field: "hero.headline", changes: [expect.objectContaining({ proposed: "A home for families on the land", accepted: "A home on the land, held together", summary: PAGE.summary })] }] },
    ]);
  });

  it("the dry run names the field and writes nothing", async () => {
    const filed = await call("POST", "/api/admin/proposals", { batch: "Dial", items: [DIAL] }, AGENT.id);
    const id = filed.body.ids[0];
    const r = await call("POST", "/api/admin/proposals/check", { items: [{ id, body: { value: "0" } }] });
    expect(r.body.results).toEqual([expect.objectContaining({ id, ok: false, field: "value" })]);
    expect(hits).toHaveLength(0);
    const [row] = await q("SELECT status FROM proposed_changes WHERE id = ?", [id]);
    expect(row.status).toBe("proposed");
  });

  it("the connector and an agent account cannot accept or discard; a stranger cannot open the page", async () => {
    const filed = await call("POST", "/api/admin/proposals", { batch: "Mixed", items: [FAQ] }, AGENT.id);
    const id = filed.body.ids[0];
    expect((await call("POST", "/api/admin/proposals/accept", { items: [{ id }] }, AGENT.id)).status).toBe(403);
    expect((await call("POST", "/api/admin/proposals/accept", { items: [{ id }] }, ADMIN.id, { "x-village-connector": "1" })).status).toBe(403);
    expect((await call("POST", "/api/admin/proposals/discard", { ids: [id] }, AGENT.id)).status).toBe(403);
    expect((await call("GET", "/api/admin/proposals", undefined, STRANGER.id)).status).toBe(403);
    expect(hits).toHaveLength(0);
    const disc = await call("POST", "/api/admin/proposals/discard", { ids: [id] });
    expect(disc.body.results[0].ok).toBe(true);
    expect((await call("GET", "/api/admin/proposals/count")).body.open).toBe(0);
  });

  it("a setting goes through its own route, and approval fields in a body are kept out of it", async () => {
    const filed = await call("POST", "/api/admin/proposals", { batch: "Brand", items: [{ kind: "setting", target: { method: "PUT", path: "/api/admin/brand" }, body: { tagline: "Living together", approvedBy: "x", approvalNote: "yes" }, summary: "A new tagline." }] }, AGENT.id);
    expect(filed.status).toBe(200);
    const [row] = await q("SELECT body_json FROM proposed_changes");
    expect(JSON.parse(row.body_json)).toEqual({ tagline: "Living together" });
  });
});
