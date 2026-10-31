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
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized } from "@/components/PageText";
import { MASTER_PLAN_PAGE, zoneTags } from "@shared/pageContent/masterPlan";
import type { ResolvedPage } from "@shared/pageContent/types";


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
/*
 * The tile labels are the village's own words (Admin, Pages, Master Plan,
 * Land figures). The land tile's label is still built from the unit, below.
 */
function statShapes(page: ResolvedPage | null) {
  const labels = page?.stats.fields;
  return [
    { key: "acres", label: "Total Acres", icon: Mountain },
    { key: "plannedHomes", label: labels?.plannedHomesLabel ?? "", icon: Home },
    { key: "guestRooms", label: labels?.guestRoomsLabel ?? "", icon: Tent },
    { key: "appraisal", label: labels?.appraisalLabel ?? "", icon: Building },
  ];
}

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

/** Icons for the zone cards, handed out in order. The words are the village's (Admin, Pages, Master Plan). */
const ZONE_ICONS = [Users, Home, Tent, TreePine, Droplets, Mountain, Building, Map];

/** The pill colour a phase's status earns. Any other status reads plain. */
function phaseStatusClass(status: string): string {
  if (status === "In Progress") return "bg-sage/10 text-sage";
  if (status === "Planning") return "bg-teal-deep/10 text-foreground";
  return "bg-muted text-muted-foreground";
}

export default function MasterPlan() {
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const villageName = useVillageName();
  // Every word on this page is the village's own, from Admin, Pages, Master
  // Plan (shared/pageContent/masterPlan.ts). Null until the saved words have
  // arrived, so the defaults never flash first.
  const page = usePageContent(MASTER_PLAN_PAGE);
  const brand = useBrandImages();
  const settings = useVillageSettings();
  // The tiles wait for the words too, so a label never changes under a figure.
  const stats = page ? statedFacts(settings, statShapes(page)).map(withStatedUnit) : [];
  // Same rule as the investor page: null is "not loaded", never "nothing to
  // say". A village with a valuation must not be told it has none while its
  // own settings are still in flight.
  const loaded = settings !== null;
  const appraisal = stats.find((s) => s.key === "appraisal");
  const vision = page?.vision;
  const valuation = page?.valuation;
  const phases = page?.phases;
  const cta = page?.cta;
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
              <h1 className="font-display text-4xl md:text-6xl font-bold text-white mb-6 break-words">
                The {villageName} Master Plan
              </h1>
              <p className={`text-xl text-white leading-relaxed break-words${page ? "" : " invisible"}`}>
                <Emphasized text={page?.hero.fields.subline || "\u00a0"} />
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
          {/* A figure steps down a size on a phone, and breaks only as a last
              resort: "$4,200,000" at text-3xl measured 161px in a 128px
              column at 320px wide and pushed the whole page sideways. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-8">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="text-center min-w-0"
              >
                <stat.icon className="w-8 h-8 mx-auto mb-2 opacity-80" />
                <div className="font-display text-2xl sm:text-3xl md:text-4xl font-bold mb-1 break-words">
                  {stat.value}
                </div>
                <div className="text-sm text-white break-words">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      ) : null}

      {/* Vision */}
      {vision && !vision.hidden && (
      <section className="py-20 bg-background overflow-x-clip">
        <div className="container">
          {/* The gap under the paragraph belongs to the zone cards, and goes
              with them: the zones ship empty, and a village with none gets
              its paragraph without a hole under it. */}
          <div className={`max-w-3xl mx-auto text-center${vision.lists.zones.length ? " mb-16" : ""}`}>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4 break-words">
              {vision.fields.heading}
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed break-words">
              <Emphasized text={vision.fields.body} />
            </p>
          </div>

          {/* Zones */}
          {vision.lists.zones.length > 0 && (
          <div className="space-y-8 max-w-4xl mx-auto">
            {vision.lists.zones.map((zone, index) => {
              const Icon = ZONE_ICONS[index % ZONE_ICONS.length];
              return (
              <motion.div
                key={`${index}-${zone.title}`}
                initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="bg-card p-6 sm:p-8 rounded-2xl shadow-sm"
              >
                <div className="flex flex-wrap items-start gap-4 sm:gap-6">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-teal-deep/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-teal-deep" />
                  </div>
                  <div className="flex-1 min-w-[12rem]">
                    <h3 className="font-display text-2xl font-bold text-foreground mb-2 break-words">
                      {zone.title}
                    </h3>
                    <p className="text-muted-foreground mb-4 break-words">
                      {zone.description}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {zoneTags(zone.tags ?? "").map((tag, i) => (
                        <span
                          key={`${i}-${tag}`}
                          className="px-3 py-1 bg-muted text-muted-foreground text-sm rounded-full max-w-full break-words"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
              );
            })}
          </div>
          )}
        </div>
      </section>
      )}

      {/* Appraisal Info */}
      {valuation && !valuation.hidden && (
      <section className="py-20 bg-aqua-light">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <Building className="w-12 h-12 text-teal-deep mx-auto mb-6" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4 break-words">
              {valuation.fields.heading}
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
                {valuation.fields.support && (
                <p className="text-muted-foreground break-words">
                  <Emphasized text={valuation.fields.support} />
                </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                This village has not published a land valuation yet.
              </p>
            )}
            {/* The village's own document, or no button. This was a disabled
                "Coming Soon" on every village, including ones with no plan
                to publish. */}
            {valuation.fields.pdfUrl && (
              <a
                href={valuation.fields.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-teal-deep text-white rounded-lg font-semibold hover:bg-teal-deep-dark transition-colors max-w-full break-words"
              >
                <Map className="w-5 h-5 flex-shrink-0" />
                {valuation.fields.pdfLabel}
              </a>
            )}
          </div>
        </div>
      </section>
      )}

      {/* Development Timeline. Words the village keeps in Admin, Pages, not
          its milestones: see shared/pageContent/masterPlan.ts. The phases
          ship empty, and a heading over no phases reads as a page that
          failed to load, so the section waits for the first one. */}
      {phases && !phases.hidden && phases.lists.phases.length > 0 && (
      <section className="py-20 bg-background">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4 break-words">
              {phases.fields.heading}
            </h2>
            {phases.fields.intro && (
            <p className="text-muted-foreground max-w-2xl mx-auto break-words">
              <Emphasized text={phases.fields.intro} />
            </p>
            )}
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-4">
              {phases.lists.phases.map((item, index) => (
                <motion.div
                  key={`${index}-${item.phase}`}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4 bg-card rounded-lg"
                >
                  <div className="flex-1 min-w-[10rem]">
                    <div className="font-semibold text-foreground break-words">{item.phase}</div>
                    <div className="text-sm text-muted-foreground break-words">{item.items}</div>
                  </div>
                  {item.status && (
                  <span className={`px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 ${phaseStatusClass(item.status)}`}>
                    {item.status}
                  </span>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>
      )}

      {/* CTA */}
      {cta && !cta.hidden && (
      <section className="py-20 bg-teal-deep text-white">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-4 break-words">
              {cta.fields.heading}
            </h2>
            <p className="text-white mb-8 break-words">
              <Emphasized text={cta.fields.body} />
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
                  {cta.fields.callLabel}
                </a>
              )}
              <Link
                href="/"
                className="px-8 py-4 bg-white/20 text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
              >
                {cta.fields.pathLabel}
              </Link>
            </div>
          </div>
        </div>
      </section>
      )}
    </Layout>
  );
}
