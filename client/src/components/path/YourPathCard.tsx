/**
 * "YOUR PATH", the one featured card on the profile's Today (the Root, game
 * feel wave 2). It says the ONE next step, what comes after it and when, and
 * draws the walk so far as a Seed of Life: one circle per milestone walked.
 *
 * IT REPLACES NINE VOICES WITH ONE. The lane-2 report counted nine places on
 * one profile that each named a "next", and they disagreed. This card reads
 * the conductor (shared/yourPath.ts, served as `me.path`), and the others go
 * quiet while it has a step: the steps before a role starts and the texts
 * waiting on the reader are drawn INSIDE it (`children`), the stage panel's
 * next step, the Today strip's line and the next-season banner are not drawn.
 *
 * Nothing here counts, ranks or compares. The seed is the reader's own walk
 * and is shown to nobody else.
 *
 * PHONE AND DESKTOP, each at its best.
 *   - A phone gets one thing at a time: the seed across the top, the step, and
 *     a full-width act under the thumb. What else waits is folded below it.
 *   - A desktop has the width for side by side: the step and its act on the
 *     left, and a standing panel on the right with what else is on the path
 *     and the agreements to align with, so nothing has to be opened to be seen.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useLingui } from "@lingui/react/macro";
import { SeedOfLife } from "@/components/journey/nature";
import { CARD_FEATURED, CHIP_SOFT, EYEBROW, HINT, LEDE, LINK, STATEMENT } from "@/components/journey/look";
import { useGameConfig } from "@/lib/gameApi";
import { useGuideName } from "@/hooks/useGuideName";
import { guideNameAtSentenceStart } from "@shared/guideName";
import { sayPath, sayPathLine, type PathAnswer } from "@shared/yourPath";
import type { PathView } from "@/lib/usePath";
import NextAct from "./NextAct";
import { companionFor, seedOf } from "./pathView";

export default function YourPathCard({ path, children, className = "" }: { path: PathView; children?: ReactNode; className?: string }) {
  const { t, i18n } = useLingui();
  const config = useGameConfig();
  const guide = useGuideName();
  const said = sayPath(path, i18n.locale);
  const seed = seedOf(path);
  const line = companionFor(path, { locale: i18n.locale, visitor: false, here: "/profile", heading: said.step, commitment: config?.project?.commitmentName });
  const rooted = path.fresh && path.walked.includes("seated");
  const seedLabel = t({ message: `Your path: ${seed.walked} of ${seed.total} steps walked`, context: "your path, the seed drawing" });
  // What else waits, said once each: the same rule twice (two roles) reads as one line here and in full on the whole-path page.
  const also: PathAnswer[] = path.also.filter((a) => a.state !== "explore" && a.state !== path.state).slice(0, 3);

  return (
    <section id="your-path" aria-labelledby="your-path-h" data-your-path="" data-path-state={path.state} className={`scroll-mt-28 ${CARD_FEATURED} ${className}`.trim()}>
      <div className="flex items-center justify-between gap-3">
        <p className={EYEBROW}>{t({ message: `Your path`, context: "your path, the profile card" })}</p>
        <Link href="/path" className={`${LINK} inline-flex min-h-11 items-center text-sm`}>
          {t({ message: `See your whole path`, context: "your path, the profile card" })}
        </Link>
      </div>
      <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
          <SeedOfLife size="md" total={seed.total} walked={seed.walked} label={seedLabel} />
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3 sm:items-start">
            <span className={CHIP_SOFT} data-whose={path.whose}>{said.whose}</span>
            <h2 id="your-path-h" className={`${STATEMENT} break-words`}>{said.step}</h2>
            {said.after && <p className={LEDE} data-path-after="">{said.after}</p>}
            {rooted && <p className="text-base font-medium text-notice">{t({ message: `Your role has taken root.`, context: "your path, the profile card" })}</p>}
            <div className="w-full sm:w-auto">
              <NextAct state={path.state} href={path.step.href} block className="sm:w-auto" />
            </div>
            {line && (
              <p className={`${HINT} max-w-prose`} data-companion-line="">
                <span className="font-semibold text-foreground">{guideNameAtSentenceStart(guide.name)}: </span>
                <span className="sm:hidden">{line.short}</span>
                <span className="hidden sm:inline">{line.line}</span>
                {line.why && <span className="mt-1 block">{line.why}</span>}
              </p>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4 empty:hidden">
          {children}
          {also.length > 0 && (
            <div data-path-also="">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t({ message: `After that`, context: "your path, the profile card" })}</p>
              <ul className="mt-2 grid gap-1">
                {also.map((a, i) => (
                  <li key={`${a.state}-${i}`} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full border border-border" />
                    {a.step.href ? (
                      <Link href={a.step.href} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                        {sayPathLine(a.step, i18n.locale)}
                      </Link>
                    ) : (
                      sayPathLine(a.step, i18n.locale)
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
