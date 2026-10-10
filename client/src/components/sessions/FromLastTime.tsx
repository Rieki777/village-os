/**
 * FROM LAST TIME: what the last closed session in this circle left behind.
 * Its actions, to check in on (done or not done, never the results); its
 * backlog; and the items it parked. Anything here can come onto today's agenda
 * with one tap, carrying where it came from, and once it is there it is no
 * longer offered.
 */
import { useState } from "react";
import {
  AIM_DEFS,
  ENTRY_LABELS,
  ROOM_COPY,
  ROOM_ITEM_MINUTES_DEFAULT,
  SESSION_COPY,
  SESSION_LIMITS,
  cleanLine,
  type ItemAim,
} from "@shared/sessions";
import { BTN_QUIET, BTN_SECONDARY, CARD, CHIP, H3, HINT, heldLine, type StageProps } from "./roomUi";

export default function FromLastTime({ view, actions }: Omit<StageProps, "now">) {
  const carried = view.carried;
  const [busy, setBusy] = useState<string | null>(null);
  if (!carried) return null;
  const { actions: carriedActions, backlog, parkedItems } = carried;
  if (!carriedActions.length && !backlog.length && !parkedItems.length) return null;
  const canAdd = view.me.joined && view.status === "open";
  // The action check is a title of the room's own, so the room asks its agenda whether it is there yet.
  const checkTitle = ROOM_COPY.actionCheckTitle.toLowerCase();
  const checkAdded = view.items.some((i) => i.fromSessionId === carried.sessionId && i.title.toLowerCase() === checkTitle);

  const bring = async (key: string, title: string, aim: ItemAim, minutes: number) => {
    const clean = cleanLine(title, SESSION_LIMITS.agendaTitle);
    if (!clean) return;
    setBusy(key);
    try {
      await actions.addItem({ title: clean, aim, minutes, fromSessionId: carried.sessionId });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={CARD} aria-labelledby="carried-title">
      <h3 id="carried-title" className={H3}>
        {SESSION_COPY.carriedTitle}
      </h3>
      <p className={HINT}>{carried.title}</p>

      {carriedActions.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-foreground">{SESSION_COPY.carriedActions}</h4>
            {canAdd && !checkAdded && (
              <button
                type="button"
                className={BTN_QUIET}
                disabled={busy != null}
                onClick={() => void bring("check", ROOM_COPY.actionCheckTitle, "report", 5)}
              >
                {ROOM_COPY.addActionCheck}
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-1.5">
            {carriedActions.map((a) => (
              <li key={a.id} className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="text-foreground">{a.text}</span>
                <span className="block text-muted-foreground">
                  {heldLine(a)}
                  {a.dueOn ? ` · ${ROOM_COPY.dueLabel} ${a.dueOn}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(backlog.length > 0 || parkedItems.length > 0) && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-foreground">{SESSION_COPY.carriedBacklog}</h4>
          <ul className="mt-2 space-y-1.5">
            {parkedItems.map((p, i) => (
              <li key={`p${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-foreground">{p.title}</span>{" "}
                  <span className={CHIP}>
                    {AIM_DEFS[p.aim].label} · {p.minutes} {ROOM_COPY.minutesShort}
                  </span>
                </span>
                {canAdd && (
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    disabled={busy != null}
                    onClick={() => void bring(`p${i}`, p.title, p.aim, p.minutes)}
                  >
                    {ROOM_COPY.addToAgenda}
                  </button>
                )}
              </li>
            ))}
            {backlog.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className={CHIP}>{ENTRY_LABELS[e.kind]}</span> <span className="text-foreground">{e.text}</span>
                </span>
                {canAdd && (
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    disabled={busy != null}
                    onClick={() => void bring(`e${e.id}`, e.text, "explore", ROOM_ITEM_MINUTES_DEFAULT)}
                  >
                    {ROOM_COPY.addToAgenda}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
