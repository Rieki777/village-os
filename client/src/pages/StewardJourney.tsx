import Layout from "@/components/Layout";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, DOOR, EYEBROW, HINT, LEDE, LINK, QUIET, RING, TILE, WORLD } from "@/components/journey/look";
import { useVillageLinks } from "@/lib/gameApi";
import { altOr, useBrandImages, useGameConfig } from "@/lib/gameApi";
import FaqSection from "@/components/FaqSection";
import { Emphasized, Highlighted } from "@/components/PageText";
import { JourneyLink, leavesSite } from "@/components/journey/JourneyLink";
import { Fireflies, SeedOfLife } from "@/components/journey/nature";
import FirstSteps from "@/components/tracks/FirstSteps";
import TwoTracks from "@/components/tracks/TwoTracks";
import { useJourneyContent } from "@/hooks/useJourneyContent";
import { buttonAction, stepPoints, type TargetContext } from "@/lib/journeyPage";
import { STEWARD_JOURNEY, STEWARD_STAGE_CIRCLE, STEWARD_STAGE_YOURS } from "@shared/pageContent/journeys";
import { useIsAdmin } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { Trans } from "@lingui/react/macro";
import type { ResolvedSection } from "@shared/pageContent/types";
import { m } from "framer-motion";
import { Users, ArrowRight, ExternalLink, ShieldCheck, Home } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/*
 * EVERY WORD ON THIS PAGE IS THE VILLAGE'S OWN, from Admin, Pages, Steward
 * journey (shared/pageContent/journeys.ts). What stays here is the look: the
 * layout and the doors, which go to fixed places in the app.
 *
 * ONE FLOW (build list section 8, 11 Nov 2026): the first steps everyone
 * takes, the fork into two paths, the role path, and the founding team's
 * invitation as the page's one main act. The page speaks in the founding
 * team's register: quieter, larger display type, gold rules, geometry only as
 * structure, one cluster of fireflies on the one main act, and no game words.
 * The playful register lives on the resident page, and the two never share a
 * screen.
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
  const founding = page && !page.foundingTeam.hidden ? page.foundingTeam : null;
  const foundingAct = founding ? buttonAction(founding.fields.ctaLabel, founding.fields.ctaTarget, targets) : null;
  const brand = useBrandImages();
  const admin = useIsAdmin();
  const adminPath = useGameConfig()?.project?.adminPath || "/admin";
  // Until the saved words arrive the hero keeps its space and stays
  // invisible, so a visitor never reads the defaults and watches them change.
  const waiting = hero ? "" : " invisible";

  const bandRef = useRef<HTMLElement | null>(null);
  const thumbAct = useThumbAct(bandRef, !!foundingAct);

  return (
    <Layout>
      {/* The sheet's world (docs/DESIGN_RULE.md): the steward's door is the start of the joining journey. */}
      <div className={WORLD}>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-24 lg:py-32">
        <div className="absolute inset-0 z-0">
          {/* THE HERO RENDERS ONLY WHEN THERE IS ONE. No picture is the honest
              state, and the gradient below carries the section on its own. */}
          {brand.stewardHero ? (
            <m.img
              src={brand.stewardHero}
              alt={altOr(brand.stewardHeroAlt, "Stewards meeting in a circle")}
              className="w-full h-full object-cover"
              initial={{ scale: 1.05 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.6 }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/60" />
        </div>

        <div className="container relative z-10">
          <div className="max-w-2xl">
            <div className="mb-6 flex items-center gap-3">
              <span className={`${RING} size-12`} aria-hidden="true">
                <Users className="h-6 w-6" />
              </span>
              <span className={`${EYEBROW} text-sm min-w-0 break-words${waiting}`}>{hero?.eyebrow || " "}</span>
            </div>
            <h1 className={`font-display text-5xl md:text-7xl font-semibold leading-tight text-foreground mb-6 break-words${waiting}`}>
              <Highlighted
                text={hero?.headline || " "}
                phrase={hero?.highlight ?? ""}
                render={(phrase) => <span className="text-notice italic">{phrase}</span>}
              />
            </h1>
            <div className="mb-6 h-px w-24 bg-notice/60" aria-hidden="true" />
            <p className={`text-xl text-muted-foreground leading-relaxed mb-8 break-words${waiting}`}>
              <Emphasized text={hero?.intro ?? ""} />
            </p>
            <div className="flex flex-wrap gap-4">
              {heroPrimary && (
                <JourneyLink action={heroPrimary.action} className={BTN_SECONDARY}>
                  {heroPrimary.label}
                  <ArrowRight className="h-5 w-5" />
                </JourneyLink>
              )}
              {heroSecondary && (
                <JourneyLink action={heroSecondary.action} className={`${BTN_SECONDARY} bg-card`}>
                  {heroSecondary.label}
                </JourneyLink>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* A phone keeps the one main act within thumb reach, pinned to the bottom
          from arrival until the invitation itself comes into view. It rides just
          above the app's tab bar (--tabbar-h), and data-bottom-bar lifts the
          shortcuts button over it. A desktop never draws it. */}
      {foundingAct && thumbAct && (
        <div className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-40 border-t border-notice/40 bg-background/95 px-4 py-3 shadow-sm sm:hidden" data-testid="thumb-act" data-bottom-bar="">
          <JourneyLink action={foundingAct.action} className={`${BTN_PRIMARY} w-full`}>
            {foundingAct.label}
            <ArrowRight className="h-5 w-5" />
          </JourneyLink>
        </div>
      )}

      {/* 1. The first steps, shared with the resident page. */}
      {page && !page.getToKnow.hidden && (
        <div className="border-y border-border/60 bg-card/40">
          <FirstSteps
            section={page.getToKnow}
            heading={page.getToKnow.fields.heading}
            body={page.getToKnow.fields.body}
            targets={targets}
            showExceptions
            register="founding"
          />
        </div>
      )}

      {/* 2. The fork: two paths off the same first steps. */}
      {page && <TwoTracks section={page.tracks} here="steward" />}

      {/* 3. The role path, ending with the invitation onto the resident path. */}
      {page && steps && (
        <section id="role-path" className="scroll-mt-20 border-y border-border/60 bg-card/40 py-16 sm:py-20" aria-labelledby="role-path-heading">
          <div className="container">
            <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
              {/* A desktop keeps the heading beside the path as it scrolls. */}
              <div className="mb-8 lg:mb-0">
                <div className="lg:sticky lg:top-24">
                  <div className="mb-4 h-px w-16 bg-notice/60" aria-hidden="true" />
                  <h2 id="role-path-heading" className="font-display text-3xl md:text-4xl font-semibold text-foreground break-words">
                    {page.steps.fields.heading}
                  </h2>
                  <p className={`${LEDE} mt-3`}>
                    <Emphasized text={page.steps.fields.intro} />
                  </p>
                </div>
              </div>
              <div className="min-w-0">
                <ol className="space-y-3">
                  {steps.map((step, index) => {
                    const action = buttonAction(step.actionLabel, step.actionTarget, targets);
                    const circle = step.stage === STEWARD_STAGE_CIRCLE;
                    return (
                      <li key={`${index}-${step.title}`} className="flex min-w-0 items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
                        <span className={`${RING} font-display text-lg`} aria-hidden="true">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <h3 className="font-display text-lg font-semibold text-foreground basis-24 grow max-w-full break-words">{step.title}</h3>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                circle ? "border border-notice/60 text-notice" : step.stage === STEWARD_STAGE_YOURS ? "border border-open/60 text-open" : "border border-border text-muted-foreground"
                              }`}
                            >
                              {step.stage}
                            </span>
                          </div>
                          <p className="mt-1 break-words text-sm text-muted-foreground">{step.description}</p>
                          {stepPoints(step).length > 0 && (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                              {stepPoints(step).map((point, i) => (
                                <li key={i} className="break-words">{point}</li>
                              ))}
                            </ul>
                          )}
                          {action && (
                            <JourneyLink action={action.action} className={`mt-1 inline-flex min-h-11 items-center gap-2 text-sm ${LINK}`}>
                              {action.label}
                              {leavesSite(action.action) ? <ExternalLink className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                            </JourneyLink>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {!page.crossover.hidden && <TrackTile section={page.crossover} targets={targets} />}
                </ol>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 4. The founding team: the page's one main act, in the quieter register. */}
      {founding && (
        <section ref={bandRef} id="founding-team" className="py-20 sm:py-28" aria-labelledby="founding-team-heading">
          <div className="container">
            <div className="mx-auto max-w-5xl border-y border-notice/40 py-12 sm:py-16 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-12">
              <div className="min-w-0">
                <p className={EYEBROW}>{founding.fields.eyebrow}</p>
                <h2 id="founding-team-heading" className="mt-4 font-display text-4xl md:text-6xl font-semibold leading-tight text-foreground break-words">
                  {founding.fields.heading}
                </h2>
                <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                  <Emphasized text={founding.fields.body} />
                </p>
                {foundingAct && (
                  <div className="mt-10">
                    <Fireflies count={6}>
                      <JourneyLink action={foundingAct.action} className={`${BTN_PRIMARY} w-full text-lg sm:w-auto`}>
                        {foundingAct.label}
                        <ArrowRight className="h-5 w-5" />
                      </JourneyLink>
                    </Fireflies>
                  </div>
                )}
              </div>
              {/* Geometry as structure: the seed whole, still, a desktop's larger field. */}
              <SeedOfLife total={7} walked={7} label="" size="lg" className="mx-auto mt-12 hidden opacity-60 md:mt-0 md:block" />
            </div>
          </div>
        </section>
      )}

      {/* 5. Optional extras: quiet rows, none needed to apply. */}
      {page && !page.extras.hidden && page.extras.lists.items.length > 0 && (
        <section className="pb-16" aria-labelledby="extras-heading">
          <div className="container">
            <div className="mx-auto max-w-3xl">
              <h2 id="extras-heading" className="font-display text-2xl md:text-3xl font-semibold text-foreground break-words">
                {page.extras.fields.heading}
              </h2>
              <p className={`${HINT} mt-2`}>
                <Emphasized text={page.extras.fields.body} />
              </p>
              <ul className="mt-6 space-y-3">
                {page.extras.lists.items.map((extra, i) => {
                  const action = buttonAction(extra.actionLabel, extra.actionTarget, targets);
                  return (
                    <li key={`${i}-${extra.title}`} className={`${QUIET} flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground break-words">{extra.title}</h3>
                          {extra.when && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{extra.when}</span>}
                        </div>
                        <p className="mt-1 break-words text-sm text-muted-foreground">{extra.description}</p>
                      </div>
                      {action && (
                        <JourneyLink action={action.action} className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-sm ${LINK}`}>
                          {action.label}
                          {leavesSite(action.action) ? <ExternalLink className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                        </JourneyLink>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Rights & Responsibilities */}
      {page && !page.rights.hidden && (
        <section className="border-t border-border/60 py-16">
          <div className="container">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground mb-3 break-words">
                {page.rights.fields.heading}
              </h2>
              <p className="text-muted-foreground mb-6">
                <Emphasized text={page.rights.fields.body} />
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <BandButton section={page.rights} targets={targets} />
                <Link href="/exit-policy" className={`inline-flex min-h-11 items-center text-sm ${LINK}`}>
                  <Trans>How leaving a role works</Trans>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* For stewards and admins only: a quiet door to the tools behind the roles. */}
      {admin && (
        <section className="pb-16">
          <div className="container">
            <div className={`${CARD} mx-auto max-w-3xl`}>
              <div className="mb-3 flex items-center gap-3">
                <span className={RING} aria-hidden="true"><ShieldCheck className="h-5 w-5" /></span>
                <h2 className="font-display text-xl font-semibold text-foreground break-words"><Trans context="steward front door">Stewarding the roles</Trans></h2>
              </div>
              <p className={`${HINT} mb-4`}><Trans>For stewards and admins: proposals waiting on you, and the tools behind the roles.</Trans></p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href="/approvals" className={DOOR}><Trans>Open the approval inbox</Trans><ArrowRight className="h-4 w-4" /></Link>
                <Link href={adminPath} className={DOOR}><Trans context="steward front door">Open admin</Trans><ArrowRight className="h-4 w-4" /></Link>
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

/** The last step of the role path: the optional invitation onto the resident path, which links across to it. */
function TrackTile({ section, targets }: { section: ResolvedSection; targets: TargetContext }) {
  const cta = buttonAction(section.fields.ctaLabel, section.fields.ctaTarget, targets);
  const mark = section.fields.mark?.trim();
  return (
    <li className={`${TILE} flex min-w-0 items-start gap-4 border-dashed`} data-track-tile="crossover">
      <span className={RING} aria-hidden="true"><Home className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-foreground break-words">{section.fields.title}</h3>
          {mark && <span className="rounded-full border border-notice/60 px-2 py-0.5 text-xs font-medium text-notice">{mark}</span>}
        </div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          <Emphasized text={section.fields.body} />
        </p>
        {cta && (
          <JourneyLink action={cta.action} className={`mt-1 inline-flex min-h-11 items-center gap-2 text-sm ${LINK}`}>
            {cta.label}
            {leavesSite(cta.action) ? <ExternalLink className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
          </JourneyLink>
        )}
      </div>
    </li>
  );
}

/**
 * Whether a phone should show the pinned act: while the founding team band is
 * still ahead, below the screen. Once it is in view, or scrolled past, the bar
 * steps out, so it never sits over the band or the page's end. Without
 * IntersectionObserver it stays hidden, and the band's own button is still there.
 */
function useThumbAct(band: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [ahead, setAhead] = useState(false);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined" || !band.current) return;
    const io = new IntersectionObserver((entries) =>
      entries.forEach((e) => setAhead(!e.isIntersecting && e.boundingClientRect.top > 0)),
    );
    io.observe(band.current);
    // Until the first report, a band below the first screen is ahead.
    setAhead(band.current.getBoundingClientRect().top > (typeof window === "undefined" ? 0 : window.innerHeight));
    return () => io.disconnect();
  }, [enabled, band]);
  return enabled && ahead;
}

/** A band's one button, edged: the founding team's invitation is the page's one gold act. */
function BandButton({ section, targets }: { section: ResolvedSection; targets: TargetContext }) {
  const cta = buttonAction(section.fields.ctaLabel, section.fields.ctaTarget, targets);
  if (!cta) return null;
  return (
    <JourneyLink action={cta.action} className={BTN_SECONDARY}>
      {cta.label}
      <ArrowRight className="h-5 w-5" />
    </JourneyLink>
  );
}
