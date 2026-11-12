/**
 * HOW MUCH YOU WEIGH, AND WHY.
 *
 * Custom mode is the sharp case: weight is allocated by a steward, one member
 * at a time, and allocated power that a member cannot see is exactly the thing
 * the constitution's new law was written against ("Voting weight is on the
 * record").
 *
 * The other two modes get the same card because the QUESTION is the same one,
 * and a member should not have to know which mode their village runs to find
 * out what their vote is worth. Equal mode answers "one person, one vote" and
 * is a short card. That shortness is the point: an honest surface for a simple
 * rule looks simple.
 *
 * A zero is stated, never left blank. In custom mode an absent allocation is
 * zero weight by design (fail closed), and a member holding zero has a real
 * grievance the interface should hand them instead of hiding it.
 *
 * THIS CARD CARRIED A TRAIL AND NO LONGER DOES, which is the whole of this
 * lane. It printed the viewer's own weight-change rows under "Every change to
 * it" while `WeightRecord` printed the village's append-only trail, which
 * CONTAINS those same rows, under "Every change". Two headings a few words
 * apart, one list nested inside the other, in one rail column. The two cards
 * landed an hour apart from two lanes and neither lane was placed to see the
 * pair.
 *
 * THE SHAPE CHOSEN: two cards, one job each, no shared rows. This card is the
 * near fact a member came for, and it is a fact, never a list: what you weigh,
 * under which rule, and what that weight is worth when a decision opens. The
 * trail is one list and lives once, in `WeightRecord`, where a row belonging
 * to the viewer now reads "You". Nothing left the page. The viewer's rows are
 * still on it, they still sit where they happened, and they now carry the name
 * of whoever made the change, which this card never showed.
 *
 * The merge was considered and refused: this card is on `/decisions/:id` too,
 * where the rail is deliberately about one vote, and a single card holding the
 * village's whole ledger would have to be the tallest thing on that page.
 */
import { Scale } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import { CrowdFigure } from "./QuorumField";
import { weightText } from "./voteBars";
import type { Standing } from "./governanceApi";

const MODE_LABEL: Record<Standing["mode"], string> = {
  equal: "One person, one vote",
  token: "Weighted by token",
  custom: "Weights allocated by the stewards",
};

export default function MyStanding({ standing }: { standing: Standing }) {
  const zero = standing.eligible && standing.weight === 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
        <Scale className="w-4 h-4 text-notice" aria-hidden="true" />
        Your weight
        <InfoTip
          tip="Weight is how much a vote counts. It is read when a ballot opens and frozen there, so a later change never rewrites a vote in flight."
          label="What voting weight is"
        />
      </h3>

      {!standing.eligible ? (
        /* THE TRUE ONE, RATHER THAN BOTH OF THEM. This named the stage rung
           and the warning badge in one sentence and left the reader to work
           out which was hers, and a member being held back by a warning has
           no other place in the product to learn that. `deniedByWarning` is
           the server saying which. R56: it is stated once, flatly, with
           nothing in it about what she should have done. */
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {standing.deniedByWarning
            ? "A warning on your account is holding voting back for as long as it stands."
            : "You cannot vote in this village yet. Voting opens at the member stage."}
        </p>
      ) : (
        <>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-foreground">{weightText(standing.weight)}</span>
            <span className="text-sm text-muted-foreground">{MODE_LABEL[standing.mode]}</span>
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{standing.why}</p>

          {/* The same silhouette a decision's participation field is built
              from, so the vocabulary is learned once. It is here because this
              is the card that answers "what is my weight worth", and the field
              is where a member sees weight spent. */}
          <p className="mt-2.5 flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
            <CrowdFigure size={22} className="mt-0.5" />
            <span>
              On a decision, the row of silhouettes fills by weight and never by heads, so this number is the share of
              it your vote fills.
            </span>
          </p>

          {zero && (
            <p className="mt-3 rounded-lg bg-notice/10 px-3 py-2 text-sm text-notice leading-relaxed">
              You hold no weight, so a vote from you would count for nothing. That is a decision somebody made, and it
              has a reason on the record. Ask a steward for it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
