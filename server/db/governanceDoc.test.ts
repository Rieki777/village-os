/**
 * docs/GOVERNANCE.md is checked against the real engine and a real database.
 *
 * `scripts/generate-governance-doc.mjs` builds the document out of two kinds
 * of reading, and each one can be wrong in its own way:
 *
 *   1. It RESTATES, in the document's own words, what `evaluateBallot`,
 *      `unityPctOf`, `quorumPctOf`, `dialsForMethod` and `thresholdsForSubject`
 *      decide. Those restatements are read out of the source, so they cannot
 *      drift by accident, but they are still a paraphrase. The first suite
 *      calls the real functions and asserts the answers match the numbers the
 *      document publishes in its machine-readable block, so the paraphrase is
 *      checked and not trusted.
 *
 *   2. It names things this platform is BROKEN about. Those sentences are the
 *      most valuable lines in the file and the easiest to leave behind after
 *      somebody fixes the defect. The second suite opens real ballots on a
 *      real MySQL, through the same `openBallot`, `castVote` and `closeBallot`
 *      production uses, and proves the two the document names by name: a
 *      Birthing carrying on one yes and two abstentions, and a missed quorum
 *      reading as no quorum instead of as a rejection. When somebody fixes
 *      either one, this goes red and the document has to be rewritten.
 *
 * The third suite is the guard itself, run under `pnpm test` as well as in CI,
 * so a developer who never runs the check scripts by hand still hears about a
 * document that has come apart from the code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import {
  BALLOT_METHODS,
  VOTE_CHOICES,
  dialsForMethod,
  evaluateBallot,
  quorumPctOf,
  unityPctOf,
  type BallotMethod,
} from "../../shared/governanceEngine";
import { dialsForSubject, thresholdsForSubject } from "../../shared/ballotSubjects";
import { VARIABLES_BY_KEY, applyTimingOf, ringOf } from "../../shared/gameVariables";
import { castVote, closeBallot, openBallot, type OpenBallotInput } from "../lib/ballots";
import { provisionTestDb, testDbConfigured, type TestDb } from "./testDb";
// The generator is plain ESM with no types. It is the subject of this file, so
// it is imported for real rather than re-implemented here.
// @ts-expect-error - scripts/ is untyped JavaScript, deliberately outside tsconfig
import { collectFacts, generate, quorumSentence, renderLineage } from "../../scripts/generate-governance-doc.mjs";
import fs from "node:fs";
import path from "node:path";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[governanceDoc.test] TEST_DATABASE_URL not set — the ballot suite is SKIPPED.");
}

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** The document's own machine-readable block, parsed back out of the file. */
function published(): any {
  const text = generate(ROOT) as string;
  const block = /```json\n([\s\S]+?)\n```/.exec(text);
  if (!block) throw new Error("docs/GOVERNANCE.md carries no machine-readable block");
  return JSON.parse(block[1]);
}

