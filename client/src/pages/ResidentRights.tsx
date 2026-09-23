import Layout from "@/components/Layout";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useVillageContent } from "@/hooks/useVillageContent";
import { useVillageName } from "@/hooks/useVillageName";
import { useTokenName } from "@/hooks/useTokenNames";
import {
  Home,
  Heart,
  Shield,
  Leaf,
  Users,
  Coins,
  TreePine,
  Star,
  Crown,
  Compass,
  ArrowRight,
  Wrench,
  Baby,
  RefreshCw,
} from "lucide-react";

/**
 * S2 brochure lane, 2026-08-30: RIGHTS[0]'s description used to assert the
 * land share transfers "tax-free" as compiled-in platform code: Costa
 * Rica's tax treatment, stated unconditionally, on every fork. It is now
 * built in the component from `content.legal.landShareTransferNote`
 * (GET /api/content/legal), which is empty on any instance that has not
 * written its own. See WhyCostaRica.tsx for the fuller version of this same
 * fix; Amora's original wording is preserved as data in
 * server/seeds/brochure-legal-seed.json, not deleted.
 */
const LAND_SHARE_BASE_DESCRIPTION =
  "Your Land Share Agreement gives you long-term security on your piece of this land, renewable, transferable to your children{{TRANSFER}}, and protected by community ownership structures that ensure the land itself can never be sold away from the community.";

const RIGHTS = (villageName: string, tokenName: string) => [
  {
    icon: Home,
    title: "Your Land Share is Yours",
    description: LAND_SHARE_BASE_DESCRIPTION.replace("{{TRANSFER}}", ""),
  },
  {
    icon: Shield,
    title: "Security Through Community Ownership",
    description:
      "The land belongs to all of us collectively. That means no single person can take it away, sell it off, or change its use without community consent. Your home sits on ground that is held in trust for the whole, including your family, and the families that come after.",
  },
  {
    icon: Users,
    title: "Voice in Community Life",
    description:
      `Residents hold full voice in the Circles that govern daily community life. As you grow into the community and reach the appropriate milestones, your governance rights deepen, from participating in decisions that affect your daily life to shaping the long-term direction of ${villageName}.`,
  },
  {
    icon: Leaf,
    title: "Access to All Commons",
    description:
      "The trails, food forests, gathering spaces, streams, ponds, and the shared land are yours to use and enjoy. Seasonal festivals, community events, potlucks, and village celebrations are part of your life here.",
  },
  {
    icon: Heart,
    title: "Community Services and Care",
    description:
      `As a resident, you have access to the wellness programs, education offerings, healing arts, and community care that ${villageName} develops together. The businesses and services that grow here serve the community first.`,
  },
  {
    icon: Coins,
    title: `Dues Offset Through ${tokenName}`,
    description:
      `Village dues can be covered through ${tokenName}, contributions you make to the community that are tracked as real value, not a fixed dollar amount. The more you contribute, the more your dues can be offset. The vision is a community where shared business profits make your life here net-positive.`,
  },
];

const RESPONSIBILITIES = (villageName: string, tokenName: string) => [
  {
    icon: Home,
    title: "Care for Your Home and Its Surroundings",
    description:
      "Your home is your space and the community's landscape. Maintain your home to a standard that honors the land around it, keeping shared pathways clear, managing your immediate space with care, and contributing to the beauty of the village.",
  },
  {
    icon: TreePine,
    title: "Act as a Co-Owner",
    description:
      "You live here. This place is yours as much as it is anyone's. Pick up what needs picking up. Notice what others might miss. Bring a co-owner's eye to every interaction with the land, the buildings, and the community. Not because you have to, because this place is actually yours.",
  },
  {
    icon: Wrench,
    title: "Contribute to Maintenance",
    description:
      "The village runs on the shared effort of its residents. Every resident contributes time to the maintenance of shared spaces, infrastructure, and community assets. This isn't outsourced, it's how we stay alive. Details of your contribution commitment are agreed during your residency onboarding.",
  },
  {
    icon: Coins,
    title: "Village Dues",
    description:
      `Monthly village dues cover utilities, shared infrastructure maintenance, and community services. The vision is for dues to be fully covered by profits from ${villageName}'s shared businesses, the retreat center, cafe, wellness offerings, and other enterprises, creating a net-positive financial life for all residents. Dues can also be offset through ${tokenName} earned from community contributions. Exact monthly amounts will be shared before signing your Land Share Agreement.`,
  },
  {
    icon: Users,
    title: "Participate in Community Processes",
    description:
      "Living here means showing up, to Circle meetings that affect your domain, to conflict resolution processes when they arise, to seasonal votes, and to the community governance that keeps everything running. Showing up is required. It's what makes self-governance real.",
  },
  {
    icon: Heart,
    title: "Honor the Good Neighbor Principles",
    description:
      "The Good Neighbor principles are a living guide to how we share space here. They cover noise, boundaries, shared resources, children and families, and how we handle conflict. Every resident commits to upholding and practicing them.",
  },
  {
    icon: Baby,
    title: "Raise the Next Generation Together",
    description:
      "Children here are raised by the whole village, not just their parents. As a resident, you share responsibility for a child-safe, child-enriching environment, showing up for Children's Play Days, respecting family spaces, and contributing to the culture that children grow up in.",
  },
];

