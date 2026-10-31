/**
 * DROP IN. The place line read out loud, a breath taken together, a few
 * minutes sat in quiet if the facilitator starts one, and a look at who is
 * here. Nothing is asked of anybody yet.
 *
 * Each thing is said once: the moon and the season sit in the room's header,
 * so this stage leaves them out, and the people are listed here in full while
 * the header leaves them out on this stage.
 *
 * The place line is set as the room's pull-quote, a gold rule at its edge and
 * the display face large, the way the record sets what a circle learned.
 */
import { ROOM_COPY, SESSION_COPY } from "@shared/sessions";
import PeopleHere from "./PeopleHere";
import SharedBreath from "./SharedBreath";
import SharedSit from "./SharedSit";
import PullACard from "@/components/sessionCard/PullACard";
import { CARD, H3 } from "./roomUi";
import type { StageProps } from "./roomUi";

export default function StageDropIn({ view, actions, offset }: StageProps & { offset: number }) {
  const placeLine = view.stamp.placeLine?.trim() || SESSION_COPY.placeLineFallback;
  return (
    <div className="space-y-5">
      <figure className="px-1 py-4 sm:px-4">
        <blockquote className="mx-auto max-w-3xl border-l-2 border-notice pl-4 font-display text-2xl leading-snug text-foreground sm:text-3xl">
          {placeLine}
        </blockquote>
      </figure>
      <div className={CARD}>
        <SharedBreath breath={view.state.breath} offset={offset} facilitates={view.me.facilitates} actions={actions} />
      </div>
      <div className={CARD}>
        <SharedSit sit={view.state.sit} offset={offset} facilitates={view.me.facilitates} actions={actions} />
      </div>
      <PullACard view={view} actions={actions} className={CARD} />
      <section className={CARD} aria-labelledby="dropin-who">
        <h3 id="dropin-who" className={`${H3} mb-3`}>
          {ROOM_COPY.whoIsHere}
        </h3>
        <PeopleHere view={view} />
      </section>
    </div>
  );
}
