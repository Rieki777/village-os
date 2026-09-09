/**
 * Delegation, proven against a real MySQL (S5 harness) and, where the rule is
 * arithmetic, proven with no database at all.
 *
 * The rules pinned here are the ones the whole feature turns on:
 *
 *  - A DELEGATION CARRIES NOTHING UNTIL THE DELEGATE ACCEPTS IT (0175). The
 *    cases below that are about what a carrying delegation does say it in one
 *    line through `handed`; the acceptance rule itself is proven on its own.
 *  - WHILE A BALLOT IS OPEN AND CHOICES ARE HIDDEN, a delegated row reports
 *    that it was cast and who decided it, never what it said.
 *  - TAKING A VOTE BACK removes the row and the seat is not cast again, so
 *    quorum falls.
 *  - NO DELEGATED ROW EXISTS on a subject that asks every seat to say yes.
 *  - A cycle is refused AT CREATION, walking the chain, and the guard reads
 *    OFFERS too. A to B to C to A never reaches the table, because with
 *    transitive chains a cycle is an infinite loop in the routine that counts
 *    a season's votes.
 *  - Resolution is TRANSITIVE, and the delegator sees who they ACTUALLY
 *    followed: A named B, C decided, A reads C.
 *  - The delegator's row carries the delegate's CHOICE and `followed_user_id`,
 *    and the weight never moves.
 *  - A member who votes for themselves OVERRIDES and keeps their own row, both
 *    before and after the delegate votes.
 *  - A delegate who does not vote leaves the delegator's vote UNCAST. No row,
 *    counted as not voted, never an abstain.
 *  - Changing or revoking a delegation while a ballot is open RE-DERIVES that
 *    member's row from the new chain, and everybody downstream of them.
 *  - The concentration counts SUM to the roster, which is what makes the
 *    shares readable as a share of anything.
 *
 * No TEST_DATABASE_URL: the database cases skip loudly, never pass hollowly
 * (house rule). The pure cases run either way.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { quorumPctOf } from "../../shared/governanceEngine";
import {
  awaitingVote,
  castVote,
  openBallot,
  ownVoteView,
  talliesFor,
  uncastDelegatedVote,
  voteCount,
  voteOf,
  votesFor,
  type OpenBallotInput,
} from "./ballots";
import {
  acceptDelegations,
  applyDelegatedVotes,
  applyDelegatedVotesEverywhere,
  ballotDelegationView,
  concentrationOver,
  declineDelegations,
  delegationCarriesOn,
  delegationOf,
  delegationProblem,
  delegationsToMe,
  effectiveConcentration,
  hiddenChoiceView,
  isCarrying,
  liveDelegationOf,
  resolveDelegate,
  resolveFinal,
  revokeDelegation,
  setDelegation,
  unvotedDelegationsOn,
  votesFollowedBy,
} from "./delegation";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

const mapOf = (pairs: [string, string][]) => new Map<string, string>(pairs);

/** A fresh subject ref per ballot, so open_key never collides between cases. */
const openOne = async (over: Partial<OpenBallotInput> = {}) => {
  const result = await openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `delegation-test-${++n}`,
    title: `Ballot ${n}`,
    docMarkdown: "# The document as checked",
    method: "custom",
    weightMode: "equal",
    unityPct: 80,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-proposer",
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
      { userId: "u-c", weight: 1 },
    ],
    ...over,
  });
  if (!result.ok) throw new Error(`ballot refused to open: ${result.error}`);
  return result.ballot;
};

