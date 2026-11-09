/**
 * WHAT THE CONNECTOR PROPOSES, over HTTP (role journey L13, tier B).
 *
 *   POST /api/agent-proposals/role-change     an org draft that waits for a holder of org.decide
 *   POST /api/agent-proposals/seating         a seating that waits for a holder of the power to fill roles
 *   POST /api/agent-proposals/letters         a drafted letter, queued for a person to send     (needs approval)
 *   GET  /api/agent-proposals/letters         the holder's own queue                               (needs approval)
 *   GET  /api/agent-proposals/conversations   applicants waiting on the holder, no contact details (needs approval)
 *   GET  /api/agent-proposals/waiting         what waits for a person who decides
 *   POST /api/agent-proposals/:id/resolve     a person marks a proposal taken or dismissed
 *   GET/PUT /api/admin/ai-agents-approval     the village setting that opens the two applicant-data tools
 *
 * Every route runs as the signed-in member and writes a WAITING item. Nothing
 * here adopts, seats, publishes, sends, sets pay or terms, invites or erases:
 * those stay with the person who presses them in the app (tier C, the 24 Sept
 * ruling: machines and Sera propose, a person or a vote adopts). Publishing a
 * role change is the existing one-click `publish-by-power` route.
 *
 * NO AI IN SELECTION. The conversations list carries no score, no rank and no
 * summary of a candidate, and no contact detail.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { addChange, createDraft, listDrafts, openDraftCap } from "../lib/orgDrafts";
import { recordEvent } from "../lib/events";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { addProposal, listWaiting, proposalById, resolveProposal, seatingAlreadyWaiting, waitingCount } from "../repos/agentProposals";
import {
  AI_APPROVAL_DOC, AI_APPROVAL_WORDS, LETTER_WORDS, approvalProblem, parseAiApproval, letterTitle, parseLetter, parseRoleChange, parseSeating, roleChangeReason,
} from "../../shared/agentProposals";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "isAdmin" | "overLimit" | "members"> & {
  liveHoldersOf: (capability: string) => Promise<string[]>;
};

const ORG_DECIDE = "org.decide";
const ORG_SEAT = "org.seat";
const WAITING_PER_HOLDER = 25;
const LIMIT_WINDOW_MS = 10 * 60_000;

const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "Member";
const isMissingTable = (e: unknown) => (e as { errno?: number })?.errno === 1146 || (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, isAdmin, overLimit, members, liveHoldersOf } = deps;

  /** The signed-in member, or null after answering 401. */
  async function signedIn(req: any, res: any): Promise<any | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in first." });
      return null;
    }
    return user;
  }

  /** Whether applicant data is open to AI agents here. It starts off. */
  async function approved(): Promise<boolean> {
    return parseAiApproval(await readConfigDocument(getPool(), AI_APPROVAL_DOC)).approved;
  }
  const closed = (res: any) => res.status(403).json({ error: "ai_agents_not_approved", message: AI_APPROVAL_WORDS.off });

  // ── The setting ────────────────────────────────────────────────────────────

  app.get("/api/admin/ai-agents-approval", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json(parseAiApproval(await readConfigDocument(getPool(), AI_APPROVAL_DOC)));
  });

  app.put("/api/admin/ai-agents-approval", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const problem = approvalProblem(req.body);
    if (problem) return res.status(400).json({ error: "bad_request", message: problem });
    const on = req.body.approved === true;
    const doc = on
      ? { approved: true, by: { userId: String(user.id), name: String(user.name ?? "").slice(0, 80) }, at: new Date().toISOString(), note: String(req.body.note).trim().slice(0, 400) }
      : { approved: false, by: { userId: String(user.id), name: String(user.name ?? "").slice(0, 80) }, at: new Date().toISOString(), note: String(req.body.note ?? "").trim().slice(0, 400) };
    await writeConfigDocument(getPool(), AI_APPROVAL_DOC, doc);
    await recordEvent(getPool(), {
      kind: "ai_agents_approval",
      text: on ? "The Anchor's approval of AI agents touching applicant data was recorded." : "The approval of AI agents touching applicant data was withdrawn.",
      actorUserId: String(user.id),
      actorKind: "human",
      entityType: "setting",
      entityRef: AI_APPROVAL_DOC,
      audience: "admin",
    });
    res.json(on ? parseAiApproval(doc) : { approved: false, by: doc.by, at: doc.at, note: doc.note });
  });

  // ── A role change: an org draft that waits ─────────────────────────────────

  app.post("/api/agent-proposals/role-change", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    if (await overLimit(`agent-proposal:${String(user.id)}`, 30, LIMIT_WINDOW_MS)) return res.status(429).json({ error: "too_many" });
    const parsed = parseRoleChange((req.body ?? {}) as Record<string, unknown>);
    if (!parsed.ok) return res.status(400).json({ error: "bad_request", message: parsed.error });
    const ask = parsed.value;
    const pool = getPool();
    const [[role]] = await pool.query<any[]>("SELECT `id`, `name` FROM `org_roles` WHERE `id` = ? AND `is_example` = 0 LIMIT 1", [ask.roleId]);
    if (!role) return res.status(404).json({ error: "no_such_role", message: "There is no role by that id. Read the chart with get_roles." });
    const made = await createDraft(pool, {
      title: `Proposed change to ${String(role.name)}`,
      rationale: roleChangeReason(ask),
      createdBy: String(user.id),
      sourceKind: "agent",
      openCap: openDraftCap((await members.all()).length),
    });
    if (!made.ok) return res.status(409).json({ error: "too_many_waiting", message: made.error });
    let changeId: string | null = null;
    if (Object.keys(ask.fields).length) {
      const c = await addChange(pool, made.id, { op: "update_seat", orgRoleId: ask.roleId, payload: ask.fields });
      if (!c.ok) return res.status(400).json({ error: "bad_change", message: c.error });
      changeId = c.id;
    }
    res.json({
      success: true,
      draftId: made.id,
      changeId,
      published: false,
      message: changeId
        ? "The change is a draft and nothing is live. A holder of the power to decide on the village's structure reads it in Review and publishes it with one click."
        : "The asks are written on a draft with no change in it. A person reads them in Review and makes the change on the role.",
    });
  });

  // ── A seating: a waiting item, never a seating ─────────────────────────────

  app.post("/api/agent-proposals/seating", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    if (await overLimit(`agent-proposal:${String(user.id)}`, 30, LIMIT_WINDOW_MS)) return res.status(429).json({ error: "too_many" });
    const parsed = parseSeating((req.body ?? {}) as Record<string, unknown>, String(user.id));
    if (!parsed.ok) return res.status(400).json({ error: "bad_request", message: parsed.error });
    const ask = parsed.value;
    const pool = getPool();
    const [[role]] = await pool.query<any[]>("SELECT `id`, `name` FROM `org_roles` WHERE `id` = ? AND `is_example` = 0 LIMIT 1", [ask.roleId]);
    if (!role) return res.status(404).json({ error: "no_such_role", message: "There is no role by that id. Read the chart with get_roles." });
    const member = await members.byId(ask.memberId);
    if (!member) return res.status(404).json({ error: "no_such_member", message: "There is no member by that id." });
    if (await seatingAlreadyWaiting(pool, ask.roleId, ask.memberId)) return res.status(409).json({ error: "already_waiting", message: "That seating is already waiting for a person." });
    if ((await waitingCount(pool, String(user.id), "seating")) >= WAITING_PER_HOLDER) return res.status(409).json({ error: "too_many_waiting", message: "Several seatings from you are still waiting. Let a person take some first." });
    const id = await addProposal(pool, {
      kind: "seating",
      proposedBy: String(user.id),
      roleId: ask.roleId,
      subjectUserId: ask.memberId,
      effectiveFrom: ask.from,
      title: `Seat ${firstName((member as any).name)} in ${String(role.name)} from ${ask.from}`,
      body: ask.why || null,
    });
    res.json({ success: true, id, seated: false, message: "Nothing was seated. A holder of the power to fill roles reads this in Review and records the seating in Admin." });
  });

  // ── Letters: drafted into a queue, a person sends ──────────────────────────

  app.post("/api/agent-proposals/letters", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    if (!(await approved())) return closed(res);
    if (await overLimit(`agent-proposal:${String(user.id)}`, 30, LIMIT_WINDOW_MS)) return res.status(429).json({ error: "too_many" });
    const parsed = parseLetter((req.body ?? {}) as Record<string, unknown>);
    if (!parsed.ok) return res.status(400).json({ error: "bad_request", message: parsed.error });
    const pool = getPool();
    if ((await waitingCount(pool, String(user.id), "letter")) >= WAITING_PER_HOLDER) return res.status(409).json({ error: "too_many_waiting", message: "Several letters from you are still waiting. Send or dismiss some first." });
    const l = parsed.value;
    const id = await addProposal(pool, { kind: "letter", proposedBy: String(user.id), applicationRef: l.applicationRef, title: letterTitle(l.kind, l.subject), body: l.body });
    res.json({ success: true, id, sent: false, message: LETTER_WORDS.queued });
  });

  app.get("/api/agent-proposals/letters", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    if (!(await approved())) return closed(res);
    res.set("Cache-Control", "no-store").json({ letters: await listWaiting(getPool(), "letter", { proposedBy: String(user.id) }) });
  });

  // ── Conversations: who is waiting on this holder, with no contact details ──

  app.get("/api/agent-proposals/conversations", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    if (!(await approved())) return closed(res);
    if (await overLimit(`agent-conversations:${String(user.id)}`, 60, LIMIT_WINDOW_MS)) return res.status(429).json({ error: "too_many" });
    const pool = getPool();
    try {
      // Read from the interview queue (role journey L5). A village that has not got it yet answers 404, in words.
      const [rows] = await pool.query<any[]>(
        "SELECT i.`id`, i.`application_ref`, i.`position`, i.`minutes`, i.`is_final`, i.`state`, i.`opened_at`, i.`booked_at`, r.`name` AS role_name " +
          "FROM `application_interviews` i " +
          "JOIN `org_role_assignments` a ON a.`org_role_id` = i.`interviewer_role_id` AND a.`user_id` = ? AND a.`ended_at` IS NULL AND a.`holder_kind` = 'member' " +
          "LEFT JOIN `org_roles` r ON r.`id` = i.`interviewer_role_id` " +
          "WHERE i.`state` IN ('open', 'booked') AND NOT EXISTS (SELECT 1 FROM `application_recusals` x WHERE x.`application_ref` = i.`application_ref` AND x.`user_id` = ?) " +
          "ORDER BY i.`opened_at` ASC LIMIT 50",
        [String(user.id), String(user.id)],
      );
      // Ref, role and timing only. No name, no email, no time zone, no scores, no summary: scoring stays a person's act.
      res.set("Cache-Control", "no-store").json({
        conversations: rows.map((r) => ({
          applicationRef: String(r.application_ref),
          asRole: r.role_name === null ? null : String(r.role_name),
          position: Number(r.position),
          minutes: Number(r.minutes),
          final: Number(r.is_final) === 1,
          state: String(r.state),
          waitingSince: r.opened_at instanceof Date ? r.opened_at.toISOString() : null,
          booked: r.booked_at !== null,
        })),
        note: "Open the application in the app to read the applicant's words. Scores are entered by a person.",
      });
    } catch (e) {
      if (isMissingTable(e) || (e as { errno?: number })?.errno === 1054) {
        return res.status(404).json({ error: "not_open", message: "Conversations are not open in this village yet." });
      }
      throw e;
    }
  });

  // ── What waits for a person who decides ────────────────────────────────────

  app.get("/api/agent-proposals/waiting", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    const [admin, deciders, seaters] = await Promise.all([isAdmin(req), liveHoldersOf(ORG_DECIDE), liveHoldersOf(ORG_SEAT)]);
    const uid = String(user.id);
    const mayDecide = admin || deciders.includes(uid);
    const maySeat = admin || seaters.includes(uid);
    if (!mayDecide && !maySeat) return res.status(401).json({ error: "auth_required", message: "Nothing is waiting for you here." });
    const pool = getPool();
    const [drafts, seatings] = await Promise.all([
      mayDecide ? listDrafts(pool, { status: "open" }) : Promise.resolve([]),
      maySeat ? listWaiting(pool, "seating") : Promise.resolve([]),
    ]);
    res.set("Cache-Control", "no-store").json({
      roleChanges: drafts
        .filter((d) => d.sourceKind === "agent")
        .map((d) => ({ draftId: d.id, title: d.title, why: d.rationale, changes: d.changes.length, changeIds: d.changes.map((c) => c.id) })),
      seatings: seatings.map((s) => ({ id: s.id, title: s.title, roleId: s.roleId, memberId: s.subjectUserId, from: s.effectiveFrom, why: s.body, createdAt: s.createdAt })),
    });
  });

  app.post("/api/agent-proposals/:id/resolve", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    const status = req.body?.status === "taken" ? "taken" : req.body?.status === "dismissed" ? "dismissed" : null;
    if (!status) return res.status(400).json({ error: "bad_request", message: "status is taken or dismissed." });
    const p = await proposalById(getPool(), String(req.params.id ?? ""));
    if (!p) return res.status(404).json({ error: "not_found" });
    const uid = String(user.id);
    // A seating is resolved by a holder of the power to fill roles. A letter by the member who drafted it.
    const may = p.kind === "letter" ? p.proposedBy === uid : (await isAdmin(req)) || (await liveHoldersOf(ORG_SEAT)).includes(uid);
    if (!may) return res.status(404).json({ error: "not_found" });
    const done = await resolveProposal(getPool(), p.id, status, uid);
    if (!done) return res.status(409).json({ error: "not_waiting", message: "That is no longer waiting." });
    res.json({ success: true });
  });
}
