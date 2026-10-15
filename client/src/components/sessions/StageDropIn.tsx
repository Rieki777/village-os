/**
 * DROP IN. The place line read out loud, a breath taken together, and a look
 * at who is here. Nothing is asked of anybody yet.
 *
 * Each thing is said once: the moon and the season sit in the room's header,
 * so this stage leaves them out, and the people are listed here in full while
 * the header leaves them out on this stage.
 */
import { ROOM_COPY, SESSION_COPY } from "@shared/sessions";
import PeopleHere from "./PeopleHere";
import SharedBreath from "./SharedBreath";
import { CARD, H3 } from "./roomUi";
import type { StageProps } from "./roomUi";

export default function StageDropIn({ view, actions, offset }: StageProps & { offset: number }) {
  const placeLine = view.stamp.placeLine?.trim() || SESSION_COPY.placeLineFallback;
  return (
    <div className="space-y-5">
      <figure className="rounded-2xl bg-gradient-to-b from-teal-deep/10 to-transparent px-6 py-8 text-center">
        <blockquote className="mx-auto max-w-2xl font-display text-xl leading-relaxed text-foreground sm:text-2xl">
          {placeLine}
        </blockquote>
      </figure>
      <div className={CARD}>
        <SharedBreath breath={view.state.breath} offset={offset} facilitates={view.me.facilitates} actions={actions} />
      </div>
      <section className={CARD} aria-labelledby="dropin-who">
        <h3 id="dropin-who" className={`${H3} mb-3`}>
          {ROOM_COPY.whoIsHere}
        </h3>
        <PeopleHere view={view} />
      </section>
    </div>
  );
}