/** Clear every delegation, so one case never reads another's chain. */
const clearDelegations = async () => {
  await pool.query("DELETE FROM delegations WHERE delegator_id LIKE 'u-%'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

/**
 * GIVE A DELEGATION AND HAVE IT ACCEPTED, which is what makes it carry (0175).
 *
 * Two acts, said in one line, because most cases here are about what a
 * carrying delegation DOES and would read as noise if each of them spelled
 * the handshake out. Both halves are asserted, so a case using this helper
 * fails loudly rather than silently proving nothing when either half stops
 * working. The acceptance rule itself is proven directly further down.
 */
const handed = async (delegator: string, delegate: string) => {
  const result = await setDelegation(pool, delegator, delegate);
  if (!result.ok) throw new Error(`delegation refused: ${result.error}`);
  const taken = await acceptDelegations(pool, delegate, delegator);
  if (taken.changed !== 1) throw new Error(`acceptance did not land: ${JSON.stringify(taken)}`);
  return result;
};

describe("delegation chains (no database)", () => {
  it("refuses to delegate to yourself", () => {
    expect(delegationProblem(mapOf([]), "u-a", "u-a")).toContain("already decide for yourself");
  });

  it("refuses a delegation that names nobody", () => {
    expect(delegationProblem(mapOf([]), "u-a", "")).toContain("names the member");
  });

  it("refuses the direct swap, A to B while B follows A", () => {
    const problem = delegationProblem(mapOf([["u-b", "u-a"]]), "u-a", "u-b");
    expect(problem).toContain("delegated their voice to you");
  });

  it("refuses the three-hop cycle at creation: A to B to C, then C to A", () => {
    // A follows B, B follows C. C asking to follow A closes the loop.
    const map = mapOf([
      ["u-a", "u-b"],
      ["u-b", "u-c"],
    ]);
    const problem = delegationProblem(map, "u-c", "u-a");
    expect(problem).toContain("comes back to you");
    // And every delegation that does NOT close a loop is still allowed.
    expect(delegationProblem(map, "u-d", "u-c")).toBeNull();
  });

  it("resolves transitively to the final decider", () => {
    const map = mapOf([
      ["u-a", "u-b"],
      ["u-b", "u-c"],
      ["u-c", "u-d"],
    ]);
    const walk = resolveFinal(map, "u-a");
    expect(walk.finalId).toBe("u-d");
    expect(walk.hops).toBe(3);
    expect(walk.chain).toEqual(["u-a", "u-b", "u-c", "u-d"]);
    expect(walk.looped).toBe(false);
    // A member who delegated to nobody decides for themselves.
    expect(resolveFinal(map, "u-d")).toMatchObject({ finalId: "u-d", hops: 0 });
  });

  it("terminates on a cycle written around the refusal, and says it looped", () => {
    const map = mapOf([
      ["u-a", "u-b"],
      ["u-b", "u-c"],
      ["u-c", "u-a"],
    ]);
    const walk = resolveFinal(map, "u-a");
    expect(walk.looped).toBe(true);
    expect(walk.chain).toEqual(["u-a", "u-b", "u-c"]);
  });

  it("concentration counts every vote once and the shares add to one", () => {
    // A and B follow C; D follows E; E and C decide for themselves.
    const map = mapOf([
      ["u-a", "u-c"],
      ["u-b", "u-c"],
      ["u-d", "u-e"],
    ]);
    const roster = ["u-a", "u-b", "u-c", "u-d", "u-e"];
    const rows = concentrationOver(map, roster);
    const by = new Map(rows.map((r) => [r.userId, r]));
    expect(by.get("u-c")!.effectiveVotes).toBe(3);
    expect(by.get("u-c")!.directDelegations).toBe(2);
    expect(by.get("u-c")!.shareOfElectorate).toBeCloseTo(0.6, 10);
    expect(by.get("u-e")!.effectiveVotes).toBe(2);
    expect(by.get("u-a")!.effectiveVotes).toBe(0);
    expect(by.get("u-a")!.decidedBy).toBe("u-c");
    expect(rows.reduce((sum, r) => sum + r.effectiveVotes, 0)).toBe(roster.length);
    expect(rows.reduce((sum, r) => sum + r.shareOfElectorate, 0)).toBeCloseTo(1, 10);
  });

  it("counts a chain through a member, so the effective number is not the direct one", () => {
    // A follows B, B follows C. C holds ONE direct delegation and decides three votes.
    const map = mapOf([
      ["u-a", "u-b"],
      ["u-b", "u-c"],
    ]);
    const rows = concentrationOver(map, ["u-a", "u-b", "u-c"]);
    const c = rows.find((r) => r.userId === "u-c")!;
    expect(c.directDelegations).toBe(1);
    expect(c.effectiveVotes).toBe(3);
    expect(rows.find((r) => r.userId === "u-a")!.hops).toBe(2);
  });

  it("keeps a decider who is off the roster in the arithmetic, marked as off it", () => {
    const rows = concentrationOver(mapOf([["u-a", "u-x"]]), ["u-a", "u-b"]);
    const x = rows.find((r) => r.userId === "u-x")!;
    expect(x.onRoster).toBe(false);
    expect(x.effectiveVotes).toBe(1);
    expect(rows.reduce((sum, r) => sum + r.effectiveVotes, 0)).toBe(2);
  });

  it("answers an empty roster with an empty list and no division by zero", () => {
    expect(concentrationOver(mapOf([["u-a", "u-b"]]), [])).toEqual([]);
  });
});

describe.skipIf(!configured)("delegation (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("writes one live delegation per member, and moving it is one act", async () => {
    await clearDelegations();
    expect((await setDelegation(pool, "u-a", "u-b")).ok).toBe(true);
    expect((await liveDelegationOf(pool, "u-a"))?.delegateId).toBe("u-b");
    expect((await setDelegation(pool, "u-a", "u-c")).ok).toBe(true);
    const [rows] = await pool.query<any[]>("SELECT * FROM delegations WHERE delegator_id = 'u-a'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows.length).toBe(1);
    expect((await liveDelegationOf(pool, "u-a"))?.delegateId).toBe("u-c");
  });

  it("revokes, says whether there was anything to revoke, and keeps the row readable", async () => {
    await clearDelegations();
    await setDelegation(pool, "u-a", "u-b");
    expect(await revokeDelegation(pool, "u-a")).toBe(true);
    // Nothing live, and the second call reports "there was nothing here"
    // rather than an error, which is a different answer from a failure.
    expect(await revokeDelegation(pool, "u-a")).toBe(false);
    expect(await liveDelegationOf(pool, "u-a")).toBeNull();
    expect((await delegationOf(pool, "u-a"))?.revokedAt).not.toBeNull();
    // A member who never gave one is told so, with no row invented.
    expect(await delegationOf(pool, "u-never")).toBeNull();
  });

  it("refuses the cycle against the stored chain, and stores nothing", async () => {
    await clearDelegations();
    expect((await handed("u-a", "u-b")).ok).toBe(true);
    expect((await handed("u-b", "u-c")).ok).toBe(true);
    const closing = await setDelegation(pool, "u-c", "u-a");
    expect(closing.ok).toBe(false);
    if (!closing.ok) expect(closing.error).toContain("comes back to you");
    expect(await liveDelegationOf(pool, "u-c")).toBeNull();
    // And the chain that does exist still resolves.
    expect((await resolveDelegate(pool, "u-a")).finalId).toBe("u-c");
  });

  it("carries the delegate's choice into the delegator's own row, with who decided it", async () => {
    await clearDelegations();
    const ballot = await openOne();
    // A follows B, B follows C. C is the final decider for all three.
    await handed("u-a", "u-b");
    await handed("u-b", "u-c");

    const cast = await castVote(pool, ballot.id, "u-c", "yes", "because it is time");
    expect(cast.ok).toBe(true);

    const a = await voteOf(pool, ballot.id, "u-a");
    const b = await voteOf(pool, ballot.id, "u-b");
    expect(a).toMatchObject({ choice: "yes", followedUserId: "u-c" });
    expect(b).toMatchObject({ choice: "yes", followedUserId: "u-c" });
    // The reason belongs to whoever wrote it and is never copied.
    expect(a?.reason).toBeNull();
    // C's own row says C decided it.
    expect(await voteOf(pool, ballot.id, "u-c")).toMatchObject({ choice: "yes", followedUserId: null });

    // THE WEIGHT NEVER MOVED. Three rows of weight 1, which is what makes
    // "3 of 3 people voted" true and keeps the frozen roll meaning what it says.
    expect(await voteCount(pool, ballot.id)).toBe(3);
    expect(await talliesFor(pool, ballot.id)).toEqual({ yesW: 3, noW: 0, abstainW: 0 });
    const weights = (await votesFor(pool, ballot.id)).map((v) => v.weight);
    expect(weights).toEqual([1, 1, 1]);
  });

  it("follows the delegate when they CHANGE their vote", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "yes" });
    await castVote(pool, ballot.id, "u-b", "no");
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "no", followedUserId: "u-b" });
  });

  it("a member who votes for themselves overrides, before and after the delegate", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");

    // A decides first. B voting the other way must not overwrite A's row.
    await castVote(pool, ballot.id, "u-a", "no", "my own words");
    await castVote(pool, ballot.id, "u-b", "yes");
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({
      choice: "no",
      reason: "my own words",
      followedUserId: null,
    });

    // And a member who was following takes their row back by voting.
    const second = await openOne();
    await castVote(pool, second.id, "u-b", "yes");
    expect(await voteOf(pool, second.id, "u-a")).toMatchObject({ choice: "yes", followedUserId: "u-b" });
    await castVote(pool, second.id, "u-a", "abstain");
    expect(await voteOf(pool, second.id, "u-a")).toMatchObject({ choice: "abstain", followedUserId: null });
    // The delegate voting again does not take it back off them.
    await castVote(pool, second.id, "u-b", "no");
    expect(await voteOf(pool, second.id, "u-a")).toMatchObject({ choice: "abstain", followedUserId: null });
  });

  it("a silent delegate leaves the vote UNCAST, never an abstain", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await handed("u-c", "u-b");
    // Nobody has voted. Deriving now must write nothing at all.
    const derived = await applyDelegatedVotes(pool, ballot.id);
    expect(derived).toMatchObject({ added: 0, changed: 0, removed: 0, eligible: true });
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();
    expect(await voteCount(pool, ballot.id)).toBe(0);
    // Quorum counts them as not voted, and an abstain would have counted them
    // as having shown up. Three members are still awaited.
    expect((await awaitingVote(pool, ballot.id)).sort()).toEqual(["u-a", "u-b", "u-c"]);
    expect(await talliesFor(pool, ballot.id)).toEqual({ yesW: 0, noW: 0, abstainW: 0 });
  });

  it("revoking mid-ballot re-derives the row away, and the vote is uncast again", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "yes" });

    await revokeDelegation(pool, "u-a");
    const moved = await applyDelegatedVotesEverywhere(pool);
    const mine = moved.find((m) => m.ballotId === ballot.id)!;
    expect(mine.counts).toMatchObject({ removed: 1, eligible: true });
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();
    expect(await voteCount(pool, ballot.id)).toBe(1);
    expect(await awaitingVote(pool, ballot.id)).toContain("u-a");
  });

  it("moving a delegation mid-ballot re-derives to the new chain, downstream included", async () => {
    await clearDelegations();
    const ballot = await openOne();
    // A follows B; B follows C. C votes yes, so A and B both carry yes.
    await handed("u-a", "u-b");
    await handed("u-b", "u-c");
    await castVote(pool, ballot.id, "u-c", "yes");
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "yes", followedUserId: "u-c" });

    // B moves their delegation to a member who voted the other way. A is
    // downstream of B and moves with them, which is the case a routine that
    // only patched the member who acted would get wrong.
    const other = await openOne({
      subjectRef: "delegation-test-move",
      electorate: [
        { userId: "u-a", weight: 1 },
        { userId: "u-b", weight: 1 },
        { userId: "u-c", weight: 1 },
        { userId: "u-d", weight: 1 },
      ],
    });
    await castVote(pool, other.id, "u-c", "yes");
    await castVote(pool, other.id, "u-d", "no");
    expect(await voteOf(pool, other.id, "u-a")).toMatchObject({ choice: "yes", followedUserId: "u-c" });
    expect((await handed("u-b", "u-d")).ok).toBe(true);
    await applyDelegatedVotesEverywhere(pool);
    expect(await voteOf(pool, other.id, "u-b")).toMatchObject({ choice: "no", followedUserId: "u-d" });
    expect(await voteOf(pool, other.id, "u-a")).toMatchObject({ choice: "no", followedUserId: "u-d" });
  });

  it("says a closed ballot was never eligible, which is not the same as nothing to do", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await pool.query("UPDATE ballots SET status = 'passed' WHERE id = ?", [ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(await applyDelegatedVotes(pool, ballot.id)).toMatchObject({ eligible: false });
    expect(await applyDelegatedVotes(pool, "no-such-ballot")).toMatchObject({ eligible: false });
  });

  it("shows a delegator every vote they hold and who decided it", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    const held = await votesFollowedBy(pool, "u-a", 10);
    const here = held.find((v) => v.ballotId === ballot.id)!;
    expect(here).toMatchObject({ choice: "yes", followedUserId: "u-b", ballotStatus: "open" });
    expect(here.ballotTitle).toBe(ballot.title);
  });

  it("reads concentration off the live table for a roster", async () => {
    await clearDelegations();
    await handed("u-a", "u-b");
    await handed("u-b", "u-c");
    const rows = await effectiveConcentration(pool, ["u-a", "u-b", "u-c"]);
    const c = rows.find((r) => r.userId === "u-c")!;
    expect(c.effectiveVotes).toBe(3);
    expect(c.shareOfElectorate).toBeCloseTo(1, 10);
    expect(rows.reduce((sum, r) => sum + r.effectiveVotes, 0)).toBe(3);
  });

  // ── 0175: consent, suppression, the uncast path, and the vote nobody
  // may delegate ─────────────────────────────────────────────────────────

  it("lands PENDING, and a pending delegation carries no choice at all", async () => {
    await clearDelegations();
    const ballot = await openOne();
    expect((await setDelegation(pool, "u-a", "u-b")).ok).toBe(true);
    const mine = await liveDelegationOf(pool, "u-a");
    expect(mine?.delegateId).toBe("u-b");
    expect(mine?.acceptedAt).toBeNull();
    // Nobody decides for A yet, so the chain stops at A.
    expect((await resolveDelegate(pool, "u-a")).finalId).toBe("u-a");
    await castVote(pool, ballot.id, "u-b", "yes");
    // THE WINDOW THE ACCEPTANCE RULE CLOSES. Before it, pointing a delegation
    // at somebody was enough to read their hidden choice off your own row.
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();
    expect(await voteCount(pool, ballot.id)).toBe(1);
  });

  it("carries from the moment the delegate accepts, and not before", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await setDelegation(pool, "u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();

    const taken = await acceptDelegations(pool, "u-b", "u-a");
    expect(taken).toMatchObject({ changed: 1, eligible: 1, delegatorIds: ["u-a"] });
    await applyDelegatedVotesEverywhere(pool);
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "yes", followedUserId: "u-b" });
  });

  it("tells a delegate with no offers apart from one who lost a race", async () => {
    await clearDelegations();
    // Nothing offered at all: eligible zero says "there was nothing to do".
    expect(await acceptDelegations(pool, "u-b")).toEqual({ changed: 0, eligible: 0, delegatorIds: [] });
    // Accepting one that already carries is the state the delegate asked for,
    // and is not an error either.
    await handed("u-a", "u-b");
    expect(await acceptDelegations(pool, "u-b", "u-a")).toMatchObject({ changed: 0, eligible: 0 });
  });

  it("accepts every offer standing when no delegator is named", async () => {
    await clearDelegations();
    await setDelegation(pool, "u-a", "u-b");
    await setDelegation(pool, "u-c", "u-b");
    const taken = await acceptDelegations(pool, "u-b");
    expect(taken.changed).toBe(2);
    expect(taken.delegatorIds.sort()).toEqual(["u-a", "u-c"]);
  });

  it("shows a pending delegation to BOTH sides", async () => {
    await clearDelegations();
    await setDelegation(pool, "u-a", "u-b");
    // The delegator sees that they are waiting.
    expect((await liveDelegationOf(pool, "u-a"))?.acceptedAt).toBeNull();
    // The delegate sees who is asking.
    const offers = await delegationsToMe(pool, "u-b");
    expect(offers.map((o) => o.delegatorId)).toEqual(["u-a"]);
    expect(offers[0]!.acceptedAt).toBeNull();
  });

  it("lets the DELEGATE end it, pending or carrying, and the seat is uncast again", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ followedUserId: "u-b" });

    const declined = await declineDelegations(pool, "u-b", "u-a");
    expect(declined).toMatchObject({ changed: 1, eligible: 1 });
    await applyDelegatedVotesEverywhere(pool);
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();
    expect(await liveDelegationOf(pool, "u-a")).toBeNull();
    // And a delegate with nothing live is told so rather than given an error.
    expect(await declineDelegations(pool, "u-b")).toMatchObject({ changed: 0, eligible: 0 });
  });

  it("keeps an acceptance only for the same live delegate", async () => {
    await clearDelegations();
    await handed("u-a", "u-b");
    // Re-giving to the same delegate changes nothing they consented to, so
    // nobody is asked to say yes twice to one sentence.
    await setDelegation(pool, "u-a", "u-b");
    expect((await liveDelegationOf(pool, "u-a"))?.acceptedAt).not.toBeNull();
    // Re-pointing at somebody new lands at pending: the new delegate has
    // consented to nothing. This is the assignment order inside the ON
    // DUPLICATE KEY UPDATE list; swapping the two clauses breaks it silently.
    await setDelegation(pool, "u-a", "u-c");
    expect((await liveDelegationOf(pool, "u-a"))?.acceptedAt).toBeNull();
    // And a delegation revoked and given again to the same member starts over,
    // because a consent given before a revocation was consent to something
    // that ended.
    await handed("u-a", "u-c");
    await revokeDelegation(pool, "u-a");
    await setDelegation(pool, "u-a", "u-c");
    expect((await liveDelegationOf(pool, "u-a"))?.acceptedAt).toBeNull();
  });

  it("re-points away from an accepted delegate and derives nothing until the new one says yes", async () => {
    await clearDelegations();
    const ballot = await openOne();
    // A follows B, who has accepted, and B votes. A's seat is cast.
    await handed("u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    await castVote(pool, ballot.id, "u-c", "no");
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "yes", followedUserId: "u-b" });

    // A points at C instead. C has agreed to nothing, so the acceptance does
    // not travel with the delegation: the seat B was deciding goes back to
    // uncast, and C's own choice does not arrive in A's row. This is the
    // whole reason `accepted_at` is cleared in the upsert. Leave it out and C
    // starts casting A's vote from a handshake C was never part of.
    expect((await setDelegation(pool, "u-a", "u-c")).ok).toBe(true);
    expect((await liveDelegationOf(pool, "u-a"))?.acceptedAt).toBeNull();
    expect((await resolveDelegate(pool, "u-a")).finalId).toBe("u-a");
    await applyDelegatedVotesEverywhere(pool);
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();
    expect(await awaitingVote(pool, ballot.id)).toContain("u-a");
    expect(await voteCount(pool, ballot.id)).toBe(2);

    // It carries from the moment C accepts, and reads C from then on.
    expect(await acceptDelegations(pool, "u-c", "u-a")).toMatchObject({ changed: 1, eligible: 1 });
    await applyDelegatedVotesEverywhere(pool);
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "no", followedUserId: "u-c" });
  });

  it("carries nothing for a delegation written before the acceptance column existed", async () => {
    await clearDelegations();
    const ballot = await openOne();
    // Exactly the row the earlier migration wrote, which is what the ALTER
    // left behind: `accepted_at` NULL, never backfilled. A delegation given
    // before consent was asked for was given without it.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO delegations (delegator_id, delegate_id, created_at, revoked_at) VALUES ('u-a','u-b',NOW(),NULL)",
    );
    const old = await delegationOf(pool, "u-a");
    expect(old?.acceptedAt).toBeNull();
    expect(isCarrying(old)).toBe(false);
    expect((await resolveDelegate(pool, "u-a")).finalId).toBe("u-a");
    await castVote(pool, ballot.id, "u-b", "yes");
    await applyDelegatedVotesEverywhere(pool);
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();
    expect(await awaitingVote(pool, ballot.id)).toContain("u-a");

    // The one door out of that state is the delegate answering, which is the
    // consent the column was added to ask for.
    const offers = await delegationsToMe(pool, "u-b");
    expect(offers.map((o) => o.acceptedAt)).toEqual([null]);
    expect(await acceptDelegations(pool, "u-b", "u-a")).toMatchObject({ changed: 1, eligible: 1 });
    await applyDelegatedVotesEverywhere(pool);
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "yes", followedUserId: "u-b" });
  });

  it("refuses a loop made of offers nobody has accepted yet", async () => {
    await clearDelegations();
    // Neither of these carries anything, and accepting them both would close
    // a loop inside the tally, where there is nobody left to refuse it.
    expect((await setDelegation(pool, "u-a", "u-b")).ok).toBe(true);
    const closing = await setDelegation(pool, "u-b", "u-a");
    expect(closing.ok).toBe(false);
    if (!closing.ok) expect(closing.error).toContain("in a circle");
  });

  it("holds the choice back on the serving path while the ballot runs", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "no");

    const served = await ownVoteView(pool, ballot, "u-a", { nameOf: () => "Ren" });
    expect(served).toMatchObject({ choice: null, choiceHidden: true, followedUserId: "u-b" });
    expect(served?.sentence).toContain("Cast, following Ren");
    // The raw read still holds the row, which is what the derivation counts.
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "no", followedUserId: "u-b" });
    // B reads their own vote as always, because they already know it.
    expect(await ownVoteView(pool, ballot, "u-b")).toMatchObject({ choice: "no", choiceHidden: false });

    // At the close it arrives with everybody else's.
    await pool.query("UPDATE ballots SET status = 'passed' WHERE id = ?", [ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const after = await ownVoteView(pool, { id: ballot.id, status: "passed" }, "u-a", { nameOf: () => "Ren" });
    expect(after).toMatchObject({ choice: "no", choiceHidden: false });
  });

  it("serves a list path from the row it already has, with no second read", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT choice, reason, followed_user_id FROM ballot_votes WHERE ballot_id = ? AND user_id = 'u-a'",
      [ballot.id],
    );
    expect(await ownVoteView(pool, ballot, "u-a", { have: rows[0] })).toMatchObject({
      choice: null,
      choiceHidden: true,
      followedUserId: "u-b",
    });
    // `have: null` means "I looked and there was nothing", which must not send
    // the caller back to the database to be told the same thing.
    expect(await ownVoteView(pool, ballot, "u-a", { have: null })).toBeNull();
  });

  it("TAKING MY VOTE BACK uncasts the row, ends the delegation, and quorum falls", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await handed("u-c", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    // Three of three seats are cast, so quorum is the whole roll.
    expect(await voteCount(pool, ballot.id)).toBe(3);
    const before = quorumPctOf(await talliesFor(pool, ballot.id), ballot.totalWeight);
    expect(before).toBeCloseTo(100, 10);

    const took = await uncastDelegatedVote(pool, ballot.id, "u-a");
    expect(took).toMatchObject({ removed: 1, eligible: true, delegationEnded: true });
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();
    expect(await liveDelegationOf(pool, "u-a")).toBeNull();
    expect(await awaitingVote(pool, ballot.id)).toContain("u-a");
    // THE NUMBER THE WHOLE FIX IS FOR. A repudiated choice used to keep
    // carrying weight, because nothing anywhere deleted a vote row.
    const after = quorumPctOf(await talliesFor(pool, ballot.id), ballot.totalWeight);
    expect(after).toBeCloseTo((2 / 3) * 100, 10);
    expect(after).toBeLessThan(before);
    // It is not an abstain: nobody made a choice here.
    expect(await talliesFor(pool, ballot.id)).toEqual({ yesW: 2, noW: 0, abstainW: 0 });
  });

  it("takes nothing back when the delegate has not voted, and leaves the delegation alone", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    // B has not voted, so there is no row here to take back. Ending the
    // delegation anyway would be an act the answer did not report.
    const took = await uncastDelegatedVote(pool, ballot.id, "u-a");
    expect(took).toMatchObject({ removed: 0, eligible: true, delegationEnded: false });
    expect(await liveDelegationOf(pool, "u-a")).not.toBeNull();
  });

  it("never reaches a vote the member cast themselves", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await castVote(pool, ballot.id, "u-a", "no", "my own words");
    const took = await uncastDelegatedVote(pool, ballot.id, "u-a");
    expect(took).toMatchObject({ removed: 0, eligible: true });
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ choice: "no", followedUserId: null });
  });

  it("says a closed ballot could not be reached, which is not 'nothing to take back'", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await pool.query("UPDATE ballots SET status = 'passed' WHERE id = ?", [ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const took = await uncastDelegatedVote(pool, ballot.id, "u-a");
    expect(took).toMatchObject({ removed: 0, eligible: false });
    expect(String(took.error)).toContain("on the record once it closes");
  });

  it("writes NO delegated row on a subject that asks every seat to say yes", async () => {
    await clearDelegations();
    const strict = await openOne({ unityPct: 100, quorumPct: 100 });
    await handed("u-a", "u-b");
    await castVote(pool, strict.id, "u-b", "yes");
    expect(await voteOf(pool, strict.id, "u-a")).toBeNull();
    expect(await voteCount(pool, strict.id)).toBe(1);
    const derived = await applyDelegatedVotes(pool, strict.id);
    // "Nothing to do" and "this vote refuses delegated rows" are different
    // answers and the counts say which.
    expect(derived).toMatchObject({ eligible: true, carries: false });
  });

  it("sweeps a delegated row off a ballot that becomes strict", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await castVote(pool, ballot.id, "u-b", "yes");
    expect(await voteOf(pool, ballot.id, "u-a")).toMatchObject({ followedUserId: "u-b" });
    await pool.query("UPDATE ballots SET unity_pct = 100 WHERE id = ?", [ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const swept = await applyDelegatedVotes(pool, ballot.id);
    expect(swept).toMatchObject({ removed: 1, carries: false });
    expect(await voteOf(pool, ballot.id, "u-a")).toBeNull();
  });

  it("names the withheld bloc while the window is still open", async () => {
    await clearDelegations();
    const ballot = await openOne();
    await handed("u-a", "u-b");
    await handed("u-c", "u-b");
    // B has not voted, so two seats that were asked are silent because of one
    // member, which reads from outside as ordinary low turnout.
    const view = await ballotDelegationView(pool, ballot.id, ["u-a", "u-b", "u-c", "u-d"]);
    expect(view).toMatchObject({ eligible: true, carries: true, withheldSeats: 2, electorateCount: 3, accountCount: 4 });
    const b = view.rows.find((r) => r.userId === "u-b")!;
    expect(b.unvotedDelegations).toBe(2);
    expect(b.votedHere).toBe(false);
    // THE TWO DENOMINATORS, both served. Three of the three people asked, and
    // three of the four accounts in the village.
    expect(b.effectiveVotesOnRoll).toBe(3);
    expect(b.shareOfElectorate).toBeCloseTo(1, 10);
    expect(b.effectiveVotesAllAccounts).toBe(3);
    expect(b.shareOfAllAccounts).toBeCloseTo(3 / 4, 10);
    expect(await unvotedDelegationsOn(pool, ballot.id, "u-b")).toBe(2);

    // Once B votes, the bloc is cast rather than withheld.
    await castVote(pool, ballot.id, "u-b", "yes");
    const after = await ballotDelegationView(pool, ballot.id, ["u-a", "u-b", "u-c", "u-d"]);
    expect(after.withheldSeats).toBe(0);
    expect(after.rows.find((r) => r.userId === "u-b")!.votedHere).toBe(true);
  });

  it("says a strict subject carries nothing rather than reporting an empty bloc", async () => {
    await clearDelegations();
    const strict = await openOne({ unityPct: 100, quorumPct: 100 });
    await handed("u-a", "u-b");
    const view = await ballotDelegationView(pool, strict.id, ["u-a", "u-b", "u-c"]);
    expect(view.carries).toBe(false);
    expect(String(view.whyNot)).toContain("answer it themselves");
    expect(view.withheldSeats).toBe(0);
    expect(view.rows.find((r) => r.userId === "u-b")!.effectiveVotesOnRoll).toBe(1);
  });
});


