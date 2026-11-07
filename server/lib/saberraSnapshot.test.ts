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
  /** When true, keeping a snapshot fails the way a database refusal would. */
  snapshotFails: false,
  /** When true, opening a session throws, the way a refused connection does. */
  sessionThrows: false,
  /** When true, storing the facts throws: a failure after the service answered. */
  factsFail: false,
  /** How long opening a session takes, so a run's start and its landing fall in different seconds. */
  slowMs: 0,
  /** A row deleted just before the next read of rows by seq, the way a prune racing a read would. */
  pruneOnRead: null as number | null,
}));

// The real facts store, with one switch: a write that throws after the read was kept.
vi.mock("../repos/moduleFacts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../repos/moduleFacts")>();
  return {
    ...real,
    upsertFacts: async (...args: Parameters<typeof real.upsertFacts>) => {
      if (state.factsFail) throw Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      return real.upsertFacts(...args);
    },
  };
});

// The real repo, with one switch: a snapshot write that throws on demand.
vi.mock("../repos/saberraSnapshots", async (importOriginal) => {
  const real = await importOriginal<typeof import("../repos/saberraSnapshots")>();
  return {
    ...real,
    insertSnapshot: async (...args: Parameters<typeof real.insertSnapshot>) => {
      if (state.snapshotFails) throw Object.assign(new Error("Invalid JSON text"), { code: "ER_INVALID_JSON_TEXT" });
      return real.insertSnapshot(...args);
    },
    snapshotsBySeq: async (...args: Parameters<typeof real.snapshotsBySeq>) => {
      if (state.pruneOnRead !== null) {
        const seq = state.pruneOnRead;
        state.pruneOnRead = null;
        await args[0].query("DELETE FROM saberra_snapshots WHERE seq = ?", [seq]); // module-review-ok: fixture SQL, a prune racing a read
      }
      return real.snapshotsBySeq(...args);
    },
  };
});

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
  openSession: async () => {
    if (state.slowMs) await new Promise((r) => setTimeout(r, state.slowMs));
    if (state.sessionThrows) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    return state.session;
  },
  listTools: async () => ({ ok: true, tools: state.tools }),
  callTool: async (_c: unknown, _s: string, _t: string, args: Record<string, unknown>) => {
    const wire = String(args.kind ?? args.record_type);
    const failure = state.fail[wire];
    if (failure) return { ok: false, ...failure };
    return { ok: true, records: state.read[wire] ?? [], cursor: state.endless[wire] ? "more" : null };
  },
}));

vi.mock("./modules", () => ({
  moduleConfig: () => ({ apiUrl: "https://service.example.test/mcp", dashboardUrl: "https://dash.example.test", pollSchedule: "every-6-hours" }),
  effectiveLifecycle: () => "preview",
}));

vi.mock("./identity", () => ({ instanceIdentity: () => ({ instanceId: "village-1", bornAt: "" }) }));

import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { seatIdFor } from "../../shared/structurePlan";
import type { Snapshot } from "../../shared/seraDifferences";
import { landProposal, markProposalDecided, proposalsInBatch } from "./externalProposals";
import { pollOnce, syncByHand } from "./saberraSync";
import { SNAPSHOT_KEEP, TEXT_KEEP, writeSnapshot } from "./saberraSnapshot";
import { countAnswer, readDifferences, snapshotsNeeded } from "./seraDifferencesRead";
import { insertSnapshot, pruneSnapshotsOlderThan, recentSnapshots } from "../repos/saberraSnapshots";
import { SNAPSHOT_MAX_AGE_DAYS, pruneByAge } from "./saberraSnapshot";
import { writeSyncLogDocument } from "../repos/saberraSyncLog";

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

