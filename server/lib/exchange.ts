/**
 * The exchange. Members buy platform tokens for fiat through the trio, and
 * may trade one village token for another; the tokens come out of a stocked
 * treasury, never out of thin air, and fiat only ever flows IN — nothing here
 * ever sells a token back for money.
 *
 * v1 (S33-S35) was buy-only, and this header said swapping was "a shipped
 * CONTRACT with no engine until v2". The engine landed in S57-S61 — see
 * `swapProblem` and the swap-order normaliser below, and `postTransferPair`
 * in the ledger, which is what makes a two-legged trade atomic. Trading is
 * still OFF by default and opens only behind a version-stamped legal card.
 *
 * The firewalls, enforced at WRITE time and re-proven at BOOT:
 *   - recognition-kind tokens are never purchasable or swappable — gratitude
 *     is earned, full stop (economy invariant 2.2 #2).
 *   - ONLY CREDIT-KIND TOKENS TRADE AT ALL. Money buys credits. It does not
 *     buy a share of the village (equity) and it does not buy a say in what
 *     the village decides (voice). See `tradingProblem`.
 *   - hypha-governed tokens are never purchasable or swappable — nothing
 *     share-like trades on this platform, ever (Gate B).
 *   - the village's voting-weight token is never listed while it is the thing
 *     that weighs votes. See `weightTokenListingProblem`.
 *   - one seller per token: a token a module sells (stays -> stay-credit)
 *     cannot ALSO be listed purchasable here. The boot check unions the
 *     static sellsToken claims with the dynamic purchasable flags.
 *
 * Stock: sys:mint -> sys:treasury (source exchange_stock, under the same
 * per-cycle mint cap as hand-mints). Sale: sys:treasury -> buyer. The
 * treasury is NOT a faucet, so selling more than was stocked FAILS the
 * settlement — out of stock is a fact the webhook retries surface to
 * admins, not a mint opportunity.
 *
 * ── UNITS, STATED ONCE FOR THE WHOLE FILE ──────────────────────────────────
 *
 * The exchange engine runs in WHOLE TOKENS. Quotes, `exchange_orders.quantity`
 * and `pay_quantity`, the per-cycle swap caps, the stock a steward reads and
 * every number this file returns to a caller are human figures. The ledger
 * runs in MINOR units and always has. The two meet at exactly three postings,
 * `settleExchangeOrder` and both legs of `executeSwap`, each of which converts
 * with `toLedgerUnits` at the call site, and at the three reads that come back
 * off the ledger, `treasuryStock`, `swapCycleUsage` and `swappableBalance`,
 * each of which converts with `fromLedgerUnits` before returning.
 *
 * Two consequences worth holding onto:
 *
 *   - Nothing converts inside `postTransfer`. Two callers elsewhere post
 *     balances they read straight out of `token_balances`, and a conversion
 *     underneath the primitive would multiply a settled balance by 10^decimals.
 *   - `swappableBalance` is where a second conversion is easiest to add by
 *     accident. Its `held` is a sum of two sources in two units: the fiat hold
 *     comes from `exchange_orders.quantity`, which is already human, and the
 *     commerce hold comes from `token_ledger.amount`, which is minor. Only the
 *     second half is converted. Dividing the whole sum takes the human half
 *     down twice and quietly under-counts the chargeback hold.
 *
 * At `decimals = 0` every conversion in this file is the identity, so none of
 * this is visible in a fixture built on today's registry. That is why the unit
 * tests register a token with decimals of their own.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  ALLOW_NEGATIVE_SOURCES,
  TREASURY,
  allTokens,
  balanceOf,
  memberAccount,
  postTransfer,
  postTransferPair,
  tokenDef,
} from "./ledger";
import type { PairGuard } from "./ledger";
// The two boundary converters, and the only ones this file may use. A literal
// factor written here would be right for exactly as long as the registry
// agreed with it, and the registry is the thing that changes.
import { fromLedgerUnits, toLedgerUnits } from "./economy";
import { numberVar, stringVar } from "./variables";
import { moduleConfig } from "./modules";
import { MODULES } from "../../shared/modules";

export interface ExchangeSettings {
  tokenSlug: string;
  purchasable: boolean;
  swappable: boolean;
  minStageToBuy: string | null;
  sortOrder: number;
  active: boolean;
  /** Fail-closed: 0 means ZERO swapped out per cycle, never "unlimited". */
  maxSwapOutPerCycle: number;
  maxSwapOutPerMemberPerCycle: number;
  swapHaltedAt: string | null;
  swapHaltedBy: string | null;
  swapHaltReason: string | null;
  /** A standing example listing: display-only, never a market. */
  isExample: boolean;
  /** Display-only stock on an example listing. NULL on every real one; the
   *  ledger is never consulted for examples and never touched by them. */
  exampleStock: number | null;
}

function rowToSettings(r: RowDataPacket): ExchangeSettings {
  return {
    tokenSlug: String(r.token_slug),
    purchasable: !!r.purchasable,
    swappable: !!r.swappable,
    minStageToBuy: r.min_stage_to_buy ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    active: !!r.active,
    maxSwapOutPerCycle: Number(r.max_swap_out_per_cycle ?? 0),
    maxSwapOutPerMemberPerCycle: Number(r.max_swap_out_per_member_per_cycle ?? 0),
    swapHaltedAt: r.swap_halted_at ? new Date(r.swap_halted_at).toISOString() : null,
    swapHaltedBy: r.swap_halted_by ?? null,
    swapHaltReason: r.swap_halt_reason ?? null,
    isExample: Number(r.is_example ?? 0) === 1,
    exampleStock: r.example_stock == null ? null : Number(r.example_stock),
  };
}

/**
 * ── WHICH TOKENS ARE ON SALE, AS A SYNCHRONOUS FACT ─────────────────────────
 *
 * `governance.weight_token` must not name a token anybody can buy, and the
 * function that decides that (`weightTokenProblem`) is synchronous and called
 * from seven ballot-opening routes and from `weightsFor`. Making it async to
 * reach this table would mean editing all of them, so the table's one relevant
 * bit is cached here the same way `tokenDef` caches the registry: filled from
 * a full read, written through on change, and read as memory.
 *
 * FILLED BEFORE ANYTHING IS SERVED, and not by a new boot call: both
 * `assertExchangeFirewalls` and `repairTaintedListings` already read the whole
 * table at boot and both run before the server answers, so the set is warm by
 * the time any route can ask. A cache with its own boot hook is a cache that
 * gets forgotten in the next fork's start-up path.
 *
 * EXAMPLES ARE EXCLUDED. A standing example listing sells nothing (the buy
 * route refuses it before any stock logic) so counting one would refuse a
 * village's ballots over a demonstration.
 *
 * A stale-empty set fails OPEN, which is worth saying plainly: if this were
 * somehow never filled, `weightTokenProblem` loses one clause and everything
 * else about the firewall still holds. That is why the rule is also written on
 * the exchange's own side, where it reads a variable and needs no cache.
 */
