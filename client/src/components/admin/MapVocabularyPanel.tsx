/**
 * The village's own words for what is on its map.
 *
 * `PUT /api/admin/map/vocabulary` has existed, been sanitised and been round
 * tripped through the scene export since the map shipped, and nothing in the
 * browser ever called it: the only writer was `scripts/import-map-scene.ts`, a
 * CLI. So a village could rename nothing without a developer.
 *
 * The artifact does apply these live. Its message handler takes
 * `{type:"config", vocabulary}` through `applyVocabulary` over
 * `VOCAB_KEYS = ['road','water','zone','media','phases']`, and the shell pushes
 * the document into the frame on every load (`LivingMap.tsx`).
 *
 * THE WHOLE DOCUMENT GOES BACK, EVERY TIME. `sanitiseMapVocabulary` rebuilds
 * the document from named keys and `put` replaces it, so a save that omitted
 * `media` would erase every medium the village had named. This panel edits four
 * of the five keys and carries `media` through untouched, and it says so where
 * a founder can read it.
 *
 * Takes no password prop, and gates its FETCHES on `useIsAdmin` as well as its
 * JSX, so it can be mounted on the map page without handing a member a console
 * refusal on load. The reasoning in full is in MapSkinPanel.tsx, which moved
 * for the same reason on the same day.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useIsAdmin } from "@/contexts/AuthContext";
import { gameFetch } from "@/lib/gameApi";
import { API_BASE } from "./adminApi";

const inputCls =
  "border border-gray-200 rounded-lg px-2 py-1.5 text-sm min-h-[44px] w-full focus:outline-none focus:ring-2 focus:ring-teal-deep";
const btnCls =
  "min-h-[44px] px-3 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-40";

/** One word per line in, a trimmed list out. */
const linesOf = (list: unknown): string =>
  (Array.isArray(list) ? list : []).map((s) => String(s)).join("\n");
const wordsOf = (text: string): string[] =>
  text.split("\n").map((s) => s.trim()).filter(Boolean);

export default function MapVocabularyPanel() {
  const mayAdminister = useIsAdmin();
  const [vocab, setVocab] = useState<any>(null);
  const [road, setRoad] = useState("");
  const [water, setWater] = useState("");
  const [zone, setZone] = useState("");
  const [phases, setPhases] = useState<Array<[string, string]>>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!mayAdminister) return;
    try {
      const res = await gameFetch(`${API_BASE}/map/vocabulary`);
      const d = res.ok ? await res.json() : null;
      const v = d?.vocabulary ?? {};
      setVocab(v);
      setRoad(linesOf(v.road));
      setWater(linesOf(v.water));
      setZone(linesOf(v.zone));
      setPhases(Object.entries(v.phases ?? {}).map(([k, val]) => [String(k), String(val)]));
    } catch { setVocab(null); }
  }, [mayAdminister]);
  useEffect(() => { void load(); }, [load]);

  // Nothing for a member, matching the fetch gate: every control here writes.
  if (!mayAdminister) return null;
  if (!vocab) return null;

  const save = async () => {
    setSaving(true);
    const next = {
      ...vocab,
      road: wordsOf(road),
      water: wordsOf(water),
      zone: wordsOf(zone),
      phases: Object.fromEntries(phases.filter(([k, v]) => k.trim() && v.trim())),
      // Carried through untouched. Losing it here would erase every medium the
      // village named, because the server replaces the whole document.
      media: Array.isArray(vocab.media) ? vocab.media : [],
    };
    const res = await gameFetch(`${API_BASE}/admin/map/vocabulary`, {
      method: "PUT",
      body: JSON.stringify({ vocabulary: next }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { toast.error(d?.message ?? d?.error ?? "That did not save"); return; }
    // The server echoes back what SURVIVED the sanitiser, so a word it refused
    // disappears from the boxes rather than sitting there looking saved.
    const v = d.vocabulary ?? next;
    setVocab(v);
    setRoad(linesOf(v.road));
    setWater(linesOf(v.water));
    setZone(linesOf(v.zone));
    setPhases(Object.entries(v.phases ?? {}).map(([k, val]) => [String(k), String(val)]));
    toast.success("Words saved. The map reads them on its next load");
  };

  /*
   * THE FIELD NAME IS THE NAME, and the examples under it are a description.
   * A wrapping <label> names its control with every string it contains, so
   * without the explicit aria-label this box announced as "Paths and roads
   * Track, lane, camino. The first is the default." on every focus. The hint
   * earns its place on screen; it just cannot be part of the name.
   */
  const box = (label: string, hint: string, value: string, onChange: (v: string) => void) => {
    const hintId = `map-vocab-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-hint`;
    return (
      <label className="text-xs text-gray-500 block">
        <span className="font-medium text-gray-700">{label}</span>
        <textarea rows={5} value={value} onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          aria-describedby={hintId}
          className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep" />
        <span id={hintId} className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>
      </label>
    );
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <h3 className="font-semibold text-gray-900 mb-1">The map's words</h3>
      <p className="text-xs text-gray-500 mb-3">
        What this village calls its paths, its water and its areas, and what it
        calls each build phase. The map applies these the next time it loads.
        One word per line.
      </p>

      <div className="grid sm:grid-cols-3 gap-3">
        {box("Paths and roads", "Track, lane, camino. The first is the default.", road, setRoad)}
        {box("Water", "Creek, spring, quebrada.", water, setWater)}
        {box("Areas and zones", "Zone one, food forest, the flats.", zone, setZone)}
      </div>

      <fieldset className="mt-4 border-0 p-0 m-0">
        <legend className="text-xs font-medium text-gray-700">Build phases</legend>
        <p className="text-[11px] text-gray-400 mb-2">
          The map keeps the numbers for its export; these are the words a person reads.
        </p>
        <div className="space-y-2">
          {phases.map(([k, v], i) => (
            <div key={i} className="grid sm:grid-cols-12 gap-2 items-end">
              <label className="text-xs text-gray-500 sm:col-span-3">
                Phase number
                <input value={k} inputMode="numeric" className={`${inputCls} mt-1`}
                  onChange={(e) => setPhases(phases.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
              </label>
              <label className="text-xs text-gray-500 sm:col-span-7">
                What it is called
                <input value={v} className={`${inputCls} mt-1`}
                  onChange={(e) => setPhases(phases.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
              </label>
              <div className="sm:col-span-2">
                <button type="button" className={`${btnCls} text-red-600 border-red-200 w-full`}
                  aria-label={`Remove phase ${k}`}
                  onClick={() => setPhases(phases.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className={`${btnCls} mt-2`}
          onClick={() => setPhases([...phases, [String(phases.length + 1), ""]])}>Add a phase</button>
      </fieldset>

      <p className="text-[11px] text-gray-400 mt-4">
        {Array.isArray(vocab.media) && vocab.media.length
          ? `${vocab.media.length} named medium(s) travel with this document and are edited on the map itself. Saving here keeps them.`
          : "Media types are named on the map itself and travel with this document."}
      </p>

      <button type="button" onClick={save} disabled={saving}
        className="mt-3 min-h-[44px] px-4 text-sm rounded-lg bg-teal-deep text-white font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-deep disabled:opacity-40">
        {saving ? "Saving…" : "Save the words"}
      </button>
    </div>
  );
}
