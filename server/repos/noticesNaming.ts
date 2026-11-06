/**
 * THE NOTICES THAT NAME A MEMBER TO SOMEBODY ELSE, and their emailed copies,
 * for the erasure sweep (server/lib/erasure.ts, the "notifications" step and
 * "notices-naming-after-tombstone").
 *
 * WHY THE ACTOR WAS NOT ENOUGH. The sweep rewrote every bell row whose
 * `actor_user_id` was the member, and the producers that tell the admins about
 * a member never set one: `notifyAdmins` in server/index.ts took no actor, so
 * "Wren Halloway has begun a departure", "Wren reserved Drill" and "Wren is
 * stuck on Mend the bench" sat on every admin's bell with `actor_user_id`
 * NULL, out of the sweep's reach, after Wren was gone. Two member-to-member
 * producers had the same gap (a send of tokens, a quest submission).
 *
 * WHAT IS HERE INSTEAD, TWO WAYS TO FIND A ROW.
 *
 *   1. FROM NOW ON, the member is the actor. Every producer that puts a
 *      member's name in somebody else's bell now passes them as the actor, so
 *      the plain actor match finds the row.
 *
 *   2. ROWS ALREADY WRITTEN carry no actor and never will, so they are found by
 *      the record their dedupe key points at: the producer built each key from
 *      the member's own exit, stay, loan, quest claim or submission, or from
 *      the member's id itself, and those records are still the member's when
 *      the sweep runs. `KEY_FAMILIES` below is the list, one entry per
 *      producer, and the test beside the erasure seeds one row per entry.
 *
 *   3. A NOTICE WHOSE SUBJECT IS THE MEMBER, never their act, has no actor to
 *      find either, and is found by the record its key was built from just
 *      the same. A ballot to seat a member or take a role back from them
 *      ("The village is asked whether Wren keeps the role in Steward") keys
 *      every notice it rings `bal:<ballotId>:...`, and the ballot's
 *      `subject_ref` names the member (server/repos/ballotWords.ts). The
 *      day-21 hand-off ("Wren has been on the resident path for three weeks")
 *      keys its notice on the walker's journey enrollment, which the comms
 *      step deletes, so the erasure rewrites it by key just before that
 *      (`forgetNoticesByKey`, below; round 2, findings 6 and 12).
 *
 * WHAT HAPPENS TO A ROW FOUND. It stays, on the bell it was rung on, with the
 * sweep's constant title and no body, which is the treatment the actor match
 * always gave. Its EMAILED COPIES go blank first, while the row can still find
 * them: the immediate email the spine sent under `notify:<id>`, and the daily
 * digest that listed its title, found by the digest's own key and the second
 * the row was stamped as emailed. A copy keeps its row, recipient and status so
 * Sent mail still counts it; its subject and words go, the same shape
 * `forgetCommsPerson` gives a person's own emails.
 *
 * WHAT IT CANNOT FIND, and says so. A notice that names a member in its words
 * with no actor and a key built from no record of theirs. Every producer that
 * writes one is listed above; a new one has to be added here, or has to pass
 * the member as its actor.
 *
 * Every statement is a DELETE keyed on the member, or an UPDATE writing a
 * constant to rows found through the member, so a second run writes the same
 * values again and a resume may run it any number of times.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { COMMS_CHANGE } from "../../shared/comms/memberView";
import { POWER_APPLICATION } from "../../shared/powerHands";
import { ERASED_SUBJECT } from "./commsPeople";
import { ballotIdsAbout } from "./ballotWords";

const VILLAGE = "local";

/** What a notice that named a departed member reads as, on whichever bell it was rung. */
export const DEPARTED_NOTICE_TITLE = "A message from a departed member";

/** Escape a value for use inside a LIKE pattern with `ESCAPE '\\'`. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** How many LIKE arms one statement carries, so a member with years of loans is several statements. */
const CHUNK = 100;

/**
 * Every producer that wrote a member's name into somebody else's bell with no
 * actor, by the record its dedupe key was built from. `notifyAdmins` appends
 * `:<adminId>`, so each prefix ends at the colon before that suffix.
 */
const KEY_FAMILIES: ReadonlyArray<{ table: "exits" | "stays" | "library_loans" | "quest_claims"; prefixes: (id: string) => string[] }> = [
  // server/index.ts, POST /api/profile/request-exit: "<name> has begun a departure".
  { table: "exits", prefixes: (id) => [`exit:${id}:opened:`] },
  // server/routes/stays.ts, POST /api/stays/request: "<name> requested a stay in <room>".
  { table: "stays", prefixes: (id) => [`stay:${id}:requested:`] },
  // server/index.ts, the library's reserve, cancel and return doors.
  { table: "library_loans", prefixes: (id) => [`loan:${id}:reserved:`, `loan:${id}:cancelled:`, `loan:${id}:returned:`] },
  // server/routes/questClaims.ts ("<first> is stuck on") and server/routes/quests.ts ("<first> submitted work on").
  { table: "quest_claims", prefixes: (id) => [`quest-confidence:${id}:`, `quest-submission:${id}:`] },
];

