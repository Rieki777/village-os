import { useEffect, useState } from "react";
import { VETO_HOURS_KEY } from "@shared/pageContent/governance";

/**
 * This village's steward veto window, in hours, as `/api/game/mechanics`
 * publishes it to anyone (`governance.veto_hours`).
 *
 * Undefined while asking. Null when the answer could not be read, which the
 * caller words as "at least" the floor: the floor is the one length that is
 * true of every village, and a guessed exact number is not.
 */
export function useVetoHours(): number | null | undefined {
  const [hours, setHours] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch("/api/game/mechanics")
      .then((r) => (r.ok ? r.json() : null))
      .then((snapshot) => {
        const variables: unknown[] = Array.isArray(snapshot?.variables) ? snapshot.variables : [];
        const row = variables.find((v: any) => v?.key === VETO_HOURS_KEY) as { parsed?: unknown; value?: unknown } | undefined;
        const raw = row?.parsed ?? row?.value;
        const n = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
        if (alive) setHours(Number.isFinite(n) ? n : null);
      })
      .catch(() => {
        if (alive) setHours(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return hours;
}