// ── 0175: CONSENT, SUPPRESSION, THE UNCAST PATH, AND THE VOTE NOBODY MAY
// DELEGATE ─────────────────────────────────────────────────────────────────

describe("what a delegator may read (no database)", () => {
  it("holds the choice back on a delegated row while the vote is running", () => {
    const view = hiddenChoiceView({
      ballotStatus: "open",
      choicesHidden: true,
      choice: "no",
      followedUserId: "u-b",
      followedName: "Ren",
    });
    expect(view.choice).toBeNull();
    expect(view.choiceHidden).toBe(true);
    expect(view.state).toBe("cast_following");
    expect(view.sentence).toContain("Cast, following Ren");
    // The sentence says WHEN it arrives, so the member is not left guessing
    // whether their vote is broken.
    expect(view.sentence).toContain("closes");
  });

  it("gives the choice back at the close, with everybody else's", () => {
    const view = hiddenChoiceView({
      ballotStatus: "passed",
      choicesHidden: true,
      choice: "no",
      followedUserId: "u-b",
      followedName: "Ren",
    });
    expect(view.choice).toBe("no");
    expect(view.choiceHidden).toBe(false);
    expect(view.sentence).toContain("Cast, following Ren: no");
  });

  it("never holds back a vote the member cast themselves", () => {
    const view = hiddenChoiceView({
      ballotStatus: "open",
      choicesHidden: true,
      choice: "yes",
      reason: "my own words",
      followedUserId: null,
    });
    expect(view).toMatchObject({ choice: "yes", choiceHidden: false, state: "cast_by_me" });
    expect(view.reason).toBe("my own words");
  });

  it("shows the choice on a village that votes in the open", () => {
    const view = hiddenChoiceView({
      ballotStatus: "open",
      choicesHidden: false,
      choice: "abstain",
      followedUserId: "u-b",
      followedName: "Ren",
    });
    expect(view).toMatchObject({ choice: "abstain", choiceHidden: false });
  });

  it("names no identifier when it has no name to use", () => {
    const view = hiddenChoiceView({
      ballotStatus: "open",
      choicesHidden: true,
      choice: "yes",
      followedUserId: "u-9f2c-secret-id",
    });
    expect(view.sentence).not.toContain("u-9f2c");
  });
});

