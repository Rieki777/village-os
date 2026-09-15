import Layout from "@/components/Layout";
import { useHypha } from "@/modules/ModuleProvider";
import { useVillageLinks } from "@/lib/gameApi";
import { useVillageName } from "@/hooks/useVillageName";
import { useTokenName, useValueTokenName } from "@/hooks/useTokenNames";
import { useValueConversion } from "@/lib/moneyClaims";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  BookOpen,
  ArrowRight,
  Heart,
  Users,
  Calendar,
  Zap,
  Target,
  Star,
  Compass,
  Crown,
  Home,
  Sparkles,
  TreePine,
  Circle,
  CheckCircle2,
  MessageCircle,
  MapPin,
  Leaf,
  DollarSign,
  TrendingUp,
  Lightbulb,
  HandshakeIcon,
  AlertCircle,
  GitBranch,
  ExternalLink,
  ClipboardList,
  Receipt,
  UserCheck,
  Vote,
} from "lucide-react";

type ScrollNavPill = { id: string; label: string };

const navPills = (tokenName: string): ScrollNavPill[] => [
  { id: "r-ikigai", label: "R-Ikigai" },
  { id: "recognition", label: `${tokenName} Economy` },
  { id: "voice", label: "Voice & Governance" },
  { id: "hypha", label: "Hypha Platform" },
  { id: "spaces", label: "The Four Spaces" },
  { id: "progression", label: "Path of Growth" },
  { id: "good-neighbor", label: "Good Neighbor" },
];

// ─── Hypha Action Cards ────────────────────────────────────────────────────────

// S14: the DHO address is DATA (the hypha.org_url variable, resolved by the
// server and read through useHypha) — the live [YOUR-DHO-SLUG] placeholder
// this file used to ship is gone. Cards carry suffixes; the render resolves.

const buildHyphaActions = (villageName: string, tokenName: string) => [
  {
    icon: ClipboardList,
    title: "Start with an Agreement",
    subtitle: "Proposing a role, quest, or new contribution",
    description:
      `Before you begin any new type of contribution, a seasonal role, a quest, or a new initiative, you open it to the community with an Agreement. Describe what you're bringing, what ${villageName} receives, and what you're requesting in return. The community votes. Value in = value out.`,
    cta: "Create Agreement",
    suffix: "/agreements/create",
    color: "border-teal-deep/30 bg-teal-deep/5",
    iconColor: "text-teal-deep",
    iconBg: "bg-teal-deep/10",
  },
  {
    icon: Receipt,
    title: `Claim Your ${tokenName}`,
    subtitle: "After completing a task, pay period, or season",
    description:
      `When you've done the work, completed a quest, finished a season as a role holder, or reached a milestone, you come back and propose a Contribution Claim. Detail what you delivered, what ${villageName} gained, and claim your ${tokenName}. This is how the value you create becomes visible and rewarded.`,
    cta: "Propose a Contribution",
    suffix: "/agreements/create/propose-contribution",
    color: "border-sage/30 bg-sage/5",
    iconColor: "text-sage",
    iconBg: "bg-sage/10",
  },
  {
    icon: DollarSign,
    title: "Propose Expenses",
    subtitle: "When your work has real costs",
    description:
      "If your contribution requires purchasing materials, covering travel, or paying for services that benefit the community, you can propose those expenses for reimbursement. Be transparent and specific, the community is the budget committee here, and your integrity in how you handle shared resources is part of your contribution.",
    cta: "Pay for Expenses",
    suffix: "/agreements/create/pay-for-expenses",
    color: "border-amber/30 bg-amber/5",
    iconColor: "text-amber-700",
    iconBg: "bg-amber/10",
  },
  {
    icon: UserCheck,
    title: "Delegate Your Voice",
    subtitle: "Trust someone to vote on your behalf",
    description:
      `Your voice is your governance power, it grows as you contribute. If you trust another member to represent your perspective while you're away or unavailable, you can delegate your voice to them. Choose someone whose judgment aligns with yours and whose commitment to ${villageName} you trust deeply.`,
    cta: "View Members",
    suffix: "/members",
    color: "border-coral/30 bg-coral/5",
    iconColor: "text-coral",
    iconBg: "bg-coral/10",
  },
];

