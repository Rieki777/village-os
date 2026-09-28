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
  apiUrl: "https://example.test/" as string,
  written: [] as Record<string, unknown>[],
  landedPayloads: [] as Record<string, unknown>[],
  batchIds: [] as string[],
  pages: 0,
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

// The address comes from the STORE now, never from the caller.
vi.mock("../lib/modules", () => ({ moduleConfig: () => ({ apiUrl: state.apiUrl }) }));

// One live seat, so a fact can be attached to it by name.
vi.mock("../lib/orgChart", () => ({
  listOrgRoles: async () => [{ id: "role-77", name: "Water Steward" }],
}));

vi.mock("../lib/externalProposals", () => ({
  landProposal: async (_p: unknown, input: Record<string, unknown>) => {
    state.landed += 1;
    state.landedPayloads.push(input);
    state.batchIds.push(String(input.batchId));
    return { ok: true, id: `p-${state.landed}`, outcome: "stored" };
  },
}));

vi.mock("../repos/moduleFacts", () => ({
  upsertFacts: async (_p: unknown, _v: unknown, _m: unknown, f: Record<string, unknown>[]) => {
    state.facts += f.length;
    state.written.push(...f);
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
  const res = await fetch(`${base}${path}`); // module-review-ok: this suite's own loopback server, not an outbound call
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function post(path: string, body: unknown = {}) {
  const res = await fetch(`${base}${path}`, { // module-review-ok: this suite's own loopback server, not an outbound call
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
  state.apiUrl = "https://example.test/";
  state.written = [];
  state.landedPayloads = [];
  state.batchIds = [];
  state.pages = 0;
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
    state.apiUrl = "";
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain("no https address");
  });

  it("REFUSES AN ADDRESS THAT IS NOT HTTPS, before a single byte of the key goes out", async () => {
    // This route sends the village's sealed credential to whatever address it
    // is given. An earlier version took that address from the request body,
    // which made anybody holding the queue's key able to name a host and be
    // sent the secret. It reads the store now, and the scheme is checked.
    state.apiUrl = "http://attacker.invalid/";
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(409);
    expect(state.landed).toBe(0);
  });

  it("refuses an address that is not a url at all", async () => {
    state.apiUrl = "not a url";
    expect((await post("/api/saberra/sync")).status).toBe(409);
  });

  it("IGNORES AN ADDRESS IN THE REQUEST BODY, which is the defect this replaced", async () => {
    state.apiUrl = "";
    const r = await post("/api/saberra/sync", { config: { apiUrl: "https://attacker.invalid/" } });
    expect(r.status).toBe(409);
    expect(state.landed).toBe(0);
  });

  it("says the session never opened, instead of reporting an empty village", async () => {
    state.session = null;
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(502);
    expect(String(r.body.error)).toContain("did not open a session");
  });

  it("NAMES A VENDOR REFUSAL PER KIND instead of landing nothing in silence", async () => {
    state.call = { ok: false, why: "vendor-error", detail: "scope does not permit this tool" };
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(200);
    expect(r.body.landed).toBe(0);
    // One entry per kind asked for, each carrying the vendor's own words.
    expect(r.body.failures.length).toBeGreaterThan(0);
    expect(String(r.body.failures[0].detail)).toContain("scope");
  });

  it("tells a genuinely empty service apart from a broken one", async () => {
    state.call = { ok: true, records: [], cursor: null };
    const r = await post("/api/saberra/sync");
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
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(200);
    expect(r.body.landed).toBeGreaterThan(0);
    expect(state.facts).toBeGreaterThan(0);
  });

  it("LANDS A CIRCLE AS A CIRCLE, now that the operation to make one exists", async () => {
    // This asserted the opposite until `create_circle` landed: a circle was
    // held because accepting one would have made a seat named after it.
    state.call = {
      ok: true,
      cursor: null,
      records: [{ id: "c-1", fields: { "Circle Name": "Land & Ecology", Status: "Active" } }],
    };
    const r = await post("/api/saberra/sync");
    // The stub answers the same record for every kind asked for, so other
    // kinds legitimately hold it. The claim is about the CIRCLE read.
    const held = r.body.held as { kind: string }[];
    expect(held.some((h) => h.kind === "circle")).toBe(false);
    expect(state.landedPayloads.some((p) => p.kind === "circle.proposed")).toBe(true);
  });

  it("still reports a record it holds, so a smaller number is never returned in silence", async () => {
    // A role assignment proposes nothing and says so per record.
    state.call = {
      ok: true,
      cursor: null,
      records: [{ id: "a-1", fields: { Role: "Finance Steward", "Energization Level": "Partial" } }],
    };
    const r = await post("/api/saberra/sync");
    const held = r.body.held as { reason: string }[];
    expect(held.some((h) => h.reason === "kind-not-allowed")).toBe(true);
  });

  it("ATTACHES A FACT TO THE SEAT THIS VILLAGE ALREADY HAS, which is what makes the panel work", async () => {
    // An earlier version stored every fact with a null entity id while the
    // panel asked by seat id, so it was empty for every seat forever and each
    // half was correct on its own.
    state.call = {
      ok: true,
      cursor: null,
      records: [{ id: "r-1", fields: { "Role Name": "Water Steward" } }],
    };
    const r = await post("/api/saberra/sync");
    const written = state.written.find((w) => w.vendorKind === "role");
    expect(written?.entityId).toBe("role-77");
    expect(r.body.attached).toBe(1);
  });

  it("leaves a fact unattached when this village has no such seat, instead of guessing", async () => {
    state.call = {
      ok: true,
      cursor: null,
      records: [{ id: "r-2", fields: { "Role Name": "A Seat We Do Not Have" } }],
    };
    await post("/api/saberra/sync");
    expect(state.written.find((w) => w.vendorKind === "role")?.entityId).toBeNull();
  });

  it("LANDS ONE STRUCTURE PROPOSAL WITH SEAT KEYS A STEWARD CAN READ", async () => {
    // The translator maps "Role Name" to `name`. An earlier version landed the
    // vendor's raw keys, which `readProposedSeats` cannot read, so every
    // proposal arrived nameless and could not be accepted.
    state.call = {
      ok: true,
      cursor: null,
      records: [
        { id: "r-1", fields: { "Role Name": "Water Steward", Circle: "Land & Ecology" } },
        { id: "r-2", fields: { "Role Name": "Finance Steward" } },
      ],
    };
    await post("/api/saberra/sync");
    const org = state.landedPayloads.find((p) => p.kind === "org.proposed");
    expect(org).toBeDefined();
    const payload = org!.payload as { seats: Record<string, unknown>[]; title: string };
    expect(payload.seats).toHaveLength(2);
    expect(payload.seats[0].name).toBe("Water Steward");
    expect(payload.seats[0].circleName).toBe("Land & Ecology");
    expect(payload.title).toContain("suggested by");
  });

  it("clips the batch id, because the spine refuses one over its limit", async () => {
    state.session = "s".repeat(200);
    state.call = { ok: true, cursor: null, records: [{ id: "r-1", fields: { "Role Name": "Water Steward" } }] };
    await post("/api/saberra/sync");
    for (const b of state.batchIds) expect(b.length).toBeLessThanOrEqual(64);
  });

  it("carries what it could not map upward, so a steward is never given less in silence", async () => {
    state.call = {
      ok: true,
      cursor: null,
      records: [{ id: "r-1", fields: { "Role Name": "Water Steward", "Some New Field": "x" } }],
    };
    const r = await post("/api/saberra/sync");
    expect(r.body.unmapped).toContain("Some New Field");
  });
});
