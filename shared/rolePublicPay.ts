/**
 * THE PUBLIC PAY RANGE (role journey PR-C, the 20 Oct ruling: money is public
 * but not the first thing seen).
 *
 * For a listed open role the card's settings section, below the role, shows the
 * pay group's kind, range, currency, period and note to everyone. Nothing else
 * from the terms on offer leaves `terms.read`: not the term, the clocks, the
 * rhythm, the allowance, the bonus, the quests, the scoreboard or the ending.
 * `publicPayOf` copies five named keys and nothing else, so a key added to the
 * pay group later does not leave by itself.
 */
import { settingsWords, type PaySettings, type SeatSettings } from "./seatSettings";

/** The only keys that ever leave the terms for a visitor. */
export const PUBLIC_PAY_KEYS = ["kind", "currency", "amountMinor", "minMinor", "maxMinor", "per", "note"] as const;

export type PublicPay = Pick<PaySettings, (typeof PUBLIC_PAY_KEYS)[number]>;

/** The pay group of a parsed offer, cut to the public keys, or null when the offer writes none. */
export function publicPayOf(settings: SeatSettings | null | undefined): PublicPay | null {
  const pay = settings?.pay;
  if (!pay || typeof pay !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_PAY_KEYS) {
    const v = (pay as unknown as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return typeof out.kind === "string" ? (out as unknown as PublicPay) : null;
}

/** Whether the pay group states an amount or a range, which a paid role needs on offer. */
export function payStatesRange(pay: PublicPay | null | undefined): boolean {
  if (!pay) return false;
  if (pay.kind === "fixed") return pay.amountMinor !== undefined;
  if (pay.kind === "range") return pay.minMinor !== undefined && pay.maxMinor !== undefined;
  return false;
}

/** The pay in words, from the same function the terms drawer uses, so the two cannot differ. */
export function publicPayWords(pay: PublicPay, locale = "en-GB"): { headline: string; lines: string[] } {
  const row = settingsWords({ pay } as unknown as SeatSettings, { locale }).find((r) => r.group === "pay");
  return { headline: row?.headline ?? "", lines: row?.lines ?? [] };
}
