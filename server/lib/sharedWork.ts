/**
 * Shared work chats: a quest or a task that two or more people are on gets one
 * conversation, and the people in it are exactly the people on the work.
 *
 * WHO IS ON THE WORK, read from the records that already say so:
 *
 *   quest  every member with a claim on it that was not declined (claimed,
 *          submitted, or consented). A declined claim is the quest handed back
 *          (drizzle/0196 says why), so it takes the member out of the chat too.
 *   task   a live-session action: the person holding it, and every member who
 *          sits in the seat holding it now (`liveHoldersOf`, the board's own
 *          rule). Read from the task's state row, or from the entry while its
 *          session is still open.
 *
 * Nobody else is in the chat. An admin is not, a circle is not (circles come
 * later), and a crew keeps its own thread (kind 'crew', server/routes/quests.ts).
 *
 * LAZY, RECONCILED ON EVERY READ. Nothing here hooks the places that change who
 * is on a quest or a task. Claims are written by the quest routes, the map's
 * promise door, the steward's consent and decline, the erasure, and seatings
 * move with the org chart and the season's terms. Hooking every one of those is
 * a list somebody will forget to extend. Instead the conversation is brought in
 * line with the record at the moment anybody looks at it: opening it from the
 * quest or the task, reading the thread, sending into it, and loading the inbox
 * (which reconciles the viewer's own work). So a declined claimant gets the 404
 * on their very next request, before any message reaches them, and a newcomer
 * finds the chat in their inbox the next time they open it.
 *
 * The conversation is created the first time the work has two people AND
 * someone on it looks. Under two people nothing is created; an existing chat
 * whose people drop to one keeps its history and its one member.
 *
 * ONE CHAT PER PIECE OF WORK, and the database enforces it. The row's
 * `direct_key` (NOT NULL, UNIQUE) is `w:<kind>:<id>`, so two people opening it
 * at once race on the index, and the loser reads back the winner's row the way
 * `openDirect` does.
 *
 * NOBODY OWNS IT. Every member is role 'member', because the membership is the
 * record's and not anybody's to edit: adding, removing, handing on and renaming
 * are refused by the routes for these threads, and so is leaving (the next read
 * would only put the member back). Muting is how a member quiets one.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { liveHoldersOf, liveSeatIdsFor } from "../../shared/sessionTasks";
import { conversationById, type Conversation } from "./messaging";
import { listOrgAssignments, type LapseContext } from "./orgChart";

export type WorkKind = "quest" | "task";
export const WORK_KINDS: readonly WorkKind[] = ["quest", "task"];

export function isWorkKind(v: unknown): v is WorkKind {
  return v === "quest" || v === "task";
}

/** The unique key a shared-work row carries in `direct_key`. */
export function workKeyFor(kind: WorkKind, id: string): string {
  return `w:${kind}:${String(id)}`;
}

/** True for a conversation that is a shared-work chat (and not a crew's thread). */
export function isWorkConversation(c: Pick<Conversation, "kind" | "contextType">): boolean {
  return c.kind === "group" && isWorkKind(c.contextType);
}

/** Titles are a label: a task's words are cut to fit the name column with room to spare. */
const TITLE_CHARS = 100;

export function workTitle(text: string): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > TITLE_CHARS ? `${flat.slice(0, TITLE_CHARS - 1)}…` : flat;
}

export interface Work {
  kind: WorkKind;
  id: string;
  title: string;
  /** User ids, distinct, in a stable order. */
  people: string[];
}

export interface WorkDeps {
  getPool(): Pool;
  /** The season's reading of whose seat term still runs. Without it every seating counts. */
  lapseContext?: () => LapseContext;
  /** Present members only: an example identity, a tombstone or an unclaimed account is never put in a chat. */
  isAddressable(userId: string): Promise<boolean>;
}

// ── Who is on the work ───────────────────────────────────────────────────────

