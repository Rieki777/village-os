import Layout from "@/components/Layout";
import { Link } from "wouter";
import { m } from "framer-motion";
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized } from "@/components/PageText";
import { RIGHTS_STEWARD_PAGE } from "@shared/pageContent/rights";
import {
  Users,
  Heart,
  TreePine,
  Star,
  Compass,
  Shield,
  Leaf,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Crown,
} from "lucide-react";
import { useStoryPageOffAlone } from "@/lib/brochure";

/*
 * Every word on this page is the village's own, from Admin, Pages, Steward
 * rights (shared/pageContent/rights.ts). Icons and colours stay here and are
 * handed out by position, so a village that adds a card gets the next one.
 *
 * The pay card used to explain what the recognition token is, how a pool of
 * the value token is shared across it, and (from `money.valueConversion`)
 * what that value converts to. Rye, 2026-10-22: a token may be named and no
 * sentence says what it does, because every village designs its own token
 * rules. So the card says only that each role and quest shows its worth on
 * its own card (TOKEN_COPY_PROPOSAL row 18), and this page reads no token
 * name and no conversion sentence at all.
 */
const RIGHT_ICONS = [Users, Heart, Star, Compass, Leaf, Shield, Sparkles, TreePine];
const RESPONSIBILITY_ICONS = [Users, TreePine, Compass, Heart, Sparkles, Star, Leaf, Shield];
const STAGE_LOOKS = [
  { icon: Star, color: "bg-teal-deep" },
  { icon: Compass, color: "bg-sage" },
  { icon: Crown, color: "bg-amber text-foreground" },
  { icon: TreePine, color: "bg-teal-deep" },
  { icon: Heart, color: "bg-sage" },
];

