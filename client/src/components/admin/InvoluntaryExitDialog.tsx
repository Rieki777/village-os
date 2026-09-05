/**
 * The form a steward fills in to open an involuntary exit.
 *
 * WHAT IT REPLACES. `window.prompt("Involuntary exits follow the published
 * process. Note for the record:")`. A browser prompt, with the site's domain
 * printed above it, for the heaviest act this software supports. It asked one
 * unlabelled question, it could not explain itself, it could not be styled or
 * translated, and a steward who pressed Enter by reflex opened a departure
 * against a real person with an empty note.
 *
 * WHY THE QUESTIONS COME FROM THE POLICY. The grounds a village recognises
 * for asking somebody to leave are a community decision, and they live in
 * `involuntary.grounds` on the published exit policy where a founder can edit
 * them. This component renders whatever that list holds. See
 * server/lib/exitPolicy.ts for why they are not compiled in.
 *
 * WHY THREE ANSWERS AND NOT A CHECKBOX. A checkbox cannot tell "no" apart
 * from "not answered", and on this form that difference is the whole record.
 * "Has a non-violent dispute resolution process been attempted?" left blank
 * reads as an accusation nobody made; answered "no" it is a fact a steward
 * put their name to. Every question therefore starts UNANSWERED and has to be
 * chosen.
 *
 * WHY IT USES THE SHARED DIALOG. `@/components/ui/dialog` wraps Radix, which
 * traps Tab inside the dialog, closes on Escape, hides the rest of the page
 * from assistive technology and returns focus to whatever opened it. Five
 * overlays in this client are hand-rolled `fixed inset-0` divs instead, and
 * most of them do none of that; this is not going to be a sixth.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Unanswered is a real state and stays distinct from "no" all the way to the
 * record.
 *
 * WHICH IS WHY THESE ARE TOGGLES AND NOT RADIOS. They carried `role="radio"`
 * inside a `role="radiogroup"`, and that made two promises the code did not
 * keep. A radio is idempotent, so clicking the chosen one should do nothing;
 * here it cleared the answer, which meant a steward re-clicking "Yes" to
 * reassure themselves silently deleted that question from the record. And a
 * radiogroup promises arrow-key navigation with a roving tabindex, which a
 * screen reader announces ("1 of 3") and which was not implemented, so the
 * one interaction the announcement named did nothing.
 *
 * A group of toggles says what this actually is: three buttons, at most one
 * pressed, and pressing the pressed one turns it off. That is the behaviour
 * that was built, it keeps "unanswered" reachable by mouse and keyboard
 * alike, each button is tabbable on its own, and it promises no keyboard
 * contract that is not there.
 */
export type GroundAnswer = "yes" | "no" | "n/a" | "";

const ANSWERS: Array<{ value: Exclude<GroundAnswer, "">; label: string }> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "n/a", label: "Does not apply" },
];

/**
 * The note that goes on the exit record, built from the answers.
 *
 * ONE FREE TEXT COLUMN IS ALL THERE IS, and that is deliberate rather than a
 * shortcut. Migrations here are numbered across every worktree and branch in
 * the programme, they apply at boot on thirteen live instances, and a bad one
 * is a village that cannot start. Composing into the existing column needs no
 * schema change, and the Departure record in Admin renders it, which is the
 * only screen anywhere that shows it. The member's own notification does NOT
 * carry it: that body is fixed copy pointing at the published exit policy.
 *
 * THE ANSWERS ARE PROTECTED FROM THE CLIP, and they had to be. `createExit`
 * stores `note.slice(0, 2000)`, and the answers are composed LAST, so a
 * steward who wrote a long account of what happened would have had precisely
 * the structured part silently truncated away. The record would keep the
 * prose and lose the line saying whether a non-violent process was attempted,
 * which is the part a reviewer needs most. The answers are measured first and
 * the reason is given whatever room remains, marked where it was cut so
 * nobody reads a clipped account as a complete one.
 *
 * Exported so the test can assert the exact record a given set of answers
 * produces, rather than asserting that a request was sent.
 */
/** Mirrors the column clip in server/lib/exit.ts. */
const NOTE_LIMIT = 2000;

