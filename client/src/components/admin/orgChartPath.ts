/**
 * WHERE THE ORG CHART IS OPEN, in the address bar.
 *
 * The lead (2026-11-11) asked for the org chart nested: the circles first, a
 * circle's roles when you open it, and the whole role when you open that. Each
 * level is an address (`?tab=org-chart&circle=<id>&role=<id>`), so a link can
 * point at one role, and the browser's back button walks back up the levels
 * the way it walks Admin's tabs.
 *
 * Roles that sit in no circle open under the circle id `none`.
 */
import { useCallback, useEffect, useState } from "react";

export const NO_CIRCLE = "none";

export interface OrgPath {
  circle: string | null;
  role: string | null;
}

export function readOrgPath(search: string): OrgPath {
  const p = new URLSearchParams(search);
  const circle = p.get("circle")?.trim() || null;
  const role = p.get("role")?.trim() || null;
  return { circle, role };
}

/** The address for a level, keeping every other parameter (the tab among them). */
export function orgPathSearch(search: string, next: OrgPath): string {
  const p = new URLSearchParams(search);
  if (next.circle) p.set("circle", next.circle); else p.delete("circle");
  if (next.role) p.set("role", next.role); else p.delete("role");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function useOrgPath(): [OrgPath, (next: OrgPath) => void] {
  const [path, setPath] = useState<OrgPath>(() => readOrgPath(window.location.search));
  useEffect(() => {
    const onPop = () => setPath(readOrgPath(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((next: OrgPath) => {
    window.history.pushState({}, "", `${window.location.pathname}${orgPathSearch(window.location.search, next)}`);
    setPath(next);
    window.scrollTo({ top: 0 });
  }, []);
  return [path, go];
}
