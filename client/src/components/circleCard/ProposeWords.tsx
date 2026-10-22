/**
 * PROPOSING NEW WORDS FOR A CIRCLE, in place beside each word on its card.
 *
 * Only a holder of a role in the circle, or an admin, sees the switch (the
 * server says so in `viewer.mayPropose`, and refuses anybody else again).
 * A proposal never writes the circle: it opens an org draft with one
 * `update_circle` change, and the section then says "Proposed, waiting for
 * consent" until the draft is adopted (server/routes/circleCard.ts).
 *
 * The text is checked in the browser by the one parser the server runs
 * (shared/circleCharterParse.ts), so the sentence under the box is the
 * refusal the server would send.
 */
import { createContext, useContext, useId, useState } from "react";
import { Link } from "wouter";
import { Pencil } from "lucide-react";
import { LINK, QUIET_BUTTON, TAP } from "@/components/playerCard/cardParts";
import { gameFetch } from "@/lib/gameApi";
import { CIRCLE_CARD_WORDS as W } from "@shared/circleCardWords";
import { circleWordLabel, parseCircleWord, type CircleWordKey } from "@shared/circleCharterParse";

export interface CircleEditState {
  /** The proposer has "Propose new words" switched on. */
  editing: boolean;
  circleId: string;
  /** The words an open draft would change. */
  pending: readonly CircleWordKey[];
  reviewHref: string | null;
  /** Read the card again after a proposal. */
  reload: () => void;
}

export const CircleEditContext = createContext<CircleEditState>({ editing: false, circleId: "", pending: [], reviewHref: null, reload: () => undefined });

/** POST /api/org/circles/:id/card/propose with one field. */
export async function proposeCircleWords(circleId: string, key: CircleWordKey, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await gameFetch(`/api/org/circles/${encodeURIComponent(circleId)}/card/propose`, {
      method: "POST",
      body: JSON.stringify({ [key]: text }),
    });
    if (res.ok) return { ok: true };
    const out = await res.json().catch(() => null);
    return { ok: false, error: String(out?.message ?? W.proposeFailed) };
  } catch {
    return { ok: false, error: W.proposeFailed };
  }
}

/** "Proposed, waiting for consent", beside a word an open draft would change. */
export function PendingWords({ wordKey }: { wordKey: CircleWordKey }) {
  const { pending } = useContext(CircleEditContext);
  if (!pending.includes(wordKey)) return null;
  return <p className="mt-1 text-sm font-medium text-notice">{W.pending}</p>;
}

/** The proposer's control beside one word. Draws nothing until "Propose new words" is on. */
export function ProposeWords({ wordKey, initial }: { wordKey: CircleWordKey; initial: string }) {
  const { editing, circleId, reviewHref, reload } = useContext(CircleEditContext);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const id = useId();
  if (!editing) return null;
  const label = circleWordLabel(wordKey);
  const single = wordKey === "purpose" || wordKey === "existsWhile";
  const hint = wordKey === "values" ? W.valuesHint : single ? null : W.oneLine;

  const send = async () => {
    const checked = parseCircleWord(wordKey, text);
    if (!checked.ok) {
      setSaid(checked.problem);
      return;
    }
    setBusy(true);
    const r = await proposeCircleWords(circleId, wordKey, text);
    setBusy(false);
    if (r.ok) {
      setSaid(W.proposed);
      setOpen(false);
      reload();
    } else setSaid(r.error);
  };

  return (
    <div className="mt-2" data-propose-words={wordKey}>
      {open ? (
        <div className="grid gap-2">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <p className="text-xs text-muted-foreground">{W.proposeNote}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          <textarea
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={wordKey === "existsWhile" ? 2 : 5}
            className="w-full rounded-lg border border-border bg-card p-3 text-sm text-card-foreground"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void send()} className={`${TAP} bg-teal-deep text-white hover:bg-teal-deep-dark`}>
              {W.proposeSend}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={QUIET_BUTTON}>
              {W.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setText(initial);
            setSaid(null);
            setOpen(true);
          }}
          className={QUIET_BUTTON}
          aria-label={`${W.proposeWords}: ${label}`}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {W.proposeWords}
        </button>
      )}
      {said ? (
        <p role="status" className="mt-1 text-sm text-card-foreground">
          {said}
          {said === W.proposed && reviewHref ? (
            <>
              {" "}
              <Link href={reviewHref} className={LINK}>
                {W.seeProposal}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
