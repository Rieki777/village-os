/**
 * The sync route's two gates, and every way a sync can fail without lying.
 *
 * THE GATE ASYMMETRY IS THE POINT OF THE FIRST HALF. Causing a sync is
 * `intake.moderate`, because a sync produces proposals and the person allowed
 * to cause them is the person who reads them. Reading the vendor's detail is
 * NOT gated on that: Rye's reason, 2026-09-24, is that a member should be able
 * to read what a role involves before deciding whether to put their hand up.
 * A test that only checked the steward path would let somebody "tidy" the
 * member path behind the same key and take that away.
 *
 * THE SECOND HALF IS THE REFUSALS. A sync has five distinct ways to come back
 * with nothing, and four of them are faults. If they all render as "nothing
 * happened", a steward spends an afternoon on it. So each is named here.
 *
 * NO DATABASE, on purpose: what is under test is which refusals happen and
 * what each one says, so the collaborators become stubs and the real handler
 * runs behind a real Express app.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  secret: { configured: true, unreadable: false, atRest: "sealed" as string | null },
  keyPresent: true,
  value: "t0ken" as string | null,
  session: "sess-1" as string | null,
  call: { ok: true, records: [] as unknown[], cursor: null } as Record<string, unknown>,
  landed: 0,
  facts: 0,
  factsRead: 0,
}));

vi.mock("../lib/secrets", () => ({
  secretStatus: () => ({
    key: "sera_api_secret",
    configured: state.secret.configured,
    source: state.secret.configured ? "admin" : "none",
    last4: "9f2a",
    setBy: null,
    setAt: null,
    atRest: state.secret.atRest,
    unreadable: state.secret.unreadable,
  }),
  villageSecretsConfigured: () => state.keyPresent,
  secretValue: () => state.value,
}));

vi.mock("../lib/saberraClient", () => ({
  openSession: async () => state.session,
  callTool: async () => state.call,
}));

vi.mock("../lib/identity", () => ({ instanceIdentity: () => ({ instanceId: "village-1", bornAt: "" }) }));

vi.mock("../lib/externalProposals", () => ({
  landProposal: async () => {
    state.landed += 1;
    return { ok: true, id: `p-${state.landed}`, outcome: "stored" };
  },
}));

vi.mock("../repos/moduleFacts", () => ({
  upsertFacts: async (_p: unknown, _v: unknown, _m: unknown, f: unknown[]) => {
    state.facts += f.length;
    return f.length;
  },
  moduleFactCount: async () => 7,
  factsForEntity: async () => {
    state.factsRead += 1;
    return [{ vendorRecordId: "r-1", fields: { "Role Type": "Steward" } }];
  },
}));

import { register } from "./saberra";

let server: http.Server;
let base: string;
let may = true;
let signedIn = true;

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function post(path: string, body: unknown = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  register(app, {
    // Refuses the way the real one does: writes the response and answers false.
    guardCapability: (async (_req: unknown, res: any) => {
      if (may) return true;
      res.status(403).json({ error: "You do not hold that key." });
      return false;
    }) as never,
    getPool: (() => ({})) as never,
    authedUser: (async () => (signedIn ? { id: "u-1" } : null)) as never,
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  may = true;
  signedIn = true;
  state.secret = { configured: true, unreadable: false, atRest: "sealed" };
  state.keyPresent = true;
  state.value = "t0ken";
  state.session = "sess-1";
  state.call = { ok: true, records: [], cursor: null };
  state.landed = 0;
  state.facts = 0;
  state.factsRead = 0;
});

describe("who may cause a sync", () => {
  it("refuses a sync without the queue's key", async () => {
    may = false;
    expect((await post("/api/saberra/sync")).status).toBe(403);
    expect(state.landed).toBe(0);
  });

  it("refuses the status read without the queue's key", async () => {
    may = false;
    expect((await get("/api/saberra/status")).status).toBe(403);
  });

  it("LETS A MEMBER READ THE DETAIL WITHOUT THAT KEY, which is the whole point of the panel", async () => {
    // A member deciding whether to apply for a seat does not hold the review
    // queue. If this ever starts asking for it, the panel is gone.
    may = false;
    const r = await get("/api/saberra/facts?kind=org_role&id=role-1");
    expect(r.status).toBe(200);
    expect(state.factsRead).toBe(1);
  });

  it("still asks a reader to be signed in", async () => {
    signedIn = false;
    expect((await get("/api/saberra/facts?kind=org_role&id=role-1")).status).toBe(401);
  });

  it("asks which seat, instead of answering everything", async () => {
    expect((await get("/api/saberra/facts")).status).toBe(400);
  });
});

describe("the ways a sync comes back with nothing", () => {
  it("SAYS THE KEY CHANGED rather than that nothing is set up", async () => {
    // A stored key this process cannot open reports `configured: false`, which
    // is identical to never having connected. The connection reading is what
    // keeps those apart and this asserts it survives the route.
    state.secret = { configured: false, unreadable: true, atRest: "sealed" };
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(409);
    expect(r.body.state).toBe("key-changed");
    expect(String(r.body.error)).toContain("cannot open it");
    expect(state.landed).toBe(0);
  });

  it("says the deployment cannot store a key at all, before anybody types one", async () => {
    state.secret = { configured: false, unreadable: false, atRest: null };
    state.keyPresent = false;
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(409);
    expect(r.body.state).toBe("cannot-store");
  });

  it("says there is no address, instead of calling an empty one", async () => {
    const r = await post("/api/saberra/sync", { config: {} });
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain("no address");
  });

  it("says the session never opened, instead of reporting an empty village", async () => {
    state.session = null;
    const r = await post("/api/saberra/sync", { config: { apiUrl: "https://example.test/" } });
    expect(r.status).toBe(502);
    expect(String(r.body.error)).toContain("did not open a session");
  });

  it("NAMES A VENDOR REFUSAL PER KIND instead of landing nothing in silence", async () => {
    state.call = { ok: false, why: "vendor-error", detail: "scope does not permit this tool" };
    const r = await post("/api/saberra/sync", { config: { apiUrl: "https://example.test/" } });
    expect(r.status).toBe(200);
    expect(r.body.landed).toBe(0);
    // One entry per kind asked for, each carrying the vendor's own words.
    expect(r.body.failures.length).toBeGreaterThan(0);
    expect(String(r.body.failures[0].detail)).toContain("scope");
  });

  it("tells a genuinely empty service apart from a broken one", async () => {
    state.call = { ok: true, records: [], cursor: null };
    const r = await post("/api/saberra/sync", { config: { apiUrl: "https://example.test/" } });
    expect(r.status).toBe(200);
    expect(r.body.landed).toBe(0);
    expect(r.body.failures).toEqual([]);
  });
});

describe("a sync that works", () => {
  it("lands the structure half and stores the detail", async () => {
    state.call = {
      ok: true,
      cursor: null,
      records: [{ id: "r-1", fields: { "Role Name": "Water Steward", Circle: "Land & Ecology" } }],
    };
    const r = await post("/api/saberra/sync", { config: { apiUrl: "https://example.test/" } });
    expect(r.status).toBe(200);
    expect(r.body.landed).toBeGreaterThan(0);
    expect(state.facts).toBeGreaterThan(0);
  });

  it("REPORTS THE HELD CIRCLES rather than pretending they landed", async () => {
    // A circle cannot be proposed until `create_circle` exists. The sync says
    // so per record instead of quietly returning a smaller number.
    state.call = {
      ok: true,
      cursor: null,
      records: [{ id: "c-1", fields: { "Circle Name": "Land & Ecology", Status: "Active" } }],
    };
    const r = await post("/api/saberra/sync", { config: { apiUrl: "https://example.test/" } });
    const held = r.body.held as { reason: string }[];
    expect(held.some((h) => h.reason === "no-create-circle-op")).toBe(true);
  });

  it("carries what it could not map upward, so a steward is never given less in silence", async () => {
    state.call = {
      ok: true,
      cursor: null,
      records: [{ id: "r-1", fields: { "Role Name": "Water Steward", "Some New Field": "x" } }],
    };
    const r = await post("/api/saberra/sync", { config: { apiUrl: "https://example.test/" } });
    expect(r.body.unmapped).toContain("Some New Field");
  });
});
