/**
 * THE END-OF-MOON REVIEW'S SETTINGS ON THE CASH PAYOUTS DESK (decision 22).
 *
 * Three tabs, one document each: Payers, Village settings and Moon rhythm.
 * Loaded as its own lazy chunk from CashPayoutsTab, so the desk's first page
 * carries none of it. Each editor asks its own door and renders nothing when
 * the moon review module is off (the door answers 404), and the server's
 * refusal when the account does not hold the cash power.
 *
 * Light-only, like the rest of this folder.
 */
import { useState } from "react";
import { ADMIN_WORDS } from "@shared/moonRecap";
import PayersEditor from "./PayersEditor";
import VillageSettingsEditor from "./VillageSettingsEditor";
import RhythmEditor from "./RhythmEditor";

type Tab = keyof typeof ADMIN_WORDS.tabs;
const TABS: readonly Tab[] = ["payers", "settings", "rhythm"];

export default function MoonReviewSettingsPanel({ password }: { password: string }) {
  const [tab, setTab] = useState<Tab>("payers");
  return (
    <section aria-label={ADMIN_WORDS.heading} className="space-y-4 border-t border-border pt-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{ADMIN_WORDS.heading}</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{ADMIN_WORDS.intro}</p>
      </div>
      <div role="tablist" aria-label={ADMIN_WORDS.heading} className="flex w-fit rounded-lg border border-border bg-white p-0.5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-teal-deep text-white" : "text-foreground"}`}
          >
            {ADMIN_WORDS.tabs[t]}
          </button>
        ))}
      </div>
      {tab === "payers" && <PayersEditor password={password} />}
      {tab === "settings" && <VillageSettingsEditor password={password} />}
      {tab === "rhythm" && <RhythmEditor password={password} />}
    </section>
  );
}
