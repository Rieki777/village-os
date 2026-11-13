/**
 * OUR FIRST 14 DAYS, as a strip of days (Phase B, the lead's decisions 1 and 3,
 * 11 Nov 2026). Shown only to someone newly seated in a role: their own
 * onboarding path, day 1 to 14 (`showsStrip`). Everyone else sees the week.
 *
 * What is ON it is village data (Admin, Onboarding path): a village writes its
 * own steps, each on the day it is due. This file draws whatever the path
 * holds and names no village and no step.
 *
 * PHONE AND DESKTOP, each at its best.
 *   - A phone: the two weeks as two rows of seven day stones, each a 44px
 *     target, and the chosen day's steps under them, one thing at a time.
 *   - A desktop: the days and the chosen day side by side, so the step and
 *     its act are read beside the whole fortnight. The keyboard walks the days
 *     (arrows a day, up and down a week, Home and End), and hovering a day
 *     names its steps.
 *
 * Steps are work and days are time: nothing here counts or ranks a person. No
 * fireflies: the page's one next act is the "Your path" card above. When every
 * step on the strip is done, a fern unfurls: a chapter finished.
 */
import { useState, type KeyboardEvent } from "react";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { FernUnfurl } from "@/components/journey/nature";
import { BTN_SECONDARY, H2, HINT, TILE } from "@/components/journey/look";
import { FIRST_DAYS, fourteenDays, moveDay, type StripPath, type StripStep } from "./fourteenDays";

/** A step's link: a page of this site opens in place, an https address in a new tab that is never handed this page. */
export function StepLink({ link }: { link: { label: string; href: string } }) {
  if (link.href.startsWith("/") && !link.href.startsWith("//")) {
    return (
      <Link href={link.href} className={BTN_SECONDARY}>
        {link.label}
      </Link>
    );
  }
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
      {link.label}
    </a>
  );
}

const fmt = (iso: string, locale: string, opts: Intl.DateTimeFormatOptions) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale, { ...opts, timeZone: "UTC" }) : iso;
};

