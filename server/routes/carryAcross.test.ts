/**
 * CARRY PEOPLE ACROSS, over real HTTP against a real database, in the shape a
 * reset takes: an old chart with people in it, a structure change from the
 * review published beside it (one live seat moved into it, new seats made),
 * and then each person moved, one confirmed action at a time.
 *
 * Asserted on the database and not only on the response:
 *   - the list reads who still sits on the old chart, with suggestions;
 *   - a move without `org.seat` is refused and changes nothing, and a member
 *     without it reads the list and is told who holds the power;
 *   - a move seats the person in the new seat with the season's term and ends
 *     the old seating, in ONE transaction: when the end fails, the new seat
 *     was never taken;
 *   - asked again, a move is the same result and never a second seating;
 *   - retiring writes one draft that skips every seat somebody holds, asked
 *     again it is the same draft, and published it rests the empty old chart
 *     bottom up and nobody is unseated.
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { landProposal, markProposalDecided } from "../lib/externalProposals";
import { seatHolder } from "../lib/orgChart";
import { addChange, createDraft, publishDraft } from "../lib/orgDrafts";
import { register } from "./structureReview";

const control = vi.hoisted(() => ({ failEnd: false }));
vi.mock("../lib/orgChart", async (orig) => {
  const real = await orig<typeof import("../lib/orgChart")>();
  return {
    ...real,
    // Delegates to the real one, except when a test makes the old seating's end fail.
    endSeating: (...args: Parameters<typeof real.endSeating>) => (control.failEnd ? Promise.resolve(false) : real.endSeating(...args)),
  };
});

const configured = testDbConfigured();
const BATCH = "sync-reset";
const SEASON = { id: "s-long", name: "A long season", startsOn: "2026-01-01", endsOn: "2037-12-21" };

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let circlesCache: any[] = [];
let structureDraft = "";
const allowed = new Set<string>(["org.seat", "intake.moderate"]);
const notices: any[] = [];
const seatings: Record<string, string> = {};

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

const liveIn = async (seatId: string) => {
  const [rows] = await pool.query<any[]>("SELECT id, user_id, display_name, season_id, term_ends_at, granted_by FROM org_role_assignments WHERE org_role_id = ? AND ended_at IS NULL", [seatId]); // module-review-ok: reading back the scratch schema this suite provisioned
  return rows;
};
const seatingRow = async (id: string) => {
  const [[row]] = await pool.query<any[]>("SELECT ended_at, ended_reason FROM org_role_assignments WHERE id = ?", [id]); // module-review-ok: reading back the scratch schema this suite provisioned
  return row;
};
const seatActive = async (id: string) => {
  const [[row]] = await pool.query<any[]>("SELECT active FROM org_roles WHERE id = ?", [id]); // module-review-ok: reading back the scratch schema this suite provisioned
  return !!row?.active;
};
const circleStatus = async (id: string) => {
  const [[row]] = await pool.query<any[]>("SELECT status FROM circles WHERE id = ?", [id]); // module-review-ok: reading back the scratch schema this suite provisioned
  return String(row?.status);
};

describe.skipIf(!configured)("carrying people across to a new chart", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });

    // ── The old chart ──
    for (const [id, name, parent] of [
      ["general-circle", "General Coordinating Circle", null],
      ["finance-circle", "Finance & Business Circle", "general-circle"],
      ["community-circle", "Community Circle", "general-circle"],
      ["development-circle", "Development Circle", "general-circle"],
    ]) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO circles (id, name, parent_circle_id, is_example, status, sort_order) VALUES (?,?,?,0,'active',1)",
        [id, name, parent],
      );
    }
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO collection_versions (collection, version) VALUES ('circles', 1) ON DUPLICATE KEY UPDATE version = 1",
    );
    for (const [id, name, circle] of [
      ["finance-lead", "Finance Lead", "finance-circle"],
      ["entity-steward", "Entity and Land Trust Steward", "finance-circle"],
      ["potluck-host", "Potluck Host", "community-circle"],
      ["operations-steward", "Operations Steward", "development-circle"],
    ]) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO org_roles (id, name, circle_id, seats, accountabilities) VALUES (?,?,?,2,'[]')",
        [id, name, circle],
      );
    }
    for (const [key, seat, h] of [
      ["ana", "finance-lead", { userId: "u-ana" }],
      ["bo", "potluck-host", { displayName: "Bo Example" }],
      ["gus", "operations-steward", { displayName: "Gus Example" }],
    ] as const) {
      const r = await seatHolder(pool, seat, h);
      expect(r.ok).toBe(true);
      seatings[key] = r.assignmentId!;
    }
    await reloadCircles();

    // ── The structure change, accepted from the review and published ──
    const made = await createDraft(pool, { title: "Structure suggested by the connected service", createdBy: "steward-1" });
    if (!made.ok) throw new Error(made.error);
    structureDraft = made.id;
    for (const c of [
      { op: "create_circle" as const, orgRoleId: "circle:community-anchor", payload: { name: "Community Anchor", parentCircleId: null } },
      { op: "update_seat" as const, orgRoleId: "operations-steward", payload: { circleId: "community-anchor" } },
      { op: "create_seat" as const, orgRoleId: "rec-finance", payload: { name: "Finance Steward", circleId: "community-anchor" } },
      { op: "create_seat" as const, orgRoleId: "rec-events", payload: { name: "Events Manager", circleId: "community-anchor" } },
    ]) {
      const r = await addChange(pool, structureDraft, c);
      expect(r.ok).toBe(true);
    }
    const published = await publishDraft(pool, structureDraft, "steward-1", null, {
      seasons: [SEASON], currentSeasonId: SEASON.id, timezone: "UTC",
    });
    expect(published.ok, !published.ok ? published.error : "").toBe(true);
    const landed = await landProposal(pool, { villageId: "v1", moduleId: "saberra", batchId: BATCH, kind: "org.proposed", payload: { title: "Structure", seats: [] } });
    if (!landed.ok) throw new Error(landed.reason);
    await markProposalDecided(pool, { id: landed.id, status: "accepted", decidedBy: "steward-1", createdRef: structureDraft });
    await reloadCircles();

    const app = express();
    app.use(express.json());
    register(app, {
      isAdmin: (async () => true) as any,
      authedUser: (async () => ({ id: "steward-1" })) as any,
      adminActor: (() => null) as any,
      guardCapability: (async (_req: any, res: any, cap: string) => {
        if (allowed.has(cap)) return true;
        res.status(403).json({ error: "forbidden", capability: cap });
        return false;
      }) as any,
      mayAct: (async (_req: any, cap: string) => ({ ok: allowed.has(cap) })) as any,
      mayStillSee: (async () => true) as any,
      getPool: () => pool as any,
      members: {
        all: async () => [
          { id: "u-ana", name: "Ana Example" },
          { id: "u-rye", name: "Rye Example" },
        ],
      } as any,
      circlesRepo: { all: () => circlesCache } as any,
      seasonState: () => ({ current: SEASON, seasons: [SEASON], timezone: "UTC" }),
      notify: (async (n: any) => {
        notices.push(n);
        return { inserted: true };
      }) as any,
      firstName: (n: string) => n.split(" ")[0] ?? "",
      liveHoldersOf: async (cap: string) => (cap === "org.seat" ? ["u-rye"] : []),
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

  const MOVE = `/api/review/batches/${BATCH}/structure/carry/move`;
  const RETIRE = `/api/review/batches/${BATCH}/structure/carry/retire`;

  it("reads who still sits on the old chart, with a suggestion that is only a suggestion", async () => {
    const r = await call("GET", `/api/review/batches/${BATCH}/structure`);
    expect(r.status).toBe(200);
    const carry = r.json.carry;
    expect(carry.draftId).toBe(structureDraft);
    expect(carry.mayCarry).toBe(true);
    expect(carry.rows.map((x: any) => [x.person, x.oldSeatName, x.suggestion?.seatId ?? null])).toEqual([
      ["Bo", "Potluck Host", null],
      ["Ana", "Finance Lead", "rec-finance"],
    ]);
    expect(carry.rows[1].suggestion.why).toBe("similar-name");
    // The seat the review moved kept its person.
    expect(carry.kept.map((k: any) => k.person)).toEqual(["Gus"]);
  });

  it("refuses a move without the power to seat people, changes nothing, and tells a reader who holds it", async () => {
    allowed.delete("org.seat");
    try {
      const r = await call("POST", MOVE, { seatingId: seatings.ana, toSeatId: "rec-finance" });
      expect(r.status).toBe(403);
      expect(r.json.capability).toBe("org.seat");
      expect(await liveIn("rec-finance")).toEqual([]);
      expect((await seatingRow(seatings.ana)).ended_at).toBeNull();

      const read = await call("GET", `/api/review/batches/${BATCH}/structure`);
      expect(read.json.carry.mayCarry).toBe(false);
      expect(read.json.carry.whoCarries).toEqual(["Rye"]);
    } finally {
      allowed.add("org.seat");
    }
  });

  it("refuses a seat that is not on the new chart", async () => {
    const r = await call("POST", MOVE, { seatingId: seatings.ana, toSeatId: "entity-steward" });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("That role is not part of the new chart.");
    expect(await liveIn("entity-steward")).toEqual([]);
  });

  it("is one transaction: when the old seating cannot end, the new seat was never taken", async () => {
    control.failEnd = true;
    try {
      const r = await call("POST", MOVE, { seatingId: seatings.ana, toSeatId: "rec-finance" });
      expect(r.status).toBe(409);
    } finally {
      control.failEnd = false;
    }
    expect(await liveIn("rec-finance")).toEqual([]);
    expect((await seatingRow(seatings.ana)).ended_at).toBeNull();
    expect(notices).toEqual([]);
  });

  it("moves one person: seated in the new seat with the season's term, the old seating ended and kept", async () => {
    const r = await call("POST", MOVE, { seatingId: seatings.ana, toSeatId: "rec-finance" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toEqual({ success: true, already: false });
    const now = await liveIn("rec-finance");
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ user_id: "u-ana", season_id: SEASON.id, granted_by: "steward-1" });
    expect(now[0].term_ends_at).not.toBeNull();
    const old = await seatingRow(seatings.ana);
    expect(old.ended_at).not.toBeNull();
    expect(old.ended_reason).toBe("Carried across to the new chart");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: "u-ana", type: "role_appointed", title: "You were seated as Finance Steward" });
    expect(notices[0].dedupeKey).toBe(`org-seat:${now[0].id}`);
  });

  it("asked again, it is the same result and never a second seating", async () => {
    const r = await call("POST", MOVE, { seatingId: seatings.ana, toSeatId: "rec-finance" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ success: true, already: true });
    expect(await liveIn("rec-finance")).toHaveLength(1);
    expect(notices).toHaveLength(1);
  });

  it("retires the empty old chart in one draft that skips every held seat, and publishes bottom up", async () => {
    const dry = await call("POST", RETIRE, { dryRun: true });
    expect(dry.status, JSON.stringify(dry.json)).toBe(200);
    expect(dry.json.blocked).toBe(0);
    expect(dry.json.draftId).toBeNull();
    const reads: string[] = dry.json.reads;
    expect(reads.some((l) => l.includes("Potluck Host"))).toBe(false);
    expect(reads.some((l) => l.includes("Community Circle"))).toBe(false);
    expect(reads.some((l) => l.includes("General Coordinating Circle"))).toBe(false);
    expect(reads.filter((l) => l.startsWith("Rest "))).toHaveLength(2);
    expect(reads.filter((l) => l.startsWith("Retire the circle"))).toHaveLength(2);

    const made = await call("POST", RETIRE, {});
    expect(made.status).toBe(200);
    expect(made.json.existing).toBe(false);
    const again = await call("POST", RETIRE, {});
    expect(again.json).toMatchObject({ existing: true, draftId: made.json.draftId });
    const [[count]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_drafts WHERE status = 'open'"); // module-review-ok: reading back the scratch schema this suite provisioned
    expect(Number(count.n)).toBe(1);

    const read = await call("GET", `/api/review/batches/${BATCH}/structure`);
    expect(read.json.carry.retireDraft).toMatchObject({ id: made.json.draftId, status: "open", blocked: 0 });
    expect(read.json.carry.retire.stillHeld.map((s: any) => s.id)).toEqual(["potluck-host"]);

    const published = await publishDraft(pool, made.json.draftId, "steward-1", null);
    expect(published.ok, !published.ok ? published.error : "").toBe(true);
    expect(await seatActive("finance-lead")).toBe(false);
    expect(await seatActive("entity-steward")).toBe(false);
    expect(await seatActive("potluck-host")).toBe(true);
    expect((await liveIn("potluck-host")).length).toBe(1);
    expect(await circleStatus("finance-circle")).toBe("dormant");
    expect(await circleStatus("development-circle")).toBe("dormant");
    expect(await circleStatus("community-circle")).toBe("active");
    expect(await circleStatus("general-circle")).toBe("active");

    await reloadCircles();
    const after = await call("GET", `/api/review/batches/${BATCH}/structure`);
    expect(after.json.carry.retireDraft).toMatchObject({ id: made.json.draftId, status: "published" });
    expect(after.json.carry.rows.map((x: any) => x.person)).toEqual(["Bo"]);
  });
});
