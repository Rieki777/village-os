/**
 * THE FIRST STEPS, shared by the steward and resident pages (build list 8.2
 * and 8.6): the same entry steps, written once in Admin, Pages, Steward
 * journey ("First steps (both paths)"), and ticked off in the visitor's own
 * browser under one key, so a tick on one page shows on the other.
 *
 * They never lock anything. On the steward page the exceptions line sits
 * beside them, because there they stand in front of a role application.
 *
 * Phone and desktop. On a phone the steps are one column and the Seed of Life
 * sits small in the heading, one thing at a time. From `lg` the steps sit
 * beside a panel that stays (sticky): the seed grown one circle per step
 * ticked, and the exceptions line, so the path stays beside the step.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { AnimatePresence, m } from "framer-motion";
import { ArrowRight, CheckCircle2, ChevronDown, Circle, ExternalLink } from "lucide-react";
import { EYEBROW, BTN_PRIMARY, BTN_NOTICE, CARD, HINT, LEDE, RING, TILE } from "@/components/journey/look";
import { SeedOfLife } from "@/components/journey/nature";
import { Emphasized } from "@/components/PageText";
import { JourneyLink, leavesSite } from "@/components/journey/JourneyLink";
import { useJourneyProgress } from "@/hooks/useJourneyContent";
import { buttonAction, stepPoints, type TargetContext } from "@/lib/journeyPage";
import type { ResolvedSection } from "@shared/pageContent/types";

/** Where both pages keep the visitor's ticks. The steward page has used this key since 2026-10-22. */
export const FIRST_STEPS_KEY = "steward-getting-to-know";

/** The most circles the Seed of Life and Flower of Life lattice draws. */
const MOST_CIRCLES = 19;

export interface FirstStepsProps {
  /** The `getToKnow` section of the steward page. */
  section: ResolvedSection;
  /** The heading and paragraph this page puts over the steps (the resident page writes its own). */
  heading: string;
  body: string;
  targets: TargetContext;
  /** The steward page shows the exceptions line; the resident page does not. */
  showExceptions: boolean;
  /** `founding` is the quieter register: no fill on the act, more space. `game` is the playful one. */
  register: "founding" | "game";
  /** The anchor the hero's button jumps to. */
  id?: string;
}