/** The submissions inbox: a raised hand for a role, an email change, a hand for a power. */
const submissionPrefixes = (id: string): string[] => [`role-application:${id}:`, `${COMMS_CHANGE}:${id}:`, `${POWER_APPLICATION}:${id}:`];

/** Every LIKE pattern that finds a no-actor notice naming this member. */
async function patternsFor(pool: Pool, userId: string, submissionIds: readonly string[]): Promise<string[]> {
  const prefixes: string[] = [
    // server/index.ts, a member's send of tokens: keyed on the sender's id.
    `send:${userId}:`,
  ];
  for (const family of KEY_FAMILIES) {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM \`${family.table}\` WHERE user_id = ?`, [userId]);
    for (const r of rows) prefixes.push(...family.prefixes(String(r.id)));
  }
  for (const id of submissionIds) prefixes.push(...submissionPrefixes(String(id)));
  // server/lib/ballotNotices.ts and every closer: `bal:<ballot>:<what>`, on a ballot about this member.
  for (const id of await ballotIdsAbout(pool, userId)) prefixes.push(`bal:${id}:`);
  return [
    // server/routes/org.ts, a claim on a seat: `seat-claim:<seat>:<member>:<admin>`.
    `seat-claim:%:${likeEscape(userId)}:%`,
    ...prefixes.map((p) => `${likeEscape(p)}%`),
  ];
}

/** Every notice, on anybody else's bell, that names this member. */
async function noticesNaming(pool: Pool, userId: string, submissionIds: readonly string[]): Promise<Array<{ id: string; userId: string; emailedAt: number | null }>> {
  const patterns = await patternsFor(pool, userId, submissionIds);
  const found = new Map<string, { id: string; userId: string; emailedAt: number | null }>();
  for (let i = 0; i < patterns.length; i += CHUNK) {
    const chunk = patterns.slice(i, i + CHUNK);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, user_id, UNIX_TIMESTAMP(emailed_at) AS emailed_at FROM notifications " +
        `WHERE user_id <> ? AND (actor_user_id = ? OR ${chunk.map(() => "dedupe_key LIKE ? ESCAPE '\\\\'").join(" OR ")})`,
      [userId, userId, ...chunk],
    );
    for (const r of rows) {
      found.set(String(r.id), { id: String(r.id), userId: String(r.user_id), emailedAt: r.emailed_at == null ? null : Number(r.emailed_at) });
    }
  }
  return Array.from(found.values());
}

const dayOf = (epochSeconds: number, shift: number): string =>
  new Date((epochSeconds + shift * 86400) * 1000).toISOString().slice(0, 10);

/**
 * The ledger rows of the emails that carried these notices: the immediate
 * copy under `notify:<id>`, and for a row that had none, the daily digest
 * that listed it.
 *
 * THE DIGEST IS FOUND BY ITS OWN KEY AND THE SECOND IT WAS STAMPED.
 * `runNotificationDigest` keys a digest `digest:<user>:<UTC day>` and stamps
 * the rows it carried a moment after posting it, so a digest is this row's
 * when its key names the row's recipient and a day around the stamp, and its
 * ledger row was written in the minute before the stamp. The day is read with
 * a day of slack either side, because the key's day comes from the process
 * clock and the stamp from the database's, and the window then decides.
 */
async function copiesOf(pool: Pool, notices: Array<{ id: string; userId: string; emailedAt: number | null }>): Promise<string[]> {
  const copies = new Set<string>();
  const immediate = new Set<string>();
  for (let i = 0; i < notices.length; i += CHUNK) {
    const chunk = notices.slice(i, i + CHUNK);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, idempotency_key FROM comms_messages WHERE village_id = ? AND idempotency_key IN (?)",
      [VILLAGE, chunk.map((n) => `notify:${n.id}`)],
    );
    for (const r of rows) {
      copies.add(String(r.id));
      immediate.add(String(r.idempotency_key).slice("notify:".length));
    }
  }
  const digested = notices.filter((n) => n.emailedAt != null && !immediate.has(n.id));
  for (let i = 0; i < digested.length; i += CHUNK) {
    const chunk = digested.slice(i, i + CHUNK);
    const keys = chunk.flatMap((n) => [-1, 0, 1].map((shift) => `digest:${n.userId}:${dayOf(n.emailedAt!, shift)}`));
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, user_id, UNIX_TIMESTAMP(created_at) AS created_at FROM comms_messages " +
        "WHERE village_id = ? AND origin = 'notify.digest' AND idempotency_key IN (?)",
      [VILLAGE, keys],
    );
    for (const r of rows) {
      const at = Number(r.created_at);
      if (chunk.some((n) => n.userId === String(r.user_id) && at <= n.emailedAt! && at >= n.emailedAt! - 60)) copies.add(String(r.id));
    }
  }
  return Array.from(copies);
}

