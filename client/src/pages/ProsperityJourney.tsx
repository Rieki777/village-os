import Layout from "@/components/Layout";
import { altOr, useBrandImages, useVillageLinks } from "@/lib/gameApi";
import FaqSection from "@/components/FaqSection";
import { useVillageName } from "@/hooks/useVillageName";
import { useValueTokenName } from "@/hooks/useTokenNames";
import { Emphasized, Highlighted } from "@/components/PageText";
import { JourneyLink, leavesSite } from "@/components/journey/JourneyLink";
import { useJourneyContent, useJourneyProgress } from "@/hooks/useJourneyContent";
import { buttonAction, stepPoints, type TargetContext } from "@/lib/journeyPage";
import { JOURNEY_LEGACY_STEP_IDS, PROSPERITY_JOURNEY } from "@shared/pageContent/journeys";
import { useGuideName } from "@/hooks/useGuideName";
import { guideNameAtSentenceStart } from "@shared/guideName";
import { useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Circle,
  Calendar,
  Heart,
  FileText,
  PartyPopper,
  Vote,
  Download,
  TrendingUp,
  Zap,
  ChevronDown,
  ExternalLink,
  Users
} from "lucide-react";

/*
 * EVERY WORD ON THIS PAGE IS THE VILLAGE'S OWN, from Admin, Pages, Prosperity
 * journey (shared/pageContent/journeys.ts). What stays here is the look: the
 * icons and tier colours, handed out by position.
 */

/** Icons for the steps, in order; a longer list starts again from the top. */
const STEP_ICONS = [Calendar, Download, FileText, Heart, Vote, PartyPopper, TrendingUp];

/**
 * Tier card colours, lowest first. The first has no tint: bg-gold/10 outranks
 * the card's bg-card by stylesheet order and would freeze this card light
 * under text that themes. Gold heading, 24px: 4.55:1 light, 3.78:1 dark.
 */
const TIER_COLORS = [
  "text-gold border-gold/20",
  "bg-teal-light/10 text-teal-light border-teal-light/20",
  "bg-sage/10 text-sage border-sage/20",
  "bg-coral/10 text-coral border-coral/20",
];

