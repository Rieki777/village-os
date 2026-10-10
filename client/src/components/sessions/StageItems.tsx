/**
 * THE WORK. The agenda down the side, each item with its status; the item the
 * room is on, open in full. Anyone can open another item's page on their own
 * screen; only the facilitator starts one, which moves the room to it.
 */
import { useState } from "react";
import { Play } from "lucide-react";
import { AIM_DEFS, ROOM_COPY, SESSION_COPY, STAGE_DEFS } from "@shared/sessions";
import ItemPage from "./ItemPage";
import { BTN_QUIET, CARD, HINT, agendaOrder, type StageProps } from "./roomUi";

export default function StageItems({ view, now, actions }: StageProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const items = agendaOrder(view.items).filter((i) => i.status !== "parked");
  const activeId = view.state.activeItemId;
  const shownId = picked ?? activeId;
  const shown = view.items.find((i) => i.id === shownId) ?? null;
  const activeTitle = view.items.find((i) => i.id === activeId)?.title ?? null;

  const start = async (itemId: number) => {
    setBusy(true);
    try {
      const r = await actions.act({ type: "item", itemId });
      if (r.ok) setPicked(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <nav aria-label={STAGE_DEFS.agenda.short} className={`${CARD} h-fit p-3`}>
        {items.length ? (
          <ol className="space-y-1">
            {items.map((item, i) => {
              const on = item.id === activeId;
              const open = item.id === shownId;
              return (
                <li key={item.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-current={open ? "page" : undefined}
                    onClick={() => setPicked(item.id === activeId ? null : item.id)}
                    className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${
                      open ? "bg-teal-deep/10 text-foreground" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                        on ? "bg-teal-deep text-white" : item.status === "done" ? "bg-open/15 text-open" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-medium ${item.status === "done" ? "text-muted-foreground line-through decoration-1" : ""}`}>
                        {item.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {AIM_DEFS[item.aim].label} · {item.minutes} {ROOM_COPY.minutesShort} · {ROOM_COPY.itemStatus[item.status]}
                      </span>
                    </span>
                  </button>
                  {view.me.facilitates && view.status === "open" && !on && item.status !== "done" && (
                    <button
                      type="button"
                      className={`${BTN_QUIET} no-underline`}
                      disabled={busy}
                      onClick={() => void start(item.id)}
                      aria-label={`${ROOM_COPY.startItem}: ${item.title}`}
                      title={ROOM_COPY.startItem}
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={`${HINT} p-2`}>{ROOM_COPY.agendaEmpty}</p>
        )}
      </nav>

      <div className="min-w-0 space-y-3">
        {shown && shown.id !== activeId && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 px-4 py-2 text-sm">
            <span className="text-muted-foreground">
              {activeTitle ? ROOM_COPY.browsing(shown.title, activeTitle) : SESSION_COPY.itemNone}
            </span>
            <div className="flex gap-2">
              {view.me.facilitates && view.status === "open" && shown.status !== "done" && (
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void start(shown.id)}>
                  {ROOM_COPY.startItem}
                </button>
              )}
              {activeId && (
                <button type="button" className={BTN_QUIET} onClick={() => setPicked(null)}>
                  {ROOM_COPY.backToRoom}
                </button>
              )}
            </div>
          </div>
        )}
        {shown ? (
          <ItemPage key={shown.id} view={view} now={now} actions={actions} item={shown} />
        ) : (
          <div className={`${CARD} py-12 text-center`}>
            <p className="text-muted-foreground">{SESSION_COPY.itemNone}</p>
          </div>
        )}
      </div>
    </div>
  );
}
