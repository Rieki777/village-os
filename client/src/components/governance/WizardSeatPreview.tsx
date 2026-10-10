/**
 * THE SEAT YOU PICKED, AS ITS CARD, WITH THE TERMS YOU ARE WRITING.
 *
 * The seat twin of WizardRolePreview. A proposal type that picks a seat from
 * the org chart (`source: "seats"`, today "Apply for a seat") shows that seat
 * as the live role card, both faces stacked the way /review shows a proposal,
 * with the Settings drawer open underneath it and fed by the answers as they
 * are typed. ProposalWizard chooses ONE preview by what was picked: a seat
 * gets this, a role with powers gets WizardRolePreview, never both.
 *
 * The seat comes from `loadOrg` in `./pickSources`, the same read the seat
 * picker made, so the card can never be a seat the picker did not offer.
 * Nothing renders until the seat is picked and found.
 *
 * The terms are parsed with the editor's own parser. Mid-edit terms that do
 * not parse yet leave the drawer saying so, instead of drawing half a term.
 */
import { useEffect, useId, useState } from "react";
import { useSeason } from "@/lib/gameApi";
import { SHEET_WORDS } from "@shared/roleSheet";
import { fromOrgSeat, seasonForSheet } from "@shared/roleSheetInputs";
import { parseSeatSettings } from "@shared/seatSettings";
import SeatTradingCard from "@/components/power/SeatTradingCard";
import SeatTermsDrawer from "@/components/power/SeatTermsDrawer";
import { loadOrg } from "./pickSources";
import { useVillagePresets } from "@/lib/seatPresetsRead";

/** `/api/org` through the shared loader. Null while unread, or when it cannot be had. */
function useOrg(): any | null {
  const [org, setOrg] = useState<any | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOrg().then((body) => {
      if (alive) setOrg(body);
    });
    return () => {
      alive = false;
    };
  }, []);
  return org;
}

export default function WizardSeatPreview({
  seatId,
  settings,
  look,
}: {
  seatId: string;
  /** The terms as the wizard holds them, valid or not yet. */
  settings: unknown;
  /** `rail`: the desktop column beside the steps. `inline`: under the fields on a phone. */
  look: "rail" | "inline";
}) {
  const org = useOrg();
  const season = useSeason();
  const villagePresets = useVillagePresets();
  const headId = `${useId().replace(/[^a-zA-Z0-9]/g, "")}-preview`;
  const roles: any[] = Array.isArray(org?.roles) ? org.roles : [];
  const row = roles.find((r) => String(r?.id ?? "") === seatId) ?? null;
  if (!row) return null;

  const input = { ...fromOrgSeat(row, org?.circles, org?.people, org?.village), mode: "proposal" as const };
  const parsed = settings === undefined ? null : parseSeatSettings(settings);

  return (
    <section aria-labelledby={headId} className={look === "rail" ? "mt-6" : ""} data-wizard-seat-preview="">
      <p
        id={headId}
        className="sheet-night inline-flex items-center gap-2 rounded-full bg-card px-3 py-1 text-xs font-semibold text-foreground"
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-open" />
        {SHEET_WORDS.livePreview}
      </p>
      <p className="mt-1.5 text-xs text-stone-600">{SHEET_WORDS.livePreviewSub}</p>
      <div className="mt-3">
        <SeatTradingCard
          input={input}
          ctx={{ now: new Date(), season: seasonForSheet(season), classNames: null }}
          faces="stacked"
          settings={
            parsed ? (
              <SeatTermsDrawer
                settings={parsed.ok ? parsed.settings : null}
                unreadable={!parsed.ok}
                villagePresets={villagePresets}
                defaultOpen
              />
            ) : undefined
          }
        />
      </div>
    </section>
  );
}
