/**
 * ONE ACTION, and who holds it. Every action leaves the session with a person
 * or a seat on it, claimed here and now, or parked to the backlog.
 *
 *   anyone in the room          "I'll take it" on an action no person holds
 *   the person holding it, or   "Let it go"
 *   the facilitator
 *   whoever wrote it, the       change its words, name a seat, set a due
 *   facilitator, the note       date, park it, bring it back, take it out
 *   taker, an admin in the room
 *   the person holding it       set its due date
 *
 * The server decides every one of these (`entryRights`); the buttons only
 * appear where it would say yes (roomUi's `entryRightsFor`).
 *
 * THE WORDS CAN BE FIXED IN PLACE. An action is an EntryCard, so whoever may
 * change its words gets a pencil on its sentence, and a typo made in the
 * middle of a call is fixed in the middle of the call. The person holding it
 * gets no pencil: they set its date and can let it go, and the words stay as
 * whoever wrote them left them.
 *
 * A due date is typed a part at a time, so it is held on this screen and sent
 * when the field is left or Enter is pressed, never on each keystroke. The
 * seat and the date stay usable while a save is out, so the cursor stays
 * where the person put it; a seat chosen while one is still saving is
 * ignored, and the picker shows what is on its way until the room answers.
 *
 * ADDING ONE IS TWO ROWS. The sentence gets the whole width of the card on a
 * row of its own, in the growing box, and who holds it, the date and Add sit
 * underneath and wrap. On the first call the label, the seat picker and the
 * date shared one row with the box, and the box was squeezed to one letter.
 */
import { useEffect, useRef, useState } from "react";
import {
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  cleanDueOn,
  cleanLine,
  type SessionEntry,
} from "@shared/sessions";
import EntryCard from "./EntryCard";
import GrowingText from "./GrowingText";
import {
  BTN_PRIMARY,
  BTN_QUIET,
  BTN_SECONDARY,
  CHIP,
  INPUT,
  LABEL,
  SELECT_CAPPED,
  UNDER_BOX,
  entryRightsFor,
  heldLine,
  isHeld,
  seatOrder,
  useDraft,
  type StageProps,
} from "./roomUi";

/** A date field as wide as its date, so it sits beside the holder and never takes the row. */
const DATE_INPUT = INPUT.replace("w-full", "w-auto");

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
  const marked = highlight && !held && !parked;

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

  const controls = open && (may.claim || may.release || may.seat || may.dueOn || may.status);

  const extra = (
    <>
      <p className={`mt-1 text-sm ${held ? "text-muted-foreground" : "font-semibold text-notice"}`}>
        {heldLine(entry)}
        {entry.dueOn ? ` · ${ROOM_COPY.dueLabel} ${entry.dueOn}` : ""}
        {parked && <span className={`${CHIP} ml-2`}>{ROOM_COPY.parkedLabel}</span>}
        {entry.status === "done" && <span className={`${CHIP} ml-2`}>{ROOM_COPY.doneLabel}</span>}
      </p>
      {controls && (
        <div className={`${UNDER_BOX} mt-2`}>
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
            <label htmlFor={`${fieldBase}-seat`} className="block min-w-0">
              <span className={`${LABEL} text-xs`}>{SESSION_COPY.nameSeat}</span>
              <select
                id={`${fieldBase}-seat`}
                className={`${SELECT_CAPPED} mt-1`}
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
            <label htmlFor={`${fieldBase}-due`} className="block">
              <span className={`${LABEL} text-xs`}>{ROOM_COPY.dueLabel}</span>
              <input
                id={`${fieldBase}-due`}
                type="date"
                className={`${DATE_INPUT} mt-1`}
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
        </div>
      )}
    </>
  );

  // An action a refused close named wears a gold ring until somebody holds it.
  return (
    <li className={`rounded-xl ${marked ? "ring-2 ring-notice" : ""}`} data-marked={marked ? "" : undefined}>
      <EntryCard view={view} actions={actions} entry={entry} singleLine extra={extra} muted={parked} />
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
      className="space-y-3"
      data-add-action=""
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      {/* Row one: the sentence, on the whole width of the card. */}
      <div data-action-text="">
        <label htmlFor={`${base}-text`} className={`${LABEL} mb-1.5`}>
          {SESSION_COPY.addAction}
        </label>
        <GrowingText
          id={`${base}-text`}
          value={text}
          onValue={textDraft.set}
          onSubmit={() => void add()}
          label={ROOM_COPY.actionPlaceholder}
          max={SESSION_LIMITS.text}
          minRows={2}
          singleLine
          mic
        />
      </div>
      {/* Row two: who holds it, by when, and Add. It wraps, and never squeezes the box above. */}
      <div className={UNDER_BOX} data-action-under="">
        {seats.length > 0 && (
          <label htmlFor={`${base}-seat`} className="block min-w-0">
            <span className={`${LABEL} text-xs`}>{ROOM_COPY.actionHolderLabel}</span>
            <select id={`${base}-seat`} className={`${SELECT_CAPPED} mt-1`} value={seat} onChange={(e) => seatDraft.set(e.target.value)}>
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
          <input id={`${base}-due`} type="date" className={`${DATE_INPUT} mt-1`} value={due} onChange={(e) => dueDraft.set(e.target.value)} />
        </label>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !text.trim()}>
          {ROOM_COPY.add}
        </button>
      </div>
    </form>
  );
}
