/**
 * A season's plan window, set by hand (season plans RC1), inside the admin
 * Season tab. Its own file because Admin.tsx sits on the monolith ratchet.
 *
 * Empty means the window is worked out from the season's first day: it opens
 * one moon before and closes a whole moon after. Both days set means members
 * plan the season between them, both days included. The server keeps the pair
 * only when both are dates (`normalizeSeasonConfig`).
 */
export type PlanWindowValue = { opensOn: string; closesOn: string } | null | undefined;

export default function SeasonPlanWindowFields({ value, onChange }: { value: PlanWindowValue; onChange: (next: { opensOn: string; closesOn: string } | null) => void }) {
  const opensOn = value?.opensOn ?? "";
  const closesOn = value?.closesOn ?? "";
  const set = (patch: Partial<{ opensOn: string; closesOn: string }>) => {
    const next = { opensOn, closesOn, ...patch };
    onChange(next.opensOn || next.closesOn ? next : null);
  };
  return (
    <fieldset className="rounded-lg border border-stone-200 p-3">
      <legend className="px-1 text-xs font-semibold text-stone-600">Season plans window</legend>
      <p className="mb-2 text-[11px] text-stone-600">
        When members plan this season. Leave both empty to open one moon before it starts and close a moon after.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-stone-700">
          Opens
          <input type="date" value={opensOn} onChange={(e) => set({ opensOn: e.target.value })} className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-2 text-sm" />
        </label>
        <label className="text-xs text-stone-700">
          Last day
          <input type="date" value={closesOn} onChange={(e) => set({ closesOn: e.target.value })} className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-2 text-sm" />
        </label>
      </div>
    </fieldset>
  );
}
