/**
 * The test-database harness (S5). Block 2's conversions are gated by tests
 * that need a REAL MySQL: provision a scratch schema, run every migration
 * through the same engine production uses, hand back a URL, drop it after.
 *
 * Where the server comes from:
 *  - CI: a mysql:8 service container (see .github/workflows/ci.yml).
 *  - This machine (no Docker): the Railway MySQL's public TCP proxy, via
 *    TEST_DATABASE_URL in the local .env — always with a scratch schema,
 *    NEVER the app's own database.
 *  - No TEST_DATABASE_URL at all: DB-backed suites skip, and the RUN fails.
 *    The JSON-era tests still run everywhere, so a contributor without a
 *    database still has a meaningful (if smaller) suite, but they have to ask
 *    for it with ALLOW_NO_TEST_DB=1. Before 2026-09-02 this line said "skip
 *    loudly" and nothing was loud: `pnpm test` with no .env skipped 1,190
 *    tests across 91 files and exited 0. The loudness now lives in
 *    `server/db/provisioningReport.ts`'s globalTeardown, which is the only
 *    place in this harness that can affect a run's exit code, because every
 *    caller of `provisionTestDb` sits behind a skip guard (see below).
 *
 * The scratch schema name is UNIQUE PER PROVISION: village_test_<epoch>_<pid>_<n>.
 *
 * It used to be a fixed `village_test`, with a TEST_SCHEMA env override "for
 * parallel working sessions". That override required every session to
 * remember to set it, and on 2026-08-01 two sessions gated their commits at
 * the same time without it — each run's DROP/CREATE yanked the schema out
 * from under the other, twice in an hour, presenting as "Unknown database
 * 'village_test'" halfway through a migration and cascades of 500s in loop
 * sections that pass on any quiet run. A safety mechanism that depends on
 * everyone remembering it is a postmortem waiting for a date, so uniqueness
 * is now the default and TEST_SCHEMA remains only as a pin for CI's named
 * service container.
 *
 * The old fixed name was also the cleanup: DROP-and-recreate each run erased
 * last time's leftovers. Unique names lose that, so provisioning SWEEPS
 * stale siblings instead — any village_test_* schema whose embedded epoch is
 * over two hours old is dropped (a crashed run's orphan), while a live
 * parallel run's schema, minutes old, is never touched.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { applyPending, discoverMigrations, MIGRATIONS_DIR } from "./migrate";
import { noteProvision } from "./provisioningReport";

const RUN_STAMP = `${Math.floor(Date.now() / 1000)}_${process.pid}`;
let provisionSeq = 0;
function nextSchemaName(): string {
  return process.env.TEST_SCHEMA || `village_test_${RUN_STAMP}_${++provisionSeq}`;
}

/** Two hours: longer than any real suite run, shorter than a working day. */
const STALE_SCHEMA_MS = 2 * 60 * 60 * 1000;

async function sweepStaleSchemas(admin: mysql.Connection): Promise<void> {
  try {
    const [rows] = await admin.query(
      "SELECT schema_name AS s FROM information_schema.schemata WHERE schema_name LIKE 'village\\_test\\_%'",
    );
    for (const row of rows as Array<{ s: string }>) {
      const epoch = Number(row.s.split("_")[2]); // village_test_<epoch>_<pid>_<n>
      if (Number.isFinite(epoch) && Date.now() - epoch * 1000 > STALE_SCHEMA_MS) {
        await admin.query(`DROP DATABASE IF EXISTS \`${row.s}\``);
      }
    }
  } catch {
    // Sweeping is hygiene, not a gate — a permissions quirk on
    // information_schema must not fail the suite.
  }
}

