/**
 * Every statement against `member_gene_keys` (drizzle/0272, 0287).
 *
 * The table holds a result and never a birth: see the migration's header for
 * why no column may ever carry a date, a time or a place. Reads of OTHER
 * members filter on `visibility = 'show'` in the SQL itself, so a hidden row
 * cannot reach a caller that forgot to check.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export type Queryable = Pool | PoolConnection;

import type { GeneKeysSource, GeneKeysVisibility } from "../../shared/geneKeys";

export type { GeneKeysSource, GeneKeysVisibility };

export interface GeneKeysRow {
  userId: string;
  /** The stored JSON, parsed. Shape-checked by the lib before it is trusted. */
  chart: unknown;
  profile: string;
  hdType: string;
  hdAuthority: string;
  visibility: GeneKeysVisibility;
  maia: boolean;
  /** In "Who complements me" (0287). Opt-in; seen only by others who opted in too. */
  complement: boolean;
  /** "Talk to me plainly" (0287): Maia never adapts her wording to the type. */
  maiaPlain: boolean;
  /** "Leave me out of session cards" (0296): welcomed by name, never read. */
  cardOut: boolean;
  source: GeneKeysSource;
  calcVersion: number;
  updatedAt: string | null;
}

const COLUMNS =
  "`user_id`, `chart`, `profile`, `hd_type`, `hd_authority`, `visibility`, `maia`, `complement`, `maia_plain`, `card_out`, `source`, `calc_version`, `updated_at`";

function parseChart(text: unknown): unknown {
  try {
    return JSON.parse(String(text ?? "null"));
  } catch {
    return null;
  }
}

function toRow(r: RowDataPacket): GeneKeysRow {
  return {
    userId: String(r.user_id),
    chart: parseChart(r.chart),
    profile: String(r.profile),
    hdType: String(r.hd_type),
    hdAuthority: String(r.hd_authority),
    visibility: r.visibility === "hide" ? "hide" : "show",
    maia: Number(r.maia) === 1,
    complement: Number(r.complement) === 1,
    maiaPlain: Number(r.maia_plain) === 1,
    cardOut: Number(r.card_out) === 1,
    source: r.source === "chosen" || r.source === "typed" ? r.source : "exact",
    calcVersion: Number(r.calc_version),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

/** The member's own row, hidden or not. */
export async function readGeneKeys(pool: Queryable, userId: string): Promise<GeneKeysRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM \`member_gene_keys\` WHERE \`user_id\` = ? LIMIT 1`, [userId]);
  return rows[0] ? toRow(rows[0]) : null;
}

export interface GeneKeysWrite {
  userId: string;
  chart: unknown;
  profile: string;
  hdType: string;
  hdAuthority: string;
  visibility: GeneKeysVisibility;
  maia: boolean;
  source: GeneKeysSource;
  calcVersion: number;
}

/** One row per member: a new reading replaces the old one whole. */
export async function writeGeneKeys(pool: Queryable, w: GeneKeysWrite): Promise<void> {
  await pool.query(
    "INSERT INTO `member_gene_keys` (`user_id`, `chart`, `profile`, `hd_type`, `hd_authority`, `visibility`, `maia`, `source`, `calc_version`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `chart` = VALUES(`chart`), `profile` = VALUES(`profile`), `hd_type` = VALUES(`hd_type`), " +
      "`hd_authority` = VALUES(`hd_authority`), `visibility` = VALUES(`visibility`), `maia` = VALUES(`maia`), " +
      "`source` = VALUES(`source`), `calc_version` = VALUES(`calc_version`)",
    [w.userId, JSON.stringify(w.chart), w.profile, w.hdType, w.hdAuthority, w.visibility, w.maia ? 1 : 0, w.source, w.calcVersion],
  );
}

export interface GeneKeysSettingsPatch {
  visibility?: GeneKeysVisibility;
  maia?: boolean;
  complement?: boolean;
  maiaPlain?: boolean;
  cardOut?: boolean;
}

