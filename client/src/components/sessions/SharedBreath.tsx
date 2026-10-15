/**
 * THE SHARED BREATH. Every screen in the room breathes at the same pace,
 * because every screen reads `breathAt` against the room's clock (the server's
 * time, carried as an offset), never against its own.
 *
 * It is drawn as a calm orb in the room's gold: a thin gold ring that holds
 * still on a faint gold wash, a soft glow inside it, and a solid seed at the
 * centre. The seed grows on the in breath, rests full on the hold, shrinks on
 * the out breath and rests small, and the glow swells a little with it. Every
 * colour comes from the theme's tokens (`notice` is the earned gold on the
 * room's night), so a village's brand reaches it.
 *
 * With reduced motion asked for, nothing scales: the orb holds still and the
 * words carry the breath, the step, its seconds and the round.
 *
 * A screen reader hears the breath begin and end, once each. The step words
 * change every few seconds, and reading each one aloud would talk over the
 * quiet the breath is for, so they are on the screen and not announced.
 *
 * The facilitator picks the pattern and the rounds from small tiles that show
 * their counts, and starts it for everyone.
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
import { radioArrows } from "@/lib/radioArrows";
import { BTN_PRIMARY, BTN_SECONDARY, H3, HINT, LABEL, tile } from "./roomUi";
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

/**
 * What a screen reader is told about the breath: that it started, then that
 * it ended. The sentence changes only at those two moments, so the polite
 * live region holding it speaks twice a breath and is quiet in between.
 */
export function breathAnnouncement(m: BreathMoment, rounds: number): string {
  if (m.state === "breathing") return ROOM_COPY.breathStartedSay(rounds);
  if (m.state === "done") return ROOM_COPY.breathDone;
  return "";
}

export interface SharedBreathProps {
  breath: SessionState["breath"];
  offset: number;
  facilitates: boolean;
  actions: RoomActions;
}

export default function SharedBreath({ breath, offset, facilitates, actions }: SharedBreathProps) {
  const reduced = useReducedMotion();
  // Five beats a second while the room breathes, so the seed moves softly;
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
  // The glow follows the seed at a quarter of its swing, so it breathes
  // without ever filling the ring.
  const glow = reduced ? 1 : 0.8 + 0.25 * scale;
  const motion = reduced ? "none" : "transform 260ms linear";
  const word = moment.state === "breathing" ? BREATH_WORDS[moment.kind] : moment.state === "done" ? ROOM_COPY.breathDone : null;

  return (
    <section aria-labelledby="breath-title" className="space-y-4">
      <h3 id="breath-title" className={H3}>
        {ROOM_COPY.breathTitle}
      </h3>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {breathAnnouncement(moment, breath.rounds)}
      </p>
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64" aria-hidden="true">
          <div className="absolute inset-0 rounded-full bg-notice/10 ring-1 ring-notice/60" />
          <div
            className="absolute inset-3 rounded-full bg-radial from-notice/30 via-notice/10 via-45% to-transparent to-70%"
            style={{ transform: `scale(${glow})`, transition: motion }}
          />
          <div
            className="h-2/5 w-2/5 rounded-full bg-notice shadow-sm"
            style={{ transform: `scale(${scale})`, transition: motion }}
          />
        </div>
        {word && <p className="text-center font-display text-3xl text-foreground">{word}</p>}
        {moment.state === "breathing" && (
          <p className={`${HINT} tabular-nums`}>
            {ROOM_COPY.breathStepLine(moment.secondsLeft, moment.round, breath.rounds)}
          </p>
        )}
        {moment.state === "idle" && <p className={`${HINT} max-w-sm text-center`}>{ROOM_COPY.breathIdle}</p>}
      </div>

      {facilitates && (
        <div className="flex flex-wrap items-end justify-center gap-4">
          <div>
            <p id="breath-pattern" className={LABEL}>
              {ROOM_COPY.breathPattern}
            </p>
            <div role="radiogroup" aria-labelledby="breath-pattern" className="mt-1 flex flex-wrap gap-2">
              {BREATH_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={pattern === k}
                  tabIndex={pattern === k ? 0 : -1}
                  className={tile(pattern === k)}
                  disabled={busy}
                  onClick={() => setPattern(k)}
                  onKeyDown={radioArrows(BREATH_KEYS, pattern, setPattern)}
                >
                  {BREATH_PATTERNS[k].label}{" "}
                  {/* No opacity here: on the chosen tile this is the dark
                      ground on the gold, and any fade lowers a pair that was
                      measured whole. The lighter weight sets it apart. */}
                  <span className="ml-1 font-normal tabular-nums">
                    {ROOM_COPY.breathCounts(BREATH_PATTERNS[k].steps.map((s) => s.secs))}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p id="breath-rounds" className={LABEL}>
              {ROOM_COPY.breathRounds}
            </p>
            <div role="radiogroup" aria-labelledby="breath-rounds" className="mt-1 flex gap-2">
              {BREATH_ROUNDS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={rounds === r}
                  tabIndex={rounds === r ? 0 : -1}
                  className={`${tile(rounds === r)} min-w-11 tabular-nums`}
                  disabled={busy}
                  onClick={() => setRounds(r)}
                  onKeyDown={radioArrows(BREATH_ROUNDS, rounds, setRounds)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
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
