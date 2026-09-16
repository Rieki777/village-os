/**
 * Photographs of a place, against the built server (0093).
 *
 * What this suite holds that a unit test cannot:
 *
 *  - THE EXIF PROOF ON THE VOLUME. A genuinely geotagged JPEG goes up through
 *    the real route, and the bytes are then read back off the uploads
 *    directory the server wrote them to. `server/lib/placePhotos.test.ts`
 *    proves the encoder strips; this proves the PRODUCT does, end to end.
 *  - THE SUBJECT'S RIGHT, including the half that a hidden row does not give
 *    you: after a subject request, `/api/uploads/<file>` stops answering. A
 *    row that leaves the gallery while the bytes stay fetchable by anyone
 *    holding the address is exactly what the person was asking to stop.
 *  - A REPORT REACHING A HUMAN. The queue is read by a curator who is NOT an
 *    admin, holding the capability through a badge, and closing a card
 *    notifies the member who raised it.
 *  - The gate: a member without `map.curatePhotos` cannot take down somebody
 *    else's photograph, and can always take down their own.
 *  - The dials: per-place and per-member limits refuse, and 0 means zero.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import sharp from "sharp";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { FIXTURE_CAMERA, buildGeotaggedJpeg } from "./lib/exifFixture";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[placePhotos.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 22702 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "places-admin";
const PLACE = "community-kitchen";
const OTHER_PLACE = "north-terrace";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";

let solToken = "";
let solId = "";
let wrenToken = "";
let wrenId = "";
let talToken = "";
let talId = "";

async function call(method: string, route: string, body?: unknown, token = founderToken) {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON stays visible through text */
  }
  return { status: res.status, json, text };
}

/** The bytes of an uploads address, and the status the route answered. */
async function fetchUpload(address: string, token = ""): Promise<{ status: number; bytes: Buffer }> {
  const res = await fetch(BASE + address, { // module-review-ok: the test client dialling the built server on localhost
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: buf };
}

async function geotagged(tint: number): Promise<Buffer> {
  const plain = await sharp({
    create: { width: 240, height: 180, channels: 3, background: { r: tint, g: 90, b: 60 } },
  })
    .jpeg()
    .toBuffer();
  return buildGeotaggedJpeg(plain);
}

async function upload(
  token: string,
  bytes: Buffer,
  fields: { altText: string; caption?: string; takenOn?: string },
  place = PLACE,
) {
  const form = new FormData();
  form.append("photo", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "wall.jpg");
  form.append("altText", fields.altText);
  if (fields.caption) form.append("caption", fields.caption);
  if (fields.takenOn) form.append("takenOn", fields.takenOn);
  const res = await fetch(`${BASE}/api/places/${encodeURIComponent(place)}/photos`, { // module-review-ok: the test client dialling the built server on localhost
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON stays visible through text */
  }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: "PlacesTest123!", paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the place photo route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-places-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "places-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      // The uploads volume gauge (server/index.ts, owned by the SRVHARD
      // lane) caches its answer behind a ONE SECOND floor with no test-visible
      // bypass: a request landing under 1s after the previous cache fill gets
      // served the stale value even when the directory's mtime moved, which
      // is a live flake risk for "reports what the photographs are using on
      // the volume" below. This env var is a NO-OP today; it takes effect
      // once server/index.ts reads UPLOADS_GAUGE_MIN_INTERVAL_MS from the
      // environment (SEASON2_FLEET_LEDGER.md 8a's follow-up, filed for
      // SRVHARD). Setting it to 0 here means the floor can never fire for
      // this suite once that lands, with no change needed on this side again.
      UPLOADS_GAUGE_MIN_INTERVAL_MS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Places Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "PlacesTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  // The map and badges modules both on: the map serves the routes, badges is
  // how a member who is not an admin comes to hold `map.curatePhotos`.
  for (const m of (await call("GET", "/api/admin/modules")).json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }

  const sol = await register("Sol Vega", "sol");
  solToken = sol.token;
  solId = sol.id;
  const wren = await register("Wren Ash", "wren");
  wrenToken = wren.token;
  wrenId = wren.id;
  const tal = await register("Tal Ferro", "tal");
  talToken = tal.token;
  talId = tal.id;

  for (const id of [solId, wrenId, talId]) {
    expect((await call("PUT", `/api/admin/players/${id}/stage`, { stageId: "member" })).status).toBe(200);
  }

  // Tal curates, and holds NOTHING else: a granted badge, no admin role, no
  // password. This is the R54 claim under test.
  const badge = (await call("POST", "/api/admin/badges", {
    name: "Keeper of the Record", kind: "granted", capabilities: ["map.curatePhotos"],
  })).json?.badge;
  expect(badge?.id, "the curator badge must exist").toBeTruthy();
  expect((await call("POST", `/api/admin/badges/${badge.id}/award`, { userId: talId, note: "Keeps the village's pictures" })).status).toBe(200);
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* gone */
  }
});

