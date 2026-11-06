/**
 * Messaging: N-party conversations, direct messages included.
 *
 * Eighteen routes, lifted out of server/index.ts unchanged:
 *
 *   GET    /api/messages                     the inbox
 *   GET    /api/messages/people              who this member may write to
 *   GET    /api/messages/unread              the menu's number, and nothing else
 *   POST   /api/messages/direct              open a one-to-one
 *   POST   /api/messages/groups              start a group
 *   GET    /api/messages/work/:kind/:id      is there a chat for this quest or task, for me
 *   POST   /api/messages/work/:kind/:id      open it (created when two people are on it)
 *   GET    /api/messages/:id                 one conversation and its messages
 *   POST   /api/messages/:id/messages        say something
 *   POST   /api/messages/:id/read            move the read mark
 *   PATCH  /api/messages/:id                 rename, or mute
 *   POST   /api/messages/:id/leave           leave
 *   POST   /api/messages/:id/members         add people
 *   DELETE /api/messages/:id/members/:userId remove one
 *   POST   /api/messages/:id/owner           hand the group on
 *   PATCH  /api/messages/:id/messages/:messageId   edit your own
 *   DELETE /api/messages/:id/messages/:messageId   withdraw your own
 *   POST   /api/messages/:id/messages/:messageId/report  raise a concern
 *   GET    /api/admin/messages/reports       the queue
 *   PUT    /api/admin/messages/reports/:id   close one
 *
 * WHY THIS IS ONE MODULE. Three helpers exist for these routes and nothing
 * else: `conversationTitle` (how a conversation is named for one viewer),
 * `requireConversation` (the membership check every read runs before it
 * answers) and `canSendMessages` (the stage-and-capability door on writing).
 * They came across with the routes, which is what makes this a module rather
 * than a folder.
 *
 * THE 404 IS THE POINT, and `requireConversation` is where it lives: a
 * non-member gets the same 404 a missing conversation gets, so a guessed id
 * never confirms that a conversation exists or who is in it. Anything added
 * here that answers before that helper has run reopens that hole.
 *
 * BOTH `app.use(..., requireModule("messaging"))` LINES MOVED WITH THE ROUTES
 * and stay first in register(). Express applies middleware in registration
 * order, so a `use` registered after its routes guards nothing.
 *
 * SHARED WORK CHATS (server/lib/sharedWork.ts). A quest or a task with two or
 * more people on it has one conversation whose members are exactly those
 * people, reconciled against the record on every read: `requireConversation`
 * syncs a shared-work thread BEFORE it checks membership, so somebody taken
 * off the work meets the same 404 as anybody else, on their very next request.
 * The inbox syncs the viewer's own work first, so a new chat is there when
 * they look. Membership is the record's, so adding, removing, handing on,
 * renaming and leaving are refused on these threads; muting is not.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order:
 * after the forum's moderation queue, before the village map's routes.
 */
import type express from "express";
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import { sortMembersByName } from "../../shared/memberOrder";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import {
  MAX_BODY_CHARS,
  addMembers as addConversationMembers,
  advanceRead,
  cleanText,
  conversationById,
  conversationFor,
  createGroup,
  editMessage,
  inboxFor,
  latestSeq,
  leaveConversation,
  membersOf,
  messagesFor,
  onMessageSent,
  openDirect,
  removeMember,
  renameConversation,
  reportMessage,
  sendMessage,
  setMuted,
  softDeleteMessage,
  totalUnreadFor,
  transferOwnership as transferConversationOwnership,
  type Conversation,
  type MemberSummary,
} from "../lib/messaging";
import { moduleActivity, requireModule } from "../lib/modules";
import { numberVar } from "../lib/variables";
import { isWorkConversation, isWorkKind, syncWork, workOf, type WorkDeps, type WorkKind } from "../lib/sharedWork";

/** Why a shared-work chat refuses membership changes. Muting stays open. */
const WORK_MEMBERSHIP_REFUSAL = "Everyone on the work is in this chat while they are on it. Mute it to quiet it";

type Deps = Pick<
  AppDeps,
  | "adminActor"
  | "authedUser"
  | "capabilityCtx"
  | "clientIp"
  | "firstName"
  | "guardCapability"
  | "isAdmin"
  | "members"
  | "notifyAdmins"
  | "notifyDeps"
  | "notifyReportReviewed"
  | "overLimit"
  | "getPool"
