/**
 * THE HAND ON A POWER ROW.
 *
 * A power the server put to this member (`recommended`) carries a button to
 * raise a hand for it, and a hand that is up says where it stands. The rules
 * are the server's (shared/powerHands.ts, server/routes/powerHands.ts). This
 * file shows what the payload and the server's answers say, and decides none
 * of it.
 *
 * ── WHAT A MEMBER SEES ─────────────────────────────────────────────────────
 *
 *   - a power put to them, no hand:  "Raise my hand", which opens a note box
 *   - a hand that is up:             "Your hand is up", and whether somebody
 *                                    is reading it or talking with them about it
 *   - a power they hold:             nothing, because "Open to you" said it
 *
 * A hand stays visible on a power the map has since stopped putting to them,
 * because the hand is still in the inbox and still theirs. An answered hand is
 * down, and the notice that names the power is how the answer reaches them.
 *
 * The seat hand on the map (`components/power/HolderCard.tsx`) uses the same
 * words for the same act, so a member meets one idea in two places.
 *
 * ── THE SERVER'S WORD OUTLASTS A REMOUNT ───────────────────────────────────
 *
 * The payload on the page is older than any answer the server gives here, so
 * the row takes the server's word: the hand it filed, or the hand a refused
 * second raise names. That word is kept against the payload's own row object.
 * "Hide what is closed" unmounts rows and remounts them with the SAME object,
 * so the answer survives; a fresh payload brings new objects, and it wins.
 *
 * ── FOCUS AND NAMES ────────────────────────────────────────────────────────
 *
 * Opening the note box puts the cursor in it, and Cancel returns focus to the
 * button that opened it. When the hand goes up, focus moves to the sentence
 * saying so. The raise button is never disabled, because a disabled button
 * drops focus to the page; a second press while one is out does nothing. Every
 * button names its power, so a list of buttons is not ten identical "Raise my
 * hand". Every answer lands in one polite live region.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Hand } from "lucide-react";
import { authToken, type ProgressionCapability } from "@/lib/gameApi";
import { NOTE_IS_PUBLIC } from "@shared/powerHands";

export type RowHand = NonNullable<ProgressionCapability["hand"]>;

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/**
 * Where a hand that is up stands, keyed by the status union, so a status the
 * server adds is a compile error here and never an empty line on the profile.
 */
const STANDING: Record<RowHand["status"], string> = {
  new: "Your hand is up",
  reviewing: "Your hand is up, and somebody is reading it",
  "in-conversation": "Your hand is up, and somebody is talking with you about it",
};

/** The server's latest word on a row's hand, kept against the payload row it answered. */
const answered = new WeakMap<ProgressionCapability, RowHand>();

export default function PowerHand({ row }: { row: ProgressionCapability }) {
  const [hand, setHand] = useState<RowHand | null>(answered.get(row) ?? row.hand ?? null);
  const [raising, setRaising] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [focusTo, setFocusTo] = useState<"open" | "hand" | null>(null);
  const noteId = useId();
  const openRef = useRef<HTMLButtonElement>(null);
  const handRef = useRef<HTMLSpanElement>(null);

  // A new payload row replaces what this row showed, unless the server has
  // already answered about that same row.
  useEffect(() => {
    setHand(answered.get(row) ?? row.hand ?? null);
  }, [row]);

  useEffect(() => {
    if (focusTo === "open") openRef.current?.focus();
    if (focusTo === "hand") handRef.current?.focus();
    if (focusTo) setFocusTo(null);
  }, [focusTo]);

  if (row.held) return null;
  if (!hand && !row.recommended && !said) return null;

  const raise = async () => {
    if (busy) return;
    setBusy(true);
    setSaid("");
    try {
      const r = await fetch(`/api/powers/${encodeURIComponent(row.key)}/raise-hand`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const d = await r.json().catch(() => ({}));
      // The server names the hand that is up on a success and on a refused
      // second hand alike, and either way that is what the row shows.
      if (d?.hand?.status) {
        answered.set(row, d.hand);
        setHand(d.hand);
        setRaising(false);
        setNote("");
        setFocusTo("hand");
      }
      if (!r.ok) throw new Error(d?.message ?? d?.error ?? "Could not raise your hand");
      setSaid("Hand raised. The founding team will be in touch.");
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="basis-full">
      {hand ? (
        <span ref={handRef} tabIndex={-1} className="inline-flex items-center gap-1 text-xs font-semibold text-notice outline-none">
          <Hand className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {STANDING[hand.status]}
        </span>
      ) : !row.recommended ? null : raising ? (
        <span className="mt-2 flex flex-col gap-2">
          <label htmlFor={noteId} className="text-xs text-muted-foreground">
            Why this power calls to you (optional)
          </label>
          {/*
            Rye, 2026-09-23: a note on a raised hand is public, and existing
            notes went public with it. Said HERE, above the empty box, because
            the one thing a build owes somebody under a ruling like that is
            that they knew before they wrote.
          */}
          <p className="text-xs text-muted-foreground">{NOTE_IS_PUBLIC}</p>
          <textarea
            id={noteId}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void raise()}
              aria-disabled={busy}
              aria-label={`Raise my hand for ${row.label}`}
              className="min-h-11 rounded-lg border border-notice/40 bg-notice/15 px-4 text-sm font-semibold text-notice aria-disabled:opacity-60"
            >
              Raise my hand
            </button>
            <button
              type="button"
              onClick={() => {
                setRaising(false);
                setFocusTo("open");
              }}
              className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </span>
        </span>
      ) : (
        <button
          ref={openRef}
          type="button"
          onClick={() => {
            setSaid("");
            setRaising(true);
          }}
          aria-label={`Raise my hand for ${row.label}`}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted"
        >
          <Hand className="h-4 w-4 shrink-0" aria-hidden="true" />
          Raise my hand
        </button>
      )}
      <span aria-live="polite" className="block text-xs text-muted-foreground">
        {said}
      </span>
    </span>
  );
}
