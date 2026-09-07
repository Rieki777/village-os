/**
 * THE DRY RUN: what this proposal would do, and what would stop it, before
 * anybody votes on it.
 *
 * ── WHY IT SHARES THE VALIDATOR ────────────────────────────────────────────
 *
 * A preview that walks the change set with its own reading of the rules is a
 * second opinion, and a second opinion about whether a proposal can apply is
 * worse than no opinion: a village votes on a preview that says yes, and the
 * executor says no three days later with the vote already spent. So this calls
 * `validateElements` from `server/lib/changeset.ts`, which is the SAME phase 1
 * the executor runs. The thing it previews is the thing that will run.
 *
 * ── WHY IT IS NOT server/lib/dryRun.ts ─────────────────────────────────────
 *
 * There is already a `server/lib/dryRun.ts` and it is about something else
 * entirely (the economy's settlement preview). Two files called dry run, one of
 * them 746 lines about mint rules, is how a lane ends up editing the wrong one.
 *
 * ── WHAT IT NEVER DOES ─────────────────────────────────────────────────────
 *
 * Write anything. Phase 1 of the executor writes nothing by construction, and
 * this module adds no write of its own: no ledger row, no notification, no
 * status flip, no element row. A dry run that left a trace would be a way to
 * change the world by asking a question.
 */
import {
  validateElements,
  type ChangesetDeps,
  type ValidatedElement,
} from "./changeset";
import { asChangeItem, type ChangeInput } from "./mechanics";
import { defaultTimingFor, kindOfSet, landingFor, timingOf, vetoHoursFrom, type GovernanceKind, type ProposalTiming } from "../../shared/governanceKinds";

export interface DryRunElement {
  index: number;
  kind: string;
  sentence: string;
  oldValue: string | null;
  newValue: string;
}

export interface DryRunResult {
  /** True when every element would apply. */
  wouldApply: boolean;
  /** What each element would do, in the order the executor would do it. */
  elements: DryRunElement[];
  /** The element that would stop it, when one would. */
  blocker: { index: number; kind: string; problem: string; sentence: string } | null;
  /** Whether this whole set sends tokens or changes the Game. */
  kind: GovernanceKind;
  /** The timing the proposer chose. */
  timing: ProposalTiming;
  /** The instant it would land, given a close at `closesAt`, or null for at-close. */
  landsAt: string | null;
  /** The sentence explaining the landing, in the member's words. */
  landing: string;
}

export interface DryRunInput {
  changes: readonly ChangeInput[];
  timing?: unknown;
  /** The instant the vote would close, so the preview can name a real date. */
  closesAt: Date;
  vetoHours: number;
  /** The first boundary of the ACTIVE clock strictly after an instant. */
  nextBoundaryAfter: (after: Date) => Date;
  /** True when the set moves a number the running cycle is settled against. */
  snapsToBoundary?: (changeSet: readonly unknown[]) => boolean;
}

/**
 * Preview a change set. Nothing is written and nothing is decided.
 *
 * The landing instant is a PREVIEW and says so: it is computed from the close
 * this proposal would have if it opened now, and the real one is stamped from
 * the ballot's own frozen `closes_at` when it carries. Showing a member a date
 * before the vote exists is worth the caveat, because "when would this happen"
 * is the first thing anybody asks.
 */
export async function dryRunProposal(deps: ChangesetDeps, input: DryRunInput): Promise<DryRunResult> {
  const itemKinds = input.changes.map((c) => {
    try {
      return asChangeItem(c).kind as string;
    } catch {
      return "unknown";
    }
  });
  const kind = kindOfSet(itemKinds);
  // The default is the KIND's, so a preview of a payout that says nothing shows
  // the instant it would actually execute at rather than a moon away.
  const timing = timingOf(input.timing, defaultTimingFor(kind));
  const landing = landingFor({
    closesAt: input.closesAt,
    kind,
    timing,
    vetoHours: vetoHoursFrom(input.vetoHours),
    nextBoundaryAfter: input.nextBoundaryAfter,
    snapToBoundary: input.snapsToBoundary ? input.snapsToBoundary(input.changes) : false,
  });

  const validated = await validateElements(deps, input.changes);
  if (!validated.ok) {
    return {
      wouldApply: false,
      elements: [],
      blocker: {
        index: validated.index,
        kind: validated.itemKind,
        problem: validated.problem,
        sentence: validated.sentence,
      },
      kind,
      timing,
      landsAt: landing.landsAt ? landing.landsAt.toISOString() : null,
      landing: landing.because,
    };
  }

  return {
    wouldApply: true,
    elements: validated.elements.map((e: ValidatedElement) => ({
      index: e.index,
      kind: e.item.kind,
      sentence: e.sentence,
      oldValue: e.oldValue,
      newValue: e.newValue,
    })),
    blocker: null,
    kind: validated.kind,
    timing,
    landsAt: landing.landsAt ? landing.landsAt.toISOString() : null,
    landing: landing.because,
  };
}
