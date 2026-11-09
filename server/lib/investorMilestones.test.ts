/**
 * The investor path's records (0349) against a real schema: raised hands, a
 * home handed over on its lease, a parcel sold, and the Homeowner and
 * Neighbour badges those two award.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { handOverHome, raiseHand, sellParcel, withdrawHand, HOMEOWNER_BADGE, NEIGHBOUR_BADGE } from "./investorMilestones";
import { evaluateEarnedBadges } from "./badges";
import { insertInvitation, invitationById, invitationHistory } from "../repos/investorMilestones";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const TZ = "America/Costa_Rica";
const NOV = new Date("2026-11-15T18:00:00Z");

const hand = (over: Partial<Parameters<typeof raiseHand>[1]> = {}) => ({
  userId: "u-ana",
  way: "steward" as const,
  invitationId: null,
  member: true,
  hiddenWays: [],
  limit: 3,
  roleHolders: ["u-lead"],
  anchorCircle: [],
  now: NOV,
  timeZone: TZ,
  ...over,
});

const awardOf = async (badgeId: string, userId: string) => {
  const [rows] = await pool.query<any[]>( // module-review-ok: reading the scratch schema this suite provisioned
    "SELECT count FROM badge_awards WHERE badge_id = ? AND user_id = ?",
    [badgeId, userId],
  );
  return rows[0] ? Number(rows[0].count) : 0;
};

describe.skipIf(!configured)("the investor path's records", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    for (const t of [
      "investor_intents",
      "investor_home_handovers",
      "investor_parcel_sales",
      "investor_invitation_history",
      "investor_invitations",
      "badge_awards",
      "badge_events",
    ]) {
      await pool.query(`DELETE FROM ${t}`); // module-review-ok: clearing the scratch schema this suite provisioned
    }
  });

  it("seeds the two badges as earned, carrying no power", async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: same
      "SELECT id, kind, capabilities, multiplier, multipliers FROM badges WHERE id IN ('homeowner','neighbour') ORDER BY id",
    );
    expect(rows.map((r) => r.id)).toEqual(["homeowner", "neighbour"]);
    for (const r of rows) {
      expect(r.kind).toBe("earned");
      expect(JSON.parse(typeof r.capabilities === "string" ? r.capabilities : JSON.stringify(r.capabilities))).toEqual([]);
      expect(r.multiplier).toBeNull();
      expect(r.multipliers).toBeNull();
    }
  });

  describe("raised hands", () => {
    it("routes a hand to the way's role holder and records the village month", async () => {
      const r = await raiseHand(pool, hand());
      expect(r).toMatchObject({ ok: true, routedTo: "role", recipients: ["u-lead"] });
      const [[row]] = await pool.query<any[]>("SELECT moon, status FROM investor_intents"); // module-review-ok: same
      expect(row).toMatchObject({ moon: "2026-11", status: "open" });
    });

    it("refuses a second open hand on the same way, in the database as well as the count", async () => {
      expect((await raiseHand(pool, hand())).ok).toBe(true);
      expect(await raiseHand(pool, hand())).toMatchObject({ ok: false, code: "HAND_ALREADY_OPEN" });
      const [[{ n }]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM investor_intents"); // module-review-ok: same
      expect(Number(n)).toBe(1);
    });

    it("lets a withdrawn hand be raised again, and still counts it toward the moon", async () => {
      const first = await raiseHand(pool, hand({ limit: 2 }));
      if (!first.ok) throw new Error("first hand refused");
      expect(await withdrawHand(pool, "u-ana", first.intentId)).toBe(true);
      expect((await raiseHand(pool, hand({ limit: 2 }))).ok).toBe(true);
      // Two raised this moon (one withdrawn), so a third on another way meets the limit.
      expect(await raiseHand(pool, hand({ limit: 2, way: "venture" }))).toMatchObject({ ok: false, code: "HAND_LIMIT_REACHED" });
    });

    it("hides the founding way from someone who is not a member", async () => {
      expect(await raiseHand(pool, hand({ way: "founding", member: false }))).toMatchObject({ ok: false, code: "WAY_MEMBERS_ONLY" });
    });
  });

  describe("a home handed over", () => {
    const over = (o: Partial<Parameters<typeof handOverHome>[1]> = {}) => ({
      homeRef: "hamlet-a:home-1",
      reservationId: null,
      userId: "u-ana",
      recordedBy: "u-steward",
      minShares: 5,
      investedUnits: 3,
      earnedUnits: 2,
      badgesOn: true,
      ...o,
    });

    it("hands it over when the owner holds N shares, and awards Homeowner", async () => {
      expect(await handOverHome(pool, over())).toMatchObject({ ok: true, badgeAwarded: true });
      expect(await awardOf(HOMEOWNER_BADGE, "u-ana")).toBe(1);
    });

    it("refuses the lease short of N shares, and writes nothing", async () => {
      expect(await handOverHome(pool, over({ earnedUnits: 1 }))).toMatchObject({ ok: false, code: "HOME_SHARES_SHORT" });
      const [[{ n }]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM investor_home_handovers"); // module-review-ok: same
      expect(Number(n)).toBe(0);
      expect(await awardOf(HOMEOWNER_BADGE, "u-ana")).toBe(0);
    });

    it("refuses when the village has not set N", async () => {
      expect(await handOverHome(pool, over({ minShares: null }))).toMatchObject({ ok: false, code: "HOME_SHARES_UNSET" });
    });

    it("hands a home over once", async () => {
      expect((await handOverHome(pool, over())).ok).toBe(true);
      expect(await handOverHome(pool, over({ userId: "u-ben" }))).toMatchObject({ ok: false, code: "ALREADY_RECORDED" });
    });

    it("records the handover and awards nothing while badges are off", async () => {
      expect(await handOverHome(pool, over({ badgesOn: false }))).toMatchObject({ ok: true, badgeAwarded: false });
      expect(await awardOf(HOMEOWNER_BADGE, "u-ana")).toBe(0);
    });
  });

  describe("a parcel sold", () => {
    it("closes the parcel as sold, keeps the story, and awards Neighbour", async () => {
      const id = await insertInvitation(pool, { way: "parcel", title: "Parcel 2", createdBy: "u-steward" });
      expect(await sellParcel(pool, { invitationId: id, userId: "u-ben", recordedBy: "u-steward", badgesOn: true })).toMatchObject({
        ok: true,
        badgeAwarded: true,
      });
      expect(await invitationById(pool, id)).toMatchObject({ status: "closed", closedReason: "sold" });
      expect((await invitationHistory(pool, id)).map((h) => h.change)).toEqual(["opened", "sold"]);
      expect(await awardOf(NEIGHBOUR_BADGE, "u-ben")).toBe(1);
    });

    it("records a sale with no known buyer and awards nobody", async () => {
      const id = await insertInvitation(pool, { way: "parcel", title: "Parcel 1", createdBy: "u-steward" });
      expect(await sellParcel(pool, { invitationId: id, userId: null, recordedBy: "u-steward", badgesOn: true })).toMatchObject({
        ok: true,
        badgeAwarded: false,
      });
    });

    it("sells a parcel once, and refuses an invitation that is not a parcel", async () => {
      const id = await insertInvitation(pool, { way: "parcel", title: "Parcel 3", createdBy: "u-steward" });
      expect((await sellParcel(pool, { invitationId: id, userId: "u-ben", recordedBy: "u-steward", badgesOn: true })).ok).toBe(true);
      expect(await sellParcel(pool, { invitationId: id, userId: "u-cal", recordedBy: "u-steward", badgesOn: true })).toMatchObject({
        ok: false,
        code: "INVITATION_CLOSED",
      });
      const other = await insertInvitation(pool, { way: "venture", title: "Bakery", createdBy: "u-steward" });
      expect(await sellParcel(pool, { invitationId: other, userId: "u-ben", recordedBy: "u-steward", badgesOn: true })).toMatchObject({
        ok: false,
        code: "NOT_A_PARCEL",
      });
    });
  });

  it("the cycle-close engine agrees with the award-now path and never awards twice", async () => {
    await handOverHome(pool, {
      homeRef: "h-1", reservationId: null, userId: "u-ana", recordedBy: "u-steward",
      minShares: 0, investedUnits: 0, earnedUnits: 0, badgesOn: true,
    });
    const id = await insertInvitation(pool, { way: "parcel", title: "Parcel 4", createdBy: "u-steward" });
    await sellParcel(pool, { invitationId: id, userId: "u-ben", recordedBy: "u-steward", badgesOn: true });
    const result = await evaluateEarnedBadges(pool);
    expect(result.newTiers.filter((t) => t.badgeId === HOMEOWNER_BADGE || t.badgeId === NEIGHBOUR_BADGE)).toEqual([]);
    expect(await awardOf(HOMEOWNER_BADGE, "u-ana")).toBe(1);
    expect(await awardOf(NEIGHBOUR_BADGE, "u-ben")).toBe(1);
  });
});
