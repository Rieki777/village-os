/**
 * A photograph of the actual ground, fetched once and kept.
 *
 * ── THE LICENCE IS THE ARCHITECTURE, AND IT WAS MEASURED ─────────────────
 *
 * The brief for this module asked for four providers to be evaluated and for
 * the fetched image to be cached as an upload instead of hotlinked, because
 * this repository lost six hero photographs in one week to a hotlink whose
 * far end got rebuilt. Both halves are right. They are also, for three of the
 * four providers, mutually exclusive, and that is the finding this file is
 * built around.
 *
 * Checked against the published terms on 2026-08-31:
 *
 *   GOOGLE MAPS STATIC. The Maps Service Specific Terms prohibit
 *   pre-fetching, indexing, storing and caching of Google Maps Content. The
 *   one exception is a temporary performance cache: under 30 consecutive
 *   days, secure, NOT REDISTRIBUTED. Serving a stored copy off our own volume
 *   to a village's public page is redistribution. Disqualified for the
 *   architecture the brief mandates.
 *
 *   MAPBOX STATIC IMAGES. The Product Terms permit caching on an END USER'S
 *   DEVICE for 30 days, and then say it plainly: the customer "shall not
 *   distribute Licensed Map Content, including from a cache, by proxying, or
 *   by using a screenshot or other static image instead of accessing Licensed
 *   Map Content directly from the Mapping APIs". Fetching once to our server
 *   and serving the file is exactly the named prohibition. Disqualified on
 *   the same ground.
 *
 *   ESRI WORLD IMAGERY. Governed by the Esri Master Licence Agreement. The
 *   standard World Imagery layer is not intended for exporting tiles for
 *   offline use; Esri publishes a separate "World Imagery (for Export)" layer
 *   for that, and reaching it is a licensing conversation and not an API key.
 *   Not disqualified outright, and not something a village can switch on by
 *   pasting a key either.
 *
 *   COPERNICUS SENTINEL-2. Free, full and open, including reproduction,
 *   distribution and adaptation, for commercial and non-commercial use, with
 *   the attribution "Contains modified Copernicus Sentinel data [year]". It
 *   is the only source on the list whose licence permits what the brief asks
 *   for without a negotiation. Its ground resolution is 10 metres per pixel,
 *   so a 300-metre village is thirty pixels across: enough to say which
 *   valley, nowhere near enough to place a greenhouse.
 *
 *   ONE TRAP WORTH NAMING, since it is the obvious shortcut. The EOX
 *   "Sentinel-2 cloudless" mosaic at s2maps.eu is a lovely cloud-free global
 *   layer and its 2018 to 2024 editions are CC BY-NC-SA: non-commercial. A
 *   village platform is not reliably non-commercial, so that layer is not a
 *   safe default even though it is free to fetch. Only the 2016 edition is
 *   CC BY 4.0.
 *
 * ── SO THE DEFAULT IS THE VILLAGE'S OWN PICTURE ──────────────────────────
 *
 * The provider that beats all four on every axis that matters here is the
 * founder's own aerial photograph. A phone drone over a Costa Rican farm
 * gives centimetres where Sentinel gives ten metres, the village already owns
 * the copyright so no licence question exists, it needs no key and no billing
 * account, it costs nothing at thirteen villages or at three hundred, and it
 * works in exactly the rural terrain where commercial satellite coverage is
 * worst and most out of date. It is also the only option that is guaranteed
 * to be current, because the founder took it this month.
 *
 * Satellite is the fallback for a village with no drone and no photograph,
 * and it is honest about being coarse.
 *
 * ── THE INVARIANT THIS FILE ENFORCES ─────────────────────────────────────
 *
 * `cacheAsUpload` REFUSES to write a provider whose licence forbids
 * redistribution. That refusal is the point of the whole module: without it,
 * the research above is a paragraph somebody deletes in six months, and the
 * first village to paste a Mapbox token puts this project in breach without
 * anybody choosing to. With it, the breach is impossible by construction and
 * turning it on takes a deliberate, logged, named environment variable set by
 * whoever actually holds the contract.
 */
