/**
 * ONE AGENDA ITEM'S LIVE PAGE: its title and aim, its own clock, what people
 * add while it runs (notes, ideas, a proposal with its consent round, the seed
 * it closes with, the actions it leaves behind).
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
  cleanLine,
  cleanText,
  timebox,
  type SessionEntry,
  type SessionItem,
} from "@shared/sessions";
import { ActionRow, AddAction } from "./ActionRow";
import ConsentRound from "./ConsentRound";
import EntryStream from "./EntryStream";
import TimeboxRing from "./TimeboxRing";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, CHIP, H2, HINT, INPUT, agendaOrder, consentOn, leads, nameOf, type StageProps } from "./roomUi";

function Proposal({ view, actions, entry }: Omit<StageProps, "now"> & { entry: SessionEntry }) {
  const [busy, setBusy] = useState(false);
  const target = `decision:${entry.id}` as const;
  const { tally } = consentOn(view, target);
  const decided = entry.status === "done";
  return (
    <div className={`rounded-xl border px-4 py-4 ${decided ? "border-open/50 bg-sage-light/60" : "border-border bg-card"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 whitespace-pre-line font-medium text-foreground">{entry.text}</p>
        {decided && <span className={`${CHIP} bg-open/15 text-open`}>{ROOM_COPY.decide}</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{nameOf(view, entry.authorUserId) ?? ""}</p>
      {!decided && (
        <div className="mt-4">
          <ConsentRound
            view={view}
            actions={actions}
            target={target}
            ask={ROOM_COPY.proposalConsentAsk}
            readOnly={!view.me.joined || view.status !== "open"}
          />
          {leads(view) && tally.consented && (
            <button
              type="button"
              className={`${BTN_PRIMARY} mt-3`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await actions.patchEntry(entry.id, { status: "done" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {ROOM_COPY.decide}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A short form for one line or a few: the proposal, the seed. */
function OneLine({
  label,
  button,
  multiline,
  onSend,
}: {
  label: string;
  button: string;
  multiline?: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const clean = multiline ? cleanText(text, SESSION_LIMITS.text) : cleanLine(text, SESSION_LIMITS.text);
    if (!clean || busy) return;
    setBusy(true);
    try {
      if (await onSend(clean)) setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        {multiline ? (
          <textarea className={`${INPUT} min-h-20`} value={text} maxLength={SESSION_LIMITS.text} placeholder={label} onChange={(e) => setText(e.target.value)} />
        ) : (
          <input className={INPUT} value={text} maxLength={SESSION_LIMITS.text} placeholder={label} onChange={(e) => setText(e.target.value)} />
        )}
      </label>
      <button type="submit" className={BTN_SECONDARY} disabled={busy || !text.trim()}>
        {button}
      </button>
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
  const seeds = entries.filter((e) => e.kind === "seed");
  const itemActions = entries.filter((e) => e.kind === "action");
  const canAdd = view.me.joined && view.status === "open";
  const nextItem = agendaOrder(view.items).find((i) => i.status === "waiting" && i.id !== item.id) ?? null;

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

  return (
    <article className={`${CARD} space-y-6`} aria-labelledby={`item-${item.id}-title`}>
      <header className="flex flex-wrap items-center gap-5">
        <TimeboxRing phase={box.phase} secondsLeft={box.secondsLeft} totalSeconds={box.totalSeconds} />
        <div className="min-w-[14rem] flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className={CHIP}>{AIM_DEFS[item.aim].label}</span>
            <span>
              {item.minutes + (live ? view.state.itemExtraMin : 0)} {ROOM_COPY.minutesShort}
            </span>
            <span>· {ROOM_COPY.itemStatus[item.status]}</span>
          </p>
          <h3 id={`item-${item.id}-title`} className={`${H2} mt-1`}>
            {item.title}
          </h3>
          <p className={`${HINT} mt-1`}>{AIM_DEFS[item.aim].hint}</p>
        </div>
        {live && box.phase !== "over" && leads(view) && (
          <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void choose("wrap")}>
            {nextItem ? ROOM_COPY.wrapNext : ROOM_COPY.wrapUp}
          </button>
        )}
      </header>

      {live && box.phase === "over" && (
        <div role="status" className="rounded-xl border border-coral/40 bg-coral/5 px-4 py-3">
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

      <div className="grid gap-6 lg:grid-cols-2">
        <EntryStream view={view} actions={actions} kind="note" itemId={item.id} title={ROOM_COPY.notes} addLabel={SESSION_COPY.addNote} />
        <EntryStream view={view} actions={actions} kind="idea" itemId={item.id} title={ROOM_COPY.ideas} addLabel={SESSION_COPY.addIdea} />
      </div>

      <section className="space-y-3" aria-labelledby={`item-${item.id}-proposal`}>
        <h4 id={`item-${item.id}-proposal`} className="text-sm font-semibold text-foreground">
          {ROOM_COPY.proposal}
        </h4>
        {proposals.map((p) => (
          <Proposal key={p.id} view={view} actions={actions} entry={p} />
        ))}
        {canAdd && (proposals.length === 0 || item.aim === "decide") && (
          <OneLine
            label={SESSION_COPY.addDecision}
            button={ROOM_COPY.add}
            multiline
            onSend={async (text) => (await actions.addEntry({ kind: "decision", text, itemId: item.id })).ok}
          />
        )}
      </section>

      <section className="space-y-2" aria-labelledby={`item-${item.id}-seed`}>
        <h4 id={`item-${item.id}-seed`} className="text-sm font-semibold text-foreground">
          {ROOM_COPY.seed}
        </h4>
        {seeds.map((s) => (
          <p key={s.id} className="rounded-xl bg-sage-light/60 px-4 py-3 font-display text-lg text-foreground">
            {s.text}
          </p>
        ))}
        {canAdd && (
          <OneLine
            label={SESSION_COPY.itemSeedPrompt}
            button={ROOM_COPY.seedSave}
            onSend={async (text) => (await actions.addEntry({ kind: "seed", text, itemId: item.id })).ok}
          />
        )}
      </section>

      <section className="space-y-3" aria-labelledby={`item-${item.id}-actions`}>
        <h4 id={`item-${item.id}-actions`} className="text-sm font-semibold text-foreground">
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
    </article>
  );
}
