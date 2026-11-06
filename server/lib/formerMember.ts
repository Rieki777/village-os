/**
 * WHO IS A FORMER MEMBER, AND WHAT STILL KEEPS ONE'S ACCOUNT.
 *
 * The founder's answer of 2026-10-30 to the exit suggestions put to him: "yes
 * build all the exit suggestions!" Five of the six read this file.
 *
 *   1. A vote a leaver cast before leaving stands; after they leave they cast
 *      no new one (`castVote`, server/lib/ballots.ts, reads `leftTheVillage`).
 *   2. A former member is on no new ballot's roll, whatever any badge grants
 *      (`withoutFormerMembers`, which `buildElectorate` runs).
 *   3. A vouch they gave somebody still waiting stops counting
 *      (`livingVouchesFor`, server/repos/vouches.ts, reads `isFormerMember`).
 *   5. The delete screen lists what they hold (`unpaidCashOf` beside
 *      `heldValueOf`, served by server/routes/ownHoldings.ts).
 *   6. Unpaid cash owed counts as value at resolve, so it keeps the account
 *      (`resolveExit`), and the exit desk shows it (`exitOpenState`).
 *
 * ── WHAT A FORMER MEMBER IS, AT THE MOMENT IT IS ASKED ──────────────────────
 *
 * Three facts, each structural:
 *
 *   - the account has a RESOLVED exit on record (`exits.status`);
 *   - it is not a tombstone (an erased account is somebody gone, and every
 *     reader already leaves those out by the address);
 *   - it is not ADMITTED now (`isAdmitted`, server/lib/admission.ts).
 *
 * The last fact is what makes coming back cost nothing extra. An admin who
 * admits a former member again through any door that admits anybody makes
 * them a member at that moment, and every reader here answers accordingly,
 * with no flag to clear and no second record to keep in step.
 *
 * NEVER THE RESOLUTION NOTE. `kept as a former member: ...` is display copy on
 * the exit row, and a parser keyed on display copy breaks on the next copy
 * edit. The note says what happened; this file reads what is true.
 *
 * NO RAW SQL HERE. Both reads live in server/repos/formerMembers.ts.
 */
import type { Pool } from "mysql2/promise";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { formatMoney } from "../../shared/money";
import { isAdmitted, type AdmissionRecord, type LadderStage } from "./admission";
import { isTombstone } from "./oauthAccounts";
import { hasResolvedExit, resolvedExitUserIds, unpaidCashTotalsOf } from "../repos/formerMembers";

/** The member fields this decision reads. Any member record satisfies it. */
export interface FormerMemberFacts extends AdmissionRecord {
  id?: unknown;
  email?: unknown;
}

/**
 * The pure answer, for a caller that already read whether the account has a
 * resolved exit. Every other reader here goes through this one.
 */
export function isFormerMember(
  person: FormerMemberFacts,
  hasResolvedExitOnRecord: boolean,
  stages: readonly LadderStage[] = GAME_CONFIG.stages,
): boolean {
  if (!hasResolvedExitOnRecord) return false;
  if (isTombstone({ email: String(person.email ?? "") })) return false;
  return !isAdmitted(person, stages);
}

/** Whether this account left the village and has not been admitted again. */
export async function leftTheVillage(pool: Pool, person: FormerMemberFacts | null | undefined): Promise<boolean> {
  const id = String(person?.id ?? "");
  if (!person || !id) return false;
  // The two answers the record alone gives come first, so a member who is in
  // costs no read at all.
  if (isTombstone({ email: String(person.email ?? "") }) || isAdmitted(person, GAME_CONFIG.stages)) return false;
  return isFormerMember(person, await hasResolvedExit(pool, id));
}

/**
 * A roll's candidates with every former member taken out, in one read.
 *
 * `buildElectorate` (server/index.ts) runs this over the present members
 * before it asks the gate, so a badge granting `ballot.vote`, or a village
 * that lowered that key's rung, cannot put somebody who left onto a new roll.
 * A roll already frozen is never rewritten: that is `castVote`'s side.
 */
export async function withoutFormerMembers<T extends FormerMemberFacts>(pool: Pool, people: readonly T[]): Promise<T[]> {
  const left = await resolvedExitUserIds(pool);
  if (left.size === 0) return [...people];
  return people.filter((p) => !isFormerMember(p, left.has(String(p.id ?? ""))));
}

/** Cash still owed to one member in one currency, in minor units. */
export interface UnpaidCash {
  currency: string;
  amountMinor: number;
  /** How many `cash_owed` rows make up the amount. */
  rows: number;
}

/** What the village still owes this member in cash, `owed` or `claimed`, per currency. */
export async function unpaidCashOf(pool: Pool, userId: string): Promise<UnpaidCash[]> {
  return (await unpaidCashTotalsOf(pool, userId)).filter((c) => c.amountMinor > 0);
}

/**
 * "$25.00, CHF 50.00": the cash in the platform's one money format
 * (`formatMoney`, shared/money.ts), so the exit desk and the departure record
 * read the amount the way every other page does (the e2e sweep, E11: they
 * said "50.00 CHF" while the rest said "CHF 50.00"). The exponent comes from
 * the currency, so a currency with no minor unit prints none. Never converted:
 * this text is written onto the permanent exit row.
 */
export function cashWords(owed: readonly UnpaidCash[]): string {
  return owed.map((c) => formatMoney(c.amountMinor, c.currency)).join(", ");
}
