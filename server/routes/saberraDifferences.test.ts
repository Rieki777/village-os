/**
 * The two differences routes: the count any signed-in member reads, and the
 * list behind the review queue's own key (spec R25).
 *
 * THE GATES ARE THE FIRST HALF. The count is the village's to see (I.3), so it
 * asks only that a reader is signed in, and it is its own payload: totals per
 * lane and the last read, never a subject. The list carries the service's
 * words and our values, so it asks `mayStillSee("intake.moderate")`, the read
 * the review queue asks, which never breaks glass on a GET.
 *
 * THE SECOND HALF IS THAT LOOKING WRITES NOTHING. The real read runs over a
 * pool that records every statement, and every statement is a SELECT.
 *
 * No database: the pool answers from fixtures. The snapshot itself is held
 * against a real schema in server/lib/saberraSnapshot.test.ts.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/secrets", () => ({
  secretStatus: () => ({ key: "sera_api_secret", configured: true, source: "admin", last4: "9f2a", setBy: null, setAt: null, atRest: "sealed", unreadable: false }),
  villageSecretsConfigured: () => true,
  villageSecretsKeyProblem: () => null,
  secretValue: () => "t0ken",
}));
vi.mock("../lib/identity", () => ({ instanceIdentity: () => ({ instanceId: "village-1", bornAt: "" }) }));
vi.mock("../lib/modules", () => ({
  moduleConfig: () => ({ apiUrl: "https://service.example.test/mcp", dashboardUrl: "https://dash.example.test", agentName: "Sera" }),
  effectiveLifecycle: () => "preview",
}));

import { register } from "./saberra";

const LAND = "0".repeat(31) + "1";
const NEW = "0".repeat(30) + "30";
const SEED = "0".repeat(30) + "31";

/** What the snapshot table holds: one whole read with a circle here, a new circle and a new role in it. */
const SNAPSHOT_ROW = {
  seq: 7,
  taken: 1762419600,
  run_trigger: "by-hand",
  circles_read: "whole",
  circles: JSON.stringify([
    { id: LAND, fields: { "Circle Name": "Land", Status: "Active" } },
    { id: NEW, fields: { "Circle Name": "Land Stewardship", Status: "Active" } },
  ]),
  roles_read: "whole",
  roles: JSON.stringify([{ id: SEED, fields: { "Role Name": "Seed Keeper", Circle: [{ id: NEW }], Body: "Keeps the seed bank.", Status: "Active" } }]),
};

/** A pool that answers the read's SELECTs from fixtures and records every statement it is sent. */
const sent: string[] = [];
const pool = {
  query: async (sql: string) => {
    sent.push(sql);
    if (/FROM saberra_snapshots/.test(sql)) return [[SNAPSHOT_ROW], []];
    if (/FROM circles/.test(sql)) return [[{ id: "land", name: "Land", aliases: "[]", parent_circle_id: null, status: "active", is_example: 0 }], []];
    return [[], []];
  },
};

let base = "";
let server: http.Server;
let bare: http.Server;
let bareBase = "";
const who = { signedIn: true, mayLook: false, mayGuard: false, limited: false };
const asked: string[] = [];
const buckets: string[] = [];
let guardCalls = 0;

const guardCapability = (async (_req: unknown, res: any, cap: string) => {
  guardCalls += 1;
  asked.push(`guard:${cap}`);
  if (who.mayGuard) return true;
  res.status(403).json({ error: "You do not hold that key." });
  return false;
}) as never;
const authedUser = (async () => (who.signedIn ? { id: "u-1" } : null)) as never;

async function listen(app: express.Express): Promise<[http.Server, string]> {
  const s = http.createServer(app);
  await new Promise<void>((r) => s.listen(0, r));
  return [s, `http://127.0.0.1:${(s.address() as { port: number }).port}`];
}

beforeAll(async () => {
  const app = express();
  register(app, {
    guardCapability,
    getPool: (() => pool) as never,
    authedUser,
    mayStillSee: (async (_req: unknown, cap: string) => {
      asked.push(`look:${cap}`);
      return who.mayLook;
    }) as never,
    overLimit: (async (bucket: string) => {
      buckets.push(bucket);
      return who.limited;
    }) as never,
  });
  [server, base] = await listen(app);

  // The same routes as the deployment wires them today: no read gate and no limiter handed in.
  const plain = express();
  register(plain, { guardCapability, getPool: (() => pool) as never, authedUser });
  [bare, bareBase] = await listen(plain);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => bare.close(() => r()));
});

beforeEach(() => {
  Object.assign(who, { signedIn: true, mayLook: false, mayGuard: false, limited: false });
  asked.length = 0;
  buckets.length = 0;
  sent.length = 0;
  guardCalls = 0;
});

