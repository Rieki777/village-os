/**
 * Every statement against the place registry's tables (drizzle/0354), and the
 * few reads it makes of other modules' tables by place key.
 *
 * Raw SQL, one place: the lib and the routes never query these tables
 * themselves. Every INSERT names every column it writes, so no DEFAULT is
 * relied on for a value the caller meant to set. Every read is scoped by
 * `village_id`.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { HomeUnits, PlaceKind, PlaceStage, PermitItem, SeedDispute } from "../../shared/places";

export type Queryable = Pool | PoolConnection;

export type Tri = "yes" | "no" | "unknown";

export interface StewardHold {
  state: "held" | "paused";
  reason: string;
  endsCycle: string | null;
  by: string;
}

export interface PlaceRow {
  key: string;
  name: string;
  zone: string | null;
  kind: PlaceKind;
  stage: PlaceStage | null;
  readinessPct: number | null;
  confirmed: boolean;
  disputes: SeedDispute[];
  aliases: string[];
  units: Partial<HomeUnits> | null;
  positionText: string;
  description: string | null;
  phase: string | null;
  isTemporary: boolean;
  temporarySuccessor: string | null;
  setAsideReason: string | null;
  retiredAt: string | null;
  inPreserve: Tri;
  inRiparian: Tri;
  footprintM2: number | null;
  childSafe: boolean;
  hoursWindow: unknown;
  isHome: boolean;
  showcase: boolean;
  stewardRoleId: string | null;
  stewardHold: StewardHold | null;
  claimWindowEndsAt: string | null;
  targetDate: string | null;
  createdBy: string;
}

export interface ZoneRow { key: string; name: string; sort: number; positionText: string }
export interface PermitRow extends PermitItem { reason: string | null; changedBy: string }
export interface LinkRow { fromKey: string; toKey: string; kind: "serves" | "part_of" }

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const tri = (v: unknown): Tri => (v === "yes" || v === "no" ? v : "unknown");

/** A `json` column arrives parsed in some mysql2 configurations and as text in others. */
function json<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function toPlace(r: RowDataPacket): PlaceRow {
  const hold = json<StewardHold | null>(r.steward_hold, null);
  return {
    key: String(r.key),
    name: String(r.name),
    zone: str(r.zone),
    kind: String(r.kind) as PlaceKind,
    stage: (str(r.stage) as PlaceStage | null),
    readinessPct: num(r.readiness_pct),
    confirmed: Number(r.confirmed) === 1,
    disputes: json<SeedDispute[]>(r.disputes, []),
    aliases: json<string[]>(r.aliases, []),
    units: json<Partial<HomeUnits> | null>(r.units, null),
    positionText: String(r.position_text ?? ""),
    description: str(r.description),
    phase: str(r.phase),
    isTemporary: Number(r.is_temporary) === 1,
    temporarySuccessor: str(r.temporary_successor),
    setAsideReason: str(r.set_aside_reason),
    retiredAt: iso(r.retired_at),
    inPreserve: tri(r.in_preserve),
    inRiparian: tri(r.in_riparian),
    footprintM2: num(r.footprint_m2),
    childSafe: Number(r.child_safe) === 1,
    hoursWindow: json<unknown>(r.hours_window, null),
    isHome: Number(r.is_home) === 1,
    showcase: Number(r.showcase) === 1,
    stewardRoleId: str(r.steward_role_id),
    stewardHold: hold && (hold.state === "held" || hold.state === "paused") ? hold : null,
    claimWindowEndsAt: iso(r.claim_window_ends_at),
    targetDate: str(r.target_date),
    createdBy: String(r.created_by),
  };
}

const PLACE_COLS =
  "`key`, `name`, `zone`, `kind`, `stage`, `readiness_pct`, `confirmed`, `disputes`, `aliases`, `units`, " +
  "`position_text`, `description`, `phase`, `is_temporary`, `temporary_successor`, `set_aside_reason`, " +
  "`retired_at`, `in_preserve`, `in_riparian`, `footprint_m2`, `child_safe`, `hours_window`, `is_home`, " +
  "`showcase`, `steward_role_id`, `steward_hold`, `claim_window_ends_at`, `target_date`, `created_by`";

