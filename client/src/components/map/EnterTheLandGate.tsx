/**
 * THE ENTER GATE for the Living Map shell.
 *
 * The artifact is ~5.7 MB, mostly base64 plates. Mounting the iframe on every
 * `/map` visit paid that cost before anyone asked to enter. This component is
 * the gate the shell holds in front of that load, and the "Preparing the
 * land…" cover that hides the frame until the village's own land is on it.
 * Deep links still open straight in via `hashIsMapDeepLink`.
 *
 * Lives beside VillageSettingsDoor under components/map so LivingMap.tsx stays
 * a shell, not a second monolith — the file-lines ratchet refuses any client
 * file that crosses 1000 lines without a baseline entry.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useVillageName, useVillageLocation } from "@/hooks/useVillageName";

/**
 * A hash that already points somewhere on the land — a place, module, journey,
 * circles or loom — so the shell should not re-gate on Enter. Plain `#hud=…`
 * is only a layout hint and still shows the gate.
 */
export function hashIsMapDeepLink(hash: string): boolean {
  if (!hash.startsWith("#/")) return false;
  const rest = hash.slice(2);
  if (!rest || /^hud=/i.test(rest)) return false;
  return true;
}

/**
 * Tell the artifact the shell already ran its intro gate. Empty hash becomes
 * `#skipIntro`; an existing hash keeps its route and gains `&skipIntro` so
 * `/skipIntro/i` still matches inside the file.
 */
export function withSkipIntro(hash: string): string {
  if (/skipIntro/i.test(hash)) return hash || "#skipIntro";
  if (!hash) return "#skipIntro";
  if (/[?&=]/.test(hash)) return `${hash}${/[?&]$/.test(hash) ? "" : "&"}skipIntro`;
  return `${hash}&skipIntro`;
}

/**
 * Whether the history entry being opened is one where the visitor already
 * pressed Enter. The shell's map history (mapHistory.ts) records it on the
 * entry, so Back from a door out to the site, Forward, or F5 returns to the
 * land and not to this gate a second time.
 */
export function arrivedEntered(): boolean {
  if (typeof window === "undefined") return false;
  const state = window.history.state as { villageMapApp?: unknown; entered?: unknown } | null;
  return !!state && state.villageMapApp === true && state.entered === true;
}

function startsEntered(): boolean {
  return hashIsMapDeepLink(typeof window === "undefined" ? "" : window.location.hash) || arrivedEntered();
}

/** How long the cover waits before it says the connection is slow. */
const SLOW_MS = 20_000;
/**
 * How long after the frame has LOADED the cover waits for the artifact to
 * say its land is the village's own. A loaded frame has run every script, so
 * a land that has still not answered is as booted as it will get, and the
 * visitor sees what there is.
 */
const LOADED_GRACE_MS = 10_000;

/**
 * Entered / preparing state for the Living Map shell.
 *
 * Deep links, and a return to an entry already entered, start entered (and
 * preparing). PREPARING IS A COVER over the land, held until the artifact
 * says the land on screen is the village's own (`landed`, from its
 * `{type:'land-ready'}`). Before that the artifact draws the seed scene it
 * ships with, and the published land replaced it a second later with half
 * the buildings jumping (F66). So the cover is no longer lifted by a clock
 * while the map is still downloading: on a slow phone the twenty seconds used
 * to run out mid-download and leave a blank screen with no way out (F47).
 * At twenty seconds the words change instead. Once the frame has loaded, a
 * land that never answers is uncovered after a grace period, so a broken
 * handshake costs a few seconds, never the map.
 *
 * `startHash` is the address the iframe opens at. It is read when the land
 * is entered and never again, because changing an iframe's `src` reloads the
 * whole map under the visitor.
 *
 * `onGraceLift` runs when the grace period, and not the map, lifts the cover.
 * The map's desk arrival waits for its land, and a land that comes after the
 * cover has gone used to fly the visitor away from whatever they had opened
 * meanwhile (and a land that never came left them with no welcome). The shell
 * uses it to tell the map the land is uncovered, so the arrival runs when it
 * can be seen.
 */
