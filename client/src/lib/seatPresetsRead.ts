/**
 * THE VILLAGE'S OWN SEAT PRESETS, ONE READ SHARED BY EVERY ASKER.
 *
 * `GET /api/seat-presets` answers a reader holding `terms.read` and nobody
 * else. Three surfaces read it: the Settings drawer on a live seat card (to
 * name the preset a group started from), the wizard's terms editor (to offer
 * the village's presets after the platform's) and the admin org chart. One
 * cached read per session, asked again after a minute, and a refused or failed
 * read is an empty list, so a drawer simply names no village preset.
 *
 * Only a surface that already holds terms asks, so a visitor's page never
 * makes this request at all.
 */
import { useEffect, useState } from "react";
import type { SeatPreset } from "@shared/seatPresets";
import { villagePresetsFrom } from "@shared/seatTermsOffer";
import { authToken } from "./gameApi";

const FRESH_MS = 60_000;
let read: { token: string | null; at: number; list: Promise<SeatPreset[]> } | null = null;

export function loadVillagePresets(): Promise<SeatPreset[]> {
  const token = authToken();
  if (!token) return Promise.resolve([]);
  if (!read || read.token !== token || Date.now() - read.at > FRESH_MS) {
    const entry = {
      token,
      at: Date.now(),
      list: fetch("/api/seat-presets", { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => (res.ok ? villagePresetsFrom(await res.json()) : []))
        .catch(() => [] as SeatPreset[]),
    };
    read = entry;
  }
  return read.list;
}

/** Forget the cached read, after a founder saves the library. */
export function forgetVillagePresets(): void {
  read = null;
}

/** The village's presets, or an empty list until they arrive. `enabled: false` asks nothing. */
export function useVillagePresets(enabled = true): readonly SeatPreset[] {
  const [presets, setPresets] = useState<readonly SeatPreset[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadVillagePresets().then((list) => {
      if (alive) setPresets(list);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return presets;
}