/* ------------------------------------------------------------------------ *
 * The template.
 *
 * Measured 2026-08-22: 88 migration files and 47 provisions in a full run, one
 * full migration run each. That was about five minutes of every CI job spent
 * replaying the same DDL forty-seven times, and it grew by that multiple with
 * every migration anyone added. One PR-merge job was cancelled on the
 * fifteen-minute cap while the push job for the same commit finished in 4m38s,
 * so the headroom this spends is what makes runner variance fatal.
 *
 * MySQL has no `CREATE DATABASE ... TEMPLATE`, so the equivalent is built by
 * hand: migrate ONCE into a template schema, then give each suite a copy made
 * from that template's own `SHOW CREATE TABLE` plus a server-side row copy.
 *
 * What this keeps, all of it load-bearing:
 *
 *  - ISOLATION. Every suite still gets its own uniquely-named scratch schema
 *    that nothing else writes to. The template is read-only once built.
 *  - CLEANUP. `drop()` is unchanged, the two-hour sweep of crashed runs'
 *    scratch schemas is unchanged, and templates get a sweep of their own.
 *  - FIDELITY. The DDL is the server's own rendering of the migrated schema,
 *    replayed on the same server, so nothing is translated between engines and
 *    the local MariaDB and CI's MySQL each clone their own dialect exactly.
 *    `server/db/harness.test.ts` asserts a clone is column-for-column and
 *    index-for-index identical to a schema that ran the migrations itself.
 *  - THE SKIP. The suites still skip on `testDbConfigured()`, and
 *    `provisionTestDb` still throws on a missing TEST_DATABASE_URL.
 *
 *    Read that second half honestly: the throw is on a path nothing reaches.
 *    Every caller is inside `describe.skipIf(!testDbConfigured())`, so a
 *    missing variable means the suite is skipped and `provisionTestDb` is
 *    never called, so the throw never fires. This comment used to call that
 *    combination "the fail-loud skip", which read as a guarantee and was a
 *    dead branch. What actually makes a database-less run loud is the
 *    globalTeardown in `./provisioningReport.ts`: it counts the schemas the
 *    run provisioned and fails a whole run that provisioned none.
 *
 * The template's identity is the sha of every migration file's NAME and BYTES
 * plus the collation asked for, so a new migration means a new template and a
 * stale one can never be silently reused. That also lets the template survive
 * between runs on a developer machine: the second run of the day pays nothing
 * at all.
 * ------------------------------------------------------------------------ */

/** Templates outlive a run on purpose; this bounds how long. */
const STALE_TEMPLATE_MS = 24 * 60 * 60 * 1000;

let fingerprintCache: { key: string; files: string[] } | null = null;

/** Migration set identity: names and bytes, so an edited file is a different set. */
function migrationsFingerprint(): { key: string; files: string[] } {
  if (fingerprintCache) return fingerprintCache;
  const files = discoverMigrations();
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(f);
    h.update(fs.readFileSync(path.join(MIGRATIONS_DIR, f)));
  }
  fingerprintCache = { key: h.digest("hex").slice(0, 12), files };
  return fingerprintCache;
}

function templateSchemaName(collation?: string): string {
  const { key } = migrationsFingerprint();
  const tag = collation ? collation.replace(/[^a-z0-9]/g, "").slice(0, 28) : "default";
  return `village_tpl_${key}_${tag}`;
}

function schemaUrl(base: string, schema: string): string {
  const u = new URL(base);
  u.pathname = `/${schema}`;
  return u.toString();
}

function createSchemaSql(schema: string, collation?: string): string {
  return (
    `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4` + (collation ? ` COLLATE ${collation}` : "")
  );
}

/**
 * Ready means the ledger holds every migration on disk. That is the same
 * question `applyPending` asks, so a template that crashed half-way reads as
 * unready and is rebuilt instead of cloned into forty-three broken schemas.
 */
async function templateIsReady(
  admin: mysql.Connection,
  schema: string,
  files: string[],
): Promise<boolean> {
  const [dbs] = await admin.query<any[]>(
    "SELECT schema_name AS s FROM information_schema.schemata WHERE schema_name = ?",
    [schema],
  );
  if (dbs.length === 0) return false;
  // `[].every(...)` is true, so an empty migration set would report a schema
  // holding no tables at all as READY and clone it into every suite. The same
  // shape as a pinned count written as "at least one": a floor of zero proves
  // nothing. discoverMigrations now throws rather than returning [], and this
  // is the second lock on the same door.
  if (files.length === 0) return false;
  try {
    const [rows] = await admin.query<any[]>(
      `SELECT filename FROM \`${schema}\`.\`_migrations_applied\``,
    );
    const done = new Set(rows.map((r) => String(r.filename)));
    return files.every((f) => done.has(f));
  } catch {
    return false;
  }
}

