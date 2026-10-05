/**
 * ONE PERSON ACROSS THE COMMS TABLES: what the People screen reads about
 * somebody, what their data export carries, and what their erasure removes
 * (the comms build spec 5.3 and 5.17).
 *
 * WHY ONE FILE FOR A PERSON, when every other comms repo is one table family.
 * A person in this system is spread over a dozen tables from three
 * migrations: the address book, their answers, the post office ledger, the
 * journeys, the paths, the gatherings' guest rows, votes, attendance and
 * feedback. The erasure sweep's own header gives the reason that decides it:
 * a deletion promise is only checkable when it is ONE enumerable list, and a
 * list split across nine files is a list nobody can see is complete. So the
 * export reads and the erasure writes sit side by side here, table by table,
 * and the test beside the erasure seeds a row in every one of them.
 *
 * WHO A PERSON IS, HERE. Their contacts (by the user id an account links, and
 * by the address keys given), and the person keys those make: the user id
 * for a member, `guest:<contactId>` for each contact (shared/comms/kinds.ts).
 *
 * READS OF THE SUPPRESSIONS TABLE. Writes to `comms_suppressions` belong to
 * the post office lane's module, and the People screen reaches them through
 * that module. This file reads one row by its key for the person page, and
 * the erasure deletes the person's rows directly, because an erasure step
 * must not depend on a module that may refuse it. The interim writers that
 * stood at the foot of this file went at the merge that wired the module in.
 *
 * Raw SQL lives here and nowhere else. Instants come out through
 * UNIX_TIMESTAMP, for the reason server/repos/commsMessages.ts gives.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { emailKeyOf } from "../../shared/comms/address";
import { guestPersonKey } from "../../shared/comms/kinds";

const VILLAGE = "local";

/** Escape a value for use inside a LIKE pattern with `ESCAPE '\\'`. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** What a removed address and a removed subject read as, once a person is erased. */
export const ERASED_ADDRESS = "[removed]";
export const ERASED_SUBJECT = "[removed with the person]";

// ── The People screen ───────────────────────────────────────────────────────

export interface PersonListRow {
  id: string;
  email: string;
  name: string | null;
  userId: string | null;
  firstSource: string;
  /** Epoch seconds. */
  createdAt: number;
  messages: number;
  /** Epoch seconds, or null when nothing was ever written to them. */
  lastMessageAt: number | null;
  /** Why email to them is stopped, or null. */
  suppression: string | null;
}

/**
 * One page of the address book, newest first, with how many emails each
 * person has had. `q` matches the address or the name, as typed.
 */
export async function searchPeople(
  pool: Pool,
  input: { q?: string; limit: number; offset: number },
): Promise<{ rows: PersonListRow[]; total: number }> {
  const q = String(input.q ?? "").trim().toLowerCase();
  const where = q ? "AND (c.email_key LIKE ? ESCAPE '\\\\' OR LOWER(c.name) LIKE ? ESCAPE '\\\\')" : "";
  const like = `%${likeEscape(q)}%`;
  const params: unknown[] = q ? [VILLAGE, like, like] : [VILLAGE];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book with each person's email count, bounded by LIMIT
    "SELECT c.id, c.email, c.name, c.user_id, c.first_source, UNIX_TIMESTAMP(c.created_at) AS created_at, " +
      "(SELECT COUNT(*) FROM comms_messages m WHERE m.contact_id = c.id) AS messages, " +
      "(SELECT UNIX_TIMESTAMP(MAX(m2.created_at)) FROM comms_messages m2 WHERE m2.contact_id = c.id) AS last_message_at, " +
      "s.reason AS suppression " +
      "FROM comms_contacts c LEFT JOIN comms_suppressions s ON s.village_id = c.village_id AND s.email_key = c.email_key " +
      `WHERE c.village_id = ? ${where} ORDER BY c.created_at DESC, c.id LIMIT ? OFFSET ?`,
    [...params, Math.max(1, Math.trunc(input.limit)), Math.max(0, Math.trunc(input.offset))],
  );
  const [count] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book, counted under the same filter
    `SELECT COUNT(*) AS n FROM comms_contacts c WHERE c.village_id = ? ${where}`,
    params,
  );
  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      email: String(r.email),
      name: str(r.name),
      userId: str(r.user_id),
      firstSource: String(r.first_source),
      createdAt: Number(r.created_at),
      messages: Number(r.messages ?? 0),
      lastMessageAt: num(r.last_message_at),
      suppression: str(r.suppression),
    })),
    total: Number(count[0]?.n ?? 0),
  };
}