export default function FirstFourteenDays({
  path,
  onTick,
  linkOf,
}: {
  path: StripPath;
  onTick: (key: string) => void;
  /** The step's link, already read as safe (OnboardingPath's `readLink`). */
  linkOf: (s: StripStep) => { label: string; href: string } | null;
}) {
  const { t, i18n } = useLingui();
  const strip = fourteenDays(path);
  const [chosen, setChosen] = useState(strip.focus);
  const day = strip.days[chosen - 1] ?? strip.days[0];
  const locale = i18n.locale || "en";
  const total = FIRST_DAYS;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = moveDay(chosen, e.key);
    if (to === null) return;
    e.preventDefault();
    setChosen(to);
    (e.currentTarget.querySelector(`[data-day="${to}"]`) as HTMLButtonElement | null)?.focus();
  };

  const next = strip.next;
  const nextDate = next ? fmt(strip.days[Math.min(total, Math.max(1, next.dueDay)) - 1].date, locale, { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <div data-first-fourteen="" data-day={path.day} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* The card above carries the path's own title as its eyebrow; the strip says which day it is. */}
        <p className={H2}>{t({ message: `Day ${path.day} of ${total}`, context: "first fourteen days strip, which day it is" })}</p>
        {strip.whole ? null : next ? (
          <p className="max-w-xl text-foreground" data-next-step={next.key}>
            <span className="font-semibold">{t({ message: `Next: ${next.title}`, context: "first fourteen days strip, the next step" })}</span>{" "}
            <span className="text-muted-foreground">
              {next.ownerName
                ? t({ message: `With ${next.ownerName}, by ${nextDate}.`, context: "first fourteen days strip, who the next step is with and when" })
                : t({ message: `By ${nextDate}.`, context: "first fourteen days strip, when the next step is due" })}
            </span>
          </p>
        ) : null}
      </div>

      {strip.whole ? (
        <div className={`${TILE} flex items-center gap-4`} data-fourteen-whole="">
          <FernUnfurl size="sm" detail={3} />
          <p className="text-foreground">{t({ message: `Every step of our first 14 days is walked. Welcome, truly.`, context: "first fourteen days strip, all done" })}</p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
        <div
          role="group"
          aria-label={t({ message: `The fourteen days`, context: "first fourteen days strip, the days as a group" })}
          onKeyDown={onKey}
          // M15: on a phone a sideways strip of 44x56 tiles; seven to a row from `sm` up.
          className="flex gap-1 overflow-x-auto max-sm:-mx-3 max-sm:px-3 max-sm:pb-1 sm:grid sm:grid-cols-7 sm:gap-2 sm:overflow-visible"
        >
          {strip.days.map((d) => {
            const titles = d.steps.map((s) => s.title).join(". ");
            const name = [
              fmt(d.date, locale, { weekday: "long", day: "numeric", month: "long" }),
              t({ message: `day ${d.day}`, context: "first fourteen days strip, a day's number in its name" }),
              d.today ? t({ message: `today`, context: "first fourteen days strip, the day that is today" }) : "",
              titles,
            ].filter(Boolean).join(", ");
            return (
              <button
                key={d.day}
                type="button"
                data-day={d.day}
                data-today={d.today ? "" : undefined}
                aria-pressed={d.day === chosen}
                aria-label={name}
                title={titles || undefined}
                tabIndex={d.day === chosen ? 0 : -1}
                onClick={() => setChosen(d.day)}
                className={`flex min-h-14 min-w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border py-1.5 text-foreground hover:border-notice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-16 ${
                  d.day === chosen ? "border-notice bg-muted" : d.today ? "border-notice/70" : "border-border"
                } ${d.past && d.steps.length === 0 ? "opacity-60" : ""}`}
              >
                <span className="text-xs uppercase tracking-widest text-muted-foreground max-sm:hidden">
                  {fmt(d.date, locale, { weekday: "short" })}
                </span>
                <span className={`font-display text-lg leading-none ${d.today ? "text-notice" : ""}`}>{d.day}</span>
                <span aria-hidden="true" className="flex h-2 items-center gap-0.5">
                  {d.steps.map((s) => (
                    <span
                      key={s.key}
                      className={`size-1.5 rounded-full ${s.doneAt ? "bg-open" : "border border-notice"}`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className={TILE} aria-live="polite" data-chosen-day={day.day}>
          <p className="font-display text-lg font-bold text-card-foreground">
            {t({ message: `Day ${day.day}`, context: "first fourteen days strip, the chosen day" })}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{fmt(day.date, locale, { weekday: "long", day: "numeric", month: "long" })}</span>
          </p>
          {day.steps.length === 0 ? (
            <p className={`${HINT} mt-2`}>{t({ message: `Nothing is due on this day. A day to settle in.`, context: "first fourteen days strip, a day with no step" })}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {day.steps.map((s) => {
                const link = linkOf(s);
                return (
                  <li key={s.key} data-step={s.key} className="flex flex-col gap-2">
                    <span className={`flex items-start gap-3 ${s.doneAt ? "text-muted-foreground" : "font-medium text-card-foreground"}`}>
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-notice ${s.doneAt ? "bg-notice text-background" : ""}`}
                      >
                        {s.doneAt && <Check className="size-3.5" />}
                      </span>
                      <span>
                        {s.title}
                        <span className="block text-sm font-normal text-muted-foreground">
                          {s.ownerName ? t({ message: `With ${s.ownerName}. Done when: ${s.doneWhen}`, context: "first fourteen days strip, who a step is with and when it is done" }) : t({ message: `Done when: ${s.doneWhen}`, context: "first fourteen days strip, when a step is done" })}
                        </span>
                      </span>
                    </span>
                    {(link || (!s.doneAt && s.mayTick)) && (
                      <span className="flex flex-wrap gap-2 pl-9">
                        {link ? <StepLink link={link} /> : null}
                        {!s.doneAt && s.mayTick ? (
                          <button type="button" onClick={() => onTick(s.key)} className={BTN_SECONDARY}>
                            {t({ message: `Mark done`, context: "first fourteen days strip, tick a step" })}
                          </button>
                        ) : null}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
