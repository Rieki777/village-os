/**
 * The signed-in member's time zone (role journey L6): their saved choice, else
 * the browser's. Other screens (the open form, the interview pages) reuse
 * this hook and `effectiveTimeZone` rather than reading the browser themselves.
 */
import { useCallback, useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { browserTimeZone, effectiveTimeZone, normalizeTimeZone } from "@shared/memberTimeZone";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

export function useMyTimeZone(): {
  /** What the member saved, or null. */
  saved: string | null;
  /** What to use: saved, else browser, else UTC. */
  zone: string;
  loaded: boolean;
  save: (zone: string | null) => Promise<boolean>;
} {
  const [saved, setSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/me/time-zone", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setSaved(normalizeTimeZone(d?.timeZone)); })
      .catch(() => {})
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);
  const save = useCallback(async (zone: string | null) => {
    try {
      const r = await fetch("/api/me/time-zone", { method: "PUT", headers: headers(), body: JSON.stringify({ timeZone: zone }) });
      if (!r.ok) return false;
      const d = await r.json();
      setSaved(normalizeTimeZone(d?.timeZone));
      return true;
    } catch { return false; }
  }, []);
  return { saved, zone: effectiveTimeZone(saved, browserTimeZone()), loaded, save };
}