const listedForTrade = new Set<string>();

function rememberListings(rows: readonly ExchangeSettings[]): void {
  listedForTrade.clear();
  for (const s of rows) {
    if (!s.isExample && s.active && (s.purchasable || s.swappable)) listedForTrade.add(s.tokenSlug);
  }
}

/** Whether this token is on the exchange right now, purchasable or swappable. */
export function isListedForTrade(slug: string): boolean {
  return listedForTrade.has(slug);
}

export async function exchangeSettings(pool: Pool): Promise<ExchangeSettings[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM token_exchange_settings ORDER BY sort_order, token_slug",
  );
  const settings = rows.map(rowToSettings);
  rememberListings(settings);
  return settings;
}

export async function settingsFor(pool: Pool, slug: string): Promise<ExchangeSettings | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM token_exchange_settings WHERE token_slug = ?",
    [slug],
  );
  return rows[0] ? rowToSettings(rows[0]) : null;
}

/** The static union of module-sold tokens (stays -> stay-credit, …). */
export function moduleSoldTokens(): Set<string> {
  return new Set(MODULES.filter((m) => m.sellsToken).map((m) => m.sellsToken!));
}

/**
 * Tokens that are NEVER listed, whatever an admin clicks: library credits
 * are backed by shelved items and minted only through guarded intake —
 * selling them for fiat would sever the backing (S41). Static on purpose,
 * like the ledger's allow-negative whitelist.
 */
export const NEVER_LISTED: ReadonlySet<string> = new Set(["library-credit"]);

/**
 * ── WHAT MONEY MAY BUY, AND THE HOLE THIS CLOSED ────────────────────────────
 *
 * The header's promise is that recognition is earned and share-like things do
 * not trade. Measured against the built server on 2026-08-30, this function
 * enforced that promise for exactly two of the four token kinds:
 *
 *   recognition  refused by name.
 *   equity       refused only when `governance` is `hypha`. The 0006 seed
 *                makes the equity row a hypha mirror, so the refusal held by
 *                accident of the seed, not by rule.
 *   voice        NOT REFUSED AT ALL. `server/lib/economy.ts` registers
 *                `village-voice` as kind `voice` with governance `platform`,
 *                precisely because a hypha mirror cannot accrue. That token
 *                passed every check here: it could be listed, priced, stocked
 *                out of `sys:mint`, and sold for a card payment. And
 *                `server/lib/voiceClaim.ts` exists to bridge a voice balance
 *                to on-chain governance the day `BRIDGE_DISPATCH_BUILT`
 *                flips, so bought voice becomes real voting power then.
 *   credit       the one kind the exchange is actually for.
 *
 * `server/seeds/examples-seed.json` already states the intended rule in its
 * own note ("Only credit-kind tokens can list ... and the boot firewalls
 * re-prove that every deploy"). The seed was right and the code was not.
 *
 * So the test is now the POSITIVE one, the same one-line kind test
 * `isPriceableToken` in `server/lib/spending.ts` already uses: a thing bought
 * with money is a credit. That fails closed for any kind a later migration
 * invents, where a list of refusals would have let it through.
 *
 * Kind-specific sentences come FIRST anyway, because "gratitude is earned" and
 * "nothing share-like trades here" say why in the village's own words, and the
 * generic sentence is the catch-all behind them.
 *
 * Returns a human refusal or null. Enforced at write time, at buy time, and
 * re-proven at boot, so a hand-edited row can never outlive a deploy.
 */
export function tradingProblem(slug: string): string | null {
  if (NEVER_LISTED.has(slug)) {
    return `${slug} is backed by the library's shelves and never trades. Its only doors are intake and loans`;
  }
  const def = tokenDef(slug);
  if (!def) return `"${slug}" is not a registered token`;
  if (def.kind === "recognition") {
    return `${slug} is recognition. It is earned through contribution and can never be bought or swapped`;
  }
  if (def.governance === "hypha") {
    return `${slug} is governed on Hypha. Nothing share-like trades on this platform`;
  }
  if (def.kind === "voice") {
    return `${def.name} is voice. A say in what this village decides is earned from work the village confirmed, and it is not the platform's to sell`;
  }
  if (def.kind !== "credit") {
    return `${def.name} is a ${def.kind} token. Only credits are bought and swapped here`;
  }
  const weighs = weightTokenListingProblem(slug);
  if (weighs) return weighs;
  if (moduleSoldTokens().has(slug)) {
    return `${slug} already has a selling module, and there is one seller per token, so the exchange would be a second`;
  }
  return null;
}

/**
 * ── THE SECOND DOOR TO THE SAME ROOM ────────────────────────────────────────
 *
 * Refusing voice-kind tokens closes the obvious path to buying votes. It does
 * not close the other one: `governance.weight_token` may name ANY
 * platform-governed token (`weightTokenProblem` in `server/lib/governanceWeights.ts`
 * refused only hypha mirrors), so a founder in `token` weight mode can point
 * the weight at an ordinary CREDIT token that is listed on the exchange, and
 * from that moment a card payment is voting weight without a voice token
 * anywhere in the story.
 *
 * Both doors now carry the same rule, from their two sides:
 *
 *   here                 the token that weighs votes may not be listed.
 *   weightTokenProblem   a token that is listed may not weigh votes.
 *
 * ── WHY THIS ONE READS THE MODE AND THE KIND TEST DOES NOT ──────────────────
 *
 * `weight_token` holds a value in every mode and only MEANS anything in
 * `token` mode; its shipped default is `gratitude`, which is recognition and
 * refused two clauses up regardless. Refusing a listing on account of a dial
 * that is currently inert would delist a legal market for a reason that is not
 * true yet, and `assertExchangeFirewalls` runs BEFORE `repairTaintedListings`
 * at boot, so a false positive here is a village that will not start rather
 * than a listing quietly narrowed.
 *
 * The moment the mode is flipped to `token` the refusal becomes true, and the
 * window between the flip and the next boot is covered from the other side:
 * `weightTokenProblem` refuses to resolve weights at all, so no ballot can
 * open on a purchasable weight token even while the listing still stands.
 */
