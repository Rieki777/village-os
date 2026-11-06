/**
 * The bridge to the organisational memory service, part 1, against a scratch
 * schema: code-names, the name swap inside a real payload, and an outbox that
 * records what would cross and sends nothing.
 *
 * EACH CASE ASSERTS ON THE ROWS, never on a function having been called. The
 * privacy cases read every payload the outbox holds and search it for every
 * name, handle, email and id the village holds for every member: a test that
 * checked one field would pass while a second field carried a name out.
 *
 * The module states are the one thing stubbed (`effectiveLifecycle`), the way
 * server/routes/questConsentPayout.test.ts stubs it, so each case says which
 * modules are on and nothing else about the server is faked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({ lifecycle: { saberra: "public", journal: "public" } as Record<string, string> }));

vi.mock("./modules", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    effectiveLifecycle: (id: string) => (id in ctl.lifecycle ? ctl.lifecycle[id] : actual.effectiveLifecycle(id)),
  };
});

import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import {
  CODE_NAME_SPACE,
  codeNameFor,
  codeNamesPendingVendorDelete,
  dropCodeNameOnVendorConfirm,
  looksLikeCodeName,
  mintCodeName,
  resolveCodeName,
} from "./codeNames";
import { cleanEntryInput, editEntry, forgetEntry, queueFeedback, saveEntry, savePrefs } from "./journal";
import { namesOf } from "./nameSwap";
import {
  backfillJournalOutbox,
  drainOutbox,
  enqueueJournalEntry,
  enqueueTeamSignal,
  forgetMemberInOutbox,
  journalSourceRef,
  lastCompletedWeekId,
  outboxView,
  rosterOf,
  runBridgeJob,
  setOutboxTransport,
  teamSignalSourceRef,
  withdrawJournalEntry,
  type OutboxSend,
} from "./saberraOutbox";
import { allPayloads, rowBySourceRef } from "../repos/saberraOutbox";

/*
 * The village. Names chosen so no code-name word contains one, which lets the
 * scan below search payloads by plain substring, the strictest form.
 */
const PEOPLE = [
  { id: "u-ximena", name: "Ximena Quell", handle: "xquell", email: "ximena.quell@example.org" },
  { id: "u-bartholo", name: "Bartholo Vex", handle: "bvex", email: "bartholo@example.org" },
  { id: "u-odalys", name: "Odalys Prynne", handle: "oprynne", email: "odalys.prynne@example.org" },
  // A departed member's tombstone and an example identity are not on the roster.
  { id: "u-gone", name: "A departed member", handle: "departed-1234", email: "deleted-u-gone@anonymized.invalid" },
  { id: "u-example", name: "Standing Example", handle: "standing", email: "standing@example.org", isExample: true },
];
const ROSTER = rosterOf(PEOPLE);
const roster = async () => ROSTER;
const TZ = "UTC";

/** Every string that would identify a member if it crossed. */
const IDENTIFYING = PEOPLE.slice(0, 3).flatMap((p) => [p.id, p.email, ...namesOf(p)]);

const configured = testDbConfigured();

describe("code-names, as a pure shape", () => {
  it("mints two words and two digits, and only from the fixed lists", () => {
    for (let i = 0; i < 200; i++) {
      const c = mintCodeName();
      expect(looksLikeCodeName(c), c).toBe(true);
    }
    // The extremes of every list, chosen by hand.
    expect(mintCodeName(() => 0)).toMatch(/^[a-z]+-[a-z]+-10$/);
    expect(mintCodeName((n) => n - 1)).toMatch(/^[a-z]+-[a-z]+-99$/);
  });

  it("draws from a space of hundreds of thousands, so a collision is rare", () => {
    expect(CODE_NAME_SPACE.first * CODE_NAME_SPACE.second * CODE_NAME_SPACE.digits).toBeGreaterThan(300_000);
  });

  it("refuses a shape that is not a code-name", () => {
    expect(looksLikeCodeName("Ximena")).toBe(false);
    expect(looksLikeCodeName("brisk-otter-7")).toBe(false);
    expect(looksLikeCodeName("sub_0123")).toBe(false);
  });
});

