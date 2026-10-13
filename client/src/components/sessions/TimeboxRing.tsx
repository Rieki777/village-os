/**
 * An item's clock as a calm ring. It drains as the minutes go; at four fifths
 * it shifts to the notice tone, and past its time it turns to the over tone
 * and says by how much. No sound and no flashing: the room is talking.
 */
import { ROOM_COPY, roomClock, type TimeboxPhase } from "@shared/sessions";

const TONE: Record<TimeboxPhase, string> = {
  idle: "text-muted-foreground",
  calm: "text-teal-deep",
  near: "text-notice",
  over: "text-coral",
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
  const r = 44;
  const c = 2 * Math.PI * r;
  const left = totalSeconds > 0 ? Math.min(1, Math.max(0, secondsLeft / totalSeconds)) : 0;
  const label = phase === "over" ? ROOM_COPY.timeOver(secondsLeft) : ROOM_COPY.timeLeft(secondsLeft);
  return (
    <div className={`relative shrink-0 ${TONE[phase]}`} style={{ width: size, height: size }} role="timer" aria-label={label}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - left)}
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset 900ms linear" }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-xl font-bold tabular-nums text-foreground">{roomClock(secondsLeft)}</span>
        <span className="text-xs text-muted-foreground">{phase === "over" ? ROOM_COPY.overWord : ROOM_COPY.leftWord}</span>
      </span>
    </div>
  );
}
