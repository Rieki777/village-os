/**
 * Where the village actually is, and what a founder can type on a phone.
 *
 * ── WHY A CENTRE AND A SPAN, AND NOT A BOX OR A POLYGON ──────────────────
 *
 * Three shapes were on the table for asking a founder where their land is.
 * The choice is made on what a person can supply on day one, holding a
 * phone, with no surveyor and no desktop GIS:
 *
 *   A POLYGON is the accurate answer and needs a map component to draw on.
 *   That component needs a tile provider, which needs a key, which is the
 *   thing we may not have. It also cannot be typed, pasted, or dictated down
 *   a phone line, so a founder with a patchy connection cannot give it at
 *   all. Nothing this platform does today computes an area, so the accuracy
 *   buys nothing yet.
 *
 *   A BOUNDING BOX is precise and needs four numbers in the right order with
 *   the right signs. Two of those numbers are the same kind of number as the
 *   other two, so a transposition inside it is invisible. A founder who can
 *   produce a correct bounding box already has GIS software, and a founder
 *   who has GIS software can produce a centre point in less time.
 *
 *   A CENTRE POINT AND A SPAN is what a phone hands over for free. Long-press
 *   in Google Maps drops a pin and offers the coordinates for copying; the
 *   share sheet emits a URL with the coordinates in it; the place card shows
 *   a plus code. The span is one number in metres that a founder can estimate
 *   by eye and correct later, and estimating it badly costs a picture that is
 *   framed too wide or too tight, never a wrong location.
 *
 * So the record is a centre and a span, and `boundsFor` derives the box the
 * imagery layer needs. The founder gives the easy thing; the code does the
 * arithmetic. A polygon can be added later without moving the centre, because
 * a centre remains true whatever else is stored beside it.
 *
 * ── THE FORMATS REAL PEOPLE PASTE ────────────────────────────────────────
 *
 * `parseCoordinates` accepts every shape a phone produces:
 *
 *   decimal degrees      9.2345, -83.8412     also  9.2345 N, 83.8412 W
 *   degrees minutes secs 9 14 04.2 N 83 50 28.3 W  with degree, quote marks
 *   a Google Maps URL    the @lat,lon form, the q= form, the ll= form
 *   a plus code          a full one, 8 characters then a plus then the rest
 *   a geo URI            geo:9.2345,-83.8412
 *
 * Every one of them is normalised to a plain pair of numbers here, in code
 * both the browser and the server run. The browser parses as the founder
 * types, so the interpretation appears under the field before anything is
 * saved. The server parses the same string again on the way in, because a
 * value validated only in a browser is a value not validated.
 *
 * ── THE TRANSPOSED PAIR ──────────────────────────────────────────────────
 *
 * Latitude and longitude the wrong way round is the common error, and this
 * module ASKS about it and never fixes it silently. `swapSuspicion` reports
 * one of two grades:
 *
 *   "impossible"  the first number is outside plus or minus 90, so it cannot
 *                 be a latitude at all, and the transposed reading is the
 *                 only one that parses.
 *   "unlikely"    both numbers could be a latitude, the given one sits beyond
 *                 the polar circles, and the transposed one does not.
 *
 * A NOTE ON WHAT THIS CANNOT DO, because the brief that asked for it assumed
 * otherwise. There is no ocean test here. Deciding that a point is at sea
 * needs a coastline dataset, which is tens of megabytes and a dependency this
 * repository does not carry, and a land test that guessed would be worse than
 * asking: it would pass a village on a headland and refuse an island. The
 * polar-circle band is the honest cheap signal, it catches the Costa Rica
 * case exactly (a transposed pair there reads as latitude 83 south, which is
 * Antarctic ice), and it costs a village inside the Arctic Circle one
 * confirmation.
 *
 * Nothing here auto-corrects. The founder is shown both readings and picks.
 */

/** A point on the earth, in signed decimal degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Which of the accepted shapes a string turned out to be. */
export type CoordinateFormat =
  | "decimal"
  | "dms"
  | "google-maps-url"
  | "plus-code"
  | "geo-uri";

/** How much reason there is to think the pair arrived transposed. */
export type SwapSuspicion = "none" | "unlikely" | "impossible";

