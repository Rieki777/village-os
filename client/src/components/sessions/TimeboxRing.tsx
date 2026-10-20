/**
 * An item's clock as a calm ring in a small medallion. It drains as the
 * minutes go; at four fifths the time turns to the notice tone, and past its
 * time the words turn to the over tone and say by how much. No sound and no
 * flashing: the room is talking.
 *
 * The arc is the profile's maturity arc (ProfileHero), a gradient from the
 * gold's shadow through the gold to its lit end, so it reads as coming from
 * somewhere rather than as a bar bent round. Every stop is a theme variable,
 * and the gradient's id is this ring's own (`useId`), so two rings on one
 * screen never paint with each other's gradient.
 *
 * The arc's drain is a transition on the dash offset, which the global
 * reduce-motion rule collapses to an instant, so a member who asked for
 * stillness sees the ring step once a second and never glide.
 */
import { useId } from "react";
import { ROOM_COPY, roomClock, type TimeboxPhase } from "@shared/sessions";

const TONE: Record<TimeboxPhase, string> = {
  idle: "text-muted-foreground",
  calm: "text-foreground",
  near: "text-notice",
  over: "text-destructive",
};

export default function TimeboxRing({
  phase,
  secondsLeft,
  totalSeconds,
  size = 112,
}: {
  phase: TimeboxPhase;
  secondsLeft: number;
  totalSeconds: number;
  size?: number;
}) {
  const id = useId();
  const gradient = `timebox-arc-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const r = 44;
  const c = 2 * Math.PI * r;
  const left = totalSeconds > 0 ? Math.min(1, Math.max(0, secondsLeft / totalSeconds)) : 0;
  const label = phase === "over" ? ROOM_COPY.timeOver(secondsLeft) : ROOM_COPY.timeLeft(secondsLeft);
  return (
    <div className="w-fit shrink-0 rounded-full bg-muted p-1.5 ring-1 ring-notice/60" data-timebox="">
      <div className="relative" style={{ width: size, height: size }} role="timer" aria-label={label}>
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--sheet-earned-deep, var(--color-notice))" />
              <stop offset="55%" stopColor="var(--sheet-notice, var(--color-notice))" />
              <stop offset="100%" stopColor="var(--sheet-earned-lit, var(--color-notice))" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="5" strokeLinecap="round" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - left)}
            transform="rotate(-90 50 50)"
            style={{ transition: "stroke-dashoffset 900ms linear" }}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className={`font-body text-xl font-semibold tabular-nums ${TONE[phase]}`}>{roomClock(secondsLeft)}</span>
          <span className="text-xs text-muted-foreground">{phase === "over" ? ROOM_COPY.overWord : ROOM_COPY.leftWord}</span>
        </span>
      </div>
    </div>
  );
}
