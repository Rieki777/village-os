/**
 * Voice-to-text for every "talk to the guide" input. The whole UX promise of
 * a conversational surface is that people can just TALK — so wherever there
 * is a chat with the assistant, this button sits beside the send button.
 *
 * Web Speech API underneath: tap to talk, each finished phrase is appended
 * to the draft through onText, tap again to stop. The browser does the
 * transcription with its own engine; where the API is absent (Firefox, some
 * webviews) the button renders nothing and typing works as it always did —
 * a mic that cannot listen must not be shown.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

const SR: any =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    : undefined;

/**
 * Whether the page's Permissions-Policy lets this document use the
 * microphone at all. Where the browser cannot say (no featurePolicy), assume
 * yes and let a refusal speak for itself through `onerror`. Until 2026-10-02
 * the server sent `microphone=()`, every tap failed with `not-allowed`, and
 * the button reset without a word, which is the failure this guards.
 */
function policyAllowsMic(): boolean {
  const fp = typeof document !== "undefined" ? (document as any).featurePolicy : undefined;
  if (!fp || typeof fp.allowsFeature !== "function") return true;
  try {
    return Boolean(fp.allowsFeature("microphone"));
  } catch {
    return true;
  }
}

/** What a refusal means to the person holding the phone, by the engine's error code. */
function refusalText(code: string): string | null {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "The microphone is blocked for this site. Allow it in your browser settings to speak.";
  }
  if (code === "network") return "Speaking needs a connection. Typing works offline.";
  if (code === "audio-capture") return "No microphone was found on this device.";
  return null;
}

export default function MicButton({
  onText,
  disabled,
  className = "",
}: {
  /** Called with each finished phrase — append it to the draft. */
  onText: (chunk: string) => void;
  disabled?: boolean;
  /** Extra classes for spacing tweaks at the call site. */
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  // The last refusal, said out loud on the button until the next try.
  const [problem, setProblem] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  // The latest onText without re-creating the recognizer mid-phrase.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // Leaving the page must release the microphone.
  useEffect(() => () => { recRef.current?.abort?.(); }, []);

  if (!SR || !policyAllowsMic()) return null;

  const stop = () => {
    recRef.current?.stop?.();
    setListening(false);
  };

  const start = () => {
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    // Final results only: interim text fighting the member's own typing in
    // one input is worse than a beat of delay after each phrase.
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r.isFinal ? String(r[0]?.transcript ?? "").trim() : "";
        if (text) onTextRef.current(text);
      }
    };
    // The engine ends itself on silence or permission refusal; either way
    // the button must tell the truth about whether anyone is listening.
    rec.onend = () => setListening(false);
    rec.onerror = (e: any) => {
      setListening(false);
      setProblem(refusalText(String(e?.error ?? "")));
    };
    recRef.current = rec;
    setProblem(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const label = listening ? "Stop voice input" : problem ?? "Speak instead of typing";

  // A title is invisible on a phone, so a refusal is also printed above the
  // button. Absolutely placed, so no call site's row changes shape.
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => (listening ? stop() : start())}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 disabled:opacity-50 ${
          listening
            ? "bg-red-500 text-white animate-pulse"
            : "bg-stone-100 text-stone-600 hover:bg-stone-200"
        } ${className}`}
      >
        {listening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>
      {problem && !listening && (
        <span
          role="status"
          className="absolute bottom-full right-0 mb-2 w-56 rounded-lg bg-stone-800 px-3 py-2 text-xs leading-snug text-white shadow-lg z-10"
        >
          {problem}
        </span>
      )}
    </span>
  );
}