export interface PersonContact {
  id: string;
  emailKey: string;
  email: string;
  name: string | null;
  userId: string | null;
  firstSource: string;
  timezone: string | null;
  /** Epoch seconds. */
  createdAt: number;
  updatedAt: number | null;
}

const contactOf = (r: RowDataPacket): PersonContact => ({
  id: String(r.id),
  emailKey: String(r.email_key),
  email: String(r.email),
  name: str(r.name),
  userId: str(r.user_id),
  firstSource: String(r.first_source),
  timezone: str(r.timezone),
  createdAt: Number(r.created_at),
  updatedAt: num(r.updated_at),
});

const CONTACT_COLUMNS =
  "id, email_key, email, name, user_id, first_source, timezone, " +
  "UNIX_TIMESTAMP(created_at) AS created_at, UNIX_TIMESTAMP(updated_at) AS updated_at";

/** One contact with its dates, or null. */
export async function personContact(pool: Pool, contactId: string): Promise<PersonContact | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book, one row by id
    `SELECT ${CONTACT_COLUMNS} FROM comms_contacts WHERE village_id = ? AND id = ? LIMIT 1`,
    [VILLAGE, contactId],
  );
  return rows[0] ? contactOf(rows[0]) : null;
}

export interface SuppressionRow {
  emailKey: string;
  reason: string;
  detail: string | null;
  createdBy: string | null;
  /** Epoch seconds. */
  createdAt: number;
}

/** The suppression on one address, or null. A read by the table's own key. */
export async function suppressionOf(pool: Pool, emailKey: string): Promise<SuppressionRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one suppression by its primary key, read for the person page
    "SELECT email_key, reason, detail, created_by, UNIX_TIMESTAMP(created_at) AS created_at " +
      "FROM comms_suppressions WHERE village_id = ? AND email_key = ? LIMIT 1",
    [VILLAGE, emailKey],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    emailKey: String(r.email_key),
    reason: String(r.reason),
    detail: str(r.detail),
    createdBy: str(r.created_by),
    createdAt: Number(r.created_at),
  };
}

export interface PersonMessage {
  id: string;
  kind: string;
  origin: string;
  subject: string;
  status: string;
  skipReason: string | null;
  attempts: number;
  lastError: string | null;
  rehearsalTo: string | null;
  journeyKey: string | null;
  stepKey: string | null;
  /** Epoch seconds. */
  createdAt: number;
  sentAt: number | null;
  deliveredAt: number | null;
  bouncedAt: number | null;
  complainedAt: number | null;
}

/** Every email written to one contact, newest first, up to `limit`. Never the words. */
export async function messagesForContact(pool: Pool, contactId: string, limit = 200): Promise<PersonMessage[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, one contact's rows, bounded by LIMIT
    "SELECT id, kind, origin, subject, status, skip_reason, attempts, last_error, rehearsal_to, journey_key, step_key, " +
      "UNIX_TIMESTAMP(created_at) AS created_at, UNIX_TIMESTAMP(sent_at) AS sent_at, " +
      "UNIX_TIMESTAMP(delivered_at) AS delivered_at, UNIX_TIMESTAMP(bounced_at) AS bounced_at, " +
      "UNIX_TIMESTAMP(complained_at) AS complained_at " +
      "FROM comms_messages WHERE village_id = ? AND contact_id = ? ORDER BY created_at DESC, id LIMIT ?",
    [VILLAGE, contactId, Math.max(1, Math.trunc(limit))],
  );
  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    origin: String(r.origin),
    subject: String(r.subject),
    status: String(r.status),
    skipReason: str(r.skip_reason),
    attempts: Number(r.attempts ?? 0),
    lastError: str(r.last_error),
    rehearsalTo: str(r.rehearsal_to),
    journeyKey: str(r.journey_key),
    stepKey: str(r.step_key),
    createdAt: Number(r.created_at),
    sentAt: num(r.sent_at),
    deliveredAt: num(r.delivered_at),
    bouncedAt: num(r.bounced_at),
    complainedAt: num(r.complained_at),
  }));
}

