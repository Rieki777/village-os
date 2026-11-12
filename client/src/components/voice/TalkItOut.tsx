/**
 * TALK IT OUT, beside one long text box (VoiceArea.tsx; the route is
 * server/routes/fieldGuide.ts). A short conversation with the member's own
 * guide, Maia or Sera, that ends in a draft in their voice. "Use this"
 * replaces the box's words and "Add to mine" adds the draft after them;
 * nothing reaches the box until one is pressed, and the form is still the
 * member's to send. The guide picker sits on top, so the member always sees
 * who is answering and can switch.
 */
import { useState, type FormEvent } from "react";
import { Send, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { FieldGuideAnswer } from "@shared/fieldGuide";
import MicButton from "@/components/MicButton";
import { appendSpoken } from "@/components/journal/GrowingTextarea";
import MyGuide, { useGuideState } from "@/components/guide/MyGuide";
import { gameFetch } from "@/lib/gameApi";
import type { TalkTarget } from "./VoiceArea";
import BreathingLoader from "@/components/natural/BreathingLoader";

type Line = { role: "user" | "assistant"; content: string };

export default function TalkItOut({
  target,
  current,
  onUse,
  onAdd,
  onClose,
}: {
  target: TalkTarget;
  current: string;
  onUse: (draft: string) => void;
  onAdd: (draft: string) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [guide, setGuide] = useGuideState();
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [offer, setOffer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [used, setUsed] = useState(false);
  const answering = guide?.options.find((o) => o.id === guide.answering)?.name ?? t({ message: "your guide", context: "talk it out: the guide, unnamed" });

  const send = async (e?: FormEvent, said?: string) => {
    e?.preventDefault();
    const words = (said ?? draft).trim();
    if (!words || busy) return;
    const next: Line[] = [...lines, { role: "user", content: words }];
    setLines(next);
    setDraft("");
    setBusy(true);
    setProblem(null);
    try {
      const res = await gameFetch("/api/guide/field", {
        method: "POST",
        body: JSON.stringify({ field: target, text: current, messages: next.slice(-20) }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<FieldGuideAnswer> & { error?: string };
      if (!res.ok || typeof data.reply !== "string") {
        setProblem(data.error || t({ message: "The guide could not answer just now. Your words are safe in the box.", context: "talk it out: failure" }));
        return;
      }
      setLines([...next, { role: "assistant", content: data.reply }]);
      if (data.draft) {
        setOffer(data.draft);
        setUsed(false);
      }
    } catch {
      setProblem(t({ message: "That did not reach the village. Check your connection and try again.", context: "talk it out: offline" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="talk-it-out"
      aria-label={t({ message: `Talk it out: ${target.label}`, context: "talk it out panel" })}
      className="space-y-3 rounded-xl border border-border bg-card p-3 text-sm text-card-foreground"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <MyGuide state={guide} onChange={setGuide} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t({ message: "Close", context: "talk it out: closes the panel" })}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {lines.length === 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            {t({ message: `Say what you want this to say, the way you'd say it to a friend. ${answering} asks a question or two and offers a draft you can use or ignore.`, context: "talk it out: intro" })}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(undefined, current.trim() ? t({ message: "Help me make what I've written clearer.", context: "talk it out: quick start with words in the box" }) : t({ message: "Help me start this.", context: "talk it out: quick start with an empty box" }))}
            className="inline-flex min-h-11 items-center rounded-full border border-border px-3 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {current.trim()
              ? t({ message: "Help me make it clearer", context: "talk it out: quick start button" })
              : t({ message: "Help me start", context: "talk it out: quick start button" })}
          </button>
        </div>
      )}

      <div className="space-y-2" aria-live="polite">
        {lines.map((l, i) => (
          <p key={i} className={`whitespace-pre-wrap rounded-xl px-3 py-2 ${l.role === "user" ? "ml-8 bg-muted text-foreground" : "mr-8 border border-border text-foreground"}`}>
            {l.content}
          </p>
        ))}
        {busy && (
          <p className="flex items-center text-muted-foreground">
            <BreathingLoader decorative size={16} className="mr-2" />
            {t({ message: `${answering} is thinking`, context: "talk it out: waiting" })}
          </p>
        )}
        {problem && <p role="alert" className="text-destructive">{problem}</p>}
      </div>

      {offer && (
        <div data-testid="talk-it-out-draft" className="space-y-2 rounded-xl border border-border bg-muted p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t({ message: "A draft for the box", context: "talk it out: draft heading" })}</p>
          <p className="whitespace-pre-wrap text-foreground">{offer}</p>
          {used ? (
            <p role="status" className="font-medium text-open">{t({ message: "In the box. Change anything you like before you send.", context: "talk it out: draft used" })}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { onUse(offer); setUsed(true); }}
                className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t({ message: "Use this", context: "talk it out: replaces the box's words with the draft" })}
              </button>
              {current.trim() && (
                <button
                  type="button"
                  onClick={() => { onAdd(offer); setUsed(true); }}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t({ message: "Add to mine", context: "talk it out: adds the draft after the box's words" })}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <form onSubmit={send} className="flex items-end gap-2">
        <label className="sr-only" htmlFor={`talk-${target.label}`}>
          {t({ message: "Your words to the guide", context: "talk it out: input label" })}
        </label>
        <textarea
          id={`talk-${target.label}`}
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <MicButton onText={(chunk) => setDraft((d) => appendSpoken(d, chunk))} disabled={busy} />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label={t({ message: "Send", context: "talk it out: sends your words" })}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
