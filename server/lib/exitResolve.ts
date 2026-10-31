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
 * CASH THE VILLAGE OWES THEM COUNTS TOO (round 4, R4-4; Rye, 2026-10-30, the
 * sixth of the exit suggestions). An unpaid row in `cash_owed` (0285), owed or
 * claimed, keeps the account on exactly as a token balance does, so the
 * treasurer still has somebody to pay and the member can sign in to see it
 * marked paid. It is checked beside `heldValueOf` by `unpaidCashOf`
 * (server/lib/formerMember.ts) and never folded into it: a `HeldValue` is a
 * token. Cash already marked `paid` keeps nothing.
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
 *   - Their open invitation links (`revokeOpenInvitesOf`, round 6, R5-2). A
 *     link is its maker's vouch, and a former member can no longer vouch, so
 *     a link made before they left must not admit anybody in their name.
 *   - Their recurring payments (`cancelFormerMembersSubscriptions`, Rye,
 *     2026-10-31, ruling 8: "a former member's exit cancels their
 *     subscriptions"). The erasure's cancel and its no-key hand-off, so
 *     /review owes whatever Stripe could not be asked to stop. Last of the
 *     steps, so a cancel that lands earlier leaves their card untouched.
 *   - Every DELEGATION they gave or carried (`endDelegationsOf`), the call the
 *     erasure makes, notices included (Rye, 2026-10-30). Each member who
 *     handed them a voice is told and decides their own votes again, and a
 *     vote copied from them onto an open ballot is no longer cast. Their OWN
 *     votes on a ballot still open stand: the roll froze with them on it, and
 *     `castVote` refuses them a new one (`leftTheVillage`).
 *
 * WHAT THEY KEEP: everything else. Their name, sign-in, sessions, wallet,
 * history and balances. An admin can admit them again through any door that
 * admits anybody, and every reader of "former member" answers from that
 * moment (`isFormerMember`, server/lib/formerMember.ts).
 *
 * THEIR VOUCHES are never touched here, and that is the rule working. A vouch
 * that admitted somebody already did its work, and the membership it wrote
 * stands. A vouch they gave somebody still waiting stops counting, because a
 * vouch is a member's ongoing promise, and that is read where vouches are
 * counted (`livingVouchesFor`, server/repos/vouches.ts). The row stays, so a
 * former member admitted again finds their word counting again.
 *
 * ORDER AND RETRY. Every step is a DELETE keyed on the member, an UPDATE
 * writing a constant, or a write keyed on its subject, so a resolve that dies
 * part way is retried by pressing it again. The exit is marked resolved LAST,
 * which is what keeps it retryable: until that write lands, the exit desk
 * still offers the button.
 *
 * ONE AT A TIME WITH "THEY'RE STAYING" (round 4). The route reads the exit's
 * status once, at the top, and this used to run every step and then write
 * 'resolved' with no status condition. A cancel that landed in between was
 * overwritten: on this path the member the admins had just kept lost their
 * membership anyway, and on the tombstone path a cancel that landed before
 * the deletion began let it close their account. Now each act that matters
 * happens inside the exit's row hold (`whileExitHeld`,
 * server/repos/exitNotes.ts), which the cancel takes too, and only while the
 * exit still reads open or settling:
 *
 *   - before each step a former member's resolve runs, the line naming it
 *     goes onto the exit (`resolveEndingLine`, server/lib/exit.ts), so a
 *     cancel can say what does not come back;
 *   - the end of membership and the write to 'resolved' happen in one hold;
 *   - on the tombstone path the erasure record is opened in the hold, so a
 *     cancel from then on finds the deletion running and refuses, as it has
 *     since round 2.
 *
 * A resolve that finds the exit closed stops where it is, ends nothing more,
 * and answers `outcome: "stopped"` with the sentence for the admin.
 */
import type { Pool } from "mysql2/promise";
import { fromLedgerUnits } from "./economy";
import { balancesFor, memberAccount, tokenDef, type TokenDef } from "./ledger";
import {
  anonymizeMember,
  beginMemberErasure,
  cancelFormerMembersSubscriptions,
  endPermissionHoldings,
  noticeSpine,
  type ErasureDeps,
} from "./erasure";
import type { ErasureOutcome } from "./memberDrivers";
import { recordPartyLeft } from "./alignmentEndings";
import { releaseSeatingsForUser } from "./orgChart";
import { recordEvent } from "./events";
import { endedInWords, resolveEndingLine, resolveEndingsIn, type FormerMemberStep } from "./exit";
import { endDelegationsOf } from "./delegation";
import { cashWords, unpaidCashOf, type UnpaidCash } from "./formerMember";
import { withdrawUnseatedOf } from "../repos/seatApplications";
import { revokeOpenInvitesOf } from "../repos/memberInvites";
import { markExitResolved, whileExitHeld, type HeldExit } from "../repos/exitNotes";
import type { FormerMemberHold } from "./exit";