const PROGRESSION = [
  {
    level: "Resident",
    description: "Full access to commons, housing rights, community participation",
    icon: Home,
    years: "Year 1+",
  },
  {
    level: "Established Resident",
    description: "Deeper governance voice, eligible for Circle Representative roles",
    icon: Star,
    years: "Year 3+",
  },
  {
    level: "Long-Term Resident",
    description: "Senior voice in community decisions, Sage eligibility, rights of nature representation",
    icon: Crown,
    years: "Year 7+",
  },
];

const FEES_VISION = (villageName: string, tokenName: string) => ({
  title: "The Vision for Your Finances Here",
  description: `Village dues exist to keep the infrastructure running, water, power, roads, shared maintenance. Right now, they're a cost. The longer-term vision is different: as ${villageName}'s shared businesses mature, the retreat center, the cafe, the wellness center, the artisan market, the education programs, the revenue they generate flows back into the community.

The goal is a life here that is economically net-positive. Where your contribution to the village through your ${tokenName} earnings, your business participation, or your role in community operations covers your dues and gives you back more than you put in.

This is what "Wealth Through Contribution" actually means. Not a promise. A design intention we're building toward together.`,
});

interface LegalContent {
  landShareTransferNote?: string;
}

export default function ResidentRights() {
  const { content } = useVillageContent<LegalContent>("legal");
  const villageName = useVillageName();
  const tokenName = useTokenName("Recognition");
  const feesVision = FEES_VISION(villageName, tokenName);
  const transferNote = content?.landShareTransferNote?.trim();
  const rights = RIGHTS(villageName, tokenName).map((right, i) =>
    i === 0 && transferNote
      ? { ...right, description: LAND_SHARE_BASE_DESCRIPTION.replace("{{TRANSFER}}", ` ${transferNote}`) }
      : right,
  );

  return (
    <Layout>
      {/* Hero */}
      <section className="relative py-20 overflow-hidden bg-gradient-to-br from-teal-deep to-teal-band">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-64 h-64 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 left-10 w-48 h-48 rounded-full bg-amber blur-3xl" />
        </div>
        <div className="container relative z-10 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Home className="w-5 h-5 text-white" />
            </div>
            <span className="text-cream/80 text-sm font-medium uppercase tracking-wide">
              Resident Space
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
            Living at {villageName} means you are not a tenant. You are a co-owner of the whole village.
            These are the rights that protect you and the responsibilities that make this place
            worth protecting.
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
            <Home className="w-10 h-10 text-teal-deep mx-auto mb-4" />
            <h2 className="font-display text-2xl font-semibold text-foreground mb-3">
              You Live Here. This Is Yours.
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
              The land at {villageName} is held collectively, not by a landlord, not by a developer, not
              by any single person. Every resident is a steward of the whole of it. Your home
              is your private space. The rest belongs to all of you. Approach every interaction
              with the land and the community from that place: this is mine, and it's also all of
              ours.
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
              Your Rights as a Resident
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              These rights are protected by community governance structures and the Land Share
              Agreement, not by goodwill alone.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {rights.map((right, i) => {
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
              Your Responsibilities as a Resident
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              This is what it means to live here: the beautiful parts and the full
              weight of belonging to a place and the people in it.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {RESPONSIBILITIES(villageName, tokenName).map((item, i) => {
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

      {/* Fees and vision */}
      <section className="py-20 bg-background">
        <div className="container max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-amber/40 bg-amber/5 p-8"
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber/20 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-amber-700" />
              </div>
              <h2 className="font-display text-2xl font-semibold text-foreground">
                {feesVision.title}
              </h2>
            </div>
            {feesVision.description.split("\n\n").map((para, i) => (
              <p key={i} className="text-muted-foreground leading-relaxed mb-4 last:mb-0">
                {para}
              </p>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Progression */}
      <section className="py-20 bg-cream">
        <div className="container max-w-3xl">
          <div className="text-center mb-12">
            <span className="text-sm font-medium uppercase tracking-wide text-amber-ink">
              Deepening Over Time
            </span>
            <h2 className="font-display text-3xl font-semibold text-foreground mt-2">
              Rights Grow With Your Roots
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              The longer you live here, the deeper your governance voice becomes. This is a
              recognition of wisdom that can only come from time, presence, and commitment.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {PROGRESSION.map((stage, i) => {
              const Icon = stage.icon;
              return (
                <motion.div
                  key={stage.level}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-5 rounded-2xl border border-border bg-white p-5"
                >
                  <div className="w-12 h-12 rounded-xl bg-teal-deep flex items-center justify-center flex-shrink-0">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">{stage.level}</div>
                    <div className="text-muted-foreground text-sm">{stage.description}</div>
                  </div>
                  <span className="text-xs font-medium text-teal-deep bg-teal/10 px-3 py-1 rounded-full whitespace-nowrap">
                    {stage.years}
                  </span>
                </motion.div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-4">
            Year thresholds are approximate and will be confirmed in the Resident Agreement.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-background">
        <div className="container max-w-2xl text-center">
          <h2 className="font-display text-2xl font-semibold text-foreground mb-4">
            Ready to Call This Home?
          </h2>
          <p className="text-muted-foreground mb-8">
            Your journey begins with a Community Call. Come meet the team, ask your questions,
            and feel what's possible here.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/resident">
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-deep text-white font-medium hover:bg-teal-deep/90 transition-colors">
                Return to Resident Journey
                <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
            <Link href="/good-neighbor">
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-teal-deep text-teal-deep font-medium hover:bg-teal-deep/5 transition-colors">
                Read Good Neighbor Principles
              </button>
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