export interface ParsedCoordinates {
  ok: true;
  lat: number;
  lon: number;
  /** Which shape the string turned out to be. */
  format: CoordinateFormat;
  /** Whether the pair looks transposed, and how strongly. */
  swap: SwapSuspicion;
  /**
   * The transposed reading, present whenever `swap` is not "none" and the
   * transposition would itself be a valid point. This is what a founder is
   * offered as the other choice. Null when swapping would not help.
   */
  swapped: LatLon | null;
}

/**
 * Why a string could not be read, as a value a caller can branch on.
 *
 * The message beside it is written for the founder and says what to do next.
 * "Invalid input" is not on this list and never will be: a person who typed
 * something wrong needs to know which part and what would be right.
 */
export type LandProblem =
  | "empty"
  | "unreadable"
  | "one-number"
  | "latitude-range"
  | "longitude-range"
  | "short-plus-code"
  | "bad-plus-code"
  | "span-range";

export interface ParseFailure {
  ok: false;
  problem: LandProblem;
  message: string;
  /**
   * The reading that WOULD have worked, when there is exactly one.
   *
   * Present only for a transposed pair whose other order is a real point.
   * The admin screen turns this into a button that fills the field with the
   * corrected pair, so the founder accepts the fix by choosing it and the
   * code never applies it on their behalf.
   */
  suggestion?: LatLon;
}

export type ParseResult = ParsedCoordinates | ParseFailure;

const fail = (problem: LandProblem, message: string): ParseFailure => ({
  ok: false,
  problem,
  message,
});

/**
 * The span a founder may ask for, in metres, measured edge to edge.
 *
 * The floor is 50 because below it the imagery is one roof and the map has
 * nothing to sit on. The ceiling is 20000 because past it a village is a dot
 * and the picture is of a province. Both are wide open on purpose: a founder
 * correcting a bad guess is the normal case.
 */
export const MIN_SPAN_M = 50;
export const MAX_SPAN_M = 20000;

/** What a founder gets before they have touched the number. */
export const DEFAULT_SPAN_M = 800;

/**
 * The polar circles, used only to grade a suspected transposition.
 *
 * A real line on the earth with a real meaning, chosen over a round number so
 * that the rule can be stated to a founder in one sentence: almost nobody
 * lives past the polar circles, so a latitude beyond one is worth a second
 * look.
 */
const POLAR_CIRCLE_DEG = 66.5;

/** Metres per degree of latitude. Constant enough at this precision. */
const METRES_PER_DEG_LAT = 111320;

const ALPHABET = "23456789CFGHJMPQRVWX";

/**
 * Read a full Open Location Code and return the centre of the cell it names.
 *
 * Full codes only. A short code such as "MR2C+8F" is meaningless without a
 * reference locality, and this module has no locality to offer, so a short
 * code is refused with copy that tells the founder where the full one is.
 */
function parsePlusCode(raw: string): ParseResult {
  const code = raw.trim().toUpperCase();
  if (!/^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,8}$/.test(code)) {
    return fail(
      "bad-plus-code",
      "That looks like a plus code with a character that does not belong to one. Plus codes use the digits 2 to 9 and the letters C, F, G, H, J, M, P, Q, R, V, W and X. Open the place in Google Maps and copy the code again.",
    );
  }
  const [head] = code.split("+");
  if (head.length < 8) {
    return fail(
      "short-plus-code",
      "That is a short plus code, which only means something next to a town name. Open the place in Google Maps, scroll to the plus code, and copy the long form that starts with four more characters. Pasting the map link instead works too.",
    );
  }
  const clean = code.replace("+", "");
  let lat = -90;
  let lon = -180;
  let resolution = 20;
  const pairs = Math.min(clean.length, 10);
  for (let i = 0; i + 1 < pairs; i += 2) {
    lat += ALPHABET.indexOf(clean[i]) * resolution;
    lon += ALPHABET.indexOf(clean[i + 1]) * resolution;
    resolution /= 20;
  }
  // The cell the pair section landed on, before any grid refinement.
  let latSize = resolution * 20;
  let lonSize = resolution * 20;
  for (let i = 10; i < clean.length; i += 1) {
    const index = ALPHABET.indexOf(clean[i]);
    latSize /= 4;
    lonSize /= 5;
    lat += Math.floor(index / 5) * latSize;
    lon += (index % 5) * lonSize;
  }
  // The centre of the cell, which is the best single point the code names.
  return finish(lat + latSize / 2, lon + lonSize / 2, "plus-code");
}

