import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import type { PathLadder, PathParticulars } from "@shared/pathLadders";

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
 *
 * IT RETURNS TWO PROJECTIONS OF ONE FETCH. `ladders` is where the member
 * stands; `particulars` is what their rows actually say. The server builds both
 * from the same four queries in the same handler, so asking for them
 * separately would have doubled the round trips on every profile paint for
 * data already in memory. They are held in one state object so a render can
 * never show one of them updated and the other stale.
 */
export interface PathLadderData {
  ladders: PathLadder[] | null;
  particulars: PathParticulars | null;
  /**
   * True once the read has come back unusable.
   *
   * Null alone cannot carry this. A member who has just claimed a path has
   * their quiet line replaced by their new section, and that section draws
   * nothing while `particulars` is null: identical to a failed read, so a
   * refusal left the sheet permanently blank exactly where something had just
   * been promised. "Still asking" and "we asked and could not" have to look
   * different, because only one of them ever ends.
   */
  failed: boolean;
}

export function usePathLadders(paths: readonly string[]): PathLadderData {
  const [data, setData] = useState<PathLadderData>({ ladders: null, particulars: null, failed: false });
  const key = paths.join(",");

  useEffect(() => {
    if (key === "") return;
    let live = true;
    setData((d) => (d.failed ? { ...d, failed: false } : d));
    gameFetch("/api/paths/ladders")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Only an array counts. A refusal, a proxy's HTML error page or a body
        // shaped like something else leaves the state null, which draws
        // nothing, instead of half a ladder assembled out of undefined.
        if (!live) return;
        if (!Array.isArray(d?.ladders)) {
          setData({ ladders: null, particulars: null, failed: true });
          return;
        }
        // `paths` is checked on its own: an older server that serves ladders
        // and no particulars leaves that half null and draws nothing, which is
        // the same unknown-draws-nothing contract one field further in.
        const p = d.paths;
        setData({
          ladders: d.ladders as PathLadder[],
          particulars: p && typeof p === "object" && !Array.isArray(p) ? (p as PathParticulars) : null,
          failed: false,
        });
      })
      .catch(() => {
        if (live) setData({ ladders: null, particulars: null, failed: true });
      });
    return () => {
      live = false;
    };
  }, [key]);

  return data;
}
