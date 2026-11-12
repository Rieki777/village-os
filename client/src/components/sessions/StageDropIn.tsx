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
 *
 * THE GATHERING (Phase C). The breath sits inside a Flower of Life and each
 * person here lights one of its circles (SharedBreath, GatheringFlower). On a
 * phone it is one thing at a time: the flower full width, then who is here,
 * then the quiet sit. On a desktop the flower takes the wide field on the
 * left and who is here and the sit stay beside it, so the circle is seen
 * whole while it breathes.
 */
import { ROOM_COPY, SESSION_COPY } from "@shared/sessions";
import PeopleHere from "./PeopleHere";
import SharedBreath from "./SharedBreath";
import SharedSit from "./SharedSit";
import PullACard from "@/components/sessionCard/PullACard";
import { CARD, H3, presentPeople } from "./roomUi";
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
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        <div className={CARD}>
          <SharedBreath breath={view.state.breath} offset={offset} facilitates={view.me.facilitates} actions={actions} here={presentPeople(view).length} />
        </div>
        <div className="space-y-5">
          <section className={CARD} aria-labelledby="dropin-who">
            <h3 id="dropin-who" className={`${H3} mb-3`}>
              {ROOM_COPY.whoIsHere}
            </h3>
            <PeopleHere view={view} />
          </section>
          <div className={CARD}>
            <SharedSit sit={view.state.sit} offset={offset} facilitates={view.me.facilitates} actions={actions} />
          </div>
        </div>
      </div>
      <PullACard view={view} actions={actions} className={CARD} />
    </div>
  );
}
