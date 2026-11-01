import Layout from "@/components/Layout";
import { useVillageLinks } from "@/lib/gameApi";
import { altOr, useBrandImages } from "@/lib/gameApi";
import FaqSection from "@/components/FaqSection";
import PathConsentBox, { FORM_CONSENT_FIELD } from "@/components/comms/PathConsentBox";
import { Emphasized, Highlighted } from "@/components/PageText";
import { JourneyLink, leavesSite } from "@/components/journey/JourneyLink";
import { useJourneyContent, useJourneyProgress } from "@/hooks/useJourneyContent";
import { buttonAction, stepPoints, type TargetContext } from "@/lib/journeyPage";
import { JOURNEY_LEGACY_STEP_IDS, STEWARD_JOURNEY } from "@shared/pageContent/journeys";
import type { ResolvedSection } from "@shared/pageContent/types";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  ArrowRight,
  CheckCircle2,
  Circle,
  Calendar,
  Heart,
  BookOpen,
  Award,
  Star,
  Compass,
  Crown,
  Sparkles,
  ChevronDown,
  ExternalLink
} from "lucide-react";

/*
 * EVERY WORD ON THIS PAGE IS THE VILLAGE'S OWN, from Admin, Pages, Steward
 * journey (shared/pageContent/journeys.ts). What stays here is the look: the
 * icons, handed out by position, and the form's machinery.
 */

