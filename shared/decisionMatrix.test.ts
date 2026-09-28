/**
 * THE DECISION MATRIX'S PLATFORM HALF, pinned to the engine it reads
 * (plan 2.3 and 7 item 3).
 *
 * Three kinds of test here, and each answers a different question:
 *
 *   PINNED    change a number the engine enforces (TIER_FLOORS, a subject's
 *             own floor, the village's method) and the row changes with it.
 *             A matrix that kept its own copy of the numbers would stay put.
 *   HONEST    the four honesty rules of plan 2.3, each asserted by what the
 *             matrix DOES say, and where the rule rests on a fact about the
 *             codebase (nothing enforces the sensing window, nothing writes
 *             the override link), that fact is asserted too, so the day it
 *             stops being true this file says the matrix is now wrong.
 *   LIVE      who holds a power, whether a steward is seated, whether
 *             governance is on: the inputs a village's own state supplies.
 *
 * The steward's reach is parsed by the server's own functions
 * (`mayVeto`, `stewardVetoTiersFrom` in server/lib/stewardship.ts) and handed
 * in, exactly as the route hands it in.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySwitchNote,
  dialProposalLine,
  generateDecisionMatrix,
  GRANT_DOOR,
  MINT_EDITOR_DOOR,
  MOON_CLOSE_DOOR,
  MOVING_DECISIONS,
  OPENED_WITHOUT_NOTICE,
  RISK_TAG_NOTE,
  RISK_TAGS,
  seatDoor,
  sensingNote,
  stewardReachTierOf,
  SUBJECT_DECISIONS,
  VETO_OVERRIDE_NOTE,
  type DecisionMatrix,
  type DecisionMatrixInputs,
  type DecisionMatrixRow,
  type PowerHolding,
  type StewardReach,
} from "./decisionMatrix";
import { GOVERNANCE_MODE, MINT_RULE, SUBJECT_THRESHOLDS, thresholdSettingsFrom, VILLAGE_LAUNCH } from "./ballotSubjects";
import { CAPABILITY_LABELS, HANDOVER_SET } from "./capabilities";
import { dialsForMethod, evaluateBallot, TIER_FLOORS, type Criticality, type MethodDials } from "./governanceEngine";
import { SEAT_SUBJECTS } from "./governanceKinds";
import { GPS_CHANGE } from "./governingPurpose";
import { CYCLE_SETTLEMENT, settlementModeFrom, settlementProposalDecision } from "./moonSettlement";
import { ringOf, VARIABLES, VARIABLES_BY_KEY } from "./gameVariables";
import { mayVeto, stewardVetoTiersFrom } from "../server/lib/stewardship";
import { pricingOf, validateChangeSet } from "../server/lib/mechanics";
import { changeSetOf } from "../server/lib/applyDue";

const shipped = (key: string): string => {
  const def = VARIABLES_BY_KEY[key];
  if (!def) throw new Error(`no such variable ${key}`);
  return String(def.default);
};

const VILLAGE: MethodDials = {
  unityPct: Number(shipped("governance.unity_pct")),
  quorumPct: Number(shipped("governance.quorum_pct")),
};

function steward(over: Partial<StewardReach> & { subjectsRaw?: string; tiersRaw?: string } = {}): StewardReach {
  const subjectsRaw = over.subjectsRaw ?? shipped("governance.steward_subjects");
  const tiersRaw = over.tiersRaw ?? shipped("governance.steward_veto_tiers");
  return {
    seated: 1,
    council: false,
    vetoHoursRaw: shipped("governance.veto_hours"),
    subjectInReach: (s) => mayVeto(s, subjectsRaw),
    tiersInReach: stewardVetoTiersFrom(tiersRaw),
    ...over,
  };
}

/** A fresh village on the shipped settings, governance on for members, holding nothing, its Game not started. */
function inputs(over: Partial<DecisionMatrixInputs> = {}): DecisionMatrixInputs {
  return {
    defaultMethod: shipped("governance.default_method"),
    village: VILLAGE,
    governanceOnForMembers: true,
    supportThreshold: Number(shipped("governance.proposal_support_threshold")),
    sensingDays: Number(shipped("governance.sensing_days")),
    steward: steward(),
    handoverComplete: false,
    powers: [],
    settlementMode: settlementModeFrom(shipped("cycle.settlement_mode")),
    gameStarted: false,
    autoApplyEnabled: shipped("governance.auto_apply_enabled") === "true",
    ...over,
  };
}

const rows = (m: DecisionMatrix): DecisionMatrixRow[] => m.groups.flatMap((g) => g.rows);
const row = (m: DecisionMatrix, key: string): DecisionMatrixRow => {
  const r = rows(m).find((x) => x.key === key);
  if (!r) throw new Error(`no row ${key}; the matrix has ${rows(m).map((x) => x.key).join(", ")}`);
  return r;
};
const words = (r: DecisionMatrixRow): string =>
  [r.decision, r.detail ?? "", r.approval.text, ...r.consultation, ...r.information, ...r.method.lines].join("\n");

// ── PINNED ─────────────────────────────────────────────────────────────────

