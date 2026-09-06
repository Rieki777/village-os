/**
 * The three per-member data models the per-path ladders read (0159, 0156, 0157).
 *
 * The assertions worth having here are not "a row can be written". They are
 * the two properties the whole design rests on, and both of them are the kind
 * that rot silently:
 *
 *  1. A POSITION FALLS WITH NO UPDATE PATH. Ending a fact or closing a
 *     venture removes it from the live read, and the history stays. Every
 *     model gets that case, because "drop a rung" is the requirement and a
 *     stored rung is what these tables exist to avoid.
 *  2. THE INVESTOR RECORD HOLDS NO MONEY, checked against information_schema
 *     rather than against a comment. A comment asking people not to add an
 *     amount column stops nobody; a test that reads the live column types
 *     fails the moment somebody does.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { reservationsForMember } from "./housing";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { createReservation, setReservationStatus } from "../lib/housing";
import { endFact, factsForMember, membersHoldingFact, recordFact } from "./investorPath";
import {
  closeVenture,
  listedVentures,
  openVenture,
  setVentureListed,
  venturesForMember,
} from "./ventures";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const MEMBER = "u-lena";
const OTHER = "u-tomas";

describe.skipIf(!configured)("per-path member data models", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM housing_reservations"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM investor_path_facts"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM member_ventures"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  // ── RESIDENT (0159) ──────────────────────────────────────────────────────

  describe("resident: a member's own reservations", () => {
    it("returns this member's intents and nobody else's", async () => {
      await createReservation(pool, {
        structureKey: "ridgeA", homeType: "casita", name: "Lena", email: "lena@example.org", userId: MEMBER,
      });
      await createReservation(pool, {
        structureKey: "ridgeA", homeType: "villa", name: "Tomas", email: "tomas@example.org", userId: OTHER,
      });
      const mine = await reservationsForMember(pool, MEMBER);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.homeType).toBe("casita");
    });

    /*
     * The property the whole table depends on. 0077 accepts leads from people
     * with no account, and a signed-in member must never be handed one of
     * them: user_id IS NULL matches no member id, so an anonymous lead is
     * invisible to every per-member read.
     */
    it("never hands an anonymous lead to a member", async () => {
      await createReservation(pool, {
        structureKey: null, homeType: "tiny-home", name: "A stranger", email: "walk-in@example.org",
      });
      expect(await reservationsForMember(pool, MEMBER)).toEqual([]);
      const [rows]: any = await pool.query("SELECT COUNT(*) AS n FROM housing_reservations"); // module-review-ok: reading the scratch schema this suite provisioned
      expect(Number(rows[0].n)).toBe(1);
    });

    /*
     * The status progression 0077 already defines IS the resident ladder's
     * fact, so a withdrawal has to be visible in what this read returns. It
     * is: the row keeps its history and reports the status it now holds, and
     * a derivation reading it answers lower without anything being stored.
     */
    it("reports a withdrawal, so a position can fall from the same rows", async () => {
      const { id } = await createReservation(pool, {
        structureKey: "ridgeA", homeType: "casita", name: "Lena", email: "lena@example.org", userId: MEMBER,
      });
      await setReservationStatus(pool, id, "reserved");
      expect((await reservationsForMember(pool, MEMBER))[0]?.status).toBe("reserved");
      await setReservationStatus(pool, id, "withdrawn");
      const after = await reservationsForMember(pool, MEMBER);
      expect(after).toHaveLength(1);
      expect(after[0]?.status).toBe("withdrawn");
    });

    /*
     * 0159's whole content. Asserted against information_schema because the
     * migration is the only thing that creates it and a query works either
     * way: without the index this read is a full scan that nothing reports.
     */
    it("has the member index 0159 adds", async () => {
      const [rows]: any = await pool.query( // module-review-ok: reading the scratch schema this suite provisioned
        "SELECT COLUMN_NAME FROM information_schema.STATISTICS " +
          "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'housing_reservations' " +
          "AND INDEX_NAME = 'housing_res_member_idx' ORDER BY SEQ_IN_INDEX",
      );
      expect(rows.map((r: any) => String(r.COLUMN_NAME))).toEqual([
        "village_id",
        "user_id",
        "status",
      ]);
    });
  });

  // ── INVESTOR (0156) ──────────────────────────────────────────────────────

  describe("investor: facts with dates, and no money anywhere", () => {
    /*
     * THE LEDGER SEPARATION, CHECKED RATHER THAN PROMISED.
     *
     * server/lib/ledger.ts is the only thing allowed to say how much, because
     * equity is a hypha-governed token mirrored read-only from Base and a
     * second writable figure here would quietly become the cap table. The
     * guarantee is that this table cannot express an amount at all, and this
     * reads the live column types to prove it.
     *
     * tinyint is exempt: `is_example` is a boolean flag, the same shape every
     * standing-example column in this schema uses. Every other numeric type
     * is a way to store a quantity and none of them belongs here.
     */
    it("has no numeric column, so it cannot hold an amount", async () => {
      const [rows]: any = await pool.query( // module-review-ok: reading the scratch schema this suite provisioned
        "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS " +
          "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'investor_path_facts' " +
          "AND DATA_TYPE IN ('int','bigint','smallint','mediumint','decimal','numeric','float','double')",
      );
      expect(rows.map((r: any) => String(r.COLUMN_NAME))).toEqual([]);
    });

    /*
     * The id a repeat hands back must name the row that is actually there.
     * Returning the id of the INSERT that just failed would be a string
     * naming nothing, and a caller linking to it would point at nothing with
     * no error to say so.
     */
    it("records a fact once, and a repeat returns the id already held", async () => {
      const first = await recordFact(pool, { userId: MEMBER, fact: "interest_registered" });
      expect(first.fresh).toBe(true);
      const again = await recordFact(pool, { userId: MEMBER, fact: "interest_registered" });
      expect(again.fresh).toBe(false);
      expect(again.id).toBe(first.id);
      const held = await factsForMember(pool, MEMBER);
      expect(held).toHaveLength(1);
      expect(held[0]?.id).toBe(again.id);
    });

    /*
     * The requirement in one case: a fact goes away, the live read is one
     * shorter, and nothing wrote a position down for anybody to correct.
     */
    it("drops a fact from the live read when it ends, and keeps the history", async () => {
      await recordFact(pool, { userId: MEMBER, fact: "packet_released" });
      expect(await factsForMember(pool, MEMBER)).toHaveLength(1);

      expect(await endFact(pool, MEMBER, "packet_released", "access withdrawn")).toBe(true);
      expect(await factsForMember(pool, MEMBER)).toEqual([]);

      const history = await factsForMember(pool, MEMBER, { includeEnded: true });
      expect(history).toHaveLength(1);
      expect(history[0]?.endedAt).not.toBeNull();
      expect(history[0]?.endedReason).toBe("access withdrawn");
    });

    it("answers false when a fact is ended twice", async () => {
      await recordFact(pool, { userId: MEMBER, fact: "agreement_signed" });
      expect(await endFact(pool, MEMBER, "agreement_signed")).toBe(true);
      expect(await endFact(pool, MEMBER, "agreement_signed")).toBe(false);
    });

    /*
     * The generated active-key trick from 0049, in the case it exists for: a
     * member may hold the same fact again later without colliding with their
     * own ended row.
     */
    it("lets the same fact be recorded again after it ended", async () => {
      await recordFact(pool, { userId: MEMBER, fact: "packet_released" });
      await endFact(pool, MEMBER, "packet_released", "expired");
      const again = await recordFact(pool, { userId: MEMBER, fact: "packet_released" });
      expect(again.fresh).toBe(true);
      expect(await factsForMember(pool, MEMBER)).toHaveLength(1);
      expect(await factsForMember(pool, MEMBER, { includeEnded: true })).toHaveLength(2);
    });

    it("keeps one member's facts out of another's read", async () => {
      await recordFact(pool, { userId: MEMBER, fact: "interest_registered" });
      expect(await factsForMember(pool, OTHER)).toEqual([]);
    });

    /*
     * A standing example must never promote a real member, the same hazard
     * org_role_assignments carries is_example for.
     */
    it("leaves example rows out of the live read", async () => {
      await pool.query( // module-review-ok: seeding an example row on the scratch schema this suite provisioned
        "INSERT INTO investor_path_facts (id, village_id, user_id, fact, is_example) VALUES (?,?,?,?,1)",
        ["ipf-example", "local", MEMBER, "agreement_signed"],
      );
      expect(await factsForMember(pool, MEMBER)).toEqual([]);
      expect(await factsForMember(pool, MEMBER, { includeExamples: true })).toHaveLength(1);
      expect(await membersHoldingFact(pool, "agreement_signed")).toEqual([]);
    });

    it("lists everyone currently holding one fact, oldest first", async () => {
      await recordFact(pool, { userId: MEMBER, fact: "interest_registered" });
      await recordFact(pool, { userId: OTHER, fact: "interest_registered" });
      await recordFact(pool, { userId: OTHER, fact: "packet_released" });
      const holders = await membersHoldingFact(pool, "interest_registered");
      expect(holders.map((h) => h.userId).sort()).toEqual([MEMBER, OTHER].sort());
    });
  });

  // ── PROSPERITY CREATOR (0157) ────────────────────────────────────────────

  describe("prosperity: a venture, and the dates a position derives from", () => {
    it("has no stage or level column, because a position is never stored", async () => {
      const [rows]: any = await pool.query( // module-review-ok: reading the scratch schema this suite provisioned
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
          "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_ventures' " +
          "AND COLUMN_NAME IN ('stage','level','rung','rank','status','score')",
      );
      expect(rows.map((r: any) => String(r.COLUMN_NAME))).toEqual([]);
    });

    it("opens a venture, and a duplicate name returns the id already open", async () => {
      const first = await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery" });
      expect(first.fresh).toBe(true);
      const again = await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery" });
      expect(again.fresh).toBe(false);
      expect(again.id).toBe(first.id);
      const open = await venturesForMember(pool, MEMBER);
      expect(open).toHaveLength(1);
      expect(open[0]?.id).toBe(again.id);
    });

    it("starts unlisted, and publishes and unpublishes on request", async () => {
      const { id } = await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery" });
      expect((await venturesForMember(pool, MEMBER))[0]?.listedAt).toBeNull();
      expect(await listedVentures(pool)).toEqual([]);

      expect(await setVentureListed(pool, id, MEMBER, true)).toBe(true);
      expect(await listedVentures(pool)).toHaveLength(1);

      expect(await setVentureListed(pool, id, MEMBER, false)).toBe(true);
      expect(await listedVentures(pool)).toEqual([]);
      expect(await venturesForMember(pool, MEMBER)).toHaveLength(1);
    });

    /*
     * The requirement again, on this model: closing removes it from the live
     * read and the row keeps its dates, so a derivation answers lower on the
     * next look and the member's history is intact.
     */
    it("drops a closed venture from the live read, and keeps the history", async () => {
      const { id } = await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery", listed: true });
      expect(await closeVenture(pool, id, MEMBER, "moved away")).toBe(true);

      expect(await venturesForMember(pool, MEMBER)).toEqual([]);
      expect(await listedVentures(pool)).toEqual([]);

      const history = await venturesForMember(pool, MEMBER, { includeClosed: true });
      expect(history).toHaveLength(1);
      expect(history[0]?.closedAt).not.toBeNull();
      expect(history[0]?.closedReason).toBe("moved away");
    });

    it("answers false when a venture is closed twice", async () => {
      const { id } = await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery" });
      expect(await closeVenture(pool, id, MEMBER)).toBe(true);
      expect(await closeVenture(pool, id, MEMBER)).toBe(false);
    });

    it("lets the same name be opened again after it closed", async () => {
      const { id } = await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery" });
      await closeVenture(pool, id, MEMBER);
      expect((await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery" })).fresh).toBe(true);
      expect(await venturesForMember(pool, MEMBER)).toHaveLength(1);
    });

    /*
     * Ownership is settled in the statement. An id that leaked to another
     * member matches no row for them, so there is no check a caller can
     * forget to make.
     */
    it("refuses a mutation from anybody but the owner", async () => {
      const { id } = await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery" });
      expect(await closeVenture(pool, id, OTHER, "not theirs to close")).toBe(false);
      expect(await setVentureListed(pool, id, OTHER, true)).toBe(false);
      expect(await venturesForMember(pool, MEMBER)).toHaveLength(1);
    });

    it("keeps two members' ventures apart, and allows the same name for each", async () => {
      expect((await openVenture(pool, { userId: MEMBER, name: "Ridge Bakery" })).fresh).toBe(true);
      expect((await openVenture(pool, { userId: OTHER, name: "Ridge Bakery" })).fresh).toBe(true);
      expect(await venturesForMember(pool, MEMBER)).toHaveLength(1);
      expect(await venturesForMember(pool, OTHER)).toHaveLength(1);
    });

    it("leaves example ventures out of the live read", async () => {
      await pool.query( // module-review-ok: seeding an example row on the scratch schema this suite provisioned
        "INSERT INTO member_ventures (id, village_id, user_id, name, listed_at, is_example) VALUES (?,?,?,?,CURRENT_TIMESTAMP,1)",
        ["ven-example", "local", MEMBER, "An example venture"],
      );
      expect(await venturesForMember(pool, MEMBER)).toEqual([]);
      expect(await venturesForMember(pool, MEMBER, { includeExamples: true })).toHaveLength(1);
    });

    /*
     * The deliberate asymmetry, asserted so it reads as a decision instead of
     * an oversight. A standing example belongs on a display surface in a
     * village with no real rows yet, and does not belong in the read a
     * ladder derives a real member's position from.
     */
    it("does show an example venture on the village listing", async () => {
      await pool.query( // module-review-ok: seeding an example row on the scratch schema this suite provisioned
        "INSERT INTO member_ventures (id, village_id, user_id, name, listed_at, is_example) VALUES (?,?,?,?,CURRENT_TIMESTAMP,1)",
        ["ven-example", "local", MEMBER, "An example venture"],
      );
      const shown = await listedVentures(pool);
      expect(shown).toHaveLength(1);
      expect(shown[0]?.isExample).toBe(true);
    });
  });
});
