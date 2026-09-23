/**
 * Where the village is: the founder's answer, and the picture that comes back.
 *
 * Four routes, following server/routes/faqs.ts's shape exactly: `register`
 * is the only export that touches Express, and `deps` is a slice of AppDeps
 * naming everything these routes can reach.
 *
 *   GET  /api/land                 what a visitor may know, and no more
 *   GET  /api/admin/land           the whole record, plus what is configured
 *   PUT  /api/admin/land           set the centre, the span, the visibility
 *   POST /api/admin/land/imagery   fetch the picture and keep it
 *
 * ── THE PUBLIC ROUTE IS THE PRIVACY BOUNDARY ─────────────────────────────
 *
 * `GET /api/land` is fetched by an uncredentialed browser. A village is a
 * place people sleep, and this codebase already re-encodes every uploaded
 * photograph to strip its GPS (server/lib/uploads.ts), so publishing the
 * village centre by default would undo that on the first deploy. The rule is
 * `publicPoint` in shared/land.ts and it is applied exactly once, here, in
 * the route that answers strangers. No other surface decides what
 * "approximate" means. That is the housing module's lesson copied on purpose:
 * three readers each deriving the same predicate is three chances to leak,
 * and one function plus a presence test cannot drift.
 *
 * ── UNSET IS NOT ZERO, AND THE CODE MAY NOT GUESS ────────────────────────
 *
 * Latitude 0, longitude 0 is a real point in the Gulf of Guinea. Every test
 * for "has this village said where it is" in this file is `=== null` against
 * a column that is NULL when unset. There is no `if (!lat)` anywhere here and
 * there must never be one: it would read a village on the equator as a
 * village that had said nothing, and the two need different answers.
 *
 * ── DECIMAL COMES BACK AS A STRING ───────────────────────────────────────
 *
 * mysql2 hands DECIMAL columns over as strings, deliberately, so that a
 * value's precision survives the trip. `readRow` converts once, in one place.
 * Scattering `Number(row.centre_lat)` through the handlers would work until
 * the one call site that forgot, which would then compare a string to a
 * number and quietly answer false.
 */
import type { Express } from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppDeps } from "../lib/appDeps";
import {
  DEFAULT_PARCEL_SLUG,
  DEFAULT_SPAN_M,
  MAX_PARCEL_LABEL,
  isLandVisibility,
  isParcelSlug,
  isSeedFrame,
  orderParcels,
  parseCoordinates,
  publicPoint,
  validateSpan,
  type LandVisibility,
  type LatLon,
} from "../../shared/land";
import {
  LicenceForbidsCaching,
  NotAnImage,
  PROVIDERS,
  configuredProvider,
  fetchAndCache,
} from "../lib/satellite";
import {
  clearParcelImagery,
  recordParcelImagery,
  recordParcelImageryError,
  upsertParcel,
  villageLandRows,
} from "../repos/villageLand";

type Deps = Pick<
  AppDeps,
  "isAdmin" | "authedUser" | "guardCapability" | "getPool" | "uploadsDir"
>;

/** This deployment is one village; the column exists for the retrofit (0069). */
const VILLAGE = "local";

/** How many pixels wide to ask a provider for. */
const IMAGE_PIXELS = 1024;

interface LandRow {
  /* The parcel's identity. Every row an older release wrote is 'home'. */
  slug: string;
  label: string;
  sortOrder: number;
  createdAt: string | null;
  centre: LatLon | null;
  spanM: number | null;
  visibility: LandVisibility;
  sourceText: string | null;
  sourceFormat: string | null;
  imageryProvider: string | null;
  imageryFilename: string | null;
  imageryAttribution: string | null;
  imageryFetchedAt: string | null;
  imageryError: string | null;
}

const EMPTY: LandRow = {
  slug: DEFAULT_PARCEL_SLUG,
  label: "",
  sortOrder: 0,
  createdAt: null,
  centre: null,
  spanM: null,
  visibility: "hidden",
  sourceText: null,
  sourceFormat: null,
  imageryProvider: null,
  imageryFilename: null,
  imageryAttribution: null,
  imageryFetchedAt: null,
  imageryError: null,
};

/**
 * Read the one row, converting the decimals exactly once.
 *
 * A row that exists with NULL coordinates is a real state: a founder can set
 * the visibility or have a failed imagery attempt recorded before they have
 * pasted a location. So "no row" and "a row with no point" both come back
 * with `centre: null`, and neither is an error.
 */
