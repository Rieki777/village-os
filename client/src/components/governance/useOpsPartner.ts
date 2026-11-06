/**
 * The village's operations role, as the chart names it. A chart with none
 * gets the same sentence and no village's name.
 */
import { useEffect, useState } from "react";
import { operationsRoleName, opsPartner } from "@shared/roleProposalHonesty";
import { loadOrg } from "./pickSources";

export function useOpsPartner(): string {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOrg().then((org) => {
      if (!alive) return;
      const roles = Array.isArray(org?.roles) ? org.roles : [];
      setName(operationsRoleName(roles));
    });
    return () => {
      alive = false;
    };
  }, []);
  return opsPartner(name);
}
