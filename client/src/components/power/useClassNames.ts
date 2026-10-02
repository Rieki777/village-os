/**
 * THE VILLAGE'S OWN NAMES FOR ITS FIVE CLASSES, read once per page.
 *
 * The role card's "Suits ..." chip and its stock-art alt both name a class,
 * and the only honest name is the one this village gave it (`/api/archetypes`,
 * public, the same read the character pages make). Until that read lands the
 * card says nothing about a class at all: it never falls back to the seed
 * names, which would put another village's words on this one's seat.
 *
 * ONE REQUEST FOR THE WHOLE PAGE. The map mounts its seat card twice (the
 * standing panel and the phone sheet, one of them hidden by CSS), and a
 * module-level promise is what keeps that from being two requests. A failed
 * read is dropped from the cache, so the next card to mount asks again
 * instead of inheriting a failure for the life of the tab.
 *
 * Returns a key -> name map, or null while unread or failed.
 */
import { useEffect, useState } from "react";

let cache: Promise<Record<string, string> | null> | null = null;

function toNames(list: unknown): Record<string, string> | null {
  if (!Array.isArray(list)) return null;
  const out: Record<string, string> = {};
  for (const a of list) {
    if (a && typeof a === "object" && typeof (a as any).key === "string" && typeof (a as any).name === "string") {
      const name = (a as any).name.trim();
      if (name) out[(a as any).key] = name;
    }
  }
  return out;
}

/** The cached read. Exported so a host that is not a component can share it. */
export function loadClassNames(): Promise<Record<string, string> | null> {
  if (!cache) {
    const pending = fetch("/api/archetypes")
      .then((r) => (r.ok ? r.json() : null))
      .then(toNames)
      .catch(() => null);
    cache = pending;
    pending.then((names) => {
      if (names === null && cache === pending) cache = null;
    });
  }
  return cache;
}

export function useClassNames(): Record<string, string> | null {
  const [names, setNames] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    loadClassNames().then((n) => {
      if (alive) setNames(n);
    });
    return () => {
      alive = false;
    };
  }, []);
  return names;
}

export default useClassNames;
