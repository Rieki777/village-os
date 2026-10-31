/**
 * Every query the place-photo feature makes (0093).
 *
 * All of it is here because the module contract's clause 13 refuses raw SQL
 * outside `server/repos`, and because one file holding every read of a table
 * is the only way the retention sweep and the serving guard can be shown to
 * agree about which files are live.
 *
 * camelCase at the interface, snake_case in the table, the same shape
 * `server/repos/gratitude.ts` uses.
 */
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type { PlacePhoto, PlacePhotoReport, ReportKind, ReportStatus } from "../../shared/placePhotos";

const toIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : new Date(String(v)).toISOString();

const toIsoOrNull = (v: unknown): string | null => (v == null ? null : toIso(v));

/** A DATE column comes back as a Date at UTC midnight, or as a string. */
const toDateOnly = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * The columns every read selects, and the join that resolves a contributor's
 * name. LEFT JOIN on purpose: an account that has been anonymised leaves the
 * photograph standing, and the surface falls back to a role.
 */
const PHOTO_COLUMNS =
  "p.id, p.structure_key, p.url, p.thumb_url, p.alt_text, p.caption, p.taken_on, " +
  "p.width, p.height, p.bytes, p.contributor_id, u.name AS contributor_name, " +
  "p.hero_at, p.hidden_at, p.hidden_by, p.hidden_reason, p.removed_at, p.created_at";

function rowToPhoto(r: any): PlacePhoto {
  return {
    id: String(r.id),
    structureKey: String(r.structure_key),
    url: String(r.url),
    thumbUrl: r.thumb_url ? String(r.thumb_url) : null,
    altText: String(r.alt_text ?? ""),
    caption: r.caption ? String(r.caption) : null,
    takenOn: toDateOnly(r.taken_on),
    width: num(r.width),
    height: num(r.height),
    bytes: num(r.bytes),
    contributorId: String(r.contributor_id),
    contributorName: r.contributor_name ? String(r.contributor_name) : "a member",
    heroAt: toIsoOrNull(r.hero_at),
    hiddenAt: toIsoOrNull(r.hidden_at),
    hiddenBy: r.hidden_by ? String(r.hidden_by) : null,
    hiddenReason: r.hidden_reason ? String(r.hidden_reason) : null,
    createdAt: toIso(r.created_at),
  };
}

export interface NewPlacePhoto {
  id: string;
  villageId: string;
  structureKey: string;
  url: string;
  thumbUrl: string | null;
  altText: string;
  caption: string | null;
  takenOn: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  contributorId: string;
}

/** One place's photographs. Removed rows never come back from here. */
export async function photosForPlace(
  pool: Pool,
  villageId: string,
  structureKey: string,
  opts: { includeHidden?: boolean } = {},
): Promise<PlacePhoto[]> {
  const hidden = opts.includeHidden ? "" : " AND p.hidden_at IS NULL";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${PHOTO_COLUMNS} FROM place_photos p LEFT JOIN users u ON u.id = p.contributor_id ` +
      `WHERE p.village_id = ? AND p.structure_key = ? AND p.removed_at IS NULL${hidden} ` +
      "ORDER BY p.created_at DESC, p.id ASC LIMIT 500",
    [villageId, structureKey],
  );
  return rows.map(rowToPhoto);
}

/** One photograph, whatever state it is in. The moderation paths need tombstones. */
export async function photoById(pool: Pool, id: string): Promise<(PlacePhoto & { removedAt: string | null; villageId: string }) | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${PHOTO_COLUMNS}, p.village_id FROM place_photos p LEFT JOIN users u ON u.id = p.contributor_id WHERE p.id = ?`,
    [id],
  );
  if (!rows[0]) return null;
  return { ...rowToPhoto(rows[0]), removedAt: toIsoOrNull(rows[0].removed_at), villageId: String(rows[0].village_id) };
}

export interface PlaceSummary {
  structureKey: string;
  photoCount: number;
  /** The place's lead picture, chosen by the same rule the gallery uses. */
  coverUrl: string | null;
  coverThumbUrl: string | null;
  coverAltText: string | null;
  latestAt: string;
}

