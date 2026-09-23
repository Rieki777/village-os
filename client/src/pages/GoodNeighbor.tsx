import Layout from "@/components/Layout";
import { useVillageLinks } from "@/lib/gameApi";
import { useVillageName } from "@/hooks/useVillageName";
import { useTokenName } from "@/hooks/useTokenNames";
import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  Heart,
  MessageCircle,
  DollarSign,
  Users,
  Leaf,
  Globe,
  Shield,
  Baby,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Calendar,
} from "lucide-react";

const buildCriteria = (villageName: string, tokenName: string) => [
  {
    number: "01",
    icon: Heart,
    title: "Core Values Alignment",
    subtitle: "You Live the Vision",
    description:
      `You understand and embrace ${villageName}'s vision of regenerative living and community stewardship. You're genuinely interested in being part of a living experiment, not just finding a nice place to live.`,
    practices: [
      "You engage with the community intentionally: show up to potlucks, participate in circles, take your voice seriously.",
      "You're curious about how things work here: our governance, our economy, our values.",
      "You accept that community life sometimes requires conversations you'd rather skip. We do it anyway, with care.",
    ],
    color: "bg-primary/10",
    iconColor: "text-primary",
  },
  {
    number: "02",
    icon: MessageCircle,
    title: "Communication & Conflict Resolution",
    subtitle: "You Practice Authentic Relating",
    description:
      "You're willing to learn and practice Nonviolent Communication (NVC) or similar practices for authentic relating. You see conflict as a doorway to deeper connection, not a threat.",
    practices: [
      "You attend our community training in NVC or conflict resolution (required for residents).",
      "When something's bothering you, you address it directly, not through gossip or silence.",
      "You're willing to apologize, make repairs, and evolve.",
    ],
    note: "What disqualifies someone: Unwillingness to engage in honest conversation or a pattern of avoiding conflict through manipulation, blame, or withdrawal.",
    color: "bg-sage/20",
    iconColor: "text-sage",
  },
  {
    number: "03",
    icon: DollarSign,
    title: "Financial Responsibility",
    subtitle: "You Can Meet Your Obligations",
    description:
      `You have the financial capacity to sustain your commitment to ${villageName}. You're honest about your resources and realistic about what you can afford.`,
    practices: [
      "You've done the math on housing, land leases, HOA fees, village dues, and shared costs.",
      "You have a clear income source or savings to cover your commitment for at least 3-5 years.",
      "If circumstances change, you communicate early. You don't disappear or default.",
    ],
    note: `This is not about wealth. ${villageName} welcomes teachers, artists, young families, retirees, and remote workers. What matters is alignment and honesty.`,
    color: "bg-amber/20",
    iconColor: "text-amber-700",
  },
  {
    number: "04",
    icon: Users,
    title: "Contribution to Community Life",
    subtitle: "You Show Up and Participate",
    description:
      "You give your time, energy, or skills to the community in some way. You're not just a consumer of community benefits, you're a co-creator.",
    practices: [
      `You identify your ${villageName} R-Ikigai: the intersection of what you love, what you're good at, and what ${villageName} needs.`,
      `You propose contributions and earn ${tokenName} through meaningful work.`,
      "You participate in circles aligned with your interests and gifts.",
    ],
    note: "This is not about perfection. We all have seasons of high and lower capacity. What matters is consistent engagement and honesty.",
    color: "bg-teal/20",
    iconColor: "text-teal-700",
  },
  {
    number: "05",
    icon: Leaf,
    title: "Respect for Land, Nature, and All Beings",
    subtitle: "You Are a Steward",
    description:
      `You understand that ${villageName}'s land is sacred and alive. You practice stewardship: protecting water, supporting regeneration, leaving no trace where possible.`,
    practices: [
      "You follow our water conservation guidelines and waste reduction practices.",
      "You participate in land stewardship (gardening, trail maintenance, reforestation) or support those who do.",
      "You treat shared spaces with care, as if they're your own responsibility.",
    ],
    color: "bg-sage-light/40",
    iconColor: "text-sage",
  },
  {
    number: "06",
    icon: Globe,
    title: "Cultural Openness & Intergenerational Respect",
    subtitle: "You Value Diversity",
    description:
      "You genuinely value diversity and different ways of being. You're open to learning from people of different cultures, ages, backgrounds, and perspectives.",
    practices: [
      // Was "our Costa Rican neighbors" and "30%+ Costa Rican
      // representation". The commitment is a real one and belongs here; the
      // nationality was Amora's, and a village elsewhere was publishing a
      // leadership quota for a country it is not in.
      "You engage respectfully with our local neighbors and team members.",
      "You support the goal of 30%+ local representation in leadership and decision-making.",
      "You honor elders, welcome children, and understand that multi-generational living is central to our vision.",
    ],
    color: "bg-teal-light/30",
    iconColor: "text-teal-600",
  },
  {
    number: "07",
    icon: Shield,
    title: "Background Check Acknowledgment",
    subtitle: "Safety and Trust for Everyone",
    description:
      "You're willing to undergo a standard background check as part of our resident vetting process. This is about safety and trust for the whole community.",
    practices: [
      "You'll provide identifying information and authorize a background check.",
      "Results are reviewed confidentially by the Resident Circle.",
      "A background check is one input among many in our evaluation of cultural fit.",
    ],
    note: "A background check is not automatically disqualifying. Many people have complicated histories. What matters is honesty, accountability, and demonstrated commitment to change.",
    color: "bg-primary/5",
    iconColor: "text-primary",
  },
  {
    number: "08",
    icon: Baby,
    title: "Children's Play Day Participation",
    subtitle: "For Families",
    description:
      `If you're a parent or guardian, you understand that children are central to ${villageName}'s vision. You participate in at least one Children's Play Day as part of the joining process.`,
    practices: [
      "You attend one Children's Play Day as part of your onboarding, a chance for the village to meet your family.",
      "You practice village parenting, understanding that raising children is a collective responsibility.",
      "You support the school pilot and educational initiatives.",
    ],
    note: "This applies only to families with children. Non-parents support children's wellbeing in other ways.",
    color: "bg-amber/10",
    iconColor: "text-amber-600",
  },
];

