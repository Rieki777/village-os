/**
 * `saberra_snapshots` (0331): the newest whole reads of the outside service's
 * circles and roles, one row per read, newest kept and the rest deleted.
 *
 * The rows are written by server/lib/saberraSnapshot.ts under the sync's lock
 * and read by the differences routes. What a row may hold, and why it never
 * holds a page address or a member's name, is in that file and in 0331.
 *
 * `taken_at` is read back with UNIX_TIMESTAMP, so the host's offset can never
 * shift it (the TIMESTAMP trap the test pools are pinned against).
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { SNAPSHOT_READS, type Snapshot, type SnapshotKind, type SnapshotRead, type SnapshotRecord } from "../../shared/seraDifferences";

export interface SnapshotRow {
  seq: number;
  snapshot: Snapshot;
}

/** A JSON column, whichever way the driver hands it back. */
function jsonOf(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A stored kind, read without trusting it: an unknown read word is a failed read, a non-list holds nothing. */
function kindOf(read: unknown, records: unknown): SnapshotKind {
  const list = jsonOf(records);
  return {
    read: readWord(read),
    records: Array.isArray(list)
      ? list.filter((r): r is SnapshotRecord => !!r && typeof r === "object" && typeof (r as SnapshotRecord).id === "string")
      : [],
  };
}

/** One read, written whole. */
export async function insertSnapshot(pool: Pool, takenAt: Date, snapshot: Omit<Snapshot, "takenAt">): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO saberra_snapshots (taken_at, run_trigger, circles_read, circles, roles_read, roles) VALUES (?, ?, ?, ?, ?, ?)",
    [
      takenAt,
      String(snapshot.trigger).slice(0, 16),
      snapshot.circles.read,
      JSON.stringify(snapshot.circles.records),
      snapshot.roles.read,
      JSON.stringify(snapshot.roles.records),
    ],
  );
  return Number(res.insertId);
}

/** The newest `limit` rows, newest first. */
export async function recentSnapshots(pool: Pool, limit: number): Promise<SnapshotRow[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq, UNIX_TIMESTAMP(taken_at) AS taken, run_trigger, circles_read, circles, roles_read, roles " +
      "FROM saberra_snapshots ORDER BY seq DESC LIMIT ?",
    [n],
  );
  return rows.map(rowOf);
}

/** One kept row without its records: enough to choose which rows a read needs. */
export interface SnapshotIndexRow {
  seq: number;
  /** Seconds since the epoch. */
  taken: number;
  circlesRead: SnapshotRead;
  rolesRead: SnapshotRead;
}

const readWord = (v: unknown): SnapshotRead =>
  typeof v === "string" && (SNAPSHOT_READS as readonly string[]).includes(v) ? (v as SnapshotRead) : "failed";

/** Every kept row's seq, time and read words, newest first. No records, so it costs almost nothing. */
export async function snapshotIndex(pool: Pool): Promise<SnapshotIndexRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq, UNIX_TIMESTAMP(taken_at) AS taken, circles_read, roles_read FROM saberra_snapshots ORDER BY seq DESC LIMIT 100",
  );
  return rows.map((r) => ({ seq: Number(r.seq), taken: Number(r.taken), circlesRead: readWord(r.circles_read), rolesRead: readWord(r.roles_read) }));
}

/** These rows whole, newest first. */
export async function snapshotsBySeq(pool: Pool, seqs: readonly number[]): Promise<SnapshotRow[]> {
  if (seqs.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq, UNIX_TIMESTAMP(taken_at) AS taken, run_trigger, circles_read, circles, roles_read, roles " +
      `FROM saberra_snapshots WHERE seq IN (${seqs.map(() => "?").join(",")}) ORDER BY seq DESC`,
    [...seqs],
  );
  return rows.map(rowOf);
}

function rowOf(r: RowDataPacket): SnapshotRow {
  return {
    seq: Number(r.seq),
    snapshot: {
      takenAt: new Date(Number(r.taken) * 1000).toISOString(),
      trigger: String(r.run_trigger ?? ""),
      circles: kindOf(r.circles_read, r.circles),
      roles: kindOf(r.roles_read, r.roles),
    },
  };
}

/** Delete every row older than the newest `keep`. Returns how many went. */
export async function pruneSnapshots(pool: Pool, keep: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seq FROM saberra_snapshots ORDER BY seq DESC LIMIT 1 OFFSET ?",
    [Math.max(0, Math.floor(keep) - 1)],
  );
  const oldestKept = rows[0]?.seq;
  if (oldestKept === undefined || oldestKept === null) return 0;
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM saberra_snapshots WHERE seq < ?", [Number(oldestKept)]);
  return res.affectedRows;
}
