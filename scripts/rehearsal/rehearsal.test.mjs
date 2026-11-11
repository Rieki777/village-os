/**
 * The rehearsal's own self-test: the two refusals that keep it off real
 * villages, and the screenshot diff it reports change with.
 *
 *   node --test scripts/rehearsal/rehearsal.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertLocalBase, assertScratchDb, isLoopbackUrl } from "./guard.mjs";
import { decodePng, diffImages, encodePng } from "./png.mjs";
import { compareShots } from "./report.mjs";

test("only a loopback base URL is accepted", () => {
  for (const ok of ["http://localhost:5871", "http://127.0.0.1:5871/x", "http://[::1]:5871"]) assert.equal(isLoopbackUrl(ok), true, ok);
  for (const bad of ["https://village.example.org", "http://localhost.example.org", "http://10.0.0.1:5871", "ftp://localhost", "not a url", "http://127.0.0.2"]) {
    assert.equal(isLoopbackUrl(bad), false, bad);
    assert.throws(() => assertLocalBase(bad), /refusing/);
  }
});

test("only a loopback scratch schema with the rehearsal prefix is accepted", () => {
  assert.doesNotThrow(() => assertScratchDb("mysql://root:pw@127.0.0.1:3306", "village_rehearsal"));
  assert.doesNotThrow(() => assertScratchDb("mysql://root:pw@localhost:3306", "village_rehearsal_ci"));
  assert.throws(() => assertScratchDb("mysql://root:pw@db.example.org:3306", "village_rehearsal"), /this machine/);
  assert.throws(() => assertScratchDb("mysql://root:pw@127.0.0.1:3306", "village"), /village_rehearsal/);
  assert.throws(() => assertScratchDb("mysql://root:pw@127.0.0.1:3306", "railway"), /village_rehearsal/);
  assert.throws(() => assertScratchDb("mysql://root:pw@127.0.0.1:3306", "village_rehearsal; DROP DATABASE x"), /village_rehearsal/);
  assert.throws(() => assertScratchDb("postgres://127.0.0.1", "village_rehearsal"), /mysql/);
});

function solid(width, height, rgb) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { width, height, data };
}

test("a PNG survives encode and decode", () => {
  const img = solid(7, 5, [10, 200, 30]);
  img.data.set([255, 0, 0, 255], 4 * 12);
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 7);
  assert.equal(back.height, 5);
  assert.deepEqual([...back.data], [...img.data]);
});

test("the diff ignores small shifts and reports real change", () => {
  const a = solid(100, 100, [40, 40, 40]);
  const nudged = solid(100, 100, [50, 50, 50]);
  assert.equal(diffImages(a, nudged).changed, false);
  const b = solid(100, 100, [40, 40, 40]);
  for (let i = 0; i < 100; i++) b.data.set([250, 250, 250, 255], i * 4); // one row in 100 is 1%
  const d = diffImages(a, b, { picture: true });
  assert.equal(d.changed, true);
  assert.equal(d.changedPixels, 100);
  assert.equal(d.picture.width, 100);
  const tall = solid(100, 120, [40, 40, 40]);
  assert.equal(diffImages(a, tall).comparable, false);
});

test("compareShots names changed, new and gone screenshots", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-"));
  const before = path.join(dir, "before");
  const now = path.join(dir, "now");
  fs.mkdirSync(before);
  fs.mkdirSync(now);
  const grey = encodePng(solid(20, 20, [90, 90, 90]));
  fs.writeFileSync(path.join(before, "same.png"), grey);
  fs.writeFileSync(path.join(now, "same.png"), grey);
  fs.writeFileSync(path.join(before, "moved.png"), grey);
  fs.writeFileSync(path.join(now, "moved.png"), encodePng(solid(20, 20, [250, 90, 90])));
  fs.writeFileSync(path.join(before, "gone.png"), grey);
  fs.writeFileSync(path.join(now, "new.png"), grey);
  const r = compareShots(now, before, path.join(dir, "diff"));
  assert.equal(r.compared, 2);
  assert.deepEqual(r.changed.map((c) => c.shot), ["moved.png"]);
  assert.deepEqual(r.added, ["new.png"]);
  assert.deepEqual(r.removed, ["gone.png"]);
  assert.ok(fs.existsSync(path.join(dir, "diff", "moved.png")));
  assert.equal(compareShots(now, null, path.join(dir, "d2")).note, "no previous run to compare with");
  fs.rmSync(dir, { recursive: true, force: true });
});
