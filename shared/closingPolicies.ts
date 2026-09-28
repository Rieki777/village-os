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
   * Whether what is left is shared by the contribution-token balances people
   * hold on closing day. When true, a member who redeems tokens gives up the
   * share those tokens would carry, and the redemption surface says so before
   * they ask (`redemptionClosingNotice`).
   */
  readsClosingDayBalances: boolean;
}

/** The ruling's words, kept exact: closing-day balance, and redemption already paid. */
export const PROPORTIONAL_CLOSING_STATEMENT =
  "On closing, the treasury and assets are shared among contribution-token holders in proportion to " +
  "the balances they hold on closing day. A member who already redeemed receives nothing more, " +
  "because redemption already paid them.";

export const CLOSING_POLICIES: Record<ClosingPolicyId, ClosingPolicyDef> = {
  "proportional-closing-balance": {
    id: "proportional-closing-balance",
    name: "Shared by closing-day balances",
    summary:
      "The platform's suggested default. What is left is shared in proportion to the contribution tokens each person holds on the day the village closes.",
    defaultStatement: PROPORTIONAL_CLOSING_STATEMENT,
    readsClosingDayBalances: true,
  },
  "own-words": {
    id: "own-words",
    name: "In the village's own words",
    summary:
      "The village names another way, in its own words. The platform keeps the statement and works nothing out from it.",
    defaultStatement: "",
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
const sameWords = (a: unknown, b: unknown): boolean =>
  String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() ===
  String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * What is wrong with a proposed section, as the sentence a founder reads, or
 * null when it may be saved.
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
 * closing-day balances. A draft does not count, because a draft is not what
 * the village promised; a policy in the village's own words does not count,
 * because the platform cannot know what it means for a redeemed token, and a
 * sentence claiming to would be the platform presuming a formula.
 *
 * Written so it is true of any token being redeemed: a redeemed token is
 * destroyed once a steward confirms, so it counts for nothing on closing day
 * whether or not the village would have counted it. "The share these tokens
 * would carry" is the ruling's point said plainly, and it is zero for a token
 * the village does not count, so the sentence never overstates.
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
  "carry then: once a steward confirms you were paid, they are destroyed and count for nothing on closing day.";
