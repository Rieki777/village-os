/**
 * The messaging substrate: N-party conversations, membership, messages, and
 * per-member read state. Direct messages are the two-party case of the same
 * table, and there is deliberately no second code path for them.
 *
 * The rules that hold this together, each of which cost somebody a session
 * somewhere:
 *
 *  - EVERY read authorizes on membership, and a non-member gets the SAME 404
 *    a missing conversation gets. A conversation id in a URL proves nothing,
 *    and a 403 would confirm the thread exists to whoever guessed the id.
 *
 *  - Read state is per MEMBER, not per message: last_read_seq is one integer,
 *    so an unread count is one comparison and never grows with volume.
 *    Advances are monotonic (GREATEST), so a slow request carrying a stale
 *    seq can never rewind someone's inbox back to unread.
 *
 *  - last_message_at is a CACHE, held to the token_balances rule: recomputed
 *    from messages after each insert, never incremented. auditLastMessageAt()
 *    re-derives every row and reports drift instead of trusting the increment.
 *
 *  - One notification per unread RUN per recipient, not one per message. The
 *    dedupe key carries the recipient's last_read_seq, so a busy thread
 *    collapses to a single row and reading it re-arms the next one.
 *
 *  - Deletion is a tombstone. The row keeps its seq, so nobody's unread count
 *    moves because someone else removed a line.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { insertNotification, type NotifyDeps } from "./notify";

/** Bodies longer than this are refused, never silently truncated. */
export const MAX_BODY_CHARS = 4000;
/** Conversation names are a label, not a paragraph. */
export const MAX_NAME_CHARS = 120;
/** What the inbox and the notification carry as a taste of the message. */
export const PREVIEW_CHARS = 140;

export type ConversationKind = "direct" | "group" | "crew";
export type MemberRole = "owner" | "member";

export interface Conversation {
  id: string;
  kind: ConversationKind;
  name: string | null;
  contextType: string | null;
  contextId: string | null;
  createdBy: string;
  createdAt: string;
  lastMessageAt: string | null;
}

export interface Membership {
  conversationId: string;
  userId: string;
  role: MemberRole;
  lastReadSeq: number;
  muted: boolean;
  joinedAt: string;
}

