/**
 * Filter presets for the submissions list.
 *
 * The current filter lives in the address (`?type=`), so a link can be
 * shared. Named presets live on this device only.
 */
import { useEffect, useState } from "react";
import { storedText, writeStored } from "@/lib/safeStorage";

export const SAVED_VIEWS_KEY = "admin.savedViews";

export interface SavedView {
  name: string;
  filter: string;
}

export function filterFromUrl(search = typeof window === "undefined" ? "" : window.location.search): string {
  const type = new URLSearchParams(search).get("type");
  return type && type.trim() ? type : "all";
}

export function writeFilterUrl(filter: string): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!filter || filter === "all") params.delete("type");
  else params.set("type", filter);
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

export function readSavedViews(): SavedView[] {
  const raw = storedText("local", SAVED_VIEWS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is SavedView => !!row && typeof row === "object" && typeof (row as SavedView).name === "string" && typeof (row as SavedView).filter === "string")
      .slice(0, 12);
  } catch {
    return [];
  }
}

export function rememberView(name: string, filter: string): SavedView[] {
  const clean = name.trim().slice(0, 40);
  if (!clean) return readSavedViews();
  const next = [{ name: clean, filter }, ...readSavedViews().filter((view) => view.name !== clean)].slice(0, 12);
  writeStored("local", SAVED_VIEWS_KEY, JSON.stringify(next));
  return next;
}

export function useSubmissionFilter(): [string, (next: string) => void] {
  const [filter, setFilter] = useState(() => filterFromUrl());
  useEffect(() => {
    const onPop = () => setFilter(filterFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const update = (next: string) => {
    setFilter(next);
    writeFilterUrl(next);
  };
  return [filter, update];
}
