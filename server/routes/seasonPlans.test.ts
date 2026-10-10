/**
 * YOUR SEASON OVER REAL HTTP AND A REAL SCHEMA (season plans RC1).
 *
 * What is pinned, each against the route as it ships and the S5 scratch schema:
 *
 *   - the village page answers 401 to a visitor and to a signed-in guest
 *     BEFORE the database is touched (the pool throws), and a member is served
 *     (control);
 *   - the village page carries NO terms and no money: no key from the
 *     application's settings anywhere in it, while the applications behind it
 *     carry pay, allowance and bonus (the checker is proven on a control
 *     fixture that does carry them);
 *   - cards are ordered by name, never by progress, and "Not filed yet" names
 *     the members who have not filed;
 *   - a save inserts version n+1 and stands the one before down; filing stamps
 *     the newest; the village reads only a FILED version;
 *   - applications join by `candidate_user_id` and `term_season_id`: another
 *     season's application is not this season's;
 *   - this moon's pips count only quests consented inside this moon, with
 *     controls for last moon and for an unconsented claim;
 *   - a seat you do not hold cannot be handed back, and with no season to
 *     plan, saving is refused in words;
 *   - the erasure step takes the member's words and leaves the seats handed back;
 *   - neither recordEvent nor addActivity appears in any file this adds.
 *
 * Every figure is fake: XTS is the ISO 4217 code reserved for testing.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import { CALENDAR_CLOCK } from "../../shared/cycleClock";
import type { PlanSeason } from "../../shared/seasonPlans";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { eraseSeasonPlanWords, planVersions } from "../repos/seasonPlans";
import { insertApplication } from "../repos/seatApplications";
import { register } from "./seasonPlans";

const LADDER = ["visitor", "guest", "member"];

/** Mid February 2027 on the calendar clock: the window for s-next (from 1 March) opened on 1 February. */
const NOW = new Date("2027-02-15T12:00:00Z");

const PEOPLE = [
  { id: "u-zed", name: "Zed Lanternwick", handle: "zed" },
  { id: "u-ana", name: "Ana Quillfeather", handle: "ana" },
  { id: "u-mo", name: "Mo Brindlecap", handle: "mo" },
  { id: "u-guest", name: "Gale Visitor", handle: "gale" },
  { id: "u-demo", name: "Aaron Example", handle: "demo", isExample: true },
];

const SEASONS: PlanSeason[] = [
  { id: "s-now", name: "Running Season", startsOn: "2026-12-01", endsOn: "2027-03-01" },
  { id: "s-next", name: "Next Season", startsOn: "2027-03-01", endsOn: "2027-06-01", goals: [{ text: "Plant the north orchard" }, { text: "Open the guest kitchen" }] },
];

/** Terms carrying money, so the privacy test has something to leak. */
const MONEY_TERMS = {
  v: 1,
  pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month", note: "Stipend reviewed with the stewards." },
  allowance: { kind: "flat", currency: "XTS", amountMinor: 87600, per: "month" },
  bonus: { kind: "equity", capWords: "up to a small share, rated each moon" },
} as any;

/** Every key and value a roster must never carry. Applied to the whole JSON. */
const MONEY_KEYS = ["settings", "settingsHash", "terms", "termsOffer", "pay", "allowance", "bonus", "amountMinor", "currency", "per", "capWords", "note", "deliverables"];
function moneyIn(payload: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (MONEY_KEYS.includes(k)) found.push(`${at}.${k}`);
        walk(x, `${at}.${k}`);
      }
    }
  };
  walk(payload, "$");
  const text = JSON.stringify(payload);
  for (const leak of ["XTS", "4321000", "87600", "small share", "Stipend"]) if (text.includes(leak)) found.push(`text:${leak}`);
  return found;
}