export default function FirstSteps({ section, heading, body, targets, showExceptions, register, id = "first-steps" }: FirstStepsProps) {
  const items = section.lists.items ?? [];
  const { t } = useLingui();
  const progress = useJourneyProgress(FIRST_STEPS_KEY, items, []);
  const [open, setOpen] = useState<number | null>(0);
  const exceptions = showExceptions ? section.fields.exceptions?.trim() ?? "" : "";
  const shown = Math.min(Math.max(items.length, 1), MOST_CIRCLES);
  const doneCount = progress.doneCount;
  const stepCount = items.length;
  const seedLabel = t({ message: `${doneCount} of ${stepCount}`, context: "first steps ticked off" });
  const founding = register === "founding";

  return (
    <section id={id} className="scroll-mt-20 py-16 sm:py-20" aria-labelledby={`${id}-heading`}>
      <div className="container">
        <div className={`mx-auto max-w-6xl lg:grid lg:gap-12 ${exceptions || founding ? "lg:grid-cols-[minmax(0,1fr)_20rem]" : "lg:grid-cols-[minmax(0,1fr)_16rem]"}`}>
          <div className="min-w-0">
            <div className="mb-8 flex items-start gap-4">
              {/* On a phone the seed sits in the heading; a desktop gives it the panel beside the steps. */}
              <SeedOfLife total={shown} walked={Math.min(progress.doneCount, shown)} label={seedLabel} size="sm" className="mt-1 lg:hidden" />
              <div className="min-w-0">
                <h2 id={`${id}-heading`} className={`font-display font-semibold text-foreground break-words ${founding ? "text-3xl sm:text-4xl" : "text-3xl"}`}>
                  {heading}
                </h2>
                <p className={`${LEDE} mt-3`}>
                  <Emphasized text={body} />
                </p>
              </div>
            </div>
            <ol className="space-y-3">
              {items.map((step, index) => {
                const done = progress.isDone(step);
                const title = step.title;
                const expanded = open === index;
                const action = buttonAction(step.actionLabel, step.actionTarget, targets);
                const points = stepPoints(step);
                const hasMore = points.length > 0 || !!action;
                return (
                  <li key={`${index}-${step.title}`} className={`rounded-xl border bg-card shadow-sm transition-colors ${done ? "border-open/60" : "border-border hover:border-notice/60"}`}>
                    <div className="flex items-start gap-4 p-5">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        aria-label={done ? t`${title}: mark as not done` : t`${title}: mark as done`}
                        onClick={() => progress.toggle(step)}
                        className="-m-2.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {done ? <CheckCircle2 className="h-6 w-6 text-open" /> : <Circle className="h-6 w-6 text-muted-foreground transition-colors hover:text-notice" />}
                      </button>
                      <span className={`${RING} font-display text-lg`} aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        {(() => {
                          const title = (
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              {step.stage && <span className={EYEBROW}>{step.stage}</span>}
                              <span className={`font-display text-lg font-semibold break-words ${done ? "text-muted-foreground" : "text-foreground"}`}>{step.title}</span>
                              {step.mark && <span className="rounded-full border border-notice/60 px-2 py-0.5 text-xs font-medium text-notice">{step.mark}</span>}
                            </span>
                          );
                          // Only a step with more to show is a button; a plain one is a heading, never a dead button.
                          if (!hasMore) return <h3 className="flex min-h-11 items-start">{title}</h3>;
                          return (
                            <h3>
                              <button
                                type="button"
                                aria-expanded={expanded}
                                onClick={() => setOpen(expanded ? null : index)}
                                className="flex min-h-11 w-full items-start justify-between gap-2 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {title}
                                <m.span className="mt-1 shrink-0" animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                  <ChevronDown className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                                </m.span>
                              </button>
                            </h3>
                          );
                        })()}
                        <p className="mt-1 break-words text-sm text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    <AnimatePresence initial={false}>
                      {expanded && hasMore && (
                        <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                          <div className="px-5 pb-5 sm:ml-24">
                            {points.length > 0 && (
                              <ul className={`${TILE} mb-4 grid gap-2 sm:grid-cols-2`}>
                                {points.map((point, i) => (
                                  <li key={i} className="flex min-w-0 items-center gap-2 break-words text-sm text-muted-foreground">
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-open" aria-hidden="true" />
                                    <span className="min-w-0 break-words">{point}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {action && (
                              <JourneyLink action={action.action} className={`${founding ? BTN_NOTICE : BTN_PRIMARY} text-sm`}>
                                {action.label}
                                {leavesSite(action.action) ? <ExternalLink className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                              </JourneyLink>
                            )}
                          </div>
                        </m.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ol>
            {exceptions && (
              <p className={`${HINT} mt-6 rounded-xl border border-border/60 px-4 py-3 lg:hidden`} data-testid="first-steps-exceptions">
                <Emphasized text={exceptions} />
              </p>
            )}
          </div>
          {/* A desktop keeps the path beside the steps: the seed as they are walked, and the exceptions line. */}
          <aside className="hidden lg:block" aria-label={heading}>
            <div className={`${CARD} sticky top-24 flex flex-col items-center gap-5 text-center`}>
              <SeedOfLife total={shown} walked={Math.min(progress.doneCount, shown)} label={seedLabel} size="lg" />
              <p className={EYEBROW}>{seedLabel}</p>
              {exceptions && (
                <p className={`${HINT} border-t border-notice/30 pt-4 text-left`}>
                  <Emphasized text={exceptions} />
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
