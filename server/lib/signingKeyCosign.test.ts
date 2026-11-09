/**
 * Two signatures to replace the village signing key after launch (the
 * coordinator, 2026-11-08, on Rye's two-signature rule). The decision is pure
 * and tested branch by branch; the pending request and the single-use co-sign
 * are tested against a real schema. The route end to end is in
 * server/authzRound.routes.e2e.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { askForRotation, clearPendingRotation, decideRotation, readPendingRotation, rotationNeedsCosign, type PendingRotation, type RotationAsk } from "./signingKeyCosign";
import { claimRotationCosign, releaseRotationCosign } from "../repos/signingKeyRow";
import { loadVariables } from "./variables";

const pending = (over: Partial<PendingRotation> = {}): PendingRotation => ({
  id: "rotate-1",
  requestedBy: "u-ann",
  requestedAt: "2026-11-08T10:00:00.000Z",
  expiresAt: "2026-11-11T10:00:00.000Z",
  fromKid: "kid-old",
  ...over,
});
const ask = (over: Partial<RotationAsk> = {}): RotationAsk => ({
  phase: "after-launch",
  signers: ["u-ann", "u-bo"],
  actor: "u-ann",
  actorIsPerson: true,
  pending: null,
  currentKid: "kid-old",
  ...over,
});

describe("who has to sign a new signing key", () => {
  it("before launch, one admin replaces it at once, however many could sign", () => {
    expect(decideRotation(ask({ phase: "before-launch", signers: ["u-ann", "u-bo", "u-cy"] }))).toEqual({ kind: "rotate", alone: false });
  });

  it("after launch, the only possible signer replaces it at once, and the record says alone", () => {
    expect(decideRotation(ask({ signers: ["u-ann"] }))).toEqual({ kind: "rotate", alone: true });
    expect(rotationNeedsCosign("after-launch", ["u-ann", "u-ann"]), "one person counted twice is still one").toBe(false);
  });

  it("after launch, with two who can sign, the first press asks and replaces nothing", () => {
    expect(decideRotation(ask())).toEqual({ kind: "ask", existing: null });
    // An admin on the shared password is a second person beside the one admin with a login.
    expect(decideRotation(ask({ signers: ["u-bo"], actor: "admin-password" }))).toEqual({ kind: "ask", existing: null });
  });

  it("the asker pressing again is never the second signature", () => {
    const p = pending();
    expect(decideRotation(ask({ pending: p }))).toEqual({ kind: "ask", existing: p });
  });

  it("a different signer with their own login completes it", () => {
    const p = pending();
    expect(decideRotation(ask({ pending: p, actor: "u-bo" }))).toEqual({ kind: "cosign", pending: p });
  });

  it("an agent and an admin who cannot sign are refused the co-sign", () => {
    const p = pending();
    const agent = decideRotation(ask({ pending: p, actor: "u-bo", actorIsPerson: false }));
    expect(agent).toMatchObject({ kind: "refuse", status: 403 });
    const outsider = decideRotation(ask({ pending: p, actor: "admin-password" }));
    expect(outsider).toMatchObject({ kind: "refuse", status: 403 });
  });

  it("a request for a key that has since been replaced is stale, and the press asks afresh", () => {
    expect(decideRotation(ask({ pending: pending({ fromKid: "kid-older" }), actor: "u-bo" }))).toEqual({ kind: "ask", existing: null });
  });
});

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
  await loadVariables(pool);
}, 300000);

afterAll(async () => {
  if (pool) await pool.end();
  if (db) await db.drop();
});

describe.skipIf(!configured)("the pending request and its one co-sign, on a real schema", () => {
  it("waits until platform.cosign_expiry_hours, then is gone; clearing it leaves nothing", async () => {
    const at = new Date("2026-11-08T10:00:00.000Z");
    const p = await askForRotation(pool, "u-ann", "kid-old", at);
    expect(new Date(p.expiresAt).getTime() - at.getTime()).toBe(72 * 3600_000);
    expect(await readPendingRotation(pool, new Date(at.getTime() + 3600_000))).toEqual(p);
    expect(await readPendingRotation(pool, new Date(at.getTime() + 72 * 3600_000))).toBeNull();
    await clearPendingRotation(pool);
    expect(await readPendingRotation(pool, at)).toBeNull();
  });

  it("two co-signers pressing at once: one claim wins, and a failed replacement gives it back", async () => {
    const both = await Promise.all([claimRotationCosign(pool, "rotate-race", "u-bo"), claimRotationCosign(pool, "rotate-race", "u-cy")]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await claimRotationCosign(pool, "rotate-race", "u-bo")).toBe(false);
    await releaseRotationCosign(pool, "rotate-race");
    expect(await claimRotationCosign(pool, "rotate-race", "u-bo")).toBe(true);
  });
});
