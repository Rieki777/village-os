/**
 * "Walk me through the next steps by email": the box on every public form
 * that feeds a path (the comms build spec 5.11).
 *
 * The words are the village's own (Comms Settings, `consentText`), read
 * through `GET /api/comms/consent`, so what the person reads is exactly what
 * the server records beside their yes. While the village's email is off the
 * read answers `show: false` and no box is drawn: a promise of emails nothing
 * would send is one the form should not make.
 *
 * Unticked by default. Unticked means the form's own acknowledgement and
 * nothing more. A form sends the answer as `commsConsent`
 * (`FORM_CONSENT_FIELD`, shared/comms/contracts.ts), `true` only when ticked.
 *
 * Member-facing: semantic theme tokens, never numbered grays.
 */
import { useEffect, useId, useState } from "react";

export { FORM_CONSENT_FIELD } from "@shared/comms/contracts";

interface ConsentWords {
  show: boolean;
  text: string;
}

/** The box's words, or null while they load or when the read fails (then no box is drawn). */
export function usePathConsentWords(): ConsentWords | null {
  const [words, setWords] = useState<ConsentWords | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/comms/consent")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d && typeof d.show === "boolean") setWords({ show: d.show, text: String(d.text ?? "") });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return words;
}

export default function PathConsentBox({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  const words = usePathConsentWords();
  const id = useId();
  if (!words?.show || !words.text) return null;
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {words.text}
      </label>
    </div>
  );
}
