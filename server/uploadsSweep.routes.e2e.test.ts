/**
 * THE FILES NOTHING POINTS AT, PROVEN AGAINST THE BUILT SERVER.
 *
 * A unit test on `classifyVolume` proves the reasoning. This proves the
 * PRODUCT, and it proves the half that matters most, which is not the
 * deletion:
 *
 *  - A REAL ORPHAN IS FOUND. The investor vault wrote its file before
 *    attempting a row it could never save, so every press left a file behind.
 *    That exact shape is reproduced here (bytes on the volume, no row
 *    anywhere) and the sweep names it.
 *
 *  - A MEMBER'S PHOTOGRAPH SURVIVES THE SAME PASS. It goes up through the
 *    real door, and after the removal it is still on the volume and still
 *    served by `/api/uploads/:filename`. This is the assertion the whole
 *    feature exists to keep true, and the reason it comes first in this file.
 *
 *  - SO DOES A BRAND IMAGE, AND SO DOES ITS THUMBNAIL. The thumbnail is the
 *    interesting one: the admin form discards `thumbUrl`, so no stored string
 *    anywhere names it and judged alone every brand thumbnail ever written
 *    looks like an orphan. It survives because a pair is one decision.
 *
 *  - AND A VAULT DOCUMENT, whose row now exists. That is the fix this sweep
 *    is cleaning up after, so it has to be shown surviving.
 *
 *  - THE FINGERPRINT REFUSES A STALE PRESS. A removal quoting a digest that
 *    no longer describes the volume removes nothing and hands back what is
 *    actually there.
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
import type { UploadsSweepReport } from "../shared/uploadsSweep";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[uploadsSweep.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 29202 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "orphans-admin";
const PLACE = "community-kitchen";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let uploadsDir = "";
let founderToken = "";
let solToken = "";

/** Old enough that both clocks (the stamp and the mtime) are past any grace. */
const LONG_AGO = Date.now() - 400 * 86_400_000;

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

async function report(): Promise<UploadsSweepReport> {
  const r = await call("GET", "/api/admin/uploads/orphans");
  expect(r.status, r.text).toBe(200);
  return r.json as UploadsSweepReport;
}

const names = (r: UploadsSweepReport, verdict: string) =>
  r.findings.filter((f) => f.verdict === verdict).map((f) => f.name);

async function jpeg(tint: number, w = 240, h = 180): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: tint, g: 90, b: 60 } } })
    .jpeg()
    .toBuffer();
}

/** A file on the volume that no row has ever named. The vault's exact legacy. */
function plantOrphan(name: string, bytes: Buffer, when = LONG_AGO): string {
  const full = path.join(uploadsDir, name);
  fs.writeFileSync(full, bytes);
  fs.utimesSync(full, new Date(when), new Date(when));
  return name;
}

async function postForm(route: string, form: FormData, token: string) {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the uploads sweep route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-orphans-"));
  uploadsDir = path.join(dataDir, "uploads");
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
      AUTH_TOKEN_SECRET: "orphans-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Orphans Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "OrphanTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  // The map module serves the place-photo door, so a member's photograph can
  // reach the volume the way a member's photograph actually does.
  for (const m of (await call("GET", "/api/admin/modules")).json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }
  const reg = await call("POST", "/api/auth/register", {
    name: "Sol Vega", email: `sol-${PORT}@example.test`, password: "OrphanTest123!", paths: ["resident"],
  }, "");
  solToken = String(reg.json?.token ?? "");
  expect((await call("PUT", `/api/admin/players/${reg.json?.user?.id}/stage`, { stageId: "member" })).status).toBe(200);
});

afterAll(async () => {
  child?.kill();
  await testDb?.drop();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* gone */ }
});

