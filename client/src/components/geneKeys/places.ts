/**
 * The birth-town list, parsed and searched on the member's own device.
 *
 * A birth town only sets the clock: it names the time zone the local birth
 * time is read in. The list comes from `GET /api/gene-keys/places` once and is
 * searched here, so what a member types never leaves their browser. Format:
 * scripts/gen-gene-keys-places.mjs. Line endings are read either way, because
 * a Windows checkout may hand the file back with CRLF.
 */
import { readPlacesText } from "@/lib/geneKeysApi";

export interface Place {
  name: string;
  /** Lower case, accents folded, for matching. */
  key: string;
  country: string;
  zone: string;
}

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function parsePlaces(text: string): Place[] {
  const lines = text.split(/\r?\n/);
  let i = lines[0]?.startsWith("#") ? 1 : 0;
  const zones: string[] = [];
  for (; i < lines.length && lines[i] !== ""; i++) zones.push(lines[i]);
  const out: Place[] = [];
  for (i += 1; i < lines.length; i++) {
    const [name, ascii, country, z] = lines[i].split("\t");
    const zone = zones[parseInt(z ?? "", 36)];
    if (!name || !zone) continue;
    out.push({ name, key: fold(ascii || name), country, zone });
  }
  return out;
}

let loading: Promise<Place[]> | null = null;

/** The list, read once per page load and shared by every caller. */
export function loadPlaces(): Promise<Place[]> {
  loading ??= readPlacesText().then(parsePlaces).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Up to `max` towns whose name, or a word in it, starts with what was typed. Biggest first. */
export function searchPlaces(places: Place[], typed: string, max = 6): Place[] {
  const k = fold(typed.trim());
  if (k.length < 2) return [];
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const p of places) {
    if (out.length >= max) break;
    if (p.key.startsWith(k) || p.key.includes(` ${k}`)) {
      const id = `${p.name}|${p.country}|${p.zone}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(p);
      }
    }
  }
  return out;
}

let regions: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

const zoneWords = new Map<string, string>();
/** "Mountain Time", or the zone's own city when the browser has no name for it. */
export function zoneName(zone: string): string {
  const known = zoneWords.get(zone);
  if (known) return known;
  let label = `${zone.split("/").pop()?.replace(/_/g, " ") ?? zone} time`;
  try {
    const part = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    if (part && !part.value.startsWith("GMT")) label = part.value;
  } catch {
    // An unknown zone keeps the city label.
  }
  zoneWords.set(zone, label);
  return label;
}