async function get(path: string, at = base) {
  const res = await fetch(`${at}${path}`); // module-review-ok: this suite's own loopback server, not an outbound call
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("the count", () => {
  it("IS FOR ANY SIGNED-IN MEMBER, holding no key, AND NAMES NO SUBJECT", async () => {
    const r = await get("/api/saberra/differences/count");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      total: 2,
      lanes: { facts: 0, lowRisk: 0, decision: 2 },
      conflicts: 0,
      checkFirst: 2,
      oursAhead: 0,
      lastReadAt: "2025-11-06T09:00:00.000Z",
      lastReadWhole: true,
    });
    // It asked for no key at all.
    expect(asked).toEqual([]);
    // The known positive: the list for a reader with the key DOES carry the subjects.
    who.mayLook = true;
    const list = JSON.stringify((await get("/api/saberra/differences")).body);
    const count = JSON.stringify(r.body);
    for (const subject of ["Land Stewardship", "Seed Keeper", SEED, NEW, "seed bank"]) {
      expect(list).toContain(subject);
      expect(count).not.toContain(subject);
    }
  });

  it("still asks a reader to be signed in", async () => {
    who.signedIn = false;
    expect((await get("/api/saberra/differences/count")).status).toBe(401);
  });
});

describe("the list", () => {
  it("IS GATED ON LOOKING WITH THE REVIEW QUEUE'S KEY, and never asks the act's gate", async () => {
    const refused = await get("/api/saberra/differences");
    expect(refused).toEqual({ status: 401, body: { error: "auth_required" } });
    expect(asked).toEqual(["look:intake.moderate"]);

    who.mayLook = true;
    const r = await get("/api/saberra/differences");
    expect(r.status).toBe(200);
    expect(guardCalls).toBe(0);
    expect(r.body.agent).toBe("Sera");
    expect(r.body.count.total).toBe(2);
    expect(r.body.differences.map((d: { words: { sentence: string } }) => d.words.sentence)).toEqual([
      "Sera suggests a new circle, Land Stewardship, with 1 role.",
      "Sera suggests a new role, Seed Keeper, in Land Stewardship.",
    ]);
    expect(r.body.differences[1].words).toMatchObject({
      flags: ["Check first: nothing was taken from Sera for this before, so there is no earlier version to compare", "Check first: the first time Sera has sent this", "Check first: Sera puts it in a circle this village doesn't have"],
      source: "From Sera's record",
      open: `https://dash.example.test/${SEED}`,
      openWords: "Open in Sera",
    });
  });

  it("SAYS WHEN EACH KIND WAS LAST READ WHOLE, so a failed read can name the check the list is from (R36)", async () => {
    who.mayLook = true;
    const r = await get("/api/saberra/differences");
    expect(r.status).toBe(200);
    expect(r.body.lastWholeAt).toEqual({ circles: "2025-11-06T09:00:00.000Z", roles: "2025-11-06T09:00:00.000Z" });
    // The count is totals and the last read, and stays exactly that.
    expect(Object.keys((await get("/api/saberra/differences/count")).body)).not.toContain("lastWholeAt");
  });

  it("CARRIES THE CIRCLES HERE IN CHART ORDER, by id alone, so the page groups in that order (US2.3)", async () => {
    who.mayLook = true;
    const r = await get("/api/saberra/differences");
    expect(r.body.circleOrder).toEqual(["land"]);
    expect(Object.keys((await get("/api/saberra/differences/count")).body)).not.toContain("circleOrder");
  });

  it("WITHOUT THE READ GATE WIRED, falls back to the module's own gate and never opens wider", async () => {
    const refused = await get("/api/saberra/differences", bareBase);
    expect(refused.status).toBe(403);
    expect(asked).toEqual(["guard:intake.moderate"]);
    who.mayGuard = true;
    expect((await get("/api/saberra/differences", bareBase)).status).toBe(200);
  });
});

describe("what looking costs", () => {
  it("WRITES NOTHING: every statement either route sends is a SELECT", async () => {
    who.mayLook = true;
    await get("/api/saberra/differences/count");
    await get("/api/saberra/differences");
    expect(sent.length).toBeGreaterThan(4);
    for (const sql of sent) expect(sql.trim()).toMatch(/^SELECT\b/i);
  });

  it("is bounded per member when the limiter is wired", async () => {
    who.mayLook = true;
    await get("/api/saberra/differences/count");
    await get("/api/saberra/differences");
    expect(buckets).toEqual(["sera-differences-count:u-1", "sera-differences:u-1"]);
    who.limited = true;
    expect((await get("/api/saberra/differences/count")).status).toBe(429);
    expect((await get("/api/saberra/differences")).status).toBe(429);
  });
});
