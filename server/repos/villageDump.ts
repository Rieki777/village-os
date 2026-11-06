/**
 * THE WHOLE VILLAGE AS ONE FILE, FOR THE PERSON WHO RUNS THE DEPLOYMENT (R071).
 *
 * A founder leaving a host, or moving a village to a new one, needs the
 * database in a form they can carry. Until this existed the only path was
 * `mysqldump` from a machine that can reach the database, which on a managed
 * host means a proxy, a CLI and a credential most founders have never seen.
 * This writes the same thing from inside the server: SQL that `mysql` can read
 * straight back into an empty database.
 *
 * ── WHAT IS IN IT ──────────────────────────────────────────────────────────
 *
 * Every base table, every row, exactly as stored. That is every member's
 * data: names, addresses, password hashes, messages, the ledger, votes. The
 * header of the file says so in as many words, and so do the docs, because a
 * file like this gets forwarded.
 *
 * ── WHAT IS NOT ────────────────────────────────────────────────────────────
 *
 * Nothing from the environment. Rows are copied as stored, so a sealed
 * integration secret leaves sealed and a member's sealed key leaves sealed;
 * the keys that open them (`VILLAGE_SECRETS_KEY`, `MEMBER_SECRETS_KEY`) live
 * in the environment and this file never reads it. Uploads (photographs,
 * documents) are on the volume and have their own route,
 * `/api/admin/backup/uploads-archive`.
 *
 * ── HOW IT STAYS CORRECT ───────────────────────────────────────────────────
 *
 * One snapshot. Every table is read inside one `START TRANSACTION WITH
 * CONSISTENT SNAPSHOT`, so a transfer that lands mid-export is either wholly in
 * the file or wholly absent, and the ledger in the file still sums to zero.
 *
 * Values are copied as the database sent them, never through JavaScript types.
 * The driver is asked for raw bytes (`typeCast: false`) and each column is
 * written by its wire type: numbers as written, binary as a hex literal, and
 * everything else, dates and JSON included, as an escaped string. A date that
 * went through a JS `Date` would come out shifted by whatever zone the process
 * runs in, and a JSON document re-serialised would come out reordered. The
 * session is pinned to UTC and the file says the same in its first lines, so a
 * `TIMESTAMP` reads back as the instant it was.
 *
 * Generated columns are left out of every INSERT and recomputed by the
 * database on the way back in; a value written into one is refused.
 *
 * ── HOW IT STAYS CHEAP ─────────────────────────────────────────────────────
 *
 * It streams. Rows come off the connection as a stream and the caller's
 * `write` is awaited, so a slow client slows the read instead of filling the
 * process's memory with a village. Nothing here knows about HTTP or gzip; the
 * route does that.
 *
 * ── HOW A SHORT FILE IS TOLD FROM A WHOLE ONE ──────────────────────────────
 *
 * The last line names the counts and says the export is complete. A file cut
 * off by a dropped connection still loads, partly, and looks plausible; only
 * the absence of that line says it is not the whole village.
 */
import mysql from "mysql2/promise";
import type { FieldPacket, Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/** The line a complete file ends with, before its counts. Restore guides key on it. */
export const DUMP_COMPLETE_MARK = "-- Export complete:";

/** The sentence the file opens with. Tested, so the warning cannot quietly go. */
export const DUMP_WARNING =
  "EVERY MEMBER'S DATA IS IN THIS FILE: names, email addresses, password hashes, messages, the ledger and votes.";

/**
 * How long one INSERT may grow before the next row starts a new one. Well under
 * the smallest `max_allowed_packet` a host is likely to run (MariaDB's 16 MB),
 * so a restore through any client accepts every statement. A single row larger
 * than this still goes, alone.
 */
const STATEMENT_BYTES = 512 * 1024;

/** How much SQL is gathered before the caller's `write` is called. */
const FLUSH_BYTES = 64 * 1024;

// Wire types from the MySQL client protocol (mysql2/lib/constants/types.js).
const NUMERIC = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);
// Dates and times arrive flagged with the binary charset too, and are text.
const TEMPORAL = new Set([7, 10, 11, 12, 14]);
const BIT = 16;
const JSON_TYPE = 245;
const GEOMETRY = 255;
const BINARY_CHARSET = 63;
const PLAIN_NUMBER = /^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/;

export interface DumpOutcome {
  tables: number;
  rows: number;
  /** Bytes of SQL handed to `write`, before any compression. */
  sqlBytes: number;
}

export interface DumpOptions {
  takenAt?: Date;
}

/**
 * Roughly how much SQL the export will be, from the database's own table
 * statistics. Approximate twice over: MySQL caches these figures for up to a
 * day, and a row as SQL text is not the same size as a row on disk. It is a
 * size note for a person deciding whether to wait, never a promise.
 */
export async function estimateDumpBytes(pool: Pool): Promise<{ bytes: number; tables: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(DATA_LENGTH), 0) AS bytes, COUNT(*) AS tables FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
  );
  return { bytes: Number(rows[0]?.bytes ?? 0), tables: Number(rows[0]?.tables ?? 0) };
}