export interface Message {
  id: string;
  seq: number;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

// ── Pure helpers (unit-tested without a database) ────────────────────────────

/**
 * Message and name text, cleaned the way display names are: control
 * characters out, runs of blank lines collapsed, edges trimmed. Bodies are
 * stored as the member typed them otherwise, and every render path escapes
 * (React by default, escapeHtml on the email path in notify.ts). Storing
 * pre-escaped text instead would double-escape the moment a second surface
 * renders it.
 */
export function cleanText(input: unknown): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    // C0/C1 controls out, tab and newline kept.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    // Zero-width characters, line/paragraph separators, and the bidi
    // overrides. These render as nothing and can make a stored message
    // display in an order nobody typed, which is a spoofing surface on a
    // screen two people are trusting.
    .replace(/[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/**
 * The dedupe key for a direct thread, NOT NULL and stable whichever member
 * opens it first. Non-direct conversations key on their own id, which is
 * already unique, so one unique index serves both without a shared sentinel
 * that every group row would collide on.
 */
export function directKeyFor(userA: string, userB: string): string {
  const [a, b] = [String(userA), String(userB)].sort();
  return `d:${a}|${b}`;
}

/** One notification per unread RUN per recipient. See the header note. */
export function messageDedupeKey(conversationId: string, recipientId: string, lastReadSeq: number): string {
  return `msg:${conversationId}:${recipientId}:${Math.max(0, Math.trunc(lastReadSeq))}`;
}

/** Inbox and notification taste of a message, tombstones included. */
export function previewOf(body: string, deletedAt: string | Date | null): string {
  if (deletedAt) return "Message deleted";
  const flat = cleanText(body).replace(/\s+/g, " ");
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

/**
 * The epoch-ms segment here is DECIMAL, and it used to be load-bearing.
 *
 * Until 0074 the inbox's tie-break was `c.id DESC`, which only meant "newest
 * first" because `Date.now()` renders as a fixed-width 13-digit decimal
 * (through 2286), making lexicographic DESC equal chronological DESC. This
 * file is the odd one out in doing that: the other four `newId`
 * implementations in `server/lib` (orgChart, orgDrafts, orgRelations,
 * seasonPatterns) all use `Date.now().toString(36)`, which is variable-width
 * and would have sorted a shorter string above a later time.
 *
 * 0074 moved the ordering onto `last_message_seq`, so the correctness of the
 * inbox no longer rests on this format. The id now only separates
 * conversations nobody has spoken in yet, where any stable order will do.
 * Kept decimal anyway, because ids of both shapes are already in the table and
 * changing the format now would make a column that sorts two different ways
 * depending on when the row was written.
 */
function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function iso(v: any): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function rowToConversation(r: RowDataPacket): Conversation {
  return {
    id: String(r.id),
    kind: String(r.kind) as ConversationKind,
    name: r.name ?? null,
    contextType: r.context_type ?? null,
    contextId: r.context_id ?? null,
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at) ?? "",
    lastMessageAt: iso(r.last_message_at),
  };
}

// ── Membership: the one authorization ────────────────────────────────────────

/**
 * The gate every read and write goes through. Returns null for a conversation
 * that does not exist AND for one this member is not in, so callers cannot
 * accidentally tell the two apart in a response.
 *
 * A member who left keeps their row (their history stays theirs) but is not a
 * member for any purpose here.
 */
export async function membershipOf(
  pool: Pool,
  conversationId: string,
  userId: string,
): Promise<Membership | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT conversation_id, user_id, role, last_read_seq, muted, joined_at FROM conversation_members " +
      "WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL",
    [conversationId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    conversationId: String(r.conversation_id),
    userId: String(r.user_id),
    role: r.role === "owner" ? "owner" : "member",
    lastReadSeq: Number(r.last_read_seq ?? 0),
    muted: Number(r.muted ?? 0) === 1,
    joinedAt: iso(r.joined_at) ?? "",
  };
}

/** The conversation, only if this member is in it. Null covers both misses. */
export async function conversationFor(
  pool: Pool,
  conversationId: string,
  userId: string,
): Promise<{ conversation: Conversation; membership: Membership } | null> {
  const membership = await membershipOf(pool, conversationId, userId);
  if (!membership) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, kind, name, context_type, context_id, created_by, created_at, last_message_at " +
      "FROM conversations WHERE id = ?",
    [conversationId],
  );
  if (!rows[0]) return null;
  return { conversation: rowToConversation(rows[0]), membership };
}

export interface MemberSummary {
  userId: string;
  role: MemberRole;
  name: string | null;
  handle: string | null;
  left: boolean;
}

/** Everyone in a thread, those who left included so old lines keep a name. */
export async function membersOf(pool: Pool, conversationId: string): Promise<MemberSummary[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT m.user_id, m.role, m.left_at, u.name, u.handle FROM conversation_members m " +
      "LEFT JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY m.joined_at, m.user_id",
    [conversationId],
  );
  return rows.map((r) => ({
    userId: String(r.user_id),
    role: r.role === "owner" ? "owner" : "member",
    name: r.name ?? null,
    handle: r.handle ?? null,
    left: !!r.left_at,
  }));
}

// ── Opening conversations ────────────────────────────────────────────────────

/**
 * Open (or reopen) the direct thread between two members. Deduped on the
 * sorted pair, so opening a DM twice from either side lands in the same
 * conversation, and a member who left it rejoins the thread they already have
 * rather than starting a second one beside it.
 */
