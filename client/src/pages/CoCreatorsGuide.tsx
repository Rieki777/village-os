import Layout from "@/components/Layout";
import { useHypha } from "@/modules/ModuleProvider";
import { useVillageLinks } from "@/lib/gameApi";
import { usePageContent } from "@/hooks/usePageContent";
import { fillPageWords, useGoodNeighborName } from "@/hooks/useGoodNeighborName";
import { Emphasized } from "@/components/PageText";
import { HyphaAdminNote } from "@/components/HyphaAdminNote";
import EarningsFromTheWork from "@/components/EarningsFromTheWork";
import {
  CO_CREATORS_GUIDE_PAGE,
  type CONTRIBUTION_LOOP_IDS,
  type GUIDE_CTA_IDS,
  type GUIDE_ELDER_IDS,
  type HYPHA_ACTION_IDS,
  type IKIGAI_CIRCLE_IDS,
} from "@shared/pageContent/coCreatorsGuide";
import { GOOD_NEIGHBOR_WORD } from "@shared/pageContent/goodNeighborName";
import { Link } from "wouter";
import { m } from "framer-motion";
import { useMemo } from "react";
import {
  BookOpen,
  ArrowRight,
  Heart,
  Users,
  Calendar,
  Star,
  Compass,
  Crown,
  Home,
  TreePine,
  Circle,
  MessageCircle,
  Leaf,
  DollarSign,
  TrendingUp,
  AlertCircle,
  ExternalLink,
  ClipboardList,
  Receipt,
  UserCheck,
  Vote,
} from "lucide-react";
import { useStoryPageOffAlone } from "@/lib/brochure";

/*
 * Every word on this page is the village's own, from Admin, Pages,
 * Co-Creators Guide (shared/pageContent/coCreatorsGuide.ts). What stays here
 * is what is not words: icons, colours, links, and the live card of what
 * quests and roles are worth (EarningsFromTheWork), which reads the work.
 *
 * THE TOKEN SECTION NAMES THE TOKEN AND SAYS NOTHING ABOUT WHAT IT DOES
 * (Rye, 2026-10-22). The hold card, the spend card with its pool and
 * conversion lines, and the flow chips are gone; the section links to
 * /game-mechanics, which is generated from the rules the village set.
 */

type IkigaiId = (typeof IKIGAI_CIRCLE_IDS)[number];
type HyphaActionId = (typeof HYPHA_ACTION_IDS)[number];
type LoopId = (typeof CONTRIBUTION_LOOP_IDS)[number];
type ElderId = (typeof GUIDE_ELDER_IDS)[number];
type CtaId = (typeof GUIDE_CTA_IDS)[number];

/**
 * Where each circle's label sits on the diagram, and how its box is drawn.
 * The diagram is 440 wide (-20..420) and the two side labels sit 15 in from
 * where they were: at 400 wide, today's own "What You're GOOD AT" and "What
 * the VILLAGE NEEDS" ran past both edges and were clipped (measured
 * 2026-10-22, 236..404 and -18..177), and a label at its limit ran further.
 */
const IKIGAI_LOOK: Record<IkigaiId, { x: number; y: number; fill: string; box: string; icon: typeof Heart; iconColor: string }> = {
  love: { x: 200, y: 80, fill: "fill-primary", box: "bg-primary/5 border-primary", icon: Heart, iconColor: "text-primary" },
  good: { x: 305, y: 260, fill: "fill-sage", box: "bg-sage/5 border-sage", icon: Star, iconColor: "text-sage" },
  needs: { x: 95, y: 320, fill: "fill-sage", box: "bg-emerald-100/50 border-emerald-600", icon: Leaf, iconColor: "text-emerald-600" },
  pays: { x: 280, y: 150, fill: "fill-amber", box: "bg-amber/5 border-amber", icon: DollarSign, iconColor: "text-amber" },
};

/*
 * The DHO address is DATA (the hypha.org_url variable, resolved by the server
 * and read through useHypha). Each card carries a path suffix on it.
 * All their text is white: each card is a 5% tint of the dark band, where
 * light-page ink read at 1.00 to 1.96:1. The icons keep the per-card colours.
 * CoCreatorsGuide.contrast.test.tsx
 */
