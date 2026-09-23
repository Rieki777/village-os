import Layout from "@/components/Layout";
import BuildProgress from "@/components/BuildProgress";
import SeasonBanner from "@/components/SeasonBanner";
import VillagePulse from "@/components/VillagePulse";
import MapPeek from "@/components/MapPeek";
import { altOr, useBrandImages, useVillageLinks } from "@/lib/gameApi";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Users,
  Home as HomeIcon,
  Sparkles,
  ArrowRight,
  Heart,
  Calendar,
  MapPin,
  TreePine,
  CheckCircle2,
  FileText,
  Laptop,
  GraduationCap,
  Sunset,
  Zap,
  Briefcase,
  Globe
} from "lucide-react";
import { useState } from "react";
import { Image } from "@/components/Image";
import { useVillageLocation, useVillageName } from "@/hooks/useVillageName";



/**
 * The art on a journey card, and what a card looks like before there is any.
 *
 * These four pictures used to be four literal URLs on one village's WordPress
 * site. All four now 404, so the homepage renders four torn images with their
 * alt text spilling out of the rounded corner, and every fork of this platform
 * would have been hot-linking that village's domain for its own artwork even
 * when the files were there.
 *
 * So the source is the brand overlay the Setup Wizard writes, and a village
 * that has not added its art yet gets a quiet mark instead of a broken one.
 * The card keeps its accessible name either way: a sighted visitor sees a
 * deliberate empty panel and a screen reader still hears which journey this is.
 *
 * A bare <img> rather than <Image> for the same reason the markup below always
 * used one: the hover zoom is `transition-transform` and the component's fade
 * is `transition-opacity`, and one would silently cancel the other.
 */
function JourneyArt({ src, alt }: { src: string | undefined; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-muted/40 text-muted-foreground/50"
        role="img"
        aria-label={alt}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" className="h-8 w-8">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M21 16l-5-5-5.5 5.5" />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
    />
  );
}

const journeyCards = (villageName: string) => [
  {
    id: "investor",
    title: "Investor",
    subtitle: "Capital Contributor",
    description: "Plant capital in a project built to last. Your investment grows the village while community ownership stays intact, returns and values that move in the same direction.",
    icon: TrendingUp,
    href: "/investor",
    color: "bg-amber",
    imageKey: "investorHero" as const,
  },
  {
    id: "steward",
    title: "Village Steward",
    subtitle: "Co-Creator",
    description: "Coordinate and execute for the success of the whole village. Join circles, take on roles, and help shape our regenerative community.",
    icon: Users,
    href: "/steward",
    color: "bg-sage",
    imageKey: "stewardHero" as const,
  },
  {
    id: "resident",
    title: "Resident",
    subtitle: "Co-Creator",
    description: `Make ${villageName} your home. Explore housing options, join the waitlist, and become part of a loving village where all beings belong.`,
    icon: HomeIcon,
    href: "/resident",
    color: "bg-teal",
    imageKey: "residentHero" as const,
  },
  {
    id: "prosperity",
    title: "Prosperity Creator",
    subtitle: "Business Builder",
    description: "Launch or grow your business inside the village. Your work aligns with community values, and you share in what you build.",
    icon: Sparkles,
    href: "/prosperity",
    color: "bg-teal-light",
    imageKey: "prosperityHero" as const,
  },
];

const journeyStages = [
  { stage: "Align", description: "Discover our values", icon: Heart },
  { stage: "Experience", description: "Visit & participate", icon: Calendar },
  { stage: "Co-Create", description: "Join our circles", icon: Users },
  { stage: "Integrate", description: "Become a member", icon: CheckCircle2 },
  { stage: "Home", description: "Make it home", icon: HomeIcon },
];

