/**
 * THE PUBLIC DOOR, against the built server.
 *
 * `POST /api/work-with-us/attachment` takes a file from a stranger with no
 * account and no session, and `/api/uploads/:filename` serves what it stored
 * to anybody with the link. It used multer's diskStorage, so a photograph
 * taken on the land arrived carrying the land's GPS position and left
 * carrying it too.
 *
 * A unit test on `sanitiseForVolume` proves the function. This proves the
 * PRODUCT: the bytes are fetched back through the running server's own
 * serving route and off the volume it wrote them to, with no account
 * anywhere in the exercise.
 *
 * The vault door is here for the same reason. It had no file filter at all,
 * so an admin dropping a phone photo in beside the cap table published the
 * same coordinates.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { FIXTURE_CAMERA, buildGeotaggedJpeg, buildPdfEmbedding } from "./lib/exifFixture";
import { exifBlockHasGps, pdfLocationMarkers } from "./lib/uploads";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[uploadStrip.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 28802 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "strip-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let founderToken = "";

async function call(method: string, route: string, body?: unknown, token = founderToken) {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

/** Post a file with NO Authorization header at all. That is the point. */
async function postAttachment(bytes: Buffer, name: string, type: string, token = "") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  const res = await fetch(`${BASE}/api/work-with-us/attachment`, { // module-review-ok: the test client dialling the built server on localhost
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text };
}

async function postVaultDoc(bytes: Buffer, name: string, type: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  form.append("name", "A document");
  const res = await fetch(`${BASE}/api/admin/investor-docs/upload`, { // module-review-ok: the test client dialling the built server on localhost
    method: "POST",
    headers: { Authorization: `Bearer ${founderToken}` },
    body: form,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text };
}

async function fetchUpload(filename: string): Promise<{ status: number; bytes: Buffer; cacheControl: string }> {
  const res = await fetch(`${BASE}/api/uploads/${filename}`); // module-review-ok: the test client dialling the built server on localhost
  return {
    status: res.status,
    bytes: Buffer.from(await res.arrayBuffer()),
    cacheControl: String(res.headers.get("cache-control") ?? ""),
  };
}

async function plainJpeg(w = 1200, h = 900): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 100, b: 70 } } }).jpeg().toBuffer();
}
async function geotagged(w = 1200, h = 900): Promise<Buffer> {
  return buildGeotaggedJpeg(await plainJpeg(w, h));
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the upload strip test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-strip-"));
  testDb = await provisionTestDb();

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
      AUTH_TOKEN_SECRET: "strip-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
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
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Strip Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "StripTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  await testDb?.drop();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* gone */ }
});

