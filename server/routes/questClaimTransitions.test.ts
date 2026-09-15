/**
 * Every door that moves a quest claim, other than consent itself, driven
 * through the real handlers against a real MySQL.
 *
 * WHAT CONSENT ALREADY HAD. `claimsRepo.consentOnce` re-reads the claim under
 * its row lock and refuses unless the status is still one the caller named.
 * That compare-and-set is what stopped two stewards both consenting one claim.
 *
 * WHAT THE OTHER THREE DOORS DID NOT HAVE, and why each one could put the
 * ledger and `quest_claims` into states nothing reconciles:
 *
 *  - DECLINE never asked what it was declining. It called `claimsRepo.update`,
 *    which locked the row and then wrote `declined` over whatever it found. A
 *    steward whose queue page was loaded before a colleague consented could
 *    press Decline on work already witnessed and PAID: the ledger posting
 *    stood, the member's consented count fell, and because a declined claim
 *    hands the quest back, the member could claim it again and be paid a
 *    second time under a fresh claim id and a fresh idempotency key. No race is
 *    needed for that one. A stale tab is enough.
 *
 *  - SUBMIT read the member's claims through a plain SELECT and wrote several
 *    awaits later, through the same unguarded `update`. A consent committing
 *    inside that gap was written back to `submitted` with the ledger already
 *    paid, so the claim returned to the queue, and a second consent then met
 *    the ledger's `duplicate: true` and wrote a new figure and witness over a
 *    payment made for the first. That is the exact end state `consentOnce` was
 *    written to make impossible, reached through the door beside it.
 *
 *  - DELETE counted in-flight claims through a plain SELECT and deleted the
 *    quest several awaits later, with no lock. A claim taken inside that gap was
 *    left pointing at a quest that no longer exists, which is the state
 *    `openClaim`'s own header says its lock prevents, from the other side.
 *
 * HOW THE GAPS ARE HIT, AND WHY IT IS NOT A RACE TEST. A race test fires two
 * requests and hopes they interleave. These put the second actor inside the gap
 * on purpose: each route's one repository call between deciding and writing is
 * wrapped, and the other actor's REAL transaction commits there. Everything the
 * handler does next runs against the real repository and the real row, so what
 * is asserted is the code under test and never the wrapper. The same doors
 * fired concurrently, with no wrapper, are in
 * `server/repos/questClaimConcurrency.test.ts`.
 *
 * The consenting steward's transaction is `consentOnce` with a stub post. The
 * ledger's idempotency is `server/ledger.test.ts`'s subject; what matters here
 * is whether a claim that consent has resolved can be moved again.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import http from "node:http";
import os from "node:os";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { claimsRepo, questsRepo, type ClaimsRepo, type QuestsRepo } from "../repos/quests";
import { register as registerQuestRoutes } from "./quests";
import { register as registerQuestClaimRoutes } from "./questClaims";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questClaimTransitions.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

type Person = { id: string; name: string };
/** The member doing the work. */
const ADA: Person = { id: "u-ada", name: "Ada Wren" };
/** The steward who consents. */
const MARA: Person = { id: "u-mara", name: "Mara Voss" };
/** A second steward, looking at a page loaded before Mara acted. */
const TOMAS: Person = { id: "u-tomas", name: "Tomas Reyes" };

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let claims: ClaimsRepo;
let quests: QuestsRepo;

/** Who the next request is from. Every gate below reads this, as a session would. */
let signedIn: Person = ADA;
/** Every bell the routes rang, in order. */
let rung: Array<{ userId: string; type: string }> = [];
/**
 * The other actor, committed inside the gap. A test sets it; it runs once, at
 * the repository call the route makes between deciding and writing.
 */
let insideTheGap: (() => Promise<void>) | null = null;
const runTheGap = async () => {
  const other = insideTheGap;
  insideTheGap = null;
  if (other) await other();
};

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

const as = (person: Person) => {
  signedIn = person;
};

const addQuest = (id: string) =>
  quests.add({ id, title: "Tend the swale", gratitude: "50-100", status: "Open", tags: [], order: 1 });

const claimRow = async (id: string) => {
  const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, reading back what the routes wrote
    "SELECT status, amount, consented_by, note FROM quest_claims WHERE id = ?",
    [id],
  );
  return (rows[0] ?? null) as { status: string; amount: number | null; consented_by: string | null; note: string | null } | null;
};

