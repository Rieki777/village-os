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

/** How long to wait on a provider before giving up, in milliseconds. */
export const FETCH_TIMEOUT_MS = 20000;

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
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) {
      throw new NotAnImage(`The imagery provider answered ${res.status}.`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
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
): Promise<CachedImage> {
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
  const bytes = await fetchImageBytes(provider.buildUrl(request, key), options.fetcher);
  return cacheAsUpload(provider, bytes, uploadsDir, env);
}