describe.skipIf(!DB_CONFIGURED)("the public proposal attachment door", () => {
  it("the fixture really is geotagged, or nothing below means anything", async () => {
    const meta = await sharp(await geotagged()).metadata();
    expect(meta.exif).toBeTruthy();
    expect(exifBlockHasGps(meta.exif as Buffer)).toBe(true);
  });

  it("takes a photograph from a stranger with no account and stores it with no coordinates", async () => {
    const up = await postAttachment(await geotagged(), "site-photo.jpg", "image/jpeg");
    expect(up.status, up.text).toBe(200);
    const filename = String(up.json?.filename ?? "");
    expect(filename).toMatch(/^proposal-\d+-[a-z0-9]+\.jpg$/);

    // Off the volume the server wrote it to.
    const onDisk = fs.readFileSync(path.join(dataDir, "uploads", filename));
    expect((await sharp(onDisk).metadata()).exif, "the stored file still carries EXIF").toBeFalsy();
    expect(onDisk.includes(Buffer.from(FIXTURE_CAMERA)), "the stored file still names the camera").toBe(false);
    expect(onDisk.includes(Buffer.from("Exif")), "the stored file still carries an EXIF container").toBe(false);

    // And through the serving route, which is how a stranger would read it.
    const served = await fetchUpload(filename);
    expect(served.status).toBe(200);
    expect((await sharp(served.bytes).metadata()).exif).toBeFalsy();
    expect(served.bytes.includes(Buffer.from(FIXTURE_CAMERA))).toBe(false);
  });

  it("keeps the picture usable: same dimensions, same format", async () => {
    const up = await postAttachment(await geotagged(1600, 1200), "wide.jpg", "image/jpeg");
    expect(up.status, up.text).toBe(200);
    const onDisk = fs.readFileSync(path.join(dataDir, "uploads", String(up.json.filename)));
    const meta = await sharp(onDisk).metadata();
    expect(meta.width, "a scan must come out the size it went in").toBe(1600);
    expect(meta.height).toBe(1200);
    expect(meta.format).toBe("jpeg");
  });

  it("refuses a PDF that hides a geotagged photograph inside it, and says why", async () => {
    const pdf = buildPdfEmbedding(await geotagged(240, 180));
    expect(pdfLocationMarkers(pdf).found, "the PDF fixture carries no GPS, so this proves nothing").toBe(true);
    const up = await postAttachment(pdf, "proposal.pdf", "application/pdf");
    expect(up.status, up.text).toBe(400);
    expect(up.json.error).toContain("GPS coordinates");
    // Refused BEFORE any write: nothing was left on the volume for the sweep.
    const left = fs.readdirSync(path.join(dataDir, "uploads")).filter((f) => f.endsWith(".pdf"));
    expect(left).toEqual([]);
  });

  it("takes an ordinary PDF through untouched, which is every CV", async () => {
    const pdf = buildPdfEmbedding(await plainJpeg(240, 180));
    const up = await postAttachment(pdf, "cv.pdf", "application/pdf");
    expect(up.status, up.text).toBe(200);
    const onDisk = fs.readFileSync(path.join(dataDir, "uploads", String(up.json.filename)));
    expect(onDisk.equals(pdf), "an ordinary PDF must reach the volume byte for byte").toBe(true);
  });

  it("still refuses the file types it always refused", async () => {
    const up = await postAttachment(Buffer.from("<html>nope</html>"), "x.html", "text/html");
    expect(up.status).toBe(400);
    expect(up.text).toContain("Only images or PDF");
  });
});

/*
 * ── THE BREAK THE TRIPWIRE WAS WATCHING, NOW FIXED ───────────────────────
 *
 * `POST /api/admin/investor-docs/upload` built an entry of
 * `{id, name, filename, pageLink, uploadedAt}` and handed it to a repo whose
 * columns are `{id, title, description, url, requiresRequest, order}` with
 * `title` NOT NULL. The insert threw `Column 'title' cannot be null` on every
 * press since the route shipped, so no document ever reached the vault through
 * the product, and the file was already on the volume by then: every attempt
 * left an orphan.
 *
 * The reader was broken in the same shape. The packet email addressed
 * `d.filename` and `d.name`, and the admin list did the same, so even a row
 * placed there by the legacy importer rendered as "undefined" pointing at
 * `/api/uploads/undefined`. A fixed writer feeding a renderer that reads other
 * columns is the other half of one defect, so both halves moved together.
 *
 * `check-admin-reach` passed this route the whole time, because a caller exists
 * in the browser. Nothing anywhere asks whether a route WORKS, which is the
 * point the tripwire was making and the reason these tests now go round trip:
 * write through the route, read back through what renders it.
 *
 * 0099 gave `pageLink` and `uploadedAt` the columns the admin form always
 * assumed they had. `title` holds the document's name and `url` holds its
 * address, so an imported row pointing at an external document still renders.
 */
