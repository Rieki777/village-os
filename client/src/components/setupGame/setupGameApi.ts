/**
 * What the setup game reads and writes. It has no doors of its own beyond its
 * one read (`GET /api/admin/setup-game`): every planting goes through the
 * route the admin screens already use, so a key planted in the game is the
 * same key Integrations shows, and a domain laid here is the domain Comms
 * Settings checks. Every call names its path first, the way
 * scripts/check-admin-reach.mjs reads it.
 */
import { commsCall, type DomainPanel, type SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import { authToken } from "@/lib/gameApi";

/** A signed-in founder's own session is the credential. Never a shared password typed here. */
const me = (): string => authToken() ?? "";

export interface HandleState {
  store: "village-secret" | "env" | "dns" | "module-config" | "slot-to-build";
  name: string;
  planted: boolean | null;
  source?: "admin" | "env" | "none";
  last4?: string | null;
}

export interface SeedState {
  id: string;
  title: string;
  kind: string;
  provider: string;
  url: string | null;
  consequence: string;
  undo: string;
  cost: string;
  need: "required" | "recommended" | "optional";
  keystone: boolean;
  readPause: boolean;
  approval: "one-founder" | "co-sign-or-cooling-off";
  lifespan: string;
  bootstrap: boolean;
  dependsOn: string[];
  launchRequirement: string | null;
  liveStrength: "present" | "confirmed" | "alive";
  proves: string;
  byHand: string | null;
  handles: HandleState[];
  planted: "yes" | "partly" | "no" | "unknown";
}

export interface SetupGameMap {
  village: string;
  phase: "before-launch" | "after-launch";
  layers: Array<{ id: string; layer: string; title: string; seeds: string[] }>;
  modules: Array<{ id: string; name: string; group: string | null; setup: "none" | "optional" | "required"; lifecycle: string; core: boolean; seeds: string[] }>;
  seeds: Record<string, SeedState>;
}

export interface LaunchItem {
  id: string;
  title: string;
  why: string;
  severity: string;
  checkKey: string;
  fixAt: string;
  fixLabel: string;
  state: "ok" | "missing" | "partial";
  detail: string;
}

export interface LaunchAnswer {
  items: LaunchItem[];
  blockingOpen: number;
  readyToLaunch: boolean;
  launchedAt: string | null;
}

export const readMap = () => commsCall<SetupGameMap>("/admin/setup-game", me());
export const readLaunch = () => commsCall<LaunchAnswer>("/admin/launch", me());
export const readComms = () => commsCall<SettingsPayload>("/admin/comms/settings", me());
export const readDomain = () => commsCall<DomainPanel>("/admin/comms/settings/domain", me());

export const plantResendKey = (value: string) =>
  commsCall<{ success?: boolean }>("/admin/integrations/resend_api_key", me(), { method: "PUT", body: { value } });
export const addDomain = (name: string) =>
  commsCall<SettingsPayload>("/admin/comms/settings/domain", me(), { method: "POST", body: { name } });
export const verifyDomain = () => commsCall<SettingsPayload>("/admin/comms/settings/domain/verify", me(), { method: "POST" });
export const confirmDomain = (verified: boolean) =>
  commsCall<SettingsPayload>("/admin/comms/settings/domain/confirm", me(), { method: "POST", body: { verified } });
export const connectReports = () => commsCall<SettingsPayload>("/admin/comms/settings/webhook", me(), { method: "POST" });
export const pasteReportsSecret = (secret: string) =>
  commsCall<SettingsPayload>("/admin/comms/settings/webhook", me(), { method: "PUT", body: { secret } });
export const saveSender = (name: string, address: string) =>
  commsCall<SettingsPayload>("/admin/comms/settings/sender", me(), { method: "PUT", body: { name, address } });
export const savePostalAddress = (postalAddress: string) =>
  commsCall<SettingsPayload>("/admin/comms/settings", me(), { method: "PUT", body: { postalAddress } });
export const sendTestLetter = () => commsCall<SettingsPayload>("/admin/comms/settings/test", me(), { method: "POST" });
export const switchModule = (id: string, lifecycle: "members") =>
  commsCall<{ lifecycle?: string }>(`/admin/modules/${encodeURIComponent(id)}/lifecycle`, me(), { method: "PUT", body: { lifecycle } });

/** A refusal in the words the server gave, or the call site's own. */
export function said(data: unknown, fallback: string): string {
  const d = data as { message?: unknown; error?: unknown } | null;
  if (d && typeof d.message === "string" && d.message.trim()) return d.message;
  if (d && typeof d.error === "string" && d.error.trim() && d.error !== "auth_required") return d.error;
  return fallback;
}