export default function StewardRights() {
  // Null until the saved words have arrived: the hero keeps its space and
  // stays invisible meanwhile, so a visitor never reads the platform's
  // defaults and then watches them change.
  const page = usePageContent(RIGHTS_STEWARD_PAGE);
  // A link to a story page switched off on its own in Admin, Pages is left out.
  const pageOff = useStoryPageOffAlone();
  const hero = page?.hero.fields;
  const ownership = page?.ownership;
  const rights = page?.rights;
  const responsibilities = page?.responsibilities;
  const progression = page?.progression;
  const cta = page?.cta;
  const waiting = page ? "" : " invisible";
  return (
    <Layout>
      {/* Hero */}
      <section className="relative py-20 overflow-hidden bg-gradient-to-br from-teal-deep to-sage">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-64 h-64 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 right-10 w-48 h-48 rounded-full bg-amber blur-3xl" />
        </div>
        <div className="container relative z-10 max-w-3xl">
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <TreePine className="w-5 h-5 text-white" />
            </div>
            <span className={`min-w-0 break-words text-cream/80 text-sm font-medium uppercase tracking-wide${waiting}`}>
              {hero?.eyebrow || " "}
            </span>
          </m.div>
          <m.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={`font-display text-4xl md:text-5xl font-semibold text-cream mb-4 break-words${waiting}`}
          >
            {hero?.headline || " "}
          </m.h1>
          <m.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={`text-cream text-lg leading-relaxed break-words${waiting}`}
          >
            <Emphasized text={hero?.intro || " "} />
          </m.p>
        </div>
      </section>

      {/* Co-ownership framing */}
      {ownership && !ownership.hidden && (
      <section className="py-16 bg-cream">
        <div className="container max-w-3xl">
          <m.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-teal/30 bg-white p-8 text-center break-words"
          >
            <TreePine className="w-10 h-10 text-sage mx-auto mb-4" />
            <h2 className="font-display text-2xl font-semibold text-foreground mb-3">
              {ownership.fields.heading}
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
              <Emphasized text={ownership.fields.body} />
            </p>
          </m.div>
        </div>
      </section>
      )}

      {/* Rights */}
      {rights && !rights.hidden && (
      <section className="py-20 bg-background">
        <div className="container max-w-4xl">
          <div className="text-center mb-12 break-words">
            <span className="text-sm font-medium uppercase tracking-wide text-teal-deep">
              {rights.fields.eyebrow}
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mt-2">
              {rights.fields.heading}
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              <Emphasized text={rights.fields.intro} />
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {rights.lists.items.map((right, i) => {
              const Icon = RIGHT_ICONS[i % RIGHT_ICONS.length];
              return (
                <m.div
                  key={`${i}-${right.title}`}
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
                    <div className="min-w-0 break-words">
                      <h3 className="font-semibold text-foreground mb-2">{right.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        <Emphasized text={right.description} />
                      </p>
                    </div>
                  </div>
                </m.div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* Responsibilities */}
      {responsibilities && !responsibilities.hidden && (
      <section className="py-20 bg-cream">
        <div className="container max-w-4xl">
          <div className="text-center mb-12 break-words">
            <span className="text-sm font-medium uppercase tracking-wide text-sage">
              {responsibilities.fields.eyebrow}
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mt-2">
              {responsibilities.fields.heading}
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              <Emphasized text={responsibilities.fields.intro} />
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {responsibilities.lists.items.map((item, i) => {
              const Icon = RESPONSIBILITY_ICONS[i % RESPONSIBILITY_ICONS.length];
              return (
                <m.div
                  key={`${i}-${item.title}`}
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
                    <div className="min-w-0 break-words">
                      <h3 className="font-semibold text-foreground mb-2">{item.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        <Emphasized text={item.description} />
                      </p>
                    </div>
                  </div>
                </m.div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* Progression Path */}
      {progression && !progression.hidden && (
      <section className="py-20 bg-background">
        <div className="container max-w-3xl">
          <div className="text-center mb-12 break-words">
            <span className="text-sm font-medium uppercase tracking-wide text-amber-ink">
              {progression.fields.eyebrow}
            </span>
            <h2 className="font-display text-3xl font-semibold text-foreground mt-2">
              {progression.fields.heading}
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              <Emphasized text={progression.fields.intro} />
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {progression.lists.stages.map((stage, i, all) => {
              const look = STAGE_LOOKS[i % STAGE_LOOKS.length];
              return (
                <m.div
                  key={`${i}-${stage.level}`}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-5 rounded-2xl border border-border bg-card p-5"
                >
                  <div className={`w-12 h-12 rounded-xl ${look.color} flex items-center justify-center flex-shrink-0`}>
                    <look.icon className="w-6 h-6 text-white" />
                  </div>
                  {/* A tag, when the village gives the stage one, takes the
                      place of the check and drops under the words on a phone. */}
                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-2 break-words">
                    <div className="flex-1 min-w-[10rem]">
                      <div className="font-semibold text-foreground">{stage.level}</div>
                      <div className="text-muted-foreground text-sm">{stage.description}</div>
                    </div>
                    {stage.years ? (
                      <span className="text-xs font-medium text-teal-deep bg-teal/10 px-3 py-1 rounded-full whitespace-nowrap">
                        {stage.years}
                      </span>
                    ) : (
                      i < all.length - 1 && <CheckCircle2 className="w-5 h-5 text-teal ml-auto opacity-40 flex-shrink-0" />
                    )}
                  </div>
                </m.div>
              );
            })}
          </div>
          {progression.fields.footnote && (
            <p className="text-xs text-muted-foreground text-center mt-4 break-words">
              {progression.fields.footnote}
            </p>
          )}
        </div>
      </section>
      )}

      {/* CTA */}
      {cta && !cta.hidden && (
      <section className="py-16 bg-cream">
        <div className="container max-w-2xl text-center break-words">
          <h2 className="font-display text-2xl font-semibold text-foreground mb-4">
            {cta.fields.heading}
          </h2>
          <p className="text-muted-foreground mb-8">
            <Emphasized text={cta.fields.body} />
          </p>
          {/* Each door is ONE link. A <button> inside a <Link> is a control
              inside a control: two tab stops for one action, read as "link,
              button", and invalid HTML. self-center keeps the content width
              the old inline button had in the phone's column. */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {!pageOff("/steward") && (
              <Link
                href="/steward"
                className="self-center inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-deep text-white font-medium hover:bg-teal-deep-dark transition-colors"
              >
                {cta.fields.primaryLabel}
                <ArrowRight className="w-4 h-4 flex-shrink-0" />
              </Link>
            )}
            {cta.fields.secondaryLabel && (
              <Link
                href="/quests"
                className="self-center inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-teal-deep text-teal-deep font-medium hover:bg-teal-deep/5 transition-colors"
              >
                {cta.fields.secondaryLabel}
              </Link>
            )}
          </div>
        </div>
      </section>
      )}
    </Layout>
  );
}
