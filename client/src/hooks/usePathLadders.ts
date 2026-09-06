import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import type { PathLadder } from "@shared/pathLadders";

/**
 * The signed-in member's per-path ladders, or null while nobody knows yet.
 *
 * NULL MEANS UNKNOWN AND UNKNOWN DRAWS NOTHING, the same contract the profile
 * page already holds `config` and `prog` to. An empty array means the server
 * answered and this member has no ladder to show, which is a different fact and
 * has to look different: drawing an empty ladder while the request is in flight
 * would tell a steward their seat had gone for as long as the fetch took, which
 * is the exact bug the `offerKnown` flag on the Paths panel exists to prevent.
 *
 * IT RE-READS WHEN THE MEMBER'S CLAIMS CHANGE, and that is the whole reason it
 * takes the paths instead of a bare flag. A member who already walks one path
 * and then claims a second would otherwise sit looking at a tile with no
 * ladder under it until they reloaded the page, because the flag never
 * changed. The key is the joined list, so it does not depend on the array
 * keeping its identity across a render.
 *
 * The list is a CONVENIENCE and never a permission. The server re-derives what
 * it will serve from the account behind the token on every call, so a member
 * who walks nothing makes no request at all and a member who edits this value
 * gains nothing.
 *
 * `gameFetch` carries the bearer token, which this route requires: it refuses a
 * stranger with 401 and every read inside it is scoped to the token's own
 * account.
 */
export function usePathLadders(paths: readonly string[]): PathLadder[] | null {
  const [ladders, setLadders] = useState<PathLadder[] | null>(null);
  const key = paths.join(",");

  useEffect(() => {
    if (key === "") return;
    let live = true;
    gameFetch("/api/paths/ladders")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Only an array counts. A refusal, a proxy's HTML error page or a body
        // shaped like something else leaves the state null, which draws
        // nothing, instead of half a ladder assembled out of undefined.
        if (live && Array.isArray(d?.ladders)) setLadders(d.ladders as PathLadder[]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);

  return ladders;
}
