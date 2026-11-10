/**
 * THE TERMS ON OFFER, READ-ONLY (the member door, Rye 10 Nov 2026; form v2's
 * "accept, or talk about the terms").
 *
 * A member applying from a role card or the board does not write terms: they
 * read the role's own terms on offer, then accept them or say what they would
 * like to talk about, which every decider sees. The answer carries the terms
 * it showed (`settings`), and the publish sends them unchanged: the first
 * picked role's offer, or, for a role whose card offers none, the platform's
 * volunteer terms the editor has always started from.
 */
import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { applyWholePreset, wholePresetById } from "@shared/seatPresets";
import { readTermsOffer } from "@shared/seatTermsOffer";
import { termsSlotFor } from "@/components/power/SeatTermsSlot";
import type { FieldSpec } from "./wizardConfig";
import { loadOrg } from "./pickSources";
import { pickedSeats } from "./SeatPicksField";
import { ROLE_APPLICATION_PREFILL, termsChoiceOf } from "./roleApplicationType";

/** The terms a door application holds: the first picked role's offer, else the volunteer terms. */
export function doorSettings(seats: ReadonlyArray<Record<string, any>>): unknown {
  for (const seat of seats) {
    const offer = readTermsOffer(seat?.termsOffer ?? null);
    if (offer.ok && offer.settings) return offer.settings;
  }
  const whole = wholePresetById(ROLE_APPLICATION_PREFILL);
  return whole ? applyWholePreset(null, whole, []) : null;
}

export default function TermsOnOfferField({
  field,
  value,
  onChange,
  answers,
  problem,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  answers: Record<string, unknown>;
  problem?: string | null;
}) {
  const { t } = useLingui();
  const ids = pickedSeats(answers.seatIds ?? answers.seatId);
  const key = ids.join(",");
  const [roles, setRoles] = useState<Array<Record<string, any>> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOrg().then((org) => {
      if (alive) setRoles(Array.isArray(org?.roles) ? org.roles : []);
    });
    return () => {
      alive = false;
    };
  }, []);
  const seats = useMemo(() => (roles ?? []).filter((r) => ids.includes(String(r.id))), [roles, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = useMemo(() => (roles ? doorSettings(seats) : null), [roles, seats]);
  const now = termsChoiceOf(value);
  const choose = (choice: "accept" | "talk", note = now?.note ?? "") => onChange({ choice, note, settings });

  // The terms shown are the terms sent: a change of roles refreshes what the answer carries.
  useEffect(() => {
    if (now && settings && JSON.stringify(now.settings) !== JSON.stringify(settings)) onChange({ ...now, settings });
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <fieldset className="grid gap-3" data-terms-on-offer="">
      <legend className="mb-1 text-sm font-semibold text-foreground">{field.label}</legend>
      {roles === null ? (
        <p className="text-sm text-muted-foreground">{t`Loading the terms on offer…`}</p>
      ) : (
        seats.map((seat) => {
          const roleName = String(seat.name ?? seat.id);
          return (
            <div key={String(seat.id)} className="rounded-xl border border-border bg-card p-3">
              <p className="text-sm font-semibold text-card-foreground">{roleName}</p>
              <div className="mt-2">{termsSlotFor(seat) ?? <p className="text-sm text-muted-foreground">{t`The village agrees this role's terms with whoever holds it.`}</p>}</div>
            </div>
          );
        })
      )}
      <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
        <input type="radio" name="door-terms" className="mt-1 size-4 accent-primary" checked={now?.choice === "accept"} onChange={() => choose("accept")} disabled={!settings} />
        {t`I accept the terms on offer.`}
      </label>
      <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
        <input type="radio" name="door-terms" className="mt-1 size-4 accent-primary" checked={now?.choice === "talk"} onChange={() => choose("talk")} disabled={!settings} />
        {t`I'd like to talk about the terms.`}
      </label>
      {now?.choice === "talk" && (
        <textarea
          aria-label={t`What you would like to talk about in the terms`}
          rows={3}
          maxLength={1000}
          value={now.note}
          onChange={(e) => choose("talk", e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      )}
      <p className="text-xs text-muted-foreground">{t`Everyone who reads your application sees a wish to talk about the terms.`}</p>
      {problem && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
