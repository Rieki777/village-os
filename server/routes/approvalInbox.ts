/**
 * THE ONE-TAP APPROVAL INBOX, over HTTP (role journey L13, part A).
 *
 * Filing (the connector, as the member whose token it is). Each writes a
 * WAITING proposal and changes nothing:
 *   POST /api/agent-proposals/setting      a village setting, a module switch, or what public proposals are for
 *   POST /api/agent-proposals/listing      "list only these", or list or unlist one role
 *   POST /api/agent-proposals/page-copy    one Pages content block
 *   POST /api/agent-proposals/map-publish  publish the proposer's current map draft
 *
 * Deciding (a person):
 *   GET  /api/approval-inbox                  what waits, with who, when, and a before and after; and what was decided
 *   POST /api/approval-inbox/:id/approve      run the stored call through the thing's OWN route, as the approver
 *   POST /api/approval-inbox/:id/decline
 *   POST /api/approval-inbox/:id/revert       put an approved one back, where its route allows
 *   POST /api/approval-inbox/approve-batch    approve several, one after another, each through its own route
 *
 * APPROVING NEVER BYPASSES A ROUTE. The call runs over the loopback with the
 * APPROVER's own authorization, so the route's gates answer for them. A
 * proposal waits seven days and then lapses. Every decision is recorded: who,
 * when and what.
 *
 * Role changes are org drafts (server/routes/agentProposals.ts) and appear in
 * the same inbox by their draft id; approving one is the existing
 * `publish-by-power` route.
 */
import type express from "express";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { listDrafts } from "../lib/orgDrafts";
import { fileListing, fileMapPublish, filePageCopy, fileSetting, runApproval, runRevert, type Filing, type FilingDeps, type RouteRunner } from "../lib/approvalInbox";
import { addProposal, decideProposal, expireOld, listInboxDecided, listInboxWaiting, proposalById, type StoredProposal } from "../repos/agentProposals";
import { EXPIRES_AFTER_MS, INBOX_WORDS, expiresAt, isExpired, type InboxBody, type InboxCall } from "../../shared/approvalInbox";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "isAdmin" | "overLimit" | "members"> & {
  liveHoldersOf: (capability: string) => Promise<string[]>;
  /** The port this server listens on, for the loopback. */
  port: () => number;
  clientIp: (req: express.Request) => string;
  /** What filing reads from the village. */
  filing: () => Omit<FilingDeps, "pool">;
  /** Today in the village, YYYY-MM-DD, for a dated seating. */
  today: () => string;
};

/** The powers whose holders see the inbox besides an admin. The routes behind each card still decide who may approve. */
const READERS = ["org.decide", "org.seat", "story.tell", "map.publish", "intake.moderate"] as const;

const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "Someone";
const DRAFT_PREFIX = "draft:";

