/**
 * PROPOSED CHANGES, over HTTP (the lead, 11 Nov 2026; shared/proposedChanges.ts).
 *
 * Proposing (the connector's `propose_changes`, as the token's holder, or a person):
 *   POST /api/admin/proposals            one change or a batch; refused whole, with a reason per item, when any is broken
 *   GET  /api/admin/proposals/lessons    what people changed before accepting, grouped by kind and field
 *
 * Reviewing (a person, on /admin/proposals):
 *   GET  /api/admin/proposals            everything waiting, by batch, each beside what is live now
 *   GET  /api/admin/proposals/count      how many wait, for Admin's link
 *   PUT  /api/admin/proposals/:id/draft  the person's edits, saved as they type
 *   POST /api/admin/proposals/check      the dry run: each edited change read by its own validator, nothing written
 *   POST /api/admin/proposals/accept     accept a selection, in order, each through its own route AS THE PERSON
 *   POST /api/admin/proposals/discard    put a selection aside
 *
 * ACCEPTING IS A PERSON'S ACT. Each change runs over the loopback with the
 * accepting person's own authorization, so the one capability gate and the
 * route's own validator answer for them, exactly as the app's own editor
 * would. One that fails does not undo the others: each lands or fails on its
 * own and the answer says which. An agent account, or any call that came
 * through the connector, is refused at accept and discard, and
 * `ALWAYS_A_PERSON` (shared/agentAdmin.ts) keeps these paths off the agent
 * paths list whatever an admin writes there.
 *
 * WHO OPENS THE PAGE. An admin, or a live holder of a power these changes need
 * (story.tell, org.decide, org.seat, dial.set), the way the approval inbox
 * reads. The route behind each change still decides whether this person may
 * make it.
 */
import type express from "express";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { isAgentAccount } from "../repos/agentAccounts";
import { applyProposal, checkProposal, labelsFor, liveOf, routeExistsIn, type KindDeps, type Run } from "../lib/proposedChanges";
import * as store from "../repos/proposedChanges";
import {
  ACCEPT_NOTE,
  fieldDiffs,
  groupLessons,
  PROPOSAL_LIMITS,
  readProposalInput,
  REVIEW_WORDS,
  type Lesson,
  type ProposalInput,
} from "../../shared/proposedChanges";
import { APPROVAL_FIELDS } from "../../shared/agentAdmin";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "isAdmin" | "overLimit" | "members" | "contentRepo" | "faqsRepo" | "seasonState"> & {
  liveHoldersOf: (capability: string) => Promise<string[]>;
  port: () => number;
  clientIp: (req: express.Request) => string;
};

