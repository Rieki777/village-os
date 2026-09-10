/**
 * Taking a portrait back, over real HTTP against a real volume.
 *
 * ── THE CLAIM UNDER TEST ─────────────────────────────────────────────────
 *
 * "Un-publish" used to clear `published_at` and nothing else. That takes the
 * picture out of every listing and leaves the FILE exactly where it was, under
 * exactly the name every visitor's browser had already been handed. There is
 * no sign-in in front of `/api/uploads/:filename`, so the address IS the
 * capability: everybody who ever opened the page kept a working link to a
 * picture its owner had just withdrawn.
 *
 * So the assertions here are about the VOLUME and not about a flag. A test
 * that only checked `published_at` would pass against the defect, which is the
 * exact shape this repository keeps producing: a green about the wrong fact.
 *
 * ── WHY A REAL SERVER ────────────────────────────────────────────────────
 *
 * The move lives in the route, because a repository may not touch the volume,
 * and the interesting failures are the ordering ones: which file exists when.
 * A handler called with a hand-built `req` would exercise the same lines and
 * prove nothing about the door, and the door is what a member presses. The
 * port is bound at 0 and read back, so this file allocates no window and can
 * never collide with an e2e suite (scripts/check-e2e-ports.mjs asks for
 * exactly this).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { seedEconomy } from "../lib/economySeed";
import * as portraits from "../repos/characterPortraits";
import { register } from "./characterPortraits";

const configured = testDbConfigured();
const VILLAGE = "local";
const KEY = "building";
const OWNER = "portrait-withdrawer";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";
let server: http.Server;
let base = "";

const bytesOf = (name: string) => fs.readFileSync(path.join(uploadsDir, name));
const onVolume = () => fs.readdirSync(uploadsDir);

async function publish(published: boolean): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api/me/portraits/${KEY}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ published }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

/** A published portrait whose bytes really sit on the volume. */
async function givePublishedPortrait(fileName: string, body = "the picture itself"): Promise<void> {
  fs.writeFileSync(path.join(uploadsDir, fileName), Buffer.from(body));
  await portraits.upsertPortrait(pool, {
    id: `cp-${OWNER}`,
    villageId: VILLAGE,
    userId: OWNER,
    archetypeKey: KEY,
    fileName,
    source: "uploaded",
    width: 512,
    height: 512,
    bytes: body.length,
  });
  await portraits.setPublished(pool, VILLAGE, OWNER, KEY, true);
}

describe.skipIf(!configured)("taking a portrait back", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await seedEconomy(pool, VILLAGE);
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [OWNER, OWNER, `${OWNER}@examples.invalid`],
    );
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-portrait-withdraw-"));

    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () => ({ id: OWNER, name: OWNER }) as any,
      getPool: () => pool,
      uploadsDir,
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop?.();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `character_portraits` WHERE `user_id` = ?", [OWNER]); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    for (const f of onVolume()) fs.rmSync(path.join(uploadsDir, f), { force: true });
  });

  it("moves the bytes to a name nobody has seen, so the published address dies", async () => {
    const published = "portrait-was-public.webp";
    await givePublishedPortrait(published, "still mine");

    const { status, body } = await publish(false);

    expect(status).toBe(200);
    expect(body.addressRevoked).toBe(true);
    // The address a stranger wrote down no longer resolves to anything.
    expect(fs.existsSync(path.join(uploadsDir, published))).toBe(false);
    // And the member still has their picture, byte for byte. Withdrawing is
    // not deleting, and DELETE /api/me/portraits/:key is the other door.
    const row = await portraits.portraitFor(pool, VILLAGE, OWNER, KEY);
    expect(row!.publishedAt).toBeNull();
    expect(row!.fileName).not.toBe(published);
    expect(bytesOf(row!.fileName!).toString()).toBe("still mine");
    expect(onVolume()).toHaveLength(1);
  });

  it("keeps the portrait readable to its owner after the move", async () => {
    await givePublishedPortrait("portrait-owner-reads.webp");

    await publish(false);
    const res = await fetch(`${base}/api/me/portraits`);
    const view = await res.json();

    // The studio renders from the row, so a move that the row did not adopt
    // would show the owner a broken image here.
    const mine = view.portraits.find((p: any) => p.archetypeKey === KEY);
    expect(mine.publishedAt).toBeNull();
    expect(mine.url).toBeTruthy();
    expect(fs.existsSync(path.join(uploadsDir, String(mine.url).replace("/api/uploads/", "")))).toBe(true);
  });

  it("answers honestly when the bytes were already gone", async () => {
    await givePublishedPortrait("portrait-vanished.webp");
    fs.rmSync(path.join(uploadsDir, "portrait-vanished.webp"));

    const { body } = await publish(false);

    // Nothing to revoke, because the address already answers 404. Saying yes
    // here is the truth; saying no would send a steward looking for a file.
    expect(body.addressRevoked).toBe(true);
    expect((await portraits.portraitFor(pool, VILLAGE, OWNER, KEY))!.publishedAt).toBeNull();
  });

  it("publishing says nothing about revocation, because it revokes nothing", async () => {
    await givePublishedPortrait("portrait-going-public.webp");
    await publish(false);

    const row = await portraits.portraitFor(pool, VILLAGE, OWNER, KEY);
    const { status, body } = await publish(true);

    expect(status).toBe(200);
    expect(body).not.toHaveProperty("addressRevoked");
    // Re-publishing hands out the CURRENT name, which is the one the
    // withdrawal moved the bytes to. The old address stays dead.
    expect((await portraits.portraitFor(pool, VILLAGE, OWNER, KEY))!.fileName).toBe(row!.fileName);
    expect(fs.existsSync(path.join(uploadsDir, "portrait-going-public.webp"))).toBe(false);
  });

  it("refuses a withdrawal on a path holding nothing, and moves no bytes", async () => {
    const { status } = await publish(false);
    expect(status).toBe(404);
    expect(onVolume()).toEqual([]);
  });
});
