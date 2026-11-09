/**
 * PRICING A NEW QUEST WITH THE VILLAGE'S RULE (quest re-price Q3b, spec
 * quest-reprice.md 3c: "The quest editor gains the engine's inputs").
 *
 * The poster says the kind of work, the hours and the conditions; the same
 * pure engine the server uses suggests the price as they type; "Use this
 * price" fills the editor's boxes with exactly what the pay door stores for it
 * (`draftFromEngine`). After the quest is posted, the editor records the
 * figure beside its inputs through `PUT /api/quests/:id/pay`, so the pricing
 * desk shows the quest as set. Optional: a poster who skips it posts with
 * their own figure, as before. Admin is light-only by ruling.
 */
import { useEffect, useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ValuationModel, WorkInputs } from "@shared/valuation";
import { suggestValuation, wholeMoney } from "@shared/valuationEngine";
import type { PayOption, WorkValueDraft } from "@/components/WorkValueEditor";
import { draftFromEngine } from "@/lib/engineQuestDraft";
import { gameFetch } from "@/lib/gameApi";

type ModelRead = { model: ValuationModel; eeMeaningWritten: boolean; tokenNames: Record<string, string> };

/** What the editor keeps once a price is used: the inputs it was set beside, and the boxes as filled. */
export interface EngineUse {
  work: WorkInputs;
  totalMinor: number;
  value: string;
}

const field = "w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white";
const label = "block text-xs text-muted-foreground mb-1";

export default function QuestEnginePrice({
  offered,
  currency,
  onUse,
}: {
  offered: readonly PayOption[] | null;
  currency: string;
  onUse: (draft: WorkValueDraft, use: EngineUse) => void;
}) {
  const { t } = useLingui();
  const [read, setRead] = useState<ModelRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [band, setBand] = useState("");
  const [complexity, setComplexity] = useState("routine");
  const [hours, setHours] = useState("");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");

  useEffect(() => {
    let alive = true;
    // A quiet read: a poster who cannot read the pay settings just types a price.
    gameFetch("/api/valuation/model")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        if (!alive) return;
        if (!d?.model) return setFailed(true);
        setRead(d);
        setBand((b) => b || d.model.bands[0]?.key || "");
      });
    return () => {
      alive = false;
    };
  }, []);

  const model = read?.model ?? null;
  const work: WorkInputs | null = useMemo(() => {
    const h = Number(hours);
    if (!band || !(h > 0)) return null;
    const line = { band, payee: "lead" as const, estimatedHours: h, ...(Number(low) > 0 ? { estimateLow: Number(low) } : {}), ...(Number(high) > 0 ? { estimateHigh: Number(high) } : {}) };
    return { kind: "quest", lines: [line], complexity };
  }, [band, hours, low, high, complexity]);
  const suggestion = useMemo(() => {
    if (!model || !work) return null;
    const s = suggestValuation(model, work, { eeMeaningWritten: !!read?.eeMeaningWritten });
    return s.ok ? { ok: true as const, payee: s.payees[0] } : { ok: false as const, problem: s.refusals[0]?.problem ?? "" };
  }, [model, work, read]);

  if (failed) return null;
  if (!read || !model) return <p className="text-xs text-muted-foreground"><Trans context="quest editor">Reading the village's pay settings…</Trans></p>;
  if (model.bands.length === 0) {
    return <p className="text-xs text-muted-foreground"><Trans context="quest editor">The village has not set its rates yet, so there is no suggested price. Set them on the economics page, or type a price below.</Trans></p>;
  }

  const s = suggestion?.ok ? suggestion.payee : null;
  const filled = s && offered && currency ? draftFromEngine(model, s.expected.totalMinor, { eeHeld: s.expected.earnedEquityHeld > 0, offered, currency }) : null;
  const tokenName = (slug: string) => read.tokenNames[slug] ?? slug;

  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 space-y-2" data-quest-engine-price>
      <p className="text-sm font-medium text-foreground"><Trans context="quest editor">Price it with the village's rule (optional)</Trans></p>
      <div className="grid gap-2 sm:grid-cols-5 items-end">
        <label className="sm:col-span-2">
          <span className={label}><Trans context="quest editor">Kind of work</Trans></span>
          <select className={field} value={band} onChange={(e) => setBand(e.target.value)}>
            {model.bands.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>
        <label>
          <span className={label}><Trans context="quest editor">Hours it takes</Trans></span>
          <input className={field} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label>
          <span className={label}><Trans context="quest editor">As little as</Trans></span>
          <input className={field} inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
        </label>
        <label>
          <span className={label}><Trans context="quest editor">As much as</Trans></span>
          <input className={field} inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className={label}><Trans context="quest editor">Conditions</Trans></span>
          <select className={field} value={complexity} onChange={(e) => setComplexity(e.target.value)}>
            {model.complexity.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
      </div>
      {suggestion && !suggestion.ok && <p className="text-sm text-muted-foreground">{suggestion.problem}</p>}
      {s && filled && work && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-foreground">
            {t({ message: `Suggested ${wholeMoney(s.expected.totalMinor, model.currency)}, likely ${wholeMoney(s.range.lowTotalMinor, model.currency)} to ${wholeMoney(s.range.highTotalMinor, model.currency)}.`, context: "quest editor" })}
          </p>
          <button
            type="button"
            className="rounded-lg bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-900"
            onClick={() => onUse(filled.draft, { work, totalMinor: s.expected.totalMinor, value: filled.draft.value })}
          >
            <Trans context="quest editor">Use this price</Trans>
          </button>
          {filled.voiceHeld && <p className="w-full text-xs text-muted-foreground"><Trans context="quest editor">Voice starts when the village adopts its own pay settings.</Trans></p>}
          {s.expected.earnedEquityHeld > 0 && <p className="w-full text-xs text-muted-foreground"><Trans context="quest editor">Earned Equity is owed on this quest until the village writes what Earned Equity means.</Trans></p>}
          {filled.unoffered.length > 0 && (
            <p className="w-full text-xs text-amber-800">
              {t({ message: `The rule pays ${filled.unoffered.map(tokenName).join(", ")}, which quests do not pay here yet. Turn it on in the quest pay rules first.`, context: "quest editor" })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
