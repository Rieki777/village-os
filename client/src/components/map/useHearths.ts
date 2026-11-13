/**
 * Today's hearths for the circles map (Phase D, D2): `GET /api/map/hearths`,
 * read once when a signed-in member opens the map and again every few
 * minutes while it stays open, so lights gather as people arrive.
 *
 * A visitor, a failed read or an answer of the wrong shape all give null,
 * and null draws glow and threads with no lights: the map never shows a
 * light it was not told about.
 */
import { useEffect, useState } from "react";
import type { HearthsPayload, HearthToday } from "@shared/mapLight";
import { authToken, gameFetch } from "@/lib/gameApi";

/** How often an open map asks again. Lights gather slowly; this is calm on purpose. */
export const HEARTHS_REFRESH_MS = 5 * 60_000;

const isHearth = (h: any): h is HearthToday =>
  !!h && typeof h.circleId === "string" && typeof h.meetsToday === "boolean" && Number.isInteger(h.lights) && h.lights >= 0;

/** The payload if it is the shape this page draws, else null. */
export function readHearths(body: unknown): HearthsPayload | null {
  const b = body as any;
  if (!b || typeof b.day !== "string" || !Array.isArray(b.hearths) || typeof b.myLight !== "boolean") return null;
  if (!b.hearths.every(isHearth)) return null;
  return { day: b.day, hearths: b.hearths, myLight: b.myLight };
}

export function useHearths(on: boolean, viewerId: string | null): HearthsPayload | null {
  const [payload, setPayload] = useState<HearthsPayload | null>(null);
  useEffect(() => {
    if (!on || !viewerId || !authToken()) {
      setPayload(null);
      return;
    }
    let live = true;
    const read = () => {
      gameFetch("/api/map/hearths")
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { if (live) setPayload(readHearths(b)); })
        .catch(() => { if (live) setPayload(null); });
    };
    read();
    const t = window.setInterval(read, HEARTHS_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [on, viewerId]);
  return payload;
}
