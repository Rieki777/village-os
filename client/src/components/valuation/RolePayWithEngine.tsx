/**
 * SETTING A ROLE'S PAY WITH THE VALUATION ENGINE (Rye, 2026-11-06: "Role pay is
 * set by both the treasurer and the role/valuation algorithm").
 *
 * The flow, in the order research 03 and the UX pass asked for:
 *   1. the role's effort for the moon: a band and an estimate, with an optional
 *      low and high;
 *   2. the setter's own number, asked BEFORE the suggestion shows, so the
 *      suggestion does not anchor it (optional, "skip");
 *   3. the suggestion and its receipt;
 *   4. the figure: "Use the suggestion" or the setter's own, never prefilled;
 *      outside the no-sign band a reason is asked, and the screen says who signs
 *      next before anything is sent.
 *
 * The suggestion is worked out here with the same pure engine the server uses,
 * so it moves as the setter types; the server prices the inputs again on save
 * and decides (PUT /api/org/roles/:id/pay). Admin is light-only by ruling.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { exponentOf } from "@shared/money";
import type { ValuationModel, WorkInputs } from "@shared/valuation";
import { suggestValuation, wholeMoney } from "@shared/valuationEngine";
import { REASON_CODES } from "@shared/valuationSetting";
import ValuationReceipt from "./ValuationReceipt";
import PayDoorNote, { type PayDoor } from "./PayDoorNote";

type Call = (path: string, body?: unknown, method?: string) => Promise<any>;
type ModelRead = { model: ValuationModel; eeMeaningWritten: boolean; tokenNames: Record<string, string>; payDoor?: PayDoor };

const field = "w-full border border-border rounded-lg px-3 py-2 text-sm min-h-[44px] bg-card";
const label = "block text-xs font-semibold text-muted-foreground mb-1";

const toMinor = (text: string, currency: string): number | null => {
  const n = Number(String(text).replace(/[^0-9.]/g, ""));
  if (!text.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * Math.pow(10, exponentOf(currency)));
};

export default function RolePayWithEngine({ role, call, onSaved }: { role: { id: string; name: string }; call: Call; onSaved: () => void }) {
  const { t } = useLingui();
  const [read, setRead] = useState<ModelRead | null>(null);
  const [band, setBand] = useState("");
  const [hours, setHours] = useState("");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [responsibility, setResponsibility] = useState("none");
  const [ownFirst, setOwnFirst] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [choice, setChoice] = useState<"suggestion" | "own" | null>(null);
  const [own, setOwn] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    void call("/valuation/model", undefined, "GET").then((d) => {
      if (!d?.model) return;
      setRead(d);
      setBand((b) => b || d.model.bands[0]?.key || "");
    });
  }, []);

  const model = read?.model ?? null;
  const currency = model?.currency ?? "";
  const work: WorkInputs | null = useMemo(() => {
    const h = Number(hours);
    if (!band || !(h > 0)) return null;
    const line = { band, payee: "lead" as const, estimatedHours: h, ...(Number(low) > 0 ? { estimateLow: Number(low) } : {}), ...(Number(high) > 0 ? { estimateHigh: Number(high) } : {}) };
    return { kind: "role", lines: [line], responsibility };
  }, [band, hours, low, high, responsibility]);
  const suggestion = useMemo(() => {
    if (!model || !work) return null;
    const s = suggestValuation(model, work, { eeMeaningWritten: !!read?.eeMeaningWritten });
    return s.ok ? { ok: true as const, payee: s.payees[0], warnings: s.warnings } : { ok: false as const, problems: s.refusals.map((r) => r.problem) };
  }, [model, work, read]);

  if (!read) return <p className="text-sm text-muted-foreground"><Trans>Reading the village's pay settings…</Trans></p>;
  if (!model || model.bands.length === 0) {
    return <p className="text-sm text-muted-foreground"><Trans>The village has not set its rates yet. Set them on the economics page, then work out this role's pay here.</Trans></p>;
  }

  const s = suggestion?.ok ? suggestion.payee : null;
  const figure = choice === "suggestion" && s ? s.expected.totalMinor : choice === "own" ? toMinor(own, currency) : null;
  const outside = s && figure !== null ? figure < s.band.lowMinor || figure > s.band.highMinor : false;
  const tokenName = (slug: string) => read.tokenNames[slug] ?? slug;

  const save = async () => {
    if (!work || figure === null) return;
    if (outside && !reason) return toast.error(t`This figure is outside the suggestion's band, so pick a reason.`);
    const why = reason === "Other" ? note.trim() || "Other" : reason || undefined;
    const d = await call(`/org/roles/${role.id}/pay`, {
      work,
      set: { totalMinor: figure },
      reason: why,
      note: note.trim() || undefined,
      ownNumberFirst: toMinor(ownFirst, currency) ?? undefined,
    }, "PUT");
    if (!d) return;
    if (d.state === "set") {
      toast.success(t({ message: "Saved", context: "role pay" }));
      setOutcome(t`Saved. The role's pay is set.`);
      onSaved();
    } else if (d.state === "awaiting_second") {
      setOutcome(t`Waiting for a second signer: another Treasurer or a steward. Until they sign, the role's pay stays as it is. If nobody signs within 7 days, put the change to the village in an org draft.`);
    } else {
      setOutcome(t`Nobody else can sign this figure, so it goes to the village. Put the change in an org draft and put it to a vote.`);
    }
  };

  return (
    <div className="space-y-3 text-foreground" data-role-pay-engine>
      <PayDoorNote door={read.payDoor} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          <span className={label}><Trans context="role pay">Kind of work</Trans></span>
          <select className={field} value={band} onChange={(e) => setBand(e.target.value)}>
            {model.bands.map((b) => (
              <option key={b.key} value={b.key}>{b.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}><Trans context="role pay">Responsibility</Trans></span>
          <select className={field} value={responsibility} onChange={(e) => setResponsibility(e.target.value)}>
            {model.responsibility.map((l) => (
              <option key={l.key} value={l.key}>{l.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}><Trans>Estimated effort for the moon, in hours</Trans></span>
          <input className={field} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className={label}><Trans>Could be as little as</Trans></span>
            <input className={field} inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
          </label>
          <label>
            <span className={label}><Trans context="role pay">Or as much as</Trans></span>
            <input className={field} inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
          </label>
        </div>
      </div>

      {!revealed && (
        <div className="rounded-lg border border-border bg-muted px-3 py-2">
          <label className="block">
            <span className={label}><Trans>Your own figure first, before you see the suggestion (optional)</Trans></span>
            <input className={field} inputMode="decimal" value={ownFirst} onChange={(e) => setOwnFirst(e.target.value)} />
          </label>
          <button type="button" disabled={!s} onClick={() => setRevealed(true)} className="mt-2 min-h-[44px] rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-40">
            <Trans context="role pay">Show the suggestion</Trans>
          </button>
        </div>
      )}

      {suggestion && !suggestion.ok && <p className="text-sm text-muted-foreground">{suggestion.problems[0]}</p>}

      {revealed && s && (
        <>
          <ValuationReceipt suggestion={s} currency={currency} tokenName={tokenName} />
          {suggestion?.ok && suggestion.warnings.map((w) => (
            <p key={w.text} className="text-sm text-muted-foreground">{w.text}</p>
          ))}
          {toMinor(ownFirst, currency) !== null && (
            <p className="text-sm text-muted-foreground"><Trans>Your own figure was {wholeMoney(toMinor(ownFirst, currency)!, currency)}.</Trans></p>
          )}
          <fieldset className="space-y-2">
            <legend className={label}><Trans context="role pay">The figure you set</Trans></legend>
            <label className="flex min-h-[44px] items-center gap-2">
              <input type="radio" name={`pay-${role.id}`} checked={choice === "suggestion"} onChange={() => setChoice("suggestion")} />
              <span><Trans context="role pay">Use the suggestion, {wholeMoney(s.expected.totalMinor, currency)}</Trans></span>
            </label>
            <label className="flex min-h-[44px] items-center gap-2">
              <input type="radio" name={`pay-${role.id}`} checked={choice === "own"} onChange={() => setChoice("own")} />
              <span><Trans context="role pay">My own figure</Trans></span>
            </label>
            {choice === "own" && <input className={field} inputMode="decimal" aria-label={t({ message: "Your figure", context: "role pay" })} value={own} onChange={(e) => setOwn(e.target.value)} />}
          </fieldset>
          {figure !== null && (
            <p className="text-sm text-muted-foreground">
              {outside
                ? t`This is outside the suggestion's band, so give a reason. A second Treasurer or a steward then signs it, or the village decides.`
                : t`This is inside the suggestion's band, so your word sets it.`}
            </p>
          )}
          {outside && (
            <label className="block">
              <span className={label}><Trans context="role pay">Reason</Trans></span>
              <select className={field} value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value=""><Trans context="role pay">Pick a reason</Trans></option>
                {REASON_CODES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className={label}>{reason === "Other" ? t({ message: "Say why", context: "role pay" }) : t({ message: "A note (optional)", context: "role pay" })}</span>
            <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="button" disabled={figure === null} onClick={() => void save()} className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark disabled:opacity-40">
            <Trans context="role pay">Set this role's pay</Trans>
          </button>
          {outcome && <p className="text-sm text-foreground" role="status">{outcome}</p>}
        </>
      )}
    </div>
  );
}
