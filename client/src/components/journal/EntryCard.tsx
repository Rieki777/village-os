/**
 * One entry in the history: its practice, its time and the start of its first
 * answer, opening to everything written and the confirmed reflection. A
 * synced entry can be edited or forgotten; one still waiting on this device
 * says so and waits.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  JOURNAL_ANSWER_MAX,
  JOURNAL_PRACTICE_DEFS,
  JOURNAL_DEFAULT_PRIVACY,
  JOURNAL_REFLECTION_MAX,
  PULSE_METRICS,
  sharesWithMemory,
  type JournalAnswer,
  type JournalEntry,
  type JournalEntryInput,
} from "@shared/journal";
import { deleteEntry, patchEntry, problemText } from "@/lib/journalApi";
import GrowingTextarea from "./GrowingTextarea";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, metricName, signed, timeLabel } from "./ui";

/** An entry as the history shows it, synced or still on the device. */
export type HistoryItem =
  | { kind: "synced"; entry: JournalEntry }
  | { kind: "pending"; entry: JournalEntryInput; lastError: string | null };

const PREVIEW = 140;

function preview(answers: JournalAnswer[]): string {
  const first = answers.find((a) => a.text.trim())?.text.trim() ?? "";
  return first.length > PREVIEW ? `${first.slice(0, PREVIEW).trimEnd()}...` : first;
}

