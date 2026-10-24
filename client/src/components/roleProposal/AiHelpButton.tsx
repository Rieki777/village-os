/**
 * The "Let AI help me with this" button on the words and season steps (role
 * proposals PR C). It draws ONLY when the adapter says the bridge is
 * configured for the village (`aiHelpStatus`, ./aiHelp.ts), and the adapter
 * says "not configured" until a guide route exists, so today it draws nothing.
 * A button that does not work is never shown.
 *
 * Once configured, a press asks for suggestions on the words written so far
 * and lists them. Each one waits for the member's own "Use this", which puts
 * the words in the field like typing does. The AI never saves or submits.
 */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { aiHelpStatus, type AiHelpStatus, type AiHelpStep, type AiSuggestion } from "./aiHelp";
import { RP_WORDS } from "./proposalWords";
import { QUIET } from "./parts";

export default function AiHelpButton({
  step,
  words,
  onAccept,
}: {
  step: AiHelpStep;
  /** The words written on this step so far, by field. */
  words: Record<string, string>;
  /** The member accepted one suggestion: put it in its field. */
  onAccept: (field: string, words: string) => void;
}) {
  const [status, setStatus] = useState<AiHelpStatus | null>(null);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void aiHelpStatus(step).then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [step]);
  if (!status || !status.configured) return null;
  const { suggest } = status;
  const ask = async () => {
    setBusy(true);
    setSuggestions(await suggest({ step, words }).catch(() => []));
    setBusy(false);
  };
  return (
    <div className="grid gap-2" data-ai-help={step}>
      <div>
        <button type="button" onClick={() => void ask()} disabled={busy} className={QUIET}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {RP_WORDS.aiHelp}
        </button>
      </div>
      {suggestions.length > 0 && (
        <ul className="grid gap-2">
          {suggestions.map((s, i) => (
            <li key={`${s.field}-${i}`} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <p className="whitespace-pre-line break-words text-stone-800">{s.words}</p>
              <button
                type="button"
                className={QUIET}
                onClick={() => {
                  onAccept(s.field, s.words);
                  setSuggestions((list) => list.filter((_, j) => j !== i));
                }}
              >
                {RP_WORDS.useSuggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
