/**
 * `/path`: THE WHOLE PATH, unrolled (the Root, game feel wave 2). A story
 * journal of the reader's own walk: chapters, each with the milestones in it,
 * the days the village holds for them, and "resume" on the one step that is
 * next. The root strip under every header opens it.
 *
 * It reads the same answer as the strip and the profile's card (`usePath`, the
 * conductor in shared/yourPath.ts), so the three cannot disagree. A visitor has
 * a path too: its first chapter, with the front door as the step.
 *
 * Nothing here is a score. A circle is a step walked; an open one is a step
 * still ahead, and nobody is compared with anybody.
 *
 * PHONE AND DESKTOP, each at its best.
 *   - A phone reads one column: the seed, then the chapters down one root, and
 *     the step's act held at the bottom of the screen within thumb reach.
 *   - A desktop sets the journal beside a standing panel: the large seed with
 *     firefly light on the circle being walked, the step and its act, the
 *     companion's line, and what else waits. Enter on the page takes the step.
 */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useLingui } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import { BreathingLoader } from "@/components/natural";
import { SeedOfLife } from "@/components/journey/nature";
import { CARD, CARD_FEATURED, CHIP_SOFT, EYEBROW, H1, HINT, LEDE, STATEMENT, WORLD } from "@/components/journey/look";
import NextAct from "@/components/path/NextAct";
import { chaptersOf, companionFor, seedOf } from "@/components/path/pathView";
import { useGuideName } from "@/hooks/useGuideName";
import { useGameConfig } from "@/lib/gameApi";
import { usePath } from "@/lib/usePath";
import { guideNameAtSentenceStart } from "@shared/guideName";
import { WHOLE_PATH_WORDS, dayInWords, pathLanguage, sayPath, sayPathLine } from "@shared/yourPath";

