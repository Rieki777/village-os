/**
 * THE INVOICE PART OF MY MOON, shown only when a role's adopted terms carry
 * money (`invoiceNeeded`). The member's own invoice is the legal one
 * (decision 16 revised): this part is the support document beside it.
 *
 *   1. The pilot note, accepted once per version.
 *   2. The pay route form: where the member lives and works and their status.
 *      It refuses anything that looks like a bank or card number before it is
 *      sent (`looksLikePaymentDetails`), and the server refuses it again.
 *   3. Bill to, the lines with their basis, the total, the attestation, the
 *      member's own invoice number (and the electronic key on the contractor
 *      route), then Send draft invoice for approval.
 *   4. The support line, To and Cc with copy buttons, and once both approvals
 *      are in, Copy work summary and Copy for email.
 *
 * Every amount prints through `<Amount>`, so Room view hides all of them.
 */
import { useEffect, useState } from "react";
import { looksLikePaymentDetails } from "@shared/seatSettings";
import {
  INVOICING_ROUTES,
  LINE_BASIS_WORDS,
  MOON_WORDS,
  MY_MOON_WORDS,
  NO_TAX_FORM,
  PAYMENT_DETAILS_REFUSED,
  SUPPORT_LINE,
  isPayRoute,
  sendYourInvoiceTo,
  type InvoiceView,
  type MoonAttestation,
  type PayRoute,
} from "@shared/moonRecap";
import * as api from "./moonApi";
import type { MyMoonData } from "./moonApi";
import { Amount, ERROR, INPUT, LABEL, MUTED, SMALL_BTN, Section, useRoomView } from "./moonUi";
import { authToken } from "@/lib/gameApi";
import { Trans } from "@lingui/react/macro";
import { InvoiceTrack, type TrackRow } from "../TreasurySync";