describe("pinned to the engine: change what the engine enforces and the row changes", () => {
  const saved = JSON.parse(JSON.stringify(TIER_FLOORS)) as Record<Criticality, MethodDials>;
  const savedMint = { ...SUBJECT_THRESHOLDS[MINT_RULE] };
  afterEach(() => {
    for (const c of Object.keys(saved) as Criticality[]) (TIER_FLOORS as Record<Criticality, MethodDials>)[c] = { ...saved[c] };
    (SUBJECT_THRESHOLDS as Record<string, unknown>)[MINT_RULE] = { ...savedMint };
  });

  it("a structural change to the Game's rules asks TIER_FLOORS.structural, raised over the village's own dials", () => {
    const r = row(generateDecisionMatrix(inputs()), "vote:mechanics:structural");
    expect(r.method.kind).toBe("custom");
    expect(r.method.unityPct).toBe(Math.max(VILLAGE.unityPct, TIER_FLOORS.structural.unityPct));
    expect(r.method.quorumPct).toBe(Math.max(VILLAGE.quorumPct, TIER_FLOORS.structural.quorumPct));
    expect(r.method.tierFloor).toBe("structural");
  });

  it("moving TIER_FLOORS moves the rows that read it, and only those", () => {
    const before = generateDecisionMatrix(inputs());
    (TIER_FLOORS as Record<Criticality, MethodDials>).structural = { unityPct: 86, quorumPct: 63 };
    (TIER_FLOORS as Record<Criticality, MethodDials>).constitutional = { unityPct: 99, quorumPct: 98 };
    const after = generateDecisionMatrix(inputs());

    expect(row(after, "vote:mechanics:structural").method).toMatchObject({ unityPct: 86, quorumPct: 63 });
    expect(row(after, "vote:mechanics:structural").method.lines.join(" ")).toContain("quorum 63 and unity 86");
    // The vote-mode switch is constitutional by criticality, so the tier raises it too.
    expect(row(after, `vote:${GOVERNANCE_MODE}`).method).toMatchObject({ unityPct: 99, quorumPct: 98 });
    // A row with no tier behind it does not move.
    expect(row(after, "move:power_transfer").method).toEqual(row(before, "move:power_transfer").method);
    expect(row(after, "vote:mechanics:routine").method).toEqual(row(before, "vote:mechanics:routine").method);
  });

  it("a subject's own floor is the row's floor: moving mint_rule's quorum moves its row", () => {
    expect(row(generateDecisionMatrix(inputs()), `vote:${MINT_RULE}`).method.quorumPct).toBe(
      Math.max(VILLAGE.quorumPct, savedMint.minQuorumPct),
    );
    (SUBJECT_THRESHOLDS as Record<string, typeof savedMint>)[MINT_RULE] = { ...savedMint, minQuorumPct: 64 };
    const r = row(generateDecisionMatrix(inputs()), `vote:${MINT_RULE}`);
    expect(r.method.quorumPct).toBe(64);
    expect(r.method.tierFloor).toBe("subject");
  });

  it("a village that raised its own tier setting reads its own number, never below the platform's", () => {
    const settings = thresholdSettingsFrom((key) => (key === "governance.tier_structural_quorum_pct" ? 71 : 0));
    const r = row(generateDecisionMatrix(inputs({ settings })), "vote:mechanics:structural");
    expect(r.method.quorumPct).toBe(71);
    const lowered = thresholdSettingsFrom((key) => (key === "governance.tier_structural_quorum_pct" ? 5 : 0));
    expect(row(generateDecisionMatrix(inputs({ settings: lowered })), "vote:mechanics:structural").method.quorumPct).toBe(
      TIER_FLOORS.structural.quorumPct,
    );
  });

  it("governance.default_method moves the method column, and a subject that fixes its own method keeps it", () => {
    const m = generateDecisionMatrix(inputs({ defaultMethod: "consent" }));
    expect(row(m, "vote:mechanics:routine").method.kind).toBe("consent");
    expect(row(m, "vote:mechanics:routine").consultation.join(" ")).toContain("raise an objection");
    expect(row(m, "move:role_seat").method.kind).toBe("consent");
    // The Birthing and the vote-mode switch fix `custom` in SUBJECT_THRESHOLDS.
    expect(SUBJECT_THRESHOLDS[VILLAGE_LAUNCH].method).toBe("custom");
    expect(row(m, `vote:${VILLAGE_LAUNCH}`).method).toMatchObject({ kind: "custom", unityPct: 100, quorumPct: 100 });
    expect(row(m, `vote:${GOVERNANCE_MODE}`).method.kind).toBe("custom");
    expect(row(m, `vote:${VILLAGE_LAUNCH}`).consultation.join(" ")).not.toContain("objection");
  });

  it("the Birthing's approval names the floors SUBJECT_THRESHOLDS puts on its roll", () => {
    const t = SUBJECT_THRESHOLDS[VILLAGE_LAUNCH];
    const r = row(generateDecisionMatrix(inputs()), `vote:${VILLAGE_LAUNCH}`);
    expect(r.approval.who).toBe("roll");
    expect(r.approval.text).toContain(`at least ${t.minElectorate} people on it`);
    expect(r.approval.text).toContain("every seat carrying weight");
    expect(r.approval.text).toContain("every one of them voting yes");
    expect(r.detail).toBe(t.why);
  });
});

// ── HONEST ─────────────────────────────────────────────────────────────────

