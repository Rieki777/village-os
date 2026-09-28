/**
 * A MEMBER'S NOTEBOOK, THE PICKS AND THE EXPORT PACK over real HTTP, against a
 * real database (plan 5.5 and 5.6; migration 0226).
 *
 * Each case asserts what HAPPENED, read back from the tables or the files the
 * route handed over: a document another member cannot read answers exactly
 * like one that does not exist; a share is a suggestion and changes nothing
 * until the pen adopts it (the adopt itself is in canvasFrames.test.ts); the
 * pack carries what a member reads on the canvas and nothing an admin keeps;
 * every export leaves an audit row with its hash and the brain's etag.
 *
 * ── THE GATE IS A FAITHFUL STUB OVER THE REAL ONE ──────────────────────────
 *
 * `guardCapability` lives inside server/index.ts and cannot be imported, so
 * the one handed to `register` is built from the REAL `capabilityDecision`,
 * as server/routes/canvas.test.ts does. The model call is a stand-in that
 * records what it was sent: no network runs here.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { DOCUMENT_WORDS } from "../../shared/villageDocuments";
import { modelFallback, type DocumentDraft } from "../../shared/documentDraft";
import type { MemberKey } from "../lib/assistant";
import type { ModelDraftInput } from "../lib/documentDraftModel";
import { briefWrite } from "../lib/villageBrain";
import { CANVAS_DATABASE_CSV } from "../lib/notebookExport";
import { recordCanvasReading } from "../repos/canvasReadings";
import { canvasProposalById } from "../repos/canvasProposals";
import { markDocumentShared, notebookForExport } from "../repos/villageDocuments";
import { CANVAS_MEMBERS_ONLY } from "./canvas";
import { MODEL_OWNER_ONLY, NO_MODEL, VILLAGE_PICK_REFUSAL, register } from "./villageDocuments";

const configured = testDbConfigured();
if (!configured) console.warn("[villageDocuments.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

const PEOPLE: Record<string, { id: string; name: string; role: string; caps: string[]; membershipGranted: boolean }> = {
  owner: { id: "vd-owner", name: "Hazel Quinlan", role: "member", caps: [], membershipGranted: true },
  other: { id: "vd-other", name: "Bram Oakes", role: "member", caps: [], membershipGranted: true },
  teller: { id: "vd-teller", name: "Wren Marsh", role: "member", caps: ["story.tell"], membershipGranted: true },
  admin: { id: "vd-admin", name: "Moss Fielding", role: "admin", caps: [], membershipGranted: false },
  stranger: { id: "vd-stranger", name: "Rook Talbot", role: "member", caps: [], membershipGranted: false },
};
type Who = keyof typeof PEOPLE;

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
/** The key the owner's model road would use. Null means none is set. */
let MEMBER_KEY: MemberKey | null = null;
/** What the model stand-in was sent, one entry per call. */
const MODEL_CALLS: ModelDraftInput[] = [];
/** What the model stand-in answers with. */
let MODEL_DRAFT: DocumentDraft = modelFallback();

