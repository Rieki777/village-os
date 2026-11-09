/**
 * THE PRICING DESK (quest re-price Q3; the mockup approved 2026-11-09).
 *
 * One desk for the Treasurer: every quest still offered, the engine's
 * suggestion beside it, one tap to use it, one press to use every in-band
 * suggestion, and clear flags for anything outside the band. Above the list,
 * the Treasurer's path: Earned Equity's meaning first (Rye: "make it the first
 * step on the Treasurer's path"), then the village's pay settings, then the
 * hours, then the prices.
 *
 * Hours open as a guess read off the card (`effortGuess`) and must be
 * confirmed before anything is set from them. The suggestion is worked out
 * here with the same pure engine the server uses; every write goes through
 * `PUT /api/quests/:id/pay`, which prices the inputs again and decides.
 * Admin is light-only by ruling.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { exponentOf } from "@shared/money";
import type { ValuationModel, WorkInputs } from "@shared/valuation";
import { suggestValuation, wholeMoney, type PayeeSuggestion } from "@shared/valuationEngine";
import { REASON_CODES } from "@shared/valuationSetting";
import { effortGuess } from "@/lib/questEffortGuess";
import PayDoorNote, { type PayDoor } from "./PayDoorNote";

type Call = (path: string, body?: unknown, method?: string) => Promise<any>;

interface DeskQuest {
  id: string;
  title: string;
  duration: string | null;
  difficulty: string | null;
  valueMinor: number | null;
  valueCurrency: string | null;
  pay: { lines: { token: string; name: string; amount: number }[] } | null;
  latest: { state: string; setMinor: number; inputs: WorkInputs; at: string } | null;
  pastPrices: { setMinor: number; at: string }[];
  openClaims: number;
}
interface DeskRead {
  model: ValuationModel;
  eeMeaningWritten: boolean;
  modelAdopted: boolean;
  cashBudgetLeft: { minor: number; currency: string } | null;
  payDoor?: PayDoor;
  quests: DeskQuest[];
}
interface RowState {
  band: string;
  complexity: string;
  hours: string;
  low: string;
  high: string;
  confirmed: boolean;
  own: string | null;
  reason: string;
  busy: boolean;
}

const input = "w-12 border border-gray-200 rounded-md px-1.5 py-1.5 text-sm bg-white text-center";
const btn = "rounded-lg px-3 py-2 text-sm font-semibold min-h-[40px]";
const primary = `${btn} bg-emerald-800 text-white hover:bg-emerald-900 disabled:opacity-50`;
const ghost = `${btn} border border-emerald-200 text-emerald-800 bg-white hover:bg-emerald-50`;
const label = "block text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:hidden";

const toMinor = (text: string, currency: string): number | null => {
  const n = Number(String(text).replace(/[^0-9.]/g, ""));
  if (!text.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * Math.pow(10, exponentOf(currency)));
};
const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

/** The band a quest most likely sits in, before the Treasurer says: by its difficulty. */
function bandGuess(model: ValuationModel, difficulty: string | null): string {
  const keys = model.bands.map((b) => b.key);
  const at = difficulty === "Advanced" ? 2 : difficulty === "Intermediate" ? 1 : 0;
  return keys[Math.min(at, keys.length - 1)] ?? "";
}

function initialRow(model: ValuationModel, q: DeskQuest): RowState {
  const saved = q.latest?.inputs?.lines?.[0];
  if (saved) {
    return {
      band: saved.band,
      complexity: String(q.latest?.inputs.complexity ?? "routine"),
      hours: String(saved.estimatedHours ?? ""),
      low: saved.estimateLow === undefined ? "" : String(saved.estimateLow),
      high: saved.estimateHigh === undefined ? "" : String(saved.estimateHigh),
      confirmed: true,
      own: null,
      reason: "",
      busy: false,
    };
  }
  const g = effortGuess(q.duration);
  return {
    band: bandGuess(model, q.difficulty),
    complexity: "routine",
    hours: g ? String(g.hours) : "",
    low: g && g.low !== g.hours ? String(g.low) : "",
    high: g && g.high !== g.hours ? String(g.high) : "",
    confirmed: false,
    own: null,
    reason: "",
    busy: false,
  };
}

