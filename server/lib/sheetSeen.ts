/**
 * Which sections of the sheet this member has already met.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * A section that has just opened is lifted to the top of the profile for a
 * session or two, so somebody who has earned something new meets it once
 * instead of having to notice it moved. Then it goes home, because the sheet's
 * order is fixed and learnable and a page that rearranges under a reader is
 * worse than one that does not.
 *
 * That needs to remember, per member, what they have already met.
 *
 * ── WHY NOT `claimMoment` ────────────────────────────────────────────────
 *
 * `client/src/lib/celebrated.ts` already does once-only, and it is
 * localStorage. Its own header says a cleared browser loses the record, which
 * is the right trade for a celebration animation and the wrong one here: a
 * member who met a section on their phone would meet it again on their laptop,
 * and clearing a browser would resurface every section they have ever opened.
 *
 * ── WHY NO MIGRATION ─────────────────────────────────────────────────────
 *
 * `users.prefs` is an existing JSON column, already read and written per
 * member (server/repos/users.ts). This is a key inside it. Roughly twenty
 * short ids per member, call it three hundred bytes; ten thousand members is
 * about three megabytes in a column that already exists, on a database already
 * holding a ledger. There was no reason to spend a migration on it, and a
 * migration on this platform is applied at boot, fail-loud, to thirteen
 * instances, so not spending one is worth something.
 *
 * ── THE CAP IS THE POINT ─────────────────────────────────────────────────
 *
 * A surfaced section goes home after a fixed number of sightings whether or
 * not anybody touches it. Without that, a section somebody has no interest in
 * sits at the top of their profile forever, which is a nag wearing a feature's
 * clothes.
 */

/** How many times a newly opened section may lift itself before it goes home. */
export const MAX_SIGHTINGS = 3;

export interface SheetSeen {
  /** section id -> how many times it has been surfaced so far. */
  [sectionId: string]: number;
}

/** Whatever is in `prefs`, read as a seen-map. Anything unreadable is empty. */
export function readSeen(prefs: unknown): SheetSeen {
  const raw = (prefs as any)?.sheetSeen;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SheetSeen = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    // Ids are short and countable; anything else is somebody else's data or a
    // corrupted write, and is dropped rather than trusted.
    if (typeof k === "string" && k.length > 0 && k.length <= 64 && Number.isFinite(Number(v))) {
      out[k] = Math.max(0, Math.min(MAX_SIGHTINGS, Math.floor(Number(v))));
    }
  }
  return out;
}

/**
 * Record that a member has met these sections once more.
 *
 * `acknowledged` jumps straight to the cap: a section somebody has actually
 * used never surfaces again, however few times it was shown. Counting up to
 * the cap is only for sections that were shown and ignored.
 */
export function noteSeen(
  current: SheetSeen,
  sections: readonly string[],
  acknowledged = false,
): SheetSeen {
  const next: SheetSeen = { ...current };
  for (const id of sections) {
    if (typeof id !== "string" || !id || id.length > 64) continue;
    const was = Number.isFinite(next[id]) ? next[id] : 0;
    next[id] = acknowledged ? MAX_SIGHTINGS : Math.min(MAX_SIGHTINGS, was + 1);
  }
  return next;
}

/** True when this section has had its turn at the top and should go home. */
export function settled(seen: SheetSeen, sectionId: string): boolean {
  return (seen[sectionId] ?? 0) >= MAX_SIGHTINGS;
}
