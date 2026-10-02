/**
 * A SEAT, AS A CARD: the role card every surface that shows a seat draws.
 *
 * The map's seat panel and phone sheet, /roles, /circles and the /review
 * preview all hand this the same two things: a `SeatInput` (their payload,
 * read by `shared/roleSheetInputs.ts`) and a `SheetContext` (the clock, the
 * season and the village's class names). `seatSheet()` turns those into every
 * word and number the card prints, and the card draws exactly that. Nothing
 * here fetches, and nothing here imports `@/lib/gameApi`: two /review test
 * files mock that module down to `authToken`, and the card has to render
 * under them. The one part that does post (raising a hand, the contact relay)
 * is `SeatAction`, which the host passes in as the `action` slot.
 *
 * ── TWO FACES, ONE COLUMN AT A TIME, UNTIL THERE IS ROOM FOR BOTH ────────
 *
 * Narrow is the default and only `@min-[...]` container variants override it,
 * so there is no gap between two breakpoints for a width to fall into. Under
 * a 680px container the card shows one face and turns over (`data-face`);
 * from 680px it opens flat, front column on the left and the back on the
 * right, and the turn is gone. Reading order is visual order at every width:
 * two real columns, no `order` and no `display: contents`. The figure row is
 * drawn twice, once per column, and only one is ever displayed.
 *
 * The turn is a quarter turn out, the swap, a quarter turn in. Under reduced
 * motion it is the swap alone. Focus follows it (to the way back, or to the
 * bar that turned it), and the card's single polite live region says which
 * face is showing. That region is also where the action's status is heard.
 *
 * `faces="stacked"` (a proposal on /review) shows both columns at every width
 * with no turn, because a steward reading a draft wants all of it at once.
 * `embedded` (/roles) leaves out the eyebrow and the badge, which the row
 * header above already says, and labels the card by that header.
 *
 * `settings` is the slot for the Terms drawer that sits under the card's
 * bottom edge. Nothing passes it yet, so nothing renders: no dead control, and
 * nothing that would show a stranger a term they cannot read.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { motion, useAnimate } from "framer-motion";
import { SHEET_WORDS, seatSheet, type SeatInput, type SheetContext } from "@shared/roleSheet";
import { useGlossGroup } from "@/components/sheet/GlossChip";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import SeatCardFront from "./SeatCardFront";
import SeatCharter from "./SeatCharter";
import { SeatCardSlotContext } from "./seatCardSlot";

type Face = "front" | "back";

/**
 * The narrow hide and the wide show have equal specificity, so the wide one
 * wins only because Tailwind emits container-query variants later. The build
 * was checked for that order (`dist/public/assets/*.css`); if it ever flips,
 * the wide rule takes `!flex`.
 */
const FRONT_COLUMN =
  "flex flex-col gap-3 group-data-[face=back]/card:hidden @min-[680px]:group-data-[face=back]/card:flex";
const BACK_COLUMN =
  "flex flex-col gap-4 group-data-[face=front]/card:hidden @min-[680px]:group-data-[face=front]/card:flex";

/** An animation that cannot finish (a paused frame loop) must not strand the card mid-turn. */
function settle(p: { then: (onResolve: () => void, onReject?: () => void) => unknown }, ms = 600): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    p.then(done, done);
  });
}