const SRC_ROOT = process.cwd();
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(SRC_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("honesty rule 1: the sensing window is shown as not enforced", () => {
  it("says so on every rule-change row and in the notes, with the supporter count as the real gate", () => {
    const m = generateDecisionMatrix(inputs());
    expect(m.sensing.enforced).toBe(false);
    expect(m.notes).toContain(sensingNote(m.sensing.days, m.sensing.supportThreshold));
    expect(shipped("governance.proposal_support_threshold")).toBe("0");
    expect(m.notes.join(" ")).toContain("0 turns that gate off");
    for (const key of ["vote:mechanics:routine", "vote:mechanics:structural", "vote:mechanics:constitutional", `vote:${MINT_RULE}`]) {
      expect(row(m, key).consultation.join(" "), key).toContain("nothing enforces it");
    }
  });

  it("the window's number changes nothing but the number", () => {
    const strip = (r: DecisionMatrixRow) => ({ ...r, consultation: r.consultation.filter((l) => !l.includes("sensing window")) });
    const short = generateDecisionMatrix(inputs({ sensingDays: 1 }));
    const long = generateDecisionMatrix(inputs({ sensingDays: 60 }));
    expect(rows(long).map(strip)).toEqual(rows(short).map(strip));
  });

  it("a supporter count above 0 is shown as the gate it is", () => {
    const m = generateDecisionMatrix(inputs({ supportThreshold: 3 }));
    expect(row(m, "vote:mechanics:routine").consultation[0]).toBe("A proposal needs 3 supporters before it can go to the vote.");
  });

  it("rests on a fact about the codebase: nothing but a display reads governance.sensing_days", () => {
    // If a route starts enforcing the window, this fails, and the matrix has to change with it.
    const readers = [...sourceFiles("server"), ...sourceFiles("shared")].filter((f) =>
      fs.readFileSync(path.join(SRC_ROOT, f), "utf8").includes("governance.sensing_days"),
    );
    expect(readers.sort()).toEqual([
      // The /api/game/config payload, which shows the number and gates nothing.
      "server/index.ts",
      // This lane's route and generator, which show it as not enforced.
      "server/routes/decisionMatrix.ts",
      "shared/decisionMatrix.ts",
      // The definition.
      "shared/gameVariables.ts",
    ]);
    const index = fs.readFileSync(path.join(SRC_ROOT, "server/index.ts"), "utf8");
    expect(index.match(/governance\.sensing_days/g)).toHaveLength(1);
    expect(index).toMatch(/sensingDays: numberVar\("governance\.sensing_days"\)/);
  });
});

describe("honesty rule 2: the votes that move a power or a seat show no tier floor", () => {
  it("every one of them says so, and asks exactly the village's own dials, as the routes price them", () => {
    const m = generateDecisionMatrix(inputs());
    const moving = m.groups.find((g) => g.id === "moving-power")!.rows;
    expect(moving.map((r) => r.key).sort()).toEqual(Object.keys(MOVING_DECISIONS).map((s) => `move:${s}`).sort());
    const village = dialsForMethod("custom", VILLAGE);
    for (const r of moving) {
      expect(r.method.tierFloor, r.key).toBe("none");
      expect(r.method.lines.join(" "), r.key).toContain("No tier floor");
      expect({ unityPct: r.method.unityPct, quorumPct: r.method.quorumPct }, r.key).toEqual(village);
    }
  });

  it("and a held power's own row says moving it has no tier floor", () => {
    for (const r of generateDecisionMatrix(inputs()).groups.find((g) => g.id === "powers")!.rows) {
      expect(r.method.lines.join(" "), r.key).toContain("no tier floor");
    }
  });

  it("covers every seat subject the landing loop knows", () => {
    for (const s of Array.from(SEAT_SUBJECTS)) expect(Object.keys(MOVING_DECISIONS)).toContain(s);
  });
});

describe("honesty rule 3: the veto override is never shown as available", () => {
  const variations: Array<[string, Partial<DecisionMatrixInputs>]> = [
    ["shipped", {}],
    ["every tier in reach, a council, stewards seated", { steward: steward({ tiersRaw: "all", council: true, seated: 3 }) }],
    ["the highest tier set to routine", { settings: thresholdSettingsFrom(() => 0, (k) => (k === "governance.highest_tier" ? "routine" : "")) }],
    ["handover complete", { handoverComplete: true }],
  ];
  for (const [name, over] of variations) {
    it(`on ${name}: no row offers one, and the notes say it cannot be done`, () => {
      const m = generateDecisionMatrix(inputs(over));
      expect(m.vetoOverrideAvailable).toBe(false);
      for (const r of rows(m)) expect(words(r), r.key).not.toMatch(/overrid|overturn/i);
      expect(m.notes).toContain(VETO_OVERRIDE_NOTE);
    });
  }

  it("rests on a fact about the codebase: nothing writes the link the override reads", () => {
    // `isOverride` (server/lib/applyDue.ts) needs supersedes_relation = 'overrides'.
    // The day a writer appears this fails, and the note above has to go.
    const mentions = sourceFiles("server").filter((f) =>
      fs.readFileSync(path.join(SRC_ROOT, f), "utf8").includes("supersedes_relation"),
    );
    expect(mentions).toEqual(["server/repos/proposalLandings.ts"]);
    const body = fs.readFileSync(path.join(SRC_ROOT, "server/repos/proposalLandings.ts"), "utf8");
    for (const line of body.split("\n").filter((l) => l.includes("supersedes_relation") && !l.trim().startsWith("/**"))) {
      expect(line).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bSET\s/i);
    }
  });
});

