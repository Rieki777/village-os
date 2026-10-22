/**
 * RAISE A TENSION WITH A ROLE: the member's control (shared/roleTensions.ts
 * holds the contract and the words). Small on purpose, so the player role
 * card and /roles can each mount it with one tag:
 *
 *   <RaiseTension roleId={role.id} roleName={role.name} />
 *
 * It asks the role's tensions read once, and draws nothing at all unless that
 * read says this reader may raise one: a visitor, a guest and a failed read
 * all leave the page as it was. Before a word is written the box says who
 * can read it, because a tension often names a person.
 *
 * The words go to the role's holders, and nowhere else, until a holder brings
 * them to the circle. Nothing here names a holder.
 */
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { gameFetch } from "@/lib/gameApi";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, COUNTER, HINT, LABEL, TEXTBOX } from "@/components/sessions/roomUi";
import { roleTensionsUrl, TENSION_COPY, TENSION_LIMITS, TENSION_REFUSALS } from "@shared/roleTensions";

/** The server's own sentence when it sent one, or the plain fallback. */
const refusalOf = (body: unknown): string => {
  const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error.trim() : "";
  return said && /\s/.test(said) ? said : TENSION_COPY.sendFailed;
};

export default function RaiseTension({ roleId, roleName }: { roleId: string; roleName: string }) {
  const { user } = useAuth();
  const [mayRaise, setMayRaise] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();
  const boxId = `${ids}-box`;
  const privacyId = `${ids}-privacy`;
  const hintId = `${ids}-hint`;
  const signedIn = !!user;

  useEffect(() => {
    if (!signedIn) {
      setMayRaise(false);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const res = await gameFetch(roleTensionsUrl(roleId), { cache: "no-store" });
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (live) setMayRaise(!!body && (body as { mayRaise?: unknown }).mayRaise === true);
      } catch {
        if (live) setMayRaise(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [roleId, signedIn]);

  if (!signedIn || !mayRaise) return null;

  const left = TENSION_LIMITS.text - text.length;
  const send = async () => {
    if (busy) return;
    if (!text.trim()) {
      setError(TENSION_REFUSALS.textEmpty);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await gameFetch(roleTensionsUrl(roleId), { method: "POST", body: JSON.stringify({ text }) });
      const reply = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(TENSION_COPY.sent);
        setText("");
        setOpen(false);
      } else setError(refusalOf(reply));
    } catch {
      setError(TENSION_COPY.sendFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-4 border-t border-border space-y-3" data-raise-tension={roleId}>
      {!open ? (
        <button type="button" className={BTN_SECONDARY} aria-label={`${TENSION_COPY.raise}: ${roleName}`} onClick={() => setOpen(true)}>
          {TENSION_COPY.raise}
        </button>
      ) : (
        <div className="space-y-3">
          <p id={privacyId} className="text-sm font-semibold text-foreground">
            {TENSION_COPY.privacy}
          </p>
          <div>
            <label htmlFor={boxId} className={LABEL}>
              {TENSION_COPY.label}
            </label>
            <p id={hintId} className={`${HINT} mt-0.5`}>
              {TENSION_COPY.hint}
            </p>
            <textarea
              id={boxId}
              rows={4}
              value={text}
              maxLength={TENSION_LIMITS.text}
              aria-describedby={`${privacyId} ${hintId}`}
              onChange={(e) => setText(e.target.value)}
              className={`${TEXTBOX} mt-2`}
              autoFocus
            />
            <p className={`${COUNTER} mt-1`}>
              {TENSION_COPY.count(left)}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void send()}>
              {TENSION_COPY.send}
            </button>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setOpen(false)}>
              {TENSION_COPY.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
