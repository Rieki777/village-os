/**
 * THE EXPORT READS BACK AS THE VILLAGE IT WAS TAKEN FROM (R071).
 *
 * A dump that cannot be restored is worse than none, because it is believed.
 * So this does the restore: a migrated scratch village, plus one table holding
 * every awkward value a village stores (quotes, backslashes, newlines, emoji,
 * JSON, raw bytes, a stored generated column, both kinds of date), is dumped,
 * the SQL is run into a SECOND scratch schema, and every table's
 * `CHECKSUM TABLE` is compared. A value the dump rendered wrongly changes a
 * checksum, whichever table it is in.
 *
 * And the snapshot: a row written by another connection while the export is
 * running must not be in the file, or the ledger in an export could be half a
 * transfer.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { DUMP_COMPLETE_MARK, DUMP_WARNING, sqlValue, streamVillageDump } from "./villageDump";

const DB = testDbConfigured();

describe("sqlValue renders by wire type", () => {
  it("writes NULL, plain numbers, hex for binary and an escaped string for the rest", () => {
    expect(sqlValue(null, { columnType: 253, characterSet: 255 })).toBe("NULL");
    expect(sqlValue(Buffer.from("-12.5"), { columnType: 246, characterSet: 63 })).toBe("-12.5");
    expect(sqlValue(Buffer.from([0, 255]), { columnType: 252, characterSet: 63 })).toBe("X'00ff'");
    expect(sqlValue(Buffer.from([1]), { columnType: 16, characterSet: 63 })).toBe("X'01'");
    // JSON arrives flagged binary on MySQL and is text all the same.
    expect(sqlValue(Buffer.from('{"a":1}'), { columnType: 245, characterSet: 63 })).toBe(`'{\\"a\\":1}'`);
    expect(sqlValue(Buffer.from("it's"), { columnType: 253, characterSet: 255 })).toBe("'it\\'s'");
    // A date is a string as sent, never a JS Date shifted by the process's zone.
    expect(sqlValue(Buffer.from("2026-03-08 02:30:00.123"), { columnType: 12, characterSet: 63 })).toBe("'2026-03-08 02:30:00.123'");
  });
});

describe.skipIf(!DB)("a whole-village export, restored", () => {
  let source: TestDb;
  let target: TestDb;
  let pool: mysql.Pool;
  let restore: mysql.Connection;

  beforeAll(async () => {
    source = await provisionTestDb();
    target = await provisionTestDb();
    pool = testPool(source, { connectionLimit: 3 });
    await source.conn.query(`CREATE TABLE dump_probe (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(200) NULL,
      body TEXT NULL,
      doc JSON NULL,
      blob_col BLOB NULL,
      bin_col VARBINARY(16) NULL,
      amount DECIMAL(20,6) NULL,
      ratio DOUBLE NULL,
      flag BIT(1) NULL,
      at_dt DATETIME(3) NULL,
      at_ts TIMESTAMP NULL,
      label_upper VARCHAR(200) AS (UPPER(label)) STORED
    ) DEFAULT CHARSET=utf8mb4`);
    await source.conn.query(
      "INSERT INTO dump_probe (label, body, doc, blob_col, bin_col, amount, ratio, flag, at_dt, at_ts) VALUES (?, ?, ?, ?, ?, ?, ?, b'1', ?, ?)",
      [
        `it's a "quote", a back\\slash, a new\nline, a\ttab, ñ and \u{1F331}`,
        "x".repeat(5000),
        JSON.stringify({ b: 1, a: [1, 2, "x"], nested: { "k\"ey": null } }),
        Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
        Buffer.from([0, 255, 0]),
        "-12345.678901",
        0.1 + 0.2,
        "2026-03-08 02:30:00.123",
        "2026-11-06 12:00:00",
      ],
    );
    await source.conn.query("INSERT INTO dump_probe (label) VALUES (NULL)");
    await source.conn.query("INSERT INTO dump_probe (label, blob_col, bin_col) VALUES ('', X'', X'')");
    // Enough rows that one INSERT cannot hold them all.
    await source.conn.query("CREATE TABLE dump_bulk (id INT NOT NULL PRIMARY KEY, payload VARCHAR(400) NOT NULL)");
    for (let start = 0; start < 3000; start += 500) {
      const rows = Array.from({ length: 500 }, (_, i) => [start + i, `row ${start + i} ${"p".repeat(300)}`]);
      await source.conn.query("INSERT INTO dump_bulk (id, payload) VALUES ?", [rows]);
    }
    // Sorts last, so the export reaches it after its first write has happened.
    await source.conn.query("CREATE TABLE zzz_dump_late (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, note VARCHAR(50) NOT NULL)");
    restore = await mysql.createConnection({ uri: target.url, multipleStatements: true, timezone: "Z" });
  }, 300_000);

  afterAll(async () => {
    await restore?.end();
    await pool?.end();
    await source?.drop();
    await target?.drop();
  });

  async function dumpText(onFirstWrite?: () => Promise<void>): Promise<{ text: string; rows: number; tables: number }> {
    const parts: string[] = [];
    let first = true;
    const outcome = await streamVillageDump(pool, async (chunk) => {
      if (first && onFirstWrite) await onFirstWrite();
      first = false;
      parts.push(chunk);
    });
    return { text: parts.join(""), rows: outcome.rows, tables: outcome.tables };
  }

  async function checksums(conn: mysql.Connection, tables: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const t of tables) {
      const [rows] = await conn.query<any[]>(`CHECKSUM TABLE \`${t}\``);
      out[t] = String(rows[0]?.Checksum);
    }
    return out;
  }

  async function baseTables(conn: mysql.Connection): Promise<string[]> {
    const [rows] = await conn.query<any[]>(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    );
    return rows.map((r) => String(r.name));
  }

  it("restores into a second schema with every table's checksum unchanged", async () => {
    const { text, rows, tables } = await dumpText();
    expect(text.split("\n")[1]).toContain(DUMP_WARNING);
    const lastLine = text.trimEnd().split("\n").pop()!;
    expect(lastLine.startsWith(DUMP_COMPLETE_MARK)).toBe(true);
    expect(text.match(/INSERT INTO `dump_bulk`/g)!.length).toBeGreaterThan(1);
    // The generated column is recomputed on the way in, never written.
    expect(text).not.toMatch(/INSERT INTO `dump_probe` \([^)]*label_upper/);

    const names = await baseTables(source.conn);
    expect(tables).toBe(names.length);
    let counted = 0;
    for (const t of names) {
      const [c] = await source.conn.query<any[]>(`SELECT COUNT(*) AS n FROM \`${t}\``);
      counted += Number(c[0].n);
    }
    expect(rows).toBe(counted);

    await restore.query(text);
    expect(await baseTables(restore)).toEqual(names);
    expect(await checksums(restore, names)).toEqual(await checksums(source.conn, names));

    // And the awkward row reads back as itself, not merely as the same checksum.
    const [back] = await restore.query<any[]>("SELECT label, label_upper, HEX(blob_col) AS b, at_dt, UNIX_TIMESTAMP(at_ts) AS ts FROM dump_probe ORDER BY id LIMIT 1");
    const [orig] = await source.conn.query<any[]>("SELECT label, label_upper, HEX(blob_col) AS b, at_dt, UNIX_TIMESTAMP(at_ts) AS ts FROM dump_probe ORDER BY id LIMIT 1");
    expect(back[0]).toEqual(orig[0]);
  }, 300_000);

  it("is one snapshot: a row written while it runs is not in the file", async () => {
    const other = await mysql.createConnection({ uri: source.url, timezone: "Z" });
    try {
      const { text } = await dumpText(async () => {
        await other.query("INSERT INTO zzz_dump_late (note) VALUES ('late-arrival')");
      });
      // The control: the row did land, so its absence is the snapshot's work.
      const [landed] = await other.query<any[]>("SELECT COUNT(*) AS n FROM zzz_dump_late WHERE note = 'late-arrival'");
      expect(Number(landed[0].n)).toBe(1);
      expect(text).not.toContain("late-arrival");
    } finally {
      await other.end();
    }
  }, 300_000);
});