describe("honesty rule 4: risk tags are information, never law", () => {
  it("a tagged row decides exactly what the untagged row decides", () => {
    const plain = generateDecisionMatrix(inputs());
    const riskTags: Record<string, string[]> = {};
    for (const r of rows(plain)) riskTags[r.key] = [...RISK_TAGS];
    const tagged = generateDecisionMatrix(inputs({ riskTags }));
    for (const r of rows(tagged)) {
      const before = row(plain, r.key);
      expect(r.riskTags, r.key).toEqual([...RISK_TAGS]);
      expect({ ...r, riskTags: [] }, r.key).toEqual(before);
    }
  });

  it("keeps only the canvas's six, and says what a tag is only when one is shown", () => {
    const m = generateDecisionMatrix(inputs({ riskTags: { [`vote:${MINT_RULE}`]: ["budget", "made-up", "impact"] } }));
    expect(row(m, `vote:${MINT_RULE}`).riskTags).toEqual(["impact", "budget"]);
    expect(m.notes).toContain(RISK_TAG_NOTE);
    expect(generateDecisionMatrix(inputs()).notes).not.toContain(RISK_TAG_NOTE);
  });
});

// ── LIVE ───────────────────────────────────────────────────────────────────

const holding = (over: Partial<PowerHolding> & Pick<PowerHolding, "capability">): PowerHolding => ({
  villageHolds: false,
  holderRoleName: null,
  liveHolders: 0,
  rolesCarrying: [],
  ...over,
});

describe("who decides a power", () => {
  it("every transferable power has one row, in the platform's order, even when the caller names none", () => {
    const powers = generateDecisionMatrix(inputs()).groups.find((g) => g.id === "powers")!.rows;
    expect(powers.map((r) => r.key)).toEqual(HANDOVER_SET.map((c) => `power:${c}`));
    // The steward's veto is the one exception: an administrator's veto stops nothing (see below).
    for (const r of powers) expect(r.approval.who, r.key).toBe(r.key === "power:steward.veto" ? "nobody" : "admin-panel");
  });

  it("before the handover: the admin panel, and the roles that carry it by name", () => {
    const m = generateDecisionMatrix(
      inputs({ powers: [holding({ capability: "intake.moderate", rolesCarrying: ["Steward Circle", "Care Team"], liveHolders: 2 })] }),
    );
    const r = row(m, "power:intake.moderate");
    expect(r.approval.who).toBe("admin-panel");
    expect(r.approval.text).toContain("So does anyone seated in Steward Circle and Care Team.");
  });

  it("once the village holds it: the live holder acts, and with nobody seated the village decides by vote", () => {
    const m = generateDecisionMatrix(
      inputs({
        powers: [
          holding({ capability: "dial.set", villageHolds: true, holderRoleName: "Steward", liveHolders: 2 }),
          holding({ capability: "forum.moderate", villageHolds: true, holderRoleName: "Hosts", liveHolders: 0 }),
        ],
      }),
    );
    expect(row(m, "power:dial.set").approval).toMatchObject({ who: "holder" });
    expect(row(m, "power:dial.set").approval.text).toContain("with Steward");
    expect(row(m, "power:dial.set").consultation).toContain(dialProposalLine());
    expect(row(m, "power:forum.moderate").approval).toMatchObject({ who: "roll" });
    expect(row(m, "power:forum.moderate").approval.text).toContain("nobody is seated there today");
  });

  it("a redemption nobody holds the key for goes to a village vote", () => {
    const m = generateDecisionMatrix(inputs());
    expect(row(m, "power:redemption.confirm").consultation.join(" ")).toContain("each redemption goes to a village vote");
    const held = generateDecisionMatrix(inputs({ powers: [holding({ capability: "redemption.confirm", liveHolders: 1 })] }));
    expect(row(held, "power:redemption.confirm").consultation.join(" ")).not.toContain("village vote");
  });
});