async function readRow(pool: Pool, slug?: string): Promise<LandRow> {
  const all = await readParcels(pool);
  if (!all.length) return EMPTY;
  if (slug === undefined) return all[0];
  return all.find((p) => p.slug === slug) ?? EMPTY;
}

/**
 * Every parcel this project holds, in the order a reader meets them.
 *
 * ONE QUERY, ordered in shared code rather than in SQL. `orderParcels` is the
 * same function the browser uses to draw the jump control, so the parcel the
 * map opens and the parcel the screen calls first are the same row by
 * construction. Two orderings that must agree forever is how the first one
 * drifts.
 */
async function readParcels(pool: Pool): Promise<LandRow[]> {
  return orderParcels((await villageLandRows(pool, VILLAGE)).map(mapRow));
}

function mapRow(row: RowDataPacket): LandRow {
  const lat = row.centre_lat;
  const lon = row.centre_lon;
  const hasPoint = lat !== null && lat !== undefined && lon !== null && lon !== undefined;
  return {
    slug: typeof row.slug === "string" && row.slug ? row.slug : DEFAULT_PARCEL_SLUG,
    label: typeof row.label === "string" ? row.label : "",
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at ? String(row.created_at) : null,
    centre: hasPoint ? { lat: Number(lat), lon: Number(lon) } : null,
    spanM: row.span_m === null || row.span_m === undefined ? null : Number(row.span_m),
    visibility: isLandVisibility(row.visibility) ? row.visibility : "hidden",
    sourceText: row.source_text ?? null,
    sourceFormat: row.source_format ?? null,
    imageryProvider: row.imagery_provider ?? null,
    imageryFilename: row.imagery_filename ?? null,
    imageryAttribution: row.imagery_attribution ?? null,
    imageryFetchedAt: row.imagery_fetched_at ? String(row.imagery_fetched_at) : null,
    imageryError: row.imagery_error ?? null,
  };
}

/**
 * Take one kept picture off the uploads volume.
 *
 * The same discipline as server/lib/erasure.ts: a name that could climb out of
 * the uploads directory is refused, because it is not a file this route wrote,
 * and a file that is already gone counts as removed. It never throws. By the
 * time it runs the database has stopped pointing at the file, so the picture
 * is no longer shown whatever happens here, and a file it could not delete is
 * an orphan that /health's orphan count already reports.
 */
function removeFromVolume(uploadsDir: string, fileName: string): boolean {
  const name = String(fileName ?? "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  try {
    fs.unlinkSync(path.join(uploadsDir, name));
    return true;
  } catch (err: any) {
    return err?.code === "ENOENT";
  }
}

