/**
 * A PROPOSAL, wherever the room meets one: on its item's page, with its
 * consent round, and again at the close, where every proposal still open is
 * listed with its tally so a proposal the room consented to is not left
 * unmarked when the session ends.
 *
 * Only the facilitator marks one decided, and only once everyone here
 * consents (`leads` and the tally); the server checks both again.
 *
 * WORDS WHILE IT IS OPEN, AND FINAL ONCE DECIDED. While the round is open,
 * whoever wrote the proposal, the hosts and an admin in the room can reword
 * it in place, and the open editor says first that new words start the
 * consent round again (the server clears the round when the words change).
 * Once the room has decided it, the words are the room's agreement: no pencil,
 * no remove, and a lock line that says why, so nobody hunts for a control
 * that is missing on purpose.
 *
 * The blossom opens once, for the people who were watching when the proposal
 * was decided. A proposal that was already decided when the page opened is
 * history, and a page that celebrates its own load celebrates nothing
 * (components/natural/moments.ts, `useArrival`).
 */
import { useState } from "react";
import { Lock, X } from "lucide-react";
import { ROOM_COPY, SESSION_LIMITS, SESSION_REFUSALS, cleanText, type SessionEntry } from "@shared/sessions";
import Celebration from "@/components/natural/Celebration";
import { useArrival, useMomentWindow } from "@/components/natural/moments";
import ConsentRound, { WaitingLine } from "./ConsentRound";
import RegenLens from "./RegenLens";
import EditableText from "./EditableText";
import {
  BTN_ICON,
  BTN_PRIMARY,
  CARD,
  CHIP,
  ENTRY_GLYPH,
  ENTRY_META,
  GLYPH,
  GLYPH_ICON,
  GLYPH_STROKE,
  H3,
  HINT,
  LOCK_LINE,
  consentOn,
  entryRightsFor,
  leads,
  nameOf,
  seesAnswers,
  type StageProps,
} from "./roomUi";

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

const Handshake = ENTRY_GLYPH.decision;
/** The decided mark: the room's living green, never the gold the next step wears. */
const DECIDED_CHIP = "inline-flex shrink-0 items-center gap-1 rounded-full border border-open/50 bg-muted px-2.5 py-0.5 text-xs font-semibold text-open";

export default function Proposal({ view, actions, entry, now }: Omit<StageProps, "now"> & { entry: SessionEntry; now?: number }) {
  const [removing, setRemoving] = useState(false);
  const decided = entry.status === "done";
  const rights = entryRightsFor(view, entry);
  const mayEdit = rights.edit && !decided;
  const mayRemove = rights.remove && !decided;
  const arrived = useArrival(entry.status);
  const blossom = useMomentWindow(arrived === "done" ? entry.id : null);

  const save = async (next: string) => {
    const clean = cleanText(next, SESSION_LIMITS.text);
    if (!clean) return { ok: false, error: SESSION_REFUSALS.textNeeded };
    const r = await actions.patchEntry(entry.id, { text: clean }, { quiet: true });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };

  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await actions.deleteEntry(entry.id);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className={`rounded-xl border px-4 py-4 has-[textarea]:border-notice/60 ${decided ? "border-open/50 bg-muted" : "border-border bg-muted"}`}
      data-entry="decision"
      data-decided={decided ? "" : undefined}
    >
      <div className="flex items-start gap-3">
        <span className={GLYPH} aria-hidden="true">
          <Handshake className={GLYPH_ICON} strokeWidth={GLYPH_STROKE} />
        </span>
        <div className="min-w-0 flex-1">
          <EditableText
            value={entry.text}
            may={mayEdit}
            label={ROOM_COPY.proposal.toLowerCase()}
            max={SESSION_LIMITS.text}
            mic
            warn={ROOM_COPY.rewordWarn}
            draftKey={`${view.id}:edit:entry:${entry.id}`}
            onSave={save}
            bare
            tools={
              mayRemove ? (
                <button type="button" className={BTN_ICON} aria-label={ROOM_COPY.remove} disabled={removing} onClick={() => void remove()}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null
            }
            render={(text) => (
              <div className="min-w-0">
                <p className="whitespace-pre-line break-words font-display text-xl leading-snug lining-nums text-foreground">{text}</p>
                <span className={ENTRY_META}>{nameOf(view, entry.authorUserId) ?? ""}</span>
              </div>
            )}
          />
        </div>
        {decided && (
          <span className={DECIDED_CHIP}>
            {blossom && <Celebration kind="blossom" intensity="whisper" size={28} message={ROOM_COPY.decidedBadge} />}
            {ROOM_COPY.decide}
          </span>
        )}
      </div>
      {decided ? (
        <p className={`${LOCK_LINE} mt-3`}>
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          {ROOM_COPY.decidedLock}
        </p>
      ) : (
        <div className="mt-4">
          <RegenLens entryId={entry.id} />
          <ConsentRound
            view={view}
            actions={actions}
            now={now}
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
            <li key={e.id} className="rounded-xl border border-border bg-muted px-4 py-3">
              {itemTitle && <span className={CHIP}>{itemTitle}</span>}
              <p className="mt-1 whitespace-pre-line font-medium text-foreground">{e.text}</p>
              <p className={`${HINT} mt-1`}>{answers ? ROOM_COPY.tallyLine(tally) : ROOM_COPY.answersHeardInRoom}</p>
              <WaitingLine view={view} target={`decision:${e.id}`} className="mt-0.5" />
              {answers && tally.consented && <p className="text-sm font-semibold text-open">{ROOM_COPY.consented}</p>}
              <DecideButton view={view} actions={actions} entry={e} className="mt-2" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
