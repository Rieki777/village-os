/**
 * THE REVIEW PANEL on an application's page (role journey L5): the ordered
 * conversations, the viewer's own scorecard form, the scorecards the rule lets
 * them read, one-click recusal, and the two doors for a decider who is stuck
 * (the moon ended; nobody can adopt at the door).
 *
 * The rules are shared/applicationReview.ts and the doors are
 * server/routes/applicationReview.ts. A scorecard is named by the interviewing
 * ROLE, never the person. The applicant never reaches this panel: the door
 * answers 404 and the panel renders nothing.
 */
import { useCallback, useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import { LEVEL_WORDS, PANEL_WORDS, SCORE_LEVELS, EVIDENCE_MAX, type Criterion, type ScoreLevel } from "@shared/applicationReview";

interface Card {
  criteria: Criterion[];
  mayRead: boolean;
  mayScore: { interviewId: number; position: number; minutes: number } | null;
  interviews: Array<{ position: number; roleName: string; minutes: number; final: boolean; state: string; entries: Array<{ criterionId: string; level: string; evidence: string }> | null }>;
}

const SECONDARY =
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-400 px-4 text-sm font-semibold text-stone-800 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:opacity-50";
const PRIMARY =
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-50";

async function call(path: string, method: "GET" | "POST", body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await gameFetch(path, { method, cache: "no-store", ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export interface ReviewPanelProps {
  applicationRef: string;
  /** The page reloads its own data after an act here. */
  onChanged?: () => void;
  /** The moon the proposal was for has ended and the viewer may adopt: offers the moon running now. */
  moonEnded?: boolean;
  mayAdopt?: boolean;
  /** Nobody can adopt at the door and the viewer is a member: offers the village's vote. */
  nobodyAtTheDoor?: boolean;
}

export default function ReviewPanel({ applicationRef, onChanged, moonEnded, mayAdopt, nobodyAtTheDoor }: ReviewPanelProps) {
  const [card, setCard] = useState<Card | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Record<string, { level: ScoreLevel | ""; evidence: string }>>({});
  const [stepping, setStepping] = useState(false);
  const [reason, setReason] = useState("");

  const base = `/api/governance/applications/${encodeURIComponent(applicationRef)}`;

  const load = useCallback(async () => {
    const a = await call(`${base}/scorecards`, "GET");
    if (a.ok) {
      setCard(a.data.scorecards as Card);
      setHidden(a.data.words ?? null);
    } else setCard(null);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // No review (an older application), or the viewer is the applicant: nothing is shown, and nothing says why.
  if (!card || card.interviews.length === 0) {
    return moonEnded && mayAdopt ? <MoonDoor applicationRef={applicationRef} onChanged={onChanged} /> : null;
  }

  const submit = async () => {
    if (!card.mayScore) return;
    setBusy(true);
    setSaid(null);
    const body = { entries: card.criteria.map((c) => ({ criterionId: c.id, level: entries[c.id]?.level ?? "", evidence: entries[c.id]?.evidence ?? "" })) };
    const a = await call(`${base}/interviews/${card.mayScore.interviewId}/score`, "POST", body);
    setBusy(false);
    setSaid({ ok: a.ok, text: a.ok ? PANEL_WORDS.submitted : String(a.data?.error ?? "That did not save.") });
    if (a.ok) {
      setEntries({});
      await load();
      onChanged?.();
    }
  };

  const stepOut = async () => {
    setBusy(true);
    const a = await call(`${base}/recuse`, "POST", { reason: reason || undefined });
    setBusy(false);
    setStepping(false);
    setSaid({ ok: a.ok, text: a.ok ? String(a.data?.message ?? "") : String(a.data?.error ?? "That did not save.") });
    await load();
    onChanged?.();
  };

  const criterionText = (id: string) => card.criteria.find((c) => c.id === id)?.text ?? id;

  return (
    <section aria-labelledby="rv-heading" className="rounded-xl border border-stone-200 bg-white p-5" data-review-panel="">
      <h2 id="rv-heading" className="text-lg font-bold text-stone-900">
        {PANEL_WORDS.heading}
      </h2>
      <p className="mt-1 text-sm text-stone-700">{PANEL_WORDS.intro}</p>

      <ol className="mt-4 space-y-3">
        {card.interviews.map((iv) => (
          <li key={iv.position} className="rounded-lg border border-stone-200 p-3" data-interview-state={iv.state}>
            <p className="font-semibold text-stone-900">
              {iv.position}. {iv.roleName} <span className="font-normal text-stone-600">· {PANEL_WORDS.minutes(iv.minutes)}</span>
              {iv.final && <span className="ml-2 rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-800">{PANEL_WORDS.final}</span>}
            </p>
            <p className="text-sm text-stone-600">{iv.state === "open" ? PANEL_WORDS.open : iv.state === "scored" ? PANEL_WORDS.scored : iv.state === "skipped" ? PANEL_WORDS.skipped : PANEL_WORDS.waiting}</p>
            {iv.entries && (
              <dl className="mt-2 space-y-1">
                {iv.entries.map((e) => (
                  <div key={e.criterionId}>
                    <dt className="text-sm font-semibold text-stone-700">{criterionText(e.criterionId)}</dt>
                    <dd className="text-stone-900">
                      <span className="font-semibold">{LEVEL_WORDS[e.level as ScoreLevel] ?? e.level}</span>
                      {": "}
                      {e.evidence}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
      {!card.mayRead && hidden && <p className="mt-3 text-sm text-stone-600">{hidden}</p>}

      {card.mayScore && (
        <form
          className="mt-5 space-y-4"
          aria-label={PANEL_WORDS.submit}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="font-semibold text-stone-900">{PANEL_WORDS.yourTurn(card.mayScore.minutes)}</p>
          {card.criteria.map((c) => (
            <fieldset key={c.id} className="space-y-2">
              <legend className="font-medium text-stone-900">{c.text}</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${PANEL_WORDS.levelLabel}: ${c.text}`}>
                {SCORE_LEVELS.map((l) => (
                  <label key={l} className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm">
                    <input
                      type="radio"
                      name={`lv-${c.id}`}
                      value={l}
                      checked={entries[c.id]?.level === l}
                      onChange={() => setEntries((m) => ({ ...m, [c.id]: { level: l, evidence: m[c.id]?.evidence ?? "" } }))}
                    />
                    {LEVEL_WORDS[l]}
                  </label>
                ))}
              </div>
              <label className="block text-sm text-stone-700">
                {PANEL_WORDS.evidenceLabel}
                <input
                  type="text"
                  maxLength={EVIDENCE_MAX}
                  className="mt-1 block min-h-[44px] w-full rounded-lg border border-stone-300 px-3"
                  value={entries[c.id]?.evidence ?? ""}
                  onChange={(e) => setEntries((m) => ({ ...m, [c.id]: { level: m[c.id]?.level ?? "", evidence: e.target.value } }))}
                />
              </label>
            </fieldset>
          ))}
          <button type="submit" disabled={busy} className={PRIMARY}>
            {PANEL_WORDS.submit}
          </button>
        </form>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {!stepping ? (
          <button type="button" className={SECONDARY} onClick={() => setStepping(true)}>
            {PANEL_WORDS.recuse}
          </button>
        ) : (
          <div role="group" aria-label={PANEL_WORDS.recuse} className="w-full rounded-lg border border-stone-300 p-3">
            <p className="text-stone-800">{PANEL_WORDS.recuseAsk}</p>
            <label className="mt-2 block text-sm text-stone-700">
              {PANEL_WORDS.reasonLabel}
              <input type="text" maxLength={300} className="mt-1 block min-h-[44px] w-full rounded-lg border border-stone-300 px-3" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={PRIMARY} onClick={() => void stepOut()}>
                {PANEL_WORDS.recuseYes}
              </button>
              <button type="button" className={SECONDARY} onClick={() => setStepping(false)}>
                {PANEL_WORDS.recuseNo}
              </button>
            </div>
          </div>
        )}
        {moonEnded && mayAdopt && <MoonDoor applicationRef={applicationRef} onChanged={onChanged} />}
        {nobodyAtTheDoor && <VillageDoor applicationRef={applicationRef} onChanged={onChanged} />}
      </div>
      {said && (
        <p role={said.ok ? "status" : "alert"} className={`mt-3 text-sm font-medium ${said.ok ? "text-sage" : "text-coral"}`}>
          {said.text}
        </p>
      )}
    </section>
  );
}

function MoonDoor({ applicationRef, onChanged }: { applicationRef: string; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        className={SECONDARY}
        onClick={async () => {
          setBusy(true);
          const a = await call(`/api/governance/open-proposals/${encodeURIComponent(applicationRef)}/adopt`, "POST", { forCurrentMoon: true });
          setBusy(false);
          setText(String(a.data?.message ?? a.data?.error ?? ""));
          if (a.ok) onChanged?.();
        }}
      >
        {PANEL_WORDS.adoptThisMoon}
      </button>
      {text && <p className="mt-2 text-sm text-stone-700">{text}</p>}
    </div>
  );
}

function VillageDoor({ applicationRef, onChanged }: { applicationRef: string; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  return (
    <div>
      <p className="mb-2 text-sm text-stone-700">{PANEL_WORDS.toTheVillageLine}</p>
      <button
        type="button"
        disabled={busy}
        className={SECONDARY}
        onClick={async () => {
          setBusy(true);
          const a = await call(`/api/governance/open-proposals/${encodeURIComponent(applicationRef)}/to-the-village`, "POST");
          setBusy(false);
          setText(a.ok ? String(a.data?.next ?? "") : String(a.data?.message ?? a.data?.error ?? ""));
          if (a.ok) onChanged?.();
        }}
      >
        {PANEL_WORDS.toTheVillage}
      </button>
      {text && <p className="mt-2 text-sm text-stone-700">{text}</p>}
    </div>
  );
}
