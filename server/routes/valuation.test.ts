/**
 * THE VALUATION ENGINE'S ROUTES, ON A REAL SCHEMA (0336).
 *
 * Rye, 2026-11-06: "Role pay is set by both the treasurer and the role/valuation
 * algorithm." These are his answers, end to end through the routes:
 *
 *   1. Any member reads the model; with none saved it is the platform rules in
 *      the village's own currency (C5).
 *   2. A suggestion is priced by the server from the work's inputs.
 *   3. Inside the no-sign band a role.pay holder's word sets the role's pay, and
 *      the record keeps the suggestion beside the figure (C1).
 *   4. Outside it: a written reason, then a second, different signer (role.pay
 *      or steward.veto) before anything is written; with none, the vote path
 *      (C3). Nothing is ever refused for its size (II.6).
 *   5. The signer is never the setter, nobody the role pays, nor anyone whose
 *      own pay the setter set this season; two signers cannot both write.
 *   6. A role that pays its setter always waits (the conflict rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { createOrgRole, listOrgRoles, seatHolder, updateOrgRole } from "../lib/orgChart";
import { saveModelVersion } from "../lib/valuationStore";
import { modelForVillage } from "../../shared/valuationEngine";
import type { ValuationModel } from "../../shared/valuation";
import { register } from "./valuation";
import { getDraft } from "../lib/orgDrafts";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, h: Handler) => handlers.set(`${method} ${p}`, h);
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") } as any, handlers };
}
function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

const configured = testDbConfigured();
const src = { sentence: "Decree 45303-MTSS, daily rate ÷ 8", date: "2026-10-31" };
const MODEL: ValuationModel = { ...modelForVillage("CRC"), bands: [{ key: "general", label: "General help", hourValueMinor: 155455, source: src }] };
/** A role estimated at 20 hours for the moon, coordinating others. */
const WORK = { kind: "role", lines: [{ band: "general", payee: "lead", estimatedHours: 20 }], responsibility: "coordinates" };

