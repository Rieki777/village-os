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
import { canConfirm, faucetFor, humanAtScale, mint, quoteWorkPay, rulesFor, type PayBoost } from "./economy";
import { oweProposalCash } from "./cashOwed";
import type { WorkValue } from "../../shared/workValue";
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

/**
 * When a Work With Us proposal is accepted, fold it into the game for a
 * matching member: a logged contribution, the work tokens the village pays
 * for an accepted proposal, and a pulse. Idempotent.
 *
 * NEVER GRATITUDE (Rye, 2026-10-23): "GRATITUDE is only sent from player to
 * player using the send gratitude function, gratitude is not distributed in
 * any other way!" This minted `gratitude.proposal_accept_award` (100) from
 * the recognition faucet; it pays the `proposal.accepted` rules now
 * (server/lib/proposalAward.ts), with the member's badge multipliers.
 *
 * A STEWARD MAY NOT PAY THEMSELVES THROUGH THIS DOOR. `canConfirm` in
 * server/lib/economy.ts already states the rule for the whole build: "A
 * steward may not witness their own work. Confirming releases value, so it
 * must be structurally impossible to do it for yourself, admin included."
 * This path releases value and did not ask. Anyone holding `intake.moderate`
 * could send a Work With Us proposal in their own name, accept it, and pay
 * themselves. Once per submission, and nothing bounds how many submissions a
 * person sends.
 *
 * The acceptance itself still stands. Whether a steward may accept their own
 * proposal at all is a question for the village, and this is not the place to
 * answer it. What stops here is the payment, and the route says so, because a
 * refusal nobody is told about teaches nothing.
 *
 * MOVED HERE FROM server/index.ts with the cash line (0285), unchanged
 * otherwise. That file is on a ratchet that turns one way, and the four
 * closures this used from it arrive as `deps` instead.
 */
export interface AcceptRewardDeps {
  members: {
    byId(id: string): Promise<any | null>;
    byEmail(email: string): Promise<any | null>;
    update(id: string, mutate: (u: any) => void): Promise<any | null>;
  };
  /** The proposer's badge multipliers, read with the season's sleeping badges. */
  boostFor(userId: string): Promise<PayBoost>;
  /** The village pulse line, through the event spine. */
  activity(text: string, actorUserId: string, submissionId: string): Promise<void>;
}

const firstName = (name: string): string => String(name ?? "").trim().split(/s+/)[0] || "Someone";

export async function applyAcceptReward(
  pool: Pool,
  deps: AcceptRewardDeps,
  entry: any,
  acceptedByUserId: string | null,
  cash: WorkValue | null = null,
): Promise<{ rewarded: boolean; refused?: string }> {
  const { members } = deps;
  if (entry.rewarded) return { rewarded: false };
  const email = String(entry.data?.email ?? "").toLowerCase();
  const match =
    (entry.userId ? await members.byId(entry.userId) : null) ??
    (email ? await members.byEmail(email) : null);
  if (!match) return { rewarded: false }; // not a registered member; nothing to fold in
  // The same rule the mint already enforces, restated where this mint happens
  // so a new caller cannot route around it.
  //
  // Called with no actor, this refuses too, and that is the point.
  // `canConfirm` answers "a confirmation needs a named steward" for an empty
  // one, so an unattributed accept withholds the payment. Every live path
  // here has an actor: the route sits behind `guardCapability`, which cannot
  // pass without a signed-in user. A future caller that loses the actor meets
  // a refusal it has to read, and inventing a witness to get past it is the
  // one thing that must stay hard.
  const witness = canConfirm(match.id, acceptedByUserId ?? "");
  if (!witness.ok) {
    return {
      rewarded: false,
      refused:
        "The proposal is accepted. The payment for it waits for another steward, " +
        "because this proposal is yours.",
    };
  }
  const paid = await payAcceptedProposal(pool, {
    submissionId: String(entry.id),
    userId: match.id,
    boost: await deps.boostFor(match.id),
  });
  if (!paid.ok) return { rewarded: false };
  // 0285: the cash the steward stated on accepting it, owed once the payment goes through.
  await oweProposalCash(pool, { submissionId: String(entry.id), userId: match.id, title: String(entry.data?.work ?? "Work With Us proposal"), cash });
  const updated = await members.update(match.id, (u: any) => {
    u.contributions = u.contributions ?? [];
    u.contributions.push({
      id: `contrib-${Date.now()}`,
      type: "proposal",
      description: `Work With Us proposal accepted: ${String(entry.data?.work ?? "your offering").slice(0, 120)}`,
      // No Gratitude: what the acceptance paid, token by token.
      recognitionEarned: 0,
      paid: paid.paid,
      date: new Date().toISOString(),
    });
  });
  if (!updated) return { rewarded: false };
  await deps.activity(`${firstName(updated.name)}'s proposal was welcomed into the village`, updated.id, String(entry.id));
  return { rewarded: true };
}
