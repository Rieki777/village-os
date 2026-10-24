/**
 * ONE REQUEST FOR ADVICE, as one person reads it (shared/sessionAdvice.ts).
 *
 * Who asked which circle and by when they decide; what they mean to decide and
 * why; and the advice so far, each in its giver's words, open to everybody
 * asked. Somebody asked gives their advice here and can change it until the
 * decision. The asker records what they decided and how the advice shaped it,
 * or withdraws the request after a confirm. Once settled, the card says what
 * was decided, or that it was withdrawn, and when.
 *
 * Every write reads `res.ok` before it says anything: a refusal shows under
 * the form in the server's words, and what landed goes to the section's one
 * polite line (`onSaved`). A refusal that says the request moved on (409)
 * asks the section to read the lists again (`onStale`). The focus moves into
 * the withdraw confirm when it opens, back to Withdraw when it is kept, and to
 * the card itself once the request is settled, since its forms are gone.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ADVICE_COPY, ADVICE_LIMITS, adviceDecideUrl, adviceGiveUrl, adviceWithdrawUrl, type AdviceRequestCard } from "@shared/sessionAdvice";
import { dateWords } from "@shared/sessionDecisions";

import { BTN_PRIMARY, BTN_QUIET, CHIP, HINT, INPUT, LABEL } from "./roomUi";
import { adviceCall } from "./adviceCall";

export default function AdviceCard({
  request,
  today,
  lit,
  onSaved,
  onStale,
}: {
  request: AdviceRequestCard;
  today: string;
  /** A notice's link landed on this request. */
  lit: boolean;
  onSaved: (next: AdviceRequestCard, said: string) => void;
  /** The server says the request moved on: read the lists again. */
  onStale?: () => void;
}) {
  const r = request;
  const [advice, setAdvice] = useState(r.myAdvice ?? "");
  const [decision, setDecision] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idBase = `advice-${r.id}`;
  const open = r.status === "open";
  const card = useRef<HTMLLIElement>(null);
  const withdrawButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const confirmTouched = useRef(false);

  useEffect(() => {
    if (!confirmTouched.current) return;
    if (confirmWithdraw) keepButton.current?.focus();
    else withdrawButton.current?.focus();
  }, [confirmWithdraw]);

  const write = async (path: string, method: string, said: string, settles: boolean, body?: unknown) => {
    setBusy(true);
    setError(null);
    const out = await adviceCall<{ request: AdviceRequestCard }>(path, method, body);
    setBusy(false);
    if (!out.ok || !out.body.request) {
      setError(out.ok ? ADVICE_COPY.failed : out.error);
      if (!out.ok && out.status === 409) onStale?.();
      return;
    }
    confirmTouched.current = false;
    setConfirmWithdraw(false);
    onSaved(out.body.request, said);
    if (settles) requestAnimationFrame(() => card.current?.focus());
  };
  const askWithdraw = (yes: boolean) => {
    confirmTouched.current = true;
    setConfirmWithdraw(yes);
  };

  const settledLine =
    r.status === "decided" && r.settledOn ? ADVICE_COPY.decided(r.settledOn) : r.status === "withdrawn" && r.settledOn ? ADVICE_COPY.withdrawn(r.settledOn) : null;

  return (
    <li
      ref={card}
      id={idBase}
      tabIndex={-1}
      className={`rounded-xl border bg-card px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring ${lit ? "border-notice" : "border-border"}`}
    >
      <p className="text-sm text-muted-foreground">{ADVICE_COPY.fromWho(r.askerName, r.circleName)}</p>
      <p className="mt-1 whitespace-pre-line break-words font-semibold text-foreground">{r.intent}</p>
      {r.context && <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground">{r.context}</p>}
      <p className="mt-1 text-sm">
        {open ? (
          <span className={r.decideBy < today ? cn(CHIP, "border-notice text-foreground") : "text-muted-foreground"}>
            {r.decideBy < today ? ADVICE_COPY.decideByPassed(r.decideBy) : ADVICE_COPY.decideByLine(r.decideBy)}
          </span>
        ) : (
          <span className="text-muted-foreground">{settledLine}</span>
        )}
      </p>

      <div className="mt-3 space-y-2">
        <p className={`${HINT} text-xs`}>{ADVICE_COPY.adviceCount(r.advice.length, r.askedCount)}</p>
        {r.advice.length === 0 ? (
          <p className={HINT}>{ADVICE_COPY.noAdviceYet}</p>
        ) : (
          <ul className="space-y-1.5">
            {r.advice.map((a, i) => (
              <li key={`${a.by}-${i}`} className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
                <span className="font-semibold">{ADVICE_COPY.adviceBy(a.by)}</span>{" "}
                <span className="text-xs text-muted-foreground">{dateWords(a.on)}</span>
                <span className="mt-0.5 block whitespace-pre-line break-words">{a.words}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {r.decision && (
        <p className="mt-3 whitespace-pre-line break-words rounded-lg border border-open/50 px-3 py-2 text-sm text-foreground">{r.decision}</p>
      )}

      {r.canAdvise && (
        <div className="mt-3 space-y-2">
          <label htmlFor={`${idBase}-advice`} className={LABEL}>
            {ADVICE_COPY.yourAdvice}
          </label>
          <textarea
            id={`${idBase}-advice`}
            className={`${INPUT} min-h-[5rem]`}
            maxLength={ADVICE_LIMITS.advice}
            value={advice}
            onChange={(e) => setAdvice(e.target.value)}
          />
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy || !advice.trim()}
            onClick={() => void write(adviceGiveUrl(r.id), "PUT", ADVICE_COPY.savedAdvice(r.askerName), false, { advice })}
          >
            {r.myAdvice ? ADVICE_COPY.changeAdvice : ADVICE_COPY.giveAdvice}
          </button>
        </div>
      )}

      {r.canDecide && (
        <div className="mt-3 space-y-2">
          <label htmlFor={`${idBase}-decision`} className={LABEL}>
            {ADVICE_COPY.decisionLabel}
          </label>
          <textarea
            id={`${idBase}-decision`}
            className={`${INPUT} min-h-[4rem]`}
            maxLength={ADVICE_LIMITS.decision}
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy || !decision.trim()}
              onClick={() => void write(adviceDecideUrl(r.id), "POST", ADVICE_COPY.savedDecision, true, { decision })}
            >
              {ADVICE_COPY.recordDecision}
            </button>
            {!confirmWithdraw ? (
              <button ref={withdrawButton} type="button" className={BTN_QUIET} disabled={busy} onClick={() => askWithdraw(true)}>
                {ADVICE_COPY.withdraw}
              </button>
            ) : (
              <span role="group" aria-label={ADVICE_COPY.withdraw} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">{ADVICE_COPY.withdrawConfirm}</span>
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void write(adviceWithdrawUrl(r.id), "POST", ADVICE_COPY.savedWithdrawn, true)}>
                  {ADVICE_COPY.withdrawYes}
                </button>
                <button ref={keepButton} type="button" className={BTN_QUIET} disabled={busy} onClick={() => askWithdraw(false)}>
                  {ADVICE_COPY.keep}
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
