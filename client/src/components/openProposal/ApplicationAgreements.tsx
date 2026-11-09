/**
 * THE AGREEMENTS FIELDSET on the public role application, its own file so one
 * lane owns it (role-agreements, PR-E; seams note 9 Nov 2026). The parser is
 * shared/openProposalAgreements.ts.
 *
 * Today: two required ticks. Rye's answer 8 (9 Nov) makes the first a real,
 * versioned membership alignment at application; `membershipLetter` is the
 * prop that lane fills. Aligning is the village's way of signing (answer 3).
 * The admin palette's tokens only.
 */
import { useLingui } from "@lingui/react/macro";
import type { ApplicationAgreed } from "@shared/openProposalAgreements";

export default function ApplicationAgreements({
  value,
  onChange,
}: {
  value: ApplicationAgreed;
  onChange: (next: ApplicationAgreed) => void;
  /** Reserved for the membership alignment at application (role-agreements lane). */
  membershipLetter?: unknown;
}) {
  const { t } = useLingui();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold text-card-foreground">{t({ message: "Agreements", context: "open proposal card" })}</legend>
      <p className="text-xs text-muted-foreground">{t`Aligning is the village's way of signing.`}</p>
      <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
        <input type="checkbox" required className="mt-1 size-4 shrink-0 accent-primary" checked={value.loveLetter} onChange={(e) => onChange({ ...value, loveLetter: e.target.checked })} />
        {t`I align with the Love Letter, the village's membership agreement.`}
      </label>
      <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
        <input type="checkbox" required className="mt-1 size-4 shrink-0 accent-primary" checked={value.nda} onChange={(e) => onChange({ ...value, nda: e.target.checked })} />
        {t`Once approved into a role, I will align with the village's confidentiality agreement (NDA) before I see any confidential records.`}
      </label>
    </fieldset>
  );
}
