/**
 * On a phone the side rail is a bottom sheet.
 *
 * The sections sit in the bottom half, each row is at least 44px, and the
 * sheet stops at the home indicator. Wide screens keep the side rail.
 */
import { useEffect, useState } from "react";
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
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white px-3 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-base text-gray-900"
        >
          <span className="truncate">{current}</span>
          <span className="shrink-0 font-medium">Sections</span>
        </button>
      </div>
      {open && (
        <>
          <button type="button" aria-label="Close sections" className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sections"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
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
