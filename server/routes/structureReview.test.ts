/**
 * THE STRUCTURE CHANGE REVIEW, over real HTTP against a real database, in the
 * shape the first vendor sync actually sent on 2026-10-09: circles under the
 * vendor's own "Circle Name" with its change log under "Notes", ONE structure
 * proposal holding every seat, and four of those seats named the same as live
 * seats ("Operations Steward" twice, "Project Manager", "Sales Lead"), beside
 * an old chart with people sitting in some of it.
 *
 * What a steward needs from it, each asserted on the database and not only on
 * the response:
 *   - an unsettled match refuses the whole accept and writes nothing;
 *   - a dry run previews the draft and writes nothing;
 *   - one accept makes ONE draft that previews with nothing blocked, splits a
 *     structure a seat was left out of (the left-out seat stays queued), turns
 *     a match into an update of the live seat that keeps its holder, adds a
 *     second match under the name the steward typed, retires only what nobody
 *     holds, and leaves untouched proposals in the queue;
 *   - the draft publishes, and the dormancy and holder rules hold at publish.
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { landProposal, reopenProposalsFor } from "../lib/externalProposals";
import { seatHolder } from "../lib/orgChart";
import { draftChangeCap, previewDraft, publishDraft, withdrawDraft } from "../lib/orgDrafts";
import { register } from "./structureReview";

const configured = testDbConfigured();
const BATCH = "sync-first-import";

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let circlesCache: any[] = [];

async function reloadCircles(): Promise<void> {
  const [rows] = await pool.query<any[]>("SELECT id, name, aliases, parent_circle_id, status, is_example FROM circles"); // module-review-ok: the suite reads back the scratch schema it provisioned, standing in for the circles cache
  circlesCache = rows.map((r) => ({
    id: r.id, name: r.name, aliases: r.aliases, parentCircleId: r.parent_circle_id, status: r.status, isExample: !!r.is_example,
  }));
}

async function call(method: string, route: string, body?: unknown) {
  const r = await fetch(base + route, { // module-review-ok: the test client dialling its own server on localhost
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const statusOf = async (id: string) => {
  const [[row]] = await pool.query<any[]>("SELECT status, payload FROM external_proposals WHERE id = ?", [id]); // module-review-ok: reading back the scratch schema this suite provisioned
  return { status: String(row?.status), payload: typeof row?.payload === "string" ? JSON.parse(row.payload) : row?.payload };
};
const waiting = async (batchId: string) => {
  const [rows] = await pool.query<any[]>("SELECT id, kind, payload FROM external_proposals WHERE batch_id = ? AND status = 'proposed'", [batchId]); // module-review-ok: reading back the scratch schema this suite provisioned
  return rows.map((r) => ({ id: String(r.id), kind: String(r.kind), payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload }));
};
const openDrafts = async () => {
  const [rows] = await pool.query<any[]>("SELECT id FROM org_drafts WHERE status = 'open'"); // module-review-ok: reading back the scratch schema this suite provisioned
  return rows.map((r) => String(r.id));
};

let structureId = "";
let riskId = "";
const circleIds: Record<string, string> = {};

async function land(kind: string, payload: Record<string, unknown>, sourceRef?: string, batchId = BATCH): Promise<string> {
  const r = await landProposal(pool, { villageId: "v1", moduleId: "saberra", batchId, kind, payload, sourceRef });
  if (!r.ok) throw new Error(`landing failed: ${r.reason}`);
  return r.id;
}

describe.skipIf(!configured)("the structure change review", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });

    // ── The old chart ──
    for (const [id, name, parent, status] of [
      ["general-circle", "General Coordinating Circle", null, "active"],
      ["development-circle", "Development Circle", "general-circle", "active"],
      ["outreach-growth-circle", "Outreach & Growth Circle", "general-circle", "active"],
      ["community-circle", "Community Circle", "general-circle", "forming"],
    ]) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO circles (id, name, parent_circle_id, is_example, status, sort_order) VALUES (?,?,?,0,?,1)",
        [id, name, parent, status],
      );
    }
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO collection_versions (collection, version) VALUES ('circles', 1) ON DUPLICATE KEY UPDATE version = 1",
    );
    for (const [id, name, circle] of [
      ["operations-steward", "Operations Steward", "general-circle"],
      ["project-manager", "Project Manager", "development-circle"],
      ["sales-lead", "Sales Lead", "outreach-growth-circle"],
      ["land-liaison", "Land Liaison", "development-circle"],
      ["potluck-host", "Potluck Host", "community-circle"],
    ]) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO org_roles (id, name, circle_id, seats, accountabilities) VALUES (?,?,?,2,'[]')",
        [id, name, circle],
      );
    }
    expect((await seatHolder(pool, "project-manager", { displayName: "Holder One" })).ok).toBe(true);
    expect((await seatHolder(pool, "land-liaison", { displayName: "Holder Two" })).ok).toBe(true);

    // ── The batch, landed the way the sync route lands it ──
    structureId = await land("org.proposed", {
      title: "Structure suggested by the connected service",
      rationale: "The connected service suggests six seats.",
      seats: [
        { name: "Operations Steward", circleName: "Community Anchor", aim: "Day to day coordination.", id: "rec-ops-anchor" },
        { name: "Operations Steward", circleName: "Regenerative Business", aim: "Runs the ventures.", id: "rec-ops-business" },
        { name: "Project Manager", circleName: "Regenerative Development", aim: "Plans and tracks the build.", id: "rec-pm" },
        { name: "Sales Lead", circleName: "Regenerative Community", aim: "Lot sales.", id: "rec-sales" },
        { name: "Events Manager", circleName: "Regenerative Community", aim: "Gatherings and open days.", id: "rec-events" },
        { name: "Development Manager", circleName: "Regenerative Development", aim: "Permits and timelines.", id: "rec-devman" },
      ],
    });
    for (const name of ["Community Anchor", "Regenerative Business", "Regenerative Development", "Regenerative Community"]) {
      circleIds[name] = await land(
        "circle.proposed",
        { "Circle Name": name, Status: "Active", Notes: "[Rewritten 2026-09-22 per Team Structure V5]", vendorRecordId: `rec-${name}` },
        `rec-${name}`,
      );
    }
    riskId = await land("risk.observed", { Risk: "Permits slip a season" }, "rec-risk");
    await reloadCircles();

    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: (async () => ({ id: "steward-1" })) as any,
      adminActor: (() => null) as any,
      guardCapability: (async () => true) as any,
      mayStillSee: (async () => true) as any,
      getPool: () => pool as any,
      members: { all: async () => [] } as any,
      circlesRepo: { all: () => circlesCache } as any,
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
    await db?.drop();
  });

  const SETTLED = () => ({
    [`${structureId}#0`]: { choice: "update" },
    [`${structureId}#1`]: { choice: "rename", name: "Ventures Operations Steward" },
    [`${structureId}#2`]: { choice: "update" },
    [`${structureId}#3`]: { choice: "update" },
  });

  it("reads the batch as a plan: four new circles, four matches, the old chart and the note", async () => {
    const r = await call("GET", `/api/review/batches/${BATCH}/structure`);
    expect(r.status).toBe(200);
    const plan = r.json.plan;
    expect(plan.circles.map((c: any) => [c.name, c.status, c.problem])).toEqual([
      ["Community Anchor", "new", null],
      ["Regenerative Business", "new", null],
      ["Regenerative Development", "new", null],
      ["Regenerative Community", "new", null],
    ]);
    expect(plan.circles.every((c: any) => c.purpose === null)).toBe(true);
    expect(plan.seats.filter((s: any) => s.match).map((s: any) => s.match.seatId)).toEqual([
      "operations-steward", "operations-steward", "project-manager", "sales-lead",
    ]);
    expect(plan.seats.find((s: any) => s.match?.seatId === "project-manager").match.holders).toBe(1);
    expect(plan.notes).toEqual([{ proposalId: riskId, kind: "risk.observed" }]);
    expect(r.json.title).toBe("Structure suggested by the connected service");
  });

  it("refuses an accept while any match is unsettled, and writes nothing", async () => {
    const conflicts = SETTLED();
    delete (conflicts as any)[`${structureId}#1`];
    const r = await call("POST", `/api/review/batches/${BATCH}/structure/accept`, { conflicts });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("One seat already exists here. Choose what happens to it.");
    expect(await openDrafts()).toEqual([]);
    expect((await statusOf(structureId)).status).toBe("proposed");
  });

  it("previews the draft as a dry run, with nothing blocked, and writes nothing", async () => {
    const r = await call("POST", `/api/review/batches/${BATCH}/structure/accept`, {
      conflicts: SETTLED(),
      retireOldChart: true,
      dryRun: true,
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.dryRun).toBe(true);
    expect(r.json.blockedLines).toEqual([]);
    expect(r.json.lines.map((l: any) => l.reads)).toContain('Retire the circle "Outreach & Growth Circle", so it rests as dormant');
    expect(await openDrafts()).toEqual([]);
  });

  it("accepts into ONE draft: splits the structure, updates live seats, renames, retires, and leaves the rest queued", async () => {
    const r = await call("POST", `/api/review/batches/${BATCH}/structure/accept`, {
      // Development Manager is left out: the structure is split and that seat stays queued.
      exclude: [`${structureId}#5`],
      conflicts: SETTLED(),
      retireOldChart: true,
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.blocked).toBe(0);
    expect(r.json.blockedLines).toEqual([]);
    expect(await openDrafts()).toEqual([r.json.draftId]);
    expect(r.json.counts).toMatchObject({ newCircles: 4, newSeats: 2, updates: 3, unsettled: 0, retiringSeats: 1, retiringCircles: 2 });

    // The circles and the kept half of the structure are accepted against the draft.
    for (const id of Object.values(circleIds)) expect((await statusOf(id)).status).toBe("accepted");
    const kept = await statusOf(structureId);
    expect(kept.status).toBe("accepted");
    expect(kept.payload.seats.map((s: any) => s.name)).toEqual([
      "Operations Steward", "Ventures Operations Steward", "Project Manager", "Sales Lead", "Events Manager",
    ]);
    // The left-out seat and the untouched note are still in the queue.
    const left = await waiting(BATCH);
    expect(left.map((p) => p.kind).sort()).toEqual(["org.proposed", "risk.observed"]);
    expect(left.find((p) => p.kind === "org.proposed")!.payload.seats.map((s: any) => s.name)).toEqual(["Development Manager"]);
    expect(left.find((p) => p.kind === "risk.observed")!.id).toBe(riskId);

    // A seating made after the accept still holds its seat: the retirement blocks rather than unseat anybody.
    expect((await seatHolder(pool, "potluck-host", { displayName: "Late Arrival" })).ok).toBe(true);
    const raced = await previewDraft(pool, r.json.draftId, draftChangeCap());
    expect(raced.lines.filter((l) => l.blocked).map((l) => [l.orgRoleId, l.blocked])).toEqual([
      ["potluck-host", "Somebody holds this seat. Give them a seat in the new chart before it is retired"],
    ]);
    await pool.query("UPDATE org_role_assignments SET ended_at = CURRENT_TIMESTAMP WHERE org_role_id = 'potluck-host'"); // module-review-ok: ending the fixture seating on the scratch schema this suite provisioned

    // And it publishes.
    const published = await publishDraft(pool, r.json.draftId, "steward-1", draftChangeCap());
    expect(published.ok, !published.ok ? published.error : "").toBe(true);
    if (published.ok) {
      expect(published.circleMoves.map((m) => [m.id, m.from, m.to]).sort()).toEqual([
        ["community-circle", "forming", "dormant"],
        ["outreach-growth-circle", "active", "dormant"],
      ]);
    }

    const [seats] = await pool.query<any[]>("SELECT id, name, circle_id, active FROM org_roles ORDER BY id"); // module-review-ok: reading back the scratch schema this suite provisioned
    const seat = (id: string) => seats.find((s) => s.id === id);
    // The live seat moved into the new circle with the new wording, and kept its holder.
    expect(seat("project-manager")).toMatchObject({ circle_id: "regenerative-development", active: 1 });
    const [[pmHolder]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_role_assignments WHERE org_role_id = 'project-manager' AND ended_at IS NULL"); // module-review-ok: reading back the scratch schema this suite provisioned
    expect(Number(pmHolder.n)).toBe(1);
    expect(seat("operations-steward")).toMatchObject({ circle_id: "community-anchor", active: 1 });
    expect(seat("sales-lead")).toMatchObject({ circle_id: "regenerative-community", active: 1 });
    // The second Operations Steward landed under the steward's own name.
    expect(seat("rec-ops-business")).toMatchObject({ name: "Ventures Operations Steward", circle_id: "regenerative-business", active: 1 });
    expect(seat("rec-events")).toMatchObject({ circle_id: "regenerative-community", active: 1 });
    // Retired: the unheld old seat. Kept: the held one, and the circles it keeps alive.
    expect(seat("potluck-host")).toMatchObject({ active: 0 });
    expect(seat("land-liaison")).toMatchObject({ active: 1, circle_id: "development-circle" });

    const [circles] = await pool.query<any[]>("SELECT id, status, purpose FROM circles ORDER BY id"); // module-review-ok: reading back the scratch schema this suite provisioned
    const status = Object.fromEntries(circles.map((c) => [c.id, c.status]));
    expect(status).toMatchObject({
      "community-anchor": "active",
      "regenerative-development": "active",
      "outreach-growth-circle": "dormant",
      "community-circle": "dormant",
      "development-circle": "active",
      "general-circle": "active",
    });
    // The vendor's change log never became a purpose.
    expect(circles.every((c) => c.purpose === null)).toBe(true);
  });

  it("a withdrawn split puts the whole structure back in the queue", async () => {
    const SPLIT = "sync-second";
    const two = await land(
      "org.proposed",
      { title: "Two seats", seats: [{ name: "Gate Keeper", circleName: "General Coordinating Circle" }, { name: "Bell Ringer", circleName: "General Coordinating Circle" }] },
      undefined,
      SPLIT,
    );
    const r = await call("POST", `/api/review/batches/${SPLIT}/structure/accept`, { exclude: [`${two}#1`] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.leftInQueue).toHaveLength(1);
    expect((await withdrawDraft(pool, r.json.draftId)).ok).toBe(true);
    expect(await reopenProposalsFor(pool, r.json.draftId)).toBe(1);
    const back = await waiting(SPLIT);
    expect(back.flatMap((p) => p.payload.seats.map((s: any) => s.name)).sort()).toEqual(["Bell Ringer", "Gate Keeper"]);
  });
});
