/**
 * The steward, against the real tables.
 *
 * REWRITTEN FROM THE APPROVAL MODEL. Every assertion that moved, moved because
 * the rule it pinned is now wrong. The founder ruled on 2026-09-03 that
 * nothing waits for a steward: a decision the village carried lands on its own
 * whether or not anybody holds the seat, and the seat's one power is to stop
 * it inside the window before it lands. So the old suite's "null is the
 * queue", "counts only undecided passed ballots as waiting", "stops asking on
 * a subject told to carry itself" and "tells the roll the decision is waiting"
 * pinned a queue that no longer exists, and the vacancy sentence they asserted
 * ("proposals wait") is now a lie about what happens.
 *
 * What each one became:
 *
 *  - a catalyst inherits the seat at the Birthing, with a term computed from
 *    the CLOCK rather than from the season list;
 *  - seating against an open-ended season is REFUSED, rather than writing a
 *    term nothing will end;
 *  - a term survives an unrelated role appointment, which it did not before
 *    the columns joined the roleHoldersRepo spec;
 *  - every term is kept in its own append-only row, because the unique key on
 *    role_holders forbids a second one;
 *  - a veto records who, why and which ballot, and a redaction blanks the
 *    words while the act, the author and the time stay;
 *  - one steward's veto stands alone, unless the village runs a council, and
 *    then it takes a majority;
 *  - a lapsed term takes the powers with it, on the plane that carries them;
 *  - an empty seat is HEALTHY and never a warning, and nothing waits on it.
 *
 * The suite drives `server/lib/stewardship.ts` against a scratch schema rather
 * than over HTTP, because these are the functions the close dispatcher and the
 * veto routes both call. The HTTP half is one thin layer over exactly these
 * calls; what is worth pinning is the rule, not the JSON.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { loadVariables, setVariable } from "./lib/variables";
import {
  actFor,
  expiringHoldings,
  forgetStewardActs,
  holdingHasLapsed,
  holdsStewardSeat,
  stewardMailRefusal,
  openTermFor,
  recordNoObjection,
  recordTermEnded,
  recordTermStarted,
  recordVeto,
  redactVetoReason,
  roleFromSeatRef,
  runTermWatch,
  seatCatalystsAsStewards,
  stewardVetoStands,
  stewardsSeated,
  subjectIsVetoable,
  subjectTypesSeen,
  termEndsAtFromCycles,
  termHistoryFor,
  vacancyState,
  vetoesFor,
  STEWARD_COUNCIL_KEY,
  STEWARD_ROLE_ID,
  STEWARD_SUBJECTS_KEY,
  STEWARD_VETO,
} from "./lib/stewardship";

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

const LAUNCH_BALLOT = "bal-birthing";
const SEASON = { currentSeasonId: "rooting-2026" };

async function member(id: string, name: string, role: string): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
    "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
    [id, name, `${id}@example.invalid`, "x", role],
  );
}

async function ballot(id: string, subjectType: string, status: string, openedBy: string, ref = "ref"): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
    "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, weight_mode, " +
      "unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, closes_at, status) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),?)",
    [id, subjectType, ref, `${subjectType}:${id}`, `Decision ${id}`, "body", "custom", "equal",
      80, 20, 3, 3, openedBy, status],
  );
}

/** The permission gate's own predicate, run over the rows the gate reads. */
async function capabilitiesOf(userId: string): Promise<string[]> {
  const [holders]: any = await pool.query(
    "SELECT role_id, term_ends_at FROM role_holders WHERE user_id = ?",
    [userId],
  );
  const live = holders.filter((h: any) => !holdingHasLapsed({ termEndsAt: h.term_ends_at }));
  if (live.length === 0) return [];
  const [roles]: any = await pool.query(
    `SELECT capabilities FROM roles WHERE id IN (${live.map(() => "?").join(",")})`,
    live.map((h: any) => h.role_id),
  );
  const out = new Set<string>();
  for (const r of roles) {
    const caps = typeof r.capabilities === "string" ? JSON.parse(r.capabilities) : r.capabilities;
    for (const c of caps ?? []) out.add(String(c));
  }
  return Array.from(out);
}