export interface PersonEnrollment {
  id: string;
  journeyKey: string;
  journeyVersion: number;
  subjectRef: string;
  state: string;
  stopReason: string | null;
  /** Epoch seconds. */
  enrolledAt: number;
  nextCheckAt: number | null;
}

/** Every journey one contact is on or was on, newest first. */
export async function enrollmentsForContact(pool: Pool, contactId: string): Promise<PersonEnrollment[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one contact's rows
    "SELECT id, journey_key, journey_version, subject_ref, state, stop_reason, " +
      "UNIX_TIMESTAMP(enrolled_at) AS enrolled_at, UNIX_TIMESTAMP(next_check_at) AS next_check_at " +
      "FROM comms_enrollments WHERE village_id = ? AND contact_id = ? ORDER BY enrolled_at DESC, id",
    [VILLAGE, contactId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    journeyKey: String(r.journey_key),
    journeyVersion: Number(r.journey_version),
    subjectRef: String(r.subject_ref),
    state: String(r.state),
    stopReason: str(r.stop_reason),
    enrolledAt: Number(r.enrolled_at),
    nextCheckAt: num(r.next_check_at),
  }));
}

export interface PeopleCsvRow {
  email: string;
  name: string | null;
  userId: string | null;
  firstSource: string;
  /** Epoch seconds. */
  createdAt: number;
  /** `kind:state` pairs, for the answers this person has actually given. */
  answers: Array<{ kind: string; state: string }>;
  suppression: string | null;
}

/**
 * The whole address book with the answers each person gave, for the CSV the
 * People screen downloads. Oldest first, so two exports line up.
 */
export async function peopleForCsv(pool: Pool): Promise<PeopleCsvRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book for an admin export, one row per contact
    "SELECT c.email, c.name, c.user_id, c.first_source, UNIX_TIMESTAMP(c.created_at) AS created_at, " +
      "GROUP_CONCAT(CONCAT(p.kind, ':', p.state) ORDER BY p.kind SEPARATOR ',') AS answers, s.reason AS suppression " +
      "FROM comms_contacts c " +
      "LEFT JOIN comms_permissions p ON p.contact_id = c.id " +
      "LEFT JOIN comms_suppressions s ON s.village_id = c.village_id AND s.email_key = c.email_key " +
      "WHERE c.village_id = ? GROUP BY c.id, c.email, c.name, c.user_id, c.first_source, c.created_at, s.reason " +
      "ORDER BY c.created_at, c.id",
    [VILLAGE],
  );
  return rows.map((r) => ({
    email: String(r.email),
    name: str(r.name),
    userId: str(r.user_id),
    firstSource: String(r.first_source),
    createdAt: Number(r.created_at),
    answers: String(r.answers ?? "")
      .split(",")
      .filter(Boolean)
      .map((pair) => {
        const [kind, state] = pair.split(":");
        return { kind: String(kind), state: String(state ?? "") };
      }),
    suppression: str(r.suppression),
  }));
}

// ── Who a person is ─────────────────────────────────────────────────────────

/** The contacts that are this person: linked to their account, or filed under one of their addresses. */
export async function contactsForPerson(
  pool: Pool,
  who: { userId?: string | null; emailKeys?: string[] },
): Promise<PersonContact[]> {
  const keys = (who.emailKeys ?? []).filter((k) => k && k.length <= 191);
  const clauses: string[] = [];
  const params: unknown[] = [VILLAGE];
  if (who.userId) {
    clauses.push("user_id = ?");
    params.push(who.userId);
  }
  if (keys.length) {
    clauses.push("email_key IN (?)");
    params.push(keys);
  }
  if (!clauses.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book, the rows that are one person
    `SELECT ${CONTACT_COLUMNS} FROM comms_contacts WHERE village_id = ? AND (${clauses.join(" OR ")}) ORDER BY created_at, id`,
    params,
  );
  return rows.map(contactOf);
}