export function composeExitNote(reason: string, grounds: string[], answers: GroundAnswer[]): string {
  const answered = grounds
    .map((q, i) => ({ q, a: answers[i] ?? "" }))
    .filter((x) => x.a !== "");
  const tail = answered.length
    ? "\n\n" + answered
        .map(({ q, a }) => `${q} ${a === "yes" ? "Yes" : a === "no" ? "No" : "Does not apply"}`)
        .join("\n")
    : "";

  const CUT = " (clipped)";
  let head = String(reason ?? "").trim();
  const room = NOTE_LIMIT - tail.length;
  if (head.length > room) head = head.slice(0, Math.max(0, room - CUT.length)).trimEnd() + CUT;

  return (head + tail).trim();
}

export default function InvoluntaryExitDialog({
  open,
  memberName,
  grounds,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  memberName: string;
  /** `involuntary.grounds` from the published policy. May be empty. */
  grounds: string[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [answers, setAnswers] = useState<GroundAnswer[]>([]);

  const answerFor = (i: number): GroundAnswer => answers[i] ?? "";
  const setAnswer = (i: number, v: GroundAnswer) =>
    setAnswers((prev) => {
      const next = [...prev];
      while (next.length < grounds.length) next.push("");
      next[i] = v;
      return next;
    });

  const reasonGiven = reason.trim().length > 0;

  /*
   * The form clears when the dialog CLOSES, not when it is submitted.
   *
   * An effect on `open` is the only place that catches every path: cancel,
   * Escape and the overlay all run through Radix's onOpenChange, but the
   * PARENT closing the dialog after a save that landed does not, because it
   * sets `open` directly. Resetting in the click handler instead is what
   * threw the steward's work away on a refusal.
   */
  useEffect(() => {
    if (!open) { setReason(""); setAnswers([]); }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onCancel(); }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ask {memberName || "this member"} to leave</DialogTitle>
          <DialogDescription>
            This opens a departure against a person and notifies them. It follows the
            exit process your village has published, and everything recorded here goes
            on the record for whoever reviews it later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <label htmlFor="involuntary-exit-reason" className="text-sm font-medium text-foreground block mb-1">
              What is the reason for requesting the removal of this member?
            </label>
            <textarea
              id="involuntary-exit-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="In your own words, for the record."
              className="w-full px-3 py-2 text-sm border border-border rounded-lg resize-y bg-background"
            />
            {!reasonGiven && (
              <p className="text-xs text-muted-foreground mt-1">
                A reason is required. The person being asked to leave is entitled to one.
              </p>
            )}
          </div>

          {grounds.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">
                About this departure
              </p>
              <div className="space-y-3">
                {grounds.map((q, i) => (
                  <div key={q} className="flex flex-wrap items-center justify-between gap-2">
                    <span id={`ground-${i}`} className="text-sm text-muted-foreground flex-1 min-w-[14rem]">{q}</span>
                    <div role="group" aria-labelledby={`ground-${i}`} className="flex gap-1.5">
                      {ANSWERS.map((a) => {
                        const chosen = answerFor(i) === a.value;
                        return (
                          <button
                            key={a.value}
                            type="button"
                            aria-pressed={chosen}
                            onClick={() => setAnswer(i, chosen ? "" : a.value)}
                            className={
                              "text-xs rounded-full px-3 py-1 border transition-colors " +
                              (chosen
                                ? "bg-teal-deep text-white border-teal-deep"
                                : "bg-background text-muted-foreground border-border hover:border-teal-deep")
                            }
                          >
                            {a.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Leave a question unanswered and it stays off the record. An answer of no is
                a different thing from a question nobody answered, so neither is assumed.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm rounded-lg px-4 py-2 border border-border text-muted-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!reasonGiven || busy}
            /*
             * NO reset() HERE, and that is not tidiness.
             *
             * `onConfirm` is asynchronous and the parent keeps this dialog
             * OPEN when the server refuses, so clearing the form on the way
             * out threw away the steward's work in exactly the situation
             * where they most need it back. POST /api/admin/exits has several
             * live refusals: the member is a seeded example identity, the
             * departure would strand the last account that can administer the
             * village, an exit is already open for them, or the request never
             * arrived. In every one of those the steward was left looking at
             * an empty form with the confirm button disabled, having lost a
             * paragraph of reasoning and four answers about a person, with
             * nothing to do but write it all again from memory.
             *
             * The form clears when the dialog CLOSES, which happens on
             * cancel, on Escape, on the overlay, and on the parent closing it
             * after a save that actually landed.
             */
            onClick={() => onConfirm(composeExitNote(reason, grounds, answers))}
            className="text-sm rounded-lg px-4 py-2 font-medium bg-red-600 text-white disabled:opacity-40"
          >
            {busy ? "Opening…" : "Open involuntary exit"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
