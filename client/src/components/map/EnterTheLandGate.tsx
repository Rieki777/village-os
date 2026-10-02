/**
 * THE ENTER GATE for the Living Map shell.
 *
 * The artifact is ~5.7 MB, mostly base64 plates. Mounting the iframe on every
 * `/map` visit paid that cost before anyone asked to enter. This component is
 * the gate the shell holds in front of that load, and the short "Preparing the
 * land…" overlay that sits above the iframe while the published scene is asked
 * for. Deep links still open straight in via `hashIsMapDeepLink`.
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

/**
 * Entered / preparing state for the Living Map shell.
 *
 * Deep links, and a return to an entry already entered, start entered (and
 * preparing). A stuck prepare never strands the visitor: twenty seconds is
 * longer than a healthy config push and short enough to recover from a quiet
 * failure. The shell clears preparing earlier once the published scene has
 * been asked for.
 *
 * `startHash` is the address the iframe opens at. It is read when the land
 * is entered and never again, because changing an iframe's `src` reloads the
 * whole map under the visitor.
 */
export function useMapEnterGate() {
  const [entered, setEntered] = useState(startsEntered);
  const [preparing, setPreparing] = useState(startsEntered);
  const [startHash, setStartHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );

  useEffect(() => {
    if (!preparing) return;
    const t = window.setTimeout(() => setPreparing(false), 20_000);
    return () => window.clearTimeout(t);
  }, [preparing]);

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

  return { entered, preparing, setPreparing, onEnter, enterAt, startHash };
}

type EnterTheLandGateProps = {
  /** Show the Enter the Land dialog (artifact present, visitor has not entered). */
  open: boolean;
  /** Show the preparing overlay (entered, config push still in flight). */
  preparing: boolean;
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

      {/* Preparing sits above the iframe; pointer-events none so Leave (and
          the land beneath) stay reachable while the config push finishes. */}
      {preparing && (
        <div
          className="absolute inset-0 z-[15] flex items-center justify-center pointer-events-none"
          aria-live="polite"
        >
          <p
            className="px-4 py-2 text-sm rounded-lg border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm"
          >
            Preparing the land…
          </p>
        </div>
      )}
    </>
  );
}