/**
 * Build the template under a named MySQL lock.
 *
 * The lock is what makes this safe with five agent lanes on one server and
 * with vitest's own worker per file: whoever gets it builds, everyone else
 * waits and then finds it ready. The lock is held by the admin CONNECTION, so
 * a crashed builder releases it when its socket dies.
 */
async function buildTemplate(
  admin: mysql.Connection,
  base: string,
  schema: string,
  collation: string | undefined,
  files: string[],
): Promise<number> {
  const [[got]] = await admin.query<any[]>("SELECT GET_LOCK(?, 600) AS ok", [schema]);
  if (Number(got?.ok) !== 1) throw new Error(`could not take the template lock for ${schema}`);
  try {
    if (await templateIsReady(admin, schema, files)) return 0;
    const t0 = Date.now();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.query(createSchemaSql(schema, collation));
    const conn = await mysql.createConnection({ uri: schemaUrl(base, schema), timezone: "Z" });
    await conn.query("SET time_zone = '+00:00'");
    const result = await applyPending(conn);
    await conn.end();
    if (result.failed) {
      await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      throw new Error(`test schema migration failed: ${result.failed}`);
    }
    const ms = Date.now() - t0;
    noteProvision({ kind: "template", ms, migrations: files.length });
    // eslint-disable-next-line no-console
    console.log(
      `[testDb] built template ${schema}: ${files.length} migrations in ${(ms / 1000).toFixed(1)}s ` +
        `(${Math.round(ms / Math.max(files.length, 1))}ms per migration file). ` +
        `Every suite in this run clones it.`,
    );
    return ms;
  } finally {
    await admin.query("SELECT RELEASE_LOCK(?)", [schema]);
  }
}

interface SeededTable {
  table: string;
  /**
   * The columns a copy may write. Generated columns are excluded, because
   * `INSERT ... SELECT *` into one is an error, and `0049_org_roles.sql`
   * already ships one (`org_role_assignments.active_holder_key`). No migration
   * seeds that table today, so the only symptom would be a future migration
   * quietly dropping this back onto the slow path.
   *
   * Generated-ness is read from `GENERATION_EXPRESSION`, never from `EXTRA`.
   * MySQL 8 writes `DEFAULT_GENERATED` into `EXTRA` for every column with a
   * DEFAULT clause, so an `EXTRA NOT LIKE '%GENERATED%'` filter would drop
   * hundreds of ordinary columns on CI while staying invisible on the local
   * MariaDB, which does not use that word at all.
   */
  columns: string[];
}

interface TemplateShape {
  /** Bumped when the shape's format changes, so a cached file from before it is ignored. */
  version: number;
  /** One `SHOW CREATE TABLE` per base table, in the template's own dialect. */
  ddl: string[];
  /** Tables a migration put rows in. Everything else is copied as an empty shell. */
  seeded: SeededTable[];
}

const SHAPE_VERSION = 2;

const shapeCache = new Map<string, TemplateShape>();

function shapeCachePath(schema: string): string {
  return path.resolve(process.cwd(), "node_modules", ".cache", `${schema}.json`);
}

/** Forget a template's shape in this process and on disk, so the next read is fresh. */
function forgetShape(schema: string): void {
  shapeCache.delete(schema);
  try {
    fs.rmSync(shapeCachePath(schema), { force: true });
  } catch {
    /* the cache is an optimisation; a run without it is correct and slower */
  }
}

/**
 * Read the template's shape once. Cached in-process AND on disk, because
 * vitest gives each test file its own worker, so without the disk half every
 * one of the forty-odd workers would pay ninety round trips to learn the same
 * unchanging answer. The cache key is the template name, which carries the
 * migration-content hash, so a stale file cannot describe a different schema.
 */
