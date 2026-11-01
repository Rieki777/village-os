import Layout from "@/components/Layout";
import { altOr, useBrandImages, useGameConfig, useVillageLinks } from "@/lib/gameApi";
import { figureWithCurrency } from "@shared/money";
import WhyCostaRica from "@/components/WhyCostaRica";
import FaqSection from "@/components/FaqSection";
import { useVillageContent } from "@/hooks/useVillageContent";
import { type MoneyContent } from "@/lib/moneyClaims";
import { Emphasized, Highlighted } from "@/components/PageText";
import { JourneyLink, leavesSite } from "@/components/journey/JourneyLink";
import { useJourneyContent, useJourneyProgress } from "@/hooks/useJourneyContent";
import { buttonAction, stepPoints, type TargetContext } from "@/lib/journeyPage";
import { JOURNEY_LEGACY_STEP_IDS, RESIDENT_JOURNEY } from "@shared/pageContent/journeys";
import type { ResolvedSection } from "@shared/pageContent/types";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  ArrowRight,
  CheckCircle2,
  Circle,
  Calendar,
  Heart,
  Users,
  FileCheck,
  Baby,
  Award,
  Key,
  Building,
  Shield,
  Crown,
  ChevronDown,
  ExternalLink,
  Sparkles,
  BookOpen,
  Sprout,
  Wallet,
  Flame
} from "lucide-react";

/*
 * EVERY WORD ON THIS PAGE IS THE VILLAGE'S OWN, from Admin, Pages, Resident
 * journey (shared/pageContent/journeys.ts). What stays here is the look: the
 * icons, handed out by position.
 *
 * THE DEPOSIT FIGURES ARE NOT WRITTEN ANYWHERE IN CODE (founder ruling,
 * 2026-09-03). The deposit step said "from $5k to $20k+ depending on the home
 * type you're reserving" as a module constant, so every village published one
 * village's dollar figures under its own name. `{range}` and
 * `{deposit-summary}` are filled from `money.depositRange` and
 * `money.depositSummary` in the runtime content document, and a village that
 * has written nothing publishes NO figure: the sentence closes after
 * "deposit" and the point is left out. The comma belongs to the code, so a
 * founder types the clause alone.
 */

/** Icons for the steps, in order; a longer list starts again from the top. */
const STEP_ICONS = [Calendar, Users, Sprout, BookOpen, Heart, Home, Wallet, FileCheck, Flame, Baby, Award, Key, Building, Heart];

/*
 * THE TENURE TITLES, AND WHAT THEY ARE NOT (founder ruling, 2026-09-03).
 *
 * Guardian at 7 years, Elder at 21, Sage at 49. Nothing in the product
 * implements any of it: no capability, no role, no ledger entry and no query
 * anywhere reads a member's years. The founder's ruling is that the titles and
 * the years STAY and the page says plainly what they are, which is
 * recognition. A village may later decide to attach real powers to them, and
 * the section says that too.
 *
 * THE RIGHTS OF NATURE IS NOT ON THIS LADDER ANY MORE. The Sage entry used to
 * call that member the "Rights of Nature voice", which would leave nature
 * unable to speak until a village's forty-ninth year. Who speaks for nature is
 * a separate design and deliberately not answered here.
 *
 * It also has to sit beside the standing economics ruling that voice follows
 * CONTRIBUTION, with roles as a recurring contribution type. So nothing in
 * the default words may say or imply that years alone grow anybody's voice,
 * and the heading that did say so ("Growing Your Voice") is gone.
 */
const TITLE_ICONS = [Home, Shield, Users, Crown];

interface VillageDues {
  amount?: string;
  period?: string;
  currency?: string;
  note?: string;
}

interface LegalContent {
  landShareTransferNote?: string;
  membership?: {
    backgroundCheckNote?: string;
  };
}

