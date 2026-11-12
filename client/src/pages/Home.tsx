import Layout from "@/components/Layout";
import BuildProgress from "@/components/BuildProgress";
import SeasonBanner from "@/components/SeasonBanner";
import VillagePulse from "@/components/VillagePulse";
import MapPeek from "@/components/MapPeek";
import { altOr, useBrandImages, useVillageLinks } from "@/lib/gameApi";
import { Link } from "wouter";
import { m } from "framer-motion";
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
import { lazy, Suspense, useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, LINK, NOTE, RING, WORLD } from "@/components/journey/look";
import { Image } from "@/components/Image";
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized, Highlighted } from "@/components/PageText";
import { HOME_PAGE } from "@shared/pageContent/home";
import { useModule } from "@/modules/ModuleProvider";
import { scrollBehavior } from "@/components/natural/scrollBehavior";
import { useStoryPageOffAlone } from "@/lib/brochure";



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

/**
 * The lights on the one act, through React.lazy (docs/DESIGN_RULE.md): a
 * static import here regrouped the shared chunks and pulled lazy-only modules
 * onto the first page (the guard-boot-set build check). Until the kit arrives
 * the act draws without its lights.
 */
const Fireflies = lazy(() => import("@/components/journey/nature/Fireflies"));

/** What each path card needs that is not words: where it goes, its icon, its picture. */
const PATH_CARD_LOOK = {
  investor: { icon: TrendingUp, href: "/investor", color: "bg-amber", imageKey: "investorHero", altKey: "investorHeroAlt" },
  steward: { icon: Users, href: "/steward", color: "bg-sage", imageKey: "stewardHero", altKey: "stewardHeroAlt" },
  resident: { icon: HomeIcon, href: "/resident", color: "bg-teal", imageKey: "residentHero", altKey: "residentHeroAlt" },
  prosperity: { icon: Sparkles, href: "/prosperity", color: "bg-teal-light", imageKey: "prosperityHero", altKey: "prosperityHeroAlt" },
} as const;

/**
 * The headline steps down a size as it grows, so a village's own longer line
 * still sits in about four lines instead of running six deep. Up to 36
 * characters keeps the original size, which the platform's own headline fits.
 */
function headlineSize(text: string): string {
  const n = Array.from(text).length;
  if (n <= 36) return "text-5xl md:text-7xl";
  if (n <= 44) return "text-4xl md:text-6xl";
  return "text-4xl md:text-5xl";
}

/** Icons for the stages and the people cards, handed out in order. */
const STAGE_ICONS = [Heart, Calendar, Users, CheckCircle2, HomeIcon, TreePine];
const PERSONA_LOOKS = [
  { icon: Laptop, color: "bg-teal/10", iconColor: "text-teal-deep" },
  { icon: GraduationCap, color: "bg-sage/20", iconColor: "text-sage" },
  { icon: Sunset, color: "bg-amber/20", iconColor: "text-amber-ink" },
  { icon: Zap, color: "bg-primary/10", iconColor: "text-primary" },
  { icon: Briefcase, color: "bg-teal-light/20", iconColor: "text-teal-deep" },
  { icon: Globe, color: "bg-sage-light/40", iconColor: "text-sage" },
  { icon: MapPin, color: "bg-teal/10", iconColor: "text-teal-deep" },
  { icon: FileText, color: "bg-sage/20", iconColor: "text-sage" },
  { icon: Heart, color: "bg-amber/20", iconColor: "text-amber-ink" },
];

