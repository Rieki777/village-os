/**
 * "PUT IT TO THE VILLAGE" FOR AN ORG CHART DRAFT, over real HTTP against a real
 * database: the `org.decide` doors, the `org_draft` ballot, and its closer.
 *
 * The gate in this harness is the REAL `capabilityDecision` from
 * shared/capabilities.ts, fed a context this file controls: a member in
 * `holders` carries `org.decide` through a role, `villageHeld` is the
 * `capability_holding` list, and an admin is an admin. `liveHoldersOf` answers
 * the same set, which is what `liveHoldersOfCapability` would count from those
 * role rows. So what is under test is the doors' reading of the gate's answer,
 * and never a stub that agrees with them by construction.
 *
 * Order matters for one thing only: the launch vote is recorded in the last
 * block, because a Game cannot be un-started (server/lib/gameStart.ts).
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import type { SubjectCloser } from "../lib/applyDue";
import { ballotById, castVote } from "../lib/ballots";
import { readGameStart, recordGameStart } from "../lib/gameStart";
import { addChange, createDraft, getDraft, previewDraft, setDraftVision, withdrawDraft } from "../lib/orgDrafts";
import {
  decideStanding,
  ORG_DRAFT,
  putToVillageRefusal,
  withdrawDraftBallot,
} from "../lib/orgDraftDecide";
import { register } from "./orgDraftDecide";
import { register as registerOrg } from "./org";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";

const USERS: Record<string, { id: string; name: string; role: string }> = {
  "holder-1": { id: "holder-1", name: "Holder One", role: "member" },
  "member-1": { id: "member-1", name: "Member One", role: "member" },
  "admin-1": { id: "admin-1", name: "Admin One", role: "admin" },
};
let holders = new Set<string>();
let villageHeld: string[] = [];
let governance = true;
let reloads = 0;
let notices: Array<{ userId: string; type: string; title: string; dedupeKey: string }> = [];
const closers: Record<string, SubjectCloser> = {};

const SEASON = {
  current: { id: "s1" },
  seasons: [{ id: "s1", startsOn: "2026-01-01", endsOn: "2030-01-01" }],
  timezone: "UTC",
};

const userOf = async (req: any) => USERS[String(req.headers["x-user"] ?? "")] ?? null;
const ctxOf = async (user: any): Promise<CapabilityCtx> => ({
  stageIndex: 0,
  stageIndexOf: () => 0,
  roleCapabilities: holders.has(String(user.id)) ? ["org.decide"] : [],
  isAdmin: user.role === "admin",
  villageHeld,
});
async function guard(req: any, res: any, cap: Capability, refusal?: { status: number; body: Record<string, unknown> }) {
  const user = await userOf(req);
  if (!user) {
    res.status(401).json({ error: "auth_required" });
    return false;
  }
  const ctx = await ctxOf(user);
  const d = capabilityDecision(cap, { ...ctx, adminOverride: req.headers["x-capability-override"] === "1" });
  if (d.allowed) return true;
  if (d.villageHolds && ctx.isAdmin) {
    res.status(409).json({ requiresOverride: true });
    return false;
  }
  res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
  return false;
}

async function call(method: string, route: string, user: string, body?: unknown) {
  const r = await fetch(base + route, { // module-review-ok: the test client dialling its own server on localhost
    method,
    headers: { "Content-Type": "application/json", "x-user": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

let seq = 0;
/**
 * A draft that carries everything the ballot must never show: a free-text
 * title and rationale, and a seating that names a person. Its circle and seat
 * names are the only words the village is allowed to read.
 */
