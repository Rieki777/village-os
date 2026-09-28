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
  generateDecisionMatrix,
  MOVING_DECISIONS,
  RISK_TAG_NOTE,
  RISK_TAGS,
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
import { HANDOVER_SET } from "./capabilities";
import { dialsForMethod, TIER_FLOORS, type Criticality, type MethodDials } from "./governanceEngine";
import { SEAT_SUBJECTS } from "./governanceKinds";
import { GPS_CHANGE } from "./governingPurpose";
import { CYCLE_SETTLEMENT } from "./moonSettlement";
import { VARIABLES_BY_KEY } from "./gameVariables";
import { mayVeto, stewardVetoTiersFrom } from "../server/lib/stewardship";
import { pricingOf } from "../server/lib/mechanics";
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

/** A fresh village on the shipped settings, governance on for members, holding nothing. */
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
    for (const r of powers) expect(r.approval.who, r.key).toBe("admin-panel");
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
    expect(row(m, "power:dial.set").consultation.join(" ")).toContain("Any member can propose a change to any dial");
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
    for (const key of [`vote:${VILLAGE_LAUNCH}`, `vote:${CYCLE_SETTLEMENT}`, "move:power_transfer", "move:role_seat"]) {
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
    for (const over of [{}, { defaultMethod: "consent" }, { governanceOnForMembers: false }, { handoverComplete: true }]) {
      const text = JSON.stringify(generateDecisionMatrix(inputs(over)));
      expect(text).not.toContain("%");
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/\b\d+ of \d+\b/);
    }
  });
});