describe("the steward's reach, read the way the landing loop reads it", () => {
  it("on the shipped reach, only a constitutional change to the Game's rules can be stopped", () => {
    const m = generateDecisionMatrix(inputs());
    expect(row(m, "vote:mechanics:constitutional").stewardStop).toBe("in-reach");
    expect(row(m, "vote:mechanics:structural").stewardStop).toBe("out-of-reach");
    expect(row(m, "vote:mechanics:routine").stewardStop).toBe("out-of-reach");
    expect(row(m, `vote:${VILLAGE_LAUNCH}`).stewardStop).toBe("no-window");
    expect(row(m, "move:role_seat").stewardStop).toBe("seat");
    expect(row(m, "move:role_unseat").stewardStop).toBe("seat");
  });

  it("a vote-mode switch counts as routine for the reach, because it reaches the landing loop with no change set", async () => {
    const m = generateDecisionMatrix(inputs());
    const mode = row(m, `vote:${GOVERNANCE_MODE}`);
    expect(mode.method.tierFloor).toBe("constitutional");
    expect(mode.stewardStop).toBe("out-of-reach");
    expect(mode.consultation.join(" ")).toContain("so this one counts as routine");
    // The landing loop's own reader: no change set is read for this subject at all.
    const asked: string[] = [];
    const pool = { query: async (sql: string) => (asked.push(sql), [[]]) } as never;
    expect(await changeSetOf(pool, { subjectType: GOVERNANCE_MODE, subjectRef: "p1" })).toEqual([]);
    expect(asked).toEqual([]);
    await changeSetOf(pool, { subjectType: "mechanics", subjectRef: "p1" });
    expect(asked).toHaveLength(1);
  });

  it("a minting rule counts at the size pricingOf gives it", () => {
    expect(stewardReachTierOf(MINT_RULE)).toBe(pricingOf({ kind: "mint_rule", key: "mint.x", to: "1" } as never).criticality);
    expect(row(generateDecisionMatrix(inputs()), `vote:${MINT_RULE}`).stewardStop).toBe("out-of-reach");
    expect(row(generateDecisionMatrix(inputs({ steward: steward({ tiersRaw: "all" }) })), `vote:${MINT_RULE}`).stewardStop).toBe(
      "in-reach",
    );
  });

  it("nobody seated, a council, and a village that put nothing in reach each say so", () => {
    expect(row(generateDecisionMatrix(inputs({ steward: steward({ seated: 0 }) })), "vote:mechanics:constitutional").stewardStop).toBe(
      "nobody-seated",
    );
    const council = row(generateDecisionMatrix(inputs({ steward: steward({ council: true }) })), "vote:mechanics:constitutional");
    expect(council.consultation.join(" ")).toContain("a majority of the seated stewards");
    const none = generateDecisionMatrix(inputs({ steward: steward({ subjectsRaw: "none", tiersRaw: "all" }) }));
    for (const r of rows(none).filter((x) => x.group !== "powers")) {
      expect(["out-of-reach", "no-window", "seat"], r.key).toContain(r.stewardStop);
    }
  });

  it("the window it names is the floored window the landing loop counts", () => {
    const m = generateDecisionMatrix(inputs({ steward: steward({ vetoHoursRaw: "5" }) }));
    expect(row(m, "vote:mechanics:constitutional").consultation.join(" ")).toContain("at least 72 hours");
  });
});

describe("where a vote is held", () => {
  it("with governance off for members, rule changes go to Hypha and every other vote cannot be held yet", () => {
    const m = generateDecisionMatrix(inputs({ governanceOnForMembers: false }));
    expect(row(m, "vote:mechanics:routine").approval.who).toBe("hypha");
    expect(row(m, `vote:${MINT_RULE}`).approval.who).toBe("hypha");
    // A moon is the exception: with no vote, the Cycles desk settles it ("a vote is not always the only door" below).
    for (const key of [`vote:${VILLAGE_LAUNCH}`, "move:power_transfer", "move:role_seat"]) {
      expect(row(m, key).approval.who, key).toBe("not-yet");
      expect(row(m, key).information, key).toEqual(["Nothing is announced until the vote can be held."]);
    }
  });

  it("a village on Hypha sends its rule changes there and holds the rest here, on its own dials", () => {
    const m = generateDecisionMatrix(inputs({ defaultMethod: "hypha" }));
    expect(row(m, "vote:mechanics:structural").method).toMatchObject({ kind: "hypha", unityPct: null });
    expect(row(m, "move:power_transfer").method.kind).toBe("custom");
    expect(row(m, "move:power_transfer").method.lines.join(" ")).toContain("no Hypha leg");
    expect(row(m, `vote:${GOVERNANCE_MODE}`).method.lines.join(" ")).not.toContain("no Hypha leg");
  });

  it("the purpose statement's vote is the founder's pen until the handover completes", () => {
    expect(row(generateDecisionMatrix(inputs()), `vote:${GPS_CHANGE}`).approval.who).toBe("founder");
    expect(row(generateDecisionMatrix(inputs({ handoverComplete: true })), `vote:${GPS_CHANGE}`).approval.who).toBe("roll");
  });

  it("a power vote says only a member may open it", () => {
    const m = generateDecisionMatrix(inputs());
    expect(row(m, "move:power_return").consultation).toContain("A member opens it. An administrator account on its own cannot.");
    expect(row(m, "move:role_seat").consultation).not.toContain("A member opens it. An administrator account on its own cannot.");
  });
});

describe("coverage and copy", () => {
  it("every subject SUBJECT_THRESHOLDS prices has its own row and its own words", () => {
    expect(Object.keys(SUBJECT_DECISIONS).sort()).toEqual(Object.keys(SUBJECT_THRESHOLDS).sort());
    const m = generateDecisionMatrix(inputs());
    for (const s of Object.keys(SUBJECT_THRESHOLDS)) expect(row(m, `vote:${s}`).decision).toBe(SUBJECT_DECISIONS[s]);
  });

  it("carries no percent sign, no dash a member reads as a pause, and no count of anything handed over", () => {
    for (const over of [
      {},
      { defaultMethod: "consent" },
      { governanceOnForMembers: false },
      { handoverComplete: true },
      { settlementMode: "manual" as const, autoApplyEnabled: false, gameStarted: true },
    ]) {
      const text = JSON.stringify(generateDecisionMatrix(inputs(over)));
      expect(text).not.toContain("%");
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/\b\d+ of \d+\b/);
    }
  });
});

