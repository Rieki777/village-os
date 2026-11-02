import Layout from "@/components/Layout";
import { Link } from "wouter";
import { m } from "framer-motion";
import { useVillageContent } from "@/hooks/useVillageContent";
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized } from "@/components/PageText";
import { RIGHTS_RESIDENT_PAGE } from "@shared/pageContent/rights";
import { fillVars } from "@shared/pageContent/resolve";
import {
  Home,
  Heart,
  Shield,
  Leaf,
  Users,
  Coins,
  TreePine,
  Star,
  Crown,
  Compass,
  ArrowRight,
  Wrench,
  Baby,
  RefreshCw,
} from "lucide-react";

/**
 * Every word on this page is the village's own, from Admin, Pages, Resident
 * rights (shared/pageContent/rights.ts). Icons stay here and are handed out
 * by position, so a village that adds a card gets the next one in the set.
 *
 * S2 brochure lane, 2026-08-30: the Land Share card used to assert the land
 * share transfers "tax-free" as compiled-in platform code: Costa Rica's tax
 * treatment, stated unconditionally, on every fork. It comes from
 * `content.legal.landShareTransferNote` (GET /api/content/legal), which is
 * empty on any instance that has not written its own. See WhyCostaRica.tsx
 * for the fuller version of this same fix; Amora's original wording is
 * preserved as data in server/seeds/amora/brochure-legal-seed.json, not
 * deleted. Since 2026-10-22 the card's words are the village's to edit, and
 * the note arrives through the `{transfer}` word, which only this page fills.
 */
const RIGHT_ICONS = [Home, Shield, Users, Leaf, Heart, Coins, Star, Compass];
const RESPONSIBILITY_ICONS = [Home, TreePine, Wrench, Coins, Users, Heart, Baby, Star];
const STAGE_ICONS = [Home, Star, Crown, Compass, TreePine];

interface LegalContent {
  landShareTransferNote?: string;
}

export default function ResidentRights() {
  const { content } = useVillageContent<LegalContent>("legal");
  // Null until the saved words have arrived: the hero keeps its space and
  // stays invisible meanwhile, so a visitor never reads the platform's
  // defaults and then watches them change.
  const page = usePageContent(RIGHTS_RESIDENT_PAGE);
  const hero = page?.hero.fields;
  const ownership = page?.ownership;
  const rightsSection = page?.rights;
  const responsibilities = page?.responsibilities;
  const finances = page?.finances;
  const progression = page?.progression;
  const cta = page?.cta;
  const transferNote = content?.landShareTransferNote?.trim();
  const transfer = { transfer: transferNote ? ` ${transferNote}` : "" };
  const financeParagraphs = finances
    ? [finances.fields.body, finances.fields.body2, finances.fields.body3].filter(Boolean)
    : [];
  const waiting = page ? "" : " invisible";

  return (
    <Layout>
      {/* Hero */}
      <section className="relative py-20 overflow-hidden bg-gradient-to-br from-teal-deep to-teal-band">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-64 h-64 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 left-10 w-48 h-48 rounded-full bg-amber blur-3xl" />
        </div>
        <div className="container relative z-10 max-w-3xl">
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Home className="w-5 h-5 text-white" />
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
            className={`text-cream/80 text-lg leading-relaxed break-words${waiting}`}
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
            <Home className="w-10 h-10 text-teal-deep mx-auto mb-4" />
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
      {rightsSection && !rightsSection.hidden && (
      <section className="py-20 bg-background">
        <div className="container max-w-4xl">
          <div className="text-center mb-12 break-words">
            <span className="text-sm font-medium uppercase tracking-wide text-teal-deep">
              {rightsSection.fields.eyebrow}
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-foreground mt-2">
              {rightsSection.fields.heading}
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              <Emphasized text={rightsSection.fields.intro} />
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {rightsSection.lists.items.map((right, i) => {
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
                        <Emphasized text={fillVars(right.description, transfer)} />
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

      {/* Fees and vision */}
      {finances && !finances.hidden && (
      <section className="py-20 bg-background">
        <div className="container max-w-3xl">
          <m.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-amber/40 bg-amber/5 p-8 break-words"
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber/20 flex items-center justify-center flex-shrink-0">
                <RefreshCw className="w-5 h-5 text-amber-700" />
              </div>
              <h2 className="min-w-0 font-display text-2xl font-semibold text-foreground">
                {finances.fields.heading}
              </h2>
            </div>
            {financeParagraphs.map((para, i) => (
              <p key={i} className="text-muted-foreground leading-relaxed mb-4 last:mb-0">
                <Emphasized text={para} />
              </p>
            ))}
          </m.div>
        </div>
      </section>
      )}

      {/* Progression */}
      {progression && !progression.hidden && (
      <section className="py-20 bg-cream">
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
            {progression.lists.stages.map((stage, i) => {
              const Icon = STAGE_ICONS[i % STAGE_ICONS.length];
              return (
                <m.div
                  key={`${i}-${stage.level}`}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-5 rounded-2xl border border-border bg-white p-5"
                >
                  <div className="w-12 h-12 rounded-xl bg-teal-deep flex items-center justify-center flex-shrink-0">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  {/* On a phone the tag drops under the words instead of
                      squeezing them into a sliver beside it. */}
                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-2 break-words">
                    <div className="flex-1 min-w-[10rem]">
                      <div className="font-semibold text-foreground">{stage.level}</div>
                      <div className="text-muted-foreground text-sm">{stage.description}</div>
                    </div>
                    {stage.years && (
                      <span className="text-xs font-medium text-teal-deep bg-teal/10 px-3 py-1 rounded-full whitespace-nowrap">
                        {stage.years}
                      </span>
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
      <section className="py-16 bg-background">
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
            <Link
              href="/resident"
              className="self-center inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-deep text-white font-medium hover:bg-teal-deep-dark transition-colors"
            >
              {cta.fields.primaryLabel}
              <ArrowRight className="w-4 h-4 flex-shrink-0" />
            </Link>
            {cta.fields.secondaryLabel && (
              <Link
                href="/good-neighbor"
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
