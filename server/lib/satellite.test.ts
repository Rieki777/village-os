/**
 * The licence guard, and the honest empty state.
 *
 * THE ONE TEST THAT MATTERS HERE is that a provider whose terms forbid
 * redistribution cannot be written to the uploads volume. Everything else in
 * this file is ordinary plumbing; that assertion is the whole reason the
 * module has a shape at all, and it is the one a later change is most likely
 * to remove by accident while making the fetch path "simpler".
 *
 * A note on what these tests prove. They prove the code does what this
 * project decided. They do NOT prove the licence readings are correct: that
 * is a question about documents, the readings are quoted with their dates in
 * server/lib/satellite.ts and docs/VILLAGE_LAND.md, and they need re-reading
 * when a provider changes terms. A green suite here is not legal advice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LicenceForbidsCaching,
  MAX_IMAGE_BYTES,
  NotAnImage,
  PROVIDERS,
  attributionFor,
  cacheAsUpload,
  cachingAllowed,
  configuredProvider,
  fetchAndCache,
  fetchImageBytes,
  providerById,
  type Fetcher,
} from "./satellite";
import { pixelsFor, MAX_IMAGE_PIXELS, MIN_IMAGE_PIXELS } from "./satellite";
import {
  COARSER_ATTEMPTS,
  FETCH_TIMEOUT_MS,
  FLOOR_IMAGE_PIXELS,
  ProviderTooSlow,
  pixelLadder,
} from "./satellite";

const CR = { lat: 9.2345, lon: -83.8412 };
const REQUEST = { centre: CR, spanM: 800, pixels: 512 };

const dirs: string[] = [];
const tempDir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "land-imagery-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** A one-by-one PNG, so sniffKind sees a real image without sharp inventing one. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const respondWith = (bytes: Buffer, ok = true, status = 200): Fetcher =>
  async () => ({
    ok,
    status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });

describe("every provider carries a licence reading somebody made", () => {
  it("declares caching as a decision, with no unknown state", () => {
    for (const p of PROVIDERS) {
      expect(["permitted", "forbidden"]).toContain(p.caching);
      expect(p.licenceNote.length).toBeGreaterThan(20);
    }
  });

  it("gives every provider a ground resolution, so the comparison can be honest", () => {
    for (const p of PROVIDERS) {
      expect(p.groundResolutionM).toBeGreaterThan(0);
    }
  });

  it("records Sentinel-2 as ten metres, which is the number that makes it a fallback", () => {
    expect(providerById("sentinel2")?.groundResolutionM).toBe(10);
  });

  it("keeps the three commercial providers marked forbidden", () => {
    // If a later change flips one of these, it has to change this line too,
    // and changing this line is a decision somebody has to defend.
    for (const id of ["mapbox", "google", "esri"]) {
      expect(providerById(id)?.caching).toBe("forbidden");
    }
  });

  it("keeps the village's own photograph permitted and keyless", () => {
    const own = providerById("village-upload");
    expect(own?.caching).toBe("permitted");
    expect(own?.keyEnv).toBeNull();
  });
});

describe("the licence guard refuses to store what may not be stored", () => {
  it("throws instead of writing a Mapbox image to the volume", async () => {
    const dir = tempDir();
    const mapbox = providerById("mapbox");
    if (!mapbox) throw new Error("mapbox provider missing");
    await expect(cacheAsUpload(mapbox, PNG, dir, {})).rejects.toBeInstanceOf(LicenceForbidsCaching);
  });

  it("leaves NOTHING on the volume when it refuses", async () => {
    // A file written and then deleted has still been written. The check has to
    // come before the write, and this is how that is pinned.
    const dir = tempDir();
    const google = providerById("google");
    if (!google) throw new Error("google provider missing");
    await expect(cacheAsUpload(google, PNG, dir, {})).rejects.toThrow();
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  it("names the provider and the reason, so the operator can act", async () => {
    const dir = tempDir();
    const esri = providerById("esri");
    if (!esri) throw new Error("esri provider missing");
    await expect(cacheAsUpload(esri, PNG, dir, {})).rejects.toThrow(/Master Licence Agreement/i);
  });

  it("does not spend a paid request before refusing", async () => {
    let called = 0;
    const counting: Fetcher = async (url, init) => {
      called += 1;
      return respondWith(PNG)(url, init);
    };
    const mapbox = providerById("mapbox");
    if (!mapbox) throw new Error("mapbox provider missing");
    await expect(
      fetchAndCache(
        { provider: mapbox, ready: true, missingEnv: null, key: "tok" },
        REQUEST,
        tempDir(),
        { fetcher: counting, env: {} },
      ),
    ).rejects.toBeInstanceOf(LicenceForbidsCaching);
    expect(called).toBe(0);
  });

  it("stores a Copernicus image, because that licence permits it", async () => {
    const dir = tempDir();
    const s2 = providerById("sentinel2");
    if (!s2) throw new Error("sentinel2 provider missing");
    const cached = await cacheAsUpload(s2, PNG, dir, {});
    expect(fs.existsSync(path.join(dir, cached.filename))).toBe(true);
    expect(cached.filename).toMatch(/^land-sentinel2-/);
  });
});

describe("the override is deliberate and provider-shaped", () => {
  it("stays shut for a bare truthy value", () => {
    const mapbox = providerById("mapbox");
    if (!mapbox) throw new Error("mapbox provider missing");
    expect(cachingAllowed(mapbox, { SATELLITE_CACHE_OVERRIDE: "1" })).toBe(false);
    expect(cachingAllowed(mapbox, { SATELLITE_CACHE_OVERRIDE: "true" })).toBe(false);
  });

  it("opens only for the provider it names", () => {
    const mapbox = providerById("mapbox");
    const google = providerById("google");
    if (!mapbox || !google) throw new Error("providers missing");
    const env = { SATELLITE_CACHE_OVERRIDE: "mapbox" };
    expect(cachingAllowed(mapbox, env)).toBe(true);
    expect(cachingAllowed(google, env)).toBe(false);
  });

  it("is irrelevant to a provider that never needed it", () => {
    const s2 = providerById("sentinel2");
    if (!s2) throw new Error("sentinel2 provider missing");
    expect(cachingAllowed(s2, {})).toBe(true);
  });
});

describe("configuration, and the village that configured nothing", () => {
  it("reports nothing configured rather than picking a default", () => {
    const status = configuredProvider({});
    expect(status.provider).toBeNull();
    expect(status.ready).toBe(false);
    expect(status.missingEnv).toBe("SATELLITE_PROVIDER");
  });

  it("reports an unknown provider name as unconfigured, and does not throw", () => {
    const status = configuredProvider({ SATELLITE_PROVIDER: "bing" });
    expect(status.provider).toBeNull();
    expect(status.ready).toBe(false);
  });

  it("names the missing key when a provider is chosen without one", () => {
    const status = configuredProvider({ SATELLITE_PROVIDER: "mapbox" });
    expect(status.provider?.id).toBe("mapbox");
    expect(status.ready).toBe(false);
    expect(status.missingEnv).toBe("MAPBOX_TOKEN");
  });

  it("is ready when the key is present", () => {
    const status = configuredProvider({ SATELLITE_PROVIDER: "mapbox", MAPBOX_TOKEN: "tok" });
    expect(status.ready).toBe(true);
    expect(status.key).toBe("tok");
  });

  it("is ready with no key for the village's own photograph", () => {
    const status = configuredProvider({ SATELLITE_PROVIDER: "village-upload" });
    expect(status.ready).toBe(true);
    expect(status.missingEnv).toBeNull();
  });

  it("treats a whitespace-only key as absent", () => {
    const status = configuredProvider({ SATELLITE_PROVIDER: "mapbox", MAPBOX_TOKEN: "   " });
    expect(status.ready).toBe(false);
  });
});

describe("bytes off the wire are treated as a stranger's bytes", () => {
  it("refuses an error page the provider labelled as an image", async () => {
    const html = Buffer.from("<html><body>Forbidden</body></html>", "utf8");
    await expect(fetchImageBytes("https://example.invalid/x", respondWith(html))).rejects.toBeInstanceOf(
      NotAnImage,
    );
  });

  it("says the key was probably refused, because that is what it usually is", async () => {
    const html = Buffer.from("<html>no</html>", "utf8");
    await expect(fetchImageBytes("https://example.invalid/x", respondWith(html))).rejects.toThrow(
      /key was refused/i,
    );
  });

  it("refuses a non-200 without reading the body", async () => {
    await expect(
      fetchImageBytes("https://example.invalid/x", respondWith(PNG, false, 403)),
    ).rejects.toThrow(/answered 403/);
  });

  it("refuses a body over the ceiling", async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES + 1)]);
    await expect(fetchImageBytes("https://example.invalid/x", respondWith(huge))).rejects.toThrow(
      /ceiling/,
    );
  });

  it("accepts a real image", async () => {
    const out = await fetchImageBytes("https://example.invalid/x", respondWith(PNG));
    expect(out.length).toBe(PNG.length);
  });
});

describe("attribution", () => {
  it("stamps the Copernicus notice with the year, which the licence asks for", () => {
    const s2 = providerById("sentinel2");
    if (!s2) throw new Error("sentinel2 provider missing");
    const line = attributionFor(s2, new Date(Date.UTC(2026, 0, 2)));
    expect(line).toBe("Contains modified Copernicus Sentinel data 2026");
  });

  it("leaves the village's own photograph with no credit line to show", () => {
    const own = providerById("village-upload");
    if (!own) throw new Error("village-upload provider missing");
    expect(attributionFor(own)).toBe("");
  });
});

describe("URL building", () => {
  it("asks Mapbox for the centre and a zoom derived from the span", () => {
    const mapbox = providerById("mapbox");
    if (!mapbox?.buildUrl) throw new Error("mapbox buildUrl missing");
    const url = mapbox.buildUrl(REQUEST, "tok");
    expect(url).toContain("satellite-v9");
    expect(url).toContain(`${CR.lon},${CR.lat},`);
    expect(url).toContain("access_token=tok");
  });

  it("keeps Google's static size inside the 640 the free endpoint serves", () => {
    const google = providerById("google");
    if (!google?.buildUrl) throw new Error("google buildUrl missing");
    const url = google.buildUrl({ ...REQUEST, pixels: 2048 }, "k");
    expect(url).toContain("size=640x640");
  });

  it("asks Esri and Sentinel for a box, because that is what they take", () => {
    for (const id of ["esri", "sentinel2"]) {
      const p = providerById(id);
      if (!p?.buildUrl) throw new Error(`${id} buildUrl missing`);
      expect(p.buildUrl(REQUEST, "https://wms.example.invalid/ogc")).toContain("bbox=");
    }
  });

  it("does not build a URL for the village's own photograph", () => {
    expect(providerById("village-upload")?.buildUrl).toBeNull();
  });
});
describe("the keyless Esri entry is a decision, kept apart from the licence reading", () => {
  it("is permitted and needs no key, while the keyed entry is untouched", () => {
    const open = providerById("esri-open");
    expect(open?.caching).toBe("permitted");
    expect(open?.keyEnv).toBeNull();
    // The reading made on 2026-08-31 still says what it said.
    expect(providerById("esri")?.caching).toBe("forbidden");
    expect(providerById("esri")?.keyEnv).toBe("ESRI_API_KEY");
  });

  it("is ready with no key once a deployment names it", () => {
    const status = configuredProvider({ SATELLITE_PROVIDER: "esri-open" });
    expect(status.provider?.id).toBe("esri-open");
    expect(status.ready).toBe(true);
    expect(status.missingEnv).toBeNull();
  });

  it("is NOT the default, so a fork that never decided is unaffected", () => {
    const status = configuredProvider({});
    expect(status.provider).toBeNull();
    expect(status.missingEnv).toBe("SATELLITE_PROVIDER");
  });

  it("asks for a picture whose ground is the same shape as the image", () => {
    const open = providerById("esri-open");
    if (!open) throw new Error("esri-open missing");
    const url = new URL(open.buildUrl!({ centre: { lat: 9.2345, lon: -83.8412 }, spanM: 800, pixels: 1024 }, null));
    const [w, h] = String(url.searchParams.get("size")).split(",").map(Number);
    const [west, south, east, north] = String(url.searchParams.get("bbox")).split(",").map(Number);
    const mLat = 111_320;
    const groundW = (east - west) * mLat * Math.cos((9.2345 * Math.PI) / 180);
    const groundH = (north - south) * mLat;
    // Same metres per pixel on both axes: the picture is not stretched.
    expect(groundW / w).toBeCloseTo(groundH / h, 2);
  });

  it("carries no token when there is no key to carry", () => {
    const open = providerById("esri-open");
    if (!open) throw new Error("esri-open missing");
    const url = new URL(open.buildUrl!({ centre: { lat: 9.2, lon: -83.8 }, spanM: 800, pixels: 512 }, null));
    expect(url.searchParams.get("token")).toBeNull();
  });
});
describe("how many pixels to ask a provider for", () => {
  /* The seed plate's frame: 2592 m across, drawn 2400 px wide, so 1.08 m/px. */
  const SEED_SPAN = 2592;
  const res = (id: string) => providerById(id)!;

  it("matches the baked plate's sharpness for a half-metre provider on that frame", () => {
    const px = pixelsFor(res("esri-open"), SEED_SPAN);
    expect(px).toBe(MAX_IMAGE_PIXELS);
    expect(SEED_SPAN / px).toBeCloseTo(1.08, 2);
  });

  it("never asks Sentinel-2 for more detail than Copernicus has", () => {
    // 10 m/px over 2592 m is 259 real pixels. Asking for 2400 would be an
    // upscale: five times the bytes, and a picture that looks like it
    // resolves a greenhouse and does not.
    const px = pixelsFor(res("sentinel2"), SEED_SPAN);
    expect(px).toBe(Math.round(SEED_SPAN / 10));
    expect(px).toBeLessThan(MAX_IMAGE_PIXELS);
  });

  it("asks a small parcel's true size rather than the cap", () => {
    // 800 m at 0.5 m/px is 1600, which is under the ceiling and is what exists.
    expect(pixelsFor(res("esri-open"), 800)).toBe(1600);
  });

  it("caps a very large parcel instead of storing an enormous file", () => {
    expect(pixelsFor(res("esri-open"), 20000)).toBe(MAX_IMAGE_PIXELS);
  });

  it("keeps a floor, so a tiny parcel still returns a picture worth looking at", () => {
    expect(pixelsFor(res("sentinel2"), 50)).toBe(MIN_IMAGE_PIXELS);
  });

  it("answers sanely for a span that is missing or nonsense", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const px = pixelsFor(res("esri-open"), bad as number);
      expect(Number.isFinite(px)).toBe(true);
      expect(px).toBeGreaterThanOrEqual(MIN_IMAGE_PIXELS);
      expect(px).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    }
  });

  it("gives every provider a usable answer, so none can ask for zero", () => {
    for (const p of PROVIDERS) {
      const px = pixelsFor(p, SEED_SPAN);
      expect(px).toBeGreaterThanOrEqual(MIN_IMAGE_PIXELS);
      expect(px).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    }
  });
});

