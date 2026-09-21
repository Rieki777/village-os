import Layout from "@/components/Layout";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useVillageName } from "@/hooks/useVillageName";
import { useTokenName, useValueTokenName } from "@/hooks/useTokenNames";
import { useValueConversion } from "@/lib/moneyClaims";
import {
  Users,
  Heart,
  TreePine,
  Star,
  Compass,
  Shield,
  Leaf,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Crown,
} from "lucide-react";

/*
 * A function of the live value-token name (Admin → Tokens): a fork's rename
 * reaches the recognition card without a code change. And now of the
 * conversion sentence, for the same reason: this card said "As {village}
 * grows, {value} convert to cash, equity, or community currency" as compiled
 * copy and nothing in the product converts anything. Founder ruling,
 * 2026-09-03: real, off platform, on-platform process unbuilt, and his words
 * to write. It comes from `money.valueConversion` and a village that has
 * published none says nothing here. See lib/moneyClaims.ts.
 */
const RIGHTS = (tokenName: string, valueName: string, villageName: string, conversionNote: string) => [
  {
    icon: Users,
    title: "Voice in Governance",
    description:
      "As a Village Steward you hold a genuine voice in how this community is shaped. You have the right to participate in Circle consent rounds, vote on decisions within your domain, and elect representatives to the Leadership Council. Your perspective matters at every level.",
  },
  {
    icon: Heart,
    title: `Earn ${tokenName} for Your Contribution`,
    description:
      `Every role you hold, every quest you complete, and every meaningful act of stewardship earns you ${tokenName}: the recognition signal, with no financial value of its own. Each cycle the community shares a real pool of ${valueName} across everyone's ${tokenName}, so appreciation decides where value flows.${conversionNote ? ` ${conversionNote}` : ""} Your effort builds real wealth.`,
  },
  {
    icon: Star,
    title: "Apply for Seasonal Roles",
    description:
      "Once you complete your Co-Creator Right of Passage, you have the right to propose yourself for any seasonal role that fits your gifts, whether that's a Circle facilitation role, a land stewardship position, or a new role you help design. Roles are renewed by consent each season.",
  },
  {
    icon: Compass,
    title: "Advance Along the Path",
    description:
      "After multiple seasons serving in a role, you earn the right to be recognized as a Guide, a mentor and anchor for those coming after you. After seasons as a Guide, you may become a Sage, holding the highest governance voice and long-term vision for the village.",
  },
  {
    icon: Leaf,
    title: "Access to Shared Land and Commons",
    description:
      "The land is yours to steward. You have the right to access all common areas, food forests, trails, gathering spaces, and natural features of the land. You can participate in every seasonal festival, community event, and village gathering.",
  },
  {
    icon: Shield,
    title: "Retreat and Wellness Access",
    description:
      `As a contributing steward, you have access to ${villageName}'s wellness offerings at community rates. Retreat facilities, healing arts programs, and wellness services are part of what this community builds together, and you are part of what makes them possible.`,
  },
];

const RESPONSIBILITIES = (villageName: string) => [
  {
    icon: Users,
    title: "Show Up for Your Circle",
    description:
      "Your Circle is counting on you. Attend meetings consistently, participate in consent rounds, and bring your whole self to the governance of your domain. If you can't make it, communicate early and often.",
  },
  {
    icon: TreePine,
    title: "Act as a Co-Owner",
    description:
      "Every steward is a co-owner of this village. Not in a legal technicality, in a lived reality. Approach every decision, every piece of land, every shared resource as if it belongs to you and to everyone here, because it does. Pick up what needs picking up. Fix what needs fixing. Notice what others might miss.",
  },
  {
    icon: Compass,
    title: "Take On Quests",
    description:
      "Quests are how the village grows. As a steward you commit to actively taking on quests that stretch your contribution, building, tending, hosting, documenting, organizing. Your engagement keeps the community alive.",
  },
  {
    icon: Heart,
    title: "Practice the Community Ways",
    description:
      `${villageName} runs on Nonviolent Communication, authentic relating, and consent-based decision-making. As a steward, you commit to practicing these tools, not just knowing them. When conflict arises, you bring it to the appropriate process before it festers.`,
  },
  {
    icon: Sparkles,
    title: "Contribute to the Seasonal Rhythm",
    description:
      `Every three months the community shapes its next season. Your presence in that vote matters. Attend seasonal transitions, participate in harvest circles and planting celebrations, and help decide collectively what ${villageName} focuses on next.`,
  },
  {
    icon: Star,
    title: "Lift Others as You Rise",
    description:
      "Your path from Visitor to Co-Creator to Guide to Sage is a relay. As you advance, you carry responsibility for welcoming newcomers, mentoring Initiates, and making it easier for the next person to find their place here.",
  },
];

