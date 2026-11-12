/**
 * "Show my light on the map" (Phase D, D2): the member's own choice, on their
 * own settings, and the only control for it anywhere.
 *
 * Off by default. The switch FOLLOWS the server's answer instead of leading
 * it, the way the contact consent beside it does: a refusal or a dropped
 * request leaves it where it was and says so, so a member who turned their
 * light off is never shown "off" while the server still holds "on".
 *
 * Drawn only where the village runs the map; its doors live under `/api/map`
 * and answer nothing when the map is off.
 */
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { gameFetch } from "@/lib/gameApi";
import { useModuleOn } from "@/modules/ModuleProvider";

/** The anchor the map's "Change it" link lands on. */
export const MAP_LIGHT_ANCHOR = "map-light";

export default function MapLightSetting() {
  const mapOn = useModuleOn("map");
  const { t } = useLingui();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!mapOn) return;
    let live = true;
    gameFetch("/api/map/my-light")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live && b && typeof b.on === "boolean") setOn(b.on); })
      .catch(() => {});
    return () => { live = false; };
  }, [mapOn]);

  /* The control arrives after its read, well after the browser looked for the
     anchor, so a "Change it" link from the map scrolls here itself. */
  const loaded = on !== null;
  useEffect(() => {
    if (!loaded || window.location.hash !== `#${MAP_LIGHT_ANCHOR}`) return;
    document.getElementById(MAP_LIGHT_ANCHOR)?.scrollIntoView?.({ block: "center" });
  }, [loaded]);

  if (!mapOn || on === null) return null;

  const save = async (next: boolean) => {
    setSaving(true);
    setNote("");
    try {
      const res = await gameFetch("/api/map/my-light", { method: "PUT", body: JSON.stringify({ on: next }) });
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (!res.ok || !body || typeof body.on !== "boolean") {
        setNote(t({ context: "map light setting, refused", message: "That did not save. Your light is unchanged." }));
        return;
      }
      setOn(body.on);
    } catch {
      setNote(t({ context: "map light setting, offline", message: "That did not reach the server. Your light is unchanged." }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id={MAP_LIGHT_ANCHOR} className="scroll-mt-28 mb-4" data-map-light-setting>
      <label className="flex min-h-11 items-start gap-2 text-sm text-card-foreground">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          checked={on}
          disabled={saving}
          aria-describedby="map-light-hint"
          onChange={(e) => void save(e.target.checked)}
        />
        <span>
          <Trans context="map light setting">Show my light on the map</Trans>
          <span id="map-light-hint" className="block text-xs text-muted-foreground">
            <Trans context="map light setting, hint">
              When you join a circle&apos;s meeting today, a firefly joins the others at its hearth. Only signed-in members see it, it never carries your name, and a light shows only when at least one other is there too.
            </Trans>
          </span>
        </span>
      </label>
      {note && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {note}
        </p>
      )}
    </div>
  );
}
