/**
 * THE MAP'S OWN TOOLS, ON TOP OF IT, on a phone.
 *
 * Rye, 2026-09-21, looking at the map on a phone: "I don't see a bar with the
 * tools". The bar existed and sat a screen and a half down. Measured at
 * 390x844 on a village shaped like this one: the map ends at 601, the first
 * screen at the tab bar's 779, and the tools row began at 1103, below the key,
 * the examples banner and the search. So a reader who turned on "How we
 * decide" did it with the map scrolled out of sight, and saw nothing change.
 *
 * On a desktop the same chips stand in a bar above the canvas. This is that
 * bar for a phone, in the same place: over the picture it changes, with each
 * chip tall enough for a thumb (40px against the desktop row's 24).
 *
 * It carries only the four toggles that change the picture. The rest of the
 * desktop row (arranging, the list, the two exports) is desktop-only already.
 * Anything passed as children rides under the chips: the "How we decide" key,
 * so a lens turned on here is read here.
 */
import type { ReactNode } from "react";
import { Link2 } from "lucide-react";

export type MapMode = "now" | "vision";

export default function MapToolStrip({
  mode,
  onMode,
  lensOn,
  onLens,
  resourcesModule,
  resourcesOn,
  onResources,
  linesOn,
  onLines,
  children,
}: {
  mode: MapMode;
  onMode: (m: MapMode) => void;
  lensOn: boolean;
  onLens: () => void;
  /** Whether the resources module is on at all; its chip is absent when it is not. */
  resourcesModule: boolean;
  resourcesOn: boolean;
  onResources: () => void;
  linesOn: boolean;
  onLines: () => void;
  children?: ReactNode;
}) {
  const pressed = (on: boolean) => (on ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-muted-foreground border-border");
  const chip = "shrink-0 inline-flex items-center gap-1 min-h-10 px-3.5 text-[13px] rounded-full border";
  return (
    <div className="sm:hidden mb-3" data-map-tool-strip>
      {/* A row that scrolls sideways inside itself when a village has every
          chip on, so the page never does. */}
      <div role="group" aria-label="What the map shows" className="flex items-center gap-1.5 overflow-x-auto px-4 pb-1">
        <div role="group" aria-label="Now or Vision" className="shrink-0 inline-flex rounded-full border border-border overflow-hidden">
          {(["now", "vision"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onMode(m)}
              className={`min-h-10 px-3.5 text-[13px] ${mode === m ? "bg-teal-deep text-white" : "bg-card text-muted-foreground"}`}
            >
              {m === "now" ? "Now" : "Vision"}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={lensOn} onClick={onLens} className={`${chip} ${pressed(lensOn)}`}>
          How we decide
        </button>
        {resourcesModule && (
          <button type="button" aria-pressed={resourcesOn} onClick={onResources} className={`${chip} ${pressed(resourcesOn)}`}>
            Resources
          </button>
        )}
        <button type="button" aria-pressed={linesOn} onClick={onLines} className={`${chip} ${pressed(linesOn)}`}>
          <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Links
        </button>
      </div>
      {children && <div className="px-4 mt-2">{children}</div>}
    </div>
  );
}