/**
 * Every place that has at least one live photograph, newest activity first.
 *
 * The cover is picked in SQL by the gallery's own rule (a pinned hero beats
 * everything, then newest, then id) so the list page and the place page never
 * lead with different pictures.
 */
export async function placesWithPhotos(pool: Pool, villageId: string): Promise<PlaceSummary[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT p.structure_key, COUNT(*) AS n, MAX(p.created_at) AS latest_at FROM place_photos p " +
      "WHERE p.village_id = ? AND p.removed_at IS NULL AND p.hidden_at IS NULL " +
      "GROUP BY p.structure_key ORDER BY latest_at DESC LIMIT 200",
    [villageId],
  );
  const out: PlaceSummary[] = [];
  for (const r of rows) {
    const [cover] = await pool.query<RowDataPacket[]>(
      "SELECT url, thumb_url, alt_text FROM place_photos " +
        "WHERE village_id = ? AND structure_key = ? AND removed_at IS NULL AND hidden_at IS NULL " +
        "ORDER BY (hero_at IS NULL) ASC, hero_at DESC, created_at DESC, id ASC LIMIT 1",
      [villageId, String(r.structure_key)],
    );
    out.push({
      structureKey: String(r.structure_key),
      photoCount: Number(r.n),
      coverUrl: cover[0] ? String(cover[0].url) : null,
      coverThumbUrl: cover[0] && cover[0].thumb_url ? String(cover[0].thumb_url) : null,
      coverAltText: cover[0] ? String(cover[0].alt_text) : null,
      latestAt: toIso(r.latest_at),
    });
  }
  return out;
}

/**
 * How many photographs one press of the whole-village index asks for.
 *
 * Sixty is twenty rows of a three-across grid, and everything below the fold
 * waits for a scroll before it fetches any bytes, so a bigger page costs a
 * reader nothing until they reach it. A village at the per-place ceiling of
 * 500 across a handful of places is a few thousand pictures, which is sixteen
 * presses of "Show older". That is the honest number, and the way to shorten
 * it later is to narrow by date, which is a fact the page already prints under
 * every picture. Narrowing by who is in a photograph is the thing this whole
 * surface exists instead of.
 */
export const INDEX_PAGE_SIZE = 60;

/** Where a page of the index stopped, so the next one can start there. */
export interface PhotoCursor {
  at: Date;
  id: string;
}

export interface PhotoPage {
  photos: PlacePhoto[];
  /** The cursor for the next press, or null when there is nothing older. */
  nextBefore: string | null;
}

/** The wire form of a cursor: the row's own timestamp and id, joined. */
export function photoCursor(photo: Pick<PlacePhoto, "createdAt" | "id">): string {
  return `${photo.createdAt}|${photo.id}`;
}

/**
 * A cursor off the wire, or null when it is not one.
 *
 * Null means REFUSE, and the route answers 400. Reading a broken cursor as
 * "start from the top" would hand somebody scrolling for a picture of
 * themselves the newest page again while looking like the older one, and they
 * would have no way to tell.
 */
export function parsePhotoCursor(raw: unknown): PhotoCursor | null {
  if (typeof raw !== "string" || !raw) return null;
  const bar = raw.lastIndexOf("|");
  if (bar <= 0 || bar === raw.length - 1) return null;
  const at = new Date(raw.slice(0, bar));
  if (Number.isNaN(at.getTime())) return null;
  return { at, id: raw.slice(bar + 1) };
}

/**
 * Every photograph in the village, newest first, across every place.
 *
 * ── WHY THIS IS FLAT AND NOT `orderPhotos` ───────────────────────────────
 *
 * A place leads with its hero, because a hero answers "what is this place".
 * Across every place there is no such question to answer, and hero-first would
 * float every pinned picture to the top of a page that says it is newest
 * first. So the order here is `created_at DESC` with the id breaking ties, and
 * it is total for the same reason the gallery's is: a page that reshuffles
 * under a person's thumb reads as broken.
 *
 * ── WHY A CURSOR AND NOT AN OFFSET ───────────────────────────────────────
 *
 * OFFSET counts rows at read time, so a photograph coming down between two
 * presses shifts everything after it up by one and the next page skips a row.
 * On the one page whose whole purpose is somebody finding a picture of
 * themselves, a skipped row is the failure. A keyset cursor names the exact
 * row the last page ended on, so nothing between the two presses can move it.
 *
 * `includeHidden` carries the SAME rule `photosForPlace` carries and is passed
 * the same value: a hidden row reaches a curator and nobody else. An index
 * that aggregated past that would show a member here what its own sources
 * refuse them.
 */