export async function openDirect(
  pool: Pool,
  userA: string,
  userB: string,
  /** Retry budget for the race below. Bounded so a pathological state
   *  surfaces as an error instead of spinning. */
  attemptsLeft = 2,
): Promise<Conversation> {
  if (String(userA) === String(userB)) throw new Error("a direct conversation needs two different people");
  const key = directKeyFor(userA, userB);
  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id, kind, name, context_type, context_id, created_by, created_at, last_message_at " +
      "FROM conversations WHERE direct_key = ?",
    [key],
  );
  if (existing[0]) {
    const conversation = rowToConversation(existing[0]);
    // Either side may have left. Rejoining is the act of opening it again.
    //
    // An upsert rather than an UPDATE, so this also repairs the one state the
    // retry below can observe: the loser of a create race reads the winner's
    // conversation row a moment before the winner has finished writing its
    // member rows, and an UPDATE would touch nothing and hand back a thread
    // the caller is not yet in.
    for (const uid of [userA, userB]) {
      await pool.query(
        "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?,?,'member') " +
          "ON DUPLICATE KEY UPDATE left_at = NULL",
        [conversation.id, uid],
      );
    }
    return conversation;
  }

  const id = newId("cnv");
  try {
    await pool.query(
      "INSERT INTO conversations (id, kind, name, created_by, direct_key) VALUES (?,?,?,?,?)",
      [id, "direct", null, userA, key],
    );
  } catch (e: any) {
    // Two devices tapped Message at once. The unique index decided; read back
    // the winner instead of handing the loser an error.
    if (e?.code === "ER_DUP_ENTRY" && attemptsLeft > 0) {
      return openDirect(pool, userA, userB, attemptsLeft - 1);
    }
    throw e;
  }
  for (const uid of [userA, userB]) {
    await pool.query(
      "INSERT IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?,?,?)",
      [id, uid, "member"],
    );
  }
  const opened = await conversationById(pool, id);
  if (!opened) throw new Error("conversation vanished immediately after insert");
  return opened;
}

/** Unauthorized read, for internal callers that have already checked membership. */
export async function conversationById(pool: Pool, id: string): Promise<Conversation | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, kind, name, context_type, context_id, created_by, created_at, last_message_at " +
      "FROM conversations WHERE id = ?",
    [id],
  );
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export interface CreateGroupInput {
  createdBy: string;
  name: string;
  memberIds: string[];
  kind?: "group" | "crew";
  contextType?: string | null;
  contextId?: string | null;
}

/**
 * A named group thread. The creator is its owner and is always a member,
 * whether or not they listed themselves. Group names are required: a group
 * with no name is a direct thread that lost track of how many people are in
 * it.
 */
export async function createGroup(pool: Pool, input: CreateGroupInput): Promise<Conversation> {
  const name = cleanText(input.name).slice(0, MAX_NAME_CHARS);
  if (!name) throw new Error("a group conversation needs a name");
  const id = newId("cnv");
  const members = Array.from(new Set([String(input.createdBy), ...input.memberIds.map(String)]));
  await pool.query(
    "INSERT INTO conversations (id, kind, name, context_type, context_id, created_by, direct_key) VALUES (?,?,?,?,?,?,?)",
    [
      id,
      input.kind ?? "group",
      name,
      input.contextType ?? null,
      input.contextId ?? null,
      input.createdBy,
      // Non-direct rows key on their own id: unique by construction, NOT NULL
      // like the index demands, and never colliding with another group's.
      id,
    ],
  );
  for (const uid of members) {
    await pool.query(
      "INSERT IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?,?,?)",
      [id, uid, uid === String(input.createdBy) ? "owner" : "member"],
    );
  }
  const created = await conversationById(pool, id);
  if (!created) throw new Error("conversation vanished immediately after insert");
  return created;
}

/** Rename a group. Direct threads have no name to set. */
export async function renameConversation(pool: Pool, conversationId: string, name: string): Promise<string> {
  const clean = cleanText(name).slice(0, MAX_NAME_CHARS);
  if (!clean) throw new Error("a group conversation needs a name");
  await pool.query("UPDATE conversations SET name = ? WHERE id = ? AND kind <> 'direct'", [clean, conversationId]);
  return clean;
}

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * The cache rule, stated once: both columns are RECOMPUTED from messages,
 * never incremented or set to "now". Tombstones count, because a conversation
 * that was active at that moment really was.
 *
 * TWO columns, and they move together or not at all. `last_message_seq` is
 * what the inbox actually orders by (0074); `last_message_at` is what it
 * DISPLAYS. Writing one without the other is the failure this module has to
 * stay clear of, because it produces an inbox that sorts on one truth and
 * renders another, with no error and no failing test. One statement, so there
 * is no window where a caller could see them disagree.
 */
