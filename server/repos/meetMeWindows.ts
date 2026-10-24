/**
 * Meet-me windows (the `events` rows of kind `meet-me`), for the erasure: a
 * home being started, with one read in it and the one scrub of what the
 * window left in its guests' mail.
 *
 * server/lib/calendarCommunity.ts still opens, lists and closes windows where
 * it always did. What lives here is what the erasure's meet-me step needs
 * (lane E2), called from `forgetMeetMeWindowsOf` in server/lib/gatherings.ts,
 * which frees each window the way any gathering is freed.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { subjectRef } from "../../shared/comms/contracts";
import { ERASED_SUBJECT } from "./commsPeople";
import { cancelQueued } from "./commsMessages";

const VILLAGE = "local";

/** Escape a value for use inside a LIKE pattern with `ESCAPE '\\'`. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Every window a member ever opened, past or ahead, by id. */
export async function meetMeWindowIdsOf(pool: Pool, userId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM events WHERE kind = 'meet-me' AND (created_by = ? OR owner_user_id = ?)",
    [userId, userId],
  );
  return rows.map((r) => String(r.id));
}

/**
 * What one window left in its guests' mail, taken out before the window goes
 * (round 2, finding 13).
 *
 * A yes to a window enrolls the guest on the gathering journey, whose facts
 * keep what they were told (the title "Meet <first name>" and the place), and
 * posts their confirmation, whose subject carries the title, whose words carry
 * the place and the note, and whose calendar file carries all three. A letter
 * about the evening that no journey owns (a move, a change of place) is keyed
 * `ev:<windowId>:...`. Every one of those rows stays, as the record that the
 * guest was on a journey and was written to, and loses the window's words:
 *   1. anything still waiting in the queue for those journeys or keys is
 *      withdrawn, so a reminder held for later never goes;
 *   2. the ledger copies keep their recipient and status, and lose their
 *      subject, words, headers and attachments;
 *   3. the journeys stop, as a removed gathering's do, and forget what they
 *      were told.
 * Nothing is sent: the guests are not written to about somebody's erasure.
 *
 * BEFORE THE WINDOW'S OWN ROW GOES, because the window's row is how the
 * erasure finds this id at all. A resume that died in between finds the
 * window again and runs this again, and every statement is a constant keyed on
 * the window, so it matches the same rows and writes the same values.
 */
export async function forgetWindowMail(pool: Pool, windowId: string): Promise<{ journeys: number; letters: number; withdrawn: number }> {
  const out = { journeys: 0, letters: 0, withdrawn: 0 };
  if (!windowId) return out;
  const subject = subjectRef.eventPrefix(windowId);
  const [enrollments] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_enrollments, every journey on one window, in any state
    "SELECT id FROM comms_enrollments WHERE village_id = ? AND (subject_ref = ? OR subject_ref LIKE ? ESCAPE '\\\\')",
    [VILLAGE, subject, `${likeEscape(subject)}:%`],
  );
  const ids = enrollments.map((r) => String(r.id));
  const letterKey = `ev:${likeEscape(windowId)}:%`;
  const about = ids.length ? "(enrollment_id IN (?) OR idempotency_key LIKE ? ESCAPE '\\\\')" : "idempotency_key LIKE ? ESCAPE '\\\\'";
  const aboutParams: unknown[] = ids.length ? [ids, letterKey] : [letterKey];

  const [queued] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_messages, what is still waiting to go about one window
    `SELECT id FROM comms_messages WHERE village_id = ? AND status = 'queued' AND ${about}`,
    [VILLAGE, ...aboutParams],
  );
  for (const r of queued) if (await cancelQueued(pool, String(r.id))) out.withdrawn += 1;

  const [letters] = await pool.query<ResultSetHeader>( // module-review-ok: comms_messages, every copy about one window, blanked to constants
    "UPDATE comms_messages SET subject = ?, body_html = NULL, body_text = NULL, headers = NULL, attachments = NULL, updated_at = CURRENT_TIMESTAMP " +
      `WHERE village_id = ? AND ${about}`,
    [ERASED_SUBJECT, VILLAGE, ...aboutParams],
  );
  out.letters = Number(letters.affectedRows ?? 0);

  if (ids.length) {
    // stop_reason is set before state, because MySQL assigns left to right and the second IF reads the first's result.
    const [journeys] = await pool.query<ResultSetHeader>( // module-review-ok: comms_enrollments, every journey on one window, stopped and forgetting what it was told
      "UPDATE comms_enrollments SET facts = JSON_REMOVE(facts, '$.told'), " +
        "stop_reason = IF(state = 'active', 'gathering_removed', stop_reason), state = IF(state = 'active', 'stopped', state), " +
        "updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id IN (?)",
      [VILLAGE, ids],
    );
    out.journeys = Number(journeys.affectedRows ?? 0);
  }
  return out;
}
