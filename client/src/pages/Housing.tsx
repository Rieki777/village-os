import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { useVillageLinks } from "@/lib/gameApi";
import { homeChoices, type PublicHome } from "@/lib/housingForm";
import { Link } from "wouter";
import { m } from "framer-motion";
import { useVillageContent } from "@/hooks/useVillageContent";
import { useVillageName } from "@/hooks/useVillageName";
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized } from "@/components/PageText";
import {
  HOUSING_PAGE,
  HOUSING_TRANSFER_DEFAULT,
  type HousingFeatureIcon,
} from "@shared/pageContent/housing";
import {
  Home,
  ArrowRight,
  Calendar,
  MapPin,
  TreePine,
  Mountain,
  Droplets,
  Sun,
  Leaf,
  Sprout,
  Wind,
  Heart,
  type LucideIcon,
} from "lucide-react";
import { useStoryPageOffAlone } from "@/lib/brochure";

interface LegalContent {
  landShareTransferNote?: string;
}

/*
 * THE FOUR TIERS THAT USED TO LIVE HERE ARE GONE (0131), and this comment is
 * the record of why, so nobody reinstates them as sensible defaults.
 *
 * They were a module constant: four names, four square-footage bands and four
 * dollar price bands, each with a "Reserve this home" button under it.
 * ReserveHome.tsx carried a second copy of the same four sizes, worded
 * differently for the same homes. `/housing` is not module-gated, so EVERY
 * village that deploys this platform published those American figures under
 * its own name, to prospective residents, and no admin field anywhere could
 * change one of them. Read live on 2026-09-02 at a Costa Rican village
 * publishing dollars and square feet nobody there chose. The figures as they
 * shipped are recorded in drizzle/0131_a_village_names_its_own_homes.sql;
 * they are deliberately not repeated in this file, because
 * client/src/lib/housingForm.test.ts fails on any of them appearing here and
 * that guard is worth more than the quotation.
 *
 * The homes now come from the village's own table (0131,
 * `GET /api/housing/public` -> `homes`, written in Admin, Housing), every
 * field free text, and they ship EMPTY. A village that has not described its
 * homes shows no tier section at all: no heading, no empty grid, no
 * placeholder card. Seeding the old numbers as defaults to spare an existing
 * village a blank section would put the defect straight back, so it was not
 * done and must not be.
 *
 * The KEYS survive, in server/lib/housing.ts's HOME_TYPES, because they are
 * the contract: a key travels as ?type= to the reservation form, and the
 * server refuses a homeType outside that list. A founder renames a home by
 * typing a name; the key underneath does not move.
 */

/**
 * The pictures behind the icon words a founder types for a land feature
 * (shared/pageContent/housing.ts lists the words). Keyed by the union, so a
 * word added to the list without a picture here fails to compile.
 */
const FEATURE_ICONS: Record<HousingFeatureIcon, LucideIcon> = {
  mountain: Mountain,
  water: Droplets,
  forest: TreePine,
  sun: Sun,
  leaf: Leaf,
  sprout: Sprout,
  wind: Wind,
  home: Home,
  pin: MapPin,
  heart: Heart,
};

