/**
 * THE FRONT OF A SEAT CARD: what the seat is, who holds it, and the one door.
 *
 * Top to bottom, which is also the reading order: the circle it sits in (and
 * the Key seat chip), the art window with the state badge and the name plate,
 * the aim, the figures, the line where the badge and the figures meet, the
 * action, the roster, and the bar that turns the card over. Every word and
 * every number comes from the view model (`seatSheet()`); this file only
 * draws, so a test of the view model is a test of what this prints.
 *
 * THE ART IS STOCK ART FOR A SUGGESTED CLASS, NEVER THE HOLDER. A seat with no
 * class tag, an unknown key, or a picture that will not load draws its sigil
 * instead: the first letter of its name in a gold ring, made from tokens, so a
 * village that re-tints its gold re-tints the sigil.
 *
 * Also the home of three parts the back face shares: the state badge, the
 * eyebrow, and the figure row (drawn twice, once per face, and only ever
 * displayed once at any width, so a screen reader meets one).
 */
import { useState, type ReactNode, type Ref } from "react";
import { RotateCcw, Sparkles, Star } from "lucide-react";
import { SHEET_WORDS, speaksForGloss, speaksForLabel, type Pip, type SeatSheetView, type SeatStateWord } from "@shared/roleSheet";
import { ExampleChip } from "@/components/ExamplesBanner";
import Figure from "@/components/sheet/Figure";
import { Gloss, GlossChip } from "@/components/sheet/GlossChip";
import SeatGlyph from "./SeatGlyph";
import SeatRoster from "./SeatRoster";

/** Which gloss on this card is open; from `useGlossGroup` in the card root. */
export interface CardGloss {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  close: () => void;
}

/** The words carry the state, the glyph only repeats them, and the ground is opaque. */
const BADGE_LOOK: Record<SeatStateWord | "proposed", string> = {
  open: "pl-1.5 text-open border border-open/60",
  partial: "pl-1.5 text-notice border border-notice/60",
  filled: "pl-1.5 text-(--sheet-earned-lit) border border-(--sheet-earned-lit)/55",
  forming: "pl-1.5 text-muted-foreground border border-dashed border-border",
  expired: "pl-1.5 text-(--sheet-earned-lit) border border-dashed border-(--sheet-earned-lit)/70",
  proposed: "pl-2.5 text-foreground border border-dashed border-border",
};

/**
 * The state badge. The glyph is the map's own SeatGlyph, so the map and the
 * card draw one glyph set; the two custom properties make it stroke in the
 * badge's ink and fill with the badge's ground.
 */