export default function EntryCard({
  item,
  onChanged,
  onDeleted,
}: {
  item: HistoryItem;
  onChanged: (e: JournalEntry) => void;
  onDeleted: (id: string) => void;
}) {
  const e = item.entry;
  const synced = item.kind === "synced" ? item.entry : null;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ answers: JournalAnswer[]; reflection: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reflection = synced ? synced.reflection : (e.reflection ?? null);
  const scores = e.scores ?? null;
  const bodyId = `entry-${e.clientId}`;
  // A page still on the device carries what the member chose on the review
  // step; one from before the choice existed is the shared default.
  const privacy = e.privacy ?? JOURNAL_DEFAULT_PRIVACY;
  const isPrivate = !sharesWithMemory(privacy);

  /** Keep it in the village, or share it again. Ruling 2026-10-05. */
  const setPrivate = async (keep: boolean) => {
    if (!synced) return;
    setBusy(true);
    setProblem(null);
    const next = keep ? "private" : JOURNAL_DEFAULT_PRIVACY;
    try {
      const back = await patchEntry(synced.id, { privacy: next });
      onChanged(back ?? { ...synced, privacy: next });
    } catch (err) {
      setProblem(problemText(err, "That change did not save. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!synced || !editing) return;
    setBusy(true);
    setProblem(null);
    const answers = editing.answers.map((a) => ({ ...a, text: a.text.slice(0, JOURNAL_ANSWER_MAX) }));
    const nextReflection = editing.reflection.trim() ? editing.reflection.trim().slice(0, JOURNAL_REFLECTION_MAX) : null;
    try {
      const back = await patchEntry(synced.id, { answers, reflection: nextReflection });
      onChanged(back ?? { ...synced, answers, reflection: nextReflection });
      setEditing(null);
    } catch (err) {
      setProblem(problemText(err, "That change did not save. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (!synced) return;
    setBusy(true);
    setProblem(null);
    try {
      await deleteEntry(synced.id);
      onDeleted(synced.id);
    } catch (err) {
      setProblem(problemText(err, "It could not be forgotten just now. Try again in a moment."));
      setBusy(false);
    }
  };

  return (
    <li className={CARD}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-start justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{JOURNAL_PRACTICE_DEFS[e.practice].label}</span>
            <span className="text-sm text-muted-foreground">{timeLabel(e.writtenAt)}</span>
            {item.kind === "pending" && (
              <span className="rounded-full bg-amber-light px-2 py-0.5 text-xs font-semibold text-amber-ink">
                Saved on this device
              </span>
            )}
            {isPrivate && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">Private</span>
            )}
          </span>
          {preview(e.answers) && <span className="mt-1 block text-sm text-muted-foreground">{preview(e.answers)}</span>}
        </span>
        {open ? (
          <ChevronUp className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="sr-only">{open ? "Hide this entry" : "Show this entry"}</span>
      </button>

      {open && (
        <div id={bodyId} className="mt-4 space-y-4 border-t border-border pt-4">
          {scores && Object.keys(scores).length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {PULSE_METRICS.filter((m) => typeof scores[m.key] === "number").map((m) => (
                <li key={m.key} className="rounded-lg bg-muted px-2.5 py-1 text-sm text-foreground">
                  {metricName(m.key)}: <span className="font-semibold">{signed(scores[m.key]!, m.min < 0)}</span>
                </li>
              ))}
            </ul>
          )}

          {e.meta?.call && <p className="text-sm text-muted-foreground">Call: {e.meta.call}</p>}

          {editing ? (
            <div className="space-y-3">
              {editing.answers.map((a, i) => (
                <div key={`${a.questionKey}-${i}`}>
                  <label htmlFor={`${bodyId}-a${i}`} className="block text-sm font-semibold text-foreground">
                    {a.prompt}
                  </label>
                  <div className="mt-1">
                    <GrowingTextarea
                      id={`${bodyId}-a${i}`}
                      value={a.text}
                      minRows={2}
                      maxLength={JOURNAL_ANSWER_MAX}
                      onValue={(t) =>
                        setEditing({ ...editing, answers: editing.answers.map((x, j) => (j === i ? { ...x, text: t } : x)) })
                      }
                    />
                  </div>
                </div>
              ))}
              <div>
                <label htmlFor={`${bodyId}-r`} className="block text-sm font-semibold text-foreground">
                  Reflection (optional)
                </label>
                <div className="mt-1">
                  <GrowingTextarea
                    id={`${bodyId}-r`}
                    value={editing.reflection}
                    minRows={2}
                    mic={false}
                    maxLength={JOURNAL_REFLECTION_MAX}
                    onValue={(t) => setEditing({ ...editing, reflection: t })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_PRIMARY} onClick={() => void saveEdit()} disabled={busy}>
                  {busy ? "Saving..." : "Save changes"}
                </button>
                <button type="button" className={BTN_SECONDARY} onClick={() => setEditing(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <dl className="space-y-3">
                {e.answers.map((a, i) => (
                  <div key={`${a.questionKey}-${i}`}>
                    <dt className="text-sm font-semibold text-foreground">{a.prompt}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{a.text}</dd>
                  </div>
                ))}
              </dl>
              {reflection && (
                <div className="rounded-xl border border-sage/40 bg-sage-light/40 p-3">
                  <p className="text-xs font-semibold text-sage">Your confirmed reflection</p>
                  <p className="mt-1 whitespace-pre-wrap text-foreground">{reflection}</p>
                </div>
              )}
              {item.kind === "pending" && item.lastError && (
                <p className="text-sm text-muted-foreground">Last try: {item.lastError}</p>
              )}
              {synced && !confirmDelete && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={() => setEditing({ answers: synced.answers.map((a) => ({ ...a })), reflection: synced.reflection ?? "" })}
                  >
                    Edit
                  </button>
                  <button type="button" className={BTN_QUIET} onClick={() => void setPrivate(!isPrivate)} disabled={busy}>
                    {isPrivate ? "Share it with organisational memory" : "Keep it private"}
                  </button>
                  <button type="button" className={BTN_QUIET} onClick={() => setConfirmDelete(true)}>
                    Forget this entry
                  </button>
                </div>
              )}
              {synced && (
                <p className="text-xs text-muted-foreground">
                  {isPrivate
                    ? "Private: it stays in this village, for you alone."
                    : "Shared with the village's organisational memory when that is connected, under code-names."}
                </p>
              )}
              {synced && confirmDelete && (
                <div role="group" aria-label="Confirm forgetting this entry" className="rounded-xl bg-destructive/10 p-3">
                  <p className="text-sm font-semibold text-destructive">Forget this entry for good? It cannot be brought back.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center rounded-xl bg-destructive px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 disabled:opacity-50"
                      onClick={() => void forget()}
                      disabled={busy}
                    >
                      {busy ? "Forgetting..." : "Yes, forget it"}
                    </button>
                    <button type="button" className={BTN_SECONDARY} onClick={() => setConfirmDelete(false)} disabled={busy}>
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
