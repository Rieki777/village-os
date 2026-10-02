/**
 * SENT: what this member has written to others, with where each one stands
 * and when it arrives. Anything not yet delivered can be withdrawn.
 */
import { useEffect, useState } from "react";
import type { FeedbackSent, FeedbackStatus } from "@shared/journal";
import { problemText, sentFeedback, withdrawFeedback } from "@/lib/journalApi";
import { BTN_SECONDARY, CARD, HINT, dayLabel, timeLabel } from "./ui";

const STATUS_TEXT: Record<FeedbackStatus, string> = {
  draft: "Not queued",
  queued: "Waiting for the Monday batch",
  withdrawn: "Withdrawn",
};

function statusLine(s: FeedbackSent): string {
  if (s.status === "queued" && s.delivered) return "Delivered";
  if (s.status === "queued" && s.deliverAfter) {
    return `${STATUS_TEXT.queued}, arrives ${dayLabel(s.deliverAfter)} at ${timeLabel(s.deliverAfter)}`;
  }
  return STATUS_TEXT[s.status] ?? s.status;
}

export default function FeedbackSentList({ refreshKey = 0 }: { refreshKey?: number }) {
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
        {(sent ?? []).map((s) => (
          <li key={s.id} className={CARD}>
            <p className="text-sm font-semibold text-foreground">To {s.recipientName}</p>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{s.message}</p>
            <p className="mt-2 text-xs text-muted-foreground">{statusLine(s)}</p>
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
        ))}
      </ul>
    </section>
  );
}
