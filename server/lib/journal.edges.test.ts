/**
 * The journal's consent, erasure and pulse rules at their edges, against a
 * scratch schema. Written by the verifier of the review fixes, beside the
 * cases server/routes/journal.test.ts already holds, to pin what those cases
 * could not see:
 *
 *   - the prefs row's `updated_at` is read straight off the row, so a note or
 *     style change while closed that moved it would go red here even when the
 *     delivery read happens to land the same way;
 *   - a message left unsigned by its author's erasure still behaves as the
 *     recipient's own: they can answer it, another erasure leaves it alone,
 *     and their own erasure takes it;
 *   - a pulse re-sent with newer words into the NEXT week gives the old week
 *     back the answer it had replaced.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import {
  cleanEntryInput,
  forgetMemberJournal,
  queueFeedback,
  readOwnPulse,
  receivedFeedback,
  respondFeedback,
  saveEntry,
  savePrefs,
  sentFeedback,
} from "./journal";

const configured = testDbConfigured();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe.skipIf(!configured)("the journal's edges against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    for (const t of ["journal_entries", "journal_pulse", "journal_feedback_prefs", "journal_feedback"]) {
      await q(`DELETE FROM \`${t}\``);
    }
  });

  const parts = (recipientId: string) => ({ recipientId, observation: "o", feeling: "f", need: "n", request: "r" });
  const answeredAt = async (userId: string) =>
    Number((await q("SELECT UNIX_TIMESTAMP(`updated_at`) AS t FROM `journal_feedback_prefs` WHERE `user_id` = ?", [userId]))[0].t);

  it("moves the prefs row's answered instant only when the yes or no flips", async () => {
    const t1 = new Date("2026-09-01T10:00:00Z");
    const t2 = new Date("2026-09-02T10:00:00Z");
    const t5 = new Date("2026-09-05T10:00:00Z");
    await savePrefs(pool, "m-ben", { open: true, style: "gentle", note: "" }, t1);
    expect(await answeredAt("m-ben")).toBe(t1.getTime() / 1000);
    await savePrefs(pool, "m-ben", { open: false, style: "gentle", note: "" }, t2);
    expect(await answeredAt("m-ben")).toBe(t2.getTime() / 1000);
    // A new note, then a new style, while still closed: the instant stays on the no.
    await savePrefs(pool, "m-ben", { open: false, style: "gentle", note: "not now" }, new Date("2026-09-03T10:00:00Z"));
    await savePrefs(pool, "m-ben", { open: false, style: "direct", note: "not now" }, new Date("2026-09-04T10:00:00Z"));
    expect(await answeredAt("m-ben")).toBe(t2.getTime() / 1000);
    await savePrefs(pool, "m-ben", { open: true, style: "direct", note: "not now" }, t5);
    expect(await answeredAt("m-ben")).toBe(t5.getTime() / 1000);
  });

  it("keeps an unsigned message the recipient's own: they can answer it, and only their erasure takes it", async () => {
    const queuedAt = new Date("2026-09-30T12:00:00Z");
    await savePrefs(pool, "m-ben", { open: true, style: "gentle", note: "" }, new Date(queuedAt.getTime() - 10 * DAY));
    const sent = await queueFeedback(pool, "m-ana", parts("m-ben"), "Thank you for the bench.", {
      timeZone: "UTC",
      now: queuedAt,
      recipientName: "Ben Ortiz",
    });
    if (!sent.ok) throw new Error(sent.problem);
    const after = new Date(new Date(sent.sent.deliverAfter!).getTime() + HOUR);

    await forgetMemberJournal(pool, "m-ana", after);

    const answered = await respondFeedback(pool, "m-ben", sent.sent.id, "thanks", after);
    expect(answered).toMatchObject({ id: sent.sent.id, message: "Thank you for the bench.", response: "thanks" });
    // The author's own view, under any id a member could hold, never shows it again.
    expect(await sentFeedback(pool, "m-ana", async () => "Ben Ortiz", after)).toEqual([]);

    // Another member leaving touches nothing of it.
    await forgetMemberJournal(pool, "m-cai", after);
    expect((await receivedFeedback(pool, "m-ben", after)).map((f) => f.id)).toEqual([sent.sent.id]);

    // Ben saying no later keeps what already reached him.
    await savePrefs(pool, "m-ben", { open: false, style: "gentle", note: "" }, new Date(after.getTime() + HOUR));
    expect((await receivedFeedback(pool, "m-ben", new Date(after.getTime() + 2 * HOUR))).map((f) => f.id)).toEqual([
      sent.sent.id,
    ]);

    // The recipient leaving takes it, unsigned or not.
    await forgetMemberJournal(pool, "m-ben", after);
    expect(await q("SELECT COUNT(*) AS n FROM `journal_feedback`")).toEqual([{ n: 0 }]);
  });

  it("gives the old week its earlier answer back when a re-sent pulse moves into the next week", async () => {
    const save = async (clientId: string, scores: Record<string, number>, writtenAt: string) => {
      const input = cleanEntryInput(
        { clientId, practice: "pulse", depth: "light", answers: [], scores, writtenAt },
        new Date("2026-10-06T00:00:00Z"),
      );
      if (!input.ok) throw new Error(input.problem);
      return saveEntry(pool, "m-ana", input.value, "UTC");
    };
    // Week 2026-W40 runs Monday 28 September to Sunday 4 October, UTC.
    const monday = await save("c-mon", { load: 5 }, "2026-09-28T08:00:00.000Z");
    const late = await save("c-late", { load: 4 }, "2026-10-04T23:30:00.000Z");
    expect(await readOwnPulse(pool, "m-ana")).toEqual([{ weekId: "2026-W40", scores: { load: 4 } }]);

    // The same sitting, edited and saved again just after midnight: week 41.
    const again = await save("c-late", { load: 2 }, "2026-10-05T00:10:00.000Z");
    expect(again.entry.id).toBe(late.entry.id);
    expect(again.created).toBe(false);
    expect(await readOwnPulse(pool, "m-ana")).toEqual([
      { weekId: "2026-W41", scores: { load: 2 } },
      { weekId: "2026-W40", scores: { load: 5 } },
    ]);
    expect(
      await q("SELECT `week_id`, `entry_id` FROM `journal_pulse` WHERE `user_id` = 'm-ana' ORDER BY `week_id`"),
    ).toEqual([
      { week_id: "2026-W40", entry_id: monday.entry.id },
      { week_id: "2026-W41", entry_id: late.entry.id },
    ]);
  });

  it("writes one entry and one set of numbers when the same save arrives twice at once", async () => {
    const input = cleanEntryInput(
      {
        clientId: "c-twice",
        practice: "pulse",
        depth: "light",
        answers: [],
        scores: { load: 3, energy: 1 },
        writtenAt: "2026-09-30T10:00:00.000Z",
      },
      new Date("2026-10-01T00:00:00Z"),
    );
    if (!input.ok) throw new Error(input.problem);
    const [a, b] = await Promise.all([
      saveEntry(pool, "m-ana", input.value, "UTC"),
      saveEntry(pool, "m-ana", input.value, "UTC"),
    ]);
    expect(a.entry.id).toBe(b.entry.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await q("SELECT COUNT(*) AS n FROM `journal_entries`")).toEqual([{ n: 1 }]);
    expect(await readOwnPulse(pool, "m-ana")).toEqual([{ weekId: "2026-W40", scores: { load: 3, energy: 1 } }]);
  });
});
