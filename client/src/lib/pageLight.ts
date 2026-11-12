/**
 * ONE LIGHT PER SCREEN (batch 158, the coordinator's wiring for Phase D).
 *
 * The fireflies belong to the one next act on a screen. When a page draws its
 * own lit act (the nature kit's `Fireflies` wrapped around a button or a door,
 * which includes D4's "your turn"), the shell stops competing with it: the
 * bell's swarm becomes a single still light. The Root strip carries no
 * fireflies of its own (components/path/RootLine.tsx), so it needs nothing.
 *
 * A tiny module-level count rather than a React context, because the bell sits
 * in the header and the page's act sits in the page: siblings, never ancestor
 * and child. It stays in the first page on purpose: it is a few lines, and the
 * nature kit, which is kept out of the first page, imports it.
 */
import { useSyncExternalStore } from "react";

let held = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of Array.from(listeners)) l();
}

/** A lit act on the page says it is there. Call the returned function when it leaves. */
export function holdPageLight(): () => void {
  held += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
    emit();
  };
}

/** Whether the page shows its own lit act right now. */
export function pageHasLight(): boolean {
  return held > 0;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** True while some act on the page carries the fireflies. */
export function usePageLight(): boolean {
  return useSyncExternalStore(subscribe, pageHasLight, () => false);
}
