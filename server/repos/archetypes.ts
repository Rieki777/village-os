/**
 * The `archetypes` table, read and written in one place.
 *
 * ── WHY EVERY STATEMENT LIVES HERE AND NOT IN THE ROUTE ────────────────────
 *
 * `server/routes/archetypes.ts` is the admin surface for the five classes. It
 * validates, refuses, and says sentences. It holds no SQL at all, which is the
 * house rule (`scripts/sql-burndown.mjs`) and is also what makes the guarantee
 * below auditable: "which statements can write this table" is answered by
 * reading one short file, and the answer is the four functions here.
 *
 * ── THE GUARANTEE: `key` IS AN IDENTIFIER, AND ONLY ONE FUNCTION WRITES IT ──
 *
 * `key` is joined on by `openPathsFor` (server/lib/characters.ts), by the
 * per-power affinity map, and by every `player_characters` row a member has
 * ever chosen. Renaming one does not fail: it silently matches nothing, and a
 * member's chosen class stops resolving with no error anywhere. So the editor
 * must not be able to reach it, and "the form does not send one" is not a
 * mechanism. Five things make it unreachable, and they are cheap to re-check:
 *
 *   1. `ArchetypeWords` is the ONLY shape the edit path accepts and it has no
 *      `key` member. TypeScript's excess-property check refuses an object
 *      literal that carries one, so `{ ...req.body }` will not compile into
 *      this parameter.
 *   2. `updateArchetypeWords` takes the key as a SEPARATE positional argument.
 *      It reaches the statement only through the WHERE clause, where it
 *      selects a row and cannot become a value.
 *   3. `EDITABLE_SET` is a fixed string naming six columns. `key` is not one
 *      of them, the parameter array beside it is typed out by hand in the same
 *      order, and nothing here builds a column list from data. Widening that
 *      constant is a visible line in a diff.
 *   4. `insertArchetype` is the one function whose SQL names `key` in a column
 *      list, and it is a bare INSERT with no ON DUPLICATE KEY UPDATE, so it
 *      can create a row and can never rewrite one.
 *   5. `reorderArchetypes` writes `sort_order` and `customized` and nothing
 *      else; `key` appears only as the CASE selector.
 *
 * ── `customized` IS THE FLAG THAT KEEPS A VILLAGE'S OWN WORDS ──────────────
 *
 * 0193 added it and `server/lib/economySeed.ts` reads it: the boot seed's
 * ON DUPLICATE KEY UPDATE is conditional on it, so a village that has edited a
 * class keeps its words through a redeploy while a village that has touched
 * nothing still receives platform copy improvements. Every write here that
 * represents an admin's decision therefore sets it, including the reorder. A
 * reorder that left the flag alone would be put back by the next restart with
 * nothing said, which is the exact failure 0193 exists to end.
 *
 * The reorder sets it only on rows that actually MOVED, which is why the
 * statement assigns `customized` BEFORE `sort_order`: MySQL evaluates a SET
 * list left to right and a later expression sees the values already assigned,
 * so the comparison has to run while `sort_order` still holds the old number.
 * Dragging one card does not freeze the other four.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Every column the admin surface reads. `key` is here as a READ, and only that. */
const READ_COLUMNS =
  "`key`, `name`, `subtitle`, `blurb`, `examples`, `sigil`, `sort_order`, `customized`";

/**
 * The columns an edit may write, named one by one.
 *
 * `customized` is a literal 1 rather than a parameter, so no caller can set it
 * back to 0 and hand a village's words back to the seed.
 */
const EDITABLE_SET =
  "`name` = ?, `subtitle` = ?, `blurb` = ?, `examples` = ?, `sigil` = ?, `customized` = 1";

/** One class, as the admin surface sees it. */
export interface ArchetypeAdminRow {
  key: string;
  name: string;
  subtitle: string;
  blurb: string;
  examples: string[];
  sigil: string;
  sortOrder: number;
  /** True once a human has made this class the village's own. */
  customized: boolean;
}

