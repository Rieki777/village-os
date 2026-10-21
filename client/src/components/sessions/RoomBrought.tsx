/**
 * WHAT MEMBERS BROUGHT FOR THIS CIRCLE, in the agenda stage, right after From
 * last time: the agenda library's waiting items this room may take up. Each
 * one comes onto today's agenda with one tap, the way a parked item from last
 * time does, and once it is on the agenda it is offered no more.
 *
 * Each row is drawn the way From last time draws a parked item: the title, the
 * aim and its usual minutes, who brought it and when, and the note, held to
 * three lines with a tap to read it all. "Add to the agenda" shows only to
 * somebody who has joined while the room is open.
 *
 * EACH VIEWER READS THEIR OWN LIST (`actions.library`, GET
 * /api/sessions/:id/library). Joining a room asks nothing about its circle, so
 * a circle's waiting items reach only the people with standing in it, the
 * person who brought each, and admins. The list is read when the stage shows
 * and again whenever the room's version moves, and a row already on this
 * agenda (an item whose `libraryId` it is) is left out at once, so a screen
 * that has not read the list again yet still offers nothing twice.
 *
 * Words come from shared/sessionLibrary.ts, the contract.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AIM_DEFS, ROOM_COPY } from "@shared/sessions";
import { LIBRARY_COPY, LIBRARY_MINUTES, agendaAimFor, broughtFor, type LibraryCard } from "@shared/sessionLibrary";
import { BTN_QUIET, BTN_SECONDARY, CARD, CHIP, H3, HINT, type StageProps } from "./roomUi";

/** "14 October", in the reader's own locale. */
function shortDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

function BroughtRow({
  card,
  canAdd,
  busy,
  onAdd,
  noCircleTag,
}: {
  card: LibraryCard;
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
  noCircleTag: boolean;
}) {
  const [whole, setWhole] = useState(false);
  const aim = agendaAimFor(card.aim);
  const when = shortDay(card.broughtAt);
  return (
    <li className="rounded-xl border border-border bg-muted px-3.5 py-3 text-sm" data-library-id={card.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base text-foreground">{card.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className={CHIP}>
              {card.aim ? AIM_DEFS[aim].label : LIBRARY_COPY.aimNotSure} · {LIBRARY_MINUTES[aim]} {ROOM_COPY.minutesShort}
            </span>
            {noCircleTag && <span className={CHIP}>{LIBRARY_COPY.roomNoCircle}</span>}
            <span>{card.mine ? LIBRARY_COPY.broughtByYou(when) : LIBRARY_COPY.broughtBy(card.broughtBy, when)}</span>
          </p>
        </div>
        {canAdd && (
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onAdd}>
            {LIBRARY_COPY.addToAgenda}
          </button>
        )}
      </div>
      {card.note && (
        <div className="mt-2">
          <p className={`whitespace-pre-line break-words text-foreground ${whole ? "" : "line-clamp-3"}`}>{card.note}</p>
          {card.note.length > 160 && (
            <button type="button" className={BTN_QUIET} aria-expanded={whole} onClick={() => setWhole((w) => !w)}>
              {whole ? LIBRARY_COPY.showLess : LIBRARY_COPY.showAll}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function RoomBrought({ view, actions }: Omit<StageProps, "now">) {
  const [cards, setCards] = useState<LibraryCard[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const open = view.status === "open";
  // The doors, held so a parent that builds them on every render never makes the read run again.
  const doors = useRef(actions);
  doors.current = actions;

  // Read when the stage shows, and again whenever the room moved.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void doors.current.library().then((list) => {
      if (alive && list) setCards(list);
    });
    return () => {
      alive = false;
    };
  }, [open, view.id, view.version]);

  const onAgenda = useMemo(() => new Set(view.items.map((i) => i.libraryId).filter((id): id is number => typeof id === "number")), [view.items]);
  const shown = (cards ?? []).filter((c) => c.status === "waiting" && !onAgenda.has(c.id));
  if (!open || !shown.length) return null;

  const canAdd = view.me.joined;
  const add = async (id: number) => {
    setBusy(id);
    try {
      const r = await actions.bringFromLibrary([id]);
      // The room's version moved, so the effect reads the list again; until it does, this row leaves on the server's yes.
      if (r.ok) setCards((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      else if (r.status === 409) setCards(await actions.library());
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={CARD} aria-labelledby="brought-title">
      <h3 id="brought-title" className={H3}>
        {broughtFor(view.circleName)}
      </h3>
      {!canAdd && <p className={`${HINT} mt-1`}>{ROOM_COPY.joinFirst}</p>}
      <ul className="mt-3 space-y-2">
        {shown.map((c) => (
          <BroughtRow
            key={c.id}
            card={c}
            canAdd={canAdd}
            busy={busy != null}
            onAdd={() => void add(c.id)}
            noCircleTag={view.circleId != null && c.circleId == null}
          />
        ))}
      </ul>
    </section>
  );
}
