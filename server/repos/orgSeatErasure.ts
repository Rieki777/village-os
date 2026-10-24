/**
 * WHAT A SEAT'S JOURNAL STILL SAYS ABOUT A MEMBER WHO HAS LEFT, for the
 * erasure sweep (server/lib/erasure.ts: "org-seatings",
 * "seat-journal-after-tombstone" and "org-seatings-after-tombstone").
 *
 * WHY. A seat's journal is the `health_events` rows typed `org_role`, and
 * `GET /api/org/:kind/:id/journal` reads them whole for any account holding
 * `map.viewPeople`, which opens at the guest rung. Four of the lines written
 * there put a seating's recorded name in the words:
 *
 *   <first name> asks to be confirmed as the holder recorded "<name>"   (the member)
 *   confirmed: the holder recorded "<name>" is a member here           (a steward)
 *   declined: the role stays recorded under "<name>"                   (a steward)
 *   seated <name>                                                      (an admin documenting a holder)
 *
 * Once a seating is the member's, that name is theirs. `releaseSeatingsForUser`
 * takes it off the seating for exactly that reason, and the journal went on
 * serving it to every account. The routes write all four with no name now
 * (server/routes/org.ts, from the constants below; the `seated` line since
 * adversarial round 3); this is for the lines already written.
 *
 * WHICH NAMES ARE THEIRS, found four ways, because no one way survives every
 * path a sweep can take:
 *
 *   1. the names still on seatings they hold or held, which
 *      `releaseSeatingsForUser` takes away, so "org-seatings" reads the
 *      journal first;
 *   2. the name quoted in each ask they wrote, found by their id as its actor,
 *      which no other step touches;
 *   3. the recorded name on each seat claim they filed, handed in by the
 *      sweep, which reads the inbox before anything scrubs it;
 *   4. their own name and first name, on the seats they held, for a record
 *      that passed "org-seatings" before it read the journal. The claim route
 *      only ever offers a seating recorded under one of those.
 *
 * A seating a steward confirmed with no ask behind it, under a spelling that
 * is none of their names, is found by way 1 alone. A sweep that passed
 * "org-seatings" before this existed has lost that name for good.
 *
 * WHAT HAPPENS TO A LINE FOUND. It stays, with its kind, its actor, its seat
 * and its date, so the journal still says what happened to the seat and when.
 * Its words become the line the route writes today. A line is matched by its
 * seat and by its WHOLE text, never by a fragment, so a neighbour's line on the
 * same seat is left alone. `at = at` because the first TIMESTAMP column of a
 * table may carry an implicit ON UPDATE.
 *
 * The `seated` line is rewritten only for a name the member held (ways 1 and
 * 4, and 3 when the claim was accepted). An ask that was declined leaves the
 * seating documented under that name, so the line that documented it is still
 * about whoever the chart says holds it.
 *
 * Every statement writes a constant to rows found through the member, so a
 * second run matches nothing and a resume may run it any number of times.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** The journal lines the seat-claim routes write, with no name in them. */
export const SEAT_JOURNAL_LINE = {
  ask: "asks to be confirmed as the recorded holder",
  confirm: "confirmed: the recorded holder is a member here",
  decline: "declined: the role stays as it was recorded",
  seated: "seated someone",
} as const;

/** The words the ask route wrote before the name came out, up to the quoted name. */
const ASKED_MARKER = ' asks to be confirmed as the holder recorded "';

/** A recorded name on one seat, and whether the seating under it became the member's. */
export interface SeatName {
  roleId: string;
  name: string;
  held: boolean;
}

/** Every seat they hold or held, with the recorded name still on it where there is one. */
async function seatingsOf(pool: Pool, userId: string): Promise<Array<{ roleId: string; name: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT org_role_id, display_name FROM org_role_assignments WHERE user_id = ?",
    [userId],
  );
  return rows.map((r) => ({ roleId: String(r.org_role_id), name: r.display_name == null ? "" : String(r.display_name) }));
}

/** The recorded name an ask in the old words quotes, or null for any other line. */
function quotedAskName(text: string): string | null {
  const at = text.indexOf(ASKED_MARKER);
  if (at < 0 || !text.endsWith('"')) return null;
  return text.slice(at + ASKED_MARKER.length, -1);
}

/** The seat and the quoted name of every ask the member wrote in the old words. */
async function askedNames(pool: Pool, userId: string): Promise<SeatName[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT entity_ref, text FROM health_events WHERE entity_type = 'org_role' AND actor_user_id = ? AND text LIKE ?",
    [userId, `%${ASKED_MARKER}%`],
  );
  const out: SeatName[] = [];
  for (const r of rows) {
    const name = quotedAskName(String(r.text ?? ""));
    if (name !== null) out.push({ roleId: String(r.entity_ref ?? ""), name, held: false });
  }
  return out;
}

/** Rewrite one seat's line whose WHOLE text is `was`. Returns how many rows changed. */
async function rewriteLine(pool: Pool, roleId: string, was: string, now: string): Promise<number> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE health_events SET text = ?, at = at WHERE entity_type = 'org_role' AND entity_ref = ? AND text = ?",
    [now, roleId, was],
  );
  return Number(r.affectedRows ?? 0);
}

