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
import { CONFLICT_AGREEMENT_KEY } from "../../shared/conflictAgreement";
import { writeConfigDocument } from "../repos/appConfigDocs";
import { recordCanvasReading } from "../repos/canvasReadings";
import { writeDecisionMatrixRow } from "../repos/decisionMatrixRows";
import {
  blocksNamedIn,
  canvasLibrary,
  LEGAL_FRAMING,
  looksLikeCanvasQuestion,
  recordAnswer,
  RECORD_REASON_SENTENCE,
  RECORD_SCOPE_SENTENCE,
  type CanvasAnswersRead,
  type CanvasBlockRecord,
} from "./companionCanvas";
import { conflictAgreementWrite } from "./conflictAgreement";
import { DEFAULT_EXIT_POLICY } from "./exitPolicy";
import { loadShelves } from "./knowledge";
import { briefAll, briefWrite } from "./villageBrain";
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
  legal: "LEGAL-WORDS: a cooperative holds the deed and the trust holds the land.",
  canvasAdopted: "CANVAS-ADOPTED: the treasury circle spends up to the float without asking.",
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

/**
 * SECOND REVIEW, 2026-10-01: most adopted answers are ones a member may not
 * read, and the record used to tell them, and stewards, that nothing was
 * adopted. A block now says where each closed section stands, the way the
 * canvas's Say frame does, and only an asker who can see every section is
 * told a block has no adopted answer.
 */
describe("a section the asker cannot read is never called unadopted", () => {
  const block = (over: Partial<CanvasBlockRecord> & Pick<CanvasBlockRecord, "block" | "name">): CanvasBlockRecord => ({ answers: [], others: [], reading: null, ...over });
  const focused = (b: CanvasBlockRecord) => recordAnswer({ why: "no-key", canvas: { focus: [b.block], blocks: [b] }, library: null }).reply;

  it("tells a member the Legal sections are kept with the administrators, and never that Legal has no answer", () => {
    const reply = focused(
      block({
        block: "legal",
        name: "Legal",
        others: [
          { section: "legal", title: "What exists on paper", state: "admin-only" },
          { section: "land", title: "The land and what is on it", state: "admin-only" },
        ],
      }),
    );
    expect(reply).toContain('For Legal, "What exists on paper" is kept with the administrators, so the guide cannot read it to you.');
    expect(reply).toContain('For Legal, "The land and what is on it" is kept with the administrators, so the guide cannot read it to you.');
    expect(reply).not.toContain("has not adopted");
  });

  it("tells a member a written section that is not opened to them so", () => {
    const reply = focused(block({ block: "power", name: "Power", others: [{ section: "decisions", title: "Who decides what", state: "not-shared" }] }));
    expect(reply).toContain('For Power, "Who decides what" is written, and not opened to members, so the guide cannot read it to you.');
    expect(reply).not.toContain("has not adopted");
  });

  it("tells an administrator that a section is adopted when its words stay with them", () => {
    const reply = focused(block({ block: "legal", name: "Legal", others: [{ section: "legal", title: "What exists on paper", state: "adopted-kept" }, { section: "land", title: "The land and what is on it", state: "blank" }] }));
    expect(reply).toContain('For Legal, "What exists on paper" is adopted, and its words stay with the administrators.');
    expect(reply).toContain('For Legal, nothing is written under "The land and what is on it" yet.');
    expect(reply).not.toContain("has not adopted");
  });

  it("still says a block has no adopted answer when the asker sees every section and none is", () => {
    const reply = focused(block({ block: "power", name: "Power", others: [{ section: "decisions", title: "Who decides what", state: "blank" }] }));
    expect(reply).toContain("The village has not adopted an answer for Power yet.");
  });

  it("reads the conflict agreement's adoption, and drops the note that says it is not written", () => {
    const note = "until the conflict agreement is written";
    const adopted = focused(block({ block: "conflict", name: "Conflict", agreement: { adopted: true, on: "2026-09-28" } }));
    expect(adopted).toContain("The village adopted its conflict agreement on 2026-09-28. Read it on How we work together (/governance).");
    expect(adopted).not.toContain("has not adopted");
    expect(adopted).not.toContain(note);
    const draft = focused(block({ block: "conflict", name: "Conflict", agreement: { adopted: false, on: null } }));
    expect(draft).toContain("The village's conflict agreement is written, and nobody has adopted it yet.");
    expect(draft).not.toContain(note);
    // With none stored, the old sentence and note are still the truth.
    const none = focused(block({ block: "conflict", name: "Conflict", agreement: null }));
    expect(none).toContain("The village has not adopted an answer for Conflict yet.");
    expect(none).toContain(note);
  });

  it("keeps a closed block out of 'Nothing is on record' in the overview, and names it as kept", () => {
    const a = recordAnswer({
      why: "lookup",
      canvas: {
        focus: [],
        blocks: [
          block({ block: "legal", name: "Legal", others: [{ section: "legal", title: "What exists on paper", state: "admin-only" }] }),
          block({ block: "team", name: "Team", others: [{ section: "membership", title: "How someone becomes one of you", state: "draft" }] }),
          block({ block: "conflict", name: "Conflict", agreement: { adopted: true, on: "2026-09-28" } }),
          block({ block: "roles", name: "Roles", others: [{ section: "work", title: "What has to happen here", state: "blank" }] }),
        ],
      },
      library: null,
    });
    expect(a.reply).toContain("The village has adopted an answer for Conflict.");
    expect(a.reply).toContain("Kept with the administrators, so the guide cannot read them to you: Legal.");
    expect(a.reply).toContain("Drafts nobody has adopted yet: Team.");
    expect(a.reply).toContain("Nothing is on record yet for Roles.");
    expect(a.reply).not.toMatch(/Nothing is on record yet for [^\n]*(Legal|Team|Conflict)/);
    expect(a.reply).not.toMatch(/\d+\s+(of|blocks?)\b/);
  });
});

