/**
 * A NEW MINTING RULE, BY VOTE (vote-path gap 8, Rye 2026-11-06:
 * "EVERYTHING can change with the highest village vote").
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * A village could vote on what an existing rule pays (`mint:<id>:<field>`,
 * shared/mintRuleKeys.ts) and never on whether a rule exists. The seed is the
 * only writer of a new row (server/lib/economySeed.ts says so: "no route
 * creates a mint rule"), so a village that wanted to pay a token it had not
 * been seeded with had nowhere to ask. There is no admin create route to reuse
 * either, so the validation here is assembled from the refusals the platform
 * already makes elsewhere, each named where it comes from:
 *
 *   the shape            `mintRuleDraftProblem`   shared/mintRuleKeys.ts
 *   the numbers          `mintRuleNumberProblem`  the same bound an edit takes
 *   the token's step     `mintAmountStepProblem`  moved out of `queueRuleChange`
 *   Gratitude            `GRATITUDE_ONLY_SENT`    shared/workValue.ts
 *   an example token     `EXAMPLE_REFUSAL`        server/lib/examples.ts
 *   Hypha, retired, no faucet  `ruleCannotPay`   server/lib/economy.ts
 *
 * ── ONE FUNCTION, ASKED TWICE ───────────────────────────────────────────────
 *
 * `newMintRuleProblem` is what `validateChangeSet` is handed at RAISE, and
 * `createMintRule` asks it again at LANDING, because a token can be retired,
 * marked an example, or seeded with a rule of its own between the two. A
 * refusal at landing writes nothing and lands in the set's `failed` list,
 * which keeps the proposal unapplied.
 *
 * ── THE NEXT MOON ───────────────────────────────────────────────────────────
 *
 * A new rule starts paying at the next moon, the same deferral every edit
 * gets: the row is written now with `effective_from_cycle` set to the next
 * cycle, and `rulesFor` reads only rules whose cycle has come. Nothing is paid
 * at the new rule inside the moon the village voted in.
 */
import type { Pool } from "mysql2/promise";
import { GRATITUDE_ONLY_SENT } from "../../shared/workValue";
import {
  mintRuleDraftProblem,
  mintRuleIdFor,
  mintRuleValueNumber,
  recipientForTrigger,
  type MintRuleDraft,
} from "../../shared/mintRuleKeys";
import { HEARTS, mintAmountStepProblem, ruleCannotPay, villageId } from "./economy";
import { EXAMPLE_REFUSAL } from "./examples";
import { currentCycleNumber } from "./gratitude-cycles";
import { tokenDef } from "./ledger";
import { insertMintRuleRow, mintRuleRowById, mintRuleRowByNaturalKey } from "../repos/mintRuleRows";

const clean = (d: MintRuleDraft): MintRuleDraft => ({
  trigger: String(d?.trigger ?? "").trim(),
  tokenSlug: String(d?.tokenSlug ?? "").trim(),
  amount: String(d?.amount ?? "").trim(),
  ceiling: String(d?.ceiling ?? "").trim(),
});

/**
 * Why this new rule could not be created, or null.
 *
 * Every refusal the token itself carries comes before the table is read, so a
 * vote to mint Gratitude is refused for being Gratitude and never for some
 * accident of what the table holds.
 */
export async function newMintRuleProblem(pool: Pool, input: MintRuleDraft): Promise<string | null> {
  const draft = clean(input);
  const shape = mintRuleDraftProblem(draft);
  if (shape) return shape;
  if (draft.tokenSlug === HEARTS) return GRATITUDE_ONLY_SENT;
  const def = tokenDef(draft.tokenSlug);
  if (!def) return `There is no token called "${draft.tokenSlug}" in this village's registry.`;
  if (def.isExample) return `${def.name} is one of the platform's example tokens, so no rule may pay it. ${EXAMPLE_REFUSAL}`;
  const cannot = ruleCannotPay(draft.tokenSlug);
  if (cannot) return `A rule on this token could not pay anybody: ${cannot}.`;
  const amount = mintRuleValueNumber("amount", draft.amount);
  if (amount !== null) {
    const step = mintAmountStepProblem(draft.tokenSlug, amount);
    if (step) return step;
  }
  const existing = await mintRuleRowByNaturalKey(pool, villageId(), draft.trigger, draft.tokenSlug);
  if (existing) {
    return `This village already has a rule paying ${def.name} for ${draft.trigger}. Change that one instead, which a proposal can do too.`;
  }
  const clash = await mintRuleRowById(pool, mintRuleIdFor(draft.trigger, draft.tokenSlug));
  if (clash) return "A rule is already filed under that name. Change that one instead.";
  return null;
}

export type CreateMintRuleResult =
  | { ok: true; ruleId: string; fromCycle: number; alreadyThere: boolean }
  | { ok: false; error: string };

/**
 * Land a carried vote's new rule.
 *
 * IDEMPOTENT. The executor skips an element whose ledger row says it already
 * landed, and beyond that a rule already filed under this id with exactly
 * these numbers is the same rule, so a retry that reaches here reports it and
 * writes nothing. Anything else already there is a refusal.
 */
export async function createMintRule(
  pool: Pool,
  input: MintRuleDraft,
  actorUserId: string,
  at: Date = new Date(),
): Promise<CreateMintRuleResult> {
  const draft = clean(input);
  const ruleId = mintRuleIdFor(draft.trigger, draft.tokenSlug);
  const amount = mintRuleValueNumber("amount", draft.amount);
  const ceiling = Number(draft.ceiling);
  const same = (r: any): boolean =>
    !!r &&
    String(r.id) === ruleId &&
    String(r.trigger) === draft.trigger &&
    String(r.token_slug) === draft.tokenSlug &&
    (r.amount === null ? amount === null : Number(r.amount) === amount) &&
    Number(r.ceiling) === ceiling;

  const there = await mintRuleRowById(pool, ruleId);
  if (same(there)) return { ok: true, ruleId, fromCycle: Number(there!.effective_from_cycle), alreadyThere: true };

  const problem = await newMintRuleProblem(pool, draft);
  if (problem) return { ok: false, error: problem };

  const fromCycle = currentCycleNumber(at) + 1;
  const wrote = await insertMintRuleRow(pool, {
    id: ruleId,
    villageId: villageId(),
    trigger: draft.trigger,
    tokenSlug: draft.tokenSlug,
    amount,
    ceiling,
    recipient: recipientForTrigger(draft.trigger),
    effectiveFromCycle: fromCycle,
    note: `Created by a village vote. Queued by ${actorUserId}.`.slice(0, 280),
  });
  if (!wrote) {
    const raced = await mintRuleRowById(pool, ruleId);
    if (same(raced)) return { ok: true, ruleId, fromCycle: Number(raced!.effective_from_cycle), alreadyThere: true };
    return { ok: false, error: "Another rule took this rule's place while the vote was landing. Nothing was written." };
  }
  return { ok: true, ruleId, fromCycle, alreadyThere: false };
}
