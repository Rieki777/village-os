/**
 * A short wait before an admin action is sent, so Undo can stop it.
 *
 * Nothing is sent until the wait ends. Undo, or leaving the page, drops it.
 * One pending action at a time: a new one replaces the one still waiting.
 */
const WAIT_MS = 10_000;
let waitMs = WAIT_MS;

/** Tests use a shorter wait. The product wait stays 10 seconds. */
export function setUndoWaitMs(ms: number): void {
  waitMs = ms;
}

type Pending = { label: string; timer: number };

let pending: Pending | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of Array.from(listeners)) fn();
}

export function undoWaitMs(): number {
  return WAIT_MS;
}

export function pendingUndoLabel(): string | null {
  return pending?.label ?? null;
}

export function subscribeUndo(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function cancelUndo(): void {
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pending = null;
  emit();
}

/** Run `work` after 10 seconds unless Undo or a newer hold comes first. */
export function holdUndo(label: string, work: () => void): void {
  cancelUndo();
  const timer = window.setTimeout(() => {
    pending = null;
    emit();
    work();
  }, waitMs);
  pending = { label, timer };
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => cancelUndo());
}