describe.skipIf(!configured)("the bridge against a real schema", () => {
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
    ctl.lifecycle = { saberra: "public", journal: "public" };
    for (const t of ["journal_entries", "journal_pulse", "journal_feedback_prefs", "journal_feedback", "saberra_outbox", "member_code_names"]) {
      await q(`DELETE FROM \`${t}\``); // module-review-ok: fixture reset of the scratch schema
    }
  });

  afterEach(() => setOutboxTransport(null));

  /** Save one entry through the journal's own path, the way the route does. */
  const save = async (userId: string, body: Record<string, unknown>) => {
    const input = cleanEntryInput({ depth: "light", ...body }, new Date());
    if (!input.ok) throw new Error(input.problem);
    return (await saveEntry(pool, userId, input.value, TZ)).entry;
  };

  const NAMED_ENTRY = {
    clientId: "c-named",
    practice: "debrief",
    writtenAt: "2026-10-13T18:00:00Z",
    answers: [
      {
        questionKey: "what-happened",
        prompt: "What happened with Bartholo?",
        text: "Ximena's plan, Bartholo Vex's budget and odalys. Mail ximena.quell@example.org or ping @bvex and OPRYNNE.",
      },
    ],
    reflection: "Odalys Prynne and I agreed.",
    meta: { call: "Sync with Bartholo", seats: ["Ximena's seat"], quests: ["Help Odalys"] },
  };

  const payloadOf = async (entryId: string) => {
    const row = await rowBySourceRef(pool, journalSourceRef(entryId));
    return row && row.payload ? JSON.parse(String(row.payload)) : null;
  };

  describe("code-names in the database", () => {
    it("gives a member ONE stable code-name, and a second ask returns the same one", async () => {
      const a = await codeNameFor(pool, "u-ximena", "journal");
      const b = await codeNameFor(pool, "u-ximena", "journal");
      expect(looksLikeCodeName(a)).toBe(true);
      expect(b).toBe(a);
      expect(await resolveCodeName(pool, a)).toBe("u-ximena");
    });

    it("MINTS AGAIN ON A COLLISION instead of handing one person another's code-name", async () => {
      const taken = await codeNameFor(pool, "u-ximena", "journal");
      const tries = [taken, taken, "quiet-heron-42"];
      const got = await codeNameFor(pool, "u-bartholo", "journal", () => tries.shift()!);
      expect(got).toBe("quiet-heron-42");
      expect(await resolveCodeName(pool, taken)).toBe("u-ximena");
    });

    it("keeps the map inside: an unknown or malformed code-name resolves to nobody", async () => {
      expect(await resolveCodeName(pool, "quiet-heron-42")).toBeNull();
      expect(await resolveCodeName(pool, "u-ximena")).toBeNull();
    });

    it("DROPS ONLY AFTER AN ERASURE MARKED IT, and a dropped code-name is never minted again", async () => {
      const c = await codeNameFor(pool, "u-odalys", "journal");
      expect(await dropCodeNameOnVendorConfirm(pool, c), "no erasure marked it, so no drop").toBe(false);
      await forgetMemberInOutbox(pool, "u-odalys");
      expect(await resolveCodeName(pool, c), "pending still resolves, so the village can name them to the vendor").toBe("u-odalys");
      expect(await codeNamesPendingVendorDelete(pool)).toBe(1);
      expect(await dropCodeNameOnVendorConfirm(pool, c)).toBe(true);
      expect(await resolveCodeName(pool, c)).toBeNull();
      expect(await codeNamesPendingVendorDelete(pool)).toBe(0);
      // Reserved: the next member offered the same string gets a fresh one.
      const tries = [c, "tidy-lynx-11"];
      expect(await codeNameFor(pool, "u-bartholo", "journal", () => tries.shift()!)).toBe("tidy-lynx-11");
    });
  });

  describe("what a journal entry looks like when it would cross", () => {
    it("CARRIES THE AUTHOR'S CODE-NAME, THE SWAPPED WORDS, THE DATE AND THE KIND, and nothing that names anybody", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      expect(await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ })).toBe("written");
      const p = await payloadOf(entry.id);
      const ximena = await resolveCodeNameOf("u-ximena");
      const bartholo = await resolveCodeNameOf("u-bartholo");
      const odalys = await resolveCodeNameOf("u-odalys");
      expect(p).toMatchObject({ kind: "journal_entry", author: ximena, date: "2026-10-13", practice: "debrief", shared: "internal" });
      expect(p.answers[0].text).toBe(
        `${ximena}'s plan, ${bartholo}'s budget and ${odalys}. Mail ${ximena} or ping ${bartholo} and ${odalys}.`,
      );
      expect(p.answers[0].prompt).toBe(`What happened with ${bartholo}?`);
      expect(p.reflection).toBe(`${odalys} and I agreed.`);
      expect(p.debrief).toEqual({ call: `Sync with ${bartholo}`, seats: [`${ximena}'s seat`], quests: [`Help ${odalys}`] });
      // No id, client id, hour or score field rides along.
      expect(Object.keys(p).sort()).toEqual(
        ["answers", "author", "date", "debrief", "depth", "item", "kind", "practice", "reflection", "shared"].sort(),
      );
    });

    async function resolveCodeNameOf(userId: string) {
      const rows = await q("SELECT `code_name` FROM `member_code_names` WHERE `user_id` = ?", [userId]); // module-review-ok: reading the scratch schema's map to name the expected code-name
      expect(rows).toHaveLength(1);
      return String(rows[0].code_name);
    }

    it("NEVER CARRIES ONE MEMBER'S NUMBERS: a pulse entry's words cross and its scores do not", async () => {
      const entry = await save("u-ximena", {
        clientId: "c-pulse",
        practice: "pulse",
        writtenAt: "2026-10-13T08:00:00Z",
        answers: [{ questionKey: "help-most", prompt: "What would help?", text: "rest" }],
        scores: { energy: -2, load: 5 },
      });
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      const raw = String((await rowBySourceRef(pool, journalSourceRef(entry.id)))!.payload);
      expect(raw).not.toContain("scores");
      expect(raw).not.toContain("energy");
      expect(JSON.parse(raw).answers[0].text).toBe("rest");
    });

    it("withdraws an entry whose words were all taken out, since what is left says only that someone wrote", async () => {
      const entry = await save("u-ximena", { ...NAMED_ENTRY, clientId: "c-words", meta: undefined, reflection: undefined });
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      expect((await rowBySourceRef(pool, journalSourceRef(entry.id)))!.status).toBe("queued");
      await editEntry(pool, "u-ximena", entry.id, { answers: [] });
      expect(await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ })).toBe("no-words");
      const row = (await rowBySourceRef(pool, journalSourceRef(entry.id)))!;
      expect([row.status, row.payload]).toEqual(["held", null]);
    });

    it("FAILS CLOSED when the roster did not load: nothing is queued", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      expect(await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster: async () => [], timeZone: TZ })).toBe(
        "author-unknown",
      );
      expect(await rowBySourceRef(pool, journalSourceRef(entry.id))).toBeNull();
    });
  });

  describe("what never crosses", () => {
    it("A PRIVATE ENTRY IS NEVER QUEUED, by the live path or the backfill", async () => {
      const entry = await save("u-ximena", { ...NAMED_ENTRY, clientId: "c-private", privacy: "private" });
      expect(await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ })).toBe("withdrawn");
      await backfillJournalOutbox(pool, { roster: ROSTER, timeZone: TZ });
      expect(await rowBySourceRef(pool, journalSourceRef(entry.id))).toBeNull();
    });

    it("WITHDRAWS AN ENTRY EDITED TO PRIVATE before it is sent: held, payload cleared, and the backfill leaves it", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      expect((await rowBySourceRef(pool, journalSourceRef(entry.id)))!.status).toBe("queued");

      await editEntry(pool, "u-ximena", entry.id, { privacy: "private" });
      expect(await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ })).toBe("withdrawn");
      const held = (await rowBySourceRef(pool, journalSourceRef(entry.id)))!;
      expect(held.status).toBe("held");
      expect(held.payload).toBeNull();
      expect(Number(held.text_chars)).toBe(0);

      await backfillJournalOutbox(pool, { roster: ROSTER, timeZone: TZ });
      expect((await rowBySourceRef(pool, journalSourceRef(entry.id)))!.payload).toBeNull();
    });

    it("REFUSES A STALE QUEUEING that lands after the entry turned private, in the same statement as the write", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      // The entry turns private, then a queueing that read it earlier lands.
      await editEntry(pool, "u-ximena", entry.id, { privacy: "private" });
      const { upsertJournalItemIfShared } = await import("../repos/saberraOutbox");
      const wrote = await upsertJournalItemIfShared(
        pool,
        { id: "sbo-stale", sourceRef: journalSourceRef(entry.id), codeName: "quiet-heron-42", period: "2026-10-13", payload: "{\"words\":\"x\"}", textChars: 1, sourceVersion: Date.now() },
        entry.id,
        "u-ximena",
      );
      expect(wrote).toBe(0);
      expect(await rowBySourceRef(pool, journalSourceRef(entry.id))).toBeNull();
    });

    it("withdraws a deleted entry too, and a deleted entry is never queued again", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      await forgetEntry(pool, "u-ximena", entry.id, TZ);
      await withdrawJournalEntry(pool, entry.id);
      expect(await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ })).toBe("no-entry");
      const row = (await rowBySourceRef(pool, journalSourceRef(entry.id)))!;
      expect(row.status).toBe("held");
      expect(row.payload).toBeNull();
    });

    it("FEEDBACK NEVER CROSSES: a whole bridge run carries no word of a queued message", async () => {
      await save("u-ximena", NAMED_ENTRY);
      await savePrefs(pool, "u-bartholo", { open: true, style: "gentle", note: "" });
      const sent = await queueFeedback(
        pool,
        "u-ximena",
        { recipientId: "u-bartholo", observation: "zz-observed", feeling: "zz-felt", need: "zz-needed", request: "zz-asked" },
        "zz-the-unsigned-message",
        { timeZone: TZ, recipientName: "Bartholo Vex" },
      );
      expect(sent.ok, "the fixture must queue the feedback, or its absence below proves nothing").toBe(true);
      await runBridgeJob(pool, { roster, timeZone: TZ, now: new Date("2026-10-14T12:00:00Z") });
      const payloads = await allPayloads(pool);
      expect(payloads.length, "the run must have queued something, or the scan below proves nothing").toBeGreaterThan(0);
      for (const { payload } of payloads) expect(payload).not.toMatch(/zz-/);
      const kinds = await q("SELECT DISTINCT `kind` FROM `saberra_outbox`"); // module-review-ok: reading the scratch schema to list what was queued
      expect(kinds.map((k: any) => k.kind)).toEqual(["journal_entry"]);
    });

    it("QUEUES NOTHING while either module is off, and an entry still queues once both are on", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      ctl.lifecycle = { saberra: "off", journal: "public" };
      expect(await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ })).toBe("bridge-closed");
      ctl.lifecycle = { saberra: "public", journal: "off" };
      expect(await runBridgeJob(pool, { roster, timeZone: TZ })).toMatch(/bridge closed/);
      expect(await allPayloads(pool)).toEqual([]);
      ctl.lifecycle = { saberra: "preview", journal: "preview" };
      expect(await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ })).toBe("written");
    });
  });

  describe("every payload, scanned for every member", () => {
    it("HOLDS NO NAME, HANDLE, EMAIL OR ID of any member in anything the outbox would send", async () => {
      await save("u-ximena", NAMED_ENTRY);
      await save("u-bartholo", {
        clientId: "c-b",
        practice: "evening",
        writtenAt: "2026-10-12T20:00:00Z",
        answers: [{ questionKey: "drained", prompt: "What drained you?", text: "XIMENA QUELL and Prynne, then bartholo@example.org." }],
      });
      await save("u-odalys", {
        clientId: "c-o",
        practice: "pulse",
        writtenAt: "2026-10-08T09:00:00Z",
        answers: [{ questionKey: "help-most", prompt: "What would help?", text: "Quell's notes and vex's map" }],
        scores: { energy: 1 },
      });
      await save("u-ximena", { clientId: "c-x2", practice: "pulse", writtenAt: "2026-10-09T09:00:00Z", scores: { energy: -1 } });
      await runBridgeJob(pool, { roster, timeZone: TZ, now: new Date("2026-10-14T12:00:00Z") });

      const payloads = await allPayloads(pool);
      // Three entries with words, and one team signal. The pulse saved as numbers
      // alone has no words, so it is not queued: its numbers cross in the signal.
      expect(payloads.map((p) => p.sourceRef.split(":")[0]).sort()).toEqual([
        "journal_entry",
        "journal_entry",
        "journal_entry",
        "team_signal",
      ]);
      for (const { sourceRef, payload } of payloads) {
        const low = payload.toLowerCase();
        for (const s of IDENTIFYING) {
          expect(low.includes(s.toLowerCase()), `${sourceRef} carries "${s}"`).toBe(false);
        }
      }
    });
  });

  describe("the backfill", () => {
    it("QUEUES THE HISTORY ONCE: entries written before the bridge opened, then nothing on a second run", async () => {
      ctl.lifecycle = { saberra: "off", journal: "public" };
      const a = await save("u-ximena", NAMED_ENTRY);
      const b = await save("u-bartholo", { clientId: "c-b", practice: "free", writtenAt: "2026-10-01T10:00:00Z", answers: [{ questionKey: "free", prompt: "On your mind?", text: "the well" }] });
      await save("u-odalys", { clientId: "c-p", practice: "free", writtenAt: "2026-10-01T10:00:00Z", privacy: "private", answers: [{ questionKey: "free", prompt: "On your mind?", text: "mine alone" }] });
      expect(await backfillJournalOutbox(pool, { roster: ROSTER, timeZone: TZ })).toEqual({ queued: 0, skipped: 0 });

      ctl.lifecycle = { saberra: "public", journal: "public" };
      expect(await backfillJournalOutbox(pool, { roster: ROSTER, timeZone: TZ })).toEqual({ queued: 2, skipped: 0 });
      expect(await backfillJournalOutbox(pool, { roster: ROSTER, timeZone: TZ })).toEqual({ queued: 0, skipped: 2 });
      const refs = await q("SELECT `source_ref` FROM `saberra_outbox` ORDER BY `source_ref`"); // module-review-ok: reading the scratch schema to list what was queued
      expect(refs.map((r: any) => r.source_ref).sort()).toEqual([journalSourceRef(a.id), journalSourceRef(b.id)].sort());
    });

    it("never queues an entry twice: a live queueing and a backfill share one row", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      await backfillJournalOutbox(pool, { roster: ROSTER, timeZone: TZ });
      expect(await q("SELECT COUNT(*) AS n FROM `saberra_outbox`")).toEqual([{ n: 1 }]); // module-review-ok: counting the scratch schema's rows
    });

    it("refreshes the one row when the words change, and keeps the newer words", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      await new Promise((r) => setTimeout(r, 1100));
      await editEntry(pool, "u-ximena", entry.id, { answers: [{ questionKey: "free", prompt: "On your mind?", text: "second thoughts" }] });
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      expect((await payloadOf(entry.id)).answers).toEqual([{ question: "free", prompt: "On your mind?", text: "second thoughts" }]);
    });
  });

  describe("the team signal", () => {
    const NOW = new Date("2026-10-14T12:00:00Z");
    const LAST_WEEK = lastCompletedWeekId(NOW, TZ);

    it("names the week that ended most recently", () => {
      expect(LAST_WEEK).toBe("2026-W41");
    });

    it("SENDS NOTHING FOR A WEEK WITH A SINGLE ANSWER", async () => {
      await save("u-ximena", { clientId: "c-1", practice: "pulse", writtenAt: "2026-10-07T09:00:00Z", scores: { energy: 1, load: 2 } });
      expect(await enqueueTeamSignal(pool, { weekId: LAST_WEEK, timeZone: TZ, now: NOW })).toBe("too-few");
      expect(await rowBySourceRef(pool, teamSignalSourceRef(LAST_WEEK))).toBeNull();
    });

    it("CARRIES ONLY THE METRICS AT LEAST TWO MEMBERS ANSWERED, once per week", async () => {
      await save("u-ximena", { clientId: "c-1", practice: "pulse", writtenAt: "2026-10-07T09:00:00Z", scores: { energy: 2, load: 4 } });
      await save("u-bartholo", { clientId: "c-2", practice: "pulse", writtenAt: "2026-10-08T09:00:00Z", scores: { energy: -1 } });
      expect(await enqueueTeamSignal(pool, { weekId: LAST_WEEK, timeZone: TZ, now: NOW })).toBe("queued");
      const row = (await rowBySourceRef(pool, teamSignalSourceRef(LAST_WEEK)))!;
      expect(row.code_name).toBeNull();
      expect(JSON.parse(String(row.payload))).toMatchObject({
        kind: "team_signal",
        week: LAST_WEEK,
        metrics: [{ metric: "energy", answered: 2, mean: 0.5 }],
      });
      // Load had one answer, so it is not there at all.
      expect(String(row.payload)).not.toContain("load");
      expect(await enqueueTeamSignal(pool, { weekId: LAST_WEEK, timeZone: TZ, now: NOW })).toBe("already");
    });
  });

  describe("the drain, which sends nothing today", () => {
    it("SENDS NOTHING WITH NO TRANSPORT, and every item stays queued", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      const out = await drainOutbox(pool);
      expect(out).toMatchObject({ sent: 0, failed: 0, held: 0 });
      expect(out.note).toMatch(/has not named a write path/);
      expect((await rowBySourceRef(pool, journalSourceRef(entry.id)))!.status).toBe("queued");
    });

    it("RETRIES UNTIL IT LANDS, through a stand-in transport", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      const seen: OutboxSend[] = [];
      let answer: { landed: boolean; detail?: string } = { landed: false, detail: "busy" };
      const t = { send: async (item: OutboxSend) => (seen.push(item), answer) };

      expect(await drainOutbox(pool, t)).toMatchObject({ sent: 0, failed: 1 });
      let row = (await rowBySourceRef(pool, journalSourceRef(entry.id)))!;
      expect([row.status, Number(row.attempts), row.last_error]).toEqual(["failed", 1, "busy"]);

      answer = { landed: true };
      expect(await drainOutbox(pool, t)).toMatchObject({ sent: 1, failed: 0 });
      row = (await rowBySourceRef(pool, journalSourceRef(entry.id)))!;
      expect([row.status, Number(row.attempts)]).toEqual(["sent", 2]);
      expect(seen[1].id).toBe(row.id);
      expect((seen[1].payload as any).item).toBe(row.id);

      expect(await drainOutbox(pool, t)).toMatchObject({ sent: 0, failed: 0 });
      expect(seen).toHaveLength(2);
    });

    it("LOOKS AGAIN BEFORE A SEND, and holds an entry that turned private without a withdrawal", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      // Private, and the withdrawal never ran (it failed, say).
      await editEntry(pool, "u-ximena", entry.id, { privacy: "private" });
      const seen: OutboxSend[] = [];
      expect(await drainOutbox(pool, { send: async (i) => (seen.push(i), { landed: true }) })).toMatchObject({ sent: 0, held: 1 });
      expect(seen).toEqual([]);
      const row = (await rowBySourceRef(pool, journalSourceRef(entry.id)))!;
      expect([row.status, row.payload]).toEqual(["held", null]);
    });
  });

  describe("erasure and the admin's view", () => {
    it("SCRUBS THE MEMBER'S PAYLOADS AND MARKS THEIR CODE-NAME PENDING, leaving everybody else's", async () => {
      const mine = await save("u-ximena", NAMED_ENTRY);
      const theirs = await save("u-bartholo", { clientId: "c-b", practice: "free", writtenAt: "2026-10-01T10:00:00Z", answers: [{ questionKey: "free", prompt: "On your mind?", text: "the well" }] });
      await backfillJournalOutbox(pool, { roster: ROSTER, timeZone: TZ });
      const code = String((await rowBySourceRef(pool, journalSourceRef(mine.id)))!.code_name);

      await forgetMemberInOutbox(pool, "u-ximena");
      await forgetMemberInOutbox(pool, "u-ximena");

      const gone = (await rowBySourceRef(pool, journalSourceRef(mine.id)))!;
      expect([gone.status, gone.payload, Number(gone.text_chars)]).toEqual(["held", null, 0]);
      expect((await rowBySourceRef(pool, journalSourceRef(theirs.id)))!.status).toBe("queued");
      expect(await resolveCodeName(pool, code), "not dropped: no vendor has confirmed").toBe("u-ximena");
      expect((await outboxView(pool)).pendingVendorDelete).toBe(1);
    });

    it("SHOWS AN ADMIN KIND, DATE, CODE-NAME, LENGTH AND STATUS, and never a word of the entry", async () => {
      const entry = await save("u-ximena", NAMED_ENTRY);
      await enqueueJournalEntry(pool, { userId: "u-ximena", entryId: entry.id, roster, timeZone: TZ });
      const view = await outboxView(pool);
      expect(view).toMatchObject({ writePath: false, journalOn: true, counts: { queued: 1, sent: 0, failed: 0, held: 0 } });
      expect(view.items).toHaveLength(1);
      const item = view.items[0];
      expect(Object.keys(item).sort()).toEqual(["attempts", "chars", "codeName", "createdAt", "id", "kind", "period", "status"]);
      expect(item).toMatchObject({ kind: "journal_entry", period: "2026-10-13", status: "queued" });
      expect(looksLikeCodeName(item.codeName)).toBe(true);
      expect(item.chars).toBeGreaterThan(50);
      // THE CODE-NAME IS LEFT OUT OF THE SEARCH, and only it. It is drawn at
      // random from two word lists (server/lib/codeNames.ts) and "upland" holds
      // "plan", so about one run in sixty-four reported a leak that was the
      // code-name and never the entry. Its shape is held above by
      // `looksLikeCodeName`; every other field of the view is still searched.
      const wire = JSON.stringify({ ...view, items: view.items.map((i: typeof item) => ({ ...i, codeName: "" })) });
      for (const word of ["plan", "budget", "agreed", "Sync with", "seat", "What happened"]) {
        expect(wire.includes(word), `the admin view carries "${word}"`).toBe(false);
      }
    });
  });
});