/** Ada claims and hands in work, through the real routes. Answers the claim id. */
const claimAndSubmit = async (questId: string, note = "Dug the first ten metres.") => {
  as(ADA);
  const claimed = await call("POST", `/api/game/quests/${questId}/claim`);
  expect(claimed.status).toBe(200);
  const submitted = await call("POST", `/api/game/quests/${questId}/submit`, { note });
  expect(submitted.status).toBe(200);
  expect(submitted.body.status).toBe("submitted");
  return String(claimed.body.id);
};

/** A steward's consent, committed for real, with the ledger stubbed out. */
const consentAs = (steward: Person, claimId: string, amount: number) =>
  claims.consentOnce(
    claimId,
    ["submitted"],
    (c) => {
      c.status = "consented";
      c.amount = amount;
      c.resolvedAt = new Date().toISOString();
      c.consentedBy = steward.id;
    },
    async () => ({ ok: true }),
  );

describe.skipIf(!configured)("the doors that move a quest claim (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    claims = claimsRepo(pool);
    quests = questsRepo(pool);

    // SUBMIT's one read before its write: the member's own claims.
    const doorClaims: ClaimsRepo = {
      ...claims,
      forUser: async (userId) => {
        const seen = await claims.forUser(userId);
        await runTheGap();
        return seen;
      },
    };
    // DELETE's write. Whatever the route decided about in-flight claims, it
    // decided before this call.
    const doorQuests: QuestsRepo = {
      ...quests,
      remove: async (id) => {
        await runTheGap();
        return quests.remove(id);
      },
    };

    const deps: any = {
      isAdmin: async () => true,
      authedUser: async () => signedIn,
      adminActor: () => null,
      mayStillSee: async () => true,
      consentActor: async () => ({ ok: true, userId: signedIn.id, isAdminActor: false }),
      getPool: () => pool,
      uploadsDir: os.tmpdir(),
      members: { all: async () => [], byId: async () => null, update: async () => null },
      questsRepo: doorQuests,
      claimsRepo: doorClaims,
      crewsRepo: {},
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async (n: { userId: string; type: string }) => {
        rung.push({ userId: n.userId, type: n.type });
      },
      notifyAdmins: async () => {},
      stageOf: async () => "member",
      recordStageEvent: async () => {},
      addActivity: async () => {},
      dormantBadgeIds: async () => [],
      loadRoles: () => [],
      roleIdsFor: () => [],
      currentPatternId: () => null,
      questConsentRecipients: async () => [MARA.id, TOMAS.id],
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
    };
    const app = express();
    app.use(express.json());
    registerQuestRoutes(app, deps);
    registerQuestClaimRoutes(app, deps);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    signedIn = ADA;
    rung = [];
    insideTheGap = null;
  });

  // ── Decline ────────────────────────────────────────────────────────────────

  it("a stale queue cannot decline work that was already consented", async () => {
    await addQuest("q-decline-stale");
    const claimId = await claimAndSubmit("q-decline-stale");
    // Mara consents. Tomas's page still shows the claim waiting.
    expect((await consentAs(MARA, claimId, 60)).ok).toBe(true);
    rung = [];

    as(TOMAS);
    const late = await call("POST", `/api/admin/quest-claims/${claimId}/consent`, { approve: false });
    expect(late.status).toBe(409);
    expect(late.body.status).toBe("consented");

    // The record of what was witnessed and paid is untouched, and nobody is told
    // their claim was released.
    const row = await claimRow(claimId);
    expect(row?.status).toBe("consented");
    expect(Number(row?.amount)).toBe(60);
    expect(row?.consented_by).toBe(MARA.id);
    expect(rung.filter((n) => n.type === "quest_declined")).toHaveLength(0);

    // THE CONSEQUENCE THE GUARD EXISTS FOR: the quest is not handed back, so
    // the same work cannot be claimed and paid a second time.
    as(ADA);
    const again = await call("POST", "/api/game/quests/q-decline-stale/claim");
    expect(again.status).toBe(409);
  });

  it("declining work that is still waiting hands the quest back, as it always has", async () => {
    await addQuest("q-decline-waiting");
    const claimId = await claimAndSubmit("q-decline-waiting");

    as(TOMAS);
    const declined = await call("POST", `/api/admin/quest-claims/${claimId}/consent`, { approve: false });
    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe("declined");
    expect((await claimRow(claimId))?.status).toBe("declined");
    expect(rung).toContainEqual({ userId: ADA.id, type: "quest_declined" });

    as(ADA);
    expect((await call("POST", "/api/game/quests/q-decline-waiting/claim")).status).toBe(200);
  });

  // ── Submit ─────────────────────────────────────────────────────────────────

  it("evidence that arrives after a consent does not reopen the claim", async () => {
    await addQuest("q-submit-late");
    const claimId = await claimAndSubmit("q-submit-late", "The first account.");
    rung = [];

    // Ada corrects her link. Between the route reading her claims and writing
    // the new evidence, Mara consents.
    insideTheGap = async () => {
      expect((await consentAs(MARA, claimId, 60)).ok).toBe(true);
    };
    as(ADA);
    const late = await call("POST", "/api/game/quests/q-submit-late/submit", { note: "A corrected link." });
    expect(late.status).toBe(409);

    const row = await claimRow(claimId);
    expect(row?.status).toBe("consented");
    expect(Number(row?.amount)).toBe(60);
    expect(row?.consented_by).toBe(MARA.id);
    expect(row?.note).toBe("The first account.");
    // Nobody is summoned to consent work that is already consented.
    expect(rung.filter((n) => n.type === "quest_submitted")).toHaveLength(0);

    // And the claim is not back in the queue, so a second consent finds it
    // resolved instead of writing a new figure over the first payment.
    expect(await consentAs(TOMAS, claimId, 90)).toMatchObject({ ok: false, reason: "status", status: "consented" });
    expect(Number((await claimRow(claimId))?.amount)).toBe(60);
  });

  it("a member may still correct evidence nobody has consented yet", async () => {
    await addQuest("q-submit-again");
    const claimId = await claimAndSubmit("q-submit-again", "The first account.");

    as(ADA);
    const again = await call("POST", "/api/game/quests/q-submit-again/submit", { note: "The second account." });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("submitted");
    const row = await claimRow(claimId);
    expect(row?.status).toBe("submitted");
    expect(row?.note).toBe("The second account.");
  });

  // ── Delete ─────────────────────────────────────────────────────────────────

  it("a claim taken while the delete was deciding stops the delete", async () => {
    await addQuest("q-delete-race");
    // Nothing is in flight when the admin presses Delete. Ada's claim lands
    // after the route has looked and before the row is gone.
    insideTheGap = async () => {
      const taken = await claims.openClaim({
        id: "claim-delete-race",
        questId: "q-delete-race",
        questTitle: "Tend the swale",
        userId: ADA.id,
        userName: ADA.name,
        status: "claimed",
        claimedAt: new Date().toISOString(),
        artifactUrl: "",
        note: "",
      });
      expect(taken.ok).toBe(true);
    };
    const removed = await call("DELETE", "/api/admin/quests/q-delete-race");
    expect(removed.status).toBe(409);
    expect(removed.body.openClaims).toBe(1);

    // The quest is still there for the claim to point at.
    expect(await quests.byId("q-delete-race")).not.toBeNull();
    expect((await claimRow("claim-delete-race"))?.status).toBe("claimed");
  });

  it("a quest with work already in flight is refused with the count", async () => {
    await addQuest("q-delete-busy");
    as(ADA);
    expect((await call("POST", "/api/game/quests/q-delete-busy/claim")).status).toBe(200);

    const removed = await call("DELETE", "/api/admin/quests/q-delete-busy");
    expect(removed.status).toBe(409);
    expect(removed.body.openClaims).toBe(1);
    expect(await quests.byId("q-delete-busy")).not.toBeNull();
  });

  it("a quest whose claims are all settled still deletes, and the settled claims survive", async () => {
    await addQuest("q-delete-settled");
    const claimId = await claimAndSubmit("q-delete-settled");
    expect((await consentAs(MARA, claimId, 60)).ok).toBe(true);

    const removed = await call("DELETE", "/api/admin/quests/q-delete-settled");
    expect(removed.status).toBe(200);
    expect(await quests.byId("q-delete-settled")).toBeNull();
    // Witnessed and paid work outlives the board entry (drizzle/0196).
    expect((await claimRow(claimId))?.status).toBe("consented");
  });
});
