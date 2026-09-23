# Where the village is

A village tells the platform where it stands, and the Living Map shows the real
ground instead of somebody else's valley.

This document is the as-built map of that feature, the evaluation behind the
imagery choice, and the field-by-field specification of the admin screen that
has not been built yet.

**Code:** `shared/land.ts`, `server/lib/satellite.ts`, `server/routes/land.ts`,
`drizzle/0123_village_land.sql`.
**Tests:** `shared/land.test.ts`, `server/lib/satellite.test.ts`,
`server/routes/land.test.ts`.

---

## 1. What a founder is asked for, and why it is that

A founder gives **a centre point and a width in metres**. The code derives the
bounding box and the zoom level (`boundsFor`, `zoomFor` in `shared/land.ts`).

Three shapes were considered. The choice turns on what a person can supply on
day one, holding a phone, with no surveyor and no desktop GIS.

| Shape | Accuracy | Can a founder give it on day one? |
|---|---|---|
| Polygon | Exact | No. Needs a map component to draw on, which needs a tile provider, which needs the key we may not have. Cannot be typed, pasted, or read down a phone. |
| Bounding box | Exact | Rarely. Four numbers in the right order with the right signs, and two of them are the same kind of number as the other two, so a transposition inside it is invisible. Anyone who can produce one already has GIS software. |
| **Centre and span** | Approximate | **Yes.** A long-press in Google Maps offers the coordinates for copying. The share sheet emits a URL carrying them. The place card shows a plus code. The span is one number a founder can estimate by eye. |

The accuracy a polygon buys is not spent anywhere. Nothing in this platform
computes an area or a boundary today; the coordinates exist to frame a
photograph. Getting the span wrong costs a picture framed too wide or too
tight, and it is corrected by typing a different number. Getting the centre
wrong is the only real failure, and a centre is the part that is easy to give.

A polygon can be added later beside the centre without moving it, because a
centre stays true whatever else is stored next to it.

## 2. What a founder can paste

`parseCoordinates` in `shared/land.ts` accepts all of these, and the browser and
the server run the same function on the same string.

| Format | Example |
|---|---|
| Decimal degrees | `9.2345, -83.8412` |
| Decimal with hemispheres | `9.2345 N, 83.8412 W` or `N9.2345 W83.8412` |
| Degrees, minutes, seconds | `9°14'04.2"N 83°50'28.3"W`, and the bare-spaces form |
| Google Maps URL | the `@lat,lon` camera form, the `!3d/!4d` place form, and `?q=` / `?ll=` |
| Plus code | a full code, `8FVC2222+22` |
| geo URI | `geo:9.2345,-83.8412` |

Two behaviours worth knowing:

- **Hemisphere letters settle the order.** `83.8412 W, 9.2345 N` is read
  correctly even though the longitude came first, because the letters say which
  number is which.
- **The place beats the camera.** In a Google Maps URL carrying both, the
  `!3d/!4d` block is the pin the founder searched for and the `@` is wherever
  the screen happened to sit. The pin wins.

**Not supported, deliberately:** short plus codes (`MR2C+8F`). They are
meaningless without a reference locality and this feature has none to offer.
The refusal says where to find the long form.

**Not supported, a real gap:** `maps.app.goo.gl` short links. The coordinates
are not in the URL, they are behind a redirect. Resolving one means an outbound
request to Google from the server on a string a user supplied, which is a
request-forgery surface, so it is refused with copy telling the founder to open
the link and long-press instead.

## 3. The transposed pair

Latitude and longitude the wrong way round is the error that actually happens.
`swapSuspicion` grades it and **nothing is ever corrected silently**.

| Grade | Condition | What happens |
|---|---|---|
| `impossible` | The first number is outside ±90, so it cannot be a latitude | The parse **fails** and carries a `suggestion` holding the other reading |
| `unlikely` | Both numbers could be a latitude, the given one is beyond the polar circles, the other is not | The parse succeeds, `PUT` **refuses** with `swap-suspected` until the founder sends `confirmSwapped: true` |
| `none` | Neither | Saves |

An out-of-range latitude never comes back as a success. A parser that answered
`ok: true` while carrying a latitude of −120 would hand every careless caller a
value the database will happily store.