export function weightTokenListingProblem(slug: string): string | null {
  if (stringVar("governance.weight_mode") !== "token") return null;
  if (stringVar("governance.weight_token").trim() !== slug) return null;
  const name = tokenDef(slug)?.name ?? slug;
  return (
    `${name} is what weighs every vote in this village right now (governance.weight_mode is set to token), ` +
    `so listing it would put voting weight on sale. Point governance.weight_token at something else first`
  );
}

/**
 * L9 (Gate F, opened by Rye 2026-07-27): selling library credits for fiat.
 *
 * The objection was never technical. A library credit is backed by a
 * physical item somebody brought to the shelf; a SOLD credit is backed by
 * money instead, and past that sale the two are indistinguishable claims on
 * the same shelves. Opening this changes what the token IS — so it opens
 * the way trading opened: a per-deployment caution card, version-stamped,
 * server-stamped, refused for any card but the current one. The ledger
 * keeps the provenances separate forever (shelf-backed credits enter via
 * sys:library-mint on intake; sold stock enters via sys:mint -> treasury),
 * so a village can always answer "how many of our credits are money-backed".
 *
 * The relaxation is PURCHASE-ONLY, structurally: tradingProblem still
 * refuses library-credit, which keeps the swap door shut regardless of any
 * config — and the faucet-issuance test would refuse it a second time.
 */
export const LIBRARY_CREDIT_CARD_VERSION = "2026-07-27";

export function creditSaleOpen(): boolean {
  const cfg = (moduleConfig("library") as any) ?? {};
  if (cfg.creditSaleEnabled !== true) return false;
  return String(cfg.creditSaleAck?.cardVersion ?? "") === LIBRARY_CREDIT_CARD_VERSION;
}

/** Buying refuses what v1 refused — except behind the L9 caution card. */
export function purchaseProblem(slug: string): string | null {
  if (NEVER_LISTED.has(slug) && creditSaleOpen()) {
    // The card is accepted: run every OTHER shared rule (recognition, kind,
    // hypha, weight token, one-seller) without the shelf-backing refusal.
    // This branch is a hand-copy of `tradingProblem` minus one clause, so
    // every rule added there has to be added here or the card opens a door
    // wider than the one it was written for.
    const def = tokenDef(slug);
    if (!def) return `"${slug}" is not a registered token`;
    if (def.kind === "recognition") return `${slug} is recognition, never for sale`;
    if (def.governance === "hypha") return `${slug} is governed on Hypha`;
    if (def.kind !== "credit") return `${def.name} is a ${def.kind} token, and only credits are sold here`;
    const weighs = weightTokenListingProblem(slug);
    if (weighs) return weighs;
    if (moduleSoldTokens().has(slug)) return `${slug} already has a selling module`;
    return null;
  }
  return tradingProblem(slug);
}

/**
 * Which tokens a FAUCET has issued into circulation — the structural test
 * behind the swap firewall.
 *
 * The rule is about DESTINATION, not about what a source string is called:
 *
 *   faucet -> sys:treasury   = stocking a shop, whatever the source says
 *   faucet -> anything else  = issuance, whatever the source says
 *
 * A source-name allowlist rots. `admin_mint` posts sys:mint -> mem:{user}
 * for ANY slug, and every module invents its own award source
 * (quest_stay_reward, library_intake, stay_comp…). Naming them all is a
 * race nobody wins. Asking where the money went is a question no future
 * module can answer wrongly.
 */
export async function faucetIssuedTokens(pool: Pool): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.token_type, COUNT(*) AS n FROM token_ledger l " +
      "JOIN ledger_accounts a ON a.id = l.from_account " +
      "WHERE a.faucet = 1 AND l.to_account <> ? GROUP BY l.token_type",
    [TREASURY],
  );
  return new Map(rows.map((r) => [String(r.token_type), Number(r.n)]));
}

/**
 * Swapping refuses everything buying refuses, PLUS faucet issuance.
 *
 * A token the village can conjure as a reward must never become a claim on
 * goods someone paid real money for. Recognition is the obvious case; the
 * subtle one is any credit a module hands out for free. There is no
 * override for this rule at any privilege level, through any config path.
 */
export async function swapProblem(
  pool: Pool,
  slug: string,
  tainted?: Map<string, number>,
): Promise<string | null> {
  const shared = tradingProblem(slug);
  if (shared) return shared;
  const issued = tainted ?? (await faucetIssuedTokens(pool));
  if (issued.has(slug)) {
    const name = tokenDef(slug)?.name ?? slug;
    return `${name} is minted by the village as a reward. Tokens you can earn from thin air are never bought or swapped here`;
  }
  return null;
}

/**
 * The write-time firewall for a listing change. Purchasable and swappable
 * are checked against their OWN rules: swapping is strictly stricter.
 */
export async function listingProblemAsync(
  pool: Pool,
  slug: string,
  flags: { purchasable: boolean; swappable: boolean },
): Promise<string | null> {
  if (!flags.purchasable && !flags.swappable) return null; // delisting is always legal
  if (flags.purchasable) {
    const p = purchaseProblem(slug);
    if (p) return p;
  }
  if (flags.swappable) {
    const s = await swapProblem(pool, slug);
    if (s) return s;
  }
  return null;
}

/** Synchronous subset, kept for the buy-only call sites and boot sweep. */
export function listingProblem(slug: string, flags: { purchasable: boolean; swappable: boolean }): string | null {
  if (!flags.purchasable && !flags.swappable) return null;
  // Any swap flag answers to the FULL shared rule — the L9 card never
  // opens the swap door. A purchase-only listing answers to purchaseProblem,
  // which is where the card (and only the card) can matter.
  if (flags.swappable) return tradingProblem(slug);
  return purchaseProblem(slug);
}

