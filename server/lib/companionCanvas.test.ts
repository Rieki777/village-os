/**
 * THE COMPANION'S CANVAS READERS, against a real database (Wave 4, plan 5.4).
 *
 * The promise under test: whoever asks, the canvas readers hand the model the
 * village's MEMBER-audience words and nothing else. The control is an
 * admin-audience row that the brief itself holds, confirmed, on a section a
 * block draws on: it must never come back, even to an admin, and the test
 * first proves the row is really there, so an empty answer cannot pass it.
 *
 * Also held: a section kept for the admins whatever its audience says
 * (`people`), a proposed row (the guide's guess, not the village's word), the
 * recorder's name on a reading, and who last wrote a matrix row. And the door:
 * a signed-in account the village has not admitted is refused by name.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { recordCanvasReading } from "../repos/canvasReadings";
import { writeDecisionMatrixRow } from "../repos/decisionMatrixRows";
import {
  blocksNamedIn,
  canvasLibrary,
  looksLikeCanvasQuestion,
  recordAnswer,
  RECORD_REASON_SENTENCE,
  RECORD_SCOPE_SENTENCE,
  type CanvasAnswersRead,
} from "./companionCanvas";
import { briefAll } from "./villageBrain";
import { callReader, wireReaders, type ReaderViewer } from "./villageReaders";

const configured = testDbConfigured();
if (!configured) console.warn("[companionCanvas] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

const viewer = (over: Partial<ReaderViewer> = {}): ReaderViewer => ({ id: "u-member", isAdmin: false, holds: () => true, admitted: true, ...over });
const admin = viewer({ id: "u-admin", isAdmin: true, admitted: false });

/** The words each fixture row carries, so an assertion names what it looks for. */
const WORDS = {
  memberAims: "We grow food together and share the harvest with the valley.",
  memberRhythm: "We meet in a Saturday circle and write each decision down the same day.",
  adminDecisions: "ADMIN-ONLY: the two founders decide spending between circles.",
  peopleNames: "PEOPLE-NAMES: Ada keeps the keys and Bo keeps the books.",
  proposedGuess: "PROPOSED-GUESS: members probably join after a season.",
};

describe("which blocks a question names", () => {
  it("finds a block by its name or its singular, and a word that merely contains one is not it", () => {
    expect(blocksNamedIn("what did we answer for Power?")).toEqual(["power"]);
    expect(blocksNamedIn("how does our weekly meeting work")).toEqual(["meetings"]);
    expect(blocksNamedIn("who should we empower")).toEqual([]);
    // More than two names is a question about the whole canvas.
    expect(blocksNamedIn("roles, power and conflict")).toEqual([]);
  });

  it("tells a canvas question from another one", () => {
    expect(looksLikeCanvasQuestion("what is still blank on the canvas")).toBe(true);
    expect(looksLikeCanvasQuestion("how is Conflict going")).toBe(true);
    expect(looksLikeCanvasQuestion("should I go to the kitchen crew gathering")).toBe(false);
  });
});

describe("the answer from the record, with no model", () => {
  const canvas: CanvasAnswersRead = {
    focus: ["power"],
    blocks: [
      {
        block: "power",
        name: "Power",
        answers: [{ section: "decisions", title: "Decisions", words: "We decide by consent." }],
        reading: { word: "Forming", sentence: "Two people decide most things.", moment: "Baseline", on: "2026-10-03" },
      },
    ],
  };

  it("says why it came from the record, then our answer, our last reading and the shelf", () => {
    const a = recordAnswer({ why: "no-key", canvas, library: { resources: [], shelf: [{ citation: "Sociocracy > Consent", excerpt: "Consent asks for no reasoned objection." }] } });
    const lines = a.reply.split("\n");
    expect(lines[0]).toBe(RECORD_REASON_SENTENCE["no-key"]);
    expect(a.reply).toContain('Our answer for Power, from Decisions: "We decide by consent."');
    expect(a.reply).toContain('Our last reading of Power: Forming, "Two people decide most things." (Baseline, 2026-10-03).');
    expect(a.reply).toContain("Sociocracy > Consent: Consent asks for no reasoned objection.");
    expect(a.consulted).toEqual({ ownRecord: [], references: ["Sociocracy > Consent"], readers: ["canvas.answers", "canvas.library"] });
  });

  it("names blocks and never counts them in the overview", () => {
    const a = recordAnswer({
      why: "lookup",
      canvas: {
        focus: [],
        blocks: [
          { block: "purpose", name: "Purpose", answers: [{ section: "aims", title: "Aims", words: "x" }], reading: null },
          { block: "team", name: "Team", answers: [], reading: { word: "Absent", sentence: "s", moment: "Baseline", on: "2026-10-03" } },
          { block: "roles", name: "Roles", answers: [], reading: null },
        ],
      },
      library: null,
    });
    expect(a.reply).toContain("The village has adopted an answer for Purpose.");
    expect(a.reply).toContain("Its latest readings: Team (Absent).");
    expect(a.reply).toContain("Nothing is on record yet for Roles.");
    expect(a.reply).not.toMatch(/\d+\s+(of|blocks?)\b/);
  });

  it("says what the record can answer when the question is about something else", () => {
    const a = recordAnswer({ why: "no-key", canvas: null, library: null });
    expect(a.reply).toBe(`${RECORD_REASON_SENTENCE["no-key"]}\n${RECORD_SCOPE_SENTENCE}`);
  });

  it("puts what a live reader said first, and then needs no scope sentence", () => {
    const live = { reply: "This week: Kitchen crew, Tuesday 18:00.", consulted: { ownRecord: [], references: [], readers: ["events.week"] } };
    const a = recordAnswer({ why: "no-consent", canvas: null, library: null, live: [live] });
    expect(a.reply).toBe(`${RECORD_REASON_SENTENCE["no-consent"]}\n${live.reply}`);
    expect(a.consulted.readers).toEqual(["events.week"]);
  });
});

