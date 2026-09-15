/**
 * HOW A BALLOT NAMES A MINTING RULE (R81, R84).
 *
 * R81: after a village starts its Game, minting is a governance act. R84 says
 * how: the village votes on the RULES, and issuance then runs under rules the
 * village already set.
 *
 * Neither was reachable. A mint rule is a row in `mint_rules`, and the only
 * writer was `PATCH /api/admin/economy/rules/:id` behind `isAdmin`. The
 * governance side could not reach it either: `validateChangeSet` refuses any
 * key absent from `VARIABLES_BY_KEY`, and a mint rule is a row, never a dial,
 * so a proposal could not even NAME one. The seat payment of 20 gratitude and
 * 50 village voice per moon, the quest completion reward, every amount the
 * settlement job pays: numbers one admin typed, in a table no ballot could
 * address.
 *
 * ── WHY A KEY NAMESPACE AND NOT A NEW REGISTRY ──────────────────────────────
 *
 * The change set already exists, it is already validated as a whole, it is
 * already rendered into the frozen proposal document, it already has a support
 * threshold, a per-member cycle cap, a cooldown and an amendment ledger. Mint
 * rules needed an address inside it, so this file is the address.
 *
 *   mint:<ruleId>:<field>
 *
 * The colon is what makes the two vocabularies impossible to confuse. No key
 * in `VARIABLES_BY_KEY` contains one, and no mint rule id does either: ids are
 * `rule-<trigger>-<token>` where triggers are dotted and tokens are slugs. So
 * a key either parses here or it is a dial, and nothing has to guess.
 *
 * ── THE THREE FIELDS, AND THE ONES THAT ARE NOT HERE ────────────────────────
 *
 * `amount`, `ceiling` and `enabled` are exactly the three columns
 * `queueRuleChange` can move, so a key that parses here has a writer waiting
 * for it. `trigger`, `token_slug` and `recipient` are absent on purpose: those
 * three ARE the identity of the rule, the natural key `mint_rules_natural` is
 * built on two of them, and changing one is a different rule with the same id.
 * A village that wants a different trigger is asking for a rule this build
 * cannot create by ballot, and saying so is more honest than half applying it.
 */

/** The one prefix. A key starting with this is a mint rule and never a dial. */
export const MINT_RULE_KEY_PREFIX = "mint:";

/**
 * The columns a ballot may move, which is exactly what `queueRuleChange` can
 * write. Adding a fourth here without a writer would let a village vote for
 * something nothing applies.
 */
export const MINT_RULE_FIELDS = ["amount", "ceiling", "enabled"] as const;
export type MintRuleField = (typeof MINT_RULE_FIELDS)[number];

/**
 * The spelling of "read the amount from whatever posted the work".
 *
 * `mint_rules.amount` is nullable and NULL carries that meaning, so the change
 * set needs a word for it: a change set holds strings, and an empty string
 * would be indistinguishable from a field somebody left blank.
 */
export const AMOUNT_FROM_SOURCE = "from-source";

/**
 * The decimal places `mint_rules.amount` and `mint_rules.ceiling` keep.
 *
 * Both columns are `decimal(18,4)` (drizzle/0071_economy_core.sql), so a fifth
 * place is not stored, it is ROUNDED AWAY by the driver on the way in. The
 * column is the authority on this number and this constant is the one place
 * the rest of the build reads it from.
 */
export const MINT_RULE_PLACES = 4;

/**
 * The largest number a minting rule can carry, and it is a property of the
 * LANGUAGE before it is a property of the column.
 *
 * `decimal(18,4)` stops at 99999999999999.9999. A JavaScript number stops
 * sooner: checking a value against four decimal places means asking whether
 * `n * 10000` is a whole number, and doubles stop being able to answer that at
 * `Number.MAX_SAFE_INTEGER`. Above 900719925474.0991 the value cannot be
 * checked against the column at all, so the tighter of the two bounds is the
 * one that ships. Everything it refuses, the column either cannot hold or
 * cannot be shown to hold.
 *
 * Before this existed, a value at or above 1e14 passed every check here, was
 * queued, and threw an out-of-range error from the driver INSIDE the ballot
 * executor, after the village had already voted. A refusal at the raise costs
 * one retype; a throw at execution costs the whole proposal.
 */