export async function recomputeLastMessageAt(pool: Pool, conversationId: string): Promise<void> {
  await pool.query(
    "UPDATE conversations SET " +
      "last_message_at = (SELECT MAX(created_at) FROM messages WHERE conversation_id = ?), " +
      "last_message_seq = (SELECT MAX(seq) FROM messages WHERE conversation_id = ?) " +
      "WHERE id = ?",
    [conversationId, conversationId, conversationId],
  );
}

/**
 * Post to a conversation. The caller has already proven membership and the
 * capability; this is the write.
 *
 * The author's own read state advances to their own message, so writing in a
 * thread never leaves you with an unread badge for your own words.
 */
export async function sendMessage(
  pool: Pool,
  input: { conversationId: string; authorId: string; body: string },
): Promise<Message> {
  const body = cleanText(input.body);
  if (!body) throw new Error("a message needs a body");
  if (body.length > MAX_BODY_CHARS) throw new Error(`a message may be at most ${MAX_BODY_CHARS} characters`);
  const id = newId("msg");
  await pool.query(
    "INSERT INTO messages (id, conversation_id, author_id, body) VALUES (?,?,?,?)",
    [id, input.conversationId, input.authorId, body],
  );
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, seq, conversation_id, author_id, body, created_at, edited_at, deleted_at FROM messages WHERE id = ?",
    [id],
  );
  const message = rowToMessage(rows[0]);
  await recomputeLastMessageAt(pool, input.conversationId);
  await pool.query(
    "UPDATE conversation_members SET last_read_seq = GREATEST(last_read_seq, ?) WHERE conversation_id = ? AND user_id = ?",
    [message.seq, input.conversationId, input.authorId],
  );
  return message;
}

function rowToMessage(r: RowDataPacket): Message {
  return {
    id: String(r.id),
    seq: Number(r.seq),
    conversationId: String(r.conversation_id),
    authorId: String(r.author_id),
    body: r.deleted_at ? "" : String(r.body),
    createdAt: iso(r.created_at) ?? "",
    editedAt: iso(r.edited_at),
    deletedAt: iso(r.deleted_at),
  };
}

/**
 * A page of a thread, oldest last. `before` pages backwards by seq. Deleted
 * rows come back as tombstones with an empty body, so the thread never grows
 * a hole where a line used to be.
 */