const configured = testDbConfigured();
if (!configured) console.warn("[seasonPlans] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

function harness() {
  const state = {
    viewer: null as { id: string; stage: string } | null,
    seasons: SEASONS,
    pool: (): any => {
      throw new Error("the database was read before the gate answered");
    },
  };
  let server: http.Server;
  let base = "";
  const ctxFor = () =>
    ({
      stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"),
      stageIndexOf: (id: string) => LADDER.indexOf(id),
      roleCapabilities: [],
    }) as unknown as CapabilityCtx;

  const start = async () => {
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () => (state.viewer ? PEOPLE.find((p) => p.id === state.viewer!.id) ?? null : null),
      guardCapability: async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
        if (state.viewer && hasCapability(cap, ctxFor())) return true;
        res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
        return false;
      },
      capabilityCtx: async () => ctxFor(),
      getPool: () => state.pool(),
      notify: async () => ({ fresh: true }),
      overLimit: async () => false,
      members: { all: async () => PEOPLE } as any,
      isPresent: (m: any) => !!m && !m.isExample,
      seasonState: () => ({ seasons: state.seasons, timezone: "UTC" }),
      clock: () => CALENDAR_CLOCK,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "never" }),
      moduleGate: (_req, _res, next) => next(),
      now: () => NOW,
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  };
  const stop = () => new Promise<void>((resolve) => server?.close(() => resolve()));
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, { // module-review-ok: this suite's own loopback server, not an outbound call
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  return { state, start, stop, call };
}

describe("the village page refuses everyone below the member rung", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("a visitor gets 401 on the page and on a profile's card, and the database is never read", async () => {
    h.state.viewer = null;
    for (const url of ["/api/season-plans", "/api/season-plans?handle=ana", "/api/season-plans/mine"]) {
      const r = await h.call("GET", url);
      expect(r.status, url).toBe(401);
      expect(r.body).not.toHaveProperty("people");
    }
  });

  it("a signed-in guest gets 401 on the village page too", async () => {
    h.state.viewer = { id: "u-guest", stage: "guest" };
    const r = await h.call("GET", "/api/season-plans");
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty("people");
  });

  it("CONTROL: a member gets past the gate, and the database is read (here it throws, so 500)", async () => {
    h.state.viewer = { id: "u-ana", stage: "member" };
    expect((await h.call("GET", "/api/season-plans")).status).toBe(500);
  });

  it("the money checker sees money when it is there (control for the privacy test)", () => {
    expect(moneyIn({ people: [{ applications: [{ settings: MONEY_TERMS }] }] }).length).toBeGreaterThan(0);
    expect(moneyIn({ people: [{ aim: "Paid 4321000 XTS" }] })).toContain("text:XTS");
    expect(moneyIn({ people: [{ name: "Ana", seats: [{ id: "a", name: "Host" }] }] })).toEqual([]);
  });
});

