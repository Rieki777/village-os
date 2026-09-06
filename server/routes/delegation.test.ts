/**
 * The delegation routes, exercised as handlers against the real library and a
 * real MySQL (S5 harness).
 *
 * WHY NOT THE E2E HARNESS. What these four routes contain worth testing is the
 * shape of the answers and one refusal: that the reply names the member who
 * ACTUALLY decides rather than the one the caller named, that revoking says
 * whether there was anything to revoke, that concentration is served to any
 * signed-in member, and that a member with no voice is told so. None of that
 * needs a booted server, and the derivation underneath it is proven against
 * real rows in server/lib/delegation.test.ts.
 *
 * `register` is called against a fake Express that records handlers by method
 * and path, so what runs is the real registration and the real handler bodies,
 * over the real pool. The one thing this file cannot see is the module gate:
 * requireModule("governance") is mounted on the /api/governance prefix in
 * server/index.ts, above these handlers, so every path here is a 404 until a
 * founder turns the module on.
 *
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (house rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { castVote, openBallot } from "../lib/ballots";
import { acceptDelegations, liveDelegationOf, setDelegation } from "../lib/delegation";
import { register } from "./delegation";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the handlers `register` hands it. */
function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, handler: Handler) => {
    handlers.set(`${method} ${path}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") },
    handlers,
  };
}

/** Captures what a handler answered. */
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

const ROSTER = [
  { id: "u-ann", name: "Ann Rivers" },
  { id: "u-ben", name: "Ben Oak" },
  { id: "u-cai", name: "Cai Stone" },
];

/**
 * The gate context, with `ballot.vote` present or absent.
 *
 * The absence is expressed through the STAGE step, because that is where a
 * member who has not arrived yet is actually refused. `ballot.vote` unlocks at
 * the member stage, so a context standing below whatever stage the gate asks
 * for is the honest shape of "this account cannot vote today". A role grant
 * would answer the other way and prove nothing about the refusal.
 */
const ctxWith = (mayVote: boolean) => ({
  stageIndex: mayVote ? 5 : 0,
  stageIndexOf: () => (mayVote ? 0 : 5),
  roleCapabilities: [] as string[],
});

function depsFor(user: { id: string } | null, mayVote = true) {
  return {
    authedUser: async () => user,
    getPool: () => pool,
    capabilityCtx: async () => ctxWith(mayVote) as any,
    members: {
      all: async () => ROSTER as any,
      byId: async (id: string) => (ROSTER.find((m) => m.id === id) as any) ?? null,
    } as any,
    firstName: (name: string) => String(name || "Someone").split(" ")[0]!,
  };
}

const handlersFor = (user: { id: string } | null, mayVote = true) => {
  const { app, handlers } = collect();
  register(app, depsFor(user, mayVote) as any);
  return handlers;
};

const call = async (handler: Handler, req: any = {}) => {
  const { res, out } = makeRes();
  await handler({ body: {}, params: {}, query: {}, ...req }, res);
  return out;
};

const clearDelegations = async () => {
  await pool.query("DELETE FROM delegations WHERE delegator_id LIKE 'u-%'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

/**
 * Give a delegation AND have it accepted, which is what makes it carry
 * (0175). The cases below that are about what the routes SAY about a
 * carrying delegation say the handshake in one line; the handshake itself is
 * proven through the routes further down.
 */
const handed = async (delegator: string, delegate: string) => {
  const result = await setDelegation(pool, delegator, delegate);
  if (!result.ok) throw new Error(`delegation refused: ${result.error}`);
  const taken = await acceptDelegations(pool, delegate, delegator);
  if (taken.changed !== 1) throw new Error(`acceptance did not land: ${JSON.stringify(taken)}`);
};

describe.skipIf(!configured)("delegation routes (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("registers seven routes on the paths server/index.ts mounts", () => {
    const handlers = handlersFor({ id: "u-ann" });
    expect([...handlers.keys()].sort()).toEqual([
      "DELETE /api/governance/delegation",
      "GET /api/governance/concentration",
      "GET /api/governance/delegation",
      "POST /api/governance/delegation/accept",
      "POST /api/governance/delegation/decline",
      "POST /api/governance/delegation/uncast",
      "PUT /api/governance/delegation",
    ]);
  });

  it("refuses a stranger on every route", async () => {
    const handlers = handlersFor(null);
    for (const key of handlers.keys()) {
      const out = await call(handlers.get(key)!, { body: { delegateId: "u-ben" } });
      expect(out.status).toBe(401);
      expect(out.body).toEqual({ error: "auth_required" });
    }
  });

  it("tells a member with no voice that there is nothing here to hand on", async () => {
    await clearDelegations();
    const handlers = handlersFor({ id: "u-ann" }, false);
    const out = await call(handlers.get("PUT /api/governance/delegation")!, { body: { delegateId: "u-ben" } });
    expect(out.status).toBe(403);
    expect(String(out.body.error)).toContain("no voice here to hand on");
  });

  it("refuses a delegation to nobody, and to a member this village does not have", async () => {
    await clearDelegations();
    const handlers = handlersFor({ id: "u-ann" });
    const blank = await call(handlers.get("PUT /api/governance/delegation")!, { body: {} });
    expect(blank.status).toBe(400);
    const stranger = await call(handlers.get("PUT /api/governance/delegation")!, { body: { delegateId: "u-nobody" } });
    expect(stranger.status).toBe(404);
  });

  it("refuses the cycle with the sentence the member reads", async () => {
    await clearDelegations();
    await setDelegation(pool, "u-ben", "u-ann");
    const handlers = handlersFor({ id: "u-ann" });
    const out = await call(handlers.get("PUT /api/governance/delegation")!, { body: { delegateId: "u-ben" } });
    expect(out.status).toBe(400);
    expect(String(out.body.error)).toContain("in a circle");
  });

  it("names who actually decides, never only who was named", async () => {
    await clearDelegations();
    await handed("u-ben", "u-cai");
    const handlers = handlersFor({ id: "u-ann" });
    const put = await call(handlers.get("PUT /api/governance/delegation")!, { body: { delegateId: "u-ben" } });
    expect(put.status).toBe(200);
    // AN OFFER RESOLVES NOWHERE UNTIL IT IS ACCEPTED (0175). Ann named Ben,
    // and until Ben says yes nobody decides for her, which is what the answer
    // has to say or she will read a chain that is not carrying her voice.
    expect(put.body).toMatchObject({ delegateTo: "u-ben", delegateToName: "Ben", pending: true, hops: 0 });
    expect(String(put.body.message)).toContain("until they accept");

    await call(handlersFor({ id: "u-ben" }).get("POST /api/governance/delegation/accept")!, {
      body: { delegatorId: "u-ann" },
    });
    const mine = await call(handlers.get("GET /api/governance/delegation")!);
    expect(mine.body).toMatchObject({ delegateTo: "u-ben", accepted: true, decidedBy: "u-cai", hops: 2 });
    expect(mine.body.chain.map((c: any) => c.userId)).toEqual(["u-ann", "u-ben", "u-cai"]);
  });

  it("reports a member who decides for themselves as following nobody", async () => {
    await clearDelegations();
    const mine = await call(handlersFor({ id: "u-ann" }).get("GET /api/governance/delegation")!);
    expect(mine.body).toMatchObject({ delegateTo: null, decidedBy: null, hops: 0, votes: [] });
  });

  it("carries a delegated vote onto an open ballot and shows who was followed", async () => {
    await clearDelegations();
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "delegation-route-vote",
      title: "The route's own ballot",
      docMarkdown: "# As checked",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-cai",
      electorate: ROSTER.map((m) => ({ userId: m.id, weight: 1 })),
    });
    expect(opened.ok).toBe(true);
    const handlers = handlersFor({ id: "u-ann" });
    await call(handlers.get("PUT /api/governance/delegation")!, { body: { delegateId: "u-ben" } });
    await call(handlersFor({ id: "u-ben" }).get("POST /api/governance/delegation/accept")!, {
      body: { delegatorId: "u-ann" },
    });
    await castVote(pool, opened.ok ? opened.ballot.id : "", "u-ben", "yes");

    const mine = await call(handlers.get("GET /api/governance/delegation")!);
    const here = mine.body.votes.find((v: any) => v.ballotId === (opened.ok ? opened.ballot.id : ""));
    // THE ROW IS CAST AND THE CHOICE IS HELD BACK (0175). Ann reads that her
    // vote was cast and who decided it, and reads what it said at the close,
    // with everybody else's. Serving the choice here is the disclosure
    // channel acceptance and suppression exist to close.
    expect(here).toMatchObject({
      choice: null,
      choiceHidden: true,
      followedUserId: "u-ben",
      followedName: "Ben",
    });
    expect(String(here.sentence)).toContain("Cast, following Ben");

    // Taking it back says so, and says what it moved.
    const gone = await call(handlers.get("DELETE /api/governance/delegation")!);
    expect(gone.body).toMatchObject({ revoked: true, hadNone: false });
    expect(gone.body.openBallotsTouched).toBeGreaterThanOrEqual(1);
    const after = await call(handlers.get("GET /api/governance/delegation")!);
    expect(after.body.votes.find((v: any) => v.ballotId === (opened.ok ? opened.ballot.id : ""))).toBeUndefined();
  });

  it("says there was nothing to revoke without calling it a failure", async () => {
    await clearDelegations();
    const out = await call(handlersFor({ id: "u-cai" }).get("DELETE /api/governance/delegation")!);
    expect(out.body).toMatchObject({ success: true, revoked: false, hadNone: true });
  });

  it("serves concentration to any signed-in member, heaviest first, summing to the roster", async () => {
    await clearDelegations();
    await handed("u-ann", "u-ben");
    await handed("u-ben", "u-cai");
    const out = await call(handlersFor({ id: "u-ann" }).get("GET /api/governance/concentration")!);
    expect(out.status).toBe(200);
    expect(out.body.memberCount).toBe(3);
    expect(out.body.rows[0]).toMatchObject({ userId: "u-cai", name: "Cai", effectiveVotes: 3 });
    expect(out.body.rows.reduce((sum: number, r: any) => sum + r.effectiveVotes, 0)).toBe(3);
    expect(out.body.rows.find((r: any) => r.userId === "u-ann")).toMatchObject({
      effectiveVotes: 0,
      decidedBy: "u-cai",
      decidedByName: "Cai",
      hops: 2,
    });
  });

  // ── 0175: the handshake, the withheld bloc, and taking a vote back ────────

  it("offers a delegation rather than starting it, and shows the offer to both sides", async () => {
    await clearDelegations();
    const ann = handlersFor({ id: "u-ann" });
    const ben = handlersFor({ id: "u-ben" });
    const put = await call(ann.get("PUT /api/governance/delegation")!, { body: { delegateId: "u-ben" } });
    expect(put.body).toMatchObject({ pending: true, accepted: false });

    // The delegator sees that she is waiting.
    const hers = await call(ann.get("GET /api/governance/delegation")!);
    expect(hers.body).toMatchObject({ delegateTo: "u-ben", accepted: false, decidedBy: null, hops: 0 });

    // The delegate sees who is asking, by name.
    const his = await call(ben.get("GET /api/governance/delegation")!);
    expect(his.body).toMatchObject({ pendingToMe: 1, carriedByMe: 0 });
    expect(his.body.offeredToMe[0]).toMatchObject({ delegatorId: "u-ann", delegatorName: "Ann", accepted: false });

    // And nothing carries yet.
    expect((await liveDelegationOf(pool, "u-ann"))?.acceptedAt).toBeNull();
  });

  it("accepts, and says how many voices it now carries", async () => {
    await clearDelegations();
    await setDelegation(pool, "u-ann", "u-ben");
    await setDelegation(pool, "u-cai", "u-ben");
    const out = await call(handlersFor({ id: "u-ben" }).get("POST /api/governance/delegation/accept")!);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ accepted: 2, wasOffered: 2, hadNone: false });
    expect(out.body.delegators.map((d: any) => d.name).sort()).toEqual(["Ann", "Cai"]);
    expect((await liveDelegationOf(pool, "u-ann"))?.acceptedAt).not.toBeNull();
  });

  it("tells a delegate nothing was offered without calling it a failure", async () => {
    await clearDelegations();
    const out = await call(handlersFor({ id: "u-ben" }).get("POST /api/governance/delegation/accept")!);
    expect(out.body).toMatchObject({ success: true, accepted: 0, wasOffered: 0, hadNone: true });
    expect(String(out.body.message)).toContain("Nobody has offered you their voice");
  });

  it("refuses an account with no voice the right to carry somebody else's", async () => {
    await clearDelegations();
    await setDelegation(pool, "u-ann", "u-ben");
    const out = await call(handlersFor({ id: "u-ben" }, false).get("POST /api/governance/delegation/accept")!);
    expect(out.status).toBe(403);
    expect(String(out.body.error)).toContain("carry anybody's voice");
  });

  it("lets the delegate hand a voice back, and the seat is uncast again", async () => {
    await clearDelegations();
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "delegation-route-decline",
      title: "Handing it back",
      docMarkdown: "# As checked",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-cai",
      electorate: ROSTER.map((m) => ({ userId: m.id, weight: 1 })),
    });
    const ballotId = opened.ok ? opened.ballot.id : "";
    await handed("u-ann", "u-ben");
    await castVote(pool, ballotId, "u-ben", "yes");

    const out = await call(handlersFor({ id: "u-ben" }).get("POST /api/governance/delegation/decline")!, {
      body: { delegatorId: "u-ann" },
    });
    expect(out.body).toMatchObject({ declined: 1, wasLive: 1, hadNone: false });
    expect(await liveDelegationOf(pool, "u-ann")).toBeNull();
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT user_id FROM ballot_votes WHERE ballot_id = ?",
      [ballotId],
    );
    expect(rows.map((r: any) => String(r.user_id))).toEqual(["u-ben"]);
  });

  it("re-points a standing delegation and hands the new member nothing until they accept", async () => {
    await clearDelegations();
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "delegation-route-repoint",
      title: "Moving a voice",
      docMarkdown: "# As checked",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-cai",
      electorate: ROSTER.map((m) => ({ userId: m.id, weight: 1 })),
    });
    const ballotId = opened.ok ? opened.ballot.id : "";
    await handed("u-ann", "u-ben");
    await castVote(pool, ballotId, "u-ben", "yes");
    await castVote(pool, ballotId, "u-cai", "no");

    // Ann moves her voice to Cai through the route. Ben accepted; Cai has
    // not, and an acceptance never travels with a delegation. The answer says
    // pending, the seat Ben was deciding goes back to uncast, and Cai's own
    // choice does not appear in Ann's row.
    const moved = await call(handlersFor({ id: "u-ann" }).get("PUT /api/governance/delegation")!, {
      body: { delegateId: "u-cai" },
    });
    expect(moved.body).toMatchObject({ delegateTo: "u-cai", pending: true, accepted: false });
    expect(String(moved.body.message)).toContain("until they accept");
    expect(moved.body.openBallotsTouched).toBeGreaterThanOrEqual(1);
    expect((await liveDelegationOf(pool, "u-ann"))?.acceptedAt).toBeNull();
    const [during] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT user_id FROM ballot_votes WHERE ballot_id = ? ORDER BY user_id",
      [ballotId],
    );
    expect(during.map((r: any) => String(r.user_id))).toEqual(["u-ben", "u-cai"]);

    // Cai says yes, and only then does Ann's seat carry Cai's choice.
    const taken = await call(handlersFor({ id: "u-cai" }).get("POST /api/governance/delegation/accept")!, {
      body: { delegatorId: "u-ann" },
    });
    expect(taken.body).toMatchObject({ accepted: 1, wasOffered: 1 });
    const [after] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT choice, followed_user_id FROM ballot_votes WHERE ballot_id = ? AND user_id = 'u-ann'",
      [ballotId],
    );
    expect(after.length).toBe(1);
    expect(String(after[0].choice)).toBe("no");
    expect(String(after[0].followed_user_id)).toBe("u-cai");
  });

  it("takes a vote back on one ballot, ends the delegation, and says both", async () => {
    await clearDelegations();
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "delegation-route-uncast",
      title: "Taking it back",
      docMarkdown: "# As checked",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-cai",
      electorate: ROSTER.map((m) => ({ userId: m.id, weight: 1 })),
    });
    const ballotId = opened.ok ? opened.ballot.id : "";
    await handed("u-ann", "u-ben");
    await castVote(pool, ballotId, "u-ben", "yes");

    const ann = handlersFor({ id: "u-ann" });
    const out = await call(ann.get("POST /api/governance/delegation/uncast")!, { body: { ballotId } });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ removed: 1, hadNone: false, delegationEnded: true });
    expect(await liveDelegationOf(pool, "u-ann")).toBeNull();
    // A second press is answered honestly rather than as a failure.
    const again = await call(ann.get("POST /api/governance/delegation/uncast")!, { body: { ballotId } });
    expect(again.body).toMatchObject({ removed: 0, hadNone: true });
    // And a request that names no ballot is refused in words.
    const blank = await call(ann.get("POST /api/governance/delegation/uncast")!, { body: {} });
    expect(blank.status).toBe(400);
    expect(String(blank.body.error)).toContain("names the vote");
  });

  it("shows the withheld bloc and both denominators on a live ballot", async () => {
    await clearDelegations();
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "delegation-route-bloc",
      title: "Who is holding this up",
      docMarkdown: "# As checked",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-cai",
      // Two of the three accounts are on this roll, so the two denominators
      // are genuinely different numbers and a page cannot swap them unseen.
      electorate: [
        { userId: "u-ann", weight: 1 },
        { userId: "u-ben", weight: 1 },
      ],
    });
    const ballotId = opened.ok ? opened.ballot.id : "";
    await handed("u-ann", "u-ben");

    const out = await call(handlersFor({ id: "u-cai" }).get("GET /api/governance/concentration")!, {
      query: { ballotId },
    });
    expect(out.status).toBe(200);
    expect(out.body.labels).toMatchObject({
      electorate: "of the people asked on this vote",
      allAccounts: "of every account in the village",
    });
    expect(out.body.onBallot).toMatchObject({
      ballotId,
      stillOpen: true,
      carriesDelegations: true,
      electorateCount: 2,
      accountCount: 3,
      withheldSeats: 1,
    });
    const ben = out.body.onBallot.rows.find((r: any) => r.userId === "u-ben");
    expect(ben).toMatchObject({ name: "Ben", unvotedDelegations: 1, votedHere: false, effectiveVotesOnRoll: 2 });
    expect(ben.shareOfElectorate).toBeCloseTo(1, 10);
    expect(ben.effectiveVotesAllAccounts).toBe(2);
    expect(ben.shareOfAllAccounts).toBeCloseTo(2 / 3, 10);
    // With no ballot named the answer says so rather than inventing one.
    const wide = await call(handlersFor({ id: "u-cai" }).get("GET /api/governance/concentration")!);
    expect(wide.body.onBallot).toBeNull();
  });
});