export default function ProsperityJourney() {
  const valueName = useValueTokenName();
  const villageName = useVillageName();
  // The village's own name for its guide, or "The village guide" while it has
  // none. Raised to a capital because the step's words open a sentence with it.
  const guide = useGuideName();
  const page = useJourneyContent(PROSPERITY_JOURNEY, (resolved) => ({
    guide: guideNameAtSentenceStart(guide.name),
    acronym: resolved.tiers.fields.acronym,
    framework: resolved.tiers.fields.framework,
  }));
  const hero = page?.hero.fields;
  const steps = page?.steps.lists.items ?? null;
  const brand = useBrandImages();
  // This village's own destinations. Blank hides the control that would use
  // one: an unconfigured village shows nothing rather than a button that
  // mails a stranger's enquiry to a different village.
  const { eventsUrl, mailTo } = useVillageLinks();
  const targets: TargetContext = { eventsUrl, mailTo, subject: hero?.contactSubject ?? "" };
  const heroPrimary = buttonAction(hero?.primaryLabel, hero?.primaryTarget, targets);
  const heroSecondary = buttonAction(hero?.secondaryLabel, hero?.secondaryTarget, targets);
  const packetCta = buttonAction(page?.packet.fields.ctaLabel, page?.packet.fields.ctaTarget, targets);
  const closingPrimary = buttonAction(page?.closing.fields.primaryLabel, page?.closing.fields.primaryTarget, targets);
  const closingSecondary = buttonAction(page?.closing.fields.secondaryLabel, page?.closing.fields.secondaryTarget, targets);
  const progress = useJourneyProgress("amora-prosperity-progress", steps, JOURNEY_LEGACY_STEP_IDS.prosperity);
  const [expandedStep, setExpandedStep] = useState<number | null>(0);

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
          {brand.prosperityHero ? (
            <m.img
              src={brand.prosperityHero}
              alt={altOr(brand.prosperityHeroAlt, "People at work on a village business")}
              className="w-full h-full object-cover"
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 1.5 }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/60" />
        </div>

        <div className="container relative z-10">
          <div className="relative max-w-2xl">
            {/* THE COPY SITS ON AN OPAQUE BAND, as on Home and Master Plan. A
                photograph under text cannot promise a ratio: at 320 to 768px this
                one showed through under the eyebrow, the heading and the
                paragraph. On the band each is two named colours whatever the
                picture is, and with no picture the band is the colour it sits
                on. heroCopy.contrast.test.tsx */}
            <div
              aria-hidden="true"
              className="absolute -inset-x-5 -inset-y-6 sm:-inset-x-8 sm:-inset-y-10 rounded-3xl bg-background"
            />
            <m.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative flex items-center gap-3 mb-6"
            >
              <m.div
                className="w-12 h-12 shrink-0 rounded-xl bg-gold flex items-center justify-center"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Sparkles className="w-6 h-6 text-white" />
              </m.div>
              {/* amber-ink, index.css's amber for text on light grounds: gold is 4.07:1 on the band. */}
              <span className={`text-amber-ink font-medium tracking-wide uppercase text-sm min-w-0 break-words${waiting}`}>{hero?.eyebrow || " "}</span>
            </m.div>

            {/* 36px under 360px wide: at 48px "Regenerative" is one unbreakable word
                that inked to x=333 at 320px, past the 304px column and the section's
                overflow-hidden edge, so its end was cut off. From 360px up, unchanged.
                break-words is for a village's own longer word at the field's limit. */}
            <m.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`relative font-display text-4xl min-[360px]:text-5xl md:text-6xl font-semibold text-foreground mb-6 break-words${waiting}`}
            >
              <Highlighted
                text={hero?.headline || " "}
                phrase={hero?.highlight ?? ""}
                render={(phrase) => <span className="text-gold italic">{phrase}</span>}
              />
            </m.h1>

            <m.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`relative text-xl text-muted-foreground leading-relaxed mb-8 break-words${waiting}`}
            >
              <Emphasized text={hero?.intro ?? ""} />
            </m.p>

            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="relative flex flex-wrap gap-4"
            >
              {heroPrimary && (
                <JourneyLink action={heroPrimary.action} className="btn-amora flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  {heroPrimary.label}
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

      {/* Shared enterprise & Co-Ownership */}
      {page && !page.economy.hidden && (
      <section className="py-16 bg-gold/5">
        <div className="container">
          <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            <m.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center min-w-0"
            >
              <m.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Heart className="w-12 h-12 text-gold mx-auto mb-4" />
              </m.div>
              <h2 className="font-display text-xl font-semibold text-foreground mb-3 break-words">
                {page.economy.fields.firstHeading}
              </h2>
              <p className="text-muted-foreground text-sm break-words">
                {/* No conversion sentence here (Rye, 2026-10-22: copy never says
                    what a token does; token row 27). */}
                <Emphasized text={page.economy.fields.firstBody} />
              </p>
            </m.div>

            <m.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-center min-w-0"
            >
              <m.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 2, repeat: Infinity, delay: 0.2 }}
              >
                <Users className="w-12 h-12 text-gold mx-auto mb-4" />
              </m.div>
              <h2 className="font-display text-xl font-semibold text-foreground mb-3 break-words">
                {page.economy.fields.secondHeading}
              </h2>
              <p className="text-muted-foreground text-sm break-words">
                <Emphasized text={page.economy.fields.secondBody} />
              </p>
            </m.div>
          </div>
        </div>
      </section>
      )}

      {/* Interactive Journey Steps */}
      {page && steps && (
      <section className="py-20 bg-background">
        <div className="container">
          <m.div
            className="text-center mb-8"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.steps.fields.heading}
            </h2>
            {/* "{count} steps" follows the list; it said "seven" in code. */}
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
              <Emphasized text={page.steps.fields.intro} />
            </p>

            {/* Progress Bar */}
            <div className="max-w-md mx-auto">
              <div className="relative h-3 bg-muted rounded-full overflow-hidden mb-2">
                <m.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-gold to-coral rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress.progress}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {progress.doneCount} of {progress.total} steps completed
              </p>
            </div>
          </m.div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-3">
              {steps.map((step, index) => {
                const isCompleted = progress.isDone(step);
                const isExpanded = expandedStep === index;
                const StepIcon = STEP_ICONS[index % STEP_ICONS.length];
                const action = buttonAction(step.actionLabel, step.actionTarget, targets);

                return (
                  <m.div
                    key={`${index}-${step.title}`}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.05 }}
                    className={`bg-card rounded-xl shadow-sm overflow-hidden transition-all ${
                      isCompleted ? "border-l-4 border-gold" : "border-l-4 border-transparent hover:border-gold/50"
                    }`}
                  >
                    <div
                      className="p-5 cursor-pointer"
                      onClick={() => setExpandedStep(isExpanded ? null : index)}
                    >
                      <div className="flex items-start gap-4">
                        {/*
                          This is a CHECKBOX, not a button: it records whether
                          someone has done this step of their own journey. It
                          shipped as a nameless 24px button with no state
                          exposed, so a screen reader announced "button" and
                          never said which step or whether it was done — on one
                          of the three pages a new member is walked through
                          first. Same fix in ResidentJourney and StewardJourney.
                        */}
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isCompleted}
                          aria-label={`${step.title}: mark as ${isCompleted ? "not done" : "done"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            progress.toggle(step);
                          }}
                          className="flex-shrink-0 mt-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        >
                          <m.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                            {isCompleted ? (
                              <CheckCircle2 className="w-6 h-6 text-gold" />
                            ) : (
                              <Circle className="w-6 h-6 text-muted-foreground hover:text-gold transition-colors" />
                            )}
                          </m.div>
                        </button>

                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isCompleted ? "bg-gold/10" : "bg-gold/5"
                        }`}>
                          <StepIcon className={`w-5 h-5 ${isCompleted ? "text-gold" : "text-gold/60"}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            {/* The title keeps to the chip's line while it has 6rem there, and
                                takes its own line below the chip when it does not: a long
                                stage name at 320px left it a sliver one letter wide. */}
                            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                isCompleted ? "bg-gold/10 text-gold" : "bg-muted text-muted-foreground"
                              }`}>
                                {step.stage}
                              </span>
                              <h3 className={`font-display text-lg font-semibold basis-24 grow max-w-full break-words ${
                                isCompleted ? "text-muted-foreground" : "text-foreground"
                              }`}>
                                {step.title}
                              </h3>
                            </div>
                            <m.div className="shrink-0" animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                              <ChevronDown className="w-5 h-5 text-muted-foreground" />
                            </m.div>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 break-words">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <m.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-5 pt-0 ml-14">
                            <div className="bg-muted/50 rounded-lg p-4 mb-4">
                              <ul className="grid grid-cols-2 gap-2">
                                {stepPoints(step).map((detail, i) => (
                                  <m.li
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 break-words"
                                  >
                                    <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-gold" />
                                    <span className="min-w-0 break-words">{detail}</span>
                                  </m.li>
                                ))}
                              </ul>
                            </div>
                            {action && (
                              <JourneyLink
                                action={action.action}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-gold text-white rounded-full text-sm font-medium hover:bg-amber-800 transition"
                              >
                                {action.label}
                                {leavesSite(action.action) ? <ExternalLink className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                              </JourneyLink>
                            )}
                          </div>
                        </m.div>
                      )}
                    </AnimatePresence>
                  </m.div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      )}

      {/* Impact tiers. The id stays whatever the tiers are called, so a step's
          "#ari-tiers" button lands here. */}
      {page && !page.tiers.hidden && (
      <section id="ari-tiers" className="py-20 bg-cream">
        <div className="container">
          <m.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.tiers.fields.heading}
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              <Emphasized text={page.tiers.fields.intro} />
            </p>
          </m.div>

          <div className="grid md:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {page.tiers.lists.items.map((tier, index) => (
              <m.div
                key={`${index}-${tier.tier}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8, scale: 1.02 }}
                className={`bg-card p-6 rounded-xl shadow-sm border-2 ${TIER_COLORS[index % TIER_COLORS.length]} transition-all min-w-0`}
              >
                <h3 className="font-display text-2xl font-semibold mb-2 break-words">
                  {tier.tier}
                </h3>
                <p className="text-sm font-medium text-muted-foreground mb-3 break-words">
                  {tier.description}
                </p>
                <p className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-4 break-words">
                  {tier.focus}
                </p>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Impact Metrics:</p>
                  <ul className="space-y-1">
                    {[tier.metric1, tier.metric2, tier.metric3].filter(Boolean).map((metric, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-center gap-2 min-w-0 break-words">
                        <span className="w-1 h-1 shrink-0 rounded-full bg-current" />
                        <span className="min-w-0 break-words">{metric}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </m.div>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* Download Packet CTA. This section's only control is the packet
          request, so the whole section hides when that button has nowhere to
          go (by default, no published contact address): a heading and a
          promise over an empty band is a worse answer than saying nothing. */}
      {page && !page.packet.hidden && packetCta && (
      <section className="py-20 bg-gold/5">
        <div className="container">
          <m.div
            className="max-w-2xl mx-auto text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.packet.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-8">
              <Emphasized text={page.packet.fields.body} />
            </p>
            <JourneyLink action={packetCta.action} className="btn-amora inline-flex items-center gap-2">
              <Download className="w-5 h-5" />
              {packetCta.label}
            </JourneyLink>
          </m.div>
        </div>
      </section>
      )}

      {/* Final CTA. Two controls, so it survives on either one. */}
      {page && !page.closing.hidden && (closingPrimary || closingSecondary) && (
      <section className="py-20 bg-background">
        <div className="container">
          <m.div
            className="max-w-2xl mx-auto text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <m.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Zap className="w-12 h-12 text-gold mx-auto mb-6" />
            </m.div>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.closing.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-8">
              <Emphasized text={page.closing.fields.body} />
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {closingPrimary && (
                <JourneyLink action={closingPrimary.action} className="btn-amora flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  {closingPrimary.label}
                </JourneyLink>
              )}
              {closingSecondary && (
                <JourneyLink
                  action={closingSecondary.action}
                  className="px-6 py-3 bg-white text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white/90 transition-all border border-border inline-flex items-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  {closingSecondary.label}
                </JourneyLink>
              )}
            </div>
          </m.div>
        </div>
      </section>
      )}

      {page && <FaqSection pathway="prosperity" heading={page.faq.fields.heading} />}
    </Layout>
  );
}