export const MINT_RULE_MAX = Number.MAX_SAFE_INTEGER / 10 ** MINT_RULE_PLACES;

/**
 * What the column would actually store for this number.
 *
 * `toFixed` and never `Math.round(n * 10000) / 10000`: the spec pins `toFixed`
 * to the decimal string closest to the value, picking the larger on a tie,
 * which is the same half-up rounding MySQL applies to a `decimal` column. It
 * is also exact for every magnitude this function is asked about, where the
 * multiply-and-divide form loses the low bits as soon as `n * 10000` passes
 * 2^53 and would then call a whole number unstorable.
 */
function storedValue(n: number): number {
  return Number(n.toFixed(MINT_RULE_PLACES));
}

/**
 * Is this NUMBER acceptable for this field, said in the member's words.
 *
 * The numeric half of `mintRuleValueProblem`, split out so the two writers ask
 * one question. `mintRuleValueProblem` parses a change set's string and calls
 * this; `queueRuleChange` in server/lib/economy.ts is handed numbers by the
 * admin route and calls this directly. Two spellings of this bound is how the
 * ballot path and the admin path would come to disagree about what a village
 * may vote for.
 *
 * ── WHY THE ROUNDING CASES REFUSE, AND WHY NEITHER IS A WARNING ────────────
 *
 * Rye's standing ruling is that warnings never block and ride the proposal for
 * stewards to read. That ruling is about a decision the village CAN enact and
 * might regret. These two are a decision the village cannot enact at all:
 *
 *   0.00001 stores as 0.0000, so an amount the village voted above zero
 *   becomes an off switch and a ceiling becomes a refusal. Nobody voted for
 *   either. A warning riding a proposal that pays nobody is a note attached to
 *   a broken rule.
 *
 *   1.00001 stores as 1.0000, so the row holds a number nobody typed. The
 *   sentence names the number the column would hold, which turns a silent
 *   reshaping into one retype.
 *
 * There is also nowhere for a warning to ride today. `validateChangeSet`
 * (server/lib/mechanics.ts) carries `problems` and nothing else, and the
 * proposal document renders that list; a warning channel is a change to the
 * governance side's files and its own decision. Said out loud here so the day
 * that channel lands, the 1.00001 case is the one to move onto it.
 */
export function mintRuleNumberProblem(field: Exclude<MintRuleField, "enabled">, n: number): string | null {
  if (!Number.isFinite(n)) return "This one takes a number.";
  if (field === "amount" && !(n > 0)) {
    return `An amount is greater than zero, or "${AMOUNT_FROM_SOURCE}" to read it from whatever posted the work.`;
  }
  if (field === "ceiling" && n < 0) return "A ceiling is zero or more, and zero means zero.";
  if (Math.abs(n) > MINT_RULE_MAX) {
    return `A minting rule holds numbers up to ${MINT_RULE_MAX}, and ${n} is above that. Ask for less.`;
  }
  const stored = storedValue(n);
  if (stored === n) return null;
  const smallest = 1 / 10 ** MINT_RULE_PLACES;
  if (n > 0 && stored === 0) {
    return (
      `A minting rule keeps ${MINT_RULE_PLACES} decimal places, so ${n} would be stored as nothing at all ` +
      `and this rule would pay nobody. Ask for ${smallest} or more.`
    );
  }
  return (
    `A minting rule keeps ${MINT_RULE_PLACES} decimal places, so ${n} would be stored as ${stored}. ` +
    `Ask for ${stored}, or for a number with no more than ${MINT_RULE_PLACES} decimal places.`
  );
}

export interface ParsedMintRuleKey {
  ruleId: string;
  field: MintRuleField;
}

