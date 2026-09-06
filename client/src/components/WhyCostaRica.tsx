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
 * server/seeds/brochure-legal-seed.json (not deleted, moved), but that seed
 * is not yet wired to auto-apply to Amora's already-existing content
 * document (see the brochure lane's report); until it lands here, Amora's
 * production instance shows the same neutral placeholder as a fresh one.
 *
 * No new legal or tax claim is invented here for any village. The
 * placeholder never says what the law is, only that the village has not
 * said yet.
 */

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
      <section className="bg-sage/15 py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 flex gap-4 items-start">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-teal-deep/10 text-teal-deep flex items-center justify-center">
              <FileQuestion className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-teal-deep mb-1.5">
                Legal, Tax and Residency Context
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                This village has not yet published the legal, tax and residency details
                for where it sits. Ask a steward, or check back once the community has
                written its own.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-sage/15 py-20">
      <div className="container max-w-5xl mx-auto px-4">
        <div className="text-center mb-12">
          <span className="inline-block text-xs tracking-widest uppercase text-teal-deep font-semibold mb-3">
            Location & Context
          </span>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3">
            {overview?.heading || "Legal, Tax and Residency Context"}
          </h2>
          {overview?.intro && (
            <p className="text-muted-foreground max-w-2xl mx-auto">{overview.intro}</p>
          )}
        </div>
        {points.length > 0 && (
        <div className="grid md:grid-cols-2 gap-5">
          {points.map((p, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <div
                key={p.title}
                className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 flex gap-4"
              >
                <div className="shrink-0 w-12 h-12 rounded-xl bg-teal-deep/10 text-teal-deep flex items-center justify-center">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-lg font-semibold text-teal-deep mb-1.5">
                    {p.title}
                  </h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{p.body}</p>
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
