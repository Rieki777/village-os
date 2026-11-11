/**
 * ONE PLACE THAT KNOWS WHETHER ANYTHING ON SCREEN IS UNSAVED.
 *
 * The lead (2026-11-11): "A save button should pop up every time I make a
 * change and this should be for every surface so that I don't have to find the
 * save buttons." The floating bar (`components/SaveBar.tsx`) is the visible
 * half. This file is the other half: a small registry every bar writes its
 * change count into, so the things that LEAVE a surface (an Admin tab switch,
 * a link, closing the tab) can ask one question before they go.
 *
 * It is plain module state on purpose. The guard has to answer from places
 * that are not React (a `beforeunload` handler, a capture-phase click
 * listener), and a context would only reach the ones inside its provider.
 *
 * `useDraftDoc` is the small form-state helper for the common case: a surface
 * that loads one document, edits a copy, and saves the copy back. It counts
 * changes per top-level key, compared by value, which is the comparison the
 * org chart already had to learn (an array compared by reference is wrong in
 * both directions).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

const LEAVE_QUESTION = msg`You have changes that are not saved yet. Leave and lose them?`;

function emit() {
  listeners.forEach((fn) => fn());
}

/** Record how many unsaved changes one surface holds. Zero removes it. */
export function setUnsaved(id: string, count: number) {
  const before = counts.get(id) ?? 0;
  if (count > 0) counts.set(id, count);
  else counts.delete(id);
  if (before !== count) emit();
}

/** Every unsaved change on screen, across every surface that registered. */
export function unsavedCount(): number {
  let n = 0;
  counts.forEach((v) => { n += v; });
  return n;
}

export function subscribeUnsaved(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Ask before leaving. True means go ahead: nothing is unsaved, or the person
 * said to leave anyway. When they leave anyway the registry is cleared, since
 * the surfaces holding those drafts are about to unmount.
 */
export function confirmLeave(): boolean {
  if (unsavedCount() === 0) return true;
  const go = window.confirm(i18n._(LEAVE_QUESTION));
  if (go) { counts.clear(); emit(); }
  return go;
}

/** Test seam: forget every registration. */
export function resetUnsavedForTests() {
  counts.clear();
  emit();
}

let installed = false;
/**
 * The browser-level guard, installed once: closing or reloading the tab, and
 * any same-window link click, ask first while anything is unsaved. The click
 * listener runs in the capture phase on the document, which is before React's
 * own root listener, so a wouter `<Link>` is stopped before it navigates.
 */
export function installLeaveGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("beforeunload", (e) => {
    if (unsavedCount() === 0) return;
    e.preventDefault();
    // Older engines only show the prompt when returnValue is set.
    e.returnValue = "";
  });
  document.addEventListener(
    "click",
    (e) => {
      if (unsavedCount() === 0 || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      // A link to the same page (a hash, or this same address) leaves nothing.
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      if (a.href === window.location.href) return;
      if (a.hasAttribute("data-keeps-draft")) return;
      if (!confirmLeave()) { e.preventDefault(); e.stopPropagation(); }
    },
    true,
  );
}

/** Live total of unsaved changes, for a component that wants to show it. */
export function useUnsavedTotal(): number {
  const [n, setN] = useState(unsavedCount);
  useEffect(() => subscribeUnsaved(() => setN(unsavedCount())), []);
  return n;
}

let nextId = 0;
/**
 * Register this surface's change count for as long as it is mounted. The
 * registration is dropped on unmount, so a surface that closed cannot keep a
 * guard asking about changes nobody can see any more.
 */
export function useUnsavedRegistration(count: number) {
  const id = useRef<string>("");
  if (!id.current) id.current = `surface-${++nextId}`;
  useEffect(() => { installLeaveGuard(); }, []);
  useEffect(() => { setUnsaved(id.current, count); }, [count]);
  useEffect(() => () => setUnsaved(id.current, 0), []);
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Absent and empty read the same on a form: a field the server left out
  // and one the person cleared are both blank.
  const blank = (v: unknown) => v === undefined || v === null || v === "";
  if (blank(a) && blank(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** How many of the keys differ between two objects, by value. */
export function changedKeys<T extends Record<string, unknown>>(loaded: T | null, draft: T | null, keys?: readonly (keyof T)[]): (keyof T)[] {
  if (!loaded || !draft) return [];
  const all = keys ?? Array.from(new Set([...Object.keys(loaded), ...Object.keys(draft)])) as (keyof T)[];
  return all.filter((k) => !same(loaded[k], draft[k]));
}

/**
 * A loaded document and an editable copy of it.
 *
 *   const doc = useDraftDoc(loadedFromServer);
 *   <input value={doc.draft?.name ?? ""} onChange={(e) => doc.patch({ name: e.target.value })} />
 *   <SaveBar count={doc.count} onSave={...} onDiscard={doc.discard} />
 *
 * `accept(saved)` takes what the server answered as the new baseline, which
 * is the only honest moment for the bar to go away.
 */
export function useDraftDoc<T extends Record<string, unknown>>(loaded: T | null, keys?: readonly (keyof T)[]) {
  const [base, setBase] = useState<T | null>(loaded);
  const [draft, setDraft] = useState<T | null>(loaded);
  // A new load replaces both, so the bar never compares against a stale copy.
  useEffect(() => { setBase(loaded); setDraft(loaded); }, [loaded]);
  const changed = useMemo(() => changedKeys(base, draft, keys), [base, draft, keys]);
  const patch = useCallback((p: Partial<T>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);
  const discard = useCallback(() => setDraft(base), [base]);
  const accept = useCallback((saved?: T) => { const next = saved ?? draft; setBase(next); setDraft(next); }, [draft]);
  return { base, draft, setDraft, patch, changed, count: changed.length, dirty: changed.length > 0, discard, accept };
}
