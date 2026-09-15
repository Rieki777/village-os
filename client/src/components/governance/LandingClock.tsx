/**
 * THE VILLAGE'S COUNTDOWN, on a decision that carried and has not taken effect.
 *
 * Rye, 2026-09-14: "a member can see a countdown timer until it passes", and on
 * the design, "It's also the villages countdown (they share it)". So this is one
 * clock for everybody, and the sentence under it says which of three things the
 * member is looking at: a steward can still stop it, nobody can, or every
 * steward already said yes. The sentence comes from the server
 * (`countdownSentence` in shared/governanceKinds.ts), read off the lock frozen at
 * the close, so this page cannot promise a door the veto route refuses.
 *
 * Built on the vote clock's arithmetic and its tick rule, for the reasons
 * VoteClock gives: seconds only when seconds could matter, and the accessible
 * name in words while the digits stay hidden from a screen reader.
 */
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { countdown, tickMsFor } from "./voteBars";

export function landingReading(
  landsAtIso: string,
  nowMs: number,
): { ended: boolean; remainingMs: number; text: string; reading: string } {
  const c = countdown(landsAtIso, nowMs);
  if (c.ended) {
    return { ended: true, remainingMs: 0, text: "Taking effect now", reading: "This decision is taking effect now" };
  }
  return {
    ended: false,
    remainingMs: c.remainingMs,
    text: `${c.text} until it takes effect`,
    reading: c.reading.replace(/ left to vote$/, " until it takes effect"),
  };
}

export default function LandingClock({ landsAt, sentence }: { landsAt: string; sentence: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const { remainingMs } = countdown(landsAt, Date.now());
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, tickMsFor(remainingMs));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [landsAt]);

  const r = landingReading(landsAt, now);
  const on = new Date(landsAt).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mt-3 rounded-lg border border-stone-900/10 bg-white/70 px-3 py-2">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-900">
        <Clock className="w-4 h-4" aria-hidden="true" />
        <span className="sr-only">{r.reading}</span>
        <span aria-hidden="true" className="tabular-nums">
          {r.text}
        </span>
      </p>
      <p className="mt-1 text-sm text-stone-700">
        {sentence} It takes effect {on}.
      </p>
    </div>
  );
}
