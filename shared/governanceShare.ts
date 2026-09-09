/**
 * WHAT SHARE OF THE VILLAGE'S VOICE ONE MEMBER HOLDS.
 *
 * ── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
 *
 * `server/lib/governanceWeights.ts` resolves weights, and resolving them means
 * a pool: `token` mode reads `token_balances` and `custom` mode reads
 * `governance_weights`. So every caller that only wants the SHARE has had to
 * import a module that carries a database with it. The dry run cannot: the
 * cardinal rule of `shared/dryRun/` is that the simulation has no import path
 * to a connection, and the concentration flag is the whole reason the
 * simulation asks about shares at all.
 *
 * The arithmetic itself never needed a pool. It is a sum and a division over
 * numbers somebody else has already resolved. So it lives here, pure, and
 * `governanceWeights.ts` re-exports it so a server caller still has one door.
 *
 * ── WHY IT TAKES bigint OR number ──────────────────────────────────────────
 *
 * `weightsFor` answers `Map<string, number>` and the dry run's balances are
 * `Map<string, bigint>` in minor units. Both are weights, both want the same
 * share, and a second copy of this arithmetic for the second numeric type is
 * how the two copies start disagreeing about what a share is.
 *
 * A share is a FRACTION and comes back as a double whichever way it went in.
 * That is the right precision for a share: it is rendered as a percentage
 * with two places, never added to a balance, and never posted to a ledger. A
 * bigint past 2^53 loses ordinary precision on the way in, which moves a
 * share by less than a rounding step of the percentage anybody reads.
 */

/**
 * Each holder's fraction of the whole, keyed the way the input was keyed.
 *
 * Negative weights are floored at zero, which is exactly what `weightsFor`
 * already does on the way out of the database: a negative member balance
 * cannot happen outside a faucet account, and the clamp is what stops one
 * ever counting as power in reverse.
 *
 * A total of zero answers zero for every holder. It never answers NaN, and
 * that is the whole reason to call this instead of dividing: a village at
 * zero total weight is an ordinary state (nobody holds the weight token yet)
 * and a page that renders NaN% for it is broken by a village being young.
 */
export function shareOfTotal(weights: ReadonlyMap<string, bigint | number>): Map<string, number> {
  // `forEach` and not `for...of`: `tsconfig.json` omits `target`, which leaves
  // `pnpm check` typechecking at the ES5 default, and ES5 refuses to iterate a
  // Map (TS2802). The tests typecheck at es2022 and would allow it, so this
  // file would pass one gate and fail the other.
  const held = new Map<string, number>();
  let total = 0;
  weights.forEach((raw, id) => {
    const w = Math.max(0, asNumber(raw));
    held.set(id, w);
    total += w;
  });
  const out = new Map<string, number>();
  held.forEach((w, id) => out.set(id, total > 0 ? w / total : 0));
  return out;
}

/** One holder and what fraction of the whole they hold. */
export interface HolderShare {
  /** The key the weights map used, which is a user id at every caller today. */
  id: string;
  /** Their fraction of the total, 0 to 1. */
  share: number;
}

/**
 * The `n` largest shares, biggest first.
 *
 * Ties break on the id, ascending, so the answer is the same on every run and
 * every engine. A concentration flag that reordered two equal holders between
 * two runs of the same preview would read as a change nobody made.
 *
 * `n` past the number of holders returns every holder, and `n` of zero or
 * less returns nothing.
 */
export function topShares(weights: ReadonlyMap<string, bigint | number>, n: number): HolderShare[] {
  const bound = Math.floor(Number(n));
  if (!Number.isFinite(bound) || bound <= 0) return [];
  const all: HolderShare[] = [];
  shareOfTotal(weights).forEach((share, id) => all.push({ id, share }));
  all.sort((a, b) => (b.share - a.share) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return all.slice(0, bound);
}

/** A weight as a double, total over both numeric types and over rubbish. */
function asNumber(raw: bigint | number): number {
  if (typeof raw === "bigint") return Number(raw);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