export interface NoticeForgetCounts {
  /** Rows on the member's own bell, deleted. */
  own: number;
  /** Rows on somebody else's bell that named them, rewritten. */
  rewritten: number;
  /** Emailed copies of those rows, blanked. */
  emails: number;
}

/**
 * Take one member off every bell: their own rows go, and every row that names
 * them to somebody else keeps its place and loses its words, its emailed
 * copies first.
 *
 * `submissionIds` are the member's own submissions, read from the repository
 * cache the caller holds, because three producers keyed their notice on one.
 */
export async function forgetNoticesOf(pool: Pool, who: { userId: string; submissionIds?: readonly string[] }): Promise<NoticeForgetCounts> {
  const counts: NoticeForgetCounts = { own: 0, rewritten: 0, emails: 0 };
  if (!who.userId) return counts;
  const [own] = await pool.query<ResultSetHeader>("DELETE FROM notifications WHERE user_id = ?", [who.userId]);
  counts.own = Number(own.affectedRows ?? 0);

  const notices = await noticesNaming(pool, who.userId, who.submissionIds ?? []);
  if (!notices.length) return counts;
  await rewriteNotices(pool, notices, counts);
  return counts;
}

/** The emailed copies of these notices go blank, then the notices lose their words. */
async function rewriteNotices(
  pool: Pool,
  notices: Array<{ id: string; userId: string; emailedAt: number | null }>,
  counts: { rewritten: number; emails: number },
  opts: { link?: boolean } = {},
): Promise<void> {
  const copies = await copiesOf(pool, notices);
  for (let i = 0; i < copies.length; i += CHUNK) {
    const [res] = await pool.query<ResultSetHeader>(
      "UPDATE comms_messages SET subject = ?, body_html = NULL, body_text = NULL, headers = NULL, attachments = NULL, updated_at = CURRENT_TIMESTAMP " +
        "WHERE village_id = ? AND id IN (?)",
      [ERASED_SUBJECT, VILLAGE, copies.slice(i, i + CHUNK)],
    );
    counts.emails += Number(res.affectedRows ?? 0);
  }
  for (let i = 0; i < notices.length; i += CHUNK) {
    const [res] = await pool.query<ResultSetHeader>(
      `UPDATE notifications SET actor_user_id = NULL, title = ?, body = NULL${opts.link ? ", link = NULL" : ""} WHERE id IN (?)`,
      [DEPARTED_NOTICE_TITLE, notices.slice(i, i + CHUNK).map((n) => n.id)],
    );
    counts.rewritten += Number(res.affectedRows ?? 0);
  }
}

/**
 * Rewrite the notices under these exact dedupe keys the way a notice naming a
 * departed member is rewritten, their emailed copies first, and their link
 * too: for the producers whose key is built from a record the erasure is
 * about to delete, so the key must be read while the record still stands.
 * The day-21 hand-off is the one today, keyed on the walker's enrollment and
 * linking to their People page, a page about a contact that is about to go.
 * Constant writes keyed by the rows found, so a resume repeats it harmlessly.
 */
export async function forgetNoticesByKey(pool: Pool, dedupeKeys: readonly string[]): Promise<{ rewritten: number; emails: number }> {
  const counts = { rewritten: 0, emails: 0 };
  const keys = Array.from(new Set(dedupeKeys.filter(Boolean)));
  const notices: Array<{ id: string; userId: string; emailedAt: number | null }> = [];
  for (let i = 0; i < keys.length; i += CHUNK) {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, user_id, UNIX_TIMESTAMP(emailed_at) AS emailed_at FROM notifications WHERE dedupe_key IN (?)",
      [keys.slice(i, i + CHUNK)],
    );
    for (const r of rows) notices.push({ id: String(r.id), userId: String(r.user_id), emailedAt: r.emailed_at == null ? null : Number(r.emailed_at) });
  }
  if (notices.length) await rewriteNotices(pool, notices, counts, { link: true });
  return counts;
}