/** The steward's lines that quote a recorded name, and the admin's `seated` line when the name is the holder's. */
async function rewriteNamedLines(pool: Pool, roleId: string, name: string, held: boolean): Promise<number> {
  let changed = 0;
  changed += await rewriteLine(pool, roleId, `confirmed: the holder recorded "${name}" is a member here`, SEAT_JOURNAL_LINE.confirm);
  changed += await rewriteLine(pool, roleId, `declined: the role stays recorded under "${name}"`, SEAT_JOURNAL_LINE.decline);
  if (held) changed += await rewriteLine(pool, roleId, `seated ${name}`, SEAT_JOURNAL_LINE.seated);
  return changed;
}

/*
 * A DOCUMENTED HOLDER, WHO HAS NO ACCOUNT (adversarial round 3, finding 12).
 *
 * `forgetDocumentedHolder` (server/lib/orgChart.ts) is the only door for a
 * person recorded on the chart who never signed up, and it took the name off
 * the seatings and left it in the journal: "seated <name>" from the admin who
 * documented them, the steward's quoted confirm and decline, and the ask of
 * whoever claimed to be them. The same rewrite as the member's, keyed on the
 * names the seatings themselves carry, because nothing joins this person to a
 * user id.
 *
 * ORDER. The forget runs no transaction, so it reads the names and rewrites
 * the journal BEFORE it nulls them. A failure part way leaves the names on the
 * seatings, and the next attempt finds them again.
 *
 * WHAT NOTHING CAN REACH. A holder forgotten before this existed has lost
 * `display_name` and the slug in `holder_key` both, so no line of theirs can
 * be matched by name any more. Only serving non-admin readers the public
 * lines alone would hide those.
 */

/** A recorded name on one seat. */
export interface SeatRecordedName {
  roleId: string;
  name: string;
}

/**
 * Every recorded name under one documented holder key, seat by seat, ended
 * seatings included. Two spellings slug to one key, so both come back.
 */
export async function documentedSeatNames(pool: Pool, holderKey: string): Promise<SeatRecordedName[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT org_role_id, display_name FROM org_role_assignments " +
      "WHERE holder_key = ? AND holder_kind = 'documented' AND display_name IS NOT NULL",
    [holderKey],
  );
  return rows
    .map((r) => ({ roleId: String(r.org_role_id ?? ""), name: String(r.display_name ?? "") }))
    .filter((p) => p.roleId && p.name.trim());
}

/**
 * Rewrite every journal line on each seat that names the person recorded
 * there: `seated <name>`, the quoted confirm and decline, and an ask quoting
 * the name, whoever wrote it. The ask starts with the asker's first name, so
 * it is found by its seat and its quoted name, then rewritten by id. A
 * neighbour's line on the same seat matches none of these. Returns how many
 * lines changed, which a second run makes zero.
 */
export async function forgetNamesInSeatJournals(pool: Pool, names: readonly SeatRecordedName[]): Promise<number> {
  const pairs = new Map<string, SeatRecordedName>();
  for (const p of names) if (p.roleId && p.name.trim()) pairs.set(`${p.roleId}\u0000${p.name}`, p);
  let changed = 0;
  for (const { roleId, name } of Array.from(pairs.values())) {
    changed += await rewriteNamedLines(pool, roleId, name, true);
    const [asks] = await pool.query<RowDataPacket[]>(
      "SELECT id, text FROM health_events WHERE entity_type = 'org_role' AND entity_ref = ? AND text LIKE ?",
      [roleId, `%${ASKED_MARKER}%`],
    );
    for (const r of asks) {
      const text = String(r.text ?? "");
      if (quotedAskName(text) !== name) continue;
      const [u] = await pool.query<ResultSetHeader>(
        "UPDATE health_events SET text = ?, at = at WHERE id = ? AND text = ?",
        [SEAT_JOURNAL_LINE.ask, r.id, text],
      );
      changed += Number(u.affectedRows ?? 0);
    }
  }
  return changed;
}

/**
 * Rewrite every journal line that names the member through a seat, and their
 * own asks. Returns how many lines changed, which a second run makes zero.
 */
export async function forgetSeatJournalNames(
  pool: Pool,
  input: { userId: string; ownNames: readonly string[]; claims: readonly SeatName[] },
): Promise<number> {
  const seatings = await seatingsOf(pool, input.userId);
  const own = Array.from(new Set(input.ownNames.map((n) => String(n ?? "").trim()).filter(Boolean)));
  const seats = Array.from(new Set(seatings.map((s) => s.roleId)));
  const found: SeatName[] = [
    ...seatings.filter((s) => s.name.trim()).map((s) => ({ roleId: s.roleId, name: s.name, held: true })),
    ...(await askedNames(pool, input.userId)),
    ...input.claims,
    ...seats.flatMap((roleId) => own.map((name) => ({ roleId, name, held: true }))),
  ];
  const pairs = new Map<string, SeatName>();
  for (const p of found) {
    if (!p.roleId || !p.name.trim()) continue;
    const key = `${p.roleId}\u0000${p.name}`;
    const seen = pairs.get(key);
    pairs.set(key, { ...p, held: p.held || !!seen?.held });
  }

  let changed = 0;
  for (const { roleId, name, held } of Array.from(pairs.values())) {
    changed += await rewriteNamedLines(pool, roleId, name, held);
  }
  // Their own asks last, because way 2 reads the name out of them.
  const [asks] = await pool.query<ResultSetHeader>(
    "UPDATE health_events SET text = ?, at = at WHERE entity_type = 'org_role' AND actor_user_id = ? AND text LIKE ?",
    [SEAT_JOURNAL_LINE.ask, input.userId, `%${ASKED_MARKER}%`],
  );
  return changed + Number(asks.affectedRows ?? 0);
}
