/**
 * The S12 stores: MySQL-authoritative, memory-cached, write-through.
 *
 * The remaining domains (submissions, milestones, roles, config documents…)
 * are read on hot synchronous paths — computeStage reads training modules and
 * submissions, getBrand() runs inside mergedConfig() on nearly every request —
 * and they change rarely, through a handful of admin screens. Making every
 * read async would re-open the cascade S6 and S10 paid for, for domains where
 * a cache can simply BE the read path:
 *
 *   - boot loads each table/document into memory (load(), fail-loud);
 *   - reads are synchronous against the cache — same semantics the file
 *     reads always had, minus the disk;
 *   - writes are ASYNC and RENAMED (saveAll→replaceAll, set→put) so the
 *     compiler forces every write site through the conversion — a floating
 *     promise on a same-named method is exactly the silent-bypass trap the
 *     S6 auth rename existed to prevent;
 *   - every write updates MySQL first, then the cache; a failed write throws
 *     into the route (500) and the cache never lies about what persisted.
 *
 * One process per deployment (Railway) is what makes the cache sound. If that
 * ever changes, these stores are the seam where cache invalidation lands.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE LOST UPDATE, AND THE COUNTER THAT CLOSES IT (0122)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `replaceAll` is a DELETE of the whole table plus a re-INSERT of a snapshot
 * the caller has been holding since it called `all()`. Every caller is a
 * read-modify-write with `await` points in the gap, and until 0122 there was
 * no lock and no staleness check across that gap, so two writers both read the
 * same state and whichever committed second erased everything the first did,
 * with both requests answering 200.
 *
 * REPRODUCED against a real MySQL before this was written, twice over:
 *
 *   - a steward renaming a tool while the daily `tools-link-check` job held a
 *     snapshot taken before the rename. The job's write put the old name back.
 *     Neither call reported anything.
 *   - a steward creating a tool while the same job held a snapshot taken
 *     before it existed. The job's DELETE-all removed the new row outright.
 *     Neither call reported anything.
 *
 * Nine tables use `dbCollection` and several of them are edited by stewards in
 * the admin panel while background jobs also write them, so this is a live
 * production shape, not only a test flake. A Railway deploy that briefly runs
 * two containers against one database is the same condition with two caches.
 *
 * HOW IT IS CLOSED, and why it needed no change at any of the 34 call sites.
 * The rows `all()` hands back are stamped, under a symbol key, with the
 * collection version they were read at. A symbol survives `{...row}` and
 * `{...row, ...req.body}`, which is how every caller in `server/index.ts`
 * builds its payload, and it is invisible to `JSON.stringify`, `Object.keys`
 * and the column list, so it never reaches an API response or the database.
 * `replaceAll` then reads the authoritative counter from `collection_versions`
 * under `SELECT ... FOR UPDATE` (which is also the lock the read-modify-write
 * cycle never had) and compares:
 *
 *   - stamp equals the counter: nothing happened in between. The write is the
 *     same DELETE plus re-INSERT it always was. This is the path every
 *     existing test takes, byte for byte.
 *   - no stamp at all: the payload was built from scratch rather than read,
 *     which is the boot seeding path. Unguarded, exactly as before.
 *   - stamp is behind the counter: somebody else wrote. The payload is REBASED
 *     onto the current rows instead of overwriting them. Fields this writer
 *     changed win, fields it did not touch keep the other writer's value, rows
 *     it never saw are kept, and rows it deleted are deleted.
 *
 * WHY REBASE RATHER THAN REFUSE. Refusing is the safer-sounding answer and it
 * was the first design. It is wrong here for a mechanical reason: these
 * callers are Express 4 async route handlers with no wrapper, so a throw out
 * of `replaceAll` is an unhandled rejection rather than a 500, and the
 * steward's request HANGS with no answer (the same trap already recorded in
 * the ledger against `putSecret`). A refusal would also cost the link-check
 * job a full day, since the scheduler stamps `last_run_at` when it claims a
 * job, not when the job succeeds. Rebasing answers both writers truthfully
 * and loses nothing that was not written by two people to the same field.
 *
 * The one case that still throws is a snapshot older than `HISTORY_DEPTH`
 * writes, where there is no baseline to rebase against and any guess would be
 * a guess about somebody's data. That is loud on purpose.
 *
 * RAW SQL WRITERS, which the counter cannot see on its own. Three files write
 * these tables directly rather than through a collection. The house rule for
 * doing that is already written down in server/lib/examples.ts: delete the
 * rows, then reload the cache, or the cache keeps serving what the database no
 * longer has. `load()` now makes that reload mean something to WRITERS too: a
 * reload that finds different rows than the cache held bumps the counter, so
 * every snapshot taken before the raw write is rebased rather than trusted.
 * Without it, a steward retiring the standing examples while somebody else
 * held a snapshot would have every example row put straight back.
 * `server/lib/orgChart.ts` and `server/lib/seasonPatterns.ts` write `circles`
 * raw and do NOT reload, so they are outside this and always were.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export type Row = Record<string, any>;

// ─── Collections ─────────────────────────────────────────────────────────────

export interface ColumnSpec {
  /** camelCase field on the record. */
  js: string;
  /** snake_case column in the table. */
  db: string;
  kind?: "json" | "bool" | "int" | "time" | "text";
  /** For NOT-NULL time columns: an absent value writes now() instead of NULL. */
  defaultNow?: boolean;
}