// ── THE REVIEW OF 2026-09-27: EACH SENTENCE HELD TO WHAT THE CODE DOES ──────

const allLines = (r: DecisionMatrixRow): string => [r.approval.text, ...r.consultation, ...r.information, ...r.method.lines].join("\n");

/** A village whose routine tier setting was raised to unity 70 and quorum 40, over its own 60 and 20. */
const RAISED_ROUTINE: Partial<DecisionMatrixInputs> = {
  village: { unityPct: 60, quorumPct: 20 },
  settings: thresholdSettingsFrom(
    (k) => ({ "governance.tier_routine_unity_pct": 70, "governance.tier_routine_quorum_pct": 40 })[k] ?? 0,
  ),
};

describe("the Method column names what set the bar", () => {
  const OWN = /The village's own dials: (?:quorum (\d+)|no quorum) and unity (\d+)/;
  const variations: Array<[string, Partial<DecisionMatrixInputs>]> = [
    ["shipped settings", {}],
    ["a village whose own dials sit above every floor but the Birthing's", { village: { unityPct: 99, quorumPct: 99 } }],
    ["a village that raised its routine tier", RAISED_ROUTINE],
  ];
  for (const [name, over] of variations) {
    it(`on ${name}: "the village's own dials" is only ever followed by the village's own numbers`, () => {
      const inp = inputs(over);
      let named = 0;
      for (const r of rows(generateDecisionMatrix(inp))) {
        for (const line of r.method.lines) {
          const m = line.match(OWN);
          if (!m) continue;
          named += 1;
          expect({ unityPct: Number(m[2]), quorumPct: Number(m[1] ?? 0) }, `${r.key}: ${line}`).toEqual(inp.village);
        }
      }
      // The denominator: a check that found no such line would pass on nothing.
      expect(named, name).toBeGreaterThan(0);
    });
  }

  it("a floored vote on shipped settings is counted on the numbers it freezes, and the village's own are named as its own", () => {
    const m = generateDecisionMatrix(inputs());
    const structural = row(m, "vote:mechanics:structural");
    const q = Math.max(VILLAGE.quorumPct, TIER_FLOORS.structural.quorumPct);
    const u = Math.max(VILLAGE.unityPct, TIER_FLOORS.structural.unityPct);
    // The floor really does raise it on shipped settings, or this case would test nothing.
    expect(q).not.toBe(VILLAGE.quorumPct);
    expect(structural.method.lines[0]).toBe(`Counted on the numbers this vote freezes: quorum ${q} and unity ${u}.`);
    expect(structural.method.lines[1]).toBe(
      `The structural tier's floor raises it above the village's own dials, which are quorum ${VILLAGE.quorumPct} and unity ${VILLAGE.unityPct}. The village cannot lower that floor.`,
    );
    for (const key of ["vote:mechanics:constitutional", `vote:${GOVERNANCE_MODE}`, `vote:${VILLAGE_LAUNCH}`, `vote:${MINT_RULE}`]) {
      expect(row(m, key).method.lines[0], key).toMatch(/^Counted on the numbers this vote freezes/);
    }
  });

  it("a raised routine tier is shown raising the routine bar, and the shipped routine tier as asking nothing more", () => {
    const raised = row(generateDecisionMatrix(inputs(RAISED_ROUTINE)), "vote:mechanics:routine");
    expect(raised.method).toMatchObject({ unityPct: 70, quorumPct: 40 });
    expect(raised.method.lines).toContain(
      "The routine tier's floor raises it above the village's own dials, which are quorum 20 and unity 60. The village cannot lower that floor.",
    );
    expect(raised.method.lines.join(" ")).not.toContain("asks nothing above");
    expect(row(generateDecisionMatrix(inputs()), "vote:mechanics:routine").method.lines.slice(0, 2)).toEqual([
      `The village's own dials: quorum ${VILLAGE.quorumPct} and unity ${VILLAGE.unityPct}.`,
      "The routine tier's floor asks nothing above the village's own dials.",
    ]);
  });

  it("under majority, consensus and consent a floor raises the quorum and names no unity number, because none is read", () => {
    // The engine's own reading: a majority ballot frozen at unity 80 carries at 60 of 100 saying yes.
    const tallies = { yesW: 60, noW: 40, abstainW: 0 };
    expect(evaluateBallot({ method: "majority", unityPct: 80, quorumPct: 50, totalWeight: 100, tallies })).toBe("passed");
    expect(evaluateBallot({ method: "custom", unityPct: 80, quorumPct: 50, totalWeight: 100, tallies })).toBe("failed");
    for (const method of ["majority", "consensus", "consent"]) {
      const r = row(generateDecisionMatrix(inputs({ defaultMethod: method })), "vote:mechanics:structural");
      expect(r.method.kind, method).toBe(method);
      expect(r.method.unityPct, method).toBeNull();
      expect(r.method.quorumPct, method).toBe(Math.max(VILLAGE.quorumPct, TIER_FLOORS.structural.quorumPct));
      expect(r.method.lines.join(" "), method).not.toMatch(/unity \d/);
      expect(r.method.lines[1], method).toBe(
        `The structural tier's floor raises the quorum above the village's own ${VILLAGE.quorumPct}. Under this method it sets no unity number, because the method decides agreement.`,
      );
    }
  });
});

