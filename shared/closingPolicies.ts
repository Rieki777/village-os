/**
 * WHAT CLOSING THIS VILLAGE MEANS: the named closing policies a village can
 * choose from, and the rules every surface reads them by.
 *
 * Rye, 2026-09-25: "before you launch the village you have to articulate what
 * it means to close a village ... they can name another but regardless one
 * does need to be agreed to name upon before launching." Four things follow,
 * and this file is where each one is held:
 *
 *   1. CLOSING IS PART OF THE EXIT AND CLOSING POLICY. The village's answer is
 *      a `closing` section inside the `exit-policy` document
 *      (server/lib/exitPolicy.ts), beside the terms for a member leaving. It
 *      is not a separate feature and it has no table of its own.
 *   2. IT IS A LAUNCH REQUIREMENT. `closing-policy-named` in
 *      shared/launchRequirements.ts blocks the launch vote until a section is
 *      adopted, resolved in server/lib/launch.ts by `closingNamed` below.
 *   3. THE DEFAULT IS ONE NAMED POLICY A VILLAGE SELECTS, never a rule it
 *      inherits. Asked "same amount each, or proportional to tokens held", Rye
 *      answered proportional; asked "lifetime contributions, or the balance on
 *      the day", he answered "Closing day balance, if they've already redeemed
 *      their tokens and they've already cashed out their contributions."
 *   4. THE METHOD IS THE VILLAGE'S. "It's up to every village to decide if
 *      they're gonna use token holdings to distribute contributions or some
 *      other method and there could be a lot." So the platform presumes no
 *      formula, and a village that names something else says it in its own
 *      words.
 *
 * ── A REGISTRY, SO THE FIRST POLICY IS NOT SPECIAL ────────────────────────
 *
 * "As we continue to add features into this, we can add and build new ways of
 * doing exit and closing processes and policies." A policy added later is one
 * more entry in `CLOSING_POLICIES`: the editor lists it, the member page names
 * it, and `readsClosingDayBalances` says whether redeeming gives up a share
 * under it. Nothing anywhere branches on the id of the first one.
 *
 * ── A POLICY'S NAME FOLLOWS ITS WORDS ─────────────────────────────────────
 *
 * The statement stays editable under every policy, and the name, the launch
 * row and the redemption notice all read the policy id. So a named policy
 * carries `keepsSentence`: the sentence its words must still contain for its
 * name to be true of them. Under the default, "Land is sold first." added to
 * its words is still the default; words saying the land goes to a trust and
 * the cash is shared equally are another method, and filing them under the
 * default is refused, because the member page would then print "Shared by
 * closing-day balances" above them and the redemption screen would tell a
 * member a formula the village never adopted (review of 2026-09-27).
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 *
 * It computes nothing and moves nothing. There is no distribution engine and
 * no dial: a village closing is a human act, and what the platform owes it is
 * the written promise made before anybody needed it, plus a closing-day
 * balance anybody can read off the ledger. A policy the platform cannot
 * compute (the land to a trust, equal shares to everyone who lived here a
 * year) is exactly as valid as the default, because the statement IS the
 * policy.
 *
 * Isomorphic: the admin editor, the member page and the server all import it,
 * so the refusal a founder reads before pressing Save and the one the route
 * answers are the same sentence.
 */
import { countWords } from "./governingPurpose";

/** Every closing policy this platform names, in the order an editor lists them. */
export const CLOSING_POLICY_IDS = ["proportional-closing-balance", "own-words"] as const;

export type ClosingPolicyId = (typeof CLOSING_POLICY_IDS)[number];

export interface ClosingPolicyDef {
  id: ClosingPolicyId;
  /** What an admin picks, and the label a member reads above the words. */
  name: string;
  /** One sentence on what choosing it means, in the chooser. */
  summary: string;
  /**
   * The words the statement box fills with when this policy is chosen, or ""
   * when the village writes its own. A STARTING POINT AND NEVER THE ANSWER:
   * the section counts only once somebody adopts the words (`adoptedAt`),
   * which is the same rule `exit-policy-terms` holds the placeholder to.
   */
  defaultStatement: string;
  /**
   * The sentence the statement must keep for this policy's NAME to stay true
   * of it, or "" when the words are wholly the village's. Whitespace and case
   * are formatting, and the sentence may run on ("... on closing day, after
   * the debts are paid"). Anything may be added around it.
   */
  keepsSentence: string;
  /**
   * Whether what is left is shared by the contribution-token balances people
   * hold on closing day. When true, a member who redeems tokens gives up the
   * share those tokens would carry, and the redemption surface says so before
   * they ask (`redemptionClosingNotice`).
   */
  readsClosingDayBalances: boolean;
}

