/**
 * A MEMBER'S OWN NOTEBOOK, THE RESOURCE PICKS, AND "TAKE THE CANVAS WITH
 * YOU" (plan 5.5 and 5.6; Wave 4, 2026-09-28; migration 0226).
 *
 *   GET    /api/documents                     mine, the village's shared ones, and any waiting on my pen
 *   POST   /api/documents                     add a text document (pasted, or a .md or .txt read as text)
 *   POST   /api/documents/file                add a file (multipart: `file`, `title`): PDF, DOCX, .md, .txt
 *   GET    /api/documents/search?q=           the documents I may read, ranked by the guide's BM25
 *   GET    /api/documents/:id                 one document, if I may read it
 *   GET    /api/documents/:id/file            a stored PDF or DOCX, if I may read it
 *   DELETE /api/documents/:id                 my own document, and nobody else's
 *   POST   /api/documents/:id/share           "Share with the village": a canvas suggestion the prose pen adopts
 *   POST   /api/documents/:id/draft           "Draft from this document": the splitter, or a model with consent
 *   POST   /api/documents/:id/draft/file      file chosen drafts as canvas suggestions, source `import`
 *   GET    /api/canvas/resource-picks         the village's picks and mine
 *   POST   /api/canvas/resource-picks         keep a resource (mine, or the village's under the pen)
 *   DELETE /api/canvas/resource-picks/:key    let one go (`?village=1` for the village's)
 *   POST   /api/canvas/exports                the four files of the pack, and an audit row
 *   GET    /api/canvas/exports/latest         my last export, and whether anything changed since
 *
 * The request and response shapes are in docs/canvas-api.md, which changes
 * with this file.
 *
 * ── WHO GETS IN ────────────────────────────────────────────────────────────
 *
 * The village's admitted members and its admins (`mayReadCanvas`, the canvas's
 * own door): a visitor with no session gets 401, and an account the village
 * has not admitted gets 403 and `CANVAS_MEMBERS_ONLY`. Core, like the canvas:
 * no module switch stands in front of it.
 *
 * ── PRIVATE BY DEFAULT ─────────────────────────────────────────────────────
 *
 * Who reads a document is decided in ONE function, `mayReadDocument`
 * (server/lib/villageDocuments.ts): its owner; every member once the village
 * adopted it; and, while its owner's share is waiting, whoever holds the
 * village's story, so the pen reads what it decides on (before the handover
 * the gate gives that pen to the administrators as well). Being an
 * administrator is not on that list. A document a person may not read answers 404, the same
 * as one that does not exist, so a number cannot be probed for.
 *
 * "Share with the village" is the OWNER'S act and the PEN'S decision: this
 * route files the suggestion only for the document's owner, and only the
 * adopt route (server/routes/canvasFrames.ts) shares it. The generic
 * suggestion door refuses the `document` target outright.
 *
 * ── A DRAFT IS A SUGGESTION ────────────────────────────────────────────────
 *
 * "Draft from this document" writes nothing until the member files what they
 * chose, and filing writes canvas suggestions with source `import` that the
 * village's pen adopts or declines like any other. The words filed are the
 * server's own: the splitter is run again on the stored text, and a model's
 * draft is held here, keyed to the member and the document, from the moment
 * it is made until it is filed or an hour passes. So a member cannot file
 * words of their own under the `import` label, which the generic door keeps
 * for administrators.
 *
 * A model sees a document only when (1) a key exists, (2) the document is the
 * asker's own, and (3) its owner said yes to the one-line disclosure naming the
 * provider and whose key pays, as it reads TODAY (`modelRoute`). Consent given
 * to one provider or operator is not consent to another, so a changed key asks
 * again.
 *
 * ── THE EXPORT ─────────────────────────────────────────────────────────────
 *
 * Built by server/lib/notebookExport.ts, which reads the brief through
 * `memberCanvasAnswers` alone. Every export writes an audit row through
 * `recordEvent` carrying the pack's content hash and the brain's etag, which
 * is how `GET /api/canvas/exports/latest` can say whether anything changed.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import type { AppDeps } from "../lib/appDeps";
import { capabilityDecision } from "../../shared/capabilities";
import { CANVAS_BLOCKS, isCanvasBlockId, type CanvasBlockId } from "../../shared/governanceCanvas";
import { servesPurposeProblem, servesPurposeScoped } from "../../shared/canvasFrames";
import { draftFromText, type DocumentDraft } from "../../shared/documentDraft";
import {
  DOCUMENT_FILE_MAX_BYTES,
  DOCUMENT_WORDS,
  DOCUMENTS_PER_MEMBER,
  cleanTitle,
  isTextKind,
  kindFromFileName,
  parseTextDocument,
  titleProblem,
} from "../../shared/villageDocuments";
import { hasGoverningPurpose } from "../../shared/governingPurpose";
import { governingPurpose } from "../lib/governingPurpose";
import { recordEvent } from "../lib/events";
import { brainEtag } from "../lib/villageBrain";
import { resolveMemberKey } from "../lib/memberSecrets";
import type { MemberKey } from "../lib/assistant";
import { draftWithModel, type ModelDraftInput, type ModelDraftOutcome } from "../lib/documentDraftModel";
import { mayReadDocument, modelRoute, searchDocuments, storedFileProblem, STORED_MIME, summaryOf, type DocumentViewer } from "../lib/villageDocuments";
import { gatherPackInput, packHash, renderPack } from "../lib/notebookExport";
import {
  addResourcePick,
  countDocumentsOwnedBy,
  deleteOwnDocument,
  documentById,
  documentFile,
  documentsByIds,
  documentsOwnedBy,
  EXPORT_ENTITY,
  insertStoredDocument,
  insertTextDocument,
  lastExportBy,
  recordModelConsent,
  removeResourcePick,
  resourcePicksFor,
  sharedDocuments,
  textDocumentsReadableBy,
  VILLAGE_PICK,
  type DocumentRow,
} from "../repos/villageDocuments";
import { decideCanvasProposal, insertCanvasProposal, openDocumentShares, openProposalCountBy } from "../repos/canvasProposals";
import { CANVAS_MEMBERS_ONLY, mayReadCanvas } from "./canvas";
import { OPEN_PROPOSALS_PER_MEMBER } from "./canvasFrames";

export interface DocumentRouteDeps
  extends Pick<
    AppDeps,
    "authedUser" | "isAdmin" | "hasMembership" | "guardCapability" | "capabilityCtx" | "getPool" | "firstName" | "overLimit" | "clientIp"
  > {
  /** The village's name, for the pack's headings. */
  villageName(): string;
  /** The model call. Tests hand a stand-in; the server uses the real one. */
  draftModel?: (input: ModelDraftInput) => Promise<ModelDraftOutcome>;
  /** The member's own model key. Tests hand a stand-in; the server reads the sealed store. */
  memberKey?: (userId: string) => Promise<MemberKey | null>;
}

