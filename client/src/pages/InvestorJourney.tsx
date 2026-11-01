import Layout from "@/components/Layout";
import { altOr, statedFacts, useBrandImages, useVillageLinks, useVillageSettings } from "@/lib/gameApi";
import WhyCostaRica from "@/components/WhyCostaRica";
import FaqSection from "@/components/FaqSection";
import PathConsentBox, { FORM_CONSENT_FIELD } from "@/components/comms/PathConsentBox";
import InvestorSummary from "@/components/InvestorSummary";
import { Emphasized, Highlighted } from "@/components/PageText";
import { JourneyLink, leavesSite } from "@/components/journey/JourneyLink";
import { useJourneyContent, useJourneyProgress } from "@/hooks/useJourneyContent";
import { buttonAction, percent, stepPoints, type TargetContext } from "@/lib/journeyPage";
import { INVESTOR_FIGURE_IDS, INVESTOR_JOURNEY, JOURNEY_LEGACY_STEP_IDS } from "@shared/pageContent/journeys";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  Circle,
  FileText,
  Calendar,
  Heart,
  Building,
  Users,
  Sparkles,
  ChevronDown,
  ExternalLink,
  Send,
  MapPin,
  Zap,
  BarChart3,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

/*
 * EVERY WORD ON THIS PAGE IS THE VILLAGE'S OWN, from Admin, Pages, Investor
 * journey (shared/pageContent/journeys.ts). What stays here is the look: the
 * icons and colours, handed out by position, and the forms' machinery.
 */

/** Icons for the steps, in order; a longer list starts again from the top. */
const STEP_ICONS = [Sparkles, FileText, Calendar, Heart];

/*
 * KEY NUMBERS ARE THE VILLAGE'S OWN, OR THERE ARE NONE.
 *
 * These four tiles used to be literals in this file: a land appreciation
 * percentage, an appraisal with its month, a projected internal rate of return,
 * and a target raise, all about one specific property in one specific country.
 * Any village that pulled this platform published every one of them as its own
 * the first time somebody opened this page, and no screen anywhere could change
 * them.
 *
 * What stays here is the tile's icon and colour. Its heading and the sentence
 * explaining the figure are the page's words; what a figure IS comes from the
 * village, through Admin, Settings. A village that has stated none of them
 * gets the honest sentence rather than an empty grid, and never a default: a
 * number nobody typed is a claim nobody made.
 */
const METRIC_LOOKS: Record<(typeof INVESTOR_FIGURE_IDS)[number], { icon: typeof TrendingUp; color: string }> = {
  appreciation: { icon: TrendingUp, color: "bg-teal-deep/10 text-teal-deep" },
  appraisal: { icon: Building, color: "bg-gold/10 text-gold" },
  projectedReturn: { icon: BarChart3, color: "bg-coral/10 text-coral" },
  targetRaise: { icon: Zap, color: "bg-sage/10 text-sage" },
};

/** Icon and gradient for each person card, handed out in order. */
const PERSONA_LOOKS = [
  { icon: MapPin, color: "from-teal-deep to-teal-deep-dark" },
  { icon: Users, color: "from-gold to-coral" },
  { icon: Heart, color: "from-sage to-teal-deep" },
  { icon: Sparkles, color: "from-coral to-gold" },
  { icon: TrendingUp, color: "from-teal-deep to-sage" },
  { icon: Building, color: "from-gold to-teal-deep" },
];

const PACK_FORM = "pack-form";
const CALL_FORM = "call-form";

