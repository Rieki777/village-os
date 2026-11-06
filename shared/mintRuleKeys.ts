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
 * A village that wants a different trigger asks for a NEW rule, which a
 * ballot can create (`mint-new:` below), and never for an edit that would
 * half apply.
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

/*
 * ── CREATING A RULE BY VOTE (vote-path gap 8, Rye 2026-11-06) ──────────────
 *
 * "EVERYTHING can change with the highest village vote." An edit names a rule
 * that exists, and nothing created one: the seed was the only writer, and no
 * admin route creates a rule either. So a village could vote on what a rule
 * paid and never on whether a rule should exist.
 *
 * A new rule is filed under its own prefix, `mint-new:<trigger>:<token>`, and
 * NEVER under `mint:`. An edit key parses into a rule id and a field, and a
 * create key names no rule yet, so letting the two share a prefix would make
 * every reader of `isMintRuleKey` guess which one it holds.
 *
 * The recipient is not on the ballot. Each trigger already has the one
 * recipient the engine pays for it (the seed's own pairing), and a recipient
 * the engine never reads for that trigger is a rule that pays nobody.
 */

/** The one prefix of a new rule. Never `mint:`, which is an edit. */
export const MINT_RULE_CREATE_KEY_PREFIX = "mint-new:";

/**
 * The triggers a vote may create a rule on: the three the engine actually
 * reads rules for (`rulesFor` is called with these and no others). A rule on
 * any other trigger would be a row the engine never consults, which is a
 * payment the village voted for and nobody receives. Same list as
 * `WORK_PAY_TRIGGERS` in shared/workValue.ts, spelled here so this file stays
 * free of imports.
 */
export const MINT_RULE_CREATE_TRIGGERS: readonly string[] = ["quest.completed", "role.cycle", "proposal.accepted"];

/** Who a rule on this trigger pays, the seed's own pairing. */
export function recipientForTrigger(trigger: string): "claimant" | "holder" {
  return trigger === "role.cycle" ? "holder" : "claimant";
}

/** A new rule's id, the seed's own scheme (`rule-<trigger>-<token>`). */
export function mintRuleIdFor(trigger: string, tokenSlug: string): string {
  return `rule-${trigger}-${tokenSlug}`;
}

/** The change-set key a new rule is filed under. */
export function mintRuleCreateKey(trigger: string, tokenSlug: string): string {
  return `${MINT_RULE_CREATE_KEY_PREFIX}${trigger}:${tokenSlug}`;
}

export function isMintRuleCreateKey(key: string): boolean {
  return typeof key === "string" && key.startsWith(MINT_RULE_CREATE_KEY_PREFIX);
}

/** A new rule as a change set carries it: strings, like every other value there. */
export interface MintRuleDraft {
  trigger: string;
  tokenSlug: string;
  /** A number, or `from-source`. */
  amount: string;
  ceiling: string;
}

/** `mint_rules.id` is varchar(64) and `token_slug` varchar(32). */
const TOKEN_SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * The half of a new rule's validation that needs no registry and no database.
 *
 * Null means acceptable. The token's own refusals (Gratitude, Hypha, an
 * example, a token with no faucet, an amount finer than the token holds) and
 * the "already exists" check need the registry and the table, so they live in
 * server/lib/mintRuleCreate.ts, which calls this first. Raise and landing both
 * go through that one function.
 */
export function mintRuleDraftProblem(draft: MintRuleDraft): string | null {
  const trigger = String(draft?.trigger ?? "").trim();
  const slug = String(draft?.tokenSlug ?? "").trim();
  if (!MINT_RULE_CREATE_TRIGGERS.includes(trigger)) {
    return `A new minting rule pays for finished quests, roles held, or accepted proposals. "${trigger}" is none of those.`;
  }
  if (!TOKEN_SLUG_SHAPE.test(slug)) return "Name the token by its slug, in lower case.";
  if (mintRuleIdFor(trigger, slug).length > 64) return "That token's slug is too long for a rule to be filed under it.";
  const amount = mintRuleValueProblem("amount", String(draft?.amount ?? ""));
  if (amount) return amount;
  return mintRuleValueProblem("ceiling", String(draft?.ceiling ?? ""));
}

/** How a new rule reads on a document. */
export function mintRuleCreateLabel(trigger: string, tokenSlug: string): string {
  return `a new rule paying ${tokenSlug} for ${trigger}`;
}
