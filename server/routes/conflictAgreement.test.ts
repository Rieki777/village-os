/**
 * THE CONFLICT AGREEMENT over real HTTP, against a real database.
 *
 * What a person meets, door by door:
 *   - the public view: roles only, and it refuses to print a member's name;
 *   - the members' view: the whole agreement, for members and admins only;
 *   - the founders' pen before the Birthing, and the village's ballot after
 *     it, each refusing the other's side;
 *   - a carried ballot landing the agreement through the cached handle;
 *   - the ombuds door keeping a pointer and never a word;
 *   - an old exit policy reading through the agreement once there is one, with
 *     its stored document never rewritten, and the launch checklist's conflict
 *     door judging the same fields.
 *
 * The exit routes are registered beside this module, the way server/index.ts
 * registers both, with `readExitPolicy` built exactly as it is there.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type CapabilityCtx } from "../../shared/capabilities";
import { CONFLICT_AGREEMENT, CONFLICT_AGREEMENT_KEY } from "../../shared/conflictAgreement";
import { dbDocument } from "../repos/store-db";
import { appendToConfigList, readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { recordGameStart } from "../lib/gameStart";
import { withPolicyDefaults } from "../lib/exitPolicy";
import {
  AGREEMENT_BALLOT_NOW,
  AGREEMENT_FOUNDERS_NOW,
  AGREEMENT_MEMBERS_ONLY,
  CONFLICT_AGREEMENT_PROPOSAL_KEY,
  NAME_WITHHELD,
  OMBUDS_ASKS_KEY,
  RESTORATIVE_IN_AGREEMENT,
  withConflictAgreement,
} from "../lib/conflictAgreement";
import { conflictAgreementCloser } from "../lib/conflictAgreementCloser";
import { ballotById } from "../lib/ballots";
import { conflictDoorFacts } from "../lib/launchGovernance";
import { register } from "./conflictAgreement";
import { register as registerExits } from "./exits";

const configured = testDbConfigured();
if (!configured) console.warn("[conflictAgreement.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

type Person = { id: string; name: string; role: string; membershipGranted: boolean; roleCapabilities: string[] };

/** The people in this village, by the bearer token each one sends. */
const PEOPLE: Record<string, Person> = {
  member: { id: "ca-member", name: "Mara Lind", role: "member", membershipGranted: true, roleCapabilities: [] },
  proposer: { id: "ca-proposer", name: "Tomás Vey", role: "member", membershipGranted: true, roleCapabilities: ["proposal.open"] },
  admin: { id: "ca-admin", name: "Moss Fielding", role: "admin", membershipGranted: true, roleCapabilities: [] },
  stranger: { id: "ca-stranger", name: "Rook Talbot", role: "member", membershipGranted: false, roleCapabilities: [] },
};

const ROLES = [
  { id: "ca-care", name: "Care Holder" },
  { id: "ca-cover", name: "Care Cover" },
  { id: "ca-stewards", name: "Stewards" },
];

