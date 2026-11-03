/**
 * Why: the small sheet Remove and Redirect open on Your list (PR E).
 *
 * A reason is required, a note is optional. The sheet says plainly that the
 * reason helps the knowledge library learn, and that a note stays in the
 * village until notes are released. Redirect also asks who: a named member, or
 * a role. Nothing is sent until the press is saved.
 */
import { useEffect, useState } from "react";
import { NOTE_MAX, REDIRECT_CHOICES, REMOVE_CHOICES, SCREEN_REASON_WORDS, type ScreenReason } from "@shared/memberTaskFeedback";
import { BTN_PRIMARY, BTN_QUIET, HINT, LABEL_CAPS } from "@/components/sessions/roomUi";
import { readTargets } from "./yourListApi";

export interface ReasonPick {
  reason: ScreenReason;
  note: string | null;
  toUserId?: string;
  toRoleId?: string;
}

const FIELD = "mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-foreground";

export default function ReasonSheet({ mode, busy, onCancel, onPick }: {
  mode: "remove" | "redirect";
  busy: boolean;
  onCancel: () => void;
  onPick: (p: ReasonPick) => void;
}) {
  const choices = mode === "remove" ? REMOVE_CHOICES : REDIRECT_CHOICES;
  const [reason, setReason] = useState<ScreenReason | "">("");
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [targets, setTargets] = useState<{ people: { id: string; name: string }[]; roles: { id: string; name: string }[] } | null>(null);
  useEffect(() => {
    if (mode === "redirect") void readTargets().then(setTargets);
  }, [mode]);

  const ready = !!reason && (mode === "remove" || !!to);
  const pick = () => {
    if (!ready) return;
    const [kind, id] = to.split(":");
    onPick({
      reason: reason as ScreenReason,
      note: note.trim() || null,
      ...(mode === "redirect" ? (kind === "p" ? { toUserId: id } : { toRoleId: id }) : {}),
    });
  };

  return (
    <div className="mt-2 rounded-xl border border-border bg-background p-3">
      <fieldset>
        <legend className={LABEL_CAPS}>{mode === "remove" ? "Why remove it?" : "Why hand it on?"}</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {choices.map((c) => (
            <label key={c} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-2 text-sm text-foreground">
              <input type="radio" name="why" value={c} checked={reason === c} onChange={() => setReason(c)} />
              {SCREEN_REASON_WORDS[c]}
            </label>
          ))}
        </div>
      </fieldset>
      {mode === "redirect" && (
        <label className="mt-2 block">
          <span className={LABEL_CAPS}>To</span>
          <select className={FIELD} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a person or a role</option>
            {targets && targets.people.length > 0 && (
              <optgroup label="A person">
                {targets.people.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
              </optgroup>
            )}
            {targets && targets.roles.length > 0 && (
              <optgroup label="A role">
                {targets.roles.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>
      )}
      <label className="mt-2 block">
        <span className={LABEL_CAPS}>A note (optional)</span>
        <textarea className={`${FIELD} min-h-20 py-2`} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className={`${HINT} mt-1`}>
        Your reason helps the knowledge library learn what to send you. A note stays in the village until notes are released, and
        emails and phone numbers are taken out before it ever leaves.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy || !ready} onClick={pick}>
          {mode === "remove" ? "Remove it" : "Hand it on"}
        </button>
        <button type="button" className={BTN_QUIET} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
