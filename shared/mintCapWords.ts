/**
 * WHAT THE ISSUANCE CAP COUNTS, said once for the dial and the Mint by hand
 * panel (2026-11-01).
 *
 * `ledger.admin_mint_cycle_cap` sums what leaves the mint faucet (`sys:mint`)
 * in a lunar cycle, net of what comes back (server/lib/mintCap.ts). Pay for
 * work and the gratitude pool issue from faucets of their own and were never
 * counted, which is right: Rye, 2026-10-22, "we definitely can't have caps on
 * what things pay". Both surfaces used to say "every door and not by hand
 * alone", which promised a cap on work pay that does not exist.
 */
export const MINT_CAP_SCOPE =
  "It counts what the mint faucet issues: hand-mints, co-signed grants, treasury stocking, stay-credit comps, purchases and adjustments, " +
  "and the credits a work-exchange quest releases all spend the same number. Pay for quests, roles and accepted proposals, " +
  "and the gratitude pool, issue from faucets of their own and are not counted.";
