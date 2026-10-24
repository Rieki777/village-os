/**
 * ONE AGENDA ITEM'S LIVE PAGE: its title and aim, its own clock, what people
 * add while it runs (notes, ideas, a proposal with its consent round, what we
 * learned from it, the actions it leaves behind).
 *
 * It is the screen's one foil card, the way a role card is on a profile: the
 * clock as a medallion, the aim as a gold eyebrow, the title set large in the
 * village's display face. Notes and ideas sit side by side once the card is
 * wide enough to give each a real column, and stack on a phone.
 *
 * EVERY BOX CAN BE CHANGED, by whoever may change it. The title is fixed in
 * place by whoever added the item while it is not done, and by the hosts and
 * an admin in the room at any time (roomUi's `mayEditItemTitle`). Each card
 * under it is an EntryCard with its own pencil. Every box anybody writes in is
 * the room's growing box, full width, so the words are read whole as they are
 * typed.
 *
 * WHAT WE LEARNED. The record keeps one sentence per lesson, under its own
 * heading and a line that says what it is for. It is stored as the kind
 * `seed`, and the room never calls it that.
 *
 * When its time is up everyone reads the three choices, and the facilitator
 * makes one: add five minutes with the room's consent, park it, or wrap it up
 * (start the next item, or none). An item that is done early is wrapped up
 * the same way, from a quiet button beside its clock.
 */
import { useState } from "react";
import {
  AIM_DEFS,
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  SESSION_REFUSALS,
  cleanLine,
  cleanText,
  timebox,
  type SessionItem,
} from "@shared/sessions";
import { ActionRow, AddAction } from "./ActionRow";
import EditableText from "./EditableText";
import EntryCard from "./EntryCard";
import EntryStream from "./EntryStream";
import GrowingText from "./GrowingText";
import Proposal from "./Proposal";
import TimeboxRing from "./TimeboxRing";
import {
  BTN_PRIMARY,
  BTN_QUIET,
  BTN_SECONDARY,
  EYEBROW,
  HERO_CONTENT,
  HERO_INNER,
  HERO_SHELL,
  HINT,
  ITEM_STREAMS,
  ITEM_TITLE,
  LABEL_CAPS,
  UNDER_BOX,
  agendaOrder,
  leads,
  mayEditItemTitle,
  useDraft,
  type StageProps,
} from "./roomUi";

/**
 * A box to add one thing to the item: the proposal, a line on what we
 * learned. What is typed is a draft under `draftKey`, so it survives the room
 * moving on under it. Enter adds it.
 */
function AddBox({
  draftKey,
  label,
  button,
  singleLine = false,
  minRows,
  describedBy,
  onSend,
}: {
  draftKey: string;
  label: string;
  button: string;
  singleLine?: boolean;
  minRows: number;
  describedBy?: string;
  onSend: (text: string) => Promise<boolean>;
}) {
  const draft = useDraft(draftKey);
  const text = draft.text;
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const clean = singleLine ? cleanLine(text, SESSION_LIMITS.text) : cleanText(text, SESSION_LIMITS.text);
    if (!clean || busy) return;
    setBusy(true);
    try {
      if (await onSend(clean)) draft.clear();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <GrowingText
        value={text}
        onValue={draft.set}
        onSubmit={() => void send()}
        label={label}
        max={SESSION_LIMITS.text}
        minRows={minRows}
        singleLine={singleLine}
        describedBy={describedBy}
        mic
      />
      <div className={UNDER_BOX}>
        <button type="submit" className={BTN_SECONDARY} disabled={busy || !text.trim()}>
          {button}
        </button>
      </div>
    </form>
  );
}