export default function InvestorJourney() {
  const page = useJourneyContent(INVESTOR_JOURNEY);
  const hero = page?.hero.fields;
  const figures = page?.figures;
  const personas = page?.personas;
  const steps = page?.steps.lists.items ?? null;
  const phases = page?.phases;
  const closing = page?.closing;
  const accreditationOn = !!page && !page.accreditation.hidden;
  const brand = useBrandImages();
  const settings = useVillageSettings();
  // NULL IS "NOT LOADED YET", NEVER "NOTHING STATED". Without this line the
  // page tells every visitor "this village has not published any figures" for
  // the length of one fetch, including on a village that has published four,
  // which is a sentence the product would be saying out of a default rather
  // than out of what happened.
  const loaded = settings !== null;
  const financialMetrics = statedFacts(
    settings,
    (figures?.lists.tiles ?? []).flatMap((tile) => {
      const look = (METRIC_LOOKS as Record<string, (typeof METRIC_LOOKS)[keyof typeof METRIC_LOOKS] | undefined>)[tile.id ?? ""];
      return look ? [{ key: tile.id ?? "", title: tile.title, detail: tile.detail, ...look }] : [];
    }),
  );
  const progress = useJourneyProgress("amora-investor-progress", steps, JOURNEY_LEGACY_STEP_IDS.investor);
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const [showPackForm, setShowPackForm] = useState(false);
  const [showCallForm, setShowCallForm] = useState(false);
  const [packFormData, setPackFormData] = useState({ name: "", email: "", investmentRange: "", message: "", accredited: false });
  const [callFormData, setCallFormData] = useState({ name: "", email: "", preferredTime: "", message: "" });
  // The "walk me through the next steps" box on each form (5.11): unticked unless the person ticks it.
  const [packConsent, setPackConsent] = useState(false);
  const [callConsent, setCallConsent] = useState(false);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  // This village's own destinations. A button whose destination is blank is
  // not drawn: an investment commitment is the single worst enquiry to
  // misroute, so a blank contact address hides it rather than addressing it
  // to somebody else.
  const { eventsUrl, contactEmail, mailTo } = useVillageLinks();
  const targets: TargetContext = { eventsUrl, mailTo, subject: hero?.contactSubject ?? "", forms: [PACK_FORM, CALL_FORM] };
  const openForm = (form: string) => (form === PACK_FORM ? setShowPackForm(true) : setShowCallForm(true));
  const heroPrimary = buttonAction(hero?.primaryLabel, hero?.primaryTarget, targets);
  const heroSecondary = buttonAction(hero?.secondaryLabel, hero?.secondaryTarget, targets);
  const closingPrimary = buttonAction(closing?.fields.primaryLabel, closing?.fields.primaryTarget, targets);
  const closingSecondary = buttonAction(closing?.fields.secondaryLabel, closing?.fields.secondaryTarget, targets);
  // Named once so the two failure paths below cannot drift apart. With no
  // published address the sentence simply stops after "try again": pointing a
  // failed investor at a mailbox this village does not own is how the lead
  // disappears without anybody noticing.
  const retryNote = contactEmail
    ? `Something went wrong. Please try again or email ${contactEmail}.`
    : "Something went wrong. Please try again.";

  const handlePackFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (accreditationOn && !packFormData.accredited) {
      setFormSuccess(page?.accreditation.fields.reminder ?? null);
      setTimeout(() => setFormSuccess(null), 4000);
      return;
    }
    try {
      /*
       * Everything the form asks for reaches the lead (POST
       * /api/investor-docs/request). A village that switched the
       * accreditation question off sends null, recorded as "not asked".
       */
      const response = await fetch("/api/investor-docs/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: packFormData.name,
          email: packFormData.email,
          accredited: accreditationOn ? packFormData.accredited : null,
          investmentRange: packFormData.investmentRange,
          message: packFormData.message,
          [FORM_CONSENT_FIELD]: packConsent,
        }),
      });
      if (response.ok) {
        const result = await response.json().catch(() => ({}));
        setFormSuccess(result.message || "Check your email - we've sent you the full investor packet.");
        setShowPackForm(false);
        setPackFormData({ name: "", email: "", investmentRange: "", message: "", accredited: false });
        setPackConsent(false);
        setTimeout(() => setFormSuccess(null), 6000);
      } else {
        setFormSuccess(retryNote);
        setTimeout(() => setFormSuccess(null), 5000);
      }
    } catch (error) {
      console.error("Form submission error:", error);
      setFormSuccess(retryNote);
      setTimeout(() => setFormSuccess(null), 5000);
    }
  };

  const handleCallFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("/api/forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "investor-call",
          data: { ...callFormData, [FORM_CONSENT_FIELD]: callConsent }
        })
      });
      if (response.ok) {
        setFormSuccess(page?.callForm.fields.thanks ?? null);
        setShowCallForm(false);
        setCallFormData({ name: "", email: "", preferredTime: "", message: "" });
        setCallConsent(false);
        setTimeout(() => setFormSuccess(null), 5000);
      }
    } catch (error) {
      console.error("Form submission error:", error);
    }
  };

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
          {brand.investorHero ? (
            <motion.img
              src={brand.investorHero}
              alt={altOr(brand.investorHeroAlt, "The land and the buildings on it")}
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
                photograph under text cannot promise a ratio: the paragraph read
                3.59:1 over this one at 393px, and the eyebrow cleared only
                because of what today's picture happens to hold. With no picture
                the band is the colour it sits on. heroCopy.contrast.test.tsx */}
            <div
              aria-hidden="true"
              className="absolute -inset-x-5 -inset-y-6 sm:-inset-x-8 sm:-inset-y-10 rounded-3xl bg-background"
            />
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative flex items-center gap-3 mb-6"
            >
              <motion.div
                className="w-12 h-12 shrink-0 rounded-xl bg-gold flex items-center justify-center"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <TrendingUp className="w-6 h-6 text-white" />
              </motion.div>
              {/* amber-ink, index.css's amber for text on light grounds: gold is 4.07:1 on the band. */}
              <span className={`text-amber-ink font-medium tracking-wide uppercase text-sm min-w-0 break-words${waiting}`}>{hero?.eyebrow || " "}</span>
            </motion.div>

            {/* 36px under 360px wide: at 48px "Regeneration" is one unbreakable word
                that inked to x=336 at 320px, past the 304px column and the section's
                overflow-hidden edge, so its end was cut off. From 360px up, unchanged.
                break-words is for a village's own longer word at the field's limit. */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`relative font-display text-4xl min-[360px]:text-5xl md:text-6xl font-semibold text-foreground mb-6 break-words${waiting}`}
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
              className={`relative text-xl text-muted-foreground leading-relaxed mb-8 break-words${waiting}`}
            >
              <Emphasized text={hero?.intro ?? ""} />
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="relative flex flex-wrap gap-4"
            >
              {/* The first button opens the page's own pack form by default,
                  posting to this village's own server: the lead is captured,
                  it reaches the right village, and the request passes through
                  the accreditation step the journey already had. */}
              {heroPrimary && (
                <JourneyLink action={heroPrimary.action} onForm={openForm} className="btn-village flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  {heroPrimary.label}
                </JourneyLink>
              )}
              {heroSecondary && (
                <JourneyLink
                  action={heroSecondary.action}
                  onForm={openForm}
                  className="px-6 py-3 bg-white/90 text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white transition-all flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  {heroSecondary.label}
                </JourneyLink>
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Financial Metrics Section */}
      {figures && !figures.hidden && (
      <section className="py-20 bg-background border-t border-b border-muted">
        <div className="container">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {figures.fields.heading}
            </h2>
            {/* R56: state what is true and get out of the way. A village with
                no figures yet is early, and saying so beats an empty grid. The
                line telling the village where to enter them belongs in Admin,
                never on its public page. */}
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
              {!loaded ? " " : financialMetrics.length ? figures.fields.intro : figures.fields.empty}
            </p>
            {financialMetrics.length && figures.fields.disclaimer ? (
              <p className="text-xs text-muted-foreground italic max-w-2xl mx-auto">
                {figures.fields.disclaimer}
              </p>
            ) : null}
          </motion.div>

          {loaded && financialMetrics.length ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {financialMetrics.map((metric, index) => (
              <motion.div
                key={metric.key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8 }}
                className={`${metric.color} rounded-xl p-8 shadow-sm transition-all min-w-0`}
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h3 className="font-display text-lg font-semibold text-foreground min-w-0 break-words">
                    {metric.title}
                  </h3>
                  <metric.icon className="w-6 h-6 shrink-0 opacity-90" />
                </div>
                <div className="mb-2">
                  <div className="font-display text-4xl font-semibold text-foreground break-words">
                    {metric.value}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium mt-1">
                    {metric.note}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed break-words">
                  {metric.detail}
                </p>
              </motion.div>
            ))}
          </div>
          ) : null}
        </div>
      </section>
      )}

      <InvestorSummary />

      {/* Who invests in this village */}
      {personas && !personas.hidden && (
      <section className="py-20 bg-cream">
        <div className="container">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
              {personas.fields.heading}
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              <Emphasized text={personas.fields.intro} />
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {personas.lists.items.map((persona, index) => {
              const look = PERSONA_LOOKS[index % PERSONA_LOOKS.length];
              return (
              <motion.div
                key={`${index}-${persona.title}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8 }}
                className={`bg-gradient-to-br ${look.color} rounded-xl p-8 shadow-sm text-white transition-all min-w-0`}
              >
                <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mb-4">
                  <look.icon className="w-6 h-6" />
                </div>
                <h3 className="font-display text-xl font-semibold mb-2 break-words">
                  {persona.title}
                </h3>
                <p className="text-white leading-relaxed break-words">
                  {persona.subtitle}
                </p>
              </motion.div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      <WhyCostaRica />

      {/* Interactive Journey Steps */}
      {page && steps && (
      <section className="py-20 bg-background">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            <motion.div
              className="text-center mb-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
                {page.steps.fields.heading}
              </h2>
              <p className="text-muted-foreground mb-6">
                <Emphasized text={page.steps.fields.intro} />
              </p>

              {/* Progress Bar */}
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
            </motion.div>

            <div className="space-y-4">
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
                    transition={{ delay: index * 0.1 }}
                    className={`bg-card rounded-xl shadow-sm overflow-hidden transition-all ${
                      isCompleted ? "border-l-4 border-sage" : "border-l-4 border-transparent"
                    }`}
                  >
                    <div
                      className="p-6 cursor-pointer"
                      onClick={() => setExpandedStep(isExpanded ? null : index)}
                    >
                      <div className="flex items-start gap-4">
                        {/* Checkbox */}
                        {/* Named and typed the way the steward, resident and prosperity
                            journeys already do it. This one was the outlier:
                            sixteen bare icon buttons whose only child is an svg,
                            so a screen reader announced "button" and this was the
                            ONLY keyboard path to mark an investor stage done. */}
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isCompleted}
                          aria-label={`${step.title}: mark as ${isCompleted ? "not done" : "done"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            progress.toggle(step);
                          }}
                          className="flex-shrink-0 mt-1"
                        >
                          <motion.div
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            {isCompleted ? (
                              <CheckCircle2 className="w-6 h-6 text-sage" />
                            ) : (
                              <Circle className="w-6 h-6 text-muted-foreground hover:text-teal-deep transition-colors" />
                            )}
                          </motion.div>
                        </button>

                        {/* Icon */}
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isCompleted ? "bg-sage/10" : "bg-teal-deep/10"
                        }`}>
                          <StepIcon className={`w-6 h-6 ${isCompleted ? "text-sage" : "text-teal-deep"}`} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-block px-2 py-1 bg-teal-deep/10 text-teal-deep text-xs font-semibold rounded-full break-words">
                              Stage: {step.stage}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <h3 className={`font-display text-xl font-semibold min-w-0 break-words ${
                              isCompleted ? "text-muted-foreground line-through" : "text-foreground"
                            }`}>
                              {step.title}
                            </h3>
                            <motion.div
                              className="shrink-0"
                              animate={{ rotate: isExpanded ? 180 : 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <ChevronDown className="w-5 h-5 text-muted-foreground" />
                            </motion.div>
                          </div>
                          <p className="text-muted-foreground mt-1 break-words">
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
                          <div className="px-6 pb-6 pt-2 ml-16">
                            <div className="bg-muted/50 rounded-lg p-4 mb-4">
                              <h4 className="font-medium text-foreground mb-3">What you'll accomplish:</h4>
                              <ul className="space-y-2">
                                {stepPoints(step).map((detail, i) => (
                                  <motion.li
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.1 }}
                                    className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 break-words"
                                  >
                                    <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-teal-deep" />
                                    <span className="min-w-0 break-words">{detail}</span>
                                  </motion.li>
                                ))}
                              </ul>
                            </div>
                            {action && (
                              <JourneyLink
                                action={action.action}
                                onForm={openForm}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-full text-sm font-medium hover:bg-teal-deep-dark transition-colors"
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

      {/* Development Phases */}
      {phases && !phases.hidden && (
      <section className="py-20 bg-teal-deep text-white">
        <div className="container">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold mb-4 break-words">
              {phases.fields.heading}
            </h2>
            <p className="text-white max-w-2xl mx-auto">
              <Emphasized text={phases.fields.intro} />
            </p>
          </motion.div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-4">
              {phases.lists.items.map((phase, index) => {
                const filled = percent(phase.progress);
                return (
                <motion.div
                  key={`${index}-${phase.name}`}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ x: 8 }}
                  className="bg-white/10 rounded-lg p-4 backdrop-blur-sm"
                >
                  {/* The status keeps to the name's line while the name has 9rem
                      there, and drops below it when it does not: a long status
                      at 320px left the name a sliver. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
                    <div className="flex items-center gap-4 min-w-0 basis-36 grow">
                      <Building className="w-5 h-5 shrink-0 text-gold" />
                      <div className="min-w-0">
                        <div className="font-semibold break-words">{phase.name}</div>
                        <div className="text-sm text-white break-words">{phase.units}</div>
                      </div>
                    </div>
                    {phase.status && (
                    <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${
                      phase.status === phases.fields.activeStatus ? "bg-gold text-white" : "bg-white/20 text-white"
                    }`}>
                      {phase.status}
                    </span>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div
                    className="h-1.5 bg-white/10 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-label={phase.name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={filled}
                  >
                    <motion.div
                      className="h-full bg-gradient-to-r from-gold to-coral rounded-full"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${filled}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: index * 0.2 }}
                    />
                  </div>
                </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      )}

      {page && <FaqSection pathway="investor" heading={page.faq.fields.heading} />}

      {/* CTA */}
      {closing && !closing.hidden && (
      <section className="py-20 bg-gradient-to-br from-gold/10 to-coral/10">
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
              {closing.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-8">
              <Emphasized text={closing.fields.body} />
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {closingPrimary && (
                <JourneyLink action={closingPrimary.action} onForm={openForm} className="btn-village flex items-center gap-2">
                  {closingPrimary.label}
                  <ArrowRight className="w-5 h-5" />
                </JourneyLink>
              )}
              {closingSecondary && (
                <JourneyLink
                  action={closingSecondary.action}
                  onForm={openForm}
                  className="px-6 py-3 bg-white/90 text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white transition-all flex items-center gap-2"
                >
                  {closingSecondary.label}
                  <ArrowRight className="w-5 h-5" />
                </JourneyLink>
              )}
            </div>
          </motion.div>
        </div>
      </section>
      )}

      {/* Success Message */}
      <AnimatePresence>
        {formSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 bg-sage text-white px-6 py-3 rounded-full shadow-lg z-50"
          >
            {formSuccess}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Investor Pack Form Modal */}
      <Dialog open={showPackForm} onOpenChange={(o) => { if (!o) setShowPackForm(false); }}>
        <DialogContent className="bg-card rounded-2xl p-8 shadow-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-semibold text-foreground">
              Request Investor Pack
            </DialogTitle>
            <DialogDescription className="sr-only">
              Request the full investor pack with financials and development timeline.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePackFormSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Name</label>
              <input
                type="text"
                value={packFormData.name}
                onChange={(e) => setPackFormData({ ...packFormData, name: e.target.value })}
                required
                className="w-full px-4 py-2 bg-muted rounded-lg border border-muted text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Email</label>
              <input
                type="email"
                value={packFormData.email}
                onChange={(e) => setPackFormData({ ...packFormData, email: e.target.value })}
                required
                className="w-full px-4 py-2 bg-muted rounded-lg border border-muted text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Investment Range</label>
              <input
                type="text"
                placeholder={page?.packForm.fields.rangeHint || undefined}
                value={packFormData.investmentRange}
                onChange={(e) => setPackFormData({ ...packFormData, investmentRange: e.target.value })}
                className="w-full px-4 py-2 bg-muted rounded-lg border border-muted text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Message (optional)</label>
              <textarea
                value={packFormData.message}
                onChange={(e) => setPackFormData({ ...packFormData, message: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 bg-muted rounded-lg border border-muted text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep resize-none"
              />
            </div>
            {accreditationOn && (
            <label className="flex items-start gap-3 text-sm text-foreground bg-muted/40 rounded-lg p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={packFormData.accredited}
                onChange={(e) => setPackFormData({ ...packFormData, accredited: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-muted text-teal-deep focus:ring-teal-deep"
              />
              <span className="leading-snug break-words">
                {page?.accreditation.fields.statement}
              </span>
            </label>
            )}
            <PathConsentBox checked={packConsent} onChange={setPackConsent} />
            <button
              type="submit"
              className="w-full bg-teal-deep text-white py-2 rounded-lg font-medium hover:bg-teal-deep-dark transition-colors flex items-center justify-center gap-2 pointer-coarse:min-h-11"
            >
              <Send className="w-4 h-4" />
              Send Request
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Schedule Call Form Modal */}
      <Dialog open={showCallForm} onOpenChange={(o) => { if (!o) setShowCallForm(false); }}>
        <DialogContent className="bg-card rounded-2xl p-8 shadow-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-semibold text-foreground">
              Schedule a Call
            </DialogTitle>
            <DialogDescription className="sr-only">
              Schedule a one-on-one investment call with our team.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCallFormSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Name</label>
              <input
                type="text"
                value={callFormData.name}
                onChange={(e) => setCallFormData({ ...callFormData, name: e.target.value })}
                required
                className="w-full px-4 py-2 bg-muted rounded-lg border border-muted text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Email</label>
              <input
                type="email"
                value={callFormData.email}
                onChange={(e) => setCallFormData({ ...callFormData, email: e.target.value })}
                required
                className="w-full px-4 py-2 bg-muted rounded-lg border border-muted text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Preferred Time</label>
              <input
                type="text"
                placeholder={page?.callForm.fields.timeHint || undefined}
                value={callFormData.preferredTime}
                onChange={(e) => setCallFormData({ ...callFormData, preferredTime: e.target.value })}
                className="w-full px-4 py-2 bg-muted rounded-lg border border-muted text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Message (optional)</label>
              <textarea
                value={callFormData.message}
                onChange={(e) => setCallFormData({ ...callFormData, message: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 bg-muted rounded-lg border border-muted text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep resize-none"
              />
            </div>
            <PathConsentBox checked={callConsent} onChange={setCallConsent} />
            <button
              type="submit"
              className="w-full bg-teal-deep text-white py-2 rounded-lg font-medium hover:bg-teal-deep-dark transition-colors flex items-center justify-center gap-2 pointer-coarse:min-h-11"
            >
              <Send className="w-4 h-4" />
              Request Call
            </button>
          </form>
        </DialogContent>
      </Dialog>

    </Layout>
  );
}
