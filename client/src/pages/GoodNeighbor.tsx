import Layout from "@/components/Layout";
import { useVillageLinks } from "@/lib/gameApi";
import { usePageContent } from "@/hooks/usePageContent";
import { fillPageWords } from "@/hooks/useGoodNeighborName";
import { Emphasized } from "@/components/PageText";
import { GOOD_NEIGHBOR_PAGE } from "@shared/pageContent/goodNeighbor";
import { GOOD_NEIGHBOR_WORD } from "@shared/pageContent/goodNeighborName";
import type { ResolvedItem } from "@shared/pageContent/types";
import { m } from "framer-motion";
import { Link } from "wouter";
import { useMemo } from "react";
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
import { useStoryPageOffAlone } from "@/lib/brochure";

/** Icons and tints for the criteria, handed out in order. The words are the village's (shared/pageContent/goodNeighbor.ts). */
const CRITERION_LOOKS = [
  { icon: Heart, color: "bg-primary/10", iconColor: "text-primary" },
  { icon: MessageCircle, color: "bg-sage/20", iconColor: "text-sage" },
  { icon: DollarSign, color: "bg-amber/20", iconColor: "text-amber-700" },
  { icon: Users, color: "bg-teal/20", iconColor: "text-teal-700" },
  { icon: Leaf, color: "bg-sage-light/40", iconColor: "text-sage" },
  { icon: Globe, color: "bg-teal-light/30", iconColor: "text-teal-600" },
  { icon: Shield, color: "bg-primary/5", iconColor: "text-primary" },
  { icon: Baby, color: "bg-amber/10", iconColor: "text-amber-600" },
];

/**
 * The headline steps down a size when long, so a village's own longer name
 * wraps between words on a phone instead of inside one. The default name
 * keeps the size it always had.
 */
function nameSize(text: string): string {
  return Array.from(text).length <= 24 ? "text-5xl md:text-6xl" : "text-4xl md:text-6xl";
}

/** The filled boxes of a row's numbered lines (`practice1`..`practice5`), in order. */
function numberedLines(row: ResolvedItem, prefix: string): string[] {
  return [1, 2, 3, 4, 5].map((i) => (row[`${prefix}${i}`] ?? "").trim()).filter(Boolean);
}

