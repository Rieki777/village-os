/**
 * WHAT THE PER-CYCLE MINT CAP COUNTS.
 *
 * `ledger.admin_mint_cycle_cap` bounds ALL ISSUANCE of one token in one lunar
 * cycle, from every door, and not only the ones an admin opens by hand. That
 * is a ruling, so it is written here beside the arithmetic that carries it
 * out instead of being inferred from a WHERE clause.
 *
 * ── WHAT THE COUNTER USED TO SAY, AND WHY IT WAS TWO DIFFERENT NUMBERS ─────
 *
 * The guard summed `token_ledger.amount` over every row leaving `sys:mint`
 * since the cycle started, and subtracted nothing. Counting every door was
 * already right under the ruling above. The return leg was the wrong half:
 * `spendSinkFor("stay-credit")` IS `sys:mint` (server/lib/spending.ts), so a
 * member paying for a night sends their credits back to the faucet that
 * issued them, the village can issue those same credits again, and the old
 * SUM counted the second issue as a second creation.
 *
 * Measured on a scratch schema, every figure read back from `token_ledger`
 * and `token_balances`: three issues of 100, one member spend of the whole
 * 300, one re-issue of 300. The guard read 600. `GET /api/admin/tokens`,
 * which derives `-tb.balance WHERE a.faucet = 1`, read 300 from the same
 * table at the same instant. Two surfaces beside each other, one table, two
 * answers. A village running stays could exhaust a cap it had not spent, with
 * no lever anywhere to clear it, because a gross SUM inside a cycle can only
 * go up.
 *
 * ── THE WINDOW, AND THE ONE CASE THE LEDGER CANNOT ANSWER ──────────────────
 *
 * The subtraction runs over exactly the window the addition runs over: rows
 * stamped at or after this cycle's start. Any other pairing compares two
 * different months and calls the difference issuance.
 *
 * A RETURN WHOSE ISSUANCE WAS IN A PREVIOUS CYCLE therefore lands in a window
 * that never held the issue it undoes. Left alone it drives the figure below
 * zero and hands a founder headroom ABOVE the cap: a village that issued 5000
 * last moon and saw all of it spent back this moon would show -5000, and a
 * cap of 10000 would then admit 15000 of fresh issuance in a single lunation.
 *
 * SO THE FIGURE HAS A FLOOR OF ZERO, and the floor is a `Math.max` in
 * TypeScript where a reader meets it, on purpose. Written as `GREATEST(0, ...)`
 * inside the SQL it would read as a formatting detail. It is the whole
 * decision: a return can cancel issuance THIS cycle made, and it can never
 * manufacture room the cycle did not have.
 *
 * The alternative is to match each return to the cycle its tokens were issued
 * in, and this table cannot answer that. A nightly stay charge, an admin
 * adjustment and a payment reversal all post toward the faucet carrying no
 * reference to the row whose tokens they return: `source_ref` on those rows
 * names the stay, the adjustment or the order, never the mint. The floor is
 * the conservative reading of a fact the ledger does not record.
 *
 * ── THE CONSEQUENCE, NAMED WHERE IT LANDS ──────────────────────────────────
 *
 * A busy stays month can legitimately exhaust a founder's ability to
 * hand-mint. That is accepted, and it is not softened here. What is not
 * accepted is meeting it as a bare refusal, so `capRefusal` says how much of
 * the lunation's issuance came from doors no admin opened, and names them.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { fromLedgerUnits, toLedgerUnits } from "./economy";
import { currentCycle } from "./gratitude-cycles";
import { MINT_FAUCET, type TransferGuard } from "./ledger";
import { numberVar } from "./variables";

/** The dial. Named once so the refusals and the guard cannot drift apart. */
export const MINT_CAP_KEY = "ledger.admin_mint_cycle_cap";

