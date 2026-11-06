/**
 * What the village brief hands to a prompt a STRANGER reaches.
 *
 * The brief has an `audience` column and a confirm step, and both mean nothing
 * until something reads them. `briefIndexForPrompt` hardcoded the ADMIN
 * audience because the founder's Setup Studio was its only caller, so wiring the
 * brief into the public guide without an audience parameter would have handed a
 * stranger the section names a village keeps private: `legal`, `constraints`,
 * `people`, `economy`. Leaking the shape of a secret is still leaking.
 *
 * Runs against the S5 harness, so every claim here needs the migration to have
 * run. No TEST_DATABASE_URL and the suite skips loudly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { briefForPublicPrompt, briefIndexForPrompt, briefWrite } from "./villageBrain";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

/** One brief section, written the way the admin route writes them. */
async function section(id: string, body: string, confirmedBy: string | null) {
  await briefWrite(pool, { section: id, body, source: "admin", confirmedBy });
}

describe.skipIf(!configured)("the brief a stranger's guide may read (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("a fresh fork hands over nothing at all", async () => {
    expect(await briefForPublicPrompt(pool)).toBe("");
  });

  it("carries confirmed member-audience sections, and never an admin one", async () => {
    await section("aims", "Growing food for the valley, and teaching how.", "u-founder");
    await section("values", "We do not sell the water.", "u-founder");
    // `constraints` is an admin-audience section and is confirmed, which is the
    // combination that would slip through an audience-blind reader.
    await section("constraints", "The lender's covenant runs to 2031.", "u-founder");

    const words = await briefForPublicPrompt(pool);
    expect(words).toContain("Growing food for the valley");
    expect(words).toContain("We do not sell the water");
    expect(words).not.toContain("lender's covenant");
    expect(words).not.toContain("Red lines");
  });

  it("leaves an unconfirmed section out, because a guess is not the village's words", async () => {
    await section("vision", "A guess the guide made and nobody has agreed to.", null);
    const words = await briefForPublicPrompt(pool);
    expect(words).not.toContain("A guess the guide made");

    // Confirming it is what puts it in front of a stranger.
    await section("vision", "A guess the guide made and nobody has agreed to.", "u-founder");
    expect(await briefForPublicPrompt(pool)).toContain("A guess the guide made");
  });

  it("stays inside its token budget on a village that has written a lot", async () => {
    await section("language", "word ".repeat(4000), "u-founder");
    const words = await briefForPublicPrompt(pool, 300);
    // capMarkdown's own budget check: four characters to a token.
    expect(words.length / 4).toBeLessThanOrEqual(300);
  });

  it("the index respects the audience it is asked for", async () => {
    const forAdmin = await briefIndexForPrompt(pool, 400, "admin");
    const forMember = await briefIndexForPrompt(pool, 400, "member");
    expect(forAdmin).toContain("Red lines");
    expect(forMember).not.toContain("Red lines");
    // The default is still admin, so the Setup Studio's call is unchanged.
    expect(await briefIndexForPrompt(pool, 400)).toContain("Red lines");
  });
});
