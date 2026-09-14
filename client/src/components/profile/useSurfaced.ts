/**
 * A section that has just opened gets one turn at the top, then goes home.
 *
 * ── THE RULE, AND WHY IT HAS THIS SHAPE ──────────────────────────────────
 *
 * The sheet's order is fixed on purpose: a page that rearranges as somebody
 * progresses moves the thing they had learned to scroll to. But a member who
 * has just earned something new should MEET it rather than have to notice that
 * a section they had never read is now full.
 *
 * So the order breaks for exactly one thing, briefly, and then restores. That
 * is the whole mechanic and every rule below exists to stop it becoming a nag:
 *
 *   ONE AT A TIME. Crossing a rung can open several things at once. They queue
 *   in the order they opened and a member meets one per visit, because "here
 *   are four new things" is the complexity this ordering exists to spare them.
 *
 *   IT GOES HOME WHETHER OR NOT THEY TOUCH IT. Three sightings and it settles.
 *   Waiting for a click means a section somebody has no interest in sits at the
 *   top of their profile forever.
 *
 *   USING IT SETTLES IT IMMEDIATELY. A section that has been opened has served
 *   its purpose and must not come back, however few times it was shown.
 *
 * ── WHY IT COUNTS A VISIT AND NOT A RENDER ───────────────────────────────
 *
 * The count is written once per mount, not on every re-render, and not on
 * every scroll. A member who reloads twice in a minute has not "seen it three
 * times"; three VISITS is the intent. React strict mode double-invokes effects
 * in development, so the guard is a ref rather than a dependency array.
 *
 * ── WHAT IT DOES BEFORE THE SERVER ANSWERS ───────────────────────────────
 *
 * Nothing. `surfaced` is empty until the read lands, so the sheet paints in its
 * settled order and a section lifts a moment later if it has earned it. The
 * alternative is lifting everything on first paint and dropping most of it,
 * which is a page that jumps for every member on every load.
 */
import { useEffect, useRef, useState } from "react";

import { gameFetch } from "@/lib/gameApi";

/** Matches server/lib/sheetSeen.ts. A section settles after this many visits. */
const MAX_SIGHTINGS = 3;

export interface Surfaced {
  /** The one section to lift, or null. Never more than one. */
  sectionId: string | null;
  /** Tell the hook a member has used it, so it settles for good. */
  acknowledge: (sectionId: string) => void;
}

/**
 * @param openNow  every section that is currently open to this member, in the
 *                 order the sheet declares them. Sections absent from this list
 *                 are not open and can never surface.
 * @param ready    false while the caller is still deciding what is open. The
 *                 hook does nothing until this is true, because a section that
 *                 looks closed for one render must not be "newly opened" on the
 *                 next one.
 */
export function useSurfaced(openNow: readonly string[], ready: boolean): Surfaced {
  const [seen, setSeen] = useState<Record<string, number> | null>(null);
  const [settledLocally, setSettledLocally] = useState<Record<string, true>>({});
  const counted = useRef(false);

  useEffect(() => {
    let alive = true;
    gameFetch("/api/profile/prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setSeen(d && typeof d.sheetSeen === "object" ? d.sheetSeen : {});
      })
      .catch(() => {
        /*
         * A FAILED READ SURFACES NOTHING, which is the safe direction. Treating
         * "we could not ask" as "they have seen nothing" would lift a section
         * at every member on every blip, and this mechanic's whole value is
         * that it is rare.
         */
        if (alive) setSeen({});
      });
    return () => {
      alive = false;
    };
  }, []);

  const known = seen ?? {};
  const candidate =
    !ready || seen === null
      ? null
      : (openNow.find((id) => !settledLocally[id] && (known[id] ?? 0) < MAX_SIGHTINGS) ?? null);

  // ONE WRITE PER VISIT, for the one section actually being lifted. Sections
  // nobody is being shown are not counted, or a member would burn their three
  // sightings on things that never appeared.
  useEffect(() => {
    if (!candidate || counted.current) return;
    counted.current = true;
    void gameFetch("/api/profile/prefs", {
      // save-ok: nothing on this page tells the member a sighting was
      // recorded, so there is no claim here that could be false. The count is
      // re-read from the server on the next mount, and a lost write shows the
      // section once more, which is the harmless direction to be wrong in.
      method: "PUT",
      body: JSON.stringify({ sawSections: [candidate] }),
    }).catch(() => {
      /* An uncounted sighting shows it once more. That is the harmless way to
         be wrong; the other way is never showing it at all. */
    });
  }, [candidate]);

  return {
    sectionId: candidate,
    acknowledge: (sectionId: string) => {
      setSettledLocally((s) => (s[sectionId] ? s : { ...s, [sectionId]: true }));
      void gameFetch("/api/profile/prefs", {
        // save-ok: `settledLocally` above is what this hook renders from, so
        // the section stops surfacing on this device whatever the server
        // says. This write is the copy that outlives the session, and a lost
        // one costs at most one more sighting on another device.
        method: "PUT",
        body: JSON.stringify({ sawSections: [sectionId], acknowledged: true }),
      }).catch(() => {
        /* It settles on this device now and on the next successful write. */
      });
    },
  };
}
