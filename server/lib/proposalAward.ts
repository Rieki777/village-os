/**
 * WHAT AN ACCEPTED WORK WITH US PROPOSAL PAYS.
 *
 * Rye, 2026-10-23: "definitely a work token. GRATITUDE is only sent from player
 * to player using the send gratitude function, gratitude is not distributed in
 * any other way!" An accepted proposal used to mint
 * `gratitude.proposal_accept_award` (100) Gratitude from the recognition
 * faucet, and that dial is retired.
 *
 * Priced like a quest: the village's enabled `proposal.accepted` rules, through
 * `quoteWorkPay`, in full (no ceiling binds work), with the proposer's badge
 * multipliers. Seeded at Village Voice and Village Credits like a quest
 * (server/lib/economySeed.ts), and set on the Mint panel. One ledger row per
 * token, keyed on the submission, so a re-accept pays once.
 */
import type { Pool } from "mysql2/promise";
import { faucetFor, humanAtScale, mint, quoteWorkPay, rulesFor, type PayBoost } from "./economy";
import { tokenDef } from "./ledger";

/** The trigger an accepted proposal fires, in the dotted spelling of `mint_rules`. */
export const PROPOSAL_TRIGGER = "proposal.accepted";

/** One token an accepted proposal paid, as a member reads it. */
export interface ProposalPaid {
  token: string;
  name: string;
  amount: number;
}

export async function payAcceptedProposal(
  pool: Pool,
  p: { submissionId: string; userId: string; boost?: PayBoost },
): Promise<{ ok: boolean; paid: ProposalPaid[]; unpayable: Array<{ token: string; reason: string }> }> {
  const quote = quoteWorkPay(await rulesFor(pool, PROPOSAL_TRIGGER), null, "proposal", p.boost);
  const paid: ProposalPaid[] = [];
  let ok = true;
  for (const line of quote.lines) {
    const res = await mint(pool, {
      toUserId: p.userId,
      tokenSlug: line.token,
      amount: line.units,
      from: faucetFor(line.token)!,
      source: "proposal_accepted",
      sourceRef: p.submissionId,
      description: "Work With Us proposal accepted",
      // The token belongs in the key: one acceptance pays more than one token.
      idempotencyKey: `proposal_accepted:${p.submissionId}:${line.token}`,
    });
    if (!res.ok) {
      // Said where it happened, and the acceptance is not marked rewarded, so
      // a later accept retries; every key here makes a retry pay once.
      console.error(`[proposals] paying ${line.token} for submission ${p.submissionId} failed: ${res.error}`);
      ok = false;
      continue;
    }
    paid.push({ token: line.token, name: tokenDef(line.token)?.name ?? line.token, amount: humanAtScale(line.units, line.decimals) });
  }
  if (quote.unpayable.length) {
    console.error(`[proposals] submission ${p.submissionId}: ${quote.unpayable.map((u) => `${u.token}: ${u.reason}`).join("; ")}`);
  }
  return { ok, paid, unpayable: quote.unpayable };
}
