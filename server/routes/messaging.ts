/**
 * Messaging: N-party conversations, direct messages included.
 *
 * Eighteen routes, lifted out of server/index.ts unchanged:
 *
 *   GET    /api/messages                     the inbox
 *   GET    /api/messages/people              who this member may write to
 *   POST   /api/messages/direct              open a one-to-one
 *   POST   /api/messages/groups              start a group
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
>;

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

  /** Membership or nothing. The 404 body is identical for both misses. */
  async function requireConversation(req: express.Request, res: express.Response, user: any) {
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
    await leaveConversation(getPool(), found.conversation.id, user.id);
    res.json({ success: true });
  });

  app.post("/api/messages/:id/members", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const found = await requireConversation(req, res, user);
    if (!found) return;
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
