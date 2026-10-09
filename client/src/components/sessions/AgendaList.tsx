/**
 * THE AGENDA: anyone in the room adds an item with an aim and some minutes.
 * Whoever added an item can change its words while it waits, and the
 * facilitator or the note taker can change any item's words. The facilitator
 * orders it and takes an item off it (there is no delete door, so "off the
 * agenda" parks it, and it can be brought back), because an item's place and
 * status are the facilitator's to set (server/lib/liveSessions.ts, `rolesIn`).
 *
 * Editing an item opens its form on the words the room holds right then, and
 * saving sends only the fields this person changed, so a change somebody else
 * made while the form was open survives unless both touched the same field.
 *
 * Moving an item sends the neighbour's position, then checks the answer: if
 * the server swapped the two, that was the whole move; if it only set the one
 * number, the neighbour gets the old one. Either reading of `position` ends in
 * the same order.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  AIM_DEFS,
  ITEM_AIMS,
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  cleanLine,
  type ItemAim,
  type SessionItem,
} from "@shared/sessions";
import { BTN_ICON, BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CHIP, HINT, INPUT, LABEL, agendaOrder, keepsNotes, leads, nameOf, type StageProps } from "./roomUi";
import type { ItemPatch } from "./useSessionRoom";

const clampMinutes = (n: number) =>
  Math.min(SESSION_LIMITS.minutesMax, Math.max(SESSION_LIMITS.minutesMin, Math.round(Number.isFinite(n) ? n : SESSION_LIMITS.minutesMin)));

/** The fields an item is made of, for adding and for editing. */
function ItemFields({
  idBase,
  title,
  aim,
  minutes,
  onTitle,
  onAim,
  onMinutes,
}: {
  idBase: string;
  title: string;
  aim: ItemAim;
  minutes: number;
  onTitle: (v: string) => void;
  onAim: (v: ItemAim) => void;
  onMinutes: (v: number) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_10rem_6rem]">
      <label htmlFor={`${idBase}-title`} className="block">
        <span className={LABEL}>{ROOM_COPY.itemTitleLabel}</span>
        <input
          id={`${idBase}-title`}
          className={`${INPUT} mt-1`}
          value={title}
          maxLength={SESSION_LIMITS.agendaTitle}
          placeholder={ROOM_COPY.itemTitlePlaceholder}
          onChange={(e) => onTitle(e.target.value)}
        />
      </label>
      <label htmlFor={`${idBase}-aim`} className="block">
        <span className={LABEL}>{SESSION_COPY.agendaAimLabel}</span>
        <select id={`${idBase}-aim`} className={`${INPUT} mt-1`} value={aim} onChange={(e) => onAim(e.target.value as ItemAim)}>
          {ITEM_AIMS.map((a) => (
            <option key={a} value={a}>
              {AIM_DEFS[a].label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${idBase}-min`} className="block">
        <span className={LABEL}>{SESSION_COPY.agendaMinutesLabel}</span>
        <input
          id={`${idBase}-min`}
          type="number"
          inputMode="numeric"
          className={`${INPUT} mt-1`}
          min={SESSION_LIMITS.minutesMin}
          max={SESSION_LIMITS.minutesMax}
          value={minutes}
          onChange={(e) => onMinutes(Number(e.target.value))}
        />
      </label>
      <p className={`${HINT} sm:col-span-3`}>{AIM_DEFS[aim].hint}</p>
    </div>
  );
}

export function AddItem({ view, actions }: Omit<StageProps, "now">) {
  const [title, setTitle] = useState("");
  const [aim, setAim] = useState<ItemAim>("explore");
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  if (!view.me.joined || view.status !== "open") return null;

  const add = async () => {
    const clean = cleanLine(title, SESSION_LIMITS.agendaTitle);
    if (!clean || busy) return;
    setBusy(true);
    try {
      const r = await actions.addItem({ title: clean, aim, minutes: clampMinutes(minutes) });
      if (r.ok) {
        setTitle("");
        setMinutes(10);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <h4 className="text-sm font-semibold text-foreground">{SESSION_COPY.agendaAdd}</h4>
      <ItemFields idBase="agenda-new" title={title} aim={aim} minutes={minutes} onTitle={setTitle} onAim={setAim} onMinutes={setMinutes} />
      <button type="submit" className={BTN_PRIMARY} disabled={busy || !title.trim()}>
        {ROOM_COPY.addItemButton}
      </button>
    </form>
  );
}

function ItemRow({
  view,
  actions,
  item,
  index,
  count,
  onMove,
  busy,
}: Omit<StageProps, "now"> & {
  item: SessionItem;
  index: number;
  count: number;
  onMove: (item: SessionItem, dir: -1 | 1) => void;
  busy: boolean;
}) {
  /** What the item held when Edit opened: the form starts here, and save sends what differs from it. */
  const [opened, setOpened] = useState<Pick<SessionItem, "title" | "aim" | "minutes"> | null>(null);
  const editing = opened != null;
  const [title, setTitle] = useState(item.title);
  const [aim, setAim] = useState<ItemAim>(item.aim);
  const [minutes, setMinutes] = useState(item.minutes);
  const [saving, setSaving] = useState(false);
  const mayEdit = keepsNotes(view) || (view.status === "open" && view.me.joined && item.addedBy === view.me.userId && item.status === "waiting");
  const mayRun = leads(view);
  const parked = item.status === "parked";

  const startEdit = () => {
    setTitle(item.title);
    setAim(item.aim);
    setMinutes(item.minutes);
    setOpened({ title: item.title, aim: item.aim, minutes: item.minutes });
  };

  const save = async () => {
    const clean = cleanLine(title, SESSION_LIMITS.agendaTitle);
    if (!clean || !opened) return;
    const patch: ItemPatch = {};
    if (clean !== opened.title) patch.title = clean;
    if (aim !== opened.aim) patch.aim = aim;
    const mins = clampMinutes(minutes);
    if (mins !== opened.minutes) patch.minutes = mins;
    if (!Object.keys(patch).length) {
      setOpened(null);
      return;
    }
    setSaving(true);
    try {
      const r = await actions.patchItem(item.id, patch);
      if (r.ok) setOpened(null);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: "parked" | "waiting") => {
    setSaving(true);
    try {
      await actions.patchItem(item.id, { status });
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <li className="rounded-xl border border-teal-deep/40 bg-card px-4 py-3">
        <ItemFields
          idBase={`agenda-${item.id}`}
          title={title}
          aim={aim}
          minutes={minutes}
          onTitle={setTitle}
          onAim={setAim}
          onMinutes={setMinutes}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={saving || !title.trim()} onClick={() => void save()}>
            {ROOM_COPY.save}
          </button>
          <button type="button" className={BTN_QUIET} onClick={() => setOpened(null)}>
            {ROOM_COPY.cancel}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${parked ? "border-dashed border-border" : "border-border bg-card"}`}>
      {!parked && (
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold tabular-nums text-muted-foreground">
          {index + 1}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${parked ? "text-muted-foreground" : "text-foreground"}`}>{item.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className={CHIP}>{AIM_DEFS[item.aim].label}</span>
          <span>
            {item.minutes} {ROOM_COPY.minutesShort}
          </span>
          {item.status !== "waiting" && <span>· {ROOM_COPY.itemStatus[item.status]}</span>}
          {nameOf(view, item.addedBy) && <span>· {nameOf(view, item.addedBy)}</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {mayRun && !parked && (
          <>
            <button type="button" className={BTN_ICON} aria-label={ROOM_COPY.moveUp} disabled={busy || index === 0} onClick={() => onMove(item, -1)}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={BTN_ICON}
              aria-label={ROOM_COPY.moveDown}
              disabled={busy || index === count - 1}
              onClick={() => onMove(item, 1)}
            >
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
        {mayEdit && !parked && item.status !== "done" && (
          <button type="button" className={BTN_QUIET} onClick={startEdit}>
            {ROOM_COPY.edit}
          </button>
        )}
        {mayRun && item.status === "waiting" && (
          <button type="button" className={BTN_QUIET} disabled={saving} onClick={() => void setStatus("parked")}>
            {ROOM_COPY.takeOff}
          </button>
        )}
        {mayRun && parked && (
          <button type="button" className={BTN_SECONDARY} disabled={saving} onClick={() => void setStatus("waiting")}>
            {ROOM_COPY.bringBack}
          </button>
        )}
      </div>
    </li>
  );
}

export default function AgendaList({ view, actions }: Omit<StageProps, "now">) {
  const [moving, setMoving] = useState(false);
  const ordered = agendaOrder(view.items);
  const onAgenda = ordered.filter((i) => i.status !== "parked");
  const off = ordered.filter((i) => i.status === "parked");

  const move = async (item: SessionItem, dir: -1 | 1) => {
    const at = onAgenda.findIndex((i) => i.id === item.id);
    const neighbour = onAgenda[at + dir];
    if (!neighbour || moving) return;
    setMoving(true);
    try {
      const mine = item.position;
      const theirs = neighbour.position;
      const r = await actions.patchItem(item.id, { position: theirs });
      if (!r.ok || !r.room) return;
      // A server that moves by index has already swapped the two. One that
      // only set the number left the neighbour sharing it: give it the old one.
      const after = r.room.items.find((i) => i.id === neighbour.id);
      if (after && after.position === theirs && mine !== theirs) {
        await actions.patchItem(neighbour.id, { position: mine });
      }
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="space-y-3">
      {onAgenda.length ? (
        <ol className="space-y-2">
          {onAgenda.map((item, i) => (
            <ItemRow
              key={item.id}
              view={view}
              actions={actions}
              item={item}
              index={i}
              count={onAgenda.length}
              onMove={(it, d) => void move(it, d)}
              busy={moving}
            />
          ))}
        </ol>
      ) : (
        <p className={HINT}>{ROOM_COPY.agendaEmpty}</p>
      )}
      {off.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-muted-foreground">{ROOM_COPY.offAgenda}</h4>
          <ul className="space-y-2">
            {off.map((item, i) => (
              <ItemRow key={item.id} view={view} actions={actions} item={item} index={i} count={off.length} onMove={() => {}} busy={moving} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