const HYPHA_ACTION_LOOK: Record<HyphaActionId, { icon: typeof Heart; suffix: string; color: string; iconColor: string; iconBg: string }> = {
  agreement: {
    icon: ClipboardList,
    suffix: "/agreements/create",
    color: "border-teal-deep/30 bg-teal-deep/5",
    iconColor: "text-teal-deep",
    iconBg: "bg-teal-deep/10",
  },
  claim: {
    icon: Receipt,
    suffix: "/agreements/create/propose-contribution",
    color: "border-sage/30 bg-sage/5",
    iconColor: "text-sage",
    iconBg: "bg-sage/10",
  },
  expenses: {
    icon: DollarSign,
    suffix: "/agreements/create/pay-for-expenses",
    color: "border-amber/30 bg-amber/5",
    iconColor: "text-amber-700",
    iconBg: "bg-amber/10",
  },
  delegate: {
    icon: UserCheck,
    suffix: "/members",
    color: "border-coral/30 bg-coral/5",
    iconColor: "text-coral",
    iconBg: "bg-coral/10",
  },
};

const LOOP_EMOJI: Record<LoopId, string> = { sense: "🌀", propose: "✍️", create: "🌱" };

const VOICE_PRINCIPLE_LOOKS = [
  { box: "border-primary bg-primary/5", icon: Circle, iconColor: "text-primary" },
  { box: "border-teal-light bg-teal-light/5", icon: MessageCircle, iconColor: "text-teal-deep" },
  { box: "border-sage bg-sage/5", icon: Users, iconColor: "text-sage" },
  { box: "border-amber bg-amber/5", icon: AlertCircle, iconColor: "text-amber" },
];

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
   a light panel. Handed out by position. */
const SPACE_LOOKS = [
  { color: "bg-aqua-light", textColor: "text-teal-deep", icon: Users },
  { color: "bg-sage-light", textColor: "text-sage", icon: Home },
  { color: "bg-amber-light", textColor: "text-gold", icon: TrendingUp },
  { color: "bg-green-light", textColor: "text-forest", icon: TreePine },
];

/** Stage chips are tinted by position: four early, three member, three co-creator, then guide and sage. */
const STAGE_TINTS = [
  ...Array(4).fill({ bg: "bg-muted", text: "text-muted-foreground" }),
  ...Array(3).fill({ bg: "bg-primary/10", text: "text-primary" }),
  ...Array(3).fill({ bg: "bg-teal-light/10", text: "text-teal-deep" }),
  { bg: "bg-blue-100", text: "text-blue-900" },
  { bg: "bg-amber-100", text: "text-amber-900" },
] as Array<{ bg: string; text: string }>;

const ELDER_LOOK: Record<ElderId, { card: string; icon: typeof Heart; title: string; body: string; duties: string }> = {
  guide: { card: "bg-blue-50 border-blue-200", icon: Compass, title: "text-blue-900", body: "text-blue-800", duties: "text-blue-700" },
  sage: { card: "bg-amber-50 border-amber-200", icon: Crown, title: "text-amber-900", body: "text-amber-800", duties: "text-amber-700" },
};

const PILLAR_ICONS = [Heart, MessageCircle, DollarSign, Users];

/** The headline steps down a size when long, so it wraps between words on a phone. Short ones keep today's size. */
function headlineSize(text: string): string {
  return Array.from(text).length <= 28 ? "text-5xl md:text-6xl" : "text-4xl md:text-5xl";
}

const CTA_LOOK: Record<CtaId, { icon: typeof Heart; href: string; external: boolean; color: string }> = {
  commitment: { icon: Heart, href: "/love-letter", external: false, color: "text-primary" },
  quests: { icon: Compass, href: "/quests", external: false, color: "text-teal-deep" },
  // Resolved at render from this village's own eventsUrl; the card drops out
  // of the grid when there is none.
  events: { icon: Calendar, href: "", external: true, color: "text-sage" },
};

