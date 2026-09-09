/**
 * WHAT A CYCLE DOES TO POWER.
 *
 * Section 22 split the dry run in two. The economics session owns everything
 * that moves balances: settlement, mint rules, allowances, sinks, exits, the
 * pool. This model owns thresholds, weights, concentration and reachability,
 * and its `step` is the identity on every balance in the village. A governance
 * model that moved money would be a second author of the ledger.
 *
 * ── IT READS THE ENGINE'S OWN HELPERS, AND NONE OF THEM ARE COPIED ─────────
 *
 * `thresholdSettingsFrom`, `highestTier`, `floorForCriticality` and
 * `stalemateWarning` are all pure already: every one of them takes the dials
 * as arguments or takes a reader function, because `shared/governanceEngine.ts`
 * and `shared/ballotSubjects.ts` were written so the surface that previews a
 * bar and the route that stamps it read one arithmetic. So this model calls
 * them and restates nothing. The bar a member sees in a preview is the bar the
 * close will apply, by construction.
 *
 * ── THE THREE THINGS IT SAYS ───────────────────────────────────────────────
 *
 * CONCENTRATION. One holder's share of the voice against the quorum of the
 * highest tier the village has set. When a single member clears that bar on
 * their own, every question in the village is theirs, and a percentage on an
 * admin page says none of that.
 *
 * REACHABILITY. The audit's fourth risk arriving from the other side: a tier
 * whose quorum asks for more weight than the members who can still answer
 * hold between them cannot pass, ever, and a village finds that out by
 * proposing something and watching it die at quorum.
 *
 * STALEMATE. The sentence `stalemateWarning` already holds, fired here on the
 * numbers this village actually runs, so it reaches a member who is reading a
 * preview and never opened the admin control that also shows it.
 */
import { floorForCriticality, highestTier, thresholdSettingsFrom, type ThresholdSettings } from "../ballotSubjects";
import { CRITICALITIES, stalemateWarning, type Criticality } from "../governanceEngine";
import { shareOfTotal, topShares } from "../governanceShare";
import type { DomainModel, Flag, MemberSpec, SimState, Violation } from "./types";

/** The keys this model reads. Named once so a rename is one edit. */
export const WEIGHT_MODE_KEY = "governance.weight_mode";
export const WEIGHT_TOKEN_KEY = "governance.weight_token";
export const VILLAGE_UNITY_KEY = "governance.unity_pct";
export const VILLAGE_QUORUM_KEY = "governance.quorum_pct";

/** A hair of tolerance, because a percentage of a sum lands just under it. */
const EPSILON = 1e-9;

/** The village's threshold settings, read out of the snapshot's variables. */
export function settingsOf(state: SimState): ThresholdSettings {
  return thresholdSettingsFrom(
    (key: string) => Number(state.variables[key] ?? 0) || 0,
    (key: string) => String(state.variables[key] ?? ""),
  );
}

/**
 * Every member's voting weight, resolved the way `weightsFor` resolves it and
 * from the snapshot instead of from a pool.
 *
 *   equal   one each.
 *   token   the member's balance of the weight token, in minor units.
 *   custom  the member's allocation, and an absent one is zero, which is how
 *           the live resolver fails closed: nobody holds power an admin never
 *           assigned.
 *
 * Negatives floor at zero here, the same clamp the live resolver applies. The
 * invariant below is what notices that the clamp had something to do.
 */
export function weightsOf(state: SimState): Map<string, number> {
  const mode = String(state.variables[WEIGHT_MODE_KEY] ?? "equal");
  const slug = String(state.variables[WEIGHT_TOKEN_KEY] ?? "");
  const out = new Map<string, number>();
  for (const member of state.members) {
    out.set(member.id, Math.max(0, rawWeightOf(state, member, mode, slug)));
  }
  return out;
}

function rawWeightOf(state: SimState, member: MemberSpec, mode: string, slug: string): number {
  if (mode === "token") {
    const account = state.balances[member.accountId] ?? {};
    const held = account[slug];
    return held === undefined ? 0 : Number(held);
  }
  if (mode === "custom") return Number(member.weight ?? 0);
  return 1;
}

/** The roll's whole weight. */
export function totalWeightOf(weights: ReadonlyMap<string, number>): number {
  let total = 0;
  weights.forEach((w) => {
    total += w;
  });
  return total;
}

/** The weight held by members who can still answer a ballot. */
export function votableWeightOf(state: SimState, weights: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const member of state.members) {
    if (member.absent) continue;
    total += weights.get(member.id) ?? 0;
  }
  return total;
}

/** A percentage said the way a member reads one. */
function pct(n: number): string {
  return String(Math.round((Number(n) || 0) * 100) / 100);
}

function amount(n: number): string {
  return String(Math.round((Number(n) || 0) * 100) / 100);
}

/**
 * The governance model.
 *
 * A function and not a constant, so a later lane can hand it the village's own
 * posture without every caller changing shape.
 */
