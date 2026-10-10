/**
 * The readers and writers for `comms_permissions`: what each person in the
 * address book said yes or no to, why the village holds that answer, and the
 * evidence for it (drizzle/0244).
 *
 * ONE ROW PER CONTACT AND KIND, and `essential` is never a row: a password
 * link always goes, so there is nothing to ask. A kind with no row means the
 * person has said nothing about it, and what follows from that is decided in
 * server/lib/comms/permissions.ts, never here.
 *
 * EVERY WRITE REPLACES THE WHOLE ANSWER. State, basis, source and evidence are
 * one fact (who said what, on what grounds), so an upsert sets all four and
 * stamps `changed_at`. A half-updated row would pair a new answer with the
 * evidence for an old one.
 *
 * Raw SQL lives here and nowhere else (the comms build spec section 1,
 * rule 6). No cache sits above this table. Instants come out through
 * UNIX_TIMESTAMP, for the reason server/repos/commsMessages.ts gives.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { PermissionBasis, PermissionKind, PermissionState } from "../../shared/comms/kinds";

export interface PermissionRow {
  contactId: string;
  kind: PermissionKind;
  state: PermissionState;
  basis: PermissionBasis;
  source: string;
  evidence: Record<string, unknown> | null;
  /** Epoch seconds. */
  changedAt: number;
}

/** A JSON column read by either driver shape: parsed already, or a string. */
function jsonOf(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "object") return Array.isArray(v) ? null : (v as Record<string, unknown>);
  try {
    const parsed = JSON.parse(String(v));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const toRow = (r: RowDataPacket): PermissionRow => ({
  contactId: String(r.contact_id),
  kind: String(r.kind) as PermissionKind,
  state: String(r.state) as PermissionState,
  basis: String(r.basis) as PermissionBasis,
  source: String(r.source),
  evidence: jsonOf(r.evidence),
  changedAt: Number(r.changed_at),
});

const COLUMNS = "contact_id, kind, state, basis, source, evidence, UNIX_TIMESTAMP(changed_at) AS changed_at";

/** Every answer one contact has given, in kind order. */
export async function permissionsForContact(pool: Pool, contactId: string): Promise<PermissionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the permissions table, every row of one contact
    `SELECT ${COLUMNS} FROM comms_permissions WHERE contact_id = ? ORDER BY kind`,
    [contactId],
  );
  return rows.map(toRow);
}

/** One contact's answer about one kind, or null when they have said nothing. */
export async function permissionRow(pool: Pool, contactId: string, kind: PermissionKind): Promise<PermissionRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the permissions table, one row by its primary key
    `SELECT ${COLUMNS} FROM comms_permissions WHERE contact_id = ? AND kind = ? LIMIT 1`,
    [contactId, kind],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Record one answer, replacing whatever was there for that contact and kind. */
export async function upsertPermission(
  pool: Pool,
  input: {
    contactId: string;
    kind: PermissionKind;
    state: PermissionState;
    basis: PermissionBasis;
    source: string;
    evidence: Record<string, unknown> | null;
  },
): Promise<void> {
  await pool.query( // module-review-ok: the permissions table's one writer, one row by its primary key
    "INSERT INTO comms_permissions (contact_id, kind, state, basis, source, evidence) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE state = VALUES(state), basis = VALUES(basis), source = VALUES(source), " +
      "evidence = VALUES(evidence), changed_at = CURRENT_TIMESTAMP",
    [
      input.contactId,
      input.kind,
      input.state,
      input.basis,
      input.source.slice(0, 64),
      input.evidence ? JSON.stringify(input.evidence) : null,
    ],
  );
}

/** Forget one answer, so the kind reads as never asked. Answers whether a row went. */
export async function deletePermission(pool: Pool, contactId: string, kind: PermissionKind): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the permissions table, one row by its primary key
    "DELETE FROM comms_permissions WHERE contact_id = ? AND kind = ?",
    [contactId, kind],
  );
  return res.affectedRows > 0;
}