/*
 * A MOSAIC SAYS NO, AND THE FETCH ASKS FOR LESS.
 *
 * Esri World Imagery holds half-metre detail over a city and less over open
 * country. `pixelsFor` asks for the provider's best, so over open country the
 * first ask is for detail that is not there, and the service answers HTTP 500
 * with an error page. Measured against the live service on 2026-09-24: Amora's
 * coast refuses 0.5 m per pixel and serves 0.667, while the same request over
 * Manhattan returns 0.333. Before this, EVERY width under about 1490 m failed
 * there, which included the default a founder started on.
 */
describe("asking for less when a place holds less", () => {
  const varying = providerById("esri-open")!;
  const fixed = providerById("sentinel2")!;

  /*
   * The size asked for, read back out of whatever URL the provider built.
   *
   * Tolerant on purpose, and it cost a red run to learn why: Sentinel-2 builds
   * a RELATIVE url from an operator-supplied WMS base, so `new URL(url)` threw
   * a TypeError inside the fake fetcher, `fetchAndCache` correctly passed a
   * non-NotAnImage straight through, and the test blamed the code. A helper
   * that only understood one provider's URL was the whole defect.
   */
  const askedPixels = (url: string): number => {
    const q = new URL(url, "https://base.test/").searchParams;
    const size = q.get("size");
    if (size) return Number(size.split(",")[0]);
    return Number(q.get("width"));
  };

  /** Answers `ok` on the nth ask and refuses every earlier one, counting as it goes. */
  const succeedsOnAsk = (n: number, asks: number[]): Fetcher =>
    async (url) => {
      asks.push(askedPixels(url));
      if (asks.length < n) return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) as ArrayBuffer,
      };
    };

  it("gives a provider whose detail is the same everywhere exactly one rung", () => {
    expect(fixed.detailVariesByPlace).toBe(false);
    expect(pixelLadder(fixed, 1600)).toEqual([1600]);
  });

  it("gives a mosaic a descending ladder, finest first", () => {
    const rungs = pixelLadder(varying, 1600);
    expect(rungs[0]).toBe(1600);
    expect(rungs.length).toBe(COARSER_ATTEMPTS + 1);
    for (let i = 1; i < rungs.length; i += 1) expect(rungs[i]).toBeLessThan(rungs[i - 1]);
  });

  it("steps below the comfort floor for a tiny parcel, because a small real picture beats none", () => {
    // 100 m over a 0.5 m provider is 200 native, which pixelsFor raises to the floor.
    const rungs = pixelLadder(varying, MIN_IMAGE_PIXELS);
    expect(rungs[rungs.length - 1]).toBeLessThan(MIN_IMAGE_PIXELS);
    expect(rungs[rungs.length - 1]).toBeGreaterThanOrEqual(FLOOR_IMAGE_PIXELS);
  });

  it("keeps the picture the second rung answered with, and says what size it kept", async () => {
    const asks: number[] = [];
    const got = await fetchAndCache(
      { provider: varying, ready: true, missingEnv: null, key: null },
      { centre: CR, spanM: 800, pixels: 1600 },
      tempDir(),
      { fetcher: succeedsOnAsk(2, asks) },
    );
    expect(asks).toEqual([1600, 1200]);
    expect(got.pixels).toBe(1200);
  });

  it("spends ONE request on a provider whose detail does not vary, however it fails", async () => {
    const asks: number[] = [];
    await expect(
      fetchAndCache(
        { provider: fixed, ready: true, missingEnv: null, key: null },
        { centre: CR, spanM: 800, pixels: 80 },
        tempDir(),
        { fetcher: succeedsOnAsk(99, asks) },
      ),
    ).rejects.toThrow(NotAnImage);
    // A retry on a keyed provider is a charge. Only a mosaic earns a second ask.
    expect(asks.length).toBe(1);
  });

  it("stops asking after a failure that is the network rather than the provider", async () => {
    let asks = 0;
    const broken: Fetcher = async () => {
      asks += 1;
      throw new Error("ECONNRESET");
    };
    await expect(
      fetchAndCache(
        { provider: varying, ready: true, missingEnv: null, key: null },
        { centre: CR, spanM: 800, pixels: 1600 },
        tempDir(),
        { fetcher: broken },
      ),
    ).rejects.toThrow("ECONNRESET");
    expect(asks).toBe(1);
  });

  it("tells a founder the lever they have when every rung was refused", async () => {
    const asks: number[] = [];
    const err = (await fetchAndCache(
      { provider: varying, ready: true, missingEnv: null, key: null },
      { centre: CR, spanM: 800, pixels: 1600 },
      tempDir(),
      { fetcher: succeedsOnAsk(99, asks) },
    ).catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(NotAnImage);
    expect(err.message).toContain("A wider frame");
    expect(err.message).toContain("5 times");
    // The old sentence described a dead host and was shown for a live one.
    expect(err.message).not.toContain("could not be reached");
    // The column clips at 255, so a longer sentence loses its own ending.
    expect(err.message.length).toBeLessThanOrEqual(255);
  });
});

