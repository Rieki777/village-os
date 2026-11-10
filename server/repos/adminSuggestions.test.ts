/**
 * THE SUGGESTION STORE against a real scratch schema: `assistant_drafts` rows
 * of kind `admin_edit` (server/repos/adminSuggestions.ts).
 *
 * What is pinned here is what only MySQL can answer: the row saves with every
 * NOT NULL column filled, a status move is guarded on the status it expects,
 * and the assistant's own queue (server/lib/drafts.ts) never sees a
 * suggestion, so its accept route cannot create a circle out of one.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { suggestionStore, type SuggestionStore } from "./adminSuggestions";
import { draftById, draftQueue } from "../lib/drafts";
import type { AdminEditPayload } from "../../shared/draftKinds";

const configured = testDbConfigured();

const edit: AdminEditPayload = { control: "village_paths", capability: "story.tell", version: "0a1b2c3d", base: {}, payload: { ladder: { title: "Our way" } } };

describe.skipIf(!configured)("admin_edit suggestions in assistant_drafts", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let store: SuggestionStore;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    store = suggestionStore(() => pool as any);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM assistant_drafts");
  });

  it("saves a suggestion and reads it back whole", async () => {
    const made = await store.create({ edit, why: "Our words for it", suggestedBy: "u-sugg" });
    expect(made.id).toMatch(/^sugg-/);
    expect(made.status).toBe("proposed");
    expect(made.edit).toEqual(edit);
    expect(made.suggestedBy).toBe("u-sugg");
    expect((await store.byId(made.id))?.why).toBe("Our words for it");
    expect((await store.withStatus("proposed")).map((s) => s.id)).toEqual([made.id]);
    expect((await store.bySuggester("u-sugg")).map((s) => s.id)).toEqual([made.id]);
  });

  it("moves a status only from the status it expects", async () => {
    const made = await store.create({ edit, why: "", suggestedBy: "u-sugg" });
    expect(await store.move(made.id, "proposed", "rejected", { decidedBy: "u-holder", note: "Not this moon." })).toBe(true);
    // A second reviewer pressing at the same moment loses, and changes nothing.
    expect(await store.move(made.id, "proposed", "accepted", { decidedBy: "u-other" })).toBe(false);
    const after = await store.byId(made.id);
    expect(after?.status).toBe("rejected");
    expect(after?.decidedBy).toBe("u-holder");
    expect(after?.note).toBe("Not this moon.");
    expect(after?.decidedAt).not.toBeNull();
  });

  it("records the ballot deciding it, and clears it when the suggestion comes back", async () => {
    const made = await store.create({ edit, why: "", suggestedBy: "u-sugg" });
    expect(await store.move(made.id, "proposed", "superseded", { ballotId: "bal-1" })).toBe(true);
    expect((await store.byId(made.id))?.ballotId).toBe("bal-1");
    expect(await store.move(made.id, "superseded", "proposed", {})).toBe(true);
    const back = await store.byId(made.id);
    expect(back?.ballotId).toBeNull();
    expect(back?.decidedAt).toBeNull();
  });

  it("is never served by the assistant's queue or its accept route", async () => {
    const made = await store.create({ edit, why: "", suggestedBy: "u-sugg" });
    expect(await draftQueue(pool as any, "proposed")).toEqual([]);
    expect(await draftById(pool as any, made.id)).toBeNull();
  });
});
