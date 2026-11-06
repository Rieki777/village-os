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

/** A cap percentage as the arithmetic reads it: 0 to 100, and rubbish is 0. */
function capPctOf(capPct: number): number {
  return Number.isFinite(capPct) ? Math.min(100, Math.max(0, capPct)) : 0;
}

/**
 * The fewest members who must hold weight for anyone to stay under the cap.
 * Below it, everyone holding weight weighs the same (`capWeights`). Five at
 * 20, four at 30, two at 50, one at 100. `weightCapLine` says this number to
 * members, so it is computed once, here, for both.
 */
export function fewestHoldersForCap(capPct: number): number {
  const pct = capPctOf(capPct);
  return pct > 0 ? Math.ceil(100 / pct) : Number.POSITIVE_INFINITY;
}

/** Round DOWN to the four places `ballot_electorate.weight` stores. */
function floorToStored(w: number): number {
  // The 1e-6 is a millionth of a stored step: enough to absorb a double that
  // lands a hair under a whole step, far too small to lift a weight past one.
  return Math.floor(w * 10_000 + 1e-6) / 10_000;
}

/**
 * THE CAP ON ONE MEMBER'S SHARE OF THE VOTE (Rye, 2026-11-05: an option, OFF
 * by default).
 *
 * The share it bounds is a share of the FROZEN total, because that is what
 * quorum and unity read: a member capped at 20 carries at most 20% of the
 * vote on that ballot.
 *
 * ── HOW: A WATER-FILL ──────────────────────────────────────────────────────
 *
 * Everyone starts at their raw share. Anyone above `capPct` of the vote is
 * clamped to exactly `capPct` and held there. The rest of the vote, 100 less
 * the clamped members' shares, is shared among the members still unclamped in
 * proportion to their raw weights. That can lift somebody else over the cap,
 * so it repeats until nobody unclamped is over. Each round only raises the
 * unclamped members' shares, so a member clamped in one round stays clamped.
 *
 * In weights: a member under the cap keeps their raw weight exactly, so their
 * order and their proportions to each other are untouched. Every clamped
 * member weighs `capPct x rest / (100 - capPct x clamped)`, where `rest` is
 * what the unclamped members hold, and that is their share of the vote to the
 * last stored digit. A clamped member always ends below their own raw weight,
 * and never below anybody unclamped. On one holder of 90 and four of 2.5 at
 * 20, all five end at 2.5, a fifth of the vote each.
 *
 * ── TOO FEW HOLDERS FOR ANYONE TO STAY UNDER IT ────────────────────────────
 *
 * With fewer than `fewestHoldersForCap(capPct)` members holding weight (fewer
 * than five at 20), every share can never be at or under the cap: five shares
 * of 20 is the least that adds up to the whole vote. The only fair result is
 * that EVERYONE HOLDING WEIGHT WEIGHS THE SAME, so they do, each at the
 * smallest holding among them, which raises nobody above what they hold. A
 * lone holder therefore stays the whole vote however low the cap is. The cap
 * cannot share power out among people who hold none.
 *
 * ── THE NUMBERS AT THE EDGES ───────────────────────────────────────────────
 *
 * Members with zero raw weight stay at zero. Caps fail closed: 0 means zero
 * for everybody, never unlimited, and so does a percentage that is not a
 * number, and `openBallot` refuses a roll whose total is zero. Above 100 is
 * read as 100, which clamps nobody. The registry refuses both ends
 * (`governance.weight_cap_pct` runs 1 to 100); this is belt to those braces.
 * Every weight is rounded DOWN to the four places `ballot_electorate.weight`
 * stores, and a clamped weight is computed from the rounded weights beside
 * it, so no frozen weight rounds above its share on the way into the column.
 */
export function capWeights(weights: ReadonlyMap<string, number>, capPct: number): Map<string, number> {
  const pct = capPctOf(capPct);
  const held = new Map<string, number>();
  weights.forEach((raw, id) => held.set(id, floorToStored(Math.max(0, asNumber(raw)))));
  const out = new Map<string, number>();
  if (!(pct > 0)) {
    held.forEach((_w, id) => out.set(id, 0));
    return out;
  }

  const holders: string[] = [];
  held.forEach((w, id) => {
    if (w > 0) holders.push(id);
  });
  const everyoneTheSame = (): Map<string, number> => {
    let least = Number.POSITIVE_INFINITY;
    holders.forEach((id) => {
      least = Math.min(least, held.get(id) ?? 0);
    });
    held.forEach((w, id) => out.set(id, w > 0 ? least : 0));
    return out;
  };
  if (holders.length < fewestHoldersForCap(pct)) return everyoneTheSame();

  const clamped = new Set<string>();
  let rest = 0;
  for (;;) {
    rest = 0;
    held.forEach((w, id) => {
      if (!clamped.has(id)) rest += w;
    });
    // The share of the vote, in percent, left to the unclamped members.
    const left = 100 - clamped.size * pct;
    // Unreachable with enough holders, and kept so a rounding surprise can
    // never divide by nothing: fall back to the same answer a small roll gets.
    if (!(left > 0) || !(rest > 0)) return everyoneTheSame();
    const over: string[] = [];
    held.forEach((w, id) => {
      // w / rest x left > pct, multiplied out. Exact on whole minor units; the
      // relative hair absorbs a double on a fractional weight sitting AT the cap.
      if (!clamped.has(id) && w * left > pct * rest * (1 + 1e-12)) over.push(id);
    });
    if (over.length === 0) break;
    over.forEach((id) => clamped.add(id));
  }

  const atCap = floorToStored((pct * rest) / (100 - clamped.size * pct));
  held.forEach((w, id) => out.set(id, clamped.has(id) ? atCap : w));
  return out;
}

/** A weight as a double, total over both numeric types and over rubbish. */
function asNumber(raw: bigint | number): number {
  if (typeof raw === "bigint") return Number(raw);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
