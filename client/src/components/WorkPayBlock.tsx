/**
 * WHAT A QUEST OR A ROLE PAYS, ON ITS CARD (0265, Rye 2026-10-21).
 *
 * Every token assigned to the work, by its live name, or "Inquire for payment
 * details" when nothing is known. The value leads, in the village's currency,
 * with the same value converted for the viewer beside it. The figures are the
 * server's (`pay` on `/api/quests` and on a role at the terms tier), worked out
 * by the function the consent and the settlement pay from, so this renders and
 * decides nothing.
 *
 * Voice and badges (Rye, 2026-10-30: each quest and role shows its full pay,
 * cash, tokens, Voice and badge, before you take it on): a Voice line is a
 * token line, named for what it is on the full block, and a badge that
 * multiplies one of the lines is named beside it, never folded into the figure.
 *
 * `pay` ABSENT draws nothing: an older server, or a role payload below the
 * terms tier, where a reader may not know what a role pays.
 */
import { Award, Coins, HandCoins } from "lucide-react";
import type { WorkPay } from "@shared/workValue";
import {
  agreementCashWords,
  badgeWords,
  cashPayWords,
  lineWords,
  linesWords,
  payHeadline,
  useDisplayRates,
  valueWords,
  voiceNames,
} from "@/lib/workPay";

export default function WorkPayBlock({
  pay,
  variant = "card",
}: {
  pay: WorkPay | null | undefined;
  /** `card` is the compact chip a board shows; `full` is the detail page's paragraph. */
  variant?: "card" | "full";
}) {
  const rates = useDisplayRates();
  if (!pay) return null;
  const headline = payHeadline(pay);
  const value = pay.value ? valueWords(pay.value, rates) : null;
  const cash = agreementCashWords(pay);
  // 0285: the cash the work itself pays, which the village owes and records.
  const ownCash = cashPayWords(pay, rates);
  const every = pay.cadence === "cycle" ? " each cycle" : "";
  const badges = pay.badges ?? [];
  const voices = voiceNames(pay);

  if (variant === "card") {
    if (headline === "inquire") {
      return (
        <span data-work-pay="inquire" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
          <HandCoins className="w-3.5 h-3.5" aria-hidden="true" />
          Inquire for payment details
        </span>
      );
    }
    return (
      <span data-work-pay={headline} className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold">
        <Coins className="w-3.5 h-3.5" aria-hidden="true" />
        {value && (
          <span>
            {value.own}
            {value.converted && <span className="font-normal opacity-80"> ({value.converted})</span>}
          </span>
        )}
        {(pay.lines.length > 0 || ownCash) && (
          <span className={value ? "font-normal" : undefined}>
            {value ? "paid as " : ""}
            {[ownCash?.own, pay.lines.length > 0 ? linesWords(pay.lines) : null].filter(Boolean).join(", ")}
            {every}
          </span>
        )}
        {badges.length > 0 && (
          <span data-work-pay-badges="" className="inline-flex items-center gap-1 font-normal">
            <Award className="w-3.5 h-3.5" aria-hidden="true" />
            {badges.map(badgeWords).join(", ")}
          </span>
        )}
      </span>
    );
  }

  return (
    <div data-work-pay={headline} className="space-y-1.5 text-sm">
      {headline === "inquire" ? (
        <p className="text-muted-foreground">
          <HandCoins className="inline w-4 h-4 mr-1 align-text-bottom" aria-hidden="true" />
          Inquire for payment details. A steward has not set what this pays yet.
        </p>
      ) : (
        <>
          {value ? (
            <p className="font-semibold text-foreground">
              Worth {value.own}
              {value.converted && <span className="font-normal text-muted-foreground"> ({value.converted})</span>}
            </p>
          ) : (
            <p className="text-muted-foreground">No value set yet. Inquire for the full payment details.</p>
          )}
          {pay.lines.length > 0 || ownCash ? (
            <p className="text-foreground">
              Paid{every} as{" "}
              {ownCash && (
                <span className="font-semibold">
                  {ownCash.own}
                  {ownCash.converted && <span className="font-normal text-muted-foreground"> ({ownCash.converted})</span>}
                </span>
              )}
              {pay.lines.map((l, i) => (
                <span key={l.token}>
                  {(i > 0 || ownCash) && ", "}
                  <span className="font-semibold">{lineWords(l)}</span>
                </span>
              ))}
              .
            </p>
          ) : (
            value && <p className="text-muted-foreground">Paid in no tokens on this platform. Inquire for payment details.</p>
          )}
          {ownCash && (
            <p className="text-xs text-muted-foreground">The village pays the cash itself, and keeps a record of what it owes you on your profile.</p>
          )}
          {pay.source === "standard" && pay.lines.length > 0 && (
            <p className="text-xs text-muted-foreground">These are the village&apos;s standard amounts.</p>
          )}
          {cash && <p className="text-foreground">Plus {cash} in cash, per the role agreement.</p>}
          {voices.length > 0 && (
            <p data-work-pay-voice="" className="text-xs text-muted-foreground">
              {voices.join(" and ")} is your say in the village&apos;s decisions.
            </p>
          )}
          {badges.length > 0 && (
            <ul data-work-pay-badges="" className="space-y-0.5">
              {badges.map((b) => (
                <li key={`${b.badge}:${b.token}`} className="text-foreground">
                  <Award className="inline w-4 h-4 mr-1 align-text-bottom text-primary" aria-hidden="true" />
                  {badgeWords(b)}.
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