export interface CollectionSpec {
  table: string;
  columns: ColumnSpec[];
  /** ORDER BY for load(); defaults to the first column. */
  orderBy?: string;
  /**
   * The field that identifies a row when a stale write is rebased. Defaults to
   * the first column, which is `id` on every collection in this codebase.
   */
  key?: string;
}

export interface DbCollection<T extends Row = Row> {
  load(): Promise<void>;
  /**
   * Synchronous, from cache. A fresh array of fresh row objects each call;
   * mutate freely, then replaceAll. Each row carries the collection version it
   * was read at, so writing it back can tell a current snapshot from a stale
   * one. Rows are COPIES: mutating one no longer reaches the cache, which is
   * what makes the version stamp mean what it says.
   */
  all(): T[];
  /**
   * Replace the whole collection, transactionally: DELETE + INSERT, under the
   * collection's version row. A snapshot that went stale while the caller held
   * it is rebased onto the current rows rather than overwriting them.
   */
  replaceAll(rows: T[]): Promise<void>;
  /** Append one row. */
  insert(row: T): Promise<T>;
}

/**
 * The version a snapshot was read at, carried on the row itself.
 *
 * A symbol rather than a field because it has to survive `{...row}` (object
 * spread copies enumerable symbol keys) while staying out of `JSON.stringify`,
 * `Object.keys`, `for...in` and therefore out of every API response and every
 * INSERT this file builds. `Symbol.for` rather than `Symbol()` so a module
 * loaded twice (src and dist in the same process) still agrees with itself
 * instead of silently failing open.
 *
 * The registry key names this FILE, not a village: this is platform code and
 * every fork of it shares the symbol, which is what makes a module loaded
 * twice agree in the first place.
 */
export const SNAPSHOT_VERSION = Symbol.for("store-db.dbCollection.snapshotVersion");

/**
 * Thrown when a whole-table write is based on a snapshot too old to rebase.
 *
 * Nothing was written. The caller should read the collection again and re-apply
 * whatever it was doing.
 */
export class StaleSnapshotError extends Error {
  readonly code = "stale_snapshot";
  constructor(
    readonly table: string,
    readonly snapshotVersion: number,
    readonly currentVersion: number,
  ) {
    super(
      `${table} was written by somebody else while this change was being prepared, and the ` +
        `snapshot handed back is too old to merge safely (read at version ${snapshotVersion}, ` +
        `the table is now at version ${currentVersion}). Nothing was written. Read the ` +
        `collection again and re-apply the change.`,
    );
    this.name = "StaleSnapshotError";
  }
}

/**
 * How many past versions of a collection are kept so a slow writer can be
 * rebased. A caller normally writes back within one or two versions of its
 * read; eight is generous for that and small enough that the retained
 * snapshots of even the largest collection here stay uninteresting in memory.
 */
const HISTORY_DEPTH = 8;

function fromDb(spec: ColumnSpec, v: any): any {
  if (v == null) return spec.kind === "json" ? undefined : v;
  switch (spec.kind) {
    case "json":
      if (typeof v === "string") {
        try { return JSON.parse(v); } catch { return undefined; }
      }
      return v;
    case "bool":
      return !!v;
    case "int":
      return Number(v);
    case "time":
      return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
    default:
      return v;
  }
}

