import Layout from "@/components/Layout";
import { altOr, useBrandImages, useVillageLinks } from "@/lib/gameApi";
import WhyCostaRica from "@/components/WhyCostaRica";
import FaqSection from "@/components/FaqSection";
import { useVillageContent } from "@/hooks/useVillageContent";
import { type MoneyContent } from "@/lib/moneyClaims";
import { useVillageName } from "@/hooks/useVillageName";
import { useTokenName } from "@/hooks/useTokenNames";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";
import { useState, useEffect } from "react";
import { Link } from "wouter";
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


const buildJourneySteps = (villageName: string) => [
  {
    id: "community-call",
    stage: "Visitor",
    title: "Attend Community Call",
    description: `Learn about the basics and ask any immediate questions about living at ${villageName}.`,
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
    title: "Attend Community Events",
    description: `Join potlucks, land tours, and community gatherings to experience ${villageName}'s living culture.`,
    icon: Users,
    // Resolved at render from this village's own eventsUrl.
    link: "",
    linkText: "View Events",
    external: true,
    details: ["Weekly potluck dinners", "Land tours with the founding team", "Community celebrations", "Children's events and family gatherings"]
  },
  {
    id: "founding-seeder",
    stage: "Founding Seeder",
    title: "Become a Founding Seeder",
    description: `Join the Founding Seeders, our waitlist of soul-aligned people securing first access to homes and land at ${villageName}. This is how you raise your hand and say: I'm serious about this.`,
    icon: Sprout,
    // No config home for a waitlist page, and a village's front door is not
    // its waitlist, so this CTA stays hidden until there is a field for it.
    link: "",
    linkText: "Become a Founding Seeder",
    external: true,
    details: ["Join the Founding Seeders waitlist", "First access to homes and land", "Priority as lots are released", "No obligation to purchase"]
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
    title: "Sign the Love Letter / Formal Membership",
    description: "Become an official member of the community by signing the membership agreement.",
    icon: Heart,
    link: "/love-letter",
    linkText: "Read the Love Letter",
    external: false,
    details: ["Read the founding principles", "Attend a membership orientation", "Sign the membership agreement", "Receive your member welcome package"]
  },
  {
    id: "housing",
    stage: "Explorer",
    title: "Explore Housing Options",
    description: "Browse available lots and housing options to find your perfect spot in the village.",
    icon: Home,
    link: "/housing",
    linkText: "View Housing Options",
    external: false,
    details: ["Browse available lots", "Review home design options", "Understand pricing tiers", "Explore financing options"]
  },
  {
    id: "deposit",
    stage: "Deposit",
    title: "Put Down a Deposit on Your Future Home",
    /*
     * THE RANGE IS NOT WRITTEN HERE ANY MORE (founder ruling, 2026-09-03).
     *
     * This sentence said "from $5k to $20k+ depending on the home type you're
     * reserving" as a module constant, and the bullet below repeated it. Every
     * village that deploys this platform therefore published one village's
     * dollar figures under its own name, to prospective residents, with no
     * screen anywhere that could change either of them. Same defect the
     * housing tiers had (0131) and the land figures had (`landFacts` in
     * server/index.ts), so it takes the same answer.
     *
     * `{range}` is filled at render from `money.depositRange` in the runtime
     * content document, and the comma in front of it is supplied by the code,
     * so a founder types the clause and nothing else. A village that has
     * written nothing publishes NO figure and the sentence closes after
     * "deposit": an empty setting and a real zero are different facts, and a
     * placeholder is the defect this change removes.
     */
    description: "Secure your future home with a fully refundable deposit{range}. This holds your place and starts the real conversation.",
    icon: Wallet,
    // Slice 1 of the reservation flow (0077). This stage carried "#" since it
    // was written, so both of Housing.tsx's CTAs pointed at a step that went
    // nowhere. It now reaches the form that records which home and which
    // hamlet a person wants. The deposit itself is still a later step, and
    // when it lands it reuses server/lib/payments.ts.
    link: "/reserve",
    linkText: "Reserve Your Home",
    external: false,
    // The short form of the same figure. It is SPLICED IN at render from
    // `money.depositSummary` when a village has written one, and simply
    // absent when it has not. Two fields for one fact because the sentence
    // and the bullet were worded differently before this change and the
    // ruling was to move the figures, never to reword them.
    details: ["Fully refundable deposit", "Reserves your future home", "Priority on your chosen lot"]
  },
  {
    id: "background",
    stage: "Applicant",
    title: "Background Check",
    // S2 brochure lane, 2026-08-30: dropped "and it's tax deductible" from the
    // default, an unconditional US tax claim attached to a background
    // check. Amora's original wording is preserved as data
    // (legal.membership.backgroundCheckNote in
    // server/seeds/brochure-legal-seed.json) and appended at render time
    // only when a village has published it. See the override below.
    description: "Once your deposit is down, we complete a background check together. It's part of our commitment to community safety",
    icon: FileCheck,
    link: "#",
    linkText: "Coming Soon",
    external: false,
    details: ["Follows your deposit", "Standard background verification", "Community safety commitment", "Confidential handling"]
  },
  {
    id: "fireside",
    stage: "Fireside",
    title: "Fireside Dinner With the Founding Team",
    description: "You're invited to an intimate 1-on-1 fireside dinner with the founding team, in person on the land, or online if you can't make it. A casual, beautiful friendship ritual where both sides explore the commitment fully.",
    icon: Flame,
    link: "#",
    linkText: "By Invitation",
    external: false,
    details: ["Intimate 1-on-1 with the founders", "In person on the land, or online", "A friendship ritual, not an interview", "Explore mutual fit and commitment"]
  },
  {
    id: "family",
    stage: "Family Day",
    title: "Children's Play Day",
    description: "If you have children, attend our family day to see how kids thrive in our community.",
    icon: Baby,
    // Resolved at render from this village's own eventsUrl.
    link: "",
    linkText: "View Family Events",
    external: true,
    details: ["Meet other families", "Experience child-friendly spaces", "Learn about our school plans", "Connect with parents"]
  },
  {
    id: "passage",
    stage: "Initiate",
    title: "Resident Right of Passage",
    description: "Complete the passage with a vote from current residents. Review the Good Neighbor criteria.",
    icon: Award,
    link: "/co-creators-guide",
    linkText: "Good Neighbor Criteria",
    external: false,
    details: ["Demonstrate commitment", "Present to residents", "Receive community consent", "Celebrate your passage"]
  },
  {
    id: "land",
    stage: "Landowner",
    title: "Purchase Land Share Agreement",
    description: "Secure your land with a Land Share Agreement and required Land Credits.",
    icon: Key,
    link: "#",
    linkText: "Learn About Land Shares",
    external: false,
    details: ["Review agreement terms", "Secure financing if needed", "Complete land credits", "Sign your agreement"]
  },
  {
    id: "build",
    stage: "Builder",
    title: "Build Your Home",
    description: "Work with our approved builders or bring your own plans. Observe Resident Governance.",
    icon: Building,
    link: "/housing",
    linkText: "Building Guidelines",
    external: false,
    details: ["Choose your home design", "Select your builder", "Follow building guidelines", "Create your dream home"]
  },
  {
    id: "move-in",
    stage: "Resident",
    title: "Move In Celebration!",
    description: `Welcome home! Celebrate with the ${villageName} Family and begin your life in the village.`,
    icon: Heart,
    link: "#",
    linkText: "Welcome Home",
    external: false,
    details: ["Community welcome ceremony", "Meet your neighbors", "Begin village life", "Celebrate your new home"]
  },
];

