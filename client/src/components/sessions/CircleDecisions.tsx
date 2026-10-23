/**
 * DECISIONS, on /sessions: what a circle decided by consent, newest first,
 * and when each is reviewed (shared/sessionDecisions.ts). Shown to somebody
 * who may keep at least one circle (its members by standing, and admins),
 * for one circle at a time, their own first.
 *
 * Each decision says where and when it was decided (the session's title only
 * for somebody who was in it), and its review: a date, "Up for review now"
 * once it has come, or that its review is one of the circle's agenda items.
 * "Set a review date" offers three quick choices (in 3 months, 6 months, a
 * year) and a date, and the review can be taken off. When the date comes, a
 * daily job makes "Review: <the decision>" an agenda item for the circle.
 *
 * Every write reads `res.ok` before it says anything, what landed is read out
 * in one polite line, and the focus returns to the button that opened a form.
 */
import { useEffect, useRef, useState } from "react";
import {
  DECISION_COPY,
  DECISION_LIMITS,
  REVIEW_CHOICES,
  addDaysTo,
  addMonthsTo,
  circleDecisionsUrl,
  dateWords,
  decisionReviewUrl,
  type CircleDecision,
  type CircleDecisionLog,
} from "@shared/sessionDecisions";
import { gameFetch } from "@/lib/gameApi";
import { BTN_PRIMARY, BTN_QUIET, CHIP, HINT, INPUT, LABEL, PANEL, UNDER_BOX } from "./roomUi";

type Sent<T> = { ok: true; body: T } | { ok: false; error: string };

async function call<T>(path: string, method: string, body?: unknown): Promise<Sent<T>> {
  try {
    const res = await gameFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const out = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
    if (res.ok && out) return { ok: true, body: out };
    const text = typeof out?.error === "string" ? out.error.trim() : "";
    return { ok: false, error: /\s/.test(text) ? text : DECISION_COPY.failed };
  } catch {
    return { ok: false, error: DECISION_COPY.failed };
  }
}