**A correction to the brief that asked for this.** The brief said a transposed
pair is "usually detectable, since most villages are not in the ocean". There is
no ocean test here and there should not be one: deciding a point is at sea needs
a coastline dataset, which is tens of megabytes and a dependency this repository
does not carry, and a land test that guessed would pass a village on a headland
and refuse an island. The polar-circle band is the cheap honest signal. It
catches the Costa Rica case exactly, because a transposed Costa Rican pair reads
as latitude 83 south, which is Antarctic ice.

**The known cost:** a village inside the Arctic Circle, such as Longyearbyen at
78.2 N, trips the check and confirms once. That is asserted as a test, not
discovered later.

## 4. The imagery, and the finding that shaped the design

Licence terms read on 2026-08-31. **These are readings of documents, and they
need re-reading when a provider changes terms.** The tests prove the code
matches these readings; they cannot prove the readings are right.

| Provider | May we fetch once, store it, and serve our copy? | Attribution | Key | Ground resolution |
|---|---|---|---|---|
| **Village's own aerial photo** | **Yes.** The village owns it | None owed | None | ~5 cm by drone |
| **Copernicus Sentinel-2** | **Yes.** Free and open, including commercial use and redistribution | "Contains modified Copernicus Sentinel data \[year\]" | A WMS endpoint | **10 m** |
| Mapbox Static Images | **No** | Mapbox + OpenStreetMap | `MAPBOX_TOKEN` | ~0.5 m |
| Google Maps Static | **No** | Google, baked into the image | `GOOGLE_MAPS_STATIC_KEY` | ~0.5 m |
| Esri World Imagery | **No**, not without a different licence | Esri and contributors | `ESRI_API_KEY` | ~0.5 m |

### The conflict at the centre of this lane

The brief required the fetched image to be **cached as an upload rather than
hotlinked**, because this repository lost six hero photographs in one week to a
hotlink whose far end got rebuilt. That requirement is right. It is also
incompatible with three of the four providers the brief listed:

- **Google Maps Platform** prohibits pre-fetching, indexing, storing and caching
  of Maps Content. The single exception is a temporary performance cache: under
  30 consecutive days, secure, and explicitly **not redistributed**. Serving a
  stored copy from our volume to a village's public page is redistribution.
- **Mapbox Product Terms** permit caching on an **end user's device** for 30
  days, then state that the customer shall not distribute map content
  "including from a cache, by proxying, or by using a screenshot or other static
  image" instead of calling the API directly. Fetching to our server and serving
  the file is the named prohibition.
- **Esri World Imagery** is governed by the Esri Master Licence Agreement, and
  the standard layer is not intended for exporting tiles to hold offline. Esri
  publishes a separate export layer, which is a licensing conversation and not
  an API key.

So the two providers that can be stored are **Copernicus Sentinel-2** and **the
village's own photograph**, and the design follows from that.

### One trap worth naming

The EOX "Sentinel-2 cloudless" mosaic at s2maps.eu is the obvious shortcut: a
free, global, cloud-free layer. Its 2018 to 2024 editions are **CC BY-NC-SA**,
non-commercial. A village platform is not reliably non-commercial, so that layer
is not a safe default even though it is free to fetch. Only the 2016 edition is
CC BY 4.0. Use the Copernicus data itself, whose licence has no such limit.

### Why the village's own photograph is the default

It beats all four on every axis that matters here. Centimetres where Sentinel
gives ten metres. The village holds the copyright, so there is no licence
question at all. No key, no billing account, no per-village provisioning. It
costs nothing at thirteen villages or at three hundred. It is current, because
the founder took it this month. And it works in exactly the rural terrain where
commercial satellite coverage is worst and most out of date.

Sentinel-2 is the fallback for a village with no drone, and it is honest about
being coarse: at 10 m per pixel a 300-metre village is thirty pixels across.
That is enough to say which valley. It is nowhere near enough to place a
greenhouse.

### Cost, and why it is not the deciding factor

**Not verified in this lane:** current price cards. It did not change the
answer, and here is why. The request volume is one image per village per
refresh. Thirteen villages setting up and refetching a few times is tens of
requests in total, which sits inside every provider's free tier by three orders
of magnitude. **Cost is not what rules these providers out. The licence is.**
Anyone revisiting this should check prices only after checking terms.

### Sharing a key across thirteen villages

A real operational finding, and an argument for the default:

- **One shared key** across thirteen deployments means one bill, one rate limit,
  and any single village able to exhaust both for the other twelve. It also puts
  the licence obligations on whoever owns the key for imagery published on
  thirteen sites they do not control.
