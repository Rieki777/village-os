/**
 * DISCARD A SESSION, OR DELETE A RECORD: one quiet control and the confirm it
 * opens. Both go through the same door, DELETE /api/sessions/:id, and both are
 * a real delete, so the confirm says plainly what goes and for whom.
 *
 *   "discard"  an open room, for its facilitator (in the bar's own row) and
 *              for an admin (in the admin's strip). Never beside the forward
 *              button: the gold step and this are never one tap apart.
 *   "delete"   a closed record, for admins only, at the foot of the record.
 *
 * THE CONFIRM IS AN ALERT DIALOG (components/ui/alert-dialog). It opens with
 * focus on "Keep it", so Enter on a dialog opened by mistake keeps the
 * session, and it gives focus back to the control when it closes.
 *
 * IT SAYS NOTHING IS GONE UNTIL THE SERVER SAID SO. The yes is a plain button,
 * not the dialog's own action, so pressing it never closes the dialog by
 * itself. While the delete is out the dialog holds open, reads "Discarding...",
 * and cannot be dismissed. A refusal shows the server's own sentence inside
 * the dialog and changes nothing on screen. Only a yes calls `onGone`, which
 * takes the page to the list.
 */
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { SESSION_DISCARD_COPY as C } from "@shared/sessions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BTN_DANGER, BTN_DANGER_QUIET, BTN_SECONDARY } from "./roomUi";

/** What the door answered, in the shape every room write hands back. */
export type DiscardAnswer = { ok: true } | { ok: false; error: string };

const WORDS = {
  discard: { button: C.discardButton, title: C.discardTitle, body: C.discardBody, keep: C.keep, yes: C.discard, busy: C.discarding },
  delete: { button: C.deleteButton, title: C.deleteTitle, body: C.deleteBody, keep: C.keepRecord, yes: C.delete, busy: C.deleting },
} as const;

export default function DiscardSession({
  kind,
  onConfirm,
  onGone,
}: {
  kind: "discard" | "delete";
  /** Send the delete and hand back the server's answer. */
  onConfirm: () => Promise<DiscardAnswer>;
  /** The server said yes: leave for the list. */
  onGone: () => void;
}) {
  const w = WORDS[kind];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const out = useRef(false);

  const confirm = async () => {
    if (out.current) return;
    out.current = true;
    setBusy(true);
    setError(null);
    let answer: DiscardAnswer;
    try {
      answer = await onConfirm();
    } catch {
      answer = { ok: false, error: C.failed };
    }
    out.current = false;
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      onGone();
      return;
    }
    setError(answer.error || C.failed);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Nothing dismisses the dialog while the delete is out.
        if (busy) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <button type="button" className={BTN_DANGER_QUIET} data-discard={kind}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {w.button}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl font-normal text-foreground">{w.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-base text-foreground">{w.body}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className={BTN_SECONDARY} disabled={busy}>
            {w.keep}
          </AlertDialogCancel>
          <button type="button" className={BTN_DANGER} disabled={busy} aria-busy={busy} onClick={() => void confirm()}>
            {busy ? w.busy : w.yes}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
