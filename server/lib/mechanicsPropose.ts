/**
 * FILING A PROPOSAL TO CHANGE THE GAME'S RULES, as one callable function
 * (moved out of server/index.ts by the canvas-frames-server lane, 2026-09-28).
 *
 *   POST /api/game/mechanics/proposals      server/index.ts calls this
 *   POST /api/canvas/proposals/:id/adopt    server/routes/canvasFrames.ts calls
 *                                           this for a dial door, after the
 *                                           Birthing
 *
 * Plan 2.3: after the Birthing, adopting a canvas answer that names a dial
 * files the proposal that would change it, and the village decides. That
 * proposal is exactly what this route has always filed, with its standing
 * check, its per-cycle ceiling, its change-set validation and its cooldown,
 * so the canvas door calls the same function rather than writing a second
 * mechanics row by hand. The body moved verbatim; only the response became a
 * returned status and body, and the INSERT moved to
 * server/repos/mechanicsProposals.ts.
 *
 * The person filing is the caller's `user`. On the canvas door that is the
 * member who pressed Adopt, so the proposal carries their standing and counts
 * against their ceiling, exactly as it would had they filed it here.
 */
import type { Pool } from "mysql2/promise";
import { timingOf } from "../../shared/governanceKinds";
import { currentCycle } from "./gratitude-cycles";
import { proposalsOpenedSince, validateChangeSet, type MintRuleValues } from "./mechanics";
import { numberVar, rawValue } from "./variables";
import { insertMechanicsProposal } from "../repos/mechanicsProposals";

export interface MechanicsProposeDeps {
  getPool(): Pool;
  /** The proposer's standing: `mechanicsStandingFor` in server/index.ts, the page's own reading. */
  standingFor(user: any): Promise<{ denied: boolean; qualified: boolean }>;
  /** The minting rules a change set names. */
  readMintRules(ruleIds: string[]): Promise<Map<string, MintRuleValues>>;
  addActivity(
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ): Promise<unknown>;
  firstName(name: string): string;
}

export interface MechanicsProposeAnswer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * File one proposal for `user`. `body` is the route's request body:
 * `{ title, rationale, changes, timing?, supersedesProposalId? }`.
 */
export async function openMechanicsProposal(
  deps: MechanicsProposeDeps,
  user: { id: string; name: string },
  body: any,
): Promise<MechanicsProposeAnswer> {
  const { getPool, standingFor, readMintRules, addActivity, firstName } = deps;
  const standing = await standingFor(user);
  if (standing.denied) {
    return { status: 403, body: { error: "A standing warning currently suspends your proposal rights. Talk to a steward" } };
  }
  // Rate limit rides the CYCLE, like the economy it governs.
  const cycleStart = new Date(currentCycle().startsAt);
  const opened = await proposalsOpenedSince(getPool(), user.id, cycleStart);
  const cap = Math.max(1, numberVar("governance.proposals_per_member_per_cycle"));
  if (opened >= cap) {
    return { status: 429, body: { error: `You have opened ${opened} proposal(s) this cycle. The village's ceiling is ${cap}. Supporting others' proposals is never limited.` } };
  }
  const title = String(body?.title ?? "").trim().slice(0, 200);
  const rationale = String(body?.rationale ?? "").trim().slice(0, 8000);
  if (!title) return { status: 400, body: { error: "Give the proposal a title" } };
  if (!rationale) return { status: 400, body: { error: "Say why. The village votes on reasons, not numbers" } };
  const cooldown = Math.max(0, numberVar("governance.change_cooldown_days"));
  const { problems, normalized } = await validateChangeSet(
    getPool(),
    Array.isArray(body?.changes) ? body.changes : [],
    rawValue,
    cooldown,
    readMintRules,
  );
  if (problems.length) return { status: 400, body: { error: "The change-set has problems", problems } };
  const id = `gmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const status = standing.qualified ? "open" : "draft";
  // The proposer's timing (0172), frozen onto the ballot at open. Absent
  // means next_moon, the founder's default.
  await insertMechanicsProposal(getPool(), {
    id,
    title,
    rationale,
    changeSet: normalized,
    proposerUserId: user.id,
    status,
    timing: timingOf(body?.timing),
    supersedesProposalId: String(body?.supersedesProposalId ?? "").trim().slice(0, 64) || null,
  });
  if (status === "open") {
    await addActivity("governance", `${firstName(user.name)} proposed a change to the game's rules: ${title}`, {
      actorUserId: user.id, entityType: "mechanics_proposal", entityRef: id,
    });
  }
  return {
    status: 200,
    body: {
      id,
      status,
      message:
        status === "open"
          ? "Your proposal is open. The village can now weigh in."
          : "Saved as a draft: you are below the proposer bar, so it opens as soon as a qualified member sponsors it.",
    },
  };
}
