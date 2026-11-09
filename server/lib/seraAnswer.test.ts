/**
 * ANSWERING THE OUTSIDE SERVICE'S DIFFERENCES, against a real schema (spec
 * R12 to R16, R28, R30, R31, R38, T14a).
 *
 * The village here published the service's first structure three days ago,
 * traced to the proposal it came from, so every field has a known base. The
 * newest read then differs from the chart in five ways: a role's words, a
 * role moved, a role archived, a new role in a circle that is here, and a new
 * circle with a new role in it. Each block takes, keeps, edits or undoes one
 * of them through `answerDifferences` and reads the list back the way the
 * page reads it.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { createHash } from "crypto";
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./modules")>()),
  moduleConfig: () => ({ apiUrl: "https://service.example.test/mcp", dashboardUrl: "https://dash.example.test", agentName: "Sera" }),
  effectiveLifecycle: () => "preview",
}));

import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { seatIdFor } from "../../shared/structurePlan";
import { differenceSentence } from "../../shared/seraDifferenceWords";
import type { Difference, SnapshotRecord } from "../../shared/seraDifferences";
import { landProposal, markProposalDecided } from "./externalProposals";
import { answered, countAnswer, forgetCachedDifferences, listAnswer, readDifferences } from "./seraDifferencesRead";
import { acceptedForDifferences } from "./saberraSnapshot";
import { answerDifferences, lapseLeftAnswers, undoAnswers, type AnswerItem } from "./seraAnswer";
import { RETIRED_REASON, retireReplacedBatches } from "./saberraRetire";
import { addChange, createDraft, DRAFT_CHANGED_SINCE_SHOWN, publishDraft, withdrawDraft } from "./orgDrafts";
import { usersRepo } from "../repos/users";
import { insertSnapshot } from "../repos/saberraSnapshots";
import { ballotById } from "./ballots";
import { nameCheckFor } from "./saberraNames";
import { rosterRows } from "../repos/peopleRoster";
import { register as registerSaberra } from "../routes/saberra";
import { register as registerDecide } from "../routes/orgDraftDecide";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

const pageOf = (tag: string) => createHash("sha256").update(`sera-answer-${tag}`).digest("hex").slice(0, 32);
const P = {
  water: pageOf("c-water"), land: pageOf("c-land"), ls: pageOf("c-ls"),
  steward: pageOf("steward"), pump: pageOf("pump"), dish: pageOf("dish"), well: pageOf("well"), seed: pageOf("seed"), keeper: pageOf("keeper"),
  hoe: pageOf("hoe"),
};
const roleId = (pk: string) => seatIdFor(pk, "never");

const ROLES = [
  { t: "steward", name: "Water Steward", aim: "Keeps the wells." },
  { t: "pump", name: "Pump Keeper", aim: "Keeps the pumps." },
  { t: "dish", name: "Dish Rota", aim: "Keeps the dishes moving." },
] as const;

type Rec = SnapshotRecord;
const circleRecs = (): Rec[] => [
  { id: P.water, fields: { "Circle Name": "Water", Status: "Active" } },
  { id: P.land, fields: { "Circle Name": "Land & Ecology", Status: "Active" } },
  { id: P.ls, fields: { "Circle Name": "Land Stewardship", Status: "Active" } },
];
/** The newest read: five ways it differs from the chart here. */
function roleRecs(over: { stewardBody?: string; dishStatus?: string; hoe?: boolean } = {}): Rec[] {
  const out: Rec[] = [
    { id: P.steward, fields: { "Role Name": "Water Steward", Circle: [{ id: P.water }], Body: over.stewardBody ?? "Keeps the wells clean.", Status: "Active" } },
    { id: P.pump, fields: { "Role Name": "Pump Keeper", Circle: [{ id: P.land }], Body: "Keeps the pumps.", Status: "Active" } },
    { id: P.dish, fields: { "Role Name": "Dish Rota", Circle: [{ id: P.water }], Body: "Keeps the dishes moving.", Status: over.dishStatus ?? "Archived" } },
    { id: P.well, fields: { "Role Name": "Well Monitor", Circle: [{ id: P.water }], Body: "Checks the wells each week.", Status: "Proposed" } },
    { id: P.seed, fields: { "Role Name": "Seed Keeper", Circle: [{ id: P.ls }], Body: "Keeps the seed bank.", Status: "Active" } },
  ];
  if (over.hoe) out.push({ id: P.hoe, fields: { "Role Name": "Hoe Keeper", Circle: [{ id: P.ls }], Body: "Keeps the hoes.", Status: "Active" } });
  return out;
}

let readClock = Date.now() - 10 * 60_000;
async function keepRead(roles: Rec[] = roleRecs(), at = new Date((readClock += 60_000))): Promise<void> {
  await insertSnapshot(pool, at, { trigger: "by-hand", circles: { read: "whole", records: circleRecs() }, roles: { read: "whole", records: roles } });
  forgetCachedDifferences();
}

async function wipe(): Promise<void> {
  for (const t of ["saberra_settled", "saberra_links", "saberra_snapshots", "org_draft_changes", "org_drafts", "org_roles", "circles", "external_proposal_subjects", "external_proposals", "ballot_votes", "ballots"]) {
    await q(`DELETE FROM ${t}`);
  }
  forgetCachedDifferences();
}