export async function messagesFor(
  pool: Pool,
  conversationId: string,
  opts: { before?: number; limit?: number } = {},
): Promise<Message[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  const params: any[] = [conversationId];
  let where = "conversation_id = ?";
  if (opts.before && Number.isFinite(opts.before)) {
    where += " AND seq < ?";
    params.push(Math.trunc(opts.before));
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, seq, conversation_id, author_id, body, created_at, edited_at, deleted_at FROM messages ` +
      `WHERE ${where} ORDER BY seq DESC LIMIT ${limit}`,
    params,
  );
  return rows.map(rowToMessage).reverse();
}

/**
 * Edit your own line, and wear the mark for it.
 *
 * `edited_at` shipped in 0066 and nothing wrote it, which is CLAUDE.md's trap
 * 12 turned inside out: a column that promises a feature the code never
 * delivers. Either wire it or drop it; this wires it.
 *
 * Scoped by conversation id for the same reason softDeleteMessage is, and
 * refused on a tombstone: editing a deleted message would un-delete it in
 * every surface that reads the body while the tombstone flag stayed set.
 *
 * The edit marker is PUBLIC and permanent, the posture the forum already
 * takes. A message that can change after it was read, with no sign it
 * changed, is a different and worse thing than one that cannot change at all.
 */
export async function editMessage(
  pool: Pool,
  conversationId: string,
  messageId: string,
  authorId: string,
  body: string,
): Promise<boolean> {
  const clean = cleanText(body);
  if (!clean) throw new Error("a message needs a body");
  if (clean.length > MAX_BODY_CHARS) throw new Error(`a message may be at most ${MAX_BODY_CHARS} characters`);
  // CURRENT_TIMESTAMP, not CURRENT_TIMESTAMP(3): edited_at is still the
  // whole-second column 0066 declared, because 0073 raised precision only on
  // the three columns that ORDER things. This one is displayed, never sorted
  // by, so writing thousandths would just be rounded away at the door.
  const [r]: any = await pool.query(
    "UPDATE messages SET body = ?, edited_at = CURRENT_TIMESTAMP " +
      "WHERE id = ? AND conversation_id = ? AND author_id = ? AND deleted_at IS NULL",
    [clean, messageId, conversationId, authorId],
  );
  return (r?.affectedRows ?? 0) > 0;
}

/**
 * Soft delete: the body goes, the row and its seq stay. Only the author may
 * do this; moderation is a separate act with its own audit trail.
 *
 * The conversation id is REQUIRED and part of the WHERE clause. Without it
 * the caller's proof of membership is decorative: they prove they belong to
 * one conversation and then delete by message id alone, which reaches their
 * messages in every OTHER conversation, including ones they were removed
 * from. Scoping the write to the conversation they proved is what makes the
 * membership check load-bearing.
 */
export async function softDeleteMessage(
  pool: Pool,
  conversationId: string,
  messageId: string,
  authorId: string,
): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE messages SET deleted_at = CURRENT_TIMESTAMP, body = '' " +
      "WHERE id = ? AND conversation_id = ? AND author_id = ? AND deleted_at IS NULL",
    [messageId, conversationId, authorId],
  );
  return (r?.affectedRows ?? 0) > 0;
}

// ── Read state ───────────────────────────────────────────────────────────────

/**
 * Advance a member's read mark. Monotonic on purpose: two tabs reporting
 * different positions settle on the further one, and a retried request from a
 * flaky connection can never mark read messages unread again.
 */
export async function advanceRead(
  pool: Pool,
  conversationId: string,
  userId: string,
  seq: number,
): Promise<number> {
  // Clamped to what this conversation actually holds. seq is global across
  // the table, so an unclamped mark lets a member park their read position
  // in the future and never hear about this thread again, which reads as a
  // broken inbox rather than as the mute they never asked for.
  const newest = await latestSeq(pool, conversationId);
  const target = Math.min(newest, Math.max(0, Math.trunc(Number(seq) || 0)));
  await pool.query(
    "UPDATE conversation_members SET last_read_seq = GREATEST(last_read_seq, ?) " +
      "WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL",
    [target, conversationId, userId],
  );
  const membership = await membershipOf(pool, conversationId, userId);
  return membership?.lastReadSeq ?? 0;
}

/** The newest seq in a conversation, or 0 for one nobody has spoken in. */
export async function latestSeq(pool: Pool, conversationId: string): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT MAX(seq) AS s FROM messages WHERE conversation_id = ?",
    [conversationId],
  );
  return Number(row?.s ?? 0);
}

export interface InboxEntry {
  conversation: Conversation;
  unreadCount: number;
  muted: boolean;
  role: MemberRole;
  lastReadSeq: number;
  latestSeq: number;
  preview: string;
  lastAuthorId: string | null;
  members: MemberSummary[];
}

/**
 * The inbox: every live conversation this member is in, newest activity
 * first. Unread counts exclude the member's own messages and tombstones,
 * because neither is something waiting to be read.
 *
 * FOUR queries, whatever the size of the inbox. The obvious shape is a loop
 * that asks per conversation, and at fifty conversations that is a hundred
 * and fifty round trips for one screen, growing with the roster of every
 * thread. The inbox is the page a member opens most, so it is the last place
 * to spend a query per row.
 */
export async function inboxFor(pool: Pool, userId: string, limit = 50): Promise<InboxEntry[]> {
  const cap = Math.max(1, Math.min(200, limit));
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.id, c.kind, c.name, c.context_type, c.context_id, c.created_by, c.created_at, c.last_message_at, " +
      "m.role, m.muted, m.last_read_seq " +
      "FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id " +
      "WHERE m.user_id = ? AND m.left_at IS NULL " +
      // Ordered by last_message_seq (0074), which is the newest message's
      // global AUTO_INCREMENT and therefore CANNOT tie: two conversations can
      // never share a message. So the comparator reaches its fallbacks only
      // for conversations nobody has spoken in yet, where created_at and then
      // id settle it. This is the same choice 0066 made for read state, now
      // applied to ordering as well.
      //
      // last_message_at is still the value the row DISPLAYS. It is no longer
      // the value it sorts by, which is why the two must be recomputed
      // together.
      "ORDER BY (c.last_message_seq IS NULL), c.last_message_seq DESC, c.created_at DESC, c.id DESC " +
      `LIMIT ${cap}`,
    [userId],
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  // Placeholders only, built from the array's LENGTH: no value is ever
  // interpolated into the SQL text.
  const marks = ids.map(() => "?").join(",");

  const [unreadRows] = await pool.query<RowDataPacket[]>(
    `SELECT msg.conversation_id, COUNT(*) AS unread FROM messages msg ` +
      `JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id AND cm.user_id = ? ` +
      `WHERE msg.conversation_id IN (${marks}) AND msg.seq > cm.last_read_seq ` +
      `AND msg.author_id <> ? AND msg.deleted_at IS NULL GROUP BY msg.conversation_id`,
    [userId, ...ids, userId],
  );
  const unreadBy = new Map(unreadRows.map((r) => [String(r.conversation_id), Number(r.unread ?? 0)]));

  const [latestRows] = await pool.query<RowDataPacket[]>(
    `SELECT msg.conversation_id, msg.author_id, msg.body, msg.deleted_at, msg.seq FROM messages msg ` +
      `JOIN (SELECT conversation_id, MAX(seq) AS seq FROM messages WHERE conversation_id IN (${marks}) ` +
      `GROUP BY conversation_id) newest ` +
      `ON newest.conversation_id = msg.conversation_id AND newest.seq = msg.seq`,
    ids,
  );
  const latestBy = new Map(latestRows.map((r) => [String(r.conversation_id), r]));

  const [memberRows] = await pool.query<RowDataPacket[]>(
    `SELECT m.conversation_id, m.user_id, m.role, m.left_at, u.name, u.handle ` +
      `FROM conversation_members m LEFT JOIN users u ON u.id = m.user_id ` +
      `WHERE m.conversation_id IN (${marks}) ORDER BY m.joined_at, m.user_id`,
    ids,
  );
  const membersBy = new Map<string, MemberSummary[]>();
  for (const r of memberRows) {
    const key = String(r.conversation_id);
    const list = membersBy.get(key) ?? [];
    list.push({
      userId: String(r.user_id),
      role: r.role === "owner" ? "owner" : "member",
      name: r.name ?? null,
      handle: r.handle ?? null,
      left: !!r.left_at,
    });
    membersBy.set(key, list);
  }

  return rows.map((r) => {
    const conversation = rowToConversation(r);
    const latest = latestBy.get(conversation.id);
    return {
      conversation,
      unreadCount: unreadBy.get(conversation.id) ?? 0,
      muted: Number(r.muted ?? 0) === 1,
      role: r.role === "owner" ? ("owner" as const) : ("member" as const),
      lastReadSeq: Number(r.last_read_seq ?? 0),
      latestSeq: Number(latest?.seq ?? 0),
      preview: latest ? previewOf(String(latest.body ?? ""), latest.deleted_at ?? null) : "",
      lastAuthorId: latest ? String(latest.author_id) : null,
      members: membersBy.get(conversation.id) ?? [],
    };
  });
}

/**
 * The badge number: unread messages across every conversation.
 *
 * Muted threads are excluded. Muting one means it stops tapping you on the
 * shoulder, and a badge is a tap on the shoulder; a muted thread that still
 * drove the count would leave a number nobody can clear without reading the
 * thread they muted. inboxUnreadTotal() on the client agrees, deliberately.
 */
export async function totalUnreadFor(pool: Pool, userId: string): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM messages msg " +
      "JOIN conversation_members m ON m.conversation_id = msg.conversation_id AND m.user_id = ? AND m.left_at IS NULL " +
      "WHERE m.muted = 0 AND msg.seq > m.last_read_seq AND msg.author_id <> ? AND msg.deleted_at IS NULL",
    [userId, userId],
  );
  return Number(row?.n ?? 0);
}

// ── Membership changes ───────────────────────────────────────────────────────

/**
 * Leave a conversation. Anyone may, always.
 *
 * When the owner of a group walks out and other people are still in it,
 * ownership passes to the longest-standing remaining member. A thread with
 * members and no owner has nobody who can add anyone, and the only way back
 * would be an admin editing a table by hand.
 */
export async function leaveConversation(pool: Pool, conversationId: string, userId: string): Promise<boolean> {
  const membership = await membershipOf(pool, conversationId, userId);
  if (!membership) return false;
  // Demoted on the way out, always. Owner is a property of ACTIVE membership,
  // never a residue on a row nobody is using: a departed owner's role that
  // survives on their row comes back with them the moment somebody re-adds
  // them, which hands ownership to whoever asked nicely to be let back in.
  await pool.query(
    "UPDATE conversation_members SET left_at = CURRENT_TIMESTAMP, role = 'member' WHERE conversation_id = ? AND user_id = ?",
    [conversationId, userId],
  );
  if (membership.role === "owner") {
    const [heirs] = await pool.query<RowDataPacket[]>(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL ORDER BY joined_at, user_id LIMIT 1",
      [conversationId],
    );
    if (heirs[0]) {
      await pool.query(
        "UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?",
        [conversationId, String(heirs[0].user_id)],
      );
    }
  }
  return true;
}

/** Add people to a group. Rejoining someone who left restores their history. */
export async function addMembers(
  pool: Pool,
  conversationId: string,
  userIds: string[],
): Promise<number> {
  let added = 0;
  for (const uid of Array.from(new Set(userIds.map(String)))) {
    // role is reset on the duplicate branch too. VALUES(…, 'member') applies
    // only to a genuinely new row, so without this a returning former owner
    // walks back in holding every owner-gated route.
    const [r]: any = await pool.query(
      "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?,?,'member') " +
        "ON DUPLICATE KEY UPDATE left_at = NULL, role = 'member'",
      [conversationId, uid],
    );
    if ((r?.affectedRows ?? 0) > 0) added++;
  }
  return added;
}

/** Owner removes someone. Their rows stay; they simply stop being a member. */
export async function removeMember(pool: Pool, conversationId: string, userId: string): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE conversation_members SET left_at = CURRENT_TIMESTAMP, role = 'member' " +
      "WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL",
    [conversationId, userId],
  );
  return (r?.affectedRows ?? 0) > 0;
}

/** Hand ownership to another live member. The old owner stays in the thread. */
export async function transferOwnership(
  pool: Pool,
  conversationId: string,
  fromUserId: string,
  toUserId: string,
): Promise<boolean> {
  const target = await membershipOf(pool, conversationId, toUserId);
  if (!target) return false;
  await pool.query(
    "UPDATE conversation_members SET role = 'member' WHERE conversation_id = ? AND user_id = ?",
    [conversationId, fromUserId],
  );
  await pool.query(
    "UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?",
    [conversationId, toUserId],
  );
  return true;
}

export async function setMuted(pool: Pool, conversationId: string, userId: string, muted: boolean): Promise<void> {
  await pool.query(
    "UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?",
    [muted ? 1 : 0, conversationId, userId],
  );
}

/** Report a message. Once per person per message; the unique index says so. */
export async function reportMessage(
  pool: Pool,
  input: { conversationId: string; messageId: string; reporterId: string; reason?: string | null },
): Promise<{ fresh: boolean }> {
  try {
    await pool.query(
      "INSERT INTO message_reports (id, conversation_id, message_id, reporter_id, reason) VALUES (?,?,?,?,?)",
      [
        newId("mrp"),
        input.conversationId,
        input.messageId,
        input.reporterId,
        input.reason ? cleanText(input.reason).slice(0, 500) : null,
      ],
    );
    return { fresh: true };
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") return { fresh: false };
    throw e;
  }
}

// ── Notifications ────────────────────────────────────────────────────────────

export interface MessageNotifyInput {
  conversation: Conversation;
  message: Message;
  author: { id: string; name?: string | null };
  /** How the conversation is titled for a recipient who is not the author. */
  titleFor(recipientId: string): string;
}

/**
 * Fan a new message out to everyone else in the thread, ONCE per unread run.
 *
 * The dedupe key carries the recipient's last_read_seq at the moment of the
 * send, so twenty messages into an unread thread produce one notification
 * row, and reading the thread moves the seq and re-arms the next one. Muted
 * members get nothing. Never throws into the send: the message is the deed
 * and the notification is a trace of it.
 */
export async function onMessageSent(deps: NotifyDeps, input: MessageNotifyInput): Promise<void> {
  try {
    const [rows] = await deps.pool.query<RowDataPacket[]>(
      "SELECT user_id, last_read_seq FROM conversation_members " +
        "WHERE conversation_id = ? AND left_at IS NULL AND muted = 0 AND user_id <> ?",
      [input.conversation.id, input.author.id],
    );
    const preview = previewOf(input.message.body, input.message.deletedAt);
    for (const r of rows) {
      const recipientId = String(r.user_id);
      const target = await deps.memberById(recipientId);
      // Tombstoned and unclaimed accounts get no mail and no bell: a
      // notification addressed to an account nobody can sign into is litter.
      if (!target || !deps.isPresent(target)) continue;
      await insertNotification(deps, {
        userId: recipientId,
        type: "message",
        title: input.titleFor(recipientId),
        body: preview,
        link: `/messages/${input.conversation.id}`,
        actorUserId: input.author.id,
        dedupeKey: messageDedupeKey(input.conversation.id, recipientId, Number(r.last_read_seq ?? 0)),
      });
    }
  } catch (e) {
    console.error("[messaging] fan-out failed (the message stands)", e);
  }
}

// ── Consistency ──────────────────────────────────────────────────────────────

export interface CacheAudit {
  checked: number;
  repaired: number;
  drifted: string[];
}

/**
 * Re-derive BOTH cached columns for every conversation and report what was
 * wrong.
 *
 * The ledger learned this the expensive way: a denormalized number that is
 * only ever written by the code that also writes the source of truth is a
 * number nobody checks. This runs at boot and reports drift by id, so a bug
 * in the send path shows up as a log line instead of as an inbox that quietly
 * sorts wrong.
 *
 * Since 0074 there are TWO of them, and this function is the single most
 * dangerous place in the module to get that wrong. It re-derives wholesale, so
 * if it repaired the timestamp and left the seq alone it would not just miss a
 * drift, it would CREATE one on every boot, and the inbox would order by a
 * stale key while displaying a fresh time. Both columns are compared, and the
 * repair writes both in one statement.
 *
 * The seq comparison is deliberately numeric rather than a string compare:
 * MySQL hands a bigint back as a string once it passes 2^53, and "10" < "9"
 * lexicographically.
 */
export async function auditLastMessageAt(pool: Pool, repair = true): Promise<CacheAudit> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.id, c.last_message_at AS cachedAt, c.last_message_seq AS cachedSeq, " +
      "(SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id) AS actualAt, " +
      "(SELECT MAX(seq) FROM messages WHERE conversation_id = c.id) AS actualSeq " +
      "FROM conversations c",
  );
  const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
  const drifted: string[] = [];
  for (const r of rows) {
    const cachedAt = r.cachedAt ? new Date(r.cachedAt).getTime() : null;
    const actualAt = r.actualAt ? new Date(r.actualAt).getTime() : null;
    if (cachedAt === actualAt && num(r.cachedSeq) === num(r.actualSeq)) continue;
    drifted.push(String(r.id));
    if (repair) {
      await pool.query(
        "UPDATE conversations SET last_message_at = ?, last_message_seq = ? WHERE id = ?",
        [r.actualAt ?? null, r.actualSeq ?? null, r.id],
      );
    }
  }
  return { checked: rows.length, repaired: repair ? drifted.length : 0, drifted };
}
