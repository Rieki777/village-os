/**
 * Step 3: YOUR SEASON (role proposals PR C).
 *
 * The member's aim for next season, one to three seasonal goals each with when
 * it is done, and which of the VILLAGE'S goals for that season their season
 * serves, each with how it helps. The goal fields are the season plan page's
 * own (SeasonGoalsFields.tsx), so the two pages read and refuse alike, and on
 * submit these words become the member's plan for that season.
 *
 * When next season's goals are not set, the step says so and saves anyway.
 */
import { AIM_MAX } from "@shared/seasonPlans";
import { SeasonalGoalsField, ServedGoalsField, type SeasonalRow, type ServedRow } from "@/components/seasonPlans/SeasonGoalsFields";
import AiHelpButton from "./AiHelpButton";
import { RP_WORDS } from "./proposalWords";
import { INPUT, LEDE, PANEL } from "./parts";

export interface SeasonState {
  aim: string;
  seasonal: SeasonalRow[];
  served: ServedRow[];
}

export default function StepSeason({ season, orgGoals, onChange }: { season: SeasonState; orgGoals: readonly string[]; onChange: (next: SeasonState) => void }) {
  return (
    <div className="grid gap-4">
      <p className={LEDE}>{RP_WORDS.seasonLede}</p>
      <label className="grid gap-1 text-sm font-semibold text-stone-900">
        {RP_WORDS.aim}
        <span className="text-xs font-normal text-stone-600">{RP_WORDS.aimHelp}</span>
        <textarea rows={3} maxLength={AIM_MAX} value={season.aim} onChange={(e) => onChange({ ...season, aim: e.target.value })} className={INPUT} />
      </label>
      <div className={PANEL}>
        <SeasonalGoalsField rows={season.seasonal} onChange={(seasonal) => onChange({ ...season, seasonal })} />
      </div>
      <div className={`${PANEL} grid gap-2`} data-org-goals="">
        <h3 className="text-sm font-semibold text-stone-800">{RP_WORDS.orgGoalsHeading}</h3>
        {orgGoals.length === 0 ? (
          <>
            <p className="text-stone-800" data-no-org-goals="">
              {RP_WORDS.noOrgGoals}
            </p>
            <p className={LEDE}>{RP_WORDS.noOrgGoalsLine}</p>
          </>
        ) : (
          <ServedGoalsField rows={season.served} onChange={(served) => onChange({ ...season, served })} />
        )}
      </div>
      <AiHelpButton
        step="season"
        words={{ aim: season.aim, ...Object.fromEntries(season.seasonal.map((g, i) => [`seasonalGoals.${i}`, g.doneWhen ? `${g.title}: ${g.doneWhen}` : g.title])) }}
        onAccept={(field, words) => {
          if (field === "aim") onChange({ ...season, aim: words });
        }}
      />
    </div>
  );
}