/** The address the browser loads the kept picture from, or null when there is none. */
const imageryUrl = (row: LandRow): string | null =>
  row.imageryFilename ? `/api/uploads/${row.imageryFilename}` : null;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, guardCapability, getPool, uploadsDir } = deps;

  /**
   * What a visitor may know.
   *
   * `configured` is the honest empty state the Living Map reads. A village
   * that has never set its coordinates answers `configured: false` with a
   * null point and a null image, which is a fact the map can render as "this
   * village has not placed itself yet". It is never a broken image and never
   * a wrong village's land.
   *
   * The imagery is served even at visibility "hidden". A photograph framed on
   * a village at a span the founder chose is a picture of some trees; the
   * coordinates are the sensitive fact, and they are what "hidden" withholds.
   * A founder who wants the picture private as well removes it, which is a
   * different act with a different button.
   */
  app.get("/api/land", async (_req, res) => {
    const all = await readParcels(getPool());
    const row = all[0] ?? EMPTY;
    const point = publicPoint(row.centre, row.visibility);
    res.json({
      /*
       * The top-level fields are the FIRST parcel and they keep the shape
       * they had. The Living Map shell reads them, and a shell deployed
       * before parcels existed must keep working against a server that has
       * them: the parcel list is additive and an older reader ignores it.
       */
      configured: row.centre !== null,
      visibility: row.visibility,
      centre: point,
      spanM: row.spanM,
      imageryUrl: imageryUrl(row),
      attribution: row.imageryAttribution ?? "",
      /*
       * WHETHER THIS PICTURE SHOWS THE SEED'S OWN RECTANGLE, as one yes-or-no.
       *
       * The map needs this to know whether the seed's surround, place names
       * and caption still describe the ground under them. It cannot work it
       * out itself: that takes the centre, and at "hidden" the centre is the
       * one thing this route withholds. So the comparison happens here, and
       * only its answer crosses the wire. `spanM` crosses too, because the map
       * needs the scale, and a width on its own names no place.
       */
      seedFrame: isSeedFrame(row.centre, row.spanM),
      /*
       * Every parcel, each with its OWN ground. Each is its own map: they are
       * not offered as one picture, because two pieces of land in different
       * places share no coordinate space and joining them would draw ground
       * that is not there.
       *
       * `publicPoint` is applied per parcel, so "hidden" hides every parcel's
       * coordinates and not just the first one's.
       */
      parcels: all.map((p) => ({
        slug: p.slug,
        label: p.label,
        configured: p.centre !== null,
        centre: publicPoint(p.centre, p.visibility),
        spanM: p.spanM,
        imageryUrl: imageryUrl(p),
        attribution: p.imageryAttribution ?? "",
        seedFrame: isSeedFrame(p.centre, p.spanM),
      })),
    });
  });

  app.get("/api/admin/land", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const all = await readParcels(getPool());
    const row = all[0] ?? EMPTY;
    const status = configuredProvider();
    res.json({
      /* Every parcel, in the order the map opens them. */
      parcels: all.map((p) => ({
        slug: p.slug,
        label: p.label,
        sortOrder: p.sortOrder,
        centre: p.centre,
        spanM: p.spanM ?? DEFAULT_SPAN_M,
        visibility: p.visibility,
        sourceText: p.sourceText,
        seedFrame: isSeedFrame(p.centre, p.spanM),
        imagery: {
          provider: p.imageryProvider,
          url: imageryUrl(p),
          attribution: p.imageryAttribution ?? "",
          fetchedAt: p.imageryFetchedAt,
          error: p.imageryError,
        },
      })),
      land: {
        centre: row.centre,
        spanM: row.spanM ?? DEFAULT_SPAN_M,
        visibility: row.visibility,
        sourceText: row.sourceText,
        sourceFormat: row.sourceFormat,
      },
      imagery: {
        provider: row.imageryProvider,
        url: imageryUrl(row),
        attribution: row.imageryAttribution ?? "",
        fetchedAt: row.imageryFetchedAt,
        error: row.imageryError,
      },
      /*
       * What this deployment can actually do, so the screen can say so before
       * the founder presses anything. A village with no provider configured
       * is told that in words, and the button that would fail is not offered.
       */
      configured: {
        providerId: status.provider?.id ?? null,
        providerLabel: status.provider?.label ?? null,
        ready: status.ready,
        missingEnv: status.missingEnv,
        caching: status.provider?.caching ?? null,
        licenceNote: status.provider?.licenceNote ?? null,
      },
      /* The catalogue, so the screen can explain the choice honestly. */
      providers: PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        caching: p.caching,
        groundResolutionM: p.groundResolutionM,
        keyEnv: p.keyEnv,
        licenceNote: p.licenceNote,
      })),
    });
  });

  /**
   * Set where the village is.
   *
   * Takes either `text` (whatever the founder pasted) or an explicit `lat` and
   * `lon` pair. The text path re-runs the SAME parser the browser ran, because
   * a value validated only in a browser is a value not validated: the browser
   * copy exists to give the founder an answer as they type, and this call is
   * the one that decides.
   *
   * A SUSPECTED TRANSPOSITION IS REFUSED HERE unless the caller says it meant
   * it. The screen shows the warning and the other reading; sending
   * `confirmSwapped: true` is the founder having looked at both and chosen.
   * Refusing by default is what stops a village landing in Antarctica because
   * nobody read the amber text.
   */
  app.put("/api/admin/land", async (req, res) => {
    if (!(await guardCapability(req, res, "map.publish"))) return;
    const body = (req.body ?? {}) as Record<string, unknown>;

    let centre: LatLon | null = null;
    let format: string | null = null;
    let sourceText: string | null = null;

    if (typeof body.text === "string" && body.text.trim()) {
      const parsed = parseCoordinates(body.text);
      if (!parsed.ok) {
        return res.status(400).json({
          error: parsed.problem,
          message: parsed.message,
          suggestion: parsed.suggestion ?? null,
        });
      }
      if (parsed.swap !== "none" && body.confirmSwapped !== true) {
        return res.status(400).json({
          error: "swap-suspected",
          message:
            "Those two numbers look like they arrived the other way round. Check which is the latitude, then save again to confirm.",
          given: { lat: parsed.lat, lon: parsed.lon },
          suggestion: parsed.swapped,
        });
      }
      centre = { lat: parsed.lat, lon: parsed.lon };
      format = parsed.format;
      sourceText = body.text.trim().slice(0, 500);
    } else if (body.lat !== undefined && body.lon !== undefined) {
      const parsed = parseCoordinates(`${body.lat}, ${body.lon}`);
      if (!parsed.ok) {
        return res.status(400).json({
          error: parsed.problem,
          message: parsed.message,
          suggestion: parsed.suggestion ?? null,
        });
      }
      if (parsed.swap !== "none" && body.confirmSwapped !== true) {
        return res.status(400).json({
          error: "swap-suspected",
          message:
            "Those two numbers look like they arrived the other way round. Check which is the latitude, then save again to confirm.",
          given: { lat: parsed.lat, lon: parsed.lon },
          suggestion: parsed.swapped,
        });
      }
      centre = { lat: parsed.lat, lon: parsed.lon };
      format = "decimal";
    }

    if (!centre) {
      return res.status(400).json({
        error: "empty",
        message:
          "Paste your village's coordinates here. In Google Maps, long-press your land, then copy the pair of numbers that appears at the top. The map link works too.",
      });
    }

    const spanIn = body.spanM === undefined ? DEFAULT_SPAN_M : body.spanM;
    const span = validateSpan(spanIn);
    if (!span.ok) return res.status(400).json({ error: span.problem, message: span.message });

    const visibility: LandVisibility = isLandVisibility(body.visibility) ? body.visibility : "hidden";

    /*
     * WHICH PARCEL. Absent means 'home', which is the row every village that
     * predates parcels already has, so a caller that knows nothing about
     * parcels keeps editing the one row it always edited.
     *
     * The slug is refused rather than repaired. A slug arrives derived from a
     * label by shared/land.ts's `parcelSlug`, and a value that does not match
     * the shape means the caller derived it differently or a founder typed
     * one by hand -- either way, silently rewriting it would put a different
     * address in the database than the one the caller believes it saved.
     */
    const slug = body.slug === undefined ? DEFAULT_PARCEL_SLUG : body.slug;
    if (!isParcelSlug(slug)) {
      return res.status(400).json({
        error: "bad-parcel",
        message:
          "That parcel name has no letters or numbers in it. Give the piece of land a name like " +
          "\"North field\" and this fills itself in.",
      });
    }
    const label = typeof body.label === "string" ? body.label.trim().slice(0, MAX_PARCEL_LABEL) : "";

    /*
     * Who changed it. A village's location is a fact about where people sleep,
     * so a change to it is worth being able to attribute later. Null when the
     * actor cannot be resolved, which is honest: an unattributed change is a
     * different record from one attributed to nobody in particular.
     */
    const actor = (await authedUser(req))?.id ?? null;

    /*
     * One statement, so two founders saving at once cannot become two rows.
     * The unique key on village_id is what settles it, in the database, rather
     * than in a read-then-write window that a second request slips through.
     */
    /*
     * Where a NEW parcel lands in the order: after the ones that exist.
     *
     * Read-then-write, and that is fine here in a way it is not for the row
     * itself. Two founders adding a parcel at the same moment can land on the
     * same sort_order; `orderParcels` settles that by created_at, so the worst
     * outcome is two parcels in an order nobody chose rather than a lost row
     * or a duplicate. The row's own identity is still settled by the database,
     * by the unique key below.
     */
    const pool = getPool();
    const existing = await readParcels(pool);
    const known = existing.find((p) => p.slug === slug);
    const sortOrder = known ? known.sortOrder : existing.length;

    /*
     * One statement, so two founders saving at once cannot become two rows.
     * The unique key on (village_id, slug) is what settles it, in the
     * database, rather than in a read-then-write window that a second request
     * slips through.
     *
     * `label` is written on insert and only OVERWRITTEN when this call carried
     * one: renaming is a thing a founder does on purpose, and a save of the
     * coordinates alone must not blank the name they gave the land.
     */
    await upsertParcel(pool, {
      id: randomUUID(),
      villageId: VILLAGE,
      slug,
      label,
      sortOrder,
      centreLat: centre.lat,
      centreLon: centre.lon,
      spanM: span.span,
      visibility,
      sourceText,
      sourceFormat: format,
      updatedBy: actor,
    });

    res.json({ success: true, slug, label: label || known?.label || "", centre, spanM: span.span, visibility });
  });

  /**
   * Fetch the picture and keep it.
   *
   * Separate from the save because it is the call that costs money and time,
   * and because a founder correcting a typo in the span should not be made to
   * wait on a provider. It also has to be re-runnable on its own: imagery is
   * refreshed, and a fetch that failed because a key was wrong has to be
   * retryable once the key is fixed.
   *
   * THE PICTURE IS STORED, NEVER HOTLINKED. That is `fetchAndCache`, which
   * writes through server/lib/uploads.ts like every other byte on the volume.
   * Six hero photographs were lost here in one week to hotlinks whose far end
   * got rebuilt, and the uploads volume is measured and confirmed to survive
   * a deploy.
   */
  app.post("/api/admin/land/imagery", async (req, res) => {
    if (!(await guardCapability(req, res, "map.publish"))) return;
    const pool = getPool();
    const slug = (req.body ?? {}).slug === undefined ? DEFAULT_PARCEL_SLUG : (req.body ?? {}).slug;
    if (!isParcelSlug(slug)) {
      return res.status(400).json({ error: "bad-parcel", message: "That parcel name is not one this village has." });
    }
    const row = await readRow(pool, slug);
    if (row.centre === null) {
      return res.status(400).json({
        error: "no-location",
        message: "Set the village's coordinates first, then fetch the picture.",
      });
    }

    const status = configuredProvider();
    if (!status.provider) {
      return res.status(409).json({
        error: "no-provider",
        message:
          "No imagery provider is set up for this village yet. Until one is, the map shows the village's own photograph if there is one, and an empty frame if there is not.",
      });
    }
    if (!status.ready) {
      return res.status(409).json({
        error: "provider-not-ready",
        message: `${status.provider.label} is selected and ${status.missingEnv} is not set, so there is no key to call it with.`,
      });
    }

    const request = { centre: row.centre, spanM: row.spanM ?? DEFAULT_SPAN_M, pixels: IMAGE_PIXELS };
    try {
      const cached = await fetchAndCache(status, request, uploadsDir);
      await recordParcelImagery(pool, VILLAGE, slug, {
        provider: status.provider.id,
        filename: cached.filename,
        attribution: cached.attribution,
      });
      return res.json({
        success: true,
        url: `/api/uploads/${cached.filename}`,
        attribution: cached.attribution,
        bytes: cached.bytes,
      });
    } catch (err) {
      /*
       * The reason is stored as well as answered, so the admin screen can show
       * what went wrong on a later visit without spending another paid request
       * to rediscover it.
       */
      const message =
        err instanceof LicenceForbidsCaching || err instanceof NotAnImage
          ? err.message
          : "The imagery provider could not be reached. Try again in a few minutes.";
      await recordParcelImageryError(pool, VILLAGE, slug, message);
      const code = err instanceof LicenceForbidsCaching ? 409 : 502;
      return res.status(code).json({ error: "imagery-failed", message });
    }
  });
  /**
   * Take the picture down.
   *
   * THE UNDO, AND THE PRIVACY PROMISE. The visibility settings cover the
   * coordinates only, and the screen tells a founder so, and tells them that
   * they can remove the picture if they would rather it were not shown. For a
   * while that sentence pointed at a button that did not exist. This is the
   * route behind it, and it is also the only way back from a picture fetched
   * with the wrong frame, which otherwise needed a hand edit in production.
   *
   * THE REFERENCE GOES FIRST, THEN THE FILE. Cleared in that order, a failure
   * part way leaves an orphan file that nothing shows, which /health counts.
   * The other order leaves the map pointing at a file that is gone, which is a
   * broken picture on a village's front page.
   *
   * The file is DELETED, not just forgotten. A picture that stays reachable at
   * its old address to anyone who saw it before is not private, and private is
   * what the founder asked for.
   */
  app.delete("/api/admin/land/imagery", async (req, res) => {
    if (!(await guardCapability(req, res, "map.publish"))) return;
    const q = (req.query ?? {}) as Record<string, unknown>;
    const slug = q.slug === undefined ? DEFAULT_PARCEL_SLUG : q.slug;
    if (!isParcelSlug(slug)) {
      return res.status(400).json({ error: "bad-parcel", message: "That parcel name is not one this village has." });
    }
    const pool = getPool();
    const row = await readRow(pool, slug);
    const filename = row.imageryFilename;
    await clearParcelImagery(pool, VILLAGE, slug);
    const fileRemoved = filename ? removeFromVolume(uploadsDir, filename) : false;
    res.json({ success: true, removed: filename !== null, fileRemoved });
  });
}