describe("the steward's veto names who can really stop a carried decision", () => {
  it("before the village takes it on, with nobody seated: nobody, and an administrator's objection stops nothing", () => {
    const r = row(generateDecisionMatrix(inputs({ steward: steward({ seated: 0 }) })), "power:steward.veto");
    expect(r.approval.who).toBe("nobody");
    expect(r.approval.text).toContain("Nobody today: no steward is seated, so no carried decision can be stopped.");
    expect(r.approval.text).toContain("An administrator who has never sat there can record an objection, and it stops nothing.");
    expect(r.approval.text).not.toContain("admins and founders act on it");
    // Every other power a fresh village holds nothing of is still the admin panel's.
    expect(row(generateDecisionMatrix(inputs()), "power:dial.set").approval.who).toBe("admin-panel");
  });

  it("with a steward seated: the stewards, by the roles that carry it", () => {
    const m = generateDecisionMatrix(
      inputs({ powers: [holding({ capability: "steward.veto", liveHolders: 1, rolesCarrying: ["Stewards"] })] }),
    );
    const r = row(m, "power:steward.veto");
    expect(r.approval.who).toBe("holder");
    expect(r.approval.text).toContain("The stewards: whoever is seated in Stewards acts on it.");
    expect(r.approval.text).toContain("it stops nothing");
  });

  it("once the village holds it, an administrator who is not seated cannot use it at all", () => {
    const r = row(
      generateDecisionMatrix(
        inputs({ powers: [holding({ capability: "steward.veto", villageHolds: true, holderRoleName: "Stewards", liveHolders: 0 })] }),
      ),
      "power:steward.veto",
    );
    expect(r.approval.who).toBe("nobody");
    expect(r.approval.text).toContain("The village holds it, with Stewards.");
    expect(r.approval.text).toContain("An administrator who is not seated there cannot use it.");
  });

  it("its seat empties at the end of its term as well as by a vote, and no other power's row says so", () => {
    const m = generateDecisionMatrix(inputs());
    expect(row(m, "power:steward.veto").method.lines).toContain(
      "The steward's seat is filled only by a village vote, and it empties by a vote or when its term ends. No admin route moves it.",
    );
    expect(row(m, "power:dial.set").method.lines.join(" ")).not.toContain("steward's seat");
  });
});

describe("a vote is not always the only door", () => {
  const DUE = [{ id: "c-7", cycleNumber: 7 }];

  it("a moon: the roll votes, and an administrator can settle it from the Cycles desk anyway", () => {
    const r = row(generateDecisionMatrix(inputs()), `vote:${CYCLE_SETTLEMENT}`);
    expect(r.approval.who).toBe("roll");
    expect(r.approval.text).toContain(MOON_CLOSE_DOOR);
  });

  it("a village that settles by hand, or has governance off for members, gets no moon vote, and the Cycles desk decides", () => {
    // The engine's own answer, which the rows below follow.
    expect(settlementProposalDecision({ mode: "proposal", governanceOn: true, due: DUE, asks: [] }).post).toBe(true);
    expect(settlementProposalDecision({ mode: "manual", governanceOn: true, due: DUE, asks: [] }).post).toBe(false);
    expect(settlementProposalDecision({ mode: "proposal", governanceOn: false, due: DUE, asks: [] }).post).toBe(false);
    const cases: Array<[Partial<DecisionMatrixInputs>, string]> = [
      [{ settlementMode: "manual" }, "This village settles its moons by hand, so no vote is opened."],
      [{ governanceOnForMembers: false }, "The governance module is not on for members, so no member votes on a moon."],
    ];
    for (const [over, why] of cases) {
      const r = row(generateDecisionMatrix(inputs(over)), `vote:${CYCLE_SETTLEMENT}`);
      expect(r.approval.who, why).toBe("admin-panel");
      expect(r.approval.text, why).toContain(why);
      expect(r.approval.text, why).not.toContain("The roll");
      expect(r.method, why).toMatchObject({ kind: "held", unityPct: null, quorumPct: null, tierFloor: null });
      expect(r.stewardStop, why).toBe("not-applicable");
    }
  });

  it("a minting rule: the admin panel's editor is named until the Game starts, and never after", () => {
    for (const governanceOnForMembers of [true, false]) {
      const before = row(generateDecisionMatrix(inputs({ governanceOnForMembers })), `vote:${MINT_RULE}`);
      expect(before.approval.text, String(governanceOnForMembers)).toContain(MINT_EDITOR_DOOR);
      const after = row(generateDecisionMatrix(inputs({ governanceOnForMembers, gameStarted: true })), `vote:${MINT_RULE}`);
      expect(after.approval.text, String(governanceOnForMembers)).not.toContain(MINT_EDITOR_DOOR);
    }
  });

  it("giving a role a power: the admin panel's door is on the vote and on every power's row but the steward's veto", () => {
    const m = generateDecisionMatrix(inputs());
    expect(row(m, "move:power_grant").approval.text).toContain(GRANT_DOOR);
    const door = "An administrator can also give it to another role directly from the admin panel, with no vote, and the village's pulse says so.";
    for (const cap of HANDOVER_SET) {
      if (cap === "steward.veto") expect(row(m, `power:${cap}`).method.lines).not.toContain(door);
      else expect(row(m, `power:${cap}`).method.lines, cap).toContain(door);
    }
  });

  it("seating and unseating: the holders route's door follows who holds the power to record a decision's outcome", () => {
    const power = `the power to ${CAPABILITY_LABELS["proposal.decide"].toLowerCase()}`;
    const panel = generateDecisionMatrix(inputs());
    expect(row(panel, "move:role_seat").approval.text).toContain(seatDoor("role_seat", false));
    expect(row(panel, "move:role_unseat").approval.text).toContain(seatDoor("role_unseat", false));
    expect(seatDoor("role_seat", false)).toContain("themselves included");

    const held = generateDecisionMatrix(
      inputs({ powers: [holding({ capability: "proposal.decide", villageHolds: true, holderRoleName: "Recorders", liveHolders: 1 })] }),
    );
    expect(row(held, "move:role_seat").approval.text).toContain(seatDoor("role_seat", true));
    expect(row(held, "move:role_unseat").approval.text).toContain(seatDoor("role_unseat", true));
    expect(seatDoor("role_seat", true)).toContain(power);
    expect(seatDoor("role_unseat", true)).toContain(power);
    expect(seatDoor("role_seat", true)).not.toBe(seatDoor("role_seat", false));
  });

  it("the votes with no door beside them name none", () => {
    const m = generateDecisionMatrix(inputs({ gameStarted: true, handoverComplete: true }));
    for (const key of [
      "vote:mechanics:routine",
      "vote:mechanics:constitutional",
      `vote:${VILLAGE_LAUNCH}`,
      `vote:${GOVERNANCE_MODE}`,
      `vote:${MINT_RULE}`,
      `vote:${GPS_CHANGE}`,
      "move:power_transfer",
      "move:power_return",
    ]) {
      expect(row(m, key).approval.text, key).not.toContain("with no vote");
    }
  });
});

