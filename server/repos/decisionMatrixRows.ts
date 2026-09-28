/**
 * THE DECISION MATRIX'S HUMAN COLUMNS (0223).
 *
 * The platform writes the other half of the matrix on every read, from the
 * rules it enforces (shared/decisionMatrix.ts), and stores none of it. These
 * rows are what only the village can say about a kind of decision: who
 * approves it, who is asked first, who is told, the method, and any risk tags.
 * Risk tags are information and never law: nothing reads them to decide
 * anything.
 *
 * ALL of the SQL for `decision_matrix_rows` lives here. Who may write a row is
 * the consequence pen's question (shared/powerHands.ts), asked by the route
 * before any of these run; nothing in this file checks a permission.
 *
 * Tags are stored as one comma-joined string. `parseMatrixRow` in
 * shared/canvasFrames.ts refuses a tag that contains a comma, so the join is
 * lossless, and a varchar keeps the column a plain string any release can read.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { MatrixRowChange } from "../../shared/canvasFrames";

export interface DecisionMatrixRow {
  id: number;
  subject: string;
  approval: string;
  consultation: string;
  information: string;
  method: string;
  riskTags: string[];
  updatedBy: string;
  /** The last writer's name, or null if the account is gone. */
  updatedByName: string | null;
  /** ISO instant. */
  updatedAt: string;
}

function toRow(r: RowDataPacket): DecisionMatrixRow {
  return {
    id: Number(r.id),
    subject: String(r.subject),
    approval: String(r.approval ?? ""),
    consultation: String(r.consultation ?? ""),
    information: String(r.information ?? ""),
    method: String(r.method ?? ""),
    riskTags: String(r.risk_tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
    updatedBy: String(r.updated_by),
    updatedByName: r.updated_by_name === null || r.updated_by_name === undefined ? null : String(r.updated_by_name),
    updatedAt: new Date(Number(r.updated_epoch) * 1000).toISOString(),
  };
}

const SELECT =
  "SELECT m.id, m.subject, m.approval, m.consultation, m.information, m.method, m.risk_tags, m.updated_by, " +
  "UNIX_TIMESTAMP(m.updated_at) AS updated_epoch, u.name AS updated_by_name " +
  "FROM decision_matrix_rows m LEFT JOIN users u ON u.id = m.updated_by";

/** Every human row, in the order they were first written. */
export async function allDecisionMatrixRows(pool: Pool): Promise<DecisionMatrixRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT} ORDER BY m.id`);
  return rows.map(toRow);
}

export async function decisionMatrixRowById(pool: Pool, id: number): Promise<DecisionMatrixRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT} WHERE m.id = ?`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Write a row: a new one when `row.rowId` is absent, that row when present.
 * Returns the row's id, or null when `rowId` names no row.
 */
export async function writeDecisionMatrixRow(pool: Pool, row: MatrixRowChange, updatedBy: string): Promise<number | null> {
  const values = [row.subject, row.approval, row.consultation, row.information, row.method, row.riskTags.join(","), updatedBy];
  if (row.rowId) {
    const [result] = await pool.query<ResultSetHeader>(
      "UPDATE decision_matrix_rows SET subject = ?, approval = ?, consultation = ?, information = ?, method = ?, " +
        "risk_tags = ?, updated_by = ?, updated_at = NOW() WHERE id = ?",
      [...values, row.rowId],
    );
    // A write that changes nothing (same words, same second) reports zero
    // affected rows on a connection without CLIENT_FOUND_ROWS, so zero is read
    // back rather than taken to mean "no such row".
    if (result.affectedRows === 1) return row.rowId;
    return (await decisionMatrixRowById(pool, row.rowId)) ? row.rowId : null;
  }
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO decision_matrix_rows (subject, approval, consultation, information, method, risk_tags, updated_by) " +
      "VALUES (?,?,?,?,?,?,?)",
    values,
  );
  return Number(result.insertId);
}

/** Remove one row. True when a row was removed. */
export async function removeDecisionMatrixRow(pool: Pool, id: number): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>("DELETE FROM decision_matrix_rows WHERE id = ?", [id]);
  return result.affectedRows === 1;
}
