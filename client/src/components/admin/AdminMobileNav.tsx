/**
 * On a phone the side rail is a bottom sheet.
 *
 * The sections sit in the bottom half, each row is at least 44px, and the
 * sheet stops at the home indicator. Wide screens keep the side rail.
 */
import { useEffect, useRef, useState } from "react";
import type { NavGroup } from "@/components/admin/adminNavGroups";
import "./adminPhone.css";

export default function AdminMobileNav({
  groups,
  activeTab,
  onSelect,
}: {
  groups: NavGroup[];
  activeTab: string;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const openedAt = useRef(0);
  const barRef = useRef<HTMLButtonElement>(null);
  const openSheet = (fromTouch = false) => {
    openedAt.current = fromTouch ? Date.now() : 0;
    setOpen(true);
  };
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    // A touch ends in pointerup and never sends a click to this button.
    // The sheet then appears under the finger, and the browser's follow-up
    // click lands on whatever just opened and would close it again.
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") openSheet(true);
    };
    el.addEventListener("pointerup", onUp);
    return () => el.removeEventListener("pointerup", onUp);
  }, []);
  const tooSoon = () => Date.now() - openedAt.current < 450;
  const closeSheet = () => {
    if (tooSoon()) return;
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = groups.flatMap((g) => g.items).find((item) => item.key === activeTab)?.label ?? "Sections";

  return (
    <div className="lg:hidden">
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white px-3 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          ref={barRef}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => openSheet(false)}
          className="flex min-h-[44px] w-full touch-manipulation items-center justify-between gap-3 text-left text-base text-gray-900"
        >
          <span className="truncate">{current}</span>
          <span className="shrink-0 font-medium">Sections</span>
        </button>
      </div>
      {open && (
        <>
          <button type="button" aria-label="Close sections" className="fixed inset-0 z-40 bg-black/40" onClick={closeSheet} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sections"
            className="fixed inset-x-0 bottom-0 z-[60] max-h-[70vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <button type="button" className="mb-2 inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-900" onClick={closeSheet}>
              Close
            </button>
            {groups.map((group) => (
              <div key={group.title} className="mb-3">
                <p className="px-1 text-xs font-semibold uppercase tracking-widest text-gray-600">{group.title}</p>
                <ul>
                  {group.items.map((item) => {
                    const active = item.key === activeTab;
                    return (
                      <li key={`${group.title}:${item.key}`}>
                        <button
                          type="button"
                          aria-current={active ? "page" : undefined}
                          onClick={() => {
                            if (tooSoon()) return;
                            onSelect(item.key);
                            setOpen(false);
                          }}
                          className={`flex min-h-[44px] w-full items-center rounded-lg px-2 text-left text-base ${active ? "font-semibold text-teal-deep" : "text-gray-900"}`}
                        >
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
