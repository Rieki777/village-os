/**
 * THE DOOR THE MAP ALREADY HAS, ANSWERED WHERE YOU ARE STANDING.
 *
 * The land map's dock carries a Village Settings button, and its own words for
 * it are "The village's own colours and words, the record every view is drawn
 * from". That is exactly these three panels: the skin is the colours, the
 * vocabulary is the words, and the welcome walk is the path a visitor is taken
 * along. Today the button hands you to `/admin?tab=setup`, which means leaving
 * the land to change how the land looks.
 *
 * So nothing new is added to the map. No second button, no floating launcher
 * over somebody else's corner. The door that promises the village's colours
 * and words now opens them here, over the map, and still offers the full
 * settings page for everything else that lives there. The artifact's own note
 * beside that button is the reason this is the only honest shape: it says the
 * control once "carried the panel's name and its four field names while
 * opening something else, which is how one room came to have three doors".
 * Two doors into one room is the promise; a third would be the defect.
 *
 * A MEMBER SEES NOTHING AND ASKS FOR NOTHING. Each panel already renders null
 * and makes no request without `useIsAdmin`, and this drawer is gated the same
 * way, so a member never gets an empty titled shell where an editor would be.
 * The door keeps its old behaviour for them: it navigates, and `/admin`
 * refuses them there as it always has.
 */
import { useEffect, useRef } from "react";
import { X, ExternalLink } from "lucide-react";
import { useIsAdmin } from "@/contexts/AuthContext";
import MapSkinPanel from "@/components/MapSkinPanel";
import WalkEditorPanel from "@/components/WalkEditorPanel";
import MapVocabularyPanel from "@/components/admin/MapVocabularyPanel";

/**
 * Whether a route the artifact asked the site to open is the settings door.
 *
 * The map's dock button carries `/admin?tab=setup`. Any other admin route is
 * somebody asking for the admin PAGE, and that still navigates: this answers
 * one door, not every mention of admin.
 */
export function isVillageSettingsRoute(route: string): boolean {
  if (typeof route !== "string") return false;
  const [path, query] = route.split("?");
  if (path !== "/admin") return false;
  return new URLSearchParams(query ?? "").get("tab") === "setup";
}

export default function VillageSettingsDoor({ open, onClose, onOpenFullPage }: {
  open: boolean;
  onClose: () => void;
  onOpenFullPage: () => void;
}) {
  const mayAdminister = useIsAdmin();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  /*
   * THE PANEL TAKES FOCUS WHEN IT OPENS, and that is not only good manners.
   * Measured: Escape did nothing, because the click that opened this happened
   * INSIDE the artifact's iframe, so the keystroke went to the iframe document
   * and the shell's listener never saw it. A dialog that does not take focus
   * on a page built out of two documents is a dialog with no keyboard at all.
   */
  useEffect(() => {
    if (open && mayAdminister) closeRef.current?.focus();
  }, [open, mayAdminister]);

  // Escape closes it, the same key that closes the artifact's own panels.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mayAdminister) return null;

  return (
    <div
      className="fixed inset-0 z-20 flex justify-end bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/*
       * Full height on the right, the width the artifact's own panel uses, so
       * the land stays visible beside it and you watch it change as you work.
       * On a phone it takes the whole screen, because 400px of panel on a
       * 390px screen is a panel with a sliver of map nobody can read.
       */}
      <aside
        role="dialog"
        aria-label="Village settings"
        className="h-full w-full sm:w-[400px] overflow-y-auto bg-card border-l border-border shadow-2xl"
      >
        <header className="sticky top-0 flex items-center justify-between gap-3 px-5 py-4 bg-card border-b border-border">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">Village settings</h2>
            <p className="text-xs text-muted-foreground">The village's own colours and words, changed while you watch the land.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close village settings"
            className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg border border-border text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="px-5 pb-8 space-y-5">
          <MapSkinPanel />
          <WalkEditorPanel />
          <MapVocabularyPanel />

          {/* Everything else the settings page holds is still one tap away. */}
          <button
            type="button"
            onClick={onOpenFullPage}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-sm rounded-lg border border-border text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
            Open the full settings page
          </button>
        </div>
      </aside>
    </div>
  );
}
