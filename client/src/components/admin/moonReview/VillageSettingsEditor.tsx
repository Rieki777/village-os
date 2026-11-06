/**
 * THE VILLAGE'S MOON-REVIEW SETTINGS, edited by a `cash.pay` holder (decision
 * 22): the host country and its VAT rate, rate source and currency, the tax
 * forms kept on file and the routes that need one, the holds, and the pilot
 * acknowledgement with its version. The route and attestation words are
 * templates filled from these. The server validates with
 * `parseMoonReviewSettings` and records every change.
 *
 * Light-only, like the rest of this folder.
 */
import { useEffect, useState } from "react";
import { ADMIN_WORDS, INVOICING_ROUTES, PAY_ROUTE_SHORT_WORDS, type MoonReviewSettings, type PayRoute } from "@shared/moonRecap";
import { buttonClass, inputClass, labelClass, primaryClass, useSettingsDocument } from "./useSettingsDocument";

const W = ADMIN_WORDS.settings;

interface Draft {
  hostCode: string;
  hostName: string;
  /** A percent as typed, such as "13". Stored in basis points. */
  vat: string;
  rateSource: string;
  currency: string;
  ackText: string;
  ackVersion: string;
  taxForms: Array<{ key: string; label: string }>;
  taxFormRoutes: PayRoute[];
  holds: Array<{ taxFormKey: string; workCountry: string; note: string }>;
  seraInbox: string;
}

const toDraft = (s: MoonReviewSettings): Draft => ({
  hostCode: s.hostCountry?.code ?? "",
  hostName: s.hostCountry?.name ?? "",
  vat: s.hostVatRateBp === null ? "" : String(s.hostVatRateBp / 100),
  rateSource: s.hostRateSource ?? "",
  currency: s.hostCurrency ?? "",
  ackText: s.pilotAck?.text ?? "",
  ackVersion: s.pilotAck?.version ?? "",
  taxForms: s.taxForms.map((f) => ({ ...f })),
  taxFormRoutes: [...s.taxFormRoutes],
  holds: s.holds.map((h) => ({ ...h })),
  seraInbox: s.seraInbox ?? "",
});

/** Empty fields send null, so the server's parser answers for each one. */
export const fromDraft = (d: Draft): Record<string, unknown> => ({
  hostCountry: d.hostCode.trim() || d.hostName.trim() ? { code: d.hostCode.trim(), name: d.hostName.trim() } : null,
  hostVatRateBp: d.vat.trim() === "" ? null : Math.round(Number(d.vat) * 100),
  hostRateSource: d.rateSource.trim() || null,
  hostCurrency: d.currency.trim() || null,
  pilotAck: d.ackText.trim() || d.ackVersion.trim() ? { text: d.ackText.trim(), version: d.ackVersion.trim() } : null,
  taxForms: d.taxForms,
  taxFormRoutes: d.taxFormRoutes,
  holds: d.holds,
  seraInbox: d.seraInbox.trim() || null,
});