export async function upsertSettings(
  pool: Pool,
  input: {
    slug: string;
    purchasable?: boolean;
    swappable?: boolean;
    minStageToBuy?: string | null;
    sortOrder?: number;
    active?: boolean;
    maxSwapOutPerCycle?: number;
    maxSwapOutPerMemberPerCycle?: number;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await settingsFor(pool, input.slug);
  const next = {
    purchasable: input.purchasable ?? current?.purchasable ?? false,
    swappable: input.swappable ?? current?.swappable ?? false,
  };
  // Swapping is strictly stricter than buying: the async form also applies
  // the faucet-issuance test when swappable is being turned on.
  const problem = await listingProblemAsync(pool, input.slug, next);
  if (problem) return { ok: false, error: problem };
  await pool.query(
    // is_example is written 0 on every real write, including the UPDATE half.
    // The standing example occupies this table's primary key for a REAL token
    // slug, so an admin listing that token updates the example row in place —
    // and the retirement that fires straight afterwards would delete the
    // listing they just saved. Claiming the row as real is what makes the
    // "retire after a real row commits" order safe on a shared key.
    // example_stock is nulled alongside the is_example claim: a row an admin
    // has made real must never carry a fictional inventory number.
    "INSERT INTO token_exchange_settings (token_slug, purchasable, swappable, min_stage_to_buy, sort_order, active, " +
      "max_swap_out_per_cycle, max_swap_out_per_member_per_cycle, is_example, example_stock) VALUES (?,?,?,?,?,?,?,?,0,NULL) " +
      "ON DUPLICATE KEY UPDATE purchasable=VALUES(purchasable), swappable=VALUES(swappable), " +
      "min_stage_to_buy=VALUES(min_stage_to_buy), sort_order=VALUES(sort_order), active=VALUES(active), " +
      "max_swap_out_per_cycle=VALUES(max_swap_out_per_cycle), " +
      "max_swap_out_per_member_per_cycle=VALUES(max_swap_out_per_member_per_cycle), is_example=0, example_stock=NULL",
    [
      input.slug,
      next.purchasable ? 1 : 0,
      next.swappable ? 1 : 0,
      input.minStageToBuy !== undefined ? input.minStageToBuy : current?.minStageToBuy ?? null,
      input.sortOrder ?? current?.sortOrder ?? 0,
      (input.active ?? current?.active ?? true) ? 1 : 0,
      Math.max(0, Math.floor(input.maxSwapOutPerCycle ?? current?.maxSwapOutPerCycle ?? 0)),
      Math.max(0, Math.floor(input.maxSwapOutPerMemberPerCycle ?? current?.maxSwapOutPerMemberPerCycle ?? 0)),
    ],
  );
  // Write through, so the weight-token rule on the governance side sees this
  // listing before the next boot rather than after it.
  await exchangeSettings(pool);
  return { ok: true };
}

/**
 * The boot assertion (called before serving): every ACTIVE listing must pass
 * the same firewall the write path enforces. Refusing boot beats serving a
 * market that sells what must not be sold.
 */
export async function assertExchangeFirewalls(pool: Pool): Promise<void> {
  const problems: string[] = [];
  for (const s of await exchangeSettings(pool)) {
    if (!s.active) continue;
    // Examples cannot refuse the boot: the seeder writes them AFTER this runs,
    // so a row this rejects lands quietly on one boot and bricks the next.
    // repairTaintedListings (which is meant to delist loudly rather than
    // crash) also runs after this, so the intended soft landing never applies.
    if (s.isExample) continue;
    const p = listingProblem(s.tokenSlug, s);
    if (p) problems.push(p);
  }
  // The inverse of one-seller: no two MODULES claim the same token either
  // (assertModuleGraph covers that); here we cover module ∪ exchange.
  if (problems.length) {
    for (const p of problems) console.error(`[exchange firewall] ${p}`);
    throw new Error(`exchange firewalls violated (${problems.length}), refusing to serve`);
  }
}

// ── Prices: append-only, bounded, always explained ──────────────────────────

export interface PriceRow {
  id: string;
  tokenSlug: string;
  priceMinor: number;
  note: string;
  setBy: string | null;
  effectiveAt: string;
}

export async function latestPrice(pool: Pool, slug: string): Promise<PriceRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM currency_prices WHERE token_slug = ? ORDER BY effective_at DESC, id DESC LIMIT 1",
    [slug],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id), tokenSlug: String(r.token_slug), priceMinor: Number(r.price_minor),
    note: String(r.note), setBy: r.set_by ?? null, effectiveAt: new Date(r.effective_at).toISOString(),
  };
}

