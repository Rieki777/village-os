/**
 * The snapshot a sync keeps of the service's circles and roles, against a real
 * schema (spec internal/spec/sera-sync, R5 to R11), and the differences the
 * list routes compute from it.
 *
 * WHAT IS PINNED, each with a control:
 *
 *   1. A read keeps circles and roles by page id, the boundary's fields only,
 *      and never the page address (R8, R10), with the edited time through the
 *      one door and never who edited (R11).
 *   2. A member's name is swapped out of the prose, and the field is named (R9).
 *   3. A kind that failed, was cut short, came back empty or was not asked
 *      carries the previous snapshot forward, and says why (R5).
 *   4. A page id that arrives twice is kept once and marked (R7).
 *   5. The newest 30 rows are kept, and no more.
 *   6. Text too long to keep whole is clipped and marked, so it is never compared (R6).
 *   7. The differences are read from what is stored, the live chart, and only
 *      this village's PUBLISHED drafts from the service (R2), and the count
 *      carries no subject (R25).
 *
 * The service is a stub; the snapshots, the users, the chart and the drafts are
 * real. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { createHash } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type mysql from "mysql2/promise";

const state = vi.hoisted(() => ({
  session: "snap-1" as string | null,
  /** Records per wire kind. */
  read: {} as Record<string, unknown[]>,
  fail: {} as Record<string, { why: string; detail: string }>,
  endless: {} as Record<string, boolean>,
  /** What `tools/list` answers: empty falls back to asking every kind the mail named. */
  tools: [] as unknown[],
}));

vi.mock("./secrets", () => ({
  secretStatus: () => ({
    key: "sera_api_secret", configured: true, source: "admin", last4: "9f2a",
    setBy: null, setAt: null, atRest: "sealed", unreadable: false,
  }),
  villageSecretsConfigured: () => true,
  villageSecretsKeyProblem: () => null,
  secretValue: () => "t0ken-SECRET-9f2a",
}));

vi.mock("./saberraClient", () => ({
  openSession: async () => state.session,
  listTools: async () => ({ ok: true, tools: state.tools }),
  callTool: async (_c: unknown, _s: string, _t: string, args: Record<string, unknown>) => {
    const wire = String(args.kind ?? args.record_type);
    const failure = state.fail[wire];
    if (failure) return { ok: false, ...failure };
    return { ok: true, records: state.read[wire] ?? [], cursor: state.endless[wire] ? "more" : null };
  },
}));

vi.mock("./modules", () => ({
  moduleConfig: () => ({ apiUrl: "https://service.example.test/mcp", dashboardUrl: "https://dash.example.test" }),
  effectiveLifecycle: () => "preview",
}));

vi.mock("./identity", () => ({ instanceIdentity: () => ({ instanceId: "village-1", bornAt: "" }) }));

import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { seatIdFor } from "../../shared/structurePlan";
import type { Snapshot } from "../../shared/seraDifferences";
import { syncByHand } from "./saberraSync";
import { SNAPSHOT_KEEP, TEXT_KEEP, writeSnapshot } from "./saberraSnapshot";
import { countAnswer, readDifferences } from "./seraDifferencesRead";
import { recentSnapshots } from "../repos/saberraSnapshots";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const pageId = (tag: string) => createHash("sha256").update(tag).digest("hex").slice(0, 32);