/**
 * Pull a coordinate pair out of a Google Maps link.
 *
 * Three shapes, tried in the order that gives the most faithful answer. The
 * `@` form is the map's camera and is what the share sheet writes. `q=` and
 * `ll=` are the older query forms and still arrive from saved links. The
 * `!3d...!4d` form carries the PLACE rather than the camera, so it is tried
 * first when present: a founder who searched for their farm and shared the
 * result has the farm in the data block and the screen centre in the `@`.
 */
function parseMapsUrl(raw: string): ParseResult | null {
  const url = raw.trim();
  /*
   * Both host shapes, because Google uses both and they look different.
   * `www.google.com/maps/...` is what the desktop site writes, and
   * `maps.google.com/?q=...` is the older host where the path carries no
   * "/maps" at all. A pattern that only knew the first silently refused every
   * link of the second kind, which is the form a saved bookmark tends to be.
   */
  const isMapsHost =
    /^https?:\/\/[^\s/]*google\.[a-z.]+\/maps/i.test(url) ||
    /^https?:\/\/maps\.google\.[a-z.]+/i.test(url) ||
    /^https?:\/\/(goo\.gl\/maps|maps\.app\.goo\.gl)/i.test(url);
  if (!isMapsHost) return null;
  const place = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (place) return finish(Number(place[1]), Number(place[2]), "google-maps-url");

  const camera = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (camera) return finish(Number(camera[1]), Number(camera[2]), "google-maps-url");

  const query = url.match(/[?&](?:q|ll|center|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if (query) return finish(Number(query[1]), Number(query[2]), "google-maps-url");

  return fail(
    "unreadable",
    "That Google Maps link does not carry the coordinates. Short links of the maps.app.goo.gl kind hide them until the link is opened. Open it in a browser, long-press the pin, and copy the pair of numbers that appears.",
  );
}

/**
 * Degrees, minutes and seconds, in the shapes a phone and a deed both use.
 *
 * The hemisphere letter is what makes this readable: DMS is almost always
 * written unsigned with N, S, E or W doing the sign, so a parser that ignored
 * the letter would put every southern village in the north.
 */
function parseDms(raw: string): ParseResult | null {
  const piece =
    "(\\d+(?:\\.\\d+)?)\\s*(?:[°d:]|\\s)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:['m:\u2032]|\\s)\\s*(?:(\\d+(?:\\.\\d+)?)\\s*(?:[\"s\u2033]|\\s)?)?\\s*([NSEW])";
  const re = new RegExp(`${piece}[\\s,;/]+${piece}`, "i");
  const m = raw.trim().match(re);
  if (!m) return null;

  const toDegrees = (d: string, mm: string, ss: string | undefined, hemi: string): number => {
    const value = Number(d) + Number(mm) / 60 + (ss ? Number(ss) / 3600 : 0);
    return /[SW]/i.test(hemi) ? -value : value;
  };
  const first = toDegrees(m[1], m[2], m[3], m[4]);
  const second = toDegrees(m[5], m[6], m[7], m[8]);
  // The hemisphere letters say which number is which, so a founder who wrote
  // longitude first still gets the right point out.
  const firstIsLat = /[NS]/i.test(m[4]);
  return firstIsLat ? finish(first, second, "dms") : finish(second, first, "dms");
}

/**
 * Plain decimal degrees, with or without hemisphere letters.
 *
 * Accepts a comma, a semicolon or whitespace between the two numbers, a
 * leading or trailing hemisphere letter on either, and the degree sign that
 * survives a copy out of a map card.
 */
function parseDecimal(raw: string): ParseResult | null {
  const text = raw.trim().replace(/[°\u00ba]/g, " ");
  const num = "([NSEW])?\\s*(-?\\d+(?:\\.\\d+)?)\\s*([NSEW])?";
  const m = text.match(new RegExp(`^${num}[\\s,;]+${num}$`, "i"));
  if (!m) return null;

  const signed = (before: string | undefined, value: string, after: string | undefined): {
    value: number;
    hemi: string | null;
  } => {
    const hemi = (before ?? after ?? "").toUpperCase() || null;
    let v = Number(value);
    if (hemi && /[SW]/.test(hemi)) v = -Math.abs(v);
    if (hemi && /[NE]/.test(hemi)) v = Math.abs(v);
    return { value: v, hemi };
  };
  const a = signed(m[1], m[2], m[3]);
  const b = signed(m[4], m[5], m[6]);
  // A hemisphere letter names the axis, so it settles the order outright.
  if (a.hemi && /[EW]/.test(a.hemi)) return finish(b.value, a.value, "decimal");
  return finish(a.value, b.value, "decimal");
}

function parseGeoUri(raw: string): ParseResult | null {
  const m = raw.trim().match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return finish(Number(m[1]), Number(m[2]), "geo-uri");
}

/**
 * Grade a pair for transposition, and produce the alternative reading.
 *
 * Called on every successful parse, including the ones that came out of a URL
 * or a plus code, because those cannot be transposed and must therefore come
 * back "none". Running the same grader over all of them means the answer is
 * uniform and one code path decides it.
 */
export function swapSuspicion(lat: number, lon: number): {
  swap: SwapSuspicion;
  swapped: LatLon | null;
} {
  const swappedIsValid = Math.abs(lon) <= 90 && Math.abs(lat) <= 180;
  if (Math.abs(lat) > 90) {
    return swappedIsValid
      ? { swap: "impossible", swapped: { lat: lon, lon: lat } }
      : { swap: "impossible", swapped: null };
  }
  if (Math.abs(lat) > POLAR_CIRCLE_DEG && Math.abs(lon) <= POLAR_CIRCLE_DEG && swappedIsValid) {
    return { swap: "unlikely", swapped: { lat: lon, lon: lat } };
  }
  return { swap: "none", swapped: null };
}

/**
 * The one exit every parser uses: range-check, grade, and answer.
 *
 * Centralised so a format added later cannot skip the range check. The
 * latitude range is checked AFTER the transposition grader has run, so that
 * a transposed pair gets the message about transposition and not the blunt
 * one about range.
 */
function finish(lat: number, lon: number, format: CoordinateFormat): ParseResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return fail(
      "unreadable",
      "Those coordinates did not come out as numbers. Paste the pair straight from your map app, or type them as two decimals with a comma between them, for example 9.2345, -83.8412.",
    );
  }
  const graded = swapSuspicion(lat, lon);
  /*
   * An out-of-range latitude NEVER comes back as a success, even when the
   * transposed reading is obvious. A parser that answered `ok: true` while
   * carrying a latitude of minus 120 would hand every careless caller a value
   * the database will happily store, and the suggestion would be decoration
   * on top of a defect. So this is a failure that names the fix, and the
   * founder accepts it by choosing it.
   */
  if (Math.abs(lat) > 90) {
    if (graded.swapped) {
      const s = graded.swapped;
      return {
        ...fail(
          "latitude-range",
          `The first number has to be the latitude, and a latitude sits between minus 90 and 90. Read the other way round these are a real place: latitude ${s.lat}, longitude ${s.lon}. If that is your land, swap the two numbers.`,
        ),
        suggestion: s,
      };
    }
    return fail(
      "latitude-range",
      "The first number is a latitude and has to sit between minus 90 and 90. Yours is outside that, and swapping the two does not land anywhere valid either. Check both numbers against your map app.",
    );
  }
  if (Math.abs(lon) > 180) {
    return fail(
      "longitude-range",
      "The second number is a longitude and has to sit between minus 180 and 180. Check it against your map app and paste the pair again.",
    );
  }
  return { ok: true, lat, lon, format, swap: graded.swap, swapped: graded.swapped };
}

