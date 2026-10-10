/**
 * THE ALIGN BUTTON (seat settings PR5, spec section 4.4).
 *
 * One button, "Align", and one plain sentence beside it: "I align with these
 * terms for <seat names>." No typed name, no drawn signature, no hash or
 * version beside the button (those live in the receipt). Rye, 2026-10-01:
 * "Just click to say you align." After the click: "You aligned on 9 Oct 2026".
 *
 * MONEY ASKS ONCE MORE. When the terms carry pay, allowance or bonus and the
 * member's last identity confirmation is older than fifteen minutes, the
 * server answers `reconfirm_required` (decision 3, 2026-10-09). The button
 * then opens the village's existing confirmation in place: the member's
 * password, or "Confirm with Google" for a member who has none
 * (`IdentityConfirmField`, the control exit and delete already use). Once
 * confirmed it aligns, without a second click on Align.
 *
 * The words never say "sign".
 */
import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { ALIGN_WORDS, alignedOnWords } from "@shared/alignments";
import { IdentityConfirmField, identityBody, identityReady, useIdentityConfirm } from "@/components/auth/ConfirmWithGoogle";
import { asksReconfirm, confirmIdentity, type Answer } from "./alignmentsApi";

/**
 * The confirmation, in place. Shown when the server asks for it, or ahead of
 * time by a Review step whose terms carry money.
 */
export function ReconfirmPanel({ onConfirmed }: { onConfirmed: () => void }) {
  const state = useIdentityConfirm("align");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setBusy(true);
    setError("");
    const answer = await confirmIdentity(identityBody(state, password).password);
    setBusy(false);
    setPassword("");
    if (answer.ok) onConfirmed();
    else {
      state.reset();
      setError(answer.error);
    }
  };

  // Back from Google confirmed: spend the cookie at once, so the member does not press twice.
  useEffect(() => {
    if (state.confirmWith === "google" && state.confirmed) void confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.confirmWith, state.confirmed]);

  return (
    <div data-reconfirm="" className="mt-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-notice" aria-hidden="true" />
        {ALIGN_WORDS.reconfirmLine}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <IdentityConfirmField
          state={state}
          action="align"
          password={password}
          onPassword={setPassword}
          placeholder="Your password"
          inputClassName="min-h-11 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        />
        {/* Unknown yet draws the password box, as exit and delete do. */}
        {state.confirmWith !== "google" && state.confirmWith !== "none" && (
          <button
            type="button"
            disabled={busy || !identityReady(state, password)}
            onClick={() => void confirm()}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {ALIGN_WORDS.reconfirm}
          </button>
        )}
      </div>
      {state.returnError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.returnError}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export interface AlignButtonProps {
  /** "Align", or "Align for the village" for a holder adopting. */
  label?: string;
  /** The one sentence beside the button. */
  sentence: string;
  /** When this member already aligned, ISO. The button gives way to the date. */
  alignedAt?: string | null;
  /** The act itself. Its answer may ask for the re-confirm. */
  onAlign: () => Promise<Answer<any>>;
  /** After a landed alignment, to reload what the page shows. */
  onDone?: (data: any) => void;
  disabled?: boolean;
}

export default function AlignButton({ label = ALIGN_WORDS.align, sentence, alignedAt = null, onAlign, onDone, disabled = false }: AlignButtonProps) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  if (alignedAt) {
    return (
      <p data-aligned="" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
        <Check className="size-4 text-notice" aria-hidden="true" />
        {ALIGN_WORDS.youAligned(alignedOnWords(alignedAt))}
      </p>
    );
  }

  const run = async () => {
    setBusy(true);
    setError("");
    const answer = await onAlign();
    setBusy(false);
    if (answer.ok) {
      setAsking(false);
      onDone?.(answer.data);
    } else if (asksReconfirm(answer)) {
      setAsking(true);
    } else {
      setError(answer.error);
    }
  };

  return (
    <div data-align-button="">
      <p className="text-sm text-foreground">{sentence}</p>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => void run()}
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
        {label}
      </button>
      {asking && <ReconfirmPanel onConfirmed={() => void run()} />}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
