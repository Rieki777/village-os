/**
 * "TERMS WE OFFER" (joining lane PR 4): what the people who seat a role read and word for ONE proposal.
 * All eight settings and the commitment, each with the role's suggestion, the candidate's answer
 * and our wording. Saving writes a new revision and never overwrites; the log below lists who,
 * when, and what changed from and to. The log is for deciders and is only ever served to them.
 *
 * Drawn in the profile's look (docs/DESIGN_RULE.md): the semantic tokens only, panels and tiles,
 * a gold main act, 44px targets. Used by the open proposal page and the member door's application page.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { COMMITMENT_CHOICES } from "@shared/termsWords";
import { OFFER_WORD_MAX } from "@shared/counterOffer";
import { gameFetch } from "@/lib/gameApi";

export interface ServedDeciderOffer {
  revision: number;
  rows: Array<{
    key: string;
    label: string;
    suggested: string | null;
    current: string | null;
    theirs: { choice: "accept" | "talk"; note: string } | null;
    state: "accept" | "talk" | "waiting";
    changed: boolean;
  }>;
  theirCommitment: number | null;
  roleCommitment: number | null;
  ourCommitment: number | null;
  history: Array<{ n: number; at: string; by: string; changes: Array<{ key: string; label: string; from: string | null; to: string | null }> }>;
  openTalks: string[];
}

const PANEL = "rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6";
const TILE = "rounded-xl border border-border bg-muted p-4";
const EYEBROW = "text-xs font-semibold uppercase tracking-widest text-notice";
const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const BTN_PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-notice px-5 py-2 font-semibold text-background hover:bg-notice/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const CHIP = "inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-semibold text-foreground";

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export default function TermsWeOffer({ offer, mayEdit, savePath, onSaved }: { offer: ServedDeciderOffer; mayEdit: boolean; savePath: string; onSaved: () => void }) {
  const { t } = useLingui();
  const [words, setWords] = useState<Record<string, string>>({});
  const [pct, setPct] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const wordsFor = (k: string, current: string | null) => (k in words ? words[k] : (current ?? ""));
  const edits = offer.rows.filter((r) => r.key in words && (words[r.key] ?? "").trim() !== (r.current ?? "").trim());
  const commitmentEdit = pct !== "" && Number(pct) !== offer.ourCommitment;
  const dirty = edits.length > 0 || commitmentEdit;

  const save = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const res = await gameFetch(savePath, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: offer.revision,
          words: Object.fromEntries(edits.map((r) => [r.key, words[r.key]])),
          ...(commitmentEdit ? { commitmentPct: Number(pct) } : {}),
        }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSaid({ ok: false, text: String(data?.message ?? data?.error ?? t`That did not save. Try again.`) });
      } else {
        setWords({});
        setPct("");
        setSaid({ ok: true, text: t`Saved. We told the applicant.` });
        onSaved();
      }
    } catch {
      setSaid({ ok: false, text: t`That did not save. Try again.` });
    } finally {
      setBusy(false);
    }
  };

  const choiceWords = (c: "accept" | "talk") => (c === "accept" ? t`I accept` : t`Let's talk`);
  const stateWords = (s: "accept" | "talk" | "waiting") => (s === "waiting" ? t`Waiting for their answer` : s === "talk" ? t`Let's talk` : t`Agreed`);

  return (
    <section aria-labelledby="terms-we-offer" className={PANEL} data-terms-we-offer="">
      <p className={EYEBROW}>{t`Counter-offer`}</p>
      <h2 id="terms-we-offer" className="font-display text-2xl font-bold text-card-foreground">
        {t`Terms we offer`}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {mayEdit
          ? t`Word any setting for this proposal. Each save is a new revision, the applicant sees what changed and answers it, and the history stays here.`
          : t`The terms as they stand for this proposal. Whoever holds the power to fill roles can change them.`}
      </p>

      <ul className="mt-4 grid gap-3">
        {offer.rows.map((r) => (
          <li key={r.key} className={TILE} data-term-row={r.key}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-foreground">{r.label}</h3>
              <span className="flex flex-wrap gap-1.5">
                {r.theirs && <span className={CHIP}>{t`They said: ${choiceWords(r.theirs.choice)}`}</span>}
                {r.changed && <span className={CHIP} data-term-state={r.state}>{stateWords(r.state)}</span>}
              </span>
            </div>
            <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t`The role suggests`}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{r.suggested ?? t`Not written. We'll set this together.`}</p>
            {r.theirs?.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{t`Their note: ${r.theirs.note}`}</p>}
            {mayEdit ? (
              <label className="mt-3 block">
                <span className="text-sm font-semibold text-foreground">{t`Our wording for this proposal`}</span>
                <textarea
                  rows={3}
                  maxLength={OFFER_WORD_MAX}
                  value={wordsFor(r.key, r.current)}
                  onChange={(e) => setWords((w) => ({ ...w, [r.key]: e.target.value }))}
                  className={`${FIELD} mt-1`}
                />
              </label>
            ) : (
              r.changed && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{t`Our wording: ${r.current ?? ""}`}</p>
            )}
          </li>
        ))}
        <li className={TILE} data-term-row="commitment">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-foreground">{t`Commitment`}</h3>
            <span className={CHIP}>{offer.theirCommitment == null ? t`They have not chosen` : t`They chose ${offer.theirCommitment}%`}</span>
          </div>
          {offer.roleCommitment != null && <p className="mt-2 text-sm text-foreground">{t`The role asks ${offer.roleCommitment}%`}</p>}
          <p className="mt-1 text-sm text-muted-foreground">{t`Energy and attention. We agree it together.`}</p>
          {mayEdit ? (
            <label className="mt-3 block">
              <span className="text-sm font-semibold text-foreground">{t`The commitment we'd agree on`}</span>
              <select value={pct === "" ? String(offer.ourCommitment ?? "") : pct} onChange={(e) => setPct(e.target.value)} className={`${FIELD} mt-1 min-h-11`}>
                {offer.ourCommitment == null && <option value="">{t`Choose`}</option>}
                {COMMITMENT_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}%
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="mt-2 text-sm text-foreground">{offer.ourCommitment == null ? "" : t`We'd agree ${offer.ourCommitment}%`}</p>
          )}
        </li>
      </ul>

      {mayEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={BTN_PRIMARY}>
            {t`Save revision ${offer.revision + 1}`}
          </button>
          {said && (
            <p role="status" className={said.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
              {said.text}
            </p>
          )}
        </div>
      )}

      <details className="mt-5" data-terms-history="">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-notice">{t`History (${offer.history.length})`}</summary>
        {offer.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t`Nothing has been changed yet.`}</p>
        ) : (
          <ol className="mt-2 grid gap-3">
            {offer.history.map((h) => (
              <li key={h.n} className="rounded-xl border border-border/60 p-3 text-sm">
                <p className="font-semibold text-foreground">{t`Revision ${h.n}, ${day(h.at)}, by ${h.by}`}</p>
                <ul className="mt-1 grid gap-1">
                  {h.changes.map((c) => (
                    <li key={c.key} className="break-words text-foreground">
                      <span className="font-semibold">{c.label}: </span>
                      <span className="text-muted-foreground">{c.from ?? t`not set`}</span>
                      {` → `}
                      <span>{c.to ?? t`not set`}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}

/** The warning above an adopt button while a setting is still being talked about. */
export function OpenTalksWarning({ settings, confirmed, onConfirm }: { settings: string[]; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  const { t } = useLingui();
  if (!settings.length) return null;
  return (
    <div className="rounded-xl border-2 border-notice/60 bg-card p-4" role="alert" data-open-talks="">
      <p className="font-semibold text-foreground">{t`We have not agreed these yet: ${settings.join(", ")}.`}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t`Adopting now records the terms as they stand.`}</p>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} className="size-5" />
        {t`I know, and I want to adopt anyway`}
      </label>
    </div>
  );
}
