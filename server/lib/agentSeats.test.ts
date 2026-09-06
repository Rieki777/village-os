/**
 * An agent holds a seat (0142), and everything that must stay true when it does.
 *
 * THESE ARE THE SECURITY PROPERTY OF SEATING A MACHINE. Two of them are not
 * about code this lane wrote: the settlement filter and the declare door both
 * predate agents, and the whole model rests on them already being right.
 * Asserting them HERE is the point, because an inherited guarantee that nobody
 * tests is a guarantee that can be loosened by somebody who does not know it
 * was carrying this weight.
 *
 * The settlement query below is copied VERBATIM from server/lib/economy.ts. It
 * is deliberately a copy: this test asks whether that exact predicate excludes
 * an agent, and importing a helper would test the helper instead. If the two
 * ever drift, that is the thing this file exists to catch.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  agentKeySlug,
  claimSeating,
  listOrgAssignments,
  listOrgRoles,
  mayDeclare,
  peopleOnly,
  seatHolder,
  seatState,
  unclaimedSeatingsFor,
  structuralLoad,
  type OrgAssignment,
} from "./orgChart";
import { measureVisionMetrics } from "./orgDrafts";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

/** The settlement predicate, word for word from server/lib/economy.ts. */
const SETTLEMENT_SEATS =
  "SELECT `id`, `org_role_id`, `user_id` FROM `org_role_assignments` " +
  "WHERE `active_holder_key` IS NOT NULL AND `holder_kind` = 'member' " +
  "AND `user_id` IS NOT NULL AND `is_example` = 0";

