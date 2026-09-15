/**
 * Layer chips (§5 item 9, C4, L5b): a display filter over what the server
 * already decided this viewer may see. THE PRIVACY LINE IS SERVER-SIDE:
 * listCalendarItems applies layer visibility before anything reaches this
 * client, so these chips only ever hide, never reveal. `circle` and
 * `household` stay in the enum with no chip (v1); items on them render
 * unfiltered.
 *
 * The choice is remembered per browser (localStorage), and the chip row only
 * offers layers actually present in the window, so a village that never uses
 * the private layer never sees a "Mine" chip.
 */
import { useCallback, useEffect, useState } from "react";
import type { CalendarItem, CalendarLayer } from "@shared/gatherings";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";

const STORE_KEY = "calendar.layersOff";

/** The v1 chip surface: mine, village, public, admin as read-only marks. */
const CHIP_ORDER: Array<{ id: CalendarLayer; label: string }> = [
  { id: "village", label: "Village" },
  { id: "public", label: "Public" },
  { id: "private", label: "Mine" },
  { id: "admin", label: "Admin" },
];

function readOff(): Set<CalendarLayer> {
  const stored = readStoredJson("local", STORE_KEY);
  const list = stored.status === "value" ? stored.value : [];
  return new Set(Array.isArray(list) ? list : []);
}

/** Chip state plus the filtered list, shared by the week and month views. */
export function useLayerFilter(items: CalendarItem[]): {
  filtered: CalendarItem[];
  present: CalendarLayer[];
  off: Set<CalendarLayer>;
  toggle: (layer: CalendarLayer) => void;
} {
  const [off, setOff] = useState<Set<CalendarLayer>>(() => readOff());

  useEffect(() => {
    writeStoredJson("local", STORE_KEY, Array.from(off));
  }, [off]);

  const toggle = useCallback((layer: CalendarLayer) => {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }, []);

  const present = CHIP_ORDER.map((c) => c.id).filter((id) => items.some((i) => i.layer === id));
  const filtered = items.filter((i) => !off.has(i.layer));
  return { filtered, present, off, toggle };
}

export function LayerChips({ present, off, toggle }: { present: CalendarLayer[]; off: Set<CalendarLayer>; toggle: (l: CalendarLayer) => void }) {
  // One layer present means nothing to filter; the row would be noise.
  if (present.length < 2) return null;
  return (
    <div className="print-hide flex items-center gap-1.5 flex-wrap mb-2" role="group" aria-label="Calendar layers">
      {CHIP_ORDER.filter((c) => present.includes(c.id)).map((c) => {
        const on = !off.has(c.id);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(c.id)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors ${
              on ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** The little pill an item wears when it is not on the default layer. */
export function layerPillLabel(layer: CalendarLayer): string | null {
  if (layer === "private") return "mine";
  if (layer === "admin") return "admin";
  if (layer === "public") return "public";
  return null;
}
