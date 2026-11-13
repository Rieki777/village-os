import {
  ShieldCheck,
  Plane,
  Scale,
  Landmark,
  MapPin,
  TrendingUp,
  FileQuestion,
} from "lucide-react";
import { useVillageContent } from "@/hooks/useVillageContent";
import { CARD, EYEBROW, HINT, LEDE, RING } from "@/components/journey/look";

/**
 * The village's own legal, tax and residency environment (S2 brochure lane,
 * 2026-08-30). This used to be six paragraphs of Costa Rican property, visa
 * and tax law compiled directly into this file: correct for Amora, and
 * quietly wrong for every one of the 13 fresh instances that inherit this
 * component unchanged. A family deciding whether to move money onto shared
 * land was reading this platform's word for what their own country's law
 * allows.
 *
 * Now it reads `content.legal.jurisdictionOverview` (GET /api/content/legal,
 * the same generic content document Team.tsx and the FAQ sections already
 * use. See server/repos/store.ts and server/index.ts's
 * `/api/content/:section`). A fresh instance has never written that section,
 * so the fetch 404s, and this renders an honest "not published yet" card
 * instead of Amora's law. Amora's own six points are preserved as DATA in
 * server/seeds/amora/brochure-legal-seed.json (not deleted, moved), but that seed
 * is not yet wired to auto-apply to Amora's already-existing content
 * document (see the brochure lane's report); until it lands here, Amora's
 * production instance shows the same neutral placeholder as a fresh one.
 *
 * No new legal or tax claim is invented here for any village. The
 * placeholder never says what the law is, only that the village has not
 * said yet.
 */

/*
 * DRAWN IN THE SEMANTIC TOKENS ONLY (night-contrast lane, 2026-11-11). It sits on
 * /resident, which stands in the sheet's night world, and on the investor page,
 * which does not. The brand inks it used (`text-teal-deep`, `bg-sage/15`) are
 * dark by design, so on the night ground the heading, the eyebrow and every
 * card title measured 1.22:1 to 1.59:1. The tokens re-theme with the ground they
 * land on, so one set of classes reads on both pages.
 */
const SECTION = "bg-muted/40 py-16 sm:py-20";

const ICONS = [ShieldCheck, Plane, Scale, Landmark, MapPin, TrendingUp];

interface JurisdictionPoint {
  title: string;
  body: string;
}

interface LegalContent {
  jurisdictionOverview?: {
    heading?: string;
    intro?: string;
    points?: JurisdictionPoint[];
  };
}

export default function WhyCostaRica() {
  const { content, loading, isPlaceholder } = useVillageContent<LegalContent>("legal");
  const overview = content?.jurisdictionOverview;
  const points = overview?.points?.filter((p) => p?.title && p?.body) ?? [];

  if (loading) return null;

  /*
   * A HEADING AND AN INTRO ARE PUBLISHED CONTENT, EVEN WITH NO CARDS.
   *
   * The gate was `points.length === 0`, so a founder who wrote this section's
   * heading and its opening sentence, saved, and added no cards yet saw the
   * "has not published" placeholder on their own live page. They had
   * published. The block simply refused to show it, and nothing told them
   * why, so the honest reading was that saving had not worked.
   *
   * The placeholder is for a village that has written NOTHING here, which is
   * still the shipped state and still the right answer for it.
   */
  const wroteSomething = !!(overview?.heading?.trim() || overview?.intro?.trim() || points.length);

  if (isPlaceholder || !wroteSomething) {
    return (
      <section className={SECTION}>
        <div className="container max-w-3xl mx-auto px-4">
          <div className={`${CARD} flex gap-4 items-start`}>
            <div className={RING}>
              <FileQuestion className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-card-foreground mb-1.5">
                Legal, Tax and Residency Context
              </h2>
              <p className={`${HINT} leading-relaxed`}>
                This village has not yet published the legal, tax and residency details
                for where it sits. Ask a steward, or check back in a few moons.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={SECTION}>
      <div className="container max-w-5xl mx-auto px-4">
        <div className="text-center mb-10 sm:mb-12">
          <p className={`${EYEBROW} mb-3`}>
            Location & Context
          </p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-3">
            {overview?.heading || "Legal, Tax and Residency Context"}
          </h2>
          {overview?.intro && (
            <p className={`${LEDE} mx-auto`}>{overview.intro}</p>
          )}
        </div>
        {points.length > 0 && (
        <div className="grid md:grid-cols-2 gap-5">
          {points.map((p, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <div
                key={p.title}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6 flex gap-4"
              >
                <div className={RING}>
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-lg font-semibold text-card-foreground mb-1.5">
                    {p.title}
                  </h3>
                  <p className={`${HINT} leading-relaxed`}>{p.body}</p>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </section>
  );
}
