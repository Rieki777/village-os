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

/**
 * THE CAP ON ONE MEMBER'S WEIGHT (Rye, 2026-11-05: an option, OFF by default).
 *
 * Each weight is clamped to `capPct` percent of the roll's UNCAPPED total, in
 * one pass. Nobody under the ceiling moves, and nobody is raised.
 *
 * ── WHY ONE PASS AGAINST THE UNCAPPED TOTAL ────────────────────────────────
 *
 * The other shape is a fixed point: lower the ceiling until no member holds
 * more than `capPct` of the CAPPED total. It was rejected for two reasons.
 *
 *   It collapses on a small roll. With fewer than 100 / capPct members holding
 *   anything (fewer than five at 20) no positive ceiling satisfies it at all,
 *   so it ends at zero weight for everybody, and `openBallot` refuses a roll
 *   whose total is zero. At exactly five holders it flattens the roll to equal
 *   weights. A dial that silently becomes "one person, one vote" or "nobody
 *   may vote" depending on how many people hold the token is not one a founder
 *   can predict.
 *   One pass can be checked by hand. Anybody can read the roll's balances, take
 *   the cap's share of their sum, and know every member's frozen weight.
 *
 * ── WHAT IT COSTS WHEN FEW MEMBERS HOLD ALL THE WEIGHT ─────────────────────
 *
 * The frozen total shrinks by whatever the cap trimmed, and quorum and unity
 * are shares of the FROZEN total. So a capped member's share of the vote can
 * still be above `capPct`. One member holding 90 and four holding 2.5 each, at
 * 20: the big holder freezes at 20, the roll totals 30, and 20 of 30 is two
 * thirds of the vote. The cap guarantees nobody carries more than `capPct` of
 * the weight the roll held; it cannot share power out among people who hold
 * none. A lone holder stays the whole roll however low the cap is.
 *
 * ── THE NUMBERS AT THE EDGES ───────────────────────────────────────────────
 *
 * Caps fail closed: 0 means zero, never unlimited, and so does a percentage
 * that is not a number. Above 100 is read as 100, which trims nobody. The
 * registry refuses both ends (`governance.weight_cap_pct` runs 1 to 100); this
 * is belt to those braces. The ceiling is rounded DOWN to the four places
 * `ballot_electorate.weight` stores, so a frozen weight cannot round up past
 * the cap on its way into the column.
 */
export function capWeights(weights: ReadonlyMap<string, number>, capPct: number): Map<string, number> {
  const held = new Map<string, number>();
  let total = 0;
  weights.forEach((raw, id) => {
    const w = Math.max(0, asNumber(raw));
    held.set(id, w);
    total += w;
  });
  const pct = Number.isFinite(capPct) ? Math.min(100, Math.max(0, capPct)) : 0;
  // The 1e-6 is a millionth of a stored step: enough to absorb a double that
  // lands a hair under a whole step, far too small to lift a ceiling past one.
  const ceiling = Math.floor(((total * pct) / 100) * 10_000 + 1e-6) / 10_000;
  const out = new Map<string, number>();
  held.forEach((w, id) => out.set(id, Math.min(w, ceiling)));
  return out;
}

/** A weight as a double, total over both numeric types and over rubbish. */
function asNumber(raw: bigint | number): number {
  if (typeof raw === "bigint") return Number(raw);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