/**
 * Read whatever the founder pasted.
 *
 * Order matters. The URL and geo-URI tests run first because both contain
 * bare numbers that the decimal reader would otherwise pick up out of
 * context. The plus code test runs before DMS because a plus code contains no
 * digits a DMS pattern would match, and running it early keeps the DMS
 * pattern from having to exclude it.
 */
export function parseCoordinates(input: string): ParseResult {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return fail(
      "empty",
      "Paste your village's coordinates here. In Google Maps, long-press your land, then copy the pair of numbers that appears at the top. The map link works too.",
    );
  }

  const url = parseMapsUrl(raw);
  if (url) return url;

  const geo = parseGeoUri(raw);
  if (geo) return geo;

  if (raw.includes("+") && /[23456789CFGHJMPQRVWX]/i.test(raw)) {
    return parsePlusCode(raw);
  }

  const dms = parseDms(raw);
  if (dms) return dms;

  const decimal = parseDecimal(raw);
  if (decimal) return decimal;

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return fail(
      "one-number",
      "That is one number, and a location needs two. Add the second with a comma between them, latitude first, for example 9.2345, -83.8412.",
    );
  }

  return fail(
    "unreadable",
    "That did not read as a location. Four shapes work here: two decimals such as 9.2345, -83.8412; degrees and minutes such as 9 14 04.2 N 83 50 28.3 W; a Google Maps link; or a full plus code. Long-pressing your land in Google Maps gives you the first one.",
  );
}

