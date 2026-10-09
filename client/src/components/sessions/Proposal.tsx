/**
 * A PROPOSAL, wherever the room meets one: on its item's page, with its
 * consent round, and again at the close, where every proposal still open is
 * listed with its tally so a proposal the room consented to is not left
 * unmarked when the session ends.
 *
 * Only the facilitator marks one decided, and only once everyone here
 * consents (`leads` and the tally); the server checks both again.
 */
import { useState } from "react";
import { ROOM_COPY, type SessionEntry } from "@shared/sessions";
import ConsentRound from "./ConsentRound";
import { BTN_PRIMARY, CARD, CHIP, H3, HINT, consentOn, leads, nameOf, seesAnswers, type StageProps } from "./roomUi";

/** "Decided by consent", for the facilitator, once the room has consented. */
export function DecideButton({ view, actions, entry, className = "" }: Omit<StageProps, "now"> & { entry: SessionEntry; className?: string }) {
  const [busy, setBusy] = useState(false);
  const { tally } = consentOn(view, `decision:${entry.id}`);
  if (!leads(view) || !tally.consented || entry.status === "done") return null;
  return (
    <button
      type="button"
      className={`${BTN_PRIMARY} ${className}`}
      disabled={busy}
      onClick={async () => {
        if (busy) return;
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
  );
}

export default function Proposal({ view, actions, entry }: Omit<StageProps, "now"> & { entry: SessionEntry }) {
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
            target={`decision:${entry.id}`}
            ask={ROOM_COPY.proposalConsentAsk}
            readOnly={!view.me.joined || view.status !== "open"}
          />
          <DecideButton view={view} actions={actions} entry={entry} className="mt-3" />
        </div>
      )}
    </div>
  );
}

/**
 * AT THE CLOSE: every proposal still open, with where it came from and how the
 * room stands on it. A proposal left open goes into the record as not decided.
 */
export function OpenProposals({ view, actions }: Omit<StageProps, "now">) {
  const open = view.entries.filter((e) => e.kind === "decision" && e.status === "open");
  if (view.status !== "open" || !open.length) return null;
  const answers = seesAnswers(view);
  return (
    <section className={CARD} aria-labelledby="close-proposals">
      <h3 id="close-proposals" className={H3}>
        {ROOM_COPY.openProposalsTitle}
      </h3>
      <p className={`${HINT} mt-1`}>{ROOM_COPY.openProposalsHint}</p>
      <ul className="mt-3 space-y-2">
        {open.map((e) => {
          const { tally } = consentOn(view, `decision:${e.id}`);
          const itemTitle = view.items.find((i) => i.id === e.itemId)?.title ?? null;
          return (
            <li key={e.id} className="rounded-xl border border-border bg-card px-4 py-3">
              {itemTitle && <span className={CHIP}>{itemTitle}</span>}
              <p className="mt-1 whitespace-pre-line font-medium text-foreground">{e.text}</p>
              <p className={`${HINT} mt-1`}>{answers ? ROOM_COPY.tallyLine(tally) : ROOM_COPY.answersHeardInRoom}</p>
              {answers && tally.consented && <p className="text-sm font-semibold text-open">{ROOM_COPY.consented}</p>}
              <DecideButton view={view} actions={actions} entry={e} className="mt-2" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