const PROGRESSION = (tokenName: string) => [
  {
    level: "Co-Creator",
    description: `Full governance voice, seasonal role eligibility, ${tokenName} economy access`,
    icon: Star,
    color: "bg-teal-deep",
  },
  {
    level: "Guide",
    description: `Mentorship responsibilities, increased ${tokenName}, voice in cross-circle decisions`,
    icon: Compass,
    color: "bg-sage",
  },
  {
    level: "Sage",
    description: "Highest governance voice, wisdom keeper, long-term strategic guidance for the village",
    icon: Crown,
    color: "bg-amber text-foreground",
  },
];

export default function StewardRights() {
  const valueName = useValueTokenName();
  const tokenName = useTokenName("Recognition");
  const villageName = useVillageName();
  const conversionNote = useValueConversion({ village: villageName, value: valueName });
  const progression = PROGRESSION(tokenName);
  return (
    <Layout>
      {/* Hero */}
      <section className="relative py-20 overflow-hidden bg-gradient-to-br from-teal-deep to-sage">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-64 h-64 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 right-10 w-48 h-48 rounded-full bg-amber blur-3xl" />
        </div>
        <div className="container relative z-10 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <TreePine className="w-5 h-5 text-white" />
            </div>
            <span className="text-cream/80 text-sm font-medium uppercase tracking-wide">
              Village Steward Space
            </span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl md:text-5xl font-semibold text-cream mb-4"
          >
            Your Rights and Responsibilities
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-cream/80 text-lg leading-relaxed"
          >
            This is a covenant between co-owners, not a legal document. Every Village
            Steward holds both, the rights that come from real ownership of this place, and the
            responsibilities that make those rights worth something.
          </motion.p>
        </div>
      </section>

      {/* Co-ownership framing */}
      <section className="py-16 bg-cream">
        <div className="container max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-teal/30 bg-white p-8 text-center"
          >
            <TreePine className="w-10 h-10 text-sage mx-auto mb-4" />
            <h2 className="font-display text-2xl font-semibold text-foreground mb-3">
              You Are a Co-Owner of This Village
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
              Not in a passive sense. Not in a "you paid for something" sense. In the deepest
              sense, the land, the buildings, the culture, the economy, the future of this place
              are in your hands as much as anyone else's. Act from that space. Steward it as if
              you built it, because you are building it, right now.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Rights */}
      <section className="py-20 bg-background">
        <div className="container max-w-4xl">
          <div className="text-center mb-12">
            <span className="text-sm font-medium uppercase tracking-wide text-teal-deep">
              What You Hold
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mt-2">
              Your Rights as a Steward
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              These are not privileges granted from above. They are yours because you showed up,
              committed, and earned them through the journey.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {RIGHTS(tokenName, valueName, villageName, conversionNote).map((right, i) => {
              const Icon = right.icon;
              return (
                <motion.div
                  key={right.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="rounded-2xl border border-border bg-card p-6"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-teal-deep/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-5 h-5 text-teal-deep" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">{right.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {right.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Responsibilities */}
      <section className="py-20 bg-cream">
        <div className="container max-w-4xl">
          <div className="text-center mb-12">
            <span className="text-sm font-medium uppercase tracking-wide text-sage">
              What You Carry
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mt-2">
              Your Responsibilities as a Steward
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              Rights and responsibilities are two sides of the same belonging. One without the
              other isn't community, it's just a transaction.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {RESPONSIBILITIES(villageName).map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="rounded-2xl border border-border bg-white p-6"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-sage/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-5 h-5 text-sage" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">{item.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Progression Path */}
      <section className="py-20 bg-background">
        <div className="container max-w-3xl">
          <div className="text-center mb-12">
            <span className="text-sm font-medium uppercase tracking-wide text-amber-700">
              Your Path Forward
            </span>
            <h2 className="font-display text-3xl font-semibold text-foreground mt-2">
              Rights Deepen as You Grow
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              Your rights and voice grow with your commitment. This is not a hierarchy of
              worth, it's a recognition that those who have poured the most into this place
              hold the most wisdom for its future.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {progression.map((stage, i) => {
              const Icon = stage.icon;
              return (
                <motion.div
                  key={stage.level}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-5 rounded-2xl border border-border bg-card p-5"
                >
                  <div className={`w-12 h-12 rounded-xl ${stage.color} flex items-center justify-center flex-shrink-0`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{stage.level}</div>
                    <div className="text-muted-foreground text-sm">{stage.description}</div>
                  </div>
                  {i < progression.length - 1 && (
                    <CheckCircle2 className="w-5 h-5 text-teal ml-auto opacity-40" />
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-cream">
        <div className="container max-w-2xl text-center">
          <h2 className="font-display text-2xl font-semibold text-foreground mb-4">
            Ready to Begin?
          </h2>
          <p className="text-muted-foreground mb-8">
            The Steward journey starts with a single step, showing up to a Community Call and
            saying yes to what's calling you.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/steward">
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-deep text-white font-medium hover:bg-teal-deep/90 transition-colors">
                Return to Steward Journey
                <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
            <Link href="/quests">
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-teal-deep text-teal-deep font-medium hover:bg-teal-deep/5 transition-colors">
                Explore Quests
              </button>
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