async function captureTemplate(admin: mysql.Connection, schema: string): Promise<TemplateShape> {
  const memo = shapeCache.get(schema);
  if (memo) return memo;
  const cacheFile = shapeCachePath(schema);
  try {
    const onDisk = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as TemplateShape;
    if (
      onDisk.version === SHAPE_VERSION &&
      Array.isArray(onDisk.ddl) &&
      Array.isArray(onDisk.seeded) &&
      onDisk.ddl.length > 0
    ) {
      shapeCache.set(schema, onDisk);
      return onDisk;
    }
  } catch {
    /* no cache yet, or an unreadable one: read the server instead */
  }

  const [rows] = await admin.query<any[]>(
    "SELECT TABLE_NAME AS n, TABLE_TYPE AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    [schema],
  );
  const other = rows.filter((r) => String(r.t) !== "BASE TABLE").map((r) => String(r.n));
  if (other.length > 0) {
    // Views, and anything else SHOW CREATE TABLE does not round-trip, would
    // clone wrong and silently. Nothing in drizzle/ creates one today; if that
    // changes, this throws and provisioning falls back to migrating in full.
    throw new Error(`template ${schema} holds non-table objects: ${other.join(", ")}`);
  }
  const tables = rows.map((r) => String(r.n));
  for (const t of tables) {
    // Interpolated into DDL, which cannot take a placeholder.
    if (!/^[A-Za-z0-9_$]+$/.test(t)) throw new Error(`refusing to build DDL from table name ${t}`);
  }

  const ddl: string[] = [];
  for (const t of tables) {
    const [[row]] = await admin.query<any[]>(`SHOW CREATE TABLE \`${schema}\`.\`${t}\``);
    ddl.push(String(row["Create Table"]));
  }
  const [counts] = tables.length
    ? await admin.query<any[]>(
        tables
          .map((t) => `SELECT '${t}' AS t, COUNT(*) AS c FROM \`${schema}\`.\`${t}\``)
          .join(" UNION ALL "),
      )
    : [[] as any[]];
  const withRows = new Set(counts.filter((r) => Number(r.c) > 0).map((r) => String(r.t)));

  // Writable columns, in declaration order, for the tables that carry rows.
  const [colRows] = await admin.query<any[]>(
    "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = ? AND (GENERATION_EXPRESSION IS NULL OR GENERATION_EXPRESSION = '') " +
      "ORDER BY TABLE_NAME, ORDINAL_POSITION",
    [schema],
  );
  const columnsByTable = new Map<string, string[]>();
  for (const row of colRows as Array<{ t: string; c: string }>) {
    const table = String(row.t);
    if (!withRows.has(table)) continue;
    const column = String(row.c);
    // Interpolated into DDL, which cannot take a placeholder.
    if (!/^[A-Za-z0-9_$]+$/.test(column)) {
      throw new Error(`refusing to build DDL from column name ${table}.${column}`);
    }
    const list = columnsByTable.get(table) ?? [];
    list.push(column);
    columnsByTable.set(table, list);
  }
  // Array.from, never a spread: tsconfig.json omits `target`, which leaves
  // `pnpm check` on the ES5 default where spreading a Set is TS2802. Only
  // tsconfig.tests.json sets es2022, so a spread here typechecks in CI's
  // "Typecheck tests" step and fails in the "Typecheck" step before it.
  const seeded: SeededTable[] = Array.from(withRows)
    .sort()
    .map((table) => ({ table, columns: columnsByTable.get(table) ?? [] }));

  const shape: TemplateShape = { version: SHAPE_VERSION, ddl, seeded };
  shapeCache.set(schema, shape);
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(shape));
    fs.renameSync(tmp, cacheFile); // atomic, so a concurrent reader sees whole JSON
  } catch {
    /* the cache is an optimisation; a run without it is correct and slower */
  }
  return shape;
}

