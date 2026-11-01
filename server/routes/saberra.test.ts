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
 * runs behind a real Express app. The sync's lock and its run log are stubs
 * too; `server/lib/saberraSync.test.ts` holds both against a real database.
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
  /** Every argument list `callTool` was handed, in order. */
  asked: [] as Record<string, unknown>[],
  /** What `tools/list` answers. The default lists nothing useful, so the plan falls back to the mail. */
  tools: { ok: true, tools: [] } as Record<string, unknown>,
  /**
   * The service's raw bytes per wire kind. A kind named here goes through the
   * REAL `callTool` with a fetch that answers these bytes, so the reading under
   * test is the client's own and never a stub's.
   */
  wire: {} as Record<string, string>,
  /** Records per wire kind, for a read where circles and roles differ. Wins over `call`. */
  byKind: {} as Record<string, unknown[]>,
  /** True while "another" sync holds the lock. */
  lockHeld: false,
  /** The stored run log document, as the repo would hand it back. */
  logDoc: null as Record<string, unknown> | null,
  /** The module's stored `pollSchedule`. */
  pollSchedule: undefined as string | undefined,
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
  villageSecretsKeyProblem: () =>
    state.keyPresent ? null : "VILLAGE_SECRETS_KEY is set, but it is 66 characters with quotes around it.",
  secretValue: () => state.value,
}));

vi.mock("../lib/saberraClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/saberraClient")>();
  return {
    openSession: async () => state.session,
    listTools: async () => state.tools,
    callTool: async (c: Parameters<typeof real.callTool>[0], s: string, t: string, args: Record<string, unknown>) => {
      state.asked.push(args);
      const bytes = state.wire[String(args.kind)];
      if (bytes !== undefined) {
        return real.callTool({ ...c, fetchImpl: async () => new Response(bytes, { status: 200 }) }, s, t, args);
      }
      const recs = state.byKind[String(args.kind)];
      if (recs !== undefined) return { ok: true, records: recs, cursor: null };
      return state.call;
    },
  };
});

vi.mock("../lib/identity", () => ({ instanceIdentity: () => ({ instanceId: "village-1", bornAt: "" }) }));

// The address comes from the STORE now, never from the caller.
vi.mock("../lib/modules", () => ({
  moduleConfig: () => ({ apiUrl: state.apiUrl, ...(state.pollSchedule !== undefined ? { pollSchedule: state.pollSchedule } : {}) }),
  effectiveLifecycle: () => "preview",
}));

// The one lock every sync runs under, held or free on demand.
vi.mock("../repos/namedLock", () => ({
  withNamedLock: async (_p: unknown, _name: string, fn: () => Promise<unknown>) =>
    state.lockHeld ? { ran: false } : { ran: true, value: await fn() },
}));

vi.mock("../repos/saberraSyncLog", () => ({
  readSyncLogDocument: async () => state.logDoc,
  writeSyncLogDocument: async (_p: unknown, doc: Record<string, unknown>) => {
    state.logDoc = JSON.parse(JSON.stringify(doc));
  },
}));

// One live seat, so a fact can be attached to it by name.
vi.mock("../lib/orgChart", () => ({
  listOrgRoles: async () => [{ id: "role-77", name: "Water Steward" }],
}));

vi.mock("../lib/externalProposals", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/externalProposals")>();
  return {
    // Pure: the sync keys "what this read carried" by the same identity a landing stores.
    identityKeyFor: real.identityKeyFor,
    landProposal: async (_p: unknown, input: Record<string, unknown>) => {
      state.landed += 1;
      state.landedPayloads.push(input);
      state.batchIds.push(String(input.batchId));
      return { ok: true, id: `p-${state.landed}`, outcome: "stored" };
    },
  };
});