/** Every place, retired ones included (the caller decides what to show). */
export async function listPlaceRows(pool: Queryable, villageId: string): Promise<PlaceRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT " + PLACE_COLS + " FROM `places` WHERE `village_id` = ? ORDER BY `zone`, `name`",
    [villageId],
  );
  return rows.map(toPlace);
}

export async function listZoneRows(pool: Queryable, villageId: string): Promise<ZoneRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `key`, `name`, `sort`, `position_text` FROM `place_zones` WHERE `village_id` = ? ORDER BY `sort`, `key`",
    [villageId],
  );
  return rows.map((r) => ({ key: String(r.key), name: String(r.name), sort: Number(r.sort), positionText: String(r.position_text ?? "") }));
}

export async function listPermitRows(pool: Queryable, villageId: string): Promise<PermitRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `key`, `title`, `state`, `reason`, `waits_on`, `changed_by` FROM `place_permits` WHERE `village_id` = ? ORDER BY `key`, `id`",
    [villageId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    place: String(r.key),
    title: String(r.title),
    state: String(r.state) as PermitItem["state"],
    waitsOn: json<string[]>(r.waits_on, []),
    reason: str(r.reason),
    changedBy: String(r.changed_by),
  }));
}

export async function listLinkRows(pool: Queryable, villageId: string): Promise<LinkRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `from_key`, `to_key`, `kind` FROM `place_links` WHERE `village_id` = ? ORDER BY `from_key`, `to_key`",
    [villageId],
  );
  return rows.map((r) => ({ fromKey: String(r.from_key), toKey: String(r.to_key), kind: r.kind === "part_of" ? "part_of" : "serves" }));
}

/** Queued stage changes per place (S3 writes them; S2 only counts). */
export async function countQueuedStageChanges(pool: Queryable, villageId: string): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `key`, COUNT(*) AS n FROM `place_stage_changes` WHERE `village_id` = ? AND `status` = 'queued' GROUP BY `key`",
    [villageId],
  );
  return new Map(rows.map((r) => [String(r.key), Number(r.n)]));
}

/** Open claims per place (S5 writes them; S2 only counts). */
export async function countOpenClaims(pool: Queryable, villageId: string): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `key`, COUNT(*) AS n FROM `place_steward_claims` WHERE `village_id` = ? AND `status` = 'open' GROUP BY `key`",
    [villageId],
  );
  return new Map(rows.map((r) => [String(r.key), Number(r.n)]));
}

// ── Reads of other modules' tables, by place key ─────────────────────────────

export interface PlaceQuestRow { id: string; title: string; structureKey: string }

/** Open, real quests that sit at a place (0060's `quests.structure_key`). */
export async function listOpenQuestsAtPlaces(pool: Queryable): Promise<PlaceQuestRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `title`, `structure_key` FROM `quests` WHERE `structure_key` IS NOT NULL AND LOWER(TRIM(`status`)) = 'open' AND `is_example` = 0 ORDER BY `sort_order`, `title`",
  );
  return rows.map((r) => ({ id: String(r.id), title: String(r.title), structureKey: String(r.structure_key) }));
}

export interface PlaceEventRow { id: string; title: string; startsAt: string; structureKeys: string[] }

/** Scheduled events starting inside a window, with the places they name (0059). */
export async function listEventsBetween(pool: Queryable, from: Date, to: Date): Promise<PlaceEventRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `title`, `starts_at`, `structure_keys` FROM `events` WHERE `status` = 'scheduled' AND `starts_at` >= ? AND `starts_at` < ? AND `structure_keys` IS NOT NULL ORDER BY `starts_at`",
    [from, to],
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    startsAt: iso(r.starts_at) ?? "",
    structureKeys: json<unknown[]>(r.structure_keys, []).map(String),
  }));
}

/** Photos shown at each place (0093): not removed, not hidden. */
export async function countPhotosByPlace(pool: Queryable, villageId: string): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `structure_key`, COUNT(*) AS n FROM `place_photos` WHERE `village_id` = ? AND `removed_at` IS NULL AND `hidden_at` IS NULL GROUP BY `structure_key`",
    [villageId],
  );
  return new Map(rows.map((r) => [String(r.structure_key), Number(r.n)]));
}