describe.skipIf(!configured)("the steward seat, seated at the Birthing", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 });
    await loadVariables(pool);
    await member("cat-1", "Wren Alder", "founder");
    await member("cat-2", "Iris Fenn", "founder");
    await member("mem-1", "Rook Salt", "member");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("finds nobody on the seat before the Birthing, and says so without calling it a fault", async () => {
    const state = await vacancyState(pool);
    expect(state.seated).toBe(false);
    expect(state.holdings).toEqual([]);
    // The setting still leaves the seat something it could stop, so the
    // sentence names that, and it still says nothing is waiting, because
    // nothing is.
    expect(state.stillAsked).toBe(true);
    expect(state.sentence).toBe("No steward holds the seat; Game changes land at their landing time.");
    expect(state.sentence, "the old model's queue is gone from the copy too").not.toContain("wait");
  });

  it("REFUSES to seat anybody against a season with no end date", async () => {
    // The audit's risk 3, at its root. A term is the only backstop on a seat
    // that can veto, and a founding season is documented as open-ended, so a
    // term measured against it never comes due.
    const r = await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, { ...SEASON, openEnded: true });
    expect(r.ok).toBe(false);
    expect(r.termEndsAt).toBeNull();
    expect(String(r.error)).toContain("no end date");
    const [count]: any = await pool.query("SELECT COUNT(*) AS n FROM role_holders");
    expect(Number(count[0].n), "and it wrote nothing on its way out").toBe(0);
  });

  it("seats every catalyst, creates the role, and grants the one power", async () => {
    const r = await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    expect(r.ok).toBe(true);
    expect(r.roleCreated).toBe(true);
    expect(r.capabilityGranted).toBe(true);
    // And the holding crosses in the same breath. Without this row an
    // administrator passes the veto gate as an ordinary admin, with nothing
    // anywhere saying they reached past the village.
    expect(r.holdingMoved).toBe(true);
    expect(r.seated.sort()).toEqual(["cat-1", "cat-2"]);
    expect(r.alreadySeated).toEqual([]);

    const [roles]: any = await pool.query("SELECT capabilities FROM roles WHERE id = ?", [STEWARD_ROLE_ID]);
    const caps = typeof roles[0].capabilities === "string" ? JSON.parse(roles[0].capabilities) : roles[0].capabilities;
    expect(caps).toContain(STEWARD_VETO);

    const [holding]: any = await pool.query(
      "SELECT holder_role_id, moved_by_ballot_id FROM capability_holding WHERE capability = ?",
      [STEWARD_VETO],
    );
    expect(holding[0]?.holder_role_id).toBe(STEWARD_ROLE_ID);
    expect(holding[0]?.moved_by_ballot_id, "the Birthing moved it, not an administrator").toBe(LAUNCH_BALLOT);
  });

  it("writes a term computed from the CLOCK, not from the season list", async () => {
    // The founder's rule that makes relinquishment automatic: the seat has to
    // be re-granted, so it has to end on an instant somebody can read. Under
    // the old code that instant came from the season list, which can be
    // open-ended and whose dates run out.
    const [rows]: any = await pool.query(
      "SELECT term_ends_at, season_id, granted_by FROM role_holders WHERE role_id = ? AND user_id = ?",
      [STEWARD_ROLE_ID, "cat-1"],
    );
    expect(rows[0].term_ends_at, "the seat ends on an instant").toBeTruthy();
    const ends = new Date(rows[0].term_ends_at);
    expect(ends.getTime()).toBeGreaterThan(Date.now());
    // Within a minute of the clock's own answer, which is the point: the
    // season is recorded beside it and does not decide it.
    const expected = termEndsAtFromCycles(3);
    expect(Math.abs(ends.getTime() - expected.getTime())).toBeLessThan(60_000);
    expect(rows[0].season_id).toBe("rooting-2026");
    expect(rows[0].granted_by, "the village put them here, not an administrator").toBe(LAUNCH_BALLOT);
  });

  it("opens one term row per seating, because role_holders can only hold the current one", async () => {
    const history = await termHistoryFor(pool, STEWARD_ROLE_ID, "cat-1");
    expect(history).toHaveLength(1);
    expect(history[0].endedAt, "it is still running").toBeNull();
    expect(history[0].termEndsAt).toBeTruthy();
    expect(history[0].seasonId).toBe("rooting-2026");
  });

  it("gives a catalyst the veto, and gives an ordinary member none", async () => {
    expect(await capabilitiesOf("cat-1")).toContain(STEWARD_VETO);
    expect(await capabilitiesOf("mem-1")).toEqual([]);
  });

  it("seats nobody twice: a retried close is one row per catalyst, and one term each", async () => {
    const again = await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    expect(again.seated, "nothing to do, and that is different from a failure").toEqual([]);
    expect(again.alreadySeated.sort()).toEqual(["cat-1", "cat-2"]);
    expect(again.roleCreated).toBe(false);
    expect(again.capabilityGranted).toBe(false);

    const [count]: any = await pool.query(
      "SELECT COUNT(*) AS n FROM role_holders WHERE role_id = ?",
      [STEWARD_ROLE_ID],
    );
    expect(Number(count[0].n)).toBe(2);
    expect(await termHistoryFor(pool, STEWARD_ROLE_ID, "cat-1")).toHaveLength(1);
  });

  it("reads the seat as held, by two people, any one of whom can stop a decision", async () => {
    const state = await vacancyState(pool);
    expect(state.seated).toBe(true);
    expect(state.holdings).toHaveLength(2);
    expect(state.lapsed).toEqual([]);
    expect(state.council).toBe(false);
    expect(state.sentence).toContain("any one of them can stop a decision");
  });

  it("keeps the term through an unrelated role appointment", async () => {
    /*
     * The audit found this one by reading `dbCollection.replaceAll`: it writes
     * one INSERT naming every SPEC'D column and only those, so a term left out
     * of the roleHoldersRepo spec comes back as NULL on the next whole-table
     * write. Seating anybody into any role would then silently make every
     * mandate in the village permanent, including the seat that can veto.
     *
     * This drives the same shape the repo does: read every column the spec
     * names, write them all back. It passes only because term_ends_at and
     * season_id ARE in the spec.
     */
    const [before]: any = await pool.query(
      "SELECT id, role_id, user_id, granted_by, granted_at, term_ends_at, season_id FROM role_holders",
    );
    expect(before.every((r: any) => r.term_ends_at), "every seat has a term to lose").toBe(true);

    await pool.query("DELETE FROM role_holders"); // module-review-ok: fixture SQL, the replaceAll shape
    for (const r of before) {
      await pool.query( // module-review-ok: fixture SQL, the replaceAll shape
        "INSERT INTO role_holders (id, role_id, user_id, granted_by, granted_at, term_ends_at, season_id) VALUES (?,?,?,?,?,?,?)",
        [r.id, r.role_id, r.user_id, r.granted_by, r.granted_at, r.term_ends_at, r.season_id],
      );
    }
    const [after]: any = await pool.query("SELECT term_ends_at, season_id FROM role_holders");
    expect(after.every((r: any) => r.term_ends_at), "the term survived the whole-table write").toBe(true);
    expect(after.every((r: any) => r.season_id === "rooting-2026")).toBe(true);
  });
});