describe.skipIf(!DB_CONFIGURED)("the investor vault door", () => {
  it("strips a photograph an admin drops in beside the cap table", async () => {
    const before = new Set(fs.readdirSync(path.join(dataDir, "uploads")));
    await postVaultDoc(await geotagged(), "site-visit.jpg", "image/jpeg");
    const written = fs.readdirSync(path.join(dataDir, "uploads")).filter((f) => !before.has(f));
    expect(written.length, "the vault must have written its file before the row").toBe(1);
    expect(written[0], "the vault keeps the document's own name in the file").toContain("site-visit");
    const onDisk = fs.readFileSync(path.join(dataDir, "uploads", written[0]));
    expect((await sharp(onDisk).metadata()).exif, "the stored vault file still carries EXIF").toBeFalsy();
    expect(onDisk.includes(Buffer.from(FIXTURE_CAMERA))).toBe(false);
  });

  it("leaves a file that is not an image or a PDF exactly as it was", async () => {
    // The vault takes any type on purpose. A spreadsheet has to survive.
    const xlsx = Buffer.concat([Buffer.from("PK", "binary"), Buffer.alloc(256, 9)]);
    const before = new Set(fs.readdirSync(path.join(dataDir, "uploads")));
    await postVaultDoc(xlsx, "cap-table.xlsx", "application/vnd.ms-excel");
    const written = fs.readdirSync(path.join(dataDir, "uploads")).filter((f) => !before.has(f));
    expect(written.length).toBe(1);
    expect(fs.readFileSync(path.join(dataDir, "uploads", written[0])).equals(xlsx)).toBe(true);
  });

  it("saves the document, and the vault's own reader serves it back", async () => {
    const up = await postVaultDoc(await plainJpeg(40, 30), "round-trip.jpg", "image/jpeg");
    expect(up.status, up.text).toBe(200);
    expect(up.json.title, "the document's name belongs in `title`, the NOT NULL column").toBe("A document");
    expect(String(up.json.url)).toMatch(/^\/api\/uploads\/round-trip-/);

    // Read back through the route the admin vault screen actually lists from,
    // which is the half a green write test cannot see. The row has to survive
    // the database, not just the handler.
    const listed = await call("GET", "/api/admin/investor-docs");
    expect(listed.status, listed.text).toBe(200);
    const saved = (listed.json as any[]).find((d) => d.id === up.json.id);
    expect(saved, "the document must come back out of the table it was written to").toBeTruthy();
    expect(saved.title).toBe("A document");
    expect(saved.url).toBe(up.json.url);

    // And the address in the row has to serve the bytes, or the link in the
    // investor's packet email is decoration.
    const served = await fetchUpload(path.basename(String(saved.url)));
    expect(served.status, "the url on the row must serve the file").toBe(200);
    expect(served.bytes.length).toBeGreaterThan(0);
  });

  it("leaves no orphan: every file on the volume is referenced by a row", async () => {
    const up = await postVaultDoc(await plainJpeg(40, 30), "no-orphan.jpg", "image/jpeg");
    expect(up.status, up.text).toBe(200);
    const listed = await call("GET", "/api/admin/investor-docs");
    const referenced = new Set((listed.json as any[]).map((d) => path.basename(String(d.url ?? ""))));
    const stranded = fs
      .readdirSync(path.join(dataDir, "uploads"))
      .filter((f) => f.includes("no-orphan") && !referenced.has(f));
    expect(stranded, "an upload that saved must leave nothing unreferenced behind it").toEqual([]);
  });

  it("deletes the row and the file it points at", async () => {
    const up = await postVaultDoc(await plainJpeg(40, 30), "delete-me.jpg", "image/jpeg");
    expect(up.status, up.text).toBe(200);
    const filename = path.basename(String(up.json.url));
    expect(fs.existsSync(path.join(dataDir, "uploads", filename))).toBe(true);

    const gone = await call("DELETE", `/api/admin/investor-docs/${up.json.id}`);
    expect(gone.status, gone.text).toBe(200);
    const listed = await call("GET", "/api/admin/investor-docs");
    expect((listed.json as any[]).some((d) => d.id === up.json.id)).toBe(false);
    // The delete route read `target.filename`, which was never a column, so it
    // joined `undefined` onto the uploads path and removed nothing.
    expect(fs.existsSync(path.join(dataDir, "uploads", filename)), "the file must go with the row").toBe(false);
  });

  it("is still admin-only, and still refuses before a byte is written", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(await geotagged(40, 30))], { type: "image/jpeg" }), "sneaky.jpg");
    const res = await fetch(`${BASE}/api/admin/investor-docs/upload`, { method: "POST", body: form }); // module-review-ok: the test client dialling the built server on localhost
    expect(res.status).toBe(401);
    expect(fs.readdirSync(path.join(dataDir, "uploads")).some((f) => f.includes("sneaky"))).toBe(false);
  });
});

/*
 * The vault's PUBLIC door, found by sweeping the class the tripwire named.
 *
 * `POST /api/investor-docs/request` is the "send me the investor packet" form
 * on the investor page. It inserted `{id, type, data, submittedAt}` into
 * `submissions`, where `status` is NOT NULL. dbCollection names every spec'd
 * column on every insert, so the absent key wrote an explicit NULL and the
 * DEFAULT 'new' never applied: the insert threw `Column 'status' cannot be
 * null` and the form has never captured a lead. The other two writers into
 * `submissions` both set `status`; this one was the outlier, and no gate
 * compares one writer to another.
 */