describe.skipIf(!configured)("the canvas readers against the database", () => {
  let db: TestDb;
  let pool: Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    wireReaders({ moduleIsOn: () => false, boolVar: () => false });
    const brief = [
      ["b-aims", "aims", "Aims", WORDS.memberAims, "member", "confirmed"],
      ["b-rhythm", "rhythm", "Rhythm", WORDS.memberRhythm, "member", "confirmed"],
      // THE CONTROL: confirmed, on the section the Power block draws on, at the admin audience.
      ["b-decisions", "decisions", "Decisions", WORDS.adminDecisions, "admin", "confirmed"],
      // Kept for the admins whatever its audience says.
      ["b-people", "people", "People", WORDS.peopleNames, "member", "confirmed"],
      // The guide's guess, not the village's word.
      ["b-membership", "membership", "Membership", WORDS.proposedGuess, "member", "proposed"],
    ];
    for (const row of brief) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO village_brief (id, section, title, body, audience, source, status) VALUES (?,?,?,?,?,'admin',?)",
        row,
      );
    }
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO users (id, name, email, password_hash, role) VALUES ('u-rec', 'Wren Halloway', 'u-rec@example.invalid', 'x', 'member')",
    );
    await recordCanvasReading(pool, { blockId: "power", level: 2, sentence: "Two people decide most things and the rest of us hear later.", moment: "baseline", recordedBy: "u-rec" });
    await writeDecisionMatrixRow(
      pool,
      { subject: "Spending over the circle's float", approval: "The treasury circle", consultation: "Every circle lead", information: "The whole village", method: "Consent", riskTags: ["money"] },
      "u-rec",
    );
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("the control row is really in the brief, confirmed and at the admin audience", async () => {
    const rows = await briefAll(pool, "admin");
    expect(rows.find((r) => r.section === "decisions")).toMatchObject({ audience: "admin", status: "confirmed", body: WORDS.adminDecisions });
  });

  it("canvas.answers hands even an admin the members' words and nothing else", async () => {
    for (const who of [admin, viewer()]) {
      const got = await callReader("canvas.answers", { pool, viewer: who });
      expect(got.ok).toBe(true);
      const text = JSON.stringify(got.ok ? got.data : null);
      expect(text).toContain(WORDS.memberAims);
      expect(text).toContain(WORDS.memberRhythm);
      expect(text, "an admin-audience row").not.toContain("ADMIN-ONLY");
      expect(text, "a section kept for the admins").not.toContain("PEOPLE-NAMES");
      expect(text, "a proposed row").not.toContain("PROPOSED-GUESS");
      expect(text, "the recorder's name").not.toContain("Wren");
      expect(text).toContain("Forming");
    }
  });

  it("reads the block a question names, whole, and only that block", async () => {
    const got = await callReader("canvas.answers", { pool, viewer: viewer(), query: "Power: who decides here?" });
    const data = (got.ok ? got.data : null) as CanvasAnswersRead;
    expect(data.focus).toEqual(["power"]);
    expect(data.blocks.map((b) => b.block)).toEqual(["power"]);
    // Power draws on `decisions`, whose only row is the admin-audience control.
    expect(data.blocks[0].answers).toEqual([]);
    expect(data.blocks[0].reading).toEqual({ word: "Forming", sentence: "Two people decide most things and the rest of us hear later.", moment: "Baseline", on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("refuses a signed-in account the village has not admitted, by name, on the canvas and the matrix", async () => {
    for (const key of ["canvas.answers", "matrix.rows"]) {
      const got = await callReader(key, { pool, viewer: viewer({ id: "u-stranger", admitted: false }) });
      expect(got).toEqual({ ok: false, error: `${key} is for the village's admitted members` });
    }
    // The library is counsel and public metadata, so any member reads it.
    expect((await callReader("canvas.library", { pool, viewer: viewer({ admitted: false }), query: "consent" })).ok).toBe(true);
  });

  it("matrix.rows reads the village's rows and never who last wrote them", async () => {
    const got = await callReader("matrix.rows", { pool, viewer: viewer() });
    expect(got.ok && got.data).toEqual([
      { subject: "Spending over the circle's float", approval: "The treasury circle", consultation: "Every circle lead", information: "The whole village", method: "Consent", riskTags: ["money"] },
    ]);
  });

  it("canvas.library holds no Canvas Resources until the resources lane lands, and reads nothing for no question", async () => {
    expect(await canvasLibrary(pool, "")).toEqual({ resources: [], shelf: [] });
    expect((await canvasLibrary(pool, "how do we decide by consent")).resources).toEqual([]);
  });
});