/** The powers whose holders open the page besides an admin. */
const READERS = ["story.tell", "org.decide", "org.seat", "dial.set"] as const;
const WINDOW = 10 * 60_000;
const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "Someone";
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const withoutApproval = (b: Record<string, unknown>) => Object.fromEntries(Object.entries(b).filter(([k]) => !(APPROVAL_FIELDS as readonly string[]).includes(k)));

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, isAdmin, overLimit, members, liveHoldersOf, port, clientIp } = deps;
  const routeExists = routeExistsIn(app);
  const kindDeps = (): KindDeps => ({
    pool: getPool(),
    content: () => (deps.contentRepo.get() ?? {}) as Record<string, unknown>,
    faqs: () => (deps.faqsRepo.get() ?? {}) as unknown as ReturnType<KindDeps["faqs"]>,
    seasons: () => (deps.seasonState().seasons ?? []) as ReturnType<KindDeps["seasons"]>,
    routeExists,
  });

  /** The signed-in member who may open the page, or null after answering. */
  async function reader(req: express.Request, res: express.Response): Promise<any | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in first." });
      return null;
    }
    if (await isAdmin(req)) return user;
    const uid = String(user.id);
    for (const cap of READERS) if ((await liveHoldersOf(cap)).includes(uid)) return user;
    res.status(403).json({ error: "not_a_reader", message: REVIEW_WORDS.notReader });
    return null;
  }

  /** A reader who is a person and did not come through the connector, or null after answering 403. */
  async function person(req: express.Request, res: express.Response): Promise<any | null> {
    if (req.get("x-village-connector")) {
      res.status(403).json({ error: "person_only", message: REVIEW_WORDS.personOnly });
      return null;
    }
    const user = await reader(req, res);
    if (!user) return null;
    if (await isAgentAccount(getPool(), String(user.id))) {
      res.status(403).json({ error: "person_only", message: REVIEW_WORDS.personOnly });
      return null;
    }
    return user;
  }

  /** Run a route as the person in this request, over the loopback, and read its JSON. */
  const runAs = (req: express.Request): Run => async (method, path, body) => {
    if (!path.startsWith("/api/") || path.startsWith("/api/agent/")) return { status: 400, body: { error: "not a route a proposal may call" } };
    const r = await fetch(`http://127.0.0.1:${port()}${path}`, { // module-review-ok: the loopback to this same process, run as the person who pressed Accept, never an outside host
      method,
      headers: {
        authorization: String(req.headers.authorization ?? ""),
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(clientIp(req) ? { "x-forwarded-for": clientIp(req) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await r.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: "The route did not answer with JSON." };
    }
    return { status: r.status, body: parsed };
  };

  // ── Proposing ──────────────────────────────────────────────────────────────

  app.post("/api/admin/proposals", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    const uid = String(user.id);
    if (await overLimit(`proposals-file:${uid}`, 60, WINDOW)) return res.status(429).json({ error: "too_many", message: "That is a lot of proposals in a few minutes. Wait a little." });
    const raw = obj(req.body) ?? {};
    const list: unknown[] = Array.isArray(raw.items) ? raw.items : [raw];
    if (!list.length) return res.status(400).json({ error: "refused", message: "Send items: a list of proposals, or one proposal." });
    if (list.length > PROPOSAL_LIMITS.items) return res.status(400).json({ error: "refused", message: `A batch holds ${PROPOSAL_LIMITS.items} proposals at most.` });
    const pool = getPool();
    const batchArg = raw.batch;
    const batchId = typeof raw.batchId === "string" ? raw.batchId : null;
    const title = (typeof batchArg === "string" ? batchArg : typeof obj(batchArg)?.title === "string" ? String(obj(batchArg)!.title) : "").replace(/\s+/g, " ").trim();
    if (!batchId && title.length < 2) return res.status(400).json({ error: "refused", message: "Name the batch: batch, a short title such as Phase A content." });
    if (title.length > PROPOSAL_LIMITS.title) return res.status(400).json({ error: "refused", message: `Keep the batch title under ${PROPOSAL_LIMITS.title} characters.` });
    if (batchId && !(await store.batchById(pool, batchId))) return res.status(404).json({ error: "not_found", message: "There is no batch by that id." });

    // Every item is read and checked before any is filed: a batch is filed whole or not at all.
    const kd = kindDeps();
    const ready: Array<{ p: ProposalInput; label: string; method: string; path: string }> = [];
    const refused: Array<{ index: number; error: string; field?: string; code?: string }> = [];
    for (let i = 0; i < list.length; i++) {
      const read = readProposalInput(list[i]);
      if (!read.ok) {
        refused.push({ index: i, error: read.error });
        continue;
      }
      const p = { ...read.value, body: withoutApproval(read.value.body) };
      const checked = await checkProposal(kd, p);
      if (!checked.ok) refused.push({ index: i, error: checked.error, ...(checked.field ? { field: checked.field } : {}), ...(checked.code ? { code: checked.code } : {}) });
      else ready.push({ p, label: checked.label, method: checked.method, path: checked.path });
    }
    if (refused.length) {
      return res.status(400).json({ error: "refused", message: `Nothing was filed. ${refused.length} of ${list.length} cannot be proposed as sent.`, refused });
    }
    const kind = (await isAgentAccount(pool, uid)) || req.get("x-village-connector") ? "agent" : "person";
    const bid = batchId ?? (await store.addBatch(pool, { title, proposedBy: uid, proposedByKind: kind }));
    let position = await store.nextPosition(pool, bid);
    const ids: string[] = [];
    for (const r of ready) {
      ids.push(
        await store.addChange(pool, {
          batchId: bid, position: position++, kind: r.p.kind, target: r.p.target, targetLabel: r.label, routeMethod: r.method, routePath: r.path,
          summary: r.p.summary, body: r.p.body, proposedBy: uid, proposedByKind: kind,
        }),
      );
    }
    await recordEvent(pool, {
      kind: "proposed_change",
      text: `${ids.length} change${ids.length === 1 ? "" : "s"} proposed for review${title ? `: ${title.slice(0, 120)}` : ""}`,
      actorUserId: uid,
      actorKind: kind === "agent" ? "agent" : "human",
      entityType: "proposed_change_batch",
      entityRef: bid,
      audience: "admin",
    });
    res.json({ success: true, batchId: bid, ids, applied: false, reviewAt: "/admin/proposals", message: REVIEW_WORDS.nothingLive });
  });

  app.get("/api/admin/proposals/lessons", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    const kind = typeof req.query.kind === "string" ? req.query.kind : null;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 100) || 100));
    const lessons: Lesson[] = [];
    for (const c of await store.listDecided(getPool(), 200, true)) {
      if (kind && c.kind !== kind) continue;
      for (const l of (c.lessons ?? []) as Array<{ field: string; proposed: unknown; accepted: unknown }>) {
        lessons.push({ proposalId: c.id, kind: c.kind, target: c.targetLabel, summary: c.summary, field: l.field, proposed: l.proposed, accepted: l.accepted, acceptedAt: c.decidedAt ?? "" });
      }
    }
    const recent = lessons.slice(0, limit);
    res.set("Cache-Control", "no-store").json({
      note: "Each entry is a field a person changed before accepting a proposal: what was proposed and what they accepted. Read these before drafting the next proposal of the same kind.",
      count: recent.length,
      groups: groupLessons(recent),
    });
  });

  // ── Reviewing ──────────────────────────────────────────────────────────────

  app.get("/api/admin/proposals/count", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    res.set("Cache-Control", "no-store").json({ open: await store.openCount(getPool()) });
  });

  app.get("/api/admin/proposals", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    const pool = getPool();
    const kd = kindDeps();
    const run = runAs(req);
    const { batches, changes } = await store.listOpen(pool);
    const decided = await store.listDecided(pool, 20);
    const names = new Map<string, string>();
    for (const id of Array.from(new Set([...changes, ...decided].flatMap((c) => [c.proposedBy, c.decidedBy ?? ""]).filter(Boolean)))) {
      names.set(id, firstName((await members.byId(id))?.name));
    }
    const served = [];
    for (const c of changes) {
      served.push({
        id: c.id,
        batchId: c.batchId,
        kind: c.kind,
        target: c.target,
        targetLabel: c.targetLabel,
        route: { method: c.routeMethod, path: c.routePath },
        summary: c.summary,
        body: c.body,
        draft: c.draft,
        live: await liveOf(kd, run, c.kind, c.target, c.draft ?? c.body),
        labels: labelsFor(c.kind, c.target, c.draft ?? c.body),
        status: c.status,
        error: c.error,
        by: names.get(c.proposedBy) ?? "Someone",
        byKind: c.proposedByKind,
        at: c.createdAt,
      });
    }
    res.set("Cache-Control", "no-store").json({
      batches: batches.map((b) => ({ id: b.id, title: b.title, by: names.get(b.proposedBy) ?? firstName(""), at: b.createdAt })),
      changes: served,
      decided: decided.map((c) => ({ id: c.id, summary: c.summary, targetLabel: c.targetLabel, status: c.status, by: names.get(c.decidedBy ?? "") ?? "Someone", at: c.decidedAt, edited: (c.lessons ?? []).length })),
    });
  });

  app.put("/api/admin/proposals/:id/draft", async (req, res) => {
    const user = await person(req, res);
    if (!user) return;
    const uid = String(user.id);
    if (await overLimit(`proposals-draft:${uid}`, 600, WINDOW)) return res.status(429).json({ error: "too_many" });
    const draft = req.body?.body === null ? null : obj(req.body?.body);
    if (req.body?.body !== null && !draft) return res.status(400).json({ error: "bad_request", message: "Send body: the edited change, or null to drop the edits." });
    if (draft && JSON.stringify(draft).length > PROPOSAL_LIMITS.bodyBytes) return res.status(400).json({ error: "bad_request", message: "That is longer than a proposal can carry." });
    const ok = await store.saveDraft(getPool(), String(req.params.id ?? ""), draft, uid);
    if (!ok) return res.status(409).json({ error: "not_open", message: REVIEW_WORDS.notProposed });
    res.json({ success: true, savedAt: new Date().toISOString() });
  });

  /** The body a person accepts: what they sent, else their saved draft, else what was proposed. */
  const finalBody = (c: store.StoredChange, sent: unknown): Record<string, unknown> => withoutApproval(obj(sent) ?? c.draft ?? c.body);

  app.post("/api/admin/proposals/check", async (req, res) => {
    const user = await person(req, res);
    if (!user) return;
    if (await overLimit(`proposals-check:${String(user.id)}`, 120, WINDOW)) return res.status(429).json({ error: "too_many" });
    const items = Array.isArray(req.body?.items) ? (req.body.items as unknown[]).slice(0, 100) : [];
    const pool = getPool();
    const kd = kindDeps();
    const results = [];
    for (const it of items) {
      const id = String(obj(it)?.id ?? "");
      const c = await store.changeById(pool, id);
      if (!c) {
        results.push({ id, ok: false, error: REVIEW_WORDS.gone });
        continue;
      }
      const checked = await checkProposal(kd, { kind: c.kind, target: c.target, body: finalBody(c, obj(it)?.body), summary: c.summary });
      results.push(checked.ok ? { id, ok: true, ...(c.kind === "setting" ? { note: "This setting's own route checks it when you accept." } : {}) } : { id, ok: false, error: checked.error, field: checked.field ?? null });
    }
    res.json({ results });
  });

  app.post("/api/admin/proposals/accept", async (req, res) => {
    const user = await person(req, res);
    if (!user) return;
    const uid = String(user.id);
    if (await overLimit(`proposals-accept:${uid}`, 60, WINDOW)) return res.status(429).json({ error: "too_many" });
    const items = Array.isArray(req.body?.items) ? (req.body.items as unknown[]).slice(0, 100) : [];
    if (!items.length) return res.status(400).json({ error: "bad_request", message: "Send items: the changes to accept, in order." });
    const pool = getPool();
    const run = runAs(req);
    const name = String(user.name ?? "").trim() || "A person";
    const results: Array<{ id: string; ok: boolean; error?: string; field?: string | null }> = [];
    // One after another, each through its own route. A failure stops nothing and undoes nothing.
    for (const it of items) {
      const id = String(obj(it)?.id ?? "");
      const c = await store.changeById(pool, id);
      if (!c) {
        results.push({ id, ok: false, error: REVIEW_WORDS.gone });
        continue;
      }
      if (c.status !== "proposed" && c.status !== "failed") {
        results.push({ id, ok: false, error: REVIEW_WORDS.notProposed });
        continue;
      }
      const body = finalBody(c, obj(it)?.body);
      // The latest edits are kept even when the change fails, so fixing it starts from them.
      if (obj(obj(it)?.body)) await store.saveDraft(pool, id, body, uid);
      const kd = kindDeps();
      const checked = await checkProposal(kd, { kind: c.kind, target: c.target, body, summary: c.summary });
      const out = checked.ok ? await applyProposal(kd, run, c.kind, c.target, body) : { ok: false as const, error: checked.error, field: checked.field };
      if (!out.ok) {
        await store.markFailed(pool, id, uid, out.error);
        await recordEvent(pool, { kind: "proposed_change", text: `A proposed change did not land: ${c.summary.slice(0, 140)}`, actorUserId: uid, actorKind: "human", entityType: "proposed_change", entityRef: id, audience: "admin" });
        results.push({ id, ok: false, error: out.error, field: out.field ?? null });
        continue;
      }
      const lessons = fieldDiffs(c.body, body);
      await store.markAccepted(pool, id, { by: uid, accepted: body, lessons, approvedBy: name, approvalNote: ACCEPT_NOTE });
      await recordEvent(pool, {
        kind: "proposed_change",
        text: `A proposed change was accepted by ${firstName(name)}, ${ACCEPT_NOTE}${lessons.length ? `, with ${lessons.length} field${lessons.length === 1 ? "" : "s"} edited` : ""}: ${c.summary.slice(0, 140)}`,
        actorUserId: uid,
        actorKind: "human",
        entityType: "proposed_change",
        entityRef: id,
        audience: "admin",
      });
      results.push({ id, ok: true });
    }
    res.json({ results, accepted: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  });

  app.post("/api/admin/proposals/discard", async (req, res) => {
    const user = await person(req, res);
    if (!user) return;
    const uid = String(user.id);
    if (await overLimit(`proposals-discard:${uid}`, 120, WINDOW)) return res.status(429).json({ error: "too_many" });
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map((x) => String(x).slice(0, 60)).slice(0, 100) : [];
    if (!ids.length) return res.status(400).json({ error: "bad_request", message: "Send ids: the changes to put aside." });
    const pool = getPool();
    const results = [];
    for (const id of ids) {
      const ok = await store.markDiscarded(pool, id, uid);
      if (ok) {
        await recordEvent(pool, { kind: "proposed_change", text: "A proposed change was discarded on the review page", actorUserId: uid, actorKind: "human", entityType: "proposed_change", entityRef: id, audience: "admin" });
      }
      results.push({ id, ok, ...(ok ? {} : { error: REVIEW_WORDS.notProposed }) });
    }
    res.json({ results });
  });
}