export default function ItemPage({ view, now, actions, item }: StageProps & { item: SessionItem }) {
  const [busy, setBusy] = useState(false);
  const live = view.state.activeItemId === item.id;
  const box = live
    ? timebox(view.state.itemStartedAt, item.minutes, view.state.itemExtraMin, now)
    : timebox(null, item.minutes, 0, now);
  const entries = view.entries.filter((e) => e.itemId === item.id);
  const proposals = entries.filter((e) => e.kind === "decision");
  const learned = entries.filter((e) => e.kind === "seed");
  const itemActions = entries.filter((e) => e.kind === "action");
  const canAdd = view.me.joined && view.status === "open";
  const nextItem = agendaOrder(view.items).find((i) => i.status === "waiting" && i.id !== item.id) ?? null;
  const ids = { title: `item-${item.id}-title`, proposal: `item-${item.id}-proposal`, seed: `item-${item.id}-seed`, actions: `item-${item.id}-actions` };

  const choose = async (choice: "extend" | "park" | "wrap") => {
    setBusy(true);
    try {
      if (choice === "extend") await actions.act({ type: "extend", minutes: SESSION_LIMITS.extendStepMin });
      if (choice === "park") {
        const r = await actions.patchItem(item.id, { status: "parked" });
        if (r.ok && r.room?.state.activeItemId === item.id) await actions.act({ type: "item", itemId: null });
      }
      if (choice === "wrap") await actions.act({ type: "item", itemId: nextItem?.id ?? null });
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = async (next: string) => {
    const title = cleanLine(next, SESSION_LIMITS.agendaTitle);
    if (!title) return { ok: false, error: SESSION_REFUSALS.itemTitleNeeded };
    const r = await actions.patchItem(item.id, { title }, { quiet: true });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };

  return (
    <article className={HERO_SHELL} aria-labelledby={ids.title}>
      <div className={HERO_INNER}>
        <div className={HERO_CONTENT}>
          <header className="flex flex-wrap items-start gap-5">
            <TimeboxRing phase={box.phase} secondsLeft={box.secondsLeft} totalSeconds={box.totalSeconds} />
            <div className="min-w-[min(14rem,100%)] flex-1">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={EYEBROW}>{AIM_DEFS[item.aim].label}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {item.minutes + (live ? view.state.itemExtraMin : 0)} {ROOM_COPY.minutesShort} · {ROOM_COPY.itemStatus[item.status]}
                </span>
              </p>
              <div className="mt-1">
                <EditableText
                  value={item.title}
                  may={mayEditItemTitle(view, item)}
                  label={ROOM_COPY.itemTitleLabel}
                  max={SESSION_LIMITS.agendaTitle}
                  singleLine
                  draftKey={`${view.id}:edit:item:${item.id}:title`}
                  onSave={saveTitle}
                  render={(text) => (
                    <h3 id={ids.title} className={ITEM_TITLE}>
                      {text}
                    </h3>
                  )}
                />
              </div>
              <p className={`${HINT} mt-1`}>{AIM_DEFS[item.aim].hint}</p>
            </div>
            {live && box.phase !== "over" && leads(view) && (
              <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void choose("wrap")}>
                {nextItem ? ROOM_COPY.wrapNext : ROOM_COPY.wrapUp}
              </button>
            )}
          </header>

          {live && box.phase === "over" && (
            <div role="status" className="rounded-xl border border-destructive/50 bg-muted px-4 py-3">
              <p className="text-sm font-medium text-foreground">{SESSION_COPY.overChoices}</p>
              {leads(view) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void choose("extend")}>
                    {ROOM_COPY.extendFive}
                  </button>
                  <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void choose("park")}>
                    {SESSION_COPY.park}
                  </button>
                  <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void choose("wrap")}>
                    {nextItem ? ROOM_COPY.wrapNext : ROOM_COPY.wrapUp}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className={ITEM_STREAMS}>
            <EntryStream view={view} actions={actions} kind="note" itemId={item.id} title={ROOM_COPY.notes} addLabel={SESSION_COPY.addNote} />
            <EntryStream view={view} actions={actions} kind="idea" itemId={item.id} title={ROOM_COPY.ideas} addLabel={SESSION_COPY.addIdea} />
          </div>

          <section className="space-y-3" aria-labelledby={ids.proposal}>
            <h4 id={ids.proposal} className={LABEL_CAPS}>
              {ROOM_COPY.proposal}
            </h4>
            {proposals.map((p) => (
              <Proposal key={p.id} view={view} actions={actions} entry={p} now={now} />
            ))}
            {canAdd && (proposals.length === 0 || item.aim === "decide") && (
              <AddBox
                draftKey={`${view.id}:${item.id}:decision`}
                label={SESSION_COPY.addDecision}
                button={ROOM_COPY.add}
                minRows={3}
                onSend={async (text) => (await actions.addEntry({ kind: "decision", text, itemId: item.id })).ok}
              />
            )}
          </section>

          <section className="space-y-3" aria-labelledby={ids.seed}>
            <div>
              <h4 id={ids.seed} className={LABEL_CAPS}>
                {ROOM_COPY.seed}
              </h4>
              <p id={`${ids.seed}-help`} className={`${HINT} mt-1`}>
                {ROOM_COPY.seedHelp}
              </p>
            </div>
            {learned.length > 0 && (
              <ul className="space-y-2">
                {learned.map((s) => (
                  <li key={s.id}>
                    <EntryCard view={view} actions={actions} entry={s} quote singleLine />
                  </li>
                ))}
              </ul>
            )}
            {canAdd && (
              <AddBox
                draftKey={`${view.id}:${item.id}:seed`}
                label={SESSION_COPY.itemSeedPrompt}
                button={ROOM_COPY.seedSave}
                singleLine
                minRows={2}
                describedBy={`${ids.seed}-help`}
                onSend={async (text) => (await actions.addEntry({ kind: "seed", text, itemId: item.id })).ok}
              />
            )}
          </section>

          <section className="space-y-3" aria-labelledby={ids.actions}>
            <h4 id={ids.actions} className={LABEL_CAPS}>
              {ROOM_COPY.actionsHere}
            </h4>
            {itemActions.length > 0 && (
              <ul className="space-y-2">
                {itemActions.map((e) => (
                  <ActionRow key={e.id} view={view} actions={actions} entry={e} />
                ))}
              </ul>
            )}
            <AddAction view={view} actions={actions} itemId={item.id} />
          </section>
        </div>
      </div>
    </article>
  );
}