export async function setPrice(
  pool: Pool,
  input: { slug: string; priceMinor: number; note: string; setBy: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const price = Math.floor(Number(input.priceMinor));
  if (!(price > 0)) return { ok: false, error: "The price must be a positive amount in cents" };
  if (!String(input.note ?? "").trim()) {
    return { ok: false, error: "A note is required. Every price change must explain itself" };
  }
  const prev = await latestPrice(pool, input.slug);
  const maxPct = numberVar("exchange.price_change_max_pct");
  if (prev && maxPct > 0) {
    const movePct = (Math.abs(price - prev.priceMinor) / prev.priceMinor) * 100;
    if (movePct > maxPct + 1e-9) {
      return {
        ok: false,
        error: `That is a ${movePct.toFixed(1)}% move; the bound is ${maxPct}% per change (exchange.price_change_max_pct). Step there in bounded changes, each with its note.`,
      };
    }
  }
  await pool.query(
    "INSERT INTO currency_prices (id, token_slug, price_minor, note, set_by) VALUES (?,?,?,?,?)",
    [`cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, input.slug, price, String(input.note).trim().slice(0, 500), input.setBy],
  );
  return { ok: true };
}

// ── Orders ───────────────────────────────────────────────────────────────────

/**
 * Create a pending order and claim the next receipt number under a row lock —
 * receipts are a human-facing sequence with no gaps from racing buyers.
 */
export async function createExchangeOrder(
  pool: Pool,
  input: { userId: string; tokenSlug: string; quantity: number; priceMinorEach: number; amountMinor: number },
): Promise<{ id: string; receiptNo: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[maxRow]] = await conn.query<any[]>(
      "SELECT COALESCE(MAX(receipt_no), 0) AS m FROM exchange_orders FOR UPDATE",
    );
    const receiptNo = Number(maxRow.m) + 1;
    const id = `xo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await conn.query(
      "INSERT INTO exchange_orders (id, receipt_no, user_id, token_slug, quantity, price_minor_each, amount_minor, status) VALUES (?,?,?,?,?,?,?,'pending')",
      [id, receiptNo, input.userId, input.tokenSlug, input.quantity, input.priceMinorEach, input.amountMinor],
    );
    await conn.commit();
    return { id, receiptNo };
  } catch (e) {
    try { await conn.rollback(); } catch { /* already rolled back */ }
    throw e;
  } finally {
    conn.release();
  }
}

export async function exchangeOrderById(pool: Pool, id: string): Promise<any | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM exchange_orders WHERE id = ?", [id]);
  return rows[0] ?? null;
}

/**
 * The settle leg: treasury -> buyer, keyed on the order. The treasury is not
 * a faucet — an under-stocked treasury makes this THROW, the webhook answer
 * 500, Stripe retry, and the trio alert admins. Fail loud, never mint.
 *
 * UNITS. `order.quantity` is the whole-token count the buy route took from the
 * request body and `createExchangeOrder` wrote verbatim, and the fiat charge
 * was `quantity * priceMinor`, a price per WHOLE token. So the human number is
 * the one the member paid for and the one this converts, here at the boundary
 * and nowhere deeper. The RETURN is `r.toBalance`, which is the ledger's own
 * post-transfer figure and therefore MINOR: convert it before printing it.
 */
export async function settleExchangeOrder(pool: Pool, orderId: string, order: any): Promise<number> {
  const r = await postTransfer(pool, {
    from: TREASURY,
    to: memberAccount(String(order.user_id)),
    tokenType: String(order.token_slug),
    amount: toLedgerUnits(String(order.token_slug), Number(order.quantity)),
    source: "exchange_purchase",
    sourceRef: orderId,
    description: `Exchange receipt #${order.receipt_no}`,
    idempotencyKey: `ord:${orderId}:leg1`,
  });
  if (!r.ok) {
    throw new Error(`treasury cannot cover order ${orderId} (${r.error}): stock it, then let the retry settle`);
  }
  return r.toBalance;
}

/**
 * Treasury stock on hand, per LISTED token (cached balances, one query).
 *
 * Returns WHOLE TOKENS. `token_balances.balance` is minor, and all five
 * consumers want a human figure: the commerce stock guard compares it against
 * a product's `token_amount`, the buy guard against the request's `quantity`,
 * the swap guard against `quote.receiveQuantity`, and the market lens and the
 * admin desk print it to a person. Converting once here is one edit against
 * five, and it leaves no consumer holding a number in a unit it did not ask
 * for.
 */
export async function treasuryStock(pool: Pool): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT token_type, balance FROM token_balances WHERE account_id = ?",
    [TREASURY],
  );
  const out: Record<string, number> = {};
  for (const r of rows) {
    const slug = String(r.token_type);
    out[slug] = fromLedgerUnits(slug, Number(r.balance));
  }
  return out;
}

/** Open economic state that blocks disabling the module (invariant #13). */
export async function exchangeOpenState(pool: Pool): Promise<{ count: number; description: string }> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM exchange_orders WHERE status IN ('pending','disputed')",
  );
  return { count: Number(row.n), description: `${row.n} pending/disputed exchange order(s)` };
}

/**
 * Every platform token an admin could conceivably list (for the admin UI).
 *
 * Standing examples are NOT among them. They are registry rows like any other,
 * so they arrived in the Tokens table, the listing table and the "stock the
 * treasury" dropdown — and stocking or minting one writes real ledger rows
 * against a slug that retirement then deletes, so the next boot refuses to
 * serve on "ledger rows exist for unregistered token". Every write door
 * refuses them now; this keeps them from being offered in the first place.
 */
export function listableTokens(): { slug: string; name: string; kind: string; reason: string | null }[] {
  return allTokens()
    .filter((t) => t.active && !t.isExample)
    .map((t) => ({ slug: t.slug, name: t.name, kind: t.kind, reason: listingProblem(t.slug, { purchasable: true, swappable: false }) }));
}

// ══ S59: the swap engine ═════════════════════════════════════════════════════

export interface SwapQuote {
  payToken: string;
  receiveToken: string;
  receiveQuantity: number;
  payQuantity: number;
  /** PAY-side fiat valuation: what the member hands over, in minor units. */
  valueMinor: number;
  /** RECEIVE-side fiat valuation. */
  netMinor: number;
  /** valueMinor - netMinor: spread plus whole-unit rounding. Always printed. */
  takeMinor: number;
  spreadBps: number;
  payPriceMinor: number;
  receivePriceMinor: number;
  payPriceRowId: string;
  receivePriceRowId: string;
  /** The village's own words for this trade — rendered verbatim by the client. */
  sentence: string;
  disclosure: string;
}

/**
 * Receive-driven quote, ceil on the pay side, BigInt throughout.
 *
 *   payQty = ceil( qB · pB · 10000 / ( pA · (10000 − spread) ) )
 *
 * Ceiling rounds toward the treasury, which is what makes A→B→A unprofitable
 * at EVERY spread including zero: the round trip can never return more than
 * qB·pB/pA, and the outbound leg already cost at least that. The spread is a
 * policy dial layered on top, never the safety mechanism.
 *
 * BigInt because qB·pB·10000 exceeds Number.MAX_SAFE_INTEGER at plausible
 * bounds, and a float multiply can round UP — the one direction that would
 * break the proof.
 */
