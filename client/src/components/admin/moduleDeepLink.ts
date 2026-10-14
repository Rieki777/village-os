/**
 * READING THE ADDRESS A SETUP LINK ARRIVED ON, once.
 *
 * `/modules/<id>#setting-<key>` is where every "here is exactly what you need"
 * link lands (shared/moduleSetupLink.ts); old `/admin?tab=modules&...`
 * addresses are redirected there by the admin page. This hook is the other
 * end: it opens the module's settings, scrolls them into view, hands the key
 * down to the settings section to focus, and then takes the fragment back out
 * of the address.
 *
 * WHY THE KEY IS CONSUMED. A fragment left in the address comes back with the
 * Back button and every reload, and would yank focus to a dial nobody asked
 * about this time. `replaceState`, so arriving at a dial is not a place in the
 * founder's history to come back to.
 *
 * It lives in its own file because the reading is testable on its own.
 */
import { useCallback, useEffect, useState } from "react";

/** The dial a fragment names (`#setting-calendar.hemisphere`), or null. */
export function readSettingFragment(hash: string): string | null {
  const m = /^#?setting-(.+)$/.exec(hash ?? "");
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]) || null;
  } catch {
    return null;
  }
}

/** Drop the `#setting-` fragment, keeping the path and query exactly as they were. */
export function forgetSettingFragment(): void {
  try {
    if (!readSettingFragment(window.location.hash)) return;
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
  } catch {
    /* an address we cannot rewrite is not a reason to fail the render */
  }
}

export interface ModuleDeepLink {
  /** Whether the settings are open. A deep link opens them; a click toggles. */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** The dial the link came for, until it has been focused once. */
  focusKey: string | null;
  /** Aim the focus at a dial without a navigation (a setup hint on the same page). */
  setFocusKey: (key: string | null) => void;
  /** Called by the settings section once it has tried to focus. */
  clearFocusKey: () => void;
}

/**
 * @param loaded false while the steward's rows are in flight, because scrolling
 *   to settings that have not rendered scrolls to nothing.
 */
export function useModuleDeepLink(loaded: boolean): ModuleDeepLink {
  const initial = readSettingFragment(typeof window === "undefined" ? "" : window.location.hash);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(!!initial);
  const [focusKey, setFocusKey] = useState<string | null>(initial);

  useEffect(() => {
    if (!loaded || !settingsOpen || !focusKey) return;
    document.getElementById("module-settings")?.scrollIntoView?.({ block: "start" });
  }, [loaded, settingsOpen, focusKey]);

  const clearFocusKey = useCallback(() => {
    setFocusKey(null);
    forgetSettingFragment();
  }, []);

  return { settingsOpen, setSettingsOpen, focusKey, setFocusKey, clearFocusKey };
}