/** The member's invoice tracks and whether a send emails Sera's inbox (invoice rails). Reloads when `key` changes. */
function useInvoiceRails(key: string): { tracks: TrackRow[]; seraInbox: string | null; loaded: boolean } {
  const [state, setState] = useState<{ tracks: TrackRow[]; seraInbox: string | null; loaded: boolean }>({ tracks: [], seraInbox: null, loaded: false });
  useEffect(() => {
    const t = authToken();
    fetch("/api/me/invoice-track", { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setState({ tracks: Array.isArray(d?.tracks) ? d.tracks : [], seraInbox: typeof d?.seraInbox === "string" ? d.seraInbox : null, loaded: true }))
      .catch(() => setState({ tracks: [], seraInbox: null, loaded: true }));
  }, [key]);
  return state;
}

function CopyLine({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
      <span className="font-medium">{label}:</span>
      <span className="min-w-0 break-all">{text}</span>
      <button type="button" className={SMALL_BTN} onClick={async () => setDone(await api.copyText(text))}>{done ? MY_MOON_WORDS.copied : MY_MOON_WORDS.copy}</button>
    </div>
  );
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className={SMALL_BTN} onClick={async () => setDone(await api.copyText(text))}>{done ? MY_MOON_WORDS.copied : label}</button>;
}

function PayRouteForm({ data, reload }: { data: MyMoonData; reload: () => Promise<unknown> }) {
  const r = data.payRoute;
  const [form, setForm] = useState({
    route: (r?.route ?? "pending") as PayRoute,
    legalName: r?.legalName ?? "",
    address: r?.address ?? "",
    currency: r?.currency ?? "",
    statusValidUntil: r?.statusValidUntil ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => { setForm({ ...form, ...patch }); setLine(null); };

  const save = async () => {
    setError(null);
    if ([form.legalName, form.address].some((t) => t && looksLikePaymentDetails(t))) return setError(PAYMENT_DETAILS_REFUSED);
    const out = await api.savePayRoute({
      route: form.route,
      payerKey: r?.payerKey ?? null,
      currency: form.currency.trim().toUpperCase() || null,
      legalName: form.legalName.trim() || null,
      address: form.address.trim() || null,
      statusValidUntil: form.statusValidUntil || null,
      taxFormKind: r?.taxFormKind ?? NO_TAX_FORM,
      taxFormSignedOn: r?.taxFormSignedOn ?? null,
      taxFormExpiresOn: r?.taxFormExpiresOn ?? null,
      taxFormFiledWhere: r?.taxFormFiledWhere ?? null,
    });
    if (!out.ok) return setError(out.error);
    setLine(MY_MOON_WORDS.routeSaved);
    await reload();
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="pay-route">
      <h4 className="m-0 text-base font-semibold text-foreground">{MY_MOON_WORDS.routeHeading}</h4>
      <p className={MUTED}>{r?.confirmedAt ? MY_MOON_WORDS.routeConfirmed : MY_MOON_WORDS.routeNotConfirmed}</p>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={LABEL}>{MY_MOON_WORDS.routeChoice}</legend>
        {data.routeChoices.map((c) => (
          <label key={c.route} className="flex items-start gap-2 text-sm text-foreground">
            <input type="radio" name="pay-route" value={c.route} checked={form.route === c.route} onChange={(e) => isPayRoute(e.target.value) && set({ route: e.target.value })} className="mt-1" />
            <span>{c.words}</span>
          </label>
        ))}
      </fieldset>
      {INVOICING_ROUTES.includes(form.route) ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={LABEL}>{MY_MOON_WORDS.legalName}<input value={form.legalName} autoComplete="name" onChange={(e) => set({ legalName: e.target.value })} className={INPUT} /></label>
          <label className={LABEL}>{MY_MOON_WORDS.currency}<input value={form.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value })} className={INPUT} /></label>
          <label className={`${LABEL} sm:col-span-2`}>{MY_MOON_WORDS.address}<textarea value={form.address} rows={2} autoComplete="street-address" onChange={(e) => set({ address: e.target.value })} className={INPUT} /></label>
          {form.route === "nomad" ? (
            <label className={LABEL}>{MY_MOON_WORDS.statusValidUntil}<input type="date" value={form.statusValidUntil} onChange={(e) => set({ statusValidUntil: e.target.value })} className={INPUT} /></label>
          ) : null}
        </div>
      ) : null}
      <p className={MUTED}>{MOON_WORDS.paymentDetails}</p>
      <p className={MUTED}>{MOON_WORDS.whoReads}: {data.cashPayHolders.join(", ") || MY_MOON_WORDS.none}</p>
      <button type="button" className={`${SMALL_BTN} self-start`} onClick={save}>{MY_MOON_WORDS.saveRoute}</button>
      {line ? <p className={MUTED} aria-live="polite">{line}</p> : null}
      {error ? <p role="alert" className={ERROR}>{error}</p> : null}
    </div>
  );
}

function emailText(inv: InvoiceView): string {
  const to = inv.billTo ? `${MOON_WORDS.to}: ${inv.billTo.invoiceTo}` : "";
  const cc = inv.billTo && inv.billTo.invoiceCc.length > 0 ? `${MOON_WORDS.cc}: ${inv.billTo.invoiceCc.join(", ")}` : "";
  return [to, cc, "", inv.workSummary ?? ""].filter((l, i) => l || i === 2).join("\n");
}