async function makeDraft(opts: { blocked?: boolean } = {}): Promise<{ id: string; circle: string; seat: string }> {
  seq += 1;
  const circle = `Kitchen Circle ${seq}`;
  const seat = `Head Cook ${seq}`;
  const made = await createDraft(pool, {
    title: `Secret Plan Wombat ${seq}`,
    rationale: "Because Maybelline Thistlewood said so in the meeting",
    createdBy: "admin-1",
    sourceKind: "human",
    openCap: null,
  });
  if (!made.ok) throw new Error(made.error);
  const add = async (op: any, orgRoleId: string, payload: any) => {
    const r = await addChange(pool, made.id, { op, orgRoleId, payload });
    if (!r.ok) throw new Error(r.error);
  };
  await add("create_circle", `circle:kitchen-${seq}`, { name: circle });
  await add("create_seat", `head-cook-${seq}`, { name: seat, circleId: opts.blocked ? "no-such-circle" : `kitchen-${seq}` });
  await add("seat_holder", `head-cook-${seq}`, { userId: "member-1", displayName: "Zephyrine Quillfeather" });
  return { id: made.id, circle, seat };
}

describe.skipIf(!configured)("org.decide: who adopts a reorganisation", () => {
  beforeAll(async () => {
    // Not started: the launch vote is recorded by the last block, by this file.
    db = await provisionTestDb({ gameStarted: false });
    pool = testPool(db, { connectionLimit: 4 });
    const app = express();
    app.use(express.json());
    const shared = {
      authedUser: userOf,
      isAdmin: async (req: any) => (await userOf(req))?.role === "admin",
      guardCapability: guard,
      capabilityCtx: ctxOf,
      getPool: () => pool,
      notify: async (n: any) => {
        notices.push(n);
        return {} as any;
      },
      seasonState: () => SEASON,
      circlesRepo: { load: async () => { reloads += 1; }, all: () => [] },
      liveHoldersOf: async () => Array.from(holders),
    };
    register(app, {
      ...(shared as any),
      overLimit: async () => false,
      ballotSetup: async () => ({
        method: "majority",
        dials: { unityPct: 50, quorumPct: 0 },
        snapshot: { mode: "equal", token: null },
        tokenProblem: null,
        electorate: Object.keys(USERS).map((userId) => ({ userId, weight: 1 })),
        durationDays: 7,
      }),
      notifyRoll: async () => 0,
      governanceOn: () => governance,
      closers,
    });
    registerOrg(app, {
      ...(shared as any),
      members: { all: async () => [] },
      firstName: (n: string) => n,
      lapseContext: () => ({}),
      currentPatternId: () => null,
      notifyAdmins: async () => {},
      submissionsRepo: { all: () => [] },
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

  beforeEach(() => {
    holders = new Set();
    villageHeld = [];
    governance = true;
    reloads = 0;
    notices = [];
  });

  describe("the predicate (Rye, 2026-09-14 and 2026-09-23)", () => {
    it("nobody holds it: any member may put it to the village, and nobody publishes", () => {
      const s = decideStanding({ villageHeld: [] }, []);
      expect([s.rule.who, s.rule.because]).toEqual(["any-member", "nobody-holds-it"]);
      expect(putToVillageRefusal(s, "member-1")).toBeNull();
    });

    it("a role holds it: only its holder may put it to the village", () => {
      const s = decideStanding({ villageHeld: [] }, ["holder-1"]);
      expect([s.rule.who, s.rule.because]).toEqual(["live-holders", "a-role-holds-it"]);
      expect(putToVillageRefusal(s, "holder-1")).toBeNull();
      expect(putToVillageRefusal(s, "member-1")?.status).toBe(403);
    });

    it("the village holds it: any member may, holders or not", () => {
      const s = decideStanding({ villageHeld: ["org.decide"] }, ["holder-1"]);
      expect([s.rule.who, s.rule.because, s.villageHolds]).toEqual(["any-member", "village-holds-it", true]);
      expect(putToVillageRefusal(s, "member-1")).toBeNull();
    });
  });

  describe("the decide read", () => {
    it("says a ballot is needed when nobody holds the power", async () => {
      const d = await makeDraft();
      const r = await call("GET", `/api/org/drafts/${d.id}/decide`, "member-1");
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({
        status: "open", blocked: 0, holderCount: 0, ballotNeeded: true,
        youMayPublish: false, youMayPutToVillage: true, adminMayPublish: false, ballot: null, launched: false,
      });
      expect((await call("GET", `/api/org/drafts/${d.id}/decide`, "admin-1")).json.adminMayPublish).toBe(true);
      expect((await call("GET", `/api/org/drafts/${d.id}/decide`, "")).status).toBe(401);
    });

    it("says a holder may publish and a member may not put it up", async () => {
      holders = new Set(["holder-1"]);
      const d = await makeDraft();
      const h = await call("GET", `/api/org/drafts/${d.id}/decide`, "holder-1");
      expect(h.json).toMatchObject({ holderCount: 1, ballotNeeded: false, youHoldThePower: true, youMayPublish: true, youMayPutToVillage: true });
      const m = await call("GET", `/api/org/drafts/${d.id}/decide`, "member-1");
      expect(m.json).toMatchObject({ youMayPublish: false, youMayPutToVillage: false, whoMayPutToVillage: "live-holders" });
      // The read names how many hold it, never who.
      expect(JSON.stringify(m.json)).not.toContain("holder-1");
    });
  });

  describe("publish by power", () => {
    it("refuses a member who holds nothing, and says it goes to the village", async () => {
      const d = await makeDraft();
      const r = await call("POST", `/api/org/drafts/${d.id}/publish-by-power`, "member-1");
      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({ error: "not_a_holder", ballotNeeded: true });
      expect((await getDraft(pool, d.id))?.status).toBe("open");
    });

    it("refuses an admin who holds nothing, though the gate lets an admin through", async () => {
      const d = await makeDraft();
      const r = await call("POST", `/api/org/drafts/${d.id}/publish-by-power`, "admin-1");
      expect(r.status).toBe(403);
      expect((await getDraft(pool, d.id))?.status).toBe("open");
    });

    it("lets a holder publish live, and runs every step after the commit", async () => {
      holders = new Set(["holder-1"]);
      const d = await makeDraft();
      const r = await call("POST", `/api/org/drafts/${d.id}/publish-by-power`, "holder-1");
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({ success: true, applied: 3, reloaded: true });
      expect((await getDraft(pool, d.id))?.status).toBe("published");
      expect(reloads).toBe(1);
      expect(notices.filter((n) => n.type === "role_appointed" && n.userId === "member-1")).toHaveLength(1);
    });

    it("refuses a draft with a blocked line, and leaves it open", async () => {
      holders = new Set(["holder-1"]);
      const d = await makeDraft({ blocked: true });
      const r = await call("POST", `/api/org/drafts/${d.id}/publish-by-power`, "holder-1");
      expect(r.status).toBe(409);
      expect(String(r.json.error)).toContain("cannot be applied");
      expect((await getDraft(pool, d.id))?.status).toBe("open");
      expect(reloads).toBe(0);
    });

    it("lets the village's seated holder through on a village-held key, and refuses the admin with the hatch", async () => {
      holders = new Set(["holder-1"]);
      villageHeld = ["org.decide"];
      const d = await makeDraft();
      expect((await call("POST", `/api/org/drafts/${d.id}/publish-by-power`, "admin-1")).status).toBe(409);
      expect((await call("POST", `/api/org/drafts/${d.id}/publish-by-power`, "holder-1")).status).toBe(200);
    });
  });

  describe("put to the village", () => {
    it("opens an org_draft ballot that names circles and seats, and no person and no free text", async () => {
      const d = await makeDraft();
      /*
       * THE CONTROL. The fixture really does carry every forbidden word: the
       * draft's own title and rationale, and the preview's sentence for the
       * seating. So an empty search below is about the composer, and not about
       * a fixture that never held the words.
       */
      const draft = await getDraft(pool, d.id);
      expect(draft?.title).toContain("Secret Plan Wombat");
      expect(draft?.rationale).toContain("Maybelline");
      expect((await previewDraft(pool, d.id)).lines.map((l) => l.reads).join(" ")).toContain("Zephyrine Quillfeather");

      const r = await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "member-1");
      expect(r.status).toBe(200);
      const ballot = await ballotById(pool, r.json.ballot.id);
      expect(ballot).toMatchObject({ subjectType: ORG_DRAFT, subjectRef: d.id, status: "open", openedBy: "member-1" });
      const text = `${ballot!.title}\n${ballot!.docMarkdown}`;
      for (const word of ["Zephyrine", "Quillfeather", "Secret Plan", "Wombat", "Maybelline", "Thistlewood", "member-1", "admin-1", "Member One", "Admin One"]) {
        expect(text, word).not.toContain(word);
      }
      expect(ballot!.docMarkdown).toContain(`Create the circle "${d.circle}"`);
      expect(ballot!.docMarkdown).toContain(`Create the seat "${d.seat}" in "${d.circle}"`);
      expect(ballot!.docMarkdown).toContain(`Seat somebody in "${d.seat}"`);
      // Shown as written inside a <pre>, so no Markdown marks.
      expect(ballot!.docMarkdown).not.toMatch(/^#|\*\*/m);
    });

    it("freezes the draft while the vote is open: no second vote, no edit, no direct publish", async () => {
      const d = await makeDraft();
      expect((await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "member-1")).status).toBe(200);
      const again = await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "member-1");
      expect([again.status, again.json.error]).toEqual([409, "ballot_open"]);
      expect((await addChange(pool, d.id, { op: "rest_seat", orgRoleId: `head-cook-${seq}`, payload: {} })).ok).toBe(false);
      expect((await setDraftVision(pool, d.id, null)).ok).toBe(false);
      holders = new Set(["holder-1"]);
      expect((await call("POST", `/api/org/drafts/${d.id}/publish-by-power`, "holder-1")).status).toBe(409);
      expect((await call("POST", `/api/admin/org/drafts/${d.id}/publish`, "admin-1")).status).toBe(409);
      expect((await getDraft(pool, d.id))?.status).toBe("open");
      const read = await call("GET", `/api/org/drafts/${d.id}/decide`, "holder-1");
      expect(read.json.ballot?.status).toBe("open");
      expect(read.json.youMayPublish).toBe(false);
    });

    it("is for the holder alone when a role holds the power", async () => {
      holders = new Set(["holder-1"]);
      const d = await makeDraft();
      const m = await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "member-1");
      expect([m.status, m.json.error]).toEqual([403, "not_a_holder"]);
      expect((await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "holder-1")).status).toBe(200);
    });

    it("refuses while voting is off, and refuses a draft that could carry nothing", async () => {
      governance = false;
      const d = await makeDraft();
      expect((await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "member-1")).status).toBe(409);
      governance = true;
      const blocked = await makeDraft({ blocked: true });
      const r = await call("POST", `/api/org/drafts/${blocked.id}/put-to-village`, "member-1");
      expect([r.status, r.json.error]).toEqual([409, "draft_blocked"]);
    });
  });

  describe("the closer", () => {
    const open = async () => {
      const d = await makeDraft();
      const r = await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "member-1");
      expect(r.status).toBe(200);
      return { draft: d, ballot: (await ballotById(pool, r.json.ballot.id))! };
    };

    it("is registered for org_draft", () => {
      expect(typeof closers[ORG_DRAFT]?.execute).toBe("function");
    });

    it("publishes a carried draft exactly once, and a retry does nothing", async () => {
      const { draft, ballot } = await open();
      notices = [];
      const closer = closers[ORG_DRAFT];
      const settled = await closer.settle(ballot, "passed", "", "admin-1");
      expect(settled.held).toBeNull();
      expect((await getDraft(pool, draft.id))?.status).toBe("open");

      const first = await closer.execute!(ballot, "admin-1");
      expect(first.held).toBeNull();
      expect(first).toMatchObject({ held: null, applied: [`org_draft:${draft.id}`] });
      const after = await getDraft(pool, draft.id);
      expect(after?.status).toBe("published");
      const [[row]] = await pool.query<any[]>("SELECT published_by FROM org_drafts WHERE id = ?", [draft.id]); // module-review-ok: reading back the scratch schema this suite provisioned
      expect(row.published_by).toBe(ballot.id);
      expect(reloads).toBe(1);
      expect(notices.filter((n) => n.type === "role_appointed" && n.userId === "member-1")).toHaveLength(1);
      expect(notices.some((n) => n.userId === "member-1" && n.dedupeKey === `bal:${ballot.id}:org-draft-published`)).toBe(true);

      const second = await closer.execute!(ballot, "admin-1");
      expect(second).toMatchObject({ held: null, applied: [] });
      expect(reloads).toBe(1);
      expect(notices.filter((n) => n.type === "role_appointed")).toHaveLength(1);
    });

    it("leaves a draft the village did not carry open and unpublished", async () => {
      const { draft, ballot } = await open();
      notices = [];
      const out = await closers[ORG_DRAFT].settle(ballot, "failed", "It did not carry.", "admin-1");
      expect(out.proposerTold).toBe("member-1");
      expect((await getDraft(pool, draft.id))?.status).toBe("open");
      expect(reloads).toBe(0);
      expect(notices.map((n) => n.dedupeKey)).toEqual([`bal:${ballot.id}:org-draft-not-carried`]);
    });

    it("holds, and never throws, when the draft went away under the vote", async () => {
      const { draft, ballot } = await open();
      expect((await withdrawDraftBallot(pool, draft.id, "admin-1", true)).ok).toBe(true);
      expect((await withdrawDraft(pool, draft.id)).ok).toBe(true);
      const out = await closers[ORG_DRAFT].execute!(ballot, "admin-1");
      expect(out.held).toContain("withdrawn");
      expect((await getDraft(pool, draft.id))?.status).toBe("withdrawn");
    });
  });

  describe("withdrawing a draft withdraws its vote", () => {
    it("calls the open vote off", async () => {
      const d = await makeDraft();
      const opened = await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "member-1");
      const w = await withdrawDraftBallot(pool, d.id, "admin-1", false);
      expect(w).toMatchObject({ ok: true, ballotId: opened.json.ballot.id });
      expect((await ballotById(pool, opened.json.ballot.id))?.status).toBe("withdrawn");
      expect((await withdrawDraft(pool, d.id)).ok).toBe(true);
      // And the draft is free of the vote: a fresh one could open on another draft.
      expect((await withdrawDraftBallot(pool, d.id, "admin-1", false))).toMatchObject({ ok: true, ballotId: null });
    });

    it("keeps a vote people have answered unless the withdrawer may discard votes", async () => {
      const d = await makeDraft();
      const opened = await call("POST", `/api/org/drafts/${d.id}/put-to-village`, "member-1");
      expect((await castVote(pool, opened.json.ballot.id, "holder-1", "yes")).ok).toBe(true);
      const refused = await withdrawDraftBallot(pool, d.id, "member-1", false);
      expect(refused.ok).toBe(false);
      expect((await ballotById(pool, opened.json.ballot.id))?.status).toBe("open");
      expect((await withdrawDraftBallot(pool, d.id, "admin-1", true)).ok).toBe(true);
    });
  });

  describe("the admin panel's door, before and after a launch vote", () => {
    it("publishes for an admin before launch, as it always did", async () => {
      const d = await makeDraft();
      const r = await call("POST", `/api/admin/org/drafts/${d.id}/publish`, "admin-1");
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ success: true, applied: 3, reloaded: true });
    });

    it("refuses an admin without org.decide once a launch vote has carried", async () => {
      await recordGameStart(pool, { ballotId: "bal-launch-test", startedBy: "admin-1", note: "test launch" });
      expect((await readGameStart(pool)).ballotId).toBe("bal-launch-test");
      const d = await makeDraft();
      const r = await call("POST", `/api/admin/org/drafts/${d.id}/publish`, "admin-1");
      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({ error: "not_a_holder", ballotNeeded: true });
      expect((await getDraft(pool, d.id))?.status).toBe("open");
      expect((await call("GET", `/api/org/drafts/${d.id}/decide`, "admin-1")).json).toMatchObject({ launched: true, adminMayPublish: false });

      holders = new Set(["admin-1"]);
      expect((await call("POST", `/api/admin/org/drafts/${d.id}/publish`, "admin-1")).status).toBe(200);
      expect((await getDraft(pool, d.id))?.status).toBe("published");
    });
  });
});
