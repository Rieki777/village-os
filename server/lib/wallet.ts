/**
 * A member's wallet: every token the village has, and where each one stands.
 *
 * The founder's sentence is the specification (Rye, 2026-10-21): "a wallet in
 * profile that shows all token holdings in game and which ones are claimed on
 * Hypha". So each row answers three questions about one token, in this order:
 *
 *   held      what is in this member's hands in the village ledger, with
 *             anything locked against a loan, a seat or a redemption named
 *   claim     whether it can be carried across to Hypha now, and when it
 *             cannot, exactly why and when that changes
 *   on Base   what the read-only mirror says they hold there, from the cache
 *             the on-chain card already fills, or why nothing is shown
 *
 * ── GRATITUDE IS WHAT IT IS ─────────────────────────────────────────────────
 *
 * "Gratitude distributes the cycle pool as it should! This is the point,
 * that's the only role of gratitude." So the recognition row shows this cycle's
 * giving left and the thanks received, and it never carries a price, a value
 * or a claim. A price beside recognition would be the first sentence in this
 * build to call appreciation money.
 *
 * ── NO PRICE AND WORTH NOTHING ARE TWO FACTS ────────────────────────────────
 *
 * A token has a money figure only when the exchange has posted one (the
 * exchange module is on and `currency_prices` holds a row), and the exchange
 * prices credit tokens alone. Everything else says "No price set" in words.
 * A zero is printed only when a price exists and the member holds none, which
 * is a true sum.
 *
 * ── NAMES ARE READ LIVE ─────────────────────────────────────────────────────
 *
 * Every name, the mirrors' included, comes from `tokenDef` on this request, so
 * a rename in Admin then Tokens reaches the wallet on the next load with
 * nothing stored beside a balance. A token with no registry row shows its slug,
 * which is a drift worth seeing and not a name worth inventing.
 *
 * ── WHOSE WALLET ────────────────────────────────────────────────────────────
 *
 * The caller's own, always. The route takes no id and no handle, so there is
 * no request shape that reads somebody else's.
 *
 * PURE ASSEMBLY, SEPARATE FROM THE READS. `assembleWallet` takes plain inputs
 * and decides every sentence, so the wording and the no-zero rule can be driven
 * without a database. `walletFor` gathers those inputs and calls it.
 */
import type { Pool } from "mysql2/promise";
import { formatUnits } from "./base-reads";
import { HEARTS, villageId, type Allowance } from "./economy";
import { latestPrice, type PriceRow } from "./exchange";
import { holdingsFor, type TokenHolding } from "./holdings";
import { allTokens, tokenDef, type TokenDef } from "./ledger";
import { effectiveLifecycle } from "./modules";
import { isPriceableToken } from "./spending";
import { boolVar, stringVar } from "./variables";
import {
  BRIDGE_DISPATCH_BUILT,
  CLAIM_LANES,
  claimReadinessFor,
  laneForToken,
  type ClaimLane,
  type ClaimReadiness,
} from "./voiceClaim";
import { cachedChainBalances, confirmedClaimTotals, type CachedChainBalance } from "../repos/wallet";

/** The currency `currency_prices.price_minor` is held in. Measured, see `RateAsk.postedCurrency`. */
export const POSTED_PRICE_CURRENCY = "USD";

export type WalletRole = "claimable" | "village" | "gratitude";

export type WalletPrice =
  | { state: "priced"; currency: string; perTokenMinor: number; heldValueMinor: number; since: string }
  | { state: "unset"; says: string }
  | { state: "never"; says: string };

export type WalletOnBase =
  | { state: "read"; mirror: string; mirrorName: string; formatted: string; fetchedAt: string; says: string }
  | { state: "unread" | "hidden"; mirror: string; mirrorName: string; says: string };

export interface WalletClaim {
  claimable: boolean;
  /** The nearest true thing about claiming, the same sentence the claim chip uses. */
  says: string;
  /** When claims open for this token, in words. Never a date that is not true. */
  opens: string;
  threshold: number;
  openClaim: ClaimReadiness["openClaim"];
  /** HUMAN units already carried across by confirmed claims. */
  claimedToHypha: number;
}

export interface WalletRow {
  token: string;
  name: string;
  /** What the token means, in the village's own words (0283), or null when it has written none. Never a platform sentence. */
  description: string | null;
  kind: string;
  role: WalletRole;
  decimals: number;
  /** MINOR units, spendable plus locked. What a member calls theirs. */
  heldUnits: number;
  /** MINOR units held against something, with each reason named in `locks`. */
  lockedUnits: number;
  locks: string[];
  /** Present on the claimable rows. */
  claim: WalletClaim | null;
  /** Present on the rows that never cross: what that means, in one sentence. */
  staysHere: string | null;
  onBase: WalletOnBase | null;
  /** Present on the recognition row only. */
  gratitude: { givingLeft: number; givingTotal: number; cycleKey: string; says: string } | null;
  price: WalletPrice;
}

