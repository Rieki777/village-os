/**
 * THE CANVAS'S FIVE FRAMES over real HTTP, against a real database (plan 2.3;
 * Wave 3a).
 *
 * Every permission path the route has, each asserted by what happened after
 * it: a member suggests, somebody without the pen is refused and nothing
 * moves, the pen adopts and the setting reads back changed, the founder keeps
 * the purpose statement, and the same suggestion behaves differently before
 * and after the Birthing. The setting writes are the real ones
 * (`writeDial`, `saveExitPolicy`, `briefWrite`, `writeGoverningPurpose`,
 * `openMechanicsProposal`), so a refusal the setting itself makes is the one
 * asserted.
 *
 * ── THE GATE IS A FAITHFUL STUB OVER THE REAL ONE ──────────────────────────
 *
 * `capabilityCtx`, `guardCapability` and `mayAct` are built here from the
 * real `capabilityDecision`, with each person's role powers from a map and the
 * village's holdings read from the real table. What that leaves out is the
 * override hatch (no admin here breaks the glass), which is the dial write's
 * own concern and is tested with it.
 *
 * ── TWO FIXTURES, LABELLED AS FIXTURES ─────────────────────────────────────
 *
 * The village provisions un-started (`gameStarted: false`), the state every
 * Season Two village is in. The "after the Birthing" cases then write a
 * `game-start` row with `recordGameStart` and ballot id `bal-fixture-canvas`:
 * no vote carried, and a row reading that id can never be mistaken for one.
 * The "after the handover" case hands every transferable power to one role,
 * which no live village has ever done; a green there is a statement about the
 * fixture, as server/lib/capabilityHolding.ts asks every such test to say.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, HANDOVER_SET, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { PROPOSAL_BODY_MAX } from "../../shared/canvasFrames";
import { CANVAS_BLOCK_IDS } from "../../shared/governanceCanvas";
import { PURPOSE_EXAMPLE } from "../../shared/governingPurpose";
import { NOTE_IS_PUBLIC } from "../../shared/powerHands";
import { calendarUpsert } from "../lib/calendar";
import { STEWARD_ROLE_ID, capabilityHoldings, moveCapabilityToVillage } from "../lib/capabilityHolding";
import { recordMechanicsChangeRow } from "../lib/changeset";
import { DEFAULT_EXIT_POLICY, withPolicyDefaults } from "../lib/exitPolicy";
import { recordGameStart } from "../lib/gameStart";
import { governingPurpose, writeGoverningPurpose } from "../lib/governingPurpose";
import { confirmManual } from "../lib/launch";
import { proposalById, proposalsOpenedSince } from "../lib/mechanics";
import { effectiveLifecycle, loadModuleSettings } from "../lib/modules";
import type { IntakeHolding } from "../lib/restorativeIntake";
import { loadVariables, numberVar, setVariable, stringVar } from "../lib/variables";
import { briefGet, briefWrite } from "../lib/villageBrain";
import { wireReaders } from "../lib/villageReaders";
import { allDecisionMatrixRows } from "../repos/decisionMatrixRows";
import { dbDocument } from "../repos/store-db";
import { CANVAS_MEMBERS_ONLY } from "./canvas";
import {
  CARE_DOOR_IN_AGREEMENT,
  CARE_DOOR_IS_THE_AGREEMENT_VOTE,
  CONSEQUENCE_VOTE_NOT_BUILT,
  FILED_BY_PROPOSER,
  PEN_REFUSALS,
  PURPOSE_CHANGE_DOOR,
  register,
} from "./canvasFrames";

const configured = testDbConfigured();
if (!configured) console.warn("[canvasFrames.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

/** The people in this village, by the bearer token each one sends. */
const PEOPLE: Record<string, { id: string; name: string; role: string; membershipGranted: boolean }> = {
  member: { id: "cf-member", name: "Ash Brook", role: "member", membershipGranted: true },
  teller: { id: "cf-teller", name: "Wren Marsh", role: "member", membershipGranted: true },
  admin: { id: "cf-admin", name: "Moss Fielding", role: "admin", membershipGranted: false },
  founder: { id: "cf-founder", name: "Ivy Holloway", role: "founder", membershipGranted: true },
  stranger: { id: "cf-stranger", name: "Rook Talbot", role: "member", membershipGranted: false },
};
type Who = keyof typeof PEOPLE;

/** What each person's roles carry, as `roleCapabilitiesFor` would answer. */
const ROLE_CAPS: Record<string, string[]> = { "cf-teller": ["story.tell"] };

const ROLES = [
  { id: "cf-care", name: "Care Holder" },
  { id: "cf-cover", name: "Care Cover" },
  { id: "cf-tellers", name: "Storytellers" },
];

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
const exitPolicyRepo = () => exitDoc!;
let exitDoc: ReturnType<typeof dbDocument<any>> | null = null;
const activity: string[] = [];
/** The seats the See frame is handed, as `loadRoleHolders` hands them. Empty unless a test seats somebody. */
let HOLDERS: IntakeHolding[] = [];
/** Whether the mechanics standing check calls the filer qualified to open a proposal, or only to draft one. */
let QUALIFIED = true;
/** Whether the village has saved a conflict agreement, which then holds the restorative block. False unless a test says so. */
let AGREEMENT_STORED = false;

const who = (req: express.Request) => {
  const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
  return PEOPLE[token] ?? null;
};