/** Two round trips: every table's DDL, then every seeded table's rows. */
async function cloneTemplate(
  base: string,
  template: string,
  schema: string,
  shape: TemplateShape,
): Promise<void> {
  // multipleStatements lives on THIS connection only, never on the one handed
  // to a test: the whole point is to spend one round trip instead of ninety,
  // and a test connection that accepts stacked statements is a footgun.
  const bulk = await mysql.createConnection({
    uri: schemaUrl(base, schema),
    timezone: "Z",
    multipleStatements: true,
  });
  try {
    await bulk.query("SET time_zone = '+00:00'");
    await bulk.query(["SET FOREIGN_KEY_CHECKS=0", ...shape.ddl, "SET FOREIGN_KEY_CHECKS=1"].join(";\n"));
    if (shape.seeded.length > 0) {
      await bulk.query(
        shape.seeded
          .map(({ table, columns }) => {
            // Named columns, never `SELECT *`: a generated column refuses to be
            // written, and `*` would carry one straight into the statement.
            const list = columns.map((c) => `\`${c}\``).join(", ");
            return `INSERT INTO \`${table}\` (${list}) SELECT ${list} FROM \`${template}\`.\`${table}\``;
          })
          .join(";\n"),
      );
    }
  } finally {
    await bulk.end();
  }
}

/**
 * Drop templates nobody has used for a day.
 *
 * A template is deliberately longer-lived than a run, so it needs its own
 * sweep or a machine that sees eight worktrees accumulates a schema per
 * migration-set forever. Two guards keep this from pulling a template out from
 * under a live run: the one this process is about to use is skipped by name,
 * and `IS_USED_LOCK` skips one a builder is holding. A clone that loses the
 * race anyway falls back to migrating in full, which is slow and correct.
 */
async function sweepStaleTemplates(admin: mysql.Connection, keep: string): Promise<void> {
  try {
    const [rows] = await admin.query<any[]>(
      "SELECT schema_name AS s FROM information_schema.schemata WHERE schema_name LIKE 'village\\_tpl\\_%'",
    );
    for (const row of rows as Array<{ s: string }>) {
      const name = String(row.s);
      if (name === keep) continue;
      const [[held]] = await admin.query<any[]>("SELECT IS_USED_LOCK(?) AS who", [name]);
      if (held?.who !== null && held?.who !== undefined) continue;
      let staleSince = 0;
      try {
        const [[age]] = await admin.query<any[]>(
          `SELECT UNIX_TIMESTAMP(MAX(applied_at)) AS t FROM \`${name}\`.\`_migrations_applied\``,
        );
        staleSince = Number(age?.t) * 1000;
      } catch {
        staleSince = 0; // no ledger at all: a half-built template, and nobody holds its lock
      }
      if (!Number.isFinite(staleSince) || Date.now() - staleSince > STALE_TEMPLATE_MS) {
        await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
        forgetShape(name);
      }
    }
  } catch {
    // Sweeping is hygiene, not a gate.
  }
}

export interface TestDb {
  /** Connection URL pointing at the scratch schema (timezone-Z discipline is the caller's job via connect()). */
  url: string;
  conn: mysql.Connection;
  drop(): Promise<void>;
}

/**
 * The gate 91 test files sit behind, via `describe.skipIf(!testDbConfigured())`.
 *
 * This function is deliberately quiet and must stay that way. A guard that
 * throws here would take out the JSON-era suite too, and a `console.warn` here
 * fires once per gated FILE, which is 91 identical lines scrolling past in the
 * middle of a run: noise, not a signal. Whether a run that skipped these is
 * allowed to exit 0 is decided ONCE, at the end, by
 * `hollowRunVerdict` in ./provisioningReport.ts.
 */
export function testDbConfigured(): boolean {
  return !!process.env.TEST_DATABASE_URL;
}

export interface ProvisionOptions {
  /**
   * Schema default collation. Omitted means `CHARACTER SET utf8mb4` with no
   * COLLATE, which on MySQL 8 lands on utf8mb4_0900_ai_ci — the same default
   * Railway uses, which is why the suite matched production so exactly that the
   * collation split in `db/collation.ts` was invisible to all of it.
   *
   * Pass a DIFFERENT collation to reproduce a fork's database.
   */
  collation?: string;
  /**
   * Whether this scratch village has already STARTED its Game (R67, lane
   * GAMESTART). Default true, and the default is the load-bearing part.
   *
   * Token issuance now waits for the launch ballot to carry: a faucet posting
   * is refused until `app_config['game-start']` exists, and migration 0112
   * writes that row only for a deployment whose ledger already proves it was
   * issuing. A scratch schema is migrated from empty, so every one of them
   * would arrive un-started, and forty suites that have nothing to do with
   * launch would each have to learn about it to keep minting.
   *
   * So the fixture says what a fixture should say: this is an ordinary village
   * mid-life. What that costs is stated plainly instead of hidden: the rest of
   * the suite cannot see the closed gate, so the gate's own suite
   * (`server/lib/gameStart.test.ts`) provisions with `gameStarted: false` and
   * proves both sides against a real database.
   */
  gameStarted?: boolean;
}

