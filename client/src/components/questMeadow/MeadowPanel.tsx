/**
 * THE MEADOW'S PANEL: the one plant you chose, read beside the field.
 *
 * On a desktop it stays beside the meadow while the arrow keys walk it; on a
 * phone it sits right under the band, so a tap on a plant lands its words
 * within the thumb's reach. It opens on the quest the meadow leads with
 * (`leadQuestFor`): one that carries your roots when there is one, else the
 * gentlest open quest.
 *
 * Fireflies gather on the panel's act only while it shows that lead, so the
 * light on the page means "this one waits on you" and nothing else
 * (docs/DESIGN_RULE.md, the drawings). Choosing another plant lets them go.
 */
import { Link } from "wouter";
import { ArrowRight, Sprout } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, CARD_FEATURED, EYEBROW, HINT } from "@/components/journey/look";
import { Fireflies } from "@/components/journey/nature";
import WorkPayBlock from "@/components/WorkPayBlock";
import { gateLabel, type BoardQuest } from "@/lib/questBoard";
import type { PlantState } from "@/lib/questMeadow";
import { PlantGlyph } from "./Plant";
import { usePlantWords } from "./plantWords";

export interface MeadowPanelProps {
  quest: BoardQuest;
  state: PlantState;
  /** This is the quest the meadow leads with. */
  lead: boolean;
  /** The lead carries one of the reader's roots. */
  fits: boolean;
  stages?: { id: string; name: string }[] | null;
  /** A line under the act, for the lead only (the member's own type line). */
  footer?: React.ReactNode;
  className?: string;
}

export default function MeadowPanel({ quest, state, lead, fits, stages, footer, className = "" }: MeadowPanelProps) {
  const { t } = useLingui();
  const words = usePlantWords();
  const gate = gateLabel(quest, stages);
  const circle = quest.circle?.trim() || "";
  const eyebrow = lead
    ? fits
      ? t({ message: "One that fits your roots", context: "quest meadow panel: the lead quest carries the member's roots" })
      : t({ message: "A good place to begin", context: "quest meadow panel: the gentlest open quest" })
    : circle || t({ message: "Open to every circle", context: "quest meadow: the bed for quests with no circle" });
  const about = quest.subtitle?.trim() || quest.description?.trim() || "";
  const act = (
    <Link href={`/quests/${quest.id}`} className={`${lead ? BTN_PRIMARY : BTN_SECONDARY} w-full`}>
      {t({ message: "Open this quest", context: "quest meadow panel: the one act" })}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );

  return (
    <section
      aria-label={t({ message: "The quest you chose", context: "quest meadow panel" })}
      data-meadow-panel={quest.id}
      className={`${lead ? CARD_FEATURED : CARD} ${className}`.trim()}
    >
      <p className={EYEBROW}>{eyebrow}</p>
      <div className="mt-3 flex items-start gap-4">
        <PlantGlyph state={state} className="size-14 sm:size-16" />
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold leading-snug text-card-foreground sm:text-2xl">{quest.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {words[state].long}
            {lead && circle ? ` · ${circle}` : ""}
          </p>
        </div>
      </div>
      {about && <p className="mt-4 text-sm leading-relaxed text-foreground/90 line-clamp-4">{about}</p>}
      {quest.pay && (
        <div className="mt-3 text-xs">
          <WorkPayBlock pay={quest.pay} />
        </div>
      )}
      {gate && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-notice">
          <Sprout className="size-3.5" aria-hidden="true" />
          {gate}
        </p>
      )}
      <div className="mt-5">{lead ? <Fireflies block count={6}>{act}</Fireflies> : act}</div>
      {lead && footer}
      <p className={`${HINT} mt-3 hidden lg:block`}>
        {t({ message: "Arrow keys walk the meadow. Enter opens a quest.", context: "quest meadow panel: desktop keyboard hint" })}
      </p>
    </section>
  );
}
