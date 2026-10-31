/**
 * Pure helpers for the inbox and the thread view. No fetching, no DOM:
 * everything here is testable with plain values, the same rule questBoard.ts
 * and firstWalk.ts follow.
 *
 * The shapes mirror what GET /api/messages and GET /api/messages/:id return.
 * Titles are computed here as well as on the server on purpose: the client
 * needs one the moment a member starts a conversation, before any response
 * has come back to read a title out of.
 */
import { TASK_BOARD_PATH } from "@shared/sessionTasks";

export type ConversationKind = "direct" | "group" | "crew";
export type MemberRole = "owner" | "member";

export interface ConversationMemberView {
  userId: string;
  name: string | null;
  handle: string | null;
  role: MemberRole;
  left: boolean;
}

export interface InboxConversation {
  id: string;
  kind: ConversationKind;
  title?: string;
  name: string | null;
  unreadCount: number;
  muted: boolean;
  role: MemberRole;
  lastReadSeq: number;
  latestSeq: number;
  preview: string;
  lastAuthorId: string | null;
  lastMessageAt: string | null;
  memberCount: number;
  members: ConversationMemberView[];
  /** "quest" or "task" on a shared work chat (and "quest" on a crew's thread). */
  contextType?: string | null;
  contextId?: string | null;
}

export interface ThreadMessage {
  id: string;
  seq: number;
  body: string;
  deleted: boolean;
  mine: boolean;
  author: { userId: string; name: string | null; handle: string | null };
  createdAt: string;
  /** Set once the author edits. The marker is public and never cleared. */
  editedAt?: string | null;
}

/** Everyone still in the thread. Members who left keep their old lines named. */
export function liveMembers(members: ConversationMemberView[]): ConversationMemberView[] {
  return (members ?? []).filter((m) => !m.left);
}

/**
 * What to call a conversation, for one viewer.
 *
 * A group carries its own name. A direct thread is titled by whoever else is
 * in it, which is a per-viewer fact and therefore not something the row could
 * have stored. If the other person left, their name still titles the thread:
 * the history is a conversation with THEM, whatever they did afterwards.
 */
export function threadTitle(
  conversation: Pick<InboxConversation, "kind" | "name" | "members">,
  viewerId: string,
): string {
  if (conversation.kind !== "direct") return conversation.name?.trim() || "Group conversation";
  const others = (conversation.members ?? []).filter((m) => m.userId !== viewerId);
  const present = others.find((m) => !m.left) ?? others[0];
  return present?.name?.trim() || "A member";
}

/**
 * The line under a group's name: who is in it, in the order the API returns
 * them, with the viewer named first as "You". Long rosters collapse to a
 * count so the header stays one line on a 390px screen.
 */