import { sanitiseForVolume, sniffKind, stampedName, writeToVolume } from "./uploads";
import { MAP_WORLD_ASPECT, boundsFor, boundsForAspect, zoomFor, type LatLon } from "../../shared/land";

/** What a provider is asked for. */
export interface ImageryRequest {
  centre: LatLon;
  /** Width of the ground area, edge to edge, in metres. */
  spanM: number;
  /** Width and height of the image to ask for, in pixels. */
  pixels: number;
}

/**
 * Whether this platform may fetch a provider's image, store it on the uploads
 * volume, and serve that copy.
 *
 * "permitted" is a positive statement about a licence somebody read.
 * "forbidden" is the same. There is deliberately no "unknown": a provider
 * added without its terms being read does not get added.
 */
export type CachingRight = "permitted" | "forbidden";

export interface SatelliteProvider {
  id: string;
  label: string;
  /** The credit line the licence requires, shown wherever the image appears. */
  attribution: string;
  caching: CachingRight;
  /** One sentence a human can act on, quoted in the admin screen and the docs. */
  licenceNote: string;
  /** The environment variable holding this provider's key. Null needs none. */
  keyEnv: string | null;
  /**
   * Roughly how fine the imagery is on the ground, in metres per pixel, for
   * the rural terrain these villages are in. Lower is better. This is what
   * makes the honest comparison possible in the admin screen.
   */
  groundResolutionM: number;
  /**
   * Whether `groundResolutionM` is a promise this provider keeps EVERYWHERE.
   *
   * For a satellite with one sensor it is: Sentinel-2 is ten metres over the
   * whole earth. For a mosaic stitched from many surveys it is not. Esri World
   * Imagery holds half-metre detail over a city and less over open country,
   * and asking it for detail a place does not have answers HTTP 500 with an
   * error page. Measured on 2026-09-24: Amora's coast refuses anything finer
   * than 0.62 m per pixel and serves 0.667 happily, while the identical
   * request over Manhattan returns 0.333 without complaint.
   *
   * So `groundResolutionM` is that provider's BEST, and true here means the
   * fetch must be ready to be told no and ask again for less. See
   * `pixelLadder`.
   *
   * It is deliberately not optional. A provider added later has to answer this
   * question, and the answer costs a failed fetch for every village in open
   * country when it is guessed wrong.
   */
  detailVariesByPlace: boolean;
  /** Build the request URL. Null when the provider is not fetched over HTTP. */
  buildUrl: ((req: ImageryRequest, key: string | null) => string) | null;
}

/** Thrown when a caller tries to store bytes a licence does not let us store. */
export class LicenceForbidsCaching extends Error {
  readonly provider: string;

  constructor(provider: string, note: string) {
    super(
      `${provider} does not permit storing and serving its imagery from this server. ${note}`,
    );
    this.name = "LicenceForbidsCaching";
    this.provider = provider;
  }
}

/** Thrown when the bytes that came back are not a picture. */
export class NotAnImage extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NotAnImage";
  }
}

/**
 * Thrown when the provider was still thinking when the clock ran out.
 *
 * It EXTENDS `NotAnImage` deliberately, and the subclassing carries two
 * meanings at once. The route already answers a `NotAnImage` by showing its
 * message to the founder, so a slow provider stops arriving as the catch-all
 * "could not be reached", which was a sentence that described a dead host and
 * got shown for a live one. And `fetchAndCache` treats it as a reason to ask
 * for a smaller picture, because a shorter render is the one lever there is.
 */
export class ProviderTooSlow extends NotAnImage {
  constructor(ms: number) {
    super(`The imagery provider was still working after ${Math.round(ms / 1000)} seconds.`);
    this.name = "ProviderTooSlow";
  }
}