// A function of the live token names AND of the conversion sentence (lib/moneyClaims.ts), so a rename and a correction both reach every card.
const recognitionItems = (tokenName: string, valueName: string, villageName: string, conversionNote: string) => ({
  earn: [
    { label: "Quests", range: `40-300 ${tokenName}` },
    { label: "Circle Roles", range: "200-500/month" },
    { label: "Land Stewardship Shifts", range: "60-120" },
    { label: "Business Revenue Share", range: "Variable" },
  ],
  hold: [
    "Visible balance on your profile",
    "Reflects your contribution history",
    "Unlocks role eligibility",
    "Represents community trust",
  ],
  spend: [
    `Each cycle, a real pool of ${valueName} is shared across everyone's ${tokenName}`,
    "Village dues & utilities",
    "Cafe & shop services",
    ...(conversionNote ? [conversionNote] : []),
  ],
});

/* Four cards, one pattern: a light tinted panel carrying a dark heading and
   dark body copy. Each `color` is a tint and each `textColor` is measured
   against that tint, because the two are only readable as a pair:
     bg-aqua-light  #c6dde0 + text-teal-deep #157f7d = 3.40:1 (20px bold, AA large)
     bg-sage-light  #dcebe0 + text-sage      #3d6e4a = 4.82:1
     bg-amber-light #fdf1de + text-gold      #a06b1c = 4.08:1 (20px bold, AA large)
     bg-green-light #dcecd6 + text-forest    #00472c = 8.78:1
   Village Steward used to be bg-teal-light, a mid-tone that put its heading at
   1.40:1 - it looked like the card that worked only because the other three had
   no background at all. Amber and green headings moved off text-amber and
   text-green-600 for the same reason: both are light accents that disappear on
   a light panel. */
const spaces = (tokenName: string) => [
  {
    id: "village-steward",
    title: "Village Steward Space",
    color: "bg-aqua-light",
    textColor: "text-teal-deep",
    icon: Users,
    description: "Coordinates overall village success, open to all path members",
  },
  {
    id: "resident",
    title: "Resident Space",
    color: "bg-sage-light",
    textColor: "text-sage",
    icon: Home,
    description: "Governs residential life and neighbor relations",
  },
  {
    id: "prosperity",
    title: "Prosperity Space",
    color: "bg-amber-light",
    textColor: "text-gold",
    icon: TrendingUp,
    description: `Manages business interests and ${tokenName} economy`,
  },
  {
    id: "land",
    title: "Land Stewardship Space",
    color: "bg-green-light",
    textColor: "text-forest",
    icon: TreePine,
    description: "Cares for land and ecosystem health",
  },
];

const buildProgressionStages = (villageName: string) => [
  { label: "Visitor", phase: "early" },
  { label: "Guest", phase: "early" },
  { label: "Immersant", phase: "early" },
  { label: "Participant", phase: "early" },
  { label: "Member", phase: "member", subLabel: `(${villageName} Family)` },
  { label: "Contributor", phase: "member" },
  { label: "Quest Seeker", phase: "member" },
  { label: "Initiate", phase: "cocreator" },
  { label: "Co-Creator", phase: "cocreator" },
  { label: "Role Holder", phase: "cocreator" },
  { label: "Guide", phase: "guide", subLabel: "(7+ years)" },
  { label: "Sage", phase: "sage", subLabel: "(21+ years)" },
];

const goodNeighborPillars = [
  {
    icon: Heart,
    title: "Love Letter Values",
    description: "Commitment to community values",
  },
  {
    icon: MessageCircle,
    title: "Authentic Communication",
    description: "Resolve conflicts with integrity",
  },
  {
    icon: DollarSign,
    title: "Financial Stability",
    description: "Meet community dues",
  },
  {
    icon: Users,
    title: "Governance Participation",
    description: "Active in decision-making",
  },
];