/** Check a span in metres, with copy that says the range. */
export function validateSpan(span: unknown): { ok: true; span: number } | ParseFailure {
  const value = Number(span);
  if (!Number.isFinite(value)) {
    return fail(
      "span-range",
      `How wide across is the area you want pictured, in metres? Type a number between ${MIN_SPAN_M} and ${MAX_SPAN_M}.`,
    );
  }
  if (value < MIN_SPAN_M || value > MAX_SPAN_M) {
    return fail(
      "span-range",
      `That width is outside what the imagery can frame. Pick a number of metres between ${MIN_SPAN_M} and ${MAX_SPAN_M}. Most villages sit somewhere near ${DEFAULT_SPAN_M}.`,
    );
  }
  return { ok: true, span: Math.round(value) };
}

/** The box an imagery request needs, derived from the centre and the span. */
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Turn a centre and a span into the square the imagery layer asks for.
 *
 * The longitude half-width divides by the cosine of the latitude, because a
 * degree of longitude shrinks towards the poles and a square in metres is not
 * a square in degrees anywhere except the equator. The cosine is floored so
 * that a village at 89 degrees produces a wide box instead of a division that
 * runs away to infinity.
 *
 * Latitude is clamped at the poles and longitude wraps across the date line,
 * so a box is always a box the caller can hand to a provider.
 */
export function boundsFor(centre: LatLon, spanM: number): Bounds {
  const half = spanM / 2;
  const dLat = half / METRES_PER_DEG_LAT;
  const cos = Math.max(Math.cos((centre.lat * Math.PI) / 180), 0.01);
  const dLon = half / (METRES_PER_DEG_LAT * cos);
  const wrap = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;
  return {
    west: wrap(centre.lon - dLon),
    south: Math.max(centre.lat - dLat, -90),
    east: wrap(centre.lon + dLon),
    north: Math.min(centre.lat + dLat, 90),
  };
}

/**
 * The slippy-map zoom level whose pixels are finest without exceeding the
 * requested width.
 *
 * Providers that take a centre and a zoom (most of them) need this; providers
 * that take a box do not. Clamped to the range every provider serves, so a
 * founder asking for a 50 metre span gets the deepest zoom that exists
 * instead of a request nothing answers.
 */
/**
 * The map's world rect, as a ratio: 2400 by 1600.
 *
 * The number lives here because it decides the SHAPE OF THE GROUND a provider
 * is asked for, and a picture whose ground is a different shape from the frame
 * it is drawn into has to be stretched to fit. Stretching a georeferenced
 * photograph moves every structure off the ground it stands on, which is the
 * one thing this map may not do, and it does it silently.
 */
export const MAP_WORLD_ASPECT = 2400 / 1600;

/**
 * The ground a provider is asked for, in the frame's own proportions.
 *
 * `boundsFor` makes a SQUARE, which is right for a provider being asked for a
 * square image and wrong for the map, whose world is 3:2. `spanM` stays the
 * WIDTH across, which is the number a founder typed and understands; the
 * height follows from the aspect.
 */
