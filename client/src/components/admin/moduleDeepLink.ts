/**
 * READING THE ADDRESS A SETUP LINK ARRIVED ON, once.
 *
 * `/admin?tab=modules&module=<id>&setting=<key>` is where every "here is
 * exactly what you need" link lands (shared/moduleSetupLink.ts). This hook is
 * the other end: it opens that module's settings, scrolls the card into view,
 * hands the key down to the settings section to focus, and then takes the key
 * back out of the URL.
 *
 * WHY THE KEY IS CONSUMED. `setActiveTab` in Admin copies the whole query
 * string forward when a founder moves between tabs, so a `setting` left in the
 * address would come back every time the Modules tab remounts and yank focus
 * to a dial nobody asked about this time. The module id deliberately stays:
 * that one is a place, and returning to the tab you were on is the behaviour
 * the Game Mechanics links have always had.
 *
 * It lives in its own file rather than inside Admin.tsx because that file sits
 * under a line ratchet that only ever turns down, and because the reading is
 * testable on its own.
 */
import { useCallback, useEffect, useState } from "react";

/** The module and dial an address names, or nulls. Safe in any environment. */
export function readModuleDeepLink(search: string): { moduleId: string | null; settingKey: string | null } {
  try {
    const p = new URLSearchParams(search);
    return { moduleId: p.get("module"), settingKey: p.get("setting") };
  } catch {
    return { moduleId: null, settingKey: null };
  }
}

/**
 * Drop `setting` from the address, keeping everything else exactly as it was.
 * `replaceState` rather than `pushState`: arriving at a dial is not a place in
 * the founder's history to come back to, and a Back button that walked them
 * through the same focus again would be a trap of our own making.
 */
export function forgetSettingParam(): void {
  try {
    const p = new URLSearchParams(window.location.search);
    if (!p.has("setting")) return;
    p.delete("setting");
    const q = p.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  } catch {
    /* an address we cannot rewrite is not a reason to fail the render */
  }
}

export interface ModuleDeepLink {
  /** Which card has its settings open. The deep link opens one; a click toggles. */
  settingsId: string | null;
  setSettingsId: (id: string | null) => void;
  /** The dial the link came for, until it has been focused once. */
  focusKey: string | null;
  /**
   * Aim the focus at a dial without a navigation, for the one surface where
   * the card is already on screen: the hint on the Modules tab opens the
   * settings in place rather than reloading the whole panel to arrive where
   * the founder already was.
   */
  setFocusKey: (key: string | null) => void;
  /** Called by the settings section once it has tried to focus. */
  clearFocusKey: () => void;
}

/**
 * @param loaded false while the catalog is still in flight, because scrolling
 *   to a card that has not rendered scrolls to nothing.
 */
export function useModuleDeepLink(loaded: boolean): ModuleDeepLink {
  const initial = readModuleDeepLink(typeof window === "undefined" ? "" : window.location.search);
  const [settingsId, setSettingsId] = useState<string | null>(initial.moduleId);
  const [focusKey, setFocusKey] = useState<string | null>(initial.settingKey);

  useEffect(() => {
    if (!loaded || !settingsId) return;
    document.getElementById(`module-card-${settingsId}`)?.scrollIntoView?.({ block: "start" });
  }, [loaded, settingsId]);

  const clearFocusKey = useCallback(() => {
    setFocusKey(null);
    forgetSettingParam();
  }, []);

  return { settingsId, setSettingsId, focusKey, setFocusKey, clearFocusKey };
}
