/**
 * The front door of a village that does not serve the brochure pages.
 *
 * The brochure home (Home.tsx) tells the first village's own story in compiled
 * copy, and a new village switched that story off (shared/brochure.ts). This
 * page is what "/" renders instead. It says only what the village itself has
 * set: its name, its line, its place and its picture, all from the Setup
 * Wizard, and it points at the parts of the platform every village has: the
 * quest board, the gratitude wall and the page about how the village decides.
 * Each of those is a core surface that cannot be switched off, so no link here
 * can land on a missing page.
 *
 * A blank field hides its line rather than printing a placeholder.
 */
import Layout from "@/components/Layout";
import SeasonBanner from "@/components/SeasonBanner";
import { Image } from "@/components/Image";
import { Link } from "wouter";
import { Heart, Landmark, Scroll } from "lucide-react";
import { altOr, useBrandImages, useGameConfig } from "@/lib/gameApi";
import { useVillageLocation, useVillageName } from "@/hooks/useVillageName";
import { useAuth } from "@/contexts/AuthContext";
import { useTokenName } from "@/hooks/useTokenNames";

/** The wall is named after the village's own recognition token, as the footer names it. */
const doors = (tokenName: string) => [
  {
    href: "/quests",
    title: "Quests",
    body: "The work this village has asked for, open for anyone to pick up.",
    Icon: Scroll,
  },
  {
    href: "/gratitude",
    title: `${tokenName} Wall`,
    body: "Who has helped whom, said out loud and kept on the wall.",
    Icon: Heart,
  },
  {
    href: "/governance",
    title: "How we decide",
    body: "Who holds which power, and how a proposal becomes a decision.",
    Icon: Landmark,
  },
];

export default function VillageWelcome() {
  const name = useVillageName();
  const location = useVillageLocation();
  const brand = useBrandImages();
  const tagline = String(useGameConfig()?.project?.tagline ?? "").trim();
  const { user } = useAuth();
  const tokenName = useTokenName("Recognition");

  return (
    <Layout>
      <section className="relative overflow-hidden bg-teal-band">
        {brand.hero ? (
          <div className="absolute inset-0 z-0">
            <Image
              src={brand.hero}
              alt={altOr(brand.heroAlt, "The village and the land around it")}
              priority
              className="w-full h-full"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-teal-band via-teal-band/85 to-teal-band/25" />
          </div>
        ) : null}

        <div className="container relative z-10 py-16 md:py-24">
          <div className="relative max-w-2xl">
            {/* An opaque band under the copy, as on the brochure home, so the
                contrast is a property of two named colours and never of the
                photograph behind them. */}
            <div
              aria-hidden="true"
              className="absolute -inset-x-5 -inset-y-6 sm:-inset-x-8 sm:-inset-y-10 rounded-3xl bg-teal-band"
            />
            <h1 className="relative font-display text-4xl md:text-6xl font-bold text-white leading-tight mb-4">
              {name}
            </h1>
            {tagline ? <p className="relative text-xl text-white leading-relaxed mb-2">{tagline}</p> : null}
            {location ? <p className="relative text-white mb-8">{location}</p> : <div className="mb-8" />}
            <div className="relative flex flex-wrap gap-4">
              {user ? (
                <Link
                  href="/quests"
                  className="min-h-[44px] px-6 py-3 bg-white text-teal-band rounded-lg font-semibold hover:bg-cream"
                >
                  See the open quests
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="min-h-[44px] px-6 py-3 bg-white text-teal-band rounded-lg font-semibold hover:bg-cream"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/request-membership"
                    className="min-h-[44px] px-6 py-3 border border-white text-white rounded-lg font-semibold hover:bg-white/10"
                  >
                    Ask to join
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <SeasonBanner />

      <section className="container py-12 md:py-16">
        <ul className="grid gap-6 md:grid-cols-3">
          {doors(tokenName).map(({ href, title, body, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="block h-full rounded-2xl border border-border bg-card p-6 hover:shadow-md transition-shadow"
              >
                <Icon className="w-6 h-6 text-teal-deep mb-3" aria-hidden="true" />
                <h2 className="font-display text-xl font-semibold text-foreground mb-2">{title}</h2>
                <p className="text-muted-foreground leading-relaxed">{body}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}
