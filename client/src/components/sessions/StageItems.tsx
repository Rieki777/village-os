/**
 * THE WORK. The agenda, each item with its status, and the item the room is
 * on, open in full. Anyone can open another item's page on their own screen;
 * only the facilitator starts one, which moves the room to it.
 *
 * TWO LAYOUTS. While no item is open, the agenda runs down the side with a
 * start button for the facilitator beside each item. Once an item is live or
 * somebody opens one, the agenda folds into a strip of chips across the top
 * and the item's page takes the whole width, because that page is where the
 * room writes, and its boxes need the room to be read whole.
 */
import { useState } from "react";
import { Play } from "lucide-react";
import { AIM_DEFS, ROOM_COPY, SESSION_COPY, STAGE_DEFS, type SessionItem } from "@shared/sessions";
import ItemPage from "./ItemPage";
import { BTN_QUIET, CARD, HINT, PANEL, agendaOrder, type StageProps } from "./roomUi";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The small number before an item: gold while the room is on it, green once done. */
function ItemNumber({ n, on, done }: { n: number; on: boolean; done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
        on ? "bg-notice text-background" : done ? "bg-open/15 text-open" : "bg-background text-muted-foreground"
      }`}
    >
      {n}
    </span>
  );
}

export default function StageItems({ view, now, actions }: StageProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const items = agendaOrder(view.items).filter((i) => i.status !== "parked");
  const activeId = view.state.activeItemId;
  const shownId = picked ?? activeId;
  const shown = view.items.find((i) => i.id === shownId) ?? null;
  const activeTitle = view.items.find((i) => i.id === activeId)?.title ?? null;
  const runs = view.me.facilitates && view.status === "open";

  const start = async (itemId: number) => {
    setBusy(true);
    try {
      const r = await actions.act({ type: "item", itemId });
      if (r.ok) setPicked(null);
    } finally {
      setBusy(false);
    }
  };

  // The room's own item, or the one already open, takes this screen back to where the room is.
  const pick = (item: SessionItem) => setPicked(item.id === activeId || item.id === picked ? null : item.id);
  const done = (item: SessionItem) => item.status === "done";
  const titleClass = (item: SessionItem) => (done(item) ? "text-muted-foreground line-through decoration-1" : "");

  if (!shown) {
    return (
      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <nav aria-label={STAGE_DEFS.agenda.short} className={`${CARD} h-fit p-3`}>
          {items.length ? (
            <ol className="space-y-1">
              {items.map((item, i) => (
                <li key={item.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => pick(item)}
                    className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted ${FOCUS}`}
                  >
                    <ItemNumber n={i + 1} on={item.id === activeId} done={done(item)} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-medium ${titleClass(item)}`}>{item.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {AIM_DEFS[item.aim].label} · {item.minutes} {ROOM_COPY.minutesShort} · {ROOM_COPY.itemStatus[item.status]}
                      </span>
                    </span>
                  </button>
                  {runs && item.id !== activeId && !done(item) && (
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
              ))}
            </ol>
          ) : (
            <p className={`${HINT} p-2`}>{ROOM_COPY.agendaEmpty}</p>
          )}
        </nav>
        <div className={`${CARD} py-12 text-center`}>
          <p className="text-muted-foreground">{SESSION_COPY.itemNone}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <nav aria-label={STAGE_DEFS.agenda.short}>
        <ol className="flex flex-wrap gap-2">
          {items.map((item, i) => {
            const open = item.id === shownId;
            return (
              <li key={item.id} className="min-w-0 max-w-full">
                <button
                  type="button"
                  aria-current={open ? "page" : undefined}
                  onClick={() => pick(item)}
                  title={`${AIM_DEFS[item.aim].label} · ${item.minutes} ${ROOM_COPY.minutesShort} · ${ROOM_COPY.itemStatus[item.status]}`}
                  className={`flex min-h-11 max-w-full items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-4 text-left text-sm text-foreground ${FOCUS} ${
                    open ? "border-notice bg-muted" : "border-border bg-card hover:border-notice"
                  }`}
                >
                  <ItemNumber n={i + 1} on={item.id === activeId} done={done(item)} />
                  <span className={`min-w-0 truncate font-medium ${titleClass(item)}`}>{item.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {shown.id !== activeId && (
        <div className={`${PANEL} flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm`}>
          <span className="text-muted-foreground">{activeTitle ? ROOM_COPY.browsing(shown.title, activeTitle) : SESSION_COPY.itemNone}</span>
          <div className="flex gap-2">
            {runs && shown.status !== "done" && (
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
      <ItemPage key={shown.id} view={view} now={now} actions={actions} item={shown} />
    </div>
  );
}
