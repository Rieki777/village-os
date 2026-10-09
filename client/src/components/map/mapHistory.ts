/**
 * THE MAP'S HISTORY, IN ONE PLACE: what Back, Forward, a reload, the address
 * bar and the Leave the map door do while the Living Map is open.
 *
 * THE MAP IS ONE PAGE. Rye's ruling (D6, 2026-10-02): "back should send you to
 * the last page you were on." So the browser's Back from the map goes to the
 * page the visitor was on before it, in one press, whatever is open on the
 * land. Nothing a visitor does inside the map (a place, a door, the Loom, the
 * Circles, a walk, a lens) adds a history entry. The Leave the map door and the
 * artifact's own `{type:'exit'}` do exactly what Back does.
 *
 * THE ADDRESS STILL FOLLOWS THE SCREEN. The artifact posts `{type:'route',
 * hash}` from its setHash, and the CURRENT entry's URL becomes `/map` plus that
 * hash, by replaceState. So F5 reopens what is on screen, a copied link opens
 * it for somebody else, a door out to the site comes Back to the map as it was
 * left, and Forward from the page before returns to the map in the state its
 * address names. An entry also remembers that its visitor already pressed
 * Enter the Land, so coming back to it does not ask again (`arrivedEntered`).
 *
 * WHAT `history.state` HOLDS on a map entry: `{villageMapApp, visit, seq,
 * entered}`. `visit` names one stay on the map and `seq` counts entries inside
 * it. The map writes only one entry per stay, so `seq` is 0 almost always. The
 * exception is an entry the BROWSER makes: a link pasted into the address bar
 * of an open map is a fragment navigation, and the browser pushes it whatever
 * this file would prefer. That entry is adopted as the next `seq` of the same
 * stay, and a Back that lands on an earlier entry of the same stay keeps going
 * until the stay is behind it. So "one Back press leaves the map" holds even
 * after a pasted link, and the browser's own entry costs nothing visible.
 *
 * A FRESH TAB HAS NO PAGE BEFORE THE MAP. A shared link opened in a new tab
 * would leave Back with nowhere to go, so on a tab whose only entry is this one
 * the village home is written under the map (`villageMapHome` at `/`), and Back
 * lands there. Chrome's history intervention can skip an entry written before
 * the visitor touched the page, until their first click or key; after that the
 * toolbar Back reaches it. This is the one push this file makes.
 *
 * A PHONE'S `#/circles` LINK OPENS THE ORG CHART (Rye, D8). The desk's Circles
 * tab goes to `/map/circles`; the in-file circles draw names at 3 px on a
 * phone. So on the pocket profile an address naming the circles REPLACES this
 * entry with `/map/circles`, which keeps Back from bouncing into it again.
 *
 * WHAT WAS WRONG BEFORE THIS MODEL, measured 2026-10-02 on this branch:
 *   - Back from an open place closed it, the next Back went to `/` (the arrival
 *     entry rewritten as the village door), and only the third reached the page
 *     the visitor came from. Forward from there went to `/`, never the map;
 *   - closing an open thing stepped back over its entry, so a person who
 *     arrived by a shared link and opened a second place lost both on one Back;
 *   - re-entering the exact URL already in the bar read as a legacy base entry
 *     and threw the visitor out to the village door.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { hashIsMapDeepLink } from "@/components/map/EnterTheLandGate";

type MapEntry = { villageMapApp: true; visit: string; seq: number; entered?: boolean };

/**
 * The map entry `state` describes, or null when it is not one of ours. An
 * entry written by the model before this one carries `depth` and no `visit`:
 * it reads as a stay of its own, named "", at `seq` depth.
 */
function entryOf(state: unknown): MapEntry | null {
  if (!state || typeof state !== "object") return null;
  const s = state as Record<string, unknown>;
  if (s.villageMapApp !== true) return null;
  const seq = Number(s.seq ?? s.depth);
  return {
    ...(s as MapEntry),
    visit: typeof s.visit === "string" ? s.visit : "",
    seq: Number.isInteger(seq) && seq >= 0 ? seq : 0,
  };
}

/** The arrival entry the previous model stamped. Popping to it meant leave. */
function isLegacyBase(state: unknown): boolean {
  return !!state && typeof state === "object" && (state as Record<string, unknown>).villageMapBase === true;
}

