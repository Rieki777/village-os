/**
 * LANDING ON A VILLAGE-LEVEL SETTING THE LAUNCH CHECKLIST LINKED TO.
 *
 * The two facts a village inherits in silence, its timezone and its currency,
 * live on two different admin screens rather than on a module card, so the
 * addresses are `?tab=season&setting=season.timezone` and
 * `?tab=setup&setting=project.fiatCurrency`. This is the other end of both.
 *
 * WHY NOT A `#hash`. The field only exists after its tab has fetched, long
 * after the browser's own hash jump has fired, and the tab already lives in
 * the query string. So the address carries the key and this focuses the
 * control once it is really there.
 *
 * WHY THE KEY IS CONSUMED. `setActiveTab` copies the whole query string
 * forward as a founder moves between tabs, so a `setting` left behind would
 * grab focus again every time they came back, for a question answered weeks
 * ago.
 */
import { useEffect } from "react";

/** The setting an address names, or null. Safe anywhere. */
export function settingFromUrl(search: string): string | null {
  try {
    return new URLSearchParams(search).get("setting");
  } catch {
    return null;
  }
}

/** Drop `setting`, keeping the rest of the address exactly as it was. */
export function forgetSetting(): void {
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

/**
 * Focus the control this screen owns, if the address asked for it.
 *
 * @param key    the setting this screen answers for, e.g. "season.timezone"
 * @param elementId the control's own id
 * @param ready  false while the screen's data is still in flight, because
 *   focusing a field that has not rendered focuses nothing
 */
export function useSettingFocus(key: string, elementId: string, ready: boolean): void {
  useEffect(() => {
    if (!ready || settingFromUrl(window.location.search) !== key) return;
    const el = document.getElementById(elementId);
    if (el) {
      // Optional call: jsdom has no scrollIntoView, and an unguarded one
      // throws inside the effect and takes the focus below it with it, which
      // is a link that scrolls and never lands.
      el.scrollIntoView?.({ block: "center" });
      el.focus({ preventScroll: true });
    }
    forgetSetting();
  }, [key, elementId, ready]);
}