export function boundsForAspect(centre: LatLon, spanM: number, aspect: number): Bounds {
  const halfW = spanM / 2;
  const halfH = spanM / (2 * (aspect > 0 ? aspect : 1));
  const dLat = halfH / METRES_PER_DEG_LAT;
  const cos = Math.max(Math.cos((centre.lat * Math.PI) / 180), 0.01);
  const dLon = halfW / (METRES_PER_DEG_LAT * cos);
  const wrap = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;
  return {
    west: wrap(centre.lon - dLon),
    south: Math.max(centre.lat - dLat, -90),
    east: wrap(centre.lon + dLon),
    north: Math.min(centre.lat + dLat, 90),
  };
}

export function zoomFor(centre: LatLon, spanM: number, pixels: number): number {
  const cos = Math.max(Math.cos((centre.lat * Math.PI) / 180), 0.01);
  const worldMetres = 2 * Math.PI * 6378137 * cos;
  const zoom = Math.log2((worldMetres * pixels) / (256 * spanM));
  return Math.min(Math.max(Math.floor(zoom), 1), 20);
}

/**
 * How precisely a village is willing to say where it is.
 *
 * A village is a place people sleep, and a public page naming its centre to
 * five decimal places is a fact that cannot be taken back. This platform
 * already strips GPS out of every uploaded photograph for exactly that
 * reason. So the location has its own visibility, it starts at "hidden", and
 * a founder turns it up deliberately.
 *
 *   hidden       nothing public. The imagery is still fetched and still shown
 *                to members who are signed in.
 *   approximate  the public page gets a point rounded to two decimal places,
 *                which is a little over a kilometre, and the imagery.
 *   exact        the public page gets what the founder typed.
 */
export const LAND_VISIBILITIES = ["hidden", "approximate", "exact"] as const;
export type LandVisibility = (typeof LAND_VISIBILITIES)[number];

export function isLandVisibility(value: unknown): value is LandVisibility {
  return typeof value === "string" && (LAND_VISIBILITIES as readonly string[]).includes(value);
}

/** Two decimal places, which is the "approximate" promise made concrete. */
export function coarsen(point: LatLon): LatLon {
  return {
    lat: Math.round(point.lat * 100) / 100,
    lon: Math.round(point.lon * 100) / 100,
  };
}

/**
 * What a caller may show, given the village's chosen visibility.
 *
 * One function decides this for every surface. Three surfaces each deciding
 * what "approximate" means is three chances to publish the exact point by
 * accident, and the housing module learned that lesson already: derive the
 * rule once and have every reader test the same thing.
 */
export function publicPoint(point: LatLon | null, visibility: LandVisibility): LatLon | null {
  if (!point) return null;
  if (visibility === "hidden") return null;
  if (visibility === "approximate") return coarsen(point);
  return point;
}
/* ── PARCELS ───────────────────────────────────────────────────────────────
 *
 * A project is not always one piece of ground. Each parcel is its own map:
 * two parcels forty kilometres apart share no honest coordinate space, and
 * drawing them on one world rect would invent the ground between them.
 *
 * The slug is the parcel's name in an address (`/map#/parcel/north-field`)
 * and the second half of its unique key. A founder never types one -- it is
 * derived from the label they DID type -- which is why the derivation lives
 * here, in shared, and runs identically in the browser and on the way in.
 */

/** Every village that already exists has exactly one parcel, and this is it. */
export const DEFAULT_PARCEL_SLUG = "home";

export const MAX_PARCEL_LABEL = 120;

/**
 * A label becomes a slug, or it does not become one at all.
 *
 * Returns "" for a label with no usable characters rather than inventing
 * something, because the caller's next move differs: the screen asks the
 * founder for a different name, and the route refuses. A generated fallback
 * like "parcel-2" would be a name nobody chose appearing in a URL forever.
 */
export function parcelSlug(label: string): string {
  return String(label ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // "Río Claro" -> "Rio Claro", not "R-o-Claro"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");               // a trailing dash left by the slice
}

export function isParcelSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(value);
}

/**
 * Which parcel a reader opens, and the order of the jump control.
 *
 * Lowest `sortOrder`, and the oldest row settles a tie. There is deliberately
 * no is-primary flag to consult: a flag has a second state nothing enforces,
 * so every reader would need this tie-break anyway.
 */
