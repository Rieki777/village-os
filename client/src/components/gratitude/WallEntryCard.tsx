/**
 * ONE APPRECIATION ON THE WALL, with the people in it.
 *
 * The card used to read `"message" — Ash to Wren · 12/09/2026`, two first
 * names and a date, which made a hall of strangers: you could see that
 * somebody had thanked somebody without ever seeing who. Rye ruled on
 * 2026-09-06 that portraits and handles may be public, so each side now
 * carries its face and its handle, and the handle is a link to that member.
 *
 * ── NEVER A BROKEN IMAGE ─────────────────────────────────────────────────
 *
 * Two guards, because one is not enough. The server sends `avatar: null` for a
 * member who fronts no character rather than a path it hopes resolves, and the
 * img carries `onError` as well, because a file can go missing after the
 * server answered. Both fall back to a medallion of the member's initial. This
 * is the same contract `ProfileHero` holds and it is held here for the same
 * reason: a wall of gratitude showing a row of broken-image glyphs is worse
 * than a wall showing initials.
 *
 * ── THE AMOUNT IS SHOWN, AND IT IS SHOWN SMALL ───────────────────────────
 *
 * It was not on the payload at all, so every thanks looked the same size when
 * the economy had already decided they were not. It sits with the attribution
 * rather than beside the words: the sentence is what a reader came for, and a
 * number set level with it competes for the eye it needs.
 *
 * ── WHY THE HANDLE AND NOT THE NAME IS THE LINK ──────────────────────────
 *
 * `/profile/:handle` is the route, so the handle is the thing that actually
 * addresses a person here. A member with no handle (a deleted account, whose
 * tombstone keeps the recorded name and nothing else) gets plain text and no
 * link, never a link that resolves to nowhere.
 */
import { Link } from "wouter";
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
 * THE FACE AND THE NAME ARE ONE TARGET.
 *
 * They were two elements with the link on the name alone, which measured
 * 74 by 16 CSS pixels on a real 390px phone. WCAG 2.5.8 asks 24 by 24 at AA
 * and 2.5.5 asks 44 by 44 at AAA, so a 16px-tall link fails the lower bar
 * outright, and it is the primary way a member reaches somebody's profile
 * from this wall.
 *
 * Wrapping both in one anchor is the fix and it is also the better
 * interaction: on a phone the portrait is the thing a thumb goes for, and it
 * was inert. `min-h-11` is the 44px this codebase already uses for its own
 * touch targets, and the negative inset keeps the row's visual rhythm
 * unchanged while the hit area grows past the text.
 */
function Person({ who }: { who: WallPerson }) {
  const label = who.name || "A member";
  const body = (
    <>
      <Face who={who} />
      <span className="font-semibold text-notice">{label}</span>
    </>
  );
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

export default function WallEntryCard({ entry, currency }: { entry: WallEntry; currency: string }) {
  return (
    <article className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
      <p className="mb-3 leading-relaxed text-card-foreground">"{entry.message}"</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Person who={entry.from} />
        <span>thanked</span>
        <Person who={entry.to} />
        {entry.amount > 0 && (
          <span className="text-notice">
            {/* Named for the reader, so the figure is never a bare integer. */}
            <span className="sr-only">Amount: </span>
            {entry.amount} {currency.toLowerCase()}
          </span>
        )}
        <span aria-hidden="true">·</span>
        <span>{new Date(entry.at).toLocaleDateString()}</span>
      </div>
    </article>
  );
}