/** Icons for the steps, in order; a longer list starts again from the top. */
const STEP_ICONS = [Calendar, Users, Users, BookOpen, Heart, Users, Compass, Award, Star];
/** Icons for the path of growth and the long-term cards, in order. */
const LADDER_ICONS = [Star, Compass, Crown];
const ARC_ICONS = [Compass, Crown];

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
  const progress = useJourneyProgress("amora-steward-progress", steps, JOURNEY_LEGACY_STEP_IDS.steward);
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
          {brand.stewardHero ? (
            <motion.img
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
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 mb-6"
            >
              <motion.div
                className="w-12 h-12 shrink-0 rounded-xl bg-sage flex items-center justify-center"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Users className="w-6 h-6 text-white" />
              </motion.div>
              <span className={`text-sage font-medium tracking-wide uppercase text-sm min-w-0 break-words${waiting}`}>{hero?.eyebrow || " "}</span>
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
                render={(phrase) => <span className="text-sage italic">{phrase}</span>}
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
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-sage to-coral rounded-full"
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
                const action = buttonAction(step.actionLabel, step.actionTarget, targets);

                return (
                  <motion.div
                    key={`${index}-${step.title}`}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.05 }}
                    className={`bg-card rounded-xl shadow-sm overflow-hidden transition-all ${
                      isCompleted ? "border-l-4 border-sage" : "border-l-4 border-transparent hover:border-coral/50"
                    }`}
                  >
                    <div
                      className="p-5 cursor-pointer"
                      onClick={() => setExpandedStep(isExpanded ? null : index)}
                    >
                      <div className="flex items-start gap-4">
                        {/* A checkbox — the comment was right, the markup was not.
                            Named and stateful now; see ProsperityJourney. */}
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
                          <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                            {isCompleted ? (
                              <CheckCircle2 className="w-6 h-6 text-sage" />
                            ) : (
                              <Circle className="w-6 h-6 text-muted-foreground hover:text-teal-deep transition-colors" />
                            )}
                          </motion.div>
                        </button>

                        {/* Icon */}
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isCompleted ? "bg-sage/10" : "bg-teal-deep/10"
                        }`}>
                          <StepIcon className={`w-5 h-5 ${isCompleted ? "text-sage" : "text-teal-deep"}`} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            {/* The title keeps to the chip's line while it has 6rem there, and
                                takes its own line below the chip when it does not: a long
                                stage name at 320px left it a sliver one letter wide. */}
                            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                isCompleted ? "bg-sage/10 text-sage" : "bg-muted text-muted-foreground"
                              }`}>
                                {step.stage}
                              </span>
                              <h3 className={`font-display text-lg font-semibold basis-24 grow max-w-full break-words ${
                                isCompleted ? "text-muted-foreground" : "text-foreground"
                              }`}>
                                {step.title}
                              </h3>
                            </div>
                            <motion.div className="shrink-0" animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                              <ChevronDown className="w-5 h-5 text-muted-foreground" />
                            </motion.div>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 break-words">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
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
                                  <motion.li
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 break-words"
                                  >
                                    <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-sage" />
                                    <span className="min-w-0 break-words">{detail}</span>
                                  </motion.li>
                                ))}
                              </ul>
                            </div>
                            {action && (
                              <JourneyLink
                                action={action.action}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-sage text-white rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
                              >
                                {action.label}
                                {leavesSite(action.action) ? <ExternalLink className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
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

      {/* Advancement Path */}
      {page && !page.ladder.hidden && (
      <section className="py-20 bg-sage text-white">
        <div className="container">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold mb-4 break-words">
              {page.ladder.fields.heading}
            </h2>
            {/* /70 measured 3.83:1 against this section's own green on the
                deployed build, under AA's 4.5:1 at 16px. Full white is 5.95:1
                on the same ground. */}
            <p className="text-white max-w-2xl mx-auto">
              <Emphasized text={page.ladder.fields.intro} />
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {page.ladder.lists.items.map((level, index) => {
              const LevelIcon = LADDER_ICONS[index % LADDER_ICONS.length];
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
                  className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4"
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.5 }}
                >
                  <LevelIcon className="w-8 h-8" />
                </motion.div>
                <h3 className="font-display text-xl font-semibold mb-2 break-words">
                  {level.level}
                </h3>
                {/* Full white, not /70 and /90. These sit on `bg-white/10`
                    over the section's green, and that tint composites LIGHTER
                    than the section itself, so the fade that reads fine
                    elsewhere loses here. Measured on the deployed build,
                    all six viewports: /70 gave 3.21:1 and /90 gave 4.19:1,
                    both under AA's 4.5:1 for text this size. Full white is
                    4.73:1 on that composite. The hierarchy between the two
                    lines is carried by `font-medium`, which already
                    distinguished them. */}
                <p className="text-white text-sm mb-3 break-words">
                  {level.requirement}
                </p>
                <p className="text-white text-sm font-medium break-words">
                  {level.benefits}
                </p>
              </motion.div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* Long-Term Arc */}
      {page && !page.arc.hidden && (
      <section className="py-20 bg-sage/5">
        <div className="container">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.arc.fields.heading}
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              <Emphasized text={page.arc.fields.intro} />
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {page.arc.lists.items.map((level, index) => {
              const LevelIcon = ARC_ICONS[index % ARC_ICONS.length];
              return (
              <motion.div
                key={`${index}-${level.level}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8, scale: 1.02 }}
                className="bg-card p-6 rounded-xl shadow-sm border border-sage/20 min-w-0"
              >
                <motion.div
                  className="w-14 h-14 rounded-full bg-sage/10 flex items-center justify-center mx-auto mb-4"
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.5 }}
                >
                  <LevelIcon className="w-7 h-7 text-sage" />
                </motion.div>
                <h3 className="font-display text-xl font-semibold text-foreground text-center mb-2 break-words">
                  {level.level}
                </h3>
                <p className="text-center text-muted-foreground text-sm break-words">
                  {level.description}
                </p>
              </motion.div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* Seasonal Rhythm */}
      {page && !page.seasons.hidden && (
      <section className="py-20 bg-cream">
        <div className="container">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Sparkles className="w-12 h-12 text-sage mx-auto mb-6" />
            </motion.div>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {page.seasons.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-8">
              <Emphasized text={page.seasons.fields.body} />
            </p>
            <BandButton section={page.seasons} targets={targets} />
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

      {/* Your Next Step */}
      {page && !page.nextStep.hidden && (
      <section className="py-20 bg-sage/10">
        <div className="container">
          <motion.div
            className="max-w-2xl mx-auto"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <div className="text-center mb-8">
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
                {page.nextStep.fields.heading}
              </h2>
              <p className="text-muted-foreground">
                <Emphasized text={page.nextStep.fields.body} />
              </p>
            </div>

            <StewardNextStepForm words={page.nextStep.fields} />
          </motion.div>
        </div>
      </section>
      )}

      {page && <FaqSection pathway="steward" heading={page.faq.fields.heading} />}
    </Layout>
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

function StewardNextStepForm({ words }: { words: Readonly<Record<string, string>> }) {
  // Blank hides the two invitations below rather than sending a
  // would-be steward to a different village's calendar.
  const { eventsUrl } = useVillageLinks();
  const [form, setForm] = useState({ name: "", email: "", gifts: "", question: "" });
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // The welcome replaces the form and its button, so focus would fall to
  // <body> and a screen reader would hear nothing. Focus goes to the welcome.
  const welcome = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (submitted) welcome.current?.focus();
  }, [submitted]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "steward-interest", data: { ...form, [FORM_CONSENT_FIELD]: consent } }),
      });
      if (!res.ok) throw new Error("Submission failed");
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-card rounded-2xl p-10 shadow-sm text-center"
      >
        <div className="w-16 h-16 rounded-full bg-sage/20 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-sage" />
        </div>
        <h3 ref={welcome} tabIndex={-1} className="font-display text-2xl font-bold text-foreground mb-3 outline-none break-words">
          {words.thanksHeading}
        </h3>
        <p className="text-muted-foreground mb-6">
          <Emphasized text={words.thanksBody} />
        </p>
        {eventsUrl && words.thanksCta && (
          <a
            href={eventsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-lg font-semibold hover:opacity-90 transition-opacity"
          >
            <Calendar className="w-5 h-5" />
            {words.thanksCta}
          </a>
        )}
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card rounded-2xl p-8 shadow-sm space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          {/* Each label is tied to its field by htmlFor. They were plain text
              above unlinked inputs, so a screen reader announced four
              controls here with no names at all. */}
          <label htmlFor="steward-name" className="block text-sm font-medium text-foreground mb-1.5">
            Your name <span className="text-destructive">*</span>
          </label>
          <input
            id="steward-name"
            type="text"
            autoComplete="name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full px-4 py-2.5 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Full name"
          />
        </div>
        <div>
          <label htmlFor="steward-email" className="block text-sm font-medium text-foreground mb-1.5">
            Email <span className="text-destructive">*</span>
          </label>
          <input
            id="steward-email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-full px-4 py-2.5 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="you@example.com"
          />
        </div>
      </div>

      <div>
        <label htmlFor="steward-gifts" className="block text-sm font-medium text-foreground mb-1.5 break-words">
          {words.giftsLabel}
        </label>
        <input
          id="steward-gifts"
          type="text"
          value={form.gifts}
          onChange={(e) => setForm((f) => ({ ...f, gifts: e.target.value }))}
          className="w-full px-4 py-2.5 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder={words.giftsHint || undefined}
        />
      </div>

      <div>
        <label htmlFor="steward-question" className="block text-sm font-medium text-foreground mb-1.5 break-words">
          {words.questionLabel}
        </label>
        <textarea
          id="steward-question"
          rows={3}
          value={form.question}
          onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
          className="w-full px-4 py-2.5 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          placeholder={words.questionHint || undefined}
        />
      </div>

      <PathConsentBox checked={consent} onChange={setConsent} />

      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-sm text-destructive"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-3 bg-sage text-white rounded-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <span>Sending...</span>
        ) : (
          <>
            <Heart className="w-5 h-5 shrink-0" />
            <span className="min-w-0 break-words text-center">{words.submitLabel}</span>
          </>
        )}
      </button>
      {eventsUrl && words.footnote && (
        <p className="text-xs text-muted-foreground text-center">
          <Highlighted
            text={words.footnote}
            phrase={words.footnoteLink}
            render={(phrase) => (
              <a href={eventsUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {phrase}
              </a>
            )}
          />
        </p>
      )}
    </form>
  );
}
