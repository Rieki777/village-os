/**
 * WHERE EACH SEED STANDS, for the Journey and the field notes. Three readers,
 * in order of how much they prove:
 *
 *   1. The comms checklist, for the email seeds: the module's own live check,
 *      ending in a delivered test letter.
 *   2. The launch rows, for any seed the catalog ties to one
 *      (`launchRequirement`): the checks Journey to Launch already runs.
 *   3. The handles: whether the value is planted at all.
 *
 * Green ("alive") only ever comes from a reader that proves the seed works.
 * A value that is merely present reads "planted", and says it is not proven
 * yet (ruling of 2026-10-13: "green means a live check passed").
 */
import type { SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import type { LaunchItem, SeedState, SetupGameMap } from "./setupGameApi";

export type Light = "alive" | "planted" | "open" | "unknown";

export interface SeedLight {
  light: Light;
  detail: string;
  fixAt: string | null;
  fixLabel: string | null;
  /** True for the email seeds, which the Spring plot plays. */
  spring: boolean;
}

const EMAIL_SEEDS = new Set(["resend-account", "resend-setup-key", "resend-sending-domain", "resend-api-key", "resend-webhook-secret", "email-from"]);
/** The status word already says "planted, not proven", so the detail adds nothing. */
const NOT_PROVEN = "";

const itemDone = (c: SettingsPayload | null, key: string) => !!c?.checklist?.find((i) => i.key === key)?.done;

function fromComms(s: SeedState, c: SettingsPayload | null): SeedLight | null {
  if (!EMAIL_SEEDS.has(s.id) || !c) return null;
  const spring = { fixAt: null, fixLabel: null, spring: true };
  const delivered = itemDone(c, "test-email");
  switch (s.id) {
    case "resend-account":
      return itemDone(c, "api-key") ? { light: "planted", detail: "A key from this account is planted.", ...spring } : { light: "open", detail: "", ...spring };
    case "resend-setup-key":
      return { light: "unknown", detail: "The setup key that composts itself is not built yet. Today one key does both jobs.", ...spring };
    case "resend-api-key":
      if (delivered) return { light: "alive", detail: "A test letter sent with it was reported delivered.", ...spring };
      return itemDone(c, "api-key") ? { light: "planted", detail: NOT_PROVEN, ...spring } : { light: "open", detail: "", ...spring };
    case "resend-sending-domain":
      return itemDone(c, "domain")
        ? { light: "alive", detail: `${c.settings.domain} verified.`, ...spring }
        : { light: c.settings.domain ? "planted" : "open", detail: c.settings.domain ? `${c.settings.domain}: ${c.settings.domainStatus}.` : "No domain yet.", ...spring };
    case "resend-webhook-secret":
      if (itemDone(c, "delivery-reports") && c.webhook.lastReportAt) return { light: "alive", detail: "Reports are arriving.", ...spring };
      return itemDone(c, "delivery-reports") ? { light: "planted", detail: NOT_PROVEN, ...spring } : { light: "open", detail: "Not connected yet.", ...spring };
    case "email-from":
      if (itemDone(c, "sender") && delivered) return { light: "alive", detail: `${c.sender.line}, and a letter from it arrived.`, ...spring };
      return itemDone(c, "sender") ? { light: "planted", detail: c.sender.line, ...spring } : { light: "open", detail: "No sender yet.", ...spring };
  }
  return null;
}

export function seedLight(s: SeedState, launch: Map<string, LaunchItem>, comms: SettingsPayload | null): SeedLight {
  const c = fromComms(s, comms);
  if (c) return c;
  const row = s.launchRequirement ? launch.get(s.launchRequirement) : undefined;
  if (row) {
    const fix = { fixAt: row.fixAt || null, fixLabel: row.fixLabel || null, spring: false };
    if (row.state === "ok") return { light: s.liveStrength === "alive" ? "alive" : "planted", detail: row.detail || (s.liveStrength === "alive" ? "Checked live." : NOT_PROVEN), ...fix };
    if (row.state === "partial") return { light: "planted", detail: row.detail || NOT_PROVEN, ...fix };
    return { light: "open", detail: row.detail, ...fix };
  }
  const secretFix = s.handles.some((h) => h.store === "village-secret") ? "/admin?tab=integrations" : null;
  const base = { fixAt: secretFix, fixLabel: secretFix ? "Open Integrations" : null, spring: false };
  switch (s.planted) {
    case "yes":
      return { light: "planted", detail: s.bootstrap ? "Set on the hosting service." : NOT_PROVEN, ...base };
    case "partly":
      return { light: "planted", detail: "Partly planted.", ...base };
    case "no":
      return { light: "open", detail: s.bootstrap ? "Set it on the hosting service." : "", ...base };
    default:
      return { light: "unknown", detail: "Only a live check can tell, and none is wired here yet.", ...base };
  }
}

export const LAYER_ORDER = ["rhizosphere", "mycelium", "canopy", "water", "vines"];
export const LAYER_WORD: Record<string, string> = { rhizosphere: "Soil", mycelium: "Mycelium", canopy: "Canopy", water: "Water", vines: "Vines" };

export function orderedLayers(map: SetupGameMap) {
  return [...map.layers].sort((a, b) => {
    const ia = LAYER_ORDER.indexOf(a.layer);
    const ib = LAYER_ORDER.indexOf(b.layer);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/** A layer is established when nothing it needs (required or recommended) is still open. */
export function layerEstablished(seeds: string[], map: SetupGameMap, lightOf: (s: SeedState) => SeedLight): boolean {
  const needed = seeds.map((id) => map.seeds[id]).filter((s): s is SeedState => !!s && s.need !== "optional");
  return needed.length > 0 && needed.every((s) => lightOf(s).light !== "open");
}

/** The first thing a founder can plant next, in layer order. */
export function nextYes(map: SetupGameMap, lightOf: (s: SeedState) => SeedLight): SeedState | null {
  for (const layer of orderedLayers(map)) {
    for (const id of layer.seeds) {
      const s = map.seeds[id];
      if (s && s.need !== "optional" && lightOf(s).light === "open") return s;
    }
  }
  for (const m of map.modules) {
    if (m.lifecycle === "off") continue;
    for (const id of m.seeds) {
      const s = map.seeds[id];
      if (s && s.need !== "optional" && lightOf(s).light === "open") return s;
    }
  }
  return null;
}
