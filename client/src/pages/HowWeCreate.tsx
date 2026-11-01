import Layout from "@/components/Layout";
import { Link } from "wouter";
import { m } from "framer-motion";
import { useVillageLinks } from "@/lib/gameApi";
import { useHypha } from "@/modules/ModuleProvider";
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized } from "@/components/PageText";
import { HyphaAdminNote } from "@/components/HyphaAdminNote";
import { HOW_WE_CREATE_PAGE } from "@shared/pageContent/howWeCreate";
import type { ResolvedItem } from "@shared/pageContent/types";
import {
  Sparkles,
  ArrowRight,
  Heart,
  Users,
  Calendar,
  CircleDot,
  Vote,
  Repeat,
  Settings,
  Palette,
  Scale,
  Handshake,
  Leaf,
  Compass,
} from "lucide-react";

/*
 * Every word on this page is the village's own, from Admin, Pages, How We
 * Create (shared/pageContent/howWeCreate.ts). Icons, emoji and colours stay
 * here and are handed out by position.
 *
 * THE TOKEN SECTION SAYS WHAT A TOKEN IS CALLED AND NOTHING ABOUT WHAT IT DOES
 * (Rye, 2026-10-22: "every community will design their own rules for these
 * and other tokens so don't mention what it does anywhere"). The pool card,
 * the conversion card, the `money.valueConversion` line and the footnote that
 * sat here are gone; the section links to /game-mechanics, which is generated
 * from the rules the village actually set.
 */
const PRINCIPLE_ICONS = [CircleDot, Settings, Heart, Repeat, Leaf, Compass];
const TOKEN_CARD_ICONS = ["🤝", "📊", "🌱"];
const METHOD_ICONS = [Vote, Handshake, Users, Palette, CircleDot, Compass];
const SEASON_LOOKS = [
  { emoji: "🌱", color: "bg-green-light text-forest" },
  { emoji: "☀️", color: "bg-yellow-100 text-yellow-700" },
  { emoji: "🍂", color: "bg-orange-100 text-orange-700" },
  { emoji: "❄️", color: "bg-blue-100 text-blue-700" },
  { emoji: "🌿", color: "bg-green-light text-forest" },
  { emoji: "🌙", color: "bg-blue-100 text-blue-700" },
];

/** Wide-screen columns for a row of up to three cards, so one card sits centred instead of in a third of the row. */
const TOKEN_GRID = ["", "max-w-md", "md:grid-cols-2 max-w-3xl", "md:grid-cols-3 max-w-4xl"];