async function questWork(pool: Pool, questId: string): Promise<Work | null> {
  const [quests] = await pool.query<RowDataPacket[]>("SELECT id, title FROM quests WHERE id = ?", [questId]);
  if (!quests[0]) return null;
  const [claims] = await pool.query<RowDataPacket[]>(
    "SELECT user_id, MIN(claimed_at) AS first_at FROM quest_claims WHERE quest_id = ? AND status <> 'declined' " +
      "GROUP BY user_id ORDER BY first_at, user_id",
    [questId],
  );
  return {
    kind: "quest",
    id: String(quests[0].id),
    title: workTitle(String(quests[0].title ?? "")) || "Quest",
    people: claims.map((r) => String(r.user_id)),
  };
}

async function taskWork(pool: Pool, entryId: string, deps: Pick<WorkDeps, "lapseContext">): Promise<Work | null> {
  const n = Number(entryId);
  if (!Number.isInteger(n) || n <= 0) return null;
  // The state row says who holds it now; an entry still in an open session has none yet.
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT e.id, e.kind, e.text, COALESCE(t.owner_no, e.owner_no) AS owner_no, " +
      "IF(t.entry_id IS NULL, e.owner_seat_id, t.owner_seat_id) AS owner_seat_id " +
      "FROM live_session_entries e LEFT JOIN live_session_task_state t ON t.entry_id = e.id WHERE e.id = ?",
    [n],
  );
  const r = rows[0];
  if (!r || String(r.kind) !== "action") return null;
  const people: string[] = [];
  const ownerNo = r.owner_no == null ? null : Number(r.owner_no);
  if (ownerNo != null && ownerNo > 0) {
    const [owner] = await pool.query<RowDataPacket[]>("SELECT user_id FROM live_session_members WHERE no = ?", [ownerNo]);
    if (owner[0]) people.push(String(owner[0].user_id));
  }
  const seat = r.owner_seat_id == null || r.owner_seat_id === "" ? null : String(r.owner_seat_id);
  if (seat) {
    const seatings = await listOrgAssignments(pool, deps.lapseContext?.());
    for (const uid of liveHoldersOf(seatings, seat)) if (!people.includes(uid)) people.push(uid);
  }
  return { kind: "task", id: String(r.id), title: workTitle(String(r.text ?? "")) || "Task", people };
}

/** The work and the people on it, or null when there is no such quest or task. */
export async function workFor(kind: WorkKind, id: string, deps: Pick<WorkDeps, "getPool" | "lapseContext">): Promise<Work | null> {
  return kind === "quest" ? questWork(deps.getPool(), id) : taskWork(deps.getPool(), id, deps);
}

/**
 * The work this member is on now, for the inbox's reconcile. Quests they hold
 * a live claim on, and tasks they or their seats hold that are not let go.
 * Bounded: an inbox load never walks more than `cap` pieces of work.
 */