interface PersonKeys {
  contactIds: string[];
  emailKeys: string[];
  /** The user id, when there is one, and a guest key for every contact. */
  personKeys: string[];
  guestKeys: string[];
  userId: string | null;
}

async function keysFor(pool: Pool, who: { userId?: string | null; emailKeys?: string[] }): Promise<PersonKeys> {
  const contacts = await contactsForPerson(pool, who);
  const contactIds = contacts.map((c) => c.id);
  const emailKeys = Array.from(new Set([...(who.emailKeys ?? []), ...contacts.map((c) => c.emailKey)])).filter(Boolean);
  const guestKeys = contactIds.map(guestPersonKey);
  const userId = who.userId ?? null;
  return { contactIds, emailKeys, guestKeys, personKeys: [...(userId ? [userId] : []), ...guestKeys], userId };
}

// ── The backfill ────────────────────────────────────────────────────────────

/**
 * Every address a housing request left, with when, for the address book's
 * one-time backfill (server/lib/comms/backfill.ts). Read-only.
 */
export async function housingAddresses(
  pool: Pool,
): Promise<Array<{ email: string; name: string | null; createdAt: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: a read-only pass over housing requests for the address book's one-time backfill
    "SELECT email, name, UNIX_TIMESTAMP(created_at) AS created_at FROM housing_reservations WHERE village_id = ? ORDER BY created_at, id",
    [VILLAGE],
  );
  return rows.map((r) => ({ email: String(r.email ?? ""), name: str(r.name), createdAt: Number(r.created_at ?? 0) }));
}

// ── The export ──────────────────────────────────────────────────────────────

/**
 * Everything the comms tables hold about one person, for the data export.
 *
 * Read-only, one query per table. The words of each email are included while
 * the village still holds them (retention clears them after 30 days), because
 * the export promises everything held. A guest confirmation's token is never
 * included: only its hash is stored, and the hash is not the person's data.
 */
