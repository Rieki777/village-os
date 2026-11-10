import Layout from "@/components/Layout";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, LINK, RING, WORLD } from "@/components/journey/look";
import { useVillageLinks } from "@/lib/gameApi";
import { altOr, useBrandImages, useGameConfig } from "@/lib/gameApi";
import FaqSection from "@/components/FaqSection";
import { Emphasized, Highlighted } from "@/components/PageText";
import { JourneyLink, leavesSite } from "@/components/journey/JourneyLink";
import { useJourneyContent } from "@/hooks/useJourneyContent";
import { buttonAction, stepPoints, type TargetContext } from "@/lib/journeyPage";
import { STEWARD_JOURNEY, STEWARD_STAGE_CIRCLE, STEWARD_STAGE_YOURS } from "@shared/pageContent/journeys";
import { useIsAdmin } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { Trans } from "@lingui/react/macro";
import type { ResolvedSection } from "@shared/pageContent/types";
import { m } from "framer-motion";
import { Users, ArrowRight, Compass, Heart, Moon, ExternalLink, ShieldCheck } from "lucide-react";

/*
 * EVERY WORD ON THIS PAGE IS THE VILLAGE'S OWN, from Admin, Pages, Steward
 * journey (shared/pageContent/journeys.ts). What stays here is the look: the
 * layout and the doors, which go to fixed places in the app.
 */

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
  const adminPath = useGameConfig()?.project?.adminPath || "/admin";
  // Until the saved words arrive the hero keeps its space and stays
  // invisible, so a visitor never reads the defaults and watches them change.
  const waiting = hero ? "" : " invisible";

  return (
    <Layout>
      {/* The sheet's world (docs/DESIGN_RULE.md): the steward's door is the start of the joining journey. */}
      <div className={WORLD}>
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
              {/* A gold ring, the way the sheet carries its icons. It used to rock forever beside the text. */}
              <span className={`${RING} size-12`} aria-hidden="true">
                <Users className="w-6 h-6" />
              </span>
              <span className={`${EYEBROW} text-sm min-w-0 break-words${waiting}`}>{hero?.eyebrow || " "}</span>
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
                render={(phrase) => <span className="text-notice italic">{phrase}</span>}
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
                <JourneyLink action={heroPrimary.action} className={BTN_PRIMARY}>
                  {heroPrimary.label}
                  <ArrowRight className="w-5 h-5" />
                </JourneyLink>
              )}
              {heroSecondary && (
                <JourneyLink
                  action={heroSecondary.action}
                  className={`${BTN_SECONDARY} bg-card`}
                >
                  {heroSecondary.label}
                </JourneyLink>
              )}
            </m.div>
          </div>
        </div>
      </section>

      {/* Meet us first: an invitation, never a requirement. */}
      {page && !page.meetFirst.hidden && (
        <section className="py-12 bg-card border-y border-border/60">
          <div className="container">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground mb-3 break-words">
                {page.meetFirst.fields.heading}
              </h2>
              <p className="text-muted-foreground mb-6">
                <Emphasized text={page.meetFirst.fields.body} />
              </p>
              <BandButton section={page.meetFirst} targets={targets} />
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
            <Door href="/roles" icon={<Compass className="w-5 h-5" />} title={<Trans>New here and ready for a role</Trans>} action={<Trans context="steward front door">Find your role</Trans>}>
              <Trans>Start with the open roles and what each one asks of you.</Trans>
            </Door>
            <Door href="/role-proposals/new" icon={<Users className="w-5 h-5" />} title={<Trans context="steward front door">Already a member</Trans>} action={<Trans context="steward front door">Propose a role</Trans>}>
              <Trans>You have an account here. Go straight to proposing yourself for a role.</Trans>
            </Door>
            <Door
              href="/quests"
              secondHref="/map"
              icon={<Heart className="w-5 h-5" />}
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
                icon={<ShieldCheck className="w-5 h-5" />}
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
        <section className="py-16 bg-card border-y border-border/60">
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
                  <li key={`${index}-${step.title}`} className="bg-muted border border-border rounded-xl p-5 flex items-start gap-4 min-w-0">
                    <span className={`${RING} font-display text-lg`} aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                        <h3 className="font-display text-lg font-semibold text-foreground basis-24 grow max-w-full break-words">{step.title}</h3>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            circle ? "border border-notice/60 text-notice" : step.stage === STEWARD_STAGE_YOURS ? "border border-open/60 text-open" : "border border-border text-muted-foreground"
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
                        <JourneyLink action={action.action} className={`inline-flex min-h-11 items-center gap-2 mt-1 text-sm ${LINK}`}>
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
      <section className="py-16 bg-card border-y border-border/60">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <Moon className="w-10 h-10 text-notice mx-auto mb-4" aria-hidden="true" />
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
                <Link href="/exit-policy" className={`text-sm ${LINK}`}>
                  <Trans>How leaving a role works</Trans>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {page && <FaqSection pathway="steward" heading={page.faq.fields.heading} />}
      </div>
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
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm min-w-0 flex flex-col">
      <div className="flex items-center gap-3 mb-2">
        <span className={RING} aria-hidden="true">{icon}</span>
        <h3 className="font-display text-xl font-semibold text-foreground break-words min-w-0">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4 break-words">{children}</p>
      <div className="mt-auto flex flex-wrap gap-3">
        <Link href={href} className={`${BTN_PRIMARY} text-sm`}>
          {action}
          <ArrowRight className="w-4 h-4" />
        </Link>
        {secondHref && (
          <Link href={secondHref} className={BTN_SECONDARY}>
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
    <JourneyLink action={cta.action} className={BTN_PRIMARY}>
      {cta.label}
      <ArrowRight className="w-5 h-5" />
    </JourneyLink>
  );
}