const ctaCards = [
  {
    title: "The Love Letter",
    description: "Read our community covenant and founding values",
    icon: Heart,
    href: "/love-letter",
    external: false,
    color: "text-primary",
  },
  {
    title: "Find Your Quest",
    description: "Discover opportunities that match your gifts",
    icon: Compass,
    href: "/quests",
    external: false,
    color: "text-teal-deep",
  },
  {
    title: "Join Community Call",
    description: "Meet us live and ask your questions",
    icon: Calendar,
    // Resolved at render from this village's own eventsUrl, and the card drops
    // out of the grid when there is none.
    href: "",
    external: true,
    color: "text-sage",
  },
];

export default function CoCreatorsGuide() {
  const hypha = useHypha();
  const valueName = useValueTokenName();
  const tokenName = useTokenName("Recognition");
  const villageName = useVillageName();
  const hyphaActions = buildHyphaActions(villageName, tokenName);
  const progressionStages = buildProgressionStages(villageName);
  // The one external card points at this village's own events page.
  // No events page, no card: better an absent invitation than one that
  // takes a reader to a different village's calendar.
  const { eventsUrl } = useVillageLinks();
  const cards = ctaCards
    .map((card) => (card.external ? { ...card, href: eventsUrl } : card))
    .filter((card) => card.href);
  const conversionNote = useValueConversion({ village: villageName, value: valueName });
  const recognition = recognitionItems(tokenName, valueName, villageName, conversionNote);
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <Layout>
      {/* HERO SECTION */}
      <section className="py-24 bg-teal-deep text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-64 h-64 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-20 w-80 h-80 bg-white rounded-full blur-3xl" />
        </div>
        <div className="container relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <BookOpen className="w-16 h-16 mx-auto mb-6 opacity-90" />
              <h1 className="font-display text-5xl md:text-6xl font-bold mb-6 leading-tight">
                The {villageName} Game Guide
              </h1>
              <p className="text-lg md:text-xl text-white leading-relaxed max-w-2xl mx-auto">
                Your complete guide to co-creating this village. How the economy works, how decisions get made, how to use our governance platform, and what the journey from visitor to Sage looks like.
              </p>
              <p className="text-sm text-white mt-4">
                Also called: The Co-Creators Guide
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* QUICK NAV BAR */}
      <section className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-muted">
        <div className="container py-4">
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 min-w-min">
              {navPills(tokenName).map((pill) => (
                <motion.button
                  key={pill.id}
                  onClick={() => scrollToSection(pill.id)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap
                    bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {pill.label}
                </motion.button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* R-IKIGAI SECTION */}
      <section id="r-ikigai" className="py-20 bg-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-5xl mx-auto"
          >
            <div className="mb-12">
              <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3">
                Your R-Ikigai
              </h2>
              <p className="text-muted-foreground text-lg">
                The intersection of what you love, what you're good at, what {villageName} needs,
                and what earns you {tokenName}.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-12 items-center">
              {/* VENN DIAGRAM */}
              <div className="relative w-full h-80 flex items-center justify-center">
                <svg viewBox="0 0 400 400" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                  {/* Top: Passion */}
                  <circle
                    cx="200"
                    cy="130"
                    r="90"
                    fill="rgba(244, 63, 94, 0.2)"
                    stroke="rgba(244, 63, 94, 0.5)"
                    strokeWidth="2"
                  />
                  {/* Right: Skills */}
                  <circle
                    cx="280"
                    cy="240"
                    r="90"
                    fill="rgba(130, 201, 185, 0.2)"
                    stroke="rgba(130, 201, 185, 0.5)"
                    strokeWidth="2"
                  />
                  {/* Bottom: Regeneration */}
                  <circle
                    cx="120"
                    cy="240"
                    r="90"
                    fill="rgba(142, 168, 156, 0.2)"
                    stroke="rgba(142, 168, 156, 0.5)"
                    strokeWidth="2"
                  />
                  {/* Left: Gratitude */}
                  <circle
                    cx="200"
                    cy="200"
                    r="60"
                    fill="rgba(251, 191, 36, 0.3)"
                    stroke="rgba(251, 191, 36, 0.6)"
                    strokeWidth="2"
                  />

                  {/* Labels */}
                  <text x="200" y="80" textAnchor="middle" className="text-sm font-bold fill-primary">
                    What You LOVE
                  </text>
                  <text x="320" y="260" textAnchor="middle" className="text-sm font-bold fill-sage">
                    What You&apos;re GOOD AT
                  </text>
                  {/*
                    Generic on purpose, and the one label on this page that is.
                    This is an SVG <text> at a fixed x with no wrapping, and the
                    three labels around it name generic roles ("You", "GRATITUDE"),
                    so a village name of unknown length would be the only variable
                    thing in a fixed layout and would run off the diagram. The
                    heading below, which flows, does name the village.
                  */}
                  <text x="80" y="320" textAnchor="middle" className="text-sm font-bold fill-sage">
                    What the VILLAGE NEEDS
                  </text>
                  <text x="280" y="150" textAnchor="middle" className="text-sm font-bold fill-amber">
                    What Earns GRATITUDE
                  </text>

                  {/* Center */}
                  <text
                    x="200"
                    y="210"
                    textAnchor="middle"
                    className="text-lg font-bold fill-teal-deep"
                  >
                    Your
                  </text>
                  <text
                    x="200"
                    y="232"
                    textAnchor="middle"
                    className="text-lg font-bold fill-teal-deep"
                  >
                    R-Ikigai
                  </text>
                </svg>
              </div>

              {/* DESCRIPTIONS */}
              <div className="space-y-6">
                <div className="p-4 rounded-lg bg-primary/5 border-l-4 border-primary">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <Heart className="w-5 h-5 text-primary" />
                    What You LOVE (Passion)
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Your authentic desires and what brings you alive. What would you do
                    even if no one paid you?
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-sage/5 border-l-4 border-sage">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <Star className="w-5 h-5 text-sage" />
                    What You&apos;re GOOD AT (Skills)
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Your natural abilities, experience, and expertise. What do others
                    come to you for?
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-emerald-100/50 border-l-4 border-emerald-600">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <Leaf className="w-5 h-5 text-emerald-600" />
                    What {villageName} NEEDS (Regeneration)
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    The gaps we need filled to create a thriving, regenerative community.
                    Where can you fill a real need?
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-amber/5 border-l-4 border-amber">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-amber" />
                    What Earns GRATITUDE (Compensation)
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Roles, quests, and contributions that our community values and rewards.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* GRATITUDE ECONOMY SECTION */}
      <section id="recognition" className="py-20 bg-primary/5">
        <div className="container">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-12 text-center">
              <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3">
                The {tokenName} Economy
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Two tokens, two jobs. The work, time, and resources you contribute to {villageName} are acknowledged in
                {tokenName}, the recognition signal, which carries no financial value of its own. {valueName} are the tracked
                value: each cycle the community shares a real pool of {valueName} across everyone's {tokenName}.{conversionNote ? ` ${conversionNote}` : ""}
              </p>
            </div>

            {/* THREE COLUMN CARDS */}
            <div className="grid md:grid-cols-3 gap-8 mb-12">
              {/* EARN */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0 }}
                className="bg-card rounded-xl p-8 border border-muted hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="font-bold text-xl text-foreground">Earn {tokenName}</h3>
                </div>
                <div className="space-y-3">
                  {recognition.earn.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 pb-3 border-b border-muted last:border-0">
                      <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.range}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* HOLD */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="bg-card rounded-xl p-8 border border-muted hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-lg bg-teal-100 flex items-center justify-center">
                    <Heart className="w-6 h-6 text-teal-deep" />
                  </div>
                  <h3 className="font-bold text-xl text-foreground">Hold {tokenName}</h3>
                </div>
                <div className="space-y-3">
                  {recognition.hold.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 pb-3 border-b border-muted last:border-0">
                      <Star className="w-5 h-5 text-teal-deep mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-foreground">{item}</p>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* SPEND */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 }}
                className="bg-card rounded-xl p-8 border border-muted hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-amber" />
                  </div>
                  <h3 className="font-bold text-xl text-foreground">Receive {valueName}</h3>
                </div>
                <div className="space-y-3">
                  {recognition.spend.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 pb-3 border-b border-muted last:border-0">
                      <ArrowRight className="w-5 h-5 text-amber mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-foreground">{item}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* GRATITUDE FLOW DIAGRAM */}
            <div className="bg-card rounded-xl p-8 border border-muted">
              <h3 className="font-bold text-lg text-foreground mb-6 text-center">
                How Value Flows Through {villageName}
              </h3>
              <div className="flex flex-col md:flex-row items-center justify-center gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="px-4 py-2 bg-green-100 rounded-lg text-sm font-medium text-green-900">
                    Contribution
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="px-4 py-2 bg-primary/10 rounded-lg text-sm font-medium text-primary">
                    {tokenName} Earned
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="px-4 py-2 bg-amber-100 rounded-lg text-sm font-medium text-amber-900">
                    Cycle Pool of {valueName}
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="px-4 py-2 bg-teal-100 rounded-lg text-sm font-medium text-teal-deep">
                    Community Spending
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="px-4 py-2 bg-sage-light rounded-lg text-sm font-medium text-sage">
                  Regenerative Loop
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>


      {/* VOICE & GOVERNANCE SECTION */}
      <section id="voice" className="py-20 bg-background overflow-x-clip">
        <div className="container">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-12 text-center">
              <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3">
                Voice & Governance
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                {villageName} practices consent-based decision making where everyone's voice matters,
                circles hold authority within their domains, and all concerns are heard.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-12">
              {/* HOW PROPOSALS WORK */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0 }}
              >
                <h3 className="font-bold text-2xl text-foreground mb-6">How Proposals Work</h3>
                <div className="space-y-4">
                  {[
                    {
                      step: "1",
                      title: "Proposal",
                      description:
                        "Anyone can raise a proposal for action or change. Proposals are presented clearly with context and goals.",
                    },
                    {
                      step: "2",
                      title: "Clarification",
                      description:
                        "The circle asks clarifying questions. This isn't debate, just understanding. Proposals may be refined.",
                    },
                    {
                      step: "3",
                      title: "Consent",
                      description:
                        "We look for consent, not unanimous agreement. No reasoned objections means we move forward.",
                    },
                  ].map((item, idx) => (
                    <div key={idx} className="flex gap-4">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="font-bold text-primary">{item.step}</span>
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground mb-1">{item.title}</h4>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 p-4 rounded-lg bg-sage/5 border border-sage/20">
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">Monthly All-Village Calls:</span> Major cross-circle
                    decisions happen here, with full transparency and participation.
                  </p>
                </div>
              </motion.div>

              {/* KEY PRINCIPLES */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="space-y-4"
              >
                <h3 className="font-bold text-2xl text-foreground mb-6">Key Principles</h3>

                <div className="p-4 rounded-lg border-2 border-primary bg-primary/5">
                  <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                    <Circle className="w-5 h-5 text-primary" />
                    Circles Hold Authority
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Each circle has decision-making power within its domain. No single person
                    overrides the circle.
                  </p>
                </div>

                <div className="p-4 rounded-lg border-2 border-teal-light bg-teal-light/5">
                  <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                    <MessageCircle className="w-5 h-5 text-teal-deep" />
                    Objections vs. Disagreements
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    A reasoned objection blocks progress. A disagreement is noted but doesn't
                    stop the work. Know the difference.
                  </p>
                </div>

                <div className="p-4 rounded-lg border-2 border-sage bg-sage/5">
                  <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                    <Users className="w-5 h-5 text-sage" />
                    Consent Culture
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    We're not seeking unanimous agreement. We're looking for no reasoned
                    objections. That's enough to move forward.
                  </p>
                </div>

                <div className="p-4 rounded-lg border-2 border-amber bg-amber/5">
                  <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber" />
                    Anyone Can Raise Concerns
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    If you see a problem, speak up. Concerns shape better decisions. Silence
                    isn't consent.
                  </p>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* HYPHA PLATFORM SECTION */}
      <section id="hypha" className="py-20 bg-teal-deep">
        <div className="container">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-12 text-center max-w-3xl mx-auto">
              <span className="text-sm font-medium uppercase tracking-wide text-cream/60">
                Where Governance Gets Real
              </span>
              <h2 className="font-display text-4xl md:text-5xl font-bold text-cream mb-4 mt-2">
                Meet Hypha
              </h2>
              <p className="text-cream/80 text-lg leading-relaxed">
                Hypha is the platform where every {villageName} decision lives, recorded, verifiable,
                and tamper-proof on a distributed ledger. This isn't a shared Google Doc or a
                Discord vote that disappears. It's an{" "}
                <strong className="text-cream">incredibly secure, globally trusted governance
                system</strong>{" "}
                used by communities around the world to hold their most important decisions.
                Your voice here is permanent. Your contributions here are real.
              </p>
              <p className="text-cream/70 text-base mt-4 leading-relaxed">
                No single person, not even the founders, can override a community consent
                vote on Hypha. That's the point. When we say {villageName} is community-governed, this
                is what makes it true.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                <a
                  href="https://app.hypha.earth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cream text-teal-deep text-sm font-semibold hover:bg-cream/90 transition-colors"
                >
                  Open Hypha Platform
                  <ExternalLink className="w-4 h-4" />
                </a>
                {/*
                  This read "[AMORA: Add your Hypha DHO link...]": a note written
                  to one client during a build, shipped to every village and
                  rendered to every anonymous visitor of every one of them. It is
                  an instruction for whoever runs this village, so it addresses
                  them and names nobody.
                */}
                <p className="text-xs text-cream/50 self-center italic">
                  Add this village's Hypha DHO link in Admin, Variables, to make this live.
                </p>
              </div>
            </div>

            {/* Value philosophy */}
            <div className="max-w-3xl mx-auto mb-12 rounded-2xl border border-white/20 bg-white/10 p-6 md:p-8">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  <Vote className="w-5 h-5 text-cream" />
                </div>
                <div>
                  <h3 className="font-semibold text-cream text-lg mb-2">
                    Value In = Value Out
                  </h3>
                  <p className="text-cream/70 text-sm leading-relaxed">
                    Every proposal puts one question to the community: does this contribution serve
                    {villageName} at the level of {tokenName} being requested? Not hours logged, hours are
                    not a contribution. What matters is the actual value created, articulated
                    clearly, and assessed honestly by your peers. The more you contribute, the more
                    weight your voice carries in those votes.
                  </p>
                </div>
              </div>
            </div>

            {/* 4 Action Cards */}
            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {hyphaActions.map((action, idx) => {
                const Icon = action.icon;
                const href = hypha.configured ? hypha.orgUrl + action.suffix : "";
                return (
                  <motion.div
                    key={action.title}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: idx * 0.08 }}
                    className={`rounded-2xl border-2 p-6 ${action.color}`}
                  >
                    <div className="flex items-start gap-4 mb-4">
                      <div className={`w-10 h-10 rounded-xl ${action.iconBg} flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`w-5 h-5 ${action.iconColor}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{action.title}</h3>
                        <p className={`text-xs font-medium ${action.iconColor}`}>{action.subtitle}</p>
                      </div>
                    </div>
                    <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                      {action.description}
                    </p>
                    {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-semibold text-teal-deep hover:underline"
                    >
                      {action.cta}
                      <ExternalLink className="w-4 h-4 opacity-60" />
                    </a>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Available once your village's Hypha space is connected.
                      </p>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* The loop */}
            <div className="mt-14 max-w-3xl mx-auto">
              <p className="text-center text-cream/60 text-xs uppercase tracking-widest font-medium mb-5">
                The {villageName} Contribution Loop
              </p>
              <div className="grid sm:grid-cols-3 gap-4 text-center">
                {[
                  { label: "Sense", emoji: "🌀", description: "Find where your gifts are most needed. A quest waiting. A gap in the land. A conversation that sparks something." },
                  { label: "Propose", emoji: "✍️", description: "Open your intention to the community in Hypha. Consent-based: the check is simply whether this serves us." },
                  { label: "Create", emoji: "🌱", description: `Do the work. Document it. Return and claim ${tokenName} for the value you actually created.` },
                ].map((step) => (
                  <div key={step.label} className="rounded-xl bg-white/10 border border-white/20 p-5">
                    <div className="text-2xl mb-2">{step.emoji}</div>
                    <div className="text-lg font-display font-bold text-cream mb-2">{step.label}</div>
                    <p className="text-cream/70 text-sm leading-relaxed">{step.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* THE FOUR SPACES SECTION */}
      <section id="spaces" className="py-20 bg-primary/5">
        <div className="container">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-12 text-center">
              <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3">
                The Four Spaces
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                {villageName} is organized into four interconnected circles, each stewarding
                a different dimension of our community.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {spaces(tokenName).map((space, idx) => (
                <motion.div
                  key={space.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  id={space.id}
                  className={`${space.color} rounded-xl p-8 border border-muted/20 hover:shadow-lg transition-shadow`}
                >
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-12 h-12 rounded-lg bg-white/70 flex items-center justify-center flex-shrink-0">
                      <space.icon className={`w-6 h-6 ${space.textColor}`} />
                    </div>
                    <h3 className={`font-bold text-xl ${space.textColor}`}>
                      {space.title}
                    </h3>
                  </div>
                  <p className="text-foreground text-sm leading-relaxed">
                    {space.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* PATH OF GROWTH SECTION */}
      <section id="progression" className="py-20 bg-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-12 text-center">
              <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3">
                Path of Growth
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Your journey through {villageName}, from first contact to deepest participation.
                Each stage has its own gifts and responsibilities.
              </p>
            </div>

            {/* PROGRESSION TIMELINE */}
            <div className="max-w-5xl mx-auto mb-16">
              <div className="relative">
                {/* RESPONSIVE GRID */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {progressionStages.map((stage, idx) => {
                    let bgColor = "bg-muted";
                    let textColor = "text-muted-foreground";

                    if (stage.phase === "member") {
                      bgColor = "bg-primary/10";
                      textColor = "text-primary";
                    } else if (stage.phase === "cocreator") {
                      bgColor = "bg-teal-light/10";
                      textColor = "text-teal-deep";
                    } else if (stage.phase === "guide") {
                      bgColor = "bg-blue-100";
                      textColor = "text-blue-900";
                    } else if (stage.phase === "sage") {
                      bgColor = "bg-amber-100";
                      textColor = "text-amber-900";
                    }

                    return (
                      <motion.div
                        key={stage.label}
                        initial={{ opacity: 0, scale: 0.9 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: idx * 0.05 }}
                        className="text-center"
                      >
                        <div className={`${bgColor} rounded-lg p-3 mb-2`}>
                          <p className={`text-xs md:text-sm font-semibold ${textColor}`}>
                            {stage.label}
                          </p>
                          {stage.subLabel && (
                            <p className={`text-xs ${textColor} opacity-70`}>
                              {stage.subLabel}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* GUIDE & SAGE DETAILS */}
            <div className="grid md:grid-cols-2 gap-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0 }}
                className="bg-blue-50 rounded-xl p-8 border border-blue-200"
              >
                <div className="flex items-center gap-3 mb-4">
                  <Compass className="w-8 h-8 text-blue-900" />
                  <h3 className="font-bold text-2xl text-blue-900">Guide</h3>
                </div>
                <p className="text-blue-800 mb-4">
                  After 7+ years of deep participation, you become a Guide. Guides mentor
                  others, hold institutional memory, and help newer members navigate their
                  journey.
                </p>
                <p className="text-sm text-blue-700">
                  <span className="font-semibold">Responsibilities:</span> Mentorship, wisdom
                  sharing, ceremony holding, and intergenerational connection.
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="bg-amber-50 rounded-xl p-8 border border-amber-200"
              >
                <div className="flex items-center gap-3 mb-4">
                  <Crown className="w-8 h-8 text-amber-900" />
                  <h3 className="font-bold text-2xl text-amber-900">Sage</h3>
                </div>
                <p className="text-amber-800 mb-4">
                  After 21+ years, a Guide may become a Sage. Sages are the living embodiment
                  of {villageName}'s values and vision, holding space for the village's evolution.
                </p>
                <p className="text-sm text-amber-700">
                  <span className="font-semibold">Responsibilities:</span> Long-term vision,
                  values stewardship, conflict resolution, and community healing.
                </p>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* GOOD NEIGHBOR SECTION */}
      <section id="good-neighbor" className="py-20 bg-primary/5">
        <div className="container">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-12 text-center">
              <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3">
                Good Neighbor Criteria
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                To become a resident of {villageName}, you commit to embodying these four pillars.
              </p>
            </div>

            {/* FOUR PILLAR CARDS */}
            <div className="grid md:grid-cols-4 gap-6 mb-12">
              {goodNeighborPillars.map((pillar, idx) => (
                <motion.div
                  key={pillar.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  className="text-center"
                >
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <pillar.icon className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{pillar.title}</h3>
                  <p className="text-sm text-muted-foreground">{pillar.description}</p>
                </motion.div>
              ))}
            </div>

            {/* LINK TO FULL DOCUMENT */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="bg-card rounded-xl p-8 border border-muted text-center max-w-2xl mx-auto"
            >
              <p className="text-muted-foreground mb-6">
                The Good Neighbor Criteria are essential for anyone seeking to become a
                Resident. They reflect our commitment to authentic community and mutual
                respect.
              </p>
              <Link href="/good-neighbor">
                <a className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity">
                  Read the Full Good Neighbor Document
                  <ArrowRight className="w-4 h-4" />
                </a>
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>


      {/* CTA SECTION */}
      <section className="py-20 bg-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="text-center mb-12">
              <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3">
                Ready to Begin?
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                The infinite journey starts with a single step. Choose your path below.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {cards.map((card, idx) => (
                <motion.div
                  key={card.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  className="group"
                >
                  {card.external ? (
                    <a
                      href={card.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-full block bg-card rounded-xl p-8 border border-muted
                        hover:border-primary hover:shadow-lg hover:translate-y-1 transition-all duration-300 cursor-pointer"
                    >
                      <div className="mb-6">
                        <card.icon className={`w-12 h-12 ${card.color}`} />
                      </div>
                      <h3 className="font-bold text-xl text-foreground mb-2">
                        {card.title}
                      </h3>
                      <p className="text-muted-foreground text-sm mb-6">
                        {card.description}
                      </p>
                      <div className="flex items-center gap-2 text-primary font-semibold">
                        Learn More
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </a>
                  ) : (
                    <Link href={card.href}>
                      <a className="h-full block bg-card rounded-xl p-8 border border-muted
                        hover:border-primary hover:shadow-lg hover:translate-y-1 transition-all duration-300 cursor-pointer">
                        <div className="mb-6">
                          <card.icon className={`w-12 h-12 ${card.color}`} />
                        </div>
                        <h3 className="font-bold text-xl text-foreground mb-2">
                          {card.title}
                        </h3>
                        <p className="text-muted-foreground text-sm mb-6">
                          {card.description}
                        </p>
                        <div className="flex items-center gap-2 text-primary font-semibold">
                          Learn More
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </a>
                    </Link>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* FOOTER WISDOM */}
      <section className="py-16 bg-teal-deep text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white rounded-full blur-3xl" />
        </div>
        <div className="container relative z-10">
          <div className="max-w-2xl mx-auto text-center">
            <p className="text-lg italic text-white leading-relaxed">
              "{villageName} is an Infinite Game, played to keep creating
              together. We co-become the most beautiful village, where all beings belong and
              thrive. Success is measured by the flourishing of our
              community, land, and relationships."
            </p>
            <div className="mt-8 flex items-center justify-center gap-4 text-white">
              <Heart className="w-5 h-5" />
              <span className="text-sm">Welcome to {villageName}</span>
              <Heart className="w-5 h-5" />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