export async function photosAcrossPlaces(
  pool: Pool,
  villageId: string,
  opts: { includeHidden?: boolean; before?: PhotoCursor | null; limit?: number } = {},
): Promise<PhotoPage> {
  // Clamped at both ends, and the ceiling matters more than the floor. No
  // caller passes `limit` today and the route does not forward one from the
  // query string, so this is not guarding a live path. It guards the next
  // hand: wiring `req.query.limit` through without a ceiling is a one-line
  // change that would let a caller ask for the whole table in one read.
  const limit = Math.min(INDEX_PAGE_SIZE, Math.max(1, opts.limit ?? INDEX_PAGE_SIZE));
  const hidden = opts.includeHidden ? "" : " AND p.hidden_at IS NULL";
  const params: unknown[] = [villageId];
  let keyset = "";
  if (opts.before) {
    keyset = " AND (p.created_at < ? OR (p.created_at = ? AND p.id > ?))";
    params.push(opts.before.at, opts.before.at, opts.before.id);
  }
  // One more than the page, which is how the end is KNOWN rather than
  // guessed. A short page is not proof of the end when a row was hidden
  // between the count and the read.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${PHOTO_COLUMNS} FROM place_photos p LEFT JOIN users u ON u.id = p.contributor_id ` +
      `WHERE p.village_id = ? AND p.removed_at IS NULL${hidden}${keyset} ` +
      "ORDER BY p.created_at DESC, p.id ASC LIMIT ?",
    [...params, limit + 1],
  );
  const photos = rows.slice(0, limit).map(rowToPhoto);
  const more = rows.length > limit;
  const last = photos[photos.length - 1];
  return { photos, nextBefore: more && last ? photoCursor(last) : null };
}

/**
 * A few photographs for every place at once, for the living map's own panel.
 *
 * ONE query and not one per place: the map opens with every structure on
 * screen and asks for the lot, so a query per place would be forty round
 * trips before the first tab is opened. Ordered by the gallery's own rule
 * (a pinned hero, then newest) and capped in memory, because MySQL has no
 * per-group limit worth writing here and the whole set is small.
 */
export async function photosByPlace(
  pool: Pool,
  villageId: string,
  perPlace: number,
): Promise<Record<string, { url: string; thumbUrl: string | null; alt: string; caption: string | null; by: string }[]>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT p.structure_key, p.url, p.thumb_url, p.alt_text, p.caption, p.taken_on, p.created_at, " +
      "u.name AS contributor_name FROM place_photos p LEFT JOIN users u ON u.id = p.contributor_id " +
      "WHERE p.village_id = ? AND p.removed_at IS NULL AND p.hidden_at IS NULL " +
      "ORDER BY p.structure_key ASC, (p.hero_at IS NULL) ASC, p.hero_at DESC, p.created_at DESC, p.id ASC LIMIT 2000",
    [villageId],
  );
  const out: Record<string, { url: string; thumbUrl: string | null; alt: string; caption: string | null; by: string }[]> = {};
  for (const r of rows) {
    const key = String(r.structure_key);
    const bucket = (out[key] ??= []);
    if (bucket.length >= perPlace) continue;
    bucket.push({
      url: String(r.url),
      thumbUrl: r.thumb_url ? String(r.thumb_url) : null,
      alt: String(r.alt_text ?? ""),
      caption: r.caption ? String(r.caption) : null,
      by: attribution(r),
    });
  }
  return out;
}