export default function InvoicePanel({ data, cycleId, editable, reload }: { data: MyMoonData; cycleId: string; editable: boolean; reload: () => Promise<unknown> }) {
  const room = useRoomView();
  const inv = data.invoice;
  const route = data.payRoute?.route ?? "pending";
  const words = data.attestationWords;
  const [att, setAtt] = useState({ countries: "", days: "0", unchanged: false, servedAbroad: false, visitor: false });
  const [number, setNumber] = useState(inv?.memberNumber ?? "");
  const [key, setKey] = useState(inv?.externalInvoiceKey ?? "");
  const [proposals, setProposals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNumber(inv?.memberNumber ?? ""), [inv?.memberNumber]);
  const rails = useInvoiceRails(`${inv?.id ?? ""}:${inv?.status ?? ""}`);
  const myTrack = inv?.id ? rails.tracks.find((t) => t.invoiceId === inv.id) ?? null : null;
  const seraInbox = rails.seraInbox;

  if (!data.invoiceNeeded) return data.noTermsLine ? <p className={MUTED}>{data.noTermsLine}</p> : null;

  const ack = data.pilotAck;
  const ackPending = !!ack && ack.acceptedVersion !== ack.version;
  const acceptPilot = async () => {
    if (!ack) return;
    const r = data.payRoute;
    const out = await api.savePayRoute({
      route: r?.route ?? "pending", payerKey: r?.payerKey ?? null, currency: r?.currency ?? null, legalName: r?.legalName ?? null, address: r?.address ?? null,
      statusValidUntil: r?.statusValidUntil ?? null, taxFormKind: r?.taxFormKind ?? NO_TAX_FORM, taxFormSignedOn: r?.taxFormSignedOn ?? null,
      taxFormExpiresOn: r?.taxFormExpiresOn ?? null, taxFormFiledWhere: r?.taxFormFiledWhere ?? null, pilotAckVersion: ack.version,
    });
    if (!out.ok) return setError(out.error);
    await reload();
  };

  const send = async () => {
    if (!inv || !ack) return;
    setError(null);
    setBusy(true);
    const attestation: MoonAttestation = {
      workCountries: att.countries.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean),
      daysInHostCountry: Number(att.days),
      statusUnchanged: att.unchanged,
      servedAbroad: route === "nomad" ? att.servedAbroad : null,
      visitorEntryWork: att.visitor,
    };
    const rangeProposals: Record<string, number> = {};
    for (const [k, v] of Object.entries(proposals)) if (v.trim() && Number.isInteger(Number(v))) rangeProposals[k] = Number(v);
    const out = await api.sendInvoice(cycleId, { attestation, pilotAckVersion: ack.version, memberNumber: number.trim(), externalInvoiceKey: route === "local_contractor" ? key.trim() || null : null, rangeProposals });
    setBusy(false);
    if (!out.ok) return setError(out.error);
    await reload();
  };

  const answerRange = async (applicationId: string, answer: "accept" | "talk") => {
    const out = await api.rangeAnswer(cycleId, { applicationId, answer });
    if (!out.ok) return setError(out.error);
    await reload();
  };

  const unsent = !inv || inv.status === "draft" || inv.status === "returned";
  return (
    <Section title={MOON_WORDS.invoice}>
      {room ? <p className={MUTED}>{MOON_WORDS.roomViewLine}</p> : null}
      {data.setupGaps.length > 0 ? <ul className="m-0 list-disc pl-5 text-sm text-muted-foreground">{data.setupGaps.map((g) => <li key={g}>{g}</li>)}</ul> : null}

      {ack && ackPending ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="pilot-ack">
          <h4 className="m-0 text-base font-semibold text-foreground">{MY_MOON_WORDS.pilotHeading}</h4>
          <p className="m-0 whitespace-pre-line text-sm text-foreground">{ack.text}</p>
          <button type="button" className={`${SMALL_BTN} self-start`} onClick={acceptPilot}>{MY_MOON_WORDS.pilotAccept}</button>
        </div>
      ) : null}

      {!room ? <PayRouteForm data={data} reload={reload} /> : null}

      {inv ? (
        <div className="flex flex-col gap-3" data-testid="invoice">
          <p className="m-0 text-sm font-semibold text-foreground">{inv.statusLine}</p>
          {!room && myTrack ? <InvoiceTrack row={myTrack} own /> : null}
          <p className={MUTED}>{inv.supportLine || SUPPORT_LINE}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className={LABEL}>{MOON_WORDS.billTo}</p>
              {inv.billTo ? (
                <p className="m-0 whitespace-pre-line text-sm text-foreground">{[inv.billTo.legalName, inv.billTo.address, inv.billTo.taxId].filter(Boolean).join("\n")}</p>
              ) : <p className={MUTED}>{MY_MOON_WORDS.noPayerYet}</p>}
            </div>
            <div>
              <p className={LABEL}>{MOON_WORDS.period}</p>
              <p className="m-0 text-sm text-foreground">{inv.period}</p>
            </div>
          </div>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {inv.lines.map((l) => (
              <li key={l.key} className="flex flex-col gap-1 rounded-lg border border-border p-2" data-testid="invoice-line">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{l.roleNames.join(", ")}</span>
                  <span className="text-sm font-semibold text-foreground"><Amount minor={l.amountMinor} currency={l.currency} /></span>
                </div>
                <p className="m-0 text-xs text-muted-foreground">{MY_MOON_WORDS.basis}: {LINE_BASIS_WORDS[l.basis]}{room ? "" : `. ${l.basisLine}`}</p>
                {l.basis === "range" && unsent && !room && editable ? (
                  <label className={LABEL}>
                    {MY_MOON_WORDS.proposeAmount}
                    <input inputMode="numeric" value={proposals[l.applicationId] ?? (l.proposedMinor ?? "").toString()} onChange={(e) => setProposals({ ...proposals, [l.applicationId]: e.target.value })} className={INPUT} />
                  </label>
                ) : null}
                {l.basis === "range" && l.finalMinor !== null && inv.status === "returned" && !room ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={SMALL_BTN} onClick={() => void answerRange(l.applicationId, "accept")}>{MOON_WORDS.acceptRange}</button>
                    <button type="button" className={SMALL_BTN} onClick={() => void answerRange(l.applicationId, "talk")}>{MOON_WORDS.talkRange}</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="m-0 flex justify-between text-sm font-semibold text-foreground">
            <span>{MOON_WORDS.total}</span>
            <span><Amount minor={inv.totalMinor} currency={inv.currency} /></span>
          </p>

          {unsent && editable && !room ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="attestation">
              <h4 className="m-0 text-base font-semibold text-foreground">{MOON_WORDS.attestation}</h4>
              <label className={LABEL}>{words.workCountries}<input value={att.countries} placeholder={MY_MOON_WORDS.countriesHint} onChange={(e) => setAtt({ ...att, countries: e.target.value })} className={INPUT} /></label>
              <label className={LABEL}>{words.daysIn}<input inputMode="numeric" value={att.days} onChange={(e) => setAtt({ ...att, days: e.target.value })} className={INPUT} /></label>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={att.unchanged} onChange={(e) => setAtt({ ...att, unchanged: e.target.checked })} />{words.statusUnchanged}</label>
              {route === "nomad" ? <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={att.servedAbroad} onChange={(e) => setAtt({ ...att, servedAbroad: e.target.checked })} />{words.servedAbroad}</label> : null}
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={att.visitor} onChange={(e) => setAtt({ ...att, visitor: e.target.checked })} />{words.visitorEntryWork}</label>
              <label className={LABEL}>{MOON_WORDS.memberNumber}<input value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} className={INPUT} /></label>
              {route === "local_contractor" ? <label className={LABEL}>{MOON_WORDS.externalKey}<input inputMode="numeric" value={key} maxLength={64} onChange={(e) => setKey(e.target.value)} className={INPUT} /></label> : null}
              {inv.sendRefusal ? <p className={MUTED}>{inv.sendRefusal}</p> : null}
              {seraInbox ? <p className="m-0 text-sm text-foreground" data-testid="emails-sera"><Trans>Sending also emails this invoice as a PDF to Sera, the village's record keeper, at <span className="break-all font-medium text-foreground">{seraInbox}</span>. It names you by your village name and code name. Your legal name and address stay private.</Trans></p> : null}
              <button type="button" className={`${SMALL_BTN} self-start`} disabled={busy || ackPending || !number.trim() || !rails.loaded} onClick={send}>{MOON_WORDS.sendInvoice}</button>
            </div>
          ) : null}

          {inv.billTo ? (
            <div className="flex flex-col gap-2">
              <p className={MUTED}>{sendYourInvoiceTo(inv.billTo.invoiceTo)}</p>
              <CopyLine label={MOON_WORDS.to} text={inv.billTo.invoiceTo} />
              {inv.billTo.invoiceCc.length > 0 ? <CopyLine label={MOON_WORDS.cc} text={inv.billTo.invoiceCc.join(", ")} /> : null}
            </div>
          ) : null}

          {room ? null : inv.workSummary ? (
            <div className="flex flex-wrap gap-2">
              <CopyButton label={MOON_WORDS.copySummary} text={inv.workSummary} />
              <CopyButton label={MOON_WORDS.copyEmail} text={emailText(inv)} />
            </div>
          ) : <p className={MUTED}>{MY_MOON_WORDS.invoiceAfterApproval}</p>}
        </div>
      ) : null}

      {error ? <p role="alert" className={ERROR}>{error}</p> : null}
    </Section>
  );
}
