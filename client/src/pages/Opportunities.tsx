import Layout from "@/components/Layout";
import { useVillageLinks } from "@/lib/gameApi";
import { useVillageContent } from "@/hooks/useVillageContent";
import { type MoneyContent } from "@/lib/moneyClaims";
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized } from "@/components/PageText";
import {
  OPPORTUNITIES_PAGE,
  VENTURE_DETAIL_LINES,
  type VentureIcon,
} from "@shared/pageContent/opportunities";
import { Link } from "wouter";
import { m } from "framer-motion";
import { 
  Sparkles, 
  ArrowRight, 
  Calendar,
  Tent,
  Stethoscope,
  Coffee,
  Store,
  GraduationCap,
  Dumbbell,
  Palette,
  Leaf,
  Home,
  Hammer,
  Heart,
  type LucideIcon,
} from "lucide-react";

/*
 * EIGHT CAPITAL FIGURES LEFT THIS FILE (founder ruling, 2026-09-03).
 *
 * Every card carried an `investment:` range as a module constant, from
 * "$100K - $300K" to "$5M - $10M", and this page fetched nothing at all. So
 * every village that deploys this platform published eight capital
 * requirements about ventures it has not costed, in dollars it may not use,
 * under its own name, with no screen anywhere that could change one of them.
 * The founder confirmed the figures are real and current FOR THIS VILLAGE,
 * which is exactly why they cannot stay compiled into platform code.
 *
 * Same answer as the housing tiers (0131) and the land figures (`landFacts`
 * in server/index.ts): the range comes from `money.ventureInvestment` in the
 * runtime content document, keyed by the venture's id, and it is free text so
 * a village writes its own currency, its own separator and "under valuation"
 * if that is the truth. NO RANGE MEANS NO LINE: the card still publishes,
 * because meaning to build a retreat centre is a real fact even when its cost
 * is not settled yet, and a blank slot or a zero would be a claim nobody made.
 *
 * The id is the storage contract and the title is not. The cards' words moved
 * to Admin, Pages, Business Opportunities on 2026-10-22
 * (shared/pageContent/opportunities.ts) as a FIXED list keyed by the same
 * eight ids, so a village renaming the café keeps the figure it typed.
 */

/**
 * The pictures behind the icon words a founder types for a venture. Keyed by
 * the union, so a word added to the spec's list without a picture here fails
 * to compile.
 */
const VENTURE_ICON: Record<VentureIcon, LucideIcon> = {
  sparkles: Sparkles,
  tent: Tent,
  health: Stethoscope,
  cafe: Coffee,
  market: Store,
  learning: GraduationCap,
  fitness: Dumbbell,
  art: Palette,
  farm: Leaf,
  home: Home,
  tools: Hammer,
  heart: Heart,
};

/** A word not on the list draws the first picture, so a typo shows a plain icon instead of a hole. */
function ventureIcon(word: string | undefined): LucideIcon {
  const key = (word ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VENTURE_ICON, key) ? VENTURE_ICON[key as VentureIcon] : Sparkles;
}

/** The badge colours for the three statuses the platform writes; any other word gets the quiet one. */
const statusColors: Record<string, string> = {
  "planning": "bg-teal-deep/10 text-foreground",
  "future": "bg-muted text-muted-foreground",
  "active": "bg-sage/10 text-sage",
};
const statusColor = (status: string) => statusColors[status.trim().toLowerCase()] ?? statusColors.future;

/** One bullet per non-blank line, at most the number the card was laid out for. */
const detailLines = (details: string | undefined) =>
  (details ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, VENTURE_DETAIL_LINES);

