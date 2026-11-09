/**
 * Where the Admin helper lives in the page, kept tiny so Admin pays nothing for
 * it until it opens: the panel itself (AdminHelperPanel.tsx) is a lazy chunk,
 * fetched the first time an admin opens it.
 *
 * It owns three things:
 *   - the keyboard shortcut, Ctrl+/ (Cmd+/ on a Mac), which toggles it;
 *   - where the panel starts: just under the sticky admin header, measured
 *     live, so the panel never covers the header (the #1046 banner) whatever
 *     the launch banner above it is doing; and where it stops, just above the
 *     phone's bottom bar, so that bar never covers the question box;
 *   - mounting the panel only while it is open.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import type { NavGroup } from "./adminNavGroups";

const AdminHelperPanel = lazy(() => import("./AdminHelperPanel"));

/** The id AdminHeader carries, so the helper can find the header's bottom edge. */
export const ADMIN_HEADER_ID = "admin-header";

/** True for Ctrl+/ or Cmd+/, typed anywhere. */
export function isHelperShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  return e.key === "/" && (e.ctrlKey || e.metaKey) && !e.altKey;
}

function headerBottom(): number {
  const el = typeof document !== "undefined" ? document.getElementById(ADMIN_HEADER_ID) : null;
  return el ? Math.max(0, Math.round(el.getBoundingClientRect().bottom)) : 0;
}

/** How much of the window's foot the phone's bottom bar (AdminMobileNav) covers; 0 where it is hidden. */
function bottomBarHeight(): number {
  const el = typeof document !== "undefined" ? document.querySelector<HTMLElement>("[data-admin-bottom-bar]") : null;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.top < window.innerHeight ? Math.round(window.innerHeight - r.top) : 0;
}

export default function AdminHelperHost({
  open,
  setOpen,
  password,
  groups,
  tab,
  onOpenTab,
}: {
  open: boolean;
  setOpen: (next: boolean | ((was: boolean) => boolean)) => void;
  password: string;
  groups: readonly NavGroup[];
  tab: string;
  onOpenTab: (key: string) => void;
}) {
  const [edges, setEdges] = useState({ top: 0, bottom: 0 });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!isHelperShortcut(e)) return;
      e.preventDefault();
      setOpen((was) => !was);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const sync = () => setEdges({ top: headerBottom(), bottom: bottomBarHeight() });
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const el = document.getElementById(ADMIN_HEADER_ID);
    const watch = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    if (el && watch) watch.observe(el);
    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      watch?.disconnect();
    };
  }, [open]);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <AdminHelperPanel
        password={password}
        groups={groups}
        tab={tab}
        top={edges.top}
        bottom={edges.bottom}
        onClose={() => setOpen(false)}
        onOpenTab={onOpenTab}
      />
    </Suspense>
  );
}
