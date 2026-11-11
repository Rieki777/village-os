/**
 * THE ROOT STRIP, filled (the Root, game feel wave 2): the one next step,
 * under the header on every page, for a member and for a visitor.
 *
 * It is the Trail's successor and reads the same answer everything else does
 * (`usePath`, the conductor in shared/yourPath.ts), so the strip, the profile's
 * "Your path" card and the whole-path page cannot disagree. The seed beside
 * the words closes one circle per milestone walked.
 *
 * PHONE AND DESKTOP, each at its best.
 *   - A phone gets ONE line and the whole strip is one target: a thumb opens
 *     the whole path, where the step's own door sits within reach.
 *   - A desktop has the width: the step is its own link, what comes after and
 *     the companion's line sit under it, the four chapter stops show where the
 *     walk stands, and a door at the end opens the whole path.
 *
 * No fireflies here. They belong to the one next act on a page, and the strip
 * is on every page.
 */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useLingui } from "@lingui/react/macro";
import { RootStrip, SeedOfLife } from "@/components/journey/nature";
import { useGameConfig } from "@/lib/gameApi";
import { usePath } from "@/lib/usePath";
import { WHOLE_PATH_WORDS, pathLanguage, sayPath } from "@shared/yourPath";
import { chaptersOf, companionFor, noteVisitorScreen, seedOf } from "./pathView";


export default function RootLine({ quiet }: { quiet: (path: string, stepHref?: string | null) => boolean }) {
  const { t, i18n } = useLingui();
  const [location] = useLocation();
  const config = useGameConfig();
  const path = usePath();
  const here = location.split(/[?#]/)[0] || "/";
  const shown = !!path && !quiet(location, path.step.href) && !path.quietOn.includes(here);
  const line = path && shown ? companionFor(path, { locale: i18n.locale, visitor: path.visitor, here, commitment: config?.project?.commitmentName }) : null;
  useEffect(() => {
    if (path?.visitor && line) noteVisitorScreen(here);
  }, [path?.visitor, line, here]);

  if (!path || !shown) return null;
  const said = sayPath(path, i18n.locale);
  const words = WHOLE_PATH_WORDS[pathLanguage(i18n.locale)];
  const seed = seedOf(path);
  const seedLabel = t({ message: `Your path: ${seed.walked} of ${seed.total} steps walked`, context: "your path, the seed drawing" });
  const glyph = <SeedOfLife size="sm" total={seed.total} walked={seed.walked} label={seedLabel} />;
  const eyebrow = t({ message: `Your path`, context: "your path, the strip under the header" });
  const openWords = t({ message: `See your whole path`, context: "your path, the strip under the header" });
  const stops = chaptersOf(path.walked);

  return (
    <aside aria-label={eyebrow} data-root-line="" data-path-state={path.state} className="sheet-night">
      {/* Phone: one line, one target, the whole path a thumb away. */}
      <Link href="/path" aria-label={`${eyebrow}: ${said.step}. ${openWords}`} className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:hidden" data-root-phone="">
        <RootStrip seed={glyph}>{said.step}</RootStrip>
      </Link>
      {/* Desktop: the step is its own door, with what comes after, the companion and the stops. */}
      <div className="hidden sm:block" data-root-desktop="">
        <RootStrip
          seed={glyph}
          detail={[said.after, line?.line].filter(Boolean).join(" ") || undefined}
          aside={
            <>
              <ol className="hidden items-center gap-3 xl:flex" aria-label={t({ message: `The chapters of your path`, context: "your path, the strip under the header" })}>
                {stops.map((s) => (
                  <li key={s.chapter} data-stop={s.state} aria-current={s.state === "now" ? "step" : undefined} className={`flex items-center gap-1.5 text-xs ${s.state === "ahead" ? "text-muted-foreground" : "text-foreground"}`}>
                    <span aria-hidden="true" className={`size-2 rounded-full border ${s.state === "walked" ? "border-notice bg-notice" : s.state === "now" ? "border-notice" : "border-border"}`} />
                    {words.chapter[s.chapter]}
                  </li>
                ))}
              </ol>
              <Link href="/path" className="inline-flex min-h-11 items-center text-sm font-medium text-notice underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                {openWords}
              </Link>
            </>
          }
        >
          <span className="mr-2 text-xs font-semibold uppercase tracking-widest text-notice">{eyebrow}</span>
          {path.step.href ? (
            <Link href={path.step.href} className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
              {said.step}
            </Link>
          ) : (
            <span className="font-medium">{said.step}</span>
          )}
        </RootStrip>
      </div>
    </aside>
  );
}