async function ctxFor(user: { id: string; role: string }): Promise<CapabilityCtx> {
  return {
    stageIndex: 0,
    stageIndexOf: () => 99,
    roleCapabilities: ROLE_CAPS[user.id] ?? [],
    isAdmin: user.role === "admin" || user.role === "founder",
    isFounder: user.role === "founder",
    villageHeld: (await capabilityHoldings(pool)).map((h) => h.capability),
  };
}

async function call(method: string, path: string, as: Who | null, body?: unknown) {
  const r = await fetch(`${base}${path}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

const propose = (as: Who, body: Record<string, unknown>) => call("POST", "/api/canvas/proposals", as, body);
const adopt = (as: Who, id: number, note?: string) => call("POST", `/api/canvas/proposals/${id}/adopt`, as, note ? { note } : {});
const decline = (as: Who, id: number, note?: string) => call("POST", `/api/canvas/proposals/${id}/decline`, as, note ? { note } : {});
const block = (as: Who | null, id: string) => call("GET", `/api/canvas/blocks/${id}`, as);

/** A purpose line long enough to pass the ballot's own floor. */
const LINE = "This lets the village admit people it already knows, which serves the purpose of deciding together in the open.";

describe.skipIf(!configured)("the canvas's five frames", () => {
  beforeAll(async () => {
    db = await provisionTestDb({ gameStarted: false });
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    for (const p of Object.values(PEOPLE)) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
        [p.id, p.name, `${p.id}@example.invalid`, "x", p.role],
      );
    }
    for (const r of ROLES) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO roles (id, name, capabilities) VALUES (?,?,?)",
        [r.id, r.name, JSON.stringify(r.id === "cf-tellers" ? ["story.tell"] : [])],
      );
    }
    await loadVariables(pool);
    await loadModuleSettings(pool);
    wireReaders({ moduleIsOn: () => true, boolVar: () => false });
    exitDoc = dbDocument<any>(pool, "exit-policy", DEFAULT_EXIT_POLICY as any);
    await exitDoc.load();

    const app = express();
    app.use(express.json({ limit: "1mb" })); // the limit server/index.ts sets
    const isAdmin = async (req: express.Request) => ["admin", "founder"].includes(who(req)?.role ?? "");
    const addActivity = async (_kind: string, text: string) => {
      activity.push(text);
    };
    register(app, {
      authedUser: async (req) => who(req),
      isAdmin,
      hasMembership: (user) => !!(user as { membershipGranted?: boolean }).membershipGranted,
      capabilityCtx: (user) => ctxFor(user),
      guardCapability: async (req, res, cap, refusal) => {
        const user = who(req);
        if (!user) {
          res.status(401).json({ error: "auth_required" });
          return false;
        }
        if (capabilityDecision(cap, await ctxFor(user)).allowed) return true;
        res.status(refusal?.status ?? 403).json(refusal?.body ?? { error: "forbidden" });
        return false;
      },
      getPool: () => pool,
      firstName: (name: string) => String(name ?? "").trim().split(/\s+/)[0] ?? "",
      loadRoles: () => ROLES as any,
      roleHolders: () => HOLDERS,
      exitPolicy: {
        isAdmin,
        getPool: () => pool,
        loadRoles: () => ROLES as any,
        circlesRepo: { all: () => [] } as any,
        exitPolicyRepo: exitPolicyRepo() as any,
        readExitPolicy: () => withPolicyDefaults(exitPolicyRepo().get()),
        // No conflict agreement unless a test stores one: the save then judges the exit policy's own restorative block.
        agreementStored: () => AGREEMENT_STORED,
      },
      dialWrite: {
        mayAct: async (req, cap: Capability) => {
          const user = who(req);
          const d = user ? capabilityDecision(cap, await ctxFor(user)) : null;
          return {
            ok: !!d?.allowed,
            reachedPast: false,
            villageHolds: !!d?.villageHolds,
            source: d?.source ?? "not granted",
            message: d?.allowed ? "" : "auth_required",
            needsOverride: false,
            overrideAvailable: false,
            holderName: null,
          };
        },
        overrideRefusal: () => null,
        authedUser: async (req) => who(req),
        adminActor: (req) => (who(req) ? { id: who(req)!.id } : null),
        getPool: () => pool,
        recordMechanicsChange: (key, result, actor, source) => recordMechanicsChangeRow(pool, key, result, actor, source),
        addActivity,
        checkVoiceSecret: () => ({ ok: true }),
      },
      mechanicsPropose: {
        getPool: () => pool,
        standingFor: async () => ({ denied: false, qualified: QUALIFIED }),
        readMintRules: async () => new Map(),
        addActivity,
        firstName: (name: string) => String(name ?? "").trim().split(/\s+/)[0] ?? "",
      },
      sharedPasswordPosture: async () => false,
      addActivity,
      tools: () => [],
      submissions: () => [],
      legalEntityLabel: () => "",
      seasonNow: () => null,
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop?.();
  });

  describe("who may read a block", () => {
    it("asks a visitor with no session to sign in, and tells an account the village has not admitted whose it is", async () => {
      expect(await block(null, "team")).toEqual({ status: 401, body: { error: "auth_required" } });
      expect(await block("stranger", "team")).toEqual({ status: 403, body: { error: CANVAS_MEMBERS_ONLY } });
      expect((await block("member", "vibes")).status).toBe(404);
    });

    it("gives a member the block's question, its credit, and the note that suggestions are public", async () => {
      const r = await block("member", "team");
      expect(r.status).toBe(200);
      expect(r.body.block.name).toBe("Team");
      expect(r.body.block.credit.text).toContain("Governance Canvas");
      expect(r.body.notesArePublic).toBe(NOTE_IS_PUBLIC);
      expect(r.body.birthed).toBe(false);
      expect(r.body.reading).toBeNull();
    });

    it("keeps the four administrators' sections away from a member, whatever their audience says", async () => {
      await briefWrite(pool, { section: "legal", body: "Title sits with the founders' trust.", audience: "member", source: "admin", confirmedBy: "cf-admin" });
      const asMember = (await block("member", "legal")).body.answer.sections;
      expect(asMember.find((s: any) => s.id === "legal")).toEqual({ id: "legal", title: expect.any(String), readable: false, status: "admin-only" });
      const asAdmin = (await block("admin", "legal")).body.answer.sections;
      expect(asAdmin.find((s: any) => s.id === "legal").body).toBe("Title sits with the founders' trust.");
    });

    it("says a section is written and not shared, until it is opened to members", async () => {
      const economy = async (as: Who) => (await block(as, "resourcing")).body.answer.sections.find((s: any) => s.id === "economy");
      expect(await economy("member")).toMatchObject({ readable: true, status: "blank" });
      await briefWrite(pool, { section: "economy", body: "Dues are forty a month.", audience: "admin", source: "admin", confirmedBy: "cf-admin" });
      expect(await economy("member")).toEqual({ id: "economy", title: expect.any(String), readable: false, status: "not-shared" });
      await briefWrite(pool, { section: "economy", body: "Dues are forty a month.", audience: "member", source: "admin", confirmedBy: "cf-admin" });
      expect(await economy("member")).toMatchObject({ readable: true, status: "confirmed", body: "Dues are forty a month." });
    });
  });

  describe("the See frame", () => {
    it("reads the dial it names, and moves when the dial moves", async () => {
      const fact = async () => (await block("member", "team")).body.observed.find((f: any) => f.id === "vouches");
      const before = await fact();
      expect(before.href).toBe("/game-mechanics");
      expect((await setVariable(pool, "membership.vouches_required", "3")).ok).toBe(true);
      expect((await fact()).text).toBe("A newcomer becomes a member after 3 vouches.");
    });

    it("says what the care door holds on the Conflict block, and never names the outside contact", async () => {
      const ids = (await block("member", "conflict")).body.observed.map((f: any) => f.id);
      expect(ids).toEqual(["restorative-steps", "care-role", "cover-role", "reply-time", "outside-contact"]);
    });

    it("reads the Power block's method, its governance switch, its powers and the Birthing", async () => {
      const facts = (await block("member", "power")).body.observed;
      expect(facts.map((f: any) => f.id)).toEqual(["default-method", "governance-on", "powers-held", "birthing"]);
      expect(facts.find((f: any) => f.id === "birthing").text).toBe("The Game has not started yet.");
      expect(facts.find((f: any) => f.id === "powers-held").text).toContain("none of its transferable powers");
    });

    it("gives every block facts with links, and none of them is a score", async () => {
      for (const id of CANVAS_BLOCK_IDS) {
        const r = await block("admin", id);
        expect(r.status, id).toBe(200);
        expect(r.body.observed.length, id).toBeGreaterThan(0);
        for (const f of r.body.observed) {
          expect(f.href, `${id}:${f.id}`).toMatch(/^\//);
          expect(f.text, `${id}:${f.id}`).not.toMatch(/\d+\s*(of|out of|\/)\s*\d+|%|score/i);
          expect(f.text, `${id}:${f.id}`).not.toBe("This could not be read just now.");
        }
      }
    });

    it("counts every role, gathering and decision the village has, past what the guide's prompt can carry", async () => {
      // Each reader's answer here is longer than its prompt budget (roles.all
      // 700 tokens, events.week 500, record.decisions 800), which is where a
      // capped answer stops being a list.
      const words = (seed: string, n: number) => `${seed} `.repeat(n).slice(0, n);
      const roleIds = Array.from({ length: 14 }, (_, i) => `cf-many-${i + 1}`);
      const recordIds = Array.from({ length: 8 }, (_, i) => `cf-rec-${i + 1}`);
      for (const [i, id] of roleIds.entries()) {
        await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
          "INSERT INTO roles (id, name, description, capabilities) VALUES (?,?,?,?)",
          [id, `Hedge keeper ${i + 1}`, words("Keeps the hedges and the paths along them.", 240), JSON.stringify([])],
        );
      }
      for (let i = 0; i < 12; i++) {
        await calendarUpsert(pool, {
          sourceModule: "cf-test", sourceId: `gathering-${i + 1}`, kind: "gathering", layer: "village",
          title: words("A long gathering by the pond to plan the winter planting.", 200),
          locationText: "The pond field, behind the long barn",
          startsAt: new Date(Date.now() + (i + 2) * 60 * 60 * 1000),
        });
      }
      for (const [i, id] of recordIds.entries()) {
        await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
          "INSERT INTO village_record (id, section, slug, title, body, occurred_at, source, is_example) VALUES (?,?,?,?,?,?,?,0)",
          [id, "decisions", id, `Decision ${i + 1}`, words("We agreed this at the circle after a long talk.", 600), new Date(Date.UTC(2026, 6, i + 1, 12)), "decision"],
        );
      }
      try {
        const fact = async (blockId: string, factId: string) =>
          (await block("member", blockId)).body.observed.find((f: any) => f.id === factId).text;
        // Soft, so a regression names every fact it broke, not only the first.
        expect.soft(await fact("roles", "roles-written")).toBe(`${ROLES.length + roleIds.length} roles are written down.`);
        expect.soft(await fact("meetings", "gatherings")).toBe("12 gatherings are on the calendar in the next seven days.");
        expect.soft(await fact("learning", "decisions-recorded")).toBe("Decisions are on the village record, the newest from 8 July 2026.");
      } finally {
        await pool.query("DELETE FROM roles WHERE id IN (?)", [roleIds]); // module-review-ok: removing this test's own rows
        await pool.query("DELETE FROM events WHERE source_module = 'cf-test'"); // module-review-ok: removing this test's own rows
        await pool.query("DELETE FROM village_record WHERE id IN (?)", [recordIds]); // module-review-ok: removing this test's own rows
      }
    });

    it("counts a seat whose term has run out as empty, by the gate's own lapse rule", async () => {
      const seats = [
        { id: "cf-rh-care", roleId: "cf-care", userId: "cf-member", termEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        { id: "cf-rh-cover", roleId: "cf-cover", userId: "cf-founder", termEndsAt: null },
        { id: "cf-rh-tellers", roleId: "cf-tellers", userId: "cf-teller", termEndsAt: null },
      ];
      for (const s of seats) {
        await pool.query( // module-review-ok: seating the scratch schema this suite provisioned
          "INSERT INTO role_holders (id, role_id, user_id, term_ends_at) VALUES (?,?,?,?)",
          [s.id, s.roleId, s.userId, s.termEndsAt],
        );
      }
      HOLDERS = seats;
      try {
        const fact = (await block("member", "roles")).body.observed.find((f: any) => f.id === "roles-empty");
        expect(fact.text).toBe("Nobody holds Care Holder today.");
      } finally {
        HOLDERS = [];
        await pool.query("DELETE FROM role_holders WHERE id IN (?)", [seats.map((s) => s.id)]); // module-review-ok: removing this test's own rows
      }
    });

    it("says a cap set after the launch decline is the village's own number, never the platform's", async () => {
      const fact = async () => (await block("member", "resourcing")).body.observed.find((f: any) => f.id === "issuance-cap").text;
      expect(await confirmManual(pool, "issuance-cap", "cf-founder", "declined")).toEqual({ ok: true, answer: "declined" });
      try {
        expect(await fact()).toMatch(/^The founders chose to keep the platform's issuance cap: \d+ tokens per lunar cycle\.$/);
        expect((await setVariable(pool, "ledger.admin_mint_cycle_cap", "500")).ok).toBe(true);
        const text = await fact();
        expect(text).toContain("500 tokens per lunar cycle");
        expect(text).not.toContain("platform's");
      } finally {
        await setVariable(pool, "ledger.admin_mint_cycle_cap", String(VARIABLES_BY_KEY["ledger.admin_mint_cycle_cap"]!.default));
        await confirmManual(pool, "issuance-cap", "cf-founder", false);
      }
    });
  });

  describe("suggesting", () => {
    it("lets a member suggest words, names them, and offers the pen to whoever holds it", async () => {
      const r = await propose("member", { blockId: "team", sectionId: "membership", body: "Two vouches and a walk around the land." });
      expect(r.status).toBe(201);
      expect(r.body.proposal).toMatchObject({ blockId: "team", target: "words", sectionId: "membership", status: "open", source: "member" });
      expect(r.body.proposal.proposedBy).toEqual({ id: "cf-member", name: "Ash" });
      expect(r.body.proposal.pen).toMatchObject({ pen: "prose", how: "act", who: "the-gate", youMayAdopt: false });
      expect("servesPurpose" in r.body.proposal).toBe(false);
      const open = (await block("teller", "team")).body.proposals.map((p: any) => p.id);
      expect(open).toContain(r.body.proposal.id);
      expect((await block("teller", "team")).body.proposals.find((p: any) => p.id === r.body.proposal.id).pen.youMayAdopt).toBe(true);
    });

    it("refuses a visitor, an account not admitted, and a suggestion nobody could adopt", async () => {
      expect((await propose("stranger", { blockId: "team", sectionId: "membership", body: "Hello there." })).status).toBe(403);
      expect((await call("POST", "/api/canvas/proposals", null, { blockId: "team", body: "x" })).status).toBe(401);
      expect((await propose("member", { blockId: "team", sectionId: "economy", body: "Some words." })).body.error).toBe("Team does not draw on that section.");
      expect((await propose("member", { blockId: "conflict", body: "Some words." })).status).toBe(400);
      const seat = await propose("member", { blockId: "roles", target: "setting", body: "Terms of a year." });
      expect(seat.status).toBe(400);
      expect(seat.body.error).toContain("Seat terms are set on each seat");
      expect((await propose("member", { blockId: "purpose", target: "purpose", body: "We grow food." })).status).toBe(400);
    });

    it("keeps a suggestion at the stated limit whole, in a script whose characters take three bytes each", async () => {
      // 40,000 characters of CJK is 120,000 bytes under utf8mb4: past what TEXT holds.
      const long = "村".repeat(PROPOSAL_BODY_MAX);
      const r = await propose("member", { blockId: "team", sectionId: "membership", body: long });
      expect(r.status).toBe(201);
      const kept = (await block("teller", "team")).body.proposals.find((p: any) => p.id === r.body.proposal.id);
      expect(kept.body).toBe(long);
    });

    it("lets only an administrator mark a suggestion as drafted from the live system", async () => {
      expect((await propose("member", { blockId: "team", sectionId: "membership", body: "Drafted words.", source: "derived" })).status).toBe(403);
      const r = await propose("admin", { blockId: "team", sectionId: "membership", body: "Drafted words.", source: "derived" });
      expect(r.status).toBe(201);
      expect(r.body.proposal.source).toBe("derived");
    });

    it("scopes the purpose line: absent on wording, required on the Power answer once a statement exists", async () => {
      const dial = { blockId: "power", target: "setting", door: "dial:governance.default_method", change: { value: "consent" }, body: "Decide by consent." };
      // No statement yet: the line is welcome and not demanded.
      expect((await propose("member", dial)).status).toBe(201);
      // Wording never carries the field.
      const worded = await propose("member", { blockId: "team", sectionId: "membership", body: "Words.", servesPurpose: LINE });
      expect(worded.status).toBe(400);
      expect(worded.body.error).toContain("carries no line about the purpose");

      // A FIXTURE: the founder's statement, written through the one writer.
      expect((await writeGoverningPurpose(pool, { statement: PURPOSE_EXAMPLE, writtenBy: "cf-founder" })).ok).toBe(true);
      const missing = await propose("member", dial);
      expect(missing.status).toBe(400);
      expect(missing.body.error).toContain("how it serves the governing purpose");
      const short = await propose("member", { ...dial, servesPurpose: "It helps." });
      expect(short.status).toBe(400);
      expect(short.body.error).toContain("12 words");
      const good = await propose("member", { ...dial, servesPurpose: LINE });
      expect(good.status).toBe(201);
      expect(good.body.proposal.servesPurpose).toBe(LINE);
      const matrix = await propose("member", {
        blockId: "power", target: "matrix", body: "Who decides a new building.",
        change: { subject: "A new building", approval: "The whole village", consultation: "Neighbours", information: "Everyone" },
      });
      expect(matrix.status).toBe(400);
    });
  });

  describe("adopting, before the Birthing", () => {
    it("words: the story's holder adopts, the audience stays where it was, and a member without the pen moves nothing", async () => {
      await briefWrite(pool, { section: "membership", body: "Old words.", audience: "member", source: "admin", confirmedBy: "cf-admin" });
      const p = (await propose("member", { blockId: "team", sectionId: "membership", body: "Two vouches, a shared meal, then a moon of visiting." })).body.proposal;

      const refused = await adopt("member", p.id);
      expect(refused).toEqual({ status: 403, body: { error: PEN_REFUSALS.prose } });
      expect((await briefGet(pool, "membership", "admin"))?.body).toBe("Old words.");

      const r = await adopt("teller", p.id, "Agreed at the moon.");
      expect(r.status).toBe(200);
      expect(r.body.outcome).toMatchObject({ wrote: "brief-section", section: "membership" });
      expect(r.body.proposal).toMatchObject({ status: "adopted", decidedBy: "cf-teller", decisionNote: "Agreed at the moon." });
      const row = await briefGet(pool, "membership", "admin");
      expect(row?.body).toBe("Two vouches, a shared meal, then a moon of visiting.");
      expect(row?.audience).toBe("member");
      expect(row?.status).toBe("confirmed");
      expect(row?.confirmedBy).toBe("cf-teller");

      expect((await adopt("teller", p.id)).status).toBe(409);
    });

    it("an administrators' section: the story's holder is refused, an administrator adopts", async () => {
      const p = (await propose("member", { blockId: "legal", sectionId: "land", body: "The land is leased for ninety-nine years." })).body.proposal;
      expect(p.pen.pen).toBe("admin");
      expect(await adopt("teller", p.id)).toEqual({ status: 403, body: { error: PEN_REFUSALS.admin } });
      expect((await adopt("admin", p.id)).status).toBe(200);
      expect((await briefGet(pool, "land", "admin"))?.body).toBe("The land is leased for ninety-nine years.");
    });

    it("the purpose statement: only the founders adopt it", async () => {
      const statement = PURPOSE_EXAMPLE.replace("This village exists", "Our village exists");
      const p = (await propose("member", { blockId: "purpose", target: "purpose", body: statement })).body.proposal;
      expect(p.pen).toMatchObject({ pen: "purpose", how: "act", who: "founders" });
      expect(await adopt("member", p.id)).toEqual({ status: 403, body: { error: PEN_REFUSALS.purpose } });
      expect((await adopt("teller", p.id)).status).toBe(403);
      expect((await governingPurpose(pool)).statement).toBe(PURPOSE_EXAMPLE);
      const r = await adopt("founder", p.id);
      expect(r.status).toBe(200);
      expect((await governingPurpose(pool)).statement).toBe(statement);
    });

    it("a dial: whoever may turn the dials adopts it, through the dial write and its own refusals", async () => {
      const p = (await propose("member", {
        blockId: "team", target: "setting", door: "dial:membership.vouches_required", change: { value: "4" }, body: "Four people should know a newcomer.",
      })).body.proposal;
      expect(await adopt("member", p.id)).toEqual({ status: 403, body: { error: PEN_REFUSALS.dial } });
      expect(numberVar("membership.vouches_required")).toBe(3);
      const r = await adopt("admin", p.id);
      expect(r.status).toBe(200);
      expect(r.body.outcome).toMatchObject({ wrote: "dial", key: "membership.vouches_required", value: "4" });
      expect(numberVar("membership.vouches_required")).toBe(4);

      // The dial's own validator answers, and the suggestion stays open.
      const bad = (await propose("member", {
        blockId: "power", target: "setting", door: "dial:governance.default_method", change: { value: "lottery" }, body: "Draw lots.", servesPurpose: LINE,
      })).body.proposal;
      const refused = await adopt("admin", bad.id);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toContain("Must be one of");
      expect(stringVar("governance.default_method")).not.toBe("lottery");
      expect((await block("admin", "power")).body.proposals.map((x: any) => x.id)).toContain(bad.id);
    });

    it("the care door: the founders adopt it through the exit-policy save, which refuses what it always refused", async () => {
      const p = (await propose("member", {
        blockId: "conflict", target: "setting", door: "exit:restorative", servesPurpose: LINE,
        change: { steps: ["Talk to the care holder first", "Meet with a facilitator"], intakeContactRole: "cf-care", coverRole: "cf-cover", replyHours: 48 },
        body: "Our own two steps, a care holder and a cover.",
      })).body.proposal;
      expect(await adopt("teller", p.id)).toEqual({ status: 403, body: { error: PEN_REFUSALS.consequence } });
      const r = await adopt("admin", p.id);
      expect(r.status).toBe(200);
      await exitPolicyRepo().load();
      const saved = exitPolicyRepo().get() as any;
      expect(saved.restorative).toMatchObject({ steps: ["Talk to the care holder first", "Meet with a facilitator"], intakeContactRole: "cf-care", coverRole: "cf-cover", replyHours: 48 });
      const care = (await block("member", "conflict")).body.observed.find((f: any) => f.id === "care-role").text;
      expect(care).toBe("Care Holder receives a request for care, and nobody holds that role today.");

      const unknown = (await propose("member", {
        blockId: "conflict", target: "setting", door: "exit:restorative", servesPurpose: LINE,
        change: { intakeContactRole: "cf-nobody" }, body: "A role that is not there.",
      })).body.proposal;
      const refused = await adopt("admin", unknown.id);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe("unknown_role");
      await exitPolicyRepo().load();
      expect((exitPolicyRepo().get() as any).restorative.intakeContactRole).toBe("cf-care");
    });

    it("the care door, once a conflict agreement holds the restorative block: the save refuses, names where it lives, and nothing moves", async () => {
      const p = (await propose("member", {
        blockId: "conflict", target: "setting", door: "exit:restorative", servesPurpose: LINE,
        change: { steps: ["Write to the care holder"], replyHours: 72 },
        body: "One step and three days.",
      })).body.proposal;
      await exitPolicyRepo().load();
      const before = JSON.stringify((exitPolicyRepo().get() as any).restorative);
      AGREEMENT_STORED = true;
      try {
        const r = await adopt("admin", p.id);
        expect(r.status).toBe(409);
        expect(r.body).toEqual({ error: "restorative_in_agreement", message: CARE_DOOR_IN_AGREEMENT });
      } finally {
        AGREEMENT_STORED = false;
      }
      await exitPolicyRepo().load();
      expect(JSON.stringify((exitPolicyRepo().get() as any).restorative)).toBe(before);
      // The suggestion stays open for the pen, with nothing recorded as adopted.
      expect((await block("admin", "conflict")).body.proposals.map((x: any) => x.id)).toContain(p.id);
    });

    it("a matrix row: the founders adopt it and the village's matrix carries it", async () => {
      const p = (await propose("member", {
        blockId: "power", target: "matrix", body: "Who decides a new building.", servesPurpose: LINE,
        change: { subject: "A new building", approval: "The whole village", consultation: "Neighbours", information: "Everyone", riskTags: ["land"] },
      })).body.proposal;
      expect((await adopt("teller", p.id)).status).toBe(403);
      expect((await adopt("admin", p.id)).status).toBe(200);
      const rows = await allDecisionMatrixRows(pool);
      expect(rows.map((r) => r.subject)).toEqual(["A new building"]);
      expect(rows[0].riskTags).toEqual(["land"]);
    });

    it("governance for members: the founders switch it on through the lifecycle write", async () => {
      expect(effectiveLifecycle("governance")).toBe("off");
      const p = (await propose("member", {
        blockId: "power", target: "setting", door: "module:governance", change: { to: "members" }, servesPurpose: LINE, body: "Let the village vote here.",
      })).body.proposal;
      expect(p.pen).toMatchObject({ pen: "module", how: "act", who: "admins" });
      expect(await adopt("member", p.id)).toEqual({ status: 403, body: { error: PEN_REFUSALS.module } });
      expect(effectiveLifecycle("governance")).toBe("off");
      const r = await adopt("admin", p.id);
      expect(r.status).toBe(200);
      expect(r.body.outcome).toEqual({ wrote: "module-lifecycle", module: "governance", lifecycle: "members" });
      expect(effectiveLifecycle("governance")).toBe("members");
      const fact = (await block("member", "power")).body.observed.find((f: any) => f.id === "governance-on").text;
      expect(fact).toBe("Governance is on for members, so the village can vote here.");
    });

    it("declining: the pen says why, a member without it cannot, and the proposer can withdraw", async () => {
      const words = (await propose("member", { blockId: "team", sectionId: "membership", body: "Anybody may join." })).body.proposal;
      expect((await decline("teller", words.id)).status).toBe(400);
      const declined = await decline("teller", words.id, "We keep the vouches.");
      expect(declined.status).toBe(200);
      expect(declined.body.proposal).toMatchObject({ status: "declined", decisionNote: "We keep the vouches." });
      expect((await adopt("teller", words.id)).status).toBe(409);

      const dial = (await propose("teller", {
        blockId: "team", target: "setting", door: "dial:membership.vouches_required", change: { value: "1" }, body: "One vouch is enough.",
      })).body.proposal;
      expect(await decline("member", dial.id, "No.")).toEqual({ status: 403, body: { error: PEN_REFUSALS.dial } });
      const withdrawn = await decline("teller", dial.id);
      expect(withdrawn.status).toBe(200);
      expect(withdrawn.body.proposal).toMatchObject({ status: "declined", outcome: { withdrawn: true } });
    });

    it("the matrix's human rows: the founders write them, members read them", async () => {
      const row = { subject: "Spending under a hundred", approval: "The treasurer", consultation: "Nobody", information: "The circle", method: "Advice" };
      expect((await call("POST", "/api/canvas/decision-matrix/rows", "member", row)).status).toBe(403);
      const made = await call("POST", "/api/canvas/decision-matrix/rows", "admin", row);
      expect(made.status).toBe(201);
      const id = made.body.row.id;
      const changed = await call("PUT", `/api/canvas/decision-matrix/rows/${id}`, "admin", { ...row, approval: "Two of the treasurers" });
      expect(changed.body.row.approval).toBe("Two of the treasurers");
      const read = await call("GET", "/api/canvas/decision-matrix/rows", "member");
      expect(read.status).toBe(200);
      expect(read.body.rows.map((r: any) => r.subject)).toContain("Spending under a hundred");
      expect(read.body.pen).toMatchObject({ pen: "consequence", how: "act", youMayAdopt: false });
      expect((await call("DELETE", `/api/canvas/decision-matrix/rows/${id}`, "admin")).status).toBe(200);
      expect((await call("DELETE", `/api/canvas/decision-matrix/rows/${id}`, "admin")).status).toBe(404);
    });
  });

  describe("adopting, after the Birthing", () => {
    beforeAll(async () => {
      // A FIXTURE, not a vote: this village's Game is recorded as started so
      // the same suggestions can be read the other side of the Birthing.
      const start = await recordGameStart(pool, {
        ballotId: "bal-fixture-canvas",
        startedBy: "test-fixture",
        note: "A fixture: the canvas frames suite starts this scratch village's Game here.",
      });
      expect(start.started).toBe(true);
    });

    it("a dial is filed as a proposal the village decides, and the dial does not move", async () => {
      const p = (await propose("member", {
        blockId: "team", target: "setting", door: "dial:membership.vouches_required", change: { value: "5" }, body: "Five people should know a newcomer.",
      })).body.proposal;
      expect(p.pen).toMatchObject({ pen: "dial", how: "ballot", who: "any-member", youMayAdopt: true });
      const r = await adopt("member", p.id);
      expect(r.status).toBe(200);
      expect(r.body.outcome).toMatchObject({ filed: "mechanics-proposal", status: "open" });
      const filed = await proposalById(pool, String(r.body.outcome.id));
      expect(filed?.proposerUserId).toBe("cf-member");
      expect(filed?.changeSet).toEqual([{ key: "membership.vouches_required", from: "4", to: "5" }]);
      expect(numberVar("membership.vouches_required")).toBe(4);
    });

    it("only the member who wrote a dial suggestion files it, in their own name, and a draft says it is a draft", async () => {
      const p = (await propose("member", {
        blockId: "team", target: "setting", door: "dial:membership.vouches_required", change: { value: "6" }, body: "Six people should know a newcomer.",
      })).body.proposal;
      const seenBy = async (as: Who) => (await block(as, "team")).body.proposals.find((x: any) => x.id === p.id);
      expect((await seenBy("teller")).pen).toMatchObject({ pen: "dial", how: "ballot", youMayAdopt: false });
      expect((await seenBy("admin")).pen).toMatchObject({ pen: "dial", how: "ballot", youMayAdopt: false });
      expect((await seenBy("member")).pen).toMatchObject({ pen: "dial", how: "ballot", youMayAdopt: true });
      for (const as of ["teller", "admin"] as const) {
        expect(await adopt(as, p.id)).toEqual({ status: 403, body: { error: FILED_BY_PROPOSER } });
        expect(await proposalsOpenedSince(pool, PEOPLE[as].id, new Date(0))).toBe(0);
      }
      expect((await seenBy("member")).status).toBe("open");

      // The author is below the proposer bar: the filing is a draft in their
      // name, and the answer is the mechanics door's own sentence for that.
      QUALIFIED = false;
      try {
        const r = await adopt("member", p.id);
        expect(r.status).toBe(200);
        expect(r.body.outcome).toMatchObject({ filed: "mechanics-proposal", status: "draft" });
        expect(r.body.message).toMatch(/^Saved as a draft: /);
        expect((await proposalById(pool, String(r.body.outcome.id)))?.proposerUserId).toBe("cf-member");
      } finally {
        QUALIFIED = true;
      }
    });

    it("the care door is sent to the conflict agreement's own vote, the matrix waits for one nothing builds yet, and nothing moves", async () => {
      const p = (await propose("member", {
        blockId: "conflict", target: "setting", door: "exit:restorative", servesPurpose: LINE,
        change: { replyHours: 24 }, body: "A day, not two.",
      })).body.proposal;
      expect(p.pen).toMatchObject({ pen: "consequence", how: "ballot", ballotBuilt: false, youMayAdopt: false });
      expect(await adopt("admin", p.id)).toEqual({ status: 409, body: { error: CARE_DOOR_IS_THE_AGREEMENT_VOTE } });
      await exitPolicyRepo().load();
      expect((exitPolicyRepo().get() as any).restorative.replyHours).toBe(48);
      expect((await block("admin", "conflict")).body.proposals.map((x: any) => x.id)).toContain(p.id);

      const row = { subject: "Hiring", approval: "The circle", consultation: "Everyone", information: "Everyone" };
      const refused = await call("POST", "/api/canvas/decision-matrix/rows", "admin", row);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toContain(CONSEQUENCE_VOTE_NOT_BUILT);
    });

    it("the part of the Game that holds the vote stays the administrators' to switch, because no vote can move it", async () => {
      const p = (await propose("member", {
        blockId: "power", target: "setting", door: "module:governance", change: { to: "public" }, servesPurpose: LINE, body: "Open governance to everyone.",
      })).body.proposal;
      expect(p.pen).toMatchObject({ pen: "module", how: "act", who: "admins", youMayAdopt: false });
      expect(await adopt("member", p.id)).toEqual({ status: 403, body: { error: PEN_REFUSALS.module } });
      expect(effectiveLifecycle("governance")).toBe("members");
      const r = await adopt("admin", p.id);
      expect(r.status).toBe(200);
      expect(effectiveLifecycle("governance")).toBe("public");
    });

    it("words are still the story's holder's to adopt", async () => {
      const p = (await propose("member", { blockId: "meetings", sectionId: "rhythm", body: "We meet at each new moon." })).body.proposal;
      expect((await adopt("member", p.id)).status).toBe(403);
      expect((await adopt("teller", p.id)).status).toBe(200);
      expect((await briefGet(pool, "rhythm", "admin"))?.body).toBe("We meet at each new moon.");
    });

    it("the block says which pen is a vote now", async () => {
      const r = (await block("member", "power")).body;
      expect(r.birthed).toBe(true);
      expect(r.pens.dial).toMatchObject({ how: "ballot", youMayAdopt: true });
      expect(r.pens.consequence).toMatchObject({ how: "ballot", ballotBuilt: false });
      expect(r.observed.find((f: any) => f.id === "birthing").text).toMatch(/^The Game started on /);
    });

    it("says the steward seat holds the powers once the launch seats them there, and never that the administrators do", async () => {
      await pool.query( // module-review-ok: the founding seat on the scratch schema this suite provisioned, as the launch seats it
        "INSERT INTO roles (id, name, capabilities) VALUES (?, 'Founding Stewards', ?) ON DUPLICATE KEY UPDATE name = VALUES(name), capabilities = VALUES(capabilities)",
        [STEWARD_ROLE_ID, JSON.stringify(HANDOVER_SET)],
      );
      for (const cap of HANDOVER_SET) {
        expect(await moveCapabilityToVillage(pool, { capability: cap, holderRoleId: STEWARD_ROLE_ID }), cap).toEqual({ ok: true });
      }
      const text = (await block("member", "power")).body.observed.find((f: any) => f.id === "powers-held").text;
      expect(text).toBe(
        "The village holds none of its transferable powers yet. The Founding Stewards seat holds them until the village moves them to roles its members hold.",
      );
    });
  });

  describe("after the handover", () => {
    it("the purpose statement goes to the village's own vote, and the founders' adopt names that door", async () => {
      // A FIXTURE no live village has reached: every transferable power moved
      // to one role that is not the founding stewards'.
      await pool.query( // module-review-ok: a holder role on the scratch schema this suite provisioned
        "INSERT INTO roles (id, name, capabilities) VALUES ('cf-keepers','Keepers',?)",
        [JSON.stringify(HANDOVER_SET)],
      );
      for (const cap of HANDOVER_SET) {
        expect(await moveCapabilityToVillage(pool, { capability: cap, holderRoleId: "cf-keepers" }), cap).toEqual({ ok: true });
      }
      const before = (await governingPurpose(pool)).statement;
      const p = (await propose("member", { blockId: "purpose", target: "purpose", body: PURPOSE_EXAMPLE })).body.proposal;
      expect(p.pen).toMatchObject({ pen: "purpose", how: "ballot", who: "any-member" });
      const r = await adopt("founder", p.id);
      expect(r.status).toBe(409);
      expect(r.body.door).toBe(PURPOSE_CHANGE_DOOR);
      expect((await governingPurpose(pool)).statement).toBe(before);
    });
  });
});