export default function YourPath() {
  const { t, i18n } = useLingui();
  const [, navigate] = useLocation();
  const config = useGameConfig();
  const guide = useGuideName();
  const path = usePath();
  const lang = pathLanguage(i18n.locale);
  const words = WHOLE_PATH_WORDS[lang];
  const href = path?.step.href ?? null;

  // Desktop: Enter takes the step, unless the reader is on a control of their own.
  useEffect(() => {
    if (!href) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Enter" || e.defaultPrevented || (el && el.closest("a, button, input, textarea, select, [role='button']"))) return;
      navigate(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href, navigate]);

  if (!path) {
    return (
      <Layout>
        <div className={`${WORLD} flex justify-center py-24`}>
          <BreathingLoader label={t({ message: `Your path`, context: "your path, the whole path page" })} />
        </div>
      </Layout>
    );
  }

  const said = sayPath(path, i18n.locale);
  const seed = seedOf(path);
  const chapters = chaptersOf(path.walked);
  const line = companionFor(path, { locale: i18n.locale, visitor: path.visitor, here: "/path", heading: said.step, commitment: config?.project?.commitmentName });
  const also = path.also.filter((a) => a.state !== "explore" && a.state !== path.state);
  const seedLabel = t({ message: `Your path: ${seed.walked} of ${seed.total} steps walked`, context: "your path, the seed drawing" });
  const nowWords = t({ message: `Now`, context: "your path, the whole path page" });

  const stepPanel = (
    <section aria-labelledby="path-now-h" className={CARD_FEATURED} data-path-now="" data-path-state={path.state}>
      <div className="flex items-center justify-between gap-3">
        <p className={EYEBROW}>{nowWords}</p>
        <span className={CHIP_SOFT}>{said.whose}</span>
      </div>
      <h2 id="path-now-h" className={`${STATEMENT} mt-2 break-words`}>{said.step}</h2>
      {said.after && <p className={`${LEDE} mt-2`}>{said.after}</p>}
      {/* The act itself: here on a desktop, held at the bottom of the screen on a phone. */}
      <div className="mt-4 hidden md:block">
        <NextAct state={path.state} href={href} />
        {href && <p className={`${HINT} mt-2`}>{t({ message: `Press Enter to take this step.`, context: "your path, the whole path page" })}</p>}
      </div>
      {line && (
        <p className={`${HINT} mt-4 max-w-prose`} data-companion-line="">
          <span className="font-semibold text-foreground">{guideNameAtSentenceStart(guide.name)}: </span>
          <span className="md:hidden">{line.short}</span>
          <span className="hidden md:inline">{line.line}</span>
          {line.why && <span className="mt-1 block">{line.why}</span>}
        </p>
      )}
    </section>
  );

  return (
    <Layout>
      <div className={`${WORLD} pb-40 pt-6 sm:py-12 md:pb-16`} data-whole-path="">
        <div className="container max-w-6xl px-4">
          <header className="max-w-3xl">
            <p className={EYEBROW}>{t({ message: `Your path`, context: "your path, the whole path page" })}</p>
            <h1 className={`${H1} mt-1`}>{t({ message: `From your first visit to your first moon`, context: "your path, the whole path page" })}</h1>
          </header>

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:gap-12">
            {/* The seed and the step: first on a phone, a standing panel beside the journal on a desktop. */}
            <aside className="lg:col-start-2 lg:row-start-1" aria-label={nowWords}>
              <div className="flex flex-col items-center gap-6 lg:sticky lg:top-28">
                <SeedOfLife size="lg" total={seed.total} walked={seed.walked} label={seedLabel} glowCurrent />
                <div className="w-full">{stepPanel}</div>
              </div>
            </aside>

            {/* The journal: chapters down one root. */}
            <ol className="relative flex flex-col gap-8 lg:col-start-1 lg:row-start-1 border-l border-open/50 pl-6 sm:pl-8" data-path-chapters="">
              {chapters.map((c) => (
                <li key={c.chapter} data-chapter={c.chapter} data-chapter-state={c.state}>
                  <p className={c.state === "ahead" ? "text-xs font-semibold uppercase tracking-widest text-muted-foreground" : EYEBROW}>{words.chapter[c.chapter]}</p>
                  <ul className="mt-3 grid gap-3">
                    {c.milestones
                      .filter((m) => m.walked)
                      .map((m) => (
                        <li key={m.milestone} data-milestone={m.milestone} data-walked="true" className="relative flex min-h-11 flex-col justify-center">
                          <span aria-hidden="true" className="absolute -left-[calc(1.5rem+7px)] top-1/2 size-3.5 -translate-y-1/2 rounded-full border-2 border-notice bg-notice/30 sm:-left-[calc(2rem+7px)]" />
                          <span className="text-base text-foreground">{words.milestone[m.milestone]}</span>
                          {path.dates[m.milestone] && <span className={HINT}>{dayInWords(path.dates[m.milestone]!, lang)}</span>}
                        </li>
                      ))}
                    {c.state === "now" && (
                      <li data-milestone="now" aria-current="step" className="relative flex min-h-14 flex-col justify-center py-1">
                        <span aria-hidden="true" className="absolute -left-[calc(1.5rem+10px)] top-1/2 size-5 -translate-y-1/2 sm:-left-[calc(2rem+10px)]">
                          <span className="absolute inset-0 rounded-full border-2 border-dash-gold-lit bg-background shadow-[0_0_10px_2px_color-mix(in_srgb,var(--color-dash-gold-lit)_45%,transparent)]" />
                        </span>
                        <span className="font-display text-xl text-foreground sm:text-2xl">{said.step}</span>
                        <span className={HINT}>{[nowWords, said.after].filter(Boolean).join(" · ")}</span>
                      </li>
                    )}
                    {c.milestones
                      .filter((m) => !m.walked)
                      .map((m) => (
                        <li key={m.milestone} data-milestone={m.milestone} data-walked="false" className="relative flex min-h-11 flex-col justify-center">
                          <span aria-hidden="true" className="absolute -left-[calc(1.5rem+7px)] top-1/2 size-3.5 -translate-y-1/2 rounded-full border border-dashed border-border bg-background sm:-left-[calc(2rem+7px)]" />
                          <span className="text-base text-muted-foreground">{words.milestone[m.milestone]}</span>
                          {path.dates[m.milestone] && <span className={HINT}>{dayInWords(path.dates[m.milestone]!, lang)}</span>}
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>

          {also.length > 0 && (
            <section aria-labelledby="path-also-h" className={`${CARD} mt-10 max-w-3xl`} data-path-also="">
              <h2 id="path-also-h" className="font-display text-2xl text-card-foreground">{t({ message: `Also on your path`, context: "your path, the whole path page" })}</h2>
              <p className={`${HINT} mt-1`}>{t({ message: `These wait behind the step above. Take them in any order once it is done.`, context: "your path, the whole path page" })}</p>
              <ul className="mt-3 grid gap-2">
                {also.map((a, i) => (
                  <li key={`${a.state}-${i}`}>
                    {a.step.href ? (
                      <Link href={a.step.href} className="group flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-2 text-foreground hover:border-notice focus-visible:outline-2 focus-visible:outline-ring">
                        <span className="min-w-0">
                          <span className="block font-medium">{sayPathLine(a.step, i18n.locale)}</span>
                          {a.after && <span className={`${HINT} block`}>{sayPathLine(a.after, i18n.locale)}</span>}
                        </span>
                      </Link>
                    ) : (
                      <p className="rounded-lg border border-border bg-muted px-4 py-3 text-foreground">{sayPathLine(a.step, i18n.locale)}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Phone: the act stays within thumb reach, above the tab bar. */}
        {href && (
          <div data-bottom-bar="" className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:hidden">
            <NextAct state={path.state} href={href} block />
          </div>
        )}
      </div>
    </Layout>
  );
}