function parseBody(raw: string | null): InboxBody | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as InboxBody;
    return b && typeof b === "object" && b.words ? b : null;
  } catch {
    return null;
  }
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, isAdmin, overLimit, members, liveHoldersOf, port, clientIp, today } = deps;

  async function signedIn(req: any, res: any) {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in first." });
      return null;
    }
    return user;
  }

  /** The signed-in member who may open the inbox, or null after answering 401. */
  async function reader(req: any, res: any) {
    const user = await signedIn(req, res);
    if (!user) return null;
    if (await isAdmin(req)) return user;
    const uid = String(user.id);
    for (const cap of READERS) if ((await liveHoldersOf(cap)).includes(uid)) return user;
    res.status(401).json({ error: "auth_required", message: "Nothing waits for you here." });
    return null;
  }

  const withPool = (): FilingDeps => ({ ...deps.filing(), pool: getPool() });

  // ── Filing ─────────────────────────────────────────────────────────────────

  async function fileIt(req: any, res: any, build: (user: any) => Promise<Filing>) {
    const user = await signedIn(req, res);
    if (!user) return;
    if (await overLimit(`agent-proposal:${String(user.id)}`, 30, 10 * 60_000)) return res.status(429).json({ error: "too_many" });
    const f = await build(user);
    if (!f.ok) return res.status(400).json({ error: "refused", message: f.error });
    const pool = getPool();
    const id = await addProposal(pool, { kind: f.kind, proposedBy: String(user.id), roleId: f.roleId ?? null, title: f.title, body: JSON.stringify(f.body) });
    res.json({ success: true, id, applied: false, expiresAt: expiresAt(new Date()).toISOString(), message: "Nothing was changed. A person approves it in the approval inbox, and it lapses in seven days." });
  }

  app.post("/api/agent-proposals/setting", (req, res) => fileIt(req, res, () => fileSetting(withPool(), (req.body ?? {}) as Record<string, unknown>)));
  app.post("/api/agent-proposals/listing", (req, res) => fileIt(req, res, () => fileListing(withPool(), (req.body ?? {}) as Record<string, unknown>)));
  app.post("/api/agent-proposals/page-copy", (req, res) => fileIt(req, res, () => filePageCopy(withPool(), (req.body ?? {}) as Record<string, unknown>)));
  app.post("/api/agent-proposals/map-publish", (req, res) => fileIt(req, res, (user) => fileMapPublish(withPool(), String(user.id), (req.body ?? {}) as Record<string, unknown>)));

  // ── The inbox ──────────────────────────────────────────────────────────────

  /** Run a stored call as the person pressing the button. */
  const runnerFor = (req: any): RouteRunner => async (call: InboxCall) => {
    if (!call.path.startsWith("/api/") || call.path.startsWith("/api/agent/")) return { status: 400, body: { error: "not a route an approval may call" } };
    const auth = String(req.headers.authorization ?? "");
    const r = await fetch(`http://127.0.0.1:${port()}${call.path}`, { // module-review-ok: the loopback to this same process, run as the person who pressed Approve, never an outside host
      method: call.method,
      headers: {
        authorization: auth,
        accept: "application/json",
        ...(call.body === undefined ? {} : { "content-type": "application/json" }),
        ...(call.headers ?? {}),
        ...(clientIp(req) ? { "x-forwarded-for": clientIp(req) } : {}),
      },
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
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

  const card = async (p: StoredProposal, names: Map<string, string>) => {
    const body = parseBody(p.body);
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      by: names.get(p.proposedBy) ?? "Someone",
      at: p.createdAt,
      expiresAt: expiresAt(p.createdAt).toISOString(),
      words: body?.words ?? { what: p.title, before: "", after: p.body ?? "" },
      canRevert: !!body?.revert,
      decision: body?.decision ?? null,
      state: p.status,
    };
  };

  app.get("/api/approval-inbox", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    const pool = getPool();
    await expireOld(pool, EXPIRES_AFTER_MS);
    const [waiting, decided, drafts] = await Promise.all([listInboxWaiting(pool), listInboxDecided(pool), listDrafts(pool, { status: "open" })]);
    const nameIds = new Set<string>([...waiting, ...decided].map((p) => p.proposedBy));
    const agentDrafts = drafts.filter((d) => d.sourceKind === "agent");
    for (const d of agentDrafts) if (d.createdBy) nameIds.add(String(d.createdBy));
    const names = new Map<string, string>();
    for (const id of Array.from(nameIds)) names.set(id, firstName((await members.byId(id))?.name));
    const cards = await Promise.all(waiting.map((p) => card(p, names)));
    const draftCards = agentDrafts.map((d) => ({
      id: `${DRAFT_PREFIX}${d.id}`,
      kind: "role_change",
      title: d.title,
      by: names.get(String(d.createdBy)) ?? "Someone",
      at: null,
      expiresAt: null,
      words: { what: d.title, before: "The role as it is", after: d.rationale ?? "" },
      canRevert: false,
      decision: null,
      state: "waiting",
      changes: d.changes.length,
    }));
    res.set("Cache-Control", "no-store").json({ waiting: [...cards, ...draftCards], decided: await Promise.all(decided.map((p) => card(p, names))) });
  });

  /** Approve one. Returns the HTTP-shaped answer so a batch can reuse it. */
  async function approveOne(req: any, user: any, id: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const pool = getPool();
    const run = runnerFor(req);
    const uid = String(user.id);
    if (id.startsWith(DRAFT_PREFIX)) {
      const draftId = id.slice(DRAFT_PREFIX.length);
      const draft = (await listDrafts(pool, { status: "open" })).find((d) => d.id === draftId && d.sourceKind === "agent");
      if (!draft) return { status: 404, body: { error: "not_found", message: INBOX_WORDS.gone } };
      const a = await run({ method: "POST", path: `/api/org/drafts/${encodeURIComponent(draftId)}/publish-by-power`, body: { expectedChanges: draft.changes.map((c) => c.id) } });
      if (a.status >= 300) return { status: 409, body: { error: "refused", message: String((a.body as any)?.message ?? (a.body as any)?.error ?? "The route refused.") } };
      const body: InboxBody = {
        words: { what: draft.title, before: "The role as it was", after: draft.rationale ?? "" },
        call: null,
        revert: { method: "POST", path: `/api/admin/org/drafts/${encodeURIComponent(draftId)}/revert`, body: {} },
        decision: { state: "approved", by: uid, at: new Date().toISOString() },
      };
      const rec = await addProposal(pool, { kind: "role_change", proposedBy: String(draft.createdBy ?? uid), title: draft.title, body: JSON.stringify(body) });
      await decideProposal(pool, rec, "waiting", "approved", uid, JSON.stringify(body));
      await audit(pool, uid, "approved", draft.title, rec);
      return { status: 200, body: { success: true, id } };
    }
    const p = await proposalById(pool, id);
    if (!p || p.kind === "letter") return { status: 404, body: { error: "not_found", message: INBOX_WORDS.gone } };
    if (p.status !== "waiting") return { status: 409, body: { error: "not_waiting", message: INBOX_WORDS.notWaiting } };
    if (isExpired(p.createdAt)) {
      await expireOld(pool, EXPIRES_AFTER_MS);
      return { status: 410, body: { error: "expired", message: INBOX_WORDS.expired } };
    }
    const body = parseBody(p.body);
    if (!body) return { status: 409, body: { error: "unreadable", message: "That proposal cannot be read. Decline it and ask for it again." } };
    if (p.kind === "seating") {
      const from = String(body.facts?.from ?? p.effectiveFrom ?? "");
      if (from && from > today()) return { status: 409, body: { error: "future", message: INBOX_WORDS.futureSeating(from) } };
    }
    const out = await runApproval(pool, body, p.kind, run);
    if (!out.ok) return { status: 409, body: { error: "refused", message: out.error } };
    const decided: InboxBody = { ...body, decision: { state: "approved", by: uid, at: new Date().toISOString(), result: out.result } };
    await decideProposal(pool, p.id, "waiting", "approved", uid, JSON.stringify(decided));
    await audit(pool, uid, "approved", p.title, p.id);
    return { status: 200, body: { success: true, id } };
  }

  async function audit(pool: ReturnType<Deps["getPool"]>, uid: string, what: string, title: string, ref: string) {
    await recordEvent(pool, {
      kind: "approval_inbox",
      text: `A proposal was ${what}: ${title.slice(0, 160)}`,
      actorUserId: uid,
      actorKind: "human",
      entityType: "agent_proposal",
      entityRef: ref,
      audience: "admin",
    });
  }

  app.post("/api/approval-inbox/approve-batch", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    if (await overLimit(`approval-inbox:${String(user.id)}`, 60, 10 * 60_000)) return res.status(429).json({ error: "too_many" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => String(x).slice(0, 80)).slice(0, 25) : [];
    if (!ids.length) return res.status(400).json({ error: "bad_request", message: "Send ids: a list of proposals." });
    const results: Array<{ id: string; ok: boolean; message?: string }> = [];
    // One after another: each goes through its own route, and one refusal does not stop the rest.
    for (const id of ids) {
      const r = await approveOne(req, user, id);
      results.push({ id, ok: r.status === 200, ...(r.status === 200 ? {} : { message: String(r.body.message ?? "") }) });
    }
    res.json({ results });
  });

  app.post("/api/approval-inbox/:id/approve", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    if (await overLimit(`approval-inbox:${String(user.id)}`, 60, 10 * 60_000)) return res.status(429).json({ error: "too_many" });
    const r = await approveOne(req, user, String(req.params.id ?? ""));
    res.status(r.status).json(r.body);
  });

  app.post("/api/approval-inbox/:id/decline", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    const pool = getPool();
    const id = String(req.params.id ?? "");
    const uid = String(user.id);
    if (id.startsWith(DRAFT_PREFIX)) {
      const a = await runnerFor(req)({ method: "POST", path: `/api/review/drafts/${encodeURIComponent(id.slice(DRAFT_PREFIX.length))}/withdraw`, body: {} });
      if (a.status >= 300) return res.status(409).json({ error: "refused", message: String((a.body as any)?.error ?? "The route refused.") });
      await audit(pool, uid, "declined", id, id);
      return res.json({ success: true });
    }
    const p = await proposalById(pool, id);
    if (!p || p.kind === "letter") return res.status(404).json({ error: "not_found", message: INBOX_WORDS.gone });
    const body = parseBody(p.body);
    const decided = JSON.stringify({ ...(body ?? { words: { what: p.title, before: "", after: "" }, call: null, revert: null }), decision: { state: "declined", by: uid, at: new Date().toISOString() } });
    if (!(await decideProposal(pool, p.id, "waiting", "declined", uid, decided))) return res.status(409).json({ error: "not_waiting", message: INBOX_WORDS.notWaiting });
    await audit(pool, uid, "declined", p.title, p.id);
    res.json({ success: true });
  });

  app.post("/api/approval-inbox/:id/revert", async (req, res) => {
    const user = await reader(req, res);
    if (!user) return;
    const pool = getPool();
    const p = await proposalById(pool, String(req.params.id ?? ""));
    if (!p || p.kind === "letter") return res.status(404).json({ error: "not_found", message: INBOX_WORDS.gone });
    if (p.status !== "approved") return res.status(409).json({ error: "not_approved", message: "Only an approved proposal can be put back." });
    const body = parseBody(p.body);
    if (!body) return res.status(409).json({ error: "unreadable" });
    const out = await runRevert(body, runnerFor(req));
    if (!out.ok) return res.status(409).json({ error: "refused", message: out.error });
    const uid = String(user.id);
    const reverted = JSON.stringify({ ...body, decision: { state: "reverted", by: uid, at: new Date().toISOString() } });
    await decideProposal(pool, p.id, "approved", "reverted", uid, reverted);
    await audit(pool, uid, "reverted", p.title, p.id);
    res.json({ success: true });
  });
}
