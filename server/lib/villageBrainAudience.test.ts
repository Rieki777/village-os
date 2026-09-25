/**
 * Who a brief section is for, and whether that choice survives the next edit
 * (defect 12, 2026-09-24).
 *
 * Two defects, one shape. `briefWrite` wrote `input.audience ?? spec.audience`
 * on every update, so the audience was not a stored choice at all: a section an
 * admin opened to members closed itself on the next text-only save, and a
 * default that ever became "member" would reopen a row an admin had closed. And
 * the public guide read every member-audience row, so the moment the canvas
 * opens `economy` to members, dues and rents reach whoever types into
 * /work-with-us. The first half is fixed by keeping the stored audience; the
 * second by an allowlist the public reader applies whatever a row says.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { BRIEF_SECTIONS } from "../../shared/villageBrief";
import {
  STRANGER_READABLE_SECTIONS,
  briefAll,
  briefForPublicPrompt,
  briefGet,
  briefWrite,
} from "./villageBrain";

const configured = testDbConfigured();

/** The revision history for one section, oldest first. */
async function revisions(pool: Pool, section: string): Promise<Array<{ revision: number; body: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT r.revision, r.body FROM village_brief_revisions r JOIN village_brief b ON b.id = r.brief_id " + // module-review-ok: a test reading the history table back to prove the write kept it
      "WHERE b.section = ? ORDER BY r.revision",
    [section],
  );
  return rows.map((r) => ({ revision: Number(r.revision), body: String(r.body) }));
}

describe.skipIf(!configured)("a brief section's audience is a stored choice (MySQL)", () => {
  let db: TestDb;
  let pool: Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("a new row takes the registry default when nobody chose", async () => {
    const economy = await briefWrite(pool, { section: "economy", body: "Dues are forty a month.", confirmedBy: "u-founder" });
    const aims = await briefWrite(pool, { section: "aims", body: "Grow food and teach it.", confirmedBy: "u-founder" });
    expect(economy.audience).toBe("admin");
    expect(aims.audience).toBe("member");
  });

  it("(a) an opened section STAYS open across a later text-only update", async () => {
    const opened = await briefWrite(pool, {
      section: "economy", body: "Dues are forty a month.", audience: "member", confirmedBy: "u-founder",
    });
    expect(opened.audience).toBe("member");

    // The admin editor's own shape: body and confirm, no audience field.
    const edited = await briefWrite(pool, { section: "economy", body: "Dues are forty-five a month now.", confirmedBy: "u-founder" });
    expect(edited.audience, "a text edit put the registry default back").toBe("member");
    expect(edited.body).toBe("Dues are forty-five a month now.");

    // A member reader sees the edited row, which is the promise "opened" makes.
    const asMember = await briefGet(pool, "economy", "member");
    expect(asMember?.body).toBe("Dues are forty-five a month now.");

    // And an unconfirmed save (a proposal) keeps it open too.
    const proposed = await briefWrite(pool, { section: "economy", body: "Dues may rise to fifty.", confirmedBy: null });
    expect(proposed.audience).toBe("member");
    expect(proposed.status).toBe("proposed");
  });

  it("(b) an explicit admin closes it, and the close is just as sticky", async () => {
    const closed = await briefWrite(pool, {
      section: "economy", body: "Dues may rise to fifty.", audience: "admin", confirmedBy: "u-founder",
    });
    expect(closed.audience).toBe("admin");
    expect(await briefGet(pool, "economy", "member"), "a member still reads a closed section").toBeNull();

    // A section whose DEFAULT is member, closed by an admin, must not reopen on
    // its next save. This is the half of the defect that turns into a leak.
    await briefWrite(pool, { section: "aims", body: "Grow food and teach it.", audience: "admin", confirmedBy: "u-founder" });
    const aimsEdited = await briefWrite(pool, { section: "aims", body: "Grow food, teach it, and keep the seed.", confirmedBy: "u-founder" });
    expect(aimsEdited.audience, "a text edit reopened a section an admin had closed").toBe("admin");
    expect(await briefGet(pool, "aims", "member")).toBeNull();
  });

  it("keeps a revision row for every change, the audience changes included", async () => {
    // economy was written five times above: create, open, edit, propose, close.
    const economy = await briefGet(pool, "economy", "admin");
    expect(economy?.revision).toBe(5);
    const history = await revisions(pool, "economy");
    expect(history.map((h) => h.revision)).toEqual([1, 2, 3, 4]);
    expect(history.map((h) => h.body)).toEqual([
      "Dues are forty a month.",
      "Dues are forty a month.",
      "Dues are forty-five a month now.",
      "Dues may rise to fifty.",
    ]);
  });
});

describe.skipIf(!configured)("(c) the strangers' prompt carries only the allowlisted sections (MySQL)", () => {
  // A distinctive phrase per section, so a leak names itself in the failure.
  const marker = (id: string) => `MARKER-${id.toUpperCase()}-7Q`;
  let db: TestDb;
  let pool: Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 });
    // EVERY section in the registry, opened to members and confirmed. The
    // non-allowlisted ones (economy, decisions, membership and the rest) are
    // exactly the rows a canvas opening would produce.
    for (const s of BRIEF_SECTIONS) {
      await briefWrite(pool, {
        section: s.id, body: `The ${s.id} section says ${marker(s.id)}.`, audience: "member", confirmedBy: "u-founder",
      });
    }
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("the setup really opened every section to members, so the absences below mean something", async () => {
    const memberRows = await briefAll(pool, "member");
    expect(memberRows.map((r) => r.section).sort()).toEqual(BRIEF_SECTIONS.map((s) => s.id).sort());
    for (const id of ["economy", "decisions", "membership"]) {
      expect(memberRows.find((r) => r.section === id)?.status, id).toBe("confirmed");
    }
  });

  it("names no section outside the allowlist, whatever its audience says, and every one inside it", async () => {
    // A budget far above what fourteen short rows need, so a cap cannot be the
    // reason anything is missing.
    const words = await briefForPublicPrompt(pool, 100000);
    const outside = BRIEF_SECTIONS.map((s) => s.id).filter((id) => !STRANGER_READABLE_SECTIONS.has(id));
    expect(outside).toEqual(expect.arrayContaining(["economy", "decisions", "membership"]));
    for (const id of outside) {
      expect(words, `${id} reached a stranger's prompt`).not.toContain(marker(id));
    }
    for (const id of STRANGER_READABLE_SECTIONS) {
      expect(words, `${id} is allowlisted and confirmed and should be there`).toContain(marker(id));
    }
  });

  it("an allowlisted section an admin closes leaves the strangers' prompt too", async () => {
    await briefWrite(pool, {
      section: "values", body: `The values section says ${marker("values")}.`, audience: "admin", confirmedBy: "u-founder",
    });
    const words = await briefForPublicPrompt(pool, 100000);
    expect(words).not.toContain(marker("values"));
    expect(words).toContain(marker("aims"));
  });
});