describe.skipIf(!configured)("planning a season, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;

  const PLAN = {
    aim: "The north orchard is planted and two more people can prune it.",
    servesGoal: "Plant the north orchard",
    commitments: { quests: { perMoonMin: 2, perMoonMax: 4 }, scoreboard: { measures: [{ measure: "Trees planted", target: "40 by the turn" }] } },
    handingBack: [] as string[],
  };
  let hostSeat = "";
  let kitchenSeat = "";

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    h.state.pool = () => pool;
    await h.start();
    for (const p of PEOPLE) {
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?,?,?,'x',?)", [p.id, p.name, `${p.id}@example.org`, p.handle]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    hostSeat = await createOrgRole(pool, { id: "seat-host", name: "Host", seats: 1 });
    kitchenSeat = await createOrgRole(pool, { id: "seat-kitchen", name: "Kitchen keeper", seats: 1 });
    await seatHolder(pool, hostSeat, { userId: "u-ana", seasonId: "s-now", termEndsAt: new Date("2027-03-01T00:00:00Z") });
    await seatHolder(pool, kitchenSeat, { userId: "u-zed", seasonId: "s-now", termEndsAt: new Date("2027-03-01T00:00:00Z") });
    const app = (id: string, who: string, seasonId: string, status: "voting" | "awaiting-holder" | "adopted", seats: string[]) =>
      insertApplication(pool, {
        id,
        candidateUserId: who,
        proposedBy: who,
        seatIds: seats,
        note: "Stipend reviewed with the stewards.",
        deliverables: "Two more people can run it.",
        settings: MONEY_TERMS,
        settingsHash: "0".repeat(64),
        termEndsAt: new Date("2027-06-01T00:00:00Z"),
        termSeasonId: seasonId,
        termFollowsSeason: true,
        startsAt: new Date("2027-03-01T00:00:00Z"),
        status,
      });
    await app("sa-00000000000000a1", "u-ana", "s-next", "voting", [hostSeat]);
    await app("sa-00000000000000a2", "u-mo", "s-next", "adopted", [kitchenSeat]);
    await app("sa-00000000000000a3", "u-zed", "s-now", "voting", [kitchenSeat]); // another season: never on this page
    const claim = (id: string, who: string, status: string, consentedAt: string | null) =>
      pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO quest_claims (id, quest_id, user_id, status, consented_at) VALUES (?,?,?,?,?)",
        [id, `q-${id}`, who, status, consentedAt ? new Date(consentedAt) : null],
      );
    await claim("c1", "u-ana", "consented", "2027-02-03T10:00:00Z"); // this moon
    await claim("c2", "u-ana", "consented", "2027-02-14T10:00:00Z"); // this moon
    await claim("c3", "u-ana", "consented", "2027-01-30T10:00:00Z"); // last moon: not counted
    await claim("c4", "u-ana", "submitted", null); // not consented: not counted
  });

  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    h.state.viewer = { id: "u-ana", stage: "member" };
    h.state.seasons = SEASONS;
  });

  it("a save inserts version n+1 and stands the one before down; filing stamps the newest", async () => {
    const first = await h.call("PUT", "/api/season-plans/mine", { ...PLAN, aim: "First thoughts on the orchard." });
    expect(first.status).toBe(200);
    expect(first.body.season.id).toBe("s-next");
    expect(first.body.plan.version).toBe(1);
    expect(first.body.filed).toBeNull();
    const second = await h.call("PUT", "/api/season-plans/mine", PLAN);
    expect(second.body.plan.version).toBe(2);
    const versions = await planVersions(pool, "u-ana", "s-next");
    expect(versions.map((v) => [v.version, !!v.supersededAt])).toEqual([[1, true], [2, false]]);

    const filed = await h.call("POST", "/api/season-plans/mine/file");
    expect(filed.status).toBe(200);
    expect(filed.body.filed.version).toBe(2);
    expect(filed.body.changedSinceFiling).toBe(false);
  });

  it("the village reads only a filed version: a draft after filing changes nothing it sees", async () => {
    await h.call("PUT", "/api/season-plans/mine", { ...PLAN, aim: "A draft nobody else reads yet." });
    const r = await h.call("GET", "/api/season-plans");
    const ana = r.body.people.find((p: any) => p.userId === "u-ana");
    expect(ana.aim).toBe(PLAN.aim);
    expect(ana.changedSinceFiling).toBe(true);
    // The member's own page shows the draft.
    expect((await h.call("GET", "/api/season-plans/mine")).body.plan.aim).toBe("A draft nobody else reads yet.");
  });

  it("orders every card by name, counts who filed, and names who has not", async () => {
    const r = await h.call("GET", "/api/season-plans");
    expect(r.status).toBe(200);
    expect(r.body.people.map((p: any) => p.name)).toEqual(["Ana Quillfeather", "Gale Visitor", "Mo Brindlecap", "Zed Lanternwick"]);
    expect(r.body.filedCount).toBe(1);
    expect(r.body.memberCount).toBe(4);
    expect(r.body.notFiled.map((p: any) => p.name)).toEqual(["Gale Visitor", "Mo Brindlecap", "Zed Lanternwick"]);
    expect(r.body.window).toMatchObject({ seasonId: "s-next", opensOn: "2027-02-01", state: "open" });
  });

  it("carries no terms and no money anywhere, though every application behind it does", async () => {
    const r = await h.call("GET", "/api/season-plans");
    expect(moneyIn(r.body)).toEqual([]);
    const one = await h.call("GET", "/api/season-plans?handle=ana");
    expect(moneyIn(one.body)).toEqual([]);
    expect(moneyIn((await h.call("GET", "/api/season-plans/mine")).body)).toEqual([]);
  });

  it("joins applications by candidate and term season: another season's application is not this season's", async () => {
    const r = await h.call("GET", "/api/season-plans");
    const byId = new Map(r.body.people.map((p: any) => [p.userId, p]));
    expect((byId.get("u-ana") as any).applications.map((a: any) => [a.id, a.status, a.href])).toEqual([
      ["sa-00000000000000a1", "voting", "/seat-applications/sa-00000000000000a1"],
    ]);
    expect((byId.get("u-ana") as any).waiting).toBe(true);
    expect((byId.get("u-mo") as any).applications.map((a: any) => a.statusWords)).toEqual(["Adopted"]);
    expect((byId.get("u-mo") as any).waiting).toBe(false);
    expect((byId.get("u-zed") as any).applications).toEqual([]);
    expect((byId.get("u-zed") as any).seats).toEqual([{ id: "seat-kitchen", name: "Kitchen keeper" }]);
  });

  it("counts this moon's consented quests only: last moon and an unconsented claim are not this moon's work", async () => {
    const r = await h.call("GET", "/api/season-plans");
    const ana = r.body.people.find((p: any) => p.userId === "u-ana");
    expect(ana.questsThisMoon).toEqual({ done: 2, min: 2, max: 4 });
    const mo = r.body.people.find((p: any) => p.userId === "u-mo");
    expect(mo.questsThisMoon.done).toBe(0);
  });

  it("serves one member's card for their profile, and 404 for a handle nobody has", async () => {
    const r = await h.call("GET", "/api/season-plans?handle=zed");
    expect(r.body.people.map((p: any) => p.userId)).toEqual(["u-zed"]);
    expect((await h.call("GET", "/api/season-plans?handle=nobody-here")).status).toBe(404);
  });

  it("tells a guest up front that applying is not open to them yet, and a member that it is (red team U5)", async () => {
    h.state.viewer = { id: "u-guest", stage: "guest" };
    const guest = await h.call("GET", "/api/season-plans/mine");
    expect(guest.status).toBe(200);
    expect(guest.body.mayApply).toBe(false);
    h.state.viewer = { id: "u-ana", stage: "member" };
    expect((await h.call("GET", "/api/season-plans/mine")).body.mayApply).toBe(true);
  });

  it("hands back only a seat you hold, and files it with the plan", async () => {
    const stray = await h.call("PUT", "/api/season-plans/mine", { ...PLAN, handingBack: [kitchenSeat] });
    expect(stray.status).toBe(400);
    expect(stray.body.field).toBe("handingBack");
    h.state.viewer = { id: "u-zed", stage: "member" };
    const ok = await h.call("PUT", "/api/season-plans/mine", { ...PLAN, handingBack: [kitchenSeat] });
    expect(ok.status).toBe(200);
    await h.call("POST", "/api/season-plans/mine/file");
    const zed = (await h.call("GET", "/api/season-plans?handle=zed")).body.people[0];
    expect(zed.handingBack).toEqual([{ id: "seat-kitchen", name: "Kitchen keeper" }]);
  });

  it("refuses to file a plan with no aim, and refuses everything with no season to plan", async () => {
    h.state.viewer = { id: "u-mo", stage: "member" };
    expect((await h.call("POST", "/api/season-plans/mine/file")).status).toBe(409);
    await h.call("PUT", "/api/season-plans/mine", { ...PLAN, aim: "" });
    const empty = await h.call("POST", "/api/season-plans/mine/file");
    expect(empty.status).toBe(409);
    expect(empty.body.message).toMatch(/Write your aim/);

    h.state.seasons = [{ id: "s-far", name: "Far Season", startsOn: "2028-01-01", endsOn: "2028-04-01" }];
    const none = await h.call("PUT", "/api/season-plans/mine", PLAN);
    expect(none.status).toBe(409);
    expect(none.body.message).toMatch(/no season to plan yet/);
    expect((await h.call("GET", "/api/season-plans/mine")).body.season).toBeNull();
  });

  it("the erasure step takes the member's words and leaves the seats handed back", async () => {
    await eraseSeasonPlanWords(pool, "u-zed");
    const rows = await planVersions(pool, "u-zed", "s-next");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.aim).toBeNull();
      expect(r.servesGoal).toBeNull();
      expect(r.commitments).toEqual({});
      expect(r.handingBack).toEqual(["seat-kitchen"]);
    }
    // Control: another member's words are untouched.
    expect((await planVersions(pool, "u-ana", "s-next")).every((r) => r.aim)).toBe(true);
  });
});

describe("no public event", () => {
  it("names neither recordEvent nor addActivity in the files season plans add", () => {
    const root = path.resolve(__dirname, "..", "..");
    const files = [
      "server/routes/seasonPlans.ts",
      "server/repos/seasonPlans.ts",
      "server/lib/seasonPlanNotices.ts",
      "shared/seasonPlans.ts",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\brecordEvent\s*\(|\baddActivity\s*\(/);
    }
    // Control: the scan finds a call where one exists.
    const events = fs.readFileSync(path.join(root, "server/lib/erasure.ts"), "utf8");
    expect(events).toMatch(/\brecordEvent\s*\(/);
  });
});
