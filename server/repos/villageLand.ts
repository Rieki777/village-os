/**
 * Every statement this platform runs against `village_land`.
 *
 * EVERY, and that is the claim this file exists to keep true. The table used
 * to be read and written from `server/routes/land.ts` directly, which the
 * contribution scan and the raw-SQL burn-down both refuse, and for a reason
 * that is about correctness rather than tidiness: queries live under
 * server/repos so that a table's readers stay enumerable and so that any
 * cache later put in front of it sits above every write. Nothing caches this
 * table today. Keeping the writes here means that when something does, a
 * removed picture cannot go on being served from a cache that a route wrote
 * around.
 *
 * The statements moved here verbatim. What each one means is argued at its
 * call site in the route, which is where the reasoning about privacy, parcels
 * and the order of a removal lives; this file is only where the SQL is.
 *
 * `db` accepts a pool or a single connection, because the route runs on the
 * pool and `land.upsert.e2e.test.ts` drives the same upsert through a test
 * connection. A test that calls the real statement proves the real statement;
 * a test holding its own copy of the SQL proves the copy.
 */
import type { Connection, Pool, RowDataPacket } from "mysql2/promise";

export type Queryable = Pool | Connection;

/** Every parcel row for one village, unordered: `orderParcels` in shared/ owns the order. */
export async function villageLandRows(db: Queryable, villageId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM village_land WHERE village_id = ?", [villageId]);
  return rows;
}

export interface ParcelWrite {
  id: string;
  villageId: string;
  slug: string;
  label: string;
  sortOrder: number;
  centreLat: number;
  centreLon: number;
  spanM: number;
  visibility: string;
  sourceText: string | null;
  sourceFormat: string | null;
  updatedBy: string | null;
}

/**
 * Save one parcel, or update it in place.
 *
 * One statement, settled by the UNIQUE key on (village_id, slug), so two
 * founders saving at once cannot become two rows. `label` is only overwritten
 * when this write carries one: a save of the coordinates alone must not blank
 * the name a founder gave the land.
 */
export async function upsertParcel(db: Queryable, p: ParcelWrite): Promise<void> {
  await db.query(
    `INSERT INTO village_land
       (id, village_id, slug, label, sort_order, centre_lat, centre_lon, span_m, visibility, source_text, source_format, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       label = IF(VALUES(label) = '', label, VALUES(label)),
       sort_order = VALUES(sort_order),
       centre_lat = VALUES(centre_lat),
       centre_lon = VALUES(centre_lon),
       span_m = VALUES(span_m),
       visibility = VALUES(visibility),
       source_text = VALUES(source_text),
       source_format = VALUES(source_format),
       updated_by = VALUES(updated_by)`,
    [
      p.id,
      p.villageId,
      p.slug,
      p.label,
      p.sortOrder,
      p.centreLat,
      p.centreLon,
      p.spanM,
      p.visibility,
      p.sourceText,
      p.sourceFormat,
      p.updatedBy,
    ],
  );
}

/** A picture fetched and kept: its file, its provider, the credit it owes. Clears any earlier error. */
export async function recordParcelImagery(
  db: Queryable,
  villageId: string,
  slug: string,
  img: { provider: string; filename: string; attribution: string },
): Promise<void> {
  await db.query(
    `UPDATE village_land
        SET imagery_provider = ?, imagery_filename = ?, imagery_attribution = ?,
            imagery_fetched_at = CURRENT_TIMESTAMP, imagery_error = NULL
      WHERE village_id = ? AND slug = ?`,
    [img.provider, img.filename, img.attribution, villageId, slug],
  );
}

/**
 * Why the last fetch failed, kept so the screen can say so without paying for
 * another request. Clipped to the column here, beside the column: a strict
 * server refuses an over-long value and the record of the failure would be the
 * thing lost.
 */
export async function recordParcelImageryError(
  db: Queryable,
  villageId: string,
  slug: string,
  message: string,
): Promise<void> {
  await db.query("UPDATE village_land SET imagery_error = ? WHERE village_id = ? AND slug = ?", [
    String(message ?? "").slice(0, 255),
    villageId,
    slug,
  ]);
}

/**
 * Forget a parcel's picture. The caller deletes the file AFTER this returns,
 * so a failure between the two leaves an orphan nothing shows, never a
 * reference to a file that is gone.
 */
export async function clearParcelImagery(db: Queryable, villageId: string, slug: string): Promise<void> {
  await db.query(
    `UPDATE village_land
        SET imagery_provider = NULL, imagery_filename = NULL, imagery_attribution = NULL,
            imagery_fetched_at = NULL, imagery_error = NULL
      WHERE village_id = ? AND slug = ?`,
    [villageId, slug],
  );
}
