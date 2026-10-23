/**
 * AUTOSAVE ON EVERY CHANGE, for the role proposal steps (role proposals PR C).
 *
 * A change marks its group dirty (`roles`, `newRoles`, `settings`, `season`,
 * the four groups `PUT /api/governance/role-proposals/:id` takes) and the save
 * runs once the member pauses. One save runs at a time: a change made while one
 * is in flight is sent after it, so the server never holds an older group than
 * the page. A save that fails keeps its groups dirty, says "Not saved, try
 * again", and is sent again by the next change or by Try again.
 *
 * `flush` sends whatever is waiting now and answers whether it saved, so a
 * page can save before it moves to another step or draws the preview.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type Group = "roles" | "newRoles" | "settings" | "season";
export type SaveStatus = "idle" | "saving" | "saved" | "failed";
export type SaveResult = { ok: true } | { ok: false; error: string };

/** How long a pause in typing is, before the save runs. Tests set it to 0. */
export const AUTOSAVE = { delayMs: 900 };

export function useAutosave(send: (groups: ReadonlySet<Group>) => Promise<SaveResult>) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const dirty = useRef(new Set<Group>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    while (inflight.current) await inflight.current;
    if (!dirty.current.size) return true;
    const groups = new Set(dirty.current);
    dirty.current.clear();
    setStatus("saving");
    const run = (async () => {
      const r = await sendRef.current(groups).catch((): SaveResult => ({ ok: false, error: "" }));
      if (r.ok) {
        setError(null);
        setStatus(dirty.current.size ? "saving" : "saved");
        return true;
      }
      groups.forEach((g) => dirty.current.add(g));
      setError(r.error || null);
      setStatus("failed");
      return false;
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    // A change made while this one was in flight goes now.
    if (ok && dirty.current.size) return flush();
    return ok;
  }, []);

  const touch = useCallback(
    (g: Group) => {
      dirty.current.add(g);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, AUTOSAVE.delayMs);
    },
    [flush],
  );

  // Leaving the page mid-pause still sends the last change.
  useEffect(
    () => () => {
      if (timer.current && dirty.current.size) void flush();
    },
    [flush],
  );

  return { status, error, touch, flush };
}