function toDb(spec: ColumnSpec, v: any): any {
  // An absent boolean is false, not NULL. Every tinyint(1) in this schema is
  // NOT NULL, so writing NULL for a field the caller simply did not set turns
  // "I have no opinion" into a constraint violation (or a silent 0 outside
  // strict mode). Two-valued columns get the two-valued answer.
  if (v == null && spec.kind === "bool") return 0;
  if (v == null) return spec.defaultNow ? new Date() : null;
  switch (spec.kind) {
    case "json":
      return JSON.stringify(v);
    case "bool":
      return v ? 1 : 0;
    case "int":
      return Number(v) || 0;
    case "time": {
      const d = v instanceof Date ? v : new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    default:
      return v;
  }
}

/** The version a row was read at, or undefined for a row built from scratch. */
export function snapshotVersionOf(row: Row): number | undefined {
  const v = (row as any)[SNAPSHOT_VERSION];
  return typeof v === "number" ? v : undefined;
}

/**
 * One canonical string per field value, so two values can be compared without
 * caring whether a date arrived as a Date or an ISO string, or whether an
 * absent value arrived as null or undefined.
 */
function canon(v: any): string {
  if (v === undefined || v === null) return "null";
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  return JSON.stringify(v);
}

export function dbCollection<T extends Row = Row>(pool: Pool, spec: CollectionSpec): DbCollection<T> {
  let cache: T[] = [];
  /** The collection version `cache` reflects. Bumped by every successful write. */
  let version = 0;
  /** version -> that version's rows by id, for rebasing a stale writer. */
  const history = new Map<number, Map<string, T>>();
  const historyOrder: number[] = [];
  let ensured: Promise<void> | null = null;

  const colList = spec.columns.map((c) => `\`${c.db}\``).join(", ");
  const placeholders = spec.columns.map(() => "?").join(",");
  const orderBy = spec.orderBy ?? `\`${spec.columns[0].db}\``;
  const keyJs = spec.key ?? spec.columns[0].js;

  const rowToItem = (r: RowDataPacket): T => {
    const item: Row = {};
    for (const c of spec.columns) {
      const v = fromDb(c, r[c.db]);
      if (v !== undefined) item[c.js] = v;
    }
    return item as T;
  };

  const itemParams = (item: T) => spec.columns.map((c) => toDb(c, item[c.js]));

  async function insertOn(conn: Pool | PoolConnection, item: T) {
    await conn.query(`INSERT INTO \`${spec.table}\` (${colList}) VALUES (${placeholders})`, itemParams(item));
  }

  const idOf = (row: Row) => String(row[keyJs]);
  const sameField = (a: any, b: any) => canon(a) === canon(b);
  const sameRow = (a: Row, b: Row) => spec.columns.every((c) => sameField(a[c.js], b[c.js]));

  /** Same rows, by id and by every spec'd field. Order is not part of it. */
  function sameRowSet(a: T[], b: T[]): boolean {
    if (a.length !== b.length) return false;
    const byId = new Map<string, T>();
    for (const r of a) byId.set(idOf(r), r);
    for (const r of b) {
      const match = byId.get(idOf(r));
      if (!match || !sameRow(match, r)) return false;
    }
    return true;
  }

  /** A stamped copy, so the caller can mutate without reaching the cache. */
  function stamped(row: T, v: number): T {
    const copy: any = { ...row };
    copy[SNAPSHOT_VERSION] = v;
    return copy as T;
  }

  /** The OLDEST version present in a payload; undefined when nothing is stamped. */
  function payloadSnapshot(rows: T[]): number | undefined {
    let oldest: number | undefined;
    for (const r of rows) {
      const v = snapshotVersionOf(r);
      if (v === undefined) continue;
      if (oldest === undefined || v < oldest) oldest = v;
    }
    return oldest;
  }

  function remember(v: number, rows: T[]): void {
    const byId = new Map<string, T>();
    // Copies, so a caller that keeps mutating the array it handed to
    // replaceAll cannot rewrite the baseline somebody else will be rebased on.
    for (const r of rows) byId.set(idOf(r), { ...r } as T);
    history.set(v, byId);
    historyOrder.push(v);
    while (historyOrder.length > HISTORY_DEPTH) {
      const drop = historyOrder.shift();
      if (drop !== undefined && historyOrder.indexOf(drop) === -1) history.delete(drop);
    }
  }

  /**
   * Three-way merge: what this writer changed since its own read, applied on
   * top of what the table says now.
   */
  function rebase(base: Map<string, T>, mine: T[], current: T[]): { rows: T[]; conflicts: string[] } {
    const conflicts: string[] = [];
    const currentById = new Map<string, T>();
    for (const r of current) currentById.set(idOf(r), r);
    const mineIds = new Set<string>();
    for (const r of mine) mineIds.add(idOf(r));

    const out: T[] = [];
    for (const row of mine) {
      const id = idOf(row);
      const before = base.get(id);
      const now = currentById.get(id);
      if (!before) {
        out.push(row); // this writer added it
        continue;
      }
      if (!now) {
        // Somebody else deleted it. Honour that, unless this writer edited the
        // row, in which case the edit is the newer intent and puts it back.
        if (!sameRow(row, before)) out.push(row);
        continue;
      }
      if (sameRow(before, now)) {
        out.push(row); // nobody else touched this row
        continue;
      }
      const merged: any = { ...row };
      for (const col of spec.columns) {
        const k = col.js;
        const mineChanged = !sameField(row[k], before[k]);
        const theirsChanged = !sameField(now[k], before[k]);
        if (!mineChanged && theirsChanged) merged[k] = now[k];
        else if (mineChanged && theirsChanged && !sameField(row[k], now[k])) conflicts.push(`${id}.${k}`);
      }
      out.push(merged as T);
    }
    for (const row of current) {
      const id = idOf(row);
      if (mineIds.has(id)) continue; // already handled above
      if (base.has(id)) continue; // this writer deleted it
      out.push(row); // somebody else added it while this writer was working
    }
    return { rows: out, conflicts };
  }

  /**
   * The counter row has to exist before anything can lock it. Done once per
   * collection per process, and OUTSIDE the write transaction: concurrent
   * `INSERT IGNORE`s of the same primary key inside a transaction are a
   * classic InnoDB deadlock, and this has no reason to be in one.
   */
  function ensureVersionRow(): Promise<void> {
    if (!ensured) {
      ensured = pool
        .query("INSERT IGNORE INTO collection_versions (collection) VALUES (?)", [spec.table])
        .then(() => undefined);
      ensured.catch(() => {
        ensured = null; // a failed ensure must not be cached as done
      });
    }
    return ensured;
  }

  async function readVersionForUpdate(conn: PoolConnection): Promise<number> {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT version FROM collection_versions WHERE collection = ? FOR UPDATE",
      [spec.table],
    );
    return Number(rows[0]?.version ?? 0);
  }

  async function readRows(conn: PoolConnection): Promise<T[]> {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${colList} FROM \`${spec.table}\` ORDER BY ${orderBy}`,
    );
    return rows.map(rowToItem);
  }

  return {
    async load() {
      await ensureVersionRow();
      const conn = await pool.getConnection();
      try {
        // One transaction so the counter and the rows come from one snapshot;
        // read apart, a write landing between them would leave the cache
        // claiming a version it does not hold.
        await conn.beginTransaction();
        const dbVersion = await readVersionForUpdate(conn);
        const rows = await readRows(conn);
        /*
         * A RELOAD THAT FINDS DIFFERENT ROWS MEANS SOMEBODY WROTE THIS TABLE
         * WITHOUT GOING THROUGH THIS COLLECTION, and the counter did not move
         * because raw SQL does not know about it.
         *
         * That is not hypothetical. `retireExamples` in server/lib/examples.ts
         * DELETEs example rows with raw SQL and then calls load() through
         * `wireExampleCaches` precisely because the cache would otherwise keep
         * serving rows the database no longer has. It fires from
         * `onRealItemPublished`, which POST /api/admin/circles calls without
         * awaiting it. So a steward creating a circle can be retiring the
         * example circles at the same moment another writer is holding a
         * snapshot that still contains them, and that writer's replaceAll
         * would put every one of them back.
         *
         * Bumping here is what makes the reload mean something to writers as
         * well as to readers: every outstanding snapshot goes stale, gets
         * rebased against the rows that actually exist now, and the delete
         * holds. A first load has an empty cache and nothing to compare, so
         * boot never bumps.
         *
         * WHAT THIS DOES NOT COVER, said plainly: a raw writer that does NOT
         * reload. `server/lib/orgChart.ts` and `server/lib/seasonPatterns.ts`
         * both write `circles` directly and neither calls load(), so their
         * writes are invisible to the cache AND to the counter. That is
         * pre-existing and unchanged here; it is filed in the ledger.
         */
        const heldBefore = cache.length;
        // Different rows under a counter that ALSO moved were written through a
        // counter: another process's collection, or a transaction that bumps it on
        // purpose, as an org draft moving a circle does. Every snapshot out there is
        // already stale against that version, so there is nothing to bump and
        // nothing to warn about. Only rows that changed under a counter that did
        // not move are a writer going around the collection.
        const behindOurBack = heldBefore > 0 && dbVersion === version && !sameRowSet(cache, rows);
        if (behindOurBack) {
          await conn.query("UPDATE collection_versions SET version = version + 1 WHERE collection = ?", [
            spec.table,
          ]);
        }
        await conn.commit();
        version = behindOurBack ? dbVersion + 1 : dbVersion;
        cache = rows;
        // The history is NOT cleared. Each entry says what `all()` handed out
        // at that version, which stays true across a reload, and clearing it
        // would turn every in-flight writer's next replaceAll into a
        // StaleSnapshotError, which under Express 4 is a hung request.
        remember(version, cache);
        if (behindOurBack) {
          console.warn(
            `[store] ${spec.table}: reloaded and found ${rows.length} row(s) where the cache held ` +
              `${heldBefore}. Something wrote this table without going through the collection, so ` +
              `version is now ${version} and every snapshot older than that will be rebased.`,
          );
        }
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    all() {
      const v = version;
      return cache.map((r) => stamped(r, v));
    },

    async replaceAll(rows) {
      await ensureVersionRow();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const dbVersion = await readVersionForUpdate(conn);
        const snapshot = payloadSnapshot(rows);

        let write: T[] = rows;
        let conflicts: string[] = [];
        let rebased = false;
        if (snapshot !== undefined && snapshot !== dbVersion) {
          const base = history.get(snapshot);
          if (!base) throw new StaleSnapshotError(spec.table, snapshot, dbVersion);
          const merged = rebase(base, rows, await readRows(conn));
          write = merged.rows;
          conflicts = merged.conflicts;
          rebased = true;
        }

        await conn.query(`DELETE FROM \`${spec.table}\``);
        for (const r of write) await insertOn(conn, r);
        await conn.query("UPDATE collection_versions SET version = version + 1 WHERE collection = ?", [
          spec.table,
        ]);
        await conn.commit();
        version = dbVersion + 1;
        cache = [...write];
        remember(version, cache);
        if (rebased) {
          // Never silent. A rebase means two writers were in the same table at
          // the same time, which is worth knowing even when it merged cleanly.
          console.warn(
            `[store] ${spec.table}: merged a write read at version ${snapshot} into version ` +
              `${version}, ${write.length} row(s)` +
              (conflicts.length
                ? `. Both writers changed ${conflicts.length} field(s) and the later one won: ${conflicts
                    .slice(0, 8)
                    .join(", ")}`
                : ", no field was changed by both"),
          );
        }
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    async insert(row) {
      await ensureVersionRow();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const dbVersion = await readVersionForUpdate(conn);
        await insertOn(conn, row);
        // If somebody else wrote since this cache loaded, appending to it would
        // leave the cache missing their rows AND claiming to be current, which
        // is how the next whole-table write would erase them. Re-read instead.
        const stale = dbVersion !== version;
        const rows = stale ? await readRows(conn) : null;
        await conn.query("UPDATE collection_versions SET version = version + 1 WHERE collection = ?", [
          spec.table,
        ]);
        await conn.commit();
        version = dbVersion + 1;
        if (rows) cache = rows;
        else cache.push(row);
        remember(version, cache);
        return row;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
  };
}

// ─── Documents (app_config key/value, JSON column) ──────────────────────────

export interface DbDocument<T extends Row = Row> {
  load(): Promise<void>;
  /** Synchronous, from cache; the fallback when no row exists. */
  get(): T;
  /** True when a row actually exists (get() alone cannot distinguish the fallback). */
  exists(): boolean;
  /** Replace wholesale — how the admin UI edits these. */
  put(doc: T): Promise<T>;
}

export function dbDocument<T extends Row = Row>(pool: Pool, key: string, fallback: T): DbDocument<T> {
  let cache: T | null = null;

  return {
    async load() {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT value FROM app_config WHERE config_key = ?",
        [key],
      );
      if (!rows[0]) {
        cache = null;
        return;
      }
      let v = rows[0].value;
      if (typeof v === "string") {
        try { v = JSON.parse(v); } catch { v = null; }
      }
      cache = v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
    },

    get() {
      return cache ?? fallback;
    },

    exists() {
      return cache !== null;
    },

    async put(doc) {
      await pool.query(
        "INSERT INTO app_config (config_key, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [key, JSON.stringify(doc)],
      );
      cache = doc;
      return doc;
    },
  };
}

/**
 * The two column coercers, for tests only.
 *
 * They decide what value the writer HANDS the database, which is where the
 * `replaceAll` re-default trap lives, and that decision happens before any
 * connection is involved. Exposing them lets the round trip be tested without
 * a MySQL instance; nothing in the app should import this.
 */
export const __testing = { toDb, fromDb };