/** The service's read for one test: a circle, a role naming it, and an assignment. */
function serviceHolds(tag: string, over: { roleName?: string; body?: string } = {}) {
  const land = pageId(`${tag}-land`);
  const water = pageId(`${tag}-water`);
  state.read = {
    circle: [
      {
        id: land,
        url: `https://www.notion.so/${tag}-Land-${land}`,
        fields: { "Circle Name": `${tag} Land`, Status: "Active", Notes: "Jane Example keeps this circle." },
      },
    ],
    role: [
      {
        id: water,
        url: `https://www.notion.so/${tag}-Water-Steward-${water}`,
        last_edited_time: "2026-10-29T15:00:00.000Z",
        last_edited_by: { name: "Jane Example", id: "person-1" },
        fields: {
          "Role Name": over.roleName ?? `${tag} Water Steward`,
          Circle: [land],
          Body: over.body ?? "Jane Example holds the water.",
          Status: "Active",
          "Active Holders": ["person-1"],
        },
      },
    ],
    role_assignment: [{ id: pageId(`${tag}-seat`), fields: { Role: [water], "Energization Level": "Partial" } }],
  };
  return { land, water };
}

const newest = async (): Promise<Snapshot> => (await recentSnapshots(pool, 1))[0]!.snapshot;

describe.skipIf(!configured)("the snapshot a sync keeps", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    // A member whose name the swap must know.
    await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ('u-jane', 'Jane Example', 'jane@example.org', 'x')"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    state.session = "snap-1";
    state.read = {};
    state.fail = {};
    state.endless = {};
    state.tools = [];
    await pool.query("DELETE FROM saberra_snapshots WHERE seq > 0"); // module-review-ok: fixture SQL, each test starts from no snapshot
  });

  it("KEEPS THE CIRCLES AND ROLES OF A READ BY PAGE ID, the boundary's fields only, and NEVER THE ADDRESS", async () => {
    const { land, water } = serviceHolds("keep");
    // The control on the fixture: the read DID carry an address, a holder, who edited, and an assignment.
    const sent = JSON.stringify(state.read);
    for (const s of ["notion.so", "Active Holders", "last_edited_by", "Energization Level"]) expect(sent).toContain(s);

    expect((await syncByHand(pool)).status).toBe(200);
    const s = await newest();
    expect(s.trigger).toBe("by-hand");
    expect(s.circles.read).toBe("whole");
    expect(s.roles.read).toBe("whole");
    expect(s.circles.records.map((r) => r.id)).toEqual([land]);
    expect(s.roles.records.map((r) => r.id)).toEqual([water]);
    expect(s.roles.records[0]).toMatchObject({
      fields: { "Role Name": "keep Water Steward", Circle: [{ id: land }], Status: "Active" },
      editedAt: "2026-10-29T15:00:00.000Z",
    });
    const stored = JSON.stringify(s);
    for (const never of ["notion.so", "https://", "url", "Active Holders", "person-1", "last_edited_by", "Energization Level", pageId("keep-seat")]) {
      expect(stored).not.toContain(never);
    }
  });

  it("SWAPS A MEMBER'S NAME OUT OF THE PROSE and names the field it did", async () => {
    serviceHolds("swap");
    expect(JSON.stringify(state.read)).toContain("Jane Example");
    await syncByHand(pool);
    const s = await newest();
    expect(s.roles.records[0]).toMatchObject({ fields: { Body: "a member holds the water." }, namesAMember: ["Body"] });
    expect(s.circles.records[0]).toMatchObject({ fields: { Notes: "a member keeps this circle." }, namesAMember: ["Notes"] });
    expect(JSON.stringify(s)).not.toContain("Jane");

    // The control: prose naming nobody is kept as sent and marked nowhere.
    serviceHolds("swap", { body: "Holds the water." });
    await syncByHand(pool);
    const plain = (await newest()).roles.records[0]!;
    expect(plain.fields.Body).toBe("Holds the water.");
    expect(plain.namesAMember).toBeUndefined();
  });

  it("CARRIES A KIND FORWARD when it failed, was cut short, came back empty or was not asked, and says which", async () => {
    serviceHolds("carry");
    await syncByHand(pool);
    const first = await newest();

    const press = async () => {
      // The roles change every time, so each row shows the whole kind moved on.
      serviceHolds("carry", { roleName: `carry Water Steward ${Math.random().toString(36).slice(2, 7)}` });
    };

    await press();
    state.fail = { circle: { why: "vendor-error", detail: "busy" } };
    await syncByHand(pool);
    let s = await newest();
    expect([s.circles.read, s.roles.read]).toEqual(["failed", "whole"]);
    expect(s.circles.records).toEqual(first.circles.records);
    expect(s.roles.records[0]!.fields["Role Name"]).not.toBe(first.roles.records[0]!.fields["Role Name"]);

    state.fail = {};
    state.endless = { circle: true };
    await syncByHand(pool);
    s = await newest();
    expect(s.circles.read).toBe("cut-short");
    expect(s.circles.records).toEqual(first.circles.records);

    state.endless = {};
    state.read.circle = [];
    await syncByHand(pool);
    s = await newest();
    expect(s.circles.read).toBe("empty");
    expect(s.circles.records).toEqual(first.circles.records);

    // A schema that offers roles and not circles: the circles were never asked for.
    serviceHolds("carry");
    state.tools = [{ name: "list_records", inputSchema: { type: "object", properties: { record_type: { type: "string", enum: ["role"] } } } }];
    await syncByHand(pool);
    s = await newest();
    expect([s.circles.read, s.roles.read]).toEqual(["not-asked", "whole"]);
    expect(s.circles.records).toEqual(first.circles.records);

    // The control: a whole read of the kind replaces it.
    state.tools = [];
    serviceHolds("carry");
    (state.read.circle[0] as { fields: Record<string, unknown> }).fields["Circle Name"] = "carry Land and Water";
    await syncByHand(pool);
    s = await newest();
    expect(s.circles.read).toBe("whole");
    expect(s.circles.records[0]!.fields["Circle Name"]).toBe("carry Land and Water");
  });

  it("KEEPS A PAGE ID THAT ARRIVES TWICE ONCE, the first copy, and marks it", async () => {
    const { water } = serviceHolds("twice");
    const dashed = `${water.slice(0, 8)}-${water.slice(8, 12)}-${water.slice(12, 16)}-${water.slice(16, 20)}-${water.slice(20)}`;
    state.read.role.push({ id: dashed, fields: { "Role Name": "twice Second Copy", Status: "Active" } });
    await syncByHand(pool);
    const roles = (await newest()).roles.records;
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ id: water, duplicate: true, fields: { "Role Name": "twice Water Steward" } });

    // The control: one copy is not marked.
    serviceHolds("twice");
    await syncByHand(pool);
    expect((await newest()).roles.records[0]!.duplicate).toBeUndefined();
  });

  it(`KEEPS THE NEWEST ${SNAPSHOT_KEEP} ROWS AND NO MORE`, async () => {
    const read = {
      asked: ["circle", "role"],
      failed: [],
      truncated: [],
      records: [{ id: pageId("rot-land"), kind: "circle" as const, fields: { "Circle Name": "rot Land", Status: "Active" } }],
    };
    for (let i = 0; i < SNAPSHOT_KEEP + 2; i += 1) await writeSnapshot(pool, read, "scheduled", new Date());
    const kept = await recentSnapshots(pool, 100);
    expect(kept).toHaveLength(SNAPSHOT_KEEP);
    // Newest first, and the two oldest are the ones that went.
    const seqs = kept.map((k) => k.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(seqs[0]! - seqs[seqs.length - 1]!).toBe(SNAPSHOT_KEEP - 1);
  });

  it("CLIPS TEXT TOO LONG TO KEEP WHOLE and marks it, so it is never compared", async () => {
    serviceHolds("long", { body: "w".repeat(TEXT_KEEP + 500) });
    await syncByHand(pool);
    const r = (await newest()).roles.records[0]!;
    expect(String(r.fields.Body)).toHaveLength(TEXT_KEEP);
    expect(r.clipped).toEqual(["Body"]);
  });

  describe("the differences read from it", () => {
    const tag = "diff";
    const waterId = seatIdFor(pageId(`${tag}-water`), "unused");
    const cookPage = pageId(`${tag}-cook`);
    const cookId = seatIdFor(cookPage, "unused");

    /** One draft and its one change, as a publish leaves them. */
    async function draft(id: string, opts: { sourceKind: string; moduleId: string | null; status: string }, change: { op: string; roleId: string; payload: unknown }) {
      await pool.query( // module-review-ok: fixture SQL standing in for a published draft
        "INSERT INTO org_drafts (id, title, status, source_kind, source_module_id, published_at) VALUES (?, 'A draft', ?, ?, ?, NOW())",
        [id, opts.status, opts.sourceKind, opts.moduleId],
      );
      await pool.query( // module-review-ok: fixture SQL standing in for a published draft's change
        "INSERT INTO org_draft_changes (id, draft_id, op, org_role_id, payload, sort_order) VALUES (?, ?, ?, ?, ?, 1)",
        [`${id}-c`, id, change.op, change.roleId, JSON.stringify(change.payload)],
      );
    }

    it("TAKES ITS BASE ONLY FROM THIS VILLAGE'S PUBLISHED DRAFTS FROM THE SERVICE, and the count names nothing", async () => {
      const { water } = serviceHolds(tag, { body: "Holds the wells." });
      state.read.role.push({ id: cookPage, fields: { "Role Name": `${tag} Cook`, Circle: [pageId(`${tag}-land`)], Body: "Cooks for the work days.", Status: "Active" } });
      await pool.query("INSERT INTO circles (id, name, status) VALUES ('diff-land', 'diff Land', 'active')"); // module-review-ok: fixture SQL, the live circle
      await pool.query( // module-review-ok: fixture SQL, the live roles
        "INSERT INTO org_roles (id, circle_id, name, seats, active, aim) VALUES (?, 'diff-land', 'diff Water Steward', 1, 1, 'Holds the water.'), (?, 'diff-land', 'diff Cook', 1, 1, 'Feeds people.')",
        [waterId, cookId],
      );
      // The water role came from the service and was published. The cook's only
      // draft from the service was withdrawn, and a human draft says nothing about the service.
      await draft("d-water", { sourceKind: "agent", moduleId: "saberra", status: "published" }, { op: "create_seat", roleId: waterId, payload: { name: "diff Water Steward", circleId: "diff-land", aim: "Holds the water." } });
      await draft("d-cook-1", { sourceKind: "agent", moduleId: "saberra", status: "withdrawn" }, { op: "create_seat", roleId: cookId, payload: { name: "diff Cook", circleId: "diff-land", aim: "Feeds people." } });
      await draft("d-cook-2", { sourceKind: "human", moduleId: null, status: "published" }, { op: "update_seat", roleId: cookId, payload: { aim: "Feeds people." } });
      await syncByHand(pool);

      const read = await readDifferences(pool);
      const aims = read.list.filter((d) => d.kind === "textField" && d.field === "aim");
      const ofWater = aims.find((d) => d.subject.ourId === waterId);
      const ofCook = aims.find((d) => d.subject.ourId === cookId);
      expect(ofWater).toMatchObject({ state: "suggestion", base: { value: "Holds the water." }, sera: "Holds the wells.", source: { pageId: water } });
      expect(ofWater!.flags).toEqual([]);
      expect(ofCook).toMatchObject({ state: "suggestion", base: "unknown" });

      // The count: totals and the last read, and nothing that names a subject.
      const count = countAnswer(read);
      expect(count.total).toBe(read.list.filter((d) => d.state !== "oursAhead").length);
      expect(count.total).toBeGreaterThan(0);
      expect(count.lastReadWhole).toBe(true);
      expect(typeof count.lastReadAt).toBe("string");
      const said = JSON.stringify(count);
      for (const never of ["diff", water, waterId, "Water", "Cook", "wells"]) expect(said).not.toContain(never);
    });
  });
});
