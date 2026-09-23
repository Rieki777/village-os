import Layout from "@/components/Layout";
import { altOr, statedFacts, useBrandImages, useVillageLinks, useVillageSettings } from "@/lib/gameApi";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { 
  Map, 
  ArrowRight, 
  Calendar,
  Home,
  Tent,
  TreePine,
  Droplets,
  Mountain,
  Users,
  Building
} from "lucide-react";
import { Image } from "@/components/Image";
import { useVillageName } from "@/hooks/useVillageName";


/*
 * THE FOUR TILES ARE SHAPES, AND THE FIGURES BELONG TO THE VILLAGE.
 *
 * They used to be literals: an acreage, a home count, a retreat key count and
 * an appraisal, all describing one specific property. Every fork of this
 * platform published all four about its own land the first time somebody
 * opened the master plan, and there was no field anywhere to change them.
 *
 * The repo already knew this tile row was fragile. The acreage carried a
 * comment reconciling it against seven other pages that each stated the same
 * figure in their own words, which is what a constant repeated across a
 * codebase always ends up needing. A village states it once, in Settings, or
 * the tile does not appear.
 */
const statShapes = [
  { key: "acres", label: "Total Acres", icon: Mountain },
  { key: "plannedHomes", label: "Planned Homes", icon: Home },
  { key: "guestRooms", label: "Retreat Keys", icon: Tent },
  { key: "appraisal", label: "Appraised Value", icon: Building },
];

/*
 * THE UNIT ON THE LAND TILE BELONGS TO THE VILLAGE TOO.
 *
 * The figure moved into Settings and the UNIT stayed hardcoded here, which is
 * how the same defect survived its own fix. Settings asks for the size of the
 * land in one box and, in the box beside it, the unit: its placeholder reads
 * "acres, hectares, manzanas". This tile threw that box away and printed
 * "Total Acres" over whatever number arrived. A village measuring in hectares
 * published its land at 40% of its real size, on the page it shows investors,
 * by filling the screen in exactly as the screen asked. The repo's own fork
 * test carried that payload as a fixture: `acres: { value: "40", note:
 * "hectares" }`.
 *
 * The unit a village typed is the unit the page states. NOTHING IS CONVERTED.
 * 40 hectares publishes as 40, under the word hectares. Multiplying it up to
 * 98.8 acres would put a number on an investor page that nobody at the village
 * ever wrote, which is a worse thing to publish than the bug.
 *
 * A blank unit still reads "Total Acres". A village that typed a bare number
 * back when acres was the only thing this tile could say keeps the page it has
 * today, unchanged. Fresh installs get "acres" already sitting in that box
 * (DEFAULT_SETTINGS, server/index.ts), so the word about to be published is on
 * screen while the founder types the number, and changing it is one edit.
 */
function withStatedUnit<T extends { key: string; label: string; note: string }>(stat: T): T {
  if (stat.key !== "acres") return stat;
  return { ...stat, label: `Total ${stat.note || "Acres"}` };
}

const villageZones = (villageName: string) => [
  {
    title: "Village Center",
    description: `The heart of ${villageName} featuring the community center, café, market, and gathering spaces.`,
    icon: Users,
    features: ["Community Center", "Café & Restaurant", "Artisan Market", "Event Spaces"],
  },
  {
    title: "Residential Neighborhoods",
    description: "Clustered housing areas designed for community connection while maintaining privacy.",
    icon: Home,
    features: ["150+ home sites", "Various lot sizes", "Walking paths", "Community gardens"],
  },
  {
    title: "Retreat & Wellness",
    description: "The retreat center and health facilities serving guests and residents.",
    icon: Tent,
    features: ["120-150 key retreat", "Health Center", "Spa facilities", "Workshop spaces"],
  },
  {
    title: "Agricultural Land",
    description: "Regenerative farms and food forests providing sustenance for the community.",
    icon: TreePine,
    features: ["Organic gardens", "Food forest", "Medicinal herbs", "Livestock areas"],
  },
  {
    title: "Commons & Conservation",
    description: "Protected natural areas, trails, and shared spaces for all to enjoy.",
    icon: Droplets,
    features: ["Nature preserves", "Hiking trails", "Water features", "Wildlife corridors"],
  },
];

