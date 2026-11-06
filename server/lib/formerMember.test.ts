/**
 * WHO IS A FORMER MEMBER, read the way every reader of the question reads it
 * (server/lib/formerMember.ts), and the cash still owed that keeps an account.
 *
 * The pure cases need no database. The rest run against a scratch schema with
 * every real migration applied, so the exits and cash_owed rows are the real
 * tables, written by the real door (`createExit`, `markExitResolved`) where one
 * exists and by fixture SQL where the door belongs to another lane.
 *
 * Every refusal sits beside somebody who is let through, in the same case: a
 * reader that called everybody a former member would pass a test that only
 * asked about the leaver.
 *
 * No TEST_DATABASE_URL: the database cases skip loudly, never pass hollowly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { cashWords, isFormerMember, leftTheVillage, unpaidCashOf, withoutFormerMembers } from "./formerMember";
import { formatMoney } from "../../shared/money";
import { createExit } from "./exit";
import { markExitResolved } from "../repos/exitNotes";
import { usersRepo } from "../repos/users";

const configured = testDbConfigured();

describe("isFormerMember: the pure answer", () => {
  const person = (over: Record<string, unknown> = {}) => ({ id: "u-1", email: "u-1@example.test", membershipGranted: false, stageGranted: null, ...over });

  it("a resolved exit and no admission is a former member", () => {
    expect(isFormerMember(person(), true)).toBe(true);
  });

  it("no resolved exit is nobody's departure, admitted or not", () => {
    expect(isFormerMember(person(), false)).toBe(false);
    expect(isFormerMember(person({ membershipGranted: true }), false)).toBe(false);
  });

  it("admitted again by either record is a member, which is what makes coming back cost nothing", () => {
    expect(isFormerMember(person({ membershipGranted: true }), true)).toBe(false);
    expect(isFormerMember(person({ stageGranted: "member" }), true)).toBe(false);
    // A grant BELOW the door admits nobody, so it does not make them a member.
    expect(isFormerMember(person({ stageGranted: "guest" }), true)).toBe(true);
  });

  it("a tombstone is somebody erased, never a former member", () => {
    expect(isFormerMember(person({ email: "deleted-u-1@anonymized.invalid" }), true)).toBe(false);
  });
});

describe("cashWords: the cash in words that read the same everywhere", () => {
  it("prints each currency at its own scale, in currency order as handed", () => {
    expect(cashWords([{ currency: "USD", amountMinor: 2500, rows: 1 }])).toBe("$25.00");
    expect(cashWords([{ currency: "EUR", amountMinor: 1, rows: 1 }, { currency: "JPY", amountMinor: 500, rows: 2 }])).toBe("€0.01, ¥500");
    expect(cashWords([])).toBe("");
  });

  it("speaks the platform's one money format, so the exit desk says CHF 50.00 like every other page (e2e sweep, E11)", () => {
    /*
     * TWO ASSERTIONS, AND THE SEPARATOR IS WHY. `Intl.NumberFormat` puts a
     * NON-BREAKING space (U+00A0) between the currency and the figure, so
     * `formatMoney(5000, "CHF")` is `CHF 50.00` and a literal written with
     * an ordinary space does not equal it — identically on screen, different in
     * bytes, and the failure reads `expected 'CHF 50.00' to be 'CHF 50.00'`,
     * which tells you nothing. So the exact value is compared against the
     * formatter, and the readable claim is made on a copy with the separator
     * normalised: that keeps "the exit desk says CHF 50.00" checkable by eye
     * without pinning a byte Intl is free to change.
     */
    const chf = cashWords([{ currency: "CHF", amountMinor: 5000, rows: 1 }]);
    expect(chf, "the exit desk said 50.00 CHF").toBe(formatMoney(5000, "CHF"));
    expect(chf.replace(/ /g, " "), "the currency leads, then the figure").toBe("CHF 50.00");
    for (const [currency, minor] of [["CHF", 5000], ["USD", 1234], ["JPY", 500], ["CRC", 300000]] as const) {
      expect(cashWords([{ currency, amountMinor: minor, rows: 1 }])).toBe(formatMoney(minor, currency));
    }
  });
});