export interface Wallet {
  rows: WalletRow[];
  /** Whether this build can carry any claim to Hypha at all. */
  bridgeReady: boolean;
}

/** Everything `assembleWallet` decides from. Plain data, no connection. */
export interface WalletInputs {
  tokens: TokenDef[];
  holdings: Record<string, TokenHolding>;
  readiness: Record<string, ClaimReadiness>;
  claimedTotals: Record<string, number>;
  chain: CachedChainBalance[];
  prices: Record<string, PriceRow | null>;
  /** The slugs `isPriceableToken` admits, decided by the caller so this stays pure. */
  priceable: string[];
  /** False when the exchange module is off, which means nothing is priced. */
  exchangeOn: boolean;
  allowance: Allowance | null;
  economicsSection: boolean;
  walletVerified: boolean;
  /** Contract addresses by mirror slug, so "not connected" can be told from "not read". */
  contracts: Record<string, string>;
  bridgeReady: boolean;
}

const nameOf = (tokens: TokenDef[], slug: string): string =>
  tokens.find((t) => t.slug === slug)?.name?.trim() || slug;

/**
 * When claims open, as a sentence, in the order the gates actually close.
 *
 * The bridge first, because it is the one gate no setting opens: telling a
 * member the next Claims Week date while nothing can carry a claim would be a
 * date that is not true.
 */
export function claimOpensSentence(r: ClaimReadiness): string {
  if (!r.bridgeReady) return "Claims open once the connection to Hypha is finished. No date is set yet.";
  if (!r.spaceConfigured) return "Claims open once the village names its Hypha space.";
  if (r.windowOpen) return "Claims Week is open now.";
  if (r.nextOpens) return `Claims Week next opens on ${r.nextOpens.slice(0, 10)}.`;
  return "Claims are closed, and no Claims Week date is set.";
}

function priceFor(
  def: TokenDef,
  holding: TokenHolding | undefined,
  price: PriceRow | null | undefined,
  exchangeOn: boolean,
  priceable: boolean,
): WalletPrice {
  if (def.kind === "recognition") {
    return { state: "never", says: `${def.name} is never priced. What you receive decides your share of the cycle pool.` };
  }
  // `priceable` is `isPriceableToken`, the one test the price writer uses, so
  // the wallet cannot show a price the exchange could never have posted.
  if (!exchangeOn || !price || !priceable) return { state: "unset", says: "No price set" };
  const heldUnits = Number(holding?.totalUnits ?? 0);
  return {
    state: "priced",
    currency: POSTED_PRICE_CURRENCY,
    perTokenMinor: price.priceMinor,
    // The posted price is per WHOLE token, and the balance is minor units at
    // the token's own scale. Divide by a whole power of ten, never multiply by
    // a negative one (see `humanAtScale`).
    heldValueMinor: Math.round((heldUnits * price.priceMinor) / 10 ** def.decimals),
    since: price.effectiveAt,
  };
}

function onBaseFor(lane: ClaimLane, inputs: WalletInputs): WalletOnBase {
  const mirror = lane.mirror;
  const mirrorName = nameOf(inputs.tokens, mirror);
  if (!inputs.economicsSection) {
    return { state: "hidden", mirror, mirrorName, says: "This village does not show on-chain holdings yet." };
  }
  if (!inputs.walletVerified) {
    return { state: "hidden", mirror, mirrorName, says: "Verify your wallet below to see what you hold on Base." };
  }
  if (!String(inputs.contracts[mirror] ?? "").trim()) {
    return { state: "unread", mirror, mirrorName, says: `The village has not connected the ${mirrorName} contract yet.` };
  }
  const cached = inputs.chain.find((c) => c.tokenSlug === mirror);
  if (!cached) {
    return { state: "unread", mirror, mirrorName, says: "Not read from Base yet. Nothing is shown in place of a number." };
  }
  return {
    state: "read",
    mirror,
    mirrorName,
    formatted: formatUnits(cached.raw, cached.decimals),
    fetchedAt: cached.fetchedAt,
    says: `As Base last said, on ${cached.fetchedAt.slice(0, 10)}.`,
  };
}

/** The order a member reads them in: what crosses, what they spend, then recognition. */
function rank(row: WalletRow): number {
  if (row.role === "claimable") return CLAIM_LANES.findIndex((l) => l.token === row.token);
  if (row.role === "village") return 100;
  return 200;
}

/**
 * Every row, decided from plain inputs.
 *
 * WHICH TOKENS: every active platform token in the registry, plus any token
 * this member holds a balance in whatever its state, so nobody ever loses sight
 * of something they own. Standing examples are left out because nobody holds
 * them. The Hypha mirrors are not rows of their own: each one is the far side
 * of a claimable row, which is where a member looks for it. A mirror with no
 * lane pointing at it would be listed on its own, and there is none today.
 */