const workOf = (r: RowState): WorkInputs => ({
  kind: "quest",
  lines: [{ band: r.band, payee: "lead", estimatedHours: Number(r.hours), estimateLow: num(r.low), estimateHigh: num(r.high) }],
  complexity: r.complexity,
});

export default function PricingDesk({ call }: { call: Call }) {
  const { t } = useLingui();
  const [read, setRead] = useState<DeskRead | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await call("/quests/pricing-desk", undefined, "GET");
    if (!d?.model) {
      setFailed(d?.error ?? t({ message: `The desk could not be read.`, context: "pricing desk" }));
      return;
    }
    setRead(d);
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const q of d.quests as DeskQuest[]) next[q.id] = prev[q.id] && !prev[q.id].busy ? { ...prev[q.id], own: null, reason: "" } : initialRow(d.model, q);
      return next;
    });
  }, [call, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const currency = read?.model.currency ?? "";
  const money = (m: number) => wholeMoney(m, currency);

  const priced = useMemo(() => {
    const out: Record<string, { s: PayeeSuggestion | null; problem: string | null; status: "set" | "waiting" | "hours" | "flagged" | "ready" }> = {};
    if (!read) return out;
    for (const q of read.quests) {
      const r = rows[q.id];
      if (!r) continue;
      let s: PayeeSuggestion | null = null;
      let problem: string | null = null;
      if (Number(r.hours) > 0 && r.band) {
        const res = suggestValuation(read.model, workOf(r), { eeMeaningWritten: read.eeMeaningWritten });
        if (res.ok) s = res.payees[0];
        else problem = res.refusals[0]?.problem ?? null;
      }
      const ownMinor = r.own === null ? null : toMinor(r.own, currency);
      const isSet = q.latest?.state === "set" && q.valueMinor === q.latest.setMinor && s?.expected.totalMinor === q.latest.setMinor;
      const status =
        q.latest && q.latest.state !== "set" ? "waiting" :
        isSet && r.own === null ? "set" :
        !r.confirmed || !s ? "hours" :
        ownMinor !== null && (ownMinor < s.band.lowMinor || ownMinor > s.band.highMinor) ? "flagged" :
        "ready";
      out[q.id] = { s, problem, status };
    }
    return out;
  }, [read, rows, currency]);

  const counts = useMemo(() => {
    const c = { ready: 0, hours: 0, flagged: 0, set: 0, waiting: 0 };
    for (const v of Object.values(priced)) c[v.status]++;
    return c;
  }, [priced]);

  const patch = (id: string, p: Partial<RowState>) => setRows((all) => ({ ...all, [id]: { ...all[id], ...p } }));

  const setPrice = async (q: DeskQuest, totalMinor: number, reason?: string): Promise<boolean> => {
    const r = rows[q.id];
    patch(q.id, { busy: true });
    const out = await call(`/quests/${encodeURIComponent(q.id)}/pay`, { work: workOf(r), set: { totalMinor }, ...(reason ? { reason } : {}) }, "PUT");
    patch(q.id, { busy: false });
    if (!out?.success) {
      toast.error(out?.error ?? t({ message: `That price was not set.`, context: "pricing desk" }));
      return false;
    }
    if (out.state === "awaiting_second") toast(t({ message: `${q.title}: waiting for a second Treasurer or a steward to sign.`, context: "pricing desk" }));
    return true;
  };

  const useAllInBand = async () => {
    if (!read) return;
    setBulkBusy(true);
    let done = 0;
    for (const q of read.quests) {
      const p = priced[q.id];
      if (p?.status !== "ready" || !p.s || rows[q.id]?.own !== null) continue;
      if (await setPrice(q, p.s.expected.totalMinor)) done++;
    }
    setBulkBusy(false);
    toast.success(t({ message: `${done} prices set.`, context: "pricing desk" }));
    await load();
  };

  if (failed) return <p className="text-sm text-muted-foreground">{failed}</p>;
  if (!read) return <p className="text-sm text-muted-foreground"><Trans context="pricing desk">Opening the pricing desk…</Trans></p>;

  const step = (done: boolean, now: boolean) =>
    `rounded-xl border p-3 ${done ? "border-emerald-200 bg-emerald-50" : now ? "border-emerald-800 ring-2 ring-emerald-50 bg-white" : "border-gray-200 bg-white"}`;
  const hoursLeft = counts.hours;
  const eeNow = !read.eeMeaningWritten;
  const modelNow = !eeNow && !read.modelAdopted;
  const hoursNow = !eeNow && !modelNow && hoursLeft > 0;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground"><Trans context="pricing desk">Pricing desk</Trans></h1>
      <p className="text-muted-foreground mb-4"><Trans context="pricing desk">Every open quest, the engine's suggestion beside it, and one tap to use it. For the Treasurer.</Trans></p>
      <div className="mb-3"><PayDoorNote door={read.payDoor} /></div>

      <ol className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <li className={step(read.eeMeaningWritten, eeNow)}>
          <b className="block text-sm text-foreground">{read.eeMeaningWritten ? "✓ " : "1 "}<Trans context="pricing desk">Earned Equity meaning</Trans></b>
          <span className="text-sm text-muted-foreground">{read.eeMeaningWritten ? t({ message: `Written`, context: "pricing desk" }) : <a className="underline font-semibold" href="/admin?tab=tokens"><Trans context="pricing desk">Write what it means first</Trans></a>}</span>
        </li>
        <li className={step(read.modelAdopted, modelNow)}>
          <b className="block text-sm text-foreground">{read.modelAdopted ? "✓ " : "2 "}<Trans context="pricing desk">Pay settings adopted</Trans></b>
          <span className="text-sm text-muted-foreground">{read.modelAdopted ? t({ message: `${read.model.currency}, version ${read.model.version}`, context: "pricing desk" }) : t({ message: `The village adopts them by vote`, context: "pricing desk" })}</span>
        </li>
        <li className={step(read.modelAdopted && hoursLeft === 0, hoursNow)}>
          <b className="block text-sm text-foreground">3 <Trans context="pricing desk">Check the hours</Trans></b>
          <span className="text-sm text-muted-foreground">{hoursLeft === 1 ? t({ message: `1 quest still needs yours`, context: "pricing desk" }) : hoursLeft ? t({ message: `${hoursLeft} quests still need yours`, context: "pricing desk" }) : t({ message: `All checked`, context: "pricing desk" })}</span>
        </li>
        <li className={step(false, !eeNow && !modelNow && !hoursNow)}>
          <b className="block text-sm text-foreground">4 <Trans context="pricing desk">Set the prices</Trans></b>
          <span className="text-sm text-muted-foreground">{t({ message: `${counts.ready} ready, ${counts.flagged} flagged`, context: "pricing desk" })}</span>
        </li>
      </ol>

      {!read.cashBudgetLeft && (
        <p className="rounded-xl bg-blue-50 text-blue-900 px-3 py-2 text-sm mb-3">
          <Trans context="pricing desk">No cash budget this moon, so every price is paid in Credits and Earned Equity, with no cash.</Trans>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 my-3">
        <div className="flex flex-wrap gap-2 text-sm font-semibold">
          <span className="rounded-full px-3 py-1 bg-emerald-50 text-emerald-800">{t({ message: `${counts.ready} inside the band`, context: "pricing desk" })}</span>
          <span className="rounded-full px-3 py-1 bg-amber-50 text-amber-900">{t({ message: `${counts.hours} need your hours`, context: "pricing desk" })}</span>
          <span className="rounded-full px-3 py-1 bg-red-50 text-red-800">{t({ message: `${counts.flagged} outside the band`, context: "pricing desk" })}</span>
          <span className="rounded-full px-3 py-1 bg-gray-100 text-muted-foreground">{t({ message: `${counts.set} set`, context: "pricing desk" })}</span>
          {counts.waiting > 0 && <span className="rounded-full px-3 py-1 bg-gray-100 text-muted-foreground">{t({ message: `${counts.waiting} waiting for a signer`, context: "pricing desk" })}</span>}
        </div>
        <button className={`${primary} w-full md:w-auto`} disabled={!read.modelAdopted || bulkBusy || counts.ready === 0} onClick={() => void useAllInBand()}>
          {t({ message: `Use the suggestion on all ${counts.ready} inside the band`, context: "pricing desk" })}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="hidden md:grid grid-cols-[1.6fr_1fr_1.2fr_1.5fr_1fr_1.3fr] gap-3 px-4 pt-2 pb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <div><Trans context="pricing desk">Quest</Trans></div><div><Trans context="pricing desk">Pays today</Trans></div><div><Trans context="pricing desk">Suggestion</Trans></div><div><Trans context="pricing desk">Estimated hours</Trans></div><div><Trans context="pricing desk">Past prices</Trans></div><div />
        </div>
        {read.quests.map((q) => {
          const r = rows[q.id];
          const p = priced[q.id];
          if (!r || !p) return null;
          const today = q.valueMinor !== null && q.latest?.state === "set"
            ? t({ message: `${money(q.valueMinor)} · set ${new Date(q.latest.at).toLocaleDateString()}`, context: "pricing desk" })
            : (q.pay?.lines ?? []).map((l) => `${l.amount} ${l.name}`).join(" + ") || t({ message: `Nothing yet`, context: "pricing desk" });
          const ownMinor = r.own === null ? null : toMinor(r.own, currency);
          return (
            <div key={q.id} className={`grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1.1fr_1.6fr_0.8fr_1.2fr] gap-x-3 gap-y-2 items-center px-3 md:px-4 py-3 border-t border-gray-200 ${p.status === "flagged" ? "bg-red-50/40" : ""}`}>
              <div className="col-span-2 md:col-span-1">
                <b className="block text-foreground">{q.title}</b>
                <span className="flex flex-col items-start text-sm text-muted-foreground">
                  <select aria-label={t({ message: `Kind of work for ${q.title}`, context: "pricing desk" })} className="appearance-none bg-transparent underline decoration-dotted cursor-pointer" value={r.band} onChange={(e) => patch(q.id, { band: e.target.value, confirmed: false })}>
                    {read.model.bands.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                  <select aria-label={t({ message: `Conditions for ${q.title}`, context: "pricing desk" })} className="appearance-none bg-transparent underline decoration-dotted cursor-pointer" value={r.complexity} onChange={(e) => patch(q.id, { complexity: e.target.value, confirmed: false })}>
                    {read.model.complexity.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </span>
              </div>
              <div className="text-sm text-muted-foreground"><span className={label}><Trans context="pricing desk">Pays today</Trans></span>{today}</div>
              <div>
                <span className={label}><Trans context="pricing desk">Suggestion</Trans></span>
                {p.s ? (
                  <>
                    <b className="text-base text-foreground">{money(p.s.expected.totalMinor)}</b>
                    <span className="block text-xs text-muted-foreground">{t({ message: `Likely ${money(p.s.range.lowTotalMinor)} to ${money(p.s.range.highTotalMinor)}`, context: "pricing desk" })}</span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">{p.problem ?? t({ message: `Give the hours`, context: "pricing desk" })}</span>
                )}
              </div>
              <div className="flex flex-nowrap items-center gap-1.5 text-sm col-span-2 md:col-span-1">
                <span className={`${label} mr-1`}><Trans context="pricing desk">Hours</Trans></span>
                <input aria-label={t({ message: `Estimated hours for ${q.title}`, context: "pricing desk" })} inputMode="decimal" className={`${input} ${r.confirmed ? "" : "border-amber-500 bg-amber-50"}`} value={r.hours} onChange={(e) => patch(q.id, { hours: e.target.value, confirmed: false })} />
                <span className="text-muted-foreground"><Trans context="pricing desk">from</Trans></span>
                <input aria-label={t({ message: `As little as, for ${q.title}`, context: "pricing desk" })} inputMode="decimal" className={input} value={r.low} onChange={(e) => patch(q.id, { low: e.target.value, confirmed: false })} />
                <span className="text-muted-foreground"><Trans context="pricing desk">to</Trans></span>
                <input aria-label={t({ message: `As much as, for ${q.title}`, context: "pricing desk" })} inputMode="decimal" className={input} value={r.high} onChange={(e) => patch(q.id, { high: e.target.value, confirmed: false })} />
              </div>
              <div className="text-sm text-muted-foreground">
                <span className={label}><Trans context="pricing desk">Past prices</Trans></span>
                {q.pastPrices.length ? q.pastPrices.map((x) => money(x.setMinor)).join(", ") : t({ message: `None yet`, context: "pricing desk" })}
              </div>
              <div className="col-span-2 md:col-span-1 flex md:flex-col gap-1.5">
                {p.status === "set" && <span className="flex-1 text-center rounded-full bg-gray-100 text-muted-foreground py-2 text-sm font-semibold"><Trans context="pricing desk">Set</Trans></span>}
                {p.status === "waiting" && <span className="flex-1 text-center rounded-full bg-gray-100 text-muted-foreground py-2 text-sm font-semibold"><Trans context="pricing desk">Waiting for a signer</Trans></span>}
                {p.status === "hours" && (
                  <button className={`${ghost} flex-1`} disabled={!p.s} onClick={() => patch(q.id, { confirmed: true })}>
                    <Trans context="pricing desk">Confirm the hours first</Trans>
                  </button>
                )}
                {(p.status === "ready" || p.status === "flagged") && p.s && (
                  r.own === null ? (
                    <>
                      <button className={`${primary} flex-1`} disabled={r.busy || !read.modelAdopted} onClick={() => void setPrice(q, p.s!.expected.totalMinor).then(async (ok) => { if (ok) await load(); })}>
                        {t({ message: `Use ${money(p.s.expected.totalMinor)}`, context: "pricing desk" })}
                      </button>
                      <button className={`${ghost} flex-1`} onClick={() => patch(q.id, { own: "" })}><Trans context="pricing desk">Own figure</Trans></button>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col gap-1.5">
                      <span className={label}><Trans context="pricing desk">Your figure</Trans></span>
                      <input aria-label={t({ message: `Your figure for ${q.title}`, context: "pricing desk" })} inputMode="decimal" className={`w-full border rounded-md px-2 py-2 text-sm ${p.status === "flagged" ? "border-red-300 bg-red-50 text-red-800 font-semibold" : "border-gray-200 bg-white"}`} value={r.own} onChange={(e) => patch(q.id, { own: e.target.value })} />
                      <div className="flex gap-1.5">
                        <button
                          className={`${p.status === "flagged" ? `${btn} bg-red-700 text-white disabled:opacity-50` : primary} flex-1`}
                          disabled={r.busy || ownMinor === null || (p.status === "flagged" && !r.reason)}
                          onClick={() => void setPrice(q, ownMinor!, p.status === "flagged" ? r.reason : undefined).then(async (ok) => { if (ok) await load(); })}
                        >
                          {p.status === "flagged" ? t({ message: `Send for signing`, context: "pricing desk" }) : t({ message: `Set`, context: "pricing desk" })}
                        </button>
                        <button className={`${ghost}`} onClick={() => patch(q.id, { own: null, reason: "" })}><Trans context="pricing desk">Cancel</Trans></button>
                      </div>
                    </div>
                  )
                )}
              </div>
              {p.status === "flagged" && p.s && ownMinor !== null && (
                <div className="col-span-2 md:col-span-6 rounded-lg bg-red-50 text-red-800 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
                  <span>
                    {ownMinor > p.s.band.highMinor
                      ? t({ message: `${money(ownMinor)} is above the band (${money(p.s.band.lowMinor)} to ${money(p.s.band.highMinor)}). Pick a reason, then a second Treasurer or a steward signs it.`, context: "pricing desk" })
                      : t({ message: `${money(ownMinor)} is below the band (${money(p.s.band.lowMinor)} to ${money(p.s.band.highMinor)}). Pick a reason, then a second Treasurer or a steward signs it.`, context: "pricing desk" })}
                  </span>
                  <select aria-label={t({ message: `Reason for ${q.title}`, context: "pricing desk" })} className="border border-red-200 rounded-md px-2 py-1 bg-white text-sm" value={r.reason} onChange={(e) => patch(q.id, { reason: e.target.value })}>
                    <option value="">{t({ message: `Pick a reason`, context: "pricing desk" })}</option>
                    {REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {q.openClaims > 0 && (
                <div className="col-span-2 md:col-span-6 rounded-lg bg-blue-50 text-blue-900 px-3 py-2 text-sm">
                  {q.openClaims === 1 ? t({ message: `1 open claim keeps the price it was taken at.`, context: "pricing desk" }) : t({ message: `${q.openClaims} open claims keep the price they were taken at.`, context: "pricing desk" })}{" "}
                  <a className="underline font-semibold" href={`/quests/${encodeURIComponent(q.id)}#take-current-price`}><Trans context="pricing desk">Its worker takes the new price here</Trans></a>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground mt-3"><Trans context="pricing desk">The hours are an estimate that sets the price. Members see the price, never the hours. Every figure is kept beside its suggestion, so past prices fill in as quests are done.</Trans></p>
    </div>
  );
}
