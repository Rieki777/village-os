/**
 * WHO A MEMBER WORKED WITH THIS CYCLE, read through the real joins.
 *
 * `gratitudeSuggestionsFor` (server/lib/gratitudeNudge.ts) is the one function
 * the gratitude nudge and the send panel's chips both read. This seeds one
 * person into each of the four traces work leaves (a shared quest, a quest
 * crew, a circle where both hold a role, a live session room) plus the people
 * who must NOT appear, and reads the suggestions back from a scratch schema.
 *
 * Each exclusion has its own row so a join that forgot it fails by name: an
 * example identity on the same quest, a member already thanked this cycle, a
 * quest partner whose work together ended before the cycle opened, a role
 * that ended before the cycle opened, and a room whose module is off.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { cycleWindow } from "./lib/economy";
import { presenceTest } from "./lib/memberPresence";
import { gratitudeSuggestionsFor, type SuggestionDeps } from "./lib/gratitudeNudge";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[gratitudeSuggestions.db] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

let db: TestDb;
let pool: mysql.Pool;

const isPresent = presenceTest("gratitude-suggestions-db-test-secret");
const { startsAt, key } = cycleWindow(new Date());
/** Inside the cycle open now, and well before it. */
const inside = new Date(startsAt.getTime() + 60_000);
const before = new Date(startsAt.getTime() - 20 * 86_400_000);

const PEOPLE = ["u-me", "u-ana", "u-ben", "u-cy", "u-dee", "u-old", "u-gone", "u-thanked", "u-example"];

async function q(sql: string, params: unknown[]) {
  await pool.query(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, as every DB suite holds

  for (const id of PEOPLE) {
    await q("INSERT INTO users (id, name, email, password_hash, is_example) VALUES (?,?,?,?,?)", [
      id, id.slice(2), `${id}@example.test`, "hash", id === "u-example" ? 1 : 0,
    ]);
  }

  // A shared quest inside the cycle: Ana, an example and somebody already thanked.
  const claim = (id: string, quest: string, user: string, status: string, at: Date) =>
    q("INSERT INTO quest_claims (id, quest_id, user_id, status, claimed_at, consented_at) VALUES (?,?,?,?,?,?)", [
      id, quest, user, status, at, status === "consented" ? at : null,
    ]);
  await claim("c1", "q-now", "u-me", "consented", inside);
  await claim("c2", "q-now", "u-ana", "submitted", inside);
  await claim("c3", "q-now", "u-example", "claimed", inside);
  await claim("c4", "q-now", "u-thanked", "claimed", inside);
  // A quest that finished, for both, before this cycle opened.
  await claim("c5", "q-old", "u-me", "consented", before);
  await claim("c6", "q-old", "u-old", "consented", before);

  // A quest crew, active.
  await q("INSERT INTO quest_crews (id, quest_id, name, creator_id, invite_code, status, created_at) VALUES (?,?,?,?,?,?,?)", [
    "crew-1", "q-crew", "Crew", "u-me", "INV1", "active", inside,
  ]);
  for (const u of ["u-me", "u-ben"]) {
    await q("INSERT INTO quest_crew_members (crew_id, user_id, joined_at) VALUES (?,?,?)", ["crew-1", u, inside]);
  }

  // One circle, three roles: mine, Cy's live one, and one that ended before the cycle.
  for (const r of ["r-me", "r-cy", "r-gone"]) {
    await q("INSERT INTO org_roles (id, circle_id, name) VALUES (?,?,?)", [r, "circle-a", r]);
  }
  const seat = (id: string, role: string, user: string, ended: Date | null) =>
    q("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, started_at, ended_at) VALUES (?,?,?,?,?,?,?)", [
      id, role, "member", user, user, before, ended,
    ]);
  await seat("a-me", "r-me", "u-me", null);
  await seat("a-cy", "r-cy", "u-cy", null);
  await seat("a-gone", "r-gone", "u-gone", new Date(before.getTime() + 86_400_000));

  // A live session room inside the cycle, with Dee.
  for (const [no, u] of [[1, "u-me"], [2, "u-dee"]] as const) {
    await q("INSERT INTO live_session_members (no, user_id) VALUES (?,?)", [no, u]);
  }
  await q(
    "INSERT INTO live_sessions (id, title, facilitator_no, created_by_no, duration_min, state, stamp, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [1, "Circle call", 1, 1, 60, "{}", "{}", inside],
  );
  for (const no of [1, 2]) {
    await q("INSERT INTO live_session_people (session_id, member_no, joined_at) VALUES (?,?,?)", [1, no, inside]);
  }

  // Already thanked this cycle.
  await q("INSERT INTO gratitude_log (id, from_id, to_id, amount, cycle_id, at) VALUES (?,?,?,?,?,?)", [
    "g1", "u-me", "u-thanked", 5, key, inside,
  ]);
});

afterAll(async () => {
  if (!configured) return;
  await pool?.end();
  await db?.drop();
});

function deps(sessionsOn = true): SuggestionDeps {
  return {
    pool,
    memberById: async (id) => (PEOPLE.includes(id) ? { id, name: id.slice(2), handle: id.slice(2), passwordHash: "hash", isExample: id === "u-example" } : null),
    isPresent,
    moduleOn: (id) => (id === "sessions" ? sessionsOn : true),
  };
}

describe.skipIf(!configured)("gratitudeSuggestionsFor, against the real joins", () => {
  it("finds the quest partner, the crewmate, the room and the circle, closest work first", async () => {
    const s = await gratitudeSuggestionsFor(deps(), "u-me");
    expect(s.map((p) => p.userId)).toEqual(["u-ana", "u-ben", "u-dee", "u-cy"]);
    expect(s.map((p) => p.sources)).toEqual([["quest"], ["crew"], ["session"], ["circle"]]);
    expect(s[0]).toMatchObject({ name: "ana", handle: "ana" });
  });

  it("leaves out an example, somebody already thanked, and work that ended before the cycle", async () => {
    const ids = (await gratitudeSuggestionsFor(deps(), "u-me")).map((p) => p.userId);
    for (const id of ["u-example", "u-thanked", "u-old", "u-gone", "u-me"]) expect(ids).not.toContain(id);
  });

  it("CONTROL: the thanked member IS a quest partner, so the exclusion is what kept them out", async () => {
    await q("DELETE FROM gratitude_log WHERE id = ?", ["g1"]);
    try {
      expect((await gratitudeSuggestionsFor(deps(), "u-me")).map((p) => p.userId)).toContain("u-thanked");
    } finally {
      await q("INSERT INTO gratitude_log (id, from_id, to_id, amount, cycle_id, at) VALUES (?,?,?,?,?,?)", [
        "g1", "u-me", "u-thanked", 5, key, inside,
      ]);
    }
  });

  it("reads no session room while the sessions module is off", async () => {
    expect((await gratitudeSuggestionsFor(deps(false), "u-me")).map((p) => p.userId)).not.toContain("u-dee");
  });

  it("works both ways: Ana's suggestions include this member", async () => {
    // The thanks was this member's, so it leaves Ana's list alone.
    expect((await gratitudeSuggestionsFor(deps(), "u-ana")).map((p) => p.userId)).toEqual(["u-me", "u-thanked"]);
  });

  it("is never padded with strangers to reach three", async () => {
    const s = await gratitudeSuggestionsFor(deps(), "u-dee");
    expect(s.map((p) => p.userId)).toEqual(["u-me"]);
  });
});