/**
 * The village's own words for a class. There is deliberately no `key`.
 *
 * This type is point 1 of the guarantee in the header. It is the whole of what
 * an edit may say, and a reader checking whether the key is reachable can stop
 * at these five fields.
 */
export interface ArchetypeWords {
  name: string;
  subtitle: string;
  blurb: string;
  examples: string[];
  sigil: string;
  /**
   * Never set. Declared so the compiler has something to refuse.
   *
   * Leaving `key` off the interface makes an object literal carrying one an
   * excess property, which TypeScript rejects, and that is most of the job.
   * `key?: never` closes the case where a caller passes a variable it has
   * already widened, since the property then has to be assignable to `never`
   * and nothing but `undefined` is. What neither can catch is a value typed
   * `any`, which `req.body` is: `any` defeats every type-level guard there is.
   * That case is closed one layer down, by `EDITABLE_SET` and
   * `editableValues`, which name the five columns and read the five fields.
   * A property nothing reads cannot reach a statement whose columns are a
   * fixed string.
   */
  key?: never;
}

const toRow = (r: RowDataPacket): ArchetypeAdminRow => ({
  key: String(r.key),
  name: String(r.name ?? ""),
  subtitle: String(r.subtitle ?? ""),
  blurb: String(r.blurb ?? ""),
  // A json column: mysql2 has already parsed it. Guard the shape anyway, the
  // same way `listArchetypes` does, so a hand-edited row degrades to no
  // examples instead of throwing inside a route.
  examples: Array.isArray(r.examples) ? r.examples.map(String) : [],
  sigil: String(r.sigil ?? ""),
  sortOrder: Number(r.sort_order ?? 0),
  customized: Number(r.customized) === 1,
});

/** The values `EDITABLE_SET` takes, in its order. Written out, never spread. */
const editableValues = (words: ArchetypeWords): unknown[] => [
  words.name,
  words.subtitle,
  words.blurb,
  JSON.stringify(words.examples),
  words.sigil,
];

/**
 * Every class this village has, in the order it shows them.
 *
 * `sort_order` then `key`, matching `listArchetypes` in
 * server/lib/characters.ts, so the admin list and the member-facing list can
 * never disagree about which class comes first.
 */
export async function listArchetypeRows(pool: Pool, villageId: string): Promise<ArchetypeAdminRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT " +
      READ_COLUMNS +
      " FROM `archetypes` WHERE `village_id` = ? ORDER BY `sort_order`, `key`",
    [villageId],
  );
  return rows.map(toRow);
}

/** One class, or null when this village has no such key. */
export async function getArchetypeRow(
  pool: Pool,
  villageId: string,
  key: string,
): Promise<ArchetypeAdminRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT " + READ_COLUMNS + " FROM `archetypes` WHERE `village_id` = ? AND `key` = ?",
    [villageId, key],
  );
  const row = rows[0];
  return row ? toRow(row) : null;
}

/**
 * Rewrite a class's words, and mark the class the village's own.
 *
 * The key selects the row and is never a value: it is a separate argument and
 * appears once, in the WHERE clause. See point 2 of the header.
 *
 * Returns the row as it now stands, or null when there was no such class. The
 * answer comes from a read-back instead of from `affectedRows`, because an
 * UPDATE that matches a row and changes nothing reports zero under some driver
 * flag settings, and "nothing to change" would then be indistinguishable from
 * "no such class". A missing row matched nothing, so nothing was written and
 * the null is the whole truth.
 */
export async function updateArchetypeWords(
  pool: Pool,
  villageId: string,
  key: string,
  words: ArchetypeWords,
): Promise<ArchetypeAdminRow | null> {
  await pool.query(
    "UPDATE `archetypes` SET " + EDITABLE_SET + " WHERE `village_id` = ? AND `key` = ?",
    [...editableValues(words), villageId, key],
  );
  return getArchetypeRow(pool, villageId, key);
}