export default function ResidentJourney() {
  const brand = useBrandImages();
  // The village's own currency (Admin, Make This Yours), for dues typed with no symbol.
  const fiatCurrency = useGameConfig()?.project?.fiatCurrency ?? "";
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const [dues, setDues] = useState<VillageDues | null>(null);
  const { content: legal } = useVillageContent<LegalContent>("legal");
  const { content: money } = useVillageContent<MoneyContent>("money");
  const transferNote = legal?.landShareTransferNote?.trim();
  const backgroundCheckNote = legal?.membership?.backgroundCheckNote?.trim();
  const depositRange = money?.depositRange?.trim();
  const depositSummary = money?.depositSummary?.trim();
  // The words only this page fills, each nothing while its setting is blank.
  const page = useJourneyContent(RESIDENT_JOURNEY, () => ({
    range: depositRange ? `, ${depositRange}` : "",
    "deposit-summary": depositSummary ?? "",
    "background-note": backgroundCheckNote ? `, ${backgroundCheckNote}` : "",
    "transfer-note": transferNote ? ` ${transferNote}` : "",
  }));
  const hero = page?.hero.fields;
  const steps = page?.steps.lists.items ?? null;
  const progress = useJourneyProgress("amora-resident-progress", steps, JOURNEY_LEGACY_STEP_IDS.resident);
  // This village's own destinations. Blank hides the control that uses one.
  const { eventsUrl, mailTo } = useVillageLinks();
  const targets: TargetContext = { eventsUrl, mailTo, subject: "" };
  const heroPrimary = buttonAction(hero?.primaryLabel, hero?.primaryTarget, targets);
  const heroSecondary = buttonAction(hero?.secondaryLabel, hero?.secondaryTarget, targets);
  const closingPrimary = buttonAction(page?.closing.fields.primaryLabel, page?.closing.fields.primaryTarget, targets);
  const closingSecondary = buttonAction(page?.closing.fields.secondaryLabel, page?.closing.fields.secondaryTarget, targets);
  const duesLink = buttonAction(page?.dues.fields.linkLabel, page?.dues.fields.linkTarget, targets);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setDues(s?.villageDues ?? null))
      .catch(() => { /* leave dues null; prose still renders */ });
  }, []);

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
          {brand.residentHero ? (
            <motion.img
              src={brand.residentHero}
              alt={altOr(brand.residentHeroAlt, "A home in the village")}
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
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 mb-6"
            >
              <motion.div
                className="w-12 h-12 shrink-0 rounded-xl bg-teal-deep flex items-center justify-center"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Home className="w-6 h-6 text-white" />
              </motion.div>
              <span className={`text-teal-deep font-medium tracking-wide uppercase text-sm min-w-0 break-words${waiting}`}>{hero?.eyebrow || " "}</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`font-display text-5xl md:text-6xl font-semibold text-foreground mb-6 break-words${waiting}`}
            >
              <Highlighted
                text={hero?.headline || " "}
                phrase={hero?.highlight ?? ""}
                render={(phrase) => <span className="text-teal-deep italic">{phrase}</span>}
              />
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`text-xl text-muted-foreground leading-relaxed mb-8 break-words${waiting}`}
            >
              <Emphasized text={hero?.intro ?? ""} />
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap gap-4"
            >
              {heroPrimary && (
                <JourneyLink action={heroPrimary.action} className="btn-village flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
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
            </motion.div>
          </div>
        </div>
      </section>

      {/* Land Share Info */}
      {page && !page.tenure.hidden && (
      <section className="py-16 bg-teal-deep/10">
        <div className="container">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <motion.div
              animate={{ y: [0, -5, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Key className="w-12 h-12 text-teal-deep mx-auto mb-4" />
            </motion.div>
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground mb-4 break-words">
              {page.tenure.fields.heading}
            </h2>
            <p className="text-muted-foreground">
              <Emphasized text={page.tenure.fields.body} />
            </p>
          </motion.div>
        </div>
      </section>
      )}

      {/* Interactive Journey Steps */}
      {page && steps && (
      <section className="py-20 bg-background">
        <div className="container">
          <motion.div
            className="text-center mb-8"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.steps.fields.heading}
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
              <Emphasized text={page.steps.fields.intro} />
            </p>

            {/* Progress Bar */}
            <div className="max-w-md mx-auto">
              <div className="relative h-3 bg-muted rounded-full overflow-hidden mb-2">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-coral to-gold rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress.progress}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {progress.doneCount} of {progress.total} steps completed
              </p>
            </div>
          </motion.div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-3">
              {steps.map((step, index) => {
                const isCompleted = progress.isDone(step);
                const isExpanded = expandedStep === index;
                const StepIcon = STEP_ICONS[index % STEP_ICONS.length];
                // A blank "goes to" draws no button: the four that pointed at
                // "#" (Coming Soon, By Invitation, Land Shares, Welcome Home)
                // were buttons to nowhere.
                const action = buttonAction(step.actionLabel, step.actionTarget, targets);

                return (
                  <motion.div
                    key={`${index}-${step.title}`}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.03 }}
                    className={`bg-card rounded-xl shadow-sm overflow-hidden transition-all ${
                      isCompleted ? "border-l-4 border-coral" : "border-l-4 border-transparent hover:border-coral/50"
                    }`}
                  >
                    <div
                      className="p-4 cursor-pointer"
                      onClick={() => setExpandedStep(isExpanded ? null : index)}
                    >
                      <div className="flex items-start gap-3">
                        {/* A checkbox, named and stateful — see ProsperityJourney. */}
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isCompleted}
                          aria-label={`${step.title}: mark as ${isCompleted ? "not done" : "done"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            progress.toggle(step);
                          }}
                          className="flex-shrink-0 mt-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                        >
                          <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                            {isCompleted ? (
                              <CheckCircle2 className="w-5 h-5 text-teal-deep" />
                            ) : (
                              <Circle className="w-5 h-5 text-muted-foreground hover:text-teal-deep transition-colors" />
                            )}
                          </motion.div>
                        </button>

                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isCompleted ? "bg-teal-deep/10" : "bg-muted"
                        }`}>
                          <StepIcon className={`w-4 h-4 ${isCompleted ? "text-teal-deep" : "text-muted-foreground"}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                isCompleted ? "bg-teal-deep/10 text-teal-deep" : "bg-muted text-muted-foreground"
                              }`}>
                                {step.stage}
                              </span>
                              <h3 className={`font-display text-base font-semibold min-w-0 break-words ${
                                isCompleted ? "text-muted-foreground" : "text-foreground"
                              }`}>
                                {step.title}
                              </h3>
                            </div>
                            <motion.div className="shrink-0" animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            </motion.div>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 pt-0 ml-12">
                            <p className="text-sm text-muted-foreground mb-3 break-words">{step.description}</p>
                            <div className="bg-muted/50 rounded-lg p-3 mb-3">
                              <ul className="grid grid-cols-2 gap-1.5">
                                {stepPoints(step).map((detail, i) => (
                                  <motion.li
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 break-words"
                                  >
                                    <div className="w-1 h-1 shrink-0 rounded-full bg-teal-deep" />
                                    <span className="min-w-0 break-words">{detail}</span>
                                  </motion.li>
                                ))}
                              </ul>
                            </div>
                            {action && (
                              <JourneyLink
                                action={action.action}
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-teal-deep text-white rounded-full text-xs font-medium hover:bg-teal-deep-dark transition"
                              >
                                {action.label}
                                {leavesSite(action.action) ? <ExternalLink className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                              </JourneyLink>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      )}

      <WhyCostaRica />

      {/* Resident Progression */}
      {page && !page.titles.hidden && (
      <section className="py-20 bg-teal-deep text-white">
        <div className="container">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold mb-4 break-words">
              {page.titles.fields.heading}
            </h2>
            <p className="text-white/70 max-w-2xl mx-auto">
              <Emphasized text={page.titles.fields.body} />
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {page.titles.lists.items.map((level, index) => {
              const LevelIcon = TITLE_ICONS[index % TITLE_ICONS.length];
              return (
              <motion.div
                key={`${index}-${level.level}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8, scale: 1.02 }}
                className="bg-white/10 p-6 rounded-xl text-center backdrop-blur-sm min-w-0"
              >
                <motion.div
                  className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4"
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.5 }}
                >
                  <LevelIcon className="w-7 h-7" />
                </motion.div>
                <h3 className="font-display text-xl font-semibold mb-2 break-words">
                  {level.level}
                </h3>
                {/* /60 measured 3.96:1 on the `bg-white/10` composite
                    rgb(83,83,83), under AA at 12px. /80 is 5.67:1 there and
                    keeps this label quieter than the heading above it, which
                    is what the fade was for. */}
                {level.years && (
                  <p className="text-white/80 text-xs mb-3 uppercase tracking-wide break-words">
                    {level.years}+
                  </p>
                )}
                <p className="text-white/90 text-sm break-words">
                  {level.description}
                </p>
              </motion.div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* Village Dues */}
      {page && !page.dues.hidden && (
      <section className="py-20 bg-cream">
        <div className="container">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.dues.fields.heading}
            </h2>
            {dues?.amount && (
              <div className="mb-6">
                <span className="font-display text-5xl md:text-6xl font-bold text-teal-deep">
                  {figureWithCurrency(dues.amount, dues.currency, fiatCurrency)}
                </span>
                <span className="text-xl text-muted-foreground"> / {dues.period || "month"}</span>
              </div>
            )}
            <p className="text-muted-foreground mb-6">
              {dues?.note?.trim() ? dues.note : <Emphasized text={page.dues.fields.fallback} />}
            </p>
            {duesLink && (
              <JourneyLink
                action={duesLink.action}
                className="inline-flex items-center gap-2 text-teal-deep font-medium hover:gap-3 transition-all"
              >
                {duesLink.label}
                <ArrowRight className="w-4 h-4" />
              </JourneyLink>
            )}
          </motion.div>
        </div>
      </section>
      )}

      {/* Rights & Responsibilities */}
      {page && !page.rights.hidden && (
      <section className="py-16 bg-background">
        <div className="container">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground mb-3 break-words">
              {page.rights.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-6">
              <Emphasized text={page.rights.fields.body} />
            </p>
            <BandButton section={page.rights} targets={targets} />
          </motion.div>
        </div>
      </section>
      )}

      {/* Your Next Step CTA */}
      {page && !page.nextStep.hidden && (
      <section className="py-20 bg-teal-deep/5">
        <div className="container">
          <motion.div
            className="max-w-2xl mx-auto text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.nextStep.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-8">
              <Emphasized text={page.nextStep.fields.body} />
            </p>
            <BandButton section={page.nextStep} targets={targets} icon />
          </motion.div>
        </div>
      </section>
      )}

      {page && <FaqSection pathway="resident" heading={page.faq.fields.heading} />}

      {/* CTA */}
      {page && !page.closing.hidden && (
      <section className="py-20 bg-background">
        <div className="container">
          <motion.div
            className="max-w-2xl mx-auto text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Sparkles className="w-12 h-12 text-teal-deep mx-auto mb-6" />
            </motion.div>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.closing.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-8">
              <Emphasized text={page.closing.fields.body} />
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {closingPrimary && (
                <JourneyLink action={closingPrimary.action} className="btn-village flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  {closingPrimary.label}
                </JourneyLink>
              )}
              {closingSecondary && (
                <JourneyLink
                  action={closingSecondary.action}
                  className="px-6 py-3 bg-white text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white/90 transition-all border border-border"
                >
                  {closingSecondary.label}
                </JourneyLink>
              )}
            </div>
          </motion.div>
        </div>
      </section>
      )}
    </Layout>
  );
}

/** A band's one button, in the page's own style. The visit invitation carries a calendar. */
function BandButton({ section, targets, icon = false }: { section: ResolvedSection; targets: TargetContext; icon?: boolean }) {
  const cta = buttonAction(section.fields.ctaLabel, section.fields.ctaTarget, targets);
  if (!cta) return null;
  return (
    <JourneyLink action={cta.action} className="btn-village inline-flex items-center gap-2">
      {icon ? <Calendar className="w-5 h-5" /> : null}
      {cta.label}
      {icon ? null : <ArrowRight className="w-4 h-4" />}
    </JourneyLink>
  );
}