export default function SeatTradingCard({
  input,
  ctx,
  action,
  settings,
  onPickPerson,
  embedded = false,
  labelledBy,
  faces = "flip",
  className = "",
}: {
  input: SeatInput;
  ctx: SheetContext;
  /** The host's action, normally `<SeatAction />`. It reads the card's view through context. */
  action?: ReactNode;
  /** The Terms drawer, built later. Renders nothing while absent. */
  settings?: ReactNode;
  /** A named holder's row becomes a button that filters to that person. */
  onPickPerson?: (holderKey: string, name: string | null) => void;
  /** /roles: no eyebrow and no badge; labelled by the row header. */
  embedded?: boolean;
  /** The id of the element that names the card when embedded. */
  labelledBy?: string;
  faces?: "flip" | "stacked";
  className?: string;
}) {
  const view = seatSheet(input, ctx);
  const stacked = faces === "stacked";
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const nameId = `${uid}-name`;
  const glossIds = {
    keySeat: `${uid}-gloss-key`,
    suits: `${uid}-gloss-suits`,
    speaksFor: `${uid}-gloss-speaks`,
    recruiting: `${uid}-gloss-recruiting`,
  };

  const [face, setFace] = useState<Face>("front");
  const [live, setLive] = useState("");
  const [openSignal, setOpenSignal] = useState(0);
  const gloss = useGlossGroup();
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLElement>();
  const flipRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"flip" | "back" | null>(null);
  const turning = useRef(false);

  // A different seat starts on its front with every gloss shut.
  const closeGloss = gloss.close;
  useEffect(() => {
    setFace("front");
    closeGloss();
  }, [view.id, closeGloss]);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "back" ? backRef : flipRef).current?.focus();
  }, [face]);

  /** Turn to `to`. `then: "action"` opens the front's action instead of focusing the bar. */
  const turn = useCallback(
    async (to: Face, then: "focus" | "action" = "focus") => {
      if (turning.current) return;
      turning.current = true;
      const el = scope.current;
      const moving = !reduced && !!el;
      try {
        if (moving) await settle(animate(el, { rotateY: 90, transformPerspective: 1200 }, { duration: 0.15, ease: "easeIn" }));
        focusNext.current = then === "focus" ? (to === "back" ? "back" : "flip") : null;
        setFace(to);
        setLive(to === "back" ? SHEET_WORDS.showingBack : SHEET_WORDS.showingFront);
        if (then === "action") setOpenSignal((n) => n + 1);
        if (moving) await settle(animate(el, { rotateY: [-90, 0], transformPerspective: 1200 }, { duration: 0.19, ease: "easeOut" }));
      } finally {
        turning.current = false;
      }
    },
    [animate, reduced, scope],
  );

  const shortcut =
    action && (view.action.kind === "raise" || view.action.kind === "signIn" || view.action.kind === "contact")
      ? view.action.kind
      : null;

  return (
    <SeatCardSlotContext.Provider value={{ seatId: view.id, action: view.action, openSignal, announce: setLive }}>
      {/* The container is this wrapper and never the article: a container
          query measures the content box, and the foil's 2px would make a
          680px host read as 676 and stay narrow. */}
      <div className="@container w-full">
        <article
          ref={scope}
          data-power-card=""
          data-face={stacked ? "front" : face}
          aria-labelledby={embedded ? labelledBy : nameId}
          className={`sheet-night seat-card-foil group/card relative w-full rounded-[20px] p-[2px] text-card-foreground ${className}`}
        >
          <div className="relative rounded-[18px] bg-[radial-gradient(130%_55%_at_50%_0%,var(--muted)_0%,var(--card)_62%)] p-2.5 after:pointer-events-none after:absolute after:inset-[5px] after:rounded-[14px] after:border after:border-notice/25 @min-[680px]:p-3.5">
            <div className="relative z-[1] flex flex-col gap-3 @min-[680px]:grid @min-[680px]:grid-cols-[260px_minmax(0,1fr)] @min-[680px]:items-start @min-[680px]:gap-6">
              {/* The profile's fade and rise, once: a new seat in the same card
                  does not re-run it. */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={stacked ? "flex flex-col gap-3" : FRONT_COLUMN}
              >
                <SeatCardFront
                  view={view}
                  glossIds={glossIds}
                  gloss={gloss}
                  nameId={nameId}
                  embedded={embedded}
                  stacked={stacked}
                  action={action}
                  onPickPerson={onPickPerson}
                  onFlip={() => void turn("back")}
                  flipRef={flipRef}
                />
              </motion.div>
              <div className={stacked ? "flex flex-col gap-4" : BACK_COLUMN}>
                <SeatCharter
                  view={view}
                  ids={{ commitments: `${uid}-commitments` }}
                  embedded={embedded}
                  stacked={stacked}
                  shortcut={shortcut}
                  onBack={() => void turn("front")}
                  onShortcut={() => void turn("front", "action")}
                  backRef={backRef}
                />
              </div>
            </div>
          </div>
          <p className="sr-only" aria-live="polite">
            {live}
          </p>
        </article>
        {settings ? (
          <div className="sheet-night relative z-0 mx-3.5 -mt-4 rounded-b-2xl border border-t-0 border-border bg-card px-3 pb-2 pt-6">
            {settings}
          </div>
        ) : null}
      </div>
    </SeatCardSlotContext.Provider>
  );
}
