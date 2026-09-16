/**
 * THE CHANGE LIMIT ON ONE OUTSIDE BATCH IS THE VILLAGE'S OWN SETTING.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────
 *
 * `draftChangeCap` was `max(3, activeMembers * 3)`. A live village of two
 * accounts therefore had a limit of six, and a first import from an outside
 * service carrying eighteen seats previewed with twelve lines blocked and
 * could not publish. Accept takes a whole batch, so there was no smaller step
 * to take. Rye, 2026-09-14: "the 3 changes per account seems to be a broken
 * limit! Let's definitely make this a setting and set it to much higher as the
 * beginnings will all have massive changes like this to get a village up."
 *
 * ── WHAT THIS HOLDS ──────────────────────────────────────────────────────
 *
 *   1. Eighteen seats from one machine draft, in a village of two accounts,
 *      preview with nothing blocked and publish, under the shipped default.
 *   2. A village that tunes the limit down to six is refused past six, in the
 *      sentence the preview already says and publish already repeats.
 *   3. The tuned value beats the default, and survives a reload of the
 *      registry from its table, which is what a restart does.
 *   4. A draft a person built is never held to it.
 *
 * The roster of two appears only in `openDraftCap`, the one org-draft limit
 * that still counts accounts. The change limit takes no roster at all, which
 * is the point: there is no member count left that could shrink it.
 *
 * Every seat carries a distinct name, no circle and no seats or criticality
 * field, so the only thing that can block a line here is the change limit.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft, draftChangeCap, openDraftCap, previewDraft, publishDraft } from "./orgDrafts";
import { listOrgRoles } from "./orgChart";
import { loadVariables, setVariable } from "./variables";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const KEY = "org.proposal_change_limit";
/** The live village this was found on had two accounts. */
const ROSTER = 2;
/** The first import that met the old limit. */
const SEATS = 18;

async function draftOf(seats: number, sourceKind: "agent" | "human" = "agent") {
  const made = await createDraft(pool, {
    title: `A batch of ${seats}`,
    sourceKind,
    sourceModuleId: sourceKind === "agent" ? "outside-service" : null,
    openCap: sourceKind === "agent" ? openDraftCap(ROSTER) : null,
  });
  if (!made.ok) throw new Error(made.error);
  for (let i = 1; i <= seats; i += 1) {
    const r = await addChange(pool, made.id, {
      op: "create_seat",
      orgRoleId: `limit-seat-${i}`,
      payload: { name: `Proposed seat ${i}` },
    });
    expect(r.ok, `seat ${i} was added`).toBe(true);
  }
  return made.id;
}

async function tune(value: string) {
  const r = await setVariable(pool, KEY, value);
  expect(r.ok, r.error).toBe(true);
}

describe.skipIf(!configured)("the change limit on one outside batch", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await loadVariables(pool);
  });
  afterAll(async () => {
    if (pool) await setVariable(pool, KEY, VARIABLES_BY_KEY[KEY].default);
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles"); // module-review-ok: same
    // Back to the platform default, which removes the stored row.
    await tune(VARIABLES_BY_KEY[KEY].default);
  });

  it("is a village setting that ships at 500, between 1 and 10000 changes", () => {
    const def = VARIABLES_BY_KEY[KEY];
    expect(def, "the registry carries the setting").toBeTruthy();
    expect(def.type).toBe("integer");
    expect(def.default).toBe("500");
    expect([def.min, def.max, def.unit]).toEqual([1, 10000, "changes"]);
  });

  it("previews eighteen seats from one machine draft in a village of two with nothing blocked, and publishes all of them", async () => {
    const id = await draftOf(SEATS);

    const preview = await previewDraft(pool, id, draftChangeCap());
    expect(preview.lines).toHaveLength(SEATS);
    expect(preview.lines.filter((l) => l.blocked).map((l) => l.blocked)).toEqual([]);
    expect(preview.blocked).toBe(0);

    const published = await publishDraft(pool, id, "steward", draftChangeCap());
    // Seat creations seat nobody, so the transaction names nobody to tell.
    expect(published).toEqual({ ok: true, applied: SEATS, seated: [] });
    expect(await listOrgRoles(pool)).toHaveLength(SEATS);
  });

  it("blocks every line past a limit the village tuned down to six, with the sentence the preview already says", async () => {
    await tune("6");
    const id = await draftOf(SEATS);

    const preview = await previewDraft(pool, id, draftChangeCap());
    expect(preview.blocked).toBe(SEATS - 6);
    expect(preview.lines.slice(0, 6).every((l) => l.blocked === null)).toBe(true);
    for (const line of preview.lines.slice(6)) {
      expect(line.blocked).toBe("This proposal is past this village's limit of 6 changes in one reorganisation");
    }

    // Publish refuses the draft whole, and says the same limit.
    const published = await publishDraft(pool, id, "steward", draftChangeCap());
    expect(published.ok).toBe(false);
    expect((published as { error: string }).error).toContain("limit of 6 changes in one reorganisation");
    expect(await listOrgRoles(pool)).toHaveLength(0);
  });

  it("reads the village's tuned value over the default, and keeps it across a reload of the registry", async () => {
    expect(draftChangeCap()).toBe(500);

    await tune("10");
    expect(draftChangeCap()).toBe(10);
    const id = await draftOf(SEATS);
    expect((await previewDraft(pool, id, draftChangeCap())).blocked).toBe(SEATS - 10);

    // A restart reads the table again. The tuned value is the stored one,
    // and never the default the code ships.
    await tune("9000");
    await loadVariables(pool);
    expect(draftChangeCap()).toBe(9000);
  });

  it("refuses a limit outside its bounds, so no village can set one that blocks every line", async () => {
    expect((await setVariable(pool, KEY, "0")).ok).toBe(false);
    expect((await setVariable(pool, KEY, "10001")).ok).toBe(false);
    expect(draftChangeCap()).toBe(500);
  });

  it("never holds a draft a person built to the limit, however low the village set it", async () => {
    await tune("6");
    const id = await draftOf(SEATS, "human");
    const preview = await previewDraft(pool, id, draftChangeCap());
    expect(preview.blocked).toBe(0);
  });
});
