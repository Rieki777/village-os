/**
 * Small hooks the Journal's tabs share.
 */
import { useCallback, useEffect, useState } from "react";
import { OUTBOX_EVENT, pendingFor, type OutboxItem } from "@/lib/journalOutbox";
import { storedText, writeStored } from "@/lib/safeStorage";

/**
 * This member's entries still waiting on the device. Re-read whenever the
 * outbox changes in this tab, or in another tab (the `storage` event).
 */
export function usePendingEntries(owner: string | null): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>(() => (owner ? pendingFor(owner) : []));
  useEffect(() => {
    if (!owner) {
      setItems([]);
      return;
    }
    const read = () => setItems(pendingFor(owner));
    read();
    window.addEventListener(OUTBOX_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [owner]);
  return items;
}

/**
 * A choice remembered on this device, such as the last tab or the depth.
 * A stored value outside `allowed` reads as the fallback, so a renamed option
 * never leaves the page on a choice that no longer exists.
 */
export function useRememberedChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = storedText("local", key);
    return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
  });
  const choose = useCallback(
    (next: T) => {
      setValue(next);
      writeStored("local", key, next);
    },
    [key],
  );
  return [value, choose];
}
