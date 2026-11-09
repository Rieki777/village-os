/**
 * THE AGREEMENTS ROUTE over real HTTP, against a real database (defect 9).
 *
 * What the wizard's "Write an agreement" meets now that something answers:
 * the words refused in the validator's sentences, a real ballot opened on the
 * `agreement` subject with the words stored beside it, the roll told, and the
 * closer moving the agreement to active, not adopted or withdrawn. The whole
 * path through the built server, landing included, is
 * server/canvasRevisit.routes.e2e.test.ts.
 *
 * The gate is a model here, as in server/routes/canvas.test.ts: the real
 * `hasCapability` over a context this file builds. DB-backed; skips loudly
 * without TEST_DATABASE_URL.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import type { CapabilityCtx } from "../../shared/capabilities";
import { AGREEMENT } from "../../shared/agreements";
import { ballotById } from "../lib/ballots";
import { listAgreements, readAgreement } from "../lib/agreements";
import { agreementCloser } from "../lib/agreementCloser";
import { AGREEMENT_OPEN_REFUSAL, register } from "./governanceAgreements";
import { CANVAS_MEMBERS_ONLY } from "./canvas";

const configured = testDbConfigured();
if (!configured) console.warn("[governanceAgreements] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

const PEOPLE: Record<string, { id: string; name: string; role: string; caps: string[]; membershipGranted: boolean }> = {
  opener: { id: "agr-opener", name: "Wren Halloway", role: "member", caps: ["proposal.open", "ballot.vote"], membershipGranted: true },
  member: { id: "agr-member", name: "Ash Brook", role: "member", caps: ["ballot.vote"], membershipGranted: true },
  stranger: { id: "agr-stranger", name: "Rook Talbot", role: "member", caps: [], membershipGranted: false },
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
const told: any[] = [];
const pulse: string[] = [];

const who = (req: express.Request) => PEOPLE[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;

const ctxFor = (u: (typeof PEOPLE)[string]): CapabilityCtx => ({
  stageIndex: 0,
  stageIndexOf: () => -1,
  roleCapabilities: u.caps,
  isAdmin: false,
  isFounder: false,
  villageHeld: [],
});

async function call(method: string, route: string, as: keyof typeof PEOPLE | null, body?: unknown) {
  const r = await fetch(`${base}${route}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

const tomorrowPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const good = (over: Record<string, unknown> = {}) => ({
  title: "Quiet hours in the common house",
  body: "Between ten at night and seven in the morning the common house is quiet. Anyone can name a night as an exception at the weekly circle.",
  domain: "space_land",
  circleId: "hearth",
  reviewAt: tomorrowPlus(90),
  ...over,
});

const closer = () =>
  agreementCloser({
    getPool: () => pool,
    notify: async (input) => {
      told.push(input);
    },
    notifyAdmins: async () => {},
    addActivity: async (_k, text) => {
      pulse.push(text);
    },
    ballotLink: (b) => `/decisions/${b.id}`,
  });

describe.skipIf(!configured)("the agreements route", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async (req) => who(req),
      isAdmin: async () => false,
      hasMembership: (u) => !!(u as { membershipGranted?: boolean }).membershipGranted,
      getPool: () => pool,
      capabilityCtx: async (u) => ctxFor(u),
      firstName: (name) => String(name).split(" ")[0] || "Someone",
      weightModeNow: () => ({ mode: "equal", token: null }) as any,
      circlesRepo: { all: () => [{ id: "hearth", name: "Hearth" }] } as any,
      notify: async (input) => {
        told.push(input);
        return { fresh: true, id: `n-${told.length}` };
      },
      buildElectorate: async () => [
        { userId: PEOPLE.opener.id, weight: 1 },
        { userId: PEOPLE.member.id, weight: 1 },
      ],
      addActivity: async (_k, text) => {
        pulse.push(text);
      },
      villageTimezone: () => "UTC",
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    told.length = 0;
    pulse.length = 0;
  });

  it("refuses a visitor, and a member without proposal.open in the route's sentence", async () => {
    expect((await call("POST", "/api/governance/agreements", null, good())).status).toBe(401);
    const r = await call("POST", "/api/governance/agreements", "member", good());
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: AGREEMENT_OPEN_REFUSAL });
  });

  it("refuses words the wizard would refuse, before any vote opens", async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ title: "Quiet" }, /title needs at least 8/],
      [{ body: "Too short to weigh." }, /at least 60 characters/],
      [{ domain: "weather" }, /money, people, space and land, rules, or none/],
      [{ circleId: "no-such-circle" }, /not one of this village's circles/],
      [{ reviewAt: "2026-02-30" }, /calendar date/],
      [{ reviewAt: new Date().toISOString().slice(0, 10) }, /after today/],
    ];
    for (const [over, said] of cases) {
      const r = await call("POST", "/api/governance/agreements", "opener", good(over));
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(String(r.body?.error)).toMatch(said);
    }
    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM ballots WHERE subject_type = 'agreement'"); // module-review-ok: reading the scratch schema this suite provisioned
    expect(Number(n.n)).toBe(0);
  });

  it("opens a real vote on the agreement subject, stores the words beside it, and tells the roll", async () => {
    const r = await call("POST", "/api/governance/agreements", "opener", good());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = String(r.body.id);
    expect(r.body.agreement).toMatchObject({ id, status: "voting", circleName: "Hearth", domain: "space_land" });
    expect(r.body.agreement).not.toHaveProperty("proposedBy");

    const ballot = await ballotById(pool, r.body.ballot.id);
    expect(ballot).toMatchObject({ subjectType: AGREEMENT, subjectRef: id, status: "open", openedBy: PEOPLE.opener.id });
    expect(ballot!.docMarkdown).toContain("Between ten at night");
    expect(ballot!.docMarkdown).toContain("Circle: Hearth.");

    const stored = await readAgreement(pool, id);
    expect(stored).toMatchObject({ id, status: "voting", ballotId: ballot!.id, proposedBy: PEOPLE.opener.id, circleId: "hearth" });

    // Not awaited by the route; give the roll's line a moment to land.
    for (let i = 0; i < 50 && !told.length; i++) await new Promise((res) => setTimeout(res, 20));
    expect(told.map((t) => [t.userId, t.type])).toEqual([[PEOPLE.member.id, "ballot_opened"]]);
    expect(pulse).toEqual(["The village is deciding whether to adopt an agreement: Quiet hours in the common house"]);
  });

  it("lets two agreements be voted on at once, each its own subject", async () => {
    const a = await call("POST", "/api/governance/agreements", "opener", good({ title: "Tools go back to the shed" }));
    const b = await call("POST", "/api/governance/agreements", "opener", good({ title: "Dogs on leads near the goats", reviewAt: null }));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.ballot.id).not.toBe(b.body.ballot.id);
    expect((await readAgreement(pool, b.body.id))?.reviewAt).toBeNull();
  });

  it("adopts at the landing, and says no, or stands down, in the closer's own words", async () => {
    const make = async (title: string) => {
      const r = await call("POST", "/api/governance/agreements", "opener", good({ title }));
      expect(r.status).toBe(201);
      return { id: String(r.body.id), ballot: (await ballotById(pool, r.body.ballot.id))! };
    };
    const carried = await make("Meals are shared on Sundays");
    const failed = await make("Nobody parks by the gate");
    const pulled = await make("Every circle meets once a moon");
    const c = closer();

    // Carried: nothing at the close, the words at the landing.
    expect(await c.settle(carried.ballot, "passed", "The village said yes.", "agr-member")).toEqual({ applied: [], held: null, proposerTold: null });
    expect((await readAgreement(pool, carried.id))?.status).toBe("voting");
    const landed = await c.execute!(carried.ballot, "agr-member");
    expect(landed.applied).toEqual([`agreement:${carried.id}`]);
    const active = await readAgreement(pool, carried.id);
    expect(active?.status).toBe("active");
    expect(active?.decidedAt).toBeTruthy();
    expect(told.some((t) => t.userId === PEOPLE.opener.id && t.title === "The village adopted this agreement: Meals are shared on Sundays")).toBe(true);
    expect(pulse).toContain("The village adopted an agreement by its own vote: Meals are shared on Sundays");

    // Not carried.
    const no = await c.settle(failed.ballot, "failed", "Too many of us park there already.", "agr-member");
    expect(no.proposerTold).toBe(PEOPLE.opener.id);
    expect((await readAgreement(pool, failed.id))?.status).toBe("not-adopted");

    // Withdrawn.
    await c.onWithdraw!(pulled.ballot);
    expect((await readAgreement(pool, pulled.id))?.status).toBe("withdrawn");

    // The list reads active first.
    const list = await listAgreements(pool);
    expect(list[0].id).toBe(carried.id);
  });

  it("holds a landing whose words were never stored, and adopts nothing", async () => {
    const r = await call("POST", "/api/governance/agreements", "opener", good({ title: "The orchard is everybody's" }));
    const ballot = (await ballotById(pool, r.body.ballot.id))!;
    await pool.query("DELETE FROM app_config WHERE config_key = ?", [`village-agreement:${r.body.id}`]); // module-review-ok: breaking the scratch schema on purpose
    const out = await closer().execute!(ballot, "agr-member");
    expect(out.applied).toEqual([]);
    expect(String(out.held)).toMatch(/was not recorded/);
  });

  it("serves members the agreements, their standing and review date, and refuses an account the village has not admitted", async () => {
    const r = await call("GET", "/api/governance/agreements", "member");
    expect(r.status).toBe(200);
    expect(r.body.agreements.length).toBeGreaterThan(0);
    for (const a of r.body.agreements) {
      expect(Object.keys(a).sort()).toEqual(["ballotId", "body", "circleId", "circleName", "decidedAt", "domain", "id", "reviewAt", "status", "title"]);
    }
    const s = await call("GET", "/api/governance/agreements", "stranger");
    expect(s.status).toBe(403);
    expect(s.body).toEqual({ error: CANVAS_MEMBERS_ONLY });
    expect((await call("GET", "/api/governance/agreements", null)).status).toBe(401);
  });
});
