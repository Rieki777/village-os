/**
 * What became of each journey email, read across the post office ledger and
 * what people did afterwards (the comms build spec 5.12, outcomes). The
 * behaviour is server/lib/comms/outcomes.ts; this file is only its SQL.
 *
 * ONE ROW PER STEP, counted from the ledger (`comms_messages`, by journey and
 * step) with a correlated look for each "what next" question, every window
 * decided IN SQL from the email's own `sent_at`:
 *
 *   sent           the provider accepted it. A rehearsed email is not counted:
 *                  it went to the rehearsal inbox, never to the person.
 *   delivered      a delivery report said it arrived.
 *   bounced        a delivery report said it bounced.
 *   unsubscribed   AFTER it was sent, the person said no to that kind of
 *                  email, or stopped everything, or complained. A pause is not
 *                  a no, so a row that only carries a pause is not counted.
 *   rsvpd          said yes to a gathering within 7 days after it.
 *   came           was marked as having come to a gathering within 7 days.
 *   reachedGoal    their journey ended on one of its goals within 7 days.
 *
 * A person is matched by their user id, or as a guest by `guest:<contactId>`
 * (the person key rule, shared/comms/kinds.ts). Opens and clicks are not
 * tracked, so nothing here reads them.
 *
 * Raw SQL lives here and nowhere else.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

/** The window after an email in which what a person did counts as following it. */
export const OUTCOME_WINDOW_DAYS = 7;

export interface StepCounts {
  stepKey: string;
  sent: number;
  delivered: number;
  bounced: number;
  unsubscribed: number;
  rsvpd: number;
  came: number;
  reachedGoal: number;
}

/**
 * Every step of one journey that has an email on record, with its numbers.
 * `goalStops` are the stop reasons that mean the journey reached its goal.
 */
export async function journeyStepCounts(pool: Pool, journeyKey: string, goalStops: readonly string[]): Promise<StepCounts[]> {
  const goals = goalStops.length ? goalStops : ["(none)"];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one journey's ledger rows by the journey index, with what each person did next
    "SELECT m.step_key, COUNT(*) AS sent, " +
      "SUM(m.status = 'delivered' OR m.delivered_at IS NOT NULL) AS delivered, " +
      "SUM(m.status = 'bounced' OR m.bounced_at IS NOT NULL) AS bounced, " +
      "SUM(EXISTS (SELECT 1 FROM comms_permissions p WHERE p.contact_id = m.contact_id AND p.kind = m.kind AND p.state = 'no' " +
      "  AND p.changed_at >= m.sent_at AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.evidence, '$.holdOnly')), '') <> 'true') " +
      " OR EXISTS (SELECT 1 FROM comms_suppressions s WHERE s.village_id = m.village_id AND s.email_key = m.email_key " +
      "  AND s.reason IN ('unsubscribed_all', 'complained') AND s.created_at >= m.sent_at)) AS unsubscribed, " +
      "SUM(EXISTS (SELECT 1 FROM event_rsvps r WHERE r.user_id IN (COALESCE(m.user_id, ''), CONCAT('guest:', COALESCE(m.contact_id, ''))) " +
      "  AND r.status = 'going' AND r.updated_at > m.sent_at AND r.updated_at <= m.sent_at + INTERVAL ? DAY)) AS rsvpd, " +
      "SUM(EXISTS (SELECT 1 FROM event_attendance a WHERE a.person_key IN (COALESCE(m.user_id, ''), CONCAT('guest:', COALESCE(m.contact_id, ''))) " +
      "  AND a.status = 'came' AND a.marked_at > m.sent_at AND a.marked_at <= m.sent_at + INTERVAL ? DAY)) AS came, " +
      "SUM(EXISTS (SELECT 1 FROM comms_enrollments e WHERE e.id = m.enrollment_id AND e.state = 'stopped' AND e.stop_reason IN (?) " +
      "  AND e.updated_at >= m.sent_at AND e.updated_at <= m.sent_at + INTERVAL ? DAY)) AS reached_goal " +
      "FROM comms_messages m WHERE m.village_id = ? AND m.journey_key = ? AND m.sent_at IS NOT NULL AND m.status <> 'rehearsed' " +
      "GROUP BY m.step_key",
    [OUTCOME_WINDOW_DAYS, OUTCOME_WINDOW_DAYS, goals, OUTCOME_WINDOW_DAYS, VILLAGE, journeyKey],
  );
  return rows.map((r) => ({
    stepKey: String(r.step_key),
    sent: Number(r.sent ?? 0),
    delivered: Number(r.delivered ?? 0),
    bounced: Number(r.bounced ?? 0),
    unsubscribed: Number(r.unsubscribed ?? 0),
    rsvpd: Number(r.rsvpd ?? 0),
    came: Number(r.came ?? 0),
    reachedGoal: Number(r.reached_goal ?? 0),
  }));
}

/** The enrollments that were sent one step, newest first: who "took the next step" is asked of. */
export async function enrollmentsSentStep(pool: Pool, journeyKey: string, stepKey: string, limit: number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one journey step's ledger rows by the journey index
    "SELECT DISTINCT m.enrollment_id FROM comms_messages m WHERE m.village_id = ? AND m.journey_key = ? AND m.step_key = ? " +
      "AND m.sent_at IS NOT NULL AND m.status <> 'rehearsed' AND m.enrollment_id IS NOT NULL ORDER BY m.enrollment_id LIMIT ?",
    [VILLAGE, journeyKey, stepKey, limit],
  );
  return rows.map((r) => String(r.enrollment_id));
}
