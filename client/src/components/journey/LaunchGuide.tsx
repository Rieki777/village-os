/**
 * THE LAUNCH GUIDE, moved out of client/src/pages/JourneyToLaunch.tsx whole
 * (2026-09-26) so that page has room for the canvas. Nothing in it changed.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Loader2, Send } from "lucide-react";
import MicButton from "@/components/MicButton";
import { authToken } from "@/lib/gameApi";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/**
 * S65: the launch guide. Same brain as the Work With Us guide, different
 * hat: she reads the SAME live checklist this page renders and walks an
 * admin through what remains, item by item. Paths she mentions become
 * links. Absent an Anthropic key she simply isn't here — the checklist
 * carries the whole story on its own.
 */
export function LaunchGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Two hats, one panel. "launch" reads the live readiness checklist;
  // "organize" (S70) reads the village's own second brain first, then the
  // shipped practitioner corpus — and shows which shelves she consulted.
  const [mode, setMode] = useState<"launch" | "organize">("launch");
  const GREETINGS: Record<string, string> = {
    launch: "I can see exactly where your launch stands. Want to start with what's blocking, or shall I walk the whole journey with you?",
    organize: "Ask me about organizing: governance, conflict, membership, legal shells, internal economics. Your village's own calls outrank the books when they speak to it.",
  };
  const [threads, setThreads] = useState<Record<string, Array<{ role: "user" | "assistant"; content: string; consulted?: any }>>>({
    launch: [{ role: "assistant", content: GREETINGS.launch }],
    organize: [{ role: "assistant", content: GREETINGS.organize }],
  });
  const msgs = threads[mode];
  const setMsgs = (fn: (m: typeof msgs) => typeof msgs) =>
    setThreads((t) => ({ ...t, [mode]: fn(t[mode]) }));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  const send = () => {
    const content = draft.trim();
    if (!content || busy) return;
    const next = [...msgs, { role: "user" as const, content }];
    setMsgs(() => next);
    setDraft("");
    setBusy(true);
    fetch(mode === "launch" ? "/api/admin/assistant/launch" : "/api/admin/assistant/organize", {
      method: "POST", headers: headers(), body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (r.status === 503) { setGone(true); return; }
        if (!r.ok) throw new Error(d.message ?? d.error ?? "failed");
        setMsgs((m) => [...m, { role: "assistant", content: d.reply, consulted: d.consulted }]);
      })
      .catch(() => setMsgs((m) => [...m, { role: "assistant", content: "Something hiccuped. Ask me that again?" }]))
      .finally(() => setBusy(false));
  };

  // Turn any /admin?tab=… or /route path she mentions into a real link.
  const linkify = (text: string) =>
    text.split(/(\/(?:admin\?tab=[a-z-]+|[a-z-]+(?:\/[a-z-]+)*))(?=[\s.,)]|$)/g).map((part, i) =>
      part.startsWith("/") ? (
        <Link key={i} href={part} className="text-teal-deep font-medium underline">{part}</Link>
      ) : (
        <span key={i}>{part}</span>
      ),
    );

  if (!open) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] bg-white border border-stone-200 rounded-2xl shadow-2xl flex flex-col max-h-[70vh]">
      <header className="px-4 py-3 border-b border-stone-100 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button onClick={() => setMode("launch")}
            className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 ${mode === "launch" ? "bg-teal-deep text-white" : "text-stone-500 hover:bg-stone-100"}`}>
            Launch
          </button>
          <button onClick={() => setMode("organize")}
            className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 ${mode === "organize" ? "bg-teal-deep text-white" : "text-stone-500 hover:bg-stone-100"}`}>
            Organizing
          </button>
        </div>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-sm">Close</button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {gone ? (
          <p className="text-xs text-stone-500">
            The guide needs an Anthropic key. Set one in{" "}
            <Link href="/admin?tab=integrations" className="text-teal-deep underline">Integrations</Link>.
            The checklist above works fine without the guide.
          </p>
        ) : (
          msgs.map((m, i) => (
            <div key={i} className={`text-sm rounded-xl px-3 py-2 max-w-[85%] ${
              m.role === "user" ? "ml-auto bg-teal-deep text-white" : "bg-stone-100 text-stone-800"
            }`}>
              {m.role === "assistant" ? linkify(m.content) : m.content}
              {m.consulted
                && (m.consulted.ownRecord?.length > 0
                  || m.consulted.references?.length > 0
                  || m.consulted.readers?.length > 0) && (
                <p className="text-[10px] text-stone-400 mt-1.5 border-t border-stone-200 pt-1">
                  {m.consulted.ownRecord?.length > 0 && <>Your calls: {m.consulted.ownRecord.join("; ")}. </>}
                  {/* Optional-chained on purpose: a reply cached before the
                      readers shipped carries no `readers` key at all. */}
                  {m.consulted.readers?.length > 0 && <>Read from the village record: {m.consulted.readers.join("; ")}. </>}
                  {m.consulted.references?.length > 0 && <>References: {m.consulted.references.join("; ")}.</>}
                </p>
              )}
            </div>
          ))
        )}
        {busy && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
      </div>
      {!gone && (
        <div className="p-3 border-t border-stone-100 flex gap-2">
          <MicButton onText={(t) => setDraft((v) => (v ? v.replace(/\s*$/, " ") : "") + t)} disabled={busy} className="!rounded-lg" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Ask about any step…"
            className="flex-1 text-sm border border-stone-200 rounded-lg px-3 py-2"
          />
          <button onClick={send} disabled={busy || !draft.trim()}
            className="bg-teal-deep text-white rounded-lg px-3 py-2 disabled:opacity-40">
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
