/**
 * A quest proposal cannot become a live quest without a human typing a reward
 * (0141).
 *
 * THE FIRST TEST IN THIS FILE IS THE LOAD-BEARING ONE and it is not about a
 * refusal at all. It reads the SCHEMA. The five columns a machine must never
 * write are absent from `quest_proposals` rather than present and guarded, so
 * there is no write to refuse and no future route that can forget to refuse
 * it. A guard can be removed by somebody who does not know why it is there; a
 * column that does not exist cannot be written by accident.
 *
 * The rest prove the other half: a quest reaches the board only through
 * `questsRepo.add`, with what a person typed on it.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { parseRewardRange } from "../../shared/questRewards";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { questsRepo as makeQuestsRepo } from "../repos/quests";
import type { NotifyInput } from "./notify";
import {
  acceptQuestProposal,
  proposeQuest,
  questBatchCap,
  questProposalQueue,
  rejectQuestProposal,
  rewardProblem,
} from "./questProposals";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let quests: ReturnType<typeof makeQuestsRepo>;

const propose = (over: Record<string, unknown> = {}) => ({
  villageId: "v1",
  moduleId: "saberra",
  batchId: "b1",
  prose: { title: "Clear the north swale", description: "Two hours with a mattock." },
  batchCap: 10,
  ...over,
});

describe.skipIf(!configured)("a proposed quest and the reward a human types", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    quests = makeQuestsRepo(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM quest_proposals"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM quests"); // module-review-ok: same
  });

  // ── THE STRUCTURAL HALF ──────────────────────────────────────────────────

  it("has no column a machine could set a reward or a gate in", async () => {
    const [cols] = await pool.query<any[]>( // module-review-ok: reading the scratch schema this suite provisioned
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS " +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quest_proposals'",
    );
    const names = new Set(cols.map((r) => String(r.c)));
    for (const forbidden of [
      "gratitude",
      "gratitude_min",
      "gratitude_max",
      "stay_credit_reward",
      "min_stage",
      "requires_role",
    ]) {
      expect(names.has(forbidden), `quest_proposals must not carry ${forbidden}`).toBe(false);
    }
    // And the prose layer IS there, so the absence above is a line drawn on
    // purpose and not a table that was never finished.
    for (const allowed of ["title", "description", "story", "steps", "tips", "role_required"]) {
      expect(names.has(allowed), `quest_proposals should carry ${allowed}`).toBe(true);
    }
  });

  // ── THE REFUSAL ──────────────────────────────────────────────────────────

  it("refuses to put a quest on the board with no reward typed", async () => {
    const p = await proposeQuest(pool, propose());
    expect(p.ok).toBe(true);

    const r = await acceptQuestProposal(pool, quests, {
      id: p.ok ? p.id : "",
      decidedBy: "u1",
      reward: { valueMinor: null, valueCurrency: "CRC" },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Nobody else can set that");
    expect(await quests.all()).toHaveLength(0);
    // The proposal is untouched and still waiting, so a refusal never loses it.
    expect(await questProposalQueue(pool)).toHaveLength(1);
  });

  it("refuses a quest with no value, and a value nobody meant", async () => {
    // Every quest carries a value from the moment it is created (0265, Rye
    // 2026-10-21). The value replaced the Gratitude label this used to read.
    expect(rewardProblem({ valueMinor: null, valueCurrency: "CRC" })).toContain("Nobody else can set that");
    expect(rewardProblem({ valueMinor: 2.5, valueCurrency: "CRC" })).toContain("whole number");
    expect(rewardProblem({ valueMinor: -1, valueCurrency: "CRC" })).toContain("whole number");
    expect(rewardProblem({ valueMinor: 2500000, valueCurrency: "CRC" })).toBeNull();
    expect(rewardProblem({ valueMinor: 500, valueCurrency: "CRC", stayCreditReward: -2 })).toContain("whole number");
    // A deliberate zero is allowed. Zero means zero, and a quest may pay stay
    // credits alone.
    expect(rewardProblem({ valueMinor: 0, valueCurrency: "CRC", stayCreditReward: 2 })).toBeNull();
  });

  it("reads a label naming no number as invalid, which it did not always", () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and the flip is the point of it.
    // `parseRewardRange` documented itself as returning valid:false for
    // anything unparseable and returned valid TRUE with zeros for a label with
    // no digits: the label stripped to "", Number("") is 0, and 0 is finite.
    // So "some hearts" was a valid reward of nothing. It was pinned here as a
    // tripwire, with a note saying whoever fixed the parser would see it go
    // red. That happened, the parser is fixed, and the redundant digit guard
    // this file used to carry in `rewardProblem` has come out with it.
    const parsed = parseRewardRange("some hearts");
    expect(parsed.valid).toBe(false);
    expect(parsed.max).toBe(0);
  });

  // ── THE ACCEPT ───────────────────────────────────────────────────────────

  it("creates the quest through the repository, carrying what the person typed", async () => {
    const p = await proposeQuest(pool, propose());
    const r = await acceptQuestProposal(pool, quests, {
      id: p.ok ? p.id : "",
      decidedBy: "u1",
      reward: { valueMinor: 2500000, valueCurrency: "CRC", valueTokens: [{ token: "credits", amount: 40 }], stayCreditReward: 2, minStage: "contributor", requiresRole: null },
    });
    expect(r.ok).toBe(true);

    const [q] = await quests.all();
    expect(q.title).toBe("Clear the north swale");
    // The value and its list, and no Gratitude label: no quest pays it.
    expect(q.valueMinor).toBe(2500000);
    expect(q.valueCurrency).toBe("CRC");
    expect(q.valueTokens).toEqual([{ token: "credits", amount: 40 }]);
    expect(q.gratitude).toBe("");
    expect(q.stayCreditReward).toBe(2);
    expect(q.minStage).toBe("contributor");
    expect(q.status).toBe("Open");
    expect(q.isExample).toBe(false);
  });

  it("writes the steward's edits and not the version that arrived", async () => {
    // Editing before accepting is the only path by which a proposal naming a
    // person can be redacted before it lands, so the edited text is what
    // reaches the board AND what is kept on the proposal row.
    const p = await proposeQuest(pool, propose());
    const r = await acceptQuestProposal(pool, quests, {
      id: p.ok ? p.id : "",
      decidedBy: "u1",
      reward: { valueMinor: 5000, valueCurrency: "CRC" },
      edits: { title: "Clear the north swale, with Ada", description: "Redacted by a steward." },
    });
    expect(r.ok).toBe(true);
    expect((await quests.all())[0].description).toBe("Redacted by a steward.");

    const [[stored]] = await pool.query<any[]>( // module-review-ok: same
      "SELECT description, status, created_ref FROM quest_proposals WHERE id = ?",
      [p.ok ? p.id : ""],
    );
    expect(stored.description).toBe("Redacted by a steward.");
    expect(stored.status).toBe("accepted");
    expect(stored.created_ref).toBe(r.ok ? r.questId : "");
  });

  it("refuses an accept that still carries an email address", async () => {
    const p = await proposeQuest(pool, propose());
    const r = await acceptQuestProposal(pool, quests, {
      id: p.ok ? p.id : "",
      decidedBy: "u1",
      reward: { valueMinor: 5000, valueCurrency: "CRC" },
      edits: { description: "ask ada@example.org" },
    });
    expect(r.ok).toBe(false);
    expect(await quests.all()).toHaveLength(0);
  });

  it("decides once: a second accept on the same proposal refuses", async () => {
    const p = await proposeQuest(pool, propose());
    const id = p.ok ? p.id : "";
    expect((await acceptQuestProposal(pool, quests, { id, decidedBy: "u1", reward: { valueMinor: 5000, valueCurrency: "CRC" } })).ok).toBe(true);
    const again = await acceptQuestProposal(pool, quests, { id, decidedBy: "u1", reward: { valueMinor: 999900, valueCurrency: "CRC" } });
    expect(again.ok).toBe(false);
    expect(!again.ok && again.status).toBe(409);
    expect(await quests.all()).toHaveLength(1);
  });

  // ── THE VOLUME CAP ───────────────────────────────────────────────────────

  it("caps how many quests one batch may propose, and says so", async () => {
    // Seeding aspirational structure is on the platform's never-build list,
    // and a meeting extractor emitting quests per meeting is that machine.
    expect(questBatchCap(0)).toBe(3);
    expect(questBatchCap(12)).toBe(12);

    for (let i = 0; i < 3; i += 1) {
      const r = await proposeQuest(pool, propose({ batchCap: 3, prose: { title: `Quest ${i}` } }));
      expect(r.ok).toBe(true);
    }
    const over = await proposeQuest(pool, propose({ batchCap: 3, prose: { title: "One too many" } }));
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error).toContain("cap of 3");
    expect(await questProposalQueue(pool)).toHaveLength(3);
  });

  it("is a no-op on a redelivery of the same proposed quest", async () => {
    const first = await proposeQuest(pool, propose());
    const again = await proposeQuest(pool, propose());
    expect(again.ok && again.outcome).toBe("duplicate");
    expect(again.ok && again.id).toBe(first.ok ? first.id : "");
    expect(await questProposalQueue(pool)).toHaveLength(1);
  });

  it("clips over-long prose instead of losing the proposal", async () => {
    // Same class as the external proposal inbox: strict MySQL refuses an
    // over-long string, so an unclipped vendor field is a lost record.
    const r = await proposeQuest(pool, propose({
      prose: {
        title: "T".repeat(400),
        subtitle: "S".repeat(900),
        duration: "D".repeat(300),
        circle: "C".repeat(400),
        description: "x".repeat(20_000),
      },
    }));
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    // Clipped to the width on `quests`, which is NARROWER than the one on
    // `quest_proposals` for four of these. Clipping to the table in front of
    // you lands the proposal and then throws at accept, which is the worst
    // place for it to happen. This test caught exactly that.
    const [row] = await questProposalQueue(pool);
    expect(row.prose.title.length).toBe(200);
    expect(row.prose.subtitle!.length).toBe(160);
    expect(row.prose.duration!.length).toBe(64);
    expect(row.prose.circle!.length).toBe(64);
  });

  it("clips again at ACCEPT, because a steward's edit never passes propose", async () => {
    const p = await proposeQuest(pool, propose());
    const r = await acceptQuestProposal(pool, quests, {
      id: p.ok ? p.id : "",
      decidedBy: "u1",
      reward: { valueMinor: 5000, valueCurrency: "CRC" },
      edits: { subtitle: "S".repeat(900), circle: "C".repeat(400) },
    });
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    const [q] = await quests.all();
    expect(q.subtitle!.length).toBe(160);
    expect(q.circle!.length).toBe(64);
  });

  it("REFUSES an over-long identifier rather than merging two batches", async () => {
    const r = await proposeQuest(pool, propose({ batchId: "b".repeat(70) }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("longer than 64 characters");
    expect(await questProposalQueue(pool)).toHaveLength(0);
  });

  it("drops a proposal carrying an email address before it is stored", async () => {
    const r = await proposeQuest(pool, propose({ prose: { title: "Ask ada@example.org about the swale" } }));
    expect(r.ok).toBe(false);
    expect(await questProposalQueue(pool)).toHaveLength(0);
  });

  // ── THE PERSON WHO PROPOSED IT HEARS THE ANSWER ──────────────────────────
  //
  // Both decisions used to tell nobody. These hand the decision a stub in
  // place of the spine and read what it was given.

  /** A stand-in for the notify spine that keeps what it was handed. */
  const spine = () => {
    const notices: NotifyInput[] = [];
    const notify = async (n: NotifyInput) => {
      notices.push(n);
      return { fresh: true };
    };
    return { notices, notify };
  };

  /** An idea a signed-in member sent through the Propose a Quest form. */
  const fromAda = (title = "Clear the north swale") =>
    propose({ moduleId: "propose-quest", proposedBy: "u-ada", proposedByKind: "human", prose: { title, description: "Two hours with a mattock." } });

  it("tells the member their idea is on the board, linked to the quest, with none of the idea's words", async () => {
    const { notices, notify } = spine();
    const p = await proposeQuest(pool, fromAda());
    const r = await acceptQuestProposal(pool, quests, { id: p.ok ? p.id : "", decidedBy: "u-steward", reward: { valueMinor: 5000, valueCurrency: "CRC" } }, notify);
    expect(r.ok).toBe(true);
    expect(notices).toEqual([
      {
        userId: "u-ada",
        type: "quest_idea_on_board",
        title: "Your quest idea is on the board",
        link: `/quests/${r.ok ? r.questId : ""}`,
        dedupeKey: `quest-idea:${p.ok ? p.id : ""}:on_board`,
      },
    ]);
    expect(JSON.stringify(notices)).not.toContain("swale");
  });

  it("tells the member the no, carrying the steward's reason and no other free text", async () => {
    const { notices, notify } = spine();
    const p = await proposeQuest(pool, fromAda());
    const id = p.ok ? p.id : "";
    expect(await rejectQuestProposal(pool, { id, decidedBy: "u-steward", note: "  The swale is already cleared this season.  " }, notify)).toBe(true);
    expect(notices).toEqual([
      {
        userId: "u-ada",
        type: "quest_idea_declined",
        title: "A steward said no to your quest idea",
        body: "The swale is already cleared this season.",
        link: "/propose-quest",
        dedupeKey: `quest-idea:${id}:declined`,
      },
    ]);
  });

  it("sends the no with no body when the steward typed no reason, and tells nobody twice", async () => {
    const { notices, notify } = spine();
    const p = await proposeQuest(pool, fromAda());
    const id = p.ok ? p.id : "";
    expect(await rejectQuestProposal(pool, { id, decidedBy: "u-steward", note: "" }, notify)).toBe(true);
    expect(await rejectQuestProposal(pool, { id, decidedBy: "u-steward", note: "again" }, notify)).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toBeNull();
  });

  it("tells nobody about a visitor's idea or a machine's", async () => {
    const { notices, notify } = spine();
    const visitor = await proposeQuest(pool, propose({ moduleId: "propose-quest", proposedBy: null, proposedByKind: "human" }));
    const machine = await proposeQuest(pool, propose({ prose: { title: "Mend the gate" }, proposedBy: "assistant", proposedByKind: "agent" }));
    expect((await acceptQuestProposal(pool, quests, { id: visitor.ok ? visitor.id : "", decidedBy: "u-steward", reward: { valueMinor: 500, valueCurrency: "CRC" } }, notify)).ok).toBe(true);
    expect(await rejectQuestProposal(pool, { id: machine.ok ? machine.id : "", decidedBy: "u-steward", note: "No." }, notify)).toBe(true);
    expect(notices).toEqual([]);
  });
});
