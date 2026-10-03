/**
 * The masterplan door, exercised over real HTTP against a real volume.
 *
 * Same shape as brandUploads.test.ts and for the same reason: what decides
 * this door is multer parsing a real multipart body and the sniff reading the
 * buffer it leaves, so a hand-built `req.file` would test a handler that never
 * sees an upload. The real `register()`, a real Express on port 0, a real temp
 * directory read back off disk, and a pool that keeps the one `app_config`
 * document in memory.
 *
 * The gate is the real one. `capabilityCtx` hands back a context and
 * `hasCapability` decides on it, so the 403 case is the gate saying no and
 * not a stub saying no; the context that is allowed is asserted allowed by
 * the gate itself first, which is the control for every case that writes.
 *
 * Every refusal asserts the status AND that the volume gained nothing, so a
 * check that did not run cannot read as a check that passed.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import { MASTERPLAN_DOC } from "../../shared/mapFromMasterplan";
import { buildGeotaggedJpeg, buildPdfEmbedding } from "../lib/exifFixture";
import { readMetadataMarkers } from "../lib/uploads";
import { register } from "./mapMasterplan";

const MAP_MAKER: CapabilityCtx = { stageIndex: 0, stageIndexOf: () => 1e9, roleCapabilities: ["map.edit"] };
const MEMBER: CapabilityCtx = { stageIndex: 0, stageIndexOf: () => 1e9, roleCapabilities: [] };

let uploadsDir = "";
let server: http.Server;
let base = "";
let who: { id: string } | null = { id: "founder-1" };
let ctx: CapabilityCtx = MAP_MAKER;
/** app_config, as far as this door can see it. */
const config = new Map<string, string>();
const events: string[] = [];

const pool: any = {
  async query(sql: string, params: unknown[] = []) {
    if (/^\s*SELECT value FROM app_config/i.test(sql)) {
      const v = config.get(String(params[0]));
      return [v === undefined ? [] : [{ value: v }], []];
    }
    if (/^\s*INSERT INTO app_config/i.test(sql)) {
      config.set(String(params[0]), String(params[1]));
      return [{ affectedRows: 1 }, []];
    }
    if (/^\s*INSERT INTO health_events/i.test(sql)) {
      events.push(String(params[2]));
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};

beforeAll(async () => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "masterplan-"));
  const app = express();
  register(app, {
    authedUser: async () => who,
    capabilityCtx: async () => ctx,
    getPool: () => pool,
    uploadsDir,
  } as any);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

beforeEach(() => {
  who = { id: "founder-1" };
  ctx = MAP_MAKER;
  config.clear();
  events.length = 0;
  for (const f of fs.readdirSync(uploadsDir)) fs.rmSync(path.join(uploadsDir, f));
});

const volume = () => fs.readdirSync(uploadsDir).sort();

async function upload(bytes: Buffer, name: string, type: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  const res = await fetch(`${base}/api/map/masterplan`, { method: "POST", body: form }); // module-review-ok: this suite's own loopback server, not an outbound call
  return { status: res.status, body: (await res.json()) as any };
}
const get = async () => {
  const res = await fetch(`${base}/api/map/masterplan`); // module-review-ok: this suite's own loopback server, not an outbound call
  return { status: res.status, body: (await res.json()) as any };
};
const remove = async () => {
  const res = await fetch(`${base}/api/map/masterplan`, { method: "DELETE" }); // module-review-ok: this suite's own loopback server, not an outbound call
  return { status: res.status, body: (await res.json()) as any };
};

/** A one-page PDF with nothing embedded: the shape most exported plans have. */
const PLAIN_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);
const plainJpeg = (w = 640, h = 480) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 220, g: 210, b: 180 } } }).jpeg().toBuffer();

it("the context these cases write with is one the real gate allows, and the other one it refuses", () => {
  expect(hasCapability("map.edit", MAP_MAKER)).toBe(true);
  expect(hasCapability("map.edit", MEMBER)).toBe(false);
});

describe("who may keep a masterplan", () => {
  it("asks a stranger to sign in, and keeps nothing", async () => {
    who = null;
    const up = await upload(PLAIN_PDF, "plan.pdf", "application/pdf");
    expect(up.status).toBe(401);
    expect((await get()).status).toBe(401);
    expect(volume()).toEqual([]);
  });

  it("refuses a member who may not draft the land, and keeps nothing", async () => {
    ctx = MEMBER;
    const up = await upload(PLAIN_PDF, "plan.pdf", "application/pdf");
    expect(up.status).toBe(403);
    expect(up.body.error).toBe("The masterplan is kept for the people who draw the map.");
    expect(volume()).toEqual([]);
    expect(config.has(MASTERPLAN_DOC)).toBe(false);
  });
});

