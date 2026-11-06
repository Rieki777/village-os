/**
 * ONE EXPORT OF THE VILLAGE'S DATABASE, BY THE VILLAGE'S VOTE (Rye,
 * 2026-11-06). The rules in server/lib/exportVotes.ts, against a real schema:
 * who may be named, the bar the vote is asked at, and that a carried vote
 * gives exactly one download to exactly one live steward.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { claimVotedExport, DATABASE_EXPORT, exportStanding, exportVoteCloser, putExportToVillage, releaseVotedExport, type ExportVoteDeps } from "./exportVotes";
import { loadVariables, setVariable } from "./variables";
import { TIER_FLOORS } from "../../shared/governanceEngine";
import { TIER_SETTING_KEYS } from "../../shared/ballotSubjects";
import type { BallotRow } from "./ballots";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const people: Record<string, { id: string; name: string; isExample?: boolean }> = {
  "u-asker": { id: "u-asker", name: "Ari Asker" },
  "u-st1": { id: "u-st1", name: "Sol Steward" },
  "u-st2": { id: "u-st2", name: "Tam Steward" },
  "u-st3": { id: "u-st3", name: "Uma Steward" },
  "u-st4": { id: "u-st4", name: "Vic Steward" },
  "u-gone": { id: "u-gone", name: "Wen Former" },
};
const told: Array<{ userId: string; title: string }> = [];
const deps = (): ExportVoteDeps => ({
  pool,
  members: { byId: async (id: string) => (people[id] ? { ...people[id] } : null) },
  notify: async (input) => {
    told.push({ userId: input.userId, title: input.title });
  },
});
const setup = () => ({
  method: "custom" as const,
  dials: { unityPct: 50, quorumPct: 0 },
  snapshot: { mode: "equal" as const, token: null },
  tokenProblem: null,
  electorate: Object.keys(people).map((userId) => ({ userId, weight: 1 })),
  durationDays: 3,
});
const REASON = "Our admin password holder has left, and we need a copy before the move.";

async function seat(userId: string, endsInDays: number | null): Promise<void> {
  const ends = endsInDays === null ? null : new Date(Date.now() + endsInDays * 86_400_000);
  await pool.query( // module-review-ok: fixture SQL seating a steward on the S5 scratch schema
    "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at) VALUES (?, 'steward', ?, 'fixture', ?)",
    [`rh-${userId}`, userId, ends],
  );
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool
  await loadVariables(pool);
  for (const id of ["u-st1", "u-st2", "u-st3", "u-st4"]) await seat(id, 90);
  await seat("u-gone", -1);
}, 300000);

afterAll(async () => {
  if (pool) await pool.end();
  if (db) await db.drop();
});

const open = async (stewardUserId: string) => {
  const opened = await putExportToVillage(deps(), { stewardUserId, openedBy: "u-asker", reason: REASON, setup: setup() });
  if (!opened.ok) throw new Error(JSON.stringify(opened.body));
  return opened.ballot as BallotRow;
};

describe.skipIf(!configured)("one export of the database, by the village's vote", () => {
  it("names only a steward whose seat is live, and only with a reason", async () => {
    expect(await putExportToVillage(deps(), { stewardUserId: "u-asker", openedBy: "u-asker", reason: REASON, setup: setup() })).toMatchObject({ ok: false, status: 409 });
    expect(await putExportToVillage(deps(), { stewardUserId: "u-gone", openedBy: "u-asker", reason: REASON, setup: setup() }), "a lapsed seat").toMatchObject({ ok: false, status: 409 });
    expect(await putExportToVillage(deps(), { stewardUserId: "u-st1", openedBy: "u-asker", reason: "pls", setup: setup() })).toMatchObject({ ok: false, status: 400 });
  });

  it("asks at the constitutional floor at least, against the ordinary dials it was handed", async () => {
    const b = await open("u-st1");
    expect(b.subjectType).toBe(DATABASE_EXPORT);
    expect(b.subjectRef).toBe("u-st1");
    expect(b.unityPct).toBeGreaterThanOrEqual(TIER_FLOORS.constitutional.unityPct);
    expect(b.quorumPct).toBeGreaterThanOrEqual(TIER_FLOORS.constitutional.quorumPct);
    expect(b.docMarkdown).toContain("Steward (Sol)");
    // One open vote per steward.
    expect(await putExportToVillage(deps(), { stewardUserId: "u-st1", openedBy: "u-asker", reason: REASON, setup: setup() })).toMatchObject({ ok: false, status: 409 });
  });

  it("asks at the village's own highest tier when the village set it higher", async () => {
    const keys = TIER_SETTING_KEYS.constitutional;
    expect((await setVariable(pool, keys.unity, "99")).ok).toBe(true);
    expect((await setVariable(pool, keys.quorum, "99")).ok).toBe(true);
    try {
      const b = await open("u-st2");
      expect(b.unityPct).toBe(99);
      expect(b.quorumPct).toBe(99);
    } finally {
      await setVariable(pool, keys.unity, String(TIER_FLOORS.constitutional.unityPct));
      await setVariable(pool, keys.quorum, String(TIER_FLOORS.constitutional.quorumPct));
    }
  });

  it("a carried vote gives one download to the named steward, once", async () => {
    const b = await open("u-st3");
    expect(await claimVotedExport(pool, b.id, "u-st3"), "the control: nothing carried yet").toMatchObject({ ok: false, status: 404 });
    const closer = exportVoteCloser(deps());
    expect((await closer.execute!(b, "u-asker")).applied).toEqual([`${DATABASE_EXPORT}:${b.id}`]);
    expect(told.some((t) => t.userId === "u-st3" && /authorised one copy/.test(t.title)), "the steward is told").toBe(true);
    await closer.execute!(b, "u-asker"); // idempotent

    expect(await claimVotedExport(pool, b.id, "u-st1"), "another steward").toMatchObject({ ok: false, status: 403 });
    expect(await claimVotedExport(pool, b.id, "u-st3")).toEqual({ ok: true });
    expect(await claimVotedExport(pool, b.id, "u-st3"), "a second time").toMatchObject({ ok: false, status: 410 });
    expect((await exportStanding(pool, b.id, "u-st3")).delivered).not.toBeNull();

    // A download that failed before any byte gives the claim back.
    await releaseVotedExport(pool, b.id);
    expect(await claimVotedExport(pool, b.id, "u-st3")).toEqual({ ok: true });
  });

  it("a vote that did not carry gives nothing", async () => {
    const b = await open("u-st4");
    await exportVoteCloser(deps()).settle(b, "failed", "The village said no.", "u-asker");
    expect(await claimVotedExport(pool, b.id, "u-st4")).toMatchObject({ ok: false, status: 404 });
    expect((await exportStanding(pool, b.id, "u-st4")).granted).toBe(false);
  });

  it("a steward whose seat has lapsed since the vote cannot take it, and it stays unused", async () => {
    const b = { id: "bal-lapse", subjectType: DATABASE_EXPORT, subjectRef: "u-gone", openedBy: "u-asker", title: "t" } as BallotRow;
    await exportVoteCloser(deps()).execute!(b, "u-asker");
    expect(await claimVotedExport(pool, b.id, "u-gone")).toMatchObject({ ok: false, status: 403 });
    expect((await exportStanding(pool, b.id, "u-gone")).delivered).toBeNull();
  });
});