export function quoteSwap(input: {
  payToken: string;
  receiveToken: string;
  receiveQuantity: number;
  payPrice: PriceRow;
  receivePrice: PriceRow;
  spreadBps: number;
  payTokenName?: string;
  receiveTokenName?: string;
  currencySymbol?: string;
}): SwapQuote | { error: string } {
  const qB = Math.trunc(Number(input.receiveQuantity) || 0);
  const pA = Math.trunc(Number(input.payPrice.priceMinor) || 0);
  const pB = Math.trunc(Number(input.receivePrice.priceMinor) || 0);
  const s = Math.max(0, Math.min(2000, Math.trunc(Number(input.spreadBps) || 0)));
  if (qB <= 0) return { error: "How many do you need?" };
  if (qB > 1_000_000_000) return { error: "That is more than this exchange handles" };
  if (pA <= 0 || pB <= 0) return { error: "Both sides need a posted price before they can be swapped" };

  // BigInt() calls rather than literals: the build targets below ES2020,
  // where 10000n is a syntax error. The arithmetic is identical.
  const numerator = BigInt(qB) * BigInt(pB) * BigInt(10000);
  const denominator = BigInt(pA) * BigInt(10000 - s);
  const payQty = Number((numerator + denominator - BigInt(1)) / denominator); // ceil
  if (!Number.isSafeInteger(payQty) || payQty <= 0) {
    return { error: "That amount is too small to swap. Ask for more and the exchange can price it" };
  }
  const valueMinor = Number(BigInt(payQty) * BigInt(pA));
  const netMinor = Number(BigInt(qB) * BigInt(pB));
  const takeMinor = valueMinor - netMinor;

  // Defaults to the symbol the platform actually CHARGES in (payments.ts
  // sends Stripe 'usd') and that every other money surface prints. A quote
  // that says ₡20.00 beside a card reading $0.20 is two different claims
  // about the same number. Forks override it.
  const sym = input.currencySymbol ?? "$";
  const payName = input.payTokenName ?? input.payToken;
  const receiveName = input.receiveTokenName ?? input.receiveToken;
  const money = (m: number) => `${sym}${(m / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sentence = `You hand over ${payQty} ${payName}. You receive ${qB} ${receiveName}.`;
  const disclosure =
    takeMinor === 0
      ? `Both sides are worth ${money(valueMinor)}. The village keeps nothing on this swap.`
      : `You hand over ${money(valueMinor)} and receive ${money(netMinor)}. The difference, ${money(takeMinor)}, is whole-unit rounding` +
        (s > 0 ? ` plus the village's ${(s / 100).toFixed(2)}% share.` : ".");

  return {
    payToken: input.payToken,
    receiveToken: input.receiveToken,
    receiveQuantity: qB,
    payQuantity: payQty,
    valueMinor,
    netMinor,
    takeMinor,
    spreadBps: s,
    payPriceMinor: pA,
    receivePriceMinor: pB,
    payPriceRowId: input.payPrice.id,
    receivePriceRowId: input.receivePrice.id,
    sentence,
    disclosure,
  };
}

/**
 * A swap order shares the SAME gapless receipt sequence as fiat purchases —
 * one book, one numbering, because a member's receipts are one story.
 */
export async function createSwapOrder(
  pool: Pool,
  input: { userId: string; quote: SwapQuote; clientKey: string },
): Promise<{ id: string; receiptNo: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[maxRow]] = await conn.query<any[]>(
      "SELECT COALESCE(MAX(receipt_no), 0) AS m FROM exchange_orders FOR UPDATE",
    );
    const receiptNo = Number(maxRow.m) + 1;
    // 'xs-' for swaps, 'xo-' for fiat orders: the leg1 idempotency namespace
    // can never collide across the two kinds.
    const id = `xs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await conn.query(
      "INSERT INTO exchange_orders (id, receipt_no, user_id, kind, token_slug, quantity, price_minor_each, amount_minor, " +
        "pay_token_slug, pay_quantity, pay_price_minor_each, pay_price_row_id, receive_price_row_id, spread_bps, net_minor, client_key, status) " +
        "VALUES (?,?,?,'swap',?,?,?,?,?,?,?,?,?,?,?,?, 'pending')",
      [
        id, receiptNo, input.userId,
        input.quote.receiveToken, input.quote.receiveQuantity, input.quote.receivePriceMinor, input.quote.valueMinor,
        input.quote.payToken, input.quote.payQuantity, input.quote.payPriceMinor,
        input.quote.payPriceRowId, input.quote.receivePriceRowId, input.quote.spreadBps, input.quote.netMinor,
        input.clientKey,
      ],
    );
    await conn.commit();
    return { id, receiptNo };
  } catch (e) {
    try { await conn.rollback(); } catch { /* already rolled back */ }
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * The two legs, in one transaction. Both or neither — a member is never
 * debited without being credited.
 *
 * UNITS. `order.pay_quantity` and `order.quantity` are the quote's whole-token
 * counts, written to `exchange_orders` by `createSwapOrder` and handed here by
 * the swap route without a round trip through the row. Each leg converts with
 * its OWN token's decimals, because a swap is the one posting where the two
 * sides can be at different scales. `quoteSwap` stays in whole tokens: its
 * prices are cents per whole token and its ceil proof is stated over integers.
 */
export async function executeSwap(
  pool: Pool,
  order: { id: string; user_id: string; pay_token_slug: string; pay_quantity: number; token_slug: string; quantity: number; receipt_no: number },
  guard?: PairGuard,
): Promise<{ ok: boolean; error?: string }> {
  const member = memberAccount(String(order.user_id));
  const r = await postTransferPair(pool, [
    {
      from: member, to: TREASURY, tokenType: String(order.pay_token_slug),
      amount: toLedgerUnits(String(order.pay_token_slug), Number(order.pay_quantity)),
      source: "exchange_swap", sourceRef: order.id,
      description: `Swap receipt #${order.receipt_no}`, idempotencyKey: `ord:${order.id}:leg1`,
    },
    {
      from: TREASURY, to: member, tokenType: String(order.token_slug),
      amount: toLedgerUnits(String(order.token_slug), Number(order.quantity)),
      source: "exchange_swap", sourceRef: order.id,
      description: `Swap receipt #${order.receipt_no}`, idempotencyKey: `ord:${order.id}:leg2`,
    },
  ], guard);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * How much of a token has left the treasury by swap this lunation.
 *
 * Takes a Pool OR a PoolConnection on purpose: called on a pool it is an
 * advisory read for the quote surface, and called on the transaction's own
 * connection (from a PairGuard) it is the enforcing read, serialized behind
 * the same treasury row lock as every competing swap.
 *
 * Returns WHOLE TOKENS. Every consumer adds it to `quote.receiveQuantity` and
 * compares the sum against `maxSwapOutPerCycle`, a dial a steward types in
 * whole tokens. Leaving the sum minor would loosen that cap by 10^decimals
 * while the member is still debited correctly, which is a cap that reports a
 * remaining figure and binds on nothing.
 */
export async function swapCycleUsage(
  pool: Pool | PoolConnection,
  slug: string,
  cycleStart: Date,
  userId?: string,
): Promise<number> {
  const params: any[] = [TREASURY, slug, cycleStart];
  let sql =
    "SELECT COALESCE(SUM(amount),0) AS s FROM token_ledger " +
    "WHERE from_account = ? AND token_type = ? AND source = 'exchange_swap' AND at >= ?";
  if (userId) { sql += " AND to_account = ?"; params.push(memberAccount(userId)); }
  const [[row]] = await pool.query<any[]>(sql, params);
  return fromLedgerUnits(slug, Number(row.s));
}