/**
 * The `token_ledger.source` values the three doors that MEET the guard write.
 *
 * `exchange_stock` is treasury stocking, `admin_mint` is both the hand-mint
 * and its co-signed approval, and `circle_treasury_fund` (0181) is a steward
 * minting a circle its treasury. Everything else out of this faucet is a door
 * that issues without passing the guard: the Stripe stay-purchase settle, the
 * member-triggered quest work-exchange release, the three stays routes, and
 * any `mint_rules` rule on stay-credit, because `faucetFor("stay-credit")`
 * returns this faucet.
 *
 * HARDCODED AND TESTED, not derived: there is no registry of door sources to
 * derive it from. `server/mintCap.e2e.test.ts` drives every guarded door and
 * asserts the rows they wrote carry exactly these values, so a further guarded
 * door with a new source goes red instead of quietly being reported to a
 * founder as somebody else's issuance.
 *
 * `circle_treasury_fund` WAS ADDED BY WATCHING THAT TEST GO RED, which is the
 * tripwire doing its job. It belongs on this list because funding a circle
 * treasury is a steward deciding to issue, the same act the other three are.
 * Left off, `capRefusal` would have told a founder who had just funded ten
 * circles that their own issuance "was issued by circle_treasury_fund, which
 * no admin minted by hand", which is the opposite of true.
 */
export const HAND_MINT_SOURCES: readonly string[] = [
  "admin_mint",
  "exchange_stock",
  "circle_treasury_fund",
];

/** What one token issued and took back in one cycle. All figures MINOR. */
export interface CycleIssuance {
  /** Out of the faucet inside the window, every door. */
  issued: number;
  /** Back into the faucet inside the window, every door. */
  returned: number;
  /** `max(0, issued - returned)`. The figure the cap is compared against. */
  net: number;
  /** Of `issued`, the part written by a source no guarded door writes. */
  byOtherDoors: number;
  /** The distinct sources behind `byOtherDoors`, sorted in JS (see below). */
  otherSources: string[];
}

/** This cycle's start, as the window both halves of the sum are taken over. */
export function mintCycleStart(): Date {
  return new Date(currentCycle().startsAt);
}

/**
 * One round trip, four figures, all of them out of `token_ledger`.
 *
 * Takes a `Pool` for a pre-flight and a `PoolConnection` for the guard. The
 * guard's connection already holds `sys:mint` locked FOR UPDATE, so the two
 * halves of the subtraction are read at the same instant as each other and as
 * the row being decided on. Reading them through the pool from inside the
 * guard would step outside that lock and reintroduce the race the guard
 * exists to close.
 *
 * `GROUP_CONCAT` is left unordered and the sort happens in JS. MySQL refuses
 * an `ORDER BY source` inside a `GROUP_CONCAT(DISTINCT CASE ...)` because the
 * ordering expression is not the DISTINCT expression, and sorting here also
 * takes the answer off the engine's collation. Nothing about this depends on
 * PAD SPACE against NO PAD either way: `source` holds ASCII snake_case
 * identifiers with no trailing space and no case variation, so MariaDB and
 * MySQL 8 return the same set.
 */
export async function readCycleIssuance(
  conn: Pool | PoolConnection,
  slug: string,
  since: Date,
): Promise<CycleIssuance> {
  const hand = HAND_MINT_SOURCES.map(() => "?").join(",");
  const [[row]] = await conn.query<any[]>(
    "SELECT " +
      "COALESCE(SUM(CASE WHEN from_account = ? THEN amount ELSE 0 END), 0) AS issued, " +
      "COALESCE(SUM(CASE WHEN to_account = ? THEN amount ELSE 0 END), 0) AS came_back, " +
      `COALESCE(SUM(CASE WHEN from_account = ? AND source NOT IN (${hand}) THEN amount ELSE 0 END), 0) AS other_doors, ` +
      `GROUP_CONCAT(DISTINCT CASE WHEN from_account = ? AND source NOT IN (${hand}) THEN source END SEPARATOR ',') AS other_sources ` +
      "FROM token_ledger WHERE token_type = ? AND at >= ? AND (from_account = ? OR to_account = ?)",
    [
      MINT_FAUCET,
      MINT_FAUCET,
      MINT_FAUCET,
      ...HAND_MINT_SOURCES,
      MINT_FAUCET,
      ...HAND_MINT_SOURCES,
      slug,
      since,
      MINT_FAUCET,
      MINT_FAUCET,
    ],
  );
  const issued = Number(row?.issued ?? 0);
  const returned = Number(row?.came_back ?? 0);
  return {
    issued,
    returned,
    // THE FLOOR. See the header: a return can cancel this cycle's own
    // issuance and can never buy room above the cap for the next one.
    net: Math.max(0, issued - returned),
    byOtherDoors: Number(row?.other_doors ?? 0),
    otherSources: String(row?.other_sources ?? "").split(",").filter(Boolean).sort(),
  };
}