describe.skipIf(!configured)("an agent holds a seat", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM org_role_assignments"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM org_roles"); // module-review-ok: same
    await pool.query("DELETE FROM users"); // module-review-ok: same
  });

  const makeSeat = async (id: string, over: Record<string, unknown> = {}) => {
    const cols = { id, name: `Seat ${id}`, seats: 1, circle_id: null, represents_circle: 0, ...over };
    const keys = Object.keys(cols);
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      `INSERT INTO org_roles (${keys.map((k) => `\`${k}\``).join(", ")}) VALUES (${keys.map(() => "?").join(",")})`,
      keys.map((k) => (cols as Record<string, unknown>)[k]),
    );
  };

  const makeMember = async (id: string) => {
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,'member')",
      [id, `Person ${id}`, `${id}@example.test`, "x"],
    );
  };

  // ── THE MODEL ────────────────────────────────────────────────────────────

  it("lands as a documented holder keyed agent:<slug>, with no account", async () => {
    await makeSeat("s1");
    const r = await seatHolder(pool, "s1", { displayName: "Meeting Scribe", isAgent: true, agentSlug: "scribe" });
    expect(r.ok).toBe(true);

    const [[row]] = await pool.query<any[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT holder_kind, holder_key, user_id, is_agent FROM org_role_assignments WHERE org_role_id = 's1'",
    );
    expect(row.holder_kind).toBe("documented");
    expect(row.holder_key).toBe("agent:scribe");
    expect(row.user_id).toBeNull();
    expect(Number(row.is_agent)).toBe(1);
  });

  it("REFUSES to give an agent a member account, which is the one rule that closes both doors", async () => {
    await makeSeat("s1");
    await makeMember("u1");
    const r = await seatHolder(pool, "s1", { userId: "u1", isAgent: true, displayName: "Scribe" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no member account");
    // The refusal is scoped to the SEAT PLANE and does not claim that no agent
    // may ever hold a users row. Governance ruling 19G gives a voting
    // representative for a river or a mountain an account of its own, and that
    // object is not this one.

    const [rows] = await pool.query<any[]>("SELECT id FROM org_role_assignments"); // module-review-ok: same
    expect(rows).toHaveLength(0);
  });

  it("cannot be CLAIMED into a member account either, which is the same door by another route", async () => {
    /*
     * The seating route is not the only way a row becomes a member holding.
     * `claimSeating` flips a documented seating to `holder_kind = 'member'`
     * with a user id, gated only on the signed-in member's NAME matching the
     * name written on the card. An agent is a documented holder, so before
     * this guard a member called Scribe could claim a seat held by an agent
     * called Scribe and arrive at exactly the state seatHolder refuses: paid
     * by the settlement job and able to open the declare door.
     *
     * The name test is looser than it looks, which is what makes this worth a
     * test rather than a comment: `unclaimedSeatingsFor` also matches when the
     * recorded name equals the member's FIRST name, so an agent called Memory
     * is offered to everybody first-named Memory.
     */
    await makeSeat("s1");
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,'member')",
      ["u-scribe", "Scribe", "scribe@example.test", "x"],
    );
    await seatHolder(pool, "s1", { displayName: "Scribe", isAgent: true, agentSlug: "scribe" });

    // Never offered.
    expect(await unclaimedSeatingsFor(pool, "Scribe")).toHaveLength(0);

    // And refused even when the id is known, because the offer list must not
    // be the only thing standing between an agent seat and an account.
    const [[seating]] = await pool.query<any[]>( // module-review-ok: same
      "SELECT id FROM org_role_assignments WHERE org_role_id = 's1'",
    );
    expect(await claimSeating(pool, seating.id, "u-scribe")).toBe(false);

    const [[after]] = await pool.query<any[]>( // module-review-ok: same
      "SELECT holder_kind, user_id, is_agent FROM org_role_assignments WHERE id = ?",
      [seating.id],
    );
    expect(after.holder_kind).toBe("documented");
    expect(after.user_id).toBeNull();
    expect(Number(after.is_agent)).toBe(1);
  });

  it("still lets a real person claim the seat somebody wrote their name on", async () => {
    // The guard above must not close the door it was not aimed at. A
    // documented HUMAN is the whole reason claiming exists.
    await makeSeat("s2");
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,'member')",
      ["u-ada", "Ada Vance", "ada@example.test", "x"],
    );
    await seatHolder(pool, "s2", { displayName: "Ada Vance" });

    expect(await unclaimedSeatingsFor(pool, "Ada Vance")).toHaveLength(1);
    const [[seating]] = await pool.query<any[]>( // module-review-ok: same
      "SELECT id FROM org_role_assignments WHERE org_role_id = 's2'",
    );
    expect(await claimSeating(pool, seating.id, "u-ada")).toBe(true);

    const [[after]] = await pool.query<any[]>( // module-review-ok: same
      "SELECT holder_kind, user_id FROM org_role_assignments WHERE id = ?",
      [seating.id],
    );
    expect(after.holder_kind).toBe("member");
    expect(after.user_id).toBe("u-ada");
  });

  it("keeps an agent's key from colliding with a documented human of the same name", async () => {
    // `documentedKey` slugifies to `doc:ada-vance` and this to `agent:ada-vance`,
    // so the same name seated twice on one seat is two holders and not a
    // duplicate-key refusal.
    await makeSeat("s1", { seats: 2 });
    expect((await seatHolder(pool, "s1", { displayName: "Ada Vance" })).ok).toBe(true);
    expect((await seatHolder(pool, "s1", { displayName: "Ada Vance", isAgent: true })).ok).toBe(true);
    expect(agentKeySlug("Ada Vance")).toBe("ada-vance");
    expect(agentKeySlug("agent:Ada Vance")).toBe("ada-vance");
  });

  // ── THE MONEY, INHERITED AND NOT INVENTED ────────────────────────────────

  it("is invisible to the settlement job's own seat query", async () => {
    await makeSeat("s1", { seats: 3 });
    await makeMember("u1");
    await seatHolder(pool, "s1", { userId: "u1" });
    await seatHolder(pool, "s1", { displayName: "Meeting Scribe", isAgent: true, agentSlug: "scribe" });
    await seatHolder(pool, "s1", { displayName: "Ada, on a card" });

    const [paid] = await pool.query<any[]>(SETTLEMENT_SEATS); // module-review-ok: the real predicate, against the scratch schema
    expect(paid.map((r) => r.user_id)).toEqual(["u1"]);
  });

  // ── THE ONE PERMISSION DOOR ──────────────────────────────────────────────

  it("cannot open the circle declare door, and cannot lend it to anybody either", async () => {
    // The 0083 bridge: a live holder of a seat flagged represents_circle may
    // redeclare how THAT circle decides. This is the acceptance test named in
    // the work order Saberra received.
    await makeSeat("speaks", { circle_id: "c1", represents_circle: 1, seats: 2 });
    await makeMember("u1");
    await seatHolder(pool, "speaks", { displayName: "Meeting Scribe", isAgent: true, agentSlug: "scribe" });

    const roles = await listOrgRoles(pool);
    const assignments = await listOrgAssignments(pool);
    const ctx = { isAdmin: false, hasOrgDeclare: false, roles, assignments };

    // The agent itself. It has no user id at all, so the door short-circuits
    // before it ever looks at the seat.
    expect(mayDeclare("c1", { ...ctx, userId: null })).toBe(false);

    // And a real member cannot inherit the agent's seat: the seating carries a
    // null user_id, so `a.userId === ctx.userId` is false for every person
    // alive. This is the case that would matter if an agent were ever given an
    // account, and it is why the refusal above exists at the write.
    expect(mayDeclare("c1", { ...ctx, userId: "u1" })).toBe(false);

    // The same seat held by a real person DOES open it, so the assertion above
    // is about the agent and not about a door that is shut for everybody.
    await seatHolder(pool, "speaks", { userId: "u1" });
    const withPerson = await listOrgAssignments(pool);
    expect(mayDeclare("c1", { ...ctx, assignments: withPerson, userId: "u1" })).toBe(true);
  });

  // ── COVERAGE, WHICH IS THE READING THAT WAS WRONG ────────────────────────

  it("does not inflate seat coverage: a seat only an agent holds is held and uncarried", async () => {
    await makeSeat("human-held");
    await makeSeat("agent-held");
    await makeSeat("empty");
    await makeMember("u1");
    await seatHolder(pool, "human-held", { userId: "u1" });
    await seatHolder(pool, "agent-held", { displayName: "Scribe", isAgent: true, agentSlug: "scribe" });

    const roles = await listOrgRoles(pool);
    const assignments = await listOrgAssignments(pool);
    const load = structuralLoad(roles, assignments);

    // Three seats. One carried, one held by a machine, one vacant.
    expect(load.seatingsLive).toBe(2);
    expect(load.humanSeatingsLive).toBe(1);
    expect(load.seatsHeldOnlyByAgents).toBe(1);
    // The agent-held seat is NOT counted as vacant, because it is not: it has
    // a holder. The whole point is that "not vacant" and "carried" stopped
    // being the same number.
    expect(load.unheldSeats).toBe(1);

    const agent = load.holders.find((h) => h.holderKey === "agent:scribe");
    expect(agent?.isAgent).toBe(true);
    expect(load.holders.find((h) => h.holderKey === "u1")?.isAgent).toBe(false);
  });

  it("keeps an agent-held seat out of the seats_filled vision metric", async () => {
    // This metric is a TRIGGER and not a display: meeting it prompts a human
    // to publish a whole reorganisation. Counting agents would let a village
    // reach the number without reaching the thing it stood for.
    await makeSeat("human-held");
    await makeSeat("agent-held");
    await makeMember("u1");
    await seatHolder(pool, "human-held", { userId: "u1" });
    await seatHolder(pool, "agent-held", { displayName: "Scribe", isAgent: true, agentSlug: "scribe" });

    const measured = await measureVisionMetrics(pool, new Set(["seats_filled"]), {
      lapseContext: () => ({ cadence: "never", currentSeasonId: null }),
      allMembers: async () => [],
      consentedCounts: async () => new Map(),
      isExampleUser: () => false,
      computeStage: () => "",
      seasonsCompleted: () => 0,
    });
    expect(measured.get("seats_filled")).toBe(1);
  });

  it("still RENDERS the seat as held, because it is", async () => {
    // The display half of the same decision, and the reason `seatState` was
    // left alone. The map, the seat cards and the public export all ask it,
    // and a seat an agent sits in is occupied. `isAgent` is how a surface says
    // by what, and `peopleOnly` is how a coverage read asks the other question.
    await makeSeat("agent-held");
    await seatHolder(pool, "agent-held", { displayName: "Scribe", isAgent: true, agentSlug: "scribe" });
    const roles = await listOrgRoles(pool);
    const held = await listOrgAssignments(pool);
    const seat = roles.find((r) => r.id === "agent-held")!;

    expect(seatState(seat, held)).toBe("filled");
    expect(peopleOnly(held)).toHaveLength(0);
    expect(seatState(seat, peopleOnly(held) as OrgAssignment[])).toBe("open");
  });
});