export async function workOf(userId: string, deps: Pick<WorkDeps, "getPool" | "lapseContext">, cap = 40): Promise<Array<{ kind: WorkKind; id: string }>> {
  const pool = deps.getPool();
  const out: Array<{ kind: WorkKind; id: string }> = [];
  const [quests] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT quest_id FROM quest_claims WHERE user_id = ? AND status IN ('claimed','submitted') LIMIT ?",
    [userId, cap],
  );
  for (const q of quests) out.push({ kind: "quest", id: String(q.quest_id) });

  const [mine] = await pool.query<RowDataPacket[]>("SELECT no FROM live_session_members WHERE user_id = ?", [userId]);
  const no = mine[0] ? Number(mine[0].no) : null;
  const seatings = await listOrgAssignments(pool, deps.lapseContext?.());
  const seats = liveSeatIdsFor(seatings, userId);
  if (no != null || seats.length) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (no != null) {
      clauses.push("owner_no = ?");
      params.push(no);
    }
    if (seats.length) {
      clauses.push(`owner_seat_id IN (${seats.map(() => "?").join(",")})`);
      params.push(...seats);
    }
    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT entry_id FROM live_session_task_state WHERE status <> 'let_go' AND (${clauses.join(" OR ")}) ` +
        `ORDER BY changed_at DESC LIMIT ${Math.max(1, Math.trunc(cap))}`,
      params,
    );
    for (const t of tasks) out.push({ kind: "task", id: String(t.entry_id) });
  }
  return out.slice(0, cap);
}

// ── The conversation ─────────────────────────────────────────────────────────

/** The chat for this work, if one was ever opened. */
export async function workConversation(pool: Pool, kind: WorkKind, id: string): Promise<Conversation | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM conversations WHERE direct_key = ?", [workKeyFor(kind, id)]);
  return rows[0] ? conversationById(pool, String(rows[0].id)) : null;
}

async function createWorkConversation(pool: Pool, work: Work, attemptsLeft = 2): Promise<Conversation> {
  const id = `cnv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await pool.query(
      "INSERT INTO conversations (id, kind, name, context_type, context_id, created_by, direct_key) VALUES (?,?,?,?,?,?,?)",
      [id, "group", work.title, work.kind, work.id, work.people[0], workKeyFor(work.kind, work.id)],
    );
  } catch (e: any) {
    // Two people opened it at once. The unique key decided; read the winner back.
    if (e?.code === "ER_DUP_ENTRY" && attemptsLeft > 0) {
      const winner = await workConversation(pool, work.kind, work.id);
      if (winner) return winner;
      return createWorkConversation(pool, work, attemptsLeft - 1);
    }
    throw e;
  }
  const created = await conversationById(pool, id);
  if (!created) throw new Error("conversation vanished immediately after insert");
  return created;
}

export interface SyncResult {
  conversation: Conversation | null;
  added: string[];
  removed: string[];
}

/**
 * Bring the chat in line with the people on the work, creating it when the
 * work has two people and no chat yet. Idempotent: a second call with nothing
 * changed writes nothing.
 */
export async function syncWorkConversation(work: Work, deps: Pick<WorkDeps, "getPool" | "isAddressable">): Promise<SyncResult> {
  const pool = deps.getPool();
  const people: string[] = [];
  for (const uid of work.people) if (await deps.isAddressable(uid)) people.push(uid);

  let conversation = await workConversation(pool, work.kind, work.id);
  if (!conversation) {
    if (people.length < 2) return { conversation: null, added: [], removed: [] };
    conversation = await createWorkConversation(pool, { ...work, people });
  } else if (conversation.name !== work.title && work.title) {
    // The quest was renamed: the chat follows its name.
    await pool.query("UPDATE conversations SET name = ? WHERE id = ?", [work.title, conversation.id]);
    conversation = { ...conversation, name: work.title };
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL",
    [conversation.id],
  );
  const current = new Set(rows.map((r) => String(r.user_id)));
  const wanted = new Set(people);
  const added: string[] = [];
  const removed: string[] = [];
  for (const uid of people) {
    if (current.has(uid)) continue;
    // A returning member gets their old row back, history and read mark with it.
    await pool.query(
      "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?,?,'member') " +
        "ON DUPLICATE KEY UPDATE left_at = NULL, role = 'member'",
      [conversation.id, uid],
    );
    added.push(uid);
  }
  for (const uid of Array.from(current)) {
    if (wanted.has(uid)) continue;
    await pool.query(
      "UPDATE conversation_members SET left_at = CURRENT_TIMESTAMP, role = 'member' WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL",
      [conversation.id, uid],
    );
    removed.push(uid);
  }
  return { conversation, added, removed };
}

/** Read the work and sync its chat in one step. Null work means no such quest or task. */
export async function syncWork(kind: WorkKind, id: string, deps: WorkDeps): Promise<{ work: Work | null } & SyncResult> {
  const work = await workFor(kind, id, deps);
  if (!work) {
    return { work: null, conversation: await workConversation(deps.getPool(), kind, id), added: [], removed: [] };
  }
  return { work, ...(await syncWorkConversation(work, deps)) };
}
