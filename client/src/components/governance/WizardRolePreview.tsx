/**
 * THE ROLE YOU PICKED, LIVE, BESIDE THE QUESTION THAT PICKED IT.
 *
 * Three proposal types ask the village to put somebody or something into a
 * role with powers (`role_seat`, `power_transfer`, `power_grant`), and until
 * now the wizard showed that role as a name in a select. This draws it as the
 * permission face of the role card (`PermissionRoleCard`): what it does, its
 * places and who sits in them, the powers it already carries and the rung it
 * asks for. That is what the vote will be about, so the author reads it
 * before they write a word of the reason.
 *
 * The list comes from `loadPermissionRoles` in `./pickSources`, the same
 * loader the picker reads, so picking a role and seeing it cost one request
 * and the two cannot disagree. The village's stages and its word for a role
 * are read here, in the wizard's own tree, and handed to the card, which
 * imports nothing from `@/lib/gameApi`.
 *
 * Nothing renders until a role is picked and found: no skeleton that looks
 * like a role, and no card for an id the list does not hold.
 */
import { useEffect, useId, useState } from "react";
import { authToken, useGameConfig, useRoleWord } from "@/lib/gameApi";
import { SHEET_WORDS } from "@shared/roleSheet";
import { fromPermissionRole } from "@shared/roleSheetInputs";
import PermissionRoleCard from "@/components/power/PermissionRoleCard";
import { loadPermissionRoles } from "./pickSources";

/** `/api/roles` through the shared loader. Null while unread, when it cannot be had, or while `enabled` is false. */
export function usePermissionRoles(enabled = true): any[] | null {
  const [roles, setRoles] = useState<any[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadPermissionRoles().then((list) => {
      if (alive) setRoles(list);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return enabled ? roles : null;
}

export default function WizardRolePreview({
  roleId,
  look,
}: {
  roleId: string;
  /** `rail`: the desktop column beside the steps. `inline`: under the fields on a phone. */
  look: "rail" | "inline";
}) {
  const roles = usePermissionRoles();
  const config = useGameConfig();
  const roleWord = useRoleWord();
  const headId = `${useId().replace(/[^a-zA-Z0-9]/g, "")}-preview`;
  const role = roles?.find((r) => String(r?.id ?? "") === roleId) ?? null;
  if (!role) return null;
  // Null while the config is unread: the card then draws no ladder and names
  // the rung by its id, never a ladder of somebody else's stages.
  const stages = Array.isArray(config?.stages) ? config.stages.map((s) => ({ id: s.id, name: s.name })) : null;

  return (
    <section aria-labelledby={headId} className={look === "rail" ? "mt-6" : ""}>
      <p
        id={headId}
        className="sheet-night inline-flex items-center gap-2 rounded-full bg-card px-3 py-1 text-xs font-semibold text-foreground"
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-open" />
        {SHEET_WORDS.livePreview}
      </p>
      <p className="mt-1.5 text-xs text-stone-600">{SHEET_WORDS.livePreviewSub}</p>
      <div className="mt-3">
        <PermissionRoleCard
          input={fromPermissionRole(role, { signedIn: !!authToken() })}
          ctx={{ stages, roleWord: roleWord.name, now: new Date() }}
        />
      </div>
    </section>
  );
}
