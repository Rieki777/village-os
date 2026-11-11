/**
 * THE FORK: where the path divides after the first steps (build list 8.6).
 * Two tracks off the same entry steps, drawn as a vesica, two circles that
 * meet and each stay whole: holding a role, and living here. Both pages show
 * it from the steward page's `tracks` section; each marks the one a visitor
 * is on and links to the other.
 *
 * Phone and desktop. On a phone the two cards stack, the one you are on
 * first, and the vesica sits small above them. From `md` the cards stand
 * side by side with the larger vesica between their headings, so the fork
 * reads as a fork.
 */
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { CARD, CARD_FEATURED, CHIP, EYEBROW, LEDE } from "@/components/journey/look";
import { Vesica } from "@/components/journey/nature";
import { Emphasized } from "@/components/PageText";
import type { ResolvedSection } from "@shared/pageContent/types";

export type Track = "steward" | "resident";

/** Each track's own page, fixed in the app. */
const TRACK_HREF: Readonly<Record<Track, string>> = { steward: "/steward", resident: "/resident" };

/** Where the track a visitor is on continues on this page. */
const TRACK_ANCHOR: Readonly<Record<Track, string>> = { steward: "#role-path", resident: "#home-path" };

export default function TwoTracks({ section, here }: { section: ResolvedSection; here: Track }) {
  const f = section.fields;
  const tracks: { id: Track; title: string; line: string }[] = [
    { id: "steward", title: f.stewardTitle, line: f.stewardLine },
    { id: "resident", title: f.residentTitle, line: f.residentLine },
  ];
  // The one you are on comes first on a phone, where the cards stack.
  const ordered = here === "steward" ? tracks : [tracks[1], tracks[0]];
  return (
    <section className="py-16 sm:py-20" aria-labelledby="two-tracks-heading">
      <div className="container">
        <div className="mx-auto max-w-4xl text-center">
          {/* The cards below name the two paths; the drawing is their shape alone. */}
          <Vesica met label={`${f.stewardTitle}, ${f.residentTitle}`} size="md" className="mx-auto mb-6 md:hidden" />
          <Vesica met label={`${f.stewardTitle}, ${f.residentTitle}`} size="lg" className="mx-auto mb-8 hidden md:block" />
          <h2 id="two-tracks-heading" className="font-display text-3xl font-semibold text-foreground break-words sm:text-4xl">
            {f.heading}
          </h2>
          <p className={`${LEDE} mx-auto mt-3`}>
            <Emphasized text={f.body} />
          </p>
        </div>
        <ul className="mx-auto mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
          {ordered.map((t) => {
            const isHere = t.id === here;
            return (
              <li key={t.id} className={`${isHere ? CARD_FEATURED : CARD} flex min-w-0 flex-col ${t.id === "steward" ? "md:order-1" : "md:order-2"}`} data-track={t.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-2xl font-semibold text-foreground break-words">{t.title}</h3>
                  {isHere && f.hereLabel && <span className={CHIP}>{f.hereLabel}</span>}
                </div>
                <p className="mt-2 break-words text-muted-foreground">
                  <Emphasized text={t.line} />
                </p>
                <div className="mt-auto pt-4">
                  {isHere ? (
                    <a href={TRACK_ANCHOR[t.id]} className={`${EYEBROW} inline-flex min-h-11 items-center gap-2 hover:text-foreground`}>
                      {t.title}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : (
                    <Link href={TRACK_HREF[t.id]} className={`${EYEBROW} inline-flex min-h-11 items-center gap-2 hover:text-foreground`}>
                      {t.title}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
