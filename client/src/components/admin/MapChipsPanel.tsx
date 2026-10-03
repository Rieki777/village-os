import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useIsAdmin } from "@/contexts/AuthContext";
import { gameFetch } from "@/lib/gameApi";
import { writeStored } from "@/lib/safeStorage";
import {
  CHIP_ICONS,
  CHIP_ICON_NAMES,
  CHIP_ICON_PATHS,
  DEFAULT_MAP_CHIPS,
  MAP_CHIPS_SAVED_EVENT,
  MAP_CHIPS_SAVED_KEY,
  MAX_MAP_CHIPS,
  STAT_SOURCES,
  STAT_SOURCE_GROUPS,
  STAT_SOURCE_KEYS,
  chipWithSource,
  freshChipId,
  isStatSource,
  type ChipIcon,
  type ChipSource,
  type MapChip,
  type ResolvedChip,
} from "@shared/mapStatChips";

/**
 * Village settings: the chips across the top of the Living Map.
 *
 * Rye, deciding F29 (2026-10-02): "Mark them as examples and wire them to
 * admin where we can add in a label and a datasource ... and make them highly
 * customizable this way. Label as example - this label goes away once set."
 *
 * So every chip is a row here: what it is called, its icon, what it reads,
 * the unit after the number, and the page its drop-down opens. A founder adds,
 * removes and reorders them. "Not set yet" keeps the map's own example number
 * and the map says "example" on the chip; any other choice draws the reading
 * and the word goes.
 *
 * Mounted in the Village settings drawer on the map (VillageSettingsDoor),
 * beside the skin, the walk and the words, because this is how the land looks
 * and a founder should watch it change while deciding.
 *
 * THE GATE IS THE SKIN EDITOR'S. Rendered and fetched only when `useIsAdmin`
 * says so, the same rule the server's `isAdmin` applies to the two routes
 * behind it (server/routes/mapChips.ts), and authenticated from the session
 * through `gameFetch`, for the reasons MapSkinPanel.tsx gives in full.
 */

interface SourceOption {
  key: string;
  label: string;
  sub: string;
  how: string;
  unit: string;
  icon: ChipIcon;
  link: string;
  group: string;
  /** Why a visitor would not see this source's chip, or null. */
  hiddenFromVisitors: string | null;
}

interface EditorView {
  chips: MapChip[];
  preview: ResolvedChip[];
  sources: SourceOption[];
}

const inputCls =
  "w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-deep";
const iconBtnCls =
  "shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-40";
const btnCls =
  "min-h-[44px] px-3 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-40";

/** Today, the way a date input writes it, in this browser's own day. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The registry as the editor shows it when the server has not said more. */
const LOCAL_SOURCES: SourceOption[] = STAT_SOURCE_KEYS.map((key) => ({
  key,
  ...STAT_SOURCES[key],
  hiddenFromVisitors: null,
}));

function ChipIconGlyph({ icon }: { icon: ChipIcon }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7"
      aria-hidden="true" focusable="false" className="shrink-0 text-teal-deep">
      <path d={CHIP_ICON_PATHS[icon] ?? CHIP_ICON_PATHS.star} />
    </svg>
  );
}

/** What the map shows for a saved chip, in a sentence. */
function previewLine(p: ResolvedChip | undefined): string {
  if (!p) return "";
  if (p.state === "live") return `The map shows ${p.value}, ${p.sub}.`;
  if (p.state === "manual") return `The map shows ${p.value}, ${p.sub}.`;
  if (p.state === "unavailable") return `Visitors do not see this chip. ${p.why ?? ""}`.trim();
  return "The map shows its example number, marked as an example.";
}