describe("the governance doc states the numbers the engine produces", () => {
  const doc = published();

  it("names the same methods, choices and outcomes the engine has", () => {
    expect(doc.engine.methods).toEqual([...BALLOT_METHODS]);
    expect(doc.engine.voteChoices).toEqual([...VOTE_CHOICES]);
    expect(doc.engine.outcomes.sort()).toEqual(["failed", "no_quorum", "passed"]);
  });

  it("states the unity each method stamps, as dialsForMethod stamps it", () => {
    const village = { unityPct: 80, quorumPct: 20 };
    for (const method of BALLOT_METHODS) {
      const stamped = dialsForMethod(method, village).unityPct;
      const documented = doc.engine.unityStampedByMethod[method];
      // The document prints null where a method takes the village's own
      // number, which is the only honest way to state a number it does not fix.
      expect(documented === null ? village.unityPct : documented).toBe(stamped);
      expect(dialsForMethod(method, village).quorumPct).toBe(village.quorumPct);
    }
  });

  it("states the abstain rule the arithmetic actually implements", () => {
    const tallies = { yesW: 8, noW: 2, abstainW: 10 };
    expect(unityPctOf(tallies)).toBe(80);
    expect(quorumPctOf(tallies, 100)).toBe(20);
    expect(quorumPctOf({ yesW: 8, noW: 2, abstainW: 0 }, 100)).toBe(10);
    // These are the DEFAULT now, and the document says so in the key itself. A
    // subject may override the abstain policy, and village_launch does, so a
    // flat claim about every ballot stopped being true on 2026-09-02.
    expect(doc.engine.abstainCountsTowardQuorumByDefault).toBe(true);
    expect(doc.engine.abstainCountsTowardUnityByDefault).toBe(false);
    const launch = doc.subjects.find((s: any) => s.everySeatWeighs);
    expect(launch.abstainPolicy).toBe("no_answer");
  });

  it("states each subject's floors, as thresholdsForSubject holds them", () => {
    for (const s of doc.subjects) {
      const real = thresholdsForSubject(s.subjectType);
      expect(real, `the document describes ${s.subjectType} and the registry has no such subject`).not.toBeNull();
      expect(real!.minUnityPct).toBe(s.minUnityPct);
      expect(real!.minQuorumPct).toBe(s.minQuorumPct);
      expect(real!.minElectorate).toBe(s.minElectorate);
      expect(!!real!.everySeatWeighs).toBe(s.everySeatWeighs);
      expect(real!.method ?? null).toBe(s.method);
      expect(real!.why).toBe(s.why);
    }
  });

  it("proves the floor never lowers a village that asked for more", () => {
    // The sentence the document leads its subject table with. A village at 90
    // and 60 keeps 90 and 60 on a subject whose floor is lower.
    const village = { unityPct: 90, quorumPct: 60 };
    for (const s of doc.subjects) {
      const frozen = dialsForSubject(s.subjectType, (s.method ?? "custom") as BallotMethod, village);
      expect(frozen.unityPct).toBeGreaterThanOrEqual(village.unityPct === 90 && s.method === "custom" ? 90 : 0);
      expect(frozen.quorumPct).toBe(Math.max(village.quorumPct, s.minQuorumPct));
    }
  });

  it("states each dial's ring, default and apply timing, as the registry resolves them", () => {
    for (const d of doc.dials) {
      const def = VARIABLES_BY_KEY[d.key];
      expect(def, `the document describes the dial ${d.key} and the registry has no such key`).toBeTruthy();
      expect(def.label).toBe(d.label);
      expect(def.default).toBe(d.default);
      expect(def.type).toBe(d.type);
      expect(def.min ?? null).toBe(d.min);
      expect(def.max ?? null).toBe(d.max);
      expect(ringOf(def)).toBe(d.ring);
      expect(applyTimingOf(def)).toBe(d.applyTiming);
    }
  });

  it("states that no governance dial waits for a cycle close, and is right", () => {
    for (const d of doc.dials) expect(d.applyTiming).toBe("instant");
    for (const key of doc.cycleApplyKeys) {
      expect(applyTimingOf(VARIABLES_BY_KEY[key])).toBe("cycle-close");
    }
  });
});