/** What `insertArchetype` did. A collision is an outcome, never an exception. */
export type InsertOutcome =
  | { added: true; row: ArchetypeAdminRow }
  | { added: false; reason: "exists" };

/** MySQL's duplicate-key error. The primary key is (village_id, key). */
const isDuplicate = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === "ER_DUP_ENTRY";

/**
 * Add a class. THE ONLY PLACE A KEY IS EVER WRITTEN.
 *
 * A bare INSERT, with no ON DUPLICATE KEY UPDATE: a second call with a key
 * this village already has raises a duplicate-key error, which comes back as
 * `added: false` and never as an overwrite. The database decides that, not a
 * check-then-write in the caller, so two admins adding the same key at the
 * same moment cannot both win.
 *
 * `customized` is 1 from the start. A class a village invented is that
 * village's own by definition, and if a later platform release ever ships the
 * same key the village's words survive the seed.
 *
 * `sort_order` lands the new class at the end of the list. Two adds racing can
 * land on the same number, which is harmless: every read orders by
 * `sort_order` then `key`, so the tie breaks the same way every time.
 */
export async function insertArchetype(
  pool: Pool,
  villageId: string,
  key: string,
  words: ArchetypeWords,
): Promise<InsertOutcome> {
  const [maxRows] = await pool.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(`sort_order`), -1) + 1 AS next FROM `archetypes` WHERE `village_id` = ?",
    [villageId],
  );
  const sortOrder = Number(maxRows[0]?.next ?? 0);
  try {
    await pool.query(
      "INSERT INTO `archetypes` " +
        "(`village_id`, `key`, `name`, `subtitle`, `blurb`, `examples`, `sigil`, `sort_order`, `customized`) " +
        "VALUES (?,?,?,?,?,?,?,?,1)",
      [villageId, key, ...editableValues(words), sortOrder],
    );
  } catch (err) {
    if (isDuplicate(err)) return { added: false, reason: "exists" };
    throw err;
  }
  const row = await getArchetypeRow(pool, villageId, key);
  if (row) return { added: true, row };
  // The row was just inserted, so a null read-back means something removed it
  // in between. The insert still happened, so report what was written. Built
  // field by field, because nothing in this module spreads an object into a
  // shape a column list is derived from.
  return {
    added: true,
    row: {
      key,
      name: words.name,
      subtitle: words.subtitle,
      blurb: words.blurb,
      examples: words.examples,
      sigil: words.sigil,
      sortOrder,
      customized: true,
    },
  };
}

/**
 * Put the classes in the given order, in one statement.
 *
 * The caller has already checked that `keys` names every class exactly once,
 * which is what makes a single UPDATE correct: every row is assigned, so no
 * row is left at a number another row now also holds. The `ELSE` branch is
 * therefore unreachable and is written anyway, because a CASE with no ELSE
 * yields NULL and `sort_order` is NOT NULL.
 *
 * `customized` is assigned FIRST on purpose. See the header: MySQL's SET list
 * is evaluated left to right and later expressions see the new values, so the
 * comparison has to happen while `sort_order` is still the old number. A row
 * that did not move keeps its flag and keeps receiving platform copy.
 */
export async function reorderArchetypes(
  pool: Pool,
  villageId: string,
  keys: readonly string[],
): Promise<void> {
  if (!keys.length) return;
  const caseExpr = "CASE `key` " + keys.map(() => "WHEN ? THEN ?").join(" ") + " ELSE `sort_order` END";
  const pairs = keys.flatMap((k, i) => [k, i]);
  await pool.query(
    "UPDATE `archetypes` SET " +
      "`customized` = IF((" +
      caseExpr +
      ") <> `sort_order`, 1, `customized`), " +
      "`sort_order` = " +
      caseExpr +
      " WHERE `village_id` = ?",
    [...pairs, ...pairs, villageId],
  );
}