const ident = (name: string) => "`" + name.replace(/`/g, "``") + "`";

/** One value, as SQL, from the bytes the database sent and the column it came from. */
export function sqlValue(raw: Buffer | null, field: { columnType?: number; characterSet?: number }): string {
  if (raw === null || raw === undefined) return "NULL";
  const type = Number(field.columnType);
  if (NUMERIC.has(type)) {
    const text = raw.toString("ascii");
    return PLAIN_NUMBER.test(text) ? text : mysql.escape(text);
  }
  const binary =
    type === BIT || type === GEOMETRY || (type !== JSON_TYPE && !TEMPORAL.has(type) && field.characterSet === BINARY_CHARSET);
  if (binary) return `X'${raw.toString("hex")}'`;
  return mysql.escape(raw.toString("utf8"));
}

/** The columns an INSERT may name: every column except a generated one. */
async function insertableColumns(conn: PoolConnection, table: string): Promise<string[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [table],
  );
  // MySQL says `STORED GENERATED` or `VIRTUAL GENERATED`, MariaDB can say
  // `PERSISTENT GENERATED`. `DEFAULT_GENERATED` is an ordinary column with an
  // expression default and must stay.
  return rows
    .filter((r) => !/\b(VIRTUAL|STORED|PERSISTENT) GENERATED\b/i.test(String(r.extra ?? "")))
    .map((r) => String(r.name));
}

/**
 * Write the whole village as SQL. `write` is awaited for every chunk, which is
 * the backpressure: return a promise that settles when the destination can
 * take more.
 */
export async function streamVillageDump(
  pool: Pool,
  write: (chunk: string) => Promise<void> | void,
  opts: DumpOptions = {},
): Promise<DumpOutcome> {
  const takenAt = opts.takenAt ?? new Date();
  const outcome: DumpOutcome = { tables: 0, rows: 0, sqlBytes: 0 };
  let pending = "";
  const emit = async (text: string, force = false) => {
    pending += text;
    if (!force && pending.length < FLUSH_BYTES) return;
    const chunk = pending;
    pending = "";
    outcome.sqlBytes += Buffer.byteLength(chunk);
    await write(chunk);
  };

  const conn = await pool.getConnection();
  let open = false;
  try {
    await conn.query("SET NAMES utf8mb4");
    await conn.query("SET SESSION time_zone = '+00:00'");
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    open = true;

    const [tableRows] = await conn.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    );
    const tables = tableRows.map((r) => String(r.name));

    await emit(
      [
        "-- Whole-village database export.",
        `-- ${DUMP_WARNING}`,
        "-- Keep it where you keep the database itself, and delete copies you no longer need.",
        "-- Sealed secrets are still sealed in it. The keys that open them, and every other",
        "-- environment variable, are not in this file.",
        `-- Taken at ${takenAt.toISOString()} in one consistent snapshot of ${tables.length} tables.`,
        "-- Restore into an EMPTY database: gunzip, then mysql <database> < this-file.sql",
        `-- A file whose last line does not start "${DUMP_COMPLETE_MARK}" was cut short. Do not restore it.`,
        "",
        "SET NAMES utf8mb4;",
        "SET time_zone = '+00:00';",
        "SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO';",
        "SET FOREIGN_KEY_CHECKS = 0;",
        "SET UNIQUE_CHECKS = 0;",
        "",
        "",
      ].join("\n"),
    );

    for (const table of tables) {
      const [created] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE ${ident(table)}`);
      const ddl = String(created[0]?.["Create Table"] ?? "");
      if (!ddl) throw new Error(`SHOW CREATE TABLE returned nothing for ${table}`);
      await emit(`-- Table ${table}\nDROP TABLE IF EXISTS ${ident(table)};\n${ddl};\n`);

      const columns = await insertableColumns(conn, table);
      if (columns.length === 0) {
        outcome.tables += 1;
        await emit("\n");
        continue;
      }
      const head = `INSERT INTO ${ident(table)} (${columns.map(ident).join(", ")}) VALUES\n`;
      let statement = "";
      let tableRowsCount = 0;

      // The callback connection underneath the promise wrapper is the one that
      // can stream. Its rows arrive as arrays of raw buffers.
      const core = (conn as unknown as { connection: any }).connection;
      const query = core.query({
        sql: `SELECT ${columns.map(ident).join(", ")} FROM ${ident(table)}`,
        typeCast: false,
        rowsAsArray: true,
      });
      let fields: FieldPacket[] = [];
      const stream = query.stream({ highWaterMark: 256 });
      stream.on("fields", (f: FieldPacket[]) => {
        fields = f;
      });
      for await (const row of stream as AsyncIterable<(Buffer | null)[]>) {
        const tuple = `(${row.map((v, i) => sqlValue(v, fields[i] as any)).join(",")})`;
        if (statement && statement.length + tuple.length > STATEMENT_BYTES) {
          await emit(`${statement};\n`);
          statement = "";
        }
        statement = statement ? `${statement},\n${tuple}` : `${head}${tuple}`;
        tableRowsCount += 1;
      }
      if (statement) await emit(`${statement};\n`);
      outcome.tables += 1;
      outcome.rows += tableRowsCount;
      await emit("\n");
    }

    await conn.query("COMMIT");
    open = false;
    await emit(
      `SET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n${DUMP_COMPLETE_MARK} ${outcome.tables} tables, ${outcome.rows} rows, taken at ${takenAt.toISOString()}.\n`,
      true,
    );
    return outcome;
  } finally {
    if (open) await conn.query("ROLLBACK").catch(() => undefined);
    conn.release();
  }
}