describe("keeping one", () => {
  it("answers nothing kept on a fresh village", async () => {
    expect(await get()).toEqual({ status: 200, body: { masterplan: null } });
  });

  it("keeps a PDF byte for byte, names it, and says so in the record and the trail", async () => {
    const up = await upload(PLAIN_PDF, "Plan V7.pdf", "application/pdf");
    expect(up.status).toBe(200);
    const rec = up.body.masterplan;
    expect(rec).toMatchObject({ kind: "pdf", mimeType: "application/pdf", originalName: "Plan V7.pdf", bytes: PLAIN_PDF.length, width: null, uploadedBy: "founder-1" });
    expect(rec.url).toBe(`/api/uploads/${rec.filename}`);
    expect(rec.filename).toMatch(/^masterplan-\d{13}-[a-z0-9]+\.pdf$/);
    expect(volume()).toEqual([rec.filename]);
    expect(fs.readFileSync(path.join(uploadsDir, rec.filename)).equals(PLAIN_PDF)).toBe(true);
    expect((await get()).body.masterplan).toEqual(rec);
    expect(events).toEqual(["kept a new masterplan for the map (Plan V7.pdf)"]);
  });

  it("keeps a photographed plan at its own size, with the GPS taken out", async () => {
    const geo = buildGeotaggedJpeg(await plainJpeg(1600, 1200));
    expect((await readMetadataMarkers(geo)).length, "the fixture is geotagged").toBeGreaterThan(0);
    const up = await upload(geo, "plan photo.jpg", "image/jpeg");
    expect(up.status).toBe(200);
    expect(up.body.masterplan).toMatchObject({ kind: "image", width: 1600, height: 1200, mimeType: "image/jpeg" });
    const stored = fs.readFileSync(path.join(uploadsDir, up.body.masterplan.filename));
    expect(await readMetadataMarkers(stored)).toEqual([]);
  });

  it("refuses a PDF that carries a geotagged photograph, and says why", async () => {
    const pdf = buildPdfEmbedding(buildGeotaggedJpeg(await plainJpeg()));
    const up = await upload(pdf, "plan.pdf", "application/pdf");
    expect(up.status).toBe(400);
    expect(up.body.error).toMatch(/GPS coordinates/);
    expect(volume()).toEqual([]);
  });

  it("refuses a file that is not a PDF or a picture, whatever it is named", async () => {
    const up = await upload(Buffer.from("<html>not a plan</html>"), "plan.pdf", "application/pdf");
    expect(up.status).toBe(400);
    expect(up.body.error).toBe('"plan.pdf" is not a PDF or a picture, so it was not kept. Upload one of: PDF, JPG, PNG or WebP.');
    expect(volume()).toEqual([]);
  });

  it("asks for a file when none came", async () => {
    const res = await fetch(`${base}/api/map/masterplan`, { method: "POST", body: new FormData() }); // module-review-ok: this suite's own loopback server, not an outbound call
    expect(res.status).toBe(400);
    expect(volume()).toEqual([]);
  });
});

describe("replacing and removing", () => {
  it("replaces the last plan and takes its file off the volume", async () => {
    const first = (await upload(PLAIN_PDF, "v1.pdf", "application/pdf")).body.masterplan;
    const second = (await upload(await plainJpeg(), "v2.jpg", "image/jpeg")).body.masterplan;
    expect(volume()).toEqual([second.filename]);
    expect(volume()).not.toContain(first.filename);
    expect((await get()).body.masterplan.originalName).toBe("v2.jpg");
  });

  it("removes the record and the file, and says when there was nothing to remove", async () => {
    const rec = (await upload(PLAIN_PDF, "plan.pdf", "application/pdf")).body.masterplan;
    expect(await remove()).toEqual({ status: 200, body: { removed: true } });
    expect(volume()).toEqual([]);
    expect((await get()).body.masterplan).toBeNull();
    expect(events.at(-1)).toBe("took the masterplan off the map (plan.pdf)");
    expect(await remove()).toEqual({ status: 200, body: { removed: false } });
    expect(rec.filename).toMatch(/^masterplan-/);
  });

  it("never deletes a file the record names that this door did not mint", async () => {
    fs.writeFileSync(path.join(uploadsDir, "brand-1790000000000-abcde.webp"), "x");
    config.set(MASTERPLAN_DOC, JSON.stringify({
      url: "/api/uploads/brand-1790000000000-abcde.webp", filename: "brand-1790000000000-abcde.webp", kind: "image",
    }));
    expect((await remove()).body).toEqual({ removed: true });
    expect(volume()).toEqual(["brand-1790000000000-abcde.webp"]);
  });
});