export async function exportCommsPerson(
  pool: Pool,
  who: { userId?: string | null; emailKeys?: string[] },
): Promise<Record<string, unknown>> {
  const k = await keysFor(pool, who);
  const rows = async (sql: string, params: unknown[]): Promise<RowDataPacket[]> =>
    (await pool.query<RowDataPacket[]>(sql, params))[0]; // module-review-ok: the data export's read-only reads, each keyed on this one person
  const none = (list: unknown[]) => list.length === 0;
  const ids = k.contactIds;
  return {
    contacts: none(ids)
      ? []
      : await rows(
          "SELECT email, name, first_source, timezone, created_at, updated_at FROM comms_contacts WHERE id IN (?)",
          [ids],
        ),
    permissions: none(ids)
      ? []
      : await rows("SELECT kind, state, basis, source, evidence, changed_at FROM comms_permissions WHERE contact_id IN (?)", [ids]),
    suppressions: none(k.emailKeys)
      ? []
      : await rows(
          "SELECT email_key, reason, detail, created_at FROM comms_suppressions WHERE village_id = ? AND email_key IN (?)",
          [VILLAGE, k.emailKeys],
        ),
    emails:
      none(ids) && !k.userId
        ? []
        : await rows(
            "SELECT id, to_email, kind, origin, subject, status, skip_reason, body_text, body_html, reply_to, created_at, " +
              "sent_at, delivered_at, bounced_at, complained_at FROM comms_messages WHERE village_id = ? AND (" +
              [...(none(ids) ? [] : ["contact_id IN (?)"]), ...(k.userId ? ["user_id = ?"] : [])].join(" OR ") +
              ") ORDER BY created_at, id",
            [VILLAGE, ...(none(ids) ? [] : [ids]), ...(k.userId ? [k.userId] : [])],
          ),
    journeys: none(ids)
      ? []
      : await rows(
          "SELECT journey_key, subject_ref, state, stop_reason, enrolled_at, updated_at FROM comms_enrollments WHERE contact_id IN (?)",
          [ids],
        ),
    paths: none(k.personKeys)
      ? []
      : await rows(
          "SELECT path_id, source, state, joined_at, left_at, done_at, last_rung FROM path_enrollments " +
            "WHERE village_id = ? AND person_key IN (?)",
          [VILLAGE, k.personKeys],
        ),
    guestRequests: none(ids)
      ? []
      : await rows(
          "SELECT event_id, occurrence_key, status, created_at, expires_at, confirmed_at FROM event_guest_requests WHERE contact_id IN (?)",
          [ids],
        ),
    guestRsvps: none(k.guestKeys)
      ? []
      : await rows("SELECT * FROM event_rsvps WHERE user_id IN (?)", [k.guestKeys]),
    guestWaitlist: none(k.guestKeys)
      ? []
      : await rows("SELECT * FROM event_waitlist WHERE user_id IN (?)", [k.guestKeys]),
    attendance: none(k.personKeys)
      ? []
      : await rows("SELECT event_id, occurrence_key, status, marked_at FROM event_attendance WHERE person_key IN (?)", [k.personKeys]),
    feedback: none(k.personKeys)
      ? []
      : await rows(
          "SELECT event_id, occurrence_key, question_key, answer, created_at, updated_at FROM event_feedback WHERE person_key IN (?)",
          [k.personKeys],
        ),
    timeVotes: none(k.personKeys)
      ? []
      : await rows("SELECT poll_id, option_id, created_at FROM event_time_poll_votes WHERE person_key IN (?)", [k.personKeys]),
    letters: none(ids)
      ? []
      : await rows(
          "SELECT letter_id, status, skip_reason, created_at FROM comms_letter_recipients WHERE contact_id IN (?)",
          [ids],
        ),
  };
}

/** The export's comms section for a signed-in member: their account's contacts and their own address. */
export function exportCommsForMember(pool: Pool, member: { id: string; email?: string | null }): Promise<Record<string, unknown>> {
  const key = emailKeyOf(String(member.email ?? ""));
  return exportCommsPerson(pool, { userId: member.id, emailKeys: key ? [key] : [] });
}

// ── The erasure ─────────────────────────────────────────────────────────────

/** How many rows each table gave up, so a test and a log line can say what happened. */
export type CommsForgetCounts = Record<string, number>;

/**
 * Take one person out of every comms table.
 *
 * EVERY STATEMENT IS A DELETE KEYED ON THE PERSON, OR AN UPDATE WRITING A
 * CONSTANT KEYED ON THEM, so a second run matches nothing and the erasure
 * sweep may resume this step any number of times (server/lib/erasure.ts).
 *
 * THE LEDGER ROWS STAY AND LOSE THE PERSON. A `comms_messages` row is the
 * village's record that an email went, and Sent mail and the journey numbers
 * count it, so the row is kept with its address, subject, words, headers and
 * attachments blanked and its contact unlinked. The subject goes too, because
 * a subject carries a first name the moment a template merges one. Where the
 * person was the SENDER of a relayed message, their address in `reply_to` goes.
 *
 * NO SUPPRESSION IS KEPT. A suppression is the address itself under another
 * name, so keeping an `erased` row would keep the very thing the person asked
 * to have removed. Nothing in comms holds the address after this step, so
 * nothing can write to it again.
 *
 * GUEST ROWS GO WITH THE GUEST. A guest's yes to a gathering and their place
 * on its waitlist are deleted. A seat a future gathering held for them is
 * free from that moment, and the next answer to that gathering serves its
 * waitlist the ordinary way.
 *
 * ORDER: the reports and the ledger first, while the contact ids still find
 * them, the address book last.
 */
