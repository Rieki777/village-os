import Layout from "@/components/Layout";
import { useVillageLinks } from "@/lib/gameApi";
import { altOr, useBrandImages } from "@/lib/gameApi";
import FaqSection from "@/components/FaqSection";
import { useVillageName } from "@/hooks/useVillageName";
import { useTokenName } from "@/hooks/useTokenNames";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";
import { useState, useEffect } from "react";
import { Link } from "wouter";
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


const buildJourneySteps = (villageName: string, tokenName: string) => [
  {
    id: "community-call",
    stage: "Visitor",
    title: "Attend Community Call",
    description: `Learn about the basics and ask any immediate questions about ${villageName}.`,
    icon: Calendar,
    // Resolved at render from this village's own eventsUrl.
    link: "",
    linkText: "Join Community Call",
    external: true,
    details: ["Meet the founding team", "Learn about our vision", "Ask questions live", "Connect with other visitors"]
  },
  {
    id: "events",
    stage: "Guest",
    title: "Participate in Events",
    description: "Join potlucks, events, workshops, and parties on our land to experience the community.",
    icon: Users,
    // Resolved at render from this village's own eventsUrl.
    link: "",
    linkText: "View Events",
    external: true,
    details: ["Weekly potlucks", "Village weaving gatherings", "Land tours", "Workshops and retreats"]
  },
  {
    id: "immersion",
    stage: "Immersant",
    title: "Village Weaving Immersion (Optional)",
    description: "Optional: spend immersive time in the village learning how it operates, observing circles in action, and discovering where your gifts are most needed. A beautiful step, but not required.",
    icon: Users,
    link: "/circles",
    linkText: "Learn About Circles",
    external: false,
    details: ["Optional, join if it calls you", "2-4 week immersion period", "Shadow existing circle members", "Identify your R-Ikigai fit"]
  },
  {
    id: "training",
    stage: "Participant",
    title: "Community Training",
    description: "Either complete our training in NVC (Nonviolent Communication), authentic relating, and other community practices, or demonstrate you already know and live these essential practices.",
    icon: BookOpen,
    link: "/training",
    linkText: "Learn About Training",
    external: false,
    details: ["Do the training, or show you already live it", "Nonviolent Communication basics", "Authentic relating practices", "Consent-based decision making"]
  },
  {
    id: "love-letter",
    stage: "Member",
    title: `Join the ${villageName} Family`,
    // S2 brochure lane, 2026-08-30: dropped "Amora 508c1a", a US tax-entity
    // reference stated as this village's own on every fork. See LoveLetter.tsx
    // and server/seeds/brochure-legal-seed.json (legal.membership.entityLabel).
    description: "Contemplate and sign our Love Letter, formally becoming a member of the community.",
    icon: Heart,
    link: "/love-letter",
    linkText: "Read the Love Letter",
    external: false,
    details: ["Understand our values deeply", "Reflect on your commitment", "Sign the Love Letter", `Join the ${villageName} Family`]
  },
  {
    id: "circle",
    stage: "Contributor",
    title: "Participate in a Circle",
    description: "Join one of our sociocratic circles to contribute to community decision-making.",
    icon: Users,
    link: "/circles",
    linkText: "Explore Circles",
    external: false,
    details: ["Choose a circle aligned with your gifts", "Attend circle meetings", "Participate in consent rounds", "Build relationships with circle members"]
  },
  {
    id: "quests",
    stage: "Quest Seeker",
    title: "Explore Quests",
    description: "Take on quests to contribute meaningfully to the village, or propose your own quest if you don't see your gift. A great way to demonstrate your commitment.",
    icon: Compass,
    link: "/quests",
    linkText: "View Quests",
    external: false,
    details: ["Browse available quests", "Choose quests matching your skills", "Submit your own quest proposal", `Earn ${tokenName} for contributions`]
  },
  {
    id: "passage",
    stage: "Initiate",
    title: "Co-Creator Right of Passage",
    description: "Complete the right of passage with a vote from the Co-Creators circle to become a full member.",
    icon: Award,
    link: "/co-creators-guide",
    linkText: "Read Co-Creator Criteria",
    external: false,
    details: ["Demonstrate sustained commitment", "Present to the Co-Creators circle", "Receive consent from members", "Celebrate your passage"]
  },
  {
    id: "roles",
    stage: "Co-Creator",
    title: "Explore & Apply for Roles",
    description: "Find a role that aligns with your gifts and apply for the upcoming season.",
    icon: Star,
    link: "/roles",
    linkText: "Explore Roles",
    external: false,
    details: ["Review available roles", "Propose your role contribution", "Receive circle consent", "Begin your seasonal role"]
  },
];

