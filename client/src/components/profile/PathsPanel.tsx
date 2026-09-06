/**
 * PATHS: which parts of village life you are here for, and how far along each.
 *
 * Membership first: a path is a bare string on the member, and this renders
 * what is true (you walk it, or you do not). Under each claimed tile sits that
 * path's own ladder, which arrives as a payload and is drawn by `PathLadder`.
 *
 * ── FOUR LADDERS, FOUR SHAPES ───────────────────────────────────────────────
 *
 * The room this file used to leave for a ladder is now filled, and it is filled
 * four different ways. An investor's steps and a resident's steps are different
 * acts with different counts, so there is no shared ladder here and no shared
 * rung count: three rungs for a steward, three for a resident, four for an
 * investor, two for a prosperity creator. `shared/pathLadders.ts` names them
 * and `server/lib/pathLadders.ts` decides which are lit, from live rows, on
 * every read.
 *
 * WHAT IS STILL REFUSED IS EVERY NUMBER THE OLD DRAFT INVENTED. That draft gave
 * each path a progress bar reading "2 of 3 seasons served, 62%", and the draft
 * made up all three figures. There is no bar, no fraction and no percentage
 * anywhere below, because a rung is a fact that holds or does not and there is
 * no denominator to divide by.
 *
 * A PATH THE MEMBER DOES NOT WALK SHOWS NO LADDER. The panel only looks up a
 * ladder for a tile the member has claimed, and the server only serves ladders
 * for the paths on the member's own record, so the two agree by construction.
 *
 * ── WHAT THIS CARD ABSORBED ─────────────────────────────────────────────────
 *
 * Four blocks used to sit under this one, one per path: Investment Journey,
 * Steward Role, Residency Status, Business Venture. Every one of them had been
 * reduced to a single "Not recorded yet" paragraph pointing at a journey page,
 * because none of them had a backing column. Four cards that can only ever say
 * "Not recorded yet" are worse than no cards, and the door each one held is
 * `route` on the path itself, which is now a link on the tile it belongs to.
 *
 * The empty-state copy went with them in the same commit, deliberately. It
 * promised "each one you take opens its own section on this page", and those
 * four blocks were the only thing in the product that made it true.
 *
 * ── COLOUR ──────────────────────────────────────────────────────────────────
 *
 * The claimed tile used to pair a per-path hardcoded tint with a per-path
 * hardcoded numbered text (`bg-blue-50` with `text-blue-600`, and three more).
 * Both halves are gone together. A claimed tile is now the semantic inverse
 * pair, which is the only high-contrast marker in this build that answers to
 * `.dark` in both directions.
 */
import { Link } from "wouter";
import { ArrowRight, Check, Plus } from "lucide-react";
import type { PathLadder as PathLadderPayload } from "@shared/pathLadders";
import PathLadder from "./PathLadder";

export interface PathTile {
  id: string;
  label: string;
  role: string;
  /** The village's own door for this path. Blank when the offer no longer names it. */
  route: string;
  /** Whether the village still offers this path, or the member merely holds it. */
  offered: boolean;
}

export default function PathsPanel({
  tiles,
  claimedIds,
  offerKnown,
  saving,
  error,
  onToggle,
  ladders,
}: {
  tiles: PathTile[];
  claimedIds: string[];
  /** Null config means UNKNOWN, and unknown says nothing. See the note below. */
  offerKnown: boolean;
  saving: string | null;
  error: string;
  onToggle: (id: string) => void;
  /**
   * The member's own ladders, from `/api/paths/ladders`.
   *
   * NULL AND UNDEFINED BOTH MEAN UNKNOWN, and unknown draws nothing, the same
   * contract `offerKnown` holds the retirement line to. An empty array means
   * the server answered and this member has no ladder to show. Optional so a
   * caller that has not fetched them renders exactly the panel it used to.
   */
  ladders?: PathLadderPayload[] | null;
}) {
  const walked = tiles.filter((t) => claimedIds.includes(t.id)).length;

  return (
    <section aria-labelledby="paths-h" className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 id="paths-h" className="font-display text-2xl font-bold text-card-foreground">
        Paths
      </h2>
      {/* The count comes off the list, never off a literal. A fork that offers
          three paths or seven gets a sentence that is true for it. */}
      <p className="mt-1 text-sm text-muted-foreground">
        {tiles.length} ways to walk with this village. Take as many as are true of you, and put one
        down whenever it changes.
      </p>

      {walked === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          You walk none of them yet. A path says which part of village life you are here for.
          Claim one below.
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {tiles.map((tile) => {
          const claimed = claimedIds.includes(tile.id);
          const busy = saving === tile.id;
          // Undefined here covers three different absences on purpose: the
          // payload has not landed, the member does not walk this path, and
          // this build has no columns for it. All three draw nothing, which is
          // the only honest picture of each of them.
          const ladder = claimed ? (ladders ?? []).find((l) => l.pathId === tile.id) : undefined;
          return (
            <div
              key={tile.id}
              className={`flex flex-col rounded-xl border p-4 ${
                claimed ? "border-foreground bg-muted" : "border-dashed border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* `break-words` throughout: a fork's path label is its own
                      words and can be long, and this tile is 160px wide at
                      375px. */}
                  <p className="font-semibold break-words text-foreground">{tile.label}</p>
                  {tile.role ? (
                    <p className="text-sm break-words text-muted-foreground">{tile.role}</p>
                  ) : null}
                </div>
                {claimed ? (
                  <Check className="h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
                ) : null}
              </div>

              <p className="mt-2 text-sm text-muted-foreground">
                {claimed ? "You walk this path." : "You do not walk this path."}
              </p>

              {/* Only once the offer has actually ARRIVED. Until then the offer
                  is empty and every path a member holds looks retired, so an
                  unguarded line here told a steward their own path was gone for
                  as long as the fetch took. */}
              {offerKnown && !tile.offered ? (
                <p className="mt-1 text-sm text-muted-foreground">No longer offered here.</p>
              ) : null}

              {/* THIS PATH'S OWN LADDER, in the room that was left for one:
                  under the standing and above the controls.

                  Only for a tile the member has CLAIMED, because a ladder is a
                  claim about somebody's journey and a path they do not walk has
                  none. Only when a payload has arrived, because null means
                  unknown and unknown says nothing. And only for a path this
                  build has columns behind, so a fork's own fifth path draws no
                  empty frame nobody could ever fill. */}
              {ladder ? <PathLadder ladder={ladder} /> : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onToggle(tile.id)}
                  disabled={saving !== null}
                  aria-pressed={claimed}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
                >
                  {claimed ? null : <Plus className="h-4 w-4" aria-hidden="true" />}
                  {busy ? "Saving" : claimed ? "Put this path down" : "Walk this path"}
                </button>
                {/* The door this path's own deleted card used to hold. A wouter
                    Link, never a raw anchor: six of those on this page were
                    forcing a full document reload inside a single-page app. */}
                {tile.route ? (
                  <Link
                    href={tile.route}
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-foreground underline underline-offset-2"
                  >
                    What this path asks
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/*
        THE RESULT OF A CLAIM, SAID OUT LOUD.

        `updateProfile` reads the Response, throws on a refusal and replaces
        the member from the body the server sent, so the tiles above show what
        was SAVED. What was missing is any announcement that it landed: this
        page carried no `aria-live` at all, so a member using a screen reader
        pressed a button and heard nothing either way.
      */}
      <p aria-live="polite" role="status" className="sr-only">
        {saving ? "Saving your paths." : ""}
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