/**
 * Tokens bought with a card are frozen from swapping for a while: long
 * enough that a chargeback still finds them in the wallet rather than
 * converted into something the village cannot claw back.
 *
 * ALL FOUR FIELDS ARE WHOLE TOKENS, and the arithmetic below is the reason
 * this function is the riskiest one in the file. `held` adds two sums that
 * arrive in DIFFERENT units:
 *
 *   - the fiat hold is `SUM(exchange_orders.quantity)`, the human count the
 *     buy route stored, already in the unit this returns;
 *   - the commerce hold is `SUM(token_ledger.amount)`, minor, and the only
 *     half that needs converting.
 *
 * So exactly two conversions happen here: `balance`, and `grants.held`.
 * Converting `row.held` as well would divide the human half a second time,
 * under-count the chargeback hold by 10^decimals, and reopen the side door the
 * `product_grant` leg was added to close. The subtraction at the end is then
 * human minus human, computed once.
 */
export async function swappableBalance(
  pool: Pool | PoolConnection,
  userId: string,
  slug: string,
  holdDays: number,
): Promise<{ balance: number; held: number; swappable: number; clearsAt: string | null }> {
  const balance = fromLedgerUnits(slug, await balanceOf(pool, memberAccount(userId), slug));
  if (holdDays <= 0) return { balance, held: 0, swappable: balance, clearsAt: null };
  const [[row]] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(quantity),0) AS held, MAX(paid_at) AS latest FROM exchange_orders " +
      "WHERE user_id = ? AND token_slug = ? AND kind = 'fiat_purchase' AND status = 'paid' " +
      "AND paid_at > (NOW() - INTERVAL ? DAY)",
    [userId, slug, holdDays],
  );
  // Commerce token packs are card money too: every token-granting product is
  // forced onto the Stripe path, so a `product_grant` ledger row is by
  // construction a recent card purchase. Without this leg the chargeback
  // hold had a side door — buy the pack in commerce, swap immediately.
  // Works on Pool or PoolConnection alike, so the in-transaction capGuard
  // read stays serialized behind the same treasury lock.
  const [[grants]] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(amount),0) AS held, MAX(at) AS latest FROM token_ledger " +
      "WHERE to_account = ? AND token_type = ? AND source = 'product_grant' " +
      "AND at > (NOW() - INTERVAL ? DAY)",
    [memberAccount(userId), slug, holdDays],
  );
  // `row.held` is human already; only the ledger half is converted. See the
  // note above this function for why the whole sum must never be divided.
  const held = Number(row.held) + fromLedgerUnits(slug, Number(grants.held));
  const latestTimes = [row.latest, grants.latest]
    .filter(Boolean)
    .map((d: any) => new Date(d).getTime());
  const clearsAt = latestTimes.length
    ? new Date(Math.max(...latestTimes) + holdDays * 86400000).toISOString()
    : null;
  return { balance, held, swappable: Math.max(0, balance - held), clearsAt };
}

/**
 * The reaper. A pending swap older than five minutes either has both legs
 * (mark it paid) or neither (cancel it). EXACTLY ONE leg is unreachable
 * under postTransferPair, so it refuses rather than guessing.
 */
export async function reconcileSwapOrders(pool: Pool): Promise<{ settled: number; cancelled: number }> {
  const [stale] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM exchange_orders WHERE kind = 'swap' AND status = 'pending' AND created_at < (NOW() - INTERVAL 5 MINUTE)",
  );
  let settled = 0;
  let cancelled = 0;
  for (const row of stale) {
    const id = String(row.id);
    const [[legs]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM token_ledger WHERE source = 'exchange_swap' AND source_ref = ?",
      [id],
    );
    const n = Number(legs.n);
    if (n === 2) {
      await pool.query("UPDATE exchange_orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE id = ?", [id]);
      settled += 1;
    } else if (n === 0) {
      // Nothing moved, so the member's confirmation code goes back to them —
      // a key left attached to a cancelled order would refuse the retry.
      await pool.query("UPDATE exchange_orders SET status = 'cancelled', client_key = NULL WHERE id = ?", [id]);
      cancelled += 1;
    } else {
      throw new Error(`swap order ${id} has ${n} ledger leg(s): a half-applied swap must never be normalized`);
    }
  }
  return { settled, cancelled };
}

/**
 * The other reaper: abandoned CARD checkouts (X4).
 *
 * A fiat purchase inserts its order as `pending` BEFORE the Stripe Checkout
 * session opens, so every closed tab leaves one behind and nothing ever
 * cleared them. That is not merely untidy. Both blockers that read this table
 * are kind-agnostic — `exchangeOpenState` refuses to turn the module off while
 * any order is pending, and the exit enumerator refuses to release a member
 * with one — so a single abandoned checkout could keep the exchange
 * permanently un-disableable and hold someone in the village indefinitely.
 * Nobody would connect the two.
 *
 * Two rules make releasing safe:
 *
 *  - Never touch an order with ledger legs. Tokens moved means it was paid,
 *    whatever the row says; that is a settle bug, not an abandonment, and it
 *    is left alone and reported rather than quietly cancelled.
 *  - Wait longer than Stripe will. A Checkout session stays payable for about
 *    24 hours, so a shorter window could cancel an order while the member is
 *    still on the payment page — taking their money against a cancelled
 *    order. Hence hours, a 48-hour default, and a floor enforced here rather
 *    than trusted to whoever edits the variable.
 *
 * `client_key` is cleared with the status for the same reason the swap reaper
 * clears it: a key still attached to a dead order refuses the member's retry.
 */
export const ORDER_EXPIRY_FLOOR_HOURS = 25;

export async function releaseAbandonedFiatOrders(
  pool: Pool,
  expiryHours: number,
): Promise<{ released: number; skipped: string[] }> {
  if (expiryHours <= 0) return { released: 0, skipped: [] };
  const hours = Math.max(ORDER_EXPIRY_FLOOR_HOURS, Math.floor(expiryHours));
  const [stale] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM exchange_orders WHERE kind = 'fiat_purchase' AND status = 'pending' " +
      "AND created_at < (NOW() - INTERVAL ? HOUR)",
    [hours],
  );
  let released = 0;
  const skipped: string[] = [];
  for (const row of stale) {
    const id = String(row.id);
    const [[legs]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM token_ledger WHERE source = 'exchange_purchase' AND source_ref = ?",
      [id],
    );
    if (Number(legs.n) > 0) {
      // Paid in the ledger, pending on the row. Releasing it would erase the
      // only record that the member is owed something.
      skipped.push(id);
      continue;
    }
    await pool.query(
      "UPDATE exchange_orders SET status = 'cancelled', client_key = NULL WHERE id = ? AND status = 'pending'",
      [id],
    );
    released += 1;
  }
  return { released, skipped };
}

