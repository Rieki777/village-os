/**
 * The signed-in member's own Gene Keys, read once and shared.
 *
 * The seal on the portrait, the card on the profile and the prompt on the
 * character page all ask the same question. One read answers all three, and a
 * save or a change anywhere updates every one of them at once.
 *
 * `undefined` while reading, `null` when there is nothing saved (or the read
 * failed: the surfaces then offer to find the lines, never claim a result).
 */
import { useEffect, useState } from "react";
import type { OwnGeneKeysView } from "@shared/geneKeys";
import { useModuleOn } from "@/modules/ModuleProvider";
import { readMyGeneKeys } from "@/lib/geneKeysApi";

type State = OwnGeneKeysView | null | undefined;

let current: State = undefined;
let reading: Promise<void> | null = null;
const listeners = new Set<(s: State) => void>();

function publish(next: State): void {
  current = next;
  for (const l of Array.from(listeners)) l(next);
}

/** Put a fresh result everywhere, after a save, a change or a removal. */
export function setMyGeneKeys(next: OwnGeneKeysView | null): void {
  publish(next);
}

function readOnce(): void {
  if (current !== undefined || reading) return;
  reading = readMyGeneKeys()
    .then((v) => publish(v))
    .catch(() => publish(null))
    .finally(() => {
      reading = null;
    });
}

export function useMyGeneKeys(): { on: boolean; mine: State } {
  const on = useModuleOn("gene_keys");
  const [mine, setMine] = useState<State>(current);
  useEffect(() => {
    if (!on) return;
    listeners.add(setMine);
    setMine(current);
    readOnce();
    return () => {
      listeners.delete(setMine);
    };
  }, [on]);
  return { on, mine: on ? mine : null };
}
