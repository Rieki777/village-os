/**
 * ONE PATH'S LADDER, drawn inside that path's own tile.
 *
 * The four paths are not the same shape and this component never pretends they
 * are: it draws the rungs it is handed, however many that is. A steward has
 * three, a resident three, an investor four, a prosperity creator two. The
 * server decides which are lit, from live rows, at the moment of the read.
 *
 * ── NO BAR, NO FRACTION, NO PERCENTAGE ──────────────────────────────────────
 *
 * This card's own history is the argument. An earlier draft of the character
 * sheet gave every path a progress bar reading "2 of 3 seasons served, 62%",
 * and each of those numbers was invented by the draft. `MaturityLadder` next
 * door draws a bar in exactly one place, inside the branch where the rung has a
 * real denominator, and there is no `else`. Here there is no denominator
 * anywhere: a rung is a fact that holds or does not, so the ladder shows which
 * ones hold and states each one in words.
 *
 * ── A DROPPED RUNG IS DRAWN, NOT HIDDEN ─────────────────────────────────────
 *
 * A rung the record still shows as reached, whose fact has since ended, gets
 * its own mark and its own sentence. That is the whole point of the interval
 * columns behind this: the position falls and the history does not, so a member
 * who stood down from a seat reads "reached, and the record shows it ended"
 * instead of a ladder that has quietly forgotten them.
 *
 * ── WHAT IT REFUSES TO SAY ──────────────────────────────────────────────────
 *
 * Anything the payload does not carry. A rung with no `note` gets no
 * explanation and a rung with no `moon` gets no date, and neither gap is filled
 * in from a neighbouring value. Three of those gaps are real and permanent, and
 * `server/lib/pathLadders.ts` names all three at the lines where it declines to
 * guess.
 *
 * ── COLOUR ──────────────────────────────────────────────────────────────────
 *
 * Semantic tokens only. `text-sage`, `text-amber-ink` and `text-teal-deep` are
 * frozen inks defined once in `@theme` and never redefined under `.dark`, so
 * they measure 2.89, 3.07 and 1.66 on a themed card at night. This card sits
 * inside a tile that is already themed, so it uses none of them, and it adds no
 * numbered gray: state is carried by an icon, by words, and by weight.
 */
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Circle, MinusCircle } from "lucide-react";
import type { LadderRung, PathLadder as PathLadderPayload } from "@shared/pathLadders";
import { villageMoonLabel } from "@shared/villageMoon";

/**
 * The three states a rung can be in, and what a reader who gets no icon hears.
 *
 * Keyed by the union, never `Record<string, string>`: a fourth state added to
 * the payload would otherwise render an empty span where a sentence belonged,
 * with no error and no console line.
 */
type RungState = "lit" | "fell" | "ahead";

const STATE_WORDS: Record<RungState, string> = {
  lit: ", this one holds now",
  fell: ", reached, and the record shows it ended",
  ahead: ", ahead of you",
};

const STATE_ICON: Record<RungState, typeof Circle> = {
  lit: CheckCircle2,
  fell: MinusCircle,
  ahead: Circle,
};

const stateOf = (rung: LadderRung): RungState => (rung.lit ? "lit" : rung.fell ? "fell" : "ahead");

export default function PathLadder({ ladder }: { ladder: PathLadderPayload }) {
  const { rungs, position, empty } = ladder;

  /*
    NOTHING ON THE LADDER YET: name the mechanic, then one door, the way the
    Contributions card does. A card that can only ever say "nothing yet" is
    worse than no card.

    The door is drawn only when the payload names one, and two of the four
    leave it blank on purpose: every tile already carries the path's own door a
    few lines below this, and a second link to the same place is noise. See
    `LadderEmpty` in shared/pathLadders.ts.
  */
  if (empty) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-background p-3">
        <p className="text-sm text-muted-foreground">
          {empty.mechanic}
          {empty.doorHref ? (
            <>
              {" "}
              <Link
                href={empty.doorHref}
                className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
              >
                {empty.doorLabel}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const here = position > 0 ? rungs[position - 1] : null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Where you stand
      </p>
      {here ? (
        <>
          <p className="mt-1 font-semibold break-words text-foreground">{here.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{here.meaning}</p>
        </>
      ) : (
        /* Every rung is dark and at least one of them once held, which is a
           real answer and not a missing one. The rungs below say which. */
        <p className="mt-1 text-sm text-muted-foreground">
          No rung on this ladder holds right now.
        </p>
      )}

      <ol className="mt-3 space-y-2">
        {rungs.map((rung, i) => {
          const state = stateOf(rung);
          const Icon = STATE_ICON[state];
          const standing = position > 0 && i === position - 1;
          const moon = villageMoonLabel(rung.moon);
          return (
            <li key={rung.id} className="flex items-start gap-2">
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${state === "ahead" ? "text-muted-foreground" : "text-foreground"}`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p
                  aria-current={standing ? "step" : undefined}
                  title={rung.meaning}
                  className={`text-sm break-words ${
                    state === "ahead" ? "text-muted-foreground" : "font-medium text-foreground"
                  }`}
                >
                  {rung.name}
                  {/* The icon carries the state to somebody looking. This
                      carries it to somebody who gets no icon, so the ladder is
                      never shape and colour alone. */}
                  <span className="sr-only">{STATE_WORDS[state]}</span>
                </p>
                {/* Why a dark rung is dark, when a column carries the reason.
                    Absent for every case where nothing in the schema says. */}
                {rung.note ? <p className="text-xs text-muted-foreground">{rung.note}</p> : null}
                {/* The village's own moon, never a raw cycle id. A village that
                    has not set a first moon gets the window with no number on
                    it, which is what `villageMoonLabel` already answers. */}
                {moon ? <p className="text-xs text-muted-foreground">{moon}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