export async function forgetCommsPerson(
  pool: Pool,
  who: { userId?: string | null; emailKeys?: string[] },
): Promise<CommsForgetCounts> {
  const k = await keysFor(pool, who);
  const counts: CommsForgetCounts = {};
  const run = async (name: string, sql: string, params: unknown[]): Promise<void> => {
    const [res] = await pool.query<ResultSetHeader>(sql, params); // module-review-ok: the comms erasure step, every statement keyed on this one person
    counts[name] = (counts[name] ?? 0) + Number(res.affectedRows ?? 0);
  };
  const ids = k.contactIds;
  const ledgerWhere: string[] = [];
  const ledgerParams: unknown[] = [];
  if (ids.length) {
    ledgerWhere.push("contact_id IN (?)");
    ledgerParams.push(ids);
  }
  if (k.emailKeys.length) {
    ledgerWhere.push("email_key IN (?)");
    ledgerParams.push(k.emailKeys);
  }
  if (k.userId) {
    ledgerWhere.push("user_id = ?");
    ledgerParams.push(k.userId);
  }

  if (ledgerWhere.length) {
    const mine = `SELECT id FROM comms_messages WHERE village_id = ? AND (${ledgerWhere.join(" OR ")})`;
    const theirs = `SELECT provider_message_id FROM comms_messages WHERE village_id = ? AND provider_message_id IS NOT NULL AND (${ledgerWhere.join(" OR ")})`;
    await run("providerEvents", `DELETE FROM comms_provider_events WHERE message_id IN (${mine})`, [VILLAGE, ...ledgerParams]);
    await run("providerEvents", `DELETE FROM comms_provider_events WHERE provider_message_id IN (${theirs})`, [
      VILLAGE,
      ...ledgerParams,
    ]);
  }
  // A delivery report that matched no row still names the address in its
  // payload. Matched as a whole quoted JSON string, so one address is never
  // found inside a longer one.
  for (const key of k.emailKeys) {
    await run("providerEvents", "DELETE FROM comms_provider_events WHERE LOWER(CAST(payload AS CHAR)) LIKE ? ESCAPE '\\\\'", [
      `%"${likeEscape(key)}"%`,
    ]);
  }
  if (ledgerWhere.length) {
    await run(
      "emails",
      "UPDATE comms_messages SET to_email = ?, email_key = ?, subject = ?, contact_id = NULL, body_html = NULL, " +
        "body_text = NULL, headers = NULL, attachments = NULL, updated_at = CURRENT_TIMESTAMP " +
        `WHERE village_id = ? AND (${ledgerWhere.join(" OR ")})`,
      [ERASED_ADDRESS, ERASED_ADDRESS, ERASED_SUBJECT, VILLAGE, ...ledgerParams],
    );
  }
  if (k.emailKeys.length) {
    await run("emailsRepliedTo", "UPDATE comms_messages SET reply_to = NULL WHERE village_id = ? AND LOWER(reply_to) IN (?)", [
      VILLAGE,
      k.emailKeys,
    ]);
  }
  if (ids.length) {
    await run("journeys", "DELETE FROM comms_enrollments WHERE village_id = ? AND contact_id IN (?)", [VILLAGE, ids]);
    await run("permissions", "DELETE FROM comms_permissions WHERE contact_id IN (?)", [ids]);
    await run("guestRequests", "DELETE FROM event_guest_requests WHERE contact_id IN (?)", [ids]);
  }
  if (ids.length || k.emailKeys.length) {
    await run(
      "letters",
      "DELETE FROM comms_letter_recipients WHERE " +
        [...(ids.length ? ["contact_id IN (?)"] : []), ...(k.emailKeys.length ? ["email_key IN (?)"] : [])].join(" OR "),
      [...(ids.length ? [ids] : []), ...(k.emailKeys.length ? [k.emailKeys] : [])],
    );
  }
  const pathWhere = [
    ...(k.personKeys.length ? ["person_key IN (?)"] : []),
    ...(k.userId ? ["user_id = ?"] : []),
    ...(ids.length ? ["contact_id IN (?)"] : []),
  ];
  if (pathWhere.length) {
    await run("paths", `DELETE FROM path_enrollments WHERE village_id = ? AND (${pathWhere.join(" OR ")})`, [
      VILLAGE,
      ...(k.personKeys.length ? [k.personKeys] : []),
      ...(k.userId ? [k.userId] : []),
      ...(ids.length ? [ids] : []),
    ]);
  }
  if (k.personKeys.length) {
    await run("attendance", "DELETE FROM event_attendance WHERE person_key IN (?)", [k.personKeys]);
    await run("feedback", "DELETE FROM event_feedback WHERE person_key IN (?)", [k.personKeys]);
    await run("timeVotes", "DELETE FROM event_time_poll_votes WHERE person_key IN (?)", [k.personKeys]);
  }
  if (k.guestKeys.length) {
    await run("guestRsvps", "DELETE FROM event_rsvps WHERE user_id IN (?)", [k.guestKeys]);
    await run("guestWaitlist", "DELETE FROM event_waitlist WHERE user_id IN (?)", [k.guestKeys]);
  }
  if (k.userId) {
    await run("hosting", "UPDATE event_comms SET host_user_id = NULL WHERE host_user_id = ?", [k.userId]);
  }
  if (k.emailKeys.length) {
    await run("suppressions", "DELETE FROM comms_suppressions WHERE village_id = ? AND email_key IN (?)", [VILLAGE, k.emailKeys]);
  }
  if (ids.length) {
    await run("contacts", "DELETE FROM comms_contacts WHERE village_id = ? AND id IN (?)", [VILLAGE, ids]);
  }
  return counts;
}