export function StateBadge({ badge, seats }: { badge: NonNullable<SeatSheetView["badge"]>; seats: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-card py-1 pr-2.5 text-[11.5px] font-semibold leading-tight [--color-parchment:var(--card)] [--color-teal-deep:currentColor] ${BADGE_LOOK[badge.word]}`}
    >
      {badge.word !== "proposed" && (
        <svg aria-hidden="true" width="16" height="16" viewBox="-10 -10 20 20" className="shrink-0">
          <SeatGlyph x={0} y={0} r={8} state={badge.word} held={badge.held} seats={seats} holders={[]} showAvatars={false} />
        </svg>
      )}
      {badge.label}
    </span>
  );
}

/** The circle the seat sits in, led by its colour as a dot and nothing more. */
export function Eyebrow({ text, colour }: { text: string; colour: string | null }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 break-words text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
      {colour && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: colour }} />}
      <span className="min-w-0">{text}</span>
    </p>
  );
}

const NUMBER = "font-body text-[30px] font-semibold leading-none tabular-nums text-card-foreground";
const FIGURE_LABEL = "text-[11px] font-semibold uppercase leading-tight tracking-[0.1em] text-muted-foreground";

/**
 * The figures. `wide` is the back column's copy, shown only once the card
 * opens flat: every figure in one row of five, the clock a plain tile whose
 * date rides its title. The narrow copy is three up with the clock on its own
 * row and its date written out under it.
 */
export function SeatFigures({ view, wide }: { view: SeatSheetView; wide: boolean }) {
  const { figures, clock } = view;
  if (wide) {
    return (
      <dl aria-label={SHEET_WORDS.figuresName} className="hidden grid-cols-5 border-y border-border/55 py-2.5 @min-[680px]:grid">
        {figures.map((f) => (
          <Figure key={f.key} layout="seat" face="body" value={String(f.value)} label={f.label} tone={f.tone} />
        ))}
        {clock && (
          <Figure layout="seat" face="body" value={String(clock.value)} label={clock.label} tone={clock.tone} title={clock.sub} />
        )}
      </dl>
    );
  }
  return (
    <dl aria-label={SHEET_WORDS.figuresName} className="grid grid-cols-3 border-y border-border/55 py-2.5 @min-[680px]:hidden">
      {figures
        .filter((f) => !f.wideOnly)
        .map((f) => (
          <Figure key={f.key} layout="seat" face="body" value={String(f.value)} label={f.label} tone={f.tone} />
        ))}
      {clock && (
        <div className="col-span-3 mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 border-t border-border/45 pl-1 pt-2.5">
          <dt className={`col-start-2 row-start-1 ${FIGURE_LABEL}`}>{clock.label}</dt>
          <dd className={`col-start-1 row-span-2 row-start-1 ${NUMBER}`}>{clock.value}</dd>
          <dd className="col-start-2 row-start-2 text-xs text-muted-foreground">{clock.sub}</dd>
        </div>
      )}
    </dl>
  );
}

const PIP: Record<Pip, string> = {
  lit: "bg-notice border-notice",
  edged: "border-notice/70",
  empty: "border-border",
};

const NAME_SCALE: Record<SeatSheetView["nameScale"], string> = {
  lg: "text-[29px] @min-[440px]:text-[31px]",
  md: "text-[24px] @min-[440px]:text-[26px]",
  sm: "text-[21px] @min-[440px]:text-[23px]",
};

/** The art: the class picture, or the sigil when there is none or it will not load. */
function ArtWindowPicture({ view }: { view: SeatSheetView }) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const p = view.portrait;
  if (p.kind === "class" && brokenSrc !== p.src) {
    // A drawing painted on a paper margin (`FRAMED_PORTRAITS`) is zoomed a
    // quarter about a point just above the window's middle, which puts its
    // margin, 8.5% of the width at most, outside every window this card draws,
    // from 272px wide to 650.
    return (
      <img
        src={p.src}
        alt={p.alt}
        onError={() => setBrokenSrc(p.src)}
        className={`absolute inset-0 h-full w-full object-cover object-[50%_5%] ${p.framed ? "origin-[50%_45%] scale-125" : ""}`}
      />
    );
  }
  const letter = p.kind === "sigil" ? p.letter : (Array.from(view.name.trim())[0] ?? "").toUpperCase();
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 flex justify-center bg-[radial-gradient(80%_70%_at_50%_30%,color-mix(in_srgb,var(--sheet-notice)_14%,transparent),transparent_70%)] pt-6"
    >
      <span className="grid size-28 place-items-center rounded-full ring-1 ring-notice/60">
        <span className="font-display text-5xl text-notice">{letter}</span>
      </span>
    </div>
  );
}

export default function SeatCardFront({
  view,
  glossIds,
  gloss,
  nameId,
  embedded,
  stacked,
  action,
  onPickPerson,
  onFlip,
  flipRef,
}: {
  view: SeatSheetView;
  glossIds: { keySeat: string; suits: string; speaksFor: string; recruiting: string };
  gloss: CardGloss;
  nameId: string;
  embedded: boolean;
  stacked: boolean;
  action?: ReactNode;
  onPickPerson?: (holderKey: string, name: string | null) => void;
  onFlip: () => void;
  flipRef: Ref<HTMLButtonElement>;
}) {
  const chip = (key: keyof typeof glossIds) => ({
    open: gloss.isOpen(key),
    glossId: glossIds[key],
    onToggle: () => gloss.toggle(key),
    onClose: gloss.close,
  });
  const { chips } = view;
  const showEyebrow = !embedded && !!view.eyebrow;
  const nameClass = `font-display leading-[1.08] text-foreground text-balance break-words ${NAME_SCALE[view.nameScale]}`;
  const nameBody = (
    <>
      {view.name}
      {view.isExample && <ExampleChip tone="night" className="ml-2 align-middle" />}
    </>
  );

  return (
    <>
      {(showEyebrow || chips.keySeat) && (
        <div className="flex min-h-6 items-center justify-between gap-2 px-1 pt-0.5">
          {showEyebrow ? <Eyebrow text={view.eyebrow!} colour={view.circleColour} /> : <span />}
          {/* The circle's name wraps beside the chip; the chip itself never does. */}
          {chips.keySeat && (
            <span className="shrink-0 whitespace-nowrap">
              <GlossChip tone="notice" icon={Star} {...chip("keySeat")}>
                {SHEET_WORDS.keySeat}
              </GlossChip>
            </span>
          )}
        </div>
      )}
      {chips.keySeat && (
        <Gloss id={glossIds.keySeat} open={gloss.isOpen("keySeat")}>
          {SHEET_WORDS.keySeatGloss}
        </Gloss>
      )}

      {/* A MINIMUM height, with the plate in flow at its foot: a long name with
          a long circle wraps to six lines at 272px, and a fixed window clipped
          the top of it under its own badge. Now the window grows instead, and
          the plate's top padding keeps the name clear of the badge. */}
      <div className="relative flex min-h-52 flex-col justify-end overflow-hidden rounded-xl bg-muted @min-[440px]:min-h-64 @min-[680px]:min-h-[300px]">
        <ArtWindowPicture view={view} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[3] rounded-xl ring-1 ring-inset ring-notice/50" />
        {!embedded && view.badge && (
          <div className="absolute left-2.5 top-2.5 z-[3]">
            <StateBadge badge={view.badge} seats={view.figures.find((f) => f.key === "places")?.value ?? 0} />
          </div>
        )}
        {/* The plate carries its own scrim, so a long name lifts the scrim with
            it. The scrim fades out across the top padding ONLY: its 90% stop
            sits 3rem below the plate's top, which is `pt-12`, so every line
            of the name and the chips sits on 90% card or more. A stop at a
            percentage of the plate's height put the first line of a
            three-line name over 39 to 62% card, under 4.5:1 on light art. */}
        <div className="relative z-[2] bg-[linear-gradient(to_top,var(--card)_0%,color-mix(in_srgb,var(--card)_90%,transparent)_calc(100%_-_3rem),transparent_100%)] px-3 pb-3 pt-12">
          {embedded ? (
            <p aria-hidden="true" className={nameClass}>
              {nameBody}
            </p>
          ) : (
            <h3 id={nameId} className={nameClass}>
              {nameBody}
            </h3>
          )}
          {(chips.suits || chips.speaksFor) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {chips.suits && (
                <GlossChip tone="suggestion" tag={SHEET_WORDS.suggestedTag} {...chip("suits")}>
                  Suits <span className="font-semibold text-foreground">{chips.suits.name}</span>
                </GlossChip>
              )}
              {chips.speaksFor && (
                <GlossChip tone="edge" {...chip("speaksFor")}>
                  {speaksForLabel(chips.speaksFor)}
                </GlossChip>
              )}
            </div>
          )}
          {chips.suits && (
            <Gloss id={glossIds.suits} open={gloss.isOpen("suits")}>
              {SHEET_WORDS.suitsGloss}
            </Gloss>
          )}
          {chips.speaksFor && (
            <Gloss id={glossIds.speaksFor} open={gloss.isOpen("speaksFor")}>
              {speaksForGloss(chips.speaksFor)}
            </Gloss>
          )}
        </div>
      </div>

      {view.aim ? (
        <p className="px-1 text-[13.5px] leading-relaxed text-foreground">
          <span className="mr-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-notice">{SHEET_WORDS.aimLabel}</span>
          {view.aim}
        </p>
      ) : (
        <p className="px-1 text-[13px] text-muted-foreground">{SHEET_WORDS.aimMissing}</p>
      )}

      <SeatFigures view={view} wide={false} />

      {view.stateLine && (
        <p className="flex items-start gap-1.5 px-1 text-[13px] leading-snug text-notice">
          <RotateCcw className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{view.stateLine}</span>
        </p>
      )}

      {action ? <div className="px-0.5 empty:hidden">{action}</div> : null}

      {view.mode === "seat" && (
        <SeatRoster
          spots={view.spots}
          moreOpenLine={view.moreOpenLine}
          rosterNote={view.rosterNote}
          onPickPerson={onPickPerson}
          headerAside={
            chips.recruiting ? (
              <GlossChip tone="open" icon={Sparkles} {...chip("recruiting")}>
                {SHEET_WORDS.recruiting}
              </GlossChip>
            ) : null
          }
          belowHeader={
            chips.recruiting ? (
              <Gloss id={glossIds.recruiting} open={gloss.isOpen("recruiting")}>
                {SHEET_WORDS.recruitingGloss}
              </Gloss>
            ) : null
          }
        />
      )}

      {!stacked && (
        <button
          ref={flipRef}
          type="button"
          onClick={onFlip}
          className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-notice/55 bg-muted px-3 py-2 text-left hover:border-notice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring @min-[680px]:hidden"
        >
          <span className="flex min-w-0 flex-1 flex-col leading-snug">
            <span className="font-display text-[17px] text-foreground">{view.flip.title}</span>
            <span className="text-[11.5px] text-muted-foreground">{view.flip.sub}</span>
          </span>
          <span aria-hidden="true" className="hidden gap-[5px] @min-[300px]:flex">
            {view.flip.pips.map((pip, i) => (
              <span key={i} className={`size-[7px] rotate-45 border ${PIP[pip]}`} />
            ))}
          </span>
          <RotateCcw className="size-[18px] shrink-0 text-notice" aria-hidden="true" />
        </button>
      )}
    </>
  );
}
