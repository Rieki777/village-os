/**
 * "How much can you give right now?" on the member's own Today (0383, lane E1).
 *
 * A quiet control: a percent, the period it covers, an optional note. Saving
 * says a new word, which joins the member's history and never replaces the
 * last one (server/repos/memberCommitments.ts). The Open work board and the
 * roles list read the word that holds today to order and filter work for this
 * member alone. Nobody else sees it, and nothing that pays reads it.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { useMyCommitment } from "@/lib/useMyCommitment";
import { COMMITMENT_PERIODS, type CommitmentPeriod } from "@shared/commitment";
import { BTN_SECONDARY, FIELD, HINT, LABEL } from "@/components/journey/look";

export default function CommitmentField() {
  const { t } = useLingui();
  const mine = useMyCommitment(true);
  const [pct, setPct] = useState<number | null>(null);
  const [period, setPeriod] = useState<CommitmentPeriod | null>(null);
  const [note, setNote] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  if (!mine.loaded) return null;

  const periodWords: Record<CommitmentPeriod, string> = {
    season: t({ message: "This season", context: "commitment field: the period a member's word covers" }),
    moon: t({ message: "This moon", context: "commitment field: the period a member's word covers" }),
    week: t({ message: "This week", context: "commitment field: the period a member's word covers" }),
  };
  const shownPct = pct ?? mine.pct ?? 50;
  const shownPeriod = period ?? mine.now?.period ?? "season";
  const changed = pct !== null || period !== null || note.trim() !== "";
  const nowPct = mine.now?.pct ?? 0;
  const nowFrom = mine.now?.fromDate ?? "";
  const earlier = mine.history.filter((h) => h.id !== mine.now?.id).slice(0, 4);

  const save = async () => {
    setBusy(true);
    const r = await mine.say({ pct: shownPct, period: shownPeriod, note: note.trim() || null });
    setBusy(false);
    if (r.ok) {
      setPct(null);
      setPeriod(null);
      setNote("");
      setSaid(t({ message: "Saved. The open work and roles now fit this.", context: "commitment field: after saving" }));
    } else setSaid(r.error);
  };

  return (
    <section aria-labelledby="my-commitment-title" className="rounded-xl border border-border bg-card p-4" data-commitment-field="">
      <h2 id="my-commitment-title" className="font-display text-lg font-semibold text-foreground">
        {t({ message: "How much can you give right now?", context: "commitment field: heading" })}
      </h2>
      <p className={`mb-3 ${HINT}`}>
        {mine.now
          ? t({ message: `You said ${nowPct}% from ${nowFrom}. Change it whenever life changes.`, context: "commitment field: what holds now" })
          : t({ message: "Say it as a percent of yourself. The open work and the roles you see will fit it. Only you see this.", context: "commitment field: before a first word" })}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 flex-1 items-center gap-3" htmlFor="my-commitment-pct">
          <span className="sr-only">{t({ message: "Percent you can give", context: "commitment field" })}</span>
          <input
            id="my-commitment-pct"
            type="range"
            min={5}
            max={100}
            step={5}
            value={shownPct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="h-11 w-full min-w-[10rem] accent-notice"
            aria-valuetext={`${shownPct}%`}
          />
          <span className="w-12 text-right font-display text-xl font-bold text-foreground" aria-hidden="true">{shownPct}%</span>
        </label>
        <select
          className={`${FIELD} min-h-11 w-auto`}
          value={shownPeriod}
          onChange={(e) => setPeriod(e.target.value as CommitmentPeriod)}
          aria-label={t({ message: "The time this covers", context: "commitment field" })}
        >
          {COMMITMENT_PERIODS.map((p) => (
            <option key={p} value={p}>{periodWords[p]}</option>
          ))}
        </select>
      </div>
      <label className="mt-3 block">
        <span className={LABEL}>{t({ message: "A note for yourself (optional)", context: "commitment field" })}</span>
        <input className={`${FIELD} mt-1 min-h-11`} value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={BTN_SECONDARY} onClick={save} disabled={busy || (!changed && !!mine.now)} data-commitment-save="">
          {t({ message: "Save", context: "commitment field" })}
        </button>
        {said && <p role="status" className={HINT}>{said}</p>}
      </div>
      {earlier.length > 0 && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-notice">{t({ message: "What you said before", context: "commitment field: the history" })}</summary>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {earlier.map((h) => {
              const pct = h.pct;
              const from = h.fromDate;
              const period = periodWords[h.period].toLowerCase();
              return (
                <li key={h.id}>
                  {t({ message: `${pct}% from ${from}, ${period}`, context: "commitment field: one earlier word" })}
                  {h.note ? `: ${h.note}` : ""}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
