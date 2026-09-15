/**
 * Pure copy and arithmetic for the settlement desk. No fetching, no DOM: the
 * same rule questBoard.ts and messaging.ts follow, and the reason those
 * helpers are testable without rendering anything.
 *
 * Closing a lunation is the one admin act that releases value, so what the
 * desk SAYS is load-bearing. The confirmation has to name the deed in plain
 * words before it happens, and the result has to name what actually happened
 * afterwards, including the case where the honest answer is "nothing". A
 * founder who presses twice must be told the second press settled nothing,
 * and must never be left guessing whether it paid twice.
 *
 * The shapes mirror GET /api/admin/cycles/pending and
 * POST /api/admin/cycles/close.
 */

import { settlementRefusalWarning, type SettlementRefusal } from "@shared/moonSettlement";

export interface CycleShare {
  name: string;
  received: number;
  distinctSenders: number;
  credited: number;
}

/** One finished lunation that has not been settled yet. */
export interface DueCycle {
  id: string;
  cycleNumber: number;
  startsAt: string;
  endsAt: string;
  recipients: number;
  received: number;
  credited: number;
  token: string;
  /**
   * True when a previous close already wrote this split to the database. The
   * server pays a retry from that record, so the numbers shown are the ones
   * the button will honour.
   */
  fromPersistedSplit: boolean;
  /**
   * The moon's latest settlement vote, when it ended in a no. Close still pays
   * this split (Rye, 2026-09-14), so the desk says so before the press.
   * Optional so a payload from before the field existed reads as no refusal.
   */
  villageRefused?: SettlementRefusal | null;
  shares: CycleShare[];
}

/**
 * What a close would settle. It carries no copy of the open lunation:
 * `GET /api/game/cycle` answers that, and one fact with two sources is one
 * fact waiting to disagree with itself.
 */
export interface PendingSettlement {
  pool: { size: number; token: string; tokenName: string; problem: string | null };
  /**
   * Set when some recognition rows carry a cycle id the server cannot read.
   * `due` is then EMPTY, and it is empty for a reason that is not "nothing is
   * due". Saying "every finished lunation is already settled" in that state
   * would be the product telling a founder a fact it does not have, so every
   * sentence below checks this first.
   */
  unreadableCycles: string | null;
  due: DueCycle[];
}

/** The open lunation, as `GET /api/game/cycle` reports it. */
export interface OpenCycle {
  id: string;
  cycleNumber: number;
  startsAt: string;
  endsAt: string;
  daysRemaining: number;
  moonPhaseName: string;
}

export interface CloseResult {
  closed: number;
  cycles: Array<{ cycleNumber: number }>;
  poolCredited: number;
  governanceApplied: number;
}

/**
 * Everything a close sets in motion, in the order a person meets it.
 *
 * Four of these five are invisible from the button: the health snapshot can
 * only ever be taken at this moment, badges re-evaluate off the fresh
 * distributions, and a governance proposal held for a cycle-timed dial has
 * been telling its author "at the next cycle close" since the day it passed.
 * A confirmation that named only the pool would be a confirmation of a
 * fraction of the deed.
 */
export const CLOSE_CONSEQUENCES = [
  "Every finished lunation that is still open settles, oldest first.",
  "The value pool pays each recipient a share of the recognition they received.",
  "This lunation's health snapshot freezes. It is the only moment those numbers are true.",
  "Earned badges are re-evaluated, and anyone who crossed a threshold is told.",
  "Passed proposals held for a cycle boundary take effect, while automatic apply is on.",
] as const;

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "328", "327 and 328", "326, 327 and 328". */
export function joinNumbers(numbers: readonly number[]): string {
  const list = numbers.map((n) => String(n));
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * The sentences the confirmation step shows, in plain language, before
 * anything moves. Empty while the preview has not arrived: a confirmation
 * with nothing to confirm is worse than a spinner.
 */
export function settlementIntent(pending: PendingSettlement | null): string[] {
  if (!pending) return [];
  // Checked ahead of the empty-due line, because an unreadable id is what
  // MADE it empty. The close refuses on the same sentence at the server.
  if (pending.unreadableCycles) return [pending.unreadableCycles];
  if (pending.due.length === 0) {
    return ["Nothing is due. Every finished lunation is already settled."];
  }

  const lines: string[] = [];
  const numbers = pending.due.map((c) => c.cycleNumber);
  const recipients = pending.due.reduce((n, c) => n + c.recipients, 0);
  const credited = pending.due.reduce((n, c) => n + c.credited, 0);
  // A cycle whose split is already on record was priced in whatever token
  // that close used, which may no longer be the configured one. Name the
  // registry name only while the two agree, and fall back to the slug when
  // they do not: a wrong token name on a value release is worse than a slug.
  const token = pending.due[0]?.token ?? pending.pool.token;
  const tokenName = token === pending.pool.token ? pending.pool.tokenName : token;

  lines.push(
    `Closing ${count(pending.due.length, "finished lunation", "finished lunations")}: ${joinNumbers(numbers)}.`,
  );
  lines.push(
    credited > 0
      ? `${count(recipients, "member", "members")} share ${credited} ${tokenName}, credited the moment you confirm.`
      : `${count(recipients, "member", "members")} are recorded as acknowledged. The pool releases nothing this time.`,
  );

  const sticky = pending.due.filter((c) => c.fromPersistedSplit).map((c) => c.cycleNumber);
  if (sticky.length > 0) {
    lines.push(
      `An earlier close already wrote the split for ${joinNumbers(sticky)}. This pays from that record, and anything already paid pays once.`,
    );
  }
  // A founder may overrule the village, and the confirmation is the last place
  // to see it before the press.
  for (const c of pending.due) {
    if (c.villageRefused) lines.push(`Lunation ${c.cycleNumber}: ${settlementRefusalWarning(c.villageRefused)}`);
  }
  if (pending.pool.problem) lines.push(pending.pool.problem);
  lines.push("Settlement cannot be undone from this desk.");
  return lines;
}

/**
 * A misconfigured pool stops the close at the server, and so does a cycle id
 * the server cannot read. Say so before the press, either way.
 */
export function settlementBlocked(pending: PendingSettlement | null): boolean {
  return !!pending?.pool.problem || !!pending?.unreadableCycles;
}

/**
 * What the close actually did, read back from its own answer.
 *
 * The double-press case is the one that matters. The server skips any
 * lunation already recorded as closed, so a second press answers 200 with
 * `closed: 0`, and a desk that printed a bare success toast would tell a
 * founder they had just settled the month twice.
 */
export function closeReport(
  result: CloseResult,
  tokenName: string,
): { settled: boolean; headline: string; lines: string[] } {
  const numbers = (result.cycles ?? []).map((c) => c.cycleNumber);
  if (!result.closed) {
    return {
      settled: false,
      headline: "Nothing was due",
      lines: [
        "Every finished lunation was already settled. No value moved, and nothing paid twice.",
      ],
    };
  }

  const lines = [
    `${count(result.closed, "lunation is", "lunations are")} now closed: ${joinNumbers(numbers)}.`,
    result.poolCredited > 0
      ? `The pool released ${result.poolCredited} ${tokenName}.`
      : "The pool released nothing. Recognition was recorded all the same.",
  ];
  if (result.governanceApplied > 0) {
    lines.push(
      `${count(result.governanceApplied, "passed proposal", "passed proposals")} took effect at the boundary.`,
    );
  }
  return {
    settled: true,
    headline: `Settled ${count(result.closed, "lunation", "lunations")}`,
    lines,
  };
}