function Decision({
  circleId,
  today,
  decision,
  onSaved,
}: {
  circleId: string;
  today: string;
  decision: CircleDecision;
  onSaved: (d: CircleDecision, said: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(decision.review?.on ?? addMonthsTo(today, 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const backToOpener = useRef(false);
  const idBase = `decision-${decision.entryId}`;

  useEffect(() => {
    if (!open && backToOpener.current) {
      backToOpener.current = false;
      opener.current?.focus();
    }
  }, [open]);

  const close = () => {
    backToOpener.current = true;
    setOpen(false);
    setError(null);
  };

  const save = async (reviewOn: string | null) => {
    setBusy(true);
    setError(null);
    const out = await call<{ decision: CircleDecision }>(decisionReviewUrl(circleId, decision.entryId), "PUT", { reviewOn });
    setBusy(false);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    close();
    onSaved(out.body.decision, reviewOn ? DECISION_COPY.saved(dateWords(reviewOn)) : DECISION_COPY.cleared);
  };

  const review = decision.review;
  const reviewLine = !review
    ? DECISION_COPY.noReview
    : review.brought
      ? DECISION_COPY.reviewBrought
      : review.due
        ? DECISION_COPY.reviewDue
        : DECISION_COPY.reviewOn(dateWords(review.on));

  return (
    <li className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="whitespace-pre-line break-words font-semibold text-foreground">{decision.text}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {decision.session ? DECISION_COPY.decidedIn(decision.session.title, dateWords(decision.decidedOn)) : DECISION_COPY.decidedOn(dateWords(decision.decidedOn))}
      </p>
      <p className="mt-1 text-sm">
        <span className={review?.due && !review.brought ? `${CHIP} border-notice text-foreground` : "text-muted-foreground"}>{reviewLine}</span>
      </p>
      {open ? (
        <div role="group" aria-label={review ? DECISION_COPY.changeReview : DECISION_COPY.setReview} className="mt-3 space-y-3 rounded-xl border border-border bg-muted px-3 py-3">
          <div className="flex flex-wrap gap-2">
            {REVIEW_CHOICES.map((months) => (
              <button key={months} type="button" className={BTN_QUIET} disabled={busy} onClick={() => setDate(addMonthsTo(today, months))}>
                {DECISION_COPY.inMonths(months)}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor={`${idBase}-date`} className={LABEL}>
              {DECISION_COPY.dateLabel}
            </label>
            <input
              id={`${idBase}-date`}
              type="date"
              min={addDaysTo(today, 1)}
              max={addDaysTo(today, DECISION_LIMITS.reviewMaxDays)}
              className={`mt-1 ${INPUT}`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className={UNDER_BOX}>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !date} onClick={() => void save(date)}>
              {DECISION_COPY.save}
            </button>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={close}>
              {DECISION_COPY.cancel}
            </button>
            {review && (
              <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void save(null)}>
                {DECISION_COPY.clear}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <button ref={opener} type="button" className={BTN_QUIET} onClick={() => setOpen(true)}>
            {review ? DECISION_COPY.changeReview : DECISION_COPY.setReview}
          </button>
        </div>
      )}
    </li>
  );
}

export default function CircleDecisions({ circles, keepCircleIds, myCircleIds }: { circles: { id: string; name: string }[]; keepCircleIds: string[]; myCircleIds: string[] }) {
  // The viewer's own circles first, then any other they may keep (an admin keeps every circle).
  const keepable = circles
    .filter((c) => keepCircleIds.includes(c.id))
    .sort((a, b) => Number(myCircleIds.includes(b.id)) - Number(myCircleIds.includes(a.id)));
  const [circleId, setCircleId] = useState(keepable[0]?.id ?? "");
  const [log, setLog] = useState<CircleDecisionLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  useEffect(() => {
    if (!circleId) return;
    let live = true;
    setLog(null);
    void call<CircleDecisionLog>(circleDecisionsUrl(circleId), "GET").then((out) => {
      if (!live) return;
      // An answer without the list (an older server, a proxy's page) says it didn't load, and never takes the page down.
      if (out.ok && Array.isArray(out.body.decisions)) {
        setLog(out.body);
        setError(null);
      } else setError(out.ok ? DECISION_COPY.loadFailed : out.error);
    });
    return () => {
      live = false;
    };
  }, [circleId]);

  if (!keepable.length) return null;
  const circleName = keepable.find((c) => c.id === circleId)?.name ?? "";

  return (
    <section aria-labelledby="sessions-decisions-heading">
      <h2 id="sessions-decisions-heading" className="font-display text-2xl text-foreground">
        {DECISION_COPY.sectionTitle}
      </h2>
      <p className={`${HINT} mt-1 max-w-2xl`}>{DECISION_COPY.lede}</p>
      <div className={`mt-4 ${PANEL}`}>
        {keepable.length > 1 && (
          <div className="mb-4 max-w-sm">
            <label htmlFor="decisions-circle" className={LABEL}>
              {DECISION_COPY.circleLabel}
            </label>
            <select id="decisions-circle" className={`mt-1 ${INPUT}`} value={circleId} onChange={(e) => setCircleId(e.target.value)}>
              {keepable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        {log &&
          (log.decisions.length === 0 ? (
            <p className={HINT}>{DECISION_COPY.empty(circleName)}</p>
          ) : (
            <ul className="space-y-3">
              {log.decisions.map((d) => (
                <Decision
                  key={d.entryId}
                  circleId={circleId}
                  today={log.today}
                  decision={d}
                  onSaved={(next, words) => {
                    setLog((l) => (l ? { ...l, decisions: l.decisions.map((x) => (x.entryId === next.entryId ? next : x)) } : l));
                    setSaid(words);
                  }}
                />
              ))}
            </ul>
          ))}
        {/* Mounted from the start, so what landed is read out when its words arrive. */}
        <p aria-live="polite" className={`text-sm text-open ${said ? "mt-2" : "sr-only"}`}>
          {said}
        </p>
      </div>
    </section>
  );
}
