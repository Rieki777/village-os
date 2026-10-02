/**
 * THE DECISION MATRIX, SERVED (plan 2.3 and 7 item 3; 2026-09-27).
 *
 *   GET /api/canvas/decision-matrix   the village's members: the platform's
 *                                     half of the canvas's Decision Matrix
 *
 * The rows come from `generateDecisionMatrix` (shared/decisionMatrix.ts),
 * which reads the rules the platform enforces. This file reads the village's
 * own state and hands it in: the default method and the dials, the tier
 * settings, whether governance is on for members, the steward's reach, and
 * who holds each transferable power today. Nothing is stored and nothing is
 * cached, so the matrix is as current as the settings it reads.
 *
 * ── WHO MAY READ: THE SAME PEOPLE AS THE CANVAS ────────────────────────────
 *
 * `mayReadCanvas` (server/routes/canvas.ts): a member the village has
 * admitted, or an admin. A visitor with no session gets 401, and a signed-in
 * account the village has not admitted gets 403 and the canvas's own
 * sentence. Rye ruled on 2026-09-25 that villagers see every dial, the admin
 * ones included, and this read gates nothing on a power: seeing who decides
 * is not a power anybody holds.
 *
 * ── EVERY READ IS ONE THE GATE ALREADY MAKES ───────────────────────────────
 *
 *   who holds a power     `capabilityHoldings`, the table the gate reads
 *   the handover          `villageHandoverState`, the purpose pen's own reader
 *   people who can act    `liveHoldersOf`, counted the way the gate counts,
 *                         with the admin short-circuit left out
 *   the roles carrying it `rolesCarrying`, the same test as the counter
 *   the steward's reach   `mayVeto` and `stewardVetoTiersFrom`, the parsers the
 *                         landing loop and the veto route use
 *   how a moon settles    `settlementModeFrom` over cycle.settlement_mode, the
 *                         moon proposer's own reading
 *   whether it started    `readGameStart`, the fact the minting-rule editor asks
 *   the landing switch    governance.auto_apply_enabled, as the landing job reads it
 *
 * The two holder readers are passed in from server/index.ts, where their
 * caches live, the way server/routes/powerHands.ts takes them.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { thresholdSettingsFrom } from "../../shared/ballotSubjects";
import { HANDOVER_SET, type Capability } from "../../shared/capabilities";
import { generateDecisionMatrix, type DecisionMatrixInputs, type PowerHolding } from "../../shared/decisionMatrix";
import { LIFECYCLE_RANK } from "../../shared/modules";
import { settlementModeFrom } from "../../shared/moonSettlement";
import { capabilityHoldings, villageHandoverState } from "../lib/capabilityHolding";
import { POWERS } from "../lib/capabilityRegistry";
import { readGameStart } from "../lib/gameStart";
import { effectiveLifecycle } from "../lib/modules";
import {
  mayVeto,
  STEWARD_COUNCIL_KEY,
  STEWARD_SUBJECTS_KEY,
  STEWARD_VETO,
  STEWARD_VETO_TIERS_KEY,
  stewardVetoTiersFrom,
  VETO_HOURS_KEY,
} from "../lib/stewardship";
import { boolVar, numberVar, stringVar } from "../lib/variables";
import { CANVAS_MEMBERS_ONLY, mayReadCanvas } from "./canvas";

export interface DecisionMatrixDeps extends Pick<AppDeps, "authedUser" | "isAdmin" | "hasMembership" | "getPool"> {
  /** Every member who holds this power today, counted the way the gate counts. */
  liveHoldersOf(capability: string): Promise<string[]>;
  /** The roles whose capability list carries this power. */
  rolesCarrying(capability: string): Array<{ id: string; name: string }>;
}

/** What the page is told when the holdings cannot be read. */
export const MATRIX_UNREADABLE = "Who holds the village's powers could not be read just now, so the matrix is not shown.";

/** Everything the generator needs, read from this village as it stands. */
export async function readMatrixInputs(deps: DecisionMatrixDeps): Promise<DecisionMatrixInputs> {
  const pool = deps.getPool();
  const [holdings, handover, start] = await Promise.all([
    capabilityHoldings(pool),
    villageHandoverState(pool),
    readGameStart(pool),
  ]);
  const held = new Map(holdings.map((h) => [h.capability, h]));
  const titles = new Map(POWERS.map((p) => [p.capability, p.title]));
  const counted = await Promise.all(HANDOVER_SET.map((cap) => deps.liveHoldersOf(cap)));

  const powers: PowerHolding[] = HANDOVER_SET.map((cap: Capability, i) => {
    const row = held.get(cap);
    return {
      capability: cap,
      villageHolds: !!row,
      holderRoleName: row ? row.holderRoleName : null,
      liveHolders: counted[i].length,
      rolesCarrying: deps.rolesCarrying(cap).map((r) => r.name),
      title: titles.get(cap),
    };
  });

  const subjectsRaw = stringVar(STEWARD_SUBJECTS_KEY);
  const stewardIndex = HANDOVER_SET.indexOf(STEWARD_VETO);
  const stewardsSeated = stewardIndex >= 0 ? counted[stewardIndex].length : (await deps.liveHoldersOf(STEWARD_VETO)).length;

  return {
    defaultMethod: stringVar("governance.default_method"),
    village: {
      unityPct: Math.max(0, numberVar("governance.unity_pct")),
      quorumPct: Math.max(0, numberVar("governance.quorum_pct")),
    },
    settings: thresholdSettingsFrom((key) => numberVar(key), (key) => stringVar(key)),
    governanceOnForMembers: LIFECYCLE_RANK[effectiveLifecycle("governance")] >= LIFECYCLE_RANK.members,
    supportThreshold: Math.max(0, numberVar("governance.proposal_support_threshold")),
    sensingDays: numberVar("governance.sensing_days"),
    steward: {
      seated: stewardsSeated,
      council: boolVar(STEWARD_COUNCIL_KEY),
      vetoHoursRaw: numberVar(VETO_HOURS_KEY),
      subjectInReach: (subjectType) => mayVeto(subjectType, subjectsRaw),
      tiersInReach: stewardVetoTiersFrom(stringVar(STEWARD_VETO_TIERS_KEY)),
    },
    handoverComplete: handover.complete,
    powers,
    settlementMode: settlementModeFrom(stringVar("cycle.settlement_mode")),
    gameStarted: start.started,
    autoApplyEnabled: boolVar("governance.auto_apply_enabled"),
  };
}

export function register(app: Express, deps: DecisionMatrixDeps): void {
  app.get("/api/canvas/decision-matrix", async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await mayReadCanvas(deps, req, user))) return res.status(403).json({ error: CANVAS_MEMBERS_ONLY });
    let inputs: DecisionMatrixInputs;
    try {
      inputs = await readMatrixInputs(deps);
    } catch (e) {
      console.error("[decision-matrix] the village's holdings could not be read", e);
      return res.status(503).json({ error: MATRIX_UNREADABLE });
    }
    res.json(generateDecisionMatrix(inputs));
  });
}
