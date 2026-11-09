/**
 * A QUEST'S PRICE, SET BY THE TREASURER BESIDE THE ENGINE (quest re-price Q2;
 * Rye, 2026-11-09). The role pay rule, on quests, through the real routes and
 * a real schema:
 *
 *   1. Inside the band, a role.pay holder's word sets the quest's value and
 *      its tokens, and the record keeps the suggestion beside the figure.
 *   2. Outside it: a written reason, then a second signer before anything is
 *      written; the second signer's press writes it.
 *   3. Nobody prices a quest they hold an open claim on: it waits.
 *   4. No role.pay, no door.
 *   5. Before the village adopts a model, the engine has no rates: the door
 *      says where to set them and writes nothing (so no Voice is ever stored
 *      on version 0, the #995 rule).
 *   6. A claim keeps its terms (0342); its worker, and only its worker, takes
 *      the new price onto it (C8).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { saveModelVersion } from "../lib/valuationStore";
import { claimsRepo, questsRepo, type ClaimsRepo, type QuestsRepo } from "../repos/quests";
import { modelForVillage } from "../../shared/valuationEngine";
import type { ValuationModel } from "../../shared/valuation";
import { register } from "./valuation";

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
/** Welcome Ambassador, as the re-price spec reads its card: 4.5 hours, 3 to 6. */
const WORK = { kind: "quest", lines: [{ band: "general", payee: "lead", estimatedHours: 4.5, estimateLow: 3, estimateHigh: 6 }] };