export default function CoCreatorsGuide() {
  const hypha = useHypha();
  const { eventsUrl } = useVillageLinks();
  // A link to a story page switched off on its own in Admin, Pages is left out.
  const pageOff = useStoryPageOffAlone();
  const resolved = usePageContent(CO_CREATORS_GUIDE_PAGE);
  // The name the village gave its criteria on the Good Neighbor page.
  const goodNeighborName = useGoodNeighborName();
  const page = useMemo(
    () =>
      resolved && goodNeighborName !== null
        ? fillPageWords(resolved, { [GOOD_NEIGHBOR_WORD]: goodNeighborName })
        : null,
    [resolved, goodNeighborName],
  );
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  if (!page) {
    // Nothing until the saved words arrive, so the defaults never flash first.
    return (
      <Layout>
        <section className="min-h-[70vh] bg-teal-deep" aria-busy="true" />
      </Layout>
    );
  }

  const { hero, ikigai, recognition, voice, spaces, progression, goodNeighbor, cta, closing } = page;
  const hyphaSection = page.hypha;
  // A Hypha section needs a Hypha space to describe: the village's switch AND its DHO link.
  const showHypha = !hyphaSection.hidden && hypha.configured;
  const navPills = [
    { id: "r-ikigai", label: ikigai.fields.navLabel, shown: !ikigai.hidden },
    { id: "recognition", label: recognition.fields.navLabel, shown: !recognition.hidden },
    { id: "voice", label: voice.fields.navLabel, shown: !voice.hidden },
    { id: "hypha", label: hyphaSection.fields.navLabel, shown: showHypha },
    { id: "spaces", label: spaces.fields.navLabel, shown: !spaces.hidden },
    { id: "progression", label: progression.fields.navLabel, shown: !progression.hidden },
    { id: "good-neighbor", label: goodNeighbor.fields.navLabel, shown: !goodNeighbor.hidden },
  ].filter((pill) => pill.shown);
  const ctaCards = cta.lists.cards
    .map((card) => {
      const look = CTA_LOOK[card.id as CtaId];
      return look
        ? { ...look, id: card.id, title: card.title, description: card.description, href: look.external ? eventsUrl : look.href }
        : null;
    })
    .filter((card): card is NonNullable<typeof card> => !!card && !!card.href && !pageOff(card.href));
  const circles = ikigai.lists.circles;

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
            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <BookOpen className="w-16 h-16 mx-auto mb-6 opacity-90" />
              <h1 className={`font-display ${headlineSize(hero.fields.headline)} font-bold mb-6 leading-tight break-words`}>
                {hero.fields.headline}
              </h1>
              <p className="text-lg md:text-xl text-white leading-relaxed max-w-2xl mx-auto">
                <Emphasized text={hero.fields.intro} />
              </p>
              {hero.fields.alsoCalled && <p className="text-sm text-white mt-4">{hero.fields.alsoCalled}</p>}
            </m.div>
          </div>
        </div>
      </section>

      {/* QUICK NAV BAR: sticks under the 96px site header (top-24 z-30, like the quest board's filters); at top-0 z-50 it covered the home link and menu. Its sections carry scroll-mt-40. */}
      {navPills.length > 0 && (
        <section className="sticky top-24 z-30 bg-background/95 backdrop-blur border-b border-muted">
          <div className="container py-4">
            <div className="overflow-x-auto scrollbar-hide">
              <div className="flex gap-2 min-w-min">
                {navPills.map((pill) => (
                  <m.button
                    key={pill.id}
                    onClick={() => scrollToSection(pill.id)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap
                      bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    {pill.label}
                  </m.button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* R-IKIGAI SECTION */}
      {!ikigai.hidden && (
        <section id="r-ikigai" className="scroll-mt-40 py-20 bg-background">
          <div className="container">
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="max-w-5xl mx-auto"
            >
              <div className="mb-12">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3 break-words">
                  {ikigai.fields.heading}
                </h2>
                <p className="text-muted-foreground text-lg">
                  <Emphasized text={ikigai.fields.intro} />
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-12 items-center">
                {/* VENN DIAGRAM. The labels sit at fixed points with no wrapping, which is why their limit is short. */}
                <div className="relative w-full h-80 flex items-center justify-center">
                  <svg viewBox="-20 0 440 400" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
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
                    {/* Middle */}
                    <circle
                      cx="200"
                      cy="200"
                      r="60"
                      fill="rgba(251, 191, 36, 0.3)"
                      stroke="rgba(251, 191, 36, 0.6)"
                      strokeWidth="2"
                    />

                    {circles.map((circle) => {
                      const look = IKIGAI_LOOK[circle.id as IkigaiId];
                      if (!look) return null;
                      return (
                        <text key={circle.id} x={look.x} y={look.y} textAnchor="middle" className={`text-sm font-bold ${look.fill}`}>
                          {circle.label}
                        </text>
                      );
                    })}

                    {/* Center */}
                    <text x="200" y="210" textAnchor="middle" className="text-lg font-bold fill-teal-deep">
                      {ikigai.fields.centerTop}
                    </text>
                    <text x="200" y="232" textAnchor="middle" className="text-lg font-bold fill-teal-deep">
                      {ikigai.fields.centerBottom}
                    </text>
                  </svg>
                </div>

                {/* DESCRIPTIONS */}
                <div className="space-y-6">
                  {circles.map((circle) => {
                    const look = IKIGAI_LOOK[circle.id as IkigaiId];
                    if (!look) return null;
                    return (
                      <div key={circle.id} className={`p-4 rounded-lg border-l-4 ${look.box}`}>
                        <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                          <look.icon className={`w-5 h-5 flex-shrink-0 ${look.iconColor}`} />
                          <span className="min-w-0 break-words">{circle.title}</span>
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          <Emphasized text={circle.body} />
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </m.div>
          </div>
        </section>
      )}

      {/* TOKENS: named, with a link to the rules the village set, and the live card of what work is worth. */}
      {!recognition.hidden && (
        <section id="recognition" className="scroll-mt-40 py-20 bg-primary/5">
          <div className="container">
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="mb-12 text-center">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3 break-words">
                  {recognition.fields.heading}
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-3">
                  <Emphasized text={recognition.fields.intro} />
                </p>
                {recognition.fields.linkLabel && (
                  <Link
                    href="/game-mechanics"
                    className="inline-flex items-center gap-1 text-primary font-semibold hover:underline"
                  >
                    {recognition.fields.linkLabel}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
              </div>

              <m.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="max-w-xl mx-auto bg-card rounded-xl p-8 border border-muted hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="font-bold text-xl text-foreground min-w-0 break-words">{recognition.fields.cardTitle}</h3>
                </div>
                <EarningsFromTheWork />
              </m.div>
            </m.div>
          </div>
        </section>
      )}

      {/* VOICE & GOVERNANCE SECTION */}
      {!voice.hidden && (
        <section id="voice" className="scroll-mt-40 py-20 bg-background overflow-x-clip">
          <div className="container">
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="mb-12 text-center">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3 break-words">
                  {voice.fields.heading}
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                  <Emphasized text={voice.fields.intro} />
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-12">
                {/* HOW PROPOSALS WORK */}
                <m.div
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0 }}
                  className="min-w-0"
                >
                  <h3 className="font-bold text-2xl text-foreground mb-6 break-words">{voice.fields.stepsHeading}</h3>
                  <div className="space-y-4">
                    {voice.lists.steps.map((item, idx) => (
                      <div key={idx} className="flex gap-4">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="font-bold text-primary">{idx + 1}</span>
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-foreground mb-1 break-words">{item.title}</h4>
                          <p className="text-sm text-muted-foreground">
                            <Emphasized text={item.description} />
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {voice.fields.note && (
                    <div className="mt-8 p-4 rounded-lg bg-sage/5 border border-sage/20">
                      <p className="text-sm text-foreground">
                        <Emphasized text={voice.fields.note} strongClassName="font-semibold" />
                      </p>
                    </div>
                  )}
                </m.div>

                {/* KEY PRINCIPLES */}
                <m.div
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 }}
                  className="space-y-4 min-w-0"
                >
                  <h3 className="font-bold text-2xl text-foreground mb-6 break-words">{voice.fields.principlesHeading}</h3>

                  {voice.lists.principles.map((principle, i) => {
                    const look = VOICE_PRINCIPLE_LOOKS[i % VOICE_PRINCIPLE_LOOKS.length];
                    return (
                      <div key={`${i}-${principle.title}`} className={`p-4 rounded-lg border-2 ${look.box}`}>
                        <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                          <look.icon className={`w-5 h-5 flex-shrink-0 ${look.iconColor}`} />
                          <span className="min-w-0 break-words">{principle.title}</span>
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          <Emphasized text={principle.body} />
                        </p>
                      </div>
                    );
                  })}
                </m.div>
              </div>
            </m.div>
          </div>
        </section>
      )}

      {/* HYPHA PLATFORM SECTION: drawn only while this village has a Hypha space to describe. */}
      {showHypha && (
        <section id="hypha" className="scroll-mt-40 py-20 bg-teal-deep">
          <div className="container">
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="mb-12 text-center max-w-3xl mx-auto">
                {hyphaSection.fields.eyebrow && (
                  <span className="text-sm font-medium uppercase tracking-wide text-cream/60">
                    {hyphaSection.fields.eyebrow}
                  </span>
                )}
                <h2 className="font-display text-4xl md:text-5xl font-bold text-cream mb-4 mt-2 break-words">
                  {hyphaSection.fields.heading}
                </h2>
                <p className="text-cream/80 text-lg leading-relaxed">
                  <Emphasized text={hyphaSection.fields.intro} strongClassName="text-cream" />
                </p>
                {hyphaSection.fields.body && (
                  <p className="text-cream/70 text-base mt-4 leading-relaxed">
                    <Emphasized text={hyphaSection.fields.body} strongClassName="text-cream" />
                  </p>
                )}
                {/* This village's own Hypha space. It used to be one shared
                    address for every village, beside an instruction to admins
                    printed to every visitor (HyphaAdminNote now tells admins). */}
                {hypha.orgUrl && (
                  <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                    <a
                      href={hypha.orgUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-cream text-teal-deep text-sm font-semibold hover:bg-cream/90 transition-colors"
                    >
                      {hyphaSection.fields.openLabel}
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}
              </div>

              {/* Value philosophy */}
              <div className="max-w-3xl mx-auto mb-12 rounded-2xl border border-white/20 bg-white/10 p-6 md:p-8">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                    <Vote className="w-5 h-5 text-cream" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-cream text-lg mb-2 break-words">{hyphaSection.fields.valueHeading}</h3>
                    <p className="text-cream/80 text-sm leading-relaxed">
                      <Emphasized text={hyphaSection.fields.valueBody} strongClassName="text-cream" />
                    </p>
                  </div>
                </div>
              </div>

              {/* 4 Action Cards. All their text is white: each card is a 5% tint of the dark band, where light-page ink read at 1.00 to 1.96:1. The icons keep the per-card colours. CoCreatorsGuide.contrast.test.tsx */}
              <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                {hyphaSection.lists.actions.map((action, idx) => {
                  const look = HYPHA_ACTION_LOOK[action.id as HyphaActionId];
                  if (!look) return null;
                  const Icon = look.icon;
                  return (
                    <m.div
                      key={action.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.08 }}
                      className={`rounded-2xl border-2 p-6 min-w-0 ${look.color}`}
                    >
                      <div className="flex items-start gap-4 mb-4">
                        <div className={`w-10 h-10 rounded-xl ${look.iconBg} flex items-center justify-center flex-shrink-0`}>
                          <Icon className={`w-5 h-5 ${look.iconColor}`} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-white break-words">{action.title}</h3>
                          <p className="text-xs font-medium text-white">{action.subtitle}</p>
                        </div>
                      </div>
                      <p className="text-white text-sm leading-relaxed mb-5">
                        <Emphasized text={action.description} />
                      </p>
                      <a
                        href={hypha.orgUrl + look.suffix}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-semibold text-white hover:underline"
                      >
                        {action.cta}
                        <ExternalLink className="w-4 h-4 opacity-60" />
                      </a>
                    </m.div>
                  );
                })}
              </div>

              {/* The loop */}
              <div className="mt-14 max-w-3xl mx-auto">
                <p className="text-center text-cream/60 text-xs uppercase tracking-widest font-medium mb-5">
                  {hyphaSection.fields.loopHeading}
                </p>
                <div className="grid sm:grid-cols-3 gap-4 text-center">
                  {hyphaSection.lists.loop.map((step) => (
                    <div key={step.id} className="rounded-xl bg-white/10 border border-white/20 p-5 min-w-0">
                      <div className="text-2xl mb-2">{LOOP_EMOJI[step.id as LoopId]}</div>
                      <div className="text-lg font-display font-bold text-cream mb-2 break-words">{step.label}</div>
                      <p className="text-cream/80 text-sm leading-relaxed">
                        <Emphasized text={step.description} />
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </m.div>
          </div>
        </section>
      )}
      {!hyphaSection.hidden && (
        <div className="container">
          <HyphaAdminNote />
        </div>
      )}

      {/* THE SPACES SECTION */}
      {!spaces.hidden && (
        <section id="spaces" className="scroll-mt-40 py-20 bg-primary/5">
          <div className="container">
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="mb-12 text-center">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3 break-words">
                  {spaces.fields.heading}
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                  <Emphasized text={spaces.fields.intro} />
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {spaces.lists.items.map((space, idx) => {
                  const look = SPACE_LOOKS[idx % SPACE_LOOKS.length];
                  return (
                    <m.div
                      key={`${idx}-${space.title}`}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.1 }}
                      className={`${look.color} rounded-xl p-8 border border-muted/20 hover:shadow-lg transition-shadow min-w-0`}
                    >
                      <div className="flex items-start gap-4 mb-4">
                        <div className="w-12 h-12 rounded-lg bg-white/70 flex items-center justify-center flex-shrink-0">
                          <look.icon className={`w-6 h-6 ${look.textColor}`} />
                        </div>
                        <h3 className={`font-bold text-xl min-w-0 break-words ${look.textColor}`}>{space.title}</h3>
                      </div>
                      <p className="text-foreground text-sm leading-relaxed break-words">{space.description}</p>
                    </m.div>
                  );
                })}
              </div>
            </m.div>
          </div>
        </section>
      )}

      {/* PATH OF GROWTH SECTION */}
      {!progression.hidden && (
        <section id="progression" className="scroll-mt-40 py-20 bg-background">
          <div className="container">
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="mb-12 text-center">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3 break-words">
                  {progression.fields.heading}
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                  <Emphasized text={progression.fields.intro} />
                </p>
              </div>

              {/* PROGRESSION TIMELINE */}
              {progression.lists.stages.length > 0 && (
                <div className="max-w-5xl mx-auto mb-16">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {progression.lists.stages.map((stage, idx) => {
                      const tint = STAGE_TINTS[Math.min(idx, STAGE_TINTS.length - 1)];
                      return (
                        <m.div
                          key={`${idx}-${stage.label}`}
                          initial={{ opacity: 0, scale: 0.9 }}
                          whileInView={{ opacity: 1, scale: 1 }}
                          viewport={{ once: true }}
                          transition={{ delay: idx * 0.05 }}
                          className="text-center min-w-0"
                        >
                          <div className={`${tint.bg} rounded-lg p-3 mb-2`}>
                            <p className={`text-xs md:text-sm font-semibold break-words ${tint.text}`}>{stage.label}</p>
                            {stage.note && <p className={`text-xs break-words ${tint.text}`}>{stage.note}</p>}
                          </div>
                        </m.div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* GUIDE & SAGE DETAILS */}
              <div className="grid md:grid-cols-2 gap-8">
                {progression.lists.elders.map((elder, idx) => {
                  const look = ELDER_LOOK[elder.id as ElderId];
                  if (!look) return null;
                  return (
                    <m.div
                      key={elder.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.1 }}
                      className={`rounded-xl p-8 border min-w-0 ${look.card}`}
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <look.icon className={`w-8 h-8 flex-shrink-0 ${look.title}`} />
                        <h3 className={`font-bold text-2xl min-w-0 break-words ${look.title}`}>{elder.title}</h3>
                      </div>
                      <p className={`mb-4 ${look.body}`}>
                        <Emphasized text={elder.body} />
                      </p>
                      {elder.duties && (
                        <p className={`text-sm ${look.duties}`}>
                          <Emphasized text={elder.duties} strongClassName="font-semibold" />
                        </p>
                      )}
                    </m.div>
                  );
                })}
              </div>
            </m.div>
          </div>
        </section>
      )}

      {/* GOOD NEIGHBOR SECTION */}
      {!goodNeighbor.hidden && (
        <section id="good-neighbor" className="scroll-mt-40 py-20 bg-primary/5">
          <div className="container">
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="mb-12 text-center">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3 break-words">
                  {goodNeighbor.fields.heading}
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                  <Emphasized text={goodNeighbor.fields.intro} />
                </p>
              </div>

              {/* PILLAR CARDS */}
              {goodNeighbor.lists.pillars.length > 0 && (
                <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6 mb-12">
                  {goodNeighbor.lists.pillars.map((pillar, idx) => {
                    const Icon = PILLAR_ICONS[idx % PILLAR_ICONS.length];
                    return (
                      <m.div
                        key={`${idx}-${pillar.title}`}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: idx * 0.1 }}
                        className="text-center min-w-0"
                      >
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                          <Icon className="w-8 h-8 text-primary" />
                        </div>
                        <h3 className="font-semibold text-foreground mb-2 break-words">{pillar.title}</h3>
                        <p className="text-sm text-muted-foreground break-words">{pillar.description}</p>
                      </m.div>
                    );
                  })}
                </div>
              )}

              {/* LINK TO FULL DOCUMENT */}
              <m.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                className="bg-card rounded-xl p-8 border border-muted text-center max-w-2xl mx-auto"
              >
                <p className="text-muted-foreground mb-6">
                  <Emphasized text={goodNeighbor.fields.body} />
                </p>
                {!pageOff("/good-neighbor") && (
                  <Link href="/good-neighbor">
                    <a className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-teal-deep-dark transition">
                      {goodNeighbor.fields.buttonLabel}
                      <ArrowRight className="w-4 h-4 flex-shrink-0" />
                    </a>
                  </Link>
                )}
              </m.div>
            </m.div>
          </div>
        </section>
      )}

      {/* CTA SECTION */}
      {!cta.hidden && (
        <section className="py-20 bg-background">
          <div className="container">
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="text-center mb-12">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3 break-words">
                  {cta.fields.heading}
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                  <Emphasized text={cta.fields.intro} />
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {ctaCards.map((card, idx) => {
                  const inner = (
                    <>
                      <div className="mb-6">
                        <card.icon className={`w-12 h-12 ${card.color}`} />
                      </div>
                      <h3 className="font-bold text-xl text-foreground mb-2 break-words">{card.title}</h3>
                      <p className="text-muted-foreground text-sm mb-6 break-words">{card.description}</p>
                      <div className="flex items-center gap-2 text-primary font-semibold">
                        {cta.fields.moreLabel}
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </>
                  );
                  const cardClass =
                    "h-full block bg-card rounded-xl p-8 border border-muted hover:border-primary hover:shadow-lg hover:translate-y-1 transition-all duration-300 cursor-pointer";
                  return (
                    <m.div
                      key={card.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.1 }}
                      className="group min-w-0"
                    >
                      {card.external ? (
                        <a href={card.href} target="_blank" rel="noopener noreferrer" className={cardClass}>
                          {inner}
                        </a>
                      ) : (
                        <Link href={card.href}>
                          <a className={cardClass}>{inner}</a>
                        </Link>
                      )}
                    </m.div>
                  );
                })}
              </div>
            </m.div>
          </div>
        </section>
      )}

      {/* FOOTER WISDOM */}
      {!closing.hidden && (
        <section className="py-16 bg-teal-deep text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-96 h-96 bg-white rounded-full blur-3xl" />
          </div>
          <div className="container relative z-10">
            <div className="max-w-2xl mx-auto text-center">
              <p className="text-lg italic text-white leading-relaxed">
                "<Emphasized text={closing.fields.quote} />"
              </p>
              {closing.fields.signoff && (
                <div className="mt-8 flex items-center justify-center gap-4 text-white">
                  <Heart className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm min-w-0 break-words">{closing.fields.signoff}</span>
                  <Heart className="w-5 h-5 flex-shrink-0" />
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
