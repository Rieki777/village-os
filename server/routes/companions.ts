/**
 * A member's companions, over HTTP (0295; the companions contract, section 6).
 *
 *   GET    /api/me/companions                     the army, each one's questions and drafts, the consent line
 *   PATCH  /api/me/companions/:id                 name, look, cap, order, resting, engine
 *   POST   /api/me/companions/consent             the member's yes to the line that names who answers
 *   GET    /api/me/companions/:id/chat            one companion's recent chat
 *   POST   /api/me/companions/:id/chat            say something to it
 *   POST   /api/me/companion-items/:id/answer     answer a question
 *   POST   /api/me/companion-items/:id/confirm    yes to a draft, with edits or without
 *   POST   /api/me/companion-items/:id/decline    no to a draft, or "not mine" to a question
 *
 * A ROUTE MODULE, because server/index.ts is at its ratchet. Every route asks
 * the one gate for `companion.use` before anything else, and no route takes a
 * member id: everything is the caller's own.
 *
 * ── A YES OPENS AN EXISTING DOOR, AS THE MEMBER ──────────────────────────
 *
 * `throughDoor` hands a request back to this same app, carrying the member's
 * own headers, as if they had pressed the door's own button: the wallet send,
 * the gratitude send, the message send, the RSVP confirm, the circle budget
 * spend. Every module gate, rate limit, permission check and audit hook that
 * door carries runs, against the member who said yes, because it is the door
 * running. There is no second write path, and nothing here could grow one by
 * accident: the paths it may reach are the ones `planConfirm` names, and
 * nothing a member sends picks a path.
 *
 * The item is claimed before the door opens, so two yeses open it once, and
 * given back if the door refuses, so a refusal leaves the draft as it was.
 */
import http from "node:http";
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { callAssistant, DEFAULT_ASSISTANT_MODEL, parseJsonReply, resolveKey } from "../lib/assistant";
import { recordAssistantUsage } from "../lib/assistantUsage";
import { companionDisclosure, consentFor, saberraDisclosure, withConsent, type CompanionDisclosure } from "../lib/companionConsent";
import { decideMemberDraft, memberDraftById, proposeMemberDraft } from "../lib/agentProfile";
import { fromLedgerUnits, recognitionName, villageId } from "../lib/economy";
import { instanceIdentity } from "../lib/identity";
import { tokenDef } from "../lib/ledger";
import { resolveMemberKey } from "../lib/memberSecrets";
import { userIdForHandle } from "../lib/profile";
import { OPEN_IDEAS_PER_MEMBER } from "../lib/publicForms";
import { proposeQuest } from "../lib/questProposals";
import { numberVar, stringVar } from "../lib/variables";
import { weekAhead } from "../lib/villageReaders";
import { listBudgets } from "../lib/resources";
import { treasuryTokenFor } from "../lib/circleTreasury";
import {
  answerQuestion,
  armyView,
  claimForDoor,
  declineItem,
  engineName,
  outcomeRefFrom,
  planConfirm,
  handOffPurchase,
  recordOutcome,
  releaseClaim,
  syncArmy,
  type CompanionsEnv,
  type DoorCall,
  type Planned,
  type Words,
} from "../lib/companions";
import { companionSystemPrompt, draftFromReply, fillFromRecord, type ProposeRsvp } from "../lib/companionMaia";
import * as repo from "../repos/companions";
import { portraitsForMember } from "../repos/characterPortraits";
import { MEMBER_BATCH_PREFIX, openIdeas, withIdeaLock } from "../repos/questProposals";
import { PROPOSE_QUEST_MODULE } from "../../shared/questIdeas";
import {
  COMPANION_PROVIDERS,
  MAX_CHAT_MESSAGE,
  MAX_COMPANION_NAME,
  MAX_QUESTIONS_PER_DAY,
  carriesContact,
  parseLook,
  villageDayKey,
  type CompanionsPayload,
} from "../../shared/companionItems";

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "overLimit" | "members"> & {
  getPool: () => import("mysql2/promise").Pool;
  /** The village's name, its guide's name and its timezone, read fresh on every request. */
  village: () => { name: string; guideName: string; timeZone: string };
};

