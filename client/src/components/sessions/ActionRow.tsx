/**
 * ONE ACTION, and who holds it. Every action leaves the session with a person
 * or a seat on it, claimed here and now, or parked to the backlog.
 *
 *   anyone in the room          "I'll take it" on an action no person holds
 *   the person holding it, or   "Let it go"
 *   the facilitator
 *   whoever wrote it, the       name a seat, set a due date, park it, bring
 *   facilitator, the note taker it back, take it out
 *   the person holding it       set its due date
 *
 * The server decides every one of these (`entryRights`); the buttons only
 * appear where it would say yes (roomUi's `entryRightsFor`).
 *
 * A due date is typed a part at a time, so it is held on this screen and sent
 * when the field is left or Enter is pressed, never on each keystroke. The
 * seat and the date stay usable while a save is out, so the cursor stays
 * where the person put it; a seat chosen while one is still saving is
 * ignored, and the picker shows what is on its way until the room answers.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  cleanDueOn,
  cleanLine,
  type SessionEntry,
} from "@shared/sessions";
import { BTN_ICON, BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CHIP, INPUT, LABEL, entryRightsFor, heldLine, isHeld, seatOrder, useDraft, type StageProps } from "./roomUi";

export function ActionRow({
  view,
  actions,
  entry,
  highlight = false,
}: Omit<StageProps, "now"> & { entry: SessionEntry; highlight?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [seatSaving, setSeatSaving] = useState<string | null>(null);
  const [due, setDue] = useState(entry.dueOn ?? "");
  /** The date on its way to the server, so leaving the field after Enter does not send it twice. */
  const dueSaving = useRef<string | null | undefined>(undefined);
  const open = view.status === "open";
  const may = entryRightsFor(view, entry);
  const parked = entry.status === "parked";
  const held = isHeld(entry);
  const seats = seatOrder(view);
  const fieldBase = `action-${entry.id}`;

  // The room's answer is the date: a save that landed, or someone else's change.
  useEffect(() => setDue(entry.dueOn ?? ""), [entry.dueOn]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const nameSeat = (seatId: string) => {
    if (busy || seatSaving != null) return;
    setSeatSaving(seatId);
    void run(() => actions.patchEntry(entry.id, { ownerSeatId: seatId || null })).finally(() => setSeatSaving(null));
  };

  const saveDue = async (field: HTMLInputElement) => {
    const next = cleanDueOn(due);
    // A date that is not a whole, real day goes back to the one the room holds.
    // A half-typed one reads as empty, the same as a cleared one, and only the
    // field's own validity tells them apart.
    if ((due && !next) || field.validity?.badInput) {
      setDue(entry.dueOn ?? "");
      return;
    }
    if (next === (entry.dueOn ?? null) || next === dueSaving.current) return;
    dueSaving.current = next;
    setBusy(true);
    try {
      const r = await actions.patchEntry(entry.id, { dueOn: next });
      if (!r.ok) setDue(entry.dueOn ?? "");
    } finally {
      dueSaving.current = undefined;
      setBusy(false);
    }
  };

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        highlight && !held && !parked ? "border-notice bg-amber-light/60" : parked ? "border-dashed border-border" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={`min-w-0 flex-1 font-medium ${parked ? "text-muted-foreground" : "text-foreground"}`}>{entry.text}</p>
        {parked && <span className={CHIP}>{ROOM_COPY.parkedLabel}</span>}
        {entry.status === "done" && <span className={CHIP}>{ROOM_COPY.doneLabel}</span>}
      </div>
      <p className={`mt-1 text-sm ${held ? "text-muted-foreground" : "font-semibold text-notice"}`}>
        {heldLine(entry)}
        {entry.dueOn ? ` · ${ROOM_COPY.dueLabel} ${entry.dueOn}` : ""}
      </p>

      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {may.claim && !parked && (
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void run(() => actions.patchEntry(entry.id, { claim: true }))}>
              {SESSION_COPY.claim}
            </button>
          )}
          {may.release && !parked && (
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void run(() => actions.patchEntry(entry.id, { release: true }))}>
              {SESSION_COPY.release}
            </button>
          )}
          {may.seat && !parked && seats.length > 0 && (
            <label htmlFor={`${fieldBase}-seat`} className="min-w-[10rem]">
              <span className={`${LABEL} text-xs`}>{SESSION_COPY.nameSeat}</span>
              <select
                id={`${fieldBase}-seat`}
                className={`${INPUT} mt-1`}
                value={seatSaving ?? entry.ownerSeatId ?? ""}
                aria-busy={seatSaving != null}
                onChange={(e) => nameSeat(e.target.value)}
              >
                <option value="">{ROOM_COPY.noSeat}</option>
                {seats.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {may.dueOn && !parked && (
            <label htmlFor={`${fieldBase}-due`} className="min-w-[9rem]">
              <span className={`${LABEL} text-xs`}>{ROOM_COPY.dueLabel}</span>
              <input
                id={`${fieldBase}-due`}
                type="date"
                className={`${INPUT} mt-1`}
                value={due}
                onChange={(e) => setDue(e.target.value)}
                onBlur={(e) => void saveDue(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveDue(e.currentTarget);
                  }
                }}
              />
            </label>
          )}
          {may.status && (
            <button
              type="button"
              className={BTN_QUIET}
              disabled={busy}
              onClick={() => void run(() => actions.patchEntry(entry.id, { status: parked ? "open" : "parked" }))}
            >
              {parked ? ROOM_COPY.bringBack : SESSION_COPY.park}
            </button>
          )}
          {may.remove && (
            <button type="button" className={BTN_ICON} aria-label={ROOM_COPY.remove} disabled={busy} onClick={() => void run(() => actions.deleteEntry(entry.id))}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Catch an action as it comes: what, and if the room knows it, which seat and by when. */
export function AddAction({ view, actions, itemId }: Omit<StageProps, "now"> & { itemId: number | null }) {
  const draftBase = `${view.id}:${itemId ?? "loose"}:action`;
  const textDraft = useDraft(`${draftBase}:text`);
  const seatDraft = useDraft(`${draftBase}:seat`);
  const dueDraft = useDraft(`${draftBase}:due`);
  const [text, seat, due] = [textDraft.text, seatDraft.text, dueDraft.text];
  const [busy, setBusy] = useState(false);
  const seats = seatOrder(view);
  if (!view.me.joined || view.status !== "open") return null;
  const base = `new-action-${itemId ?? "loose"}`;

  const add = async () => {
    const clean = cleanLine(text, SESSION_LIMITS.text);
    if (!clean || busy) return;
    setBusy(true);
    try {
      const r = await actions.addEntry({ kind: "action", text: clean, itemId, ownerSeatId: seat || null, dueOn: cleanDueOn(due) });
      if (r.ok) {
        textDraft.clear();
        seatDraft.clear();
        dueDraft.clear();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label htmlFor={`${base}-text`} className="block">
        <span className={`${LABEL} text-xs`}>{SESSION_COPY.addAction}</span>
        <input
          id={`${base}-text`}
          className={`${INPUT} mt-1`}
          value={text}
          maxLength={SESSION_LIMITS.text}
          placeholder={ROOM_COPY.writeHere}
          onChange={(e) => textDraft.set(e.target.value)}
        />
      </label>
      {seats.length > 0 && (
        <label htmlFor={`${base}-seat`} className="block">
          <span className={`${LABEL} text-xs`}>{ROOM_COPY.seatLabel}</span>
          <select id={`${base}-seat`} className={`${INPUT} mt-1`} value={seat} onChange={(e) => seatDraft.set(e.target.value)}>
            <option value="">{ROOM_COPY.noSeat}</option>
            {seats.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label htmlFor={`${base}-due`} className="block">
        <span className={`${LABEL} text-xs`}>{ROOM_COPY.dueLabel}</span>
        <input id={`${base}-due`} type="date" className={`${INPUT} mt-1`} value={due} onChange={(e) => dueDraft.set(e.target.value)} />
      </label>
      <button type="submit" className={BTN_SECONDARY} disabled={busy || !text.trim()}>
        {ROOM_COPY.add}
      </button>
    </form>
  );
}
