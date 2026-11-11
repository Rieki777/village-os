/**
 * "Complete your draft": the unfinished proposals waiting for their author.
 *
 * Hypha renders these at the top of the type step as dashed-border cards with
 * a category chip, a title, "Last edited on <date>", and Continue / Delete
 * (harvest section 1, `proposal-draft.vue`). Same card, one real difference:
 * theirs come out of localStorage and ours come out of the database, so this
 * list is the same on the phone as it was on the laptop that typed it.
 *
 * The title is guessed from the payload rather than stored, because the wizard
 * autosaves from the first step and a draft with no title yet is the normal
 * case. "Untitled" is honest, and the type chip carries enough meaning that a
 * member recognises their own work without one.
 */
import { FileEdit, Trash2 } from "lucide-react";
import { typeConfig, type WizardType } from "./wizardConfig";
import { walkFor } from "./wizardWalk";
import type { ProposalDraft } from "./governanceApi";

/** The best name this draft has, from whichever field carries one. */
export function draftTitle(draft: ProposalDraft): string {
  const p = draft.payload ?? {};
  for (const key of ["title", "deliverables", "reason", "fitStatement", "body"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) {
      const line = v.trim().split("\n")[0];
      return line.length > 70 ? `${line.slice(0, 70)}…` : line;
    }
  }
  return "Untitled";
}

export default function DraftCards({
  drafts,
  busyId,
  onContinue,
  onDiscard,
}: {
  drafts: ProposalDraft[];
  busyId: string | null;
  onContinue: (draft: ProposalDraft) => void;
  onDiscard: (draft: ProposalDraft) => void;
}) {
  if (drafts.length === 0) return null;

  return (
    <section>
      <h2 className="text-base font-bold text-foreground">Pick up where you left off</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {drafts.length === 1 ? "One proposal is" : `${drafts.length} proposals are`} half written. They are yours alone
        until you publish.
      </p>
      <ul className="mt-3 space-y-2">
        {drafts.map((d) => {
          const cfg = typeConfig(d.wizardType);
          const walk = walkFor(d.wizardType);
          const at = Math.min(Math.max(0, d.stepIndex), walk.length - 1);
          return (
            <li
              key={d.id}
              className="rounded-xl border-2 border-dashed border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
                  {cfg?.title ?? d.wizardType}
                </span>
                <span className="text-xs text-muted-foreground">
                  Last edited{" "}
                  {new Date(d.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-foreground">{draftTitle(d)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You stopped at {walk[at]?.label ?? "the beginning"}, step {at + 1} of {walk.length}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === d.id}
                  onClick={() => onContinue(d)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-notice px-4 text-sm font-semibold text-background hover:bg-notice/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                >
                  <FileEdit className="w-4 h-4" aria-hidden="true" />
                  Continue
                </button>
                <button
                  type="button"
                  disabled={busyId === d.id}
                  onClick={() => onDiscard(d)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  Discard
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