/*
 * THE TENURE TITLES, AND WHAT THEY ARE NOT (founder ruling, 2026-09-03).
 *
 * Guardian at 7 years, Elder at 21, Sage at 49. Nothing in the product
 * implements any of it: no capability, no role, no ledger entry and no query
 * anywhere reads a member's years. The founder's ruling is that the titles and
 * the years STAY and the page says plainly what they are, which is
 * recognition. A village may later decide to attach real powers to them, and
 * the section below says that too.
 *
 * THE RIGHTS OF NATURE IS NOT ON THIS LADDER ANY MORE. The Sage entry used to
 * call that member the "Rights of Nature voice", which would leave nature
 * unable to speak until a village's forty-ninth year. Who speaks for nature is
 * a separate design and deliberately not answered here; this file's job was to
 * stop answering it wrongly.
 *
 * It also has to sit beside the standing economics ruling that voice follows
 * CONTRIBUTION, with roles as a recurring contribution type. So nothing in
 * this section may say or imply that years alone grow anybody's voice, and the
 * heading that did say so ("Growing Your Voice") is gone.
 */
const residentProgression = [
  { level: "Resident", description: "Your arrival, you've made the village your home", icon: Home },
  { level: "Guardian", description: "Deep roots, steward of community traditions", icon: Shield, years: "7 years" },
  { level: "Elder", description: "Village wisdom keeper, mentor to new residents", icon: Users, years: "21 years" },
  { level: "Sage", description: "Intergenerational bridge, keeper of the village's longest memory", icon: Crown, years: "49 years" },
];

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
  const villageName = useVillageName();
  const tokenName = useTokenName("Recognition");
  const journeySteps = buildJourneySteps(villageName);
  const brand = useBrandImages();
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>("community-call");
  const [dues, setDues] = useState<VillageDues | null>(null);
  const { content: legal } = useVillageContent<LegalContent>("legal");
  const { content: money } = useVillageContent<MoneyContent>("money");
  const transferNote = legal?.landShareTransferNote?.trim();
  const backgroundCheckNote = legal?.membership?.backgroundCheckNote?.trim();
  const depositRange = money?.depositRange?.trim();
  const depositSummary = money?.depositSummary?.trim();
  // This village's own destinations. Blank hides the control below.
  const { eventsUrl } = useVillageLinks();
  const steps = journeySteps.map((step) => {
    if (step.id === "community-call" || step.id === "events" || step.id === "family") {
      return { ...step, link: eventsUrl };
    }
    if (step.id === "background") {
      return {
        ...step,
        description: backgroundCheckNote
          ? `${step.description}, ${backgroundCheckNote}.`
          : `${step.description}.`,
      };
    }
    if (step.id === "deposit") {
      // The comma belongs to the code, so a founder types the clause alone
      // and an unwritten range leaves no punctuation behind it.
      const details = [...step.details];
      if (depositSummary) details.splice(1, 0, depositSummary);
      return {
        ...step,
        description: step.description.replace(/\{range\}/g, depositRange ? `, ${depositRange}` : ""),
        details,
      };
    }
    return step;
  });

  useEffect(() => {
    // A blocked store threw here, and a half-written value threw one line
    // later: JSON.parse had no guard either. Both now read as no progress,
    // which costs a visitor their ticks and never the page.
    const saved = readStoredJson("local", "amora-resident-progress");
    if (saved.status === "value" && Array.isArray(saved.value)) {
      setCompletedSteps(saved.value.filter((v): v is string => typeof v === "string"));
    }
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setDues(s?.villageDues ?? null))
      .catch(() => { /* leave dues null; prose still renders */ });
  }, []);

  const toggleStep = (stepId: string) => {
    const newCompleted = completedSteps.includes(stepId)
      ? completedSteps.filter(id => id !== stepId)
      : [...completedSteps, stepId];
    setCompletedSteps(newCompleted);
    writeStoredJson("local", "amora-resident-progress", newCompleted);
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
                className="w-12 h-12 rounded-xl bg-teal-deep flex items-center justify-center"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Home className="w-6 h-6 text-white" />
              </motion.div>
              <span className="text-teal-deep font-medium tracking-wide uppercase text-sm">Resident Co-Creator Journey</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="font-display text-5xl md:text-6xl font-semibold text-foreground mb-6"
            >
              Make {villageName}{" "}
              <span className="text-teal-deep italic">Home</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-muted-foreground leading-relaxed mb-8"
            >
              The Resident Space is for those coordinating the success of the whole Village 
              from the perspective of Residents. Find your place in a loving community where 
              all beings belong and thrive.
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
                href="/housing"
                className="px-6 py-3 bg-white/90 text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white transition-all"
              >
                Explore Housing
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Land Share Info */}
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
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground mb-4">
              Land Share Agreements
            </h2>
            <p className="text-muted-foreground">
              Your Land Share Agreement gives you long-term access to your land with the ability
              to renew and pass down to your children{transferNote ? ` ${transferNote}` : ""}. The
              structure holds ownership in the community and gives your family security.
            </p>
          </motion.div>
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
              Your Path to Residency
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
              Each step helps both sides decide. You figure out if {villageName} is right for you; we figure out the same.
            </p>
            
            {/* Progress Bar */}
            <div className="max-w-md mx-auto">
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
                    transition={{ delay: index * 0.03 }}
                    className={`bg-card rounded-xl shadow-sm overflow-hidden transition-all ${
                      isCompleted ? "border-l-4 border-coral" : "border-l-4 border-transparent hover:border-coral/50"
                    }`}
                  >
                    <div 
                      className="p-4 cursor-pointer"
                      onClick={() => setExpandedStep(isExpanded ? null : step.id)}
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
                            toggleStep(step.id);
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
                          <step.icon className={`w-4 h-4 ${isCompleted ? "text-teal-deep" : "text-muted-foreground"}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                isCompleted ? "bg-teal-deep/10 text-teal-deep" : "bg-muted text-muted-foreground"
                              }`}>
                                {step.stage}
                              </span>
                              <h3 className={`font-display text-base font-semibold ${
                                isCompleted ? "text-muted-foreground" : "text-foreground"
                              }`}>
                                {step.title}
                              </h3>
                            </div>
                            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
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
                            <p className="text-sm text-muted-foreground mb-3">{step.description}</p>
                            <div className="bg-muted/50 rounded-lg p-3 mb-3">
                              <ul className="grid grid-cols-2 gap-1.5">
                                {step.details.map((detail, i) => (
                                  <motion.li 
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    className="flex items-center gap-2 text-xs text-muted-foreground"
                                  >
                                    <div className="w-1 h-1 rounded-full bg-teal-deep" />
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
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-teal-deep text-white rounded-full text-xs font-medium hover:opacity-90 transition-opacity"
                              >
                                {step.linkText}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <Link
                                href={step.link}
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-teal-deep text-white rounded-full text-xs font-medium hover:opacity-90 transition-opacity"
                              >
                                {step.linkText}
                                <ArrowRight className="w-3 h-3" />
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

      <WhyCostaRica />

      {/* Resident Progression */}
      <section className="py-20 bg-teal-deep text-white">
        <div className="container">
          <motion.div 
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold mb-4">
              Titles for Time Here
            </h2>
            <p className="text-white/70 max-w-2xl mx-auto">
              {villageName} marks long presence with a title. These titles are honorary: they
              carry no voice in governance and no rights today. Voice comes from what you
              contribute, and a village may decide later to attach powers of its own to these
              titles.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {residentProgression.map((level, index) => (
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
                  className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4"
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.5 }}
                >
                  <level.icon className="w-7 h-7" />
                </motion.div>
                <h3 className="font-display text-xl font-semibold mb-2">
                  {level.level}
                </h3>
                {level.years && (
                  <p className="text-white/60 text-xs mb-3 uppercase tracking-wide">
                    {level.years}+
                  </p>
                )}
                <p className="text-white/90 text-sm">
                  {level.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Village Dues */}
      <section className="py-20 bg-cream">
        <div className="container">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Village Dues
            </h2>
            {dues?.amount && (
              <div className="mb-6">
                <span className="font-display text-5xl md:text-6xl font-bold text-teal-deep">
                  {dues.currency || "$"}{dues.amount}
                </span>
                <span className="text-xl text-muted-foreground"> / {dues.period || "month"}</span>
              </div>
            )}
            <p className="text-muted-foreground mb-6">
              {dues?.note?.trim()
                ? dues.note
                : `As a resident, you'll pay Village Dues that cover utilities, maintenance, and community services. These can be offset through ${tokenName}, a living record of the value you contribute, not a fixed dollar amount. Together, we work to reduce costs and create surplus that benefits everyone.`}
            </p>
            <Link
              href="/how-we-create"
              className="inline-flex items-center gap-2 text-teal-deep font-medium hover:gap-3 transition-all"
            >
              Learn How {tokenName} Works
              <ArrowRight className="w-4 h-4" />
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
              As a resident you are a co-owner of this village, not a tenant. Read the full covenant that protects you and defines what we're building together.
            </p>
            <Link
              href="/resident-rights"
              className="btn-amora inline-flex items-center gap-2"
            >
              Read Rights and Responsibilities
              <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Your Next Step CTA */}
      <section className="py-20 bg-teal-deep/5">
        <div className="container">
          <motion.div 
            className="max-w-2xl mx-auto text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Your Next Step
            </h2>
            <p className="text-muted-foreground mb-8">
              Schedule a village visit to experience {villageName} firsthand and ask any questions 
              about becoming a resident.
            </p>
            <Link href="/visit" className="btn-amora inline-flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Schedule a Village Visit
            </Link>
          </motion.div>
        </div>
      </section>

      <FaqSection pathway="resident" />

      {/* CTA */}
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
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Find Your Home
            </h2>
            <p className="text-muted-foreground mb-8">
              Start with a community call to learn about life at {villageName}, 
              then explore our housing options and available lots.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-amora flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Join Community Call
                </a>
              )}
              <Link
                href="/housing"
                className="px-6 py-3 bg-white text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-white/90 transition-all border border-border"
              >
                View Housing Options
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