describe.skipIf(!configured)("the veto on a carried decision", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 });
    await loadVariables(pool);
    await member("st-1", "Wren Alder", "founder");
    await member("st-2", "Iris Fenn", "founder");
    await member("pr-1", "Rook Salt", "member");
    await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    await ballot("bal-stop", "mechanics", "passed", "pr-1");
    await ballot("bal-quiet", "mechanics", "passed", "pr-1");
    await ballot("bal-council", "mechanics", "passed", "pr-1");
    await ballot("bal-advisory", "advisory", "passed", "pr-1");
    // `userId@roleId` is the shape the role_seat and role_unseat routes freeze.
    await ballot("bal-unseat", "role_unseat", "passed", "pr-1", `st-1@${STEWARD_ROLE_ID}`);
    await ballot("bal-other-seat", "role_seat", "passed", "pr-1", "pr-1@gardeners");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("has no act on a carried decision until somebody makes one, and that is not a queue", async () => {
    expect(await vetoesFor(pool, "bal-stop")).toEqual([]);
    const standing = await stewardVetoStands(pool, "bal-stop");
    expect(standing.stands, "nothing stops it, so it lands").toBe(false);
    expect(standing.sentence).toBe("No steward has stopped this.");
  });

  it("refuses an empty veto reason and writes nothing", async () => {
    const r = await recordVeto(pool, { ballotId: "bal-stop", decidedBy: "st-1", reason: "   " });
    expect(r.ok).toBe(false);
    expect(await vetoesFor(pool, "bal-stop"), "a rejected veto leaves no row").toEqual([]);
  });

  it("records a veto with the person, the reason and the ballot", async () => {
    const reason = "This turns the mint on before the ledger is settled.";
    const r = await recordVeto(pool, { ballotId: "bal-stop", decidedBy: "st-1", reason });
    expect(r.ok).toBe(true);

    const row = await actFor(pool, "bal-stop", "st-1", "veto");
    expect(row).toBeTruthy();
    expect(row!.ballotId).toBe("bal-stop");
    expect(row!.decidedBy).toBe("st-1");
    expect(row!.act).toBe("veto");
    expect(row!.reason).toBe(reason);
    expect(row!.redactedAt).toBeNull();
    expect(row!.decidedAt).toBeTruthy();
  });

  it("stands on ONE steward's veto, because that is the default the founder ruled", async () => {
    const standing = await stewardVetoStands(pool, "bal-stop");
    expect(standing.stands).toBe(true);
    expect(standing.vetoes).toBe(1);
    expect(standing.needed).toBe(1);
    expect(standing.council).toBe(false);
    expect(standing.by).toEqual(["st-1"]);
  });

  it("writes one row for a retried veto, rather than a second opinion nobody can order", async () => {
    const second = await recordVeto(pool, { ballotId: "bal-stop", decidedBy: "st-1", reason: "Different words." });
    expect(second.ok).toBe(true);
    expect(second.ok && second.fresh, "nothing new was written").toBe(false);
    expect(await vetoesFor(pool, "bal-stop")).toHaveLength(1);
    expect((await actFor(pool, "bal-stop", "st-1", "veto"))!.reason).toContain("ledger is settled");
  });

  it("records a no-objection that CLOSES NOTHING, and leaves the veto still open to its author", async () => {
    // The courtesy the founder allowed. It changes no timing, and a steward
    // who says nothing is wrong and then sees something can still stop it.
    const r = await recordNoObjection(pool, { ballotId: "bal-quiet", decidedBy: "st-1" });
    expect(r.ok).toBe(true);
    expect((await actFor(pool, "bal-quiet", "st-1", "no_objection"))!.reason).toBe("");
    expect((await stewardVetoStands(pool, "bal-quiet")).stands).toBe(false);

    const later = await recordVeto(pool, { ballotId: "bal-quiet", decidedBy: "st-1", reason: "I looked again." });
    expect(later.ok && later.fresh, "the second act is a real act, not a collision").toBe(true);
    const acts = await vetoesFor(pool, "bal-quiet");
    expect(acts.map((a) => a.act).sort()).toEqual(["no_objection", "veto"]);
    expect((await stewardVetoStands(pool, "bal-quiet")).stands).toBe(true);
  });

  it("needs a MAJORITY of the seated stewards once the village runs a council", async () => {
    await setVariable(pool, STEWARD_COUNCIL_KEY, "true");
    await recordVeto(pool, { ballotId: "bal-council", decidedBy: "st-1", reason: "One of us objects." });
    const one = await stewardVetoStands(pool, "bal-council");
    expect(one.council).toBe(true);
    expect(one.seated).toBe(2);
    expect(one.needed, "two seats, so a majority is two").toBe(2);
    expect(one.stands, "one steward alone no longer holds the village up").toBe(false);
    expect(one.sentence).toContain("a council here needs 2");

    await recordVeto(pool, { ballotId: "bal-council", decidedBy: "st-2", reason: "So does the other." });
    const two = await stewardVetoStands(pool, "bal-council");
    expect(two.stands).toBe(true);
    expect(two.vetoes).toBe(2);
    await setVariable(pool, STEWARD_COUNCIL_KEY, "false");
  });

  it("counts nobody's veto who never held the seat", async () => {
    await recordVeto(pool, { ballotId: "bal-stop", decidedBy: "pr-1", reason: "I would rather not." });
    const standing = await stewardVetoStands(pool, "bal-stop");
    expect(standing.by, "a row from a member is a row, and it is not a veto").toEqual(["st-1"]);
  });

  it("CANNOT be used on the ballot that unseats the steward's own role", async () => {
    // Risk 3 of the audit, in one assertion. A seat that can stop its own
    // removal can never be removed.
    const verdict = await subjectIsVetoable(pool, {
      subjectType: "role_unseat",
      subjectRef: `st-1@${STEWARD_ROLE_ID}`,
    });
    expect(verdict.vetoable).toBe(false);
    /*
     * THE COPY CHANGED BECAUSE THE RULE DID (20.11). The first build gave this
     * carve-out no window at all, so the sentence said the decision took
     * effect the moment it carried. It now keeps its timing and its window
     * like any other Game change and loses only the veto, so the sentence has
     * to say that or a steward reads a no-window promise into it.
     */
    expect(verdict.why).toContain("waits out its window");
    expect(verdict.why).toContain("could never be removed");
  });

  it("CANNOT be used on a change set that edits a limit on the seat, bundled or alone", async () => {
    // The bundle was the hole: asking the subject type alone answered
    // "vetoable" for a change set carrying the window length beside a dial.
    const bundled = await subjectIsVetoable(
      pool,
      { subjectType: "mechanics", subjectRef: "prop-x" },
      [{ key: "gratitude.pool" }, { key: "governance.veto_hours" }],
    );
    expect(bundled.vetoable).toBe(false);
    expect(bundled.why).toContain("governance.veto_hours");

    const alone = await subjectIsVetoable(pool, { subjectType: "mechanics", subjectRef: "prop-y" }, [
      { key: STEWARD_SUBJECTS_KEY },
    ]);
    expect(alone.vetoable).toBe(false);
  });

  it("reads the role off the userId@roleId reference the routes actually freeze", async () => {
    // A guess here decides whether a seat can stop its own removal, so the
    // reference is parsed rather than pattern-matched, and a reference this
    // build cannot read leaves the subject vetoable rather than silently
    // exempt.
    expect(roleFromSeatRef(`st-1@${STEWARD_ROLE_ID}`)).toBe(STEWARD_ROLE_ID);
    expect(roleFromSeatRef(STEWARD_ROLE_ID)).toBe(STEWARD_ROLE_ID);
    expect(roleFromSeatRef("@steward")).toBeNull();
    expect(roleFromSeatRef("")).toBeNull();
  });

  it("can still be used on a seating for any other role", async () => {
    const verdict = await subjectIsVetoable(pool, { subjectType: "role_seat", subjectRef: "pr-1@gardeners" });
    expect(verdict.vetoable).toBe(true);
  });

  it("can never be used on an advisory vote, which changes nothing", async () => {
    const verdict = await subjectIsVetoable(pool, { subjectType: "advisory", subjectRef: null });
    expect(verdict.vetoable).toBe(false);
    expect(verdict.why).toContain("nothing to stop");
  });

  it("blanks the words on a redaction and keeps the act, its author and its time", async () => {
    const row = (await actFor(pool, "bal-stop", "st-1", "veto"))!;
    const r = await redactVetoReason(pool, row.id, "st-2");
    expect(r.ok).toBe(true);
    expect(r.ok && r.alreadyRedacted).toBe(false);

    const after = (await actFor(pool, "bal-stop", "st-1", "veto"))!;
    expect(after.reason).toBe("");
    expect(after.redactedAt).toBeTruthy();
    expect(after.redactedBy).toBe("st-2");
    expect(after.decidedBy, "the author stays").toBe("st-1");
    expect(after.decidedAt).toBe(row.decidedAt);
    expect((await stewardVetoStands(pool, "bal-stop")).stands, "and the decision is still stopped").toBe(true);
  });

  it("reports a second redaction rather than moving the first one's timestamp", async () => {
    const row = (await actFor(pool, "bal-stop", "st-1", "veto"))!;
    const again = await redactVetoReason(pool, row.id, "st-1");
    expect(again.ok && again.alreadyRedacted).toBe(true);
    expect(again.ok && again.row.redactedBy, "the first redactor keeps the record").toBe("st-2");
  });

  it("blanks a departing member's own words, and counts what it blanked", async () => {
    // The right-to-be-forgotten path. A veto reason is free text about a named
    // neighbour, and anonymizeMember touched no governance table before this.
    const swept = await forgetStewardActs(pool, "st-2");
    expect(swept.redacted, "one unredacted act of st-2's").toBe(1);
    const nothingLeft = await forgetStewardActs(pool, "st-2");
    expect(nothingLeft.redacted, "nothing left to blank, which is not the same as a failure").toBe(0);
  });

  /*
   * THE WORDS ARE WRITTEN ONCE AND STORED THREE TIMES, and the first build of
   * both sweeps knew about one of them. `recordVeto` in the landing path
   * stamps the same sentence onto the ballot and onto the proposal, and those
   * are the copies the decision page and the proposer's own page render. So
   * "the words can be redacted later" was true on one page and false on two.
   */
  const mirrored = async (id: string, who: string, words: string): Promise<void> => {
    await ballot(id, "mechanics", "passed", "pr-1", `prop-${id}`);
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status) VALUES (?,?,?,?,?,?)",
      [`prop-${id}`, `Proposal ${id}`, "why", JSON.stringify([{ kind: "dial", key: "gratitude.pool" }]), "pr-1", "passed_onsite"],
    );
    await recordVeto(pool, { ballotId: id, decidedBy: who, reason: words });
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "UPDATE ballots SET vetoed_at = NOW(), vetoed_by = ?, veto_reason = ? WHERE id = ?",
      [who, words, id],
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "UPDATE mechanics_proposals SET vetoed_at = NOW(), vetoed_by = ?, veto_reason = ? WHERE id = ?",
      [who, words, `prop-${id}`],
    );
  };

  const mirrorsOf = async (id: string): Promise<{ ballot: string; proposal: string }> => {
    const [b]: any = await pool.query("SELECT veto_reason FROM ballots WHERE id = ?", [id]);
    const [p]: any = await pool.query("SELECT veto_reason FROM mechanics_proposals WHERE id = ?", [`prop-${id}`]);
    return { ballot: String(b[0]?.veto_reason ?? ""), proposal: String(p[0]?.veto_reason ?? "") };
  };

  it("REACHES EVERY COPY on a redaction, and leaves the act, the author and the time standing", async () => {
    await mirrored("bal-mirror", "st-1", "Rook took this to the wrong circle.");
    expect((await mirrorsOf("bal-mirror")).ballot).toContain("wrong circle");

    const row = (await actFor(pool, "bal-mirror", "st-1", "veto"))!;
    const r = await redactVetoReason(pool, row.id, "st-2");
    expect(r.ok).toBe(true);

    const after = (await actFor(pool, "bal-mirror", "st-1", "veto"))!;
    expect(after.reason).toBe("");
    expect(after.decidedBy, "the author stays").toBe("st-1");
    expect(after.decidedAt, "and the time stays").toBe(row.decidedAt);
    const mirrors = await mirrorsOf("bal-mirror");
    expect(mirrors.ballot, "the decision page reads this column").toBe("");
    expect(mirrors.proposal, "and the proposer's own page reads this one").toBe("");
  });

  it("sweeps every copy when a member leaves, and counts each table separately", async () => {
    await mirrored("bal-forget", "st-1", "Rook took this to the wrong circle.");
    const swept = await forgetStewardActs(pool, "st-1");
    expect(swept.redacted, "the acts st-1 wrote and had not already lost").toBeGreaterThan(0);
    expect(swept.ballots).toBeGreaterThan(0);
    expect(swept.proposals).toBeGreaterThan(0);
    const mirrors = await mirrorsOf("bal-forget");
    expect(mirrors.ballot).toBe("");
    expect(mirrors.proposal).toBe("");

    const again = await forgetStewardActs(pool, "st-1");
    expect(again.ballots, "nothing left to blank is not the same as a sweep that did not run").toBe(0);
    expect(again.proposals).toBe(0);
  });

  it("keeps governance mail on while somebody holds the seat, and lets it go when they do not", async () => {
    /*
     * The pin in `emailCadenceFor` is half the rule. Without this half a
     * seated steward turns governance mail off, the three window notices stop
     * being read, and the only warning anybody gets before a carried decision
     * lands is one nobody sees.
     */
    expect(await holdsStewardSeat(pool, "st-1")).toBe(true);
    const refusal = await stewardMailRefusal(pool, "st-1", { governanceEmail: "off" });
    expect(refusal).toBeTruthy();
    expect(String(refusal)).toContain("role_unseat");
    expect(await stewardMailRefusal(pool, "st-1", { emailsOff: true })).toBeTruthy();
    // Anything that is not silence goes straight through, and costs no query.
    expect(await stewardMailRefusal(pool, "st-1", { governanceEmail: "immediate" })).toBeNull();
    // Somebody who holds no seat keeps every preference they had.
    expect(await stewardMailRefusal(pool, "pr-1", { emailsOff: true })).toBeNull();
  });

  it("shows the per-subject map over the kinds of decision this village has actually held", async () => {
    const seen = await subjectTypesSeen(pool);
    expect(seen).toContain("mechanics");
    expect(seen).toContain("advisory");
  });
});

