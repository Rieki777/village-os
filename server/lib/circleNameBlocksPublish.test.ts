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
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  addChange,
  createDraft,
  listDrafts,
  loadPreviewContext,
  previewDraft,
  publishDraft,
  stuckQueueDrafts,
  type Draft,
  type DraftOp,
} from "./orgDrafts";
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

  it("lists every bad field of a hand-built seat in one preview, where the first hid the rest", async () => {
    const id = await draftWith(
      [{ op: "create_seat", orgRoleId: "cnb-many", payload: { name: "Cook", aim: { text: "Feed" }, domain: ["a", "b"], recruiting: "yes" } }],
      null,
    );
    const reason = String((await previewDraft(pool, id, 99)).lines[0].blocked);
    expect(reason).toContain("This seat's aim is not text");
    expect(reason).toContain("This seat's domain is not text");
    expect(reason).toContain("Recruiting is true or false");
  });

  it("blocks an object where a value belongs, where converting it threw and took the preview down", async () => {
    // `String({ toString: 0 })` throws. These arrive exactly so from JSON.
    const hostile = () => JSON.parse('{"toString":0,"valueOf":0}');
    const cases: [string, Record<string, unknown>, string][] = [
      ["cnb-h-crit", { name: "Crit Seat", criticality: hostile() }, "Criticality is normal or high"],
      ["cnb-h-seats", { name: "Seats Seat", seats: hostile() }, "A seat holds between 1 and 50 people"],
      ["cnb-h-circle", { name: "Circle Seat", circleId: hostile() }, "That circle does not exist"],
      ["cnb-h-name", { name: hostile() }, "This seat's name is not text"],
      ["cnb-h-matches", { name: "Match Seat", circleName: "Nowhere Circle", circleMatches: hostile() }, 'There is no circle called "Nowhere Circle"'],
    ];
    for (const [seatId, payload, sentence] of cases) {
      const id = await draftWith([{ op: "create_seat", orgRoleId: seatId, payload }]);
      const preview = await previewDraft(pool, id, 99);
      expect(preview.lines[0].blocked, seatId).toContain(sentence);
      expect((await publishDraft(pool, id, "u-steward", 99)).ok, seatId).toBe(false);
    }
    await pool.query("INSERT INTO org_roles (id, name, seats) VALUES ('cnb-existing', 'Existing Seat', 1)"); // module-review-ok: a fixture on the scratch schema this suite provisioned
    const edit = await draftWith([{ op: "update_seat", orgRoleId: "cnb-existing", payload: { seats: hostile() } }]);
    expect((await previewDraft(pool, edit, 99)).lines[0].blocked).toBe("A seat holds between 1 and 50 people");
  });

  it("lists the queue's stuck drafts from one read of seats and circles, and a draft whose preview throws", async () => {
    const blockedA = await draftWith([{ op: "create_seat", orgRoleId: "cnb-sa", payload: { name: "Stuck A", circleName: "Nowhere Circle", circleMatches: 0 } }]);
    const blockedB = await draftWith([{ op: "create_seat", orgRoleId: "cnb-sb", payload: { name: "Stuck B", seats: 400 } }]);
    const clean = await draftWith([{ op: "create_seat", orgRoleId: "cnb-sc", payload: { name: "Clean Seat" } }]);
    const byHand = await draftWith([{ op: "create_seat", orgRoleId: "cnb-sd", payload: { name: "" } }], null);

    let queries = 0;
    const counting = new Proxy(pool, {
      get: (target, prop) => {
        const v = Reflect.get(target, prop, target);
        if (prop !== "query") return typeof v === "function" ? v.bind(target) : v;
        return (...args: unknown[]) => {
          queries += 1;
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as mysql.Pool;
    const drafts = await listDrafts(pool);
    const context = await loadPreviewContext(counting);
    expect(queries).toBe(2);

    const stuck = stuckQueueDrafts(drafts, context, 99);
    const ids = stuck.map((d) => d.draftId);
    expect(ids).toContain(blockedA);
    expect(ids).toContain(blockedB);
    expect(ids).not.toContain(clean);
    // Made by a person, so no proposal goes back and it is not the queue's to list.
    expect(ids).not.toContain(byHand);
    expect(queries).toBe(2);

    // A draft whose preview throws is listed with its withdraw, and the rest still are.
    const broken = drafts.map((d) => (d.id === blockedA ? ({ ...d, changes: undefined } as unknown as Draft) : d));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const listed = stuckQueueDrafts(broken, context, 99);
      const fallback = listed.find((d) => d.draftId === blockedA);
      expect(fallback?.blockedLines[0].blocked).toContain("could not be previewed");
      expect(listed.map((d) => d.draftId)).toContain(blockedB);
      // Marked, so the page says it could not be checked where it said "1 of its
      // seats are blocked", and the line no longer names "This draft" twice.
      expect(fallback?.unpreviewable).toBe(true);
      expect(fallback?.blockedLines[0].reads).toBe("");
      expect(listed.find((d) => d.draftId === blockedB)).not.toHaveProperty("unpreviewable");
      // Logged with the draft's id, where the throw used to vanish.
      expect(errors.mock.calls.some((args) => args.some((a) => String(a).includes(blockedA)))).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it("reads a circle id sent as a one-item list as that circle, where it blocked as a circle that does not exist", async () => {
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO circles (id, name, aliases, is_example) VALUES ('cnb-springs', 'Springs & Wells', ?, 0)",
      [JSON.stringify([])],
    );
    const made = await draftWith([{ op: "create_seat", orgRoleId: "cnb-listed", payload: { name: "Listed Seat", circleId: ["cnb-springs"] } }]);
    const preview = await previewDraft(pool, made, 99);
    expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
    const r = await publishDraft(pool, made, "u-steward", 99);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    expect((await seatRow("cnb-listed")).circle_id).toBe("cnb-springs");

    await pool.query("INSERT INTO org_roles (id, name, seats) VALUES ('cnb-existing', 'Existing Seat', 1)"); // module-review-ok: a fixture on the scratch schema this suite provisioned
    const edit = await draftWith([{ op: "update_seat", orgRoleId: "cnb-existing", payload: { circleId: ["cnb-springs"] } }]);
    const editPreview = await previewDraft(pool, edit, 99);
    expect(editPreview.blocked, JSON.stringify(editPreview.lines)).toBe(0);
    const e = await publishDraft(pool, edit, "u-steward", 99);
    expect(e.ok, !e.ok ? e.error : "").toBe(true);
    expect((await seatRow("cnb-existing")).circle_id).toBe("cnb-springs");

    // A list holding a circle that does not exist still says so.
    const missing = await draftWith([{ op: "create_seat", orgRoleId: "cnb-listed-x", payload: { name: "Missing Seat", circleId: ["cnb-nowhere"] } }]);
    expect((await previewDraft(pool, missing, 99)).lines[0].blocked).toBe("That circle does not exist. A draft cannot create circles");
  });

  it("gives the recovery for a circle in a form nothing reads beside another reason, and still asks no admin for a circle", async () => {
    const unread = await draftWith([
      { op: "create_seat", orgRoleId: "cnb-unread-seats", payload: { name: "Pump Keeper", seats: 400, circleUnread: ["circle"] } },
    ]);
    const reason = String((await previewDraft(pool, unread, 99)).lines[0].blocked);
    expect(reason).toContain("A seat holds between 1 and 50 people");
    expect(reason).toContain('where you can write the circle\'s name under "circle" and accept again');

    const unknown = await draftWith([
      { op: "create_seat", orgRoleId: "cnb-unknown-seats", payload: { name: "Kiln Keeper", seats: 400, circleName: "Nowhere Circle", circleMatches: 0 } },
    ]);
    const unknownReason = String((await previewDraft(pool, unknown, 99)).lines[0].blocked);
    expect(unknownReason).toContain('There is no circle called "Nowhere Circle" yet');
    expect(unknownReason).not.toContain("Ask an admin to create it");
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
    // One recovery. Asking for the circle as well sent a steward to an admin
    // for a circle made for a seat they then rejected, and said withdraw twice.
    expect(reason).not.toContain("Ask an admin to create it");
    expect(reason.match(/withdraw/gi), reason).toHaveLength(1);

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