/** The chart here, published three days ago from the service's first structure, traced to its proposal. */
async function seed(): Promise<void> {
  await wipe();
  await q("INSERT INTO circles (id, name, status, sort_order) VALUES ('water', 'Water', 'active', 1), ('land', 'Land & Ecology', 'active', 2)");
  const landed = await landProposal(pool, {
    villageId: "village-1", moduleId: "saberra", batchId: "sync-first", kind: "org.proposed",
    payload: { title: "Structure", rationale: "From the service.", seats: ROLES.map((r) => ({ id: P[r.t], name: r.name, circleName: "Water", aim: r.aim })) },
    sourceRef: "structure-first", trustTier: "extracted_unreviewed",
  });
  if (!landed.ok) throw new Error("the first structure did not land");
  await q("INSERT INTO org_drafts (id, title, status, source_kind, source_module_id, published_at) VALUES ('d-first', 'Structure', 'published', 'agent', 'saberra', ?)", [
    new Date(Date.now() - 3 * 86_400_000),
  ]);
  let sort = 0;
  for (const r of ROLES) {
    await q("INSERT INTO org_draft_changes (id, draft_id, op, org_role_id, payload, sort_order) VALUES (?, 'd-first', 'create_seat', ?, ?, ?)", [
      `d-first-${r.t}`, roleId(P[r.t]), JSON.stringify({ name: r.name, circleId: "water", aim: r.aim }), (sort += 1),
    ]);
    await q("INSERT INTO org_roles (id, circle_id, name, seats, active, aim) VALUES (?, 'water', ?, 1, 1, ?)", [roleId(P[r.t]), r.name, r.aim]);
  }
  await markProposalDecided(pool, { id: landed.id, status: "accepted", decidedBy: "u-steward", createdRef: "d-first" });
  await keepRead();
}

const AGENT = "Sera";
const deps = {
  read: () => readDifferences(pool),
  describe: (d: Difference) => ({ ...d, words: { sentence: differenceSentence(d, AGENT) } }),
  agent: AGENT,
  // R9: the wide match over today's roster, as the route hands it in.
  namesAMember: async () => nameCheckFor(await rosterRows(pool)).names,
};
const HOLDER = { userId: "u-ana", door: "power" as const, byRoleId: "ops-lead" };
const MODERATOR = { userId: "u-mo", door: "moderator" as const, byRoleId: null };
const item = (d: Difference): AnswerItem => ({ key: d.key, seraHash: d.seraHash, oursHash: d.oursHash });
const view = async () => answered(await readDifferences(pool));
async function one(kind: Difference["kind"], name?: string): Promise<Difference> {
  const d = (await readDifferences(pool)).list.find((x) => x.kind === kind && (name === undefined || x.subject.name === name));
  if (!d) throw new Error(`no ${kind} ${name ?? ""} in the list`);
  return d;
}
const changesIn = async (draftId: string) =>
  (await q("SELECT op, org_role_id, payload FROM org_draft_changes WHERE draft_id = ? ORDER BY sort_order", [draftId])).map((r) => ({
    op: r.op, orgRoleId: r.org_role_id, payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
  }));

