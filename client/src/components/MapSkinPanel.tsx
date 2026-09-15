import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { writeStored } from "@/lib/safeStorage";
import {
  DEFAULT_MAP_SKIN,
  FLOW_STYLES,
  ICON_MODES,
  LABEL_STYLES,
  MAP_SKIN_SAVED_EVENT,
  MAP_SKIN_SAVED_KEY,
  MAP_THEMES,
  RUNTIME_PAINTERLY,
  SKIN_BOUNDS,
  type MapSkin,
} from "@shared/mapSkin";

/**
 * Admin, Make This Yours, step 6: how the Living Map draws this village.
 *
 * Every dial the map itself offers is here, which is deliberate. A founder
 * styling their land wants to see the map change while they decide, so the
 * wizard shows the whole set instead of a curated three.
 *
 * The stored shape is the map artifact's own export format (shared/mapSkin.ts),
 * so a founder can style inside the map, export, and land on these values.
 * Scales are fractions in storage and percent on screen; the conversion
 * happens at this boundary and nowhere else.
 *
 * Self-contained like LookPanel and TypographyPanel, for the same reason:
 * Admin.tsx is a large file other workstreams edit, so the mount is one line.
 */
export default function MapSkinPanel({ password }: { password: string }) {
  const [skin, setSkin] = useState<MapSkin | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Read the skin the MAP reads.
   *
   * `/api/map/skin` is the same document the shell hands the iframe, so the
   * panel and the land can never show different answers. It sits behind the
   * map module's gate, so a village with the map off gets a 404 there; the
   * brand document is the fallback for exactly that case, and it is the same
   * object either way (both are `getBrand().skin`).
   */
  const load = useCallback(async () => {
    try {
      let stored: any = null;
      const viaMap = await fetch("/api/map/skin");
      if (viaMap.ok) stored = (await viaMap.json())?.skin;
      if (!stored) {
        const res = await fetch("/api/admin/brand", { headers: { Authorization: `Bearer ${password}` } });
        stored = (await res.json())?.brand?.skin;
      }
      setSkin({ ...DEFAULT_MAP_SKIN, ...(stored ?? {}) });
    } catch { toast.error("Could not load the map settings"); }
  }, [password]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!skin) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brand", {
        method: "PUT",
        headers: { Authorization: `Bearer ${password}`, "Content-Type": "application/json" },
        body: JSON.stringify({ skin }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      // Read the saved document back. The server clamps and drops values it
      // does not recognise, so showing what it stored keeps the panel honest
      // about a colour or a scale that did not survive the trip.
      setSkin({ ...DEFAULT_MAP_SKIN, ...(data.brand?.skin ?? {}) });
      /*
       * Tell an open map to retint. Twice, for the two places it can be: the
       * custom event reaches this tab, the localStorage write reaches the
       * others. The timestamp is never read; it exists so the key CHANGES,
       * because writing an identical value fires no storage event.
       */
      window.dispatchEvent(new Event(MAP_SKIN_SAVED_EVENT));
      writeStored("local", MAP_SKIN_SAVED_KEY, String(Date.now()));
      toast.success("Map style saved. An open map retints straight away");
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  if (!skin) return null;
  const set = (patch: Partial<MapSkin>) => setSkin({ ...skin, ...patch });

  /** Percent on screen, fraction in storage. */
  const scaleRow = (
    key: "label_scale" | "global_scale",
    label: string,
    hint: string,
  ) => {
    const b = SKIN_BOUNDS[key];
    const pct = Math.round(skin[key] * 100);
    return (
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1" htmlFor={`skin-${key}`}>
          {label} <span className="font-normal text-gray-500">{pct}%</span>
        </label>
        <input
          id={`skin-${key}`}
          type="range"
          min={Math.round(b.min * 100)}
          max={Math.round(b.max * 100)}
          value={pct}
          onChange={(e) => set({ [key]: Number(e.target.value) / 100 } as Partial<MapSkin>)}
          className="w-full accent-teal-deep"
        />
        <p className="text-[11px] text-gray-400">{hint}</p>
      </div>
    );
  };

  /**
   * A painterly dial is a fraction or "not set", and the difference matters:
   * unset leaves the map's baked-in look alone.
   *
   * Percent on the slider, fraction in storage, converted here and nowhere
   * else, exactly like the two scales above. The map's own slider does the
   * same division, which is why the stored value round-trips through its
   * export untouched.
   */
  const dialRow = (key: "brush" | "palette", label: string) => {
    const value = skin.painterly[key];
    const setDial = (v: number | null) =>
      set({ painterly: { ...skin.painterly, [key]: v } });
    /*
     * An unset dial shows what the map ACTUALLY draws, not a middle guess.
     * The slider sits at the runtime default and storage stays null until the
     * founder moves it, so opening this panel and saving changes nothing.
     */
    const shown = value ?? RUNTIME_PAINTERLY[key];
    return (
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1" htmlFor={`skin-${key}`}>
          {label}{" "}
          <span className="font-normal text-gray-500">
            {Math.round(shown * 100)}%{value === null ? " (map default)" : ""}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`skin-${key}`}
            type="range"
            min={Math.round(SKIN_BOUNDS.painterly.min * 100)}
            max={Math.round(SKIN_BOUNDS.painterly.max * 100)}
            value={Math.round(shown * 100)}
            onChange={(e) => setDial(Number(e.target.value) / 100)}
            className="flex-1 accent-teal-deep"
          />
          {value !== null && (
            <button type="button" onClick={() => setDial(null)}
              className="text-xs text-gray-400 underline underline-offset-2 shrink-0">
              reset
            </button>
          )}
        </div>
      </div>
    );
  };

  const colourRow = (key: "accent" | "parchment", label: string, placeholder: string) => (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(skin[key]) ? skin[key] : placeholder}
          onChange={(e) => set({ [key]: e.target.value } as Partial<MapSkin>)}
          aria-label={label}
          className="h-9 w-12 rounded border border-gray-200 cursor-pointer"
        />
        <input
          value={skin[key]}
          onChange={(e) => set({ [key]: e.target.value } as Partial<MapSkin>)}
          placeholder={placeholder}
          className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 w-28 font-mono"
        />
        {skin[key] && (
          <button type="button" onClick={() => set({ [key]: "" } as Partial<MapSkin>)}
            className="text-xs text-gray-400 underline underline-offset-2">clear</button>
        )}
      </div>
    </div>
  );

  /*
   * The three "pick one of the map's words" rows. Options come from the
   * shared allowlists rather than being typed here, so the panel cannot offer
   * a value the sanitiser will throw away on save.
   */
  const choiceRow = (
    key: "icon_mode" | "flow_style" | "label_style",
    label: string,
    options: readonly string[],
    hint: string,
  ) => (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1.5" htmlFor={`skin-${key}`}>{label}</label>
      <select
        id={`skin-${key}`}
        value={skin[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<MapSkin>)}
        className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white"
      >
        {options.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <p className="text-[11px] text-gray-400 mt-1">{hint}</p>
    </div>
  );

  /*
   * The checkbox is named by the toggle, described by the line under it. A
   * wrapping <label> would otherwise read both as one name, so a reader
   * tabbing these heard "Dream mist A soft haze over the land." where the
   * useful word is the first two.
   */
  const toggleRow = (key: "mist" | "glow", label: string, hint: string) => (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={skin[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<MapSkin>)}
        aria-label={label}
        aria-describedby={`map-skin-${key}-hint`}
        className="h-4 w-4 mt-0.5 accent-teal-deep"
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span id={`map-skin-${key}-hint`} className="block text-[11px] text-gray-400">{hint}</span>
      </span>
    </label>
  );

  return (
    <div>
      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1.5" htmlFor="skin-theme">Land theme</label>
          <select
            id="skin-theme"
            value={skin.theme}
            onChange={(e) => set({ theme: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white"
          >
            <option value="">Keep the map's own theme</option>
            {MAP_THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1.5" htmlFor="skin-words">Your land, in words</label>
          <input
            id="skin-words"
            value={skin.words}
            onChange={(e) => set({ words: e.target.value.slice(0, 160) })}
            placeholder="high desert, red rock and juniper"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Grows a theme from the words themselves. The map uses this when no theme is picked above.
          </p>
        </div>

        {/* theme-ok: neutral colour-input default, never rendered as chrome */}
        {colourRow("accent", "Accent", "#157f7d")}
        {/* theme-ok: neutral colour-input default, never rendered as chrome */}
        {colourRow("parchment", "Parchment", "#f3e7cf")}

        {scaleRow("label_scale", "Label size", "How large place names are drawn.")}
        {scaleRow("global_scale", "Map scale", "How large the whole plate is drawn.")}

        {choiceRow("icon_mode", "Icon style", ICON_MODES,
          "Painted buildings, flat isometric ones, or let the map choose per building.")}
        {choiceRow("flow_style", "Flow lines", FLOW_STYLES,
          "How water, energy and the rest are drawn moving between places.")}
        {choiceRow("label_style", "Place names", LABEL_STYLES,
          "Ribbons under each place, or carved tablets.")}

        <div className="space-y-3 self-center">
          {toggleRow("mist", "Dream mist", "A soft haze over the land.")}
          {toggleRow("glow", "Village pulse", "Lit buildings breathe when something is happening there.")}
        </div>

        {dialRow("brush", "Paint brush")}
        {dialRow("palette", "Palette")}
      </div>

      {/* The caveat that used to live here is gone: the map's applySkinExport
          now drives the repaint from painterly.brush and painterly.palette, so
          both dials are real. */}
      <p className="text-xs text-gray-500 mb-4">
        Saved styling reaches an open map straight away. Everything here travels with the
        map's own export, so you can style inside the map and bring the result back.
      </p>

      <button onClick={save} disabled={saving}
        className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
        {saving ? "Saving..." : "Save map style"}
      </button>
    </div>
  );
}
