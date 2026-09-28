/**
 * THE CANVAS SUGGESTIONS: what anybody in the village has proposed as an
 * answer to a canvas block, and what the pen did with it (0223).
 *
 * ALL of the SQL for `canvas_proposals` lives here. The raw-SQL burn-down
 * register is at its ceiling, so the route module holds none, and this file is
 * exempt from that register by living in server/repos.
 *
 * ── A SUGGESTION MOVES ONCE ────────────────────────────────────────────────
 *
 * `open`, then `adopted` or `declined`, and never back. The one statement that
 * changes a row is `decideCanvasProposal`, and it changes only a row that is
 * still open (`WHERE status = 'open'`), so two pens deciding the same
 * suggestion at once cannot both record a decision: the second one's UPDATE
 * touches nothing and it is told so. The body, the target and the change are
 * never rewritten, because the village read those words; a changed mind is a
 * new suggestion.
 *
 * ── TIMES ARE READ AS UNIX_TIMESTAMP ───────────────────────────────────────
 *
 * The same pairing server/repos/canvasReadings.ts uses: `created_at` is written
 * by the column DEFAULT in the session's zone and read back as
 * `UNIX_TIMESTAMP`, which MySQL evaluates in that same zone. `decided_at` is
 * written with `NOW()` for the same reason, never with a JS Date the driver
 * would convert.
 *
 * No cache sits above this table. A suggestion made a moment ago is on the
 * next load.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  isCanvasDoorId,
  PROPOSAL_SOURCES,
  PROPOSAL_STATUSES,
  PROPOSAL_TARGETS,
  type CanvasDoorId,
  type CanvasProposalInput,
  type ProposalSource,
  type ProposalStatus,
  type ProposalTarget,
} from "../../shared/canvasFrames";
import { isCanvasBlockId, type CanvasBlockId } from "../../shared/governanceCanvas";

export interface CanvasProposalRow {
  id: number;
  blockId: CanvasBlockId;
  target: ProposalTarget;
  sectionId: string | null;
  door: CanvasDoorId | null;
  /** The structured change a setting or matrix suggestion carries, parsed. Null on words. */
  change: Record<string, unknown> | null;
  body: string;
  /** The proposer's purpose line, or null where the field does not exist. */
  servesPurpose: string | null;
  source: ProposalSource;
  proposedBy: string;
  /** The proposer's name as the users table holds it, or null if the account is gone. */
  proposerName: string | null;
  status: ProposalStatus;
  decidedBy: string | null;
  /** The decider's name as the users table holds it, or null while open or if the account is gone. */
  deciderName: string | null;
  decisionNote: string | null;
  /** What adopting it did, as the route recorded it. Null until adopted. */
  outcome: Record<string, unknown> | null;
  /** ISO instant. */
  createdAt: string;
  /** ISO instant, or null while open. */
  decidedAt: string | null;
}

const COLUMNS =
  "p.id, p.block_id, p.target, p.section_id, p.door, p.change_json, p.body, p.serves_purpose, p.source, " +
  "p.proposed_by, p.status, p.decided_by, p.decision_note, p.outcome_json, " +
  "UNIX_TIMESTAMP(p.created_at) AS created_epoch, UNIX_TIMESTAMP(p.decided_at) AS decided_epoch, " +
  "u.name AS proposer_name, d.name AS decider_name";

/** Every read names the proposer and the decider through the users table. */
const FROM = "FROM canvas_proposals p LEFT JOIN users u ON u.id = p.proposed_by LEFT JOIN users d ON d.id = p.decided_by";

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

/**
 * A stored row as the route reads it, or null for a row this build cannot
 * read (a block, target, source or status the registry no longer knows). A
 * fork that removed a block keeps its rows, and they come back if it returns.
 */