/** The default's first sentence, which IS the default: the words filed under it keep this. */
export const PROPORTIONAL_CLOSING_RULE =
  "On closing, the treasury and assets are shared among contribution-token holders in proportion to " +
  "the balances they hold on closing day.";

/** The ruling's words, kept exact: closing-day balance, and redemption already paid. */
export const PROPORTIONAL_CLOSING_STATEMENT =
  `${PROPORTIONAL_CLOSING_RULE} A member who already redeemed receives nothing more, ` +
  "because redemption already paid them.";

export const CLOSING_POLICIES: Record<ClosingPolicyId, ClosingPolicyDef> = {
  "proportional-closing-balance": {
    id: "proportional-closing-balance",
    name: "Shared by closing-day balances",
    summary:
      "The platform's suggested default. What is left is shared in proportion to the contribution tokens each person holds on the day the village closes.",
    defaultStatement: PROPORTIONAL_CLOSING_STATEMENT,
    keepsSentence: PROPORTIONAL_CLOSING_RULE,
    readsClosingDayBalances: true,
  },
  "own-words": {
    id: "own-words",
    name: "In the village's own words",
    summary:
      "The village names another way, in its own words. The platform keeps the statement and works nothing out from it.",
    defaultStatement: "",
    keepsSentence: "",
    readsClosingDayBalances: false,
  },
};

/** The registry entry for an id, or null for anything the registry does not name. */
export function closingPolicyDef(id: unknown): ClosingPolicyDef | null {
  return typeof id === "string" && (CLOSING_POLICY_IDS as readonly string[]).includes(id)
    ? CLOSING_POLICIES[id as ClosingPolicyId]
    : null;
}

/**
 * The closing section as it is STORED in the exit-policy document.
 *
 * `adoptedBy` is the account that adopted the words and `adoptedAt` when.
 * Both are null on a draft, and a draft is not a named policy. Absent as a
 * whole means the village has not started, which is every exit policy saved
 * before this section existed, live Amora's among them.
 */
export interface ClosingSection {
  policyId: string;
  statement: string;
  adoptedBy: string | null;
  adoptedAt: string | null;
}

/** The section as readers get it: who adopted it stays in the record and out of the page. */
export type ClosingSectionForReaders = Omit<ClosingSection, "adoptedBy">;

/**
 * Fewest words that can say who receives what is left and how.
 *
 * A floor against "tbd" and "x", never a quality bar: the shortest honest
 * answers people actually give ("the land goes to a trust and the cash to
 * whoever is still here") clear it easily.
 */
export const CLOSING_MIN_WORDS = 8;

/** A statement longer than this is a document, and belongs in the agreements. */
export const CLOSING_MAX_CHARS = 5000;

/** Whitespace and case are formatting, never new words. */
const plain = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const sameWords = (a: unknown, b: unknown): boolean => plain(a) === plain(b);

/**
 * Whether the words still say what the chosen policy's name says, which is
 * whether they contain its `keepsSentence`. True for a policy with no such
 * sentence and for an id the registry does not know (that refusal is
 * `closingStatementProblem`'s first). The sentence's closing full stop is
 * dropped before the search, so the village may run the sentence on.
 */
export function closingWordsKeepTheirPolicy(policyId: unknown, statement: unknown): boolean {
  const keep = closingPolicyDef(policyId)?.keepsSentence ?? "";
  return !keep || plain(statement).includes(plain(keep).replace(/\.$/, ""));
}

/**
 * What is wrong with a proposed section, as the sentence a founder reads, or
 * null when it may be saved.
 *
 * Words filed under a named policy must keep the sentence that policy stands
 * for (`closingWordsKeepTheirPolicy`), or its name, the launch row and the
 * redemption notice would each claim something the words do not say.
 *
 * `own-words` holding the default's words, word for word, is refused. The
 * default is one choice away, and choosing it is what tells a member about to
 * redeem that the policy reads closing-day balances. The same words filed as
 * the village's own would say the same thing on the page and keep that
 * sentence off the redemption screen.
 */