/**
 * What a founder reads when the cap refuses them, and why it says more than
 * the number.
 *
 * The cap bounds every door, so the issuance that used it up was often nobody
 * in the room. A refusal that stated only a total left a steward looking at a
 * hand-mint log holding a fraction of that number, with no way to tell where
 * the rest went. This names the amount and the doors, so the sentence answers
 * the question it provokes.
 *
 * `mint cap` stays in the first clause: three routes map this to a 409 by
 * matching that substring.
 */
export function capRefusal(slug: string, capHuman: number, issuance: CycleIssuance): string {
  const head =
    `This would exceed the per-cycle mint cap: ${fromLedgerUnits(slug, issuance.net)} of ` +
    `${capHuman} ${slug} already issued this lunation`;
  if (issuance.byOtherDoors <= 0) return head;
  // Four names, and it SAYS when it truncated. A silent cut would tell a
  // steward the list was complete when it was not.
  const shown = issuance.otherSources.slice(0, 4);
  const named = shown.join(", ") +
    (issuance.otherSources.length > shown.length ? ` and ${issuance.otherSources.length - shown.length} more` : "");
  return (
    `${head}, and ${fromLedgerUnits(slug, issuance.byOtherDoors)} of that was issued by ${named}, ` +
    "which no admin minted by hand. The cap bounds every door that issues, so a busy month of " +
    "stays or quests can use it up before a steward mints anything"
  );
}

/**
 * THE PER-CYCLE MINT CAP, ENFORCED WHERE IT CANNOT BE RACED.
 *
 * Three doors mint from `sys:mint` through this guard, and all three used to
 * read the cycle's running total, compare it, and then post several awaits
 * later. Two admins clicking at once both read the same stale total, both
 * decide there is room, and both post: the cap is exceeded while every
 * individual request looks lawful, and nothing downstream notices because
 * conservation still holds.
 *
 * "Caps fail closed" is a platform invariant, so this runs as a ledger guard
 * instead, inside the transaction, after `sys:mint` and the destination are
 * locked FOR UPDATE. Any two mints of the same token contend on the same
 * `sys:mint` row, so they serialise, and the second one counts the first
 * one's committed row. Deciding and writing become one step.
 *
 * UNITS: `units` is MINOR, the number the leg posts, because the counter is a
 * SUM over `token_ledger.amount`; the dial is a whole-token number a steward
 * typed, and it is converted here, once.
 */
export function mintCapGuard(slug: string, units: number): TransferGuard {
  const since = mintCycleStart();
  return async (conn) => {
    // The cap is read INSIDE the guard, under the lock, so the decision
    // cannot be made against a number the variable store has since replaced.
    // The comment here already claimed that while the read itself sat outside
    // the closure, which made it a description of an intention.
    const capHuman = numberVar(MINT_CAP_KEY);
    if (capHuman <= 0) return `Minting is disabled (${MINT_CAP_KEY} is 0)`;
    const issuance = await readCycleIssuance(conn, slug, since);
    if (issuance.net + units > toLedgerUnits(slug, capHuman)) return capRefusal(slug, capHuman, issuance);
    return null;
  };
}