/** Change who sees the lines, what Maia may do with them, "Who complements me", or session cards. Returns whether a row exists. */
export async function updateGeneKeysSettings(pool: Queryable, userId: string, patch: GeneKeysSettingsPatch): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.visibility) { sets.push("`visibility` = ?"); args.push(patch.visibility); }
  if (typeof patch.maia === "boolean") { sets.push("`maia` = ?"); args.push(patch.maia ? 1 : 0); }
  if (typeof patch.complement === "boolean") { sets.push("`complement` = ?"); args.push(patch.complement ? 1 : 0); }
  if (typeof patch.maiaPlain === "boolean") { sets.push("`maia_plain` = ?"); args.push(patch.maiaPlain ? 1 : 0); }
  if (typeof patch.cardOut === "boolean") { sets.push("`card_out` = ?"); args.push(patch.cardOut ? 1 : 0); }
  if (!sets.length) return (await readGeneKeys(pool, userId)) !== null;
  const [r] = await pool.query<any>(`UPDATE \`member_gene_keys\` SET ${sets.join(", ")} WHERE \`user_id\` = ?`, [...args, userId]);
  return Number(r?.affectedRows ?? 0) > 0;
}

/** Remove the member's row. The member's own door and the erasure sweep both call this. */
export async function deleteGeneKeys(pool: Queryable, userId: string): Promise<number> {
  const [r] = await pool.query<any>("DELETE FROM `member_gene_keys` WHERE `user_id` = ?", [userId]);
  return Number(r?.affectedRows ?? 0);
}

/** Other members' rows, only the shown ones. At most `ids.length` rows, in no promised order. */
export async function shownGeneKeysFor(pool: Queryable, ids: string[]): Promise<GeneKeysRow[]> {
  if (!ids.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`member_gene_keys\` WHERE \`visibility\` = 'show' AND \`user_id\` IN (?)`,
    [ids],
  );
  return rows.map(toRow);
}

/** One member's shown row, found by the handle their public profile uses. */
export async function shownGeneKeysByHandle(pool: Queryable, handle: string): Promise<GeneKeysRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT g.`user_id`, g.`chart`, g.`profile`, g.`hd_type`, g.`hd_authority`, g.`visibility`, g.`maia`, g.`complement`, g.`maia_plain`, g.`card_out`, g.`source`, g.`calc_version`, g.`updated_at` " +
      "FROM `member_gene_keys` g JOIN `users` u ON u.`id` = g.`user_id` " +
      "WHERE u.`handle` = ? AND u.`is_example` = 0 AND g.`visibility` = 'show' LIMIT 1",
    [handle],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Every member whose lines are shown, for the earned badge "Lines found" (server/lib/badges.ts). */
export async function shownGeneKeysUserIds(pool: Queryable): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT `user_id` FROM `member_gene_keys` WHERE `visibility` = 'show'");
  return rows.map((r) => String(r.user_id));
}

export interface ComplementRow extends GeneKeysRow {
  name: string;
  handle: string | null;
}

/**
 * "Who complements me": everyone else who opted in AND shows their lines, with
 * the name and handle their profile uses. Both conditions live in the SQL, so a
 * member who never said yes, or hides their lines, cannot reach this list.
 */
export async function complementCandidates(pool: Queryable, exceptUserId: string): Promise<ComplementRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT g.`user_id`, g.`chart`, g.`profile`, g.`hd_type`, g.`hd_authority`, g.`visibility`, g.`maia`, g.`complement`, g.`maia_plain`, g.`card_out`, " +
      "g.`source`, g.`calc_version`, g.`updated_at`, u.`name`, u.`handle` " +
      "FROM `member_gene_keys` g JOIN `users` u ON u.`id` = g.`user_id` " +
      "WHERE g.`complement` = 1 AND g.`visibility` = 'show' AND u.`is_example` = 0 AND g.`user_id` <> ?",
    [exceptUserId],
  );
  return rows.map((r) => ({ ...toRow(r), name: String(r.name ?? ""), handle: r.handle ? String(r.handle) : null }));
}

/**
 * The rows a session card may READ, for the people present: shown, Maia allowed
 * to use them, and not left out of cards (0296). All three in the SQL, so a
 * card cannot read a member who did not say yes to every one.
 */
export async function cardReadableGeneKeys(pool: Queryable, ids: string[]): Promise<GeneKeysRow[]> {
  if (!ids.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`member_gene_keys\` WHERE \`visibility\` = 'show' AND \`maia\` = 1 AND \`card_out\` = 0 AND \`user_id\` IN (?)`,
    [ids],
  );
  return rows.map(toRow);
}