describe.skipIf(!configured)("setting a role's pay with the Treasurer and the algorithm", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let actor: { id: string; name: string } | null = { id: "treasurer-1", name: "A Treasurer" };
  let holders: Record<string, string[]> = {};
  let holdsRolePay = true;
  let expectedTotal = 0;

  const call = async (key: string, req: any = {}) => {
    const h = handlers.get(key);
    if (!h) throw new Error(`no handler for ${key}`);
    const { res, out } = makeRes();
    await h({ params: {}, body: {}, query: {}, ...req }, res);
    return out;
  };
  const roleOf = async (id: string): Promise<any> => (await listOrgRoles(pool)).find((r) => r.id === id);
  const as = (id: string) => (actor = { id, name: id });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const { app, handlers: h } = collect();
    register(app, {
      authedUser: async () => actor,
      getPool: () => pool,
      guardCapability: async (_req: any, res: any, key: string) => {
        if (key === "role.pay" && !holdsRolePay) {
          res.status(403).json({ error: "capability_required", capability: key });
          return false;
        }
        return true;
      },
      overLimit: async () => false,
      liveHoldersOf: async (cap: string) => holders[cap] ?? [],
      projectCurrency: () => "CRC",
      eeMeaningWritten: () => true,
      // The scratch schema registers no tokens; the real check is the admin door's, exercised below by name.
      payLineCheck: (_rules: unknown, token: string) => (token === "hearts" ? "Gratitude never pays work." : null),
    } as any);
    handlers = h;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    as("treasurer-1");
    holdsRolePay = true;
    holders = { "role.pay": ["treasurer-1", "treasurer-2"], "steward.veto": ["steward-1"] };
    for (const t of ["valuation_settings", "valuation_models", "org_role_assignments", "org_roles"]) {
      await pool.query(`DELETE FROM \`${t}\``); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    await saveModelVersion(pool, MODEL, { door: "version", actorId: "founder-1" });
    const s = await call("POST /api/valuation/suggest", { body: { work: WORK } });
    expectedTotal = s.body.payees[0].expected.totalMinor;
  });

  const makeRole = async (name = "Garden Steward") => createOrgRole(pool, { name, seats: 1 } as any);
  const setPay = (id: string, totalMinor: number, extra: Record<string, unknown> = {}) =>
    call("PUT /api/org/roles/:id/pay", { params: { id }, body: { work: WORK, set: { totalMinor }, ...extra } });

  it("lets any member read the model, and prices in the village's own currency with none saved (C5)", async () => {
    await pool.query("DELETE FROM `valuation_models`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const out = await call("GET /api/valuation/model");
    expect(out.status).toBe(200);
    expect(out.body.model).toMatchObject({ version: 0, currency: "CRC" });
    expect(out.body.eeMeaningWritten).toBe(true);
    expect(out.body.tokenNames[MODEL.tokens.voice]).toBe(MODEL.tokens.voice);
    actor = null;
    expect((await call("GET /api/valuation/model")).status).toBe(401);
  });

  it("suggests from the work's inputs, and refuses with where to fix it when the village set no rates", async () => {
    const ok = await call("POST /api/valuation/suggest", { body: { work: WORK } });
    expect(ok.status).toBe(200);
    expect(ok.body.payees[0].expected.totalMinor).toBeGreaterThan(0);
    await pool.query("DELETE FROM `valuation_models`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const none = await call("POST /api/valuation/suggest", { body: { work: WORK } });
    expect(none.status).toBe(400);
    expect(none.body.refusals[0].fixAt).toBe("valuation:bands");
  });

  it("sets the role's pay on the Treasurer's word inside the band, keeping the suggestion beside it (C1)", async () => {
    const id = await makeRole();
    const figure = Math.round(expectedTotal * 1.05);
    const out = await setPay(id, figure);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body).toMatchObject({ state: "set", decision: { inside: true, needs: "none" } });
    const role = await roleOf(id);
    expect(role.valueMinor).toBeGreaterThan(0);
    expect(role.valueMinor).toBeLessThanOrEqual(figure);
    expect(role.valueTokens.find((t: any) => t.token === MODEL.tokens.voice)?.amount).toBe(Math.floor(role.valueMinor / 100));
    const rec = await call("GET /api/org/roles/:id/pay/settings", { params: { id } });
    expect(rec.body.settings[0]).toMatchObject({ state: "set", suggestedMinor: expectedTotal, setMinor: figure, setterId: "treasurer-1", inside: true });
  });

  it("asks a written reason outside the band, and writes nothing without one", async () => {
    const id = await makeRole();
    const out = await setPay(id, Math.round(expectedTotal * 1.3));
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/reason/);
    expect((await roleOf(id)).valueMinor ?? null).toBeNull();
  });

  it("holds a figure outside the band for a second, different signer, and writes it when they sign (C3)", async () => {
    const id = await makeRole();
    const figure = Math.round(expectedTotal * 1.3);
    const out = await setPay(id, figure, { reason: "Local going rate differs" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ state: "awaiting_second", voteAfterDays: 7, proposeInstead: "/api/org/drafts/:id/put-to-village" });
    expect(out.body.decision.signers.sort()).toEqual(["steward-1", "treasurer-2"]);
    expect((await roleOf(id)).valueMinor ?? null).toBeNull();

    as("treasurer-1");
    const self = await call("POST /api/valuation/settings/:id/sign", { params: { id: out.body.settingId } });
    expect(self.status).toBe(403);
    as("steward-1");
    const signed = await call("POST /api/valuation/settings/:id/sign", { params: { id: out.body.settingId } });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect((await roleOf(id)).valueMinor).toBeGreaterThan(0);
    as("treasurer-2");
    expect((await call("POST /api/valuation/settings/:id/sign", { params: { id: out.body.settingId } })).status).toBe(409);
  });

  it("never refuses a figure for its size (II.6)", async () => {
    const id = await makeRole();
    const out = await setPay(id, expectedTotal * 40, { reason: "Fairness with similar work" });
    expect(out.status).toBe(200);
    expect(out.body.state).toBe("awaiting_second");
  });

  it("names the village vote when no different signer is eligible", async () => {
    holders = { "role.pay": ["treasurer-1"], "steward.veto": [] };
    const id = await makeRole();
    const out = await setPay(id, Math.round(expectedTotal * 0.6), { reason: "Cash budget this cycle" });
    expect(out.body).toMatchObject({ state: "awaiting_vote", proposeInstead: "/api/org/drafts/:id/put-to-village" });
    // The draft is opened now, carrying the figure, so the vote is one press away (B3, 0.4).
    expect(out.body.putToVillage).toBe(`/api/org/drafts/${out.body.draftId}/put-to-village`);
    const draft: any = await getDraft(pool, out.body.draftId);
    expect(draft.changes[0]).toMatchObject({ op: "update_seat", orgRoleId: id });
    expect(draft.changes[0].payload.valueMinor).toBeLessThanOrEqual(Math.round(expectedTotal * 0.6));
    expect((await roleOf(id)).valueMinor ?? null).toBeNull();
  });

  it("makes a role that pays its setter wait, even inside the band, and never lets someone the role pays sign it", async () => {
    const id = await makeRole("Treasurer");
    await seatHolder(pool, id, { userId: "treasurer-1" });
    await seatHolder(pool, id, { userId: "treasurer-2" });
    const out = await setPay(id, expectedTotal);
    expect(out.body).toMatchObject({ state: "awaiting_second", decision: { inside: true, conflicted: true } });
    expect(out.body.decision.signers).toEqual(["steward-1"]);
    as("treasurer-2");
    expect((await call("POST /api/valuation/settings/:id/sign", { params: { id: out.body.settingId } })).status).toBe(403);
  });

  it("refuses a signer whose own pay the setter set this season (no swapping)", async () => {
    const theirs = await makeRole("Seed Keeper");
    await seatHolder(pool, theirs, { userId: "steward-1" });
    expect((await setPay(theirs, expectedTotal)).body.state).toBe("set");
    const id = await makeRole();
    const out = await setPay(id, Math.round(expectedTotal * 1.3), { reason: "Urgency" });
    expect(out.body.decision.signers).toEqual(["treasurer-2"]);
    as("steward-1");
    expect((await call("POST /api/valuation/settings/:id/sign", { params: { id: out.body.settingId } })).status).toBe(403);
  });

  it("asks the gate for role.pay, and needs a real role and the work's inputs", async () => {
    const id = await makeRole();
    holdsRolePay = false;
    expect((await setPay(id, expectedTotal)).status).toBe(403);
    holdsRolePay = true;
    expect((await call("PUT /api/org/roles/:id/pay", { params: { id: "no-such-role" }, body: { work: WORK, set: { totalMinor: 1 } } })).status).toBe(404);
    expect((await call("PUT /api/org/roles/:id/pay", { params: { id }, body: { set: { totalMinor: 1 } } })).status).toBe(400);
  });

  describe("P4, the retro top-up", () => {
    const topUp = (id: string, body: Record<string, unknown>) => call("POST /api/org/roles/:id/pay/top-up", { params: { id }, body });

    it("lets any member propose to raise a set figure, opening an org draft for the village and writing nothing yet", async () => {
      const id = await makeRole();
      expect((await setPay(id, expectedTotal)).body.state).toBe("set");
      const before = (await roleOf(id)).valueMinor;
      as("member-9");
      const out = await topUp(id, { totalMinor: before * 2, outcome: "The beds fed the whole kitchen through the dry moon" });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      expect(out.body.putToVillage).toBe(`/api/org/drafts/${out.body.draftId}/put-to-village`);
      const draft: any = await getDraft(pool, out.body.draftId);
      expect(draft.changes[0].payload.valueMinor).toBe(before * 2);
      expect((await roleOf(id)).valueMinor).toBe(before);
      const rec = await call("GET /api/org/roles/:id/pay/settings", { params: { id } });
      // Both records are kept; found by state, since two written in the same second have no order between them.
      const byState = (st: string) => rec.body.settings.find((x: any) => x.state === st);
      expect(byState("awaiting_vote")).toMatchObject({ reason: "Retro top-up", setterId: "member-9" });
      expect(byState("set")).toMatchObject({ setterId: "treasurer-1" });
    });

    it("never lowers a figure, and names the different proposal that can", async () => {
      const id = await makeRole();
      await setPay(id, expectedTotal);
      const current = (await roleOf(id)).valueMinor;
      for (const totalMinor of [current, current - 100]) {
        const out = await topUp(id, { totalMinor, outcome: "anything" });
        expect(out.status).toBe(409);
        expect(out.body.error).toMatch(/only raises/);
        expect(out.body.proposeInstead).toBe("/api/org/drafts/:id/put-to-village");
      }
    });

    it("asks what the work achieved, and refuses a role with no figure yet", async () => {
      const id = await makeRole();
      expect((await topUp(id, { totalMinor: 100000, outcome: "x" })).body.error).toMatch(/no figure set yet/);
      await setPay(id, expectedTotal);
      expect((await topUp(id, { totalMinor: expectedTotal * 3, outcome: "  " })).body.error).toMatch(/achieved/);
      actor = null;
      expect((await topUp(id, { totalMinor: expectedTotal * 3, outcome: "x" })).status).toBe(401);
    });
  });

  describe("no Voice line before the village adopts its own scale (economics lane, 2026-11-08)", () => {
    it("opens a top-up draft with no Voice while the village is still on the platform default model", async () => {
      const id = await makeRole();
      await updateOrgRole(pool, id, {}, { valueMinor: 20000000, valueCurrency: "CRC" });
      await pool.query("DELETE FROM `valuation_models`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      as("member-9");
      const out = await call("POST /api/org/roles/:id/pay/top-up", { params: { id }, body: { totalMinor: 30000000, outcome: "Carried the harvest" } });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      const draft: any = await getDraft(pool, out.body.draftId);
      const tokens = draft.changes[0].payload.valueTokens as Array<{ token: string }>;
      expect(tokens.some((t) => t.token === MODEL.tokens.voice)).toBe(false);
      expect(out.body.voiceHeld).toBe(true);
    });

    it("carries the Voice line once the village has adopted a model of its own", async () => {
      const id = await makeRole();
      expect((await setPay(id, expectedTotal)).body.state).toBe("set");
      const role = await roleOf(id);
      expect(role.valueTokens.some((t: { token: string }) => t.token === MODEL.tokens.voice)).toBe(true);
    });
  });
});