export function governanceModel(): DomainModel {
  return {
    name: "governance",

    /**
     * The identity on every balance. It advances the governance clock, which
     * is the only state this model owns, and touches nothing else.
     */
    step(state: SimState): SimState {
      return {
        ...state,
        governance: { ...state.governance, cyclesElapsed: state.governance.cyclesElapsed + 1 },
      };
    },

    flags(state: SimState, cycle: number): Flag[] {
      const out: Flag[] = [];
      const settings = settingsOf(state);
      const top = highestTier(settings);
      const topDials = floorForCriticality(top, settings);
      const weights = weightsOf(state);
      const total = totalWeightOf(weights);

      // ── Concentration ────────────────────────────────────────────────────
      const biggest = topShares(weights as ReadonlyMap<string, number>, 1);
      if (biggest.length > 0 && total > 0 && topDials.quorumPct > 0) {
        const share = biggest[0].share * 100;
        if (share > topDials.quorumPct + EPSILON) {
          out.push({
            code: "weight_concentration",
            severity: "danger",
            cycle,
            sentence:
              `One member holds ${pct(share)}% of this village's voting weight, and the ${top} tier asks for ` +
              `${pct(topDials.quorumPct)}% to show up. One holder alone clears the top tier.`,
            actionable:
              "Look at how the weight token is spread, or at which tier the village decides its hardest questions at.",
          });
        }
      }

      // ── Reachability ─────────────────────────────────────────────────────
      const votable = votableWeightOf(state, weights);
      const away = state.members.filter((m) => m.absent).length;
      if (total > 0) {
        for (const tier of CRITICALITIES) {
          const dials = floorForCriticality(tier as Criticality, settings);
          const needed = (dials.quorumPct / 100) * total;
          if (needed <= votable + EPSILON) continue;
          out.push({
            code: "tier_unreachable",
            severity: "danger",
            cycle,
            sentence:
              `A ${tier} decision asks for ${pct(dials.quorumPct)}% of the weight to show up, which is ` +
              `${amount(needed)} of ${amount(total)}. ${away === 1 ? "One member has" : `${away} members have`} gone still, so ` +
              `at most ${amount(votable)} can answer and nothing at this tier can pass today.`,
            actionable:
              "Ask the members who have gone still to hand their voice on, or lower this tier before proposing anything at it.",
          });
        }
      }

      // ── Stalemate ────────────────────────────────────────────────────────
      const loudest = Math.max(
        topDials.unityPct,
        topDials.quorumPct,
        Number(state.variables[VILLAGE_UNITY_KEY] ?? 0) || 0,
        Number(state.variables[VILLAGE_QUORUM_KEY] ?? 0) || 0,
      );
      const warning = stalemateWarning(loudest);
      if (warning) {
        out.push({
          code: "stalemate_risk",
          severity: "warning",
          cycle,
          sentence: warning,
          actionable: "The village decides. This says what the number means on today's roll.",
        });
      }

      return out;
    },

    /**
     * TOTAL WEIGHT EQUALS THE SUM OF THE WEIGHT TOKEN'S BALANCES.
     *
     * Only in `token` mode, because it is only in `token` mode that the two
     * numbers have anything to do with each other: `equal` weighs one a head
     * and `custom` weighs an allocation table, and asserting a balance
     * identity over either would be asserting a coincidence.
     *
     * It is not the tautology it looks like. The weights are resolved through
     * the same clamp the live resolver applies, so a negative member balance
     * of the weight token counts as zero on the way through and stays
     * negative in the balances. The two totals then disagree, and that
     * disagreement is exactly the ledger's own rule that only faucet accounts
     * go negative, caught inside a preview instead of at settlement.
     */
    invariants(state: SimState): Violation[] {
      const mode = String(state.variables[WEIGHT_MODE_KEY] ?? "equal");
      if (mode !== "token") return [];
      const slug = String(state.variables[WEIGHT_TOKEN_KEY] ?? "");
      if (!slug) return [];
      const resolved = totalWeightOf(weightsOf(state));
      let held = 0;
      for (const member of state.members) {
        const account = state.balances[member.accountId] ?? {};
        const raw = account[slug];
        if (raw !== undefined) held += Number(raw);
      }
      if (Math.abs(resolved - held) <= EPSILON) return [];
      return [
        {
          invariant: "governance.weight_equals_balances",
          cycle: state.cycle,
          detail:
            `The roll resolves to ${amount(resolved)} of voting weight and the member accounts hold ` +
            `${amount(held)} ${slug} between them. A member account is carrying a negative balance of the token that weighs votes.`,
        },
      ];
    },
  };
}

/** Each member's share of the voice, for a surface that wants the whole map. */
export function sharesOf(state: SimState): Map<string, number> {
  return shareOfTotal(weightsOf(state) as ReadonlyMap<string, number>);
}
