import Layout from "@/components/Layout";
import { altOr, statedFacts, useBrandImages, useVillageLinks, useVillageSettings } from "@/lib/gameApi";
import WhyCostaRica from "@/components/WhyCostaRica";
import FaqSection from "@/components/FaqSection";
import { useVillageName } from "@/hooks/useVillageName";
import InvestorSummary from "@/components/InvestorSummary";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { 
  TrendingUp, 
  ArrowRight, 
  CheckCircle2,
  Circle,
  FileText,
  Calendar,
  DollarSign,
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
  MessageSquare
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

// New investor-focused image showing sustainable luxury development

const buildJourneySteps = (villageName: string) => [
  {
    id: "discover",
    stage: "Curious",
    title: `Discover ${villageName}`,
    description: "Learn about our vision, values, and regenerative approach to community development.",
    icon: Sparkles,
    action: "Join Community Call",
    // Resolved at render from this village's own eventsUrl. Blank here so no
    // village inherits another village's calendar.
    link: "",
    external: true,
    details: [
      "Understand our mission and values",
      "Learn about the land and location",
      "Meet the founding team",
      "Ask questions in a live Q&A"
    ]
  },
  {
    id: "request",
    stage: "Interested",
    title: "Request Investor Pack",
    description: "Receive the full investor pack: feasibility study, proformas, and development timeline.",
    icon: FileText,
    action: "Request Pack",
    formType: "investor-pack",
    details: [
      "15-year financial proformas",
      "Feasibility study with market analysis",
      "Development timeline and phases",
      "Legal structure overview"
    ]
  },
  {
    id: "call",
    stage: "Exploring",
    title: "Schedule Investment Call",
    description: `Connect one-on-one with our team to discuss your investment goals and how they align with ${villageName}.`,
    icon: Calendar,
    action: "Schedule Call",
    formType: "investor-call",
    details: [
      "Discuss investment options",
      "Review financial projections",
      "Understand debt vs equity structures",
      "Explore your path to residency"
    ]
  },
  {
    id: "commit",
    stage: "Committed",
    title: "Make Your Commitment",
    description: `Choose your investment vehicle and formalize your contribution to the ${villageName} vision.`,
    icon: Heart,
    action: "Contact Team",
    // Resolved at render from this village's own contactEmail. An investment
    // commitment is the single worst enquiry to misroute, so blank hides the
    // control entirely rather than addressing it to somebody else.
    link: "",
    external: true,
    details: [
      "Select investment structure",
      "Review and sign agreements",
      "Transfer funds securely",
      "Receive investor updates"
    ]
  },
];


const developmentPhases = [
  { phase: "Resort & Retreat Center", units: "120-150 keys", status: "Planning", progress: 15 },
  { phase: "Health Center", units: "1 facility", status: "Planning", progress: 10 },
  { phase: "Community Center & Café", units: "1 facility", status: "Planning", progress: 20 },
  { phase: "Show Homes", units: "10 homes", status: "Planning", progress: 25 },
  { phase: "Residential Lots", units: "150+ lots", status: "Future", progress: 5 },
];

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
 * What stays here is the SHAPE of the tile: its heading, its icon, its colour,
 * and the sentence explaining what the figure means. What a figure IS comes
 * from the village, through Admin, Settings. A village that has stated none of
 * them gets the honest sentence below rather than an empty grid, and never a
 * default: a number nobody typed is a claim nobody made.
 */
const metricShapes = [
  { key: "appreciation", title: "Land Value", detail: "Change in the value of this village's land.", icon: TrendingUp, color: "bg-teal-deep/10 text-teal-deep" },
  { key: "appraisal", title: "Appraisal", detail: "Current property valuation.", icon: Building, color: "bg-gold/10 text-gold" },
  { key: "projectedReturn", title: "Projected Return", detail: "Based on phased development.", icon: BarChart3, color: "bg-coral/10 text-coral" },
  { key: "targetRaise", title: "Target Raise", detail: "What this phase is raising.", icon: Zap, color: "bg-sage/10 text-sage" },
];

const buyerPersonas = [
  {
    title: "Digital Nomad Couple",
    subtitle: "Invest from anywhere, build your future haven",
    icon: MapPin,
    color: "from-teal-deep to-teal-deep-dark"
  },
  {
    title: "Worldschooling Family",
    subtitle: "Create a home base while the world is your classroom",
    icon: Users,
    color: "from-gold to-coral"
  },
  {
    title: "Retiree/Snowbird",
    subtitle: "A sanctuary of your own, with community and returns",
    icon: Heart,
    color: "from-sage to-teal-deep"
  },
  {
    title: "Longevity Seeker",
    subtitle: "Where your years are extended by regenerative living",
    icon: Sparkles,
    color: "from-coral to-gold"
  },
  {
    title: "Remote Exec/Founder",
    subtitle: "Build wealth while building a better world",
    icon: TrendingUp,
    color: "from-teal-deep to-sage"
  },
  {
    // Was "Costa Rican/LatAm Professional". The persona is real in every
    // region; only the region was one village's. The subtitle already said
    // "your homeland", which carries the whole idea without a map.
    title: "Local & Regional Professional",
    subtitle: "Invest in your homeland's regenerative future",
    icon: Building,
    color: "from-gold to-teal-deep"
  }
];


export default function InvestorJourney() {
  const villageName = useVillageName();
  const journeySteps = buildJourneySteps(villageName);
  const brand = useBrandImages();
  const settings = useVillageSettings();
  // NULL IS "NOT LOADED YET", NEVER "NOTHING STATED". Without this line the
  // page tells every visitor "this village has not published any figures" for
  // the length of one fetch, including on a village that has published four,
  // which is a sentence the product would be saying out of a default rather
  // than out of what happened.
  const loaded = settings !== null;
  const financialMetrics = statedFacts(settings, metricShapes);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>("discover");
  const [showPackForm, setShowPackForm] = useState(false);
  const [showCallForm, setShowCallForm] = useState(false);
  const [packFormData, setPackFormData] = useState({ name: "", email: "", investmentRange: "", message: "", accredited: false });
  const [callFormData, setCallFormData] = useState({ name: "", email: "", preferredTime: "", message: "" });
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  // This village's own destinations. Blank hides the control that uses one.
  const { eventsUrl, contactEmail, mailTo } = useVillageLinks();
  const commitHref = mailTo("Investment Commitment");
  const steps = journeySteps.map((step) => {
    if (step.id === "discover") return { ...step, link: eventsUrl };
    if (step.id === "commit") return { ...step, link: commitHref };
    return step;
  });
  // Named once so the two failure paths below cannot drift apart. With no
  // published address the sentence simply stops after "try again": pointing a
  // failed investor at a mailbox this village does not own is how the lead
  // disappears without anybody noticing.
  const retryNote = contactEmail
    ? `Something went wrong. Please try again or email ${contactEmail}.`
    : "Something went wrong. Please try again.";

  // Load progress from localStorage
  useEffect(() => {
    // A blocked store threw here, and a half-written value threw one line
    // later: JSON.parse had no guard either. Both now read as no progress,
    // which costs a visitor their ticks and never the page.
    const saved = readStoredJson("local", "amora-investor-progress");
    if (saved.status === "value" && Array.isArray(saved.value)) {
      setCompletedSteps(saved.value.filter((v): v is string => typeof v === "string"));
    }
  }, []);

  // Save progress to localStorage
  const toggleStep = (stepId: string) => {
    const newCompleted = completedSteps.includes(stepId)
      ? completedSteps.filter(id => id !== stepId)
      : [...completedSteps, stepId];
    setCompletedSteps(newCompleted);
    writeStoredJson("local", "amora-investor-progress", newCompleted);
  };

  const progress = (completedSteps.length / journeySteps.length) * 100;

  const handlePackFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packFormData.accredited) {
      setFormSuccess("Please confirm you are an accredited investor.");
      setTimeout(() => setFormSuccess(null), 4000);
      return;
    }
    try {
      const response = await fetch("/api/investor-docs/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: packFormData.name,
          email: packFormData.email,
          accredited: packFormData.accredited,
        }),
      });
      if (response.ok) {
        const result = await response.json().catch(() => ({}));
        setFormSuccess(result.message || "Check your email - we've sent you the full investor packet.");
        setShowPackForm(false);
        setPackFormData({ name: "", email: "", investmentRange: "", message: "", accredited: false });
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
          data: callFormData
        })
      });
      if (response.ok) {
        setFormSuccess("Thank you! Our team will be in touch within 48 hours.");
        setShowCallForm(false);
        setCallFormData({ name: "", email: "", preferredTime: "", message: "" });
        setTimeout(() => setFormSuccess(null), 5000);
      }
    } catch (error) {
      console.error("Form submission error:", error);
    }
  };

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
          <div className="max-w-2xl">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 mb-6"
            >
              <motion.div 
                className="w-12 h-12 rounded-xl bg-gold flex items-center justify-center"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <TrendingUp className="w-6 h-6 text-white" />
              </motion.div>
              <span className="text-gold font-medium tracking-wide uppercase text-sm">Capital Contributor Journey</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="font-display text-5xl md:text-6xl font-semibold text-foreground mb-6"
            >
              Invest in{" "}
              <span className="text-teal-deep italic">Regeneration</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-muted-foreground leading-relaxed mb-8"
            >
              Capital Contributors offer financial resources, credit lines, investments,
              or other capital resources. We prioritize investors who share the vision -
              capital structured to deliver real returns while keeping the village
              in the hands of the people who call it home.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap gap-4"
            >
              {/* This asked for the investor pack by mail. The page already
                  serves that exact request with its own form, posting to this
                  village's own /api/forms/submit, so the hero now opens that
                  form. Better than hiding it: the lead is captured either way,
                  it reaches the right village, and the request now passes
                  through the accreditation step the journey already had rather
                  than around it. */}
              <button
                type="button"
                onClick={() => setShowPackForm(true)}
                className="btn-amora flex items-center gap-2"
              >
                <FileText className="w-5 h-5" />
                Request Investor Pack
              </button>
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-white/90 text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white transition-all flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Join Community Call
                </a>
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Financial Metrics Section */}
      <section className="py-20 bg-background border-t border-b border-muted">
        <div className="container">
          <motion.div 
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Key Numbers
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
              {!loaded
                ? " "
                : financialMetrics.length
                ? "The figures this village has stated about its own land and its own raise."
                : "This village has not published any figures yet."}
            </p>
            {financialMetrics.length ? (
              <p className="text-xs text-muted-foreground italic max-w-2xl mx-auto">
                Past performance and projections are not guarantees of future results.
              </p>
            ) : null}
          </motion.div>

          {!loaded ? null : financialMetrics.length ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {financialMetrics.map((metric, index) => (
              <motion.div
                key={metric.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8 }}
                className={`${metric.color} rounded-xl p-8 shadow-sm transition-all`}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    {metric.title}
                  </h3>
                  <metric.icon className="w-6 h-6 opacity-90" />
                </div>
                <div className="mb-2">
                  <div className="font-display text-4xl font-semibold text-foreground">
                    {metric.value}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium mt-1">
                    {metric.note}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {metric.detail}
                </p>
              </motion.div>
            ))}
          </div>
          ) : (
            /* R56: state what is true and get out of the way. A village with no
               figures yet is early, and saying so beats an empty grid. */
            <p className="text-center text-muted-foreground max-w-xl mx-auto">
              Land value, appraisal, projected return and the raise appear here once the
              village fills them in under Admin, Settings.
            </p>
          )}
        </div>
      </section>

      <InvestorSummary />

      {/* Who invests in this village */}
      <section className="py-20 bg-cream">
        <div className="container">
          <motion.div 
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Who Invests in {villageName}?
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              People with different goals and backgrounds are building at {villageName}. See if your story is here.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {buyerPersonas.map((persona, index) => (
              <motion.div
                key={persona.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8 }}
                className={`bg-gradient-to-br ${persona.color} rounded-xl p-8 shadow-sm text-white transition-all`}
              >
                <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mb-4">
                  <persona.icon className="w-6 h-6" />
                </div>
                <h3 className="font-display text-xl font-semibold mb-2">
                  {persona.title}
                </h3>
                <p className="text-white leading-relaxed">
                  {persona.subtitle}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <WhyCostaRica />

      {/* Interactive Journey Steps */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            <motion.div 
              className="text-center mb-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
                Your Investment Journey
              </h2>
              <p className="text-muted-foreground mb-6">
                Track your progress as you explore investment opportunities at {villageName}.
              </p>
              
              {/* Progress Bar */}
              <div className="relative h-3 bg-muted rounded-full overflow-hidden mb-2">
                <motion.div 
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-coral to-gold rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {completedSteps.length} of {journeySteps.length} steps completed
              </p>
            </motion.div>

            <div className="space-y-4">
              {steps.map((step, index) => {
                const isCompleted = completedSteps.includes(step.id);
                const isExpanded = expandedStep === step.id;
                
                return (
                  <motion.div
                    key={step.id}
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
                      onClick={() => setExpandedStep(isExpanded ? null : step.id)}
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
                            toggleStep(step.id);
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
                          <step.icon className={`w-6 h-6 ${isCompleted ? "text-sage" : "text-teal-deep"}`} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-block px-2 py-1 bg-teal-deep/10 text-teal-deep text-xs font-semibold rounded-full">
                              Stage: {step.stage}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <h3 className={`font-display text-xl font-semibold ${
                              isCompleted ? "text-muted-foreground line-through" : "text-foreground"
                            }`}>
                              {step.title}
                            </h3>
                            <motion.div
                              animate={{ rotate: isExpanded ? 180 : 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <ChevronDown className="w-5 h-5 text-muted-foreground" />
                            </motion.div>
                          </div>
                          <p className="text-muted-foreground mt-1">
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
                                {step.details.map((detail, i) => (
                                  <motion.li 
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.1 }}
                                    className="flex items-center gap-2 text-sm text-muted-foreground"
                                  >
                                    <div className="w-1.5 h-1.5 rounded-full bg-teal-deep" />
                                    {detail}
                                  </motion.li>
                                ))}
                              </ul>
                            </div>
                            {step.formType === "investor-pack" ? (
                              <button
                                onClick={() => setShowPackForm(true)}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-full text-sm font-medium hover:bg-teal-deep-dark transition-colors"
                              >
                                {step.action}
                                <ArrowRight className="w-4 h-4" />
                              </button>
                            ) : step.formType === "investor-call" ? (
                              <button
                                onClick={() => setShowCallForm(true)}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-full text-sm font-medium hover:bg-teal-deep-dark transition-colors"
                              >
                                {step.action}
                                <ArrowRight className="w-4 h-4" />
                              </button>
                            ) : step.link ? (
                              <a
                                href={step.link}
                                target={step.external ? "_blank" : undefined}
                                rel={step.external ? "noopener noreferrer" : undefined}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-full text-sm font-medium hover:bg-teal-deep-dark transition-colors"
                              >
                                {step.action}
                                {step.external ? <ExternalLink className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                              </a>
                            ) : null}
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

      {/* Development Phases */}
      <section className="py-20 bg-teal-deep text-white">
        <div className="container">
          <motion.div 
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold mb-4">
              Development Phases
            </h2>
            <p className="text-white max-w-2xl mx-auto">
              With the potential 1% regenerative development loan, multiple phases can proceed simultaneously.
            </p>
          </motion.div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-4">
              {developmentPhases.map((phase, index) => (
                <motion.div
                  key={phase.phase}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ x: 8 }}
                  className="bg-white/10 rounded-lg p-4 backdrop-blur-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-4">
                      <Building className="w-5 h-5 text-gold" />
                      <div>
                        <div className="font-semibold">{phase.phase}</div>
                        <div className="text-sm text-white">{phase.units}</div>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      phase.status === "Planning" ? "bg-gold/20 text-gold" : "bg-white/20 text-white"
                    }`}>
                      {phase.status}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-gradient-to-r from-gold to-coral rounded-full"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${phase.progress}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: index * 0.2 }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <FaqSection pathway="investor" heading="Investor FAQs" />

      {/* CTA */}
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
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Ready to Explore?
            </h2>
            <p className="text-muted-foreground mb-8">
              Connect with our team to discuss how {villageName} fits your investment goals.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <button
                onClick={() => setShowPackForm(true)}
                className="btn-amora flex items-center gap-2"
              >
                Request Investor Pack
                <ArrowRight className="w-5 h-5" />
              </button>
              <Link
                href="/master-plan"
                className="px-6 py-3 bg-white/90 text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white transition-all flex items-center gap-2"
              >
                View the Master Plan
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

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
                placeholder="e.g., $50K - $250K"
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
            <label className="flex items-start gap-3 text-sm text-foreground bg-muted/40 rounded-lg p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={packFormData.accredited}
                onChange={(e) => setPackFormData({ ...packFormData, accredited: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-muted text-teal-deep focus:ring-teal-deep"
              />
              <span className="leading-snug">
                I confirm I am an accredited investor.
              </span>
            </label>
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
                placeholder="e.g., Tuesday 2pm EST"
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
