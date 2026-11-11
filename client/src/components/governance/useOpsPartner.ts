/**
 * The role an open terms row is filled with: the role the village names to
 * welcome people (`org.onboarding_role`, the role that sends first replies to
 * applicants), read by its id from the village's public dials and named from
 * the chart. Never picked by a word in a role's name: "Operations" in a title
 * named a conversation role as the partner (verify report B4). A village that
 * names none gets the same sentence and no name.
 */
import { useEffect, useState } from "react";
import { onboardingRoleName, opsPartner } from "@shared/roleProposalHonesty";
import { loadOrg } from "./pickSources";

/** The dial's key, as `/api/game/mechanics` lists it. */
export const ONBOARDING_ROLE_KEY = "org.onboarding_role";

let dialOnce: Promise<string> | null = null;

/** The village's onboarding role id, read once per page load. Empty when unread or unset. */
export function loadOnboardingRoleId(): Promise<string> {
  if (!dialOnce) {
    dialOnce = fetch("/api/game/mechanics", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: any) => {
        const row = Array.isArray(body?.variables) ? body.variables.find((v: any) => v?.key === ONBOARDING_ROLE_KEY) : null;
        return typeof row?.value === "string" ? row.value.trim() : "";
      })
      .catch(() => "");
  }
  return dialOnce;
}

/** Tests start each case from an unread dial. */
export function resetOnboardingRoleRead(): void {
  dialOnce = null;
}

export function useOpsPartner(): string {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([loadOrg(), loadOnboardingRoleId()]).then(([org, id]) => {
      if (!alive) return;
      const roles = Array.isArray(org?.roles) ? org.roles : [];
      setName(onboardingRoleName(roles, id));
    });
    return () => {
      alive = false;
    };
  }, []);
  return opsPartner(name);
}