/** Compose one. The single place the key's shape is written down. */
export function mintRuleKey(ruleId: string, field: MintRuleField): string {
  return `${MINT_RULE_KEY_PREFIX}${ruleId}:${field}`;
}

/** Cheap enough for a filter, and it answers only what it is asked. */
export function isMintRuleKey(key: string): boolean {
  return key.startsWith(MINT_RULE_KEY_PREFIX);
}

/**
 * Read one, or null.
 *
 * Null is returned for a key that carries the prefix and nothing this build
 * can use, so a caller that has already filtered on `isMintRuleKey` still has
 * to handle the miss. A guess here would move a rule nobody named.
 */
export function parseMintRuleKey(key: string): ParsedMintRuleKey | null {
  if (!isMintRuleKey(key)) return null;
  const rest = key.slice(MINT_RULE_KEY_PREFIX.length);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0 || cut === rest.length - 1) return null;
  const ruleId = rest.slice(0, cut);
  const field = rest.slice(cut + 1);
  if (!(MINT_RULE_FIELDS as readonly string[]).includes(field)) return null;
  return { ruleId, field: field as MintRuleField };
}

/**
 * Is this value acceptable for this field, said in the member's words.
 *
 * Null means acceptable. The same three sentences `queueRuleChange` refuses
 * with, checked here at RAISE so a proposal that could never apply never
 * reaches a vote, and checked again there at EXECUTION because the row can
 * move between the two.
 */
export function mintRuleValueProblem(field: MintRuleField, raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (field === "enabled") {
    return value === "true" || value === "false"
      ? null
      : "This one is on or off, so the value has to be true or false.";
  }
  if (field === "amount" && value === AMOUNT_FROM_SOURCE) return null;
  const n = Number(value);
  if (value === "" || !Number.isFinite(n)) return "This one takes a number.";
  // Everything the number itself decides is decided ONCE, in the function the
  // admin route's writer calls too. Sign, range and what the column would keep
  // of it all live there. See `mintRuleNumberProblem` for why the two rounding
  // cases refuse instead of riding the proposal as warnings.
  return mintRuleNumberProblem(field, n);
}

/**
 * The number a field's string carries, or null for "read it from the source".
 * Callers have already run `mintRuleValueProblem`, so this parses and never
 * validates: two opinions about what a value means is how they disagree.
 */
export function mintRuleValueNumber(field: MintRuleField, raw: string): number | null {
  const value = String(raw ?? "").trim();
  if (field === "amount" && value === AMOUNT_FROM_SOURCE) return null;
  return Number(value);
}

/**
 * One spelling per value, so "already has that value" is a real comparison.
 *
 * `mint_rules.amount` is `decimal(18,4)`, so the row reads back as 20 and a
 * proposal typed as "20.0000" is the same number in a different costume. Left
 * alone, the no-op check would let a change that changes nothing go to a vote,
 * and the village would decide something that was already true. Callers have
 * run `mintRuleValueProblem` first, so this normalises and never validates.
 */
export function normalizeMintRuleValue(field: MintRuleField, raw: string): string {
  const value = String(raw ?? "").trim();
  if (field === "enabled") return value === "true" ? "true" : "false";
  if (field === "amount" && value === AMOUNT_FROM_SOURCE) return AMOUNT_FROM_SOURCE;
  return String(Number(value));
}

/** How a field is written on a proposal document and on the decision page. */
export const MINT_RULE_FIELD_LABEL: Record<MintRuleField, string> = {
  amount: "how much it pays",
  ceiling: "the most it can pay",
  enabled: "whether it pays at all",
};

/** A value as a member reads it, never as the column stores it. */
export function displayMintRuleValue(field: MintRuleField, raw: string): string {
  const value = String(raw ?? "").trim();
  if (field === "enabled") return value === "true" ? "On" : "Off";
  if (field === "amount" && value === AMOUNT_FROM_SOURCE) return "however much the work was posted for";
  return value;
}
