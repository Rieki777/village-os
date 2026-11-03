/**
 * Step 4: TERMS AND REVIEW DATES (role proposals PR C).
 *
 * One set of terms covers every role in the proposal, as one application
 * holds them, written in the member door's own editor (SeatSettingsEditor),
 * judged by the parser the server runs. Each role keeps its own review date.
 *
 * The load check adds up each role's time and says plainly when it goes past
 * a full season (shared/roleProposalLoad.ts).
 */
import SeatSettingsEditor from "@/components/governance/SeatSettingsEditor";
import { useVillagePresets } from "@/lib/seatPresetsRead";
import { loadCheck, LOAD_WORDS } from "@shared/roleProposalLoad";
import { emptySettings, parseSeatSettings, type SeatSettings } from "@shared/seatSettings";
import { RP_WORDS } from "./proposalWords";
import { INPUT, LEDE, PANEL, PRIMARY, QUIET, SECONDARY } from "./parts";

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
  onOpenWords,
  onHours,
}: {
  roles: readonly TermsRole[];
  settings: SeatSettings;
  onReview: (roleId: string, day: string) => void;
  onSettings: (next: SeatSettings) => void;
  /** Who fills a row left open. The chart's operations role, or the fallback. */
  partner: string;
  /** Opens the Words step, where each role's hours are written. */
  onOpenWords: () => void;
  /** Writes one role's time, which the load check adds up. */
  onHours: (roleId: string, text: string) => void;
}) {
  const presets = useVillagePresets();
  const load = loadCheck(roles.map((r) => ({ name: r.name, time: r.time })));
  const parsed = parseSeatSettings(settings);
  return (
    <div className="grid gap-4">
      <p className={LEDE}>{RP_WORDS.termsLede}</p>

      <section aria-labelledby="rp-load" className={`${PANEL} grid gap-2 ${load.over ? "border-coral" : ""}`} data-load-check={load.over ? "over" : "within"}>
        <h3 id="rp-load" className="font-semibold text-stone-900">
          {LOAD_WORDS.heading}
        </h3>
        <p className={LEDE}>{LOAD_WORDS.lede}</p>
        {load.counted.length > 0 && (
          <ul className="grid gap-0.5 text-sm text-stone-800">
            {load.counted.map((c, i) => (
              <li key={i}>{LOAD_WORDS.oneRole(c.name, Math.round(c.hours))}</li>
            ))}
          </ul>
        )}
        {load.lines.map((l, i) => (
          <p key={i} className={i === 0 ? `font-semibold ${load.over ? "text-coral" : "text-stone-900"}` : "text-sm text-stone-700"} data-load-line={i}>
            {l}
          </p>
        ))}
        {load.notCounted.length > 0 && (
          <ul className="grid gap-0.5 text-sm text-stone-600">
            {load.notCounted.map((c, i) => (
              <li key={i}>
                {c.name}: {c.why}
              </li>
            ))}
          </ul>
        )}
        {load.notCounted.length > 0 && (
          <button type="button" className={QUIET} onClick={onOpenWords}>
            {LOAD_WORDS.writeHours}
          </button>
        )}
      </section>

      {roles.length > 0 && (
        <fieldset className={`${PANEL} grid gap-3`}>
          <legend className="px-1 font-semibold text-stone-900">{RP_WORDS.reviewDates}</legend>
          <p className="text-xs text-stone-600">{RP_WORDS.reviewHint}</p>
          {roles.map((r) => (
            <label key={r.id} className="grid gap-1 text-sm font-medium text-stone-800">
              <span className="break-words">{r.name}</span>
              <input type="date" value={r.reviewOn} onChange={(e) => onReview(r.id, e.target.value)} className={`min-h-[44px] ${INPUT}`} />
            </label>
          ))}
        </fieldset>
      )}

      {roles.length > 0 && (
        <section className={`${PANEL} grid gap-3`} aria-label={RP_WORDS.hoursQuestion}>
          <h3 className="font-semibold text-stone-900">{RP_WORDS.hoursQuestion}</h3>
          {roles.map((r) => (
            <fieldset key={r.id} className="grid gap-2">
              <legend className="text-sm font-medium text-foreground">{r.name}</legend>
              <div className="flex flex-wrap gap-2">
                {[2, 5, 10, 20, 40].map((n) => {
                  const label = RP_WORDS.hoursChoice(n);
                  const on = (r.time ?? "").trim().toLowerCase() === label;
                  return (
                    <button key={n} type="button" className={on ? PRIMARY : SECONDARY} aria-pressed={on} onClick={() => onHours(r.id, label)}>
                      {label}
                    </button>
                  );
                })}
                <button type="button" className={!r.time ? PRIMARY : SECONDARY} aria-pressed={!r.time} onClick={() => onHours(r.id, "")}>
                  {RP_WORDS.notSureHours}
                </button>
              </div>
            </fieldset>
          ))}
        </section>
      )}

      <section aria-labelledby="rp-terms" className="grid gap-2">
        <h3 id="rp-terms" className="font-semibold text-stone-900">
          {RP_WORDS.termsHeading}
        </h3>
        <p className={LEDE}>{RP_WORDS.notSureLine(partner)}</p>
        <button type="button" className={SECONDARY} onClick={() => onSettings(emptySettings())}>
          {RP_WORDS.notSureYet}
        </button>
        {!parsed.ok && <p className="text-sm font-medium text-coral">{RP_WORDS.termsNotSaved}</p>}
        <SeatSettingsEditor value={settings} onChange={onSettings} villagePresets={presets} partner={partner} />
      </section>
    </div>
  );
}
