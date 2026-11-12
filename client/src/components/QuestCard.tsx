/**
 * The quest card: a poster, a promise, and nothing else to operate.
 *
 * Ported lesson from the sibling game's three quest-page redesigns: the card
 * is tier one of a disclosure ladder. It draws the eye and states the offer;
 * reading and doing happen on the quest's own page. So the whole card is one
 * link, there are no buttons on it, and the only numbers it shows are alive
 * (a zero renders as silence, never as "0 in the field").
 *
 * A quest with no poster image paints a scene from its circle via
 * questScene(), so the board is colorful on day one of a fork with zero
 * uploaded art, and re-themes itself when the village picks a brand seed.
 */
import { Link } from "wouter";
import { useState } from "react";
import {
  ArrowRight, Baby, BookOpen, Brush, Calendar, Camera, CheckCircle2, ChefHat,
  Clock, Compass, Hammer, Home, Laptop, Leaf, Music, ShieldCheck,
  Sprout, Star, TreePine, Users,
} from "lucide-react";
import type { QuestClaim } from "@/lib/gameApi";
import WorkPayBlock from "@/components/WorkPayBlock";
import RootTags from "@/components/roots/RootTags";
import {
  gateLabel, questScene, sceneGradient, statusIs, type BoardQuest, type QuestSigns,
} from "@/lib/questBoard";
import { plantFor } from "@/lib/questMeadow";
import { PlantGlyph } from "@/components/questMeadow/Plant";
import { usePlantWords } from "@/components/questMeadow/plantWords";

export const QUEST_ICONS: Record<string, React.ElementType> = {
  Users, Sprout, ChefHat, TreePine, BookOpen, Home, Camera, Baby, Laptop,
  Leaf, Hammer, Brush, Music, ShieldCheck, Star, Calendar, Compass,
};

export const iconFor = (name: string | null | undefined): React.ElementType =>
  QUEST_ICONS[String(name ?? "")] ?? Star;

/*
 * SEMANTIC TOKENS ONLY (night-contrast lane, 2026-11-11). The board stands in
 * the sheet's night world and the quest's own page does not, and these chips
 * are drawn on both. The brand and palette inks they used (`text-sage`,
 * `text-teal-700`, `text-teal-deep`) are dark by design: on the night card the
 * sage chip measured 2.52:1 and "See the quest" 1.58:1. `open`, `notice` and
 * `foreground` re-theme with the ground they land on and clear AA on both.
 */
export const difficultyColors: Record<string, string> = {
  Beginner: "bg-open/10 text-open",
  Intermediate: "bg-notice/10 text-notice",
  Advanced: "border border-border bg-muted text-foreground",
};

const CLAIM_CHIP: Record<string, { label: string; cls: string }> = {
  claimed: { label: "In progress", cls: "bg-notice text-background" },
  submitted: { label: "Turned in", cls: "bg-card text-foreground" },
  consented: { label: "Complete", cls: "bg-open text-background" },
};

export function QuestPoster({
  quest,
  className = "",
  children,
  priority = false,
}: {
  quest: BoardQuest;
  className?: string;
  children?: React.ReactNode;
  /** The one poster above the fold loads eagerly; the rest stay lazy. */
  priority?: boolean;
}) {
  const Icon = iconFor(quest.icon);
  const scene = questScene(quest.circle);
  // Poster art lives in the uploads volume, so a village that cloned a seed
  // without the files, or an admin who mistyped a path, has an image URL that
  // resolves to nothing. Falling back to the circle's scene means that reads
  // as a quest board with no art yet, which is the designed state, instead of
  // a broken image icon.
  const [broken, setBroken] = useState(false);
  const showImage = !!quest.imageUrl && !broken;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {showImage ? (
        <img
          src={quest.imageUrl as string}
          alt=""
          loading={priority ? "eager" : "lazy"}
          onError={() => setBroken(true)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: sceneGradient(scene) }}
        />
      )}
      {!showImage && (
        <Icon
          aria-hidden="true"
          className="absolute -right-5 -bottom-6 w-32 h-32 text-white/15 rotate-6"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
      {children}
    </div>
  );
}

