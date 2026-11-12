/**
 * "FITS YOU": the one card the open work board leads with (decision 5).
 *
 * Chosen by `leadQuestFor`: a quest that carries your roots, then one that
 * grows a season goal still in need, then the gentlest. It says why in one
 * line and has one act, "Take this on", which opens the quest's own page
 * where the taking happens (its safety and age checks live there). The
 * fireflies sit on that act and nowhere else on the page: something here
 * waits on you.
 */
import { Link } from "wouter";
import { ArrowRight, Clock, MapPin, Target } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { BTN_PRIMARY, CARD_FEATURED, EYEBROW } from "@/components/journey/look";
import { Fireflies } from "@/components/journey/nature";
import WorkPayBlock from "@/components/WorkPayBlock";
import type { QuestSuggestion } from "@/lib/questBoard";
import type { QuestStatus } from "@/lib/questStatus";
import { PlantGlyph } from "./StatusMark";
import { useStatusWords } from "./statusWords";
import { usePlaceWords } from "./placeWords";

export interface FitsYouCardProps {
  lead: QuestSuggestion;
  status: QuestStatus;
  /** The goal the quest grows, when the season holds it. */
  goal: { id: string; text: string } | null;
  /** A line under the act (the member's own type line). */
  footer?: React.ReactNode;
  /** Signed in: the card is chosen for this person. A visitor gets a plain "start here". */
  forYou?: boolean;
}

export default function FitsYouCard({ lead, status, goal, footer, forYou = true }: FitsYouCardProps) {
  const { t } = useLingui();
  const statusWords = useStatusWords();
  const placeWords = usePlaceWords();
  const q = lead.quest;
  const goalText = goal?.text ?? "";
  const why = lead.fits
    ? t({ message: "It grows from your roots.", context: "open work: why the lead quest was chosen" })
    : lead.needed && goal
      ? t({ message: `It grows ${goalText}, and that goal needs hands this season.`, context: "open work: why the lead quest was chosen" })
      : t({ message: "A gentle place to begin.", context: "open work: why the lead quest was chosen" });
  const about = q.subtitle?.trim() || q.description?.trim() || "";

  return (
    <section className={CARD_FEATURED} aria-labelledby="lead-quest-title" data-lead-quest={q.id}>
      <p className={EYEBROW}>
        {forYou
          ? t({ message: "Fits you", context: "open work: the one card chosen for the reader" })
          : t({ message: "A good place to start", context: "open work: the lead card for a visitor" })}
        {q.circle ? ` · ${q.circle}` : ""}
      </p>
      <div className="mt-2 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h2 id="lead-quest-title" className="font-display text-2xl font-bold leading-snug text-card-foreground sm:text-3xl">
            {q.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {why}
          </p>
          {about && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/90 line-clamp-3">{about}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {goal && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <Target className="size-3.5 text-open" aria-hidden="true" />
                {t({ message: `Grows: ${goalText}`, context: "open work card: the season goal this quest grows" })}
              </span>
            )}
            {q.duration && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden="true" />
                {q.duration}
              </span>
            )}
            {q.place && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                {placeWords[q.place]}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5" data-status={status}>
              <PlantGlyph state={status} className="size-5" />
              {statusWords[status]}
            </span>
          </div>
          {q.pay && (
            <div className="mt-3 text-xs">
              <WorkPayBlock pay={q.pay} />
            </div>
          )}
        </div>
        <div className="lg:w-64">
          <Fireflies block count={6}>
            <Link href={`/quests/${q.id}`} className={`${BTN_PRIMARY} w-full`}>
              {t({ message: "Take this on", context: "open work: the one act on the lead card" })}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Fireflies>
        </div>
      </div>
      {footer}
    </section>
  );
}