- **Per-village keys** mean thirteen billing accounts and thirteen founders each
  completing a Google or Mapbox signup, which is a step several will not finish.
- **The village's own photograph** needs no key, which is why it is the default.

## 5. How the code is shaped

One provider behind a seam, the key read from the environment, and a village
with no key getting an honest empty state.

```
shared/land.ts        parsing, validation, bounds, zoom, visibility. Browser and server both.
server/lib/satellite.ts  the provider registry, the licence data, fetch and cache
server/routes/land.ts    four routes
drizzle/0123_...sql      one row per village
```

**The invariant that makes the research durable:** `cacheAsUpload` refuses to
write any provider whose `caching` is `forbidden`, and it checks **before** any
byte is written and before any paid request is spent. Without that check, the
evaluation above is a paragraph somebody deletes in six months and the first
village to paste a Mapbox token puts the project in breach without anybody
choosing to.

Every byte goes through `server/lib/uploads.ts`, so the image is re-encoded with
no metadata and the result is checked before storing, and
`scripts/check-upload-strip.mjs` stays green.

### Environment variables

| Variable | Meaning |
|---|---|
| `SATELLITE_PROVIDER` | One of `village-upload`, `esri-open`, `sentinel2`, `mapbox`, `google`, `esri`. Unset means no imagery, which is an honest empty state and not an error. `esri-open` needs no key and is what this project runs; see FORK_RUNBOOK for what naming it means |
| `SENTINEL_WMS_URL` | The WMS base URL for Sentinel-2 |
| `MAPBOX_TOKEN`, `GOOGLE_MAPS_STATIC_KEY`, `ESRI_API_KEY` | Per-provider keys |
| `SATELLITE_CACHE_OVERRIDE` | The escape hatch. Set it to **the provider's id**, for a deployment that holds its own written agreement |

`SATELLITE_CACHE_OVERRIDE` is deliberately not a boolean. Naming the provider
means the person setting it has one specific contract in mind, and a stray `1`
in an env file cannot switch on redistribution for everything.

## 6. The admin screen, specified

**This screen does not exist yet.** `client/src/pages/Admin.tsx` was held by
another wave while these routes were built. Both write routes carry a line in
`scripts/check-admin-reach.mjs` recording that, and **both lines come out the
day this screen lands.**

Put it in Project Settings, beside Map and styling.

### Fields

| Field | Control | Validation | Notes |
|---|---|---|---|
| Location | Single-line text | `parseCoordinates` **in the browser, as they type** | Import from `@shared/land`. Show the interpretation live under the field |
| Width across | Number, metres | `validateSpan`. 50 to 20000 | Default 800 |
| Who can see this | Three radios | `hidden` / `approximate` / `exact` | Default `hidden`. Label them with what they mean, not their ids |

**What the three settings actually control, and the limit a founder must be
told.** They govern the **coordinates**, and only the coordinates:

| Setting | A stranger loading the site gets |
|---|---|
| `hidden` | No point at all |
| `approximate` | The point rounded to two decimals, a little over a kilometre |
| `exact` | What the founder typed |

**The aerial photograph is served at every setting, including `hidden`.** The
picture is what makes the map worth looking at, and a photograph of trees is not
a street address. It is also not nothing: somebody determined could match a
distinctive coastline or roofline against public imagery. So the screen must say
this in plain words next to the radios, along the lines of "your picture is
shown to visitors at every setting; remove it if you would rather it were not."
A founder can then make the choice knowing what it is. Hiding this behaviour
would be the failure, because the setting is named in a way that invites a
founder to assume it covers everything.

Because parsing is in `shared/`, the screen gives instant feedback with no round
trip. The server re-parses on the way in regardless: a value validated only in a
browser is a value not validated.

### Live feedback under the location field

- **Parsed.** Show `format` in words ("read as a Google Maps link") and the
  decimal pair. Seeing the numbers is how a founder catches a wrong pin.
- **`swap: "unlikely"`.** Amber. Show both readings and a button that fills the
  field with the other one. Do not block typing.
- **Parse failed.** Show `message` verbatim. **The copy is written for the
  founder and already says what to do.** Do not replace it with "Invalid input";
  a test asserts that word never appears.
- **`suggestion` present on a failure.** Offer a button that fills the field with
  it.

