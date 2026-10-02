/**
 * THE CROWN BAR'S CHIPS, CARRIED FROM THE VILLAGE TO THE MAP.
 *
 * The founder chooses what each chip reads in Village settings
 * (MapChipsPanel). The server counts it and resolves every chip
 * (`GET /api/map/chips`, shared/mapStatChips.ts), and the shell does what it
 * does for everything else on the map: carries the answer into the frame as
 * one message, `{type:'chips'}`, and decides nothing about it. The artifact's
 * `applyChips` draws it.
 *
 * CREDENTIALED, through gameFetch. A chip that reads a module this viewer
 * cannot open is left out by the server, and the server can only tell a
 * member from a stranger by the token. Without one a member would be shown
 * the visitor's bar.
 *
 * WHEN IT ASKS. Once when the map has booted, again whenever a founder saves
 * the chips (in this tab or another), again when the tab comes back into
 * view, and every MAP_CHIPS_REFRESH_MS while it is in view. A hidden tab asks
 * nothing: nobody is reading its bar, and the next look asks at once.
 *
 * Every failure is silent and costs only freshness: the map keeps drawing what
 * it drew, which on a first failure is its own five examples, each marked.
 */
import { useEffect } from "react";
import { gameFetch } from "@/lib/gameApi";
import { MAP_CHIPS_REFRESH_MS, MAP_CHIPS_SAVED_EVENT, MAP_CHIPS_SAVED_KEY } from "@shared/mapStatChips";

/** Ask the village for its chips and hand them to the map in `win`. */
export async function pushChips(win: Window | null | undefined): Promise<boolean> {
  if (!win) return false;
  try {
    const res = await gameFetch("/api/map/chips");
    if (!res.ok) return false;
    const body = await res.json();
    if (!Array.isArray(body?.chips)) return false;
    win.postMessage({ type: "chips", chips: body.chips }, window.location.origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep the bar's readings fresh while the map is open and booted.
 *
 * `push` is the caller's own pushChips bound to its frame; `active` is
 * whether the artifact has said it is ready, because a message posted to a
 * map that has not wired its listener yet is lost.
 */
export function useChipsCadence(push: () => void, active: boolean, everyMs: number = MAP_CHIPS_REFRESH_MS): void {
  useEffect(() => {
    if (!active) return;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const tick = () => {
      if (visible()) push();
    };
    const timer = window.setInterval(tick, everyMs);
    const onVisibility = () => {
      if (visible()) push();
    };
    const onSaved = () => push();
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === MAP_CHIPS_SAVED_KEY) push();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(MAP_CHIPS_SAVED_EVENT, onSaved);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(MAP_CHIPS_SAVED_EVENT, onSaved);
      window.removeEventListener("storage", onStorage);
    };
  }, [push, active, everyMs]);
}
