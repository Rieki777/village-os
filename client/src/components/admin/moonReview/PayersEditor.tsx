/**
 * THE PAYERS, edited by a `cash.pay` holder (decision 22). Each payer's legal
 * name, address, tax number, country, currencies, where invoices go and who
 * is copied, the invoicing switch, the routes it pays, and its authority as a
 * note. The server validates with `parsePayers` and records every change.
 *
 * Light-only, like the rest of this folder.
 */
import { useEffect, useState } from "react";
import {
  ADMIN_WORDS, AUTHORITY_KINDS, AUTHORITY_KIND_WORDS, INVOICING_ROUTES, PAY_ROUTE_SHORT_WORDS,
  type AuthorityKind, type Payer, type PayersDoc, type PayRoute,
} from "@shared/moonRecap";
import SaveBar from "@/components/SaveBar";
import { docChangeCount } from "@/lib/unsavedChanges";
import { buttonClass, inputClass, labelClass, listOf, primaryClass, useSettingsDocument } from "./useSettingsDocument";

const W = ADMIN_WORDS.payers;

const blank = (): Payer => ({
  key: "", legalName: "", address: "", taxId: null, country: "", currencies: [], invoiceTo: "", invoiceCc: [], invoicing: false, routes: [],
  authority: { kind: "none", date: null, routes: [], monthlyCeilingMinor: null, ceilingCurrency: null, filedWhere: null },
  queueNote: null,
});

/** The form keeps lists as the words a person types; they become lists on save. */
interface Draft extends Omit<Payer, "currencies" | "invoiceCc"> {
  currencies: string;
  invoiceCc: string;
}

const toDraft = (p: Payer): Draft => ({ ...p, currencies: p.currencies.join(", "), invoiceCc: p.invoiceCc.join(", ") });
const fromDraft = (d: Draft): Payer => ({
  ...d,
  key: d.key.trim(),
  currencies: listOf(d.currencies).map((c) => c.toUpperCase()),
  invoiceCc: listOf(d.invoiceCc),
  taxId: d.taxId?.trim() || null,
  queueNote: d.queueNote?.trim() || null,
});

export default function PayersEditor({ password }: { password: string }) {
  const { state, save, saving, message } = useSettingsDocument<PayersDoc>("payers", password);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    if (state.kind === "ready") setDrafts(state.doc.payers.map(toDraft));
  }, [state]);

  if (state.kind === "loading" || state.kind === "off") return null;
  if (state.kind === "refused") return <p role="alert" className="text-sm text-foreground">{state.text}</p>;

  const set = (i: number, patch: Partial<Draft>) => setDrafts((all) => all.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const setAuthority = (i: number, patch: Partial<Payer["authority"]>) =>
    setDrafts((all) => all.map((d, k) => (k === i ? { ...d, authority: { ...d.authority, ...patch } } : d)));
  const toggleRoute = (i: number, r: PayRoute) =>
    set(i, { routes: drafts[i].routes.includes(r) ? drafts[i].routes.filter((x) => x !== r) : [...drafts[i].routes, r] });

  return (
    <div className="space-y-4">
      {state.gaps.length > 0 && (
        <p data-testid="payers-gap" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-foreground">{W.empty}</p>
      )}
      {drafts.map((d, i) => (
        <fieldset key={i} className="space-y-3 rounded-xl border border-border bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">{d.legalName || W.newPayer}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>{W.key}<input className={inputClass} value={d.key} onChange={(e) => set(i, { key: e.target.value })} /></label>
            <label className={labelClass}>{W.legalName}<input className={inputClass} value={d.legalName} onChange={(e) => set(i, { legalName: e.target.value })} /></label>
            <label className={labelClass}>{W.address}<input className={inputClass} value={d.address} onChange={(e) => set(i, { address: e.target.value })} /></label>
            <label className={labelClass}>{W.taxId}<input className={inputClass} value={d.taxId ?? ""} onChange={(e) => set(i, { taxId: e.target.value })} /></label>
            <label className={labelClass}>{W.country}<input className={inputClass} maxLength={2} value={d.country} onChange={(e) => set(i, { country: e.target.value.toUpperCase() })} /></label>
            <label className={labelClass}>{W.currencies}<input className={inputClass} value={d.currencies} onChange={(e) => set(i, { currencies: e.target.value })} /></label>
            <label className={labelClass}>{W.invoiceTo}<input className={inputClass} value={d.invoiceTo} onChange={(e) => set(i, { invoiceTo: e.target.value })} /></label>
            <label className={labelClass}>{W.invoiceCc}<input className={inputClass} value={d.invoiceCc} onChange={(e) => set(i, { invoiceCc: e.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={d.invoicing} onChange={(e) => set(i, { invoicing: e.target.checked })} />
            {W.invoicing}
          </label>
          <div>
            <p className={labelClass}>{W.routes}</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {INVOICING_ROUTES.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={d.routes.includes(r)} onChange={() => toggleRoute(i, r)} />
                  {PAY_ROUTE_SHORT_WORDS[r]}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <p className={`${labelClass} sm:col-span-3`}>{W.authority}</p>
            <label className={labelClass}>{W.authorityKind}
              <select className={inputClass} value={d.authority.kind} onChange={(e) => setAuthority(i, { kind: e.target.value as AuthorityKind })}>
                {AUTHORITY_KINDS.map((k) => <option key={k} value={k}>{AUTHORITY_KIND_WORDS[k]}</option>)}
              </select>
            </label>
            <label className={labelClass}>{W.authorityDate}<input type="date" className={inputClass} value={d.authority.date ?? ""} onChange={(e) => setAuthority(i, { date: e.target.value || null })} /></label>
            <label className={labelClass}>{W.filedWhere}<input className={inputClass} value={d.authority.filedWhere ?? ""} onChange={(e) => setAuthority(i, { filedWhere: e.target.value || null })} /></label>
            <label className={labelClass}>{W.ceiling}
              <input type="number" min={0} className={inputClass} value={d.authority.monthlyCeilingMinor ?? ""}
                onChange={(e) => setAuthority(i, { monthlyCeilingMinor: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className={labelClass}>{W.ceilingCurrency}<input className={inputClass} maxLength={3} value={d.authority.ceilingCurrency ?? ""} onChange={(e) => setAuthority(i, { ceilingCurrency: e.target.value.toUpperCase() || null })} /></label>
          </div>
          <label className={labelClass}>{W.queueNote}<textarea className={inputClass} rows={2} value={d.queueNote ?? ""} onChange={(e) => set(i, { queueNote: e.target.value })} /></label>
          <button type="button" className={buttonClass} onClick={() => setDrafts((all) => all.filter((_, k) => k !== i))}>{W.remove}</button>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => setDrafts((all) => [...all, toDraft(blank())])}>{W.add}</button>
        {message?.ok && <p role="status" className="text-sm text-foreground">{message.text}</p>}
      </div>
      <SaveBar count={docChangeCount(state.kind === "ready" ? JSON.stringify(state.doc.payers.map(toDraft)) : null, JSON.stringify(drafts))} onSave={() => save({ payers: drafts.map(fromDraft) })} onDiscard={() => setDrafts((state as { doc: PayersDoc }).doc.payers.map(toDraft))} what="the payers" />
    </div>
  );
}