/**
 * The village's own aerial photograph.
 *
 * No URL and no key: the bytes arrive through the ordinary upload path and
 * this entry exists so that the founder's picture travels through the same
 * record, the same attribution field and the same cache guard as a fetched
 * one. Resolution is recorded as the low end of what a consumer drone
 * produces at a couple of hundred metres.
 */
const VILLAGE_UPLOAD: SatelliteProvider = {
  id: "village-upload",
  label: "The village's own aerial photograph",
  attribution: "",
  caching: "permitted",
  licenceNote: "The village took the photograph and holds the copyright, so there is no third party licence to satisfy.",
  keyEnv: null,
  groundResolutionM: 0.05,
  /* The village's own camera over the village's own land. There is no service to say no. */
  detailVariesByPlace: false,
  buildUrl: null,
};

const SENTINEL2: SatelliteProvider = {
  id: "sentinel2",
  label: "Copernicus Sentinel-2",
  attribution: "Contains modified Copernicus Sentinel data",
  caching: "permitted",
  licenceNote:
    "Copernicus data is free and open for reproduction and distribution, including commercially, as long as the modification notice is shown.",
  keyEnv: "SENTINEL_WMS_URL",
  groundResolutionM: 10,
  /* One sensor, ten metres, the whole earth. The figure holds wherever a village is. */
  detailVariesByPlace: false,
  buildUrl: (req, key) => {
    // The endpoint is configuration and not a constant, because every route to
    // Sentinel-2 that does not require a personal account is a WMS somebody
    // operates, and naming one here would hard-code a host this project does
    // not run. The deployment supplies a WMS base URL; this builds the query.
    const b = boundsFor(req.centre, req.spanM);
    const params = new URLSearchParams({
      service: "WMS",
      request: "GetMap",
      version: "1.3.0",
      layers: "TRUE_COLOR",
      format: "image/jpeg",
      crs: "CRS:84",
      bbox: `${b.west},${b.south},${b.east},${b.north}`,
      width: String(req.pixels),
      height: String(req.pixels),
    });
    const base = String(key ?? "");
    return `${base}${base.includes("?") ? "&" : "?"}${params.toString()}`;
  },
};

const MAPBOX: SatelliteProvider = {
  id: "mapbox",
  label: "Mapbox Static Images",
  attribution: "Imagery (c) Mapbox, (c) OpenStreetMap",
  caching: "forbidden",
  licenceNote:
    "The Mapbox Product Terms forbid distributing map content from a cache, by proxying, or as a static image instead of calling the API directly. Storing a copy on this server and serving it is the case those terms name.",
  keyEnv: "MAPBOX_TOKEN",
  groundResolutionM: 0.5,
  /* A tile API answers every zoom with a picture, upsampling past its detail instead of refusing. */
  detailVariesByPlace: false,
  buildUrl: (req, key) => {
    const z = zoomFor(req.centre, req.spanM, req.pixels);
    const { lon, lat } = req.centre;
    return (
      "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/" +
      `${lon},${lat},${z},0/${req.pixels}x${req.pixels}@2x` +
      `?access_token=${encodeURIComponent(String(key ?? ""))}`
    );
  },
};

const GOOGLE: SatelliteProvider = {
  id: "google",
  label: "Google Maps Static",
  attribution: "Imagery (c) Google",
  caching: "forbidden",
  licenceNote:
    "The Google Maps Platform terms prohibit storing or caching map content, with one narrow exception for a temporary performance cache under 30 days that is explicitly not redistributed. Serving a stored copy to a village page is redistribution.",
  keyEnv: "GOOGLE_MAPS_STATIC_KEY",
  groundResolutionM: 0.5,
  /* Same shape as Mapbox: a tile API answers, so there is no no to catch. */
  detailVariesByPlace: false,
  buildUrl: (req, key) => {
    const z = zoomFor(req.centre, req.spanM, req.pixels);
    const params = new URLSearchParams({
      center: `${req.centre.lat},${req.centre.lon}`,
      zoom: String(z),
      size: `${Math.min(req.pixels, 640)}x${Math.min(req.pixels, 640)}`,
      maptype: "satellite",
      scale: "2",
      key: String(key ?? ""),
    });
    return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  },
};