export default function QuestCard({
  quest,
  claim,
  signs,
  stages,
  priority = false,
}: {
  quest: BoardQuest;
  claim?: QuestClaim;
  signs?: QuestSigns;
  stages?: { id: string; name: string }[] | null;
  priority?: boolean;
}) {
  const Icon = iconFor(quest.icon);
  // The quest as a plant in the meadow: seed, bud or flower (lib/questMeadow.ts).
  // It describes the work, from the village's own life signs.
  const plant = plantFor(signs);
  const plantWords = usePlantWords();
  const chip = claim && claim.status !== "declined" ? CLAIM_CHIP[claim.status] : null;
  const gate = gateLabel(quest, stages);
  const active = signs?.active ?? 0;
  const done = signs?.done ?? 0;

  // A gated quest reads differently, so the gate belongs in the link's name: a
  // screen reader user should not have to open the card to learn the quest is
  // not open to them yet.
  const linkLabel = gate ? `${quest.title}, ${gate}` : quest.title;

  return (
    <Link
      href={`/quests/${quest.id}`}
      className="group block h-full focus-visible:outline-2 focus-visible:outline-ring rounded-2xl"
      aria-label={linkLabel}
    >
      <article className="h-full flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden transition-shadow duration-300 group-hover:shadow-lg">
        <QuestPoster quest={quest} className="aspect-[16/9]" priority={priority}>
          <div className="absolute top-3 left-3 w-9 h-9 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="absolute top-3 right-3 flex gap-1.5">
            {statusIs(quest, "seasonal") && !chip && (
              <span className="px-2 py-0.5 rounded-full bg-white/85 text-teal-deep text-[10px] font-bold uppercase tracking-wide">
                Seasonal
              </span>
            )}
            {chip && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${chip.cls}`}>
                {chip.label}
              </span>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <h3 className="font-display text-lg font-bold text-white leading-snug drop-shadow-sm">
              {quest.title}
            </h3>
            {quest.circle && (
              <p className="text-white/80 text-xs mt-0.5">{quest.circle}</p>
            )}
          </div>
        </QuestPoster>

        <div className="p-4 flex-1 flex flex-col gap-2.5">
          {quest.subtitle ? (
            <p className="text-sm text-foreground/80 italic leading-relaxed">{quest.subtitle}</p>
          ) : (
            quest.description && (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                {quest.description}
              </p>
            )
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* What the quest is worth and pays, or to inquire (0265). Never Gratitude, which pays no quest. */}
            <WorkPayBlock pay={quest.pay} />
            {quest.duration && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                {quest.duration}
              </span>
            )}
            {quest.difficulty && (
              <span className={`px-2 py-0.5 rounded-full font-medium ${difficultyColors[quest.difficulty] ?? "bg-muted text-muted-foreground"}`}>
                {quest.difficulty}
              </span>
            )}
          </div>

          {/* The roots it grows from, drawn as small roots (shared/archetypeRoots.ts). */}
          {quest.archetypes?.length ? <RootTags roots={quest.archetypes} size="sm" /> : null}

          {(active > 0 || done > 0) && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {active > 0 && (
                <span className="inline-flex items-center gap-1 font-medium text-open">
                  <Users className="w-3.5 h-3.5" />
                  {active} in the field now
                </span>
              )}
              {done > 0 && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {done} completed
                </span>
              )}
            </div>
          )}

          {gate && (
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-notice">
              <Sprout className="w-3.5 h-3.5" />
              {gate}
            </p>
          )}

          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-plant={plant}>
            <PlantGlyph state={plant} className="size-5" />
            {plantWords[plant].long}
          </p>

          <div className="mt-auto pt-2 flex items-center justify-between text-sm font-semibold text-notice">
            <span>See the quest</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </article>
    </Link>
  );
}