/**
 * Automated authority may NARROW the market and never widen it. A listing
 * that no longer passes its own firewall (a token that has since been
 * faucet-issued, say) is delisted loudly at boot rather than crashing a
 * deployment that was fine yesterday.
 */
export async function repairTaintedListings(pool: Pool): Promise<string[]> {
  const repaired: string[] = [];
  const tainted = await faucetIssuedTokens(pool);
  for (const s of await exchangeSettings(pool)) {
    if (!s.active || (!s.purchasable && !s.swappable)) continue;
    // Only auto-fix what delisting can fix; anything else falls through to
    // the assertion below and refuses boot.
    if (!tokenDef(s.tokenSlug)) continue;
    // Each flag answers to ITS OWN rule. Swapping refuses strictly more than
    // buying, so a token that becomes faucet-tainted after it was listed
    // loses only its SWAP listing — closing the shop too would delist a
    // sale that was always legal, silently, at a boot nobody was watching.
    const purchaseBad = s.purchasable ? purchaseProblem(s.tokenSlug) : null;
    const swapBad = s.swappable ? await swapProblem(pool, s.tokenSlug, tainted) : null;
    if (!purchaseBad && !swapBad) continue;
    await pool.query(
      "UPDATE token_exchange_settings SET purchasable = ?, swappable = ? WHERE token_slug = ?",
      [purchaseBad ? 0 : s.purchasable ? 1 : 0, swapBad ? 0 : s.swappable ? 1 : 0, s.tokenSlug],
    );
    repaired.push(`${s.tokenSlug}: ${purchaseBad ?? swapBad}`);
  }
  // Same write-through as upsertSettings: the set was filled from the rows
  // this pass has just narrowed, so re-read before anything is served.
  if (repaired.length) await exchangeSettings(pool);
  return repaired;
}

/**
 * The swap boot assertions. Everything the write path refuses, re-proven
 * against the whole ledger — plus the structural facts no single write can
 * check: leg pairing, faucet abstinence, and Gate C2 asserted in data.
 */
export async function assertSwapFirewalls(
  pool: Pool,
  ctx: { tradingEnabled: boolean; sharedPasswordPosture: boolean; legalAckVersion?: string | null; cardVersion: string },
): Promise<string[]> {
  const problems: string[] = [];
  // Warnings close SWAPPING. Problems refuse to serve at all. The difference
  // matters: an amended caution card must stop trades, but it must not take
  // the village's quests and stays down with it.
  const warnings: string[] = [];

  // 2. allowNegative must never learn the swap source.
  if (ALLOW_NEGATIVE_SOURCES.has("exchange_swap")) {
    problems.push("exchange_swap is in ALLOW_NEGATIVE_SOURCES: a swap may never create debt");
  }

  // 4. No swap leg touches a faucet, on either side, anywhere in history.
  const [faucetLegs] = await pool.query<RowDataPacket[]>(
    "SELECT l.id FROM token_ledger l JOIN ledger_accounts a ON a.id IN (l.from_account, l.to_account) " +
      "WHERE l.source = 'exchange_swap' AND a.faucet = 1 LIMIT 5",
  );
  for (const r of faucetLegs) problems.push(`swap ledger row ${r.id} touches a faucet account: a swap must never mint`);

  // 5. Leg pairing: every swap group is exactly two rows, opposite
  // directions across the treasury, in two different tokens.
  const [groups] = await pool.query<RowDataPacket[]>(
    "SELECT source_ref, COUNT(*) AS n, COUNT(DISTINCT token_type) AS tokens, " +
      "SUM(from_account = ?) AS out_legs, SUM(to_account = ?) AS in_legs " +
      "FROM token_ledger WHERE source = 'exchange_swap' GROUP BY source_ref HAVING n <> 2 OR tokens <> 2 OR out_legs <> 1 OR in_legs <> 1 LIMIT 5",
    [TREASURY, TREASURY],
  );
  for (const g of groups) {
    problems.push(
      `swap ${g.source_ref} has ${g.n} leg(s) across ${g.tokens} token(s): a half-applied or malformed swap must never be normalized`,
    );
  }

  // 6. Gate C2 in data: a swap never carries a payment provider.
  const [[provider]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM exchange_orders WHERE kind = 'swap' AND (provider_ref IS NOT NULL OR stripe_payment_intent_id IS NOT NULL)",
  );
  if (Number(provider.n) > 0) {
    problems.push(`${provider.n} swap order(s) carry a payment provider reference: swaps never touch fiat`);
  }

  // 10. Caps are non-negative; the spread is inside its bounds.
  const [badCaps] = await pool.query<RowDataPacket[]>(
    "SELECT token_slug FROM token_exchange_settings WHERE max_swap_out_per_cycle < 0 OR max_swap_out_per_member_per_cycle < 0 LIMIT 5",
  );
  for (const c of badCaps) problems.push(`${c.token_slug} has a negative swap cap`);

  // 8/9. Opening the market is a posture decision, not just a toggle.
  if (ctx.tradingEnabled && ctx.sharedPasswordPosture) {
    problems.push(
      "internal trading is enabled while a shared password is the only admin credential: bootstrap per-admin identities first",
    );
  }
  // A version bump here is a DOCS change that would otherwise brick every
  // fork running trading, so it closes swapping and shouts instead. The
  // safety property survives — no trade happens under a stale acceptance —
  // without an upgrade becoming a village-wide outage.
  if (ctx.tradingEnabled && ctx.legalAckVersion !== ctx.cardVersion) {
    warnings.push(
      `swapping is CLOSED: the legal caution card is version ${ctx.cardVersion} but this village accepted ` +
        `${ctx.legalAckVersion ?? "none"}. An admin must read and accept the current card in Admin → Exchange`,
    );
  }

  if (problems.length) {
    for (const p of problems) console.error(`[swap firewall] ${p}`);
    throw new Error(`swap firewalls violated (${problems.length}), refusing to serve`);
  }
  for (const w of warnings) console.error(`[swap firewall] ${w}`);
  return warnings;
}
