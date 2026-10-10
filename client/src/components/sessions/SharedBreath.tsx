/**
 * THE SHARED BREATH. Every screen in the room breathes at the same pace,
 * because every screen reads `breathAt` against the room's clock (the server's
 * time, carried as an offset), never against its own.
 *
 * A soft circle grows on the in breath, rests full on the hold, shrinks on the
 * out breath and rests small. The facilitator picks the pattern and the rounds
 * and starts it for everyone. With reduced motion asked for, the circle holds
 * still and the words carry the breath: the step, its seconds and the round.
 */
import { useState } from "react";
import {
  BREATH_KEYS,
  BREATH_PATTERNS,
  BREATH_ROUNDS,
  BREATH_WORDS,
  ROOM_COPY,
  breathAt,
  type BreathKey,
  type BreathMoment,
  type SessionState,
} from "@shared/sessions";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { BTN_PRIMARY, BTN_SECONDARY, H3, HINT, INPUT, LABEL } from "./roomUi";
import { useRoomNow, type RoomActions } from "./useSessionRoom";

/** How full the circle is at this moment of the breath, from 0.55 to 1. */
export function breathScale(m: BreathMoment): number {
  if (m.state !== "breathing") return 0.7;
  const p = Math.min(1, Math.max(0, m.progress));
  switch (m.kind) {
    case "in":
      return 0.55 + 0.45 * p;
    case "hold-in":
      return 1;
    case "out":
      return 1 - 0.45 * p;
    case "hold-out":
      return 0.55;
  }
}

/** When a started breath ends, in the room's time; null for one not started. */
export function breathEndsAt(b: SessionState["breath"]): number | null {
  if (b.startedAt == null) return null;
  const steps = BREATH_PATTERNS[b.pattern]?.steps ?? BREATH_PATTERNS.settle.steps;
  return b.startedAt + steps.reduce((sum, step) => sum + step.secs, 0) * b.rounds * 1000;
}

export interface SharedBreathProps {
  breath: SessionState["breath"];
  offset: number;
  facilitates: boolean;
  actions: RoomActions;
}

export default function SharedBreath({ breath, offset, facilitates, actions }: SharedBreathProps) {
  const reduced = useReducedMotion();
  // Five beats a second while the room breathes, so the circle moves softly;
  // once a second otherwise, which is all the words need.
  const ends = breathEndsAt(breath);
  const running = ends != null && Date.now() + offset < ends;
  const now = useRoomNow(offset, running ? 200 : 1000);
  const moment = breathAt(breath, now);
  const [pattern, setPattern] = useState<BreathKey>(breath.pattern);
  const [rounds, setRounds] = useState<number>(breath.rounds);
  const [busy, setBusy] = useState(false);

  const run = async (on: boolean) => {
    setBusy(true);
    try {
      await actions.act(on ? { type: "breath", pattern, rounds, run: true } : { type: "breath", run: false });
    } finally {
      setBusy(false);
    }
  };

  const scale = reduced ? 0.8 : breathScale(moment);
  const word =
    moment.state === "breathing" ? BREATH_WORDS[moment.kind] : moment.state === "done" ? ROOM_COPY.breathDone : ROOM_COPY.breathTitle;

  return (
    <section aria-labelledby="breath-title" className="space-y-4">
      <h3 id="breath-title" className={H3}>
        {ROOM_COPY.breathTitle}
      </h3>
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64" aria-hidden="true">
          <div className="absolute inset-0 rounded-full border border-teal-deep/20" />
          <div
            className="absolute inset-0 rounded-full bg-teal-deep/15 ring-1 ring-teal-deep/25"
            style={{
              transform: `scale(${scale})`,
              transition: reduced ? "none" : "transform 260ms linear",
            }}
          />
          <div
            className="absolute inset-0 rounded-full bg-teal-deep/10"
            style={{ transform: `scale(${Math.max(0.3, scale - 0.25)})`, transition: reduced ? "none" : "transform 260ms linear" }}
          />
          {moment.state === "breathing" && (
            <span className="relative font-display text-4xl font-bold tabular-nums text-foreground/70">{moment.secondsLeft}</span>
          )}
        </div>
        <p className="text-center font-display text-2xl font-semibold text-foreground" aria-live="polite">
          {word}
        </p>
        {moment.state === "breathing" && (
          <p className={HINT}>{ROOM_COPY.breathRound(moment.round, breath.rounds)}</p>
        )}
        {moment.state === "idle" && <p className={`${HINT} max-w-sm text-center`}>{ROOM_COPY.breathIdle}</p>}
      </div>

      {facilitates && (
        <div className="flex flex-wrap items-end justify-center gap-3">
          <label className="min-w-[9rem]">
            <span className={LABEL}>{ROOM_COPY.breathPattern}</span>
            <select className={INPUT} value={pattern} onChange={(e) => setPattern(e.target.value as BreathKey)} disabled={busy}>
              {BREATH_KEYS.map((k) => (
                <option key={k} value={k}>
                  {BREATH_PATTERNS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[6rem]">
            <span className={LABEL}>{ROOM_COPY.breathRounds}</span>
            <select className={INPUT} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} disabled={busy}>
              {BREATH_ROUNDS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {moment.state === "breathing" ? (
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void run(false)}>
              {ROOM_COPY.breathStop}
            </button>
          ) : (
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void run(true)}>
              {moment.state === "done" ? ROOM_COPY.breathAgain : ROOM_COPY.breathStart}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
