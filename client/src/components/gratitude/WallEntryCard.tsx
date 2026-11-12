/**
 * ONE THANKS ON THE WALL: a thread between two people (Phase C, decision 4).
 *
 * The words first, in the display face. Under them the two faces, joined by a
 * thread; a pair who thanked each other both ways meet in a vesica, two
 * circles each still whole. Then who thanked whom, and when.
 *
 * ── NO AMOUNT, AND NO COUNT ──────────────────────────────────────────────
 *
 * The card used to carry the amount beside the names. The lead's ruling for
 * the threads is that they never show a count, so the amount is no longer
 * drawn. It stays on the payload and on the ledger, where settlement reads
 * it; nothing about the economy changed, only what a reader sees. "Both
 * ways" is a fact about a pair and never says how often.
 *
 * ── NEVER A BROKEN IMAGE ─────────────────────────────────────────────────
 *
 * The server sends `avatar: null` for a member who fronts no character, and
 * the img carries `onError` as well, because a file can go missing after the
 * server answered. Both fall back to the member's initial, which is always in
 * the tree underneath the portrait.
 *
 * ── WHY THE HANDLE AND NOT THE NAME IS THE LINK ──────────────────────────
 *
 * `/profile/:handle` is the route, so the handle is the thing that actually
 * addresses a person here. A member with no handle (a deleted account, whose
 * tombstone keeps the recorded name and nothing else) gets plain text and no
 * link, never a link that resolves to nowhere. Face and name are one target,
 * 44px tall, because the portrait is what a thumb goes for.
 */
import { Link } from "wouter";
import { Trans, useLingui } from "@lingui/react/macro";

import Vesica from "@/components/journey/nature/Vesica";
import type { WallEntry, WallPerson } from "@shared/gratitudeVoices";

function Face({ who, size = "h-8 w-8" }: { who: WallPerson; size?: string }) {
  const initial = (who.name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`${size} relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground`}
      aria-hidden="true"
    >
      {/*
        THE INITIAL IS ALWAYS RENDERED, AND THE PORTRAIT SITS ON TOP OF IT.

        This was `{avatar ? <img/> : null}{avatar ? null : initial}`, so when a
        portrait existed the initial was never in the tree at all, and the
        onError below hid the img to reveal nothing: an empty circle. The
        comment on that handler claimed the initial would show, which is the
        second half of the defect. A guard whose fallback does not exist is not
        a guard, and prose describing behaviour the code does not have is worse
        than no prose.

        Absolutely positioned so the two occupy the same square rather than
        stacking, and the img paints over the letter until it cannot.
      */}
      <span className="absolute">{initial}</span>
      {who.avatar ? (
        <img
          src={who.avatar}
          alt=""
          className="relative h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            // The file went missing after the server answered. Drop the img and
            // the initial underneath it is what remains.
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}

/**
 * THE NAME IS THE TARGET, AND IT IS 44PX TALL.
 *
 * The name link once measured 74 by 16 CSS pixels on a 390px phone, which
 * fails WCAG 2.5.8 outright. The faces now sit together on the thread, so the
 * name carries the link alone, and `min-h-11` gives it the 44px this codebase
 * uses for every touch target; the negative inset keeps the row's rhythm.
 */
function Person({ who }: { who: WallPerson }) {
  const { t } = useLingui();
  const label = who.name || t({ message: "A member", context: "thanks thread: a person with no recorded name" });
  const body = <span className="font-semibold text-notice">{label}</span>;
  // No handle means a deleted account: the tombstone keeps the recorded name
  // and there is nowhere to go, so it is deliberately not a link.
  if (!who.handle) {
    return <span className="inline-flex min-h-11 items-center gap-2">{body}</span>;
  }
  return (
    <Link
      href={`/profile/${who.handle}`}
      className="-mx-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      {body}
    </Link>
  );
}

/** A thread between two faces, for a thanks that went one way. */
function OneThread() {
  return (
    <svg viewBox="0 0 64 24" className="h-6 w-16 shrink-0 overflow-visible text-open" aria-hidden="true">
      <path d="M4 16 Q32 2 60 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

/**
 * When, in words a person uses: the weekday within the last week, otherwise
 * the day and the month. Never "N days ago": time here is moons and dates.
 */
export function whenLabel(at: string, locale: string, now: Date = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const ageDays = (now.getTime() - d.getTime()) / 86_400_000;
  try {
    if (ageDays >= 0 && ageDays < 6.5) return d.toLocaleDateString(locale, { weekday: "long" });
    return d.toLocaleDateString(locale, { day: "numeric", month: "long" });
  } catch {
    return d.toLocaleDateString();
  }
}

export interface WallEntryCardProps {
  entry: WallEntry;
  /** The two thanked each other both ways (`bothWays`). */
  mutual?: boolean;
  /** This thread is lit on the web beside the words. */
  lit?: boolean;
  /** Hover or focus lights the thread on the web; leaving puts it out. */
  onLight?: (on: boolean) => void;
}

export default function WallEntryCard({ entry, mutual = false, lit = false, onLight }: WallEntryCardProps) {
  const { t, i18n } = useLingui();
  const from = <Person who={entry.from} />;
  const to = <Person who={entry.to} />;
  return (
    <article
      className={`rounded-2xl border bg-card px-5 py-4 shadow-sm transition-colors ${lit ? "border-notice/60" : "border-border"}`}
      data-testid="thread-card"
      data-mutual={mutual ? "true" : "false"}
      onMouseEnter={onLight ? () => onLight(true) : undefined}
      onMouseLeave={onLight ? () => onLight(false) : undefined}
      onFocus={onLight ? () => onLight(true) : undefined}
      onBlur={onLight ? () => onLight(false) : undefined}
    >
      <blockquote className="mb-3 font-display text-lg leading-snug text-card-foreground sm:text-xl">
        &ldquo;{entry.message}&rdquo;
      </blockquote>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Face who={entry.from} />
          {mutual ? (
            <Vesica
              met
              size="sm"
              label={t({ message: "They thanked each other both ways", context: "thanks thread: the vesica, read aloud" })}
            />
          ) : (
            <OneThread />
          )}
          <Face who={entry.to} />
        </span>
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <Trans context="thanks thread: who thanked whom">{from} thanked {to}</Trans>
          <span aria-hidden="true">·</span>
          <time dateTime={entry.at}>{whenLabel(entry.at, i18n.locale || "en")}</time>
        </span>
        {mutual && (
          <span className="inline-flex items-center rounded-full border border-notice/50 px-2.5 py-0.5 text-xs font-semibold text-notice">
            {t({ message: "Both ways", context: "thanks thread: the two thanked each other" })}
          </span>
        )}
      </div>
    </article>
  );
}