const dealbreakers = [
  {
    category: "Active Harm or Abuse",
    items: [
      "History of violence, sexual abuse, or serious harm to others (except with demonstrated accountability and healing over substantial time)",
      "Current patterns of manipulation, coercion, or abuse",
      "Unwillingness to engage in conflict resolution or take responsibility for harm",
    ],
  },
  {
    category: "Fundamentally Extractive Mindset",
    items: [
      "Viewing the community purely as a resource to exploit",
      "Refusal to contribute or participate in shared governance",
      "Consistent dishonesty or fraud",
    ],
  },
  {
    category: "Misalignment on Core Values",
    items: [
      "Deep opposition to regenerative living practices",
      "Unwillingness to respect the land or honor our environmental commitments",
      "Active resistance to cultural diversity or multi-generational inclusion",
    ],
  },
  {
    category: "Incompatibility with Our Governance",
    items: [
      "Insistence on top-down authority or individual control",
      "Refusal to practice authentic communication or engage in conflict resolution",
      "Inability or unwillingness to honor consent-based decision-making",
    ],
  },
];

const commitments = [
  "Create a genuinely supportive and thriving community",
  "Practice transparent governance and decision-making",
  "Share financial benefits from commercial enterprises with all residents",
  "Protect your investment and provide stability (30-99 year land leases with renewal options)",
  "Honor your voice and participation in decisions that affect you",
  "Support your growth, learning, and evolution",
  "Celebrate your contributions and make your belonging real",
  "Handle conflict with care and commitment to resolution",
  "Protect the land and ecological integrity for generations",
];

