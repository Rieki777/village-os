/**
 * The guide: a conversation beside the page, a sheet from the bottom on a
 * phone and a panel on the right on a desk.
 *
 * It reflects back and never speaks for the member. A follow-up question it
 * offers becomes a question in the sitting only when tapped, and its
 * distilled reflection is kept only when the member says "yes, that is it",
 * or after they have corrected it in their own words.
 *
 * When the server has no model to ask, it answers 503 and the panel says so
 * in one calm line. Nothing about saving depends on it.
 */
import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { JOURNAL_REFLECTION_MAX, type GuideMessage, type GuideReply, type GuideRequest } from "@shared/journal";
import { askGuide, isAssistantUnavailable, problemText } from "@/lib/journalApi";
import GrowingTextarea from "./GrowingTextarea";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT } from "./ui";

export const GUIDE_RESTING = "The guide is resting. Your journal works without it.";

export default function GuidePanel({
  open,
  onClose,
  request,
  messages,
  onMessages,
  onAddQuestion,
  onConfirmReflection,
}: {
  open: boolean;
  onClose: () => void;
  /** Everything the guide needs except the conversation, read at send time. */
  request: () => Omit<GuideRequest, "messages">;
  messages: GuideMessage[];
  onMessages: (next: GuideMessage[]) => void;
  onAddQuestion: (prompt: string) => void;
  onConfirmReflection: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [latest, setLatest] = useState<GuideReply | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const inputId = "journal-guide-input";
  const panelRef = useRef<HTMLDivElement>(null);

  // Opening puts the cursor in the box; Escape closes.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => document.getElementById(inputId)?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const ask = async (text: string) => {
    const said = text.trim();
    if (!said || busy) return;
    const turn: GuideMessage = { role: "user", content: said };
    setBusy(true);
    setProblem(null);
    try {
      const reply = await askGuide({ ...request(), messages: [...messages, turn] });
      onMessages([...messages, turn, { role: "assistant", content: reply.reply }]);
      setLatest(reply);
      setEditing(null);
      setKept(false);
      setDraft("");
    } catch (err) {
      // The typed words stay in the box, so nothing is lost by asking.
      setProblem(
        isAssistantUnavailable(err)
          ? GUIDE_RESTING
          : problemText(err, "The guide could not answer just now. Your journal works without it."),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = (text: string) => {
    const clean = text.trim().slice(0, JOURNAL_REFLECTION_MAX);
    if (!clean) return;
    onConfirmReflection(clean);
    setEditing(null);
    setKept(true);
  };

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-[69] bg-black/30 md:hidden" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="The guide"
        data-scroll-contain
        className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-card text-card-foreground shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:border-l md:border-t-0"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="font-display text-lg font-bold text-foreground">The guide</h2>
          <button type="button" onClick={onClose} className={BTN_QUIET} aria-label="Close the guide">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
          {messages.length === 0 && (
            <p className={HINT}>
              Ask anything about what you have written, or let the guide reflect it back to you. It asks; it never
              answers for you.
            </p>
          )}
          {messages.map((m, i) => (
            <p
              key={i}
              className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                m.role === "user" ? "ml-8 bg-teal-deep/10 text-foreground" : "mr-8 bg-muted text-foreground"
              }`}
            >
              <span className="sr-only">{m.role === "user" ? "You said: " : "The guide said: "}</span>
              {m.content}
            </p>
          ))}

          {latest?.nextQuestion && (
            <button
              type="button"
              className="block min-h-11 w-full rounded-xl border border-teal-deep/50 bg-card px-3 py-2 text-left text-sm font-medium text-teal-deep hover:bg-teal-deep/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
              onClick={() => {
                onAddQuestion(latest.nextQuestion);
                setLatest({ ...latest, nextQuestion: "" });
              }}
            >
              Add this question to my page: {latest.nextQuestion}
            </button>
          )}

          {latest?.reflection && !kept && (
            <div className="rounded-xl border border-sage/40 bg-sage-light/40 p-3">
              <p className="text-xs font-semibold text-sage">What I heard</p>
              {editing === null ? (
                <>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{latest.reflection}</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">Did I get that right?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={BTN_PRIMARY} onClick={() => confirm(latest.reflection)}>
                      Yes
                    </button>
                    <button type="button" className={BTN_SECONDARY} onClick={() => setEditing(latest.reflection)}>
                      Not quite
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label htmlFor="journal-guide-reflection" className="mt-1 block text-sm text-foreground">
                    Say it your way
                  </label>
                  <div className="mt-1">
                    <GrowingTextarea
                      id="journal-guide-reflection"
                      value={editing}
                      onValue={setEditing}
                      minRows={3}
                      maxLength={JOURNAL_REFLECTION_MAX}
                    />
                  </div>
                  <button type="button" className={`${BTN_PRIMARY} mt-2`} onClick={() => confirm(editing)} disabled={!editing.trim()}>
                    Keep this version
                  </button>
                </>
              )}
            </div>
          )}
          {kept && <p role="status" className="text-sm text-open">Kept as your reflection. You can change it when you read the page back.</p>}

          {problem && (
            <p role="status" className="rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
              {problem}
            </p>
          )}
        </div>

        <form
          className="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Your message to the guide
          </label>
          <GrowingTextarea id={inputId} value={draft} onValue={setDraft} minRows={2} maxLength={2000} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" className={BTN_PRIMARY} disabled={busy || !draft.trim()}>
              <Send className="h-4 w-4" aria-hidden="true" />
              {busy ? "Asking..." : "Ask"}
            </button>
            {messages.length === 0 && (
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={() => void ask("Reflect back what I have written so far.")}
              >
                Reflect this back to me
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