/** SECOND REVIEW, 2026-10-01: the legal shelf reached members with its framing cut off mid-word. */
describe("the legal shelf carries its framing", () => {
  beforeAll(() => {
    loadShelves(process.cwd());
  });

  it("says the framing first, before the shelf, and never cuts an excerpt inside a word", async () => {
    for (const q of [
      "Legal: should we set up a 508 church to avoid taxes?",
      // Not asked from the Legal block: the shelf hit alone carries the framing.
      "is a 508(c)(1)(A) church legitimate for us?",
      "Legal: what legal structure should we pick?",
    ]) {
      const lib = await canvasLibrary(null as unknown as Pool, q);
      expect(lib.shelf.length, q).toBeGreaterThan(0);
      expect(lib.framing, q).toBe(LEGAL_FRAMING);
      const lines = recordAnswer({ why: "no-key", canvas: null, library: lib }).reply.split("\n");
      expect(lines.indexOf(LEGAL_FRAMING), q).toBeGreaterThan(-1);
      expect(lines.indexOf(LEGAL_FRAMING), q).toBeLessThan(lines.indexOf("From the platform's own governance shelf:"));
      for (const s of lib.shelf) expect(s.excerpt, `${q}: ${s.citation}`).not.toMatch(/\w\.\.\.$/);
    }
  });

  it("adds no framing where no legal shelf is touched", async () => {
    const lib = await canvasLibrary(null as unknown as Pool, "how do we run a consent round in our circle?");
    expect(lib.framing).toBeUndefined();
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
      // Confirmed, and one of the four sections kept with the admins.
      ["b-legal", "legal", "What exists on paper", WORDS.legal, "admin", "confirmed"],
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
      expect(text, "an admin-only section, confirmed").not.toContain("LEGAL-WORDS");
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

  it("says where each closed section stands by the Say frame's rule: a member is told it is closed, an admin its state", async () => {
    const read = async (who: ReaderViewer, query: string) => {
      const got = await callReader("canvas.answers", { pool, viewer: who, query });
      if (!got.ok) throw new Error(got.error);
      return got.data as CanvasAnswersRead;
    };
    // Power: `decisions` is confirmed at the admin audience.
    expect((await read(viewer(), "Power: who decides?")).blocks[0].others).toEqual([{ section: "decisions", title: "Who decides what", state: "not-shared" }]);
    expect((await read(admin, "Power: who decides?")).blocks[0].others).toEqual([{ section: "decisions", title: "Who decides what", state: "adopted-kept" }]);
    // Legal: a member is never told whether it is adopted; an admin is.
    expect((await read(viewer(), "Legal: what did we answer?")).blocks[0].others).toEqual([
      { section: "legal", title: "What exists on paper", state: "admin-only" },
      { section: "land", title: "The land and what is on it", state: "admin-only" },
    ]);
    expect((await read(admin, "Legal: what did we answer?")).blocks[0].others).toEqual([
      { section: "legal", title: "What exists on paper", state: "adopted-kept" },
      { section: "land", title: "The land and what is on it", state: "blank" },
    ]);
    // Team: a proposed member-audience row is a draft; `people` is the admins' whatever its audience says.
    expect((await read(viewer(), "Team: how do people join?")).blocks[0].others).toEqual([
      { section: "membership", title: "How someone becomes one of you", state: "draft" },
      { section: "people", title: "Who is already carrying this", state: "admin-only" },
    ]);
    // And what the member hears for Legal is true, and holds no words.
    const legal = recordAnswer({ why: "no-key", canvas: await read(viewer(), "Legal: what did we answer?"), library: null }).reply;
    expect(legal).not.toContain("has not adopted");
    expect(legal).not.toContain("LEGAL-WORDS");
    expect(legal).toContain("kept with the administrators");
  });

  it("an answer adopted on the canvas keeps its section's admin audience, and the member is told it is written, never that it is not adopted", async () => {
    // The exact write canvas adoption makes (server/routes/canvasFrames.ts): no audience passed.
    const row = await briefWrite(pool, { section: "economy", body: WORDS.canvasAdopted, source: "admin", confirmedBy: "u-admin" });
    // The control is real: the row is confirmed and at the admin audience.
    expect(row).toMatchObject({ section: "economy", status: "confirmed", audience: "admin" });
    const got = await callReader("canvas.answers", { pool, viewer: viewer(), query: "Resourcing: where does our money come from?" });
    const data = (got.ok ? got.data : null) as CanvasAnswersRead;
    expect(data.blocks[0].answers).toEqual([]);
    expect(data.blocks[0].others).toEqual([{ section: "economy", title: "How value moves", state: "not-shared" }]);
    const reply = recordAnswer({ why: "no-key", canvas: data, library: null }).reply;
    expect(reply).toContain('For Resourcing, "How value moves" is written, and not opened to members, so the guide cannot read it to you.');
    expect(reply).not.toContain("has not adopted");
    expect(reply).not.toContain("CANVAS-ADOPTED");
  });

  it("reads the conflict agreement's own adoption stamp for the Conflict block", async () => {
    const before = await callReader("canvas.answers", { pool, viewer: viewer(), query: "Conflict: who helps?" });
    expect((before.ok ? (before.data as CanvasAnswersRead) : null)?.blocks[0].agreement).toBeNull();
    const w = conflictAgreementWrite(
      {
        adopt: true,
        agreement: {
          steps: [
            { what: "We talk it out", whoInRoom: "the two of us" },
            { what: "We bring it to the care holder", whoInRoom: "the two of us and the care holder" },
          ],
          careRole: "care",
          coverRole: "cover",
          replyHours: 48,
          outsideContacts: [{ id: "oc-1", name: "Ada Quill", organisation: "Cohort Care", role: "Ombuds", howToReach: "ada@example.invalid" }],
          whenPowerInvolved: { roleId: "stewards", outsideContactId: "", words: "" },
          safetyContacts: [{ name: "Crisis line", howToReach: "0800 000 000", when: "" }],
          consequencesLadder: { rungs: [{ rung: 1, words: "We ask for a change." }], appeal: "" },
          practices: [],
          reviewDate: "2027-01-15",
        },
      },
      { storedRaw: null, roleIds: ["care", "cover", "stewards"], platformSteps: DEFAULT_EXIT_POLICY.restorative.steps, actorId: "u-admin", now: new Date("2026-09-28T12:00:00.000Z"), gameStarted: false },
    );
    if (!w.ok) throw new Error(w.error);
    await writeConfigDocument(pool, CONFLICT_AGREEMENT_KEY, w.doc as unknown as Record<string, unknown>);
    const got = await callReader("canvas.answers", { pool, viewer: viewer(), query: "Conflict: who helps?" });
    const data = (got.ok ? got.data : null) as CanvasAnswersRead;
    expect(data.blocks[0].agreement).toEqual({ adopted: true, on: "2026-09-28" });
    const reply = recordAnswer({ why: "no-key", canvas: data, library: null }).reply;
    expect(reply).toContain("The village adopted its conflict agreement on 2026-09-28.");
    expect(reply).not.toContain("has not adopted");
    expect(reply).not.toContain("until the conflict agreement is written");
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
