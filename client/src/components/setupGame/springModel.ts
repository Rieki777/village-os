/**
 * THE SPRING PLOT'S STATE, read off the comms module's own checklist.
 *
 * Nothing here decides that a step is done. The comms setup checklist does
 * (`buildChecklist` in server/lib/comms/setup.ts, items 1 to 5 and 13), the
 * same checklist Comms Settings opens with, so the game and the admin screen
 * can never disagree. The one step the checklist cannot see is the account at
 * Resend itself; a planted key proves it, and before that the founder's own
 * tick stands in, kept only in this browser.
 */
import type { DomainPanel, SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import { keyIsSendOnly } from "@shared/comms/settings";

export type BeatId = "account" | "key" | "stones" | "reports" | "sign" | "nursery" | "transplant" | "trade";

export interface Beat {
  id: BeatId;
  n: number;
  /** The banner's word. */
  short: string;
  done: boolean;
  keystone: boolean;
}

export const BEAT_ORDER: readonly BeatId[] = ["account", "key", "stones", "reports", "sign", "nursery", "transplant", "trade"];

const SHORT: Record<BeatId, string> = {
  account: "Account",
  key: "Key",
  stones: "Stones",
  reports: "Reports",
  sign: "Signature",
  nursery: "Nursery",
  transplant: "Transplant",
  trade: "Trade",
};

/**
 * THE LAST PLANTING: the full-access key the setup needed traded for one that
 * can only send, and only from the village's domain (the catalog's
 * `resend-api-key` seed). Done when Resend said THIS key may only send, so a
 * key pasted afterwards through any door reads as not yet asked.
 */
export const keyTraded = (p: SettingsPayload | null): boolean => !!p && keyIsSendOnly(p.settings, p.key);

const itemDone = (p: SettingsPayload | null, key: string): boolean => !!p?.checklist?.find((i) => i.key === key)?.done;

export const commsIsOn = (p: SettingsPayload | null): boolean => p?.lifecycle === "members" || p?.lifecycle === "public";

export function springBeats(p: SettingsPayload | null, local: { account: boolean }): { beats: Beat[]; current: BeatId | "done" } {
  const done: Record<BeatId, boolean> = {
    account: local.account || itemDone(p, "api-key"),
    key: itemDone(p, "api-key"),
    stones: itemDone(p, "domain"),
    reports: itemDone(p, "delivery-reports"),
    sign: itemDone(p, "sender") && itemDone(p, "postal-address"),
    nursery: itemDone(p, "test-email"),
    transplant: commsIsOn(p),
    trade: keyTraded(p),
  };
  const beats = BEAT_ORDER.map((id, i) => ({ id, n: i + 1, short: SHORT[id], done: done[id], keystone: id === "transplant" || id === "trade" }));
  const open = beats.find((b) => !b.done);
  return { beats, current: open ? open.id : "done" };
}

/** The DNS weather: how many of the provider's records it has seen, while the domain waits. */
export function stoneWeather(p: SettingsPayload | null, d: DomainPanel | null): { storm: boolean; seen: number; total: number } {
  if (!p?.settings?.domain || itemDone(p, "domain")) return { storm: false, seen: 0, total: 0 };
  const records = d?.records ?? [];
  const seen = records.filter((r) => /verified|valid/i.test(String(r.status))).length;
  return { storm: true, seen, total: records.length };
}

/** A suggestion for the sending domain: the domain the founders' own addresses already use. */
export function suggestedDomain(p: SettingsPayload | null): string {
  const pool = [p?.me?.email ?? "", ...(p?.admins ?? [])];
  for (const a of pool) {
    const at = a.lastIndexOf("@");
    const host = at > 0 ? a.slice(at + 1).trim().toLowerCase() : "";
    if (host && !/^(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton|protonmail)\./.test(host)) return host;
  }
  return "";
}

export interface JournalLine {
  at: number;
  text: string;
}

/** The forest journal for this plot, from what the server recorded. Never invented. */
export function springJournal(p: SettingsPayload | null): JournalLine[] {
  if (!p) return [];
  const lines: JournalLine[] = [];
  const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
  if (p.key.configured && p.key.setAt) {
    lines.push({ at: t(p.key.setAt), text: `Sending key planted in the root cellar${p.key.setBy ? ` by ${p.key.setBy}` : ""}, ending ${p.key.last4 ?? "????"}.` });
  }
  const s = p.settings;
  if (s.domain && s.domainCheckedAt) {
    lines.push({
      at: t(s.domainCheckedAt),
      text: s.domainStatus === "verified"
        ? `${s.domain} verified${s.domainConfirmedBy ? `, confirmed by ${s.domainConfirmedBy}` : " by Resend"}.`
        : `${s.domain} checked with Resend: ${s.domainStatus ?? "waiting"}.`,
    });
  }
  if (p.webhook.connectedAt) {
    lines.push({ at: t(p.webhook.connectedAt), text: `Delivery reports connected${p.webhook.connectedBy ? ` by ${p.webhook.connectedBy}` : ""}.` });
  }
  if (p.testEmail) {
    lines.push({
      at: p.testEmail.createdAt,
      text: p.testEmail.delivered
        ? `Test letter to ${p.testEmail.toEmail} reported delivered. The bees came.`
        : `Test letter to ${p.testEmail.toEmail}: ${p.testEmail.status}.`,
    });
  }
  return lines.filter((l) => Number.isFinite(l.at)).sort((a, b) => b.at - a.at);
}