describe.skipIf(!DB_CONFIGURED)("the files nothing points at", () => {
  /** Everything that must still be on the volume when this suite is done. */
  const mustSurvive: string[] = [];
  let placePhoto = "";
  let placeThumb = "";
  let brandImage = "";
  let brandThumb = "";
  let vaultDoc = "";
  let oldBrand = "";
  let oldBrandThumb = "";
  let heldAttachment = "";
  let staleOrphan = "";
  let proposalOrphan = "";
  let foreignFile = "";
  let freshOrphan = "";

  it("fills the volume through the real doors, the way a village does", async () => {
    // A member's photograph. Its row names both the picture and its thumbnail.
    const photoForm = new FormData();
    photoForm.append("photo", new Blob([new Uint8Array(await jpeg(200))], { type: "image/jpeg" }), "wall.jpg");
    photoForm.append("altText", "The north wall of the community kitchen, half built");
    const up = await postForm(`/api/places/${PLACE}/photos`, photoForm, solToken);
    expect(up.status, up.text).toBe(200);
    placePhoto = path.basename(String(up.json?.photo?.url ?? ""));
    placeThumb = path.basename(String(up.json?.photo?.thumbUrl ?? ""));
    expect(placePhoto, "a place photograph must have landed").toBeTruthy();
    expect(placeThumb, "and its thumbnail").toBeTruthy();

    // A brand image. The form saves `url` into the brand document and DROPS
    // `thumbUrl`, so the thumbnail is named by no stored string anywhere.
    const brandForm = new FormData();
    brandForm.append("file", new Blob([new Uint8Array(await jpeg(120, 900, 600))], { type: "image/jpeg" }), "hero.jpg");
    const brand = await postForm("/api/admin/brand/image", brandForm, founderToken);
    expect(brand.status, brand.text).toBe(200);
    brandImage = path.basename(String(brand.json?.url ?? ""));
    brandThumb = path.basename(String(brand.json?.thumbUrl ?? ""));
    expect(brandThumb, "the brand door must have written a thumbnail").toBeTruthy();
    /*
     * A brand pair OLD enough to be judged, with the full-size picture in the
     * brand document and the thumbnail named by nothing at all. This is the
     * live shape (`BrandImageField` discards `data.thumbUrl`), and the pair
     * that came off the door a moment ago cannot test it: its stamp is minutes
     * old, so the grace window would keep the thumbnail whatever the pairing
     * rule did, and the assertion would prove nothing.
     */
    oldBrand = plantOrphan(`brand-${LONG_AGO + 10}-hh7kd.webp`, await sharp(await jpeg(80, 600, 400)).webp().toBuffer());
    oldBrandThumb = plantOrphan(`brand-${LONG_AGO + 10}-hh7kd.thumb.webp`, await sharp(await jpeg(80, 120, 80)).webp().toBuffer());

    const current = (await call("GET", "/api/admin/brand")).json ?? {};
    const saved = await call("PUT", "/api/admin/brand", {
      ...current,
      images: {
        ...(current.images ?? {}),
        hero: String(brand.json?.url ?? ""),
        // The old pair's full-size address, and deliberately not its thumbnail.
        logo: `/api/uploads/${oldBrand}`,
      },
    });
    expect(saved.status, saved.text).toBe(200);

    // A vault document. Its row exists now, which is the fix this sweep is
    // cleaning up after.
    const vaultForm = new FormData();
    vaultForm.append("file", new Blob([new Uint8Array(Buffer.from("%PDF-1.7\ncap table\n"))], { type: "application/pdf" }), "Cap Table 2026.pdf");
    vaultForm.append("name", "Cap table");
    const vault = await postForm("/api/admin/investor-docs/upload", vaultForm, founderToken);
    expect(vault.status, vault.text).toBe(200);
    vaultDoc = path.basename(String(vault.json?.url ?? ""));
    expect(vaultDoc).toBeTruthy();

    /*
     * THE MOST DANGEROUS REFERENCE ON THE PLATFORM, and the reason it is
     * exercised on an OLD file rather than on one that has just come off the
     * door: a proposal attachment is stored as a BARE FILENAME inside the
     * `data` JSON of a submission, with no `/api/uploads/` anywhere near it.
     * Every reference scan that looks for a URL prefix classes every
     * work-with-us attachment on the volume as unreferenced, and those are
     * CVs, portfolios, and ID scans on some forks. A fresh file would be held
     * by the grace window whatever the scan concluded, so the assertion would
     * prove nothing.
     */
    heldAttachment = plantOrphan(`proposal-${LONG_AGO + 20}-kk3jd.jpg`, await jpeg(140));
    const held = await call("POST", "/api/forms/submit", {
      type: "work-with-us",
      data: { name: "Wren Ash", email: `wren-${PORT}@example.test`, attachment: heldAttachment },
    }, "");
    expect(held.status, held.text).toBe(200);

    mustSurvive.push(placePhoto, placeThumb, brandImage, brandThumb, vaultDoc, oldBrand, oldBrandThumb, heldAttachment);
    for (const name of mustSurvive) {
      expect(fs.existsSync(path.join(uploadsDir, name)), `${name} must be on the volume`).toBe(true);
    }
  });

  it("finds the file the broken vault route left, and nothing else", async () => {
    // The exact legacy: bytes on the volume, no row anywhere, minted by a door
    // that stamps the uploaded document's own name into the filename.
    staleOrphan = plantOrphan(`Term-Sheet-v3-${LONG_AGO}-ab3de.pdf`, Buffer.from("%PDF-1.7\nterm sheet\n"));
    proposalOrphan = plantOrphan(`proposal-${LONG_AGO + 1}-9zqk2.jpg`, await jpeg(60));
    // A file somebody put there by hand. Nothing here is entitled to an
    // opinion about it, so it is reported and left.
    foreignFile = "operator-notes.txt";
    plantOrphan(foreignFile, Buffer.from("restore checklist\n"));
    // And one written minutes ago, which the grace window protects.
    freshOrphan = plantOrphan(`Draft-Memo-${Date.now()}-77abc.pdf`, Buffer.from("%PDF-1.7\ndraft\n"), Date.now());

    const r = await report();
    expect(r.complete, r.incompleteReason ?? "").toBe(true);
    expect(r.scan.columns, "the scan must have read real columns").toBeGreaterThan(20);

    const orphans = names(r, "orphan");
    expect(orphans).toContain(staleOrphan);
    expect(orphans).toContain(proposalOrphan);
    expect(orphans).not.toContain(freshOrphan);
    for (const survivor of mustSurvive) {
      expect(orphans, `${survivor} must never be offered for removal`).not.toContain(survivor);
    }

    // THE PAIRING RULE, on a pair old enough for the window to be no help.
    // Nothing anywhere names the thumbnail; it is kept because its full-size
    // picture is kept, and both are absent from the findings entirely.
    expect(orphans, "a thumbnail nothing names must not be offered").not.toContain(oldBrandThumb);
    expect(r.findings.find((f) => f.name === oldBrandThumb)).toBeUndefined();
    expect(r.findings.find((f) => f.name === oldBrand)).toBeUndefined();

    // A bare filename in a submission's data JSON holds its file, and the file
    // beside it that no submission names does not survive by association.
    expect(orphans, "a bare filename in a JSON column is a reference").not.toContain(heldAttachment);
    expect(orphans).toContain(proposalOrphan);

    expect(names(r, "unknown")).toContain(foreignFile);
    expect(r.tally.recent.files, "the fresh file is inside the window").toBeGreaterThan(0);
    expect(r.volume.files).toBe(fs.readdirSync(uploadsDir).length);
  });

  it("refuses a press that quotes a list the volume no longer matches", async () => {
    const stale = await report();
    const extra = plantOrphan(`Stray-Deck-${LONG_AGO + 2}-mm4kd.pdf`, Buffer.from("%PDF-1.7\ndeck\n"));
    const refused = await call("POST", "/api/admin/uploads/orphans/remove", { digest: stale.digest });
    expect(refused.status, refused.text).toBe(409);
    expect(fs.existsSync(path.join(uploadsDir, extra)), "nothing may be removed on a stale press").toBe(true);
    expect(fs.existsSync(path.join(uploadsDir, staleOrphan))).toBe(true);
    // The refusal hands back what is actually there, so the next press is real.
    expect(names(refused.json?.report as UploadsSweepReport, "orphan")).toContain(extra);
    fs.unlinkSync(path.join(uploadsDir, extra));
  });

  it("removes exactly what it listed, and every referenced file survives the same pass", async () => {
    const before = await report();
    const offered = names(before, "orphan").sort();
    expect(offered).toEqual([proposalOrphan, staleOrphan].sort());

    const done = await call("POST", "/api/admin/uploads/orphans/remove", { digest: before.digest });
    expect(done.status, done.text).toBe(200);
    expect(done.json?.removed).toBe(2);
    expect([...done.json.names].sort()).toEqual(offered);
    expect(done.json?.kept).toEqual([]);
    expect(done.json?.bytes).toBeGreaterThan(0);

    // Gone.
    expect(fs.existsSync(path.join(uploadsDir, staleOrphan))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir, proposalOrphan))).toBe(false);

    // THE ASSERTION THIS WHOLE FEATURE EXISTS FOR. Still on the volume, and
    // still served, which is the half a disk check alone would miss.
    for (const name of mustSurvive) {
      expect(fs.existsSync(path.join(uploadsDir, name)), `${name} must have survived`).toBe(true);
      const served = await fetch(`${BASE}/api/uploads/${name}`); // module-review-ok: the test client dialling the built server on localhost
      expect(served.status, `${name} must still be served`).toBe(200);
      expect(Number(served.headers.get("content-length") ?? 0)).toBeGreaterThan(0);
    }
    // The file nobody here can identify, and the file inside its grace window.
    expect(fs.existsSync(path.join(uploadsDir, foreignFile))).toBe(true);
    expect(fs.existsSync(path.join(uploadsDir, freshOrphan))).toBe(true);

    const after = done.json?.after as UploadsSweepReport;
    expect(names(after, "orphan")).toEqual([]);
    expect(after.volume.files).toBe(fs.readdirSync(uploadsDir).length);
  });

  it("puts the count on /health without walking the volume again", async () => {
    const health = await (await fetch(`${BASE}/health`)).json(); // module-review-ok: the test client dialling the built server on localhost
    expect(health?.uploads?.files).toBe(fs.readdirSync(uploadsDir).length);
    expect(health?.uploads?.orphanFiles).toBe(0);
  });

  it("removes nothing when there is nothing to remove", async () => {
    const r = await report();
    const done = await call("POST", "/api/admin/uploads/orphans/remove", { digest: r.digest });
    expect(done.status, done.text).toBe(200);
    expect(done.json?.removed).toBe(0);
    expect(fs.readdirSync(uploadsDir).length).toBe(r.volume.files);
  });

  it("refuses a stranger at both doors", async () => {
    expect((await call("GET", "/api/admin/uploads/orphans", undefined, "")).status).toBe(401);
    expect((await call("POST", "/api/admin/uploads/orphans/remove", { digest: "x" }, "")).status).toBe(401);
    expect((await call("POST", "/api/admin/uploads/orphans/remove", { digest: "x" }, solToken)).status).toBe(401);
  });
});
