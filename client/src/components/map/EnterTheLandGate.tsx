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
 * Entered / preparing state for the Living Map shell.
 *
 * Deep links start already entered (and preparing). A stuck prepare never
 * strands the visitor: twenty seconds is longer than a healthy config push and
 * short enough to recover from a quiet failure. The shell clears preparing
 * earlier once the published scene has been asked for.
 */
export function useMapEnterGate() {
  const [entered, setEntered] = useState(() =>
    hashIsMapDeepLink(typeof window === "undefined" ? "" : window.location.hash),
  );
  const [preparing, setPreparing] = useState(() =>
    hashIsMapDeepLink(typeof window === "undefined" ? "" : window.location.hash),
  );

  useEffect(() => {
    if (!preparing) return;
    const t = window.setTimeout(() => setPreparing(false), 20_000);
    return () => window.clearTimeout(t);
  }, [preparing]);

  /**
   * Whether the visitor pressed Enter the Land. The button held focus and
   * unmounts on the press, so focus falls to the page and the map's own keys
   * (Space, the arrows, T for the tour) answer nothing until somebody clicks
   * the land. The shell reads this on load to hand focus to the land the
   * button opened. A deep link never pressed anything and keeps its focus.
   */
  const pressed = useRef(false);

  const onEnter = useCallback(() => {
    pressed.current = true;
    setEntered(true);
    setPreparing(true);
  }, []);

  return { entered, preparing, setPreparing, onEnter, pressed };
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