export function closingStatementProblem(policyId: unknown, statement: unknown): string | null {
  const def = closingPolicyDef(policyId);
  if (!def) return "Choose one of the named ways, or choose to write your own.";
  const text = typeof statement === "string" ? statement.trim() : "";
  if (!text) return "Write what closing means here. The statement is what every member reads.";
  if (text.length > CLOSING_MAX_CHARS) {
    return `Keep it under ${CLOSING_MAX_CHARS} characters. A longer text belongs in an agreement the village adopts.`;
  }
  const words = countWords(text);
  if (words < CLOSING_MIN_WORDS) {
    return `Say it in at least ${CLOSING_MIN_WORDS} words: who receives what is left, and how it is worked out.`;
  }
  if (!closingWordsKeepTheirPolicy(def.id, text)) {
    return `Words saved as "${def.name}" keep the sentence that choice stands for: "${def.keepsSentence}" Add to it as you like. To name another way, choose to write your own.`;
  }
  if (def.id === "own-words" && sameWords(text, PROPORTIONAL_CLOSING_STATEMENT)) {
    return "These are the default's words. Choose the default itself, so a member about to redeem is told what it means for them.";
  }
  return null;
}

/** An ISO instant that parses, or null. A stamp that cannot be read is not a stamp. */
const instant = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" && Number.isFinite(Date.parse(v)) ? v : null;

/**
 * WHETHER THE VILLAGE HAS NAMED WHAT CLOSING MEANS.
 *
 * Named means three things at once: a policy the registry knows, words that
 * pass the same check the editor runs, and an adoption on record. The words
 * alone never count, which is the rule that stops the pre-filled default from
 * passing as a decision nobody made.
 *
 * Reads either shape, stored or served, so the launch check, the member page
 * and the redemption notice all ask the one question. Anything that is not a
 * section (absent, null, a string some release wrote) is simply not named.
 */
export function closingNamed(section: unknown): boolean {
  if (!section || typeof section !== "object") return false;
  const s = section as Partial<ClosingSection>;
  return closingStatementProblem(s.policyId, s.statement) === null && instant(s.adoptedAt) !== null;
}

/**
 * The section as a READER receives it, or undefined when there is none.
 *
 * `adoptedBy` is an account id, and the exit policy is published to anybody
 * with the link, signed in or not. The record keeps who adopted the words;
 * the page says when. Every other field passes through as stored, so a reader
 * sees a draft as a draft.
 */
export function closingForReaders(section: unknown): ClosingSectionForReaders | undefined {
  if (!section || typeof section !== "object" || Array.isArray(section)) return undefined;
  const s = section as Partial<ClosingSection>;
  return {
    policyId: typeof s.policyId === "string" ? s.policyId : "",
    statement: typeof s.statement === "string" ? s.statement : "",
    adoptedAt: instant(s.adoptedAt),
  };
}

/**
 * The sentence the redemption screen shows before a member asks, or null
 * when it does not apply.
 *
 * It applies exactly when the village has NAMED a policy that shares by
 * closing-day balances, and named means its adopted words still carry that
 * policy's sentence (`closingNamed` asks `closingStatementProblem`), so the
 * notice can never claim a formula the words dropped. A draft does not count, because a draft is not what
 * the village promised; a policy in the village's own words does not count,
 * because the platform cannot know what it means for a redeemed token, and a
 * sentence claiming to would be the platform presuming a formula.
 *
 * Written so it is true of any token being redeemed: a redeemed token is
 * destroyed once the redemption is confirmed, so it counts for nothing on
 * closing day whether or not the village would have counted it. "The share
 * these tokens would carry" is the ruling's point said plainly, and it is zero
 * for a token the village does not count, so the sentence never overstates.
 *
 * IT NAMES NOBODY AS THE ONE WHO CONFIRMS (Wave 2 audit, 2026-09-28). It used
 * to say "once a steward confirms you were paid", and a village where nobody
 * holds `redemption.confirm` decides each redemption by a village vote
 * (`confirmModeFor` in server/lib/redemption.ts), which is every fresh
 * village. The panel then showed "this one goes to a village vote" and "once
 * a steward confirms" a few lines apart. The confirmation, by a steward or by
 * the vote, is what destroys the tokens, so the sentence says that and stops.
 */
export function redemptionClosingNotice(section: unknown): string | null {
  if (!closingNamed(section)) return null;
  const def = closingPolicyDef((section as ClosingSection).policyId);
  if (!def?.readsClosingDayBalances) return null;
  return CLOSING_REDEMPTION_NOTICE;
}

/** The notice itself, exported so a test can find it on the screen by its words. */
export const CLOSING_REDEMPTION_NOTICE =
  "This village's closing policy shares what is left, if the village ever closes, among contribution-token " +
  "holders in proportion to what they hold on closing day. Redeeming gives up the share these tokens would " +
  "carry then: once your redemption is confirmed, they are destroyed and count for nothing on closing day.";