export default function MasterPlan() {
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const villageName = useVillageName();
  const zones = villageZones(villageName);
  const brand = useBrandImages();
  const settings = useVillageSettings();
  const stats = statedFacts(settings, statShapes).map(withStatedUnit);
  // Same rule as the investor page: null is "not loaded", never "nothing to
  // say". A village with a valuation must not be told it has none while its
  // own settings are still in flight.
  const loaded = settings !== null;
  const appraisal = stats.find((s) => s.key === "appraisal");
  return (
    <Layout>
      {/* Hero.
          The section's own surface is the brand BAND, so the copy has a known
          colour behind it before anything else is drawn. shared/brandTokens.ts
          derives --tone-brand-band and measures white on it at 4.5:1 or better
          for every seed, which is what makes that a promise rather than a
          guess about the platform's own neutral palette. */}
      <section className="relative py-24 overflow-hidden bg-teal-band">
        <div className="absolute inset-0 z-0">
          {/* THE HERO RENDERS ONLY WHEN THERE IS ONE, matching the four
              journey pages (InvestorJourney, StewardJourney, ResidentJourney,
              ProsperityJourney). Without this guard a village that has
              uploaded no master plan art got Image's placeholder: a 32px
              picture frame centred in a 1264x489 hero, which landed inside the
              headline's own box, in the leading between its two lines. It
              paints BEHIND the headline (the h1 wins the hit test at that
              point), so it was never a stacking bug: it was a 32px mark
              centred in a full-bleed box that happens to be the same box the
              title sits in. Drawing nothing removes it at the source, and the
              scrim goes with the picture it exists to darken.

              A configured hero that then 404s still shows the mark, with the
              village's own alt text on it. That case is genuinely broken and
              should look it. */}
          {brand.masterPlanHero ? (
            <>
              <Image
                src={brand.masterPlanHero}
                alt={altOr(brand.masterPlanHeroAlt, "The master plan for the village")}
                priority
                className="w-full h-full"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-teal-band via-teal-band/90 to-teal-band/60" />
            </>
          ) : null}
        </div>

        <div className="container relative z-10">
          <div className="relative max-w-3xl">
            {/* The copy's own opaque band. A scrim at 60% cannot promise a
                ratio, because what shows through it is whatever photograph the
                village uploaded. This is opaque, so the ratio is a property of
                two named colours. It is invisible until there IS a picture,
                because the section behind it is the same band colour. */}
            <div
              aria-hidden="true"
              className="absolute -inset-x-5 -inset-y-6 sm:-inset-x-8 sm:-inset-y-10 rounded-3xl bg-teal-band"
            />
            <motion.div
              className="relative"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Map className="w-16 h-16 text-white mb-6 opacity-80" />
              <h1 className="font-display text-4xl md:text-6xl font-bold text-white mb-6">
                The {villageName} Master Plan
              </h1>
              <p className="text-xl text-white leading-relaxed">
                Our vision for a regenerative village that harmonizes human habitation 
                with the natural beauty of the land it sits on.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats. A village that has stated no figures gets no band at all: an
          empty row of headings with nothing under them reads as broken, and a
          placeholder number would be a claim nobody made. */}
      {stats.length ? (
      <section className="py-12 bg-teal-deep text-white">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="text-center"
              >
                <stat.icon className="w-8 h-8 mx-auto mb-2 opacity-80" />
                <div className="font-display text-3xl md:text-4xl font-bold mb-1">
                  {stat.value}
                </div>
                <div className="text-sm text-white">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      ) : null}

      {/* Vision */}
      <section className="py-20 bg-background overflow-x-clip">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              Our Vision
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              {villageName} is designed as a complete village ecosystem, a place where people live, 
              work, learn, and thrive together. Our master plan balances development with 
              conservation, ensuring that the land regenerates even as we build upon it.
            </p>
          </div>

          {/* Zones */}
          <div className="space-y-8 max-w-4xl mx-auto">
            {zones.map((zone, index) => (
              <motion.div
                key={zone.title}
                initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="bg-card p-8 rounded-2xl shadow-sm"
              >
                <div className="flex items-start gap-6">
                  <div className="w-14 h-14 rounded-xl bg-teal-deep/10 flex items-center justify-center flex-shrink-0">
                    <zone.icon className="w-7 h-7 text-teal-deep" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display text-2xl font-bold text-foreground mb-2">
                      {zone.title}
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      {zone.description}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {zone.features.map((feature) => (
                        <span
                          key={feature}
                          className="px-3 py-1 bg-muted text-muted-foreground text-sm rounded-full"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Appraisal Info */}
      <section className="py-20 bg-aqua-light">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <Building className="w-12 h-12 text-teal-deep mx-auto mb-6" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              Land Valuation
            </h2>
            {/* The appraisal sentence names the village's own figure or it does
                not appear. It used to name one specific property's valuation and
                the month it was made, in prose, on every fork. */}
            {!loaded ? null : appraisal ? (
              <>
                <p className="text-muted-foreground mb-6">
                  {appraisal.note ? `${appraisal.note}: an appraisal ` : "An appraisal "}
                  valued the property at <strong>{appraisal.value}</strong>.
                </p>
                <p className="text-muted-foreground">
                  This valuation supports the financing strategy and shows the asset base
                  underneath the village.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                This village has not published a land valuation yet.
              </p>
            )}
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-teal-deep/30 text-teal-deep rounded-lg font-semibold cursor-not-allowed opacity-60"
              title="Master Plan PDF coming soon"
            >
              <Map className="w-5 h-5" />
              Master Plan PDF, Coming Soon
            </button>
          </div>
        </div>
      </section>

      {/* Development Timeline */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              Development Phases
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              With a potential 1% regenerative development loan, multiple phases can 
              proceed simultaneously, accelerating our timeline significantly.
            </p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-4">
              {[
                { phase: "Infrastructure", items: "Roads, utilities, water systems", status: "In Progress" },
                { phase: "Community Center", items: "Café, gathering spaces, offices", status: "Planning" },
                { phase: "Show Homes", items: "10 homes of various styles", status: "Planning" },
                { phase: "Retreat Center", items: "120-150 key wellness facility", status: "Planning" },
                { phase: "Health Center", items: "Integrative health services", status: "Planning" },
                { phase: "Residential Phase 1", items: "First 50 home sites", status: "Future" },
              ].map((item, index) => (
                <motion.div
                  key={item.phase}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center justify-between p-4 bg-card rounded-lg"
                >
                  <div>
                    <div className="font-semibold text-foreground">{item.phase}</div>
                    <div className="text-sm text-muted-foreground">{item.items}</div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    item.status === "In Progress" ? "bg-sage/10 text-sage" :
                    item.status === "Planning" ? "bg-teal-deep/10 text-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {item.status}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-teal-deep text-white">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
              Be Part of the Vision
            </h2>
            <p className="text-white mb-8">
              Whether you want to invest, live, work, or create at {villageName}, 
              there's a place for you in our master plan.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-8 py-4 bg-white text-teal-deep rounded-lg font-semibold hover:bg-white/90 transition-colors flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Join Community Call
                </a>
              )}
              <Link
                href="/"
                className="px-8 py-4 bg-white/20 text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
              >
                Choose Your Path
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