describe("dial proposals, as the proposal path answers them", () => {
  it("a founder-held dial is refused by the proposal path, and the dial.set row says so", async () => {
    const founderHeld = VARIABLES.find((v) => ringOf(v) !== "open" && v.key !== "governance.weight_mode");
    expect(founderHeld, "the registry holds a founder-held dial").toBeTruthy();
    const pool = { query: async () => [[]] } as never;
    const value = String(founderHeld!.default);
    const { problems } = await validateChangeSet(pool, [{ key: founderHeld!.key, to: value }], () => value, 0);
    expect(problems.map((p) => p.problem)).toContain("This dial is founder-held and cannot be moved by proposal");

    const r = row(generateDecisionMatrix(inputs()), "power:dial.set");
    expect(r.consultation).toContain(dialProposalLine());
    expect(dialProposalLine()).toContain("A dial marked founder-held cannot be moved by a proposal.");
    expect(r.consultation.join(" ")).not.toContain("any dial,");
  });
});

describe("who is told when a vote opens", () => {
  it("the two openers that send no notice say so, and every other vote on the roll promises one", () => {
    const m = generateDecisionMatrix(inputs({ handoverComplete: true }));
    for (const s of [GOVERNANCE_MODE, GPS_CHANGE]) {
      const info = row(m, `vote:${s}`).information.join(" ");
      expect(info, s).not.toContain("told when it opens");
      expect(info, s).toContain(OPENED_WITHOUT_NOTICE[s]);
    }
    for (const key of [`vote:${VILLAGE_LAUNCH}`, `vote:${MINT_RULE}`, `vote:${CYCLE_SETTLEMENT}`, "vote:mechanics:routine", "move:role_seat"]) {
      expect(row(m, key).information[0], key).toContain("told when it opens");
    }
  });

  it("rests on a fact about the codebase: those two openers send the roll no ballot_opened notice", () => {
    const sends = (f: string) => /ballot_opened|notifyRoll\(/.test(fs.readFileSync(path.join(SRC_ROOT, f), "utf8"));
    // A known positive first, so an empty search cannot pass on a pattern that finds nothing anywhere.
    expect(sends("server/routes/powerHands.ts")).toBe(true);
    // The day either of these sends one, OPENED_WITHOUT_NOTICE has to lose it.
    expect(sends("server/routes/governanceMode.ts")).toBe(false);
    expect(sends("server/routes/governingPurpose.ts")).toBe(false);
    expect(Object.keys(OPENED_WITHOUT_NOTICE).sort()).toEqual([GOVERNANCE_MODE, GPS_CHANGE].sort());
  });
});

describe("the landing switch", () => {
  it("no row says nobody can stop a carried decision, and the notes name the switch that can hold every one", () => {
    for (const autoApplyEnabled of [true, false]) {
      for (const over of [{}, { steward: steward({ subjectsRaw: "none" }) }]) {
        const m = generateDecisionMatrix(inputs({ autoApplyEnabled, ...over }));
        for (const r of rows(m)) expect(allLines(r), r.key).not.toMatch(/nobody can stop it once it carries/i);
        expect(m.notes).toContain(applySwitchNote(autoApplyEnabled));
      }
    }
    expect(applySwitchNote(false)).toContain("is off, so every carried decision that waits for its window is held");
    expect(applySwitchNote(true)).toContain(`"${VARIABLES_BY_KEY["governance.auto_apply_enabled"].label}" is on`);
  });
});
