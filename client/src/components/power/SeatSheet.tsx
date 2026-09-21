/**
 * The bottom sheet a phone reads a seat or a circle in, focus-managed exactly
 * as the old card was: focus moves in on open and returns on close, Escape and
 * the backdrop both close it.
 *
 * Moved out of `client/src/pages/VillageMap.tsx` (2026-09-21) when that page
 * reached 963 of its 1000 lines and the sheet needed a second way to open: a
 * stepped-into circle now shows `CirclePeek` under the map first, and this
 * sheet only when the reader asks for the details.
 *
 * THE GROUND IS THE LENS'S CARD, NOT WHITE. The sheet renders inside
 * `.circle-lens`, which re-declares `--foreground` as a light ink for the
 * map's dark ground. The cards inside write in that ink, and this panel was
 * `bg-white`: measured live at 390x844, the circle's name, its purpose, its
 * list and its seat names all came out at 1.36:1, ten of ten text runs under
 * 4.5:1. `bg-card` is the surface the same cards stand on in the desktop
 * panel, so both widths now read one pairing.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function SeatSheet({
  children,
  onClose,
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  /** What a screen reader announces the dialog as: the seat's name, or the circle's. */
  label: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-scroll-contain
        className="bg-card text-card-foreground border-t border-border w-full rounded-t-2xl px-6 pt-3 pb-[calc(1.5rem+var(--tabbar-h))] max-h-[80vh] overflow-y-auto shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end -mr-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