describe.skipIf(!DB_CONFIGURED)("the investor packet request", () => {
  it("captures the lead, and the stewards' inbox has it", async () => {
    const res = await fetch(`${BASE}/api/investor-docs/request`, { // module-review-ok: the test client dialling the built server on localhost
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada Prospect", email: "ada@example.test", accredited: true }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    // Read back through the admin submissions list, which is where a founder
    // would look for the lead. The write is only real if this sees it.
    const listed = await call("GET", "/api/admin/submissions?type=investor-doc-request");
    expect(listed.status, listed.text).toBe(200);
    const lead = (listed.json as any[]).find((s) => s?.data?.email === "ada@example.test");
    expect(lead, "the lead must survive the insert and come back out").toBeTruthy();
    expect(lead.status, "status is NOT NULL, so an omitted key refused the whole row").toBe("new");
    expect(lead.data.name).toBe("Ada Prospect");
  });
});

describe.skipIf(!DB_CONFIGURED)("the brand image door", () => {
  it("strips, and now asserts it stripped", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(await geotagged())], { type: "image/jpeg" }), "hero.jpg");
    const res = await fetch(`${BASE}/api/admin/brand/image`, { // module-review-ok: the test client dialling the built server on localhost
      method: "POST",
      headers: { Authorization: `Bearer ${founderToken}` },
      body: form,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    for (const address of [body.url, body.thumbUrl].filter(Boolean)) {
      const onDisk = fs.readFileSync(path.join(dataDir, "uploads", path.basename(String(address))));
      expect((await sharp(onDisk).metadata()).exif).toBeFalsy();
      expect(onDisk.includes(Buffer.from(FIXTURE_CAMERA))).toBe(false);
    }
  });
});


/**
 * WHOSE CACHE MAY HOLD IT, driven against the real header the real route sets.
 *
 * Erasure unlinks a member's files, so the origin answers 404 the moment they
 * leave. The header said `public, max-age=31536000, immutable`, so every
 * shared cache that had fetched one went on serving it for up to a year
 * without ever asking, and a member's face could be handed to somebody else
 * by a proxy after they had gone.
 *
 * BOTH DIRECTIONS ARE ASSERTED IN ONE CASE ON PURPOSE. A rule that answered
 * `private` for everything would pass the member half and quietly cost every
 * viewer of the village's own images a shared cache they could have used.
 *
 * THE FILE STANDING FOR "NOT A MEMBER'S" IS A VAULT IMAGE, AND THAT IS NOT AN
 * ENDORSEMENT. `vaultBase` keeps the uploader's own filename, so an investor
 * document carries no prefix to read and lands on the public side here. A
 * vault PDF is already served `private, no-cache` by type and an image is
 * not. That gap is real, it is a different argument from this one, and it is
 * filed separately. If somebody closes it, this assertion is the one to
 * change, and it should be changed deliberately rather than discovered.
 */
describe.skipIf(!DB_CONFIGURED)("the one-year header", () => {
  it("is private for a member's own file and public for one that is not", async () => {
    const mine = await postAttachment(await plainJpeg(40, 30), "my-face.jpg", "image/jpeg");
    expect(mine.status, mine.text).toBe(200);
    const mineName = String(mine.json?.filename ?? "");
    expect(mineName, "the attachment door mints the member prefix").toMatch(/^proposal-/);

    const theirs = await postVaultDoc(await plainJpeg(40, 30), "cap-table.jpg", "image/jpeg");
    expect(theirs.status, theirs.text).toBe(200);
    const theirsName = String(theirs.json?.url ?? "").replace("/api/uploads/", "");
    expect(theirsName, "the vault keeps the uploader's own name, so it carries no prefix").toMatch(/^cap-table-/);

    const served = await fetchUpload(mineName);
    expect(served.status).toBe(200);
    expect(served.cacheControl).toBe("private, max-age=31536000, immutable");

    const other = await fetchUpload(theirsName);
    expect(other.status).toBe(200);
    expect(other.cacheControl).toBe("public, max-age=31536000, immutable");
  });
});