// ── Retention ───────────────────────────────────────────────────────────────

/**
 * Forget contacts nobody has written to and nothing refers to, once they are
 * `months` old (the `comms.retention_months` dial, 5.17).
 *
 * "Nothing refers to" is read widely on purpose: no email on the ledger, no
 * answer on record, no journey, no path, no guest request, and no guest row
 * in a gathering, a vote, an attendance list or a letter. A contact any of
 * those still names is the only way that row resolves to a person, and
 * deleting it would leave an organiser's list reading "a guest" where a name
 * was. The clock is the later of when the contact was made and last changed.
 */
export async function sweepIdleContacts(pool: Pool, months: number): Promise<number> {
  const m = Math.trunc(months);
  if (!(m > 0)) return 0;
  // The outer table is named in full: a single-table DELETE takes no alias on
  // every engine this runs on, and each subquery reads a different table.
  const id = "comms_contacts.id";
  const guest = "CONCAT('guest:', comms_contacts.id)";
  const none = (sql: string) => `AND NOT EXISTS (${sql}) `;
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the retention sweep over the address book, bounded by age and LIMIT
    "DELETE FROM comms_contacts " +
      "WHERE village_id = ? AND COALESCE(updated_at, created_at) < CURRENT_TIMESTAMP - INTERVAL ? MONTH " +
      none(`SELECT 1 FROM comms_messages m WHERE m.contact_id = ${id}`) +
      none(`SELECT 1 FROM comms_permissions p WHERE p.contact_id = ${id}`) +
      none(`SELECT 1 FROM comms_enrollments e WHERE e.contact_id = ${id}`) +
      none(`SELECT 1 FROM path_enrollments pe WHERE pe.contact_id = ${id} OR pe.person_key = ${guest}`) +
      none(`SELECT 1 FROM event_guest_requests g WHERE g.contact_id = ${id}`) +
      none(`SELECT 1 FROM event_rsvps r WHERE r.user_id = ${guest}`) +
      none(`SELECT 1 FROM event_waitlist w WHERE w.user_id = ${guest}`) +
      none(`SELECT 1 FROM event_attendance a WHERE a.person_key = ${guest}`) +
      none(`SELECT 1 FROM event_feedback f WHERE f.person_key = ${guest}`) +
      none(`SELECT 1 FROM event_time_poll_votes v WHERE v.person_key = ${guest}`) +
      none(`SELECT 1 FROM comms_letter_recipients lr WHERE lr.contact_id = ${id}`) +
      "LIMIT 5000",
    [VILLAGE, m],
  );
  return res.affectedRows;
}
