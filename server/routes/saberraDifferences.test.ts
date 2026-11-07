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

import { ageOutStoredReads, register, SNAPSHOT_AGE_JOB } from "./saberra";
import { registeredJobs } from "../lib/scheduler";
import { batchLinks, heldPageIdsOf, holderNamesByRole, listAnswer, type DifferencesRead } from "../lib/seraDifferencesRead";
import type { Difference } from "../../shared/seraDifferences";

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
/** Who holds each power live, as the gate counts them. */
const liveHolders: Record<string, string[]> = { "org.decide": ["u-rye"], "cash.pay": [] };
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
    members: { all: async () => [{ id: "u-rye", name: "Rye Weaver", email: "rye@example.test" }] } as never,
    deciders: {
      roles: () => [{ id: "ops-lead", name: "Ops lead", capabilities: liveHolders["org.decide"].length ? ["org.decide"] : [] }, { id: "treasurer", name: "Treasurer", capabilities: ["cash.pay"] }],
      roleHolders: () => [{ roleId: "ops-lead", userId: "u-rye" }],
      orgRoles: async () => [],
      villageHolder: async () => null,
    },
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
      toDecide: 2,
      small: 0,
      facts: 0,
      // Who decides and who sets pay, from the holder test: role names and first names only (S2).
      // Before launch (the mock has held no launch vote) the admins hold the door beside the role (N4).
      decides: { by: "holders", labels: ["Ops lead (Rye)"], more: 0, stewards: false, others: 0, admins: true },
      paySetBy: { by: "admins" },
      // About this reader only, outside the cache (Q5): may they read the list, and do they decide.
      reader: { mayRead: false, decides: false },
      lanes: { facts: 0, lowRisk: 0, decision: 2 },
      conflicts: 0,
      checkFirst: 2,
      oursAhead: 0,
      lastReadAt: "2025-11-06T09:00:00.000Z",
      lastReadWhole: true,
    });
    // It gated on no key: it only LOOKED, to tell this reader whether the list is theirs to read (Q5).
    expect(asked).toEqual(["look:intake.moderate"]);
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
    // A first sight implies the unknown base, so the screen leaves the base off (R39)...
    expect(r.body.differences[1].words).toMatchObject({
      flags: ["Check first: the first time Sera has sent this", "Check first: Sera puts it in a circle this village doesn't have"],
      source: "From Sera's record",
      open: `https://dash.example.test/${SEED}`,
      openWords: "Open in Sera",
    });
    // ...and the data keeps it, so an unknown base is still never taken in bulk or applied by itself (R2).
    expect(r.body.differences[1].flags.map((f: { key: string }) => f.key)).toContain("baseUnknown");
    expect(r.body.differences[1].bulkEligible).toBe(false);
    expect(r.body.differences[1].autoEligible).toBe(false);
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

describe("the words the list sends", () => {
  /** A role here, matched by its page id. */
  const role = (over: Partial<Difference>): Difference => ({
    key: "p:x", kind: "roleMove", lane: "decision", state: "suggestion", field: "circle", sera: "land", ours: "water",
    base: { value: "water" }, seraHash: "s", oursHash: "o", flags: [], namesAMember: false, autoEligible: false,
    bulkEligible: true, takeable: true, source: { pageId: "p", editedAt: null }, params: { from: "Water", to: ["Land & Ecology"] },
    subject: { kind: "role", pageId: "p", ourId: "r-water", via: "pageId", name: "Water Steward", circleId: "water", circleName: "Water" },
    ...over,
  });
  const read = (list: Difference[], holders: Record<string, string[]>): DifferencesRead => ({
    list, latest: null, lastWhole: { circles: null, roles: null }, circleOrder: [], holders, heldPageIds: [],
  });
  const sentences = (r: DifferencesRead) =>
    listAnswer(r, { agent: "Sera", dashboard: "", timeZone: "UTC" }).differences.map((d) => d.words.sentence);

  it("NAMES A ROLE WITH ITS HOLDERS HERE, from the live chart (Role (FirstName))", () => {
    expect(sentences(read([role({})], { "r-water": ["Ana Moss"] }))).toEqual([
      "Sera suggests moving Water Steward (Ana) from Water to Land & Ecology.",
    ]);
    expect(sentences(read([role({})], {}))).toEqual(["Sera suggests moving Water Steward from Water to Land & Ecology."]);
  });

  it("SAYS NOBODY HOLDS A ROLE THE SERVICE ARCHIVED, and names who does", () => {
    const rest = role({ kind: "roleRest", field: null, sera: "gone", ours: "live", subject: { kind: "role", pageId: "p", ourId: "r-dish", via: "pageId", name: "Dish Rota", circleId: "kitchen", circleName: "Kitchen" } });
    expect(sentences(read([rest], {}))).toEqual(["Sera has archived Dish Rota. It is still live here, and nobody holds it."]);
    expect(sentences(read([rest], { "r-dish": ["Ana Moss"] }))).toEqual(["Sera has archived Dish Rota (Ana). It is still live here."]);
  });
});

describe("who decides, on the count", () => {
  it("CARRIES NO ID, NO ADDRESS AND NO SURNAME of a holder, and says nothing without the holder reads (S2)", async () => {
    const told = JSON.stringify((await get("/api/saberra/differences/count")).body);
    for (const never of ["u-rye", "Weaver", "example.test"]) expect(told).not.toContain(never);
    const bare = (await get("/api/saberra/differences/count", bareBase)).body;
    expect(bare.decides).toBeNull();
    expect(bare.paySetBy).toBeNull();
  });
});