describe.skipIf(!configured)("setting a quest's price with the Treasurer and the engine", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let quests: QuestsRepo;
  let claims: ClaimsRepo;
  let actor: { id: string; name: string } | null = { id: "treasurer-1", name: "A Treasurer" };
  let holders: Record<string, string[]> = {};
  let holdsRolePay = true;
  let expectedTotal = 0;
  let n = 0;

  const call = async (key: string, req: any = {}) => {
    const h = handlers.get(key);
    if (!h) throw new Error(`no handler for ${key}`);
    const { res, out } = makeRes();
    await h({ params: {}, body: {}, query: {}, ...req }, res);
    return out;
  };
  const as = (id: string) => (actor = { id, name: id });
  const makeQuest = async () => {
    const id = `q-price-${++n}`;
    await quests.add({ id, title: `Quest ${n}`, gratitude: "", status: "Open", tags: [], order: n } as any);
    return id;
  };
  const setPrice = (id: string, totalMinor: number, extra: Record<string, unknown> = {}) =>
    call("PUT /api/quests/:id/pay", { params: { id }, body: { work: WORK, set: { totalMinor }, ...extra } });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    quests = questsRepo(pool);
    claims = claimsRepo(pool);
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
      capabilityCtx: async () => ({ villageHeld: [] }),
      projectCurrency: () => "CRC",
      eeMeaningWritten: () => true,
      // The scratch schema registers no tokens; the admin door's real check is exercised in valuation.test.ts.
      payLineCheck: () => null,
      quests,
      claims,
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
    for (const t of ["valuation_settings", "valuation_models"]) {
      await pool.query(`DELETE FROM \`${t}\``); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    await saveModelVersion(pool, MODEL, { door: "version", actorId: "founder-1" });
    const s = await call("POST /api/valuation/suggest", { body: { work: WORK } });
    expectedTotal = s.body.payees[0].expected.totalMinor;
  });

  it("inside the band, the Treasurer's word sets the quest's value and tokens, beside the suggestion", async () => {
    const id = await makeQuest();
    const out = await setPrice(id, expectedTotal);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.state).toBe("set");
    const q: any = await quests.byId(id);
    expect(q.valueMinor).toBe(expectedTotal);
    expect(q.valueCurrency).toBe("CRC");
    const tokens = Object.fromEntries((q.valueTokens ?? []).map((t: any) => [t.token, t.amount]));
    expect(tokens[MODEL.tokens.credits]).toBeGreaterThan(0);
    expect(tokens[MODEL.tokens.equity]).toBeGreaterThan(0);
    expect(tokens[MODEL.tokens.voice], "Voice is everything paid, at 1 per colon").toBe(Math.floor(expectedTotal / 100));
    const rec = await call("GET /api/quests/:id/pay/settings", { params: { id } });
    expect(rec.body.settings[0]).toMatchObject({ state: "set", setMinor: expectedTotal });
    expect(rec.body.settings[0].suggestion.expected.totalMinor).toBe(expectedTotal);
  });

  it("outside the band asks a reason, then waits for a second signer, whose press writes it", async () => {
    const id = await makeQuest();
    const far = expectedTotal * 2;
    expect((await setPrice(id, far)).status).toBe(400);
    const waiting = await setPrice(id, far, { reason: "Hard conditions" });
    expect(waiting.body.state).toBe("awaiting_second");
    expect(((await quests.byId(id)) as any).valueMinor ?? null).toBeNull();
    as("treasurer-2");
    const signed = await call("POST /api/valuation/settings/:id/sign", { params: { id: waiting.body.settingId } });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(((await quests.byId(id)) as any).valueMinor).toBe(far);
  });

  it("a setter holding an open claim on the quest never prices it by their word alone", async () => {
    const id = await makeQuest();
    const taken = await claims.openClaim({ id: `claim-${id}`, questId: id, questTitle: "q", userId: "treasurer-1", userName: "T", status: "claimed", claimedAt: new Date().toISOString(), artifactUrl: "", note: "" });
    expect(taken.ok).toBe(true);
    const out = await setPrice(id, expectedTotal);
    expect(out.status).toBe(200);
    expect(out.body.state, "the conflict rule").not.toBe("set");
    expect(((await quests.byId(id)) as any).valueMinor ?? null).toBeNull();
  });

  it("refuses anyone without the pay-setting power", async () => {
    holdsRolePay = false;
    const id = await makeQuest();
    expect((await setPrice(id, expectedTotal)).status).toBe(403);
  });

  it("before the village adopts its own model, refuses with where to set the rates, and writes nothing", async () => {
    await pool.query("DELETE FROM `valuation_models`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const id = await makeQuest();
    const out = await setPrice(id, 0);
    expect(out.status).toBe(400);
    expect(out.body.refusals[0].fixAt).toBe("valuation:bands");
    expect(((await quests.byId(id)) as any).valueTokens ?? null).toBeNull();
  });

  it("a claim keeps its terms; its worker, and only its worker, takes the new price (C8)", async () => {
    const id = await makeQuest();
    const claimId = `claim-take-${id}`;
    expect((await claims.openClaim({ id: claimId, questId: id, questTitle: "q", userId: "member-1", userName: "M", status: "claimed", claimedAt: new Date().toISOString(), artifactUrl: "", note: "" })).ok).toBe(true);
    expect((await setPrice(id, expectedTotal)).body.state).toBe("set");
    expect((await claims.byId(claimId))?.payTerms?.valueTokens ?? null, "the claim kept the terms it was taken at").toBeNull();

    as("member-2");
    expect((await call("POST /api/game/quest-claims/:id/take-current-price", { params: { id: claimId } })).status).toBe(403);
    as("member-1");
    const took = await call("POST /api/game/quest-claims/:id/take-current-price", { params: { id: claimId } });
    expect(took.status, JSON.stringify(took.body)).toBe(200);
    expect((await claims.byId(claimId))?.payTerms?.valueMinor).toBe(expectedTotal);
  });
  it("the pricing desk lists each quest still offered, its last figure beside its inputs, and its open claims", async () => {
    const id = await makeQuest();
    expect((await setPrice(id, expectedTotal)).body.state).toBe("set");
    await claims.openClaim({ id: `claim-desk-${id}`, questId: id, questTitle: "q", userId: "member-9", userName: "M", status: "claimed", claimedAt: new Date().toISOString(), artifactUrl: "", note: "" });
    const desk = await call("GET /api/quests/pricing-desk");
    expect(desk.status, JSON.stringify(desk.body)).toBe(200);
    expect(desk.body).toMatchObject({ modelAdopted: true, eeMeaningWritten: true, cashBudgetLeft: null });
    const row = desk.body.quests.find((q: any) => q.id === id);
    expect(row.latest).toMatchObject({ state: "set", setMinor: expectedTotal });
    expect(row.latest.inputs.lines[0]).toMatchObject({ band: "general", estimatedHours: 4.5 });
    expect(row.pastPrices[0].setMinor).toBe(expectedTotal);
    expect(row.openClaims).toBe(1);
    expect(row.pay.value).toMatchObject({ minor: expectedTotal, currency: "CRC" }); // the scratch schema seeds no rules, so the lines are the engine's to test elsewhere
    holdsRolePay = false;
    expect((await call("GET /api/quests/pricing-desk")).status).toBe(403);
  });
});
