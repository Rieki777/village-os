/**
 * ASKING FOR ADVICE, on /sessions (shared/sessionAdvice.ts): the advice
 * process. Before deciding something that touches others, a member asks the
 * people it touches. They name what they mean to decide, why, and by when,
 * and ask a circle; everybody with standing in it is asked.
 *
 * Two lists: the requests the viewer was asked about, and the ones they made,
 * each open first and then the latest settled (`AdviceCard`). "Ask for
 * advice" opens the form: the circle, what and why, and the decide-by date
 * (In 3 days, In a week, In two weeks, or a date up to sixty days ahead). A
 * notice's link lands on its request (`#advice-<id>`), which is lit and takes
 * the focus. A list that did not load can be tried again.
 *
 * Every write reads `res.ok` before it says anything, what landed is read out
 * in one polite line, and the focus goes into the form when it opens and back
 * to the button that opened it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ADVICE_API,
  ADVICE_COPY,
  ADVICE_LIMITS,
  DECIDE_BY_CHOICES,
  type AdvicePayload,
  type AdviceRequestCard,
} from "@shared/sessionAdvice";
import { addDaysTo } from "@shared/sessionDecisions";
import AdviceCard from "./AdviceCard";
import { adviceCall } from "./adviceCall";
import { BTN_PRIMARY, BTN_QUIET, HINT, INPUT, LABEL, PANEL } from "./roomUi";
import { useHash } from "./useHash";

function AskForm({
  payload,
  onAsked,
  onCancel,
}: {
  payload: AdvicePayload;
  onAsked: (request: AdviceRequestCard) => void;
  onCancel: () => void;
}) {
  const [circleId, setCircleId] = useState(payload.circles[0]?.id ?? "");
  const [intent, setIntent] = useState("");
  const [context, setContext] = useState("");
  const [decideBy, setDecideBy] = useState(addDaysTo(payload.today, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    group.current?.focus();
  }, []);

  const send = async () => {
    setBusy(true);
    setError(null);
    const out = await adviceCall<{ request: AdviceRequestCard }>(ADVICE_API, "POST", { circleId, intent, context, decideBy });
    setBusy(false);
    if (!out.ok || !out.body.request) {
      setError(out.ok ? ADVICE_COPY.failed : out.error);
      return;
    }
    onAsked(out.body.request);
  };

  return (
    <div
      ref={group}
      tabIndex={-1}
      role="group"
      aria-label={ADVICE_COPY.askTitle}
      className="mb-4 space-y-3 rounded-xl border border-border bg-muted px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="max-w-sm">
        <label htmlFor="advice-circle" className={LABEL}>
          {ADVICE_COPY.circleLabel}
        </label>
        <select id="advice-circle" className={`mt-1 ${INPUT}`} value={circleId} onChange={(e) => setCircleId(e.target.value)}>
          {payload.circles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="advice-intent" className={LABEL}>
          {ADVICE_COPY.intentLabel}
        </label>
        <textarea id="advice-intent" className={`mt-1 ${INPUT} min-h-[4rem]`} maxLength={ADVICE_LIMITS.intent} value={intent} onChange={(e) => setIntent(e.target.value)} />
      </div>
      <div>
        <label htmlFor="advice-context" className={LABEL}>
          {ADVICE_COPY.contextLabel}
        </label>
        <textarea id="advice-context" className={`mt-1 ${INPUT} min-h-[4rem]`} maxLength={ADVICE_LIMITS.context} value={context} onChange={(e) => setContext(e.target.value)} />
      </div>
      <div>
        <p className={LABEL}>{ADVICE_COPY.decideByLabel}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {DECIDE_BY_CHOICES.map((days) => (
            <button key={days} type="button" className={BTN_QUIET} disabled={busy} onClick={() => setDecideBy(addDaysTo(payload.today, days))}>
              {ADVICE_COPY.inDays(days)}
            </button>
          ))}
        </div>
        <input
          type="date"
          aria-label={ADVICE_COPY.decideByLabel}
          className={`mt-2 ${INPUT} max-w-xs`}
          min={addDaysTo(payload.today, 1)}
          max={addDaysTo(payload.today, ADVICE_LIMITS.decideByMaxDays)}
          value={decideBy}
          onChange={(e) => setDecideBy(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy || !circleId || !intent.trim() || !decideBy} onClick={() => void send()}>
          {ADVICE_COPY.send}
        </button>
        <button type="button" className={BTN_QUIET} disabled={busy} onClick={onCancel}>
          {ADVICE_COPY.cancel}
        </button>
      </div>
    </div>
  );
}

export default function AdviceProcess() {
  const [payload, setPayload] = useState<AdvicePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const hash = useHash();
  const litId = /^#advice-(\d+)$/.exec(hash)?.[1];

  useEffect(() => {
    let live = true;
    setError(null);
    void adviceCall<AdvicePayload>(ADVICE_API, "GET").then((out) => {
      if (!live) return;
      // An answer without the lists (an older server, a proxy's page) says it didn't load, and never takes the page down.
      if (out.ok && Array.isArray(out.body.mine) && Array.isArray(out.body.askedOfMe)) setPayload(out.body);
      else setError(out.ok ? ADVICE_COPY.loadFailed : out.error);
    });
    return () => {
      live = false;
    };
  }, [tries]);

  // A notice's link lands on its request once the lists are here.
  useEffect(() => {
    if (!litId || !payload) return;
    document.getElementById(`advice-${litId}`)?.focus();
  }, [litId, payload]);

  const replace = useCallback((next: AdviceRequestCard) => {
    setPayload((p) =>
      p
        ? {
            ...p,
            mine: p.mine.map((r) => (r.id === next.id ? next : r)),
            askedOfMe: p.askedOfMe.map((r) => (r.id === next.id ? next : r)),
          }
        : p,
    );
  }, []);

  const closeForm = () => {
    setAsking(false);
    requestAnimationFrame(() => opener.current?.focus());
  };

  const list = (title: string, rows: AdviceRequestCard[], empty: string) => (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className={HINT}>{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <AdviceCard
              key={r.id}
              request={r}
              today={payload!.today}
              lit={litId === String(r.id)}
              onSaved={(next, words) => {
                replace(next);
                setSaid(words);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section id="advice" aria-labelledby="sessions-advice-heading">
      <h2 id="sessions-advice-heading" className="font-display text-2xl text-foreground">
        {ADVICE_COPY.sectionTitle}
      </h2>
      <p className={`${HINT} mt-1 max-w-2xl`}>{ADVICE_COPY.lede}</p>
      <div className={`mt-4 ${PANEL}`}>
        {error && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
            <button type="button" className={BTN_QUIET} onClick={() => setTries((n) => n + 1)}>
              {ADVICE_COPY.retry}
            </button>
          </div>
        )}
        {!payload && !error && <p className={HINT}>{ADVICE_COPY.loading}</p>}
        {payload && (
          <div className="space-y-5">
            {asking ? (
              <AskForm
                payload={payload}
                onCancel={closeForm}
                onAsked={(request) => {
                  setPayload((p) => (p ? { ...p, mine: [request, ...p.mine] } : p));
                  setSaid(ADVICE_COPY.asked(request.circleName, request.askedCount));
                  closeForm();
                }}
              />
            ) : (
              payload.circles.length > 0 && (
                <button ref={opener} type="button" className={BTN_PRIMARY} onClick={() => setAsking(true)}>
                  {ADVICE_COPY.askButton}
                </button>
              )
            )}
            {list(ADVICE_COPY.askedOfMeTitle, payload.askedOfMe, ADVICE_COPY.nothingAsked)}
            {list(ADVICE_COPY.mineTitle, payload.mine, ADVICE_COPY.nothingMine)}
          </div>
        )}
        {/* Mounted from the start, so what landed is read out when its words arrive. */}
        <p aria-live="polite" className={`text-sm text-open ${said ? "mt-2" : "sr-only"}`}>
          {said}
        </p>
      </div>
    </section>
  );
}
