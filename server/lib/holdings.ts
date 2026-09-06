/**
 * WHAT A MEMBER HAS, AND WHAT A MEMBER CAN SPEND.
 *
 * Those are two numbers and this codebase has only ever published one of them.
 * `token_balances` is the SPENDABLE figure: every escrow in the platform works
 * by moving the tokens OUT of the member's account into a holding account, so
 * the moment a deposit is taken the member's balance falls and nothing anywhere
 * says why.
 *
 * The founder's case, in his words: a member with seventy library credits and
 * fifty locked in a camera has twenty to spend and seventy to their name. Today
 * the library page prints twenty, the Borrow button refuses, and the sentence
 * the member meets is about credits they can plainly remember earning.
 *
 * ── THE FOURTH READING ─────────────────────────────────────────────────────
 *
 * A holdings surface needs FOUR facts and not three, and cramming the fourth
 * into the third is what produced the defect:
 *
 *   spendable  what `token_balances` says, which is what a spend can draw on
 *   locked     what is held against something, out of the account
 *   total      the two added, which is what a member calls "mine"
 *   locks      WHY, one entry per thing holding tokens, each naming the thing
 *
 * The fourth is the one that turns a refusal into an instruction. A number
 * cannot say "return the camera"; only a row that knows the camera can.
 *
 * ── AN EMPTY STATE, A REAL ZERO AND A FULLY LOCKED BALANCE ─────────────────
 *
 * Three different facts, and the shape here keeps them apart on purpose.
 * `holdingFor` ALWAYS returns an object, so a caller that asked about a token
 * and got zeros knows it asked; a slug missing from `holdingsFor` was never
 * asked about. Within an answer, `total === 0` is a real zero and
 * `total > 0 && spendableUnits === 0` is fully locked, which is the state a
 * member is most likely to meet and least likely to understand.
 *
 * ── WHERE THE LOCKS COME FROM, AND WHY THE ROWS AND NOT THE ACCOUNTS ───────
 *
 * Three holding accounts in this codebase hold a member's tokens against
 * something: `sys:library-escrow` (a loan deposit), `sys:redemption-hold` (an
 * open redemption) and `sys:event-escrow` (a seat taken). Every one of them
 * POOLS the whole village, so no per-member figure can be read off a balance.
 * Each also keeps rows with the member on them, and each already has a
 * reconciliation function comparing the two. So the locks are read off the
 * ROWS, exactly as `heldForRedemption` reads them, and the reconciliation
 * functions stay the thing that says whether the rows and the accounts agree.
 *
 * ── UNITS ──────────────────────────────────────────────────────────────────
 *
 * MINOR units on every field whose name ends in `Units`, human on the twin
 * beside it, converted once here with `fromLedgerUnits` so that a render site
 * needs nothing from the route to be right. `library_loans`.`escrow_credits`
 * is the one column in the three that stores WHOLE credits, and it is
 * converted UP the way `escrowReconciliation` converts it, so the comparison
 * stays integer.
 *
 * NOTHING IN THIS FILE POSTS. It reads and it decides what a member is told,
 * the way `server/lib/spending.ts` and `server/lib/redemption.ts` open with the
 * same sentence.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { fromLedgerUnits, toLedgerUnits, villageId } from "./economy";
import { balancesFor, memberAccount, tokenDef } from "./ledger";

/** Which mechanism is holding the tokens. */
export type LockSource = "library-loan" | "redemption" | "event-seat";

/** One thing holding one member's tokens, and the sentence that says so. */
export interface TokenLock {
  source: LockSource;
  /** The loan, the redemption or the gathering. */
  ref: string;
  tokenSlug: string;
  /** MINOR units. */
  heldUnits: number;
  /** The same figure a person reads. */
  held: number;
  /** What the tokens are locked up with, named. */
  itemName: string;
  /** The whole sentence, ready to render. */
  sentence: string;
}

/** One token, read four ways. */
export interface TokenHolding {
  tokenSlug: string;
  tokenName: string;
  decimals: number;
  /** MINOR. What `token_balances` holds, which is what a spend may draw on. */
  spendableUnits: number;
  /** MINOR. Held against the locks below. */
  lockedUnits: number;
  /** MINOR. The two added. What a member calls theirs. */
  totalUnits: number;
  spendable: number;
  locked: number;
  total: number;
  locks: TokenLock[];
}

/**
 * THE FOUNDER'S SENTENCE, and it is his and not a paraphrase of his.
 *
 * "locked up with the Camera, return the camera to unlock these tokens"
 *
 * THE ITEM NAME GOES IN BOTH SLOTS VERBATIM, AND HE RULED IT. His example
 * lowercased the second occurrence; this lane kept the name as written in both
 * and flagged the difference rather than choosing silently, and he answered
 * "keep the capitalization". So this is no longer a departure to defend, it is
 * the ruling.
 *
 * The reason it was worth asking: lowercasing the second occurrence reproduces
 * his example exactly and mangles every real item name on the shelf. The seeded
 * catalogue holds "Cordless drill, 18V, two batteries", and lowercasing that
 * prints "18v". A capital letter is a smaller wrong than a mangled model
 * number, and a member meets the item under the name it carries on the shelf
 * either way.
 *
 * NO TRAILING PERIOD. It is a fragment the surface frames, which is the
 * contract every refusal sentence in `server/lib/redemption.ts` carries.
 */