// ── The seed import ──────────────────────────────────────────────────────────

export interface PlaceInsert {
  key: string;
  name: string;
  zone: string | null;
  kind: PlaceKind;
  stage: PlaceStage | null;
  confirmed: boolean;
  disputes: SeedDispute[];
  aliases: string[];
  units: Partial<HomeUnits> | null;
  positionText: string;
  description: string;
  phase: string | null;
  isTemporary: boolean;
  temporarySuccessor: string | null;
  setAsideReason: string | null;
  childSafe: boolean;
  isHome: boolean;
  showcase: boolean;
  stewardRoleId: string | null;
  targetDate: string | null;
}

/**
 * Write a seed in one transaction. Rows that already exist are KEPT as they
 * are, never overwritten: an import adds what is missing and never undoes an
 * edit a holder made after the first one. Returns the keys it added.
 */
export async function insertSeed(
  pool: Pool,
  villageId: string,
  by: string,
  input: {
    zones: ZoneRow[];
    places: PlaceInsert[];
    permits: PermitItem[];
    links: LinkRow[];
  },
): Promise<{ addedPlaces: string[]; addedZones: number; addedPermits: number; addedLinks: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let addedZones = 0;
    for (const z of input.zones) {
      const [r]: any = await conn.query(
        "INSERT IGNORE INTO `place_zones` (`village_id`, `key`, `name`, `sort`, `position_text`) VALUES (?, ?, ?, ?, ?)",
        [villageId, z.key, z.name, z.sort, z.positionText],
      );
      addedZones += Number(r.affectedRows ?? 0);
    }
    const addedPlaces: string[] = [];
    for (const p of input.places) {
      const [r]: any = await conn.query(
        "INSERT IGNORE INTO `places` (`village_id`, `key`, `name`, `zone`, `kind`, `stage`, `readiness_pct`, `confirmed`, " +
          "`disputes`, `aliases`, `units`, `position_text`, `description`, `phase`, `is_temporary`, `temporary_successor`, " +
          "`set_aside_reason`, `retired_at`, `in_preserve`, `in_riparian`, `footprint_m2`, `child_safe`, `hours_window`, " +
          "`is_home`, `showcase`, `steward_role_id`, `steward_hold`, `claim_window_ends_at`, `target_date`, `created_by`) " +
          "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unknown', 'unknown', NULL, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?)",
        [
          villageId, p.key, p.name, p.zone, p.kind, p.stage, p.confirmed ? 1 : 0,
          p.disputes.length ? JSON.stringify(p.disputes) : null,
          p.aliases.length ? JSON.stringify(p.aliases) : null,
          p.units ? JSON.stringify(p.units) : null,
          p.positionText, p.description, p.phase, p.isTemporary ? 1 : 0, p.temporarySuccessor, p.setAsideReason,
          p.childSafe ? 1 : 0, p.isHome ? 1 : 0, p.showcase ? 1 : 0, p.stewardRoleId, p.targetDate, by,
        ],
      );
      if (Number(r.affectedRows ?? 0) > 0) addedPlaces.push(p.key);
    }
    let addedPermits = 0;
    for (const i of input.permits) {
      const [r]: any = await conn.query(
        "INSERT IGNORE INTO `place_permits` (`id`, `village_id`, `key`, `title`, `state`, `reason`, `upload_id`, `waits_on`, `changed_by`) " +
          "VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
        [i.id, villageId, i.place, i.title, i.state, i.waitsOn?.length ? JSON.stringify(i.waitsOn) : null, by],
      );
      addedPermits += Number(r.affectedRows ?? 0);
    }
    let addedLinks = 0;
    for (const l of input.links) {
      const [r]: any = await conn.query(
        "INSERT IGNORE INTO `place_links` (`village_id`, `from_key`, `to_key`, `kind`) VALUES (?, ?, ?, ?)",
        [villageId, l.fromKey, l.toKey, l.kind],
      );
      addedLinks += Number(r.affectedRows ?? 0);
    }
    await conn.commit();
    return { addedPlaces, addedZones, addedPermits, addedLinks };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
