/**
 * THE TWO ROUTES RYE'S RULINGS OF 2026-09-23 ADDED, OVER REAL HTTP.
 *
 *   GET  /api/powers/hands                      ruling 2, the notes are public
 *   POST /api/powers/hands/:id/put-to-village   ruling 1, who may open the vote
 *
 * shared/powerHands.test.ts proves the rules without a database. This proves
 * the WIRING: that the route asks the rule about the right power, that the
 * public read cannot reach a neighbouring row in the same table, and that the
 * seat vote is opened through the one function `POST /api/governance/role-seats`
 * calls rather than a copy of it.
 *
 * ── WHY `liveHoldersOf` IS THE REAL FUNCTION HERE AND NOT A STUB ───────────
 *
 * Two of the controls the brief asked for are about who counts as a holder: a
 * seat whose TERM HAS LAPSED, and a holder a WARNING BADGE denies. Neither is
 * visible if the test hands the route a list of names. So the dep is wired to
 * the real `liveHoldersOfCapability` over fixture rows, which is exactly what
 * server/index.ts does, and those two controls then exercise the rule that
 * actually ships.
 *
 * No database: the pool is a stub that answers the one query
 * `capabilityHoldings` makes, which is how a village-held power is set up here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CapabilityCtx } from "../../shared/capabilities";
import { liveHoldersOfCapability } from "../lib/roleGrants";
import { register } from "./powerHands";

const LIBRARY = "library.keep";
const LIBRARY_LABEL = "Keep the shared library and its loans";
const KEEPERS = "role-keepers";

const ANA = { id: "user-ana", name: "Ana Rivers", email: "ana@example.org", role: "member" };
const HOLDER = { id: "user-holder", name: "Hal Keeper", email: "hal@example.org", role: "member" };
const GONE = { id: "user-gone", name: "Gone Member", email: "gone@example.org", role: "member" };

/** What the village holds, per test. Empty is the state every village boots in. */
let villageHeld: string[] = [];
/** The `capability_holding` rows the stub pool answers with. */
let holdingRows: Array<{ capability: string; holder_role_id: string; role_name: string; moved_at: string; moved_by_ballot_id: string | null; moved_by_user_id: string | null; note: string | null }> = [];
/** The seats, in `liveHoldersOfCapability`'s own shape. */
let seats: Array<{ roleId: string; userId: string; termEndsAt: string | null }> = [];
/** Warning badges and grants, per member, exactly as the gate reads them. */
let badges: Record<string, { grants?: string[]; denies?: string[] }> = {};
let roles: Array<{ id: string; name: string; capabilities: string[] }> = [];
let inbox: any[] = [];
let absent = new Set<string>();
let caller: any = ANA;
let opened: any[] = [];
let openAnswers: any = null;

const pool = {
  async query(sql: string) {
    if (String(sql).includes("FROM capability_holding")) return [holdingRows, []];
    return [[], []];
  },
} as unknown as Pool;

let server: http.Server;
let base = "";