/**
 * Fresh scratch schema with every migration applied.
 *
 * The schema arrives as a copy of a template that ran the migrations once for
 * the whole run (see the block comment above). The copy is byte-for-byte the
 * same schema the migrations produce, and `applyPending` below still runs on
 * it, so this function's contract is unchanged: what comes back is a private
 * schema at the head of the migration list.
 */
export async function provisionTestDb(opts: ProvisionOptions = {}): Promise<TestDb> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set");
  // Interpolated into DDL, which cannot take a placeholder.
  if (opts.collation && !/^[a-z0-9_]+$/.test(opts.collation)) {
    throw new Error(`refusing to build DDL from collation=${opts.collation}`);
  }
  const startedAt = Date.now();
  const schema = nextSchemaName();
  const { files } = migrationsFingerprint();
  const template = templateSchemaName(opts.collation);
  const u = new URL(base);
  // Connect without a database first so we can drop/create the scratch one.
  const admin = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    timezone: "Z",
  });
  let templateMs = 0;
  let cloned = false;
  try {
    await sweepStaleSchemas(admin);
    await sweepStaleTemplates(admin, template);
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    try {
      if (!(await templateIsReady(admin, template, files))) {
        templateMs = await buildTemplate(admin, base, template, opts.collation, files);
      }
      const shape = await captureTemplate(admin, template);
      await admin.query(createSchemaSql(schema, opts.collation));
      await cloneTemplate(base, template, schema, shape);
      cloned = true;
    } catch (err: any) {
      // Every failure here is recoverable by doing the slow thing. A template
      // swept out from under this call, a permissions quirk on
      // information_schema, a view someone added: none of them are worth a red
      // suite, and all of them are worth SAYING, because the whole point of
      // the mechanism is the five minutes a silent fallback would spend.
      forgetShape(template);
      // eslint-disable-next-line no-console
      console.warn(
        `[testDb] could not clone template ${template} (${err?.message}). ` +
          `This schema is running all ${files.length} migrations itself, which is the slow path.`,
      );
      await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.query(createSchemaSql(schema, opts.collation));
    }
  } finally {
    await admin.end();
  }

  u.pathname = `/${schema}`;
  const url = u.toString();
  const conn = await mysql.createConnection({ uri: url, timezone: "Z" });
  // Same session pin as the pool and the migration engine: the scratch schema
  // must not be the one place NOW() means something else.
  await conn.query("SET time_zone = '+00:00'");
  const result = await applyPending(conn);
  if (result.failed) {
    // Drop before throwing. This is the ONLY path that creates a schema and
    // then abandons it, and it used to leave the half-migrated schema behind
    // for the two-hour sweeper to find on some later run — which only happens
    // if something provisions against that same server again. When
    // TEST_DATABASE_URL moved from the Railway proxy to a local MySQL, every
    // orphan already on Railway became unreachable by the sweeper, because
    // nothing will ever provision there to trigger it.
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    } catch {
      // A failed migration is the interesting error; a failed cleanup is not.
    }
    await conn.end();
    throw new Error(`test schema migration failed: ${result.failed}`);
  }
  // A clone must leave `applyPending` with nothing to do. If it ever applies
  // one, the template was behind the migrations on disk and the fingerprint
  // that is supposed to make that impossible has a hole in it.
  if (cloned && result.applied.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[testDb] the clone of ${template} was ${result.applied.length} migration(s) behind. ` +
        `The template fingerprint is not covering something it should.`,
    );
  }
  /*
   * The fixture's one opinion about this village, written here and nowhere
   * else. See `ProvisionOptions.gameStarted` for what it costs and why it is
   * still the right default. `ballotId` is a fixture marker on purpose: a row
   * reading `bal-fixture` can never be mistaken for a vote a village held.
   */
  if (opts.gameStarted !== false) {
    await conn.query("INSERT IGNORE INTO app_config (config_key, value) VALUES ('game-start', ?)", [
      JSON.stringify({
        startedAt: new Date().toISOString(),
        ballotId: "bal-fixture",
        startedBy: "test-harness",
        note: "Provisioned by the S5 test harness as a village whose Game has already started.",
      }),
    ]);
  }
  noteProvision({
    kind: cloned ? "clone" : "full",
    ms: Date.now() - startedAt - templateMs,
    migrations: files.length,
  });
  return {
    url,
    conn,
    async drop() {
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      } finally {
        await conn.end();
      }
    },
  };
}

/**
 * How long an e2e suite waits for the built server to answer `/health`.
 *
 * ONE number, because it was five hand-copied ones and they had already
 * drifted: three files said 180s and two said 120s, and the two short ones
 * were below the floor `vitest.config.ts` documents as the rule
 * (`hookTimeout > provisioning + this`). `messaging.routes.e2e` failed on it
 * against the hosted MySQL while CI stayed green, because CI runs MySQL as a
 * local service container where boot is fast.
 *
 * The number is not arbitrary. A first boot against a fresh scratch schema
 * runs every SQL migration, then every data migration, and ends with the 0049
 * org-chart backfill, which walks circles, seats and holders as separate
 * statements. That cost grows with every migration anyone adds.
 *
 * Raise this rather than lower it, and raise `hookTimeout` with it. When a
 * server genuinely will not start, THIS deadline prints the server's own log
 * and says what it was doing; the hook timeout says "Hook timed out" and
 * throws that log away. The informative error has to be the one that fires.
 *
 * 180s -> 120s on 2026-08-14, when the reason for 180 stopped existing.
 * TEST_DATABASE_URL pointed at a Railway MySQL through the public proxy, 47ms
 * round trip and 408-836ms per connect, so every one of these numbers was sized
 * by the wire rather than by the tests. A local MariaDB on :3307 now serves the
 * same migrations:
 *
 *     provisioning, all migrations, one pooled connection   46.8s -> 6.1s
 *     boot to /health, measured solo                                 25.9s
 *     server/ledger.test.ts, 21 tests, identical pass      165.5s -> 13.5s
 *
 * 60s was tried first, from that 25.9s solo boot, AND IT FAILED: four e2e
 * suites running together while five agent lanes worked the same machine could
 * not boot in 60s. A solo measurement is the wrong basis for a number that only
 * ever fires under contention, which is by definition when the machine is
 * busiest. 120s passed the identical four-suite run under identical load, 68
 * tests, 0 failures. SIZE THIS AGAINST CONTENTION, NOT AGAINST A QUIET BOX.
 *
 * If TEST_DATABASE_URL ever points at a remote host again, put 180s back. Each
 * worktree keeps its previous value beside it as `.env.remote-backup`.
 */
export const E2E_BOOT_DEADLINE_MS = 120_000;

/**
 * How long a port may still be held by whoever had it last.
 *
 * `fileParallelism: false` starts the next e2e file the moment the previous
 * afterAll resolves, and 40 of the 41 afterAll hooks call `child?.kill()` and
 * return without waiting for the child to exit. On Windows a SIGTERM
 * terminates the target unconditionally so the socket frees at once; on Linux
 * the server's own handler runs `gracefulShutdown`, draining in-flight
 * requests and closing the pool while vitest has already moved on. Ten seconds
 * is far longer than that drain and far shorter than the boot deadline.
 */
const PORT_RELEASE_DEADLINE_MS = 10_000;

/**
 * Refuse to boot onto a port somebody else is holding.
 *
 * WHY THIS EXISTS. Every e2e boot poll asks `GET /health` and breaks on any
 * 200. It asks whether SOMETHING is listening, never whether that something is
 * the child it just spawned. So a child that dies on a bind conflict while a
 * stranger answers on that port reads as a successful boot, and the suite runs
 * its whole scenario against the wrong server and the wrong schema. The
 * downstream symptom is the empty-string-token family: bootstrap returns
 * nothing usable and the first assertion three calls later says
 * `expected '' to be truthy`. That was reproduced exactly, on this machine, by
 * standing an ordinary server on the port `modulePool.e2e.test.ts` used to
 * hardcode.
 *
 * Two things produce the stranger, and this handles both: an ORPHAN from an
 * interrupted run (killing a runner does not kill the servers it spawned, and
 * they bind 0.0.0.0), and the PREVIOUS suite in this same run whose server has
 * not finished letting go. The first is a failure and says so by name; the
 * second is a wait.
 *
 * What it does NOT do is verify identity mid-run: a stranger that appears
 * AFTER this returns is still invisible. Disjoint windows (scripts/check-e2e-
 * ports.mjs) make that vanishingly unlikely; a nonce echoed by /health would
 * close it completely and is the next step, not this one.
 */
export async function waitForPortFree(port: number, host = "127.0.0.1"): Promise<void> {
  const net = await import("node:net");
  const accepting = (): Promise<boolean> =>
    new Promise((resolve) => {
      const sock = net.connect({ port, host });
      const done = (answer: boolean) => {
        sock.removeAllListeners();
        sock.destroy();
        resolve(answer);
      };
      sock.setTimeout(1_000);
      sock.once("connect", () => done(true));
      sock.once("timeout", () => done(false));
      sock.once("error", () => done(false));
    });

  const deadline = Date.now() + PORT_RELEASE_DEADLINE_MS;
  for (;;) {
    if (!(await accepting())) return;
    if (Date.now() > deadline) {
      throw new Error(
        `port ${port} is already held by another process after ` +
          `${PORT_RELEASE_DEADLINE_MS / 1000}s of waiting, so this suite cannot boot its own ` +
          `server there. Without this check the boot poll would have accepted the stranger's ` +
          `200 and run the whole scenario against it, failing later with something like ` +
          `"expected '' to be truthy". Usual causes: an orphaned server from an interrupted ` +
          `run (they are not killed with their runner and they bind 0.0.0.0), or another ` +
          `worktree running the same suite. Find it with ` +
          `\`Get-NetTCPConnection -LocalPort ${port} -State Listen\` or \`lsof -i :${port}\`.`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/*
 * Re-exported here for the same reason E2E_BOOT_DEADLINE_MS lives here: the
 * e2e harness should have ONE place it imports its shared facts from. The
 * implementation is in ./distFreshness so vitest's globalSetup can call it
 * without pulling mysql2 into the main process.
 */
/**
 * Resolves once a transaction on the pool's own schema is waiting on a lock.
 *
 * A lock test puts a second actor behind a transaction that holds a row, and it
 * has to know the second actor is really queued before the first one commits.
 * A fixed sleep only makes that likely: on a loaded machine the second actor can
 * arrive after the commit, meet no lock at all, and pass. This polls InnoDB's
 * own transaction table instead, so the wait is a fact, and it throws when
 * nothing ever waits, so a case whose second actor never met the lock fails
 * instead of passing. The schema filter keeps another suite's lock on a shared
 * server from answering for this one.
 */
export async function untilALockIsAwaited(
  pool: { query(sql: string): Promise<unknown> },
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [rows] = (await pool.query( // module-review-ok: InnoDB's own lock table, read for the scratch schema a lock test provisioned
      "SELECT COUNT(*) AS n FROM information_schema.innodb_trx t " +
        "JOIN information_schema.processlist p ON p.id = t.trx_mysql_thread_id " +
        "WHERE t.trx_state = 'LOCK WAIT' AND p.db = DATABASE()",
    )) as [Array<{ n: number | string }>, unknown];
    if (Number(rows[0]?.n ?? 0) > 0) return;
    if (Date.now() > deadline) {
      throw new Error(`Nothing on this schema waited on a lock within ${timeoutMs} ms, so the second actor never met it.`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

export { assertFreshDist, distFreshnessProblem } from "./distFreshness";