describe.skipIf(!DB_CONFIGURED)("photographs of a place", () => {
  let solPhotoId = "";
  let solPhotoUrl = "";
  let solThumbUrl = "";
  let wrenPhotoId = "";
  let terracePhotoId = "";

  it("takes a member's photograph and gives it back with attribution", async () => {
    const up = await upload(solToken, await geotagged(200), {
      altText: "The north wall of the community kitchen, half built",
      caption: "First course of block up.",
      takenOn: "2026-03-14",
    });
    expect(up.status, up.text).toBe(200);
    solPhotoId = String(up.json?.photo?.id ?? "");
    solPhotoUrl = String(up.json?.photo?.url ?? "");
    solThumbUrl = String(up.json?.photo?.thumbUrl ?? "");
    expect(solPhotoId).toBeTruthy();
    expect(solPhotoUrl.startsWith("/api/uploads/")).toBe(true);
    expect(up.json.photo.contributorName).toBe("Sol Vega");
    expect(up.json.photo.takenOn).toBe("2026-03-14");
    expect(up.json.photo.altText).toBe("The north wall of the community kitchen, half built");
  });

  it("STRIPS THE LOCATION DATA: the bytes on the volume carry no GPS", async () => {
    const uploads = path.join(dataDir, "uploads");
    const names = [solPhotoUrl, solThumbUrl].map((u) => path.basename(u));
    expect(names.length).toBe(2);
    for (const name of names) {
      const file = path.join(uploads, name);
      expect(fs.existsSync(file), `${name} must be on the volume`).toBe(true);
      const bytes = fs.readFileSync(file);
      // The parser's opinion...
      const meta = await sharp(bytes).metadata();
      expect(meta.exif, `${name} still carries an EXIF blob`).toBeFalsy();
      // ...and the bytes themselves, which is where a chunk no parser knows
      // about would still be sitting.
      expect(bytes.includes(Buffer.from(FIXTURE_CAMERA)), `${name} still names the camera`).toBe(false);
      expect(bytes.includes(Buffer.from("Exif")), `${name} still carries an EXIF container`).toBe(false);
      expect(bytes.includes(Buffer.from("GPS")), `${name} still carries a GPS marker`).toBe(false);
    }
  });

  it("serves the photograph over the uploads route", async () => {
    const got = await fetchUpload(solPhotoUrl);
    expect(got.status).toBe(200);
    expect((await sharp(got.bytes).metadata()).format).toBe("webp");
  });

  it("takes a second member's photograph of the same place, newest first", async () => {
    const up = await upload(wrenToken, await geotagged(40), { altText: "The same wall with the roof trusses up" });
    expect(up.status, up.text).toBe(200);
    wrenPhotoId = String(up.json?.photo?.id ?? "");
    const gallery = await call("GET", `/api/places/${PLACE}/photos`, undefined, solToken);
    expect(gallery.json.photos.map((p: any) => p.id)).toEqual([wrenPhotoId, solPhotoId]);
    expect(gallery.json.photos[1].contributorName).toBe("Sol Vega");
  });

  it("leads with the hero once a curator pins one, and a curator is not an admin", async () => {
    const pinned = await call("PUT", `/api/places/${PLACE}/hero`, { photoId: solPhotoId }, talToken);
    expect(pinned.status, pinned.text).toBe(200);
    const gallery = await call("GET", `/api/places/${PLACE}/photos`, undefined, solToken);
    expect(gallery.json.photos.map((p: any) => p.id)).toEqual([solPhotoId, wrenPhotoId]);
    // The shelf leads with the same picture the place does.
    const shelf = await call("GET", "/api/places", undefined, solToken);
    const place = shelf.json.places.find((p: any) => p.structureKey === PLACE);
    expect(place.coverUrl).toBe(solPhotoUrl);
    expect(place.photoCount).toBe(2);
  });

  it("puts every photograph on one page, newest first, whatever place it is filed under", async () => {
    // A second place, so the index is proving it crosses places rather than
    // repeating one gallery.
    const up = await upload(wrenToken, await geotagged(120), { altText: "The north terrace, newly dug" }, OTHER_PLACE);
    expect(up.status, up.text).toBe(200);
    terracePhotoId = String(up.json?.photo?.id ?? "");
    expect(terracePhotoId).toBeTruthy();

    const index = await call("GET", "/api/places/photos", undefined, solToken);
    expect(index.status, index.text).toBe(200);
    // Strictly newest first. The hero pinned two tests ago leads its own
    // place and must NOT float to the top of a page that says newest first.
    expect(index.json.photos.map((p: any) => p.id)).toEqual([terracePhotoId, wrenPhotoId, solPhotoId]);
    expect(index.json.photos[0].structureKey).toBe(OTHER_PLACE);
    expect(index.json.photos[1].structureKey).toBe(PLACE);
    // Three photographs is well under one page, so there is nothing older.
    expect(index.json.nextBefore).toBeNull();
  });

  it("carries on from the exact row the last page ended on", async () => {
    const index = await call("GET", "/api/places/photos", undefined, solToken);
    const first = index.json.photos[0];
    const cursor = `${first.createdAt}|${first.id}`;
    const older = await call("GET", `/api/places/photos?before=${encodeURIComponent(cursor)}`, undefined, solToken);
    expect(older.status, older.text).toBe(200);
    expect(older.json.photos.map((p: any) => p.id)).toEqual([wrenPhotoId, solPhotoId]);
  });

  it("refuses a cursor it cannot read instead of quietly starting again at the top", async () => {
    const broken = await call("GET", "/api/places/photos?before=not-a-cursor", undefined, solToken);
    expect(broken.status).toBe(400);
    // The failure this refusal prevents: a person scrolling for a picture of
    // themselves being handed the newest page dressed as the older one.
    expect(broken.json.photos).toBeUndefined();
  });

  it("refuses a photograph with no description of what is in it", async () => {
    const up = await upload(solToken, await geotagged(90), { altText: "  " });
    expect(up.status).toBe(400);
    expect(up.json.error).toContain("Describe the photograph");
  });

  it("refuses a member who does not hold the capability from taking down another's photograph", async () => {
    const refused = await call("DELETE", `/api/places/photo/${wrenPhotoId}`, undefined, solToken);
    expect(refused.status).toBe(403);
    const hide = await call("POST", `/api/places/photo/${wrenPhotoId}/hide`, {}, solToken);
    expect(hide.status).toBe(403);
  });

  it("carries a report to a queue a curator who is not an admin can read", async () => {
    const filed = await call("POST", `/api/places/photo/${solPhotoId}/report`, { reason: "That is my neighbour's gate in the corner." }, wrenToken);
    expect(filed.status, filed.text).toBe(200);
    expect(filed.json.fresh).toBe(true);

    // A member with no curate capability gets nothing from the queue.
    expect((await call("GET", "/api/places/reports", undefined, solToken)).status).toBe(403);

    const queue = await call("GET", "/api/places/reports?status=open", undefined, talToken);
    expect(queue.status, queue.text).toBe(200);
    const card = queue.json.reports.find((r: any) => r.photoId === solPhotoId);
    expect(card, "the report must be on the curator's queue").toBeTruthy();
    expect(card.kind).toBe("concern");
    expect(card.reporter).toBe("Wren Ash");
    expect(card.reason).toContain("neighbour's gate");
    // The card carries the picture, so the row is a decision and not an id.
    expect(card.photoUrl).toBe(solPhotoUrl);
    expect(card.photoAltText).toContain("north wall");
  });

  it("tells the member who reported that somebody looked", async () => {
    const queue = await call("GET", "/api/places/reports?status=open", undefined, talToken);
    const card = queue.json.reports.find((r: any) => r.photoId === solPhotoId);
    const closed = await call("PUT", `/api/places/reports/${card.id}`, { status: "resolved" }, talToken);
    expect(closed.status, closed.text).toBe(200);
    const bell = await call("GET", "/api/notifications", undefined, wrenToken);
    expect(bell.json.notifications.some((n: any) => n.type === "moderation" && n.link === "/places")).toBe(true);
    const handled = await call("GET", "/api/places/reports?status=resolved", undefined, talToken);
    expect(handled.json.reports.find((r: any) => r.id === card.id).resolvedBy).toBe("Tal Ferro");
  });

  it("hides a photograph the moment its subject asks, AND stops serving the bytes", async () => {
    const asked = await call("POST", `/api/places/photo/${solPhotoId}/subject-request`, { reason: "That is me on the ladder." }, wrenToken);
    expect(asked.status, asked.text).toBe(200);
    expect(asked.json.hidden).toBe(true);

    // Gone from the gallery for everyone who is not a curator.
    const gallery = await call("GET", `/api/places/${PLACE}/photos`, undefined, solToken);
    expect(gallery.json.photos.map((p: any) => p.id)).toEqual([wrenPhotoId]);

    // AND gone from the address. A hidden row whose file still answers is the
    // whole of what the person was asking to stop.
    expect((await fetchUpload(solPhotoUrl)).status).toBe(404);
    expect((await fetchUpload(solThumbUrl)).status).toBe(404);

    // The curator still sees it, because deciding means looking at it.
    const curatorView = await call("GET", `/api/places/${PLACE}/photos`, undefined, talToken);
    const hidden = curatorView.json.photos.find((p: any) => p.id === solPhotoId);
    expect(hidden.hiddenBy).toBe("subject");
  });

  it("KEEPS THE INDEX INSIDE THE PLACE PAGE PERMISSION: a hidden photograph reaches a curator and nobody else", async () => {
    // The claim under test. An index aggregates, and the classic way an index
    // leaks is by showing in one list what each of its sources refuses.
    // solPhotoId is hidden by the subject request in the test above.
    const inPlace = await call("GET", `/api/places/${PLACE}/photos`, undefined, solToken);
    expect(inPlace.json.photos.some((p: any) => p.id === solPhotoId), "the place page must already refuse it").toBe(false);

    const mine = await call("GET", "/api/places/photos", undefined, solToken);
    expect(mine.status, mine.text).toBe(200);
    expect(mine.json.photos.some((p: any) => p.id === solPhotoId), "the index must refuse it too").toBe(false);
    // Wren filed the request and still cannot see it here.
    const theirs = await call("GET", "/api/places/photos", undefined, wrenToken);
    expect(theirs.json.photos.some((p: any) => p.id === solPhotoId)).toBe(false);

    // And a curator, who CAN see it in its place, sees it here. An index
    // stricter than the place page would hide a decision from the person
    // whose job it is to make it.
    const curator = await call("GET", "/api/places/photos", undefined, talToken);
    const seen = curator.json.photos.find((p: any) => p.id === solPhotoId);
    expect(seen, "a curator sees the hidden row on the index as they do in the place").toBeTruthy();
    expect(seen.hiddenBy).toBe("subject");
  });

  it("closes the index to a visitor exactly when the map closes to one", async () => {
    // Anonymous reading rides `map.public_structure`, the same dial the place
    // page rides. On by default, so the visitor reads it.
    const open = await call("GET", "/api/places/photos", undefined, "");
    expect(open.status).toBe(200);
    expect(open.json.signedIn).toBe(false);

    expect((await call("PUT", "/api/admin/variables/map.public_structure", { value: "false" })).status).toBe(200);
    expect((await call("GET", "/api/places/photos", undefined, "")).status).toBe(401);
    // The place page and the index answer a visitor the same way.
    expect((await call("GET", `/api/places/${PLACE}/photos`, undefined, "")).status).toBe(401);
    expect((await call("GET", "/api/places/photos", undefined, solToken)).status).toBe(200);
    expect((await call("PUT", "/api/admin/variables/map.public_structure", { value: "true" })).status).toBe(200);
  });

  it("shows the hidden bytes to a curator and to nobody else", async () => {
    // The one exception to the suppression, and the reason it exists: a report
    // card that cannot show the photograph is a card nobody can decide.
    const curator = await fetchUpload(solPhotoUrl, talToken);
    expect(curator.status, "a curator must be able to look at what they are judging").toBe(200);
    expect((await sharp(curator.bytes).metadata()).format).toBe("webp");
    // A member who is signed in but holds no curate capability gets the same
    // 404 a stranger gets. Signing in is not a way around a takedown.
    expect((await fetchUpload(solPhotoUrl, wrenToken)).status).toBe(404);
    expect((await fetchUpload(solPhotoUrl, solToken)).status).toBe(404);
  });

  it("carries the subject's request to the same queue, marked as what it is", async () => {
    const queue = await call("GET", "/api/places/reports?status=open", undefined, talToken);
    const card = queue.json.reports.find((r: any) => r.photoId === solPhotoId && r.kind === "subject");
    expect(card, "a subject request must reach the queue").toBeTruthy();
    expect(card.photoHidden).toBe(true);
  });

  it("lets a curator put it back, and the bytes answer again", async () => {
    expect((await call("POST", `/api/places/photo/${solPhotoId}/restore`, {}, talToken)).status).toBe(200);
    expect((await fetchUpload(solPhotoUrl)).status).toBe(200);
    // A restore does not un-file the request: the card stays for the curator
    // to close deliberately.
    const queue = await call("GET", "/api/places/reports?status=open", undefined, talToken);
    expect(queue.json.reports.some((r: any) => r.photoId === solPhotoId && r.kind === "subject")).toBe(true);
  });

  it("lets the person who took a photograph take it down, and the file goes with it", async () => {
    const uploads = path.join(dataDir, "uploads");
    const name = path.basename(solPhotoUrl);
    expect(fs.existsSync(path.join(uploads, name))).toBe(true);
    const gone = await call("DELETE", `/api/places/photo/${solPhotoId}`, undefined, solToken);
    expect(gone.status, gone.text).toBe(200);
    expect(gone.json.removed).toBe(true);
    expect(fs.existsSync(path.join(uploads, name)), "the file must leave the volume").toBe(false);
    expect((await fetchUpload(solPhotoUrl)).status).toBe(404);
    // A takedown answers every open report on the picture.
    const queue = await call("GET", "/api/places/reports?status=open", undefined, talToken);
    expect(queue.json.reports.some((r: any) => r.photoId === solPhotoId)).toBe(false);
  });

  it("keeps the record of the takedown so a closed report still names something", async () => {
    const handled = await call("GET", "/api/places/reports?status=resolved", undefined, talToken);
    const card = handled.json.reports.find((r: any) => r.photoId === solPhotoId && r.kind === "subject");
    expect(card, "the subject's request survives the takedown as a record").toBeTruthy();
    expect(card.photoRemoved).toBe(true);
    expect(card.photoUrl).toBeNull();
  });

  it("TAKES THE WORDS DOWN WITH THE PICTURE: a photograph taken down for good keeps no description", async () => {
    // A description of a photograph is still a description of the person in
    // it. A takedown that leaves "The north wall of the community kitchen"
    // attached to a gone picture has removed the image and kept the sentence
    // about the people. solPhotoId was taken down for good two tests ago.
    const [rows]: any = await pool.query("SELECT alt_text, caption, url FROM place_photos WHERE id = ?", [solPhotoId]);
    expect(rows.length, "the tombstone row survives, because a closed report names it").toBe(1);
    expect(rows[0].alt_text, "the description is erased, not merely withheld").toBe("");
    expect(rows[0].caption).toBeNull();
    // The address stays, because the retention sweep still has to find the
    // file it unlinks. `removed_at` is what decides whether bytes are served.
    expect(String(rows[0].url).startsWith("/api/uploads/")).toBe(true);

    // And no surface a reader can reach carries it either. The curator queue
    // is the last one that held it: it nulls the picture on a takedown and
    // used to keep the sentence.
    const handled = await call("GET", "/api/places/reports?status=resolved", undefined, talToken);
    const cards = handled.json.reports.filter((r: any) => r.photoId === solPhotoId);
    expect(cards.length, "the takedown left records behind to check").toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.photoRemoved).toBe(true);
      expect(card.photoAltText, "a curator reads no description of a picture that is gone").toBeNull();
    }
    // Not on the index for anybody, curator included.
    for (const token of [solToken, wrenToken, talToken]) {
      const index = await call("GET", "/api/places/photos", undefined, token);
      expect(index.json.photos.some((p: any) => p.id === solPhotoId)).toBe(false);
    }
  });

  it("gives a restored photograph its description back, because hiding withholds and does not erase", async () => {
    // The other half of the decision. Hiding is reversible, so it must not
    // destroy the words: a photograph put back with an empty description is a
    // picture a member who cannot see it is told nothing about.
    const hidden = await call("POST", `/api/places/photo/${terracePhotoId}/hide`, { reason: "checking" }, talToken);
    expect(hidden.status, hidden.text).toBe(200);
    expect((await call("POST", `/api/places/photo/${terracePhotoId}/restore`, {}, talToken)).status).toBe(200);
    const index = await call("GET", "/api/places/photos", undefined, solToken);
    const back = index.json.photos.find((p: any) => p.id === terracePhotoId);
    expect(back, "a restored photograph comes back to the index").toBeTruthy();
    expect(back.altText).toBe("The north terrace, newly dug");
  });

  it("counts a place against the village's per-place dial, and 0 means zero", async () => {
    expect((await call("PUT", "/api/admin/variables/map.photos_per_place", { value: "1" })).status).toBe(200);
    const refused = await upload(wrenToken, await geotagged(10), { altText: "One more of the same wall" });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toContain("the village's limit is 1");

    expect((await call("PUT", "/api/admin/variables/map.photos_per_place", { value: "0" })).status).toBe(200);
    const closed = await upload(wrenToken, await geotagged(11), { altText: "Anything at all" }, "another-place");
    expect(closed.status, "0 means zero, never unlimited").toBe(409);
    expect((await call("PUT", "/api/admin/variables/map.photos_per_place", { value: "60" })).status).toBe(200);
  });

  it("counts a member against the village's daily dial", async () => {
    expect((await call("PUT", "/api/admin/variables/map.photos_per_member_daily", { value: "0" })).status).toBe(200);
    const refused = await upload(wrenToken, await geotagged(12), { altText: "Anything at all" });
    expect(refused.status).toBe(429);
    expect((await call("PUT", "/api/admin/variables/map.photos_per_member_daily", { value: "12" })).status).toBe(200);
  });

  it("reports what the photographs are using on the volume", async () => {
    const health = await fetch(`${BASE}/health`); // module-review-ok: the test client dialling the built server on localhost
    const body: any = await health.json();
    expect(body.uploads).toBeTruthy();
    expect(typeof body.uploads.photoFiles).toBe("number");
    expect(body.uploads.photoFiles).toBeGreaterThan(0);
    expect(body.uploads.photoFiles).toBeLessThanOrEqual(body.uploads.files);
  });

  it("refuses a signed-out visitor everything that writes", async () => {
    expect((await call("POST", `/api/places/photo/${wrenPhotoId}/report`, {}, "")).status).toBe(401);
    expect((await call("POST", `/api/places/photo/${wrenPhotoId}/subject-request`, {}, "")).status).toBe(401);
    expect((await call("GET", "/api/places/reports", undefined, "")).status).toBe(401);
    const up = await upload("", await geotagged(13), { altText: "Anything at all" });
    expect(up.status).toBe(401);
  });
});
