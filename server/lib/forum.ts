/**
 * The forum's notification fan-out (S24-S26): the RULES ported from
 * regen-civics, implemented fresh on the S16 spine.
 *
 * Precedence — one person, one notification per event:
 *   mention > direct reply > thread follow.
 * Mentions resolve first and seed the alreadyNotified set; the direct-reply
 * stage skips anyone in it and adds its own targets; followers are last and
 * skip everyone already reached. Self-notifications never happen.
 *
 * Idempotency is layered exactly like the original: forum_mentions is the
 * edit ledger (a re-parse only notifies NEW handles; removing a mention
 * never retracts a delivered notification), and every insertNotification
 * carries a dedupe key, so a double-fired hook is a no-op.
 *
 * MENTION_CAP = 10 resolved targets per post, in first-seen order.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { insertNotification, type NotifyDeps } from "./notify";

export const MENTION_CAP = 10;

/**
 * Extract @handles from body text: code fences and inline code stripped,
 * email addresses never match (require a non-word char or start before @),
 * handles are 3-30 chars of [a-z0-9-_] starting alphanumeric, lowercased,
 * first-seen order.
 */
export function parseMentions(body: string): string[] {
  const stripped = String(body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
  const seen: string[] = [];
  const re = /(^|[^\w@])@([a-z0-9][a-z0-9\-_]{2,29})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const handle = m[2].toLowerCase();
    if (!seen.includes(handle)) seen.push(handle);
    if (seen.length >= MENTION_CAP) break;
  }
  return seen;
}

export interface ForumNotifyDeps extends NotifyDeps {
  memberByHandle(handle: string): Promise<any | null>;
}

async function freshMention(
  pool: Pool,
  sourceType: "thread" | "reply",
  sourceId: string,
  mentionedUserId: string,
): Promise<boolean> {
  try {
    await pool.query(
      "INSERT INTO forum_mentions (source_type, source_id, mentioned_user_id) VALUES (?,?,?)",
      [sourceType, sourceId, mentionedUserId],
    );
    return true;
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") return false;
    throw e;
  }
}

export async function subscribe(
  pool: Pool,
  userId: string,
  threadId: string,
  reason: "authored" | "replied" | "mentioned" | "manual",
  muted = false,
) {
  // First reason wins; a manual call may still flip the mute flag.
  await pool.query(
    "INSERT INTO forum_subscriptions (user_id, thread_id, reason, muted) VALUES (?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE muted = IF(VALUES(reason) = 'manual', VALUES(muted), muted)",
    [userId, threadId, reason, muted ? 1 : 0],
  );
}

/**
 * Resolve @handles in a body to members and notify the FRESH ones. Returns
 * the set of userIds who received a mention notification this pass — the
 * alreadyNotified seed for later precedence stages.
 */
export async function processMentions(
  deps: ForumNotifyDeps,
  input: {
    body: string;
    sourceType: "thread" | "reply";
    sourceId: string;
    threadId: string;
    threadTitle: string;
    actor: any;
  },
): Promise<Set<string>> {
  const notified = new Set<string>();
  for (const handle of parseMentions(input.body)) {
    const target = await deps.memberByHandle(handle);
    if (!target || target.id === input.actor.id || !deps.isPresent(target)) continue;
    if (!(await freshMention(deps.pool, input.sourceType, input.sourceId, target.id))) continue;
    await insertNotification(deps, {
      userId: target.id,
      type: "mention",
      title: `${String(input.actor.name ?? "").split(" ")[0]} mentioned you in "${input.threadTitle.slice(0, 60)}"`,
      body: input.body.slice(0, 140),
      link: `/forum/${input.threadId}`,
      actorUserId: input.actor.id,
      dedupeKey: `mention:${input.sourceType}:${input.sourceId}:u${target.id}`,
    });
    await subscribe(deps.pool, target.id, input.threadId, "mentioned");
    notified.add(target.id);
  }
  return notified;
}

/** Thread created: author auto-subscribes, mentions fan out. */
export async function onThreadCreated(deps: ForumNotifyDeps, thread: any, author: any): Promise<void> {
  try {
    await subscribe(deps.pool, author.id, thread.id, "authored");
    await processMentions(deps, {
      body: thread.body,
      sourceType: "thread",
      sourceId: thread.id,
      threadId: thread.id,
      threadTitle: thread.title || thread.body.slice(0, 60),
      actor: author,
    });
  } catch (e) {
    console.error("[forum] thread fan-out failed (thread stands)", e);
  }
}

/** Reply created: the full precedence chain. */
export async function onReplyCreated(
  deps: ForumNotifyDeps,
  thread: any,
  reply: any,
  author: any,
  parentReplyAuthorId: string | null,
): Promise<void> {
  try {
    await subscribe(deps.pool, author.id, thread.id, "replied");
    const title = thread.title || String(thread.body ?? "").slice(0, 60);

    // Stage 1: mentions.
    const alreadyNotified = await processMentions(deps, {
      body: reply.body,
      sourceType: "reply",
      sourceId: reply.id,
      threadId: thread.id,
      threadTitle: title,
      actor: author,
    });

    // Stage 2: the thread author, then the parent reply's author.
    const directTargets = [thread.authorId, parentReplyAuthorId].filter(
      (id, i, arr): id is string => !!id && id !== author.id && !alreadyNotified.has(id) && arr.indexOf(id) === i,
    );
    for (const targetId of directTargets) {
      const target = await deps.memberById(targetId);
      if (!target || !deps.isPresent(target)) continue;
      await insertNotification(deps, {
        userId: targetId,
        type: "forum_reply",
        title: `${String(author.name ?? "").split(" ")[0]} replied in "${title.slice(0, 60)}"`,
        body: String(reply.body).slice(0, 140),
        link: `/forum/${thread.id}`,
        actorUserId: author.id,
        dedupeKey: `reply:${reply.id}:u${targetId}`,
      });
      alreadyNotified.add(targetId);
    }

    // Stage 3: followers — everyone else who chose to watch this thread.
    const [subs] = await deps.pool.query<RowDataPacket[]>(
      "SELECT user_id FROM forum_subscriptions WHERE thread_id = ? AND muted = 0",
      [thread.id],
    );
    for (const s of subs) {
      const uid = String(s.user_id);
      if (uid === author.id || alreadyNotified.has(uid)) continue;
      await insertNotification(deps, {
        userId: uid,
        type: "thread_activity",
        title: `New activity in "${title.slice(0, 60)}"`,
        link: `/forum/${thread.id}`,
        actorUserId: author.id,
        dedupeKey: `thread:${reply.id}:u${uid}`,
      });
    }
  } catch (e) {
    console.error("[forum] reply fan-out failed (reply stands)", e);
  }
}
