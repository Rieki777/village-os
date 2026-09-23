// The guided proposal conversation (Maia). One component, two entry points:
// an offer to work with the village, and a self-proposed quest. Both talk to
// /api/assistant/proposal with a `kind`, so the two flows stay in step.
import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, CheckCircle2, ArrowRight, Send } from "lucide-react";
import { submitProposal, ProposalKind } from "@/lib/proposals";
import MicButton from "@/components/MicButton";

interface ChatMsg { role: "user" | "assistant"; content: string }

export default function GuideChat({
  kind,
  projectName,
  assistantName,
  greeting,
  empty,
  onSubmitted,
  onFallback,
  onRefineInForm,
  refineLabel = "Review in the form",
}: {
  kind: ProposalKind;
  projectName: string;
  assistantName: string;
  greeting?: string;
  empty: Record<string, any>;
  onSubmitted: () => void;
  onFallback: () => void;
  onRefineInForm: (p: Record<string, any>) => void;
  refineLabel?: string;
}) {
  const defaultGreeting =
    kind === "quest-proposal"
      ? `Hi, I'm ${assistantName}. So you've got a quest in mind that isn't on the board yet. I'd love to hear it. What do you want to bring to ${projectName}?`
      : `Hi, I'm ${assistantName}. I help people shape their offering to ${projectName}. There's no wrong way to start. What are you dreaming of bringing?`;

  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content: greeting ? greeting.replace(/\{name\}/g, assistantName) : defaultGreeting,
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [proposal, setProposal] = useState<Record<string, any> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setThinking(true);
    try {
      const res = await fetch("/api/assistant/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, messages: next }),
      });
      if (res.status === 503) { onFallback(); return; }
      const data = await res.json();
      if (!res.ok) {
        setMessages([...next, { role: "assistant", content: "I lost my thread for a moment. Could you say that again?" }]);
      } else {
        setMessages([...next, { role: "assistant", content: data.reply }]);
        if (data.complete && data.proposal) setProposal({ ...empty, ...data.proposal });
      }
    } catch {
      setMessages([...next, { role: "assistant", content: "Something interrupted us. Try sending that once more." }]);
    }
    setThinking(false);
  };

  const submit = async () => {
    if (!proposal) return;
    setSubmitting(true);
    const ok = await submitProposal(kind, proposal);
    setSubmitting(false);
    if (ok) {
      onSubmitted();
      return;
    }
    /*
     * A refused submission used to do nothing at all: the spinner stopped,
     * the Send button came back, and the proposal somebody had spent the
     * whole conversation shaping had not left the browser. The two sibling
     * forms both say a sentence here, and this one is where the work is
     * longest, so silence costs the most.
     *
     * It speaks in the transcript because that is where this component says
     * everything else, and the draft is still on screen underneath it.
     */
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          "That did not send, and your proposal is still here. Try the button again in a moment, or use the plain form instead.",
      },
    ]);
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-stone-100 bg-teal-deep/5">
        <div className="w-9 h-9 rounded-full bg-teal-deep text-white flex items-center justify-center">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <p className="font-semibold text-teal-deep leading-tight">{assistantName}</p>
          <p className="text-xs text-stone-600">Your {projectName} guide</p>
        </div>
      </div>

      <div ref={scrollRef} className="h-[420px] overflow-y-auto px-5 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === "user" ? "bg-teal-deep text-white" : "bg-stone-100 text-stone-700"
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="bg-stone-100 text-stone-600 rounded-2xl px-4 py-2.5 text-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> {assistantName} is thinking…
            </div>
          </div>
        )}

        {proposal && (
          <div className="bg-amber/10 border border-amber/30 rounded-2xl p-4 mt-2">
            <p className="font-semibold text-teal-deep mb-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Your proposal is ready
            </p>
            <p className="text-sm text-stone-600 mb-3">
              {assistantName} has captured everything. Review it, then send it to the {projectName} team.
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={submit} disabled={submitting} className="inline-flex items-center gap-2 bg-teal-deep text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-teal disabled:opacity-50">
                {submitting ? "Sending…" : "Submit proposal"} <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={() => onRefineInForm(proposal)} className="text-sm font-medium text-teal-deep px-4 py-2 rounded-xl border border-stone-200 hover:bg-stone-50">
                {refineLabel}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-stone-100 p-3 flex items-end gap-2">
        <MicButton onText={(t) => setInput((v) => (v ? v.replace(/\s*$/, " ") : "") + t)} disabled={thinking} />
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`Tell ${assistantName} about your idea…`}
          rows={1}
          className="flex-1 resize-none px-3 py-2 text-sm border border-stone-200 rounded-xl outline-none focus:border-teal-deep max-h-32"
        />
        <button onClick={send} aria-label="Send message" disabled={thinking || !input.trim()} className="shrink-0 w-10 h-10 rounded-xl bg-teal-deep text-white flex items-center justify-center hover:bg-teal disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