describe.skipIf(!configured)("a term that runs out, and the vacancy it leaves", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 });
    await loadVariables(pool);
    await member("lapse-1", "Wren Alder", "founder");
    await member("roll-1", "Rook Salt", "member");
    await seatCatalystsAsStewards(pool, LAUNCH_BALLOT, SEASON);
    await ballot("bal-held", "mechanics", "passed", "roll-1");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("holds the powers while the term is running", async () => {
    expect(await capabilitiesOf("lapse-1")).toContain(STEWARD_VETO);
    const state = await vacancyState(pool);
    expect(state.seated).toBe(true);
  });

  it("TAKES THE POWERS when the term date passes, which is the rule that replaced the old one", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "UPDATE role_holders SET term_ends_at = ? WHERE user_id = ?",
      [new Date("2020-01-01T00:00:00Z"), "lapse-1"],
    );
    expect(await capabilitiesOf("lapse-1"), "the seat expired, and the power with it").toEqual([]);
  });

  it("still shows who held it, marked lapsed, so the seat does not read as never filled", async () => {
    const held = await stewardsSeated(pool);
    expect(held).toHaveLength(1);
    expect(held[0].userId).toBe("lapse-1");
    expect(held[0].lapsed).toBe(true);
  });

  it("reads as vacant, and says the decisions land anyway", async () => {
    // The sentence that replaced "proposals wait". Nothing waits: a village
    // with no steward has nobody who can veto, which is the healthy end state
    // the founder described, and the copy never renders it as a fault.
    const state = await vacancyState(pool);
    expect(state.seated).toBe(false);
    expect(state.lapsed).toHaveLength(1);
    expect(state.sentence).toBe("No steward holds the seat; Game changes land at their landing time.");
    expect(state.healthy, "an empty seat is a state the village may be in, not a gap").toBe(true);
  });

  it("says it differently once the village puts everything out of the seat's reach", async () => {
    await setVariable(pool, STEWARD_SUBJECTS_KEY, "none");
    const state = await vacancyState(pool);
    expect(state.seated).toBe(false);
    expect(state.healthy).toBe(true);
    expect(state.sentence).toContain("agreements carry themselves");
    await setVariable(pool, STEWARD_SUBJECTS_KEY, "all");
  });

  it("closes the term row when the mandate ends, and says who ended it", async () => {
    // A term that reached its date and a term somebody cut short are different
    // facts, and they must never render alike a year later.
    expect((await openTermFor(pool, STEWARD_ROLE_ID, "lapse-1"))!.endedAt).toBeNull();
    const r = await recordTermEnded(pool, { roleId: STEWARD_ROLE_ID, userId: "lapse-1", endedBy: null });
    expect(r.ended).toBe(true);
    expect(await openTermFor(pool, STEWARD_ROLE_ID, "lapse-1"), "nothing open now").toBeNull();
    const history = await termHistoryFor(pool, STEWARD_ROLE_ID, "lapse-1");
    expect(history).toHaveLength(1);
    expect(history[0].endedAt).toBeTruthy();
    expect(history[0].endedBy, "the date ended it, and nobody did").toBeNull();
  });

  it("keeps the FIRST term when the same seat is filled again", async () => {
    // The whole reason 0176 exists: UNIQUE (role_id, user_id) on role_holders
    // forbids a second row, so without this table the second seating erases
    // every trace of the first.
    await recordTermStarted(pool, {
      roleId: STEWARD_ROLE_ID,
      userId: "lapse-1",
      termEndsAt: termEndsAtFromCycles(3),
      seasonId: "flowering-2027",
    });
    const history = await termHistoryFor(pool, STEWARD_ROLE_ID, "lapse-1");
    expect(history).toHaveLength(2);
    expect(history[0].endedAt, "the first one is still closed, with its own dates").toBeTruthy();
    expect(history[1].endedAt).toBeNull();
    expect(history[1].seasonId).toBe("flowering-2027");
  });

  it("puts the lapsed holding on the term watch's list, ended rather than expiring", async () => {
    const rows = await expiringHoldings(pool);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("lapse-1");
    expect(rows[0].ended).toBe(true);
  });

  it("tells the holder the powers ended, and is LOUD when no season is running", async () => {
    const told: Array<{ userId: string; body: string; key: string }> = [];
    const admins: string[] = [];
    const r = await runTermWatch({
      pool,
      seatings: [],
      season: { current: null },
      notify: async (n) => {
        told.push({ userId: n.userId, body: String(n.body ?? ""), key: n.dedupeKey });
        return { fresh: true };
      },
      notifyAdmins: async (type, title, key) => {
        admins.push(`${type}:${title}:${key}`);
      },
    });

    expect(r.ok).toBe(true);
    expect(r.holdersTold).toBe(1);
    expect(r.lapsed).toBe(1);
    expect(told[0].userId).toBe("lapse-1");
    expect(told[0].body, "the copy says the powers went with the seat").toContain("the powers that came with it");
    expect(told[0].key).toContain("perm-term-ended");

    // The audit's finding, made loud: every term is measured against a
    // calendar that can simply stop, and the seat that can veto hangs on it.
    expect(r.seasonRunning).toBe(false);
    expect(r.seasonKnown, "a season was handed in; it was empty").toBe(true);
    expect(r.seasonSentence).toContain("no season is running");
    expect(admins).toHaveLength(1);
    expect(admins[0]).toContain("No season is running");
  });

  it("tells NOBODY about the calendar while a season is running", async () => {
    const admins: string[] = [];
    const r = await runTermWatch({
      pool,
      seatings: [],
      season: { current: { id: "rooting-2026" } },
      notify: async () => ({ fresh: true }),
      notifyAdmins: async (type) => {
        admins.push(type);
      },
    });
    expect(r.seasonRunning).toBe(true);
    expect(admins).toEqual([]);
  });

  it("says CANNOT TELL, not NO SEASON, when the caller handed no calendar at all", async () => {
    // Two different facts. One is a village whose rhythm stopped; the other is
    // a sweep that could not read it, and collapsing them would hide the
    // second behind a message about the first.
    const admins: string[] = [];
    const r = await runTermWatch({
      pool,
      seatings: [],
      notify: async () => ({ fresh: true }),
      notifyAdmins: async (_type, title) => {
        admins.push(title);
      },
    });
    expect(r.seasonKnown).toBe(false);
    expect(r.seasonRunning).toBe(false);
    expect(r.seasonSentence).toContain("could not be read");
    expect(admins[0]).toContain("could not be read");
  });
});