> &
  Partial<Pick<AppDeps, "lapseContext">>;

export function register(app: Express, deps: Deps): void {
  const {
    adminActor,
    authedUser,
    capabilityCtx,
    clientIp,
    firstName,
    guardCapability,
    isAdmin,
    members,
    notifyAdmins,
    notifyDeps,
    notifyReportReviewed,
    overLimit,
    getPool,
  } = deps;

  // ── Messaging: N-party conversations, direct messages included ────────────
  //
  // Every route here mounts behind requireModule('messaging'), and every read
  // authorizes on MEMBERSHIP before it answers. A non-member gets the same
  // 404 a missing conversation gets, so a guessed id never confirms that a
  // conversation exists or who is in it.
  app.use("/api/messages", requireModule("messaging"));
  app.use("/api/admin/messages", requireModule("messaging"));

  /**
   * How a conversation is titled for one viewer. A group carries its own
   * name; a direct thread is titled by whoever else is in it, resolved per
   * viewer because there is no single true name to store on the row.
   */
  function conversationTitle(conversation: Conversation, members: MemberSummary[], viewerId: string): string {
    if (conversation.kind !== "direct") return conversation.name ?? "Group conversation";
    const other = members.find((m) => m.userId !== viewerId);
    return other?.name ? firstName(other.name) : "A member";
  }

  /**
   * The shared-work chats read who is on the work through these. Addressable
   * means the same as for a direct thread: never an example identity, a
   * tombstone or an unclaimed account.
   */
  const workDeps: WorkDeps = {
    getPool,
    lapseContext: deps.lapseContext ? () => deps.lapseContext!() : undefined,
    isAddressable: async (id) => !!(await addressableMember(id)),
  };

  /** Bring a shared-work thread in line with its record. Never fails the read it rides on. */
  async function syncIfWork(conversationId: string): Promise<void> {
    const c = await conversationById(getPool(), conversationId);
    if (!c || !isWorkConversation(c) || !c.contextId) return;
    try {
      await syncWork(c.contextType as WorkKind, c.contextId, workDeps);
    } catch (e) {
      console.error("[messaging] could not sync the shared work chat", conversationId, e);
    }
  }

  /** Membership or nothing. The 404 body is identical for both misses. */
  async function requireConversation(req: express.Request, res: express.Response, user: any) {
    // A shared-work thread is synced first, so membership is read against who
    // is on the work NOW. Same 404 either way: the sync answers nothing itself.
    await syncIfWork(String(req.params.id));
    const found = await conversationFor(getPool(), String(req.params.id), user.id);
    if (!found) {
      res.status(404).json({ error: "Not found" });
      return null;
    }
    return found;
  }

  /**
   * The one capability gate, once, for every write path in this module.
   *
   * It covers renaming and member management as well as sending. A rename
   * reaches every member's inbox title and every notification email subject,
   * so it pushes text at people exactly the way a message does, and adding
   * someone hands them the whole thread's history. A warning badge's deny has
   * to reach all of it, or the suspension is one PATCH away from meaningless.
   *
   * What it deliberately does NOT cover: reading, muting, leaving, deleting
   * your own line, and reporting. Those are self-protective or
   * self-limiting, and a member under suspension must always be able to do
   * them.
   */
  async function canSendMessages(user: any): Promise<boolean> {
    return hasCapability("message.send", await capabilityCtx(user));
  }

  /**
   * Addressable members only: a present person (server/lib/memberPresence.ts),
   * which includes a member who signs in with Google and has no password.
   * Example identities, tombstones and unclaimed accounts are refused at the
   * door, because a conversation with one is a conversation nobody will read.
   */
  async function addressableMember(id: string): Promise<any | null> {
    const target = await members.byId(String(id));
    if (!target || !deps.notifyDeps.isPresent(target)) return null;
    return target;
  }

  app.get("/api/messages", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to see your messages" });
    // The viewer's shared work first: chats for work they just joined appear,
    // and chats for work they left stop listing them.
    try {
      const keys = await workOf(user.id, workDeps);
      for (const e of await inboxFor(getPool(), user.id)) {
        if (isWorkConversation(e.conversation) && e.conversation.contextId) {
          keys.push({ kind: e.conversation.contextType as WorkKind, id: e.conversation.contextId });
        }
      }
      const seen = new Set<string>();
      for (const k of keys) {
        const key = `${k.kind}:${k.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await syncWork(k.kind, k.id, workDeps);
      }
    } catch (e) {
      console.error("[messaging] could not sync shared work for", user.id, e);
    }
    const entries = await inboxFor(getPool(), user.id);
    res.json({
      unreadTotal: await totalUnreadFor(getPool(), user.id),
      conversations: entries.map((e) => ({
        id: e.conversation.id,
        kind: e.conversation.kind,
        title: conversationTitle(e.conversation, e.members, user.id),
        name: e.conversation.name,
        contextType: e.conversation.contextType,
        contextId: e.conversation.contextId,
        unreadCount: e.unreadCount,
        muted: e.muted,
        role: e.role,
        lastReadSeq: e.lastReadSeq,
        latestSeq: e.latestSeq,
        preview: e.preview,
        lastAuthorId: e.lastAuthorId,
        lastMessageAt: e.conversation.lastMessageAt,
        memberCount: e.members.filter((m) => !m.left).length,
        members: e.members.map((m) => ({
          userId: m.userId,
          name: m.name ? firstName(m.name) : null,
          handle: m.handle,
          role: m.role,
          left: m.left,
        })),
      })),
    });
  });

  /**
   * Who a member can write to, by search.
   *
   * A search, deliberately, instead of a directory endpoint: the composer
   * needs to resolve a name somebody already has in mind, and handing every
   * signed-in account the full roster in one call is a different feature with
   * a different privacy question. Registered BEFORE /api/messages/:id, or
   * Express would read "people" as a conversation id.
   */
  app.get("/api/messages/people", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (q.length < 2) return res.json([]);
    const all = await members.all();
    // SORTED BEFORE THE SLICE, and the slice is why it matters. This cut the
    // first ten matches out of join order, so on a village where eleven names
    // contain the query the ten oldest accounts answered and the newest member
    // could not be found at all. Ten alphabetical matches are at least the same
    // ten every time, and a searcher can tell what they are looking at.
    const matches = sortMembersByName(
      all
        .filter((u: any) => u.id !== user.id && deps.notifyDeps.isPresent(u))
        .filter(
          (u: any) =>
            String(u.name ?? "").toLowerCase().includes(q) ||
            String(u.handle ?? "").toLowerCase().includes(q),
        ),
    )
      .slice(0, 10)
      .map((u: any) => ({ userId: u.id, name: firstName(u.name ?? "Member"), handle: u.handle ?? null }));
    res.json(matches);
  });

  /**
   * The menu's number: one COUNT, nothing else, so the avatar menu can ask
   * every time it opens without paying for the whole inbox. Registered before
   * /api/messages/:id, or Express would read "unread" as a conversation id.
   */
  app.get("/api/messages/unread", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    res.json({ unreadTotal: await totalUnreadFor(getPool(), user.id) });
  });

  /** Open (or reopen) the direct thread with one other member. */
  app.post("/api/messages/direct", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to send a message" });
    if (!(await canSendMessages(user))) {
      return res.status(403).json({ error: "Messaging opens at the member stage" });
    }
    const targetId = String(req.body?.userId ?? "");
    if (!targetId || targetId === user.id) {
      return res.status(400).json({ error: "Name someone else to write to" });
    }
    if (await overLimit(`msg-open:${user.id}`, 20, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "That is a lot of new conversations at once. Give it a few minutes" });
    }
    if (!(await addressableMember(targetId))) {
      return res.status(404).json({ error: "No member with that id" });
    }
    const conversation = await openDirect(getPool(), user.id, targetId);
    const roster = await membersOf(getPool(), conversation.id);
    res.json({
      id: conversation.id,
      kind: conversation.kind,
      title: conversationTitle(conversation, roster, user.id),
    });
  });

  /** A named group thread. The creator owns it and is always in it. */
  app.post("/api/messages/groups", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to start a conversation" });
    if (!(await canSendMessages(user))) {
      return res.status(403).json({ error: "Messaging opens at the member stage" });
    }
    if (await overLimit(`msg-open:${user.id}`, 20, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "That is a lot of new conversations at once. Give it a few minutes" });
    }
    const name = cleanText(req.body?.name);
    if (!name) return res.status(400).json({ error: "Give the conversation a name" });
    const requested: string[] = Array.isArray(req.body?.memberIds) ? req.body.memberIds.map(String) : [];
    const wanted: string[] = Array.from(new Set(requested.filter((id) => id && id !== user.id)));
    if (!wanted.length) return res.status(400).json({ error: "Choose at least one other person" });
    const cap = Math.max(2, numberVar("messaging.max_members"));
    if (wanted.length + 1 > cap) {
      return res.status(400).json({ error: `A group conversation holds up to ${cap} people` });
    }
    for (const id of wanted) {
      if (!(await addressableMember(id))) return res.status(400).json({ error: "One of those members does not exist" });
    }
    const conversation = await createGroup(getPool(), { createdBy: user.id, name, memberIds: wanted });
    res.json({ id: conversation.id, kind: conversation.kind, title: conversation.name });
  });

  /**
   * The chat for a quest or a task, as the Chat button asks about it. Answers
   * only about the viewer's own place in it: `available` is true when they are
   * on the work and it has two or more people. Somebody not on the work gets
   * the same answer as for work that does not exist, and never a member list.
   */
  app.get("/api/messages/work/:kind/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const kind = String(req.params.kind);
    if (!isWorkKind(kind)) return res.status(404).json({ error: "Not found" });
    const synced = await syncWork(kind, String(req.params.id), workDeps);
    const on = !!synced.work && synced.work.people.includes(user.id);
    const member = on && synced.conversation ? await conversationFor(getPool(), synced.conversation.id, user.id) : null;
    res.json({
      available: !!member,
      conversationId: member ? member.conversation.id : null,
      people: on && synced.work ? synced.work.people.length : 0,
    });
  });

  /** Open the chat for a quest or a task, or the same 404 for anybody not in it. */
  app.post("/api/messages/work/:kind/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const kind = String(req.params.kind);
    if (!isWorkKind(kind)) return res.status(404).json({ error: "Not found" });
    const synced = await syncWork(kind, String(req.params.id), workDeps);
    const member = synced.conversation ? await conversationFor(getPool(), synced.conversation.id, user.id) : null;
    if (!member) return res.status(404).json({ error: "Not found" });
    res.json({ id: member.conversation.id, kind: member.conversation.kind, title: member.conversation.name });
  });

  /** One thread: membership proven first, then a page of its messages. */
  app.get("/api/messages/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to read your messages" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    const before = req.query.before ? Number(req.query.before) : undefined;
    const page = await messagesFor(getPool(), found.conversation.id, { before, limit: 50 });
    const roster = await membersOf(getPool(), found.conversation.id);
    const byId = new Map(roster.map((m) => [m.userId, m]));
    res.json({
      id: found.conversation.id,
      kind: found.conversation.kind,
      name: found.conversation.name,
      title: conversationTitle(found.conversation, roster, user.id),
      contextType: found.conversation.contextType,
      contextId: found.conversation.contextId,
      role: found.membership.role,
      muted: found.membership.muted,
      lastReadSeq: found.membership.lastReadSeq,
      latestSeq: await latestSeq(getPool(), found.conversation.id),
      members: roster.map((m) => ({
        userId: m.userId,
        name: m.name ? firstName(m.name) : null,
        handle: m.handle,
        role: m.role,
        left: m.left,
      })),
      messages: page.map((m) => ({
        id: m.id,
        seq: m.seq,
        body: m.body,
        deleted: !!m.deletedAt,
        mine: m.authorId === user.id,
        author: {
          userId: m.authorId,
          name: byId.get(m.authorId)?.name ? firstName(String(byId.get(m.authorId)?.name)) : "A member",
          handle: byId.get(m.authorId)?.handle ?? null,
        },
        createdAt: m.createdAt,
        editedAt: m.editedAt,
      })),
    });
  });

  app.post("/api/messages/:id/messages", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to send a message" });
    if (!(await canSendMessages(user))) {
      return res.status(403).json({ error: "Messaging opens at the member stage" });
    }
    const perMinute = Math.max(1, numberVar("messaging.sends_per_minute"));
    if (await overLimit(`msg-send:${user.id}`, perMinute, 60 * 1000)) {
      return res.status(429).json({ error: "Slow down a little. Try again in a minute" });
    }
    // A second bucket on the address, so one compromised token cannot spray
    // the village from a script the way a single-bucket guard allows.
    if (await overLimit(`msg-send-ip:${clientIp(req)}`, perMinute * 4, 60 * 1000)) {
      return res.status(429).json({ error: "Slow down a little. Try again in a minute" });
    }
    const found = await requireConversation(req, res, user);
    if (!found) return;
    const body = cleanText(req.body?.body);
    if (!body) return res.status(400).json({ error: "Say something" });
    if (body.length > MAX_BODY_CHARS) {
      return res.status(400).json({ error: `A message holds up to ${MAX_BODY_CHARS} characters` });
    }
    const message = await sendMessage(getPool(), {
      conversationId: found.conversation.id,
      authorId: user.id,
      body,
    });
    const who = firstName(user.name ?? "A member");
    await onMessageSent(notifyDeps, {
      conversation: found.conversation,
      message,
      author: { id: user.id, name: user.name },
      titleFor: () =>
        found.conversation.kind === "direct"
          ? `${who} sent you a message`
          : `${who} wrote in "${String(found.conversation.name ?? "your conversation").slice(0, 60)}"`,
    });
    // No moduleActivity call, deliberately: a private conversation is not
    // village news, and the Pulse is a public surface.
    res.json({ id: message.id, seq: message.seq, createdAt: message.createdAt });
  });

  /** Advance this member's read mark. Monotonic in the repo layer. */
  app.post("/api/messages/:id/read", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    // A body-less call means "everything". advanceRead clamps to the newest
    // seq this conversation actually holds, so asking for everything and
    // asking for a specific position go through exactly one code path.
    const requested = Number(req.body?.seq);
    const target = Number.isFinite(requested) ? requested : Number.MAX_SAFE_INTEGER;
    const lastReadSeq = await advanceRead(getPool(), found.conversation.id, user.id, target);
    res.json({ lastReadSeq, unreadTotal: await totalUnreadFor(getPool(), user.id) });
  });

  /** Mute, or rename a group. Direct threads have no name to set. */
  app.patch("/api/messages/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    if (req.body?.muted !== undefined) {
      await setMuted(getPool(), found.conversation.id, user.id, !!req.body.muted);
    }
    if (req.body?.name !== undefined) {
      if (isWorkConversation(found.conversation)) {
        return res.status(400).json({ error: "A shared work chat is titled by the work" });
      }
      if (found.conversation.kind === "direct") {
        return res.status(400).json({ error: "A direct conversation is titled by who is in it" });
      }
      if (found.membership.role !== "owner") {
        return res.status(403).json({ error: "Only the conversation's owner can rename it" });
      }
      if (!(await canSendMessages(user))) {
        return res.status(403).json({ error: "Messaging is suspended for this account" });
      }
      const name = cleanText(req.body.name);
      if (!name) return res.status(400).json({ error: "Give the conversation a name" });
      await renameConversation(getPool(), found.conversation.id, name);
    }
    res.json({ success: true });
  });

  /** Anyone may leave, always. Ownership passes on in the repo layer. */
  app.post("/api/messages/:id/leave", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    if (isWorkConversation(found.conversation)) {
      return res.status(400).json({ error: WORK_MEMBERSHIP_REFUSAL });
    }
    await leaveConversation(getPool(), found.conversation.id, user.id);
    res.json({ success: true });
  });

  app.post("/api/messages/:id/members", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    if (isWorkConversation(found.conversation)) {
      return res.status(400).json({ error: WORK_MEMBERSHIP_REFUSAL });
    }
    if (found.conversation.kind === "direct") {
      return res.status(400).json({ error: "A direct conversation holds exactly two people. Start a group instead" });
    }
    if (found.membership.role !== "owner") {
      return res.status(403).json({ error: "Only the conversation's owner can add people" });
    }
    if (!(await canSendMessages(user))) {
      return res.status(403).json({ error: "Messaging is suspended for this account" });
    }
    const requested: string[] = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];
    const wanted: string[] = Array.from(new Set(requested.filter((id) => !!id)));
    if (!wanted.length) return res.status(400).json({ error: "Choose someone to add" });
    const roster = await membersOf(getPool(), found.conversation.id);
    const live = roster.filter((m) => !m.left).length;
    const cap = Math.max(2, numberVar("messaging.max_members"));
    if (live + wanted.length > cap) {
      return res.status(400).json({ error: `A group conversation holds up to ${cap} people` });
    }
    for (const id of wanted) {
      if (!(await addressableMember(id))) return res.status(400).json({ error: "One of those members does not exist" });
    }
    const added = await addConversationMembers(getPool(), found.conversation.id, wanted);
    res.json({ success: true, added });
  });

  app.delete("/api/messages/:id/members/:userId", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    if (isWorkConversation(found.conversation)) {
      return res.status(400).json({ error: WORK_MEMBERSHIP_REFUSAL });
    }
    if (found.conversation.kind === "direct") {
      return res.status(400).json({ error: "Neither person can remove the other from a direct conversation" });
    }
    if (found.membership.role !== "owner") {
      return res.status(403).json({ error: "Only the conversation's owner can remove people" });
    }
    if (!(await canSendMessages(user))) {
      return res.status(403).json({ error: "Messaging is suspended for this account" });
    }
    if (String(req.params.userId) === user.id) {
      return res.status(400).json({ error: "Use leave to take yourself out" });
    }
    const removed = await removeMember(getPool(), found.conversation.id, String(req.params.userId));
    if (!removed) return res.status(404).json({ error: "That person is not in this conversation" });
    res.json({ success: true });
  });

  app.post("/api/messages/:id/owner", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    if (isWorkConversation(found.conversation)) {
      return res.status(400).json({ error: WORK_MEMBERSHIP_REFUSAL });
    }
    if (found.conversation.kind === "direct") {
      return res.status(400).json({ error: "A direct conversation has no owner" });
    }
    if (found.membership.role !== "owner") {
      return res.status(403).json({ error: "Only the conversation's owner can hand it on" });
    }
    if (!(await canSendMessages(user))) {
      return res.status(403).json({ error: "Messaging is suspended for this account" });
    }
    const toUserId = String(req.body?.userId ?? "");
    if (!toUserId || toUserId === user.id) return res.status(400).json({ error: "Name another member of this conversation" });
    const ok = await transferConversationOwnership(getPool(), found.conversation.id, user.id, toUserId);
    if (!ok) return res.status(400).json({ error: "That person is not in this conversation" });
    res.json({ success: true });
  });

  /**
   * Only the author edits their own line, and the edit shows.
   *
   * Behind message.send, unlike deleting: an edit puts NEW text in front of
   * people, so a member whose sending was suspended by a warning badge must
   * not reach it, or the suspension is one PATCH away from meaningless.
   * Deleting your own words stays available under suspension, because
   * removing text is self-limiting.
   */
  app.patch("/api/messages/:id/messages/:messageId", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await canSendMessages(user))) {
      return res.status(403).json({ error: "Messaging is suspended for this account" });
    }
    const perMinute = Math.max(1, numberVar("messaging.sends_per_minute"));
    if (await overLimit(`msg-send:${user.id}`, perMinute, 60 * 1000)) {
      return res.status(429).json({ error: "Slow down a little. Try again in a minute" });
    }
    const found = await requireConversation(req, res, user);
    if (!found) return;
    const body = cleanText(req.body?.body);
    if (!body) return res.status(400).json({ error: "Say something" });
    if (body.length > MAX_BODY_CHARS) {
      return res.status(400).json({ error: `A message holds up to ${MAX_BODY_CHARS} characters` });
    }
    const edited = await editMessage(getPool(), found.conversation.id, String(req.params.messageId), user.id, body);
    // Same 404 as deleting, and for the same reason: a tombstone and a
    // message that was never yours are both "no message of yours with that
    // id" from here, and telling them apart would say something about a
    // conversation the caller may only be guessing at.
    if (!edited) return res.status(404).json({ error: "No message of yours with that id" });
    // No notification, deliberately. An edit is not a new message, and
    // re-ringing everyone for a typo fix is how a thread teaches people to
    // mute it.
    res.json({ success: true });
  });

  /** Only the author removes their own line, and it leaves a tombstone. */
  app.delete("/api/messages/:id/messages/:messageId", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    const gone = await softDeleteMessage(getPool(), found.conversation.id, String(req.params.messageId), user.id);
    if (!gone) return res.status(404).json({ error: "No message of yours with that id" });
    res.json({ success: true });
  });

  /** Every thread inherits a report path. Reports go to a human. */
  app.post("/api/messages/:id/messages/:messageId/report", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
    const [target] = await getPool().query<any[]>(
      "SELECT id FROM messages WHERE id = ? AND conversation_id = ?",
      [String(req.params.messageId), found.conversation.id],
    );
    if (!target[0]) return res.status(404).json({ error: "No message with that id" });
    const outcome = await reportMessage(getPool(), {
      conversationId: found.conversation.id,
      messageId: String(req.params.messageId),
      reporterId: user.id,
      reason: req.body?.reason ?? null,
    });
    if (outcome.fresh) {
      // Admin audience: a report on a private conversation is moderation
      // business, and it never belongs on the public Pulse.
      await recordEvent(getPool(), {
        kind: "message_report",
        text: `${firstName(user.name)} reported a message`,
        actorUserId: user.id,
        entityType: "conversation",
        entityRef: found.conversation.id,
        audience: "admin",
      });
      /*
       * And the people who can act are told. The Pulse event above is a trail
       * an admin has to go looking for; this is the one that arrives.
       *
       * PRIVACY. The alert names nobody and quotes nothing. A report inside a
       * private thread is the case where a notification preview on a locked
       * phone would leak the most, so the line says a report is waiting and
       * the queue behind the admin gate holds everything else. Only a FRESH
       * report rings, so a member pressing the flag twice cannot ring twice.
       */
      await notifyAdmins(
        "moderation",
        "A reported message is waiting for review",
        `message-report:${String(req.params.messageId)}:${user.id}`,
        "/admin?tab=message-reports",
      );
    }
    res.json({ success: true, fresh: outcome.fresh });
  });

  /**
   * The moderation queue. Reports carry WHO and WHERE; the message body is
   * shown so a moderator can judge it, which is the only reason an admin
   * reads inside a private conversation at all.
   */
  app.get("/api/admin/messages/reports", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const status = ["open", "resolved", "dismissed"].includes(String(req.query.status))
      ? String(req.query.status)
      : "open";
    const [rows] = await getPool().query<any[]>(
      "SELECT r.id, r.conversation_id, r.message_id, r.reporter_id, r.reason, r.status, r.created_at, " +
        "r.resolved_at, ru.name AS resolved_by_name, " +
        "m.body, m.author_id, m.deleted_at, c.kind, c.name, u.name AS reporter_name " +
        "FROM message_reports r " +
        "LEFT JOIN messages m ON m.id = r.message_id " +
        "LEFT JOIN conversations c ON c.id = r.conversation_id " +
        "LEFT JOIN users u ON u.id = r.reporter_id " +
        "LEFT JOIN users ru ON ru.id = r.resolved_by " +
        "WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100",
      [status],
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        conversationKind: r.kind,
        conversationName: r.name,
        messageId: r.message_id,
        body: r.deleted_at ? "" : r.body,
        deleted: !!r.deleted_at,
        authorId: r.author_id,
        reporter: r.reporter_name ?? "a member",
        reason: r.reason,
        status: r.status,
        at: new Date(r.created_at).toISOString(),
        // The steward who closed it, and when. Written since the queue
        // shipped and read by nobody until now. A password-only admin leaves
        // a null id, so the name falls back to a role.
        resolvedBy: r.resolved_at ? (r.resolved_by_name ?? "a steward") : null,
        resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
      })),
    );
  });

  app.put("/api/admin/messages/reports/:id", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const status = String(req.body?.status ?? "");
    if (!["resolved", "dismissed"].includes(status)) {
      return res.status(400).json({ error: "status must be resolved or dismissed" });
    }
    // Read the reporter BEFORE the update, so the person who raised this can
    // be told it was looked at.
    const [[before]] = await getPool().query<any[]>("SELECT reporter_id FROM message_reports WHERE id = ?", [req.params.id]);
    const [r]: any = await getPool().query(
      "UPDATE message_reports SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'",
      [status, adminActor(req)?.id ?? null, req.params.id],
    );
    if (!r.affectedRows) return res.status(404).json({ error: "No open report with that id" });
    if (before?.reporter_id) await notifyReportReviewed(String(before.reporter_id), req.params.id, "message");
    res.json({ success: true });
  });
}