// A record the service stopped sending is withdrawn against the real queue in
// server/lib/saberraSync.test.ts; here nothing is waiting, so nothing goes.
vi.mock("../repos/externalProposals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repos/externalProposals")>()),
  withdrawGone: async () => [],
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
  state.asked = [];
  state.tools = { ok: true, tools: [] };
  state.wire = {};
  state.byKind = {};
  state.lockHeld = false;
  state.logDoc = null;
  state.pollSchedule = undefined;
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

  it("refuses the run log without the queue's key, because it is the button's report", async () => {
    may = false;
    expect((await get("/api/saberra/runs")).status).toBe(403);
    // The control: the same read with the key answers.
    may = true;
    expect((await get("/api/saberra/runs")).status).toBe(200);
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
    // The reason, named. A key set in the wrong shape is not a key nobody set.
    expect(String(r.body.error)).toContain("quotes around it");
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

  it("PLACES A SEAT WHOSE CIRCLE ARRIVES AS A RELATION, by handing the translator the circles too", async () => {
    // The live sync of 2026-10-09: `Circle` on a role is a list of page ids,
    // and the route used to hand the translator the roles alone, so even a
    // translator that read relations had nothing to resolve them against.
    const LAND = "3ed0a88e-f36a-8104-80fa-cd2bfe15c001";
    state.byKind = {
      circle: [{ id: LAND, fields: { "Circle Name": "Land & Ecology", Status: "Active" } }],
      role: [{ id: "r-1", fields: { "Role Name": "Water Steward", Circle: [LAND], Body: "Holds the water.", Status: "Vacant" } }],
      role_assignment: [],
    };
    const r = await post("/api/saberra/sync");
    const org = state.landedPayloads.find((p) => p.kind === "org.proposed");
    const seat = (org!.payload as { seats: Record<string, unknown>[] }).seats[0];
    expect(seat).toMatchObject({ name: "Water Steward", circleName: "Land & Ecology", aim: "Holds the water.", sourceStatus: "Vacant" });
    expect(r.body.circles).toMatchObject({ placed: 1, unresolved: 0, absent: 0, shapes: ["list of 1 id"] });
  });

  it("ASKS EVERY LANDING TO CARRY A WAITING DUPLICATE FORWARD, so Sync now is safe to press again", async () => {
    state.byKind = {
      circle: [{ id: "c-1", fields: { "Circle Name": "Land & Ecology", Status: "Active" } }],
      role: [{ id: "r-1", fields: { "Role Name": "Water Steward" } }],
      role_assignment: [],
    };
    await post("/api/saberra/sync");
    expect(state.landedPayloads.length).toBeGreaterThan(1);
    for (const p of state.landedPayloads) expect(p.rebatchWaiting).toBe(true);
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

/**
 * WHAT A SYNC ASKS FOR. The service calls a role assignment `role_assignment`
 * and offers no tensions or risks yet (their mails of 2026-09-24 and 09-28).
 * An earlier version sent our own id `roleAssignment` and asked for all five.
 */
describe("asking the service in its own names", () => {
  const sentKinds = (arg = "kind") => state.asked.map((a) => a[arg]);

  it("ASKS FOR role_assignment, and never for a kind the service does not offer", async () => {
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(200);
    // The known positive first: the three offered kinds were asked for, so the
    // absences below are about which kinds, never about an empty loop.
    expect(sentKinds()).toEqual(["circle", "role", "role_assignment"]);
    expect(sentKinds()).not.toContain("roleAssignment");
    expect(sentKinds()).not.toContain("tension");
    expect(sentKinds()).not.toContain("risk");
  });

  it("NAMES EACH KIND IT HOLDS AND DID NOT ASK FOR, as its own line", async () => {
    const r = await post("/api/saberra/sync");
    expect(r.body.notOffered).toEqual([
      "tension: not offered by the service yet",
      "risk: not offered by the service yet",
    ]);
    expect(r.body.asked.source).toBe("mail");
  });

  it("uses the argument and the values the service's schema declares", async () => {
    state.tools = {
      ok: true,
      tools: [
        {
          name: "list_records",
          inputSchema: {
            type: "object",
            properties: { record_type: { type: "string", enum: ["circle", "role", "role_assignment", "tension"] } },
          },
        },
      ],
    };
    const r = await post("/api/saberra/sync");
    expect(sentKinds("record_type")).toEqual(["circle", "role", "role_assignment", "tension"]);
    expect(sentKinds("kind").every((v) => v === undefined)).toBe(true);
    expect(r.body.notOffered).toEqual(["risk: not offered by the service yet"]);
    expect(r.body.asked).toMatchObject({ argument: "record_type", source: "schema" });
  });

  it("still syncs when tools/list fails, and says why the plan was guessed", async () => {
    state.tools = { ok: false, why: "vendor-error", detail: "Method not found" };
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(200);
    expect(sentKinds()).toEqual(["circle", "role", "role_assignment"]);
    expect(String(r.body.asked.note)).toContain("Method not found");
  });

  it("names a failure by our kind and by the words a steward reads", async () => {
    state.call = { ok: false, why: "vendor-error", detail: "scope does not permit this tool" };
    const r = await post("/api/saberra/sync");
    const assignment = (r.body.failures as { kind: string; label: string }[]).find((f) => f.kind === "roleAssignment");
    expect(assignment?.label).toBe("role assignment");
  });
});

/**
 * THE SYNC'S ANSWER IS A SURFACE TOO. A reply the client cannot read used to
 * travel into `failures[].detail` word for word, before the allow list or the
 * address net had seen it, and the panel printed it. Asking for
 * `role_assignment` makes this the likely first live outcome: the service knows
 * that name, answers real rows, and their shape has never been measured. The
 * fixture names nobody real.
 */
describe("what a failed sync repeats", () => {
  const ROWS = JSON.stringify({
    results: [
      {
        id: "rec1",
        fields: { "Assignment Title": "Jane Example - Treasurer", "Role Holder": "Jane Example", Contact: "jane@example.org" },
      },
    ],
  });

  it("NEVER REPEATS AN UNREADABLE ROLE ASSIGNMENT REPLY, its dropped fields or an address", async () => {
    const bytes = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: ROWS }] } })}\n\n`;
    // The control on the fixture: the bytes DO carry all three.
    for (const s of ["Assignment Title", "Jane Example", "jane@example.org"]) expect(bytes).toContain(s);
    state.wire = { role_assignment: bytes };
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(200);
    // The known positive: the role assignment failure IS in the answer, named,
    // so the absences below are about what it says and never an empty list.
    const failure = (r.body.failures as { kind: string; why: string; detail: string }[]).find((f) => f.kind === "roleAssignment");
    expect(failure?.why).toBe("unreadable");
    expect(failure?.detail).toContain("results");
    const whole = JSON.stringify(r.body);
    expect(whole).not.toContain("Assignment Title");
    expect(whole).not.toContain("Role Holder");
    expect(whole).not.toContain("Jane");
    expect(whole).not.toContain("example.org");
  });

  it("never repeats prose with an address in it", async () => {
    const prose = "Jane Example holds Treasurer (jane@example.org)";
    state.wire = {
      role_assignment: `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: prose }] } })}\n\n`,
    };
    const r = await post("/api/saberra/sync");
    expect((r.body.failures as { kind: string }[]).some((f) => f.kind === "roleAssignment")).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("example.org");
    expect(JSON.stringify(r.body)).not.toContain("Jane");
  });
});

/**
 * THE SCHEDULE'S HALF OF THE ROUTE: a press that finds a sync running, and the
 * run log a press writes. The schedule's own decisions (off, no change,
 * backoff, the lock against a crash) are held against a real database in
 * `server/lib/saberraSync.test.ts`.
 */
describe("a press beside the schedule", () => {
  it("REFUSES A PRESS WHILE A SYNC IS RUNNING, and calls nothing", async () => {
    state.lockHeld = true;
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "A sync is already running. Its report appears under Sync now when it finishes.", state: "busy" });
    expect(state.asked).toEqual([]);
    expect(state.landed).toBe(0);
    expect(state.logDoc).toBeNull();
    // The control: the lock free, the same press runs.
    state.lockHeld = false;
    expect((await post("/api/saberra/sync")).status).toBe(200);
    expect(state.asked.length).toBeGreaterThan(0);
  });

  it("WRITES THE PRESS TO THE LOG IN TYPED FIELDS, never the key or the service's words", async () => {
    state.value = "t0ken-SECRET-4242";
    state.call = { ok: false, why: "vendor-error", detail: "scope does not permit Jane Example" };
    state.byKind = {
      circle: [{ id: "c-1", fields: { "Circle Name": "Land & Ecology", Status: "Active", Notes: "kept by Jane Example" } }],
      role: [{ id: "r-1", fields: { "Role Name": "Water Steward", Circle: ["c-1"] } }],
    };
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(200);
    const run = (state.logDoc!.runs as Record<string, unknown>[])[0]!;
    expect(run).toMatchObject({
      trigger: "by-hand",
      outcome: "landed",
      reason: "partial",
      error: "Some kinds could not be read. What could be read went to the review queue.",
      records: 2,
      skipped: ["tension", "risk"],
      failed: [{ kind: "roleAssignment", why: "vendor-error" }],
      plan: "mail",
    });
    expect(run.landed).toBeGreaterThan(0);
    // The known positive: the answer on screen DID carry the vendor's words,
    // so their absence from the log is the rule and not an empty read.
    expect(JSON.stringify(r.body)).toContain("scope does not permit");
    const whole = JSON.stringify(state.logDoc);
    for (const never of ["t0ken", "SECRET", "scope", "Jane", "Water Steward", "Land & Ecology", "Circle Name"]) {
      expect(whole).not.toContain(never);
    }
  });

  it("logs a press whose session never opened as a failed run, and answers as before", async () => {
    state.session = null;
    const r = await post("/api/saberra/sync");
    expect(r.status).toBe(502);
    expect((state.logDoc!.runs as Record<string, unknown>[])[0]).toMatchObject({
      trigger: "by-hand",
      outcome: "failed",
      reason: "no-session",
    });
  });

  it("logs nothing for a press refused before it called out, which the screen already says", async () => {
    state.apiUrl = "";
    expect((await post("/api/saberra/sync")).status).toBe(409);
    expect(state.logDoc).toBeNull();
  });

  it("ANSWERS THE SCHEDULE, WHEN IT NEXT RUNS, AND THE RUNS", async () => {
    state.pollSchedule = "every-6-hours";
    await post("/api/saberra/sync");
    const r = await get("/api/saberra/runs");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ schedule: "every-6-hours", blocked: null, backoff: { failures: 0, factor: 1 } });
    expect(typeof r.body.timezone).toBe("string");
    expect(r.body.runs).toHaveLength(1);
    // Six hours after the press, which is the clock the schedule keeps.
    const gap = Date.parse(r.body.nextAt) - Date.parse(r.body.runs[0].at);
    expect(gap).toBe(6 * 60 * 60 * 1000);
  });

  it("says the schedule is waiting for a key, and off when nothing is stored", async () => {
    state.value = null;
    const r = await get("/api/saberra/runs");
    expect(r.body).toMatchObject({ schedule: "off", nextAt: null, blocked: "no-key", runs: [] });
  });
});
