/**
 * THE TERMS ON OFFER, READ-ONLY (the member door, Rye 10 Nov 2026; form v2's
 * "accept, or talk about the terms").
 *
 * A member applying from a role card or the board does not write terms: they
 * read the role's own terms on offer, then accept them or say what they would
 * like to talk about, which every decider sees. The answer carries the terms
 * it showed (`settings`), and the publish sends them unchanged: the first
 * picked role's offer, or, for a role whose card offers none, no terms at all
 * (`{ v: 1 }`), exactly what the open form sends. The village agrees them with
 * the holder. Never the platform's volunteer preset: that read as a volunteer
 * track (Rye, 10 Nov 2026: every role is a contract), and a village's own
 * default belongs to its data, not to a door.
 */
import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { readTermsOffer } from "@shared/seatTermsOffer";
import { termsSlotFor } from "@/components/power/SeatTermsSlot";
import type { FieldSpec } from "./wizardConfig";
import { loadOrg } from "./pickSources";
import { pickedSeats } from "./SeatPicksField";
import { termsChoiceOf } from "./roleApplicationType";
import { publicTermsOf } from "@shared/seatTermsOffer";
import { writtenKeys } from "@shared/termsWords";
import TermsEight, { type TermsStepValue } from "./TermsEight";

/** No terms written: the village agrees a role's terms with its holder (the open form sends the same). */
export const NO_TERMS_YET = { v: 1 } as const;

/** The terms a door application holds: the first picked role's offer, else none written yet. */
export function doorSettings(seats: ReadonlyArray<Record<string, any>>): unknown {
  for (const seat of seats) {
    const offer = readTermsOffer(seat?.termsOffer ?? null);
    if (offer.ok && offer.settings) return offer.settings;
  }
  return { ...NO_TERMS_YET };
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
  const offers = useMemo(() => seats.map((seat) => ({ seat, ...publicTermsOf(seat?.termsOffer ?? null) })), [seats]);
  const written = useMemo(() => writtenKeys(offers), [offers]);
  const now = termsChoiceOf(value);
  const step: TermsStepValue = { answers: now?.answers ?? {}, commitmentPct: now?.commitmentPct ?? null };
  const send = (next: TermsStepValue) => onChange({ answers: next.answers, commitmentPct: next.commitmentPct, settings, written });

  // The terms shown are the terms sent: a change of roles refreshes what the answer carries.
  useEffect(() => {
    if (!settings) return;
    if (!now || JSON.stringify(now.settings) !== JSON.stringify(settings) || JSON.stringify(now.written) !== JSON.stringify(written)) {
      onChange({ answers: step.answers, commitmentPct: step.commitmentPct, settings, written });
    }
  }, [settings, written]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-3" data-terms-on-offer="">
      <p className="text-sm font-semibold text-foreground">{field.label}</p>
      {roles === null ? (
        <p className="text-sm text-muted-foreground">{t`Loading the terms on offer…`}</p>
      ) : (
        <>
          <TermsEight roles={offers.map((o) => ({ id: String(o.seat.id), name: String(o.seat.name ?? o.seat.id), words: o.words, commitmentPct: o.commitmentPct }))} value={step} onChange={send} problem={problem} idPrefix="door-terms" />
          {seats.some((seat) => termsSlotFor(seat)) && (
            <details className="rounded-xl border border-border bg-card p-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-card-foreground">{t`Everything else on the role card's terms`}</summary>
              {seats.map((seat) => (
                <div key={String(seat.id)} className="mt-2">
                  <p className="text-sm font-semibold text-card-foreground">{String(seat.name ?? seat.id)}</p>
                  {termsSlotFor(seat)}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