const ESRI: SatelliteProvider = {
  id: "esri",
  label: "Esri World Imagery",
  attribution: "Imagery (c) Esri and its imagery contributors",
  caching: "forbidden",
  licenceNote:
    "Esri World Imagery is governed by the Esri Master Licence Agreement, and the standard layer is not intended for exporting tiles to hold offline. Esri publishes a separate export layer, which is a licensing conversation and not an API key.",
  keyEnv: "ESRI_API_KEY",
  groundResolutionM: 0.5,
  /* A mosaic of many surveys, so 0.5 is its best and not its promise. See the flag's note. */
  detailVariesByPlace: true,
  buildUrl: (req, key) => {
    const b = boundsFor(req.centre, req.spanM);
    const params = new URLSearchParams({
      bbox: `${b.west},${b.south},${b.east},${b.north}`,
      bboxSR: "4326",
      imageSR: "4326",
      size: `${req.pixels},${req.pixels}`,
      format: "jpg",
      f: "image",
    });
    if (key) params.set("token", String(key));
    return (
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
      `?${params.toString()}`
    );
  },
};

/**
 * Esri World Imagery, fetched without a key and kept.
 *
 * SEPARATE FROM `ESRI` ABOVE, AND THE SEPARATION IS THE POINT. That entry
 * records a licence reading made on 2026-08-31 and stays exactly as it was:
 * keyed, and refused for caching. This one is a DEPLOYMENT OWNER'S DECISION,
 * made by Rye on 2026-09-19 for this project, that its own fetches and its own
 * stored copies are acceptable to it. Two entries, because a policy choice and
 * a licence reading are different things and collapsing them into one edit
 * would have quietly rewritten the research.
 *
 * It is not the default. `SATELLITE_PROVIDER` still has to name it, so a fork
 * that has not made this decision is unaffected and still gets the honest
 * empty state it gets today. The three commercial entries above stay
 * forbidden, and the test that pins them still passes.
 *
 * The same public `export` endpoint the map's own plate was cut from
 * (docs/prototypes/fetch_sat.py), which is why it needs no key: the token is
 * only ever added when one exists.
 */
const ESRI_OPEN: SatelliteProvider = {
  id: "esri-open",
  label: "Esri World Imagery (no key, kept on our own volume)",
  attribution: "Imagery (c) Esri and its imagery contributors",
  caching: "permitted",
  licenceNote:
    "Kept by a deployment owner's decision. This project is open source and treats its own use of the public World Imagery export endpoint as acceptable for itself. That is a policy choice made here on 2026-09-19, and it is not a licence grant. The keyed `esri` entry above records the stricter reading and is unchanged. A fork that has not made the same decision should leave this provider unnamed.",
  keyEnv: null,
  groundResolutionM: 0.5,
  /* The same World Imagery service as the keyed entry above, with the same varying detail. */
  detailVariesByPlace: true,
  buildUrl: (req) => {
    const b = boundsForAspect(req.centre, req.spanM, MAP_WORLD_ASPECT);
    /*
     * The image is asked for in the WORLD'S aspect, not as a square. The map's
     * world rect is 2400x1600, and a square picture stretched into it would
     * move every structure off the ground it stands on, which is the one thing
     * a georeferenced map may not do.
     */
    const params = new URLSearchParams({
      bbox: `${b.west},${b.south},${b.east},${b.north}`,
      bboxSR: "4326",
      imageSR: "4326",
      size: `${req.pixels},${Math.round(req.pixels / MAP_WORLD_ASPECT)}`,
      format: "jpg",
      f: "image",
    });
    return (
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
      `?${params.toString()}`
    );
  },
};

export const PROVIDERS: readonly SatelliteProvider[] = [
  VILLAGE_UPLOAD,
  ESRI_OPEN,
  SENTINEL2,
  MAPBOX,
  GOOGLE,
  ESRI,
];