describe("the vote nobody may delegate (no database)", () => {
  it("refuses a delegated row on the Birthing, which asks every seat to say yes", () => {
    const verdict = delegationCarriesOn({ subjectType: "village_launch", method: "custom", unityPct: 100 });
    expect(verdict.carries).toBe(false);
    expect(verdict.why).toContain("answer it themselves");
  });

  it("refuses one on any subject frozen at 100 unity, whatever it is called", () => {
    expect(delegationCarriesOn({ subjectType: "mechanics", method: "custom", unityPct: 100 }).carries).toBe(false);
  });

  it("refuses one under consensus, whose own sentence is unity of 100", () => {
    expect(delegationCarriesOn({ subjectType: "mechanics", method: "consensus", unityPct: 0 }).carries).toBe(false);
  });

  it("carries on an ordinary vote, and says nothing is wrong", () => {
    const verdict = delegationCarriesOn({ subjectType: "mechanics", method: "custom", unityPct: 80 });
    expect(verdict).toEqual({ carries: true, why: null });
  });
});

/**
 * THE BACKFILL DECISION, READ OFF THE MIGRATION ITSELF.
 *
 * The cases above prove what an unaccepted delegation does. This one proves
 * the migration leaves every delegation that predates the column in exactly
 * that state. Backfilling `accepted_at` would grant, on the delegate's
 * behalf, the consent the column exists to ask for, and it would do it to
 * every delegation given while nobody was asked. The migration is found by
 * its name rather than its number, because the build renumbers migrations
 * when it lands.
 */
describe("the acceptance column's backfill decision (no database)", () => {
  const drizzle = path.resolve(__dirname, "../../drizzle");

  it("adds the column and backfills nothing, so no delegation arrives pre-accepted", () => {
    const named = readdirSync(drizzle).filter((f) => f.endsWith("_delegation_acceptance.sql"));
    expect(named.length).toBe(1);
    const sql = readFileSync(path.join(drizzle, named[0]!), "utf8");
    // The column lands nullable, which is what leaves an old row pending.
    expect(sql).toMatch(/ADD COLUMN `accepted_at` datetime NULL/);
    // The decision is written down where the next reader of the schema finds
    // it, rather than left to be inferred from the absence of a statement.
    expect(sql).toContain("NULLABLE, NEVER BACKFILLED");
    // And nothing in the file sets the column on any row.
    expect(sql).not.toMatch(/UPDATE\s+`?delegations`?/i);
    expect(sql).not.toMatch(/SET\s+`?accepted_at`?\s*=/i);
  });
});
