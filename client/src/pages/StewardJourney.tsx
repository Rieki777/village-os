import Layout from "@/components/Layout";
import { useVillageLinks } from "@/lib/gameApi";
import { altOr, useBrandImages, useGameConfig } from "@/lib/gameApi";
import FaqSection from "@/components/FaqSection";
import { Emphasized, Highlighted } from "@/components/PageText";
import { JourneyLink, leavesSite } from "@/components/journey/JourneyLink";
import { useJourneyContent, useJourneyProgress } from "@/hooks/useJourneyContent";
import { buttonAction, stepPoints, type TargetContext } from "@/lib/journeyPage";
import { STEWARD_JOURNEY, STEWARD_STAGE_CIRCLE, STEWARD_STAGE_YOURS } from "@shared/pageContent/journeys";
import { useIsAdmin } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { Trans } from "@lingui/react/macro";
import type { ResolvedSection } from "@shared/pageContent/types";
import { m } from "framer-motion";
import { Users, ArrowRight, Calendar, BookOpen, CheckCircle2, Circle, ChevronDown, Compass, Heart, Moon, ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AnimatePresence } from "framer-motion";

/*
 * EVERY WORD ON THIS PAGE IS THE VILLAGE'S OWN, from Admin, Pages, Steward
 * journey (shared/pageContent/journeys.ts). What stays here is the look: the
 * layout and the doors, which go to fixed places in the app.
 */

/** Icons for the "Getting to know us" cards, in order. */
const KNOW_ICONS = [Calendar, Users, Users, BookOpen];