/** A policy exactly as a release before the conflict-door fields saved it. */
const OLD_POLICY = {
  placeholder: true,
  voluntary: { noticePeriodDays: 30, valuationMethod: "Ours", unwindSteps: ["Hand off your roles"] },
  involuntary: { decidingDomainId: "", appealDomainId: "", process: "Ours too" },
  restorative: { intakeContactRole: "ca-care", steps: ["We talk first", "Then we ask the care holder"] },
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
let exitPolicyRepo: ReturnType<typeof dbDocument<any>>;
let agreementRepo: ReturnType<typeof dbDocument<any>>;
const hits = new Map<string, number>();
const notices: Array<{ userId: string; type: string; title: string; body?: string | null }> = [];
const activity: string[] = [];

const who = (req: express.Request) => PEOPLE[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;
const ctxFor = (p: Person): CapabilityCtx => ({
  stageIndex: 0,
  stageIndexOf: () => -1,
  roleCapabilities: p.roleCapabilities,
  isAdmin: p.role === "admin" || p.role === "founder",
  isFounder: p.role === "founder",
});
const readExitPolicy = () => withConflictAgreement(withPolicyDefaults(exitPolicyRepo.get()), agreementRepo.get());

async function call(method: string, route: string, as: keyof typeof PEOPLE | null, body?: unknown) {
  const r = await fetch(`${base}${route}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

/** An agreement a village could adopt. Each case changes what it needs. */
const agreement = (over: Record<string, unknown> = {}) => ({
  steps: [
    { what: "We talk it out", whoInRoom: "the two of us" },
    { what: "Then we ask Mara to sit with us", whoInRoom: "the two of us and the Care Holder" },
  ],
  careRole: "ca-care",
  coverRole: "ca-cover",
  replyHours: 48,
  outsideContacts: [{ id: "oc-1", name: "Ada Quill", organisation: "Cohort Care", role: "Ombuds", howToReach: "ada@example.invalid" }],
  whenPowerInvolved: { roleId: "ca-stewards", outsideContactId: "", words: "" },
  safetyContacts: [{ name: "Night crisis line", howToReach: "0800 000 000", when: "" }],
  consequencesLadder: { rungs: [{ rung: 1, words: "We ask for a change." }, { rung: 2, words: "We write it down." }], appeal: "Three members not involved hear it." },
  practices: [{ name: "Beginning Anew", when: "Each new moon" }],
  reviewDate: "2030-01-15",
  ...over,
});

/** Put the village back where every case starts: no agreement, the old policy, not started. */
async function reset() {
  await pool.query("DELETE FROM app_config WHERE config_key IN (?,?,?,?,?)", [ // module-review-ok: each case starts from the same village, on the scratch schema this suite provisioned
    CONFLICT_AGREEMENT_KEY,
    CONFLICT_AGREEMENT_PROPOSAL_KEY,
    OMBUDS_ASKS_KEY,
    "game-start",
    "exit-policy",
  ]);
  await pool.query("DELETE FROM ballots WHERE subject_type = ?", [CONFLICT_AGREEMENT]); // module-review-ok: fixture cleanup on the scratch schema this suite provisioned
  await writeConfigDocument(pool, "exit-policy", OLD_POLICY);
  await exitPolicyRepo.load();
  await agreementRepo.load();
  hits.clear();
  notices.length = 0;
  activity.length = 0;
}

describe.skipIf(!configured)("the conflict agreement's doors", () => {
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
        "INSERT INTO roles (id, name, capabilities) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
        [r.id, r.name, JSON.stringify([])],
      );
    }
    exitPolicyRepo = dbDocument<any>(pool, "exit-policy", {} as any);
    agreementRepo = dbDocument<any>(pool, CONFLICT_AGREEMENT_KEY, null as any);

    const app = express();
    app.use(express.json());
    const isAdmin = async (req: express.Request) => ["admin", "founder"].includes(who(req)?.role ?? "");
    const common = {
      authedUser: async (req: express.Request) => who(req),
      isAdmin,
      adminActor: (req: express.Request) => {
        const p = who(req);
        return p ? { id: p.id, name: p.name } : null;
      },
      hasMembership: (user: any) => !!user?.membershipGranted,
      getPool: () => pool,
      members: { all: async () => Object.values(PEOPLE) } as any,
      loadRoles: () => ROLES,
      notify: async (n: any) => {
        notices.push(n);
        return { fresh: true } as any;
      },
      roleHolders: () => [{ roleId: "ca-care", userId: "ca-admin", termEndsAt: null }],
    };
    register(app, {
      ...common,
      capabilityCtx: async (user: any) => ctxFor(user),
      firstName: (n: string) => String(n ?? "").split(" ")[0],
      overLimit: async (bucket: string, max: number) => {
        const n = (hits.get(bucket) ?? 0) + 1;
        hits.set(bucket, n);
        return n > max;
      },
      weightModeNow: () => ({ mode: "equal", token: null }),
      agreement: agreementRepo,
      readExitPolicy,
      buildElectorate: async () => Object.values(PEOPLE).filter((p) => p.membershipGranted).map((p) => ({ userId: p.id, weight: 1 })),
      addActivity: async (_kind: string, text: string) => {
        activity.push(text);
      },
    } as any);
    registerExits(app, {
      ...common,
      circlesRepo: { all: () => [] },
      roleIdsFor: () => [],
      notifyAdmins: async () => {},
      agreementStored: () => agreementRepo.exists(),
      readExitPolicy,
      exitPolicyRepo,
    } as any);
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

  beforeEach(reset);

  describe("who may read", () => {
    it("the full view asks a visitor to sign in and tells an account the village has not admitted what it can read", async () => {
      expect((await call("GET", "/api/conflict-agreement", null)).status).toBe(401);
      const r = await call("GET", "/api/conflict-agreement", "stranger");
      expect(r).toEqual({ status: 403, body: { error: AGREEMENT_MEMBERS_ONLY } });
    });

    it("a member reads the agreement their old exit policy describes, with who holds each role today", async () => {
      const r = await call("GET", "/api/conflict-agreement", "member");
      expect(r.status).toBe(200);
      expect(r.body.stored).toBe(false);
      expect(r.body.agreement.steps.map((s: any) => s.what)).toEqual(OLD_POLICY.restorative.steps);
      expect(r.body.agreement.careRole).toBe("ca-care");
      expect(r.body.roles.find((x: any) => x.id === "ca-care").liveHolders).toBe(1);
      expect(r.body.pen).toEqual({ how: "founders", mayWrite: false, mayPropose: false });
      expect((await call("GET", "/api/conflict-agreement", "admin")).body.pen.mayWrite).toBe(true);
    });

    it("the public view says there is no agreement yet, until there is one", async () => {
      expect((await call("GET", "/api/conflict-agreement/public", null)).body).toEqual({ stored: false, agreement: null });
    });
  });

  describe("the public view names roles, never people", () => {
    it("refuses to print a member's name, the outside contact's person, or any safety contact", async () => {
      expect((await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement(), adopt: true })).status).toBe(200);
      const r = await call("GET", "/api/conflict-agreement/public", null);
      expect(r.status).toBe(200);
      const view = r.body.agreement;
      expect(view.withheld).toBe(true);
      expect(view.steps[0]).toEqual({ what: "We talk it out", whoInRoom: "the two of us" });
      expect(view.steps[1].what).toBeNull();
      expect(view.careRole).toEqual({ id: "ca-care", name: "Care Holder" });
      expect(view.outsideContacts).toEqual([{ id: "oc-1", label: "Ombuds at Cohort Care" }]);
      const text = JSON.stringify(r.body);
      for (const hidden of ["Mara", "Ada Quill", "ada@example.invalid", "Night crisis line", "ca-admin"]) expect(text, hidden).not.toContain(hidden);
    });

    it("the exit policy, read by anybody who is not a member, carries the same rule", async () => {
      await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement(), adopt: true });
      for (const as of [null, "stranger"] as const) {
        const r = (await call("GET", "/api/exit-policy", as)).body.policy.restorative;
        expect(r.steps[1], String(as)).toBe(NAME_WITHHELD);
        expect(r.outsideContact, String(as)).toEqual({ name: "", organisation: "Ombuds, Cohort Care", howToReach: "" });
      }
      const m = (await call("GET", "/api/exit-policy", "member")).body.policy.restorative;
      expect(m.steps[1]).toBe("Then we ask Mara to sit with us. In the room: the two of us and the Care Holder");
      expect(m.outsideContact.name).toBe("Ada Quill");
    });
  });

  describe("read-through: an old exit policy, then an agreement", () => {
    it("reads the old policy unchanged, then the agreement's fields, and never rewrites the stored policy", async () => {
      const before = (await call("GET", "/api/exit-policy", "member")).body.policy.restorative;
      expect(before.steps).toEqual(OLD_POLICY.restorative.steps);
      expect(before.intakeContactRole).toBe("ca-care");
      expect(before.replyHours).toBeNull();

      await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement({ replyHours: 36 }) });
      const after = (await call("GET", "/api/exit-policy", "member")).body.policy;
      expect(after.restorative.replyHours).toBe(36);
      expect(after.restorative.coverRole).toBe("ca-cover");
      expect(after.restorative.steps[0]).toBe("We talk it out. In the room: the two of us");
      expect(after.voluntary.unwindSteps).toEqual(OLD_POLICY.voluntary.unwindSteps);

      expect(await readConfigDocument(pool, "exit-policy")).toEqual(OLD_POLICY);
    });

    it("the launch checklist's conflict door judges the agreement's fields", async () => {
      expect((await conflictDoorFacts(pool)).replyHours).toBeNull();
      await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement({ replyHours: 36 }) });
      const facts = await conflictDoorFacts(pool);
      expect(facts.replyHours).toBe(36);
      expect(facts.intakeRoleId).toBe("ca-care");
      expect(facts.outsideContact.name).toBe("Ada Quill");
    });

    it("the exit policy's own save keeps the block the agreement holds, and refuses to change it", async () => {
      await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement() });
      const served = readExitPolicy() as any;
      const same = await call("PUT", "/api/admin/exit-policy", "admin", { ...served, voluntary: { ...served.voluntary, noticePeriodDays: 14 } });
      expect(same.status).toBe(200);
      const stored = await readConfigDocument<any>(pool, "exit-policy");
      expect(stored.voluntary.noticePeriodDays).toBe(14);
      expect(stored.restorative.steps).toEqual(OLD_POLICY.restorative.steps);

      const changed = await call("PUT", "/api/admin/exit-policy", "admin", { ...served, restorative: { ...served.restorative, replyHours: 2 } });
      expect(changed).toEqual({ status: 409, body: { error: "restorative_in_agreement", message: RESTORATIVE_IN_AGREEMENT } });
    });
  });

  describe("the consequence pen", () => {
    it("before the Birthing: an admin writes, a member cannot, and nobody opens a vote", async () => {
      expect((await call("PUT", "/api/admin/conflict-agreement", null, { agreement: agreement() })).status).toBe(401);
      expect((await call("PUT", "/api/admin/conflict-agreement", "member", { agreement: agreement() })).status).toBe(401);
      const refused = await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement({ reviewDate: "" }), adopt: true });
      expect(refused).toMatchObject({ status: 400, body: { frame: "adoption" } });
      expect(agreementRepo.exists()).toBe(false);

      const ok = await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement(), adopt: true });
      expect(ok.status).toBe(200);
      expect(ok.body.agreement).toMatchObject({ version: 1, adoptedHow: "founders" });
      expect(ok.body.agreement.adoptedBy).toBeUndefined();
      expect((await readConfigDocument<any>(pool, CONFLICT_AGREEMENT_KEY))?.adoptedBy).toBe("ca-admin");

      const vote = await call("POST", "/api/governance/conflict-agreement-changes", "proposer", { agreement: agreement({ replyHours: 12 }) });
      expect(vote).toEqual({ status: 409, body: { error: AGREEMENT_FOUNDERS_NOW } });
    });

    it("after the Birthing: the admin is sent to the vote, a member without proposal.open is refused, and a holder opens it", async () => {
      await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement(), adopt: true });
      await recordGameStart(pool, { ballotId: "b-birth", startedBy: "ca-admin", note: "The village began." });

      expect(await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement({ replyHours: 12 }), adopt: true })).toEqual({
        status: 409,
        body: { error: AGREEMENT_BALLOT_NOW, frame: null },
      });
      expect((await call("POST", "/api/governance/conflict-agreement-changes", "member", { agreement: agreement({ replyHours: 12 }) })).status).toBe(403);
      expect((await call("POST", "/api/governance/conflict-agreement-changes", "proposer", { agreement: agreement() })).body.error).toBe(
        "That is what the agreement already says.",
      );
      expect((await call("POST", "/api/governance/conflict-agreement-changes", "proposer", { agreement: agreement({ reviewDate: "" }) })).status).toBe(400);

      const opened = await call("POST", "/api/governance/conflict-agreement-changes", "proposer", { agreement: agreement({ replyHours: 12 }) });
      expect(opened.status).toBe(200);
      const ballot = await ballotById(pool, opened.body.ballot.id);
      expect(ballot?.subjectType).toBe(CONFLICT_AGREEMENT);
      // The structural tier, at least 80 and 50, whatever the village's own dials say.
      expect(ballot!.unityPct).toBeGreaterThanOrEqual(80);
      expect(ballot!.quorumPct).toBeGreaterThanOrEqual(50);
      // Written in the same transaction as the ballot.
      const proposal = await readConfigDocument<any>(pool, CONFLICT_AGREEMENT_PROPOSAL_KEY);
      expect(proposal.ballotId).toBe(ballot!.id);
      expect(proposal.agreement.replyHours).toBe(12);
      expect(notices.filter((n) => n.type === "ballot_opened").map((n) => n.userId).sort()).toEqual(["ca-admin", "ca-member"]);
      expect(activity).toContain("The village is deciding whether to change its conflict agreement.");
      // The agreement itself has not moved yet.
      expect(agreementOfRepo().replyHours).toBe(48);

      const second = await call("POST", "/api/governance/conflict-agreement-changes", "proposer", { agreement: agreement({ replyHours: 6 }) });
      expect(second.status).toBe(409);
      expect(second.body.ballotId).toBe(ballot!.id);
    });

    it("a carried ballot lands the agreement through the cached handle, and a failed one changes nothing", async () => {
      await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement(), adopt: true });
      await recordGameStart(pool, { ballotId: "b-birth", startedBy: "ca-admin", note: "The village began." });
      const opened = await call("POST", "/api/governance/conflict-agreement-changes", "proposer", { agreement: agreement({ replyHours: 12 }) });
      const ballot = (await ballotById(pool, opened.body.ballot.id))!;
      const closer = conflictAgreementCloser({
        getPool: () => pool,
        agreement: agreementRepo,
        loadRoles: () => ROLES,
        notify: async (n) => {
          notices.push(n);
        },
        notifyAdmins: async () => {},
        addActivity: async (_k, text) => {
          activity.push(text);
        },
        recordAudit: () => {},
        ballotLink: (b) => `/decisions/${b.id}`,
      });

      const failed = await closer(ballot, "failed", "Too few agreed.", "system");
      expect(failed.applied).toEqual([]);
      expect(agreementOfRepo().replyHours).toBe(48);

      const other = await closer({ ...ballot, id: "some-other-ballot" }, "passed", "", "system");
      expect(other.held).toContain("was not recorded against it");
      expect(agreementOfRepo().replyHours).toBe(48);

      const carried = await closer(ballot, "passed", "", "system");
      expect(carried.applied).toEqual(["conflict-agreement"]);
      expect(agreementOfRepo()).toMatchObject({ replyHours: 12, version: 2, adoptedHow: "ballot", adoptedBy: `ballot:${ballot.id}` });
      // Every reader sees it at once, with no reload.
      expect((await call("GET", "/api/exit-policy", "member")).body.policy.restorative.replyHours).toBe(12);
      expect((await readConfigDocument<any>(pool, CONFLICT_AGREEMENT_KEY)).replyHours).toBe(12);
    });
  });

  describe("the ombuds door", () => {
    it("keeps who asked, when and which contact, answers with how to reach them, and stores no words", async () => {
      await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement(), adopt: true });
      expect((await call("POST", "/api/conflict-agreement/ombuds-asks", null, { contactId: "oc-1" })).status).toBe(401);
      expect((await call("POST", "/api/conflict-agreement/ombuds-asks", "stranger", { contactId: "oc-1" })).status).toBe(403);

      const words = await call("POST", "/api/conflict-agreement/ombuds-asks", "member", { contactId: "oc-1", message: "He shouted at me in the kitchen" });
      expect(words.status).toBe(400);
      expect(await readConfigDocument(pool, OMBUDS_ASKS_KEY)).toBeNull();

      const asked = await call("POST", "/api/conflict-agreement/ombuds-asks", "member", { contactId: "oc-1" });
      expect(asked.status).toBe(201);
      expect(asked.body.contact).toEqual({ id: "oc-1", name: "Ada Quill", organisation: "Cohort Care", role: "Ombuds", howToReach: "ada@example.invalid" });

      const stored = await readConfigDocument<any>(pool, OMBUDS_ASKS_KEY);
      expect(stored.asks).toHaveLength(1);
      expect(Object.keys(stored.asks[0]).sort()).toEqual(["askedAt", "askedBy", "contactId", "contactLabel", "id"]);
      expect(stored.asks[0]).toMatchObject({ askedBy: "ca-member", contactId: "oc-1", contactLabel: "Ombuds at Cohort Care" });
      expect(JSON.stringify(stored)).not.toContain("shouted");
      expect(notices).toEqual([]);

      const mine = (await call("GET", "/api/conflict-agreement", "member")).body.yourAsks;
      expect(mine.map((a: any) => a.contactId)).toEqual(["oc-1"]);
      expect((await call("GET", "/api/conflict-agreement", "admin")).body.yourAsks).toEqual([]);
    });

    it("reaches the outside contact an old exit policy names, before any agreement is saved", async () => {
      await writeConfigDocument(pool, "exit-policy", {
        ...OLD_POLICY,
        restorative: { ...OLD_POLICY.restorative, outsideContact: { name: "Ada Quill", organisation: "Cohort Care", howToReach: "ada@x" } },
      });
      await exitPolicyRepo.load();
      const asked = await call("POST", "/api/conflict-agreement/ombuds-asks", "member", { contactId: "oc-1" });
      expect(asked.status).toBe(201);
      expect(asked.body.contact.howToReach).toBe("ada@x");
      expect(agreementRepo.exists()).toBe(false);
    });

    it("takes three asks a day from one member", async () => {
      await call("PUT", "/api/admin/conflict-agreement", "admin", { agreement: agreement(), adopt: true });
      for (let i = 0; i < 3; i++) expect((await call("POST", "/api/conflict-agreement/ombuds-asks", "member", { contactId: "oc-1" })).status).toBe(201);
      expect((await call("POST", "/api/conflict-agreement/ombuds-asks", "member", { contactId: "oc-1" })).status).toBe(429);
    });

    it("loses no pointer when many asks land at once", async () => {
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          appendToConfigList(pool, OMBUDS_ASKS_KEY, "asks", { id: `oa-${i}`, askedBy: `m-${i}`, askedAt: "t", contactId: "oc-1", contactLabel: "x" }),
        ),
      );
      const stored = await readConfigDocument<any>(pool, OMBUDS_ASKS_KEY);
      expect(stored.asks.map((a: any) => a.id).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `oa-${i}`).sort());
      expect(typeof stored.asks[0]).toBe("object");
    });
  });
});

function agreementOfRepo(): any {
  return agreementRepo.get();
}

// Keeps the capability decision this suite relies on honest: the proposer
// passes `proposal.open` as a member, the plain member does not.
describe.skipIf(!configured)("the fixture's own people", () => {
  it("only the proposer holds proposal.open as a member", () => {
    expect(capabilityDecision("proposal.open", { ...ctxFor(PEOPLE.proposer), isAdmin: false }).allowed).toBe(true);
    expect(capabilityDecision("proposal.open", { ...ctxFor(PEOPLE.member), isAdmin: false }).allowed).toBe(false);
  });
});