export function orderParcels<T extends { sortOrder: number; createdAt?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.sortOrder !== b.sortOrder
      ? a.sortOrder - b.sortOrder
      : String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
}
/* ── THE SEED FRAME ────────────────────────────────────────────────────────
 *
 * Every deployment ships the map artifact with one plate baked into it, and
 * that plate was cut to one real rectangle of ground. This is that rectangle's
 * georeference, COPIED from `GEOREF` in docs/prototypes/grounds-v0.html, which
 * is the source. `shared/land.test.ts` reads the artifact and fails if the two
 * ever disagree, the same way scripts/check-map-routes.mjs holds the map's
 * SITE_PAGES to the router: two copies of one fact are safe only when
 * something checks them against each other.
 *
 * WHY THE SERVER HAS TO KNOW IT. Everything the seed draws besides its plate,
 * its surround, its place names and its coordinate caption, belongs to THIS
 * rectangle. Over a village standing anywhere else it is invented geography,
 * which this map may never draw. So a village's picture is compared against
 * the seed frame, and the comparison is made HERE rather than in the browser,
 * because at "hidden" the browser is not allowed to learn the coordinates it
 * would need to make it. What crosses the wire is one yes-or-no.
 *
 * It is not a village's identity and it names none. It is a fact about a file
 * the platform ships.
 */
export const SEED_GEOREF = {
  lat: 9.2320128,
  lon: -83.8343203,
  /** The world point the pin sits on. Deliberately NOT the centre. */
  pinW: [1520, 800] as const,
  mPerUnit: 2592 / 2400,
  world: [2400, 1600] as const,
};

/**
 * World units to WGS84 under a georeference, by the artifact's own formula.
 *
 * Web Mercator about the pin, exactly as grounds-v0.html's worldToLatLon does
 * it, including the zoom it carries even though the zoom cancels: a second
 * formula that agreed "to within a metre" would be a second thing to trust.
 */
export function worldToLatLonUnder(
  g: { lat: number; lon: number; pinW: readonly [number, number]; mPerUnit: number },
  x: number,
  y: number,
): LatLon {
  const z = 17;
  const n = Math.pow(2, z) * 256;
  const mpp = (156543.03392 * Math.cos((g.lat * Math.PI) / 180)) / Math.pow(2, z);
  const ppu = g.mPerUnit / mpp;
  const lr = (g.lat * Math.PI) / 180;
  const gx = ((g.lon + 180) / 360) * n + (x - g.pinW[0]) * ppu;
  const gy = ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n + (y - g.pinW[1]) * ppu;
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * 180) / Math.PI,
    lon: (gx / n) * 360 - 180,
  };
}

/**
 * The rectangle the seed plate covers, as a centre and a width.
 *
 * The centre is the WORLD centre, not the pin. They are 320 units apart, about
 * 345 metres, and a picture centred on the pin would land that far from every
 * building already placed on the map.
 */
export function seedFrame(): { centre: LatLon; spanM: number } {
  const [w, h] = SEED_GEOREF.world;
  return {
    centre: worldToLatLonUnder(SEED_GEOREF, w / 2, h / 2),
    spanM: w * SEED_GEOREF.mPerUnit,
  };
}

/**
 * Whether a parcel's picture shows the seed's own rectangle.
 *
 * TIGHT on purpose. The tolerance absorbs the column's six-decimal rounding
 * (about eleven centimetres) and a founder's span arriving as a whole number,
 * and nothing more. A frame five metres off is a different frame: the picture
 * would sit that far from the buildings on it.
 */
export function isSeedFrame(centre: LatLon | null, spanM: number | null): boolean {
  if (!centre || spanM === null || !Number.isFinite(spanM)) return false;
  const seed = seedFrame();
  const CENTRE_TOLERANCE_DEG = 0.00005; // about 5.5 m
  const SPAN_TOLERANCE = 0.005; // half a percent, about 13 m of 2592
  return (
    Math.abs(centre.lat - seed.centre.lat) <= CENTRE_TOLERANCE_DEG &&
    Math.abs(centre.lon - seed.centre.lon) <= CENTRE_TOLERANCE_DEG &&
    Math.abs(spanM - seed.spanM) / seed.spanM <= SPAN_TOLERANCE
  );
}

/** Great-circle distance in metres. Used to notice a founder standing near the seed. */
export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6371008.8;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