const newVisit = () => Math.random().toString(36).slice(2, 10) || "v";

/**
 * A route the artifact may write into the visible address bar: empty, one of
 * its own `#/...` addresses, or a lens with no place (`#lens=vision`). The
 * artifact is same-origin and checked by origin before this runs, and this is
 * the second guard: nothing else reaches the URL, and never the shell's
 * `skipIntro` token or a `hud=` layout hint.
 */
export function isMapRoute(hash: string): boolean {
  if (hash === "") return true;
  if (!/^#(?:\/[A-Za-z0-9_/?=:&.,-]*|lens=[a-z,]*)$/.test(hash)) return false;
  return !/skipIntro|hud=/i.test(hash);
}

/**
 * The part of an address that names what is OPEN, without the lens it is seen
 * through, a layout hint or the shell's enter token. `#/circles&lens=org` and
 * `#/circles` name the same screen; `#lens=vision` names nothing open.
 */
export function addressRoute(hash: string): string {
  if (!hash.startsWith("#")) return "";
  const route = hash
    .slice(1)
    .split("&")
    .filter((part) => !/^(?:lens|hud)=|^skipIntro$/i.test(part))
    .join("&")
    .replace(/[?&]skipIntro\b/gi, "")
    .replace(/[?&]$/, "");
  return route === "" || route === "/" ? "" : `#${route}`;
}

/** D8: on a phone this address belongs to the org chart, not the land. */
export function circlesOnPhone(hash: string, pocket: boolean): boolean {
  return pocket && addressRoute(hash) === "#/circles";
}

type Navigate = (to: string, options?: { replace?: boolean }) => void;

export function useMapHistory({
  navigate,
  frame,
  entered,
  enterAt,
  pocket = false,
}: {
  navigate: Navigate;
  frame: RefObject<HTMLIFrameElement | null>;
  entered: boolean;
  /** Open the map at `hash`, for a deep link that arrives while the gate is up. */
  enterAt: (hash: string) => void;
  /** The artifact is drawing its pocket (phone) layout. See LivingMap's pocketProfile. */
  pocket?: boolean;
}) {
  /** The path the map was mounted at. Every entry this hook owns is on it. */
  const mapPath = useRef(typeof window === "undefined" ? "/map" : window.location.pathname);
  const nav = useRef(navigate);
  nav.current = navigate;
  const enter = useRef(enterAt);
  enter.current = enterAt;
  const enteredNow = useRef(entered);
  enteredNow.current = entered;
  const pocketNow = useRef(pocket);
  pocketNow.current = pocket;

  /** The entry this hook is on, and the highest `seq` its stay has reached. */
  const cur = useRef<MapEntry | null>(null);
  const top = useRef(0);
  /**
   * A Back (or the Leave door) is walking out over this stay's entries. It
   * lapses after two seconds: a traversal that went nowhere must not leave
   * the address frozen or the next Forward read as a Back.
   */
  const leaving = useRef(false);
  const leftAt = useRef(0);
  const isLeaving = () => leaving.current && Date.now() - leftAt.current < 2000;
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

  /**
   * Go back past this stay. `navigation.canGoBack` is asked where the browser
   * has it: a map entry with nothing before it (a restored tab the home was
   * never written under) goes to the village home in place.
   */
  const leave = useCallback(() => {
    const api = (window as unknown as { navigation?: { canGoBack?: boolean } }).navigation;
    if (api && api.canGoBack === false) {
      leaving.current = false;
      nav.current("/", { replace: true });
      return;
    }
    leaving.current = true;
    leftAt.current = Date.now();
    window.history.back();
  }, []);

  /**
   * Show the map the address `hash` names. On a phone an address naming the
   * circles is the org chart's, and replaces this entry (D8).
   */
  const route = useCallback((hash: string) => {
    if (circlesOnPhone(hash, pocketNow.current)) {
      nav.current("/map/circles", { replace: true });
      return;
    }
    if (enteredNow.current) forward(hash);
    else if (hashIsMapDeepLink(hash)) enter.current(hash);
  }, [forward]);

  useEffect(() => {
    const here = () => window.location.pathname === mapPath.current;

    /*
     * Arriving on a map entry, by Back, Forward or a reload, reuses it. Only a
     * fresh arrival is stamped, and only a fresh TAB gets the home under it.
     */
    let entry = entryOf(window.history.state);
    if (!entry || !entry.visit) {
      const prior = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
      const stamp: MapEntry = {
        villageMapApp: true,
        visit: newVisit(),
        seq: entry ? entry.seq : 0,
        entered: entry?.entered === true || enteredNow.current,
      };
      if (!entry && window.history.length === 1) {
        const url = window.location.pathname + window.location.search + window.location.hash;
        window.history.replaceState({ villageMapHome: true }, "", "/");
        window.history.pushState(stamp, "", url);
      } else {
        window.history.replaceState({ ...prior, ...stamp }, "");
      }
      entry = stamp;
    }
    cur.current = entry;
    top.current = entry.seq;
    if (circlesOnPhone(window.location.hash, pocketNow.current)) {
      nav.current("/map/circles", { replace: true });
    }

    /*
     * Somebody else put an address on the map's own path: the address bar, a
     * link, a same-route navigation, or the same URL entered again (which the
     * browser answers by REPLACING this entry with a stateless one). It joins
     * this stay one `seq` later, and the map goes there. It is never a reason
     * to leave.
     */
    const adopt = () => {
      const hash = window.location.hash;
      const next: MapEntry = {
        villageMapApp: true,
        visit: cur.current?.visit || newVisit(),
        seq: top.current + 1,
        entered: enteredNow.current || hashIsMapDeepLink(hash),
      };
      window.history.replaceState(next, "");
      cur.current = next;
      top.current = next.seq;
      route(hash);
    };

    const onPop = () => {
      // The router is already rendering another page; that page owns this.
      if (!here()) {
        leaving.current = false;
        return;
      }
      const state = window.history.state;
      if (isLegacyBase(state)) {
        leaving.current = false;
        nav.current("/", { replace: true });
        return;
      }
      const landed = entryOf(state);
      if (!landed) {
        adopt();
        return;
      }
      const was = cur.current;
      /* An entry the previous model wrote has no stay of its own: it is read
         as one of this stay's, at the depth it was written with. */
      const sameStay = !!was && (landed.visit === was.visit || !landed.visit);
      const backInStay = sameStay && landed.seq < (was?.seq ?? 0);
      if (isLeaving() || backInStay) {
        /* Back landed on an earlier entry of the same stay: the map is one
           page, so keep going. The entry passed over learns that this stay
           was entered, so Forward onto it later opens the land and not the
           gate (a link pasted at the gate made the stay's second entry). */
        if (enteredNow.current && !landed.entered) {
          window.history.replaceState({ ...(state as object), entered: true }, "");
        }
        cur.current = landed;
        leave();
        return;
      }
      leaving.current = false;
      const into: MapEntry = landed.visit ? landed : { ...landed, visit: was?.visit || newVisit() };
      if (into !== landed) window.history.replaceState({ ...(state as object), visit: into.visit, seq: into.seq }, "");
      cur.current = into;
      top.current = Math.max(top.current, into.seq);
      route(window.location.hash);
    };

    /* wouter announces every pushState it makes. Ours carry their own state. */
    const onPushed = () => {
      if (!here() || entryOf(window.history.state) || isLegacyBase(window.history.state)) return;
      adopt();
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener("pushState", onPushed);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pushState", onPushed);
    };
  }, [route, leave]);

  /**
   * The artifact's address changed. It REPLACES the address of the entry the
   * map is on, and never adds one: in-map state is not a page (D6).
   */
  const onRoute = useCallback((data: { hash?: unknown; user?: unknown }) => {
    const hash = typeof data.hash === "string" ? data.hash : null;
    if (hash === null || !isMapRoute(hash)) return;
    if (window.location.pathname !== mapPath.current || isLeaving()) return;
    const state = window.history.state;
    if (!entryOf(state)) return;
    if (circlesOnPhone(hash, pocketNow.current)) {
      nav.current("/map/circles", { replace: true });
      return;
    }
    if (hash === window.location.hash) return;
    window.history.replaceState(state, "", urlFor(hash));
  }, []);

  /** The artifact booted. A route that arrived while it loaded is sent now. */
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

  /** The Leave the map door: exactly what Back does. See the header. */
  const exitApp = useCallback(() => {
    if (window.location.pathname === mapPath.current && entryOf(window.history.state)) leave();
    else nav.current("/", { replace: true });
  }, [leave]);

  return { exitApp, onRoute, onReady, markEntered };
}
