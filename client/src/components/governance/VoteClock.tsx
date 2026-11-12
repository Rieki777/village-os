/**
 * The live countdown on a decision in flight.
 *
 * Hypha ticks a one-second interval and force-updates the whole widget
 * (harvest section 2). This one asks voteBars.tickMsFor how often a second
 * could possibly matter and schedules only that: per second inside the last
 * hour, per minute inside the last day, every five minutes beyond. A ballot
 * nine days out does not need 777,600 re-renders to be honest, and a member
 * who asked for less motion should not get a digit twitching at them for a
 * week.
 *
 * The accessible name carries the span in WORDS ("2 days 3 hours left to
 * vote"), and the visible clock is aria-hidden: a screen reader announcing a
 * changing colon-separated string every second is unusable, and it was never
 * the information anyway.
 */
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { countdown, tickMsFor } from "./voteBars";

export default function VoteClock({
  closesAt,
  className = "",
  calm = false,
}: {
  closesAt: string;
  className?: string;
  /**
   * Decider calm (Phase D): a date and no countdown. The pages where people
   * decide say when a vote closes and never tick toward it; nothing here hurries
   * a decision. The band on the home page keeps its clock.
   */
  calm?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (calm) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const { remainingMs } = countdown(closesAt, Date.now());
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, tickMsFor(remainingMs));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [closesAt, calm]);

  const c = countdown(closesAt, now);
  const closedOn = new Date(closesAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  if (c.ended) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground ${className}`}>
        <Clock className="w-4 h-4" aria-hidden="true" />
        <span>Voting ended {closedOn}</span>
      </span>
    );
  }

  if (calm) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground ${className}`} data-vote-clock="calm">
        <Clock className="w-4 h-4" aria-hidden="true" />
        <span>Open until {closedOn}</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground ${className}`}>
      <Clock className="w-4 h-4" aria-hidden="true" />
      <span className="sr-only">{c.reading}</span>
      <span aria-hidden="true" className="tabular-nums font-medium">
        {c.text} left
      </span>
    </span>
  );
}
