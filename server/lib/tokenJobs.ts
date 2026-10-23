/**
 * WHICH TOKEN DOES WHICH JOB, READ FROM THE PLACES THAT DECIDE IT (Rye, 2026-10-22).
 *
 * Every answer here is read from the one place that already decides that job:
 * the enabled mint rules, a dial, the exchange's settings, the claim lanes, a
 * module's declaration, or the code. Nothing is stored, so this list cannot
 * disagree with what the engine does. The shape and the labels are in
 * shared/tokenJobs.ts; the admin screen changes a job through its `setBy` door.
 *
 * Three jobs are FIXED IN CODE today, and the list says so instead of offering a
 * control that would do nothing: thanks between members and the basis the cycle
 * pool is shared on both run on the recognition token (`HEARTS` in
 * server/lib/economy.ts, about twenty call sites), and the claim lanes to Hypha
 * are declared in server/lib/voiceClaim.ts.
 */
import type { Pool } from "mysql2/promise";
import { HEARTS, rulesFor } from "./economy";
import { exchangeSettings } from "./exchange";
import { allTokens, tokenDef } from "./ledger";
import { effectiveLifecycle } from "./modules";
import { redeemableTokens } from "./redemption";
import { numberVar, stringVar } from "./variables";
import { CLAIM_LANES } from "./voiceClaim";
import { payableTokens } from "./workPay";
import { MODULES_BY_ID } from "../../shared/modules";
import { TOKEN_JOB_LABELS, type TokenJob, type TokenJobId, type TokenJobSource, type TokenJobToken } from "../../shared/tokenJobs";

const named = (slug: string): TokenJobToken => ({ slug, name: tokenDef(slug)?.name ?? slug });

/** Distinct slugs in first-seen order, each with its live name. */
function tokensOf(slugs: readonly string[]): TokenJobToken[] {
  const seen: string[] = [];
  for (const s of slugs) if (s && !seen.includes(s)) seen.push(s);
  return seen.map(named);
}

function job(
  id: TokenJobId,
  tokens: TokenJobToken[],
  setBy: TokenJobSource,
  assignable: boolean,
  moduleId: string | null = null,
): TokenJob {
  return {
    id,
    label: TOKEN_JOB_LABELS[id],
    tokens,
    setBy,
    assignable,
    module: moduleId ? { id: moduleId, lifecycle: effectiveLifecycle(moduleId) } : null,
  };
}

/** Every job, in the order the admin screen lists them. */
export async function tokenJobs(pool: Pool): Promise<TokenJob[]> {
  const [questRules, roleRules, exchange] = await Promise.all([
    rulesFor(pool, "quest.completed"),
    rulesFor(pool, "role.cycle"),
    exchangeSettings(pool),
  ]);

  // Vote weight: one person, one vote is no token at all.
  const weighted = String(stringVar("governance.weight_mode")) === "token";
  // The proposal award mints the recognition token; an award of 0 is no token.
  const award = Math.max(0, numberVar("gratitude.proposal_accept_award"));
  const staysToken = MODULES_BY_ID.stays?.sellsToken ?? null;

  return [
    // The tokens a quest or a role can be paid in: an enabled rule the engine can
    // honour, Gratitude never (server/lib/workPay.ts). The same list the editor offers.
    job("work.quest", tokensOf(payableTokens(questRules).map((t) => t.token)), { kind: "mint_rules", trigger: "quest.completed" }, true, "quests"),
    job("work.role", tokensOf(payableTokens(roleRules).map((t) => t.token)), { kind: "mint_rules", trigger: "role.cycle" }, true),
    job("thanks", tokensOf([HEARTS]), { kind: "code", where: "server/lib/economy.ts HEARTS" }, false, "gratitude"),
    job("pool.payout", tokensOf([String(stringVar("gratitude.pool_token"))]), { kind: "dial", key: "gratitude.pool_token" }, true, "gratitude"),
    job("pool.basis", tokensOf([HEARTS]), { kind: "code", where: "server/lib/economy.ts HEARTS" }, false, "gratitude"),
    job(
      "vote.weight",
      weighted ? tokensOf([String(stringVar("governance.weight_token"))]) : [],
      { kind: "dial", key: "governance.weight_token" },
      true,
    ),
    job("redemption", tokensOf(redeemableTokens(allTokens()).map((t) => t.slug)), { kind: "dial", key: "redemption.tokens" }, true, "redemption"),
    job(
      "exchange",
      tokensOf(exchange.filter((s) => !s.isExample && s.active && (s.purchasable || s.swappable)).map((s) => s.tokenSlug)),
      { kind: "exchange" },
      true,
      "exchange",
    ),
    job("hypha.claim", tokensOf(CLAIM_LANES.map((l) => l.token)), { kind: "code", where: "server/lib/voiceClaim.ts CLAIM_LANES" }, false, "hypha"),
    job("proposal.award", award > 0 ? tokensOf([HEARTS]) : [], { kind: "dial", key: "gratitude.proposal_accept_award" }, false),
    job("stays", staysToken ? tokensOf([staysToken]) : [], { kind: "module", module: "stays" }, false, "stays"),
    job("dues", [], { kind: "nothing" }, false),
    job("revenue.share", [], { kind: "nothing" }, false),
  ];
}