/*
 * A SLOW PROVIDER IS NOT AN UNREACHABLE ONE.
 *
 * Raising MAX_IMAGE_PIXELS from 1024 to 2400 made the ask about five times
 * bigger, and the export endpoint renders on demand, so the wait grew with it.
 * The timeout stayed at 20 s. Measured live on 2026-09-24, the same 2400 px
 * request four times running took 12.7, 24.8, 29.5 and 27.2 seconds: three of
 * the four over the old ceiling, on a village that was configured correctly.
 */
describe("a provider that is slow rather than absent", () => {
  const varying = providerById("esri-open")!;

  /** Honours the abort signal and otherwise never answers. */
  const silent: Fetcher = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });

  it("names the wait instead of claiming the provider could not be reached", async () => {
    const err = (await fetchImageBytes("https://example.test/x", silent, 20).catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(ProviderTooSlow);
    expect(err.message).toContain("still working");
  });

  it("is a NotAnImage, which is what makes the fetch ask for a smaller picture", () => {
    expect(new ProviderTooSlow(45000)).toBeInstanceOf(NotAnImage);
  });

  it("keeps the clock generous enough for the picture this platform now asks for", () => {
    // The worst of four live 2400 px fetches was 29.5 s. A ceiling under that
    // fails a working village, which is exactly what shipped.
    expect(FETCH_TIMEOUT_MS).toBeGreaterThan(30000);
  });
});