### The requests

Save the location:

```http
PUT /api/admin/land
Content-Type: application/json

{ "text": "9.2345, -83.8412", "spanM": 800, "visibility": "approximate" }
```

`text` is what the founder typed, unparsed. Alternatively send `lat` and `lon`
as numbers. Add `"confirmSwapped": true` only after the founder has looked at
both readings and chosen.

Responses:

| Status | Body | Screen does |
|---|---|---|
| 200 | `{ success, centre, spanM, visibility }` | Confirm, then offer Fetch the picture |
| 400 | `{ error: "swap-suspected", message, given, suggestion }` | Show both, one button per reading |
| 400 | `{ error: <problem>, message, suggestion }` | Show `message`; offer `suggestion` when present |

Fetch the picture:

```http
POST /api/admin/land/imagery
```

No body. Reads the saved location.

| Status | Body | Screen does |
|---|---|---|
| 200 | `{ success, url, attribution, bytes }` | Show the image and the attribution line |
| 400 | `{ error: "no-location" }` | Should not happen; the button is disabled until saved |
| 409 | `{ error: "no-provider" \| "provider-not-ready" }` | Show `message`. Do not offer the button in this state |
| 409 | licence refusal | Show `message`. This is a configuration decision for whoever holds the contract |
| 502 | `{ error: "imagery-failed", message }` | Show `message` and let them retry |

Read the current state with `GET /api/admin/land`. It returns the record, a
`configured` block saying what this deployment can actually do, and the
`providers` catalogue with each licence reading. **Use `configured.ready` to
decide whether to show the fetch button at all**, so a founder is never offered
a button that cannot work.

### Attribution is not optional

Wherever the image renders, render `attribution` beside it when it is non-empty.
For Copernicus that string is the licence condition being met.

## 7. Ready for thirteen

### What each founder does

1. Open Project Settings, Land.
2. Long-press their land in Google Maps and paste. About ten seconds.
3. Check the interpretation under the field. Confirm or fix a transposition.
4. Set the width across. The default is usually close.
5. Choose who can see it. **It starts hidden and stays hidden until they choose.**
6. Press Fetch the picture, or upload their own aerial photograph.

### What we do once

- Decide the fleet default for `SATELLITE_PROVIDER`. **The recommendation is to
  ship with none set**, and to ask each founder for a drone photograph in
  onboarding. That needs no key, no billing, no licence, and it produces a
  better picture than any satellite option.
- If a satellite fallback is wanted, stand up one Sentinel-2 WMS endpoint and
  set `SENTINEL_WMS_URL` on all thirteen. Copernicus permits the storing and the
  serving, so one endpoint for the fleet is licence-clean.
- Apply migration 0123 on each deployment. Deploys do not run migrations.
- Do **not** put a Mapbox or Google key on the fleet. It cannot be cached, and
  the code will refuse rather than breach.

### What breaks if a founder skips this entirely

**Nothing breaks.** This is the part that had to be true before anything else
mattered.

- `GET /api/land` answers `configured: false` with a null centre and a null
  image address. It is a fact the map can render as "this village has not placed
  itself yet".
- The Living Map keeps working. It draws the scene the village published, or the
  artifact's own seed. The land record adds a photograph under it and is not
  load-bearing for anything else.
- No broken image, ever. `imageryUrl` is null rather than an address that 404s.
- A village that sets coordinates but has no provider configured gets the same
  honest empty state and a message saying so.

The one thing a founder loses by skipping is the aerial photograph under their
map, which means they place structures over the artifact's default ground.

## 8. Open, and deliberately not done

- **The admin screen.** Section 6 specifies it. Two allowlist lines come out
  when it lands.
- **Reverse geocoding.** Turning a pasted town name into coordinates needs a
  geocoding provider and its own licence reading. A founder can paste a Maps
  link instead, which is fewer steps.
- **The village's own photograph has no upload route yet.** The provider entry
  and the storage path exist; the form does not. It belongs with the admin
  screen and is the highest-value follow-up in this area.
- **Georeferencing an uploaded photo** is assumed rather than measured: the
  centre and span are taken as the photo's frame. A founder whose drone shot is
  off-centre has no way to nudge it. Fine for a backdrop, wrong for survey work,
  and worth stating before somebody assumes otherwise.
- **`maps.app.goo.gl` links.** Section 2 says why they are refused.