async function call(path: string, init?: { method?: string; body?: unknown }) {
  const r = await fetch(`${base}${path}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every e2e suite does
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  register(app, {
    authedUser: async () => caller,
    capabilityCtx: async () => ({ villageHeld: [...villageHeld] }) as unknown as CapabilityCtx,
    stageOf: async () => "co-creator",
    firstName: (n: string) => String(n ?? "").split(" ")[0] ?? "",
    isPresent: (m: any) => !absent.has(String(m?.id)),
    members: {
      all: async () => [ANA, HOLDER, GONE],
      byId: async (id: string) => [ANA, HOLDER, GONE].find((m) => m.id === id) ?? null,
    } as any,
    notifyAdmins: async () => undefined,
    getPool: () => pool,
    overLimit: async () => false,
    submissionsRepo: { all: () => inbox, insert: async () => undefined } as any,
    liveHoldersOf: async (capability: string) =>
      liveHoldersOfCapability(seats as any, roles, capability, new Date(), badges),
    rolesCarrying: (capability: string) =>
      roles.filter((r) => r.capabilities.includes(capability)).map((r) => ({ id: r.id, name: r.name })),
    openSeatVote: async (ask: { userId: string; roleId: string; reason: string; termEndsOn?: unknown; openedBy: { id: string; name: string } }) => {
      opened.push(ask);
      return openAnswers ?? { ok: true, ballot: { id: "ballot-1", closesAt: "2026-10-01T00:00:00.000Z" } };
    },
  } as any);
  server = http.createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

beforeEach(() => {
  villageHeld = [];
  holdingRows = [];
  roles = [{ id: KEEPERS, name: "The Library Keepers", capabilities: [LIBRARY] }];
  seats = [];
  badges = {};
  absent = new Set();
  caller = ANA;
  opened = [];
  openAnswers = null;
  inbox = [
    {
      id: "hand-ana",
      type: "power-application",
      status: "new",
      userId: ANA.id,
      userName: ANA.name,
      submittedAt: "2026-09-20T09:00:00.000Z",
      data: { capability: LIBRARY, powerLabel: LIBRARY_LABEL, note: "I ran a lending library for six years.", email: ANA.email },
    },
    {
      id: "visit-1",
      type: "visit-inquiry",
      status: "new",
      userId: GONE.id,
      userName: GONE.name,
      submittedAt: "2026-09-19T09:00:00.000Z",
      data: { note: "We would like to visit in March with two children.", email: "visitor@example.org" },
    },
  ];
});

/** Put the power in the village's own hands, both halves the code reads. */
function villageHolds() {
  villageHeld = [LIBRARY];
  holdingRows = [
    { capability: LIBRARY, holder_role_id: KEEPERS, role_name: "The Library Keepers", moved_at: "2026-09-01T00:00:00.000Z", moved_by_ballot_id: "b0", moved_by_user_id: null, note: null },
  ];
}

describe("ruling 2: the notes members read", () => {
  it("gives an ordinary member the note on a hand that is up", async () => {
    const r = await call("/api/powers/hands");
    expect(r.status).toBe(200);
    expect(r.body.hands).toHaveLength(1);
    expect(r.body.hands[0].note).toBe("I ran a lending library for six years.");
    expect(r.body.hands[0].userName).toBe(ANA.name);
  });

  it("CONTROL: the visit inquiry sitting in the same table is not published", async () => {
    const r = await call("/api/powers/hands");
    const said = JSON.stringify(r.body);
    expect(said).not.toContain("We would like to visit in March");
    expect(said).not.toContain("visitor@example.org");
  });

  it("CONTROL: the email stored beside the note does not leave with it", async () => {
    const r = await call("/api/powers/hands");
    expect(JSON.stringify(r.body)).not.toContain(ANA.email);
  });

  it("says who may put each hand to the village, and which seat the vote would fill", async () => {
    seats = [{ roleId: KEEPERS, userId: HOLDER.id, termEndsAt: null }];
    const r = await call("/api/powers/hands");
    expect(r.body.hands[0].whoMay).toBe("live-holders");
    expect(r.body.hands[0].youMayPut).toBe(false);
    expect(r.body.hands[0].seatRole).toEqual({ id: KEEPERS, name: "The Library Keepers" });
  });

  it("refuses a stranger", async () => {
    caller = null;
    expect((await call("/api/powers/hands")).status).toBe(401);
  });
});

describe("ruling 1: who may put a hand to the village", () => {
  it("CONTROL: a member opening a vote on a ROLE-held power is refused", async () => {
    seats = [{ roleId: KEEPERS, userId: HOLDER.id, termEndsAt: null }];
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_a_holder");
    expect(opened).toHaveLength(0);
  });

  it("CONTROL: the same member on a VILLAGE-held power succeeds", async () => {
    seats = [{ roleId: KEEPERS, userId: HOLDER.id, termEndsAt: null }];
    villageHolds();
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST", body: { reason: "She has done this work before." } });
    expect(r.status).toBe(200);
    expect(r.body.ballot.id).toBe("ballot-1");
    expect(opened).toHaveLength(1);
    expect(opened[0].roleId).toBe(KEEPERS);
    expect(opened[0].userId).toBe(ANA.id);
  });

  it("a live holder may, on the same role-held power that refused a member", async () => {
    seats = [{ roleId: KEEPERS, userId: HOLDER.id, termEndsAt: null }];
    caller = HOLDER;
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    expect(r.status).toBe(200);
    expect(opened).toHaveLength(1);
  });

  it("CONTROL: a holder whose TERM HAS LAPSED is refused", async () => {
    seats = [{ roleId: KEEPERS, userId: HOLDER.id, termEndsAt: "2026-01-01T00:00:00.000Z" }];
    caller = HOLDER;
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    // Nobody holds it live any more, so it falls to the org.decide reading and
    // opens to any member. The lapsed holder passes AS A MEMBER, and the rule
    // the payload names is the one that changed.
    expect(r.status).toBe(200);
    expect((await call("/api/powers/hands")).body.hands[0].because).toBe("nobody-holds-it");
  });

  it("CONTROL: a lapsed term does not leave a role-held power holder-only for the wrong person", async () => {
    // Two seats, one lapsed. The live one still holds it, so the lapsed one is
    // refused exactly as any other member is.
    seats = [
      { roleId: KEEPERS, userId: HOLDER.id, termEndsAt: "2026-01-01T00:00:00.000Z" },
      { roleId: KEEPERS, userId: GONE.id, termEndsAt: null },
    ];
    caller = HOLDER;
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    expect(r.status).toBe(403);
    expect(opened).toHaveLength(0);
  });

  it("CONTROL: a warning badge's deny takes a holder off the list", async () => {
    seats = [{ roleId: KEEPERS, userId: HOLDER.id, termEndsAt: null }, { roleId: KEEPERS, userId: GONE.id, termEndsAt: null }];
    badges = { [HOLDER.id]: { denies: [LIBRARY] } };
    caller = HOLDER;
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    expect(r.status).toBe(403);
    expect(opened).toHaveLength(0);
  });

  it("refuses a hand that is not up", async () => {
    const r = await call("/api/powers/hands/nope/put-to-village", { method: "POST" });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("hand_not_up");
  });

  it("refuses a power no role carries, and says where that door is", async () => {
    roles = [];
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("no_role_carries_it");
    expect(r.body.message).toContain("votes a power onto a role first");
  });

  it("asks which role when more than one carries the power", async () => {
    roles = [
      { id: KEEPERS, name: "The Library Keepers", capabilities: [LIBRARY] },
      { id: "role-stewards", name: "The Stewards", capabilities: [LIBRARY] },
    ];
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("which_role");
    const named = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST", body: { roleId: "role-stewards" } });
    expect(named.status).toBe(200);
    expect(opened[0].roleId).toBe("role-stewards");
  });

  it("carries the hand's own note into the document the village reads", async () => {
    await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST", body: { reason: "She knows the shelves." } });
    expect(opened[0].reason).toContain("I ran a lending library for six years.");
    expect(opened[0].reason).toContain("She knows the shelves.");
    expect(opened[0].reason).toContain("Ana Rivers raised a hand");
  });

  it("hands the seat vote's own refusal straight back", async () => {
    openAnswers = { ok: false, status: 409, body: { error: "that role carries ballot.vote" } };
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("that role carries ballot.vote");
  });

  it("leaves out a member who asked to be forgotten, note and all", async () => {
    absent = new Set([ANA.id]);
    expect((await call("/api/powers/hands")).body.hands).toHaveLength(0);
    const r = await call("/api/powers/hands/hand-ana/put-to-village", { method: "POST" });
    expect(r.status).toBe(404);
  });
});