export function assembleWallet(inputs: WalletInputs): Wallet {
  const mirrorsWithLane = new Set(CLAIM_LANES.map((l) => l.mirror));
  const rows: WalletRow[] = [];
  const seen = new Set<string>();

  const consider = (def: TokenDef) => {
    if (seen.has(def.slug)) return;
    seen.add(def.slug);
    const holding = inputs.holdings[def.slug];
    const heldUnits = Number(holding?.totalUnits ?? 0);
    if (def.isExample && heldUnits === 0) return;
    if (!def.active && heldUnits === 0) return;
    if (def.governance !== "platform" && mirrorsWithLane.has(def.slug)) return;

    const lane = laneForToken(def.slug);
    const readiness = inputs.readiness[def.slug];
    const recognition = def.kind === "recognition";
    const role: WalletRole = lane && readiness ? "claimable" : recognition ? "gratitude" : "village";

    const giving =
      recognition && def.slug === HEARTS && inputs.allowance
        ? {
            givingLeft: inputs.allowance.remaining,
            givingTotal: inputs.allowance.total,
            cycleKey: inputs.allowance.cycleKey,
            says: `${inputs.allowance.remaining} of ${inputs.allowance.total} left to give this cycle. What you do not give expires when the cycle closes.`,
          }
        : null;

    rows.push({
      token: def.slug,
      name: def.name?.trim() || def.slug,
      description: def.description?.trim() || null,
      kind: def.kind,
      role,
      decimals: Number(holding?.decimals ?? def.decimals ?? 0),
      heldUnits,
      lockedUnits: Number(holding?.lockedUnits ?? 0),
      locks: (holding?.locks ?? []).map((l) => l.sentence),
      claim:
        role === "claimable" && readiness
          ? {
              claimable: readiness.claimable,
              says: readiness.says,
              opens: claimOpensSentence(readiness),
              threshold: readiness.threshold,
              openClaim: readiness.openClaim,
              claimedToHypha: Number(inputs.claimedTotals[def.slug] ?? 0),
            }
          : null,
      staysHere:
        role === "gratitude"
          ? `${def.name?.trim() || def.slug} is given and received here, and never claimed or sent to Base.`
          : role === "village"
            ? def.governance === "platform"
              ? "Stays in the village. There is nothing to claim on Hypha."
              : "Lives on Base. This village only reads it."
            : null,
      onBase: lane && role === "claimable" ? onBaseFor(lane, inputs) : null,
      gratitude: giving,
      price: priceFor(def, holding, inputs.prices[def.slug], inputs.exchangeOn, inputs.priceable.includes(def.slug)),
    });
  };

  for (const def of inputs.tokens) consider(def);
  // A balance in a token the registry no longer lists is still the member's.
  for (const slug of Object.keys(inputs.holdings)) {
    if (seen.has(slug)) continue;
    if (Number(inputs.holdings[slug]?.totalUnits ?? 0) === 0) continue;
    consider({
      slug,
      name: slug,
      kind: "credit",
      governance: "platform",
      transferable: false,
      decimals: inputs.holdings[slug].decimals,
      active: false,
    });
  }

  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { rows, bridgeReady: inputs.bridgeReady };
}

/** What `walletFor` needs from the host that this module cannot reach. */
export interface WalletDeps {
  /** The one allowance (R73), resolved by the host, which knows the member's stage. */
  allowanceFor: (user: any) => Promise<Allowance>;
}

/** The caller's own wallet. `user` is the authenticated member row. */
export async function walletFor(pool: Pool, user: any, deps: WalletDeps): Promise<Wallet> {
  const userId = String(user.id);
  const tokens = allTokens();
  const exchangeOn = effectiveLifecycle("exchange") !== "off";
  const priceable = tokens.filter((t) => isPriceableToken(t.slug)).map((t) => t.slug);

  const [holdings, claimedTotals, chain, allowance, readinessList, priceList] = await Promise.all([
    holdingsFor(pool, userId),
    confirmedClaimTotals(pool, villageId(), userId),
    cachedChainBalances(pool, userId),
    tokenDef(HEARTS) ? deps.allowanceFor(user) : Promise.resolve(null),
    Promise.all(CLAIM_LANES.filter((l) => tokenDef(l.token)).map((l) => claimReadinessFor(pool, userId, l))),
    exchangeOn ? Promise.all(priceable.map((s) => latestPrice(pool, s))) : Promise.resolve([] as Array<PriceRow | null>),
  ]);

  const readiness: Record<string, ClaimReadiness> = {};
  for (const r of readinessList) readiness[r.token] = r;
  const prices: Record<string, PriceRow | null> = {};
  priceable.forEach((s, i) => (prices[s] = priceList[i] ?? null));

  return assembleWallet({
    tokens,
    holdings,
    readiness,
    claimedTotals,
    chain,
    prices,
    priceable,
    exchangeOn,
    allowance,
    economicsSection: boolVar("tokens.show_economics_section"),
    walletVerified: !!user.walletVerifiedAt && !!user.walletAddress,
    contracts: {
      equity: stringVar("tokens.equity_address"),
      voice: stringVar("tokens.voice_address"),
    },
    bridgeReady: BRIDGE_DISPATCH_BUILT,
  });
}
