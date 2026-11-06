/**
 * THE END OF MOON SECTIONS of a templated room (shared/sessionTemplates.ts
 * `MOON_SECTION_KINDS`): Our moons, Moon goals and Sending together.
 *
 * Each reads the moon-review module's room door through `moonRoomPanel`
 * (shared/moonRoom.ts), which keeps only words: no amount, no score, no
 * reading and no moon load ever reaches this file. While the door is not
 * there yet (the module off, or a server without the door) each section shows
 * one calm line and the room runs by voice.
 *
 * The talking stick's own controls are TemplatePanel's; this file draws what
 * the stick holder chose to show.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { MOON_ROOM_COPY, MY_MOON_HREF, TEMPLATES_ROOM_POLL_MS } from "@shared/sessionTemplates";
import { moonRoomApi, type MoonRoomPanel } from "@shared/moonRoom";
import type { RoomResponse } from "@shared/moonRecap";
import { gameFetch } from "@/lib/gameApi";
import { BTN_FORWARD, CHIP, HINT, LABEL_CAPS, SOFT } from "./roomUi";

/** The door's answer while `enabled`, asked every few seconds while the tab is visible. Null: not there, or not yet. */
export function useMoonRoom(sessionId: number, enabled: boolean): RoomResponse | null {
  const [data, setData] = useState<RoomResponse | null>(null);
  const alive = useRef(true);
  const read = useCallback(async () => {
    try {
      const res = await gameFetch(moonRoomApi(sessionId));
      if (!alive.current) return;
      setData(res.ok ? ((await res.json()) as RoomResponse) : null);
    } catch {
      // Offline for a moment: keep what was shown.
    }
  }, [sessionId]);
  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      setData(null);
      return;
    }
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, TEMPLATES_ROOM_POLL_MS);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [read, enabled]);
  return data;
}

const NotReady = () => <p className={HINT}>{MOON_ROOM_COPY.notReady}</p>;

/** Show my moon or Speak only, for the stick holder (or a host on their word). */
export function MoonShareChoice({ shown, busy, onChoose }: { shown: boolean; busy: boolean; onChoose(show: boolean): void }) {
  const pill = (on: boolean) =>
    on
      ? "min-h-9 rounded-full border border-notice bg-notice px-3 text-sm font-semibold text-background"
      : "min-h-9 rounded-full border border-border px-3 text-sm text-foreground hover:border-notice disabled:opacity-60";
  return (
    <span className="flex flex-wrap items-center gap-1" role="group" aria-label={MOON_ROOM_COPY.chooseAsk}>
      <button type="button" aria-pressed={shown} disabled={busy} className={pill(shown)} onClick={() => onChoose(true)}>
        {MOON_ROOM_COPY.showMine}
      </button>
      <button type="button" aria-pressed={!shown} disabled={busy} className={pill(!shown)} onClick={() => onChoose(false)}>
        {MOON_ROOM_COPY.speakOnly}
      </button>
    </span>
  );
}

/** Our moons: the holder's recap when shown, then who is ready to share. */
export function MoonRecapBody({ panel, holderName }: { panel: MoonRoomPanel | null; holderName: string | null }) {
  if (!panel) return <NotReady />;
  return (
    <div className="space-y-3" data-testid="moon-recap">
      {holderName &&
        (!panel.shown ? (
          <p className={HINT}>{MOON_ROOM_COPY.speaking(holderName)}</p>
        ) : panel.recap ? (
          <div className="space-y-3">
            {panel.recap.roles.map((role, i) => (
              <div key={`${role.name}-${i}`} className={`${SOFT} space-y-1.5`}>
                <p className="font-semibold text-foreground">{role.name}</p>
                <ul className="space-y-1">
                  {role.items.map((item, j) => (
                    <li key={j} className="text-sm text-foreground">
                      {item.text}{" "}
                      {item.proofUrl && (
                        <a href={item.proofUrl} target="_blank" rel="noreferrer noopener" className="text-notice underline underline-offset-2">
                          {MOON_ROOM_COPY.proof}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {panel.recap.seasonGoals.length > 0 && (
              <div className="space-y-1">
                <p className={LABEL_CAPS}>{MOON_ROOM_COPY.seasonGoals}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {panel.recap.seasonGoals.map((g) => (
                    <li key={g} className={CHIP}>
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className={HINT}>{MOON_ROOM_COPY.noRecap(holderName)}</p>
        ))}
      <div className="space-y-1">
        <p className={LABEL_CAPS}>{MOON_ROOM_COPY.readyHeading}</p>
        {panel.ready.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {panel.ready.map((name, i) => (
              <li key={`${name}-${i}`} className="rounded-full border border-notice/70 px-3 py-1 text-sm text-foreground">
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className={HINT}>{MOON_ROOM_COPY.readyEmpty}</p>
        )}
      </div>
    </div>
  );
}

/** Moon goals: the holder's goals for the moon just ended with how each landed, then the next moon's. Words only. */
export function MoonGoalsBody({ panel }: { panel: MoonRoomPanel | null }) {
  if (!panel) return <NotReady />;
  if (!panel.shown) return <p className={HINT}>{MOON_ROOM_COPY.goalsWaiting}</p>;
  const g = panel.goals;
  if (!g || (!g.last.length && !g.next.length)) return <p className={HINT}>{MOON_ROOM_COPY.goalsEmpty}</p>;
  return (
    <div className="space-y-3" data-testid="moon-goals">
      {g.last.length > 0 && (
        <div className="space-y-1">
          <p className={LABEL_CAPS}>{MOON_ROOM_COPY.goalsLast}</p>
          <ul className="space-y-1.5">
            {g.last.map((goal, i) => (
              <li key={i} className={`${SOFT} flex flex-wrap items-center justify-between gap-2`}>
                <span className="min-w-0 flex-1 text-foreground">{goal.text}</span>
                <span className={CHIP}>{goal.mark}</span>
                {goal.flagged && <span className="w-full text-xs text-muted-foreground">{MOON_ROOM_COPY.goalFlagged}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {g.next.length > 0 && (
        <div className="space-y-1">
          <p className={LABEL_CAPS}>{MOON_ROOM_COPY.goalsNext}</p>
          <ul className="space-y-1.5">
            {g.next.map((goal, i) => (
              <li key={i} className={SOFT}>
                <span className="text-foreground">{goal.text}</span>
                {goal.doneWhen && <span className="block text-xs text-muted-foreground">{MOON_ROOM_COPY.doneWhen(goal.doneWhen)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Sending together: this viewer's own row and how many people have sent. No amount to anyone. */
export function MoonInvoicesBody({ panel }: { panel: MoonRoomPanel | null }) {
  if (!panel) return <NotReady />;
  return (
    <div className="space-y-2" data-testid="moon-invoices">
      {panel.mine ? (
        <div className={`${SOFT} flex flex-wrap items-center justify-between gap-2`}>
          <span className="text-foreground">
            <span className={LABEL_CAPS}>{MOON_ROOM_COPY.mineHeading}</span> <span>{panel.mine.statusWords}</span>
          </span>
          {panel.mine.send && (
            <Link href={MY_MOON_HREF} className={BTN_FORWARD}>
              {MOON_ROOM_COPY.sendMine}
            </Link>
          )}
        </div>
      ) : (
        <p className={HINT}>{MOON_ROOM_COPY.mineNone}</p>
      )}
      <p className="text-sm text-foreground" aria-live="polite">
        {MOON_ROOM_COPY.sentCount(panel.sentCount)}
      </p>
      {panel.sendBy && <p className={HINT}>{panel.sendBy}</p>}
    </div>
  );
}