function toRow(r: RowDataPacket): CanvasProposalRow | null {
  const blockId = String(r.block_id);
  const target = String(r.target);
  const source = String(r.source);
  const status = String(r.status);
  if (!isCanvasBlockId(blockId) || !isOneOf(PROPOSAL_TARGETS, target) || !isOneOf(PROPOSAL_SOURCES, source) || !isOneOf(PROPOSAL_STATUSES, status)) {
    return null;
  }
  const door = r.door === null || r.door === undefined ? null : String(r.door);
  const decided = r.decided_epoch === null || r.decided_epoch === undefined ? null : Number(r.decided_epoch);
  return {
    id: Number(r.id),
    blockId,
    target,
    sectionId: r.section_id === null || r.section_id === undefined ? null : String(r.section_id),
    door: door && isCanvasDoorId(door) ? door : null,
    change: parseJson(r.change_json),
    body: String(r.body ?? ""),
    servesPurpose: r.serves_purpose === null || r.serves_purpose === undefined ? null : String(r.serves_purpose),
    source,
    proposedBy: String(r.proposed_by),
    proposerName: r.proposer_name === null || r.proposer_name === undefined ? null : String(r.proposer_name),
    status,
    decidedBy: r.decided_by === null || r.decided_by === undefined ? null : String(r.decided_by),
    deciderName: r.decider_name === null || r.decider_name === undefined ? null : String(r.decider_name),
    decisionNote: r.decision_note === null || r.decision_note === undefined ? null : String(r.decision_note),
    outcome: parseJson(r.outcome_json),
    createdAt: new Date(Number(r.created_epoch) * 1000).toISOString(),
    decidedAt: decided === null ? null : new Date(decided * 1000).toISOString(),
  };
}

/** Write one suggestion, already validated by `parseCanvasProposal`. Returns its id. */
export async function insertCanvasProposal(
  pool: Pool,
  input: CanvasProposalInput & { proposedBy: string; servesPurpose: string | null },
): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO canvas_proposals (block_id, target, section_id, door, change_json, body, serves_purpose, source, proposed_by) " +
      "VALUES (?,?,?,?,?,?,?,?,?)",
    [
      input.blockId,
      input.target,
      input.sectionId,
      input.door,
      input.change ? JSON.stringify(input.change) : null,
      input.body,
      input.servesPurpose,
      input.source,
      input.proposedBy,
    ],
  );
  return Number(result.insertId);
}

/** One suggestion by id, whatever its status, or null. */
export async function canvasProposalById(pool: Pool, id: number): Promise<CanvasProposalRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} ${FROM} WHERE p.id = ?`,
    [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** A block's open suggestions, newest first. */
export async function openProposalsForBlock(pool: Pool, blockId: CanvasBlockId): Promise<CanvasProposalRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} ${FROM} WHERE p.block_id = ? AND p.status = 'open' ORDER BY p.created_at DESC, p.id DESC`,
    [blockId],
  );
  return rows.map(toRow).filter((r): r is CanvasProposalRow => r !== null);
}

/** How many decided suggestions a block lists under Adopt, newest decision first. */
export const DECIDED_LISTED = 25;

/**
 * A block's decided suggestions, newest decision first: adopted, declined and
 * withdrawn, each with the note it was decided with. The pen's note is public
 * (Rye, 2026-09-23), and this is where it is read back; before this reader
 * existed a decided suggestion left the only list there was, and its note
 * with it (audit of Wave 3b, 2026-09-28).
 */
export async function decidedProposalsForBlock(pool: Pool, blockId: CanvasBlockId, limit = DECIDED_LISTED): Promise<CanvasProposalRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} ${FROM} WHERE p.block_id = ? AND p.status <> 'open' ORDER BY p.decided_at DESC, p.id DESC LIMIT ?`,
    [blockId, limit],
  );
  return rows.map(toRow).filter((r): r is CanvasProposalRow => r !== null);
}

/** How many suggestions this member has open across the whole canvas. */
export async function openProposalCountBy(pool: Pool, userId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM canvas_proposals WHERE proposed_by = ? AND status = 'open'",
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface CanvasDecision {
  id: number;
  status: Exclude<ProposalStatus, "open">;
  decidedBy: string;
  note: string | null;
  outcome: Record<string, unknown> | null;
}

/**
 * Record the pen's decision. True when this call moved the row; false when it
 * was no longer open, which is somebody else's decision landing first.
 */
export async function decideCanvasProposal(pool: Pool, d: CanvasDecision): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE canvas_proposals SET status = ?, decided_by = ?, decision_note = ?, outcome_json = ?, decided_at = NOW() " +
      "WHERE id = ? AND status = 'open'",
    [d.status, d.decidedBy, d.note, d.outcome ? JSON.stringify(d.outcome) : null, d.id],
  );
  return result.affectedRows === 1;
}
