/**
 * THE LIVE TIME VOTE on a gathering's card (the comms build spec 5.10).
 *
 * Closed, it is one line under the gathering: "Time still being voted" and
 * the time leading now. Open, it shows every time on offer with its count,
 * the first names behind it for a signed-in member while the host shows
 * them, and a tick box per time for anyone who can vote. A tick saves at
 * once, and the gathering's own time follows whichever time is winning, so
 * the page asks the calendar to reload after a save.
 *
 * WHILE THE PAGE IS VISIBLE the tally refreshes every ten seconds, so a
 * member watching sees other people's picks land. A hidden tab asks nothing.
 *
 * A member's page, so semantic tokens throughout: it follows the theme the
 * village chose. The server decides who sees names: a response for a
 * signed-out reader carries counts and nothing person-shaped.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarItem } from "@shared/gatherings";
import type { PollView } from "@shared/comms/timePoll";
import { authToken } from "@/lib/gameApi";

const REFRESH_MS = 10_000;

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export default function TimePollPanel({ item, onChanged }: { item: CalendarItem; onChanged?: () => void }) {
  const summary = item.timePoll;
  const [open, setOpen] = useState(false);
  const [poll, setPoll] = useState<PollView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(item.id)}/time-poll`, { headers: headers() });
      if (!res.ok) return;
      const body = await res.json();
      if (alive.current) setPoll(body.poll ?? null);
    } catch {
      /* the last tally stays on screen */
    }
  }, [item.id]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [open, load]);

  if (!summary) return null;

  const toggle = async (optionId: string, on: boolean) => {
    if (!poll?.mine) return;
    const next = on ? Array.from(new Set([...poll.mine, optionId])) : poll.mine.filter((id) => id !== optionId);
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(item.id)}/time-poll/vote`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ optionIds: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setProblem(body?.error ?? "That didn't save. Try again.");
      else {
        setPoll(body.poll ?? null);
        onChanged?.();
      }
    } catch {
      setProblem("That didn't save. Try again.");
    }
    setBusy(false);
  };

  const voting = summary.state === "open";
  const signedIn = Boolean(authToken());

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-foreground">
          <span className="font-medium">{voting ? (summary.stillVoting ? "Time still being voted" : "Time set for this evening") : "Time set"}</span>
          {summary.leadingLabel && voting && <span className="text-muted-foreground"> · Leading: {summary.leadingLabel}</span>}
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="px-3 py-1 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted"
        >
          {open ? "Hide the vote" : voting ? "Vote on the time" : "See the vote"}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {!poll && <p className="text-sm text-muted-foreground">Loading...</p>}
          {poll && (
            <>
              {voting && <p className="text-sm text-muted-foreground mb-2">Pick every time you can make. The time with the most picks becomes the gathering's time.</p>}
              {problem && (
                <p role="alert" className="text-sm text-destructive mb-2">
                  {problem}
                </p>
              )}
              <ul className="space-y-1.5">
                {poll.options.map((o) => {
                  const mine = poll.mine?.includes(o.id) ?? false;
                  return (
                    <li key={o.id} className="flex items-start gap-2 text-sm">
                      {poll.canVote ? (
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={mine}
                          disabled={busy}
                          onChange={(e) => void toggle(o.id, e.target.checked)}
                          aria-label={`I can make ${o.label}`}
                        />
                      ) : null}
                      <span className="min-w-0">
                        <span className={o.applied ? "font-semibold text-foreground" : "text-foreground"}>{o.label}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {o.count} can come
                          {o.leading ? " · leading" : ""}
                          {o.pinned ? " · chosen by the host" : ""}
                        </span>
                        {o.names && o.names.length > 0 && <span className="block text-xs text-muted-foreground">{o.names.join(", ")}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {voting && !poll.canVote && !signedIn && <p className="text-xs text-muted-foreground mt-2">Sign in to vote.</p>}
              {voting && poll.closesAt && <p className="text-xs text-muted-foreground mt-2">Voting closes {new Date(poll.closesAt).toLocaleString()}.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