export default function VillageSettingsEditor({ password }: { password: string }) {
  const { state, save, saving, message, decideInbox } = useSettingsDocument<MoonReviewSettings>("settings", password);
  const [d, setD] = useState<Draft | null>(null);

  useEffect(() => {
    if (state.kind === "ready") setD(toDraft(state.doc));
  }, [state]);

  if (state.kind === "loading" || state.kind === "off") return null;
  if (state.kind === "refused") return <p role="alert" className="text-sm text-foreground">{state.text}</p>;
  if (!d) return null;

  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const gap = (key: string) => state.gaps.some((g) => g.key === key);
  const toggleRoute = (r: PayRoute) => set({ taxFormRoutes: d.taxFormRoutes.includes(r) ? d.taxFormRoutes.filter((x) => x !== r) : [...d.taxFormRoutes, r] });

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-white p-4">
        {gap("country") && <p data-testid="country-gap" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-foreground">{W.hostMissing}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>{W.hostCode}<input className={inputClass} maxLength={2} value={d.hostCode} onChange={(e) => set({ hostCode: e.target.value.toUpperCase() })} /></label>
          <label className={labelClass}>{W.hostName}<input className={inputClass} value={d.hostName} onChange={(e) => set({ hostName: e.target.value })} /></label>
          <label className={labelClass}>{W.vat}<input type="number" min={0} max={100} step="0.01" className={inputClass} value={d.vat} onChange={(e) => set({ vat: e.target.value })} /></label>
          <label className={labelClass}>{W.currency}<input className={inputClass} maxLength={3} value={d.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></label>
          <label className={`${labelClass} sm:col-span-2`}>{W.rateSource}<input className={inputClass} value={d.rateSource} onChange={(e) => set({ rateSource: e.target.value })} /></label>
          <label className={`${labelClass} sm:col-span-2`}>{W.seraInbox}<input type="email" className={inputClass} maxLength={254} value={d.seraInbox} onChange={(e) => set({ seraInbox: e.target.value })} /><span className="mt-1 block text-xs text-muted-foreground">{W.seraInboxHint}</span></label>
          {state.kind === "ready" && state.pendingSeraInbox ? (
            <div data-testid="sera-inbox-pending" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-foreground sm:col-span-2">
              <p className="m-0">{W.seraInboxPending(state.pendingSeraInbox.address)}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryClass} onClick={() => void decideInbox("confirm")}>{W.seraInboxConfirm}</button>
                <button type="button" className={buttonClass} onClick={() => void decideInbox("cancel")}>{W.seraInboxCancel}</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-white p-4">
        {gap("pilotAck") && <p data-testid="ack-gap" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-foreground">{W.ackMissing}</p>}
        <label className={labelClass}>{W.ackText}<textarea className={inputClass} rows={3} value={d.ackText} onChange={(e) => set({ ackText: e.target.value })} /></label>
        <label className={labelClass}>{W.ackVersion}<input className={inputClass} value={d.ackVersion} onChange={(e) => set({ ackVersion: e.target.value })} /></label>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-white p-4">
        <p className={labelClass}>{W.taxForms}</p>
        {d.taxForms.map((f, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <label className={labelClass}>{W.formKey}<input className={inputClass} maxLength={8} value={f.key} onChange={(e) => set({ taxForms: d.taxForms.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)) })} /></label>
            <label className={labelClass}>{W.formLabel}<input className={inputClass} value={f.label} onChange={(e) => set({ taxForms: d.taxForms.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} /></label>
            <button type="button" className={`${buttonClass} self-end`} onClick={() => set({ taxForms: d.taxForms.filter((_, k) => k !== i) })}>{W.remove}</button>
          </div>
        ))}
        <button type="button" className={buttonClass} onClick={() => set({ taxForms: [...d.taxForms, { key: "", label: "" }] })}>{W.addForm}</button>
        <p className={labelClass}>{W.formRoutes}</p>
        <div className="flex flex-wrap gap-3">
          {INVOICING_ROUTES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={d.taxFormRoutes.includes(r)} onChange={() => toggleRoute(r)} />
              {PAY_ROUTE_SHORT_WORDS[r]}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-white p-4">
        <p className={labelClass}>{W.holds}</p>
        {d.holds.map((h, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
            <label className={labelClass}>{W.holdForm}
              <select className={inputClass} value={h.taxFormKey} onChange={(e) => set({ holds: d.holds.map((x, k) => (k === i ? { ...x, taxFormKey: e.target.value } : x)) })}>
                <option value="" />
                {d.taxForms.filter((f) => f.key).map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
              </select>
            </label>
            <label className={labelClass}>{W.holdCountry}<input className={inputClass} maxLength={2} value={h.workCountry} onChange={(e) => set({ holds: d.holds.map((x, k) => (k === i ? { ...x, workCountry: e.target.value.toUpperCase() } : x)) })} /></label>
            <label className={labelClass}>{W.holdNote}<input className={inputClass} value={h.note} onChange={(e) => set({ holds: d.holds.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)) })} /></label>
            <button type="button" className={`${buttonClass} self-end`} onClick={() => set({ holds: d.holds.filter((_, k) => k !== i) })}>{W.remove}</button>
          </div>
        ))}
        <button type="button" className={buttonClass} onClick={() => set({ holds: [...d.holds, { taxFormKey: "", workCountry: "", note: "" }] })}>{W.addHold}</button>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryClass} disabled={saving} onClick={() => void save(fromDraft(d) as unknown as MoonReviewSettings)}>
          {saving ? ADMIN_WORDS.saving : ADMIN_WORDS.save}
        </button>
        {message && <p role={message.ok ? "status" : "alert"} className="text-sm text-foreground">{message.text}</p>}
      </div>
    </div>
  );
}