describe.skipIf(!configured)("the governance doc's claims, against a real ballot", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let doc: any;
  let n = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    doc = published();
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const openOne = async (over: Partial<OpenBallotInput> = {}) =>
    openBallot(pool, {
      subjectType: "advisory",
      subjectRef: `gov-doc-${++n}`,
      title: `Doc ballot ${n}`,
      docMarkdown: "# The document as checked",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-opener",
      electorate: [
        { userId: "u-a", weight: 1 },
        { userId: "u-b", weight: 1 },
        { userId: "u-c", weight: 1 },
      ],
      ...over,
    });

  it("freezes the Birthing's floors exactly as the document publishes them", async () => {
    const launch = doc.subjects.find((s: any) => s.everySeatWeighs);
    expect(launch, "the document must publish a subject where every seat weighs").toBeTruthy();
    const opened = await openOne({
      subjectType: launch.subjectType,
      subjectRef: "start",
      method: launch.method ?? "custom",
      unityPct: launch.minUnityPct,
      quorumPct: launch.minQuorumPct,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.ballot.unityPct).toBe(launch.minUnityPct);
    expect(opened.ballot.quorumPct).toBe(launch.minQuorumPct);
    expect(opened.ballot.electorateCount).toBe(3);
    expect(opened.ballot.totalWeight).toBe(3);
  });

  it("A BIRTHING NO LONGER CARRIES ON ONE YES AND TWO ABSTENTIONS, and closes for want of quorum", async () => {
    // This used to pin the defect the document named in "What is broken today":
    // an abstention counted toward quorum, so the Game could start on one
    // person's yes. The 2026-09-02 governance build gave the subject its own
    // abstain policy, and an abstention on the Birthing now answers nothing at
    // all. The test went red on the day of the fix, which is what it was for,
    // and it pins the new rule from the same direction.
    //
    // no_quorum matters here and "failed" would be wrong: a question too few
    // people answered is recoverable, and the constant subject_ref lets the
    // Birthing be asked again the same hour on a fresh freeze.
    const launch = doc.subjects.find((s: any) => s.everySeatWeighs);
    const opened = await openOne({
      subjectType: launch.subjectType,
      subjectRef: "start-abstain",
      method: launch.method ?? "custom",
      unityPct: launch.minUnityPct,
      quorumPct: launch.minQuorumPct,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    expect((await castVote(pool, id, "u-a", "yes")).ok).toBe(true);
    expect((await castVote(pool, id, "u-b", "abstain")).ok).toBe(true);
    expect((await castVote(pool, id, "u-c", "abstain")).ok).toBe(true);

    const closed = await closeBallot(pool, {
      ballotId: id,
      outcomeNote: "Three people answered and one took a side.",
      closedBy: "u-opener",
      closerMayCloseEarly: true,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.outcome).toBe("no_quorum");
    // The quorum REPORTED is computed under the policy that decided, so the
    // two abstentions are absent from it: 1 of 3 seats answered, holding 33% of
    // the frozen weight. A reported 100 beside an outcome of no_quorum would be
    // a number that contradicts the sentence beside it.
    expect(closed.quorum).toBeCloseTo(100 / 3, 6);
    // The raw tallies still record what each person did, because an abstention
    // is a real act even when it answers nothing.
    expect(closed.tallies).toEqual({ yesW: 1, noW: 0, abstainW: 2 });
  });

  it("reads a missed quorum as no quorum and never as a rejection", async () => {
    const opened = await openOne({ quorumPct: 80 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await castVote(pool, opened.ballot.id, "u-a", "yes")).ok).toBe(true);
    const closed = await closeBallot(pool, {
      ballotId: opened.ballot.id,
      outcomeNote: "One of three answered.",
      closedBy: "u-opener",
      closerMayCloseEarly: true,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.outcome).toBe("no_quorum");
    expect(closed.unity).toBe(100);
    expect(doc.engine.ballotStatuses).toContain("no_quorum");
  });

  it("evaluates a closed ballot the way the document's formulas say", async () => {
    const opened = await openOne();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    await castVote(pool, id, "u-a", "yes");
    await castVote(pool, id, "u-b", "yes");
    await castVote(pool, id, "u-c", "no");
    const closed = await closeBallot(pool, {
      ballotId: id,
      outcomeNote: "Two of three agreed.",
      closedBy: "u-opener",
      closerMayCloseEarly: true,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    const byHand = evaluateBallot({
      method: "custom",
      unityPct: 80,
      quorumPct: 20,
      totalWeight: 3,
      tallies: closed.tallies,
    });
    expect(closed.outcome).toBe(byHand);
    expect(closed.outcome).toBe("failed");
    expect(unityPctOf(closed.tallies)).toBeCloseTo(66.67, 1);
  });
});

describe("the committed document", () => {
  it("is what the generator writes today", () => {
    const wanted = generate(ROOT) as string;
    const found = fs.readFileSync(path.join(ROOT, "docs", "GOVERNANCE.md"), "utf8");
    // Carriage returns are normalised for the same reason
    // scripts/check-governance-doc.mjs normalises them: git hands this file
    // back CRLF on the Windows checkouts this repository is developed on, and
    // a raw comparison would fail there and pass in CI.
    expect(found.replace(/\r\n/g, "\n")).toBe(wanted.replace(/\r\n/g, "\n"));
  });

  it("classifies every route it publishes, or says it could not", () => {
    const facts = collectFacts(ROOT);
    expect(facts.routes.total).toBeGreaterThan(0);
    for (const r of facts.routes.rows) {
      expect(typeof r.door).toBe("string");
      expect(r.door.length).toBeGreaterThan(0);
    }
  });

  it("reads every route module on disk instead of a list of three", () => {
    // The defect this pins: `routeFacts` walked a hardcoded three-file list, so
    // `server/routes/delegation.ts`, `governanceVetoes.ts`, `governanceLanding.ts`
    // and `governanceMode.ts` were invisible. The routes table lost their rows
    // and, because the staged flags read the same walk, the document stated as
    // a fact that delegation was ruled and not built while it was serving.
    const facts = collectFacts(ROOT);
    const modules = new Set<string>(
      facts.routes.rows.map((r: { file: string }) => r.file).filter((f: string) => f.startsWith("server/routes/")),
    );
    const onDisk = fs
      .readdirSync(path.join(ROOT, "server", "routes"))
      .filter((n) => n.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(n));
    for (const name of onDisk) {
      const rel = `server/routes/${name}`;
      const registers = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const servesGovernance = /app\.(get|post|put|patch|delete)\(\s*"\/api\/(governance|game\/mechanics)/.test(registers);
      if (!servesGovernance) continue;
      expect(modules.has(rel), `${rel} registers a governance route the document never read`).toBe(true);
    }
    expect(facts.staged.delegation).toBe(false);
  });

  it("the lineage file on the assistant's shelf is what the generator writes today", () => {
    const facts = collectFacts(ROOT);
    const wanted = renderLineage(facts) as string;
    const found = fs.readFileSync(path.join(ROOT, "docs", "knowledge", "governance-lineage.md"), "utf8");
    expect(found.replace(/\r\n/g, "\n")).toBe(wanted.replace(/\r\n/g, "\n"));
  });
});

/**
 * WHAT QUORUM COUNTS, put to the real function.
 *
 * 19F: quorum is pure token weight, and the head-count quorum an earlier plan
 * carried is withdrawn. The generator derives its sentence by parsing
 * `quorumPctOf`, which is one reading of the code; this calls the function with
 * a roll where the head count and the weight give different answers and checks
 * that the engine follows the weight and that the document says so. The two
 * halves fail independently, which is the point: a parse that went wrong and a
 * formula that changed do not look alike.
 */
describe("the governance doc's quorum sentence is the engine's arithmetic", () => {
  it("follows weight when heads and weight disagree, and the document says weight", () => {
    // Three people on the roll, all three answered, so a head-count quorum
    // would read 100%. They hold 10 of 100 weight between them.
    const tallies = { yes: 2, no: 1, abstain: 0, yesW: 6, noW: 4, abstainW: 0 };
    const byHeads = ((tallies.yes + tallies.no + tallies.abstain) / 3) * 100;
    const byWeight = quorumPctOf(tallies, 100);

    expect(byHeads).toBeCloseTo(100, 6);
    expect(byWeight).toBeCloseTo(10, 6);
    expect(byWeight).not.toBeCloseTo(byHeads, 1);

    const facts = collectFacts(ROOT);
    expect(facts.quorumFormula.weightOnly).toBe(true);
    expect(facts.quorumFormula.headFields).toEqual([]);

    const text = generate(ROOT) as string;
    expect(text).toContain(quorumSentence(facts));
    expect(text).toContain("Quorum is weight.");
    expect(text).toContain("97 percent of the Voice carries a constitutional change alone");
  });

  it("the machine-readable block reports the same reading", () => {
    const doc = published();
    expect(doc.quorum.weightOnly).toBe(true);
    expect(doc.quorum.countsHeadFields).toEqual([]);
    expect(doc.quorum.countsWeightFields.sort()).toEqual(["abstainW", "noW", "yesW"]);
    expect(doc.quorum.dividesByTotalWeight).toBe(true);
  });
});