/** The attribution line, built where the row is read so the map gets it whole. */
function attribution(r: any): string {
  const who = (r.contributor_name ? String(r.contributor_name) : "").trim() || "a member";
  const taken = toDateOnly(r.taken_on);
  const when = taken ?? toIso(r.created_at);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(when) ? `${when}T00:00:00Z` : when);
  if (Number.isNaN(d.getTime())) return `Photo by ${who}`;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `Photo by ${who}, ${taken ? "taken" : "added"} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export async function countForPlace(pool: Pool, villageId: string, structureKey: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM place_photos WHERE village_id = ? AND structure_key = ? AND removed_at IS NULL",
    [villageId, structureKey],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * What one member has added in the last 24 hours, across every place.
 *
 * Counts removed rows too. A member who posts twelve pictures and takes six
 * down has still spent twelve of the village's day, and not counting them
 * would make the dial a suggestion.
 */
export async function countByContributorSince(pool: Pool, contributorId: string, hours: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM place_photos WHERE contributor_id = ? AND created_at >= (NOW(3) - INTERVAL ? HOUR)",
    [contributorId, hours],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function insertPhoto(pool: Pool, row: NewPlacePhoto): Promise<void> {
  await pool.query(
    "INSERT INTO place_photos (id, village_id, structure_key, url, thumb_url, alt_text, caption, taken_on, width, height, bytes, contributor_id) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      row.id, row.villageId, row.structureKey, row.url, row.thumbUrl, row.altText,
      row.caption, row.takenOn, row.width, row.height, row.bytes, row.contributorId,
    ],
  );
}

/**
 * Pin one photograph as the place's lead shot, unpinning whatever held it.
 *
 * Two statements and no transaction on purpose: the worst interleaving leaves
 * a place with no hero for a moment, and a place with no hero simply leads
 * with its newest. Nothing here can produce two heroes, because the clear runs
 * first and covers every row in the place.
 */
export async function setHero(pool: Pool, villageId: string, structureKey: string, photoId: string | null): Promise<void> {
  await pool.query(
    "UPDATE place_photos SET hero_at = NULL WHERE village_id = ? AND structure_key = ? AND hero_at IS NOT NULL",
    [villageId, structureKey],
  );
  if (photoId) {
    await pool.query(
      "UPDATE place_photos SET hero_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND removed_at IS NULL AND hidden_at IS NULL",
      [photoId],
    );
  }
}

/**
 * Reversible. Returns false when the row was already hidden or is gone.
 *
 * ── WHY THIS ONE WITHHOLDS THE WORDS AND DOES NOT ERASE THEM ─────────────
 *
 * Hiding is the state a photograph sits in while somebody decides. The row
 * stops reaching every reader who is not a curator, description included,
 * because the whole row stops reaching them: `photosForPlace` and
 * `photosAcrossPlaces` both take `includeHidden` and both are passed the same
 * curate answer. So the words are already withheld from everyone the takedown
 * was for.
 *
 * Erasing them here as well would destroy a description on an action a curator
 * is expected to reverse. A photograph put back with an empty `alt_text` is a
 * picture a member who cannot see it is told nothing about, which is the exact
 * failure the required column in 0093 was added to end. The community
 * threshold reaches this same function, so a mistaken pile-on would spend a
 * real description to say nothing.
 *
 * A curator keeps both the picture and the words while the decision is still
 * theirs to make, and loses both the moment it is made: `removePhoto` erases.
 * The window is exactly as wide as the decision.
 */
export async function hidePhoto(pool: Pool, id: string, by: string, reason: string | null): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE place_photos SET hidden_at = CURRENT_TIMESTAMP(3), hidden_by = ?, hidden_reason = ?, hero_at = NULL " +
      "WHERE id = ? AND hidden_at IS NULL AND removed_at IS NULL",
    [by, reason, id],
  );
  return r.affectedRows > 0;
}

export async function restorePhoto(pool: Pool, id: string): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE place_photos SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL " +
      "WHERE id = ? AND hidden_at IS NOT NULL AND removed_at IS NULL",
    [id],
  );
  return r.affectedRows > 0;
}

/**
 * Irreversible. The caller unlinks the file; the row stays as a tombstone.
 *
 * ── THE WORDS COME DOWN WITH THE PICTURE ─────────────────────────────────
 *
 * A description of a photograph is still a description of the person in it.
 * A takedown that unlinks the file and leaves "Rye and two neighbours planting
 * the north terrace" on the row has removed the picture and kept the sentence
 * about the people, which is not what anybody asking for a takedown meant.
 *
 * So the description is ERASED here, in the same statement that sets
 * `removed_at`, and erasing is the honest choice on this path precisely
 * because this path is the one that cannot be undone. `hidePhoto` is the
 * reversible sibling and does NOT erase, for the reason written over it.
 *
 * What stays, and why each one has to: the id, because a resolved report names
 * it; the url, because the retention sweep unlinks the file by that address;
 * `contributor_id` and the timestamps, because they say a takedown happened
 * rather than that a photograph never existed. None of those is a sentence
 * about a person in a picture.
 *
 * `alt_text` is NOT NULL, so the erased value is the empty string. Nothing
 * renders it: every gallery read filters `removed_at IS NULL`, and the one
 * surface that reads a removed row, the curator's queue, nulls the field.
 */
export async function removePhoto(pool: Pool, id: string, by: string): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE place_photos SET removed_at = CURRENT_TIMESTAMP(3), removed_by = ?, hero_at = NULL, " +
      "alt_text = '', caption = NULL WHERE id = ? AND removed_at IS NULL",
    [by, id],
  );
  return r.affectedRows > 0;
}

/**
 * Filenames that must not be served: hidden, or removed and still on disk.
 *
 * Hiding a row stops it appearing in a gallery and does nothing at all to the
 * bytes, which anyone holding the address can still fetch. For a photograph
 * somebody has asked to have taken down, that gap is the whole failure. The
 * uploads route reads this set, so a hidden picture is unreachable by URL as
 * well as absent from the page.
 */
export async function suppressedFilenames(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT url, thumb_url FROM place_photos WHERE hidden_at IS NOT NULL OR removed_at IS NOT NULL",
  );
  const out: string[] = [];
  for (const r of rows) {
    for (const v of [r.url, r.thumb_url]) {
      const s = v == null ? "" : String(v);
      if (s) out.push(s.slice(s.lastIndexOf("/") + 1));
    }
  }
  return out;
}

/** Tombstones the sweep may forget, with the files they still name. */
export async function tombstonesOlderThan(pool: Pool, days: number): Promise<{ id: string; url: string; thumbUrl: string | null }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, url, thumb_url FROM place_photos WHERE removed_at IS NOT NULL AND removed_at < (NOW(3) - INTERVAL ? DAY) LIMIT 500",
    [days],
  );
  return rows.map((r) => ({ id: String(r.id), url: String(r.url), thumbUrl: r.thumb_url ? String(r.thumb_url) : null }));
}

/**
 * Every file a photograph that is NOT removed still points at.
 *
 * The sweep asks this before unlinking anything. Two rows can never share a
 * file (the unique key on url says so), and this is the belt: a file a live
 * row names is never deleted because a tombstone also named it.
 */
export async function liveFilenames(pool: Pool): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT url, thumb_url FROM place_photos WHERE removed_at IS NULL");
  const out = new Set<string>();
  for (const r of rows) {
    for (const v of [r.url, r.thumb_url]) {
      const s = v == null ? "" : String(v);
      if (s) out.add(s.slice(s.lastIndexOf("/") + 1));
    }
  }
  return out;
}

export async function deletePhotoRows(pool: Pool, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const marks = ids.map(() => "?").join(",");
  await pool.query(`DELETE FROM place_photo_reports WHERE photo_id IN (${marks})`, [...ids]);
  const [r] = await pool.query<ResultSetHeader>(`DELETE FROM place_photos WHERE id IN (${marks})`, [...ids]);
  return r.affectedRows;
}

// ── Reports ────────────────────────────────────────────────────────────────

export async function insertReport(
  pool: Pool,
  row: { id: string; villageId: string; photoId: string; reporterId: string; kind: ReportKind; reason: string | null },
): Promise<void> {
  await pool.query(
    "INSERT INTO place_photo_reports (id, village_id, photo_id, reporter_id, kind, reason) VALUES (?,?,?,?,?,?)",
    [row.id, row.villageId, row.photoId, row.reporterId, row.kind, row.reason],
  );
}

/**
 * The erasure sweep's "photo-report-reasons-after-tombstone": the words a
 * member who has left typed on their reports go, and the reports stay.
 *
 * The curators' queue (`listReports`) serves `reason` to every holder of
 * `map.curatePhotos`, which a role or a badge can grant, and a subject request
 * is often the person's own name. The row keeps its kind, status, photo and
 * resolver, because the unique key, the concern count and the queue's
 * decision all rest on it, and the photograph is left exactly as it is: a
 * subject request keeps the picture dark after the person who made it has
 * gone. Reads only by the reporter's id, so a resume may run it again.
 */
export async function forgetReportReasonsOf(pool: Pool, reporterId: string): Promise<number> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE place_photo_reports SET reason = NULL WHERE reporter_id = ? AND reason IS NOT NULL",
    [reporterId],
  );
  return r.affectedRows;
}

/** Distinct members who have an open concern on one photograph. */
export async function openConcernReporters(pool: Pool, photoId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(DISTINCT reporter_id) AS n FROM place_photo_reports WHERE photo_id = ? AND kind = 'concern' AND status = 'open'",
    [photoId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * The curator's queue, joined into something a person can act on.
 *
 * Opaque identifiers are what kept the forum's queue unbuilt for a release:
 * the picture, what it shows, whether it is already dark and who raised it are
 * the fields that turn a row into a decision.
 */
export async function listReports(pool: Pool, status: ReportStatus): Promise<PlacePhotoReport[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT r.id, r.photo_id, r.kind, r.reason, r.status, r.created_at, r.resolved_at, " +
      "ru.name AS resolved_by_name, u.name AS reporter_name, " +
      "p.structure_key, p.url, p.alt_text, p.hidden_at, p.removed_at " +
      "FROM place_photo_reports r " +
      "LEFT JOIN place_photos p ON p.id = r.photo_id " +
      "LEFT JOIN users u ON u.id = r.reporter_id " +
      "LEFT JOIN users ru ON ru.id = r.resolved_by " +
      "WHERE r.status = ? ORDER BY r.created_at ASC LIMIT 200",
    [status],
  );
  return rows.map((r) => ({
    id: String(r.id),
    photoId: String(r.photo_id),
    structureKey: r.structure_key ? String(r.structure_key) : "",
    photoUrl: r.removed_at || !r.url ? null : String(r.url),
    // Nulled on a takedown for the same reason the picture is. `removePhoto`
    // has already erased the column; this says so at the surface as well, so
    // the rule is readable here and does not rest on '' being falsy.
    photoAltText: r.removed_at || !r.alt_text ? null : String(r.alt_text),
    photoRemoved: !!r.removed_at,
    photoHidden: !!r.hidden_at,
    kind: (String(r.kind) === "subject" ? "subject" : "concern") as ReportKind,
    reason: r.reason ? String(r.reason) : null,
    status: String(r.status) as ReportStatus,
    reporter: r.reporter_name ? String(r.reporter_name) : "a member",
    at: toIso(r.created_at),
    resolvedBy: r.resolved_at ? (r.resolved_by_name ? String(r.resolved_by_name) : "a curator") : null,
    resolvedAt: toIsoOrNull(r.resolved_at),
  }));
}

export async function reporterOf(pool: Pool, reportId: string): Promise<{ reporterId: string; photoId: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT reporter_id, photo_id FROM place_photo_reports WHERE id = ?",
    [reportId],
  );
  if (!rows[0]) return null;
  return { reporterId: String(rows[0].reporter_id), photoId: String(rows[0].photo_id) };
}

export async function closeReport(pool: Pool, id: string, status: "resolved" | "dismissed", by: string | null): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE place_photo_reports SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'open'",
    [status, by, id],
  );
  return r.affectedRows > 0;
}

/** Close every open report on one photograph. A takedown answers all of them. */
export async function closeReportsForPhoto(pool: Pool, photoId: string, by: string | null): Promise<string[]> {
  const [open] = await pool.query<RowDataPacket[]>(
    "SELECT reporter_id FROM place_photo_reports WHERE photo_id = ? AND status = 'open'",
    [photoId],
  );
  await pool.query(
    "UPDATE place_photo_reports SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP(3) WHERE photo_id = ? AND status = 'open'",
    [by, photoId],
  );
  return open.map((r) => String(r.reporter_id));
}

/** How many reports are waiting. The count a curator's door shows. */
export async function openReportCount(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM place_photo_reports WHERE status = 'open'",
  );
  return Number(rows[0]?.n ?? 0);
}