export function memberSummary(
  members: ConversationMemberView[],
  viewerId: string,
  maxNamed = 2,
): string {
  const live = liveMembers(members);
  const me = live.some((m) => m.userId === viewerId);
  const others = live.filter((m) => m.userId !== viewerId).map((m) => m.name?.trim() || "a member");
  if (!others.length) return me ? "Just you" : "Nobody here";
  const lead = me ? ["You"] : [];
  const named = [...lead, ...others.slice(0, maxNamed)];
  const rest = others.length - Math.min(others.length, maxNamed);
  if (rest > 0) return `${named.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/** The badge on a conversation row. Nothing at zero, "9+" past nine. */
export function unreadBadge(count: number): string {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (n === 0) return "";
  return n > 9 ? "9+" : String(n);
}

/**
 * The number on the Messages nav entry. Muted conversations are excluded,
 * because muting a thread means it stops tapping you on the shoulder, and a
 * badge is a tap on the shoulder. The server's total agrees.
 */
export function inboxUnreadTotal(list: InboxConversation[]): number {
  return (list ?? []).reduce((sum, c) => (c.muted ? sum : sum + Math.max(0, c.unreadCount || 0)), 0);
}

/**
 * Newest activity first. A conversation nobody has spoken in sorts last.
 *
 * Sorts on `latestSeq`, which is the same key the server orders by since 0074
 * (`conversations.last_message_seq`, the newest message's global
 * AUTO_INCREMENT). That agreement is the whole point of this function: it
 * re-sorts a list the API already ordered, so any key it uses that the server
 * does not will reorder the inbox the moment an optimistic send triggers a
 * re-sort. It has gone wrong once already, when the two tie-breakers ran in
 * opposite directions.
 *
 * A seq cannot tie, since two conversations never share a message, so the
 * fallbacks below only separate threads nobody has spoken in yet.
 */
export function sortInbox(list: InboxConversation[]): InboxConversation[] {
  return [...(list ?? [])].sort((a, b) => {
    const sa = Math.max(0, a.latestSeq || 0);
    const sb = Math.max(0, b.latestSeq || 0);
    if (sb !== sa) return sb - sa;
    // Both silent. Fall to time, then to id, descending in both, matching the
    // server's `c.created_at DESC, c.id DESC`.
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/**
 * "now" / "12m" / "3h" / "2d" / "12 Mar", with `now` injected so the function
 * stays pure. Anything unparseable renders as nothing, never as NaN.
 */
export function relativeTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const secs = Math.floor((now.getTime() - t) / 1000);
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 7 * 86_400) return `${Math.floor(secs / 86_400)}d`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export interface MessageDay {
  label: string;
  messages: ThreadMessage[];
}

/**
 * Day separators for the thread. Messages arrive oldest first and stay in
 * that order; only the grouping is added. Today and yesterday are named, and
 * anything older carries its date.
 */
export function groupMessagesByDay(messages: ThreadMessage[], now: Date): MessageDay[] {
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = dayKey(now);
  const yesterdayDate = new Date(now.getTime());
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);

  const days: MessageDay[] = [];
  for (const m of messages ?? []) {
    const at = new Date(m.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKey(at);
    const label =
      key === today
        ? "Today"
        : key === yesterday
          ? "Yesterday"
          : at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const last = days[days.length - 1];
    if (last && last.label === label) last.messages.push(m);
    else days.push({ label, messages: [m] });
  }
  return days;
}

/** Avatar fallback: up to two initials, uppercase. */
export function initialsOf(name: string | null | undefined): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The client's mirror of the server's rules, so a button nobody is allowed to
 * press is never drawn. The server enforces these independently; this exists
 * to keep the UI honest, never as the gate.
 */
export function canRename(conversation: Pick<InboxConversation, "kind" | "role">): boolean {
  return conversation.kind !== "direct" && conversation.role === "owner";
}

export function canManageMembers(conversation: Pick<InboxConversation, "kind" | "role">): boolean {
  return conversation.kind !== "direct" && conversation.role === "owner";
}

/**
 * A shared work chat: one quest's or one task's, whose members are the people
 * on the work (server/lib/sharedWork.ts). A crew's thread is kind "crew" and
 * keeps its own place in the list.
 */
export function isWorkThread(conversation: Pick<InboxConversation, "kind" | "contextType">): boolean {
  return conversation.kind === "group" && (conversation.contextType === "quest" || conversation.contextType === "task");
}

/** What a shared work chat is about, for the line under its title. */
export function workLabel(conversation: Pick<InboxConversation, "contextType">): string {
  return conversation.contextType === "task" ? "Task" : "Quest";
}

/**
 * The inbox in two parts: the shared work chats, and everything else. Each
 * keeps the order it came in, so a sorted list stays sorted in both.
 */
export function splitInbox(list: InboxConversation[]): { work: InboxConversation[]; people: InboxConversation[] } {
  const work: InboxConversation[] = [];
  const people: InboxConversation[] = [];
  for (const c of list ?? []) (isWorkThread(c) ? work : people).push(c);
  return { work, people };
}

/** Where a shared work chat's own page lives, for its header link. */
export function workHref(conversation: Pick<InboxConversation, "contextType" | "contextId">): string | null {
  if (!conversation.contextId) return null;
  if (conversation.contextType === "quest") return `/quests/${encodeURIComponent(conversation.contextId)}`;
  if (conversation.contextType === "task") return TASK_BOARD_PATH;
  return null;
}

/** How many messages in a thread the viewer has not read yet. */
export function unreadInThread(messages: ThreadMessage[], lastReadSeq: number): number {
  return (messages ?? []).filter((m) => m.seq > lastReadSeq && !m.mine && !m.deleted).length;
}