export function useMapEnterGate(onGraceLift?: () => void) {
  const graceLift = useRef(onGraceLift);
  graceLift.current = onGraceLift;
  const [entered, setEntered] = useState(startsEntered);
  const [preparing, setPreparing] = useState(startsEntered);
  const [slow, setSlow] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [startHash, setStartHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );

  useEffect(() => {
    if (!preparing || loaded) return;
    const t = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(t);
  }, [preparing, loaded]);

  useEffect(() => {
    if (!preparing || !loaded) return;
    const t = window.setTimeout(() => {
      setPreparing(false);
      graceLift.current?.();
    }, LOADED_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [preparing, loaded]);

  /** The artifact said its land is the village's own: lift the cover. */
  const landed = useCallback(() => setPreparing(false), []);
  /** The frame's document has loaded: every script in it has run. */
  const frameLoaded = useCallback(() => setLoaded(true), []);

  /** Open the land at `hash`. A no-op once entered: see startHash. */
  const enteredNow = useRef(entered);
  enteredNow.current = entered;
  const enterAt = useCallback((hash: string) => {
    if (enteredNow.current) return;
    enteredNow.current = true;
    setStartHash(hash);
    setEntered(true);
    setPreparing(true);
  }, []);

  const onEnter = useCallback(() => enterAt(window.location.hash), [enterAt]);

  return { entered, preparing, slow, landed, frameLoaded, onEnter, enterAt, startHash };
}

type EnterTheLandGateProps = {
  /** Show the Enter the Land dialog (artifact present, visitor has not entered). */
  open: boolean;
  /** Cover the land (entered, the village's own land not on screen yet). */
  preparing: boolean;
  /** The cover has waited long enough to say the connection is slow. */
  slow?: boolean;
  onEnter: () => void;
};

/**
 * Brand-safe enter dialog and preparing overlay.
 *
 * Village name and location come from the shared hooks so this surface never
 * hard-codes a tenant. Theme classes only — no hex or rgba literals.
 */
export default function EnterTheLandGate({
  open,
  preparing,
  slow = false,
  onEnter,
}: EnterTheLandGateProps) {
  const villageName = useVillageName();
  const villageLocation = useVillageLocation();

  return (
    <>
      {open && (
        <div
          className="absolute inset-0 z-[5] flex items-center justify-center px-6 bg-background/90 backdrop-blur-sm"
          role="dialog"
          aria-label="Enter the Living Map"
        >
          <div className="text-center text-foreground">
            <h1 className="font-display text-3xl tracking-[0.5em] uppercase text-foreground">
              {villageName}
            </h1>
            <p className="mt-3 text-xs tracking-[0.2em] uppercase text-muted-foreground">
              {villageLocation
                ? `a living village · ${villageLocation}`
                : "a living village"}
            </p>
            <button
              type="button"
              onClick={onEnter}
              className="mt-7 min-h-[44px] px-8 py-2.5 text-sm rounded-lg border border-border bg-background/95 text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Enter the Land
            </button>
          </div>
        </div>
      )}

      {/* The cover sits over the iframe and under the shell's Leave the map
          (z-10), so a way out stays on screen while the land loads. It is
          opaque, and it takes the pointer, because what it hides is the seed
          scene: a click there opened the seed's version of a building. */}
      {preparing && (
        <div
          className="absolute inset-0 z-[5] flex items-center justify-center px-6 bg-background"
          role="status"
          aria-live="polite"
        >
          <p className="px-4 py-2 text-sm text-center rounded-lg border border-border bg-background text-foreground shadow-sm">
            {slow ? "Still bringing the land. A slow connection takes longer." : "Preparing the land…"}
          </p>
        </div>
      )}
    </>
  );
}