export function lockedSentence(itemName: string): string {
  // "item" and not "the item". The template supplies the article, and the
  // fallback carrying its own printed "locked up with the the item" the first
  // time this was run.
  const named = String(itemName ?? "").trim() || "item";
  return `locked up with the ${named}, return the ${named} to unlock these tokens`;
}

/**
 * What an open redemption says while it waits.
 *
 * A redemption is not an item and it is not returned, so it gets its own
 * sentence instead of being forced through the founder's. Withdrawing is the
 * act that gives these back, and the sentence names it because a member
 * looking at a short balance needs the lever and not the diagnosis.
 */
export function redemptionLockSentence(): string {
  return "held against a redemption you have open, withdraw it to unlock these tokens";
}

/** What a seat taken at a gathering says while the gathering is still ahead. */
export function seatLockSentence(gathering: string): string {
  const named = String(gathering ?? "").trim() || "a gathering";
  return `held for your place at ${named}, and it settles when the gathering is over`;
}

// ── The three lock sources ─────────────────────────────────────────────────

const LIVE_LOAN_STATUSES = ["reserved", "pickup_pending", "active", "return_pending"] as const;

/**
 * Deposits this member has locked in items that are out.
 *
 * The status list and the `settled_at IS NULL` test are `escrowReconciliation`'s
 * own, character for character, because a lock this reads and that does not (or
 * the other way) is a drift between what a member is told and what the boot
 * invariant enforces.
 *
 * `escrow_credits` stores WHOLE credits, so it is converted UP here the way
 * that function converts it.
 */
export async function libraryLocksFor(pool: Pool, userId: string): Promise<TokenLock[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.`id`, l.`escrow_credits`, i.`name` FROM `library_loans` l " +
      "JOIN `library_items` i ON i.`id` = l.`item_id` " +
      `WHERE l.\`user_id\` = ? AND l.\`settled_at\` IS NULL AND l.\`escrow_credits\` > 0 ` +
      `AND l.\`status\` IN (${LIVE_LOAN_STATUSES.map(() => "?").join(",")}) ORDER BY l.\`created_at\``,
    [userId, ...LIVE_LOAN_STATUSES],
  );
  return rows.map((r) => {
    const heldUnits = toLedgerUnits("library-credit", Number(r.escrow_credits ?? 0));
    const itemName = String(r.name ?? "");
    return {
      source: "library-loan" as const,
      ref: String(r.id),
      tokenSlug: "library-credit",
      heldUnits,
      held: fromLedgerUnits("library-credit", heldUnits),
      itemName,
      sentence: lockedSentence(itemName),
    };
  });
}

/**
 * Tokens this member has held against redemptions nobody has answered.
 *
 * `held_account IS NOT NULL` is `heldForRedemption`'s own test: a redemption
 * opened while the village had the hold turned off took nothing, so it locks
 * nothing.
 */
export async function redemptionLocksFor(pool: Pool, userId: string): Promise<TokenLock[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `token_slug`, `amount` FROM `redemptions` WHERE `village_id` = ? AND `user_id` = ? " +
      "AND `state` = 'requested' AND `held_account` IS NOT NULL ORDER BY `created_at`",
    [villageId(), userId],
  );
  return rows.map((r) => {
    const slug = String(r.token_slug);
    const heldUnits = Number(r.amount ?? 0);
    return {
      source: "redemption" as const,
      ref: String(r.id),
      tokenSlug: slug,
      heldUnits,
      held: fromLedgerUnits(slug, heldUnits),
      itemName: "a redemption you have open",
      sentence: redemptionLockSentence(),
    };
  });
}

/**
 * Seat fees resting in escrow until the gathering is over.
 *
 * `status = 'held'` is `seatEscrowDrift`'s own test. `amount` is MINOR units
 * here: `chargeForPlace` posts the column straight to `postTransfer`.
 */
export async function seatLocksFor(pool: Pool, userId: string): Promise<TokenLock[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.`id`, c.`token_type`, c.`amount`, e.`title` FROM `event_seat_charges` c " +
      "LEFT JOIN `events` e ON e.`id` = c.`event_id` " +
      "WHERE c.`user_id` = ? AND c.`status` = 'held' ORDER BY c.`created_at`",
    [userId],
  );
  return rows.map((r) => {
    const slug = String(r.token_type);
    const heldUnits = Number(r.amount ?? 0);
    const title = String(r.title ?? "a gathering");
    return {
      source: "event-seat" as const,
      ref: String(r.id),
      tokenSlug: slug,
      heldUnits,
      held: fromLedgerUnits(slug, heldUnits),
      itemName: title,
      sentence: seatLockSentence(title),
    };
  });
}

