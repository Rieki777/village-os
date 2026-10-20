/**
 * Words from a ReGen Civics file, waiting in memory for the editor they belong in.
 *
 * The import screen (client/src/components/admin/ProfileImport.tsx) never
 * saves a purpose statement, a covenant or a quest. It hands the words to the
 * editor that already saves them, and the founder reads them there and
 * presses that editor's own Save. This is the hand-off and nothing more.
 *
 * IN MEMORY ONLY, AND TAKEN ONCE. A prefill is a suggestion made a moment ago
 * on this page. Written to browser storage it would outlive the moment and
 * turn up in an editor days later with nobody remembering where it came from,
 * so a reload drops it and the founder presses the button again. An editor
 * that takes one clears it, so the next editor to open does not get it twice.
 */
import { useEffect, useRef } from "react";

export interface Prefills {
  /** The governing purpose box on Make This Site Yours. */
  purpose: { text: string; fromFirstLine: boolean };
  /** The opening paragraph of the membership covenant section. */
  covenant: string;
  /** The Quests tab's "Post a quest" form. */
  quest: { title: string; needLabel: string | null };
}

type Key = keyof Prefills;

const waiting = new Map<Key, unknown>();
const listeners = new Map<Key, Set<(v: unknown) => void>>();

/** Hand words to an editor: delivered now if it is open, or kept until it opens. */
export function offerPrefill<K extends Key>(key: K, value: Prefills[K]): void {
  const open = listeners.get(key);
  if (open && open.size) {
    waiting.delete(key);
    for (const fn of Array.from(open)) fn(value);
    return;
  }
  waiting.set(key, value);
}

/** What is waiting for this editor, taken so nobody else gets it. */
export function takePrefill<K extends Key>(key: K): Prefills[K] | undefined {
  const v = waiting.get(key) as Prefills[K] | undefined;
  waiting.delete(key);
  return v;
}

/*
 * THE FILE ITSELF, kept the same way. A founder who opens Quests from the
 * import screen leaves Make This Site Yours, and the screen unmounts with
 * everything it read. Kept here, the file is read again when they come back,
 * so the second quest does not mean pasting it twice. Closing the card lets
 * it go.
 */
let keptFile = "";

export function keepFile(text: string): void {
  keptFile = text;
}

export function keptFileText(): string {
  return keptFile;
}

/** An open editor's ear: what is waiting when it mounts, and whatever is offered while it is open. */
export function usePrefill<K extends Key>(key: K, onArrive: (value: Prefills[K]) => void): void {
  const ref = useRef(onArrive);
  ref.current = onArrive;
  useEffect(() => {
    const fn = (v: unknown) => ref.current(v as Prefills[K]);
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(fn);
    const now = takePrefill(key);
    if (now !== undefined) fn(now);
    return () => {
      set!.delete(fn);
    };
  }, [key]);
}