/**
 * The widest picture this platform will ask any provider for, and keep.
 *
 * 2400 is not arbitrary: it is the width of the plate baked into the map
 * artifact, which covers 2592 m, so a village framed like that one gets
 * 1.08 m per pixel and a fetched picture is as sharp as the one the map
 * already draws. Before this, every fetch asked for 1024 whatever the span,
 * which for that frame is 2.53 m per pixel: a founder who fetched their own
 * land got a picture visibly softer than the seed they were replacing.
 */
export const MAX_IMAGE_PIXELS = 2400;

/**
 * Small enough that a tiny parcel does not pay for pixels, large enough that
 * an image is still worth looking at. Only a very coarse provider over a very
 * small parcel can reach it.
 */
export const MIN_IMAGE_PIXELS = 256;

/**
 * How many pixels to ask this provider for, to cover `spanM` of ground.
 *
 * NEVER MORE THAN THE PROVIDER CAN RESOLVE. Asking Sentinel-2, at ten metres
 * per pixel, for a 2400-wide image of a 2592 m village is asking for ten times
 * the detail that exists: the answer is an upscale, five times the bytes, and
 * a picture that LOOKS like it resolves a greenhouse and does not. This map
 * may not present invented detail as real, and a resampled pixel is invented
 * detail with a filename.
 *
 * So the ask is the ground divided by what the provider actually resolves,
 * capped at what this platform will store. For a 0.5 m provider over 2592 m
 * that is 5184, capped to 2400. For Sentinel-2 over the same ground it is
 * 259, which is the honest size of what Copernicus has.
 */
export function pixelsFor(provider: SatelliteProvider, spanM: number): number {
  const span = Number.isFinite(spanM) && spanM > 0 ? spanM : 0;
  const res = provider.groundResolutionM > 0 ? provider.groundResolutionM : 1;
  const native = Math.round(span / res);
  return Math.max(MIN_IMAGE_PIXELS, Math.min(MAX_IMAGE_PIXELS, native));
}

/**
 * Each step down is a quarter less detail, which lands near the tile levels a
 * mosaic is actually cut at without throwing away half the sharpness the way
 * halving would. From 0.5 m per pixel the rungs are 0.67, 0.89, 1.19, 1.58.
 */
export const COARSER_STEP = 0.75;

/** How many times to accept being told no before giving up. */
export const COARSER_ATTEMPTS = 4;

/**
 * The smallest image worth keeping, which is BELOW `MIN_IMAGE_PIXELS` on
 * purpose.
 *
 * That floor exists so a small parcel is not served a thumbnail when a real
 * picture is available. Down here the question is different: the place holds
 * no finer detail, so a small real picture is the only picture there is, and
 * refusing it would leave the founder with nothing over a rule about comfort.
 */
export const FLOOR_IMAGE_PIXELS = 64;

/**
 * The sizes to ask for, finest first, stopping at the first one that answers.
 *
 * A provider whose detail is the same everywhere gets a list of one, so
 * nothing about its behaviour changes and no second request is ever spent on
 * it. That matters for the keyed providers, where a retry is a charge.
 *
 * For a mosaic the list is the whole point. Esri answers HTTP 500 when asked
 * for detail a place does not hold, so the first ask can fail for a reason
 * that has nothing to do with the request being wrong: Amora's own coast
 * refuses 0.5 m per pixel, which is exactly what `pixelsFor` computes for it.
 * Before this, every village in open country got a failed fetch and an error
 * naming somebody else's status code.
 */
export function pixelLadder(provider: SatelliteProvider, pixels: number): number[] {
  const first = Math.max(FLOOR_IMAGE_PIXELS, Math.round(pixels));
  if (!provider.detailVariesByPlace) return [first];
  const rungs = [first];
  for (let i = 0; i < COARSER_ATTEMPTS; i += 1) {
    const next = Math.round(rungs[rungs.length - 1] * COARSER_STEP);
    if (next < FLOOR_IMAGE_PIXELS || next >= rungs[rungs.length - 1]) break;
    rungs.push(next);
  }
  return rungs;
}