/** Every lock on this member, from all three sources, in one read each. */
export async function locksFor(pool: Pool, userId: string): Promise<TokenLock[]> {
  const [library, redemptions, seats] = await Promise.all([
    libraryLocksFor(pool, userId),
    redemptionLocksFor(pool, userId),
    seatLocksFor(pool, userId),
  ]);
  return [...library, ...redemptions, ...seats];
}

// ── The reading ────────────────────────────────────────────────────────────

/**
 * Fold a balance sheet and a list of locks into the four numbers per token.
 *
 * PURE, so the arithmetic and every edge (a real zero, a fully locked balance,
 * a lock on a token with no balance row left) can be driven with no database.
 * A lock on a token the member has no balance row for is NOT dropped: it is
 * exactly the fully-locked case, and dropping it would make the member's own
 * deposit invisible on the surface built to explain it.
 */
export function foldHoldings(
  spendableUnitsBySlug: Record<string, number>,
  locks: TokenLock[],
): Record<string, TokenHolding> {
  // `Array.from` and not a spread: the build target predates iterating a Set
  // directly, and `--downlevelIteration` is a repo-wide setting one module has
  // no business turning on.
  const slugs = Array.from(
    new Set<string>([...Object.keys(spendableUnitsBySlug), ...locks.map((l) => l.tokenSlug)]),
  );
  const out: Record<string, TokenHolding> = {};
  for (const slug of slugs) {
    const mine = locks.filter((l) => l.tokenSlug === slug);
    const spendableUnits = Number(spendableUnitsBySlug[slug] ?? 0);
    const lockedUnits = mine.reduce((n, l) => n + l.heldUnits, 0);
    const totalUnits = spendableUnits + lockedUnits;
    out[slug] = {
      tokenSlug: slug,
      tokenName: tokenDef(slug)?.name ?? slug,
      decimals: tokenDef(slug)?.decimals ?? 0,
      spendableUnits,
      lockedUnits,
      totalUnits,
      spendable: fromLedgerUnits(slug, spendableUnits),
      locked: fromLedgerUnits(slug, lockedUnits),
      total: fromLedgerUnits(slug, totalUnits),
      locks: mine,
    };
  }
  return out;
}

/**
 * Everything this member holds, spendable and locked, keyed by slug.
 *
 * A slug ABSENT from this map is a member who has never held that token, which
 * is the empty state. A slug present with `total` 0 is a real zero. The two
 * are different facts and a surface that prints "0" for both is wrong about
 * one of them.
 */
export async function holdingsFor(pool: Pool, userId: string): Promise<Record<string, TokenHolding>> {
  const [balances, locks] = await Promise.all([
    balancesFor(pool, memberAccount(userId)),
    locksFor(pool, userId),
  ]);
  return foldHoldings(balances, locks);
}

/**
 * One token, and ALWAYS an answer.
 *
 * A caller that asked about a slug gets an object even when the member has
 * never touched it, because "I asked and the answer is nothing" is a fact a
 * refusal has to be able to state.
 */
export async function holdingFor(pool: Pool, userId: string, slug: string): Promise<TokenHolding> {
  const all = await holdingsFor(pool, userId);
  return (
    all[slug] ?? {
      tokenSlug: slug,
      tokenName: tokenDef(slug)?.name ?? slug,
      decimals: tokenDef(slug)?.decimals ?? 0,
      spendableUnits: 0,
      lockedUnits: 0,
      totalUnits: 0,
      spendable: 0,
      locked: 0,
      total: 0,
      locks: [],
    }
  );
}

/**
 * Why this spend is short, in the member's own words, or null when it is not.
 *
 * THE WHOLE POINT OF THE FOURTH READING, met at a door. A member refused for
 * twenty credits they are holding fifty of has been told something true and
 * useless. This says the same refusal with the reason attached, and the reason
 * is the founder's sentence naming the thing to go and fetch.
 *
 * Returns null when the locks do not explain the shortfall, so a member who is
 * genuinely short hears the ordinary sentence and is never sent to look for an
 * item that would not have covered it either.
 *
 * A TOP-LEVEL FUNCTION DECLARATION. `refusalsFrom` in
 * scripts/generate-economics-doc.mjs reads sentences out of declarations of
 * this shape, and the sentences here are built from the locks, so they are
 * assembled and not literal: the pieces a reader can quote are
 * `lockedSentence` and its two siblings above.
 */
export function lockedShortfall(holding: TokenHolding, needUnits: number): string | null {
  if (needUnits <= holding.spendableUnits) return null;
  if (holding.lockedUnits <= 0) return null;
  if (needUnits > holding.totalUnits) return null;
  const said = holding.locks.map((l) => `${l.held} ${holding.tokenName} ${l.sentence}`);
  return said.join(". ");
}