/** The filled boxes of a row's numbered lines (`item1`..`item5`), in order. */
function numberedLines(row: ResolvedItem, prefix: string): string[] {
  return [1, 2, 3, 4, 5].map((i) => (row[`${prefix}${i}`] ?? "").trim()).filter(Boolean);
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function HowWeCreate() {
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const hypha = useHypha();
  const page = usePageContent(HOW_WE_CREATE_PAGE);
  if (!page) {
    // Nothing until the saved words arrive, so the defaults never flash first.
    return (
      <Layout>
        <section className="min-h-[70vh]" aria-busy="true" />
      </Layout>
    );
  }
  const { hero, principles, tokens, governance, seasons, cta } = page;
  // A Hypha section needs a Hypha space to describe: the village's switch AND its DHO link.
  const hyphaSection = page.hypha;
  const showHypha = !hyphaSection.hidden && hypha.configured;
  const tokenCards = tokens.lists.cards;
  return (
    <Layout>
      <section className="py-24 bg-background">
        <div className="container">
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <m.div
              className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Sparkles className="w-8 h-8 text-primary" />
            </m.div>
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4 break-words">
              {hero.fields.headline}
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              <Emphasized text={hero.fields.intro} />
            </p>
          </m.div>

          {/* Core Principles */}
          {!principles.hidden && principles.lists.items.length > 0 && (
            <m.div
              className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-20"
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              {principles.lists.items.map((principle, i) => {
                const Icon = PRINCIPLE_ICONS[i % PRINCIPLE_ICONS.length];
                return (
                  <m.div
                    key={`${i}-${principle.title}`}
                    variants={itemVariants}
                    whileHover={{ scale: 1.02, y: -4 }}
                    className="bg-card p-8 rounded-2xl shadow-sm border border-border/50 hover:shadow-lg transition-shadow min-w-0"
                  >
                    <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                      <Icon className="w-7 h-7 text-primary" />
                    </div>
                    <h2 className="font-display text-2xl font-semibold text-foreground mb-3 break-words">
                      {principle.title}
                    </h2>
                    <p className="text-muted-foreground leading-relaxed">
                      <Emphasized text={principle.description} />
                    </p>
                  </m.div>
                );
              })}
            </m.div>
          )}

          {/* Our tokens: named, with a link to the rules the village set. */}
          {!tokens.hidden && (
            <m.div
              className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-3xl p-8 md:p-12 mb-20"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
            >
              <div className={`text-center${tokenCards.length ? " mb-12" : ""}`}>
                <m.div
                  animate={{
                    scale: [1, 1.2, 1],
                    rotate: [0, 5, -5, 0],
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Heart className="w-12 h-12 text-primary mx-auto mb-4" />
                </m.div>
                <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
                  {tokens.fields.heading}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto mb-2">
                  <Emphasized text={tokens.fields.intro} />
                </p>
                {tokens.fields.linkLabel && (
                  <Link
                    href="/game-mechanics"
                    className="inline-flex items-center gap-1 text-primary font-semibold hover:underline"
                  >
                    {tokens.fields.linkLabel}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
              </div>

              {tokenCards.length > 0 && (
                <div className={`grid gap-6 mx-auto ${TOKEN_GRID[Math.min(tokenCards.length, 3)]}`}>
                  {tokenCards.map((item, index) => (
                    <m.div
                      key={`${index}-${item.title}`}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.15 }}
                      whileHover={{ y: -8, scale: 1.02 }}
                      className="bg-card p-6 rounded-xl text-center shadow-sm hover:shadow-md transition-all min-w-0"
                    >
                      <m.div
                        className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4"
                        whileHover={{ rotate: 360 }}
                        transition={{ duration: 0.5 }}
                      >
                        <span className="text-2xl">{TOKEN_CARD_ICONS[index % TOKEN_CARD_ICONS.length]}</span>
                      </m.div>
                      <h3 className="font-display text-lg font-semibold text-foreground mb-2 break-words">
                        {item.title}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        <Emphasized text={item.body} />
                      </p>
                    </m.div>
                  ))}
                </div>
              )}
            </m.div>
          )}

          {/* Governance Structure */}
          {!governance.hidden && (
            <m.div
              className="bg-sage/5 rounded-3xl p-8 md:p-12 mb-20 border border-sage/20"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
            >
              <div className="text-center mb-12">
                <Users className="w-12 h-12 text-sage mx-auto mb-4" />
                <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
                  {governance.fields.heading}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  <Emphasized text={governance.fields.intro} />
                </p>
              </div>

              {governance.lists.phases.length > 0 && (
                <div className="grid md:grid-cols-2 gap-6 mb-8">
                  {governance.lists.phases.map((phase, i) => (
                    <m.div
                      key={`${i}-${phase.title}`}
                      initial={{ opacity: 0, x: i % 2 ? 20 : -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      className="bg-card p-6 rounded-xl border border-border min-w-0"
                    >
                      <h3 className="font-display text-lg font-semibold text-foreground mb-3 break-words">{phase.title}</h3>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        {numberedLines(phase, "item").map((line, j) => (
                          <li key={j} className="flex gap-2">
                            <span className="text-sage">→</span> <span className="min-w-0 break-words">{line}</span>
                          </li>
                        ))}
                      </ul>
                    </m.div>
                  ))}
                </div>
              )}

              {governance.fields.buttonLabel && (
                <m.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="text-center"
                >
                  <Link href="/roles">
                    <a className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-lg hover:bg-sage/90 transition-colors font-medium">
                      {governance.fields.buttonLabel}
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </Link>
                </m.div>
              )}
            </m.div>
          )}

          {/* Flexible Governance with Hypha */}
          {showHypha && (
            <div className="max-w-4xl mx-auto mb-20">
              <m.div
                className="text-center mb-12"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <Scale className="w-12 h-12 text-sage mx-auto mb-4" />
                <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
                  {hyphaSection.fields.heading}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  <Emphasized text={hyphaSection.fields.intro} />
                </p>
              </m.div>

              {hyphaSection.lists.methods.length > 0 && (
                <m.div
                  className="grid sm:grid-cols-2 gap-6"
                  variants={containerVariants}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                >
                  {hyphaSection.lists.methods.map((option, i) => {
                    const Icon = METHOD_ICONS[i % METHOD_ICONS.length];
                    return (
                      <m.div
                        key={`${i}-${option.name}`}
                        variants={itemVariants}
                        whileHover={{ scale: 1.02 }}
                        className="bg-card p-6 rounded-xl shadow-sm border border-border/50 min-w-0"
                      >
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-lg bg-sage/10 flex items-center justify-center flex-shrink-0">
                            <Icon className="w-6 h-6 text-sage" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-display text-xl font-semibold text-foreground mb-2 break-words">
                              {option.name}
                            </h3>
                            <p className="text-muted-foreground text-sm mb-3">
                              <Emphasized text={option.description} />
                            </p>
                            {option.best && <p className="text-xs text-sage font-medium">Best for: {option.best}</p>}
                          </div>
                        </div>
                      </m.div>
                    );
                  })}
                </m.div>
              )}

              <m.div
                className="mt-8 p-6 bg-sage/5 rounded-xl border border-sage/20"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
              >
                <h3 className="font-display text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-sage flex-shrink-0" />
                  <span className="min-w-0 break-words">{hyphaSection.fields.boxHeading}</span>
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  <Emphasized text={hyphaSection.fields.boxBody} />
                </p>
              </m.div>
            </div>
          )}
          {!hyphaSection.hidden && <HyphaAdminNote />}

          {/* Seasonal Rhythm */}
          {!seasons.hidden && (
            <div className="max-w-3xl mx-auto mb-20">
              <m.div
                className="text-center mb-8"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <m.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                >
                  <Repeat className="w-12 h-12 text-teal-light mx-auto mb-4" />
                </m.div>
                <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mb-4 break-words">
                  {seasons.fields.heading}
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto">
                  <Emphasized text={seasons.fields.intro} />
                </p>
              </m.div>
              <div className="grid sm:grid-cols-2 gap-6">
                {seasons.lists.seasons.map((item, index) => {
                  const look = SEASON_LOOKS[index % SEASON_LOOKS.length];
                  return (
                    <m.div
                      key={`${index}-${item.name}`}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.1 }}
                      whileHover={{ scale: 1.03 }}
                      className="bg-card p-6 rounded-xl shadow-sm border border-border/50 min-w-0"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-2xl">{look.emoji}</span>
                        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${look.color}`}>
                          {item.name}
                        </span>
                      </div>
                      <h3 className="font-display text-xl font-semibold text-foreground mb-2 break-words">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        <Emphasized text={item.description} />
                      </p>
                    </m.div>
                  );
                })}
              </div>
              {seasons.fields.note && (
                <m.div
                  className="mt-8 p-5 bg-white/60 rounded-xl text-center border border-border/40"
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.4 }}
                >
                  <p className="text-sm text-muted-foreground">
                    <Emphasized text={seasons.fields.note} />
                  </p>
                </m.div>
              )}
            </div>
          )}

          {/* CTA */}
          {!cta.hidden && (
            <m.div
              className="max-w-3xl mx-auto text-center bg-cream-dark p-8 rounded-2xl"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground mb-4 break-words">
                {cta.fields.heading}
              </h2>
              <p className="text-muted-foreground mb-6">
                <Emphasized text={cta.fields.body} />
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <Link
                  href="/co-creators-guide"
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-teal-deep-dark transition-all hover:scale-105 flex items-center gap-2"
                >
                  {cta.fields.guideLabel}
                  <ArrowRight className="w-5 h-5" />
                </Link>
                {eventsUrl && cta.fields.eventsLabel && (
                  <a
                    href={eventsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-3 bg-muted text-foreground rounded-full font-medium uppercase tracking-wider text-sm hover:bg-muted/80 transition-all hover:scale-105 flex items-center gap-2"
                  >
                    <Calendar className="w-5 h-5" />
                    {cta.fields.eventsLabel}
                  </a>
                )}
              </div>
            </m.div>
          )}
        </div>
      </section>
    </Layout>
  );
}
