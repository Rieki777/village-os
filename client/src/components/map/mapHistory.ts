/**
 * THE MAP'S HISTORY, IN ONE PLACE: what Back, Forward, a reload and the
 * address bar do while the Living Map is open.
 *
 * Every entry this hook writes sits at the map's own path. There are three
 * kinds, and `history.state` says which one an entry is:
 *
 *   BASE    the entry the visitor arrived on, stamped `villageMapBase`.
 *           Popping to it means LEAVE: it is replaced with `/`, so leaving the
 *           map always lands on the village door, and a second Back does not
 *           walk straight back into the map.
 *   MARKER  pushed once over the base, `{villageMapApp, depth: 1}`. The map
 *           with nothing a visitor opened by hand.
 *   OPEN    pushed when the visitor opens a place, a door, the Loom, the
 *           Circles or a walk from that closed state, `depth: 2, opened`.
 *           Back pops it, so Back CLOSES what is open before it leaves the
 *           map. Moving from one open thing to another replaces it, so a tour
 *           or a run of clicks never stacks up Back presses.
 *
 * THE ADDRESS BAR FOLLOWS THE MAP. The artifact posts `{type:'route', hash}`
 * from its setHash, and the current entry's URL becomes `/map` plus that hash.
 * So F5 reopens the place on screen, a copied link opens it for somebody
 * else, and a door out to the site comes Back to the place it left. An entry
 * also remembers that its visitor already pressed Enter the Land, so coming
 * Back to the map does not ask again (see `arrivedEntered`).
 *
 * WHAT WAS WRONG, measured on 2026-10-01 against production and dev:
 *   - the marker was pushed on EVERY mount, including a return by Back or
 *     Forward onto a marker that already existed. That erased Forward, showed
 *     the gate again, and turned each Back into gate, home, gate, home. In
 *     real Chrome the second push, made with no user activation, got the
 *     entries marked skippable and the toolbar Back left the site;
 *   - every popstate on the map sent the visitor to `/`, including the one a
 *     fragment navigation fires, so pasting `/map#/place/kitchen` into the
 *     address bar of an open map threw them out, and the hash bridge that was
 *     meant to forward it never once ran;
 *   - the address bar never changed while the map was in use, so F5 and a
 *     shared link always came back to the gate with nothing open.
 *
 * ONE WAY OUT, STILL. The artifact's `{type:'exit'}`, the shell's Leave the
 * map door and the browser Back from the marker all end at the base entry,
 * and the base entry is where leaving happens. exitApp goes back by the
 * entry's depth, so it leaves in one press from an open place too.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { arrivedEntered, hashIsMapDeepLink } from "@/components/map/EnterTheLandGate";

type MapEntry = { villageMapApp: true; depth: number; entered?: boolean; opened?: boolean };

/** The map entry `state` describes, or null when it is not one of ours. */
function entryOf(state: unknown): MapEntry | null {
  if (!state || typeof state !== "object") return null;
  const s = state as Record<string, unknown>;
  if (s.villageMapApp !== true) return null;
  const depth = Number(s.depth);
  // An entry written before depths existed is the single marker it was.
  return { ...(s as MapEntry), depth: Number.isInteger(depth) && depth >= 1 ? depth : 1 };
}

function isBase(state: unknown): boolean {
  return !!state && typeof state === "object" && (state as Record<string, unknown>).villageMapBase === true;
}

/**
 * A route the artifact may write into the visible address bar: empty, or one
 * of its own `#/...` addresses. The artifact is same-origin and checked by
 * origin before this runs, and this is the second guard: nothing else reaches
 * the URL, and never the shell's `skipIntro` token or a `hud=` layout hint.
 */
