/**
 * THE SHARED SIT. A meditation drop in: the facilitator picks a few minutes
 * and starts it, and every screen in the room keeps the same quiet, because
 * every screen reads `sitAt` against the room's clock (the server's time,
 * carried as an offset), exactly as the breath does.
 *
 * A singing bowl rings softly when the sit starts and fully when it ends. It
 * rings only for a sit that is happening now: a screen that opens the room a
 * minute after the end stays quiet, since the moment has passed. Browsers will
 * not make sound until a person taps, so each screen has its own bell switch,
 * and the facilitator's start counts as their tap.
 *
 * The seated figure carries the time without numbers to watch: a light climbs
 * the chakras and falls back while the room sits, and when the bowl rings the
 * light fills the body from the root to the crown and returns. With reduced
 * motion asked for, the lights hold still and the words carry it.
 */
import { useEffect, useRef, useState } from "react";
import { ROOM_COPY, SIT_MINUTES, SIT_SETTLE_SECS, sitAt, type SessionState, type SitMoment } from "@shared/sessions";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { radioArrows } from "@/lib/radioArrows";
import { ringBell, unlockBell } from "@/lib/bowlBell";
import { isMuted } from "@/lib/sound";
import ChakraFigure, { chakraLight } from "./ChakraFigure";
import { BTN_PRIMARY, BTN_SECONDARY, H3, HINT, LABEL, tile } from "./roomUi";
import { useRoomNow, type RoomActions } from "./useSessionRoom";

/** A late screen still hears the start this many seconds in, and the end this many after. */
const START_BELL_WINDOW = 15;
const END_BELL_WINDOW = 5;

/** Which bell, if any, the move from `before` to `now` should ring. */
export function bellFor(before: SitMoment["state"], now: SitMoment): "start" | "end" | null {
  if (now.state === "sitting" && before !== "sitting" && now.elapsed < START_BELL_WINDOW) return "start";
  if (now.state === "done" && before === "sitting" && now.sinceEnd < END_BELL_WINDOW) return "end";
  return null;
}

/** What a screen reader hears: the start and the end, once each. */
export function sitAnnouncement(m: SitMoment, minutes: number): string {
  if (m.state === "sitting") return ROOM_COPY.sitStartedSay(minutes);
  if (m.state === "done") return ROOM_COPY.sitEndedSay;
  return "";
}

export interface SharedSitProps {
  sit: SessionState["sit"];
  offset: number;
  facilitates: boolean;
  actions: RoomActions;
}

export default function SharedSit({ sit, offset, facilitates, actions }: SharedSitProps) {
  const reduced = useReducedMotion();
  const probe = sitAt(sit, Date.now() + offset);
  // Four beats a second while the lights move, once a second otherwise.
  const moving = probe.state === "sitting" || (probe.state === "done" && probe.sinceEnd < SIT_SETTLE_SECS + 1);
  const now = useRoomNow(offset, moving && !reduced ? 250 : 1000);
  const moment = sitAt(sit, now);
  const [minutes, setMinutes] = useState<number>(sit.minutes);
  const [busy, setBusy] = useState(false);
  const [bell, setBell] = useState(false);
  const before = useRef<SitMoment["state"]>("idle");

  useEffect(() => {
    const which = bellFor(before.current, moment);
    before.current = moment.state;
    if (which && bell) void ringBell({ soft: which === "start" });
  }, [moment, bell]);

  const turnBellOn = async () => {
    const ok = await unlockBell();
    setBell(ok);
    return ok;
  };

  const toggleBell = async () => {
    if (bell) return setBell(false);
    if (await turnBellOn()) void ringBell({ soft: true });
  };

  const run = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await turnBellOn();
      await actions.act(on ? { type: "sit", minutes, run: true } : { type: "sit", run: false });
    } finally {
      setBusy(false);
    }
  };

  const muted = isMuted();

  return (
    <section aria-labelledby="sit-title" className="space-y-4">
      <h3 id="sit-title" className={H3}>
        {ROOM_COPY.sitTitle}
      </h3>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {sitAnnouncement(moment, sit.minutes)}
      </p>
      <div className="flex flex-col items-center gap-3 py-2">
        <ChakraFigure light={chakraLight(moment, reduced)} motion={!reduced} />
        {moment.state === "sitting" && (
          <div className="text-center">
            <p className="font-display text-4xl tabular-nums text-foreground">{ROOM_COPY.sitLeft(moment.secondsLeft)}</p>
            <p className={HINT}>{ROOM_COPY.sitLeftHint}</p>
            <p className={`${HINT} mt-2 max-w-sm`}>{ROOM_COPY.sitSitting}</p>
          </div>
        )}
        {moment.state === "done" && <p className="text-center font-display text-2xl text-foreground">{ROOM_COPY.sitDone}</p>}
        {moment.state === "idle" && <p className={`${HINT} max-w-sm text-center`}>{ROOM_COPY.sitIdle}</p>}
        <button type="button" className={tile(bell)} aria-pressed={bell} onClick={() => void toggleBell()}>
          {bell ? ROOM_COPY.bellOn : ROOM_COPY.bellOff}
        </button>
        {!bell && !muted && <p className={`${HINT} max-w-sm text-center`}>{ROOM_COPY.bellHint}</p>}
        {muted && <p className={`${HINT} max-w-sm text-center`}>{ROOM_COPY.bellMuted}</p>}
      </div>

      {facilitates && (
        <div className="flex flex-wrap items-end justify-center gap-4">
          <div>
            <p id="sit-minutes" className={LABEL}>
              {ROOM_COPY.sitMinutes}
            </p>
            <div role="radiogroup" aria-labelledby="sit-minutes" className="mt-1 flex gap-2">
              {SIT_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={minutes === m}
                  aria-label={ROOM_COPY.sitMinutesWord(m)}
                  tabIndex={minutes === m ? 0 : -1}
                  className={`${tile(minutes === m)} min-w-11 tabular-nums`}
                  disabled={busy}
                  onClick={() => setMinutes(m)}
                  onKeyDown={radioArrows(SIT_MINUTES, minutes, setMinutes)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {moment.state === "sitting" ? (
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void run(false)}>
              {ROOM_COPY.sitStop}
            </button>
          ) : (
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void run(true)}>
              {moment.state === "done" ? ROOM_COPY.sitAgain : ROOM_COPY.sitStart}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
