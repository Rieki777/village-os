/**
 * Starting a village from its ReGen Civics profile: the org draft a real card
 * builds, against a real scratch schema.
 *
 * shared/regenImport.test.ts proves what the draft SAYS. Only a database can
 * prove the four things a founder is promised on the import screen:
 *
 *   - every line previews clean on a fresh fork, so the founder reads the
 *     whole shape and nothing in it blocks;
 *   - publishing makes the project's circles, puts each seat in its circle
 *     with the card's fields, writes the team's holders as names to claim,
 *     and rests the councils a new village is born with;
 *   - reverting puts the councils back, rests every seat it made and leaves
 *     its circles dormant, because history is not deleted;
 *   - none of it needs anything the admin's draft route does not take.
 *
 * The card is ReGen Civics' own output (shared/__fixtures__, see
 * shared/regenFile.test.ts). The councils are the eight
 * server/seeds/circles-seed.json seeds on every fresh fork.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { addChange, createDraft, previewDraft, publishDraft, revertDraft } from "./orgDrafts";
import { readRegenFile } from "../../shared/regenFile";
import { defaultChoices, draftChangesFor, draftWordsFor, planImport, type LiveVillage } from "../../shared/regenImport";
import type { SeatCalendar } from "../../shared/seatTerms";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const ROOT = path.join(HERE, "..", "..");
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "seeds", "circles-seed.json"), "utf8")) as Array<{ id: string; name: string }>;
const CARD = fs.readFileSync(path.join(ROOT, "shared", "__fixtures__", "regen-card-riverbend.json"), "utf8");

/** Dated from today and never far out: MySQL 8 caps a TIMESTAMP at 2038 (see draftPublishOnce.test.ts). */
const dayFromToday = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const CALENDAR: SeatCalendar = {
  seasons: [{ id: "season-now", startsOn: dayFromToday(-30), endsOn: dayFromToday(60) }],
  currentSeasonId: "season-now",
  timezone: "UTC",
};

function planOf() {
  const read = readRegenFile(CARD);
  if (!read.ok) throw new Error(read.error);
  const live: LiveVillage = {
    scope: [],
    circles: SEED.map((c) => ({ id: c.id, name: c.name, status: "active", isExample: false, aliases: [], decidesBy: null })),
    seats: [],
    seasonEnds: true,
  };
  return planImport(read.profile, live, { tag: "t1" });
}

/** The draft as the import screen builds it: through the same two calls the admin route makes. */
async function draftFromCard(): Promise<string> {
  const plan = planOf();
  const words = draftWordsFor(plan.profile);
  const made = await createDraft(pool, { title: words.title, rationale: words.rationale, createdBy: "u-founder", sourceKind: "human", openCap: null });
  if (!made.ok) throw new Error(made.error);
  for (const c of draftChangesFor(plan, defaultChoices(plan))) {
    const r = await addChange(pool, made.id, c);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
  }
  return made.id;
}

async function circles(): Promise<Map<string, { name: string; status: string }>> {
  const [rows] = await pool.query<any[]>("SELECT id, name, status FROM circles"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
  return new Map((rows as any[]).map((r) => [String(r.id), { name: String(r.name), status: String(r.status) }]));
}

describe.skipIf(!configured)("a village started from a real ReGen Civics card", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
    await pool.query("DELETE FROM org_role_assignments"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles"); // module-review-ok: same
    await pool.query("DELETE FROM circles"); // module-review-ok: same
    let order = 1;
    for (const c of SEED) {
      await pool.query( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
        "INSERT INTO circles (id, name, parent_circle_id, is_example, status, sort_order) VALUES (?, ?, NULL, 0, 'active', ?)",
        [c.id, c.name, order++],
      );
    }
    await pool.query( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
      "INSERT INTO collection_versions (collection, version) VALUES ('circles', 1) ON DUPLICATE KEY UPDATE version = 1",
    );
  });

  it("previews every line clean, in words", async () => {
    const id = await draftFromCard();
    const preview = await previewDraft(pool, id);
    expect(preview.blocked, JSON.stringify(preview.lines.filter((l) => l.blocked))).toBe(0);
    const reads = preview.lines.map((l) => l.reads);
    expect(reads).toContain('Create the circle "Living Water"');
    expect(reads).toContain('Create the circle "Kitchen"');
    expect(reads).toContain('Create the role "River voice"');
    expect(reads).toContain("Put Ana in Water keeper");
    expect(reads).toContain(`Retire the circle "${SEED[0].name}", so it rests as dormant`);
  });

  it("publishes the project's circles, its seats and its holders, and rests the councils", async () => {
    const id = await draftFromCard();
    const r = await publishDraft(pool, id, "u-founder", null, CALENDAR);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);

    const after = await circles();
    for (const made of ["living-water", "love-cultivation", "kitchen", "trust-comms", "festivals-rites"]) {
      expect(after.get(made)?.status, made).toBe("active");
    }
    for (const c of SEED) expect(after.get(c.id)?.status, c.id).toBe("dormant");

    const [seats] = await pool.query<any[]>( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
      "SELECT id, name, circle_id, aim, domain, accountabilities, why_it_matters, seats, recruiting, active FROM org_roles ORDER BY id",
    );
    const byId = new Map((seats as any[]).map((s) => [String(s.id), s]));
    expect([...byId.keys()].sort()).toEqual(["ceremony-holder-t1", "cook-t1", "heart-keeper-t1", "river-voice-t1", "water-keeper-t1"]);
    const keeper = byId.get("water-keeper-t1");
    expect(keeper.circle_id).toBe("living-water");
    expect(keeper.domain).toBe("when we irrigate");
    const list = typeof keeper.accountabilities === "string" ? JSON.parse(keeper.accountabilities) : keeper.accountabilities;
    expect(list).toEqual(["The spring, the catchment, the water tests", "Contribution: 4 hours a week"]);
    expect(Number(keeper.recruiting)).toBe(0);
    expect(byId.get("cook-t1").circle_id).toBe("kitchen");
    expect(Number(byId.get("river-voice-t1").recruiting)).toBe(1);
    expect(String(byId.get("river-voice-t1").why_it_matters)).toContain("A being holds this role: The river.");

    const [holders] = await pool.query<any[]>( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
      "SELECT org_role_id, holder_kind, user_id, display_name FROM org_role_assignments WHERE ended_at IS NULL ORDER BY org_role_id",
    );
    expect((holders as any[]).map((h) => [h.org_role_id, h.holder_kind, h.user_id, h.display_name])).toEqual([
      ["heart-keeper-t1", "documented", null, "Bo"],
      ["water-keeper-t1", "documented", null, "Ana"],
    ]);
  });

  it("reverts to the councils it found, resting what it made", async () => {
    const id = await draftFromCard();
    const published = await publishDraft(pool, id, "u-founder", null, CALENDAR);
    expect(published.ok, !published.ok ? published.error : "").toBe(true);
    const reverted = await revertDraft(pool, id);
    expect(reverted.ok, !reverted.ok ? reverted.error : "").toBe(true);

    const after = await circles();
    for (const c of SEED) expect(after.get(c.id)?.status, c.id).toBe("active");
    expect(after.get("living-water")?.status).toBe("dormant");
    const [[live]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_roles WHERE active = 1"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
    expect(Number(live.n)).toBe(0);
    const [[held]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_role_assignments WHERE ended_at IS NULL"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
    expect(Number(held.n)).toBe(0);
  });
});