export function providerById(id: string | null | undefined): SatelliteProvider | null {
  if (!id) return null;
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * The escape hatch, named so it cannot be taken by accident.
 *
 * A deployment that has its OWN written agreement with a provider can set
 * this to that provider's id. It is deliberately not a boolean: naming the
 * provider means the person setting it has one specific contract in mind, and
 * a stray "1" in an env file cannot switch on redistribution for everything.
 */
const CACHE_OVERRIDE_ENV = "SATELLITE_CACHE_OVERRIDE";

export function cachingAllowed(
  provider: SatelliteProvider,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (provider.caching === "permitted") return true;
  return String(env[CACHE_OVERRIDE_ENV] ?? "").trim() === provider.id;
}

/** What the deployment is configured to use, and whether it can actually run. */
export interface ProviderStatus {
  provider: SatelliteProvider | null;
  /** True when the provider needs no key, or the key is present. */
  ready: boolean;
  /** Which environment variable is missing, when one is. */
  missingEnv: string | null;
  /** The key itself, for the caller that is about to build a URL. */
  key: string | null;
}

/**
 * Read the configured provider out of the environment.
 *
 * A village with nothing configured gets `{ provider: null, ready: false }`,
 * which the route turns into an honest empty state. There is no default
 * provider and no silent fallback to a keyless source: a map that quietly
 * showed a different picture from the one the founder configured would be a
 * worse failure than a map that says nothing is configured yet.
 */
export function configuredProvider(env: NodeJS.ProcessEnv = process.env): ProviderStatus {
  const id = String(env.SATELLITE_PROVIDER ?? "").trim();
  if (!id) return { provider: null, ready: false, missingEnv: "SATELLITE_PROVIDER", key: null };
  const provider = providerById(id);
  if (!provider) return { provider: null, ready: false, missingEnv: "SATELLITE_PROVIDER", key: null };
  if (!provider.keyEnv) return { provider, ready: true, missingEnv: null, key: null };
  const key = String(env[provider.keyEnv] ?? "").trim();
  if (!key) return { provider, ready: false, missingEnv: provider.keyEnv, key: null };
  return { provider, ready: true, missingEnv: null, key };
}

/** How big a satellite image this platform will accept, in bytes. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * How long to wait on one ask, in milliseconds.
 *
 * THIS WAS 20000 AND IT WAS SIZED FOR A PICTURE WE NO LONGER ASK FOR. When
 * `MAX_IMAGE_PIXELS` went from 1024 to 2400 the ask grew about five and a half
 * times in pixels and five times in bytes, and the export endpoint RENDERS on
 * demand, so a bigger ask is a longer wait and not only a bigger download.
 * The timeout was left where it was.
 *
 * Measured against the live service on 2026-09-24, the same 2400 px request
 * four times running: 12.7 s, 24.8 s, 29.5 s, 27.2 s. Three of the four were
 * over the old ceiling. That is a founder pressing Fetch on a correctly
 * configured village and being told the provider could not be reached, on a
 * request that was working and slow.
 *
 * 45 s is half again beyond the worst of those four. The whole staircase is
 * bounded separately by `LADDER_BUDGET_MS`, so a generous single wait cannot
 * turn into five of them.
 */
export const FETCH_TIMEOUT_MS = 45000;

/**
 * How long the whole ladder may take before it stops asking.
 *
 * A slow answer is a reason to ask for LESS, because a smaller picture is a
 * shorter render, and a village on a thin rural connection is exactly who
 * needs that. So a timeout steps down instead of ending the attempt. The
 * budget is what stops that being five long waits in a row: once this much has
 * gone by, whatever rung is next does not get asked.
 */
export const LADDER_BUDGET_MS = 100000;

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * Pull the bytes down, with a clock and a ceiling on them.
 *
 * The content type header is not consulted. A provider that answers an error
 * page with `image/jpeg` on it is a provider whose header lied, and this
 * codebase's rule for uploads is already that the first bytes are the file
 * (`sniffKind` in server/lib/uploads.ts). The same rule applies to bytes that
 * arrive from a provider, because a remote server is exactly as much a
 * stranger as a person with an upload form.
 */
export async function fetchImageBytes(
  url: string,
  fetcher: Fetcher = globalThis.fetch as unknown as Fetcher,
  /*
   * Overridable ONLY so a test can reach the timeout branch. A suite that
   * waited out the real 45 seconds would be skipped by whoever ran it next,
   * and the branch this parameter exists to cover is the one that shipped
   * broken: a slow provider read as an unreachable one.
   */
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Buffer> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    /*
     * The flag is set BEFORE the abort, so that by the time the rejection is
     * caught below it is already true. Asking `controller.signal.aborted`
     * instead would answer true for a caller's own cancellation as well, and
     * those two want opposite handling.
     */
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  /*
   * The clock can run out at either await, and a big picture makes the SECOND
   * one the likely place: the headers come back quickly and the megabyte after
   * them is what takes the time. Both are wrapped for that reason.
   */
  const whileWaiting = (err: unknown): never => {
    if (timedOut) throw new ProviderTooSlow(timeoutMs);
    throw err;
  };
  try {
    const res = await fetcher(url, { signal: controller.signal }).catch(whileWaiting);
    if (!res.ok) {
      throw new NotAnImage(`The imagery provider answered ${res.status}.`);
    }
    const buf = Buffer.from(await res.arrayBuffer().catch(whileWaiting));
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new NotAnImage(
        `The image came back at ${Math.round(buf.length / 1024)} kB, over the ${Math.round(MAX_IMAGE_BYTES / 1024)} kB ceiling.`,
      );
    }
    if (sniffKind(buf) !== "image") {
      throw new NotAnImage(
        "The imagery provider sent something that is not a picture. That usually means the key was refused and the body is an error page.",
      );
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

export interface CachedImage {
  filename: string;
  bytes: number;
  attribution: string;
}

/**
 * A picture that was fetched as well as kept, so it knows what it cost.
 *
 * `pixels` is the rung that answered, which is the first ask for most places
 * and a coarser one where the provider held less detail. The screen says it
 * back to the founder, because "kept at 1.3 m per pixel" is the difference
 * between a picture that looks soft and a picture that IS the ground.
 */
export interface FetchedImage extends CachedImage {
  pixels: number;
}

/**
 * Put the picture on the uploads volume, through the one door.
 *
 * THE LICENCE CHECK COMES FIRST, before any byte is written, because a file
 * written and then deleted has still been written. `sanitiseForVolume` and
 * `writeToVolume` are server/lib/uploads.ts's, so this writer is inside the
 * guarantee that scripts/check-upload-strip.mjs enforces: the image is
 * re-encoded with no metadata and the result is checked before it is stored.
 *
 * A satellite image carries no EXIF worth worrying about, and that is not the
 * reason to go through the door. The reason is that a writer outside the door
 * is a writer nobody audits, and the next one after it will be an upload.
 */
export async function cacheAsUpload(
  provider: SatelliteProvider,
  bytes: Buffer,
  uploadsDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CachedImage> {
  if (!cachingAllowed(provider, env)) {
    throw new LicenceForbidsCaching(provider.label, provider.licenceNote);
  }
  const clean = await sanitiseForVolume(bytes, `${provider.id}.jpg`);
  const filename = stampedName(`land-${provider.id}`, clean.ext);
  writeToVolume(uploadsDir, filename, clean.bytes);
  return { filename, bytes: clean.bytes.length, attribution: attributionFor(provider) };
}

/**
 * The credit line to store beside the file.
 *
 * Copernicus asks for the year of the data in the notice, and the year the
 * image was fetched is the closest honest stand-in this code has. A provider
 * with a fixed line gets it verbatim.
 */
export function attributionFor(provider: SatelliteProvider, now: Date = new Date()): string {
  if (!provider.attribution) return "";
  if (provider.id === "sentinel2") return `${provider.attribution} ${now.getUTCFullYear()}`;
  return provider.attribution;
}

/**
 * Fetch and store in one call, which is what a route wants.
 *
 * Refuses before the network call when the licence forbids storing, so a
 * misconfigured deployment does not spend a paid request to find out.
 */
export async function fetchAndCache(
  status: ProviderStatus,
  request: ImageryRequest,
  uploadsDir: string,
  options: { fetcher?: Fetcher; env?: NodeJS.ProcessEnv } = {},
): Promise<FetchedImage> {
  const env = options.env ?? process.env;
  const { provider, ready, key } = status;
  if (!provider) throw new NotAnImage("No imagery provider is configured for this village.");
  if (!provider.buildUrl) {
    throw new NotAnImage(
      `${provider.label} does not fetch over the network. Its picture arrives through the upload form.`,
    );
  }
  if (!cachingAllowed(provider, env)) {
    throw new LicenceForbidsCaching(provider.label, provider.licenceNote);
  }
  if (!ready) throw new NotAnImage(`${provider.label} is selected and its key is not set.`);

  /*
   * ASK FINEST FIRST, AND ACCEPT BEING TOLD NO.
   *
   * Only a `NotAnImage` is worth another ask: that is the provider answering,
   * with a status or a body that says this request was too much. A timeout or
   * a dropped socket is the network, and walking the whole ladder on those
   * would spend five twenty-second waits to arrive at the same place, so the
   * loop stops on the first failure that is not the provider's own answer.
   */
  const rungs = pixelLadder(provider, request.pixels);
  const started = Date.now();
  let bytes: Buffer | null = null;
  let kept = rungs[0];
  let asked = 0;
  let refusal: NotAnImage | null = null;
  for (const pixels of rungs) {
    if (asked > 0 && Date.now() - started > LADDER_BUDGET_MS) break;
    asked += 1;
    try {
      bytes = await fetchImageBytes(provider.buildUrl({ ...request, pixels }, key), options.fetcher);
      kept = pixels;
      break;
    } catch (err) {
      if (!(err instanceof NotAnImage)) throw err;
      refusal = err;
    }
  }
  if (!bytes) throw ladderRanOut(request.spanM, rungs.slice(0, asked), refusal);
  return { ...(await cacheAsUpload(provider, bytes, uploadsDir, env)), pixels: kept };
}

/**
 * What to say when every ask came back no.
 *
 * The two reasons want different sentences, and giving one sentence for both
 * is how this route came to tell a founder their provider was unreachable
 * when it was answering fine and slowly:
 *
 *   TOO SLOW. The place may hold all the detail in the world. Nothing the
 *   founder types will change that today, so the honest advice is the clock.
 *
 *   REFUSED. The service answered, and what it said is that this place has no
 *   picture this fine. A wider frame asks for coarser ground per pixel, which
 *   is a lever the founder does hold.
 *
 * A single-rung provider keeps its own message either way, because no stepping
 * down happened and there is nothing to add to what it said.
 *
 * Kept short on purpose. `recordParcelImageryError` clips at 255 characters,
 * which is the width of the column, so a longer sentence loses its own ending.
 */
function ladderRanOut(spanM: number, asked: number[], refusal: NotAnImage | null): NotAnImage {
  if (asked.length < 2 || !refusal) {
    return refusal ?? new NotAnImage("The imagery provider sent nothing this platform could keep.");
  }
  if (refusal instanceof ProviderTooSlow) {
    return new NotAnImage(
      `${refusal.message} It was asked ${asked.length} times, each one smaller than the last. The service is slow right now, so the same button in a few minutes usually works.`,
    );
  }
  const coarsest = (spanM / asked[asked.length - 1]).toFixed(1);
  return new NotAnImage(
    `No picture of this place at the detail asked for. It was asked ${asked.length} times, down to ${coarsest} m per pixel, and refused each time. A wider frame is the usual fix: this source holds less detail over open country than over a city.`,
  );
}

