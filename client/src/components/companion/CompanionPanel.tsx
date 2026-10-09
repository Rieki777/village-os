/**
 * THE COMPANION PANEL (plan 5.4; Wave 4, 2026-09-28). Lazy: `Companion.tsx`
 * imports it the first time somebody presses Ask.
 *
 * It talks to `POST /api/agent/ask` (server/routes/companion.ts) and says
 * what the server says. Three things it shows that a chat box would not:
 *
 *   WHERE AN ANSWER CAME FROM. A reply from the record says so in its own
 *   first sentence, and every reply lists what was read, in words.
 *
 *   THE LINE BEFORE A MODEL. When the server hands back `consent`, the panel
 *   shows its one line, naming the model provider and whoever holds the key,
 *   with "Agree" and "Not now". Agreeing records the yes to exactly that line
 *   and asks the last question again; nothing the member typed went to a
 *   model before that.
 *
 *   A WAY TO TAKE IT BACK. Once agreed, the panel says to whom and offers
 *   "Take back my yes".
 *
 * No number is shown and nothing is counted: the canvas's R55 line holds here.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, Send, X } from "lucide-react";
import { CANVAS_BLOCKS, type CanvasBlockId } from "@shared/governanceCanvas";
import { authToken } from "@/lib/gameApi";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/** The one line, as the server words it. */
export interface CompanionLine {
  provider: string;
  operator: string;
  source: string;
  sentence: string;
}

interface Consulted {
  ownRecord?: string[];
  references?: string[];
  readers?: string[];
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  consulted?: Consulted;
  /** A line the panel wrote itself (a refusal, a note). Never sent back to the server. */
  local?: boolean;
}

/** What each reader is called on the page. A key missing here is printed as it comes. */
const READ_FROM: Record<string, string> = {
  "canvas.answers": "the village's canvas",
  "canvas.library": "Canvas Resources and the shelf",
  "matrix.rows": "the Decision Matrix",
  "events.week": "the calendar",
  "record.decisions": "the decision record",
  "roles.all": "the roles",
  "seats.vacant": "the seats",
  "circles.all": "the circles",
  "quests.library": "the quests",
  "badges.all": "the badges",
};

/** A refusal in the member's words, by the status and the server's own sentence. */
export function askFailure(status: number | null, body: { error?: unknown; message?: unknown } | null): string {
  if (status === 401) return "Sign in to ask.";
  if (typeof body?.message === "string" && body.message) return body.message;
  if (status === 429 && typeof body?.error === "string") return body.error;
  if (status === 503) return "The guide cannot answer in its own words right now: the model is not reachable or today's answers are used up. Ask again later.";
  if (status === 502) return "The model did not answer. Ask again in a moment.";
  if (status === null) return "That did not reach the server.";
  return typeof body?.error === "string" && body.error ? body.error : "That did not work. Ask again in a moment.";
}

