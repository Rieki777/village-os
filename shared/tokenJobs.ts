/**
 * WHICH TOKEN DOES WHICH JOB, IN ONE LIST (Rye, 2026-10-22).
 *
 * "In admin we should set what token is responsible (if at all) for any of
 * these functions." Each job already has exactly one place that decides it: a
 * dial, the mint rules, the exchange's own settings, or the code. This file
 * names the jobs and the shape that reports them; it decides nothing and
 * stores nothing. The admin screen reads `GET /api/admin/token-jobs`
 * (server/lib/tokenJobs.ts) and changes a job through the door that already
 * owns it, so there is never a second record of which token does what.
 *
 * NO LABEL SAYS WHAT A TOKEN DOES (Rye, 2026-10-22: "every community will
 * design their own rules for these and other tokens so don't mention what it
 * does anywhere"). A label names the job and nothing else.
 */

export const TOKEN_JOB_IDS = [
  "work.quest",
  "work.role",
  "thanks",
  "pool.payout",
  "pool.basis",
  "vote.weight",
  "redemption",
  "exchange",
  "hypha.claim",
  "proposal.award",
  "stays",
  "dues",
  "revenue.share",
] as const;

export type TokenJobId = (typeof TOKEN_JOB_IDS)[number];

/** The job's name on the admin screen. Keyed by the union, so a new job cannot ship without one. */
export const TOKEN_JOB_LABELS: Record<TokenJobId, string> = {
  "work.quest": "Quests",
  "work.role": "Roles, each cycle",
  thanks: "Thanks between members",
  "pool.payout": "The cycle pool",
  "pool.basis": "How the cycle pool is shared",
  "vote.weight": "Vote weight",
  redemption: "Redemption",
  exchange: "The exchange",
  "hypha.claim": "Claims on Hypha",
  "proposal.award": "Accepted Work With Us proposals",
  stays: "Stays",
  dues: "Village dues",
  "revenue.share": "Revenue share",
};

/**
 * Where a job is decided, which is where the admin screen sends a change.
 *
 *   dial         a game variable, changed through the variables route
 *   mint_rules   the enabled rules on one trigger, changed on the Mint panel
 *   exchange     the exchange's per-token settings
 *   module       a module's own declaration (`sellsToken` in shared/modules.ts)
 *   code         fixed in the platform; no setting changes it
 *   nothing      no token does this job, and nothing in the platform could
 */
export type TokenJobSource =
  | { kind: "dial"; key: string }
  | { kind: "mint_rules"; trigger: string }
  | { kind: "exchange" }
  | { kind: "module"; module: string }
  | { kind: "code"; where: string }
  | { kind: "nothing" };

/** One token doing a job, by slug and its live registry name. */
export interface TokenJobToken {
  slug: string;
  name: string;
}

export interface TokenJob {
  id: TokenJobId;
  label: string;
  /**
   * Every token doing this job right now. Empty means none does, which is a
   * real answer for a village and never an error. A list, because some jobs
   * are done by several at once: a quest can pay two tokens, and two tokens
   * can be claimed on Hypha.
   */
  tokens: TokenJobToken[];
  setBy: TokenJobSource;
  /** Whether a village can change which token does this job without a code change. */
  assignable: boolean;
  /** The module the job belongs to and its lifecycle, when it belongs to one. A job in a module that is off is not running. */
  module: { id: string; lifecycle: string } | null;
}