export function isMapRoute(hash: string): boolean {
  if (hash === "") return true;
  if (!/^#\/[A-Za-z0-9_/?=:&.-]*$/.test(hash)) return false;
  return !/skipIntro|hud=/i.test(hash);
}

type Navigate = (to: string, options?: { replace?: boolean }) => void;

export function useMapHistory({
  navigate,
  frame,
  entered,
  enterAt,
}: {
  navigate: Navigate;
  frame: RefObject<HTMLIFrameElement | null>;
  entered: boolean;
  /** Open the map at `hash`, for a deep link that arrives while the gate is up. */
  enterAt: (hash: string) => void;
}) {
  /** The path the map was mounted at. Every entry this hook owns is on it. */
  const mapPath = useRef(typeof window === "undefined" ? "/map" : window.location.pathname);
  const nav = useRef(navigate);
  nav.current = navigate;
  const enter = useRef(enterAt);
  enter.current = enterAt;
  const enteredNow = useRef(entered);
  enteredNow.current = entered;

  /** The current entry's hash and depth as this hook last wrote or read them. */
  const lastHash = useRef("");
  const depth = useRef(1);
  /** The newest address the artifact reported. */
  const artRoute = useRef("");
  /** Backs this hook made itself, to retire an OPEN entry when the map closed. */
  const selfBack = useRef(0);
  /** exitApp is on its way to the base entry. */
  const leaving = useRef(false);
  /** The artifact answers messages only once it has booted. */
  const ready = useRef(false);
  const pending = useRef<string | null>(null);

  /** Route the artifact, never through its own history (see its goto). */
  const forward = useCallback((hash: string) => {
    const win = frame.current?.contentWindow;
    if (!win || !ready.current) {
      pending.current = hash;
      return;
    }
    win.postMessage({ type: "goto", hash }, window.location.origin);
  }, [frame]);

  const urlFor = (hash: string) => mapPath.current + window.location.search + hash;

  useEffect(() => {
    const here = () => window.location.pathname === mapPath.current;

    /*
     * Arriving on a map entry, by Back, Forward or a reload, reuses it. Only a
     * fresh arrival stamps its entry as the base and pushes the marker over it.
     */
    if (!entryOf(window.history.state)) {
      const prior = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
      window.history.replaceState({ ...prior, villageMapBase: true }, "");
      window.history.pushState({ villageMapApp: true, depth: 1, entered: enteredNow.current }, "");
    }
    depth.current = entryOf(window.history.state)?.depth ?? 1;
    lastHash.current = window.location.hash;

    /*
     * Somebody else put an address on the map's own path: the address bar, a
     * link, a same-route navigation. It becomes a map entry one deeper than
     * the one it came from, and the map goes there. It is never a reason to
     * leave.
     */
    const adopt = () => {
      const hash = window.location.hash;
      const d = depth.current + 1;
      const isEntered = enteredNow.current || hashIsMapDeepLink(hash);
      window.history.replaceState({ villageMapApp: true, depth: d, entered: isEntered }, "");
      depth.current = d;
      lastHash.current = hash;
      if (enteredNow.current) forward(hash);
      else if (hashIsMapDeepLink(hash)) enter.current(hash);
    };

    const onPop = () => {
      // The router is already rendering another page; that page owns this.
      if (!here()) return;
      const state = window.history.state;
      const entry = entryOf(state);
      /*
       * Leave on the base entry, or on exitApp's way out. An unstamped entry
       * under the map with the SAME hash is a base from before the stamp
       * existed: a fragment navigation always changes the hash.
       */
      if (leaving.current || isBase(state) || (!entry && window.location.hash === lastHash.current)) {
        leaving.current = false;
        nav.current("/", { replace: true });
        return;
      }
      if (!entry) {
        adopt();
        return;
      }
      depth.current = entry.depth;
      lastHash.current = window.location.hash;
      if (selfBack.current > 0) {
        /* This hook stepped back over the OPEN entry because the map closed
           it. The map already shows the truth, so the entry takes the map's
           address and nothing is sent. */
        selfBack.current -= 1;
        if (artRoute.current !== window.location.hash) {
          window.history.replaceState(state, "", urlFor(artRoute.current));
          lastHash.current = artRoute.current;
        }
        return;
      }
      forward(window.location.hash);
    };

    /* wouter announces every pushState it makes. Ours carry their own state. */
    const onPushed = () => {
      if (!here() || entryOf(window.history.state) || isBase(window.history.state)) return;
      adopt();
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener("pushState", onPushed);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pushState", onPushed);
    };
  }, [forward]);

  /**
   * The artifact's address changed. Push only when a person opened something
   * from the closed map, by their own click or key; everything else replaces
   * the entry it is on. Closing what an OPEN entry opened steps back over it,
   * so the next Back leaves the map instead of doing nothing visible.
   */
  const onRoute = useCallback((data: { hash?: unknown; user?: unknown }) => {
    const hash = typeof data.hash === "string" ? data.hash : null;
    if (hash === null || !isMapRoute(hash)) return;
    artRoute.current = hash;
    if (window.location.pathname !== mapPath.current || selfBack.current > 0) return;
    const state = window.history.state;
    const entry = entryOf(state);
    if (!entry || hash === window.location.hash) return;
    if (hash && data.user === true && entry.depth === 1 && !hashIsMapDeepLink(window.location.hash)) {
      window.history.pushState({ villageMapApp: true, depth: 2, entered: true, opened: true }, "", urlFor(hash));
      depth.current = 2;
    } else if (!hash && entry.opened) {
      selfBack.current += 1;
      window.history.back();
      return;
    } else {
      window.history.replaceState(state, "", urlFor(hash));
    }
    lastHash.current = hash;
  }, []);

  /** The artifact booted. A Back that landed while it loaded is sent now. */
  const onReady = useCallback(() => {
    ready.current = true;
    if (pending.current !== null) {
      const hash = pending.current;
      pending.current = null;
      forward(hash);
    }
  }, [forward]);

  /** Enter the Land was pressed: a return to this entry skips the gate. */
  const markEntered = useCallback(() => {
    enteredNow.current = true;
    const state = window.history.state;
    const entry = entryOf(state);
    if (entry && !entry.entered) window.history.replaceState({ ...state, entered: true }, "");
  }, []);

  /** Leave the map in one press from any depth. See the header. */
  const exitApp = useCallback(() => {
    const entry = entryOf(window.history.state);
    if (entry && window.location.pathname === mapPath.current) {
      leaving.current = true;
      window.history.go(-entry.depth);
    } else {
      nav.current("/", { replace: true });
    }
  }, []);

  return { exitApp, onRoute, onReady, markEntered };
}