/** One balance that keeps an account alive, in HUMAN units. */
export interface HeldValue {
  token: string;
  name: string;
  kind: string;
  /** `fromLedgerUnits` of the balance: what a person reads. */
  amount: number;
}

/** The ways a resolve ends: one of the two outcomes, or stopped because the exit closed first. */
export type ExitOutcome = "former" | "erased" | "stopped";

/** Why a resolve stopped, for the route to answer with. */
export interface ResolveStopped {
  /** What the exit read when the resolve came to act, or null when there is none. */
  status: string | null;
  /** The sentence the admin reads. */
  message: string;
  /** The steps the exit's record says a resolve had already begun, each once. */
  alreadyEnded: FormerMemberStep[];
  /** The permission roles those steps ended, by id. */
  vacatedRoles: string[];
}

export interface ExitResolution {
  outcome: ExitOutcome;
  /** What a former member still holds. Empty when the account was erased. */
  held: HeldValue[];
  /** The cash still owed to a former member, per currency. Empty when the account was erased. */
  owed: UnpaidCash[];
  /** What the outside stores answered, on the erasure path only. */
  external: ErasureOutcome | null;
  /** Present exactly when `outcome` is "stopped". */
  stopped?: ResolveStopped;
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

/**
 * The exit path's answer to "does resolving this departure keep the account?",
 * handed to `exitOpenState` and `subscriptionsState` (server/lib/exit.ts) by
 * the routes that show the sentence. It lives here, beside `resolveExit`'s
 * rule, because exit.ts is imported by the economy and may not import this
 * file (shared/seatSettings.boundary.test.ts). It asks `keepsAsFormerMember`,
 * the rule resolve itself reads, so a leaver kept only for cash owed is told
 * they stay on as a former member (round 6, R5-0/R5-1), and that resolving
 * the departure cancels their recurring payments (Rye, 2026-10-31, ruling 8).
 * The reason phrase opens the sentence the member and the admin read, and
 * names both reasons.
 */
export const FORMER_MEMBER_HOLD: FormerMemberHold = {
  keptAsFormerMember: (pool, userId) => keepsAsFormerMember(pool, userId),
  reason: "Holding tokens, or being owed cash by the village,",
};

/**
 * The one rule for whether resolve keeps a leaver on as a former member: they
 * hold value (`heldValueOf`) or the village still owes them cash
 * (`unpaidCashOf`). Resolve and every departure notice that predicts its
 * outcome ask this, so a new reason to keep someone cannot split them (R5-0).
 */
export async function keepsAsFormerMember(pool: Pool, userId: string): Promise<boolean> {
  return (await keepReasons(pool, userId)).keeps;
}

async function keepReasons(pool: Pool, userId: string): Promise<{ held: HeldValue[]; owed: UnpaidCash[]; keeps: boolean }> {
  const held = await heldValueOf(pool, userId);
  const owed = await unpaidCashOf(pool, userId);
  return { held, owed, keeps: held.length > 0 || owed.length > 0 };
}

/** The marker the resolution line is written under, matched by `SETTLE_LINE` in exit.ts. */
export const FORMER_MEMBER_MARK = "kept as a former member: ";

/**
 * The line a former member's exit carries: the date, what they still hold, and
 * the cash still owed to them. It names no person, which is why an erasure
 * asked for later keeps it.
 */
export function formerMemberNote(held: readonly HeldValue[], now: Date, owed: readonly UnpaidCash[] = []): string {
  const parts: string[] = [];
  if (held.length) parts.push(`still holds ${held.map((h) => `${h.amount} ${h.token}`).join(", ")}`);
  if (owed.length) parts.push(`is owed ${cashWords(owed)} in cash`);
  return `
[${now.toISOString().slice(0, 10)}] ${FORMER_MEMBER_MARK}${parts.join("; ")}`.slice(0, 2000);
}

/** One step a former member's resolve runs before membership ends. */
interface FormerMemberStepRun {
  name: FormerMemberStep;
  /** The permission roles it ends, by id, read just before it runs. */
  roles?: () => string[];
  run: () => Promise<unknown>;
}

/**
 * Membership ends and the roles go; the account and everything in it stay.
 * The header says what each step is for, and how the hold orders them.
 *
 * Null when it ran to the end and the exit is resolved. Otherwise the exit as
 * the hold read it when it was no longer open: nothing after that point ran.
 */
export async function keepAsFormerMember(
  pool: Pool,
  input: { exitId: string; target: any; actorId?: string | null; deps: ErasureDeps; now: Date; agreementRef: string | null; note: string },
): Promise<HeldExit | null> {
  const { deps, now } = input;
  const userId = String(input.target.id);
  const steps: FormerMemberStepRun[] = [
    { name: "alignment-party-left", run: () => recordPartyLeft(pool, userId, now) },
    {
      name: "role-holdings",
      roles: () => deps.loadRoleHolders().filter((h) => h.userId === userId).map((h) => String(h.roleId ?? "")).filter(Boolean),
      run: () => endPermissionHoldings(userId, deps),
    },
    { name: "org-seatings", run: () => releaseSeatingsForUser(pool, userId, "member left the village") },
    { name: "role-applications", run: () => withdrawUnseatedOf(pool, userId) },
    // A link is its maker's vouch, and a former member can no longer vouch: their open links stop admitting (R5-2).
    { name: "invitations", run: () => revokeOpenInvitesOf(pool, userId) },
    // Rye, 2026-10-31, ruling 8: their recurring payments stop with them, through the erasure's cancel and hand-off.
    { name: "subscriptions", run: () => cancelFormerMembersSubscriptions(pool, userId, input.actorId ?? null, deps) },
  ];
  for (const step of steps) {
    // The line goes on first and the step runs after the hold: see `resolveEndingLine` for why that order.
    const closed = await whileExitHeld(pool, input.exitId, async (hold) => {
      if (!hold.exit.open) return hold.exit;
      await hold.appendNote(resolveEndingLine(step.name, step.roles?.() ?? [], now));
      return null;
    });
    if (closed) return closed;
    await step.run();
  }
  /*
   * The irreversible end and the move to resolved, in one hold: a cancel waits for both or lands before either.
   *
   * THEIR DELEGATIONS END HERE, with membership, never as a step before it (Rye, 2026-10-30; the erasure's own
   * call, notices included). Each member who handed them a voice is told they left, and a vote copied from them is
   * no longer cast. A step could run and then be cancelled, telling those members something false, and the notice's
   * one stable key would then swallow the true one on a later departure. Inside the hold, a cancel lands before it
   * or after the exit is resolved. It runs once more after the hold commits: between the end of membership and the
   * commit the leaver is not yet a former member to the delegation routes, so an offer accepted in that moment is
   * ended too. Idempotent: a second run finds no live row and tells nobody twice.
   */
  const closed = await whileExitHeld(pool, input.exitId, async (hold) => {
    if (!hold.exit.open) return hold.exit;
    await deps.members.update(userId, (u: any) => {
      u.membershipGranted = false;
      u.stageGranted = null;
      u.role = "member";
    });
    await endDelegationsOf(pool, userId, noticeSpine(pool, deps));
    await hold.markResolved(input.agreementRef, input.note);
    return null;
  });
  if (!closed) await endDelegationsOf(pool, userId, noticeSpine(pool, deps));
  return closed;
}

/** What a resolve that found the exit closed tells the admin, with what the exit's record says had already ended. */
export function stoppedBy(exit: HeldExit): ResolveStopped {
  const endings = resolveEndingsIn(exit.resolution);
  const base = { status: exit.status, alreadyEnded: endings.steps, vacatedRoles: endings.roles };
  if (exit.status === "cancelled") {
    const message = endings.steps.length
      ? "This departure was closed with They're staying while the resolve was running, so it stopped before their membership ended " +
        `and they are still a member. It had already ended ${endedInWords(endings)}, and those do not come back on their own. ` +
        "Put back what they still need by hand."
      : "This departure was closed with They're staying before the resolve began, so nothing ended and they are still a member.";
    return { ...base, message };
  }
  if (exit.status === "resolved") return { ...base, message: "This departure is already resolved." };
  return { ...base, message: "No open exit with that id" };
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
  const { held, owed, keeps } = await keepReasons(pool, String(input.target.id));

  if (!keeps) {
    // Opened in the hold, so a cancel from here on finds the deletion running and refuses.
    const closed = await whileExitHeld(pool, input.exitId, async (hold) => {
      if (!hold.exit.open) return hold.exit;
      await beginMemberErasure(pool, input.target);
      return null;
    });
    if (closed) return { outcome: "stopped", held, owed, external: null, stopped: stoppedBy(closed) };
    const external = await anonymizeMember(pool, input.target, input.actorId, input.deps, { begun: true });
    // Conditional like every resolve write. It finds the exit closed only when a cancel ended a record
    // that ran past MAY_STILL_BE_RUNNING_SECONDS, and the account is closed either way.
    await markExitResolved(pool, input.exitId, agreement, "");
    return { outcome: "erased", held, owed, external };
  }

  const closed = await keepAsFormerMember(pool, {
    exitId: input.exitId,
    target: input.target,
    actorId: input.actorId,
    deps: input.deps,
    now,
    agreementRef: agreement,
    note: formerMemberNote(held, now, owed),
  });
  if (closed) return { outcome: "stopped", held, owed, external: null, stopped: stoppedBy(closed) };
  await recordEvent(pool, {
    kind: "audit",
    text: "member:kept-as-former",
    actorUserId: input.actorId,
    entityType: "user",
    entityRef: String(input.target.id),
    audience: "admin",
  });
  return { outcome: "former", held, owed, external: null };
}