describe("about this reader (Q5)", () => {
  it("SAYS WHETHER THIS READER MAY READ THE LIST, by the list's own gate, and whether they decide", async () => {
    who.mayLook = true;
    expect((await get("/api/saberra/differences/count")).body.reader).toEqual({ mayRead: true, decides: false });
    expect((await get("/api/saberra/differences/count", bareBase)).body.reader).toEqual({ mayRead: null, decides: false });
  });
});

describe("which arrival holds each difference (C7, S1)", () => {
  const roleDiff = (pageId: string) => ({ kind: "roleMove", subject: { kind: "role", pageId } }) as never;
  const circleDiff = (pageId: string) => ({ kind: "circleAdd", subject: { kind: "circle", pageId } }) as never;
  const batches = [
    { batchId: "old", kind: "org.proposed", receivedAt: "2026-11-01T10:00:00.000Z", payload: { seats: [{ id: "AAAA-1111" }, { id: "bbbb2222" }] } },
    { batchId: "new", kind: "org.proposed", receivedAt: "2026-11-05T10:00:00.000Z", payload: { seats: [{ id: "bbbb-2222" }] } },
    { batchId: "circ", kind: "circle.proposed", receivedAt: "2026-11-03T10:00:00.000Z", payload: { vendorRecordId: "cccc-3333" } },
  ];
  it("LINKS A ROLE TO THE NEWEST WAITING BATCH CARRYING ITS PAGE ID, a circle by its record id, and nothing to none", () => {
    const out = batchLinks([roleDiff("aaaa1111"), roleDiff("BBBB2222"), circleDiff("cccc3333"), roleDiff("dddd4444")], batches, ["aaaa1111", "bbbb2222"], "2026-11-06T10:00:00.000Z");
    expect(out.links).toEqual(["old", "new", "circ", null]);
  });
  it("HOLDS A BATCH ONLY WHEN THE NEWEST READ HOLDS EVERY PAGE ID IT CARRIES", () => {
    const out = batchLinks([], batches, ["aaaa1111", "bbbb2222"], "2026-11-06T10:00:00.000Z");
    expect(out.held.sort()).toEqual(["new", "old"]);
  });
  it("NEVER HOLDS A BATCH NEWER THAN THE NEWEST READ, whose fields the read cannot hold (K6)", () => {
    // The read was taken before "new" landed (its snapshot write failed): page ids alone would call it held.
    const out = batchLinks([], batches, ["aaaa1111", "bbbb2222"], "2026-11-04T10:00:00.000Z");
    expect(out.held).toEqual(["old"]);
    expect(batchLinks([], batches, ["aaaa1111", "bbbb2222"], null).held).toEqual([]);
  });
  it("HOLDS ONLY WHAT THE NEWEST READ READ ITSELF, never a record it carried from the read before (R3-3)", () => {
    const snap = {
      takenAt: "2026-11-06T10:00:00.000Z", trigger: "scheduled",
      circles: { read: "whole", records: [{ id: "cccc-3333", fields: {} }] },
      // Roles failed part way: what the row holds for them was carried.
      roles: { read: "cut-short", records: [{ id: "aaaa1111", fields: {}, readAt: "2026-11-05T10:00:00.000Z" }] },
    };
    expect(heldPageIdsOf(snap as never)).toEqual(["cccc3333"]);
    // A carried record inside a kind read whole is not held either.
    const mixed = { ...snap, roles: { read: "whole", records: [{ id: "bbbb2222", fields: {} }, { id: "aaaa1111", fields: {}, readAt: "2026-11-05T10:00:00.000Z" }] } };
    expect(heldPageIdsOf(mixed as never)).toEqual(["cccc3333", "bbbb2222"]);
  });
  it("NAMES NO HOLDER WHOSE TERM HAS LAPSED (N5)", () => {
    const roster = [{ id: "u-ana", name: "Ana Moss" }, { id: "u-bo", name: "Bo Reyes" }];
    const seatings = [
      { orgRoleId: "r-water", userId: "u-ana", displayName: null, isExample: false, lapsed: false },
      { orgRoleId: "r-water", userId: "u-bo", displayName: null, isExample: false, lapsed: true },
    ];
    expect(holderNamesByRole(seatings, roster)).toEqual({ "r-water": ["Ana Moss"] });
  });
});

describe("stored reads age out", () => {
  it("FORGETS THE CACHED LIST WHEN THE AGE JOB CUTS ANYTHING, since a cut leaves every seq as it was (R3-5)", async () => {
    let forgot = 0;
    const forget = () => { forgot += 1; };
    expect(await ageOutStoredReads(pool as never, async () => 2, forget)).toContain("removed 2");
    expect(forgot).toBe(1);
    await ageOutStoredReads(pool as never, async () => 0, forget);
    expect(forgot).toBe(1);
  });

  it("REGISTERS A DAILY JOB that ages stored reads out, whatever the schedule or the module (R27)", () => {
    expect(registeredJobs()).toContainEqual({ name: SNAPSHOT_AGE_JOB, everyMs: 24 * 60 * 60 * 1000 });
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