const who = (req: express.Request) => PEOPLE[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;

const ctxFor = (user: (typeof PEOPLE)[string]): CapabilityCtx => ({
  stageIndex: 0,
  stageIndexOf: () => -1,
  roleCapabilities: user.caps,
  isAdmin: user.role === "admin" || user.role === "founder",
  isFounder: user.role === "founder",
  villageHeld: [],
});

async function call(method: string, route: string, as: Who | null, body?: unknown) {
  const r = await fetch(`${base}${route}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

async function upload(as: Who, name: string, bytes: Buffer, title = "") {
  const form = new FormData();
  form.append("title", title);
  form.append("file", new Blob([new Uint8Array(bytes)]), name);
  const r = await fetch(`${base}/api/documents/file`, { method: "POST", headers: { Authorization: `Bearer ${as}` }, body: form }); // module-review-ok: the test client dialling its own in-process server on localhost
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

const addText = async (as: Who, title: string, body: string) => {
  const r = await call("POST", "/api/documents", as, { kind: "paste", title, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.document.id as number;
};

/** The pack as one string, for "is it anywhere in any file" questions. */
const whole = (files: Array<{ name: string; content: string }>) => files.map((f) => `${f.name}\n${f.content}`).join("\n");
const file = (files: Array<{ name: string; content: string }>, name: string) => files.find((f) => f.name === name)?.content ?? "";

describe.skipIf(!configured)("a member's notebook, the picks and the export", () => {
  beforeAll(async () => {
    db = await provisionTestDb({ gameStarted: false });
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    for (const p of Object.values(PEOPLE)) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
        [p.id, p.name, `${p.id}@example.invalid`, "x", p.role],
      );
    }
    const app = express();
    app.use(express.json({ limit: "1mb" })); // the limit server/index.ts sets
    register(app, {
      authedUser: async (req) => who(req),
      isAdmin: async (req) => ["admin", "founder"].includes(who(req)?.role ?? ""),
      hasMembership: (user) => !!(user as { membershipGranted?: boolean }).membershipGranted,
      capabilityCtx: async (user) => ctxFor(user),
      guardCapability: async (req, res, cap: Capability, refusal) => {
        const user = who(req);
        if (!user) {
          res.status(401).json({ error: "auth_required" });
          return false;
        }
        if (capabilityDecision(cap, ctxFor(user)).allowed) return true;
        res.status(refusal?.status ?? 403).json(refusal?.body ?? { error: "forbidden" });
        return false;
      },
      getPool: () => pool,
      firstName: (name: string) => String(name ?? "").trim().split(/\s+/)[0] ?? "",
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
      villageName: () => "Alder Hollow",
      memberKey: async () => MEMBER_KEY,
      draftModel: async (input) => {
        MODEL_CALLS.push(input);
        return { ok: true, result: { read: true, draft: MODEL_DRAFT } };
      },
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop?.();
  });

  describe("who gets in", () => {
    it("asks a visitor to sign in and tells an account the village has not admitted why", async () => {
      for (const [method, route] of [
        ["GET", "/api/documents"],
        ["POST", "/api/documents"],
        ["POST", "/api/canvas/exports"],
        ["GET", "/api/canvas/exports/latest"],
        ["GET", "/api/canvas/resource-picks"],
      ] as const) {
        expect(await call(method, route, null, method === "POST" ? {} : undefined), `${method} ${route}`).toEqual({ status: 401, body: { error: "auth_required" } });
        expect(await call(method, route, "stranger", method === "POST" ? {} : undefined), `${method} ${route}`).toEqual({ status: 403, body: { error: CANVAS_MEMBERS_ONLY } });
      }
      // And the stranger's refused add left nothing behind.
      expect(await q("SELECT id FROM village_documents WHERE owner_user_id = ?", [PEOPLE.stranger.id])).toHaveLength(0);
    });
  });

  describe("private by default", () => {
    let docId = 0;
    it("stores a pasted document as its owner's, private", async () => {
      docId = await addText("owner", "Our well rota", "## Who draws water\n\nHazel on Mondays, the WELLROTA-PRIVATE line.");
      const rows = await q("SELECT owner_user_id, kind, shared_with_village FROM village_documents WHERE id = ?", [docId]);
      expect(rows[0]).toMatchObject({ owner_user_id: PEOPLE.owner.id, kind: "paste", shared_with_village: 0 });
      const mine = await call("GET", "/api/documents", "owner");
      expect(mine.body.mine.map((d: any) => [d.id, d.standing])).toContainEqual([docId, "private"]);
      expect(mine.body.privateNote).toBe(DOCUMENT_WORDS.private);
    });

    it("answers another member, an admin and the story pen exactly as for a document that does not exist", async () => {
      const missing = await call("GET", "/api/documents/999999", "other");
      expect(missing).toEqual({ status: 404, body: { error: DOCUMENT_WORDS.notFound } });
      for (const as of ["other", "admin", "teller"] as const) {
        expect(await call("GET", `/api/documents/${docId}`, as), as).toEqual(missing);
      }
      expect((await call("GET", `/api/documents/${docId}`, "owner")).body.body).toContain("WELLROTA-PRIVATE");
    });

    it("keeps it off every other list and out of every other member's search", async () => {
      for (const as of ["other", "admin", "teller"] as const) {
        const list = await call("GET", "/api/documents", as);
        const ids = [...list.body.mine, ...list.body.shared, ...list.body.toDecide].map((d: any) => d.id);
        expect(ids, as).not.toContain(docId);
        const found = await call("GET", "/api/documents/search?q=water%20rota", as);
        expect(found.body.hits, as).toEqual([]);
      }
      const own = await call("GET", "/api/documents/search?q=water%20rota", "owner");
      expect(own.body.hits.map((h: any) => h.documentId)).toContain(docId);
    });

    it("refuses text with a NUL in it, and a document with no title, in the form's own words", async () => {
      expect(await call("POST", "/api/documents", "owner", { kind: "paste", title: "x", body: "a\u0000b" })).toEqual({ status: 400, body: { error: DOCUMENT_WORDS.notText } });
      expect(await call("POST", "/api/documents", "owner", { kind: "paste", title: "  ", body: "words" })).toEqual({ status: 400, body: { error: DOCUMENT_WORDS.titleMissing } });
    });
  });

  describe("stored files", () => {
    const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("1 0 obj << >> endobj\n%%EOF\n")]);
    const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....word/document.xml....")]);

    it("keeps a PDF whole for its owner, serves it only to them, and never as a page", async () => {
      const up = await upload("owner", "Statutes 2026.pdf", PDF);
      expect(up.status, JSON.stringify(up.body)).toBe(201);
      expect(up.body.document).toMatchObject({ kind: "pdf", title: "Statutes 2026", standing: "private", size: PDF.length });
      const id = up.body.document.id;
      const r = await fetch(`${base}/api/documents/${id}/file`, { headers: { Authorization: "Bearer owner" } }); // module-review-ok: the test client dialling its own in-process server
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("application/pdf");
      expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="Statutes-2026.pdf"$/);
      expect(Buffer.from(await r.arrayBuffer()).equals(PDF)).toBe(true);
      const theirs = await fetch(`${base}/api/documents/${id}/file`, { headers: { Authorization: "Bearer other" } }); // module-review-ok: the test client dialling its own in-process server
      expect(theirs.status).toBe(404);
      // The bytes live in the database, never on a volume a public route serves.
      expect((await q("SELECT LENGTH(bytes) AS n FROM village_document_files WHERE document_id = ?", [id]))[0].n).toBe(PDF.length);
    });

    it("refuses a file that is not what its name says, and stores nothing", async () => {
      const before = (await q("SELECT COUNT(*) AS n FROM village_documents"))[0].n;
      expect(await upload("owner", "renamed.pdf", Buffer.from("just some text"))).toEqual({ status: 400, body: { error: DOCUMENT_WORDS.fileNotPdf } });
      expect(await upload("owner", "renamed.docx", PDF)).toEqual({ status: 400, body: { error: DOCUMENT_WORDS.fileNotDocx } });
      expect(await upload("owner", "notes.exe", PDF)).toEqual({ status: 400, body: { error: DOCUMENT_WORDS.kindUnknown } });
      expect((await q("SELECT COUNT(*) AS n FROM village_documents"))[0].n).toBe(before);
    });

    it("takes a DOCX, and reads a .md file as text", async () => {
      expect((await upload("owner", "Minutes.docx", DOCX)).body.document).toMatchObject({ kind: "docx" });
      const md = await upload("owner", "notes.md", Buffer.from("# Notes\n\nWe decide by consent."), "Our notes");
      expect(md.body.document).toMatchObject({ kind: "md", title: "Our notes" });
      const rows = await q("SELECT body FROM village_documents WHERE id = ?", [md.body.document.id]);
      expect(rows[0].body).toBe("# Notes\n\nWe decide by consent.");
    });

    it("refuses a file over the limit before storing any of it", async () => {
      const big = await upload("owner", "big.pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(8 * 1024 * 1024)]));
      expect(big).toEqual({ status: 413, body: { error: DOCUMENT_WORDS.fileTooBig } });
    });
  });

  describe("share with the village", () => {
    let docId = 0;
    it("is the owner's ask only, and files a suggestion that changes nothing yet", async () => {
      docId = await addText("owner", "How we decide", "## Decisions\n\nWe decide by consent at the circle meeting. SHARE-ASKED-TEXT");
      expect((await call("POST", `/api/documents/${docId}/share`, "other", { blockId: "power" })).status).toBe(404);
      expect((await call("POST", `/api/documents/${docId}/share`, "owner", { blockId: "vibes" })).status).toBe(400);
      const asked = await call("POST", `/api/documents/${docId}/share`, "owner", { blockId: "power", note: "Our decision notes." });
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      const p = await canvasProposalById(pool, asked.body.proposalId);
      expect(p).toMatchObject({ target: "document", blockId: "power", status: "open", proposedBy: PEOPLE.owner.id, body: "Our decision notes.", source: "member" });
      expect(p?.change).toEqual({ documentId: docId, title: "How we decide" });
      // Still private: only the adopt route shares it.
      expect((await q("SELECT shared_with_village FROM village_documents WHERE id = ?", [docId]))[0].shared_with_village).toBe(0);
      expect(asked.body.document.standing).toBe("share-asked");
      expect(await call("POST", `/api/documents/${docId}/share`, "owner", { blockId: "power" })).toMatchObject({ status: 409, body: { error: DOCUMENT_WORDS.shareOpen } });
    });

    it("lets whoever holds the story read it while the ask is open, and nobody else", async () => {
      // Before the handover the gate gives the story pen to the administrators
      // as well as to a role carrying `story.tell`, so both may adopt, and both read.
      for (const as of ["teller", "admin"] as const) {
        expect((await call("GET", `/api/documents/${docId}`, as)).body.body, as).toContain("SHARE-ASKED-TEXT");
        const list = await call("GET", "/api/documents", as);
        expect(list.body.toDecide.map((d: any) => [d.id, d.ownerName]), as).toContainEqual([docId, "Hazel"]);
      }
      expect((await call("GET", `/api/documents/${docId}`, "other")).status).toBe(404);
      expect((await call("GET", "/api/documents", "other")).body.toDecide).toEqual([]);
    });

    it("once adopted, every member reads it, and the owner's name travels only as a first name", async () => {
      expect(await markDocumentShared(pool, docId, PEOPLE.owner.id)).toBe(true);
      const read = await call("GET", `/api/documents/${docId}`, "other");
      expect(read.body.body).toContain("SHARE-ASKED-TEXT");
      expect(read.body.document).toMatchObject({ standing: "shared", ownerName: "Hazel", yours: false });
      expect(await call("POST", `/api/documents/${docId}/share`, "owner", { blockId: "power" })).toMatchObject({ status: 409, body: { error: DOCUMENT_WORDS.alreadyShared } });
    });

    it("deleting a document with an open ask withdraws the ask in the owner's name", async () => {
      const id = await addText("owner", "A second thought", "Nothing much here.");
      const asked = await call("POST", `/api/documents/${id}/share`, "owner", { blockId: "team" });
      expect((await call("DELETE", `/api/documents/${id}`, "teller")).status).toBe(403);
      expect((await call("DELETE", `/api/documents/${id}`, "owner")).body).toEqual({ deleted: id });
      expect(await q("SELECT id FROM village_documents WHERE id = ?", [id])).toHaveLength(0);
      expect(await canvasProposalById(pool, asked.body.proposalId)).toMatchObject({ status: "declined", decidedBy: PEOPLE.owner.id, outcome: { withdrawn: true } });
    });
  });

  describe("draft from this document", () => {
    let docId = 0;
    const TEXT = "# Our notes\n\n## Who decides\n\nWe decide by consent, and any member may object.\n\n## Money\n\nDues are twenty a month and the budget is read aloud each moon.";

    it("drafts per block with the splitter, and files only what was ticked, as the server drafted it, marked import", async () => {
      docId = await addText("owner", "Notes", TEXT);
      const d = await call("POST", `/api/documents/${docId}/draft`, "owner", { mode: "words" });
      expect(d.status).toBe(200);
      const blocks = d.body.draft.items.map((i: any) => i.blockId);
      expect(blocks).toEqual(expect.arrayContaining(["power", "resourcing"]));
      const filed = await call("POST", `/api/documents/${docId}/draft/file`, "owner", { blocks: ["resourcing"], body: "words I typed myself" });
      expect(filed.status, JSON.stringify(filed.body)).toBe(201);
      expect(filed.body.filed).toHaveLength(1);
      const p = await canvasProposalById(pool, filed.body.filed[0].proposalId);
      const item = d.body.draft.items.find((i: any) => i.blockId === "resourcing");
      expect(p).toMatchObject({ blockId: "resourcing", target: "words", sectionId: "economy", source: "import", body: item.body, proposedBy: PEOPLE.owner.id });
      expect(p?.body).not.toContain("words I typed myself");
    });

    it("says there is no model when no key is set, and sends nothing", async () => {
      MEMBER_KEY = null;
      const before = MODEL_CALLS.length;
      expect(await call("POST", `/api/documents/${docId}/draft`, "owner", { mode: "model" })).toEqual({ status: 409, body: { error: NO_MODEL } });
      expect(MODEL_CALLS.length).toBe(before);
    });

    it("asks the owner first, names where the text goes, and sends it only after a yes", async () => {
      MEMBER_KEY = { provider: "anthropic", key: "sk-member-test" };
      const before = MODEL_CALLS.length;
      const ask = await call("POST", `/api/documents/${docId}/draft`, "owner", { mode: "model" });
      expect(ask.status).toBe(409);
      expect(ask.body).toMatchObject({ needsConsent: true });
      expect(ask.body.disclosure).toContain("Anthropic, with your own key");
      expect(MODEL_CALLS.length).toBe(before);

      MODEL_DRAFT = { items: [{ blockId: "purpose", sectionId: "aims", body: "MODEL-DRAFTED-AIMS", why: "Drafted by the model from the document." }], gaps: [], noSection: ["conflict"] };
      const yes = await call("POST", `/api/documents/${docId}/draft`, "owner", { mode: "model", consent: true });
      expect(yes.status, JSON.stringify(yes.body)).toBe(200);
      expect(MODEL_CALLS.length).toBe(before + 1);
      expect(MODEL_CALLS[MODEL_CALLS.length - 1]).toMatchObject({ userId: PEOPLE.owner.id, text: TEXT, title: "Notes" });
      expect((await q("SELECT model_consent_to FROM village_documents WHERE id = ?", [docId]))[0].model_consent_to).toBe("Anthropic, with your own key");

      // The held draft files the MODEL's words, and only for its own maker.
      expect((await call("POST", `/api/documents/${docId}/draft/file`, "other", { blocks: ["purpose"], draftId: yes.body.draftId })).status).toBe(404);
      const filed = await call("POST", `/api/documents/${docId}/draft/file`, "owner", { blocks: ["purpose"], draftId: yes.body.draftId });
      expect((await canvasProposalById(pool, filed.body.filed[0].proposalId))?.body).toBe("MODEL-DRAFTED-AIMS");
      expect((await call("POST", `/api/documents/${docId}/draft/file`, "owner", { blocks: ["purpose"], draftId: yes.body.draftId })).status).toBe(410);
    });

    it("asks again when the key changes, because consent to one provider is not consent to another", async () => {
      MEMBER_KEY = { provider: "openai_compatible", key: "sk-other", baseUrl: "https://models.example.test/v1" };
      const again = await call("POST", `/api/documents/${docId}/draft`, "owner", { mode: "model" });
      expect(again.status).toBe(409);
      expect(again.body.disclosure).toContain("models.example.test");
    });

    it("never sends somebody else's document to a model, even a shared one", async () => {
      MEMBER_KEY = { provider: "anthropic", key: "sk-member-test" };
      await markDocumentShared(pool, docId, PEOPLE.owner.id);
      const before = MODEL_CALLS.length;
      expect(await call("POST", `/api/documents/${docId}/draft`, "other", { mode: "model", consent: true })).toEqual({ status: 403, body: { error: MODEL_OWNER_ONLY } });
      expect(MODEL_CALLS.length).toBe(before);
      // The splitter sends nothing anywhere, so any reader may use it.
      expect((await call("POST", `/api/documents/${docId}/draft`, "other", { mode: "words" })).status).toBe(200);
    });
  });

  describe("the member's own data export (GET /api/profile/export)", () => {
    it("carries every document the member added, with its text, and never another member's", async () => {
      const mine = await notebookForExport(pool, PEOPLE.owner.id);
      const titles = mine.documents.map((d) => d.title);
      expect(titles).toEqual(expect.arrayContaining(["Our well rota", "How we decide", "Statutes 2026"]));
      expect(mine.documents.find((d) => d.title === "Our well rota")?.text).toContain("WELLROTA-PRIVATE");
      expect(mine.documents.find((d) => d.title === "Statutes 2026")).toMatchObject({ kind: "pdf", text: null, fileName: "Statutes-2026.pdf" });
      expect(mine.documents.every((d) => d.id > 0)).toBe(true);
      const theirs = await notebookForExport(pool, PEOPLE.other.id);
      expect(JSON.stringify(theirs)).not.toContain("WELLROTA-PRIVATE");
    });
  });

  describe("resource picks", () => {
    it("keeps a member's own list, and the village's only under the story pen", async () => {
      expect((await call("POST", "/api/canvas/resource-picks", "owner", { resourceKey: "sociocracy-basics" })).status).toBe(201);
      expect((await call("POST", "/api/canvas/resource-picks", "owner", { resourceKey: "sociocracy-basics" })).body.added).toBe(false);
      expect(await call("POST", "/api/canvas/resource-picks", "other", { resourceKey: "nvc-intro", forVillage: true })).toEqual({ status: 403, body: { error: VILLAGE_PICK_REFUSAL } });
      expect((await q("SELECT id FROM canvas_resource_picks WHERE user_id = '' AND resource_key = 'nvc-intro'"))).toHaveLength(0);
      expect((await call("POST", "/api/canvas/resource-picks", "teller", { resourceKey: "governance-canvas", forVillage: true })).status).toBe(201);
      expect((await call("GET", "/api/canvas/resource-picks", "owner")).body).toEqual({ village: ["governance-canvas"], mine: ["sociocracy-basics"] });
      expect((await call("POST", "/api/canvas/resource-picks", "owner", { resourceKey: "has space" })).status).toBe(400);
    });
  });

  describe("the export pack", () => {
    let packFor: (as: Who) => Promise<{ status: number; body: any }>;
    beforeAll(async () => {
      packFor = (as) => call("POST", "/api/canvas/exports", as, {});
      // The brief, every way a section can be kept.
      await briefWrite(pool, { section: "aims", body: "AIMS-MEMBER-CONFIRMED", confirmedBy: PEOPLE.admin.id });
      await briefWrite(pool, { section: "decisions", body: "DECISIONS-ADMIN-SECRET", confirmedBy: PEOPLE.admin.id });
      await briefWrite(pool, { section: "economy", body: "ECONOMY-OPENED-TO-MEMBERS", audience: "member", confirmedBy: PEOPLE.admin.id });
      await briefWrite(pool, { section: "rhythm", body: "RHYTHM-OPEN-BUT-PROPOSED", audience: "member" });
      for (const s of ["people", "legal", "land", "constraints"]) {
        await briefWrite(pool, { section: s, body: `${s.toUpperCase()}-OPENED-STILL-SECRET`, audience: "member", confirmedBy: PEOPLE.admin.id });
      }
      await recordCanvasReading(pool, { blockId: "power", level: 2, sentence: "Two people decide most things. READING-SENTENCE", moment: "baseline", recordedBy: PEOPLE.teller.id });
      await addText("other", "My own notes", "OTHER-MEMBER-PRIVATE-TEXT");
      await addText("owner", "My diary", "OWNER-OWN-PRIVATE-TEXT");
    });

    it("carries what a member reads on the canvas and never a row the admins keep", async () => {
      const got = await packFor("owner");
      expect(got.status, JSON.stringify(got.body)).toBe(200);
      expect(got.body.files.map((f: any) => f.name)).toEqual(["README.md", "canvas.md", "resources.md", "our-documents.md"]);
      const all = whole(got.body.files);
      for (const kept of ["DECISIONS-ADMIN-SECRET", "RHYTHM-OPEN-BUT-PROPOSED", "PEOPLE-OPENED-STILL-SECRET", "LEGAL-OPENED-STILL-SECRET", "LAND-OPENED-STILL-SECRET", "CONSTRAINTS-OPENED-STILL-SECRET"]) {
        expect(all, kept).not.toContain(kept);
      }
      const canvas = file(got.body.files, "canvas.md");
      expect(canvas).toContain("AIMS-MEMBER-CONFIRMED");
      expect(canvas).toContain("ECONOMY-OPENED-TO-MEMBERS");
      expect(canvas).toContain("READING-SENTENCE");
    });

    it("names no person: not the recorder of a reading, not a shared document's owner", async () => {
      const all = whole((await packFor("other")).body.files);
      for (const p of Object.values(PEOPLE)) {
        for (const part of p.name.split(" ")) expect(all, p.name).not.toContain(part);
      }
      expect(all).toContain("whoever held the village's story");
    });

    it("carries the member's own private documents and never another member's", async () => {
      const mine = file((await packFor("owner")).body.files, "our-documents.md");
      expect(mine).toContain("OWNER-OWN-PRIVATE-TEXT");
      expect(mine).not.toContain("OTHER-MEMBER-PRIVATE-TEXT");
      expect(mine).toContain("SHARE-ASKED-TEXT"); // shared by the pen above
      const theirs = file((await packFor("other")).body.files, "our-documents.md");
      expect(theirs).toContain("OTHER-MEMBER-PRIVATE-TEXT");
      expect(theirs).not.toContain("OWNER-OWN-PRIVATE-TEXT");
      expect(theirs).not.toContain("WELLROTA-PRIVATE");
    });

    it("writes a README that links the database's public columns, dates the snapshot and says Google gets the content", async () => {
      const got = await packFor("owner");
      const readme = file(got.body.files, "README.md");
      expect(readme).toContain(CANVAS_DATABASE_CSV);
      expect(readme).toContain(`Exported on ${got.body.exportedAt.slice(0, 10)} (UTC)`);
      expect(readme).toContain("snapshot");
      expect(readme).toContain("Uploading these files to a Gemini notebook sends everything in them to Google.");
      expect(file(got.body.files, "resources.md")).toContain(CANVAS_DATABASE_CSV);
    });

    it("writes an audit row per export with the pack's hash and the brain's etag, and says when something changed", async () => {
      const got = await packFor("teller");
      const rows = await q(
        "SELECT kind, text, entity_type, entity_ref, audience FROM health_events WHERE actor_user_id = ? AND entity_type = 'canvas_export' ORDER BY at DESC, id DESC",
        [PEOPLE.teller.id],
      );
      expect(rows[0]).toMatchObject({ kind: "audit", text: `canvas:export:${got.body.hash}`, entity_type: "canvas_export", entity_ref: got.body.brainEtag, audience: "admin" });
      expect(got.body.brainEtag).toMatch(/^W\/"brain-\d+-\d+-\d+"$/);
      expect((await call("GET", "/api/canvas/exports/latest", "teller")).body).toMatchObject({ changedSince: false });
      await recordCanvasReading(pool, { blockId: "team", level: 3, sentence: "A newer reading.", moment: "canvas-moon", recordedBy: PEOPLE.teller.id });
      expect((await call("GET", "/api/canvas/exports/latest", "teller")).body).toMatchObject({ changedSince: true });
      expect((await call("GET", "/api/canvas/exports/latest", "admin")).body).toEqual({ lastExportAt: null, changedSince: null });
    });

    it("lists picks by key while the resources table is absent, and by name once it is there", async () => {
      const before = file((await packFor("owner")).body.files, "resources.md");
      expect(before).toContain("could not be read");
      expect(before).toContain("`governance-canvas`");
      expect(before).toContain("`sociocracy-basics`");
      // The columns the canvas-resources lane's brief names (0224), in a scratch table.
      await pool.query( // module-review-ok: a stand-in for 0224's table, in the scratch schema this suite provisioned
        "CREATE TABLE IF NOT EXISTS canvas_resources (resource_key varchar(191) PRIMARY KEY, name varchar(300), type varchar(80), url varchar(1000) NULL, withdrawn_at datetime NULL)",
      );
      await pool.query( // module-review-ok: seeding the stand-in table
        "INSERT INTO canvas_resources (resource_key, name, type, url, withdrawn_at) VALUES (?,?,?,?,NULL), (?,?,?,NULL,NOW())",
        ["governance-canvas", "Governance Canvas", "Canvas", "https://example.test/canvas", "sociocracy-basics", "Sociocracy basics", "Guide"],
      );
      const after = file((await packFor("owner")).body.files, "resources.md");
      expect(after).not.toContain("could not be read");
      expect(after).toContain("**Governance Canvas** (Canvas): https://example.test/canvas");
      expect(after).toContain("**Sociocracy basics** (Guide): withdrawn from the database");
    });
  });
});
