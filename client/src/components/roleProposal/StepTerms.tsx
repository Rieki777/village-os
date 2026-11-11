/**
 * Step 4: TERMS AND REVIEW DATES (role proposals PR C).
 *
 * One set of terms covers every role in the proposal, as one application
 * holds them, written in the member door's own editor (SeatSettingsEditor),
 * judged by the parser the server runs. Each role keeps its own review date.
 *
 * Each role asks a commitment, 0 to 100 in tens with no default: energy and
 * attention, never hours. Time is not tracked here.
 */
import SeatSettingsEditor from "@/components/governance/SeatSettingsEditor";
import { useVillagePresets } from "@/lib/seatPresetsRead";
import { COMMITMENT_CHOICES, COMMITMENT_HINT, commitmentWords } from "@shared/termsWords";
import { parseSeatSettings, type SeatSettings } from "@shared/seatSettings";
import { RP_WORDS } from "./proposalWords";
import { INPUT, LEDE, PANEL } from "./parts";
import WrittenDate from "./WrittenDate";

/** The percent a role's time words carry ("Commitment: 40%"), or null for anything else, such as older words about hours. */
export function commitmentOf(time: string | null | undefined): number | null {
  const m = /^Commitment: (\d{1,3})%$/.exec((time ?? "").trim());
  return m && (COMMITMENT_CHOICES as readonly number[]).includes(Number(m[1])) ? Number(m[1]) : null;
}

export interface TermsRole {
  id: string;
  name: string;
  reviewOn: string;
  /** The role's time words as proposed now. */
  time: string | null;
}

export default function StepTerms({
  roles,
  settings,
  onReview,
  onSettings,
  partner,
  onCommitment,
}: {
  roles: readonly TermsRole[];
  settings: SeatSettings;
  onReview: (roleId: string, day: string) => void;
  onSettings: (next: SeatSettings) => void;
  /** Who fills a row left open. The chart's operations role, or the fallback. */
  /** Null while the chart loads, so no generic name flashes before the real one. */
  partner: string | null;
  /** Writes one role's commitment, as the words "Commitment: 40%". Empty clears it. */
  onCommitment: (roleId: string, text: string) => void;
}) {
  const presets = useVillagePresets();
  const parsed = parseSeatSettings(settings);
  return (
    <div className="grid gap-4">
      <p className={LEDE}>{RP_WORDS.termsLede}</p>

      {roles.length > 0 && (
        <section aria-labelledby="rp-reviews" className={`${PANEL} grid gap-3 pt-4`}>
          <h3 id="rp-reviews" className="font-semibold text-foreground">{RP_WORDS.reviewDates}</h3>
          <p className="text-xs text-muted-foreground">{RP_WORDS.reviewHint}</p>
          {roles.map((r) => (
            <label key={r.id} className="grid gap-1 text-sm font-medium text-foreground">
              <span className="break-words">{r.name}</span>
              <WrittenDate iso={r.reviewOn} />
              <input type="date" value={r.reviewOn} onChange={(e) => onReview(r.id, e.target.value)} className={`min-h-[44px] ${INPUT}`} />
            </label>
          ))}
        </section>
      )}

      {roles.length > 0 && (
        <section className={`${PANEL} grid gap-3`} aria-label={RP_WORDS.commitmentQuestion} data-commitment-section="">
          <h3 className="font-semibold text-foreground">{RP_WORDS.commitmentQuestion}</h3>
          <p className="text-xs text-muted-foreground">{COMMITMENT_HINT}</p>
          {roles.map((r) => {
            const pct = commitmentOf(r.time);
            return (
              <label key={r.id} className="grid gap-1 text-sm font-medium text-foreground">
                <span className="break-words">{r.name}</span>
                <select
                  value={pct === null ? "" : String(pct)}
                  onChange={(e) => onCommitment(r.id, e.target.value === "" ? "" : commitmentWords(Number(e.target.value)))}
                  className={`min-h-[44px] ${INPUT}`}
                >
                  <option value="">{RP_WORDS.commitmentChoose}</option>
                  {COMMITMENT_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </section>
      )}

      <section aria-labelledby="rp-terms" className="grid gap-2">
        <h3 id="rp-terms" className="font-semibold text-foreground">
          {RP_WORDS.termsHeading}
        </h3>
        {partner === null ? (
          <p className={LEDE} aria-busy="true">{RP_WORDS.termsLoading}</p>
        ) : (
          <>
            <p className={LEDE}>{RP_WORDS.notSureLine(partner)}</p>
            {!parsed.ok && <p className="text-sm font-medium text-coral">{RP_WORDS.termsNotSaved}</p>}
            <SeatSettingsEditor value={settings} onChange={onSettings} villagePresets={presets} partner={partner} />
          </>
        )}
      </section>
    </div>
  );
}