describe.skipIf(!configured)("against the real tables", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned

  const person = async (id: string, over: Record<string, unknown> = {}): Promise<any> => {
    await usersRepo(pool).add({ id, name: id, email: `${id}@example.test`, passwordHash: "x", paths: [] });
    if (Object.keys(over).length) await usersRepo(pool).update(id, (u: any) => Object.assign(u, over));
    const made = await usersRepo(pool).byId(id);
    if (!made) throw new Error(`${id} was not written`);
    return made;
  };

  /** A departure through the real doors, ending in the status given. */
  const departure = async (userId: string, status: "resolved" | "cancelled" | "open") => {
    const made = await createExit(pool, { userId, kind: "voluntary", openedBy: userId, noticeDays: 0 });
    if (!made.ok) throw new Error(made.error);
    if (status === "resolved") await markExitResolved(pool, made.exit.id, null, "");
    if (status === "cancelled") await q("UPDATE exits SET status = 'cancelled' WHERE id = ?", [made.exit.id]);
  };

  const owe = async (id: string, userId: string, amountMinor: number, currency: string, state: "owed" | "claimed" | "paid") => {
    await q(
      "INSERT INTO cash_owed (id, occurrence_key, user_id, work_kind, work_ref, work_title, amount_minor, currency, state) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, `fm-test:${id}`, userId, "quest", `q-${id}`, `Work ${id}`, amountMinor, currency, state],
    );
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("leftTheVillage: a resolved exit without admission, and nothing else", async () => {
    const left = await person("fm-left");
    await departure(left.id, "resolved");
    const stayed = await person("fm-stayed", { membershipGranted: true });
    const cancelled = await person("fm-cancelled");
    await departure(cancelled.id, "cancelled");
    const leaving = await person("fm-leaving");
    await departure(leaving.id, "open");

    expect(await leftTheVillage(pool, left)).toBe(true);
    expect(await leftTheVillage(pool, stayed), "never left").toBe(false);
    expect(await leftTheVillage(pool, cancelled), "a person who stays: the exit closed without a departure").toBe(false);
    expect(await leftTheVillage(pool, leaving), "still in the middle of leaving, so still here").toBe(false);
    expect(await leftTheVillage(pool, null)).toBe(false);
  });

  it("leftTheVillage answers again the moment a former member is admitted again", async () => {
    const back = await person("fm-back");
    await departure(back.id, "resolved");
    expect(await leftTheVillage(pool, back)).toBe(true);
    const admitted = await usersRepo(pool).update(back.id, (u: any) => { u.stageGranted = "member"; });
    expect(await leftTheVillage(pool, admitted)).toBe(false);
  });

  it("withoutFormerMembers takes out exactly the people who left, in one read", async () => {
    const left = await person("fm-roll-left");
    await departure(left.id, "resolved");
    const here = await person("fm-roll-here", { membershipGranted: true });
    const back = await person("fm-roll-back", { stageGranted: "member" });
    await departure(back.id, "resolved");

    const kept = await withoutFormerMembers(pool, [left, here, back]);
    expect(kept.map((p: any) => p.id)).toEqual([here.id, back.id]);
  });

  it("unpaidCashOf counts owed and claimed per currency, and never what is paid", async () => {
    const who = await person("fm-cash");
    await owe("fm-c1", who.id, 1500, "USD", "owed");
    await owe("fm-c2", who.id, 1000, "USD", "claimed");
    await owe("fm-c3", who.id, 9900, "USD", "paid");
    await owe("fm-c4", who.id, 700, "EUR", "owed");
    const nobody = await person("fm-cash-none");
    await owe("fm-c5", nobody.id, 4000, "USD", "paid");

    expect(await unpaidCashOf(pool, who.id)).toEqual([
      { currency: "EUR", amountMinor: 700, rows: 1 },
      { currency: "USD", amountMinor: 2500, rows: 2 },
    ]);
    expect(await unpaidCashOf(pool, nobody.id), "paid in full is owed nothing").toEqual([]);
  });
});