export default function Opportunities() {
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const { content: money } = useVillageContent<MoneyContent>("money");
  // Whitespace is not a figure: a founder who clears a field publishes nothing.
  const investmentFor = (key: string | undefined) => (key ? money?.ventureInvestment?.[key]?.trim() || "" : "");
  // The page's words are the village's own, from Admin, Pages, Business
  // Opportunities. Null until the saved words have arrived, so the defaults
  // never paint first and then change.
  const page = usePageContent(OPPORTUNITIES_PAGE);
  const hero = page?.hero.fields;
  const ventures = page?.ventures;
  const revenue = page?.revenue;
  const cta = page?.cta.fields;
  return (
    <Layout>
      {/* Hero */}
      <section className="py-24 bg-teal-light text-white">
        <div className="container">
          <div className="max-w-3xl">
            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Sparkles className="w-16 h-16 mb-6 opacity-80" />
              <h1 className="font-display text-4xl md:text-6xl font-bold mb-6">
                Business Opportunities
              </h1>
              {/* Invisible, not absent, until the saved words arrive. The
                  sentence named the recognition token as what a revenue share
                  is paid in; the token ruling of 2026-10-22 took that out. */}
              <p className={`text-xl text-white leading-relaxed break-words${hero ? "" : " invisible"}`}>
                <Emphasized text={hero?.lede ?? "\u00a0"} />
              </p>
            </m.div>
          </div>
        </div>
      </section>

      {/* Opportunities Grid */}
      {ventures && !ventures.hidden && (
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {ventures.lists.cards.map((opp, index) => {
              const Icon = ventureIcon(opp.icon);
              const details = detailLines(opp.details);
              const range = investmentFor(opp.id);
              return (
              <m.div
                key={opp.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                className="bg-card p-8 rounded-2xl shadow-sm min-w-0"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="w-14 h-14 shrink-0 rounded-xl bg-teal-light/10 flex items-center justify-center">
                    <Icon className="w-7 h-7 text-teal-light" />
                  </div>
                  {opp.status && (
                    <span className={`px-3 py-1 text-xs font-medium rounded-lg break-words ${statusColor(opp.status)}`}>
                      {opp.status}
                    </span>
                  )}
                </div>
                <h2 className="font-display text-2xl font-bold text-foreground mb-2 break-words">
                  {opp.title}
                </h2>
                <p className="text-muted-foreground mb-4 break-words">
                  {opp.description}
                </p>
                {range && (
                  <div className="mb-4">
                    <span className="text-sm font-medium text-foreground">Investment Range: </span>
                    <span className="text-sm text-teal-light font-semibold">{range}</span>
                  </div>
                )}
                {details.length > 0 && (
                <ul className="space-y-2">
                  {details.map((detail, i) => (
                    <li key={`${i}-${detail}`} className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                      <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-teal-light" />
                      <span className="min-w-0 break-words">{detail}</span>
                    </li>
                  ))}
                </ul>
                )}
              </m.div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* Revenue Sharing. Named the recognition token as the currency of a
          revenue share until the token ruling of 2026-10-22 (rows 31 to 33):
          a token may be named, and no sentence says what it does. */}
      {revenue && !revenue.hidden && (
      <section className="py-20 bg-teal-light/10">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4 break-words">
              {revenue.fields.heading}
            </h2>
            <p className="text-muted-foreground mb-8 break-words">
              <Emphasized text={revenue.fields.body} />
            </p>
            <Link
              href="/how-we-create"
              // `text-teal-light` is `--tone-brand-mid`, which falls back to
              // #737373 on an unbranded fork. That clears AA on white (4.74:1)
              // and FAILS on this section's own `aqua-light` band: measured
              // 3.73:1 against rgb(228,228,228) on the deployed build, all six
              // viewports. `text-teal-deep` is safe by construction -
              // shared/brandTokens.ts enforces contrastRatio(white, brand)
              // >= 4.5 for every seed and contrast is symmetric - and measures
              // 8.15:1 on this band under the neutral default. Same fix, and
              // the same reasoning, as the Register path pills.
              className="inline-flex items-center gap-2 text-teal-deep font-medium hover:gap-3 transition-all"
            >
              How we create together
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
      )}

      {/* CTA */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              Interested in an Opportunity?
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
              <Link
                href="/prosperity"
                className="px-8 py-4 bg-muted text-foreground rounded-lg font-semibold hover:bg-muted/80 transition-colors"
              >
                Prosperity Journey
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