const advancementPath = (tokenName: string) => [
  {
    level: "Role Holder",
    requirement: "Apply and be approved for a seasonal role",
    benefits: `Compensation in ${tokenName}, voice in your circle`,
    icon: Star,
  },
  {
    level: "Guide",
    requirement: "After multiple seasons in a role",
    benefits: "Increased compensation, mentorship responsibilities",
    icon: Compass,
  },
  {
    level: "Sage",
    requirement: "After seasons as a Guide",
    benefits: "Highest voice, wisdom keeper, strategic guidance",
    icon: Crown,
  },
];

const longTermArc = [
  {
    level: "Guide",
    description: "Mentor to newer stewards and circle facilitators",
    icon: Compass,
  },
  {
    level: "Sage",
    description: "Village wisdom keeper and strategic guide",
    icon: Crown,
  },
];

export default function StewardJourney() {
  // This village's own destinations. Blank hides the control.
  const { eventsUrl } = useVillageLinks();
  const villageName = useVillageName();
  const tokenName = useTokenName("Recognition");
  const journeySteps = buildJourneySteps(villageName, tokenName);
  const steps = journeySteps.map((step) =>
    step.id === "community-call" || step.id === "events"
      ? { ...step, link: eventsUrl }
      : step,
  );
  const brand = useBrandImages();
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>("community-call");

  useEffect(() => {
    // A blocked store threw here, and a half-written value threw one line
    // later: JSON.parse had no guard either. Both now read as no progress,
    // which costs a visitor their ticks and never the page.
    const saved = readStoredJson("local", "amora-steward-progress");
    if (saved.status === "value" && Array.isArray(saved.value)) {
      setCompletedSteps(saved.value.filter((v): v is string => typeof v === "string"));
    }
  }, []);

  const toggleStep = (stepId: string) => {
    const newCompleted = completedSteps.includes(stepId)
      ? completedSteps.filter(id => id !== stepId)
      : [...completedSteps, stepId];
    setCompletedSteps(newCompleted);
    writeStoredJson("local", "amora-steward-progress", newCompleted);
  };

  const progress = (completedSteps.length / journeySteps.length) * 100;

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
                className="w-12 h-12 rounded-xl bg-sage flex items-center justify-center"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Users className="w-6 h-6 text-white" />
              </motion.div>
              <span className="text-sage font-medium tracking-wide uppercase text-sm">Village Steward Journey</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="font-display text-5xl md:text-6xl font-semibold text-foreground mb-6"
            >
              Steward the{" "}
              <span className="text-sage italic">Village</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-muted-foreground leading-relaxed mb-8"
            >
              The Village Steward Space is for those coordinating and executing 
              for the success of the whole Village. Join circles, take on roles, and help 
              shape our regenerative community through sociocratic governance.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap gap-4"
            >
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-amora flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Start with Community Call
                </a>
              )}
              <Link
                href="/how-we-create"
                className="px-6 py-3 bg-white/90 text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white transition-all"
              >
                Learn How We Create
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Interactive Journey Steps */}
      <section className="py-20 bg-background">
        <div className="container">
          <motion.div 
            className="text-center mb-8"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Your Journey to Co-Creation
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
              Each step deepens your connection with the community and helps you find where your gifts fit.
            </p>
            
            {/* Progress Bar */}
            <div className="max-w-md mx-auto">
              <div className="relative h-3 bg-muted rounded-full overflow-hidden mb-2">
                <motion.div 
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-sage to-coral rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {completedSteps.length} of {journeySteps.length} steps completed
              </p>
            </div>
          </motion.div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-3">
              {steps.map((step, index) => {
                const isCompleted = completedSteps.includes(step.id);
                const isExpanded = expandedStep === step.id;
                
                return (
                  <motion.div
                    key={step.id}
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
                      onClick={() => setExpandedStep(isExpanded ? null : step.id)}
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
                            toggleStep(step.id);
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
                          <step.icon className={`w-5 h-5 ${isCompleted ? "text-sage" : "text-teal-deep"}`} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                isCompleted ? "bg-sage/10 text-sage" : "bg-muted text-muted-foreground"
                              }`}>
                                {step.stage}
                              </span>
                              <h3 className={`font-display text-lg font-semibold ${
                                isCompleted ? "text-muted-foreground" : "text-foreground"
                              }`}>
                                {step.title}
                              </h3>
                            </div>
                            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                              <ChevronDown className="w-5 h-5 text-muted-foreground" />
                            </motion.div>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
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
                                {step.details.map((detail, i) => (
                                  <motion.li 
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="flex items-center gap-2 text-sm text-muted-foreground"
                                  >
                                    <div className="w-1.5 h-1.5 rounded-full bg-sage" />
                                    {detail}
                                  </motion.li>
                                ))}
                              </ul>
                            </div>
                            {!step.link ? null : step.external ? (
                              <a
                                href={step.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-sage text-white rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
                              >
                                {step.linkText}
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            ) : (
                              <Link
                                href={step.link}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-sage text-white rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
                              >
                                {step.linkText}
                                <ArrowRight className="w-4 h-4" />
                              </Link>
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

      {/* Advancement Path */}
      <section className="py-20 bg-sage text-white">
        <div className="container">
          <motion.div 
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold mb-4">
              The Path of Growth
            </h2>
            <p className="text-white/70 max-w-2xl mx-auto">
              Each new season requires successful role proposals to continue. 
              As you grow, so does your voice and responsibility.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {advancementPath(tokenName).map((level, index) => (
              <motion.div
                key={level.level}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8, scale: 1.02 }}
                className="bg-white/10 p-6 rounded-xl text-center backdrop-blur-sm"
              >
                <motion.div 
                  className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4"
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.5 }}
                >
                  <level.icon className="w-8 h-8" />
                </motion.div>
                <h3 className="font-display text-xl font-semibold mb-2">
                  {level.level}
                </h3>
                <p className="text-white/70 text-sm mb-3">
                  {level.requirement}
                </p>
                <p className="text-white/90 text-sm font-medium">
                  {level.benefits}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Long-Term Arc */}
      <section className="py-20 bg-sage/5">
        <div className="container">
          <motion.div 
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Long-Term Growth
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Your role deepens with each season.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {longTermArc.map((level, index) => (
              <motion.div
                key={level.level}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8, scale: 1.02 }}
                className="bg-card p-6 rounded-xl shadow-sm border border-sage/20"
              >
                <motion.div 
                  className="w-14 h-14 rounded-full bg-sage/10 flex items-center justify-center mx-auto mb-4"
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.5 }}
                >
                  <level.icon className="w-7 h-7 text-sage" />
                </motion.div>
                <h3 className="font-display text-xl font-semibold text-foreground text-center mb-2">
                  {level.level}
                </h3>
                <p className="text-center text-muted-foreground text-sm">
                  {level.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Seasonal Rhythm */}
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
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Seasonal Festivals
            </h2>
            <p className="text-muted-foreground mb-8">
              Every 3 months, the community votes on what kind of season comes next. Seasons aren't on a fixed cycle, they're chosen based on what {villageName} needs. Spring for new builds, Summer for events and energy, Fall for harvest and reflection, Winter for systems design and planning. Each seasonal transition is marked by a festival.
            </p>
            <Link
              href="/how-we-create"
              className="btn-amora inline-flex items-center gap-2"
            >
              Learn About Our Seasons
              <ArrowRight className="w-5 h-5" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Rights & Responsibilities */}
      <section className="py-16 bg-background">
        <div className="container">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground mb-3">
              Your Rights and Responsibilities
            </h2>
            <p className="text-muted-foreground mb-6">
              As a Village Steward, you hold real ownership of this place, and real responsibility for it. Read the full covenant between co-owners.
            </p>
            <Link
              href="/steward-rights"
              className="btn-amora inline-flex items-center gap-2"
            >
              Read Rights and Responsibilities
              <ArrowRight className="w-5 h-5" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Your Next Step */}
      <section className="py-20 bg-sage/10">
        <div className="container">
          <motion.div
            className="max-w-2xl mx-auto"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <div className="text-center mb-8">
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
                Your Next Step
              </h2>
              <p className="text-muted-foreground">
                Tell us where you're coming from and what calls you here. We'll
                reach out with the right invitation.
              </p>
            </div>

            <StewardNextStepForm />
          </motion.div>
        </div>
      </section>

      <FaqSection pathway="steward" />
    </Layout>
  );
}

function StewardNextStepForm() {
  // Blank hides the two invitations below rather than sending a
  // would-be steward to a different village's calendar.
  const { eventsUrl } = useVillageLinks();
  const [form, setForm] = useState({ name: "", email: "", gifts: "", question: "" });
  const [submitted, setSubmitted] = useState(false);
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
        body: JSON.stringify({ type: "steward-interest", data: form }),
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
        <h3 className="font-display text-2xl font-bold text-foreground mb-3">
          Welcome, future Steward.
        </h3>
        <p className="text-muted-foreground mb-6">
          We've received your message and will be in touch soon with your next
          invitation into the village.
        </p>
        {eventsUrl && (
          <a
            href={eventsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-lg font-semibold hover:opacity-90 transition-opacity"
          >
            <Calendar className="w-5 h-5" />
            Join the Next Community Call
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
            className="w-full px-4 py-2.5 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
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
            className="w-full px-4 py-2.5 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="you@example.com"
          />
        </div>
      </div>

      <div>
        <label htmlFor="steward-gifts" className="block text-sm font-medium text-foreground mb-1.5">
          What gifts do you bring? (skills, time, passion)
        </label>
        <input
          id="steward-gifts"
          type="text"
          value={form.gifts}
          onChange={(e) => setForm((f) => ({ ...f, gifts: e.target.value }))}
          className="w-full px-4 py-2.5 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="e.g. regenerative farming, facilitation, web development..."
        />
      </div>

      <div>
        <label htmlFor="steward-question" className="block text-sm font-medium text-foreground mb-1.5">
          What called you to stewardship?
        </label>
        <textarea
          id="steward-question"
          rows={3}
          value={form.question}
          onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
          className="w-full px-4 py-2.5 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          placeholder="Share what resonated, what you're looking for, or any questions on your heart..."
        />
      </div>

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
        className="w-full py-3 bg-sage text-white rounded-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <span>Sending...</span>
        ) : (
          <>
            <Heart className="w-5 h-5" />
            Begin My Stewardship Journey
          </>
        )}
      </button>
      {eventsUrl && (
        <p className="text-xs text-muted-foreground text-center">
          Or{" "}
          <a
            href={eventsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            join our next community call
          </a>{" "}
          to learn more first.
        </p>
      )}
    </form>
  );
}