export default function GoodNeighbor() {
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const villageName = useVillageName();
  const tokenName = useTokenName("recognition");
  const criteria = buildCriteria(villageName, tokenName);
  return (
    <Layout>
      {/* Hero */}
      <section className="relative py-24 bg-gradient-to-b from-sage/20 to-background overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 left-10 w-96 h-96 rounded-full bg-primary blur-3xl" />
          <div className="absolute bottom-10 right-10 w-64 h-64 rounded-full bg-sage blur-3xl" />
        </div>
        <div className="container relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="inline-block px-4 py-1.5 bg-primary/10 rounded-full text-primary text-sm font-medium mb-6"
            >
              Our Living Covenant
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="font-display text-5xl md:text-6xl font-bold text-foreground mb-6"
            >
              Good Neighbor Criteria
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-muted-foreground leading-relaxed mb-8"
            >
              This is not a legal document or a list of rules. This is a
              heartfelt covenant, a living agreement that expresses the values we
              embody together and the commitment we make to one another as
              neighbors.
            </motion.p>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-lg text-muted-foreground italic"
            >
              "We are called to be architects of the future, not its victims."
              <br />
              <span className="not-italic text-sm">- Buckminster Fuller</span>
            </motion.p>
          </div>
        </div>
      </section>

      {/* What this village values */}
      <section className="py-16 bg-primary/5">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-display text-3xl font-bold text-foreground mb-8 text-center">
              What {villageName} Values, and Why It Matters
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  title: "Regenerative Living",
                  body: "We don't just sustain, we heal. This community is built on the belief that humans can actively restore the land, water systems, and ecosystems we depend on. We leave things better than we found them.",
                },
                {
                  title: "Community Care",
                  body: "We practice radical responsibility alongside deep interdependence. That means you show up for yourself and for the whole. We know that a single person's wellbeing affects everyone's.",
                },
                {
                  title: "Regenerative Purpose",
                  body: `Your life here has meaning. You're not just living in a nice place, you're aligning your unique gifts with what ${villageName} needs. This is the heart of the ${villageName} R-Ikigai.`,
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="bg-card rounded-xl p-6 shadow-sm"
                >
                  <h3 className="font-display text-lg font-bold text-foreground mb-3">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* The Criteria */}
      <section className="py-24 bg-background">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="font-display text-4xl font-bold text-foreground mb-4">
                The Good Neighbor Criteria
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Think of these as the operating system for our shared life. They
                describe who we are, how we show up for each other, and what
                makes {villageName} work as a living organism.
              </p>
            </div>

            <div className="space-y-8">
              {criteria.map((criterion, index) => (
                <motion.div
                  key={criterion.number}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-card rounded-2xl overflow-hidden shadow-sm border border-border"
                >
                  <div className="p-6 md:p-8">
                    <div className="flex items-start gap-4 mb-4">
                      <div
                        className={`w-12 h-12 rounded-xl ${criterion.color} flex items-center justify-center flex-shrink-0`}
                      >
                        <criterion.icon
                          className={`w-6 h-6 ${criterion.iconColor}`}
                        />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-xs font-mono text-muted-foreground">
                            {criterion.number}
                          </span>
                          <h3 className="font-display text-xl font-bold text-foreground">
                            {criterion.title}
                          </h3>
                        </div>
                        <p className="text-sm text-primary font-medium">
                          {criterion.subtitle}
                        </p>
                      </div>
                    </div>

                    <p className="text-muted-foreground leading-relaxed mb-5">
                      {criterion.description}
                    </p>

                    <div className="space-y-2 mb-4">
                      {criterion.practices.map((practice, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-muted-foreground">
                            {practice}
                          </p>
                        </div>
                      ))}
                    </div>

                    {criterion.note && (
                      <div className="bg-muted/50 rounded-lg px-4 py-3 text-sm text-muted-foreground italic">
                        {criterion.note}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Dealbreakers */}
      <section className="py-20 bg-destructive/5">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <h2 className="font-display text-3xl font-bold text-foreground">
                Clear Dealbreakers
              </h2>
            </div>
            <p className="text-muted-foreground mb-10 max-w-2xl">
              We want to be honest about this. Some behaviors or commitments are
              incompatible with {villageName}'s vision.
            </p>
            <div className="grid md:grid-cols-2 gap-6">
              {dealbreakers.map((group) => (
                <div key={group.category} className="bg-card rounded-xl p-6 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-4">
                    {group.category}
                  </h3>
                  <ul className="space-y-2">
                    {group.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-destructive mt-2 flex-shrink-0" />
                        <p className="text-sm text-muted-foreground">{item}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How We Assess Fit */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-display text-3xl font-bold text-foreground mb-4">
              The Conversation, Not Just the Criteria
            </h2>
            <p className="text-muted-foreground mb-10">
              These criteria are not a checklist to complete in isolation.
              They're a conversation starter. Here's how we assess fit:
            </p>
            <div className="space-y-4">
              {[
                {
                  step: "1",
                  title: "Initial Exploration",
                  body: `You learn about ${villageName} through events, tours, and conversations. You ask hard questions.`,
                },
                {
                  step: "2",
                  title: "Community Engagement",
                  body: "You attend potlucks, workshops, and gatherings. You get to know people. They get to know you.",
                },
                {
                  step: "3",
                  title: "Deep Conversation",
                  body: "If you're serious about residency, you have structured conversations with the Resident Circle about your values, your history, your commitment, and your concerns.",
                },
                {
                  step: "4",
                  title: "Background Check",
                  body: "You authorize a standard background check and reference check.",
                },
                {
                  step: "5",
                  title: "Observation Period",
                  body: "A period of participation before full commitment, so both you and the community can assess genuine fit.",
                },
                {
                  step: "6",
                  title: "Resident Consent",
                  body: "Current residents and the Resident Circle give their consent. The bar is genuine consent with no reasoned objections, not unanimous agreement.",
                },
                {
                  step: "7",
                  title: "Celebration",
                  body: "If approved, we celebrate your commitment with the whole community. Welcome home.",
                },
              ].map((item) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="flex items-start gap-4 bg-card rounded-xl p-5 shadow-sm"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold text-sm">
                      {item.step}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{item.body}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* What this village commits to you */}
      <section className="py-20 bg-primary/5">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-display text-3xl font-bold text-foreground mb-4">
              What {villageName} Commits to You
            </h2>
            <p className="text-muted-foreground mb-8">
              This covenant is two-way. If you commit to the Good Neighbor
              Criteria, {villageName} commits to you:
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {commitments.map((commitment, i) => (
                <div key={i} className="flex items-start gap-3 bg-card rounded-lg p-4 shadow-sm">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">{commitment}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Closing + CTA */}
      <section className="py-24 bg-background">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-display text-4xl font-bold text-foreground mb-6">
                A Final Word
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                The Good Neighbor Criteria exist because we believe something
                rare is possible here: a community where freedom and belonging,
                individual purpose and collective thriving, human flourishing and
                ecological regeneration all reinforce each other.
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed mb-10">
                If that resonates, and you're ready to live by these criteria
                and give this place your best, the belonging you get back here
                is real. Welcome home.
              </p>

              <div className="flex flex-wrap justify-center gap-4">
                <Link href="/love-letter">
                  <a className="px-8 py-4 bg-primary text-primary-foreground rounded-lg font-semibold text-lg hover:bg-teal-deep-dark transition-all duration-200 flex items-center gap-2">
                    Sign the Membership Covenant
                    <ArrowRight className="w-5 h-5" />
                  </a>
                </Link>
                {eventsUrl && (
                  <a
                    href={eventsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-8 py-4 bg-secondary text-secondary-foreground rounded-lg font-semibold text-lg hover:opacity-90 transition-all duration-200 flex items-center gap-2"
                  >
                    <Calendar className="w-5 h-5" />
                    Attend a Community Call
                  </a>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
