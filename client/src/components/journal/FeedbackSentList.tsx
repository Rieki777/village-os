/**
 * SENT: what this member has written to others, with where each one stands
 * and when it arrives. Anything not yet delivered can be withdrawn.
 *
 * The batch goes out on Monday at 09:00 VILLAGE time, so the arrival is
 * printed in the village's zone, named, and the reader's own clock is a second
 * line only when it reads differently. Printed in the reader's zone alone, a
 * member eleven hours behind the village read "Monday batch, arrives Sunday".
 * Until the village's zone is known, the line makes no weekday claim at all.
 */
import { useEffect, useState } from "react";
import type { FeedbackSent, FeedbackStatus } from "@shared/journal";
import { useSeason } from "@/lib/gameApi";
import { problemText, sentFeedback, withdrawFeedback } from "@/lib/journalApi";
import { villageClock, villageDay, viewerZone } from "@/components/calendar/calendarTime";
import { BTN_SECONDARY, CARD, HINT, dayLabel, timeLabel } from "./ui";

const STATUS_TEXT: Record<FeedbackStatus, string> = {
  draft: "Not queued",
  queued: "Waiting for the Monday batch",
  withdrawn: "Withdrawn",
};

/**
 * Where one message stands. `local` is the reader's own clock for the same
 * instant, present only when it reads differently from the village's.
 * `zone` is the village's IANA zone, or null while it is not known.
 */
export function statusLine(s: FeedbackSent, zone: string | null): { main: string; local: string | null } {
  if (s.status === "queued" && s.delivered) return { main: "Delivered", local: null };
  // Held: they said no to feedback before it reached them. It waits, and the
  // author may still withdraw it. Never a Monday that has already gone by.
  if (s.status === "queued" && s.held) {
    return { main: "They are not taking feedback right now, so this waits until they are.", local: null };
  }
  if (s.status === "queued" && s.deliverAfter) {
    const at = new Date(s.deliverAfter);
    if (Number.isNaN(at.getTime())) return { main: STATUS_TEXT.queued, local: null };
    if (!zone) {
      return { main: `Queued, arrives ${dayLabel(s.deliverAfter)} at ${timeLabel(s.deliverAfter)} where you are`, local: null };
    }
    const village = `${villageDay(at, zone)} at ${villageClock(at, zone)}`;
    const mine = viewerZone();
    const yours = `${villageDay(at, mine)} at ${villageClock(at, mine)}`;
    return {
      main: `${STATUS_TEXT.queued}, arrives ${village}, village time`,
      local: mine !== zone && yours !== village ? `${yours} where you are` : null,
    };
  }
  return { main: STATUS_TEXT[s.status] ?? s.status, local: null };
}

export default function FeedbackSentList({ refreshKey = 0 }: { refreshKey?: number }) {
  // The server queues against the same zone (`seasonState().timezone`, "UTC" when unset).
  const season = useSeason();
  const zone = season ? season.timezone || "UTC" : null;
  const [sent, setSent] = useState<FeedbackSent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    sentFeedback()
      .then((s) => live && setSent(s))
      .catch((err) => {
        if (!live) return;
        setSent([]);
        setProblem(problemText(err, "What you have sent could not be read just now."));
      });
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const withdraw = async (id: string) => {
    setBusy(id);
    setProblem(null);
    try {
      await withdrawFeedback(id);
      setSent((was) => (was ?? []).map((s) => (s.id === id ? { ...s, status: "withdrawn" } : s)));
    } catch (err) {
      setProblem(problemText(err, "It could not be withdrawn. It may already have been delivered."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="fb-sent" className="space-y-3">
      <h2 id="fb-sent" className="font-display text-xl font-bold text-foreground">
        Sent
      </h2>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {sent !== null && sent.length === 0 && !problem && <p className={HINT}>Nothing sent yet.</p>}
      <ul className="space-y-3">
        {(sent ?? []).map((s) => {
          const status = statusLine(s, zone);
          return (
            <li key={s.id} className={CARD}>
              <p className="text-sm font-semibold text-foreground">To {s.recipientName}</p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{s.message}</p>
              <p className="mt-2 text-xs text-muted-foreground">{status.main}</p>
              {status.local && <p className="text-xs text-muted-foreground">{status.local}</p>}
              {s.status === "queued" && !s.delivered && (
                <button
                  type="button"
                  className={`${BTN_SECONDARY} mt-3`}
                  onClick={() => void withdraw(s.id)}
                  disabled={busy === s.id}
                >
                  {busy === s.id ? "Withdrawing..." : "Withdraw"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
