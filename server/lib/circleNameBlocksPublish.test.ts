/**
 * A proposed seat whose circle arrived as a name this village cannot place is
 * blocked at preview, and its draft refuses to publish.
 *
 * THE DEFECT THIS GUARDS. `previewDraft` refused a `circleId` that does not
 * exist and nothing refused a MISSING one. A vendor that gives a seat's circle
 * by name, where the name matches no circle, produced a seat with no circle id,
 * and that seat previewed clean and published into no circle at all. No block,
 * no log line, a seat floating free of the structure the vendor described.
 *
 * The normaliser keeps such a name as `circleName` beside the number of
 * circles it matched, and the preview now blocks on it with a sentence that
 * says what to do. The last two tests are the controls: a name that resolved,
 * and an explicit id, both still publish.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft, previewDraft, publishDraft, type DraftOp } from "./orgDrafts";
import { normaliseProposedSeat, type LiveCircle } from "./proposedSeats";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function draftWith(changes: { op: DraftOp; orgRoleId: string; payload: Record<string, unknown> }[]) {
  const made = await createDraft(pool, {
    title: "Seats as a vendor proposed them",
    createdBy: "u-steward",
    sourceKind: "agent",
    sourceModuleId: "vendor",
    openCap: 99,
  });
  if (!made.ok) throw new Error(made.error);
  for (const c of changes) {
    const added = await addChange(pool, made.id, c);
    if (!added.ok) throw new Error(added.error);
  }
  return made.id;
}

async function liveCircles(): Promise<LiveCircle[]> {
  const [rows] = await pool.query<any[]>("SELECT id, name, aliases, is_example FROM circles"); // module-review-ok: reading back the scratch schema this suite provisioned
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: typeof r.aliases === "string" ? JSON.parse(r.aliases) : r.aliases,
    isExample: Number(r.is_example) === 1,
  }));
}

async function seatRow(id: string) {
  const [[row]] = await pool.query<any[]>( // module-review-ok: same
    "SELECT id, circle_id, accountabilities FROM org_roles WHERE id = ?", [id],
  );
  return row;
}

describe.skipIf(!configured)("a circle given by a name this village cannot place", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles WHERE id LIKE 'cnb-%'"); // module-review-ok: same, only this suite's own seats
    await pool.query("DELETE FROM circles WHERE id LIKE 'cnb-%'"); // module-review-ok: same, only this suite's own circles
  });

  it("blocks a seat whose circle name matched nothing, says what to do, and refuses to publish", async () => {
    const seat = normaliseProposedSeat(
      { role_name: "Spring Keeper", circle: "Nowhere Circle", seat_count: 1, accountabilities: "Test the spring; Keep the log." },
      await liveCircles(),
    );
    expect(seat.payload.circleId).toBeUndefined();
    expect(seat.payload.circleName).toBe("Nowhere Circle");

    const id = await draftWith([{ op: "create_seat", orgRoleId: "cnb-spring", payload: seat.payload }]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked).toBe(1);
    expect(preview.lines[0].blocked).toContain('There is no circle called "Nowhere Circle" yet');
    expect(preview.lines[0].blocked).toContain("withdraw this draft and accept the batch again");

    const r = await publishDraft(pool, id, "u-steward", 99);
    expect(r.ok).toBe(false);
    expect(!r.ok ? r.error : "").toContain("Nowhere Circle");
    expect(await seatRow("cnb-spring")).toBeUndefined();
  });

  it("blocks a name that matched more than one circle, with its own sentence", async () => {
    const id = await draftWith([
      { op: "create_seat", orgRoleId: "cnb-cook", payload: { name: "Cook", circleName: "Hearth", circleMatches: 2 } },
    ]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked).toBe(1);
    expect(preview.lines[0].blocked).toContain('More than one circle answers to "Hearth"');
    const r = await publishDraft(pool, id, "u-steward", 99);
    expect(r.ok).toBe(false);
  });

  it("blocks an update_seat that carries a circle name and no id", async () => {
    await pool.query("INSERT INTO org_roles (id, name, seats) VALUES ('cnb-existing', 'Existing Seat', 1)"); // module-review-ok: a fixture on the scratch schema this suite provisioned
    const id = await draftWith([
      { op: "update_seat", orgRoleId: "cnb-existing", payload: { aim: "A new aim", circleName: "Nowhere Circle", circleMatches: 0 } },
    ]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked).toBe(1);
    expect(preview.lines[0].blocked).toContain('There is no circle called "Nowhere Circle" yet');
  });

  it("publishes a seat whose circle name resolved, into that circle, with its accountabilities as a list", async () => {
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO circles (id, name, aliases, is_example) VALUES ('cnb-springs', 'Springs & Wells', ?, 0)",
      [JSON.stringify(["Water Care"])],
    );
    const seat = normaliseProposedSeat(
      { role_name: "Spring Keeper", circle: " water care", seat_count: 1, accountabilities: "Test the spring; Keep the log." },
      await liveCircles(),
    );
    expect(seat.payload.circleId).toBe("cnb-springs");

    const id = await draftWith([{ op: "create_seat", orgRoleId: "cnb-spring", payload: seat.payload }]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
    const r = await publishDraft(pool, id, "u-steward", 99);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);

    const row = await seatRow("cnb-spring");
    expect(row.circle_id).toBe("cnb-springs");
    const acc = typeof row.accountabilities === "string" ? JSON.parse(row.accountabilities) : row.accountabilities;
    expect(acc).toEqual(["Test the spring", "Keep the log"]);
  });

  it("lets an explicit circleId through even beside a stale circle name", async () => {
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO circles (id, name, aliases, is_example) VALUES ('cnb-springs', 'Springs & Wells', ?, 0)",
      [JSON.stringify([])],
    );
    const id = await draftWith([
      {
        op: "create_seat",
        orgRoleId: "cnb-placed",
        payload: { name: "Placed Seat", circleId: "cnb-springs", circleName: "Nowhere Circle", circleMatches: 0 },
      },
    ]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
  });
});