export default function Home() {
  // Blank hides both buttons rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const villageName = useVillageName();
  // The most-read sentence on the site said "in Costa Rica" in compiled JSX.
  // Blank means the village has not said where it is, and the sentence then
  // omits the place rather than naming somebody else's.
  const location = useVillageLocation();
  const brand = useBrandImages();
  return (
    <Layout>
      {/* Hero Section.
          The hero's own surface is the brand BAND, and everything else in this
          section is drawn against it. shared/brandTokens.ts derives
          --tone-brand-band together with --tone-sun-on-band, moves the two
          toward each other until the pair clears 4.5:1, and refuses to ship a
          village theme where it does not. That derivation is the only reason
          any promise below holds for all thirteen deployments rather than for
          the platform's own neutral palette alone. */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-teal-band">
        {/* Background picture, when the village has one. */}
        <div className="absolute inset-0 z-0">
          {/* THE HERO RENDERS ONLY WHEN THERE IS ONE, the same rule the four
              journey pages already follow (InvestorJourney, StewardJourney,
              ResidentJourney, ProsperityJourney all guard their hero this
              way). This page did not, so a village with no uploaded art got
              Image's placeholder mark: a 32px picture frame in the middle of
              a 1272px hero, which reads to a visitor as a broken photograph
              rather than as a village that has not added one yet. All
              thirteen deployments are in that state and the live one is too.

              A hero that IS configured and then fails to load keeps the
              placeholder, deliberately. Those are different facts: nothing
              uploaded means nothing is missing, and a 404 on a file the
              village did upload means something IS. Image draws the mark and
              keeps the village's own alt text on it for the second case, so a
              screen reader still hears what the picture was meant to be.

              priority: when there IS a hero it is the Largest Contentful
              Paint element, and without fetchPriority=high it queues behind
              every other image on the page. */}
          {brand.hero ? (
            <>
              <Image
                src={brand.hero}
                alt={altOr(brand.heroAlt, "The village and the land around it")}
                priority
                className="w-full h-full"
              />
              {/* The scrim belongs to the photograph and goes with it. It used
                  to be drawn from literal black and painted whether or not
                  there was anything to darken, so a village with no art got a
                  wash fading to nothing on the right: a picture-shaped hole
                  where a picture had never been. Nothing here now hints at a
                  photograph that does not exist. */}
              <div className="absolute inset-0 bg-gradient-to-r from-teal-band via-teal-band/85 to-teal-band/25" />
            </>
          ) : null}
        </div>

        {/* Content */}
        <div className="container relative z-10 py-10 md:py-20">
          <div className="relative max-w-2xl">
            {/* THE COPY SITS ON AN OPAQUE BAND, AND THAT IS THE WHOLE FIX.

                A translucent scrim cannot promise a contrast ratio, because
                the ratio then depends on the photograph underneath, and a
                photograph is whatever the village uploads. With no photograph
                the scrim thinned toward the right until the accent word ran
                at 1.65:1 on its left edge and 2.52:1 on its right, against a
                3:1 floor for large text (measured at 1272x900, this branch,
                before this change). Nudging the accent hex would not have
                fixed it: --primary is derived to clear 4.5:1 on WHITE, so on
                a dark scrim the arithmetic has no answer at either end.

                This band is opaque, so the ratio is a property of two named
                colours and holds whatever is behind it. It bleeds past the
                copy on every side, and a village with no photograph never
                sees it: the section behind it is the same band colour, so it
                only becomes a visible panel at the moment there is a picture
                for it to sit on, which is the moment it is needed. */}
            <div
              aria-hidden="true"
              className="absolute -inset-x-5 -inset-y-6 sm:-inset-x-8 sm:-inset-y-10 rounded-3xl bg-teal-band"
            />
            <motion.div
              className="relative"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="inline-block px-4 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-white text-sm font-medium mb-6">
                Come co-create paradise
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="relative font-display text-5xl md:text-7xl font-bold text-white leading-tight mb-6"
            >
              Co-Become the Most{" "}
              {/* text-amber-on-band, not text-primary. --primary is the seed
                  colour derived to clear 4.5:1 against WHITE, and this word has
                  a dark band behind it, so it was measured at 1.65:1 and 2.52:1
                  on the live palette. --tone-sun-on-band is the other half of
                  the pair --tone-brand-band belongs to: shared/brandTokens.ts
                  moves the two toward each other until they clear 4.5:1 and
                  refuses to ship a village theme where they do not. */}
              <span className="text-amber-on-band">Beautiful</span> Village
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative text-xl text-white/80 leading-relaxed mb-8"
            >
              A regenerative village{location ? ` in ${location}` : ""} where all beings{" "}
              <span className="font-semibold text-white">belong</span> and{" "}
              <span className="font-semibold text-white">thrive</span>. Find your path to participation.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="relative flex flex-wrap gap-4"
            >
              {/* THE TWO CONTROLS ARE DRAWN AGAINST THE BAND, NOT AGAINST A
                  SCRIM. WCAG 1.4.11 asks 3:1 for the boundary that tells a
                  visitor a control is there, and bg-primary can never give
                  that here: --tone-brand-band IS --tone-brand darkened, so the
                  fill and the surface behind it are the same hue a few steps
                  apart, for every village rather than only for the platform
                  default. Measured on the band: 1.46:1 for the filled button
                  and 1.92:1 for the outline one. White is the pairing this
                  codebase already uses for a control on the band
                  (Decisions.tsx), at 15.13:1, and the second control keeps its
                  translucent fill with a border that clears 3:1 on its own.

                  Measured after: 15.13:1 for the filled control, and 5.18:1
                  for the outline one's border.

                  That second number is the pixel a visitor's eye actually
                  lands on, and it took three readings to get right. This
                  comment first said 3.55:1 and the lane's own report said
                  3.67:1, neither reproducible. The border is border-white/40
                  over bg-white/20, and background-clip defaults to border-box,
                  so the button's own translucent fill composites UNDER its
                  border. Model the border against the bare band and you get
                  3.68:1; measure what is painted and it is 5.18:1. Both clear
                  the 3:1 requirement, so the conclusion never moved, but a
                  comment carrying a measurement nobody can reproduce is the
                  thing this whole exercise exists to stop. */}
              <a
                href="#choose-path"
                className="px-8 py-4 bg-white text-teal-band rounded-lg font-semibold text-lg hover:bg-cream transition-all duration-200 flex items-center gap-2"
              >
                Find Your Path
                <ArrowRight className="w-5 h-5" />
              </a>
              <Link
                href="/co-creators-guide"
                className="px-8 py-4 bg-white/20 backdrop-blur-sm border border-white/40 text-white rounded-lg font-semibold text-lg hover:bg-white/30 transition-all duration-200"
              >
                Read the Co-Creators Guide
              </Link>
            </motion.div>
          </div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
        >
          <div className="w-6 h-10 border-2 border-white/50 rounded-full flex justify-center">
            <motion.div
              animate={{ y: [0, 12, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-1.5 h-1.5 bg-white rounded-full mt-2"
            />
          </div>
        </motion.div>
      </section>

      {/* Journey Stages */}
      <section className="py-16 bg-aqua-light">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              From First Visit to Home
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Each stage is a chance to get to know each other. You figure out if {villageName} fits your life; we figure out if you're a good fit for the village.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-4 md:gap-0">
            {journeyStages.map((item, index) => (
              <div key={item.stage} className="flex items-center">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex flex-col items-center px-6 py-4"
                >
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <item.icon className="w-6 h-6 text-primary" />
                  </div>
                  <span className="font-display text-lg font-semibold text-foreground">
                    {item.stage}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {item.description}
                  </span>
                </motion.div>
                {index < journeyStages.length - 1 && (
                  <ArrowRight className="w-5 h-5 text-muted-foreground hidden md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <SeasonBanner />

      <BuildProgress />

      <VillagePulse />

      {/* Above "choose your path" on purpose: seeing the place comes before
          being asked which way into it you want. */}
      <MapPeek />

      {/* Choose Your Path */}
      <section id="choose-path" className="py-24 bg-background">
        <div className="container">
          <div className="text-center mb-16">
            <motion.span
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="inline-block px-4 py-1.5 bg-primary/10 rounded-full text-primary text-sm font-medium mb-4"
            >
              What brought you here?
            </motion.span>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4"
            >
              Choose Your Path
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl text-muted-foreground max-w-2xl mx-auto"
            >
              Four unique journeys to participate in the {villageName} community. Each path leads to belonging.
            </motion.p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {journeyCards(villageName).map((card, index) => (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Link href={card.href}>
                  <div className="group relative overflow-hidden rounded-2xl bg-card shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer">
                    {/* Image */}
                    <div className="relative h-56 overflow-hidden">
                      <JourneyArt src={brand[card.imageKey]} alt={card.title} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className={`absolute top-4 left-4 w-12 h-12 ${card.color} rounded-xl flex items-center justify-center`}>
                        <card.icon className="w-6 h-6 text-white" />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-display text-2xl font-bold text-foreground">
                          {card.title}
                        </h3>
                        <span className="text-sm text-muted-foreground">
                          {card.subtitle}
                        </span>
                      </div>
                      <p className="text-muted-foreground mb-4 leading-relaxed">
                        {card.description}
                      </p>
                      <div className="flex items-center text-primary font-medium group-hover:gap-3 gap-2 transition-all duration-200">
                        <span>Begin your journey</span>
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>


      {/* Who comes to this village */}
      <section className="py-24 bg-background">
        <div className="container">
          <div className="text-center mb-16">
            <motion.span
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="inline-block px-4 py-1.5 bg-sage/20 rounded-full text-sage text-sm font-medium mb-4"
            >
              People like you
            </motion.span>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4"
            >
              Who Comes to {villageName}?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl text-muted-foreground max-w-2xl mx-auto"
            >
              {villageName} attracts people who are done half-living. Here are some of
              the souls who find their way here.
            </motion.p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              {
                icon: Laptop,
                label: "Digital Nomad Couple",
                tagline: "We want roots without walls.",
                body: "Location-independent professionals ready to stop bouncing between Airbnbs and plant themselves somewhere with depth, community, and a reason to stay.",
                color: "bg-teal/10",
                iconColor: "text-teal-700",
              },
              {
                icon: GraduationCap,
                label: "Worldschooling Family",
                tagline: "Our kids deserve a village.",
                body: "Families who want their children raised by a community, surrounded by nature, multi-generational wisdom, and real-world learning instead of a system.",
                color: "bg-sage/20",
                iconColor: "text-sage",
              },
              {
                icon: Sunset,
                label: "Retiree & Snowbird",
                tagline: "Finally, a second chapter worth living.",
                // The closing line was one country's tourism slogan, which a
                // village elsewhere cannot honour and should not print.
                body: "Post-career dreamers who want warmth, beauty, belonging, and a role that still matters, not a golf course.",
                color: "bg-amber/20",
                iconColor: "text-amber-700",
              },
              {
                icon: Zap,
                label: "Longevity Seeker",
                tagline: "I want to live well, not just long.",
                body: "Health-conscious individuals chasing clean air, organic food, movement, community, and purpose as medicine: building a life designed to thrive.",
                color: "bg-primary/10",
                iconColor: "text-primary",
              },
              {
                icon: Briefcase,
                label: "Remote Exec & Founder",
                tagline: "I built the life. Now I want meaning.",
                body: "High-achievers who want their next chapter to matter: contributing capital, skills, or leadership to something regenerative and lasting.",
                color: "bg-teal-light/20",
                iconColor: "text-teal-600",
              },
              {
                icon: Globe,
                /*
                 * This card used to read "Costa Rican & LatAm Professional",
                 * offering "the regenerative future of Central America". Every
                 * other persona here describes a KIND of person and travels
                 * to any village; this one named one continent, so a founder
                 * in Portugal or Vermont published an invitation to a region
                 * they are not in. Generalised rather than deleted: the
                 * audience is real everywhere, only the map was Amora's.
                 */
                label: "Regional Changemaker",
                tagline: "I want to build something here.",
                body: `Local and regional changemakers who see ${villageName} as the proving ground for a regenerative future in their own part of the world, and want to help shape it.`,
                color: "bg-sage-light/40",
                iconColor: "text-sage",
              },
            ].map((persona, index) => (
              <motion.div
                key={persona.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.07 }}
                className="bg-card rounded-xl p-6 shadow-sm border border-border"
              >
                <div
                  className={`w-12 h-12 rounded-xl ${persona.color} flex items-center justify-center mb-4`}
                >
                  <persona.icon className={`w-6 h-6 ${persona.iconColor}`} />
                </div>
                <h3 className="font-display text-lg font-bold text-foreground mb-1">
                  {persona.label}
                </h3>
                <p className="text-primary text-sm font-medium italic mb-3">
                  "{persona.tagline}"
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {persona.body}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="text-center mt-12">
            <p className="text-muted-foreground mb-4">
              See yourself here? There's a path with your name on it.
            </p>
            <a
              href="#choose-path"
              className="inline-flex items-center gap-2 text-primary font-semibold hover:opacity-80 transition-opacity"
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById("choose-path")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Find your path <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-primary/5">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-display text-4xl md:text-5xl font-bold text-foreground mb-6"
            >
              Ready to Begin Your Journey?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl text-muted-foreground mb-8"
            >
              Join our next community call to learn about the basics and ask any questions. 
              It's the perfect first step on any path.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="flex flex-wrap justify-center gap-4"
            >
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-8 py-4 bg-primary text-primary-foreground rounded-lg font-semibold text-lg hover:bg-teal-deep-dark transition-all duration-200 flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Join Community Call
                </a>
              )}
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-8 py-4 bg-secondary text-secondary-foreground rounded-lg font-semibold text-lg hover:opacity-90 transition-all duration-200"
                >
                  View All Events
                </a>
              )}
            </motion.div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