export default function CompanionPanel({ block, onClose }: { block: CanvasBlockId | null; onClose: () => void }) {
  const name = block ? CANVAS_BLOCKS[block].name : null;
  const [turns, setTurns] = useState<Turn[]>([
    {
      role: "assistant",
      content: name
        ? `Ask about ${name}. The guide reads what the village adopted for it and its last reading first, then the shelf.`
        : "Ask about the canvas. The guide reads what the village adopted and its readings first, then the shelf.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** The line waiting for a yes, if the last answer came back with one. */
  const [line, setLine] = useState<CompanionLine | null>(null);
  const [notNow, setNotNow] = useState(false);
  /** The member's standing yes, if any, as the server holds it. */
  const [agreed, setAgreed] = useState<{ provider: string; at: string } | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    fetch("/api/agent/companion", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAgreed(d?.consent ? { provider: String(d.consent.provider), at: String(d.consent.at) } : null))
      .catch(() => setAgreed(null));
  }, []);

  const ask = async (thread: Turn[]) => {
    setBusy(true);
    try {
      const r = await fetch("/api/agent/ask", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          messages: thread.filter((t) => !t.local).map(({ role, content }) => ({ role, content })),
          block,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setTurns((t) => [...t, { role: "assistant", content: askFailure(r.status, d), local: true }]);
        return;
      }
      const reply: Turn = { role: "assistant", content: String(d?.reply ?? ""), consulted: d?.consulted };
      const extra: Turn[] = d?.draft
        ? [{ role: "assistant", content: "The guide drafted an answer to a gathering for you. It waits for your yes in your profile.", local: true }]
        : [];
      setTurns((t) => [...t, reply, ...extra]);
      setLine(d?.consent?.required ? { provider: d.consent.provider, operator: d.consent.operator, source: d.consent.source, sentence: d.consent.sentence } : null);
    } catch {
      setTurns((t) => [...t, { role: "assistant", content: askFailure(null, null), local: true }]);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const content = draft.trim();
    if (!content || busy) return;
    const thread: Turn[] = [...turns, { role: "user", content }];
    setTurns(thread);
    setDraft("");
    void ask(thread);
  };

  /** Yes to the line shown, then the last question again, now that a model may answer it. */
  const agree = async () => {
    if (!line) return;
    setLineError(null);
    try {
      const r = await fetch("/api/agent/companion/consent", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ provider: line.provider, operator: line.operator, source: line.source }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setLineError(askFailure(r.status, d));
        if (d?.disclosure) setLine({ ...d.disclosure });
        return;
      }
      setLine(null);
      setAgreed(d?.consent ? { provider: String(d.consent.provider), at: String(d.consent.at) } : null);
      let last = -1;
      turns.forEach((t, i) => {
        if (t.role === "user") last = i;
      });
      if (last >= 0) void ask(turns.slice(0, last + 1));
    } catch {
      setLineError(askFailure(null, null));
    }
  };

  const takeBack = async () => {
    try {
      const r = await fetch("/api/agent/companion/consent", { method: "DELETE", headers: headers() });
      if (r.ok) setAgreed(null);
    } catch {
      // Nothing changed on the server, so the page says nothing changed.
    }
  };

  const readFrom = (c?: Consulted): string => {
    const read = (c?.readers ?? []).map((k) => READ_FROM[k] ?? k);
    const refs = c?.references ?? [];
    const parts: string[] = [];
    if (read.length) parts.push(`Read from ${read.join("; ")}.`);
    if (refs.length) parts.push(`Shelf: ${refs.join("; ")}.`);
    return parts.join(" ");
  };

  // On a phone the tab bar (z-50, portaled after #root) and the shortcut
  // button (z-[60]) sit over the bottom of the screen, so the panel docks
  // above the bar and layers at z-[70], the modal rule in MobileFab.tsx.
  // From md up the bar is gone and --tabbar-h is 0.
  return (
    <div
      role="dialog"
      aria-label={name ? `Ask about ${name}` : "Ask about the canvas"}
      data-testid="companion-panel"
      data-hides-fab
      className="fixed bottom-[calc(var(--tabbar-h)+0.5rem)] md:bottom-4 right-4 z-[70] w-[min(24rem,calc(100vw-2rem))] bg-white border border-stone-200 rounded-2xl shadow-2xl flex flex-col max-h-[70vh] wrap-anywhere"
    >
      <header className="px-4 py-3 border-b border-stone-100 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-stone-900">{name ? `Ask about ${name}` : "Ask about the canvas"}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-stone-600 hover:text-stone-900">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
        {turns.map((t, i) => (
          <div
            key={i}
            className={`text-sm rounded-xl px-3 py-2 max-w-[90%] whitespace-pre-line ${
              t.role === "user" ? "ml-auto bg-teal-deep text-white" : "bg-stone-100 text-stone-900"
            }`}
          >
            {t.content}
            {t.role === "assistant" && readFrom(t.consulted) && (
              <p className="text-xs text-stone-600 mt-1.5 border-t border-stone-200 pt-1">{readFrom(t.consulted)}</p>
            )}
          </div>
        ))}
        {busy && <Loader2 className="w-4 h-4 animate-spin text-stone-500" aria-label="The guide is reading" />}
        {line && !notNow && (
          <div data-testid="companion-line" className="text-sm rounded-xl border border-teal-deep bg-white px-3 py-2 space-y-2">
            <p className="text-stone-900">{line.sentence}</p>
            {lineError && <p className="text-xs text-red-700">{lineError}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void agree()} className="min-h-[44px] text-sm font-medium rounded-lg px-3 text-white bg-teal-deep">
                Agree and ask again
              </button>
              <button type="button" onClick={() => setNotNow(true)} className="min-h-[44px] text-sm font-medium rounded-lg px-3 text-stone-800 border border-stone-300">
                Not now
              </button>
            </div>
          </div>
        )}
      </div>
      {agreed && (
        <p className="px-4 pb-2 text-xs text-stone-600">
          You agreed on {agreed.at.slice(0, 10)} that the guide may send your questions to {agreed.provider}.{" "}
          <button type="button" onClick={() => void takeBack()} className="font-medium text-teal-deep underline">
            Take back my yes
          </button>
        </p>
      )}
      <div className="p-3 border-t border-stone-100 flex gap-2">
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          aria-label="Your question"
          placeholder={name ? `A question about ${name}` : "A question about the canvas"}
          className="flex-1 min-w-0 text-sm border border-stone-300 rounded-lg px-3 py-2"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !draft.trim()}
          aria-label="Ask"
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center bg-teal-deep text-white rounded-lg disabled:opacity-40"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <p className="px-4 pb-3 text-xs text-stone-600">
        The guide never changes the canvas. To change an answer, suggest it under Say on the block.{" "}
        <Link href="/profile" className="text-teal-deep underline">Your profile</Link> holds anything it drafted for you.
      </p>
    </div>
  );
}
