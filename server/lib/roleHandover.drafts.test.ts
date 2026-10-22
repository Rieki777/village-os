/**
 * "Bring me", "Not mine to hold" and the runbook change on the ROLE, by draft
 * (0268, Rye 2026-10-22), and only by draft.
 *
 * What this pins, each against a real schema:
 *   - the round trip for each field: an `update_seat` draft names it, the
 *     publish writes it, `listOrgRoles` reads it back, and the revert puts the
 *     words before it back;
 *   - a role a `create_seat` draft makes keeps all three;
 *   - a bad value blocks at preview with the parser's sentence, and a draft
 *     that reaches the publish anyway is refused there too, nothing written;
 *   - reverting a draft whose `before_json` predates 0268 leaves words written
 *     since alone;
 *   - MIGRATION COMPAT: the three columns are nullable with no default, and the
 *     previous release's INSERT, which names none of them, still writes a role.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft, previewDraft, publishDraft, revertDraft } from "./orgDrafts";
import { listOrgRoles } from "./orgChart";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function draftWith(op: "update_seat" | "create_seat", orgRoleId: string, payload: Record<string, unknown>) {
  const made = await createDraft(pool, { title: "Handover words", createdBy: "u-steward", openCap: 99 });
  if (!made.ok) throw new Error(made.error);
  const added = await addChange(pool, made.id, { op, orgRoleId, payload });
  if (!added.ok) throw new Error(added.error);
  return made.id;
}

async function publishWith(op: "update_seat" | "create_seat", orgRoleId: string, payload: Record<string, unknown>) {
  const id = await draftWith(op, orgRoleId, payload);
  const preview = await previewDraft(pool, id, 99);
  expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
  const r = await publishDraft(pool, id, "u-steward", 99);
  expect(r.ok, !r.ok ? r.error : "").toBe(true);
  return id;
}

async function roleOf(id: string) {
  return (await listOrgRoles(pool)).find((r) => r.id === id);
}

describe.skipIf(!configured)("the handover words change on the role, by draft", () => {
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
    await pool.query("DELETE FROM org_roles WHERE id LIKE 'hand-%'"); // module-review-ok: same, only this suite's own roles
    await pool.query("INSERT INTO org_roles (id, name, aim, domain, accountabilities, seats) VALUES ('hand-water', 'Water Steward', 'Keep the springs running', 'The tanks', '[]', 1)"); // module-review-ok: this suite's own fixture role
  });

  it("migration compat: three nullable columns, no default, and the old INSERT still writes a role", async () => {
    const [cols] = await pool.query<any[]>(
      "SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_roles' AND COLUMN_NAME IN ('bring_me','not_mine','runbook') ORDER BY COLUMN_NAME",
    );
    // MariaDB spells "no default" as the text NULL; MySQL as a real null.
    expect(cols.map((c) => [c.name, c.nullable, c.def === "NULL" ? null : (c.def ?? null)])).toEqual([
      ["bring_me", "YES", null],
      ["not_mine", "YES", null],
      ["runbook", "YES", null],
    ]);
    expect(cols.find((c) => c.name === "runbook")?.type).toBe("text");
    // The previous release's create_seat INSERT, column for column. It names none of the three.
    await pool.query(
      "INSERT INTO org_roles (id, name, circle_id, aim, domain, accountabilities, seats, why_it_matters, criticality, recruiting, terms_offer, terms_offer_at, terms_offer_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", // module-review-ok: the previous release's own statement, replayed against the migrated schema
      ["hand-old", "Old Release Role", null, null, null, "[]", 1, null, "normal", 0, null, null, null],
    );
    const old = await roleOf("hand-old");
    expect(old).toMatchObject({ bringMe: null, notMine: null, runbook: null });
  });

  it("round trip: Bring me, by update_seat, and the revert puts it back", async () => {
    const id = await publishWith("update_seat", "hand-water", { bringMe: ["A water reading", "  The tank key  "] });
    expect((await roleOf("hand-water"))?.bringMe).toEqual(["A water reading", "The tank key"]);
    const back = await revertDraft(pool, id);
    expect(back.ok, !back.ok ? back.error : "").toBe(true);
    expect((await roleOf("hand-water"))?.bringMe).toBeNull();
  });

  it("round trip: Not mine to hold, sent as one item per line", async () => {
    await publishWith("update_seat", "hand-water", { notMine: "Garden irrigation\n\nRoof gutters" });
    expect((await roleOf("hand-water"))?.notMine).toEqual(["Garden irrigation", "Roof gutters"]);
  });

  it("round trip: the runbook, words and then one https link, and the revert restores the words", async () => {
    await publishWith("update_seat", "hand-water", { runbook: "Check the tanks every Monday." });
    expect((await roleOf("hand-water"))?.runbook).toBe("Check the tanks every Monday.");
    const second = await publishWith("update_seat", "hand-water", { runbook: "https://example.org/water" });
    expect((await roleOf("hand-water"))?.runbook).toBe("https://example.org/water");
    const back = await revertDraft(pool, second);
    expect(back.ok).toBe(true);
    expect((await roleOf("hand-water"))?.runbook).toBe("Check the tanks every Monday.");
  });

  it("null clears a field, and a field the draft does not name is left as it was", async () => {
    await publishWith("update_seat", "hand-water", { bringMe: ["A reading"], runbook: "Words" });
    await publishWith("update_seat", "hand-water", { bringMe: null });
    const r = await roleOf("hand-water");
    expect(r?.bringMe).toBeNull();
    expect(r?.runbook).toBe("Words");
    expect(r?.aim).toBe("Keep the springs running");
  });

  it("a role a create_seat draft makes keeps all three", async () => {
    await publishWith("create_seat", "hand-new", {
      name: "Hearth Keeper",
      bringMe: ["Firewood"],
      notMine: ["The kitchen rota"],
      runbook: "https://example.org/hearth",
    });
    expect(await roleOf("hand-new")).toMatchObject({
      bringMe: ["Firewood"],
      notMine: ["The kitchen rota"],
      runbook: "https://example.org/hearth",
    });
  });

  it("a bad value blocks at preview with the parser's sentence, and the publish refuses it too", async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ bringMe: Array.from({ length: 9 }, (_, i) => `Item ${i + 1}`) }, /Bring me: Up to 8 lines/],
      [{ notMine: ["x".repeat(161)] }, /Not mine to hold: Keep each line to 160 characters/],
      [{ runbook: "x".repeat(2001) }, /Runbook: Keep it to 2000 characters/],
      [{ runbook: "http://example.org/plain" }, /https:\/\//],
      [{ bringMe: ["Pay into 12345678901"] }, /bank or card number/],
    ];
    for (const [payload, words] of cases) {
      const id = await draftWith("update_seat", "hand-water", payload);
      const preview = await previewDraft(pool, id, 99);
      expect(preview.blocked, JSON.stringify(payload)).toBe(1);
      expect(preview.lines[0].blocked).toMatch(words);
      const r = await publishDraft(pool, id, "u-steward", 99);
      expect(r.ok).toBe(false);
    }
    expect(await roleOf("hand-water")).toMatchObject({ bringMe: null, notMine: null, runbook: null });
  });

  it("reverting a draft captured before 0268 leaves words written since alone", async () => {
    const id = await publishWith("update_seat", "hand-water", { aim: "A new aim" });
    // What a release before 0268 captured: no handover columns at all.
    await pool.query( // module-review-ok: this suite rewrites its own draft row to the shape an older release stored
      "UPDATE org_draft_changes SET before_json = JSON_REMOVE(before_json, '$.bring_me', '$.not_mine', '$.runbook') WHERE draft_id = ?",
      [id],
    );
    await publishWith("update_seat", "hand-water", { bringMe: ["Written since"] });
    const back = await revertDraft(pool, id);
    expect(back.ok, !back.ok ? back.error : "").toBe(true);
    const r = await roleOf("hand-water");
    expect(r?.aim).toBe("Keep the springs running");
    expect(r?.bringMe).toEqual(["Written since"]);
  });
});
