/**
 * RESOLVING A DEPARTURE: A FORMER MEMBER, OR A TOMBSTONE.
 *
 * The founder's ruling of 2026-10-23. "As a general rule members keep their
 * tokens." Asked whether a leaver should (a) stay on as a former member,
 * account and balances kept, so they can come back or claim later, or (b)
 * have the account erased after first moving their voice and equity across to
 * Hypha, Rye answered: "a if b hasn't already happened."
 *
 * So resolve asks one question once the blocking domains are clean: does the
 * member's own account still hold anything of value?
 *
 *   - YES: they stay on as a FORMER MEMBER. The account, the sign-in and every
 *     balance stay exactly where they are. Membership ends, the roles they
 *     hold are vacated by the same calls the erasure makes, and the exit
 *     records what they still hold.
 *   - NO, because they carried it across to Hypha or there was never anything:
 *     the anonymize tombstone runs, exactly as it always has.
 *
 * WHAT COUNTS AS VALUE. A POSITIVE balance in a platform-governed token whose
 * kind is not `recognition`. Recognition is a record of thanks and it is what
 * shares the cycle pool, so it never kept anybody's account alive; the sweep
 * settles it at the shipped dials. A Hypha mirror never posts to this ledger,
 * and a balance the registry cannot name is no token any surface can show,
 * so neither counts. A negative balance never reaches here: it blocks resolve.
 *
 * WHAT A FORMER MEMBER LOSES, and each line has a reason:
 *   - `membershipGranted` AND `stageGranted`. Admission is either one
 *     (`isAdmitted`, server/lib/admission.ts), so ending membership clears
 *     both, exactly as the tombstone does. Every rung above Member closes
 *     behind the door, `ballot.vote` and `member.vouch` with them.
 *   - The account tier (`role`) goes back to `member`, as the tombstone writes
 *     it, so somebody who left the village cannot keep administering it.
 *   - Their PERMISSION holdings (`endPermissionHoldings`), their ORG seatings
 *     (`releaseSeatingsForUser`), and every seat application not yet seated
 *     (`withdrawUnseatedOf`), after the alignment texts they are party to are
 *     marked `party_left` (`recordPartyLeft`), in the erasure's order and for
 *     the erasure's reason: a released seating ends seat terms by the
 *     derivation, and the record would then never say why.
 *
 * WHAT THEY KEEP: everything else. Their name, sign-in, sessions, wallet,
 * history and balances. An admin can admit them again through any door that
 * admits anybody.
 *
 * ORDER AND RETRY. Every step is a DELETE keyed on the member, an UPDATE
 * writing a constant, or a write keyed on its subject, so a resolve that dies
 * part way is retried by pressing it again. The exit is marked resolved LAST,
 * which is what keeps it retryable: until that write lands, the exit desk
 * still offers the button.
 */
import type { Pool } from "mysql2/promise";
import { fromLedgerUnits } from "./economy";
import { balancesFor, memberAccount, tokenDef, type TokenDef } from "./ledger";
import { anonymizeMember, endPermissionHoldings, type ErasureDeps } from "./erasure";
import type { ErasureOutcome } from "./memberDrivers";
import { recordPartyLeft } from "./alignmentEndings";
import { releaseSeatingsForUser } from "./orgChart";
import { recordEvent } from "./events";
import { withdrawUnseatedOf } from "../repos/seatApplications";
import { markExitResolved } from "../repos/exitNotes";

/** One balance that keeps an account alive, in HUMAN units. */
export interface HeldValue {
  token: string;
  name: string;
  kind: string;
  /** `fromLedgerUnits` of the balance: what a person reads. */
  amount: number;
}

/** The two ways a resolve ends. */
export type ExitOutcome = "former" | "erased";

export interface ExitResolution {
  outcome: ExitOutcome;
  /** What a former member still holds. Empty when the account was erased. */
  held: HeldValue[];
  /** What the outside stores answered, on the erasure path only. */
  external: ErasureOutcome | null;
}

/** Whether a balance in this token keeps an account alive at resolve. */
export function countsAsValue(def: Pick<TokenDef, "kind" | "governance"> | undefined): boolean {
  return !!def && def.governance === "platform" && def.kind !== "recognition";
}

/**
 * Every balance the member's own account holds that keeps it alive, in token
 * order so the line written onto the exit reads the same on every run.
 */
export async function heldValueOf(pool: Pool, userId: string): Promise<HeldValue[]> {
  const balances = await balancesFor(pool, memberAccount(userId));
  const held: HeldValue[] = [];
  for (const [token, units] of Object.entries(balances)) {
    if (!(units > 0)) continue;
    const def = tokenDef(token);
    if (!def || !countsAsValue(def)) continue;
    held.push({ token, name: def.name, kind: def.kind, amount: fromLedgerUnits(token, units) });
  }
  return held.sort((a, b) => a.token.localeCompare(b.token));
}

/** The marker the resolution line is written under, matched by `SETTLE_LINE` in exit.ts. */
export const FORMER_MEMBER_MARK = "kept as a former member: ";

/**
 * The line a former member's exit carries: the date and what they still hold.
 * It names no person, which is why an erasure asked for later keeps it.
 */
export function formerMemberNote(held: readonly HeldValue[], now: Date): string {
  const what = held.map((h) => `${h.amount} ${h.token}`).join(", ");
  return `\n[${now.toISOString().slice(0, 10)}] ${FORMER_MEMBER_MARK}still holds ${what}`.slice(0, 2000);
}

/**
 * Membership ends and the roles go; the account and everything in it stay.
 * The header says what each step is for.
 */
export async function keepAsFormerMember(pool: Pool, target: any, deps: ErasureDeps, now: Date = new Date()): Promise<void> {
  const userId = String(target.id);
  await recordPartyLeft(pool, userId, now);
  await endPermissionHoldings(userId, deps);
  await releaseSeatingsForUser(pool, userId, "member left the village");
  await withdrawUnseatedOf(pool, userId);
  await deps.members.update(userId, (u: any) => {
    u.membershipGranted = false;
    u.stageGranted = null;
    u.role = "member";
  });
}

/**
 * The terminal act of a departure, once the blocking domains are clean. The
 * caller has already refused while any of them stands, and sends the vacated
 * roles' notices itself, because it read the roles before this ran.
 */
export async function resolveExit(
  pool: Pool,
  input: { exitId: string; target: any; actorId: string | null; agreementRef?: unknown; deps: ErasureDeps; now?: Date },
): Promise<ExitResolution> {
  const now = input.now ?? new Date();
  const agreement = input.agreementRef ? String(input.agreementRef).slice(0, 255) : null;
  const held = await heldValueOf(pool, String(input.target.id));

  if (!held.length) {
    const external = await anonymizeMember(pool, input.target, input.actorId, input.deps);
    await markExitResolved(pool, input.exitId, agreement, "");
    return { outcome: "erased", held, external };
  }

  await keepAsFormerMember(pool, input.target, input.deps, now);
  await markExitResolved(pool, input.exitId, agreement, formerMemberNote(held, now));
  await recordEvent(pool, {
    kind: "audit",
    text: "member:kept-as-former",
    actorUserId: input.actorId,
    entityType: "user",
    entityRef: String(input.target.id),
    audience: "admin",
  });
  return { outcome: "former", held, external: null };
}
