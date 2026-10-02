/**
 * Small hooks the Journal's tabs share.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TOKEN_KEY, authToken } from "@/lib/gameApi";
import { OUTBOX_EVENT, claimedUserId, pendingFor, type OutboxItem } from "@/lib/journalOutbox";
import { storedText, writeStored } from "@/lib/safeStorage";
import { clearDraft } from "./sitting";

/**
 * This member's entries still on the device, refused ones included, and only
 * theirs: another member's waiting pages stay keyed to that member and never
 * show here. Re-read whenever the outbox changes in this tab, or in another
 * tab (the `storage` event).
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
 * Signing out takes the open page with it.
 *
 * An open sitting lives on the device as a draft, in plain words, so a
 * shared or borrowed browser would keep it for the next person to find. It
 * is unsaved scratch, so it goes when its member's session does:
 *
 *   - in this tab, when the signed-in member changes (sign-out sets nobody),
 *     the member who left loses their draft;
 *   - in another tab, when the stored token is replaced by a DIFFERENT
 *     member's, this tab drops the draft too and returns true, so the page
 *     can close the open sitting before it writes the draft back.
 *
 * A token that is only removed, or replaced by the same member's (a 401 in
 * another tab, signing in again, setting a password), keeps the draft: it is
 * still this member's, and wiping it would cost words mid-sentence. It stays
 * keyed to them and no other member ever reads it.
 *
 * Pages already saved to the outbox stay: they are kept for their member's
 * next session and are never shown to anybody else (`usePendingEntries`).
 */
export function useSignOutForgetsDraft(owner: string | null): boolean {
  const last = useRef<string | null>(owner);
  const [changedElsewhere, setChangedElsewhere] = useState(false);

  useEffect(() => {
    const was = last.current;
    last.current = owner;
    if (was && was !== owner) clearDraft(was);
    setChangedElsewhere(false);
    if (!owner) return;
    const mine = authToken();
    const onStorage = (e: StorageEvent) => {
      // A null key is the whole store cleared.
      if (e.key !== null && e.key !== TOKEN_KEY) return;
      const now = authToken();
      if (now === mine || !now) return;
      const who = claimedUserId(now);
      if (who !== null && who === String(owner)) return;
      clearDraft(owner);
      setChangedElsewhere(true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [owner]);

  return changedElsewhere;
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