export default function GoodNeighbor() {
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  // A link to a story page switched off on its own in Admin, Pages is left out.
  const pageOff = useStoryPageOffAlone();
  // Every word here is the village's own, from Admin, Pages, Good Neighbor.
  // `{good-neighbor}` is this page's own headline field, so renaming the
  // criteria renames every mention of them at once.
  const resolved = usePageContent(GOOD_NEIGHBOR_PAGE);
  const page = useMemo(
    () => (resolved ? fillPageWords(resolved, { [GOOD_NEIGHBOR_WORD]: resolved.hero.fields.name }) : null),
    [resolved],
  );
  if (!page) {
    // Nothing until the saved words arrive, so the defaults never flash first.
    return (
      <Layout>
        <section className="min-h-[70vh]" aria-busy="true" />
      </Layout>
    );
  }
  const { hero, values, criteria, dealbreakers, process, commitments, closing } = page;
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
            {hero.fields.eyebrow && (
              <m.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="inline-block px-4 py-1.5 bg-primary/10 rounded-full text-primary text-sm font-medium mb-6"
              >
                {hero.fields.eyebrow}
              </m.span>
            )}
            <m.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`font-display ${nameSize(hero.fields.name)} font-bold text-foreground mb-6 break-words`}
            >
              {hero.fields.name}
            </m.h1>
            <m.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-foreground leading-relaxed mb-8"
            >
              <Emphasized text={hero.fields.intro} />
            </m.p>
            {hero.fields.quote && (
              <m.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-lg text-foreground italic"
              >
                "<Emphasized text={hero.fields.quote} />"
                {hero.fields.quoteBy && (
                  <>
                    <br />
                    <span className="not-italic text-sm">- {hero.fields.quoteBy}</span>
                  </>
                )}
              </m.p>
            )}
          </div>
        </div>
      </section>

      {/* What this village values */}
      {!values.hidden && (
        <section className="py-16 bg-primary/5">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-3xl font-bold text-foreground mb-8 text-center break-words">
                {values.fields.heading}
              </h2>
              <div className="grid md:grid-cols-3 gap-6">
                {values.lists.items.map((item, i) => (
                  <div key={`${i}-${item.title}`} className="bg-card rounded-xl p-6 shadow-sm min-w-0">
                    <h3 className="font-display text-lg font-bold text-foreground mb-3 break-words">{item.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      <Emphasized text={item.body} />
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* The Criteria */}
      <section className="py-24 bg-background">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="font-display text-4xl font-bold text-foreground mb-4 break-words">
                {criteria.fields.heading}
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                <Emphasized text={criteria.fields.intro} />
              </p>
            </div>

            <div className="space-y-8">
              {criteria.lists.items.map((criterion, index) => {
                const look = CRITERION_LOOKS[index % CRITERION_LOOKS.length];
                const practices = numberedLines(criterion, "practice");
                return (
                  <m.div
                    key={`${index}-${criterion.title}`}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-card rounded-2xl overflow-hidden shadow-sm border border-border"
                  >
                    <div className="p-6 md:p-8">
                      <div className="flex items-start gap-4 mb-4">
                        <div className={`w-12 h-12 rounded-xl ${look.color} flex items-center justify-center flex-shrink-0`}>
                          <look.icon className={`w-6 h-6 ${look.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-xs font-mono text-muted-foreground">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <h3 className="font-display text-xl font-bold text-foreground min-w-0 break-words">
                              {criterion.title}
                            </h3>
                          </div>
                          <p className="text-sm text-primary font-medium break-words">{criterion.subtitle}</p>
                        </div>
                      </div>

                      <p className="text-muted-foreground leading-relaxed mb-5">
                        <Emphasized text={criterion.description} />
                      </p>

                      {practices.length > 0 && (
                        <div className="space-y-2 mb-4">
                          {practices.map((practice, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                              <p className="text-sm text-muted-foreground min-w-0 break-words">{practice}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {criterion.note && (
                        <div className="bg-muted/50 rounded-lg px-4 py-3 text-sm text-muted-foreground italic">
                          <Emphasized text={criterion.note} />
                        </div>
                      )}
                    </div>
                  </m.div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Dealbreakers */}
      {!dealbreakers.hidden && (
        <section className="py-20 bg-destructive/5">
          <div className="container">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-destructive flex-shrink-0" />
                <h2 className="font-display text-3xl font-bold text-foreground min-w-0 break-words">
                  {dealbreakers.fields.heading}
                </h2>
              </div>
              <p className="text-muted-foreground mb-10 max-w-2xl">
                <Emphasized text={dealbreakers.fields.intro} />
              </p>
              <div className="grid md:grid-cols-2 gap-6">
                {dealbreakers.lists.groups.map((group, gi) => (
                  <div key={`${gi}-${group.category}`} className="bg-card rounded-xl p-6 shadow-sm min-w-0">
                    <h3 className="font-semibold text-foreground mb-4 break-words">{group.category}</h3>
                    <ul className="space-y-2">
                      {numberedLines(group, "item").map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-destructive mt-2 flex-shrink-0" />
                          <p className="text-sm text-muted-foreground min-w-0 break-words">{item}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* How We Assess Fit */}
      {!process.hidden && (
        <section className="py-20 bg-background">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-3xl font-bold text-foreground mb-4 break-words">
                {process.fields.heading}
              </h2>
              <p className="text-muted-foreground mb-10">
                <Emphasized text={process.fields.intro} />
              </p>
              <div className="space-y-4">
                {process.lists.steps.map((item, i) => (
                  <m.div
                    key={`${i}-${item.title}`}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    className="flex items-start gap-4 bg-card rounded-xl p-5 shadow-sm"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-primary font-bold text-sm">{i + 1}</span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground mb-1 break-words">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        <Emphasized text={item.body} />
                      </p>
                    </div>
                  </m.div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* What this village commits to you */}
      {!commitments.hidden && (
        <section className="py-20 bg-primary/5">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-3xl font-bold text-foreground mb-4 break-words">
                {commitments.fields.heading}
              </h2>
              <p className="text-muted-foreground mb-8">
                <Emphasized text={commitments.fields.intro} />
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {commitments.lists.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 bg-card rounded-lg p-4 shadow-sm min-w-0">
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-muted-foreground min-w-0 break-words">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Closing + CTA */}
      {!closing.hidden && (
        <section className="py-24 bg-background">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <m.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
                <h2 className="font-display text-4xl font-bold text-foreground mb-6 break-words">
                  {closing.fields.heading}
                </h2>
                <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                  <Emphasized text={closing.fields.body} />
                </p>
                {closing.fields.body2 && (
                  <p className="text-lg text-muted-foreground leading-relaxed mb-10">
                    <Emphasized text={closing.fields.body2} />
                  </p>
                )}

                <div className="flex flex-wrap justify-center gap-4">
                  {!pageOff("/love-letter") && (
                    <Link href="/love-letter">
                      <a className="px-8 py-4 bg-primary text-primary-foreground rounded-lg font-semibold text-lg hover:bg-teal-deep-dark transition-all duration-200 flex items-center gap-2">
                        {closing.fields.commitLabel}
                        <ArrowRight className="w-5 h-5" />
                      </a>
                    </Link>
                  )}
                  {eventsUrl && closing.fields.eventsLabel && (
                    <a
                      href={eventsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-8 py-4 bg-secondary text-secondary-foreground rounded-lg font-semibold text-lg hover:opacity-90 transition-all duration-200 flex items-center gap-2"
                    >
                      <Calendar className="w-5 h-5" />
                      {closing.fields.eventsLabel}
                    </a>
                  )}
                </div>
              </m.div>
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
