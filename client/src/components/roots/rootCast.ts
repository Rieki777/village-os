/**
 * The village's five roots, read once per page load from `GET /api/archetypes`
 * (the same words the profile's characters page and the roles page show), so
 * every tag on a page costs one request between them. A failed read is
 * forgotten, so the next mount asks again; until then a tag falls back to its
 * key with "The" taken off, which is never empty.
 */
import { useEffect, useState } from "react";

export interface Root {
  key: string;
  name: string;
  subtitle: string;
  blurb: string;
}

let castOnce: Promise<Root[]> | null = null;
let castNow: Root[] | null = null;

export function readRootCast(): Promise<Root[]> {
  castOnce ??= fetch("/api/archetypes")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`archetypes ${r.status}`))))
    .then((d: unknown) => {
      const list = Array.isArray(d)
        ? d
            .filter((a: any) => a && typeof a.key === "string")
            .map((a: any) => ({
              key: String(a.key),
              name: String(a.name ?? a.key),
              subtitle: String(a.subtitle ?? ""),
              blurb: String(a.blurb ?? ""),
            }))
        : [];
      castNow = list;
      return list;
    })
    .catch(() => {
      castOnce = null;
      return [];
    });
  return castOnce;
}

/** The cast, live. Empty until it arrives. */
export function useRootCast(): Root[] {
  const [cast, setCast] = useState<Root[]>(castNow ?? []);
  useEffect(() => {
    let live = true;
    void readRootCast().then((c) => live && c.length && setCast(c));
    return () => {
      live = false;
    };
  }, []);
  return cast;
}

/** For tests: forget the cached cast. */
export function forgetRootCast(): void {
  castOnce = null;
  castNow = null;
}