const HOUR_MS = 60 * 60 * 1000;
const CHAT_PER_HOUR = 60;
const YES_PER_HOUR = 60;
const EDITS_PER_HOUR = 120;
/** How much of a chat goes back to the model with each message. */
const CHAT_HISTORY = 12;
/** The line the gate answers with. */
const NOT_YET = "Companions open when you become a member of the village.";
const NEVER_INVENT =
  "Names, events and labels about a person come word for word from a tool result or from the member's own words. If it is not there, say: I don't see that anywhere.";

/** The request a door sees: the member's own headers, a parsed body, nothing to read from the wire. */
export async function throughDoor(app: Express, from: Request, call: DoorCall): Promise<{ status: number; json: any }> {
  return new Promise((resolve) => {
    const sub = new http.IncomingMessage(from.socket);
    sub.method = call.method;
    sub.url = call.path;
    const headers: Record<string, any> = { ...from.headers, "content-type": "application/json" };
    // Compression would hand back bytes we then parse; a length or a cache
    // validator describes the request we came in on, not this one.
    delete headers["accept-encoding"];
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    delete headers["if-none-match"];
    sub.headers = headers;
    (sub as any).body = call.body;
    // The body parsers skip a request whose body is already read.
    (sub as any)._body = true;
    sub.push(null);

    const out = new http.ServerResponse(sub);
    const chunks: Buffer[] = [];
    let settled = false;
    const take = (chunk: unknown, enc?: unknown) => {
      if (chunk === undefined || chunk === null || typeof chunk === "function") return;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof enc === "string" ? (enc as BufferEncoding) : "utf8"));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8");
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { error: text.slice(0, 200) };
      }
      // Hooks that write on a finished response (the admin audit line) run now, as they would for the button.
      out.emit("finish");
      resolve({ status: out.statusCode, json });
    };
    (out as any).write = (chunk: unknown, enc?: unknown) => {
      take(chunk, enc);
      return true;
    };
    (out as any).end = (chunk?: unknown, enc?: unknown) => {
      take(chunk, enc);
      finish();
      return out;
    };
    (app as any).handle(sub, out, (err: unknown) => {
      if (settled) return;
      settled = true;
      resolve({ status: err ? 500 : 404, json: { error: err ? "That door failed." : "That door is not here." } });
    });
  });
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, overLimit, members, getPool, village } = deps;

  const env = (): CompanionsEnv & { timeZone: string; villageName: string } => {
    const v = village();
    return {
      pool: getPool(),
      today: villageDayKey(new Date(), v.timeZone),
      ceiling: Math.max(0, Math.min(MAX_QUESTIONS_PER_DAY, Math.trunc(numberVar("companions.max_questions_per_day")))),
      roleScope: stringVar("companions.role_ids"),
      guideName: v.guideName,
      timeZone: v.timeZone,
      villageName: v.name,
    };
  };

  const words: Words = {
    tokenAmount: (slug, minor) => `${fromLedgerUnits(slug, minor)} ${tokenDef(slug)?.name ?? slug}`,
    recognition: (n) => `${n} ${recognitionName()}`,
  };

  /** Signed in and holding `companion.use`, or the request is already answered. */
  const member = async (req: Request, res: Response): Promise<any | null> => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in first" });
      return null;
    }
    if (!(await guardCapability(req, res, "companion.use", { status: 403, body: { error: NOT_YET } }))) return null;
    return user;
  };

  const ownCompanion = async (res: Response, userId: string, id: string): Promise<repo.CompanionRow | null> => {
    const c = await repo.companionById(getPool(), id);
    if (!c || c.ownerUserId !== userId || c.status === "retired") {
      res.status(404).json({ error: "Not found" });
      return null;
    }
    return c;
  };

  const proposeRsvpFor = (userId: string): ProposeRsvp => async (payload) => {
    const out = await proposeMemberDraft(getPool(), userId, "event_rsvp", payload, "assistant");
    return out.ok ? { ok: true, id: out.draft.id } : { ok: false, error: out.error };
  };

  /** The key that would answer this member's chat now, and the line that names it. Null: no key at all. */
  const villageLine = async (user: any): Promise<{ disclosure: CompanionDisclosure; memberKey: any } | null> => {
    const memberKey = await resolveMemberKey(getPool(), String(user.id));
    const resolved = resolveKey(process.env, memberKey);
    if (!resolved) return null;
    return { disclosure: companionDisclosure(resolved.source, memberKey, village().name, process.env), memberKey };
  };

  /**
   * An RSVP drafted here is a member draft underneath, and the member may have
   * answered it from the "Your agent" panel instead. Whatever they did there
   * is what this card says.
   */
  const reconcileRsvps = async (userId: string) => {
    for (const it of await repo.openDraftsOfKind(getPool(), userId, "rsvp")) {
      const mdId = typeof it.payload?.memberDraftId === "string" ? it.payload.memberDraftId : null;
      if (!mdId) continue;
      const md = await memberDraftById(getPool(), mdId);
      if (!md || md.status === "proposed") continue;
      const to = md.status === "confirmed" ? "confirmed" : md.status === "rejected" ? "declined" : "expired";
      await repo.decideItem(getPool(), it.id, ["open"], to, to === "confirmed" ? { outcomeRef: `rsvp:${md.id}` } : {});
    }
  };

  app.get("/api/me/companions", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const e = env();
    const uid = String(user.id);
    const army = await syncArmy(e, uid);
    const personal = army.find((c) => c.scope === "personal");
    if (personal && personal.status === "active") {
      const week = await weekAhead(getPool(), { userId: uid, isAdmin: false }, 7).catch(() => []);
      await fillFromRecord(e, personal, week, proposeRsvpFor(uid), e.timeZone);
    }
    await reconcileRsvps(uid);
    const portraits = await portraitsForMember(getPool(), uid);
    const portraitUrl = (key: string) => {
      const p = portraits.find((r) => r.archetypeKey === key && r.fileName);
      return p ? `/api/uploads/${encodeURIComponent(String(p.fileName))}` : null;
    };
    const budgets = await listBudgets(getPool()).catch(() => []);
    const budgetToken = (id: string) => {
      const b = budgets.find((x) => x.id === id);
      return b ? treasuryTokenFor(b.unit) : null;
    };
    const companions = await armyView(e, uid, { ...words, budgetToken }, portraitUrl);
    const line = await villageLine(user);
    const body: CompanionsPayload = {
      companions,
      ceiling: e.ceiling,
      today: e.today,
      consent: line ? { disclosure: line.disclosure, given: Boolean(consentFor(user.prefs, line.disclosure)) } : null,
    };
    res.json(body);
  });

  app.patch("/api/me/companions/:id", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await overLimit(`companion-edit:${user.id}`, EDITS_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of changes. Try again in a little while." });
    }
    const c = await ownCompanion(res, String(user.id), String(req.params.id));
    if (!c) return;
    const b = req.body ?? {};
    const patch: Parameters<typeof repo.updateCompanion>[2] = {};
    if (b.name !== undefined) {
      const name = String(b.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Give your companion a name." });
      if (name.length > MAX_COMPANION_NAME) return res.status(400).json({ error: `A name holds up to ${MAX_COMPANION_NAME} characters.` });
      if (carriesContact(name)) return res.status(400).json({ error: "A name may not carry an email address or a phone number." });
      patch.name = name;
    }
    if (b.look !== undefined) {
      const look = parseLook(b.look);
      if (!look) return res.status(400).json({ error: "Choose a pet, or one of your own portraits." });
      if (look.source !== "choose") {
        const mine = await portraitsForMember(getPool(), String(user.id));
        if (!mine.some((p) => p.archetypeKey === look.portraitKey && p.fileName)) {
          return res.status(400).json({ error: "Make that portrait in the portrait studio first, then choose it here." });
        }
      }
      patch.look = JSON.stringify(look);
    }
    if (b.dailyQuestionCap !== undefined) {
      const n = Number(b.dailyQuestionCap);
      if (!Number.isInteger(n) || n < 0 || n > MAX_QUESTIONS_PER_DAY) {
        return res.status(400).json({ error: `Choose from 0 to ${MAX_QUESTIONS_PER_DAY} questions a day.` });
      }
      patch.dailyQuestionCap = n;
    }
    if (b.sortOrder !== undefined) {
      const n = Number(b.sortOrder);
      if (!Number.isInteger(n) || n < 0 || n > 1000) return res.status(400).json({ error: "sortOrder is a whole number from 0 to 1000." });
      patch.sortOrder = n;
    }
    if (b.status !== undefined) {
      if (b.status !== "active" && b.status !== "resting") return res.status(400).json({ error: "A companion is active or resting." });
      patch.status = b.status;
    }
    if (b.provider !== undefined) {
      if (!(COMPANION_PROVIDERS as readonly string[]).includes(String(b.provider))) return res.status(400).json({ error: "That engine is not one this village knows." });
      // The contract's question 1: a personal companion stays with the village guide, so no
      // member's identity crosses to the outside service on purpose.
      if (c.scope === "personal" && b.provider !== "village") {
        return res.status(400).json({ error: "Your personal companion speaks through the village guide." });
      }
      patch.provider = b.provider;
    }
    await repo.updateCompanion(getPool(), c.id, patch);
    res.json({ companion: await repo.companionById(getPool(), c.id) });
  });

  app.post("/api/me/companions/consent", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await overLimit(`companion-consent:${user.id}`, 30, HOUR_MS)) {
      return res.status(429).json({ error: "Try again in a little while." });
    }
    const b = req.body ?? {};
    let d: CompanionDisclosure | null = null;
    if (b.source === "saberra") {
      d = saberraDisclosure(String(b.companionName ?? ""));
    } else {
      const line = await villageLine(user);
      if (!line) return res.status(409).json({ error: "No key answers here yet, so there is nothing to agree to." });
      d = line.disclosure;
    }
    if (b.provider !== d.provider || b.operator !== d.operator || b.source !== d.source) {
      return res.status(409).json({ error: "Who answers changed since you read that line. Read it again.", disclosure: d });
    }
    const at = new Date().toISOString();
    const updated = await members.update(String(user.id), (u: any) => {
      u.prefs = withConsent(u.prefs, d!, at);
    });
    if (!updated) return res.status(404).json({ error: "Your account could not be found." });
    res.json({ consent: consentFor(updated.prefs, d), disclosure: d });
  });

  app.get("/api/me/companions/:id/chat", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const c = await ownCompanion(res, String(user.id), String(req.params.id));
    if (!c) return;
    res.json({ messages: await repo.recentMessages(getPool(), c.id, String(user.id), 40) });
  });

  app.post("/api/me/companions/:id/chat", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const uid = String(user.id);
    const c = await ownCompanion(res, uid, String(req.params.id));
    if (!c) return;
    const text = String(req.body?.message ?? "").trim();
    if (!text) return res.status(400).json({ error: "Say something first." });
    if (text.length > MAX_CHAT_MESSAGE) return res.status(400).json({ error: `A message holds up to ${MAX_CHAT_MESSAGE} characters.` });
    if (await overLimit(`companion-chat:${uid}`, CHAT_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of chat for one hour. Pick it up in a little while." });
    }
    const e = env();
    // The outside engine has no chat yet (its `companion_chat` is a seam), so every chat runs on the village guide.
    const engine = engineName("village", e.guideName);
    const line = await villageLine(user);
    if (!line) return res.status(409).json({ error: `${engine} has no key in this village yet, so companions cannot talk in their own words.`, engine });
    if (!consentFor(user.prefs, line.disclosure)) {
      return res.status(409).json({ error: "consent_required", consent: { required: true, ...line.disclosure }, engine });
    }

    const messageId = await repo.addMessage(getPool(), { companionId: c.id, ownerUserId: uid, speaker: "member", engine: "village", body: text });
    const history = await repo.recentMessages(getPool(), c.id, uid, CHAT_HISTORY);
    const roleName = c.scope === "role" ? ((await repo.rosterFor(getPool(), [c.scopeId])).get(c.scopeId)?.name ?? null) : null;
    const system = companionSystemPrompt({
      guideName: engine,
      villageName: e.villageName,
      companionName: c.name,
      scopeLine: roleName ? `${roleName} companion` : "Personal companion",
      roleName,
      never: NEVER_INVENT,
    });
    const call = await callAssistant({
      mode: "member",
      system,
      messages: history.map((m) => ({ role: m.speaker === "member" ? ("user" as const) : ("assistant" as const), content: m.body })),
      model: DEFAULT_ASSISTANT_MODEL,
      clientIp: String(req.ip ?? ""),
      burstKey: `companion:${uid}`,
      userId: uid,
      memberKey: line.memberKey,
    });
    const paid = call.ok ? { keySource: call.keySource, usage: call.usage, iterations: call.iterations, stopReason: call.stopReason } : call.spent;
    if (paid) {
      await recordAssistantUsage(getPool(), {
        villageId: instanceIdentity().instanceId,
        mode: "member",
        model: DEFAULT_ASSISTANT_MODEL,
        keySource: paid.keySource,
        userId: uid,
        usage: paid.usage,
        iterations: paid.iterations,
        stopReason: paid.stopReason,
        path: "loop",
      });
    }
    if (!call.ok) return res.status(call.status).json({ error: call.error, engine });
    const parsed = parseJsonReply<any>(call.text, { reply: call.text || "I don't see that anywhere." });
    const reply = typeof parsed?.reply === "string" && parsed.reply.trim() ? parsed.reply.trim().slice(0, 2000) : "I don't see that anywhere.";
    await repo.addMessage(getPool(), { companionId: c.id, ownerUserId: uid, speaker: "companion", engine: "village", body: reply });

    let refusal: string | null = null;
    let drafted: string | null = null;
    if (parsed?.draft) {
      const week = await weekAhead(getPool(), { userId: uid, isAdmin: false }, 30).catch(() => []);
      const landed = await draftFromReply(e, c, parsed.draft, {
        memberMessage: text,
        messageId,
        knownEventIds: new Set(week.map((w) => w.id)),
        userIdForHandle: (h) => userIdForHandle(getPool(), h),
        roleExists: async (id) => (await repo.rosterFor(getPool(), [id])).has(id),
        proposeRsvp: proposeRsvpFor(uid),
      });
      if (landed && !landed.ok) refusal = landed.error;
      if (landed && landed.ok) drafted = landed.item.id;
    }
    res.json({ messages: await repo.recentMessages(getPool(), c.id, uid, 40), engine, drafted, refusal });
  });

  app.post("/api/me/companion-items/:id/answer", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await overLimit(`companion-yes:${user.id}`, YES_PER_HOUR, HOUR_MS)) return res.status(429).json({ error: "Try again in a little while." });
    const out = await answerQuestion(getPool(), String(user.id), String(req.params.id), req.body?.answer);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json({ success: true, status: out.item.status });
  });

  app.post("/api/me/companion-items/:id/decline", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await overLimit(`companion-yes:${user.id}`, YES_PER_HOUR, HOUR_MS)) return res.status(429).json({ error: "Try again in a little while." });
    const out = await declineItem(getPool(), String(user.id), String(req.params.id));
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    const md = out.item.draftKind === "rsvp" && typeof out.item.payload?.memberDraftId === "string" ? out.item.payload.memberDraftId : null;
    if (md) await decideMemberDraft(getPool(), String(user.id), md, "rejected");
    res.json({ success: true, status: out.item.status });
  });

  app.post("/api/me/companion-items/:id/confirm", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const uid = String(user.id);
    if (await overLimit(`companion-yes:${uid}`, YES_PER_HOUR, HOUR_MS)) return res.status(429).json({ error: "Try again in a little while." });
    const planned = await planConfirm(getPool(), uid, String(req.params.id), req.body?.edits);
    if (!planned.ok) return res.status(planned.status).json({ error: planned.error });
    if (!(await claimForDoor(getPool(), planned))) return res.status(409).json({ error: "That draft was already decided." });

    const done = await openDoor(app, req, uid, planned);
    if (!done.ok) {
      await releaseClaim(getPool(), planned);
      return res.status(done.status).json({ error: done.error });
    }
    await recordOutcome(getPool(), planned.item.id, done.outcomeRef);
    res.json({ success: true, kind: planned.kind, edited: planned.edited, outcome: done.outcomeRef, ...(done.mailto ? { mailto: done.mailto } : {}) });
  });

  /** Open the planned door. Every write here is a door the village already had. */
  async function openDoor(
    app: Express,
    req: Request,
    uid: string,
    planned: Extract<Planned, { ok: true }>,
  ): Promise<{ ok: true; outcomeRef: string; mailto?: string } | { ok: false; status: number; error: string }> {
    const plan = planned.plan;
    const pool = getPool();
    const refused = (r: { status: number; json: any }) => ({ ok: false as const, status: r.status, error: String(r.json?.error ?? r.json?.message ?? "That door said no.") });

    if (plan.way === "mail") return { ok: true, outcomeRef: "mailto", mailto: plan.mailto };

    // A purchase: the pay-back spend goes to whoever speaks for the circle.
    if (plan.way === "payback") {
      const handed = await handOffPurchase(env(), planned.item, plan);
      if (!handed.ok) return handed;
      return { ok: true, outcomeRef: `payback:${handed.landedId}` };
    }

    if (plan.way === "http") {
      const first = await throughDoor(app, req, plan.first);
      if (first.status >= 400) return refused(first);
      if (!plan.then) return { ok: true, outcomeRef: outcomeRefFrom(planned.kind, first.json) };
      const next = plan.then(first.json);
      if ("error" in next) return { ok: false, status: 409, error: next.error };
      const second = await throughDoor(app, req, next);
      if (second.status >= 400) return refused(second);
      return { ok: true, outcomeRef: outcomeRefFrom(planned.kind, second.json) };
    }

    if (plan.way === "rsvp") {
      let draftId = plan.memberDraftId;
      const fresh = plan.changed || !draftId;
      if (fresh) {
        const made = await proposeRsvpFor(uid)({ eventId: plan.eventId, status: plan.status, ...(plan.occurrenceKey ? { occurrenceKey: plan.occurrenceKey } : {}) });
        if (!made.ok) return { ok: false, status: 400, error: made.error };
        draftId = made.id;
      }
      const r = await throughDoor(app, req, { method: "POST", path: `/api/agent/drafts/${encodeURIComponent(String(draftId))}/confirm`, body: {} });
      if (r.status >= 400) {
        if (fresh) await decideMemberDraft(pool, uid, String(draftId), "rejected");
        return refused(r);
      }
      if (fresh && plan.memberDraftId) await decideMemberDraft(pool, uid, plan.memberDraftId, "rejected");
      if (fresh) await repo.setItemPayload(pool, planned.item.id, { ...planned.payload, memberDraftId: draftId });
      return { ok: true, outcomeRef: `rsvp:${draftId}` };
    }

    // The quest idea: the member form's own door, its lock and its allowance.
    const item = planned.item;
    const out = await withIdeaLock(pool, async (conn) => {
      if ((await openIdeas(conn, { member: uid })) >= OPEN_IDEAS_PER_MEMBER) return "full" as const;
      return proposeQuest(conn, {
        villageId: villageId(),
        moduleId: PROPOSE_QUEST_MODULE,
        batchId: `${MEMBER_BATCH_PREFIX}${item.id}`.slice(0, 64),
        batchCap: 1,
        prose: plan.prose,
        rationale: "Drafted by a companion and proposed with the member's yes.",
        quote: item.quote,
        sourceRef: `companion:${item.id}`,
        proposedBy: uid,
        proposedByKind: "human",
      });
    });
    if (out === "full") return { ok: false, status: 409, error: `You already have ${OPEN_IDEAS_PER_MEMBER} quest ideas waiting for review. One needs a decision first.` };
    if (!out.ok) return { ok: false, status: 400, error: out.error };
    return { ok: true, outcomeRef: `quest_proposal:${out.id}` };
  }
}