export default function Home() {
  const { t } = useLingui();
  // Blank hides both buttons rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const brand = useBrandImages();
  // Every word on this page is the village's own, from Admin, Pages, Home
  // (shared/pageContent/home.ts). Null until the saved words have arrived:
  // the hero keeps its space and stays invisible meanwhile, so a visitor never
  // reads the platform's defaults and then watches them change.
  const page = usePageContent(HOME_PAGE);
  const hero = page?.hero.fields;
  const journey = page?.journey;
  const paths = page?.paths;
  // A journey switched off on its own in Admin, Pages takes its card with it,
  // and with no card left the section draws nothing, as if it were hidden.
  const pageOff = useStoryPageOffAlone();
  const pathCards = (paths?.lists.cards ?? []).filter((card) => {
    const look = PATH_CARD_LOOK[card.id as keyof typeof PATH_CARD_LOOK];
    return !!look && !pageOff(look.href);
  });
  const personas = page?.personas;
  const cta = page?.cta;
  // R47: the hero holds one door forward, plus the map when this village has
  // one. An off module would only answer the door with its closed card.
  const mapOn = !!useModule("map");
  // THE FOUNDING TEAM IS THE FIRST SCREEN'S ONE ACT while the village has the
  // section on (D-01). A senior professional landing here read no word about
  // paid roles, and the only gold on the screen was a link off the site. Off,
  // the hero keeps its own door to the paths. The read never blocks the page.
  const founding = useFoundingOn();
  const pathsShown = !!paths && !paths.hidden && pathCards.length > 0;
  const waysShown = pathsShown || founding;
  const foundingLink = (
      <Link href="/roles" className={`${BTN_PRIMARY} min-h-12 px-6 text-base`} data-hero-act="founding">
        {t({ message: "Join the founding team", context: "landing hero main act" })}
        <ArrowRight aria-hidden="true" className="h-5 w-5" />
      </Link>
  );
  const heroAct = founding ? (
    <Suspense fallback={foundingLink}>
    <Fireflies count={6}>
      {foundingLink}
    </Fireflies>
    </Suspense>
  ) : (
    <a href="#choose-path" className={`${BTN_PRIMARY} min-h-12 px-6 text-base`} data-hero-act="paths">
      Pick your path
      <ArrowRight aria-hidden="true" className="h-5 w-5" />
    </a>
  );
  return (
    <Layout>
      {/* THE LANDING STANDS IN THE NIGHT WORLD (D-01, docs/DESIGN_RULE.md): the
          same ground, tokens and display face as the founding pages a visitor
          goes on to, so the first screen and the second are one place. */}
      <div className={WORLD}>
      {/* Hero Section. Words first, then the picture (M11): the photograph
          mounts once the words are there, so a slow phone paints the sentence
          and never an empty frame. */}
      <section className="relative overflow-hidden" data-landing-hero="">
        <div className="absolute inset-0 z-0">
          {/* THE HERO RENDERS ONLY WHEN THERE IS ONE, the same rule the four
              journey pages follow. A village with no uploaded art gets the
              night ground and nothing that reads as a broken photograph. A
              hero that IS configured and then fails to load keeps Image's
              mark and the village's own alt text, because that is breakage.
              priority: it is the largest paint once it arrives. */}
          {brand.hero && hero ? (
            <>
              <Image
                src={brand.hero}
                alt={altOr(brand.heroAlt, "The village and the land around it")}
                priority
                className="w-full h-full"
              />
              {/* The scrim belongs to the photograph and goes with it: dark
                  where the words sit, open where the land is, and dark again
                  at the foot where the ways in overlap the hero. */}
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/20" />
              <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
            </>
          ) : null}
        </div>

        <div className={`container relative z-10 pt-12 sm:pt-20 lg:pt-28 ${waysShown ? "pb-32 sm:pb-36 lg:pb-44" : "pb-16 lg:pb-24"}`}>
          <div className="relative max-w-2xl">
            {/* THE COPY SITS ON AN OPAQUE BAND, so its contrast is a property
                of two named colours and holds whatever photograph is behind
                it. With no photograph the band is the ground itself and never
                shows; with one, it is the dark panel the words need. */}
            <div
              aria-hidden="true"
              className="absolute -inset-x-5 -inset-y-6 sm:-inset-x-8 sm:-inset-y-10 rounded-2xl bg-background"
            />
            {hero?.badge ? (
              <p className={`relative mb-5 ${EYEBROW}`}>{hero.badge}</p>
            ) : null}
            <h1
              style={{ animationDelay: "0.05s" }}
              className={`hero-rise relative font-display ${headlineSize(hero?.headline ?? "")} leading-[1.08] text-foreground text-balance mb-6 break-words${hero ? "" : " invisible"}`}
            >
              <Highlighted
                text={hero?.headline || "\u00a0"}
                phrase={hero?.highlight ?? ""}
                render={(phrase) => <span className="text-notice">{phrase}</span>}
              />
            </h1>

            <p
              style={{ animationDelay: "0.1s" }}
              className={`hero-rise relative max-w-[34em] text-lg sm:text-xl text-foreground/90 leading-relaxed mb-8${hero ? "" : " invisible"}`}
            >
              <Emphasized text={hero?.subline ?? ""} strongClassName="font-semibold text-foreground" />
              {founding ? (
                <>
                  {" "}
                  {t({
                    message: "We're forming the founding team now: paid, multi-year roles that take the village from idea to home.",
                    context: "landing hero, the founding team line",
                  })}
                </>
              ) : null}
            </p>

            <div
              style={{ animationDelay: "0.15s" }}
              className="hero-rise relative flex flex-wrap items-center gap-3"
            >
              {heroAct}
              {mapOn ? (
                <Link href="/map" className={`${BTN_SECONDARY} min-h-12 bg-background/60 px-5 text-base`}>
                  {t({ message: "Explore the map", context: "landing hero second act" })}
                </Link>
              ) : founding ? (
                <a href="#choose-path" className={`${BTN_SECONDARY} min-h-12 bg-background/60 px-5 text-base`}>
                  Pick your path
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* THE WAYS IN, overlapping the hero's foot (D-01, D-16). One row on a
          desktop, every card the same height with its door at the bottom; a
          column on a phone. The founding team leads with the gold edge while
          the village has the section on. The section keeps its id when it is
          empty so the hero's "Pick your path" never points at nothing. */}
      <section id="choose-path" aria-labelledby={waysShown ? "choose-path-h" : undefined} className={waysShown ? "relative z-20 scroll-mt-24 pb-16 sm:pb-20" : undefined}>
        {waysShown && (
        <div className="container -mt-24 sm:-mt-28 lg:-mt-32">
          {paths && pathsShown ? (
            <div className="relative mb-5 max-w-2xl">
              <p className={EYEBROW}>{paths.fields.eyebrow}</p>
              <h2 id="choose-path-h" className="mt-2 font-display text-2xl leading-tight text-foreground sm:text-3xl">
                {paths.fields.heading}
              </h2>
            </div>
          ) : (
            <h2 id="choose-path-h" className="sr-only">
              {t({ message: "Ways in", context: "landing, the ways in heading when the paths are hidden" })}
            </h2>
          )}
          <ul className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
            {founding && (
              <li className="min-w-0">
                <Link href="/roles" className={`${WAY_CARD} border-2 border-notice/60`} data-way="founding">
                  <span className={EYEBROW}>{t({ message: "Paid roles", context: "landing, founding team card eyebrow" })}</span>
                  <span className="mt-2 block font-display text-2xl leading-tight text-foreground">
                    {t({ message: "Founding team", context: "landing, founding team card title" })}
                  </span>
                  <span className={`mt-2 block ${WAY_BODY}`}>
                    {t({ message: "Lead a whole domain of the village, from the foundation through to completion.", context: "landing, founding team card body" })}
                  </span>
                  <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-notice">
                    {t({ message: "See the open roles", context: "landing, founding team card door" })}
                    <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            )}
            {pathsShown && pathCards.map((card) => {
              const look = PATH_CARD_LOOK[card.id as keyof typeof PATH_CARD_LOOK];
              if (!look) return null;
              const art = brand[look.imageKey];
              return (
                <li key={card.id} className="min-w-0">
                  <Link href={look.href} className={`${WAY_CARD} border border-border`}>
                    {/* The village's own art for this way in, when it has added
                        some; a card without art is a quiet card, never a frame. */}
                    {art ? (
                      <span className="relative -mx-5 -mt-5 mb-4 block h-28 overflow-hidden rounded-t-2xl">
                        <JourneyArt src={art} alt={altOr(brand[look.altKey], card.title)} />
                      </span>
                    ) : null}
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="font-display text-2xl leading-tight text-foreground">{card.title}</h3>
                      <span className="text-sm text-muted-foreground">{card.subtitle}</span>
                    </span>
                    <span className={`mt-2 block ${WAY_BODY}`}>{card.description}</span>
                    <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-foreground group-hover:text-notice">
                      <span>Choose {card.title}</span>
                      <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {paths && pathsShown && paths.fields.intro ? (
            <p className={`mt-6 max-w-2xl ${NOTE}`}>
              <Emphasized text={paths.fields.intro} />
            </p>
          ) : null}
        </div>
        )}
      </section>

      <SeasonBanner />

      {/* The commons: this season's goals, the village's own count and no
          names (batch 157, D3; D-19). Placed right after the ways in. */}
      <VillagePulse />

      {/* Journey Stages */}
      {journey && !journey.hidden && (
      <section className="border-y border-border/60 bg-card/40 py-16">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl text-foreground mb-4">
              {journey.fields.heading}
            </h2>
            <p className={`mx-auto ${NOTE} max-w-2xl`}>
              <Emphasized text={journey.fields.intro} />
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-4 md:gap-0">
            {journey.lists.stages.map((item, index, all) => {
              const Icon = STAGE_ICONS[index % STAGE_ICONS.length];
              return (
              <div key={`${index}-${item.name}`} className="flex items-center">
                <m.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex flex-col items-center px-6 py-4"
                >
                  <span className={`${RING} mb-3 size-14`} aria-hidden="true">
                    <Icon className="w-6 h-6" />
                  </span>
                  <span className="font-display text-lg text-foreground">
                    {item.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {item.description}
                  </span>
                </m.div>
                {index < all.length - 1 && (
                  <ArrowRight aria-hidden="true" className="w-5 h-5 text-muted-foreground hidden md:block" />
                )}
              </div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      <BuildProgress />

      {/* Seeing the place, after the ways in. */}
      <MapPeek />

      {/* Who comes to this village */}
      {personas && !personas.hidden && (
      <section className="py-24">
        <div className="container">
          <div className="text-center mb-16">
            <m.span
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className={`mb-4 inline-block ${EYEBROW}`}
            >
              {personas.fields.eyebrow}
            </m.span>
            <m.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-display text-4xl md:text-5xl text-foreground mb-4"
            >
              {personas.fields.heading}
            </m.h2>
            <m.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl text-muted-foreground max-w-2xl mx-auto"
            >
              <Emphasized text={personas.fields.intro} />
            </m.p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {personas.lists.items.map((persona, index) => {
              const look = PERSONA_LOOKS[index % PERSONA_LOOKS.length];
              return (
              <m.div
                key={`${index}-${persona.label}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.07 }}
                className="bg-card rounded-xl p-6 shadow-sm border border-border"
              >
                <span className={`${RING} mb-4`} aria-hidden="true">
                  <look.icon className="w-5 h-5" />
                </span>
                <h3 className="font-display text-lg text-foreground mb-1">
                  {persona.label}
                </h3>
                {persona.tagline && (
                <p className="text-notice text-sm font-medium italic mb-3">
                  "{persona.tagline}"
                </p>
                )}
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {persona.body}
                </p>
              </m.div>
              );
            })}
          </div>

          <div className="text-center mt-12">
            <p className="text-muted-foreground mb-4">
              {personas.fields.footer}
            </p>
            <a
              href="#choose-path"
              className={`inline-flex min-h-11 items-center gap-2 ${LINK}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById("choose-path")
                  ?.scrollIntoView({ behavior: scrollBehavior() });
              }}
            >
              Pick your path <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
      )}

      {/* CTA Section */}
      {cta && !cta.hidden && (
      <section className="border-t border-border/60 bg-card/40 py-24">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <m.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-display text-4xl md:text-5xl text-foreground mb-6"
            >
              {cta.fields.heading}
            </m.h2>
            <m.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl text-muted-foreground mb-8"
            >
              <Emphasized text={cta.fields.body} />
            </m.p>
            <m.div
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
                  className={BTN_SECONDARY}
                >
                  <Calendar className="w-5 h-5" />
                  {cta.fields.primaryLabel}
                </a>
              )}
              {eventsUrl && cta.fields.secondaryLabel && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={BTN_SECONDARY}
                >
                  {cta.fields.secondaryLabel}
                </a>
              )}
            </m.div>
          </div>
        </div>
      </section>
      )}
      </div>
    </Layout>
  );
}

/** A way-in card: the whole card is the door, every one the same height, the door's words at the foot. */
const WAY_CARD =
  "group flex h-full flex-col rounded-2xl bg-card p-5 shadow-sm transition-colors hover:border-notice/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const WAY_BODY = "text-sm leading-relaxed text-muted-foreground sm:text-base";

/** Whether the village has its founding team section on. Off until the read answers, and off when it fails. */
function useFoundingOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    // The same public read the roles page makes (GET /api/org/founding-team),
    // asked for its one yes or no; any failure is the section off.
    fetch("/api/org/founding-team")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setOn(d?.on === true && Array.isArray(d?.roleIds) && d.roleIds.length > 0))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return on;
}
