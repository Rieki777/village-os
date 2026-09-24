/**
 * WHICH CLOCK THIS VILLAGE KEEPS, asked on the screen that owns it.
 *
 * The platform ships `America/Costa_Rica` and every fork inherits it in
 * silence: seasons derive dated entries whatever the zone, so nothing looks
 * broken and nothing ever asked. The zone decides when a day turns, when a
 * season turns, when the claims window opens, what time a gathering is shown
 * at, and when the weekly brief goes out.
 *
 * THE CONFIRM BUTTON IS THE WHOLE POINT. A village really in Costa Rica has
 * nothing to change, so without a way to AGREE there is no way to answer at
 * all; and the stored zone cannot be read as agreement, because the Season tab
 * is handed the normalised document and writes the platform's zone back on any
 * save. Renaming a season would otherwise count as confirming a clock.
 *
 * It asks and never blocks. A village may save, launch and run for years
 * without answering; what it may not do is never be asked.
 *
 * ITS OWN FILE, because `client/src/pages/Admin.tsx` is on a line ratchet that
 * only ever turns down, and because the label, the box, the question and the
 * confirmation are one thing. Light-only, like the rest of this folder.
 */
import { useSettingFocus } from "@/components/admin/settingFocus";

export default function SeasonTimezoneField({
  value,
  answered,
  saving,
  onChange,
  onConfirm,
}: {
  value: string;
  /** Has somebody here said this zone is right? Not "is a zone stored". */
  answered: boolean;
  saving: boolean;
  onChange: (timezone: string) => void;
  onConfirm: () => void;
}) {
  useSettingFocus("season.timezone", "season-timezone", true);
  return (
    <div>
      {/* The label was tied to nothing, so a screen reader met an unnamed box,
          and there was no id for a link to land on either. Both are fixed
          here, because the launch checklist and the admin banner now send
          people straight to this control. */}
      <label htmlFor="season-timezone" className="text-sm font-medium text-gray-700 block mb-1">
        Timezone
      </label>
      <input
        id="season-timezone"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="America/Costa_Rica"
        aria-describedby={answered ? undefined : "season-timezone-answer"}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
      />
      <p className="text-[11px] text-gray-400 mt-1">A season turns at midnight where the village is.</p>
      {!answered && (
        <p
          id="season-timezone-answer"
          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2"
        >
          Needs your answer. This is where the platform starts, not something anybody here said, and
          it decides when a day, a season and the claims window turn. Type yours, or press This is
          right to keep it. Nothing is blocked either way.{" "}
          <button type="button" onClick={onConfirm} disabled={saving} className="underline font-medium">
            This is right
          </button>
        </p>
      )}
    </div>
  );
}
