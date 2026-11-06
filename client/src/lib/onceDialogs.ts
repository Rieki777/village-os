/**
 * THE ONCE DIALOGS TAKE TURNS.
 *
 * Layout mounts more than one dialog a member sees once: the reward moment
 * (pay landed) and the season-turned offer. Each decides on its own whether
 * it is due, so a member whose season turns while pay lands was shown both,
 * stacked. This is the one place they agree who goes first.
 *
 * A dialog HOLDS the floor while it is deciding and while it is open, and
 * lets go when it has nothing to show or is closed. A dialog lower in `ORDER`
 * shows only while nobody above it holds the floor, so it waits and is never
 * lost: it opens after the one above has been closed, or on the next visit.
 *
 * Only a dialog that HOLDS needs to be mounted for this to mean anything, so
 * a page or a test that mounts the lower dialog alone sees a free floor.
 */
import { useSyncExternalStore } from "react";

/** First in the list goes first. Pay before the season, by the coordinator's word, 2026-10-31. */
export const ORDER = ["reward", "season"] as const;
export type OnceDialog = (typeof ORDER)[number];

const holding = new Set<OnceDialog>();
const listeners = new Set<() => void>();

function changed() {
  listeners.forEach((l) => l());
}

/** Take the floor. Returns the release, which is safe to call more than once. */
export function holdFloor(name: OnceDialog): () => void {
  holding.add(name);
  changed();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holding.delete(name);
    changed();
  };
}

/** Whether `name` may show now: nobody before it in `ORDER` holds the floor. */
export function floorFree(name: OnceDialog): boolean {
  for (const earlier of ORDER) {
    if (earlier === name) return true;
    if (holding.has(earlier)) return false;
  }
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFloorFree(name: OnceDialog): boolean {
  return useSyncExternalStore(
    subscribe,
    () => floorFree(name),
    () => floorFree(name),
  );
}