/** Said to a member who asks to keep the village's own picks without the pen. */
export const VILLAGE_PICK_REFUSAL =
  "The village's own picks are kept by whoever holds the village's story. You can keep a list of your own.";

/** Said when a model draft is asked of somebody else's document. */
export const MODEL_OWNER_ONLY = "Only the member who added a document can send it to a model. The words-only draft works on any document you can read.";

/** Said when no key is there to use. */
export const NO_MODEL = "No model is connected here, so the words-only draft is the one there is. It sends nothing anywhere.";

/** A draft held for filing expires after this long. */
export const HELD_DRAFT_MS = 60 * 60 * 1000;

/** How many resources one list may keep. */
export const PICKS_PER_LIST = 200;

/** A resource key: printable, no spaces, the width of the column. */
const RESOURCE_KEY = /^[\x21-\x7e]{1,191}$/;

/** The filename a download is offered under: ASCII letters, digits, dots, dashes and underscores. */
export function safeDownloadName(name: string, fallback: string): string {
  const s = String(name ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return s && s !== "." && s !== ".." ? s : fallback;
}

export function register(app: Express, deps: DocumentRouteDeps): void {
  const { authedUser, capabilityCtx, getPool, firstName, guardCapability, overLimit, clientIp } = deps;
  const draftModel = deps.draftModel ?? draftWithModel;
  const memberKeyFor = deps.memberKey ?? ((userId: string) => resolveMemberKey(getPool(), userId));

  /** A model's draft, held until it is filed or an hour passes. Keyed by its id. */
  const held = new Map<string, { userId: string; documentId: number; draft: DocumentDraft; expires: number }>();
  const sweep = () => {
    const now = Date.now();
    held.forEach((v, k) => {
      if (v.expires < now) held.delete(k);
    });
    // A bound on memory, whatever the traffic: the oldest go first.
    while (held.size > 500) held.delete(held.keys().next().value as string);
  };

  /** Signed in and in the village, or the answer that says why not. Null means the answer was sent. */
  const member = async (req: Request, res: Response): Promise<any | null> => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    if (!(await mayReadCanvas(deps, req, user))) {
      res.status(403).json({ error: CANVAS_MEMBERS_ONLY });
      return null;
    }
    return user;
  };

  const viewerOf = async (user: any): Promise<DocumentViewer> => ({
    id: String(user.id),
    holdsStoryPen: capabilityDecision("story.tell", await capabilityCtx(user)).allowed,
  });

  /** The document in the path, if this viewer may read it, or the 404 that says nothing more. */
  const readable = async (req: Request, res: Response, user: any): Promise<{ doc: DocumentRow; shares: Map<number, number>; viewer: DocumentViewer } | null> => {
    const id = Number(req.params.id);
    const doc = Number.isInteger(id) && id > 0 ? await documentById(getPool(), id) : null;
    const shares = await openDocumentShares(getPool());
    const viewer = await viewerOf(user);
    if (!doc || !mayReadDocument(doc, viewer, shares)) {
      res.status(404).json({ error: DOCUMENT_WORDS.notFound });
      return null;
    }
    return { doc, shares, viewer };
  };

  const summary = (doc: DocumentRow, userId: string, shares: Map<number, number>) => summaryOf(doc, userId, shares, firstName);

  // ── GET /api/documents ──────────────────────────────────────────────────
  app.get("/api/documents", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const pool = getPool();
    const me = String(user.id);
    const [shares, viewer, mine, shared] = await Promise.all([openDocumentShares(pool), viewerOf(user), documentsOwnedBy(pool, me), sharedDocuments(pool)]);
    // The documents whose owners asked to share them, for whoever decides.
    const waiting = viewer.holdsStoryPen
      ? (await documentsByIds(pool, Array.from(shares.keys()))).filter((d) => !d.shared && d.ownerId !== me)
      : [];
    res.json({
      mine: mine.map((d) => summary(d, me, shares)),
      shared: shared.map((d) => summary(d, me, shares)),
      toDecide: waiting.map((d) => ({ ...summary(d, me, shares), proposalId: shares.get(d.id) ?? null })),
      privateNote: DOCUMENT_WORDS.private,
      limits: { perMember: DOCUMENTS_PER_MEMBER, fileBytes: DOCUMENT_FILE_MAX_BYTES },
    });
  });

  /** Whether this member may add one more document, or the refusal. */
  const roomFor = async (res: Response, userId: string): Promise<boolean> => {
    if ((await countDocumentsOwnedBy(getPool(), userId)) >= DOCUMENTS_PER_MEMBER) {
      res.status(409).json({ error: DOCUMENT_WORDS.tooMany });
      return false;
    }
    return true;
  };

  const created = async (res: Response, userId: string, id: number) => {
    const pool = getPool();
    const [doc, shares] = await Promise.all([documentById(pool, id), openDocumentShares(pool)]);
    if (!doc) return res.status(500).json({ error: "The document was saved and could not be read back." });
    return res.status(201).json({ document: summary(doc, userId, shares) });
  };

  // ── POST /api/documents ─────────────────────────────────────────────────
  app.post("/api/documents", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const me = String(user.id);
    if (await overLimit(`documents-add:${me}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "That is a lot of documents in an hour. Try again in a little while." });
    }
    const parsed = parseTextDocument(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    if (!(await roomFor(res, me))) return;
    const id = await insertTextDocument(getPool(), me, parsed.doc);
    return created(res, me, id);
  });

  // ── POST /api/documents/file ────────────────────────────────────────────
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: DOCUMENT_FILE_MAX_BYTES, files: 1, fields: 4 } });
  app.post("/api/documents/file", async (req, res) => {
    // Who is asking is settled BEFORE a byte of the file is read.
    const user = await member(req, res);
    if (!user) return;
    const me = String(user.id);
    if (await overLimit(`documents-add:${me}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "That is a lot of documents in an hour. Try again in a little while." });
    }
    upload.single("file")(req, res, async (err: any) => {
      if (err) {
        const tooBig = err?.code === "LIMIT_FILE_SIZE";
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? DOCUMENT_WORDS.fileTooBig : "That file could not be read." });
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) return res.status(400).json({ error: "Pick a file to add." });
      const kind = kindFromFileName(file.originalname);
      if (!kind) return res.status(400).json({ error: DOCUMENT_WORDS.kindUnknown });
      const fromName = cleanTitle(file.originalname.replace(/\.[^.]+$/, ""));
      const title = cleanTitle((req.body as Record<string, unknown> | undefined)?.title) || fromName;
      if (!(await roomFor(res, me))) return;
      if (isTextKind(kind)) {
        // A .md or .txt is text: it is read as UTF-8 and held to the same rules as pasted text.
        const parsed = parseTextDocument({ kind, title, body: file.buffer.toString("utf8") });
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        return created(res, me, await insertTextDocument(getPool(), me, parsed.doc));
      }
      const tp = titleProblem(title);
      if (tp) return res.status(400).json({ error: tp });
      const problem = storedFileProblem(kind, file.buffer);
      if (problem) return res.status(400).json({ error: problem });
      const id = await insertStoredDocument(getPool(), me, {
        title,
        kind,
        fileName: safeDownloadName(file.originalname, `document.${kind}`),
        mime: STORED_MIME[kind],
        bytes: file.buffer,
      });
      return created(res, me, id);
    });
  });

  // ── GET /api/documents/search ───────────────────────────────────────────
  app.get("/api/documents/search", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const q = String(req.query.q ?? "").slice(0, 500);
    if (!q.trim()) return res.json({ hits: [] });
    const docs = await textDocumentsReadableBy(getPool(), String(user.id));
    res.json({ hits: searchDocuments(docs, q, 5) });
  });

  // ── GET /api/documents/:id ──────────────────────────────────────────────
  app.get("/api/documents/:id", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const found = await readable(req, res, user);
    if (!found) return;
    const { doc, shares } = found;
    const me = String(user.id);
    const yours = doc.ownerId === me;
    // Where a model draft would send it, said only to its owner, who is the only one who can send it.
    let model: { available: boolean; sentence: string | null; consented: boolean } | null = null;
    if (yours && isTextKind(doc.kind)) {
      const route = modelRoute(await memberKeyFor(me));
      model = { available: route.available, sentence: route.sentence, consented: route.available && doc.modelConsentTo === route.to };
    }
    const hasStatement = hasGoverningPurpose(await governingPurpose(getPool()));
    res.json({
      document: summary(doc, me, shares),
      body: isTextKind(doc.kind) ? doc.body : null,
      fileName: isTextKind(doc.kind) ? null : doc.fileName,
      shareProposalId: shares.get(doc.id) ?? null,
      model,
      purposeWritten: hasStatement,
    });
  });

  // ── GET /api/documents/:id/file ─────────────────────────────────────────
  app.get("/api/documents/:id/file", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const found = await readable(req, res, user);
    if (!found) return;
    const { doc } = found;
    if (isTextKind(doc.kind)) return res.status(404).json({ error: "This document is text. Read it on the page." });
    const file = await documentFile(getPool(), doc.id);
    if (!file) return res.status(404).json({ error: DOCUMENT_WORDS.notFound });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${safeDownloadName(doc.fileName ?? "", `document.${doc.kind}`)}"`);
    res.type(file.mime).send(file.bytes);
  });

  // ── DELETE /api/documents/:id ───────────────────────────────────────────
  app.delete("/api/documents/:id", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const found = await readable(req, res, user);
    if (!found) return;
    const { doc, shares } = found;
    const me = String(user.id);
    if (doc.ownerId !== me) return res.status(403).json({ error: DOCUMENT_WORDS.notYours });
    const pool = getPool();
    if (!(await deleteOwnDocument(pool, doc.id, me))) return res.status(404).json({ error: DOCUMENT_WORDS.notFound });
    // A share still waiting on the pen has nothing left to share: it is
    // withdrawn in the owner's name, as if they had pressed Withdraw.
    const waiting = shares.get(doc.id);
    if (waiting) {
      await decideCanvasProposal(pool, {
        id: waiting, status: "declined", decidedBy: me, note: "Withdrawn: its owner deleted the document.", outcome: { withdrawn: true },
      });
    }
    res.json({ deleted: doc.id });
  });

  // ── POST /api/documents/:id/share ───────────────────────────────────────
  app.post("/api/documents/:id/share", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const found = await readable(req, res, user);
    if (!found) return;
    const { doc, shares } = found;
    const me = String(user.id);
    if (doc.ownerId !== me) return res.status(403).json({ error: DOCUMENT_WORDS.notYours });
    if (doc.shared) return res.status(409).json({ error: DOCUMENT_WORDS.alreadyShared });
    if (shares.has(doc.id)) return res.status(409).json({ error: DOCUMENT_WORDS.shareOpen, proposalId: shares.get(doc.id) });
    const blockId = req.body?.blockId;
    if (!isCanvasBlockId(blockId)) return res.status(400).json({ error: "Say which block of the canvas this document speaks to." });
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (note.length > 2000) return res.status(400).json({ error: "Keep the note to 2000 characters." });
    const pool = getPool();
    if ((await openProposalCountBy(pool, me)) >= OPEN_PROPOSALS_PER_MEMBER) {
      return res.status(429).json({ error: `You have ${OPEN_PROPOSALS_PER_MEMBER} suggestions open already. Once some are adopted or declined you can add more.` });
    }
    const proposalId = await insertCanvasProposal(pool, {
      blockId,
      target: "document",
      sectionId: null,
      door: null,
      change: { documentId: doc.id, title: doc.title },
      body: note || `"${doc.title}", offered to the village's notebook.`,
      source: "member",
      proposedBy: me,
      servesPurpose: null,
    });
    await recordEvent(pool, {
      kind: "audit", text: `canvas:share-asked:${proposalId}`, actorUserId: me,
      entityType: "canvas_proposal", entityRef: String(proposalId), audience: "admin",
    });
    const after = await openDocumentShares(pool);
    res.status(201).json({
      proposalId,
      document: summary(doc, me, after),
      message: `Asked. The suggestion is on the ${CANVAS_BLOCKS[blockId].name} block's Adopt frame, and whoever holds the village's story decides it.`,
    });
  });

  // ── POST /api/documents/:id/draft ───────────────────────────────────────
  app.post("/api/documents/:id/draft", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const found = await readable(req, res, user);
    if (!found) return;
    const { doc } = found;
    if (!isTextKind(doc.kind) || doc.body === null) return res.status(400).json({ error: DOCUMENT_WORDS.storedNoText });
    const pool = getPool();
    const purposeWritten = hasGoverningPurpose(await governingPurpose(pool));
    const mode = req.body?.mode === "model" ? "model" : "words";
    if (mode === "words") return res.json({ mode, read: true, draft: draftFromText(doc.body), draftId: null, purposeWritten });

    const me = String(user.id);
    if (doc.ownerId !== me) return res.status(403).json({ error: MODEL_OWNER_ONLY });
    const memberKey = await memberKeyFor(me);
    const route = modelRoute(memberKey);
    if (!route.available || !route.to) return res.status(409).json({ error: NO_MODEL });
    if (req.body?.consent === true) {
      await recordModelConsent(pool, doc.id, me, route.to);
      await recordEvent(pool, {
        kind: "audit", text: `documents:model-consent:${doc.id}`, actorUserId: me,
        entityType: "village_document", entityRef: String(doc.id), audience: "admin",
      });
    } else if (doc.modelConsentTo !== route.to) {
      return res.status(409).json({ error: "Say yes to where the text goes first.", needsConsent: true, disclosure: route.sentence });
    }
    const outcome = await draftModel({ pool, userId: me, clientIp: clientIp(req), title: doc.title, text: doc.body, memberKey });
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    sweep();
    const draftId = randomUUID();
    held.set(draftId, { userId: me, documentId: doc.id, draft: outcome.result.draft, expires: Date.now() + HELD_DRAFT_MS });
    res.json({ mode, read: outcome.result.read, draft: outcome.result.draft, draftId, purposeWritten });
  });

  // ── POST /api/documents/:id/draft/file ──────────────────────────────────
  app.post("/api/documents/:id/draft/file", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const found = await readable(req, res, user);
    if (!found) return;
    const { doc } = found;
    if (!isTextKind(doc.kind) || doc.body === null) return res.status(400).json({ error: DOCUMENT_WORDS.storedNoText });
    const me = String(user.id);
    const blocks: unknown[] = Array.isArray(req.body?.blocks) ? req.body.blocks : [];
    const chosen = Array.from(new Set(blocks.filter(isCanvasBlockId))) as CanvasBlockId[];
    if (!chosen.length) return res.status(400).json({ error: "Choose at least one block to file a suggestion for." });
    let draft: DocumentDraft;
    const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : "";
    if (draftId) {
      sweep();
      const h = held.get(draftId);
      if (!h || h.userId !== me || h.documentId !== doc.id) {
        return res.status(410).json({ error: "That draft has expired or is not yours. Draft it again." });
      }
      draft = h.draft;
    } else {
      draft = draftFromText(doc.body);
    }
    const pool = getPool();
    const purposeWritten = hasGoverningPurpose(await governingPurpose(pool));
    const lines = (req.body?.servesPurpose ?? {}) as Record<string, unknown>;
    const filed: Array<{ blockId: CanvasBlockId; proposalId: number }> = [];
    const refused: Array<{ blockId: CanvasBlockId; error: string }> = [];
    let open = await openProposalCountBy(pool, me);
    for (const blockId of chosen) {
      const item = draft.items.find((i) => i.blockId === blockId);
      if (!item) {
        refused.push({ blockId, error: `Nothing was drafted for ${CANVAS_BLOCKS[blockId].name}.` });
        continue;
      }
      const scoped = servesPurposeScoped(blockId, "words");
      const raw = lines[blockId];
      const problem = servesPurposeProblem(scoped, scoped ? raw : undefined, purposeWritten);
      if (problem) {
        refused.push({ blockId, error: problem });
        continue;
      }
      if (open >= OPEN_PROPOSALS_PER_MEMBER) {
        refused.push({ blockId, error: `You have ${OPEN_PROPOSALS_PER_MEMBER} suggestions open already.` });
        continue;
      }
      const line = scoped && typeof raw === "string" ? raw.trim() : "";
      const proposalId = await insertCanvasProposal(pool, {
        blockId,
        target: "words",
        sectionId: item.sectionId,
        door: null,
        change: null,
        body: item.body,
        source: "import",
        proposedBy: me,
        servesPurpose: line || null,
      });
      open += 1;
      filed.push({ blockId, proposalId });
    }
    if (draftId && filed.length) held.delete(draftId);
    if (filed.length) {
      await recordEvent(pool, {
        kind: "audit", text: `canvas:import:${doc.id}:${filed.map((f) => f.proposalId).join(",")}`, actorUserId: me,
        entityType: "village_document", entityRef: String(doc.id), audience: "admin",
      });
    }
    res.status(filed.length ? 201 : 400).json({ filed, refused });
  });

  // ── Resource picks ──────────────────────────────────────────────────────
  app.get("/api/canvas/resource-picks", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const pool = getPool();
    const [village, mine] = await Promise.all([resourcePicksFor(pool, VILLAGE_PICK), resourcePicksFor(pool, String(user.id))]);
    res.json({ village, mine });
  });

  /** Whose list a pick request is about, after the pen is asked for the village's. Null means answered. */
  const pickList = async (req: Request, res: Response, user: any, forVillage: boolean): Promise<string | null> => {
    if (!forVillage) return String(user.id);
    if (!(await guardCapability(req, res, "story.tell", { status: 403, body: { error: VILLAGE_PICK_REFUSAL } }))) return null;
    return VILLAGE_PICK;
  };

  app.post("/api/canvas/resource-picks", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const key = typeof req.body?.resourceKey === "string" ? req.body.resourceKey.trim() : "";
    if (!RESOURCE_KEY.test(key)) return res.status(400).json({ error: "That is not a resource from the canvas resources." });
    const list = await pickList(req, res, user, req.body?.forVillage === true);
    if (list === null) return;
    const pool = getPool();
    if ((await resourcePicksFor(pool, list)).length >= PICKS_PER_LIST) {
      return res.status(409).json({ error: `A list keeps up to ${PICKS_PER_LIST} resources. Let one go to keep another.` });
    }
    const added = await addResourcePick(pool, list, key);
    res.status(added ? 201 : 200).json({ picked: key, forVillage: list === VILLAGE_PICK, added });
  });

  app.delete("/api/canvas/resource-picks/:key", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const key = String(req.params.key ?? "");
    if (!RESOURCE_KEY.test(key)) return res.status(400).json({ error: "That is not a resource from the canvas resources." });
    const list = await pickList(req, res, user, req.query.village === "1");
    if (list === null) return;
    const removed = await removeResourcePick(getPool(), list, key);
    res.status(removed ? 200 : 404).json({ removed, forVillage: list === VILLAGE_PICK });
  });

  // ── The export pack ─────────────────────────────────────────────────────
  app.post("/api/canvas/exports", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const me = String(user.id);
    if (await overLimit(`canvas-export:${me}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "That is a lot of exports in an hour. The last one you saved is still good." });
    }
    const pool = getPool();
    const input = await gatherPackInput(pool, me, deps.villageName());
    const exportedAt = new Date();
    const hash = packHash(input);
    const etag = await brainEtag(pool);
    // Awaited, so the answer is sent after the record exists (`recordEvent` never throws).
    await recordEvent(pool, {
      kind: "audit", text: `canvas:export:${hash}`, actorUserId: me,
      entityType: EXPORT_ENTITY, entityRef: etag.slice(0, 120), audience: "admin",
    });
    res.json({ files: renderPack(input, exportedAt), exportedAt: exportedAt.toISOString(), hash, brainEtag: etag });
  });

  app.get("/api/canvas/exports/latest", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const me = String(user.id);
    const pool = getPool();
    const last = await lastExportBy(pool, me);
    if (!last) return res.json({ lastExportAt: null, changedSince: null });
    const now = packHash(await gatherPackInput(pool, me, deps.villageName()));
    res.json({ lastExportAt: last.at, changedSince: last.hash ? last.hash !== now : true });
  });
}