export default function MapChipsPanel() {
  const mayAdminister = useIsAdmin();
  const [chips, setChips] = useState<MapChip[] | null>(null);
  const [preview, setPreview] = useState<ResolvedChip[]>([]);
  const [sources, setSources] = useState<SourceOption[]>(LOCAL_SOURCES);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const take = (v: Partial<EditorView>) => {
    if (Array.isArray(v.chips)) setChips(v.chips);
    if (Array.isArray(v.preview)) setPreview(v.preview);
    if (Array.isArray(v.sources) && v.sources.length) setSources(v.sources);
    setDirty(false);
  };

  // No request at all for a viewer who cannot administer: see MapSkinPanel.
  const load = useCallback(async () => {
    if (!mayAdminister) return;
    try {
      const res = await gameFetch("/api/admin/map/chips");
      if (!res.ok) throw new Error(String(res.status));
      take(await res.json());
    } catch {
      toast.error("Could not load the map's chips");
    }
  }, [mayAdminister]);
  useEffect(() => { void load(); }, [load]);

  if (!mayAdminister || !chips) return null;

  const change = (next: MapChip[]) => {
    setChips(next);
    setDirty(true);
  };
  const edit = (i: number, patch: Partial<MapChip>) => change(chips.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= chips.length) return;
    const next = [...chips];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const add = () => {
    if (chips.length >= MAX_MAP_CHIPS) return;
    const id = freshChipId("chip", chips.map((c) => c.id));
    change([...chips, { id, label: "New chip", icon: "star", source: "none", unit: "", format: "compact", link: "", manual: null }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await gameFetch("/api/admin/map/chips", {
        method: "PUT",
        body: JSON.stringify({ chips }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "The chips did not save");
        return;
      }
      // What the server kept, which is what the map will draw.
      take(body);
      window.dispatchEvent(new Event(MAP_CHIPS_SAVED_EVENT));
      writeStored("local", MAP_CHIPS_SAVED_KEY, String(Date.now()));
      toast.success("Chips saved. An open map shows them straight away");
    } catch {
      toast.error("The chips did not save");
    } finally {
      setSaving(false);
    }
  };

  const links = Array.from(new Set(sources.map((s) => s.link).filter(Boolean))).sort();

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <h3 className="font-semibold text-gray-900 mb-1">The numbers across the top of the map</h3>
      <p className="text-xs text-gray-500 mb-3">
        Each chip reads something the village keeps, or a number you type. A chip you have not set
        shows the map's example number and says example on it, until you choose what it reads.
      </p>

      <datalist id="map-chip-links">
        {links.map((l) => <option key={l} value={l} />)}
      </datalist>

      <ol className="space-y-3 list-none p-0 m-0">
        {chips.map((chip, i) => {
          const src = sources.find((s) => s.key === chip.source);
          const shown = preview.find((p) => p.id === chip.id);
          const name = chip.label || `Chip ${i + 1}`;
          const fieldId = (f: string) => `map-chip-${chip.id}-${f}`;
          return (
            <li key={chip.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <ChipIconGlyph icon={chip.icon} />
                <span className="font-medium text-sm text-gray-900 flex-1 min-w-0 truncate">{name}</span>
                {/* Icons with names, so a 400px drawer keeps room for the chip's own name. */}
                <button type="button" className={iconBtnCls} disabled={i === 0} onClick={() => move(i, -1)}
                  aria-label={`Move ${name} earlier`} title="Earlier on the bar">
                  <ArrowUp className="w-4 h-4" aria-hidden="true" />
                </button>
                <button type="button" className={iconBtnCls} disabled={i === chips.length - 1} onClick={() => move(i, 1)}
                  aria-label={`Move ${name} later`} title="Later on the bar">
                  <ArrowDown className="w-4 h-4" aria-hidden="true" />
                </button>
                <button type="button" className={`${iconBtnCls} text-red-600 border-red-200`}
                  onClick={() => change(chips.filter((_, j) => j !== i))}
                  aria-label={`Take ${name} off the map`} title="Take it off the bar">
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-2">
                <label className="text-xs text-gray-500 sm:col-span-2" htmlFor={fieldId("source")}>
                  What it reads
                  <select id={fieldId("source")} className={`${inputCls} mt-1`} value={chip.source}
                    onChange={(e) => edit(i, chipWithSource(chip, e.target.value as ChipSource, today()))}>
                    <option value="none">Not set yet (shows an example)</option>
                    <option value="manual">A number I type</option>
                    {STAT_SOURCE_GROUPS.map((g) => (
                      <optgroup key={g} label={g}>
                        {sources.filter((s) => s.group === g).map((s) => (
                          <option key={s.key} value={s.key}>{s.label}: {s.sub}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-gray-500" htmlFor={fieldId("label")}>
                  Name on the chip
                  <input id={fieldId("label")} className={`${inputCls} mt-1`} value={chip.label} maxLength={24}
                    onChange={(e) => edit(i, { label: e.target.value })} />
                </label>

                <label className="text-xs text-gray-500" htmlFor={fieldId("icon")}>
                  Icon
                  <select id={fieldId("icon")} className={`${inputCls} mt-1`} value={chip.icon}
                    onChange={(e) => edit(i, { icon: e.target.value as ChipIcon })}>
                    {CHIP_ICONS.map((k) => <option key={k} value={k}>{CHIP_ICON_NAMES[k]}</option>)}
                  </select>
                </label>

                <label className="text-xs text-gray-500" htmlFor={fieldId("unit")}>
                  Unit after the number
                  <input id={fieldId("unit")} className={`${inputCls} mt-1`} value={chip.unit} maxLength={8}
                    placeholder="kg, %, ha" onChange={(e) => edit(i, { unit: e.target.value })} />
                </label>

                {isStatSource(chip.source) && (
                  <label className="text-xs text-gray-500" htmlFor={fieldId("format")}>
                    Large numbers
                    <select id={fieldId("format")} className={`${inputCls} mt-1`} value={chip.format}
                      onChange={(e) => edit(i, { format: e.target.value === "full" ? "full" : "compact" })}>
                      <option value="compact">Short, like 12.4k</option>
                      <option value="full">In full, like 12,400</option>
                    </select>
                  </label>
                )}

                <label className="text-xs text-gray-500 sm:col-span-2" htmlFor={fieldId("link")}>
                  Page it opens
                  <input id={fieldId("link")} className={`${inputCls} mt-1`} value={chip.link} maxLength={64}
                    list="map-chip-links" placeholder="/quests"
                    onChange={(e) => edit(i, { link: e.target.value.trim() })} />
                </label>

                {chip.source === "manual" && (
                  <>
                    <label className="text-xs text-gray-500" htmlFor={fieldId("value")}>
                      Your number
                      <input id={fieldId("value")} className={`${inputCls} mt-1`} maxLength={16}
                        value={chip.manual?.value ?? ""}
                        onChange={(e) => edit(i, { manual: { value: e.target.value, asOf: chip.manual?.asOf ?? today() } })} />
                    </label>
                    <label className="text-xs text-gray-500" htmlFor={fieldId("asof")}>
                      True as of
                      <input id={fieldId("asof")} type="date" className={`${inputCls} mt-1`}
                        value={chip.manual?.asOf ?? ""}
                        onChange={(e) => edit(i, { manual: { value: chip.manual?.value ?? "", asOf: e.target.value } })} />
                    </label>
                  </>
                )}
              </div>

              {src && <p className="text-[11px] text-gray-400 mt-2">{src.how}</p>}
              {/* Before a save, the warning; after it, the preview says the same thing once. */}
              {dirty && src?.hiddenFromVisitors && (
                <p className="text-[11px] text-amber-700 mt-1">{src.hiddenFromVisitors}</p>
              )}
              {!dirty && shown && <p className="text-[11px] text-gray-600 mt-1">{previewLine(shown)}</p>}
            </li>
          );
        })}
      </ol>

      {chips.length === 0 && (
        <p className="text-xs text-gray-500 mt-2">The bar carries only the moon. Add a chip to put a number beside it.</p>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className={btnCls} onClick={add} disabled={chips.length >= MAX_MAP_CHIPS}>
          Add a chip
        </button>
        <button type="button" className={btnCls}
          onClick={() => change(DEFAULT_MAP_CHIPS.map((c) => ({ ...c })))}>
          Put back the five examples
        </button>
      </div>
      {chips.length >= MAX_MAP_CHIPS && (
        <p className="text-[11px] text-gray-400 mt-1">
          The bar holds {MAX_MAP_CHIPS} chips and the moon, which is as many as fit across a phone.
        </p>
      )}

      {dirty && <p className="text-[11px] text-gray-500 mt-3">Save to see what the map will show.</p>}

      <button type="button" onClick={save} disabled={saving}
        className="mt-3 min-h-[44px] px-4 text-sm rounded-lg bg-teal-deep text-white font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-deep disabled:opacity-40">
        {saving ? "Saving..." : "Save the chips"}
      </button>
    </div>
  );
}
