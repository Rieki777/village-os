/**
 * THE VILLAGE'S OWN SEAT PRESETS, the founding write (seat settings PR3).
 *
 * A preset is a starting point for one group of a seat's terms. The
 * platform's are shapes with blank amounts and ship in code; the village's
 * own may carry the village's figures and are data, in the `seat-presets`
 * document, written here through `PUT /api/admin/seat-presets`. The rules a
 * save must meet are `seatPresetsDocProblems` (shared/seatTermsOffer.ts), and
 * the route answers with the same sentence this shows.
 *
 * RETIRED, NEVER DELETED. There is no delete button because the route refuses
 * one: an offer may name the preset it started from, and a drawer that cannot
 * find it cannot say so. Retiring takes a preset out of the picker and keeps
 * it in the document. Changing a preset's values raises its version.
 *
 * A person's own card is never copied in here. A preset is a shape a village
 * offers any seat, so it carries a seat's terms and no member's name.
 *
 * Light only, by ruling, in the admin's own inks.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { GROUP_LABELS, SETTINGS_GROUPS, type SeatSettings, type SettingsGroup } from "@shared/seatSettings";
import { seatPresetsDocProblems, villagePresetsFrom, type VillagePresetRow } from "@shared/seatTermsOffer";
import SeatSettingsFields from "@/components/governance/SeatSettingsFields";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { forgetVillagePresets } from "@/lib/seatPresetsRead";
import { settingsWords } from "@shared/seatSettings";

export const PRESET_EDITOR_WORDS = {
  title: "Village seat presets",
  sub: "Starting points for a seat's terms, with this village's own figures. Members pick them after the platform's shapes. Retired presets leave the picker and stay on record.",
  add: "Add a preset",
  group: "Group",
  label: "Name",
  blurb: "One line a member reads",
  save: "Save preset",
  retire: "Retire",
  retired: "retired",
  none: "No village presets yet.",
} as const;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export default function VillagePresetsEditor({ password }: { password: string }) {
  const [rows, setRows] = useState<VillagePresetRow[] | null>(null);
  const [group, setGroup] = useState<SettingsGroup>("pay");
  const [label, setLabel] = useState("");
  const [blurb, setBlurb] = useState("");
  const [draft, setDraft] = useState<SeatSettings>({ v: 1 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/seat-presets`, { headers: authHeaders(password) });
    const body = await res.json().catch(() => ({}));
    setRows(res.ok && Array.isArray(body?.presets) ? body.presets : []);
  }, [password]);
  useEffect(() => {
    void load();
  }, [load]);

  const put = async (presets: VillagePresetRow[], said: string) => {
    const problems = seatPresetsDocProblems({ presets }, { presets: rows ?? [] });
    if (problems.length > 0) {
      toast.error(problems[0]);
      return false;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/seat-presets`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ presets }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(refusal(body, "That did not save"));
        return false;
      }
      toast.success(said);
      forgetVillagePresets();
      setRows(Array.isArray(body?.presets) ? body.presets : presets);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const id = `custom:${slug(label)}`;
    const row: VillagePresetRow = { id, group, label: label.trim(), blurb: blurb.trim(), version: 1, values: draft[group] ?? null, retiredAt: null };
    if (await put([...(rows ?? []), row], "Preset saved")) {
      setLabel("");
      setBlurb("");
      setDraft({ v: 1 });
    }
  };

  const retire = (id: string) =>
    void put(
      (rows ?? []).map((r) => (r.id === id ? { ...r, retiredAt: new Date().toISOString().slice(0, 10) } : r)),
      "Preset retired",
    );

  const readable = new Map(villagePresetsFrom({ presets: rows ?? [] }).map((p) => [p.id, p]));
  const inputCls = "mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5" data-village-presets-editor="">
      <h3 className="font-semibold text-gray-900">{PRESET_EDITOR_WORDS.title}</h3>
      <p className="mt-1 text-xs text-gray-500">{PRESET_EDITOR_WORDS.sub}</p>

      <ul className="mt-3 space-y-2">
        {(rows ?? []).length === 0 && <li className="text-xs text-gray-400">{PRESET_EDITOR_WORDS.none}</li>}
        {(rows ?? []).map((r) => {
          const p = readable.get(r.id);
          const headline = p ? settingsWords({ v: 1, [p.group]: p.values } as SeatSettings).find((w) => w.group === p.group)?.headline : null;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <span className="font-medium text-gray-800">{r.label}</span>
              <span className="text-xs text-gray-500">
                {GROUP_LABELS[r.group] ?? r.group} · v{r.version}
              </span>
              {headline && <span className="text-xs text-gray-600">{headline}</span>}
              {r.retiredAt ? (
                <span className="ml-auto text-xs text-gray-400">{PRESET_EDITOR_WORDS.retired} {r.retiredAt}</span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => retire(r.id)}
                  className="ml-auto min-h-[44px] rounded-lg px-3 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
                >
                  {PRESET_EDITOR_WORDS.retire}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <p className="text-sm font-medium text-gray-800">{PRESET_EDITOR_WORDS.add}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-gray-500">
            {PRESET_EDITOR_WORDS.group}
            <select value={group} onChange={(e) => setGroup(e.target.value as SettingsGroup)} className={inputCls}>
              {SETTINGS_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            {PRESET_EDITOR_WORDS.label}
            <input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-gray-500">
            {PRESET_EDITOR_WORDS.blurb}
            <input value={blurb} maxLength={200} onChange={(e) => setBlurb(e.target.value)} className={inputCls} />
          </label>
        </div>
        <div className="mt-3">
          <SeatSettingsFields group={group} settings={draft} onChange={setDraft} />
        </div>
        <button
          type="button"
          disabled={busy || !label.trim() || draft[group] === undefined}
          onClick={() => void add()}
          className="mt-3 min-h-[44px] rounded-lg border border-gray-200 px-3 text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
        >
          {PRESET_EDITOR_WORDS.save}
        </button>
      </div>
    </div>
  );
}
