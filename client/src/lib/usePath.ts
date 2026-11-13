/**
 * THE READER'S PATH, for every surface that names a next step (the Root).
 *
 * A signed-in member's path is the server's own answer (`me.path`,
 * server/lib/pathFacts.ts), read at most once per half minute across the
 * whole app, because every page mounts its own Layout and the strip sits in
 * all of them. A profile change (a quest turned in, an agreement aligned)
 * clears it, which is exactly when the step moves. A visitor has no account
 * to read, so their path is worked out here by the same conductor
 * (shared/yourPath.ts) from nothing but the clock.
 *
 * This file imports the conductor, so it belongs to the lazy chunks that draw
 * the path and never to the app shell.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchGameMe, type GameMe } from "@/lib/gameApi";
import { onProfileRefresh } from "@/lib/profileRefresh";
import { civilDay, visitorFacts, yourPathAll, type PathAnswer, type PathMilestone } from "@shared/yourPath";

export interface PathView extends PathAnswer {
  today: string;
  also: PathAnswer[];
  dates: Partial<Record<PathMilestone, string>>;
  /** True for somebody with no account. */
  visitor: boolean;
}

const TTL_MS = 30_000;
let cache: { at: number; path: PathView | null } | null = null;

/** For tests, and for a page that knows the path just moved. */
export function clearPathCache(): void {
  cache = null;
}

/** Hand the cache a payload a page already fetched, so the strip does not ask again. */
export function rememberPath(me: Pick<GameMe, "path"> | null | undefined): void {
  if (me?.path) cache = { at: Date.now(), path: { ...me.path, visitor: false } };
}

export function visitorPath(now: Date = new Date()): PathView {
  const all = yourPathAll(visitorFacts(now, "UTC"));
  return { ...all[0], today: civilDay(now, "UTC"), also: all.slice(1), dates: {}, visitor: true };
}

/** The reader's path, or null while it is not known yet (and for a member on a server older than the path). */
export function usePath(): PathView | null {
  const { user, loading } = useAuth() as { user: unknown; loading?: boolean };
  const [path, setPath] = useState<PathView | null>(() => (user && cache && Date.now() - cache.at < TTL_MS ? cache.path : null));

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setPath(visitorPath());
      return;
    }
    let live = true;
    const load = (force: boolean) => {
      if (!force && cache && Date.now() - cache.at < TTL_MS) {
        setPath(cache.path);
        return;
      }
      void fetchGameMe()
        .then((me) => {
          const next = me?.path ? { ...me.path, visitor: false } : null;
          cache = { at: Date.now(), path: next };
          if (live) setPath(next);
        })
        .catch(() => undefined);
    };
    load(false);
    const off = onProfileRefresh(() => {
      cache = null;
      load(true);
    });
    return () => {
      live = false;
      off();
    };
  }, [user, loading]);

  return path;
}