describe("which stored reads a request reads", () => {
  const H = 60 * 60;
  const row = (seq: number, hoursAgo: number, circlesRead: "whole" | "failed" = "whole", rolesRead: "whole" | "failed" = "whole") => ({
    seq, taken: 1_000_000 - hoursAgo * H, circlesRead, rolesRead,
  });

  it("READS THE NEWEST TWO, THE NEWEST A DAY OLD, AND THE TWO NEWEST WHOLE OF EACH KIND, never all thirty", () => {
    const index = [
      row(30, 0, "failed", "whole"), row(29, 2, "failed", "failed"), row(28, 4), row(27, 6), row(26, 20), row(25, 25), row(24, 30), row(1, 400),
    ];
    // 30, 29 newest; 25 the newest at least a day old; 28, 27 the circles' two newest whole; 30, 28 the roles'.
    expect(snapshotsNeeded(index, 1_000_000)).toEqual([30, 29, 28, 27, 25]);
    // Nothing a day old yet: the oldest kept stands in.
    expect(snapshotsNeeded([row(3, 0), row(2, 1), row(1, 2)], 1_000_000)).toEqual([3, 2, 1]);
  });
});

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
    state.snapshotFails = false;
    state.sessionThrows = false;
    state.factsFail = false;
    state.pruneOnRead = null;
    state.slowMs = 0;
    await pool.query("DELETE FROM saberra_snapshots WHERE seq > 0"); // module-review-ok: fixture SQL, each test starts from no snapshot
    await writeSyncLogDocument(pool, { runs: [], landedFingerprint: null });
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
    expect(s.roles.records[0]).toMatchObject({ fields: { Body: "a member holds the water." }, namesAMember: ["Body"], swapped: ["Body"] });
    expect(s.circles.records[0]).toMatchObject({ fields: { Notes: "a member keeps this circle." }, namesAMember: ["Notes"], swapped: ["Notes"] });
    expect(JSON.stringify(s)).not.toContain("Jane");

    // The control: prose naming nobody is kept as sent and marked nowhere.
    serviceHolds("swap", { body: "Holds the water." });
    await syncByHand(pool);
    const plain = (await newest()).roles.records[0]!;
    expect(plain.fields.Body).toBe("Holds the water.");
    expect(plain.namesAMember).toBeUndefined();
    expect(plain.swapped).toBeUndefined();
  });

  it("REWRITES ONLY A FULL NAME, and only FLAGS a first name, a surname or a name in a role's title", async () => {
    // A member whose surname is an ordinary word, here for this test alone.
    await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ('u-robin', 'Robin Wells', 'robin@example.org', 'x')"); // module-review-ok: fixture SQL, a second member for the wide match
    try {
      serviceHolds("wide", { body: "Robin keeps the wells clear, with Jane Example.", roleName: "Robin's Helper" });
      await syncByHand(pool);
      const r = (await newest()).roles.records[0]!;
      // The full name is swapped; "Robin" and "wells" stay as sent, and the field is flagged.
      expect(r.fields.Body).toBe("Robin keeps the wells clear, with a member.");
      expect(r.fields["Role Name"]).toBe("Robin's Helper");
      expect(r).toMatchObject({ namesAMember: ["Body", "Role Name"], swapped: ["Body"] });

      // The control: words with no name in them are neither flagged nor rewritten.
      serviceHolds("wide", { body: "Keeps the paths clear." });
      await syncByHand(pool);
      const plain = (await newest()).roles.records[0]!;
      expect(plain.namesAMember).toBeUndefined();
      expect(plain.swapped).toBeUndefined();
    } finally {
      await pool.query("DELETE FROM users WHERE id = 'u-robin'"); // module-review-ok: fixture SQL, removes this test's member
    }
  });

  it("FLAGS A MEMBER'S FULL NAME IN A ROLE'S OR A CIRCLE'S NAME, keeps it as sent, and does nothing more (review C9)", async () => {
    const { land, water } = serviceHolds("c9", { roleName: "Jane Example's Helper", body: "Holds the water." });
    const circle = (state.read.circle[0] as { fields: Record<string, unknown> }).fields;
    circle["Circle Name"] = "Jane Example Circle";
    circle.Notes = "Keeps this circle.";
    await syncByHand(pool);
    const s = await newest();
    // Chart names are compared with ours, so they are stored as sent: flagged, never rewritten.
    const role = s.roles.records[0]!;
    expect(role.fields).toMatchObject({ "Role Name": "Jane Example's Helper", Body: "Holds the water." });
    expect(role.namesAMember).toEqual(["Role Name"]);
    expect(role.swapped).toBeUndefined();
    const held = s.circles.records[0]!;
    expect(held.fields).toMatchObject({ "Circle Name": "Jane Example Circle", Notes: "Keeps this circle." });
    expect(held.namesAMember).toEqual(["Circle Name"]);
    expect(held.swapped).toBeUndefined();
    // Each addition says so, and its name is never offered to take as it stands.
    const mine = (await readDifferences(pool)).list.filter((d) => d.subject.pageId === land || d.subject.pageId === water);
    expect(mine.map((d) => d.kind).sort()).toEqual(["circleAdd", "roleAdd"]);
    for (const d of mine) expect(d).toMatchObject({ namesAMember: true, takeable: false, autoEligible: false, bulkEligible: false });

    // The control: names with nobody's name in them are flagged nowhere.
    serviceHolds("c9", { roleName: "Water Helper", body: "Holds the water." });
    const plain = state.read.circle[0] as { fields: Record<string, unknown> };
    plain.fields["Circle Name"] = "Water Circle";
    plain.fields.Notes = "Keeps this circle.";
    await syncByHand(pool);
    const after = await newest();
    expect(after.roles.records[0]!.namesAMember).toBeUndefined();
    expect(after.circles.records[0]!.namesAMember).toBeUndefined();
  });

  it("KEEPS ONLY THE PAGE ID OF AN ID THAT ENDS A PAGE ADDRESS, dashed or not, so no stored id carries a title (review #5)", async () => {
    const { land } = serviceHolds("tail");
    const hex = pageId("tail-titled");
    const dashed = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const other = pageId("tail-other");
    (state.read.role as unknown[]).push(
      { id: `Jane-Example-Helper-${dashed}`, fields: { "Role Name": "Helper", Circle: [`Land-Circle-${land}`], Status: "Active" } },
      { id: `Secret-Plan-${other}`, fields: { "Role Name": "Planner", Status: "Active" } },
    );
    expect((await syncByHand(pool)).status).toBe(200);
    const s = await newest();
    expect(s.roles.records.map((r) => r.id)).toEqual(expect.arrayContaining([hex, other]));
    expect(s.roles.records.find((r) => r.id === hex)!.fields.Circle).toEqual([{ id: land }]);
    const stored = JSON.stringify(s);
    for (const title of ["Jane-Example", "Helper-", "Secret-Plan", "Land-Circle"]) expect(stored).not.toContain(title);
    // What the sync landed carries the page id too, never the title.
    expect(JSON.stringify(await proposalsInBatch(pool, "sync-snap-1"))).not.toContain("Jane-Example");
  });

  it("DROPS A RECORD WHOSE ID IS AN ADDRESS, and counts it in the sync's report (R10)", async () => {
    const { water } = serviceHolds("ids");
    // The service sends a second role with its page ADDRESS where the id belongs: the title rides in it.
    (state.read.role as unknown[]).push({ id: `https://www.notion.so/Secret-Plan-${pageId("ids-url")}`, fields: { "Role Name": "Secret Plan", Status: "Active" } });
    const answer = await syncByHand(pool);
    expect(answer.status).toBe(200);
    expect(answer.body.refusedIds).toBe(1);
    const s = await newest();
    expect(s.roles.records.map((r) => r.id)).toEqual([water]);
    expect(JSON.stringify(s)).not.toContain("Secret");
  });

  it("PRUNES BY AGE, the newest read included, and the list reads an empty table as nothing read yet", async () => {
    serviceHolds("age");
    await syncByHand(pool);
    await syncByHand(pool);
    const age = (days: number, which: "MIN" | "MAX") =>
      pool.query( // module-review-ok: fixture SQL, ages one stored read
        `UPDATE saberra_snapshots SET taken_at = taken_at - INTERVAL ${days} DAY WHERE seq = (SELECT s FROM (SELECT ${which}(seq) AS s FROM saberra_snapshots) x)`,
      );
    await age(SNAPSHOT_MAX_AGE_DAYS + 1, "MIN");
    expect(await pruneByAge(pool, new Date())).toBe(1);
    expect((await recentSnapshots(pool, 30)).length).toBe(1);
    // The newest one too, once it is past the age: nothing stays because it is the last.
    await age(SNAPSHOT_MAX_AGE_DAYS + 1, "MAX");
    expect(await pruneByAge(pool, new Date())).toBe(1);
    expect((await recentSnapshots(pool, 30)).length).toBe(0);
    const read = await readDifferences(pool);
    expect(read.list).toEqual([]);
    expect(read.latest).toBeNull();
    expect(countAnswer(read)).toMatchObject({ total: 0, lastReadAt: null, lastReadWhole: false });
    // A read inside the age is never touched.
    await syncByHand(pool);
    expect(await pruneSnapshotsOlderThan(pool, new Date(Date.now() - SNAPSHOT_MAX_AGE_DAYS * 86_400_000))).toBe(0);
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
    const written: number[] = [];
    for (let i = 0; i < SNAPSHOT_KEEP + 2; i += 1) written.push((await writeSnapshot(pool, read, "scheduled", new Date())).seq);
    const kept = await recentSnapshots(pool, 100);
    expect(kept).toHaveLength(SNAPSHOT_KEEP);
    // The newest kept is the last one written, newest first, and the two oldest are the ones that went.
    expect(kept[0]!.seq).toBe(written[written.length - 1]);
    expect(kept.map((k) => k.seq)).toEqual(written.slice(2).reverse());
  });

  it("CLIPS TEXT TOO LONG TO KEEP WHOLE and marks it, so it is never compared", async () => {
    serviceHolds("long", { body: "w".repeat(TEXT_KEEP + 500) });
    await syncByHand(pool);
    const r = (await newest()).roles.records[0]!;
    expect(String(r.fields.Body)).toHaveLength(TEXT_KEEP);
    expect(r.clipped).toEqual(["Body"]);
  });

  it("CLIPS ON A WHOLE CHARACTER, never between the two halves of one, so the row is still kept", async () => {
    // A character outside the basic plane straddles the limit in UTF-16.
    const body = `${"w".repeat(TEXT_KEEP - 1)}\u{1F33F}${"w".repeat(10)}`;
    serviceHolds("emoji", { body });
    const before = (await recentSnapshots(pool, 1))[0]?.seq ?? 0;
    await syncByHand(pool);
    const [row] = await recentSnapshots(pool, 1);
    // A row was written at all: half a character is JSON the column refuses.
    expect(row!.seq).toBeGreaterThan(before);
    const kept = String(row!.snapshot.roles.records[0]!.fields.Body);
    expect(Array.from(kept)).toHaveLength(TEXT_KEEP);
    expect(kept.endsWith("\u{1F33F}")).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(kept)).toBe(false);
  });

  it("KEEPS A SNAPSHOT OF AN UNCHANGED SCHEDULED READ, which lands nothing, because R4 counts it", async () => {
    serviceHolds("same");
    expect((await syncByHand(pool)).status).toBe(200);
    const pressed = (await recentSnapshots(pool, 1))[0]!.seq;
    const said = await pollOnce(pool, () => Date.now() + 7 * 60 * 60 * 1000);
    expect(said).toContain("no-change");
    const [row] = await recentSnapshots(pool, 1);
    expect(row!.seq).toBeGreaterThan(pressed);
    expect(row!.snapshot).toMatchObject({ trigger: "scheduled", roles: { read: "whole" }, circles: { read: "whole" } });
  });

  it("A STORED MATCH READS BACK WHOLE, the pay it carries included, and a malformed one reads as none", async () => {
    const whole = { ourId: "role-1", via: "earlier", agreed: { name: true, aim: "Holds the water.", circle: "land" }, pay: "0123456789abcdef" };
    const records = [
      { id: pageId("rt-1"), fields: { "Role Name": "One" }, match: whole },
      { id: pageId("rt-2"), fields: { "Role Name": "Two" }, match: null },
      { id: pageId("rt-3"), fields: { "Role Name": "Three" }, match: { ourId: "role-3", via: "guess", agreed: {} } },
      { id: pageId("rt-4"), fields: { "Role Name": "Four" }, match: { ourId: "role-4", via: "name", agreed: { name: 7, aim: true }, pay: 12 } },
    ];
    await insertSnapshot(pool, new Date(), { trigger: "by-hand", circles: { read: "empty", records: [] }, roles: { read: "whole", records: records as never } });
    const back = (await newest()).roles.records;
    expect(back[0]!.match).toEqual(whole);
    expect(back[1]!.match).toBeNull();
    // A way nobody matches by is no match at all: the record reads as one kept before matches were stored.
    expect("match" in back[2]!).toBe(false);
    // What is not text or true is left out, and so is a pay that is not text.
    expect(back[3]!.match).toEqual({ ourId: "role-4", via: "name", agreed: { aim: true } });
  });

  it("A RENAME HERE BETWEEN TWO SYNCS IS OURS AHEAD: each read is kept with its match as it was made then (review C2)", async () => {
    const land = pageId("c2-land");
    const water = pageId("c2-water");
    // A circle and a role made here, never published from the service: matched by name alone.
    await pool.query("INSERT INTO circles (id, name, status) VALUES ('c2-land', 'c2 Land', 'active')"); // module-review-ok: fixture SQL, a circle made here
    await pool.query( // module-review-ok: fixture SQL, a role made here
      "INSERT INTO org_roles (id, circle_id, name, seats, active, aim) VALUES ('c2-water', 'c2-land', 'c2 Water Steward', 1, 1, 'Holds the water.')",
    );
    state.read = {
      circle: [{ id: land, fields: { "Circle Name": "c2 Land", Status: "Active" } }],
      role: [{ id: water, fields: { "Role Name": "c2 Water Steward", Circle: [land], Body: "Holds the water.", Status: "Active" } }],
      role_assignment: [],
    };
    await syncByHand(pool);
    const first = await newest();
    // Both renamed here; the service sends exactly what it sent before.
    await pool.query("UPDATE circles SET name = 'c2 Land & Ecology' WHERE id = 'c2-land'"); // module-review-ok: fixture SQL, a rename made here
    await pool.query("UPDATE org_roles SET name = 'c2 Water Keeper' WHERE id = 'c2-water'"); // module-review-ok: fixture SQL, a rename made here
    await syncByHand(pool);
    const mine = (await readDifferences(pool)).list.filter((d) => d.subject.pageId === land || d.subject.pageId === water);
    // Never a circle to add or a role to add that would duplicate ours: two renames of ours, ahead.
    expect(mine.map((d) => [d.kind, d.state, d.subject.ourId])).toEqual([
      ["rename", "oursAhead", "c2-land"],
      ["rename", "oursAhead", "c2-water"],
    ]);
    // What the first read was kept with, and the second: the match made then, and what both sides held.
    expect(first.circles.records[0]!.match).toEqual({ ourId: "c2-land", via: "name", agreed: { name: true } });
    expect(first.roles.records[0]!.match).toEqual({ ourId: "c2-water", via: "name", agreed: { name: true, aim: true, circle: "c2-land" } });
    const second = await newest();
    expect(second.roles.records[0]!.match).toEqual({ ourId: "c2-water", via: "earlier", agreed: { name: true, aim: true, circle: "c2-land" } });
  });

  it("THE SERVICE NOT ANSWERING IS KEPT AS A READ, both kinds failed and carried, so the list says when it last tried (review C6)", async () => {
    serviceHolds("quiet");
    await syncByHand(pool);
    const whole = await newest();
    const ids = (s: Snapshot) => [s.circles.records.map((r) => r.id), s.roles.records.map((r) => r.id)];
    const tried = async () => {
      const s = await newest();
      expect([s.circles.read, s.roles.read]).toEqual(["failed", "failed"]);
      // Carried, so nothing looks removed and the page still shows the last full check.
      expect(ids(s)).toEqual(ids(whole));
      const read = await readDifferences(pool);
      expect(read.latest).toMatchObject({ takenAt: s.takenAt, circles: "failed", roles: "failed" });
      expect(read.lastWhole).toEqual({ circles: whole.takenAt, roles: whole.takenAt });
      return s;
    };

    // No session at all.
    const before = (await recentSnapshots(pool, 1))[0]!.seq;
    state.session = null;
    expect((await syncByHand(pool)).status).toBe(502);
    expect((await recentSnapshots(pool, 1))[0]!.seq).toBeGreaterThan(before);
    await tried();

    // A call that throws.
    const again = (await recentSnapshots(pool, 1))[0]!.seq;
    state.session = "snap-1";
    state.sessionThrows = true;
    await expect(syncByHand(pool)).rejects.toThrow();
    expect((await recentSnapshots(pool, 1))[0]!.seq).toBeGreaterThan(again);
    await tried();

    // The control: a failure after the service answered keeps the read it made, and no failed one on top.
    state.sessionThrows = false;
    state.factsFail = true;
    await expect(syncByHand(pool)).rejects.toThrow();
    const [top, under] = await recentSnapshots(pool, 2);
    expect([top!.snapshot.circles.read, top!.snapshot.roles.read]).toEqual(["whole", "whole"]);
    expect(under!.snapshot.circles.read).toBe("failed");
  });

  it("THIRTY ATTEMPTS THE SERVICE NEVER ANSWERED NEVER PRUNE THE LAST FULL CHECK (review C6)", async () => {
    serviceHolds("outage");
    await syncByHand(pool);
    const whole = await newest();
    const failed = { asked: ["circle", "role"], failed: ["circle", "role"], truncated: [], records: [] };
    for (let i = 0; i < SNAPSHOT_KEEP + 2; i += 1) await writeSnapshot(pool, failed, "scheduled", new Date());
    const kept = await recentSnapshots(pool, 100);
    // The newest thirty, and the last whole read of each kind besides.
    expect(kept).toHaveLength(SNAPSHOT_KEEP + 1);
    expect(kept[kept.length - 1]!.snapshot).toMatchObject({ takenAt: whole.takenAt, circles: { read: "whole" }, roles: { read: "whole" } });
    expect((await readDifferences(pool)).lastWhole).toEqual({ circles: whole.takenAt, roles: whole.takenAt });
  });

  describe("which rows the list reads, as the clock moves and the table is pruned", () => {
    const H = 60 * 60 * 1000;
    const T = Date.parse("2026-11-04T12:00:00.000Z");
    const land = pageId("clk-land");
    /** One read: our circle with a review date, and a role only when the roles came back whole. */
    const read = (review: string, roles: "whole" | "failed") => ({
      asked: ["circle", "role"],
      failed: roles === "failed" ? ["role"] : [],
      truncated: [],
      records: [
        { id: land, kind: "circle" as const, fields: { "Circle Name": "clk Land", Status: "Active", "Next Review Date": review } },
        ...(roles === "whole" ? [{ id: pageId("clk-role"), kind: "role" as const, fields: { "Role Name": "clk Cook", Status: "Active" } }] : []),
      ],
    });
    const reviewFact = async (now: number) =>
      (await readDifferences(pool, now)).list.filter((d) => d.subject.pageId === land && d.field === "Next Review Date").map((d) => [d.sera, d.ours]);

    beforeEach(async () => {
      await pool.query("INSERT IGNORE INTO circles (id, name, status) VALUES ('clk-land', 'clk Land', 'active')"); // module-review-ok: fixture SQL, the live circle
    });

    it("THE CACHE MOVES WITH THE CLOCK: the read a day before is part of its key (review nit)", async () => {
      // The roles were last whole in the two oldest reads, so all four rows are read at either clock below.
      await writeSnapshot(pool, read("2026-12-01", "whole"), "scheduled", new Date(T - 50 * H));
      await writeSnapshot(pool, read("2026-12-01", "whole"), "scheduled", new Date(T - 30 * H));
      await writeSnapshot(pool, read("2027-01-01", "failed"), "scheduled", new Date(T - 2 * H));
      await writeSnapshot(pool, read("2027-01-01", "failed"), "scheduled", new Date(T));
      // A day before T is the read at T-30h: the date moved since.
      expect(await reviewFact(T)).toEqual([["2027-01-01", "2026-12-01"]]);
      // 23 hours on, the same rows, and a day before is the read at T-2h, which already said 2027-01-01.
      expect(await reviewFact(T + 23 * H)).toEqual([]);
    });

    it("A READ THAT RACES A PRUNE CHOOSES ITS ROWS AGAIN, never answering from part of them (review nit)", async () => {
      await writeSnapshot(pool, read("2026-12-01", "whole"), "scheduled", new Date(T - 50 * H));
      const dayOld = (await writeSnapshot(pool, read("2026-12-01", "whole"), "scheduled", new Date(T - 30 * H))).seq;
      await writeSnapshot(pool, read("2027-01-01", "whole"), "scheduled", new Date(T - 1 * H));
      await writeSnapshot(pool, read("2027-01-01", "whole"), "scheduled", new Date(T));
      // The read a day before is pruned between choosing it and reading it.
      state.pruneOnRead = dayOld;
      const fact = await reviewFact(T);
      expect(state.pruneOnRead).toBeNull();
      // Chosen again, a day before is the read at T-50h, which said 2026-12-01 too.
      expect(fact).toEqual([["2027-01-01", "2026-12-01"]]);
    });
  });

  it("A LANDING RUN'S READ IS KEPT AFTER ITS LANDING, so no batch it landed is newer than its own read (for review K6)", async () => {
    serviceHolds("after");
    state.session = "snap-after";
    // The run starts, waits on the service past a second boundary, then reads and lands.
    state.slowMs = 2_100;
    expect((await syncByHand(pool)).status).toBe(200);
    const [[landed]] = (await pool.query( // module-review-ok: fixture SQL, the newest arrival of the batch this run landed
      "SELECT UNIX_TIMESTAMP(MAX(received_at)) AS at FROM external_proposals WHERE batch_id = 'sync-snap-after'",
    )) as unknown as [Array<{ at: number | string | null }>];
    expect(landed!.at).not.toBeNull();
    const kept = Date.parse((await newest()).takenAt) / 1000;
    // "Last checked" is the end of the read: never earlier than what the read landed.
    expect(kept).toBeGreaterThanOrEqual(Number(landed!.at));
  }, 15_000);

  it("A SNAPSHOT THAT CANNOT BE KEPT NEVER STOPS THE SYNC: the proposals still land", async () => {
    serviceHolds("fails");
    await syncByHand(pool);
    const kept = (await recentSnapshots(pool, 1))[0]!.seq;
    serviceHolds("fails", { body: "Holds the water, and the wells." });
    state.session = "snap-fails";
    state.snapshotFails = true;
    const r = await syncByHand(pool);
    expect(r.status).toBe(200);
    expect(r.body.landed).toBeGreaterThan(0);
    expect((await proposalsInBatch(pool, "sync-snap-fails")).some((p) => p.kind === "org.proposed")).toBe(true);
    // The differences list reads the snapshot before, which is still there.
    expect((await recentSnapshots(pool, 1))[0]!.seq).toBe(kept);
  });

  describe("the differences read from it", () => {
    const tag = "diff";
    /** Each role here was published from a proposal, under a different rule. */
    const ROLES = ["water", "cook", "keeper", "pantry", "edited", "human"] as const;
    type Role = (typeof ROLES)[number];
    const page = (r: Role) => pageId(`${tag}-${r}`);
    const idOf = (r: Role) => seatIdFor(page(r), "unused");
    const said = (r: Role) => `The ${r} as the service said it.`;
    const STEWARDS_WORDS = "A steward's own words.";

    /** One draft and its one change, as a publish leaves them, published `daysAgo` days back. */
    async function draft(id: string, opts: { sourceKind: string; moduleId: string | null; status: string; daysAgo?: number }, change: { op: string; roleId: string; payload: unknown }) {
      await pool.query( // module-review-ok: fixture SQL standing in for a published draft
        "INSERT INTO org_drafts (id, title, status, source_kind, source_module_id, published_at) VALUES (?, 'A draft', ?, ?, ?, ?)",
        [id, opts.status, opts.sourceKind, opts.moduleId, new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000)],
      );
      await pool.query( // module-review-ok: fixture SQL standing in for a published draft's change
        "INSERT INTO org_draft_changes (id, draft_id, op, org_role_id, payload, sort_order) VALUES (?, ?, ?, ?, ?, 1)",
        [`${id}-c`, id, change.op, change.roleId, JSON.stringify(change.payload)],
      );
    }

    /**
     * A structure proposal landed from `proposalModule`, accepted into a draft
     * from `draftModule` with `status`, the way the review leaves them: the
     * change written first, then the proposal marked accepted against the draft,
     * carrying the steward's edit when there was one.
     */
    async function accepted(
      r: string,
      opts: { status: string; draftModule: string | null; sourceKind?: string; proposalModule?: string; edited?: boolean; aim?: string; draftId?: string; daysAgo?: number },
    ) {
      const pageOf = pageId(`${tag}-${r}`);
      const draftId = opts.draftId ?? `d-${r}`;
      const seat = { id: pageOf, name: `${tag} ${r}`, circleName: `${tag} Land`, aim: opts.aim ?? `The ${r} as the service said it.` };
      const payload = { title: "Structure", rationale: "From the service.", seats: [seat] };
      const landed = await landProposal(pool, {
        villageId: "village-1", moduleId: opts.proposalModule ?? "saberra", batchId: `batch-${draftId}`, kind: "org.proposed",
        payload, sourceRef: `structure-${draftId}`, trustTier: "extracted_unreviewed",
      });
      if (!landed.ok) throw new Error(`the ${r} proposal did not land`);
      const published = opts.edited ? STEWARDS_WORDS : seat.aim;
      await draft(draftId, { sourceKind: opts.sourceKind ?? "agent", moduleId: opts.draftModule, status: opts.status, daysAgo: opts.daysAgo }, {
        op: "create_seat", roleId: seatIdFor(pageOf, "unused"), payload: { name: seat.name, circleId: "diff-land", aim: published },
      });
      await markProposalDecided(pool, {
        id: landed.id, status: "accepted", decidedBy: "u-steward", createdRef: draftId,
        editedPayload: opts.edited ? { ...payload, seats: [{ ...seat, aim: STEWARDS_WORDS }] } : null,
      });
      return published;
    }

    /** A live role a draft made, with our words on it. */
    async function liveRole(r: string, aim: string) {
      await pool.query( // module-review-ok: fixture SQL, the live role the draft made
        "INSERT INTO org_roles (id, circle_id, name, seats, active, aim) VALUES (?, 'diff-land', ?, 1, 1, ?)",
        [seatIdFor(pageId(`${tag}-${r}`), "unused"), `${tag} ${r}`, aim],
      );
    }

    it("TAKES ITS BASE FROM WHAT THE SERVICE SAID, ONLY IN THIS VILLAGE'S OWN PUBLISHED, UNEDITED ACCEPTS", async () => {
      const land = pageId(`${tag}-land`);
      await pool.query("INSERT INTO circles (id, name, status) VALUES ('diff-land', 'diff Land', 'active')"); // module-review-ok: fixture SQL, the live circle
      const ourWords: Record<Role, string> = {
        // Published from the service, untouched: the one known base.
        water: await accepted("water", { status: "published", draftModule: "saberra" }),
        // Published, then reverted: undone, so it says nothing.
        cook: await accepted("cook", { status: "reverted", draftModule: "saberra" }),
        // Another module's proposal, in a draft from this one.
        keeper: await accepted("keeper", { status: "published", draftModule: "saberra", proposalModule: "hypha" }),
        // This module's proposal, in a draft another module made.
        pantry: await accepted("pantry", { status: "published", draftModule: "hypha" }),
        // Edited by a steward at accept: the payload no longer hashes to its key.
        edited: await accepted("edited", { status: "published", draftModule: "saberra", edited: true }),
        // A person's own draft says nothing about the service.
        human: await accepted("human", { status: "published", draftModule: "saberra", sourceKind: "human" }),
      };
      for (const r of ROLES) await liveRole(r, ourWords[r]);
      // Somebody holds the water role here, named the way a documented holder is.
      await pool.query( // module-review-ok: fixture SQL, a seating on the live role
        "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, display_name, holder_key) VALUES ('a-water', ?, 'documented', 'Robin Wells', 'documented:robin')",
        [idOf("water")],
      );
      // The service now says something new for every one of them.
      state.read = {
        circle: [{ id: land, fields: { "Circle Name": `${tag} Land`, Status: "Active" } }],
        role: ROLES.map((r) => ({ id: page(r), fields: { "Role Name": `${tag} ${r}`, Circle: [land], Body: `The ${r}, as the service says it now.`, Status: "Active" } })),
        role_assignment: [],
      };
      await syncByHand(pool);

      const read = await readDifferences(pool);
      // Who holds each role here, read from the live chart, for "Role (FirstName)".
      expect(read.holders[idOf("water")]).toEqual(["Robin Wells"]);
      expect(read.holders[idOf("cook")] ?? []).toEqual([]);
      const baseOf = (r: Role) => read.list.find((d) => d.field === "aim" && d.subject.ourId === idOf(r))?.base;
      expect(baseOf("water")).toEqual({ value: said("water") });
      for (const r of ["cook", "keeper", "pantry", "edited", "human"] as const) expect(baseOf(r), r).toBe("unknown");
      const ofWater = read.list.find((d) => d.field === "aim" && d.subject.ourId === idOf("water"))!;
      expect(ofWater).toMatchObject({ state: "suggestion", source: { pageId: page("water") } });
      expect(ofWater.flags).toEqual([]);

      // The count: totals and the last read, and nothing that names a subject.
      const count = countAnswer(read);
      expect(count.total).toBe(read.list.filter((d) => d.state !== "oursAhead").length);
      expect(count.total).toBeGreaterThan(0);
      expect(count.lastReadWhole).toBe(true);
      expect(typeof count.lastReadAt).toBe("string");
      const told = JSON.stringify(count);
      for (const never of ["diff", page("water"), idOf("water"), "water", "service says"]) expect(told).not.toContain(never);

      // THE CACHE NEVER ANSWERS FOR A CHART THAT MOVED: the same words written here settle it.
      await pool.query("UPDATE org_roles SET aim = ? WHERE id = ?", ["The water, as the service says it now.", idOf("water")]); // module-review-ok: fixture SQL, an edit made here
      const after = await readDifferences(pool);
      expect(after.list.some((d) => d.field === "aim" && d.subject.ourId === idOf("water"))).toBe(false);
    });

    it("SWAPS A FULL NAME OUT OF ANY TEXT FIELD AND FLAGS IT, so a fact naming a member never applies by itself (R9)", async () => {
      const land = pageId(`${tag}-land`);
      await pool.query("INSERT IGNORE INTO circles (id, name, status) VALUES ('diff-land', 'diff Land', 'active')"); // module-review-ok: fixture SQL, the live circle
      await liveRole("method", "Keeps the method.");
      const read = (method: string) => ({
        circle: [{ id: land, fields: { "Circle Name": `${tag} Land`, Status: "Active" } }],
        role: [{ id: pageId(`${tag}-method`), fields: { "Role Name": `${tag} method`, Circle: [land], Body: "Keeps the method.", Status: "Active", "Assignment Method": method } }],
        role_assignment: [],
      });
      state.read = read("Elected");
      await syncByHand(pool);
      // The reviewer's probe value: a full name in a field that is not prose.
      state.read = read("Appointed by Jane Example");
      await syncByHand(pool);
      const stored = (await recentSnapshots(pool, 1))[0]!.snapshot.roles.records[0]!;
      expect(stored.fields["Assignment Method"]).toBe("Appointed by a member");
      expect(stored.swapped).toContain("Assignment Method");
      expect(stored.namesAMember).toContain("Assignment Method");
      // A role's and a circle's name are flagged, never rewritten: they are compared with our own names.
      expect(stored.fields["Role Name"]).toBe(`${tag} method`);
      const fact = (await readDifferences(pool)).list.find((d) => d.field === "Assignment Method");
      expect(fact?.flags.map((f) => f.key)).toContain("namesAMember");
      expect(fact?.autoEligible).toBe(false);
    });

    it("TAKES THE NEWEST PUBLISHED CHANGE AS THE BASE, and compares our words through the same name swap", async () => {
      const land = pageId(`${tag}-land`);
      // Two accepts of one role, a week apart: the later one is the base.
      await accepted("twice", { status: "published", draftModule: "saberra", aim: "The first words.", draftId: "d-twice-1", daysAgo: 7 });
      await accepted("twice", { status: "published", draftModule: "saberra", aim: "The second words.", draftId: "d-twice-2", daysAgo: 1 });
      await liveRole("twice", "The second words.");
      // Our words name a member; the service's, as stored, carry the stand-in.
      await accepted("named", { status: "published", draftModule: "saberra", aim: "Jane Example keeps the seeds." });
      await liveRole("named", "Jane Example keeps the seeds.");
      state.read = {
        circle: [{ id: land, fields: { "Circle Name": `${tag} Land`, Status: "Active" } }],
        role: [
          { id: pageId(`${tag}-twice`), fields: { "Role Name": `${tag} twice`, Circle: [land], Body: "The third words.", Status: "Active" } },
          { id: pageId(`${tag}-named`), fields: { "Role Name": `${tag} named`, Circle: [land], Body: "Jane Example keeps the seeds.", Status: "Active" } },
        ],
        role_assignment: [],
      };
      await syncByHand(pool);
      const read = await readDifferences(pool);
      const aimOf = (r: string) => read.list.find((d) => d.field === "aim" && d.subject.ourId === seatIdFor(pageId(`${tag}-${r}`), "unused"));
      expect(aimOf("twice")).toMatchObject({ state: "suggestion", base: { value: "The second words." } });
      expect(aimOf("named")).toBeUndefined();
    });
  });
});
