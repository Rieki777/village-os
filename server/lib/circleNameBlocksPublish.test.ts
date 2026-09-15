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

async function draftWith(
  changes: { op: DraftOp; orgRoleId: string; payload: Record<string, unknown> }[],
  // Set for a draft the review queue made, which is the one a withdraw reopens proposals for.
  sourceProposalId: string | null = "xprop-cnb",
) {
  const made = await createDraft(pool, {
    title: "Seats as a vendor proposed them",
    createdBy: "u-steward",
    sourceKind: "agent",
    sourceModuleId: "vendor",
    sourceProposalId,
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
    "SELECT id, circle_id, accountabilities, aim, recruiting FROM org_roles WHERE id = ?", [id],
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
    // The recovery that exists: a withdraw reopens this draft's proposals.
    // "Accept the batch again" would also take every other waiting proposal.
    expect(preview.lines[0].blocked).toContain("withdraw this draft. Its proposals go back in the review queue");
    expect(preview.lines[0].blocked).not.toContain("batch");

    const r = await publishDraft(pool, id, "u-steward", 99);
    expect(r.ok).toBe(false);
    expect(!r.ok ? r.error : "").toContain("Nowhere Circle");
    expect(await seatRow("cnb-spring")).toBeUndefined();
  });

  it("tells a person who made the draft by hand to make it again, since no proposal goes back", async () => {
    const id = await draftWith(
      [{ op: "create_seat", orgRoleId: "cnb-hand", payload: { name: "Hand Seat", circleName: "Nowhere Circle", circleMatches: 0 } }],
      null,
    );
    const preview = await previewDraft(pool, id, 99);
    expect(preview.lines[0].blocked).toContain("withdraw this draft and make it again");
    expect(preview.lines[0].blocked).not.toContain("queue");
  });

  it("blocks a seat whose circle arrived in a shape nothing reads, which published into no circle", async () => {
    const seat = normaliseProposedSeat(
      { role_name: "Spring Keeper", circle: { id: "springs", name: "Springs & Wells" } },
      await liveCircles(),
    );
    expect(seat.payload.circleUnread).toEqual(["circle"]);
    const id = await draftWith([{ op: "create_seat", orgRoleId: "cnb-unread", payload: seat.payload }]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked).toBe(1);
    expect(preview.lines[0].blocked).toContain('This seat gave its circle under "circle" in a form this village cannot read');
    const r = await publishDraft(pool, id, "u-steward", 99);
    expect(r.ok).toBe(false);
    expect(await seatRow("cnb-unread")).toBeUndefined();
  });

  it("checks a circle id of 0 against the circles, where truthiness skipped it and published circle \"0\"", async () => {
    const id = await draftWith([{ op: "create_seat", orgRoleId: "cnb-zero", payload: { name: "Zero Seat", circleId: 0 } }]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.lines[0].blocked).toBe("That circle does not exist. A draft cannot create circles");
    expect((await publishDraft(pool, id, "u-steward", 99)).ok).toBe(false);
    expect(await seatRow("cnb-zero")).toBeUndefined();
  });

  it("blocks a text field that is an object or a list, and a recruiting flag it would write as 0", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      // An object publishes as the literal "[object Object]".
      ["cnb-obj-aim", { name: "Cook", aim: { text: "Feed the village" } }, "This seat's aim is not text"],
      ["cnb-obj-name", { name: { en: "Cook" } }, "This seat's name is not text"],
      // An array expands into extra VALUES and rolls the whole publish back.
      ["cnb-arr-domain", { name: "Pump Keeper", domain: ["Water lines", "Pumps"] }, "This seat's domain is not text"],
      ["cnb-yes", { name: "Recruiter", recruiting: "yes" }, "Recruiting is true or false"],
    ];
    for (const [seatId, payload, sentence] of cases) {
      const id = await draftWith([{ op: "create_seat", orgRoleId: seatId, payload }]);
      const preview = await previewDraft(pool, id, 99);
      expect(preview.lines[0].blocked, seatId).toContain(sentence);
      expect((await publishDraft(pool, id, "u-steward", 99)).ok, seatId).toBe(false);
      expect(await seatRow(seatId), seatId).toBeUndefined();
    }
  });

  it("publishes a vendor's recruiting \"yes\" as recruiting, read by the normaliser", async () => {
    const seat = normaliseProposedSeat({ role_name: "Recruiter", recruiting: "yes", aim: "Find people" }, await liveCircles());
    const id = await draftWith([{ op: "create_seat", orgRoleId: "cnb-recruits", payload: seat.payload }]);
    const r = await publishDraft(pool, id, "u-steward", 99);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    const row = await seatRow("cnb-recruits");
    expect(Number(row.recruiting)).toBe(1);
    expect(row.aim).toBe("Find people");
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

    // The same seat, edited with an aim of a shape the UPDATE would bind raw.
    const shaped = await draftWith([
      { op: "update_seat", orgRoleId: "cnb-existing", payload: { aim: { text: "A new aim" } } },
    ]);
    const shapedPreview = await previewDraft(pool, shaped, 99);
    expect(shapedPreview.lines[0].blocked).toContain("This seat's aim is not text");
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

  it("lists a live-name collision beside a missing circle in one preview, the collision first", async () => {
    // One reason per line used to let the circle hide the collision: an admin
    // made the circle, the steward accepted again, and only then heard the
    // name was taken. A live circle for a seat that was never going to publish.
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO org_roles (id, name, seats, active, is_example) VALUES ('cnb-live', 'Operations Keeper', 1, 1, 0)",
    );
    const seat = normaliseProposedSeat({ role_name: "Operations Keeper", circle: "Nowhere Circle" }, await liveCircles());
    const id = await draftWith([{ op: "create_seat", orgRoleId: "cnb-dup", payload: seat.payload }]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked).toBe(1);
    const reason = String(preview.lines[0].blocked);
    const collision = reason.indexOf('This village already has a live seat called "Operations Keeper"');
    expect(collision, reason).toBeGreaterThanOrEqual(0);
    expect(reason.indexOf('There is no circle called "Nowhere Circle" yet'), reason).toBeGreaterThan(collision);
    expect(reason).toContain("reject this one or give it a name of its own");

    // An unknown circle id no longer overwrites an id collision.
    const both = await draftWith([
      { op: "create_seat", orgRoleId: "cnb-live", payload: { name: "Fresh Name", circleId: "cnb-missing" } },
    ]);
    const bothReason = String((await previewDraft(pool, both, 99)).lines[0].blocked);
    expect(bothReason).toContain("A seat with that id already exists");
    expect(bothReason).toContain("That circle does not exist");
  });

  it("publishes a seat that copied the platform's representsCircle flag, which blocked on a circle it never had", async () => {
    const seat = normaliseProposedSeat({ name: "Night Watch", representsCircle: false }, await liveCircles());
    expect(seat.ignored).toEqual(["representsCircle"]);
    const id = await draftWith([{ op: "create_seat", orgRoleId: "cnb-watch", payload: seat.payload }]);
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
    const r = await publishDraft(pool, id, "u-steward", 99);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    expect((await seatRow("cnb-watch")).circle_id).toBeNull();
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
