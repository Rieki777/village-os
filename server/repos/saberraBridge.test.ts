import { describe, expect, it } from "vitest";
import { bridgeReading } from "./saberraBridge";

/** A pool that knows which tables exist and answers counts by matching SQL. */
function fakePool(tables: string[], answers: [RegExp, unknown[]][]) {
  return {
    query: async (sql: string) => {
      if (sql.includes("information_schema.TABLES")) return [tables.map((t) => ({ t }))];
      if (sql.includes("information_schema.COLUMNS")) return [[{ c: "status" }]];
      for (const [re, rows] of answers) if (re.test(sql)) return [rows];
      return [[{ n: 0 }]];
    },
  } as any;
}

describe("the bridge reading", () => {
  it("answers not ready, not an error, when the tables are missing", async () => {
    const r = await bridgeReading(fakePool([], []));
    expect(r.lists.ready).toBe(false);
    expect(r.feedback.ready).toBe(false);
    expect(r.needsOwner.ready).toBe(false);
    expect(r.reviewQueue.waiting).toBe(0);
  });

  it("counts lists, feedback, the review queue and Needs Owner", async () => {
    const r = await bridgeReading(
      fakePool(
        ["member_tasks", "member_task_access", "sera_person_links", "member_task_import_queue", "member_task_outbox", "member_task_bridge", "member_task_prefs", "external_proposals"],
        [
          [/SELECT DISTINCT `user_id` FROM `sera_person_links`\) l/, [{ name: "Ana", on_: 1, imported: 33, last_at: new Date("2026-11-02T20:00:00Z") }]],
          [/member_task_prefs/, [{ n: 2 }]],
          [/sera_person_links/, [{ n: 1 }]],
          [/member_task_access/, [{ n: 1 }]],
          [/GROUP BY `import_batch`/, [{ b: "batch-1", at: new Date("2026-11-02T20:00:00Z"), n: 33 }]],
          [/FROM `member_tasks`/, [{ n: 33, o: 30 }]],
          [/member_task_outbox/, [{ kind: "feedback", status: "sent", n: 4 }, { kind: "feedback", status: "queued", n: 2 }, { kind: "feedback", status: "failed", n: 1 }, { kind: "note", status: "held", n: 3 }]],
          [/member_task_bridge/, [{ value: "held" }]],
          [/external_proposals/, [{ n: 5 }]],
          [/member_task_import_queue/, [{ n: 2 }]],
        ],
      ),
    );
    expect(r.lists).toMatchObject({ ready: true, linkedPeople: 1, listsOn: 1, imported: 33, importedOpen: 30 });
    expect(r.lists.lastBatch).toEqual({ id: "batch-1", at: "2026-11-02T20:00:00.000Z", tasks: 33 });
    expect(r.feedback).toEqual({ ready: true, sent: 4, queued: 2, failed: 1, notesHeld: 3, notesReleased: false, membersOff: 2 });
    expect(r.lists.people).toEqual([{ name: "Ana", listOn: true, imported: 33, lastImportAt: "2026-11-02T20:00:00.000Z", lastSyncedAt: null }]);
    expect(r.reviewQueue.waiting).toBe(5);
    expect(r.needsOwner).toEqual({ ready: true, waiting: 2 });
  });
});
