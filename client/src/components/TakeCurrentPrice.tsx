/**
 * THE WORKER TAKES THE QUEST'S NEW PRICE (valuation spec C8; quest re-price Q3).
 *
 * A claim keeps the price it was taken at (0342). When the Treasurer re-prices
 * a quest someone is already doing, only that person's agreement moves their
 * claim to the new price. This is where they give it: shown on their own open
 * claim when its kept terms differ from the quest's terms now. The pricing
 * desk links here (`#take-current-price`).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import type { QuestClaim } from "@/lib/gameApi";
import { gameFetch } from "@/lib/gameApi";
import type { BoardQuest } from "@/lib/questBoard";

const tokensKey = (list: { token: string; amount: number }[] | null | undefined) =>
  JSON.stringify((list ?? null) && [...(list ?? [])].sort((a, b) => a.token.localeCompare(b.token)));

/** Whether an open claim kept terms the quest no longer offers. */
export function claimPriceDiffers(claim: QuestClaim | undefined, quest: BoardQuest): boolean {
  const kept = claim?.payTerms;
  if (!claim || !kept || (claim.status !== "claimed" && claim.status !== "submitted")) return false;
  return (
    (kept.valueMinor ?? null) !== (quest.valueMinor ?? null) ||
    (kept.cashMinor ?? null) !== (quest.cashMinor ?? null) ||
    tokensKey(kept.valueTokens) !== tokensKey(quest.valueTokens)
  );
}

export default function TakeCurrentPrice({ claim, quest, onTaken }: { claim: QuestClaim | undefined; quest: BoardQuest; onTaken: () => void }) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  if (!claimPriceDiffers(claim, quest)) return null;
  const take = async () => {
    setBusy(true);
    const r = await gameFetch(`/api/game/quest-claims/${encodeURIComponent(claim!.id)}/take-current-price`, { method: "POST" });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(body?.error ?? t`The new price was not taken.`);
    toast.success(t`Your claim now pays the quest's new price.`);
    onTaken();
  };
  return (
    <div id="take-current-price" className="mx-6 mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <p className="font-semibold"><Trans>This quest has a new price.</Trans></p>
      <p className="mt-1"><Trans>You took it on at its earlier price, and your claim keeps that one unless you choose the new price shown above.</Trans></p>
      <button className="mt-3 rounded-lg bg-blue-800 px-3 py-2 font-semibold text-white min-h-[40px] disabled:opacity-50" disabled={busy} onClick={() => void take()}>
        <Trans>Take the new price</Trans>
      </button>
    </div>
  );
}
