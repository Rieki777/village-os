/**
 * WHAT LEAVING CANCELS, told before the member confirms (round 3, finding 5).
 *
 * Deleting an account cancels every recurring payment the member set up
 * through Stripe: the erasure's `product-subscriptions-after-tombstone` step
 * does it, because nothing in the app lets a member cancel one themselves. The
 * member should hear that before they press delete, so the delete panel and
 * the departure page read `GET /api/profile/leaving-notices`
 * (server/routes/profile.ts) and show each sentence. It is the same sentence
 * the admin reads on the exit desk (`subscriptionsState`, server/lib/exit.ts).
 *
 * A member with nothing to cancel sees nothing here, and so does a member
 * whose read failed: this is a notice, never a block, and the erasure cancels
 * the payments whether or not the notice was read.
 */
import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { authToken } from "@/lib/gameApi";

/** One notice, as the server sends it (an exit domain that is never blocking). */
export interface LeavingNotice {
  domain: string;
  count: number;
  description: string;
}

/**
 * The member's own notices, once read; null until then, or when the read fails.
 *
 * `path` says which door the member is at. "delete" is the delete panel, and a
 * delete always cancels. "exit" is the departure page: a departure keeps a
 * member who still holds tokens, or whom the village still owes cash, as a
 * former member (round 4, finding 1; round 6, R5-0/R5-1), and since Rye's
 * ruling 8 of 2026-10-31 that departure cancels the payments too. The server
 * says which act cancels them, deleting the account or resolving the departure.
 */
export function useLeavingNotices(enabled: boolean, path: "delete" | "exit" = "delete"): LeavingNotice[] | null {
  const [notices, setNotices] = useState<LeavingNotice[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch(path === "exit" ? "/api/profile/leaving-notices?for=exit" : "/api/profile/leaving-notices", { headers: { Authorization: `Bearer ${authToken()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && Array.isArray(d.notices)) setNotices(d.notices);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, path]);
  return notices;
}

/** The notices before leaving, or nothing when there are none. */
export default function LeavingNotices({ notices }: { notices: readonly LeavingNotice[] | null }) {
  if (!notices || notices.length === 0) return null;
  return (
    <div data-leaving-notices="" className="mt-3 rounded-lg border border-border bg-background/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Repeat className="size-3.5 text-notice" aria-hidden="true" />
        Recurring payments
      </p>
      <ul className="mt-1 list-disc pl-5 text-xs text-foreground">
        {notices.map((n) => (
          <li key={n.domain}>{n.description}.</li>
        ))}
      </ul>
    </div>
  );
}