/** A word not on the list draws the first picture, so a typo shows a plain icon instead of a hole. */
function featureIcon(word: string | undefined): LucideIcon {
  const key = (word ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(FEATURE_ICONS, key)
    ? FEATURE_ICONS[key as HousingFeatureIcon]
    : Mountain;
}

export default function Housing() {
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  // A link to a story page switched off on its own in Admin, Pages is left out.
  const pageOff = useStoryPageOffAlone();
  const villageName = useVillageName();
  // The page's words are the village's own, from Admin, Pages, Housing
  // (shared/pageContent/housing.ts). Null until the saved words have arrived,
  // so the defaults never paint first and then change.
  const page = usePageContent(HOUSING_PAGE);
  const hero = page?.hero.fields;
  const features = page?.features;
  const tenure = page?.tenure;
  const cta = page?.cta.fields;
  /**
   * S2 brochure lane, 2026-08-30: this section used to state the land share
   * transfers "tax-free" unconditionally: Costa Rica's tax treatment,
   * compiled into every fork. `content.legal.landShareTransferNote`
   * (GET /api/content/legal) is empty on a fresh instance, so the card below
   * falls back to a plain, honest description with no tax claim in it. See
   * WhyCostaRica.tsx for the fuller version of this fix.
   */
  const { content: legal } = useVillageContent<LegalContent>("legal");
  const transferNote = legal?.landShareTransferNote?.trim();
  /*
   * The Transferable card follows that note only while its description is
   * the platform's own. A village that wrote its own description in Pages has
   * said what it means, and the note does not overwrite it.
   */
  const tenureBody = (id: string | undefined, body: string) =>
    id === "transferable" && transferNote && body === HOUSING_TRANSFER_DEFAULT
      ? `Pass your land share to your children ${transferNote}, keeping it in the family.`
      : body;
  /*
   * The homes this village has published, and nothing else (0131). `null`
   * until the read lands; `homeChoices` is where the three answers live, so
   * this page and /reserve cannot disagree about what an empty list means.
   *
   * A failed read settles to an empty list, which draws no tier section. Fail
   * closed: a network blip must never publish a figure, and there is no
   * figure to publish when the list is empty.
   */
  const [homes, setHomes] = useState<PublicHome[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/housing/public")
      .then((r) => (r.ok ? r.json() : { homes: [] }))
      .then((d) => {
        if (alive) setHomes(Array.isArray(d?.homes) ? d.homes : []);
      })
      .catch(() => alive && setHomes([]));
    return () => {
      alive = false;
    };
  }, []);
  const choices = homeChoices(homes);
  /*
   * FORWARD the hamlet, if this page was handed one (0077). A card click
   * would otherwise drop it and the person would have to say where they want
   * to live a second time. Read at render; the query string does not change
   * under this page.
   *
   * This page MINTS NOTHING. Measured 2026-08-14, no link anywhere in the
   * repo sends `?hamlet=` to it, so today this always produces `/reserve`
   * with a type and no hamlet. The producer is a link out of a structure on
   * the map carrying that structure's own key, and it is the map lane's to
   * add; this reader is here so it works the day it lands.
   */
  const reserveHref = (typeKey: string) => {
    const here = new URLSearchParams(window.location.search);
    const out = new URLSearchParams({ type: typeKey });
    const hamlet = here.get("hamlet") ?? "";
    if (/^[A-Za-z0-9_-]{1,64}$/.test(hamlet)) {
      out.set("hamlet", hamlet);
      out.set("from", here.get("from") === "map" ? "map" : "site");
    }
    return `/reserve?${out.toString()}`;
  };

  return (
    <Layout>
      {/* Hero, on the band: the ground the Governance, Visit and WorkWithUs
          heroes use (Rye's ruling, 2026-09-21). It sat on the soft tone,
          where white measured 1.67 to 3.00:1 for every seed. The paragraph is
          full white on purpose: at /80 it drops under 4.5 on 7 of the 54
          seeded themes (4.03 worst), and full white clears 5.36 on all of
          them. client/src/lib/brandGroundContrast.test.ts measures both. */}
      <section className="py-24 bg-teal-band text-white">
        <div className="container">
          <div className="max-w-3xl">
            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Home className="w-16 h-16 mb-6 opacity-80" />
              <h1 className="font-display text-4xl md:text-6xl font-bold mb-6">
                Housing at {villageName}
              </h1>
              {/* This paragraph used to open "From tiny homes to luxury
                  villas", naming four tiers the page can no longer promise
                  are there, and to state that all homes are built with
                  sustainable materials, which is a claim about one village's
                  construction. Both went with the constant. What is left
                  holds for any village running this platform, because the
                  Land Share structure it names is the one this page already
                  explains further down for everybody. */}
              {/* Invisible, not absent, until the saved words arrive: the
                  hero keeps its height and never shows the defaults first. */}
              <p className={`text-xl text-white leading-relaxed break-words${hero ? "" : " invisible"}`}>
                <Emphasized text={hero?.lede ?? "\u00a0"} />
              </p>
            </m.div>
          </div>
        </div>
      </section>

      {/* Land Features. A village that hid them, or listed none, draws no
          band at all rather than an empty strip of colour. */}
      {features && !features.hidden && features.lists.items.length > 0 && (
      <section className="py-16 bg-aqua-light">
        <div className="container">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.lists.items.map((feature, index) => {
              const Icon = featureIcon(feature.icon);
              return (
              <m.div
                key={`${index}-${feature.title}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="text-center min-w-0"
              >
                <div className="w-14 h-14 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-4">
                  <Icon className="w-7 h-7 text-teal" />
                </div>
                <h2 className="font-display text-lg font-semibold text-foreground mb-2 break-words">
                  {feature.title}
                </h2>
                <p className="text-sm text-muted-foreground break-words">
                  {feature.body}
                </p>
              </m.div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* Housing Options.
          THE WHOLE SECTION, HEADING AND ALL, OR NOTHING. Hiding only the grid
          leaves "Housing Options" standing over a gap, which reads as a page
          that failed to load rather than as a village that has not described
          its homes yet, and an empty heading is exactly the scaffolding this
          change exists to stop drawing.

          It also stays away while the read is in flight (`unknown`), so a
          village that HAS published homes never flashes a missing section on
          the way to showing them.

          The sentence that used to sit under the heading, "We're building 10
          show homes of various sizes and styles. Prices are estimates and
          will vary based on finishes and location", went with the tiers: a
          count of one project's show homes and a caveat about one project's
          pricing, published under every fork's name. A village that wants to
          say either can say it in a home's own description, in its own
          words. */}
      {choices.kind === "some" && (
        <section className="py-20 bg-background">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
                Housing Options
              </h2>
            </div>

            <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
              {choices.homes.map((home, index) => (
                <m.div
                  key={home.homeType}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="bg-card rounded-2xl shadow-sm"
                >
                  <Link
                    href={reserveHref(home.homeType)}
                    className="block p-8 rounded-2xl hover:shadow-md transition-shadow"
                  >
                    {/* Every line below prints exactly what the founder
                        typed. No unit is appended, no currency symbol is
                        supplied, no figure is reformatted, and a field left
                        blank draws nothing rather than an empty badge. */}
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="font-display text-2xl font-bold text-foreground">
                          {home.name}
                        </h3>
                        {home.size && (
                          <p className="text-sm text-muted-foreground">{home.size}</p>
                        )}
                      </div>
                      {home.price && (
                        <span className="px-3 py-1 bg-teal/10 text-teal text-sm font-medium rounded-lg shrink-0">
                          {home.price}
                        </span>
                      )}
                    </div>
                    {home.description && (
                      <p className="text-muted-foreground mb-4 whitespace-pre-line">
                        {home.description}
                      </p>
                    )}
                    {home.features.length > 0 && (
                      <ul className="space-y-2 mb-5">
                        {home.features.map((feature) => (
                          <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-teal shrink-0" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    )}
                    <span className="inline-flex items-center gap-2 text-teal font-medium">
                      Reserve this home
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </Link>
                </m.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Land Share Info: how a home is held here, in the village's words. */}
      {tenure && !tenure.hidden && (
      <section className="py-20 bg-teal/10">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <MapPin className="w-12 h-12 text-teal mx-auto mb-6" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4 break-words">
              {tenure.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-6 break-words">
              <Emphasized text={tenure.fields.intro} />
            </p>
            <div className="grid sm:grid-cols-3 gap-6 text-left mb-8">
              {tenure.lists.points.map((point) => (
              <div key={point.id} className="bg-card p-6 rounded-xl min-w-0">
                <h3 className="font-semibold text-foreground mb-2 break-words">{point.title}</h3>
                <p className="text-sm text-muted-foreground break-words">
                  {tenureBody(point.id, point.body)}
                </p>
              </div>
              ))}
            </div>
            {!pageOff("/resident") && (
              <Link
                href="/resident"
                className="inline-flex items-center gap-2 px-6 py-3 bg-teal-deep text-white rounded-lg font-semibold hover:bg-teal-deep-dark transition"
              >
                Learn About Residency
                <ArrowRight className="w-5 h-5" />
              </Link>
            )}
          </div>
        </div>
      </section>
      )}

      {/* CTA */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              Interested in Housing?
            </h2>
            <p className={`text-muted-foreground mb-8 break-words${cta ? "" : " invisible"}`}>
              <Emphasized text={cta?.body ?? "\u00a0"} />
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-8 py-4 bg-teal-deep text-white rounded-lg font-semibold hover:bg-teal-deep-dark transition flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Join Community Call
                </a>
              )}
              {!pageOff("/resident") && (
                <Link
                  href="/resident"
                  className="px-8 py-4 bg-muted text-foreground rounded-lg font-semibold hover:bg-muted/80 transition-colors"
                >
                  Resident Journey
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
