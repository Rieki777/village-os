/**
 * THE CANVAS MOON CARD on the Canvas view (plan 4.4; Wave 4, 2026-09-28).
 *
 * The next new moon, and the blocks its question names: the block the
 * village's season chose to grow, plus any block a key moment flagged, or one
 * block in canvas order when there is neither. Block titles only, the same
 * line the weekly brief and the moon digest print (`canvasMoonLine`).
 *
 * For whoever manages the calendar, one offer: a canvas moon gathering that
 * recurs every new moon. It is OFFERED and never seeded. Pressing it puts a
 * DRAFT on the calendar's list, and they publish it from this card once its
 * place and time suit the village. The network lives in CanvasView, as the
 * season's does; this card is handed its payload and one function.
 *
 * Light only, by ruling. No count, no percentage and no "so many of" here,
 * like every file in this directory (client/src/lib/canvasCopy.test.ts).
 */
import { useState } from "react";
import { Moon } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { canvasMoonLine, type CanvasMoonPayload } from "@shared/canvasRevisit";

export type MoonOfferAnswer = { ok: true; message: string } | { ok: false; error: string };

/** "Sat 10 Oct" in the reader's own words for the day. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function CanvasMoon({
  payload,
  onOffer,
  onPublish,
}: {
  payload: CanvasMoonPayload | null;
  onOffer: () => Promise<MoonOfferAnswer>;
  /** Publishes the offered draft. The card is the door for whoever manages events (W4-moon-publish-there). */
  onPublish?: (gatheringId: string) => Promise<MoonOfferAnswer>;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<MoonOfferAnswer | null>(null);
  const next = payload?.next ?? null;
  if (!next) return null;

  const line = canvasMoonLine(next.blocks.map((b) => b.name));
  const day = dayLabel(next.startsAt);
  const offer = async () => {
    setBusy(true);
    setAnswer(await onOffer());
    setBusy(false);
  };
  const draftId = payload?.gathering?.status === "draft" ? payload.gathering.id : null;
  const publish = async () => {
    if (!draftId || !onPublish) return;
    setBusy(true);
    setAnswer(await onPublish(draftId));
    setBusy(false);
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5" data-testid="canvas-moon" aria-labelledby="canvas-moon-heading">
      <h3 id="canvas-moon-heading" className="flex items-center gap-2 font-display text-lg font-bold text-stone-900">
        <Moon className="h-5 w-5 text-teal-deep" aria-hidden="true" />
        <Trans context="heading of the canvas moon card">The canvas moon</Trans>
      </h3>
      {day && (
        <p className="mt-1 text-sm text-stone-700">
          <Trans>Next new moon: {day}.</Trans>
        </p>
      )}
      {line && <p className="mt-2 text-stone-900">{line}</p>}
      <p className="flex flex-wrap gap-1.5 mt-2">
        {next.blocks.map((b) => (
          <a
            key={b.id}
            href={`#canvas-block-${b.id}`}
            className="text-xs font-medium rounded-full px-2.5 py-1 border border-teal-deep text-teal-deep hover:bg-stone-50"
          >
            {b.name}
          </a>
        ))}
      </p>
      <p className="mt-2 text-xs text-stone-600 leading-relaxed">
        <Trans>
          Each new moon the village looks again at the block its season chose to grow and at any block a key moment
          flagged. With neither, the blocks take turns in canvas order.
        </Trans>
      </p>

      {payload?.gathering && (
        <p className="mt-3 text-sm text-stone-700" data-testid="canvas-moon-gathering">
          {payload.gathering.status === "draft"
            ? t`A canvas moon gathering is on the calendar's list as a draft. It reaches the calendar once somebody who manages events publishes it.`
            : t`The canvas moon is on the village calendar.`}
        </p>
      )}

      {payload?.mayOffer && !answer?.ok && (
        <div className="mt-3">
          <button
            type="button"
            onClick={offer}
            disabled={busy}
            className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
          >
            {busy ? t({ message: "Offering", context: "a canvas moon gathering is being offered" }) : t`Offer a canvas moon gathering`}
          </button>
          <p className="mt-1.5 text-xs text-stone-600">
            <Trans>
              It goes on the calendar's list as a draft that recurs every new moon. Nothing is published until you publish it.
            </Trans>
          </p>
        </div>
      )}
      {payload?.mayPublish && draftId && onPublish && !answer?.ok && (
        <div className="mt-3">
          <button
            type="button"
            onClick={publish}
            disabled={busy}
            className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
          >
            {busy ? t({ message: "Publishing", context: "the canvas moon is being published" }) : t`Publish the canvas moon`}
          </button>
          <p className="mt-1.5 text-xs text-stone-600">
            <Trans>It goes on the village calendar for every member, recurring each new moon.</Trans>
          </p>
        </div>
      )}
      {answer?.ok && (
        <p role="status" className="mt-3 text-sm text-stone-900">
          {answer.message}
        </p>
      )}
      {answer && !answer.ok && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {answer.error}
        </p>
      )}
    </section>
  );
}