describe.skipIf(!configured)("answering the differences", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await seed();
  });

  it("the fixture differs in the five ways it says, each a suggestion on a known base where it has one", async () => {
    const list = (await readDifferences(pool)).list.filter((d) => d.state !== "oursAhead");
    expect(list.map((d) => [d.kind, d.subject.name, d.bulkEligible])).toEqual(
      expect.arrayContaining([
        ["textField", "Water Steward", true],
        ["roleMove", "Pump Keeper", true],
        ["roleRest", "Dish Rota", true],
        ["roleAdd", "Well Monitor", false],
        ["circleAdd", "Land Stewardship", false],
        ["roleAdd", "Seed Keeper", false],
      ]),
    );
  });

  describe("a take (R12, R13)", () => {
    it("puts one decision into one draft, exactly that field, and cannot take it twice", async () => {
      const move = await one("roleMove");
      const r = await answerDifferences(pool, deps, { act: "take", items: [item(move)], actor: HOLDER });
      expect(r.status).toBe(200);
      const draftId = String(r.body.draftId);
      expect(await changesIn(draftId)).toEqual([{ op: "update_seat", orgRoleId: roleId(P.pump), payload: { circleId: "land" } }]);
      expect((await q("SELECT status, source_kind, source_module_id, created_by FROM org_drafts WHERE id = ?", [draftId]))[0]).toEqual({
        status: "open", source_kind: "agent", source_module_id: "saberra", created_by: "u-ana",
      });
      // Nothing on the chart moved: a take is a draft.
      expect((await q("SELECT circle_id FROM org_roles WHERE id = ?", [roleId(P.pump)]))[0].circle_id).toBe("water");
      const v = await view();
      expect(v.open.map((d) => d.key)).not.toContain(move.key);
      expect(v.inDraft.map((g) => [g.draftId, g.items.map((d) => d.key)])).toEqual([[draftId, [move.key]]]);
      const ids = (await q("SELECT id FROM org_draft_changes WHERE draft_id = ?", [draftId])).map((r) => r.id);
      expect(countAnswer(await readDifferences(pool)).drafts).toEqual([{ id: draftId, changes: 1, changeIds: ids, hasChanged: false }]);
      const again = await answerDifferences(pool, deps, { act: "take", items: [item(move)], actor: HOLDER });
      expect([again.status, again.body.why]).toEqual([409, "inDraft"]);
      expect(await changesIn(draftId)).toHaveLength(1);
    });

    it("an edit writes the person's own words into the one field, in the same draft as the takes before it", async () => {
      const move = await one("roleMove");
      const first = await answerDifferences(pool, deps, { act: "take", items: [item(move)], actor: HOLDER });
      const words = await one("textField", "Water Steward");
      const r = await answerDifferences(pool, deps, { act: "edit", items: [{ ...item(words), value: "Keeps the wells and the rota." }], actor: HOLDER });
      expect(r.status).toBe(200);
      expect(r.body.draftId).toBe(first.body.draftId);
      expect((await changesIn(String(r.body.draftId)))[1]).toEqual({ op: "update_seat", orgRoleId: roleId(P.steward), payload: { aim: "Keeps the wells and the rota." } });
      expect((await q("SELECT answer, door, by_role_id, actor_user_id FROM saberra_settled WHERE difference_key = ?", [words.key]))[0]).toEqual({
        answer: "edited", door: "power", by_role_id: "ops-lead", actor_user_id: "u-ana",
      });
      // The first answer about a role ties its page id to it (R1).
      expect(await q("SELECT subject_kind, page_key, our_id, set_by FROM saberra_links ORDER BY page_key")).toEqual(
        [
          { subject_kind: "role", page_key: P.pump, our_id: roleId(P.pump), set_by: "take" },
          { subject_kind: "role", page_key: P.steward, our_id: roleId(P.steward), set_by: "take" },
        ].sort((a, b) => a.page_key.localeCompare(b.page_key)),
      );
    });
  });

  describe("compare and set (R14)", () => {
    it("refuses when the service's hash moved, and when ours did, with the difference as it stands, and writes nothing", async () => {
      const words = await one("textField", "Water Steward");
      const sera = await answerDifferences(pool, deps, { act: "take", items: [{ ...item(words), seraHash: "0000000000000000" }], actor: HOLDER });
      expect([sera.status, sera.body.why, sera.body.error]).toEqual([409, "seraChanged", "Sera changed this since you opened it."]);
      expect((sera.body.difference as Difference).seraHash).toBe(words.seraHash);
      const ours = await answerDifferences(pool, deps, { act: "keep", items: [{ ...item(words), oursHash: "0000000000000000" }], actor: HOLDER });
      expect([ours.status, ours.body.why]).toEqual([409, "oursChanged"]);

      // Ours really moves under it: somebody rewrote the role's words here.
      await q("UPDATE org_roles SET aim = 'Keeps the wells and the tanks.' WHERE id = ?", [roleId(P.steward)]);
      const moved = await answerDifferences(pool, deps, { act: "take", items: [item(words)], actor: HOLDER });
      expect([moved.status, moved.body.why]).toEqual([409, "oursChanged"]);
      const now = moved.body.difference as Difference;
      expect(now.oursHash).not.toBe(words.oursHash);

      // Then the service moves under the refreshed one: a newer read with other words.
      await keepRead(roleRecs({ stewardBody: "Keeps the wells clean and safe." }));
      const later = await answerDifferences(pool, deps, { act: "take", items: [item(now)], actor: HOLDER });
      expect([later.status, later.body.why]).toEqual([409, "seraChanged"]);
      expect(await q("SELECT COUNT(*) AS n FROM saberra_settled")).toEqual([{ n: 0 }]);
      expect(await q("SELECT COUNT(*) AS n FROM org_drafts WHERE status = 'open'")).toEqual([{ n: 0 }]);
    });
  });

  describe("a keep (R16, T11)", () => {
    it("settles until the service changes the value, survives a read that changed nothing, and is undone", async () => {
      const words = await one("textField", "Water Steward");
      expect((await answerDifferences(pool, deps, { act: "keep", items: [item(words)], actor: HOLDER })).status).toBe(200);
      expect((await view()).open.map((d) => d.key)).not.toContain(words.key);
      await keepRead();
      expect((await view()).open.map((d) => d.key), "an unchanged read leaves it answered").not.toContain(words.key);
      const undo = await undoAnswers(pool, deps, { keys: [words.key], actor: HOLDER });
      expect([undo.status, undo.body.undone]).toEqual([200, [words.key]]);
      expect((await view()).open.map((d) => d.key)).toContain(words.key);
      // Kept again, and the service then changes it: it is back.
      expect((await answerDifferences(pool, deps, { act: "keep", items: [item(await one("textField", "Water Steward"))], actor: HOLDER })).status).toBe(200);
      await keepRead(roleRecs({ stewardBody: "Keeps the wells clean and safe." }));
      expect((await view()).open.map((d) => d.key)).toContain(words.key);
    });

    it("a moderator without the power only sets a decision aside: it stays in the list for the people who decide", async () => {
      const move = await one("roleMove");
      const kept = await answerDifferences(pool, deps, { act: "keep", items: [item(move)], actor: MODERATOR });
      expect([kept.status, (kept.body.done as Array<{ setAside?: boolean }>)[0].setAside]).toEqual([200, true]);
      const v = await view();
      expect(v.open.map((d) => d.key)).toContain(move.key);
      expect(Array.from(v.setAside)).toEqual([move.key]);
      // A holder's keep of the same one settles it.
      expect((await answerDifferences(pool, deps, { act: "keep", items: [item(move)], actor: HOLDER })).status).toBe(200);
      expect((await view()).open.map((d) => d.key)).not.toContain(move.key);
    });
  });

  describe("in a draft is a state (R13)", () => {
    it("withdrawing the draft opens it again, publishing settles it, and a live take is not undone from the list", async () => {
      const move = await one("roleMove");
      const first = await answerDifferences(pool, deps, { act: "take", items: [item(move)], actor: HOLDER });
      expect((await withdrawDraft(pool, String(first.body.draftId))).ok).toBe(true);
      expect((await view()).open.map((d) => d.key)).toContain(move.key);
      const second = await answerDifferences(pool, deps, { act: "take", items: [item(move)], actor: HOLDER });
      expect(second.status).toBe(200);
      expect(second.body.draftId, "a new draft, the old one is withdrawn").not.toBe(first.body.draftId);
      expect((await publishDraft(pool, String(second.body.draftId), "u-ana")).ok).toBe(true);
      forgetCachedDifferences();
      expect((await readDifferences(pool)).list.map((d) => d.key)).not.toContain(move.key);
      const undo = await undoAnswers(pool, deps, { keys: [move.key], actor: HOLDER });
      expect([undo.status, undo.body.why]).toEqual([409, "live"]);
    });
  });

  describe("bulk (R2, R30)", () => {
    it("takes what may be taken together, and names a Check first row it leaves out", async () => {
      const words = await one("textField", "Water Steward");
      const move = await one("roleMove");
      const well = await one("roleAdd", "Well Monitor");
      const r = await answerDifferences(pool, deps, { act: "take", items: [item(words), item(move), item(well)], actor: HOLDER });
      expect(r.status).toBe(200);
      expect((r.body.done as Array<{ key: string }>).map((d) => d.key)).toEqual([words.key, move.key]);
      expect((r.body.refused as Array<{ key: string; why: string }>).map((x) => [x.key, x.why])).toEqual([[well.key, "checkFirst"]]);
      expect(await changesIn(String(r.body.draftId))).toHaveLength(2);
      // Taken on its own, the same row goes in.
      expect((await answerDifferences(pool, deps, { act: "take", items: [item(well)], actor: HOLDER })).status).toBe(200);
    });
  });

  describe("a new circle carries its roles (R31)", () => {
    it("its new role alone waits for it; taking the circle makes both, and undoing the circle takes both out", async () => {
      const seed = await one("roleAdd", "Seed Keeper");
      const alone = await answerDifferences(pool, deps, { act: "take", items: [item(seed)], actor: HOLDER });
      expect([alone.status, alone.body.why]).toEqual([409, "circleFirst"]);
      const circle = await one("circleAdd", "Land Stewardship");
      const r = await answerDifferences(pool, deps, { act: "take", items: [item(circle)], actor: HOLDER });
      expect(r.status).toBe(200);
      const draftId = String(r.body.draftId);
      expect(await changesIn(draftId)).toEqual([
        { op: "create_circle", orgRoleId: "circle:land-stewardship", payload: { name: "Land Stewardship", purpose: null, parentCircleId: null } },
        { op: "create_seat", orgRoleId: roleId(P.seed), payload: { name: "Seed Keeper", aim: "Keeps the seed bank.", circleId: "land-stewardship" } },
      ]);
      const v = await view();
      expect(v.inDraft.map((g) => [g.items.map((d) => d.key), g.with.map((d) => d.key)])).toEqual([[[circle.key], [seed.key]]]);
      const undo = await undoAnswers(pool, deps, { keys: [circle.key], actor: HOLDER });
      expect(undo.body.undone).toEqual([circle.key, seed.key]);
      expect(await changesIn(draftId)).toEqual([]);
      expect((await q("SELECT status FROM org_drafts WHERE id = ?", [draftId]))[0].status, "a draft left empty is withdrawn").toBe("withdrawn");
      expect((await view()).open.map((d) => d.key)).toEqual(expect.arrayContaining([circle.key, seed.key]));
    });
  });


  describe("an edit's words are a person's (R9, review 1)", () => {
    it("refuses words that name a member here, inside the transaction, and writes nothing", async () => {
      await usersRepo(pool).add({ id: "u-wren", name: "Wren Halloway", email: "wren@example.test", passwordHash: "x", paths: [] });
      const words = await one("textField", "Water Steward");
      const r = await answerDifferences(pool, deps, { act: "edit", items: [{ ...item(words), value: "Wren Halloway keeps the wells." }], actor: HOLDER });
      expect([r.status, r.body.why]).toEqual([400, "editNamesAMember"]);
      expect(await q("SELECT COUNT(*) AS n FROM org_draft_changes WHERE draft_id <> 'd-first'")).toEqual([{ n: 0 }]);
      expect((await answerDifferences(pool, deps, { act: "edit", items: [{ ...item(words), value: "Keeps the wells and the rota." }], actor: HOLDER })).status).toBe(200);
      await q("DELETE FROM users WHERE id = 'u-wren'");
    });
  });

  describe("a take never lands while its draft is publishing (review 2)", () => {
    /** A pool whose next connection pauses at the publish's first write, after the draft row is locked. */
    function pausingPool() {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let paused!: () => void;
      const reached = new Promise<void>((r) => (paused = r));
      const proxy: any = new Proxy(pool, {
        get(target: any, prop) {
          if (prop === "getConnection") {
            return async () => {
              const conn = await target.getConnection();
              const orig = conn.query.bind(conn);
              let once = false;
              conn.query = async (sql: any, ...rest: any[]) => {
                if (!once && typeof sql === "string" && sql.startsWith("UPDATE org_draft_changes SET before_json")) {
                  once = true;
                  paused();
                  await gate;
                }
                return orig(sql, ...rest);
              };
              return conn;
            };
          }
          const v = target[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
      return { proxy, reached, release };
    }

    it("waits for the publish, then goes into a new draft; the published one holds only what it applied", async () => {
      const move = await one("roleMove");
      const first = await answerDifferences(pool, deps, { act: "take", items: [item(move)], actor: HOLDER });
      const draftId = String(first.body.draftId);
      const { proxy, reached, release } = pausingPool();
      const publishing = publishDraft(proxy, draftId, "u-ana");
      await reached;
      const words = await one("textField", "Water Steward");
      let settledEarly = false;
      const taking = answerDifferences(pool, deps, { act: "take", items: [item(words)], actor: HOLDER }).then((r) => {
        settledEarly = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(settledEarly, "the take waits on the draft row the publish holds").toBe(false);
      release();
      expect((await publishing).ok).toBe(true);
      const took = await taking;
      expect(took.status).toBe(200);
      expect(took.body.draftId).not.toBe(draftId);
      expect(await changesIn(draftId)).toEqual([{ op: "update_seat", orgRoleId: roleId(P.pump), payload: { circleId: "land" } }]);
      expect((await q("SELECT status FROM org_drafts WHERE id = ?", [took.body.draftId]))[0].status).toBe("open");
    });

    it("an undo waits too, then finds the take live and says so", async () => {
      const move = await one("roleMove");
      const first = await answerDifferences(pool, deps, { act: "take", items: [item(move)], actor: HOLDER });
      const { proxy, reached, release } = pausingPool();
      const publishing = publishDraft(proxy, String(first.body.draftId), "u-ana");
      await reached;
      const undoing = undoAnswers(pool, deps, { keys: [move.key], actor: HOLDER });
      await new Promise((r) => setTimeout(r, 400));
      release();
      expect((await publishing).ok).toBe(true);
      const u = await undoing;
      expect([u.status, u.body.why]).toEqual([409, "live"]);
      expect((await q("SELECT circle_id FROM org_roles WHERE id = ?", [roleId(P.pump)]))[0].circle_id).toBe("land");
    });

    it("a publish shown a set of changes refuses a draft that holds another (review 12)", async () => {
      const move = await one("roleMove");
      const first = await answerDifferences(pool, deps, { act: "take", items: [item(move)], actor: HOLDER });
      const draftId = String(first.body.draftId);
      const shown = (await q("SELECT id FROM org_draft_changes WHERE draft_id = ?", [draftId])).map((r) => String(r.id));
      expect((await answerDifferences(pool, deps, { act: "take", items: [item(await one("textField", "Water Steward"))], actor: HOLDER })).body.draftId).toBe(draftId);
      expect(await publishDraft(pool, draftId, "u-ana", null, null, shown)).toEqual({ ok: false, error: DRAFT_CHANGED_SINCE_SHOWN });
      const now = (await q("SELECT id FROM org_draft_changes WHERE draft_id = ?", [draftId])).map((r) => String(r.id));
      expect((await publishDraft(pool, draftId, "u-ana", null, null, now)).ok).toBe(true);
    });
  });

  describe("a take outlives its difference only as changed (R13, review 3)", () => {
    it("shows a take whose difference went, counts the draft's real changes, and never adds to that draft", async () => {
      const dish = await one("roleRest", "Dish Rota");
      const first = await answerDifferences(pool, deps, { act: "take", items: [item(dish)], actor: HOLDER });
      const draftId = String(first.body.draftId);
      // The service brings Dish Rota back: nothing differs any more, and the retirement still sits in the draft.
      await keepRead(roleRecs({ dishStatus: "Active" }));
      let read = await readDifferences(pool);
      const shown = listAnswer(read, { agent: AGENT, dashboard: null, timeZone: "UTC" }).inDraft;
      expect(shown.map((g) => [g.draftId, g.changes, g.hasChanged, g.items.map((i) => [i.sentence, i.changed, i.now])])).toEqual([
        [draftId, 1, true, [["Retiring Dish Rota.", true, null]]],
      ]);
      expect(countAnswer(read).drafts.map((d) => [d.id, d.changes, d.hasChanged])).toEqual([[draftId, 1, true]]);
      // A new take goes to a new draft, never into the one holding a change that moved.
      const second = await answerDifferences(pool, deps, { act: "take", items: [item(await one("roleMove"))], actor: HOLDER });
      expect(second.body.draftId).not.toBe(draftId);
      read = await readDifferences(pool);
      expect(countAnswer(read).drafts.map((d) => d.hasChanged).sort()).toEqual([false, true]);
    });

    it("a take whose service value moved is taken again in its own draft, with the new words in place of the old", async () => {
      const words = await one("textField", "Water Steward");
      const first = await answerDifferences(pool, deps, { act: "take", items: [item(words)], actor: HOLDER });
      const draftId = String(first.body.draftId);
      await keepRead(roleRecs({ stewardBody: "Keeps the wells clean and safe." }));
      const read = await readDifferences(pool);
      const item0 = listAnswer(read, { agent: AGENT, dashboard: null, timeZone: "UTC" }).inDraft[0].items[0];
      expect([item0.changed, item0.value]).toEqual([true, "Keeps the wells clean."]);
      expect((await answerDifferences(pool, deps, { act: "keep", items: [item0.now!], actor: HOLDER })).body.why).toBe("inDraft");
      const again = await answerDifferences(pool, deps, { act: "take", items: [item0.now!], actor: HOLDER });
      expect([again.status, again.body.draftId]).toEqual([200, draftId]);
      expect(await changesIn(draftId)).toEqual([{ op: "update_seat", orgRoleId: roleId(P.steward), payload: { aim: "Keeps the wells clean and safe." } }]);
      expect(listAnswer(await readDifferences(pool), { agent: AGENT, dashboard: null, timeZone: "UTC" }).inDraft[0].hasChanged).toBe(false);
    });
  });

  describe("a new circle and the roles it carries (R31, review 4, 5)", () => {
    it("undoing the circle takes out every role the draft places in it, and refuses, naming it, a role it cannot", async () => {
      await keepRead(roleRecs({ hoe: true }));
      const circle = await one("circleAdd", "Land Stewardship");
      const r = await answerDifferences(pool, deps, { act: "take", items: [item(circle)], actor: HOLDER });
      const draftId = String(r.body.draftId);
      // One of its roles undone, then taken on its own: it goes into the draft's circle with no tie to the circle's take.
      const hoe = await one("roleAdd", "Hoe Keeper");
      expect((await undoAnswers(pool, deps, { keys: [hoe.key], actor: HOLDER })).status).toBe(200);
      expect((await answerDifferences(pool, deps, { act: "take", items: [item(await one("roleAdd", "Hoe Keeper"))], actor: HOLDER })).status).toBe(200);
      // A role somebody placed in the circle by hand, with no answer behind it.
      expect((await addChange(pool, draftId, { op: "create_seat", orgRoleId: "by-hand", payload: { name: "Fence Mender", circleId: "land-stewardship" } })).ok).toBe(true);
      const refused = await undoAnswers(pool, deps, { keys: [circle.key], actor: HOLDER });
      expect([refused.status, refused.body.why, refused.body.error]).toEqual([409, "circleHasRoles", "Roles are placed in this new circle. Undo them first. Fence Mender."]);
      await q("DELETE FROM org_draft_changes WHERE org_role_id = 'by-hand'");
      const undo = await undoAnswers(pool, deps, { keys: [circle.key], actor: HOLDER });
      expect(undo.status).toBe(200);
      expect((undo.body.undone as string[]).sort()).toEqual([circle.key, hoe.key, (await one("roleAdd", "Seed Keeper")).key].sort());
      expect(await changesIn(draftId)).toEqual([]);
      expect((await q("SELECT status FROM org_drafts WHERE id = ?", [draftId]))[0].status).toBe("withdrawn");
    });

    it("taking the circle leaves a kept role of it alone, keeps the keep, and names it", async () => {
      const seedRole = await one("roleAdd", "Seed Keeper");
      expect((await answerDifferences(pool, deps, { act: "keep", items: [item(seedRole)], actor: HOLDER })).status).toBe(200);
      const r = await answerDifferences(pool, deps, { act: "take", items: [item(await one("circleAdd", "Land Stewardship"))], actor: HOLDER });
      expect((r.body.refused as Array<{ key: string; why: string }>).map((x) => [x.key, x.why])).toEqual([[seedRole.key, "answered"]]);
      expect((await changesIn(String(r.body.draftId))).map((c) => c.op)).toEqual(["create_circle"]);
      expect(await q("SELECT answer, came_with FROM saberra_settled WHERE difference_key = ?", [seedRole.key])).toEqual([{ answer: "kept", came_with: null }]);
    });
  });

  describe("what a take writes and what it leaves behind (review 6, 7, 9, 13)", () => {
    it("writes the service's words as stored, line breaks and all", async () => {
      const stored = "Keeps the wells clean.\n\n- daily check\n- weekly report";
      await keepRead(roleRecs({ stewardBody: stored }));
      const r = await answerDifferences(pool, deps, { act: "take", items: [item(await one("textField", "Water Steward"))], actor: HOLDER });
      expect((await changesIn(String(r.body.draftId)))[0].payload).toEqual({ aim: stored });
    });

    it("a keep lapses once its difference leaves the list, so the same value coming back is a suggestion again", async () => {
      const words = await one("textField", "Water Steward");
      expect((await answerDifferences(pool, deps, { act: "keep", items: [item(words)], actor: HOLDER })).status).toBe(200);
      // The service comes round to ours: nothing differs, and the read is checked against the answers.
      await keepRead(roleRecs({ stewardBody: "Keeps the wells." }));
      expect(await lapseLeftAnswers(pool, () => readDifferences(pool))).toBe(1);
      // Then goes back to the words that were kept.
      await keepRead(roleRecs({ stewardBody: "Keeps the wells clean." }));
      expect((await view()).open.map((d) => d.key)).toContain(words.key);
    });

    it("an undo unties the link its answer made, and records the undoer's own door", async () => {
      const move = await one("roleMove");
      expect((await answerDifferences(pool, deps, { act: "keep", items: [item(move)], actor: HOLDER })).status).toBe(200);
      expect(await q("SELECT page_key FROM saberra_links")).toEqual([{ page_key: P.pump }]);
      expect((await undoAnswers(pool, deps, { keys: [move.key], actor: MODERATOR })).status).toBe(200);
      expect(await q("SELECT page_key FROM saberra_links")).toEqual([]);
      expect(await q("SELECT answer, door, actor_user_id, by_role_id FROM saberra_settled WHERE difference_key = ?", [move.key])).toEqual([
        { answer: "undone", door: "moderator", actor_user_id: "u-mo", by_role_id: null },
      ]);
    });

    it("an edit makes its draft a person's draft and the card shows whose words they are (review 11)", async () => {
      const words = await one("textField", "Water Steward");
      const r = await answerDifferences(pool, deps, { act: "edit", items: [{ ...item(words), value: "Keeps the wells and the rota." }], actor: HOLDER });
      const draftId = String(r.body.draftId);
      expect((await q("SELECT title, source_kind FROM org_drafts WHERE id = ?", [draftId]))[0]).toEqual({
        title: "Changes from Sera's list, some in words written here", source_kind: "human",
      });
      const read = await readDifferences(pool);
      const mine = listAnswer(read, { agent: AGENT, dashboard: null, timeZone: "UTC", viewerId: "u-ana", roleName: () => "Ops lead" }).inDraft[0].items[0];
      expect([mine.answer, mine.value, mine.by]).toEqual(["edited", "Keeps the wells and the rota.", "you"]);
      const theirs = listAnswer(read, { agent: AGENT, dashboard: null, timeZone: "UTC", viewerId: "u-other", roleName: () => "Ops lead" }).inDraft[0].items[0];
      expect(theirs.by).toBe("Ops lead");
    });

    it("never answers with the text of an error it did not expect (review 19)", async () => {
      const broken = { ...deps, read: async () => { throw Object.assign(new Error("Table 'secret_internal' is marked as crashed"), { code: "ER_CRASHED_ON_USAGE" }); } };
      const r = await answerDifferences(pool, broken, { act: "keep", items: [item(await one("roleMove"))], actor: HOLDER });
      expect(r.body).toEqual({ error: "The answer could not be written. Nothing changed.", why: "failed" });
    });
  });

  describe("retiring the old deliveries (R28)", () => {
    const land = (batchId: string, sourceRef: string, seats: Array<{ id: string; name: string }>, moduleId = "saberra") =>
      landProposal(pool, {
        villageId: "village-1", moduleId, batchId, kind: "org.proposed",
        payload: { title: "Structure", rationale: "From the service.", seats }, sourceRef, trustTier: "extracted_unreviewed", rebatchWaiting: true,
      });
    const statusOf = async (batchId: string) => (await q("SELECT status, retired_reason FROM external_proposals WHERE batch_id = ? ORDER BY id", [batchId]));

    it("retires a delivery the newest read holds whole, keeps the landing's own, one in review and other modules', and never brings one back", async () => {
      const seats = [{ id: P.steward, name: "Water Steward" }, { id: P.pump, name: "Pump Keeper" }];
      expect((await land("sync-old", "structure-old", seats)).ok).toBe(true);
      expect((await land("sync-busy", "structure-busy-a", seats)).ok).toBe(true);
      const accepted = await land("sync-busy", "structure-busy-b", [{ id: P.dish, name: "Dish Rota" }]);
      const open = await createDraft(pool, { title: "Open", createdBy: "u-steward", sourceKind: "agent", sourceModuleId: "saberra", openCap: null });
      if (!accepted.ok || !open.ok) throw new Error("fixture");
      await markProposalDecided(pool, { id: accepted.id, status: "accepted", decidedBy: "u-steward", createdRef: open.id });
      expect((await land("sync-recent", "structure-recent-a", seats)).ok).toBe(true);
      const rejected = await land("sync-recent", "structure-recent-b", [{ id: P.dish, name: "Dish Rota" }]);
      if (!rejected.ok) throw new Error("fixture");
      await markProposalDecided(pool, { id: rejected.id, status: "rejected", decidedBy: "u-steward" });
      expect((await land("sync-mine", "structure-mine", seats)).ok).toBe(true);
      expect((await land("other-batch", "structure-other", seats, "other-service")).ok).toBe(true);
      // The read is kept after the landings, as the sync keeps it.
      await keepRead(roleRecs(), new Date(Date.now() + 60_000));

      // Looking at the list retires nothing.
      await readDifferences(pool);
      expect((await statusOf("sync-old"))[0].status).toBe("proposed");

      const retired = await retireReplacedBatches(pool, "sync-mine");
      expect(retired).toEqual(["sync-old"]);
      expect(await statusOf("sync-old")).toEqual([{ status: "superseded", retired_reason: RETIRED_REASON }]);
      expect((await statusOf("sync-busy")).map((r) => r.status).sort()).toEqual(["accepted", "proposed"]);
      expect((await statusOf("sync-recent")).map((r) => r.status).sort()).toEqual(["proposed", "rejected"]);
      expect(await statusOf("sync-mine")).toEqual([{ status: "proposed", retired_reason: null }]);
      expect(await statusOf("other-batch")).toEqual([{ status: "proposed", retired_reason: null }]);

      // The same claim sent again is never brought back.
      const again = await land("sync-again", "structure-old", seats);
      expect(again.ok && again.outcome).toBe("duplicate");
      expect(await statusOf("sync-old")).toEqual([{ status: "superseded", retired_reason: RETIRED_REASON }]);
      expect(await statusOf("sync-again")).toEqual([]);
    });
  });
});

describe.skipIf(!configured)("an edit at accept (T14a)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("marks a change of capitals alone as an edit, never an unchanged payload sent back, and leaves the edited one out of the base", async () => {
    await wipe();
    await q("INSERT INTO circles (id, name, status, sort_order) VALUES ('water', 'Water', 'active', 1)");
    const seatsOf = (aim: string) => ({ title: "Structure", rationale: "From the service.", seats: [{ id: P.keeper, name: "Gate Keeper", circleName: "Water", aim }] });
    const sentAim = "keeps the gate.";
    const stewardsAim = "Keeps the gate.";
    const capitals = await landProposal(pool, {
      villageId: "village-1", moduleId: "saberra", batchId: "sync-k", kind: "org.proposed", payload: seatsOf(sentAim), sourceRef: "structure-k", trustTier: "extracted_unreviewed",
    });
    const same = await landProposal(pool, {
      villageId: "village-1", moduleId: "saberra", batchId: "sync-s", kind: "org.proposed", payload: seatsOf("keeps the lane."), sourceRef: "structure-s", trustTier: "extracted_unreviewed",
    });
    if (!capitals.ok || !same.ok) throw new Error("fixture");
    await q("INSERT INTO org_drafts (id, title, status, source_kind, source_module_id, published_at) VALUES ('d-k', 'Structure', 'published', 'agent', 'saberra', ?)", [new Date(Date.now() - 86_400_000)]);
    await q("INSERT INTO org_draft_changes (id, draft_id, op, org_role_id, payload, sort_order) VALUES ('d-k-1', 'd-k', 'create_seat', ?, ?, 1)", [
      roleId(P.keeper), JSON.stringify({ name: "Gate Keeper", circleId: "water", aim: stewardsAim }),
    ]);
    await q("INSERT INTO org_roles (id, circle_id, name, seats, active, aim) VALUES (?, 'water', 'Gate Keeper', 1, 1, ?)", [roleId(P.keeper), stewardsAim]);
    await markProposalDecided(pool, { id: capitals.id, status: "accepted", decidedBy: "u-steward", createdRef: "d-k", editedPayload: seatsOf(stewardsAim) });
    // The other one sent back exactly as it was stored: no edit.
    await markProposalDecided(pool, { id: same.id, status: "accepted", decidedBy: "u-steward", createdRef: "d-other", editedPayload: seatsOf("keeps the lane.") });
    expect(await q("SELECT id, edited_at_accept IS NOT NULL AS edited FROM external_proposals ORDER BY batch_id")).toEqual([
      { id: capitals.id, edited: 1 },
      { id: same.id, edited: 0 },
    ]);

    const traced = await acceptedForDifferences(pool);
    expect(traced.map((c) => [c.orgRoleId, c.from])).toEqual([[roleId(P.keeper), null]]);

    // The service then changes its words for real: the base is unknown, so it is checked first and never bulk-taken.
    await insertSnapshot(pool, new Date(), {
      trigger: "by-hand",
      circles: { read: "whole", records: [{ id: P.water, fields: { "Circle Name": "Water", Status: "Active" } }] },
      roles: { read: "whole", records: [{ id: P.keeper, fields: { "Role Name": "Gate Keeper", Circle: [{ id: P.water }], Body: "keeps the gate and the lane.", Status: "Active" } }] },
    });
    forgetCachedDifferences();
    const words = (await readDifferences(pool)).list.find((d) => d.kind === "textField" && d.field === "aim");
    expect(words?.flags.map((f) => f.key)).toContain("baseUnknown");
    expect(words?.bulkEligible).toBe(false);
  });
});

/**
 * THE MEMBER'S DOOR TO A VOTE (R38, constitution 0.3). The list is the review
 * queue's, so a member never reads it; when nobody holds the power to decide,
 * the count tells them a draft from the list is open, and the existing
 * put-to-village door on that draft is theirs to knock on.
 */
describe.skipIf(!configured)("a member puts the list's draft to the village", () => {
  let server: http.Server;
  let base = "";
  const USERS: Record<string, { id: string; role: string }> = { "u-mem": { id: "u-mem", role: "member" }, "u-ana": { id: "u-ana", role: "member" } };
  const userOf = async (req: any) => USERS[String(req.headers["x-user"] ?? "")] ?? null;
  /** Who holds org.decide by the gate's live count (a badge counts there), and who holds it through a role. */
  let liveNow: string[] = [];
  let roleHoldersNow: Array<{ roleId: string; userId: string }> = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    const app = express();
    app.use(express.json());
    const guard = async (req: any, res: any) => {
      if (await userOf(req)) return true;
      res.status(401).json({ error: "auth_required" });
      return false;
    };
    registerSaberra(app, {
      guardCapability: guard as never,
      getPool: () => pool,
      authedUser: userOf as never,
      mayStillSee: (async (req: any) => String(req.headers["x-user"]) === "u-ana") as never,
      members: { all: async () => [{ id: "u-mem", name: "Mem Ber" }, { id: "u-ana", name: "Ana Moss" }] } as never,
      deciders: {
        roles: () => [{ id: "ops-lead", name: "Ops lead", capabilities: ["org.decide"] }],
        roleHolders: () => roleHoldersNow,
        orgRoles: async () => [],
        villageHolder: async () => null,
      },
      liveHoldersOf: async () => liveNow,
      isAdmin: async () => false,
    });
    registerDecide(app, {
      authedUser: userOf,
      isAdmin: async () => false,
      guardCapability: guard,
      capabilityCtx: async () => ({ stageIndex: 0, stageIndexOf: () => 0, roleCapabilities: [], isAdmin: false, villageHeld: [] }),
      getPool: () => pool,
      overLimit: async () => false,
      notify: async () => ({}),
      seasonState: () => ({ current: { id: "s1" }, seasons: [], timezone: "UTC" }),
      circlesRepo: { load: async () => undefined, all: () => [] },
      liveHoldersOf: async () => liveNow,
      ballotSetup: async () => ({
        method: "majority", dials: { unityPct: 50, quorumPct: 0 }, snapshot: { mode: "equal", token: null }, tokenProblem: null,
        electorate: Object.keys(USERS).map((userId) => ({ userId, weight: 1 })), durationDays: 7,
      }),
      notifyRoll: async () => 0,
      governanceOn: () => true,
      closers: {},
    } as never);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await seed();
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await pool?.end();
    await db?.drop();
  });

  const call = async (method: string, route: string, user: string, body?: unknown) => {
    const r = await fetch(base + route, { method, headers: { "Content-Type": "application/json", "x-user": user }, body: body === undefined ? undefined : JSON.stringify(body) }); // module-review-ok: this suite's own loopback server
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  it("counts a power held through a badge as no power: such a keep is set aside, and a keep through a role settles (K13, review 14)", async () => {
    await seed();
    liveNow = ["u-ana"];
    roleHoldersNow = [];
    const list = await call("GET", "/api/saberra/differences", "u-ana");
    const move = (list.json.differences as Difference[]).find((d) => d.kind === "roleMove")!;
    const kept = await call("POST", "/api/saberra/differences/answer", "u-ana", { act: "keep", items: [item(move)] });
    expect([kept.status, kept.json.done[0].setAside]).toEqual([200, true]);
    expect((await q("SELECT door, by_role_id FROM saberra_settled WHERE difference_key = ?", [move.key]))[0]).toEqual({ door: "moderator", by_role_id: null });
    roleHoldersNow = [{ roleId: "ops-lead", userId: "u-ana" }];
    const again = await call("POST", "/api/saberra/differences/answer", "u-ana", { act: "keep", items: [item(move)] });
    expect([again.status, again.json.done[0].setAside]).toEqual([200, false]);
    expect((await q("SELECT door, by_role_id FROM saberra_settled WHERE difference_key = ?", [move.key]))[0]).toEqual({ door: "power", by_role_id: "ops-lead" });
    liveNow = [];
    roleHoldersNow = [];
    await seed();
  });

  it("publishes through the holder's door only the changes it was shown (review 12)", async () => {
    await seed();
    const list = await call("GET", "/api/saberra/differences", "u-ana");
    const move = (list.json.differences as Difference[]).find((d) => d.kind === "roleMove")!;
    const took = await call("POST", "/api/saberra/differences/answer", "u-ana", { act: "take", items: [item(move)] });
    const shown = (await call("GET", "/api/saberra/differences", "u-ana")).json.inDraft[0].changeIds as string[];
    liveNow = ["u-ana"];
    const stale = await call("POST", `/api/org/drafts/${took.json.draftId}/publish-by-power`, "u-ana", { expectedChanges: ["not-a-change"] });
    expect([stale.status, stale.json.error]).toEqual([409, DRAFT_CHANGED_SINCE_SHOWN]);
    const ok = await call("POST", `/api/org/drafts/${took.json.draftId}/publish-by-power`, "u-ana", { expectedChanges: shown });
    expect(ok.status).toBe(200);
    liveNow = [];
    await seed();
  });

  it("sees the draft the decision made on the count, by id and size only, and opens the vote through the existing door", async () => {
    const before = await call("GET", "/api/saberra/differences/count", "u-mem");
    expect(before.json.drafts).toEqual([]);
    // A reader of the list takes a decision: it becomes a draft, and nobody holds the power to publish it.
    const list = await call("GET", "/api/saberra/differences", "u-ana");
    const move = (list.json.differences as Difference[]).find((d) => d.kind === "roleMove")!;
    const took = await call("POST", "/api/saberra/differences/answer", "u-ana", { act: "take", items: [item(move)] });
    expect(took.status).toBe(200);
    // The door it came through is the moderator's: nobody holds the power, so nothing claims it.
    expect((await q("SELECT door FROM saberra_settled WHERE difference_key = ?", [move.key]))[0].door).toBe("moderator");

    const count = await call("GET", "/api/saberra/differences/count", "u-mem");
    expect(count.json.drafts).toMatchObject([{ id: took.json.draftId, changes: 1, hasChanged: false }]);
    expect(JSON.stringify(count.json)).not.toContain("Pump Keeper");
    const decide = await call("GET", `/api/org/drafts/${took.json.draftId}/decide`, "u-mem");
    expect([decide.json.ballotNeeded, decide.json.youMayPutToVillage]).toEqual([true, true]);
    const put = await call("POST", `/api/org/drafts/${took.json.draftId}/put-to-village`, "u-mem");
    expect(put.status).toBe(200);
    expect(await ballotById(pool, put.json.ballot.id)).toMatchObject({ subjectType: "org_draft", subjectRef: took.json.draftId, openedBy: "u-mem", status: "open" });
    // Under the vote the draft is frozen: its answer cannot be undone from the list, and a new take goes elsewhere (review 18).
    const undo = await call("POST", "/api/saberra/differences/undo", "u-ana", { keys: [move.key] });
    expect([undo.status, undo.json.why]).toEqual([409, "underVote"]);
    const words = (list.json.differences as Difference[]).find((d) => d.kind === "textField" && d.subject.name === "Water Steward")!;
    const next = await call("POST", "/api/saberra/differences/answer", "u-ana", { act: "take", items: [item(words)] });
    expect(next.status).toBe(200);
    expect(next.json.draftId).not.toBe(took.json.draftId);
    expect(await q("SELECT COUNT(*) AS n FROM org_draft_changes WHERE draft_id = ?", [took.json.draftId])).toEqual([{ n: 1 }]);
  });
});
