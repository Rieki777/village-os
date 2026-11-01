/**
 * A member's one next step, picked from the ordered rules in GAME_CONFIG.
 *
 * ── A GUEST WHO SIGNED WAS TOLD TO SIGN AGAIN ──────────────────────────────
 *
 * The membership rule read `hasMembership` alone. Signing the letter does not
 * admit anybody: the village answers it, by an admin or an `intake.moderate`
 * holder accepting the row (`shared/membershipSigning.ts` says why). So from
 * the moment a guest signed until somebody answered, "Your next step" on their
 * profile and the Trail on every page told them to "Sign the Love Letter",
 * for a letter they had already signed. The signing was readable the whole
 * time: `/api/game/progression` already serves it as `signing`.
 *
 * Now a signing the village has not answered reads as its own step, which says
 * the letter is with the village and offers something to do meanwhile. A
 * signing the village said no to reads as no signing at all, because signing
 * again is how a person asks again. Every judgement here is pure, so a test
 * holds it with the real rules and no server.
 *
 * ── WHY THIS IS NOT IN server/index.ts ─────────────────────────────────────
 *
 * That file may not grow (scripts/check-server-index-size.mjs). It gathers the
 * member's facts and hands them here.
 */
import type { NextActionRule } from "../../shared/gameConfig";
import { signingOf } from "../../shared/membershipSigning";

/**
 * Where a guest stands with the letter.
 *
 *   unsigned   no signing, or one the village said no to: signing is the step
 *   waiting    signed, and the village has not answered yet
 *   null       the letter is not this member's step at all: they hold
 *              membership already, or this village does not serve the letter
 */
export type Joining = "unsigned" | "waiting" | null;

/** A guest's standing with the letter, read off the submissions the server already holds. */
export function joiningOf(submissions: readonly unknown[], userId: unknown): Exclude<Joining, null> {
  return signingOf(submissions, userId)?.answer === "waiting" ? "waiting" : "unsigned";
}

/** What the rules are evaluated against, gathered by the caller. */
export interface NextActionFacts {
  trained: boolean;
  joining: Joining;
  claims: ReadonlyArray<{ status?: unknown }>;
  budget: { remaining: number; total: number };
  /** True only while the gene-keys module is on and this member has saved no lines. Absent means "not asked". */
  geneKeysMissing?: boolean;
}

/** True when this rule is the member's step, given their facts. */
function applies(when: NextActionRule["when"], f: NextActionFacts): boolean {
  switch (when) {
    case "no-training": return !f.trained;
    case "membership-waiting": return f.joining === "waiting";
    case "no-membership": return f.joining === "unsigned";
    case "no-quest-claimed": return f.claims.length === 0;
    case "no-gene-keys": return f.geneKeysMissing === true;
    case "quest-in-progress": return f.claims.some((c) => c.status === "claimed" || c.status === "submitted");
    case "gratitude-unspent": return f.budget.remaining > 0 && f.budget.total > 0;
    case "always": return true;
  }
}

/**
 * BEFORE LAUNCH, A FOUNDER'S NEXT STEP IS THE VILLAGE ITSELF. The member rules
 * above told a founder of a village with no members yet to do the training,
 * which is a step for someone joining, not for someone still setting the place
 * up (the founder-path pass of 2026-11-01). While founder power stands (the
 * village has not voted to start its Game), a founder or admin is sent to the
 * setup game, which lists everything the village still needs; after launch
 * they get the member rules like everyone else.
 */
export const FOUNDER_SETUP_STEP = { id: "founder-setup", label: "Set up your village", href: "/setup-game" } as const;

export function founderStepFor(role: unknown, founderPowerStands: boolean): typeof FOUNDER_SETUP_STEP | null {
  return founderPowerStands && (role === "founder" || role === "admin") ? FOUNDER_SETUP_STEP : null;
}

/** The first rule that applies, in order; the last rule when none does. */
export function pickNextAction<R extends NextActionRule>(rules: readonly R[], facts: NextActionFacts): R {
  return rules.find((rule) => applies(rule.when, facts)) ?? rules[rules.length - 1];
}