export default function StewardJourney() {
  // This village's own destinations. Blank hides the control.
  const { eventsUrl, mailTo } = useVillageLinks();
  const page = useJourneyContent(STEWARD_JOURNEY);
  const hero = page?.hero.fields;
  const steps = page?.steps.lists.items ?? null;
  const targets: TargetContext = { eventsUrl, mailTo, subject: "" };
  const heroPrimary = buttonAction(hero?.primaryLabel, hero?.primaryTarget, targets);
  const heroSecondary = buttonAction(hero?.secondaryLabel, hero?.secondaryTarget, targets);
  const brand = useBrandImages();
  const admin = useIsAdmin();
  const knowCards = page?.getToKnow.lists.items ?? null;
  const progress = useJourneyProgress("steward-getting-to-know", knowCards, []);
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const adminPath = useGameConfig()?.project?.adminPath || "/admin";
  // Until the saved words arrive the hero keeps its space and stays
  // invisible, so a visitor never reads the defaults and watches them change.
  const waiting = hero ? "" : " invisible";

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 z-0">
          {/* THE HERO RENDERS ONLY WHEN THERE IS ONE.
              This was a bare <img> whose src came from the brand overlay with a
              hardcoded fallback behind it, so it always had a URL. The fallback
              pointed at one village's WordPress site and every one of those URLs
              now 404s, which is why the live page renders a torn image. With the
              fallback gone the src would simply be empty, and an <img src=""> is
              a broken image too. No picture is the honest state, and the gradient
              below carries the section on its own. */}
          {brand.stewardHero ? (
            <m.img
              src={brand.stewardHero}
              alt={altOr(brand.stewardHeroAlt, "Stewards meeting in a circle")}
              className="w-full h-full object-cover"
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 1.5 }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/60" />
        </div>

        <div className="container relative z-10">
          <div className="max-w-2xl">
            <m.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 mb-6"
            >
              <m.div
                className="w-12 h-12 shrink-0 rounded-xl bg-sage flex items-center justify-center"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Users className="w-6 h-6 text-white" />
              </m.div>
              <span className={`text-sage font-medium tracking-wide uppercase text-sm min-w-0 break-words${waiting}`}>{hero?.eyebrow || " "}</span>
            </m.div>

            <m.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`font-display text-5xl md:text-6xl font-semibold text-foreground mb-6 break-words${waiting}`}
            >
              <Highlighted
                text={hero?.headline || " "}
                phrase={hero?.highlight ?? ""}
                render={(phrase) => <span className="text-sage italic">{phrase}</span>}
              />
            </m.h1>

            <m.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`text-xl text-muted-foreground leading-relaxed mb-8 break-words${waiting}`}
            >
              <Emphasized text={hero?.intro ?? ""} />
            </m.p>

            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap gap-4"
            >
              {heroPrimary && (
                <JourneyLink action={heroPrimary.action} className="btn-village flex items-center gap-2">
                  {heroPrimary.label}
                  <ArrowRight className="w-5 h-5" />
                </JourneyLink>
              )}
              {heroSecondary && (
                <JourneyLink
                  action={heroSecondary.action}
                  className="px-6 py-3 bg-white/90 text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white transition-all"
                >
                  {heroSecondary.label}
                </JourneyLink>
              )}
            </m.div>
          </div>
        </div>
      </section>

      {/* Getting to know us: optional first steps, none required before a proposal. */}
      {page && !page.getToKnow.hidden && (
        <section className="py-16 bg-sage/10">
          <div className="container">
            <div className="text-center mb-8">
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
                {page.getToKnow.fields.heading}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                <Emphasized text={page.getToKnow.fields.body} />
              </p>
            </div>
            <div className="max-w-3xl mx-auto space-y-3">
              {page.getToKnow.lists.items.map((step, index) => {
                const isCompleted = progress.isDone(step);
                const isExpanded = expandedStep === index;
                const StepIcon = KNOW_ICONS[index % KNOW_ICONS.length];
                const action = buttonAction(step.actionLabel, step.actionTarget, targets);
                const points = stepPoints(step);
                const hasMore = points.length > 0 || !!action;
                return (
                  <div
                    key={`${index}-${step.title}`}
                    className={`bg-card rounded-xl shadow-sm overflow-hidden transition-all ${
                      isCompleted ? "border-l-4 border-sage" : "border-l-4 border-transparent hover:border-coral/50"
                    }`}
                  >
                    <div className={`p-5 ${hasMore ? "cursor-pointer" : ""}`} onClick={() => hasMore && setExpandedStep(isExpanded ? null : index)}>
                      <div className="flex items-start gap-4">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isCompleted}
                          aria-label={`${step.title}: mark as ${isCompleted ? "not done" : "done"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            progress.toggle(step);
                          }}
                          className="flex-shrink-0 mt-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-sage"
                        >
                          {isCompleted ? <CheckCircle2 className="w-6 h-6 text-sage" /> : <Circle className="w-6 h-6 text-muted-foreground hover:text-teal-deep transition-colors" />}
                        </button>
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isCompleted ? "bg-sage/10" : "bg-teal-deep/10"}`}>
                          <StepIcon className={`w-5 h-5 ${isCompleted ? "text-sage" : "text-teal-deep"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${isCompleted ? "bg-sage/10 text-sage" : "bg-muted text-muted-foreground"}`}>{step.stage}</span>
                              <h3 className={`font-display text-lg font-semibold basis-24 grow max-w-full break-words ${isCompleted ? "text-muted-foreground" : "text-foreground"}`}>{step.title}</h3>
                              {step.mark && <span className="px-2 py-0.5 text-xs font-medium rounded border border-sage text-foreground">{step.mark}</span>}
                            </div>
                            {hasMore && (
                              <m.div className="shrink-0" animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                <ChevronDown className="w-5 h-5 text-muted-foreground" />
                              </m.div>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 break-words">{step.description}</p>
                        </div>
                      </div>
                    </div>
                    <AnimatePresence>
                      {isExpanded && hasMore && (
                        <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                          <div className="px-5 pb-5 pt-0 ml-14">
                            {points.length > 0 && (
                              <div className="bg-muted/50 rounded-lg p-4 mb-4">
                                <ul className="grid sm:grid-cols-2 gap-2">
                                  {points.map((detail, i) => (
                                    <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 break-words">
                                      <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-sage" />
                                      <span className="min-w-0 break-words">{detail}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {action && (
                              <JourneyLink action={action.action} className="inline-flex items-center gap-2 px-4 py-2 bg-sage text-white rounded-full text-sm font-medium hover:opacity-90 transition-opacity">
                                {action.label}
                                {leavesSite(action.action) ? <ExternalLink className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                              </JourneyLink>
                            )}
                          </div>
                        </m.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Four doors */}
      <section className="py-16 bg-background" aria-labelledby="steward-doors">
        <div className="container">
          <h2 id="steward-doors" className="font-display text-3xl md:text-4xl font-semibold text-foreground text-center mb-8 break-words">
            <Trans>Which door is yours?</Trans>
          </h2>
          <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
            <Door href="/roles" icon={<Compass className="w-5 h-5 text-sage" />} title={<Trans>New here and ready for a role</Trans>} action={<Trans context="steward front door">Find your role</Trans>}>
              <Trans>Start with the open roles and what each one asks of you.</Trans>
            </Door>
            <Door href="/role-proposals/new" icon={<Users className="w-5 h-5 text-sage" />} title={<Trans context="steward front door">Already a member</Trans>} action={<Trans context="steward front door">Propose a role</Trans>}>
              <Trans>You have an account here. Go straight to proposing yourself for a role.</Trans>
            </Door>
            <Door
              href="/quests"
              secondHref="/map"
              icon={<Heart className="w-5 h-5 text-sage" />}
              title={<Trans>Not ready for a role yet</Trans>}
              action={<Trans context="steward front door">See the quests</Trans>}
              secondAction={<Trans context="steward front door">Explore the map</Trans>}
            >
              <Trans>Take a quest or look around the land first. A role will still be here when you are ready.</Trans>
            </Door>
            {admin && (
              <Door
                href="/approvals"
                secondHref={adminPath}
                icon={<ShieldCheck className="w-5 h-5 text-sage" />}
                title={<Trans context="steward front door">Stewarding the roles</Trans>}
                action={<Trans>Open the approval inbox</Trans>}
                secondAction={<Trans context="steward front door">Open admin</Trans>}
              >
                <Trans>For stewards and admins: proposals waiting on you, and the tools behind the roles.</Trans>
              </Door>
            )}
          </div>
        </div>
      </section>

      {/* The eleven steps */}
      {page && steps && (
        <section className="py-16 bg-sage/5">
          <div className="container">
            <div className="text-center mb-8">
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
                {page.steps.fields.heading}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                <Emphasized text={page.steps.fields.intro} />
              </p>
            </div>
            <ol className="max-w-3xl mx-auto space-y-3">
              {steps.map((step, index) => {
                const action = buttonAction(step.actionLabel, step.actionTarget, targets);
                const circle = step.stage === STEWARD_STAGE_CIRCLE;
                return (
                  <li key={`${index}-${step.title}`} className="bg-card rounded-xl shadow-sm p-5 flex items-start gap-4 min-w-0">
                    <span className="w-9 h-9 shrink-0 rounded-full bg-teal-deep/10 text-teal-deep font-semibold flex items-center justify-center" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                        <h3 className="font-display text-lg font-semibold text-foreground basis-24 grow max-w-full break-words">{step.title}</h3>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            circle ? "bg-coral/15 text-foreground" : step.stage === STEWARD_STAGE_YOURS ? "bg-sage/15 text-foreground" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {step.stage}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 break-words">{step.description}</p>
                      {stepPoints(step).length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground list-disc pl-5">
                          {stepPoints(step).map((point, i) => (
                            <li key={i} className="break-words">{point}</li>
                          ))}
                        </ul>
                      )}
                      {action && (
                        <JourneyLink action={action.action} className="inline-flex items-center gap-2 mt-3 text-sm font-medium text-teal-deep underline underline-offset-2">
                          {action.label}
                          {leavesSite(action.action) ? <ExternalLink className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                        </JourneyLink>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      )}

      {/* One moon, in brief */}
      <section className="py-16 bg-cream">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <Moon className="w-10 h-10 text-sage mx-auto mb-4" aria-hidden="true" />
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              <Trans context="steward front door">One moon</Trans>
            </h2>
            <p className="text-muted-foreground">
              <Trans>Roles run from new moon to new moon. Each moon you and your circle agree what you will deliver, and we pay for the work delivered, never for hours.</Trans>
            </p>
          </div>
        </div>
      </section>

      {/* Rights & Responsibilities */}
      {page && !page.rights.hidden && (
        <section className="py-16 bg-background">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground mb-3 break-words">
                {page.rights.fields.heading}
              </h2>
              <p className="text-muted-foreground mb-6">
                <Emphasized text={page.rights.fields.body} />
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <BandButton section={page.rights} targets={targets} />
                <Link href="/exit-policy" className="text-sm font-medium text-teal-deep underline underline-offset-2">
                  <Trans>How leaving a role works</Trans>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {page && <FaqSection pathway="steward" heading={page.faq.fields.heading} />}
    </Layout>
  );
}

/** One of the four doors: a title, a line, and one or two links. */
function Door({
  href,
  secondHref,
  icon,
  title,
  action,
  secondAction,
  children,
}: {
  href: string;
  secondHref?: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  action: React.ReactNode;
  secondAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl shadow-sm p-6 min-w-0 flex flex-col">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-10 h-10 shrink-0 rounded-lg bg-sage/10 flex items-center justify-center" aria-hidden="true">{icon}</span>
        <h3 className="font-display text-xl font-semibold text-foreground break-words min-w-0">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4 break-words">{children}</p>
      <div className="mt-auto flex flex-wrap gap-3">
        <Link href={href} className="inline-flex items-center gap-2 px-4 py-2 bg-sage text-white rounded-full text-sm font-medium hover:opacity-90 transition-opacity">
          {action}
          <ArrowRight className="w-4 h-4" />
        </Link>
        {secondHref && (
          <Link href={secondHref} className="inline-flex items-center gap-2 px-4 py-2 border border-sage text-foreground rounded-full text-sm font-medium hover:bg-sage/10 transition-colors">
            {secondAction}
          </Link>
        )}
      </div>
    </div>
  );
}

/** A band's one button, in the page's own style. */
function BandButton({ section, targets }: { section: ResolvedSection; targets: TargetContext }) {
  const cta = buttonAction(section.fields.ctaLabel, section.fields.ctaTarget, targets);
  if (!cta) return null;
  return (
    <JourneyLink action={cta.action} className="btn-village inline-flex items-center gap-2">
      {cta.label}
      <ArrowRight className="w-5 h-5" />
    </JourneyLink>
  );
}
