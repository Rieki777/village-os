/**
 * THE PLAYER CARD ON A ROLE APPLICATION, AND ONE MEMBER'S APPLICATIONS GROUPED
 * (player card PR 3), over real HTTP and, where it reads, the S5 scratch schema.
 *
 *   - `GET /api/governance/role-applications/:id/card` is tiered exactly like
 *     the application read: a visitor and a signed-in guest get the same 401
 *     and the same body, BEFORE the database is touched (the pool throws).
 *   - past the gate, the candidate reads the self tier and another member the
 *     member tier; the roles are the application's seat_ids, the terms are its
 *     own, and the live sections read "Starts once adopted". Five roles are
 *     one card.
 *   - `?candidate=` returns that member's rows only, grouped past, this
 *     season and next season, and old seatings with no application only to
 *     the member themselves.
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import type { SeatCalendar } from "../../shared/seatTerms";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole } from "../lib/orgChart";
import { insertApplication } from "../repos/seatApplications";
import { MEMBERS_ONLY, register as registerCard } from "./applicationCard";
import { register as registerApplications } from "./seatApplications";

const LADDER = ["visitor", "guest", "member"];
const NOW = new Date("2026-10-22T18:00:00Z");
const PEOPLE: Record<string, { id: string; name: string }> = {
  "u-ana": { id: "u-ana", name: "Ana Quillfeather" },
  "u-ivo": { id: "u-ivo", name: "Ivo Lantern" },
  "u-guest": { id: "u-guest", name: "Gale Visitor" },
};
const CALENDAR: SeatCalendar = {
  seasons: [
    { id: "s-old", startsOn: "2026-01-01", endsOn: "2026-06-01" },
    { id: "s-now", startsOn: "2026-06-01", endsOn: "2027-01-01" },
    { id: "s-next", startsOn: "2027-01-01", endsOn: "2027-06-01" },
  ],
  currentSeasonId: "s-now",
  timezone: "UTC",
};
const SEASON_NAMES: Record<string, string> = { "s-old": "Old", "s-now": "Now", "s-next": "Next" };
const TERMS = {
  v: 1,
  term: { reviewOn: "2026-12-01" },
  pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month" },
};

const configured = testDbConfigured();
if (!configured) console.warn("[applicationCard] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

function harness() {
  const state = {
    viewer: null as { id: string; stage: string } | null,
    pool: (): any => {
      throw new Error("the database was read before the gate answered");
    },
  };
  let server: http.Server;
  let base = "";
  const ctxOf = () =>
    ({
      stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"),
      stageIndexOf: (id: string) => LADDER.indexOf(id),
      roleCapabilities: [],
      villageHeld: [],
    }) as unknown as CapabilityCtx;
  const authedUser = async () => (state.viewer ? { ...(PEOPLE[state.viewer.id] ?? { id: state.viewer.id, name: "Someone" }) } : null);
  const guardCapability = async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
    if (state.viewer && hasCapability(cap, ctxOf())) return true;
    res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
    return false;
  };
  const firstName = (n: string) => String(n ?? "").split(" ")[0] ?? "";

  const start = async () => {
    const app = express();
    app.use(express.json());
    registerCard(app, {
      authedUser,
      isAdmin: async () => false,
      capabilityCtx: async () => ctxOf(),
      guardCapability,
      getPool: () => state.pool(),
      firstName,
      seasonState: () => ({
        current: { id: "s-now", name: "Now", startsOn: "2026-06-01", endsOn: "2027-01-01" },
        upcoming: { id: "s-next" },
        // Named, so a card can say which season it is drawn in (E9).
        seasons: CALENDAR.seasons.map((s) => ({ ...s, name: SEASON_NAMES[s.id] ?? null })) as any[],
        timezone: "UTC",
      }),
      lapse: () => ({ currentSeasonId: "s-now", cadence: "never" }),
      mapLifecycle: () => "members",
      boolVar: () => false,
      villageName: () => "Riverbend",
      now: () => NOW,
    } as any);
    registerApplications(app, {
      authedUser,
      capabilityCtx: async () => ctxOf(),
      guardCapability,
      getPool: () => state.pool(),
      notify: async () => ({ inserted: true }) as any,
      notifyAdmins: async () => {},
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null, all: async () => Object.values(PEOPLE) } as any,
      firstName,
      liveHoldersOf: async () => [],
      rolesCarrying: () => [],
      loadRoleHolders: () => [],
      roleBallotSetup: async () => {
        throw new Error("no ballot in this suite");
      },
      seatCalendar: () => CALENDAR,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "never" }),
      landingDeps: () => {
        throw new Error("no landing in this suite");
      },
      closers: {},
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  };
  const stop = () => new Promise<void>((resolve) => server?.close(() => resolve()));
  const call = async (url: string) => {
    const res = await fetch(`${base}${url}`); // module-review-ok: this suite's own loopback server, not an outbound call
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  return { state, start, stop, call };
}

describe("the card on an application is gated like the application", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("a visitor and a signed-in guest get 401 with the application's own body, and the database is never read", async () => {
    for (const viewer of [null, { id: "u-guest", stage: "guest" }]) {
      h.state.viewer = viewer;
      const card = await h.call("/api/governance/role-applications/sa-0123456789abcdef/card");
      const read = await h.call("/api/governance/role-applications/sa-0123456789abcdef");
      expect(card.status).toBe(401);
      expect(card.body).toEqual(MEMBERS_ONLY);
      // Control: the application read answers the same, word for word.
      expect(read.status).toBe(401);
      expect(card.body).toEqual(read.body);
      expect(card.body).not.toHaveProperty("card");
    }
  });

  it("the candidate filter is gated the same way", async () => {
    h.state.viewer = { id: "u-guest", stage: "guest" };
    expect((await h.call("/api/governance/role-applications?candidate=u-guest")).status).toBe(401);
  });
});

describe.skipIf(!configured)("the proposal card and the grouped list, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  const roleIds: string[] = [];
  let n = 0;

  const file = async (id: string, over: Partial<Parameters<typeof insertApplication>[1]> = {}) =>
    insertApplication(pool, {
      id,
      candidateUserId: "u-ana",
      proposedBy: "u-ana",
      seatIds: [roleIds[0]],
      note: null,
      deliverables: null,
      settings: TERMS as any,
      settingsHash: "h",
      termEndsAt: new Date("2027-01-01T00:00:00Z"),
      termSeasonId: "s-now",
      termFollowsSeason: true,
      startsAt: null,
      status: "awaiting-holder",
      ...over,
    });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    h.state.pool = () => pool;
    for (const p of Object.values(PEOPLE)) {
      await pool.query("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, ?, ?, 'x', '[]')", [p.id, p.name, `${p.id}@example.test`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    for (const name of ["Water Keeper", "Seed Keeper", "Path Keeper", "Tool Keeper", "Hearth Keeper"]) {
      n += 1;
      roleIds.push(await createOrgRole(pool, { id: `card-role-${n}`, name, seats: 2, aim: `Keep the ${name.toLowerCase()} work going.` }));
    }
    await file("sa-00000000000000a1", { seatIds: [...roleIds] });
    await file("sa-00000000000000a2", { termSeasonId: "s-old", termEndsAt: new Date("2026-06-01T00:00:00Z"), status: "adopted" });
    await file("sa-00000000000000a3", { termSeasonId: "s-next", termEndsAt: new Date("2027-06-01T00:00:00Z"), startsAt: new Date("2027-01-01T00:00:00Z") });
    await file("sa-00000000000000b1", { candidateUserId: "u-ivo", proposedBy: "u-ivo" });
    // An old seating that came through no application.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, started_at, ended_at, ended_reason, is_example) VALUES ('as-old', ?, 'member', 'u-ana', 'member:u-ana', '2026-01-10 00:00:00', '2026-05-30 00:00:00', 'stepped_down', 0)",
      [roleIds[1]],
    );
    await h.start();
  });
  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });
  beforeEach(() => {
    h.state.viewer = { id: "u-ivo", stage: "member" };
  });

  it("one person applying for five roles is one card, in proposal mode, at the member tier", async () => {
    const r = await h.call("/api/governance/role-applications/sa-00000000000000a1/card");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.viewer).toEqual({ level: "member", isSelf: false });
    const card = r.body.card;
    expect(card.roles.map((x: any) => x.id)).toEqual(roleIds);
    expect(card.header.name).toBe("Ana Quillfeather");
    expect(card.header.rolesLine.startsWith("Applies for ")).toBe(true);
    expect(card.across.tasks).toEqual({ kind: "empty", words: "Starts once adopted" });
    expect(card.across.signs).toEqual({ kind: "empty", words: "Starts once adopted" });
    for (const role of card.roles) expect(role.tensions).toEqual({ kind: "empty", words: "Starts once adopted" });
    // The application's own terms, money in words, small and last.
    const rows = card.agreements.roles[0].rows.value;
    expect(rows[rows.length - 1]).toMatchObject({ label: "Pay", small: true });
    expect(JSON.stringify(r.body)).not.toContain("4321000");
    // The reader is never named on the card.
    expect(JSON.stringify(r.body)).not.toContain("Ivo");
  });

  it("the candidate reads their own proposal card at the self tier, with their old seating in Past", async () => {
    h.state.viewer = { id: "u-ana", stage: "member" };
    const r = await h.call("/api/governance/role-applications/sa-00000000000000a1/card");
    expect(r.status).toBe(200);
    expect(r.body.viewer).toEqual({ level: "self", isSelf: true });
    const past = r.body.card.applications.past.value.map((a: any) => a.status);
    expect(past).toContain("Held, with no application on file");
  });

  it("E9: the card is drawn in the season the application is for, never the running one", async () => {
    // Filed for the next season: its name and its dates, and no day counted of a season not begun.
    const next = (await h.call("/api/governance/role-applications/sa-00000000000000a3/card")).body.card.header;
    expect(next.eyebrow).toBe("Riverbend · Next");
    expect(next.span).toBe("1 January to 31 May 2027");
    expect(next.moon.day).toBeNull();
    // Control: an application for the running season reads the running season, day counted.
    const now = (await h.call("/api/governance/role-applications/sa-00000000000000a1/card")).body.card.header;
    expect(now.eyebrow).toBe("Riverbend · Now");
    expect(now.span).toBe("1 June to 31 December 2026");
    expect(now.moon.day).not.toBeNull();
  });

  it("an unknown or malformed id is 404 for a member", async () => {
    expect((await h.call("/api/governance/role-applications/sa-ffffffffffffffff/card")).status).toBe(404);
    expect((await h.call("/api/governance/role-applications/not-an-id/card")).status).toBe(404);
  });

  it("?candidate= returns that member's rows only, grouped past, this season and next season", async () => {
    const r = await h.call("/api/governance/role-applications?candidate=u-ana");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ids = r.body.applications.map((a: any) => a.id).sort();
    expect(ids).toEqual(["sa-00000000000000a1", "sa-00000000000000a2", "sa-00000000000000a3"]);
    expect(r.body.groups).toEqual({
      past: ["sa-00000000000000a2"],
      thisSeason: ["sa-00000000000000a1"],
      nextSeason: ["sa-00000000000000a3"],
    });
    // Old seatings are a person's own history: not for another member.
    expect(r.body).not.toHaveProperty("pastSeatings");
  });

  it("the member themselves also reads their old seatings with no application, in plain words", async () => {
    h.state.viewer = { id: "u-ana", stage: "member" };
    const r = await h.call("/api/governance/role-applications?candidate=u-ana");
    expect(r.body.pastSeatings).toEqual([
      expect.objectContaining({ roleId: roleIds[1], roleName: "Seed Keeper", words: "Held, with no application on file", href: `/roles?seat=${roleIds[1]}` }),
    ]);
  });

  it("the unfiltered list is unchanged: every application, and no groups", async () => {
    const r = await h.call("/api/governance/role-applications");
    expect(r.body.applications).toHaveLength(4);
    expect(r.body).not.toHaveProperty("groups");
    expect((await h.call("/api/governance/role-applications?candidate=")).status).toBe(400);
  });
});
