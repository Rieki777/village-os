/**
 * WHAT LEAVING KEEPS, told before the member confirms (round 4).
 *
 * CASH THE VILLAGE STILL OWES (R4-4). Rye's ruling of 2026-10-23, "a if b
 * hasn't already happened": a leaver who still holds value stays on as a
 * former member who can claim later. Cash in `cash_owed` (0285) is value, so
 * a departure keeps an account owed cash on (`keepReasons`,
 * server/lib/exitResolve.ts, reading `unpaidCashOf` in server/lib/formerMember.ts). Deleting the account gives it up, and the delete
 * panel asks the member to say so with a tick the server checks
 * (`cashNotGivenUp`, server/lib/cashOwed.ts). The count is read from the
 * member's own list (`GET /api/me/cash-owed`); the amounts and the work stay
 * on the cash card.
 *
 * A VOTE ALREADY CAST (R4-8). A yes, no or abstain cast in person on a ballot
 * still open stays, because that ballot froze the member into its roll (the
 * snapshot law, server/lib/ballots.ts). The member hears it at both doors.
 *
 * A member owed nothing sees no cash line, and so does a member whose read
 * failed: the server asks again before it erases.
 */
import { useEffect, useState } from "react";
import { Banknote, Vote } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import {
  CASH_GIVE_UP_LABEL,
  CASH_ON_DELETION,
  CASH_ON_DEPARTURE,
  cashStillOwedWords,
  isUnpaidCash,
  type CashOwedEntry,
} from "@shared/cashOwed";

/** The sentence both doors carry about a vote already cast. */
export const VOTE_CAST_STAYS = "A vote you already cast on an open ballot still counts when it closes.";

/** How many cash payments the village still owes the signed-in member; null until read, or when the read fails. */
export function useUnpaidCash(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/me/cash-owed", { headers: { Authorization: `Bearer ${authToken()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d || !Array.isArray(d.entries)) return;
        setCount((d.entries as CashOwedEntry[]).filter((e) => isUnpaidCash(e.state)).length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  return count;
}

/** The cash line before leaving, or nothing when none is owed. On the delete panel it carries the tick. */
export function CashOwedNotice({
  count,
  door,
  givenUp,
  onGiveUp,
}: {
  count: number | null;
  door: "departure" | "deletion";
  givenUp?: boolean;
  onGiveUp?: (v: boolean) => void;
}) {
  if (!count) return null;
  return (
    <div data-leaving-cash="" className="mt-3 rounded-lg border border-border bg-background/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Banknote className="size-3.5 text-notice" aria-hidden="true" />
        {cashStillOwedWords(count)}
      </p>
      <p className="mt-1 text-xs text-foreground">{door === "departure" ? CASH_ON_DEPARTURE : CASH_ON_DELETION}.</p>
      {door === "deletion" && (
        <label className="mt-2 flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={!!givenUp} onChange={(e) => onGiveUp?.(e.target.checked)} />
          {CASH_GIVE_UP_LABEL}
        </label>
      )}
    </div>
  );
}

/** The vote line, at both doors. */
export function VotesCastNotice() {
  return (
    <p data-leaving-votes="" className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Vote className="size-3.5" aria-hidden="true" />
      {VOTE_CAST_STAYS}
    </p>
  );
}
