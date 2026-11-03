/**
 * The bridge board's reading: counts only, never a title, a note, or a person.
 * A table that is not in this database yet answers "not ready", never an error,
 * so the board can say "Building" while another change is still landing.
 */
import type { Pool } from "mysql2/promise";
import type { BridgeAnswer } from "@shared/seraBridgeBoard";

type Row = Record<string, unknown>;

async function tables(pool: Pool, names: string[]): Promise<Set<string>> {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`,
    names,
  );
  return new Set((rows as Row[]).map((r) => String(r.t ?? r.TABLE_NAME)));
}

async function one(pool: Pool, sql: string, args: unknown[] = []): Promise<Row> {
  const [rows] = await pool.query(sql, args);
  return ((rows as Row[])[0] ?? {}) as Row;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function columns(pool: Pool, table: string): Promise<Set<string>> {
  const [rows] = await pool.query(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  );
  return new Set((rows as Row[]).map((r) => String(r.c ?? r.COLUMN_NAME)));
}

export async function bridgeLists(pool: Pool, have: Set<string>): Promise<BridgeAnswer["lists"]> {
  const empty = { ready: false, linkedPeople: 0, listsOn: 0, imported: 0, importedOpen: 0, lastBatch: null };
  if (!have.has("member_tasks") || !have.has("member_task_access") || !have.has("sera_person_links")) return empty;
  const linked = await one(pool, "SELECT COUNT(DISTINCT `user_id`) AS n FROM `sera_person_links`");
  const on = await one(pool, "SELECT COUNT(*) AS n FROM `member_task_access` WHERE `list_on` = 1");
  const imp = await one(
    pool,
    "SELECT COUNT(*) AS n, SUM(`status` = 'open') AS o FROM `member_tasks` WHERE `source` = 'sera'",
  );
  const last = await one(
    pool,
    "SELECT `import_batch` AS b, MAX(`created_at`) AS at, COUNT(*) AS n FROM `member_tasks` WHERE `source` = 'sera' AND `import_batch` IS NOT NULL GROUP BY `import_batch` ORDER BY MAX(`created_at`) DESC LIMIT 1",
  );
  const at = last.at instanceof Date ? last.at.toISOString() : last.at ? String(last.at) : null;
  return {
    ready: true,
    linkedPeople: n(linked.n),
    listsOn: n(on.n),
    imported: n(imp.n),
    importedOpen: n(imp.o),
    lastBatch: last.b ? { id: String(last.b), at, tasks: n(last.n) } : null,
  };
}

export async function bridgeFeedback(pool: Pool, have: Set<string>): Promise<BridgeAnswer["feedback"]> {
  const off = { ready: false, sent: 0, queued: 0, failed: 0, notesHeld: 0, notesReleased: null };
  if (!have.has("member_task_feedback")) return off;
  const cols = await columns(pool, "member_task_feedback");
  const statusCol = ["sera_status", "send_status", "status"].find((c) => cols.has(c));
  if (!statusCol) return { ...off, ready: true };
  const [rows] = await pool.query(
    `SELECT \`${statusCol}\` AS s, COUNT(*) AS n FROM \`member_task_feedback\` GROUP BY \`${statusCol}\``,
  );
  const by = new Map((rows as Row[]).map((r) => [String(r.s), n(r.n)]));
  const sum = (...keys: string[]) => keys.reduce((t, k) => t + (by.get(k) ?? 0), 0);
  let notesHeld = 0;
  const noteCol = ["note_status", "note_held"].find((c) => cols.has(c));
  if (noteCol === "note_status") notesHeld = n((await one(pool, "SELECT COUNT(*) AS n FROM `member_task_feedback` WHERE `note_status` = 'held'")).n);
  if (noteCol === "note_held") notesHeld = n((await one(pool, "SELECT COUNT(*) AS n FROM `member_task_feedback` WHERE `note_held` = 1")).n);
  return {
    ready: true,
    sent: sum("sent", "accepted", "delivered"),
    queued: sum("queued", "pending", "waiting"),
    failed: sum("failed", "error", "refused"),
    notesHeld,
    notesReleased: null,
  };
}

export async function bridgeReading(pool: Pool): Promise<Omit<BridgeAnswer, "connection">> {
  const have = await tables(pool, [
    "member_tasks",
    "member_task_access",
    "sera_person_links",
    "member_task_import_queue",
    "member_task_feedback",
    "external_proposals",
  ]);
  const lists = await bridgeLists(pool, have);
  const feedback = await bridgeFeedback(pool, have);
  const review = have.has("external_proposals")
    ? n((await one(pool, "SELECT COUNT(*) AS n FROM `external_proposals` WHERE `module_id` = 'saberra' AND `status` = 'proposed'")).n)
    : 0;
  const needsOwner = have.has("member_task_import_queue")
    ? { ready: true, waiting: n((await one(pool, "SELECT COUNT(*) AS n FROM `member_task_import_queue` WHERE `status` = 'waiting'")).n) }
    : { ready: false, waiting: 0 };
  return { lists, feedback, reviewQueue: { waiting: review }, needsOwner };
}
