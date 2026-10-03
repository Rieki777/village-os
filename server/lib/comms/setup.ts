/**
 * THE COMMS SETUP CHECKLIST: thirteen things a founder supplies, each one
 * readable as done or not, in plain words (the comms build spec 5.15).
 *
 * Rye, 2026-10-02: "For all the things you need from me (all founders would
 * need to add them) add them all in the admin setup for the comms so that
 * founders can add/edit these vital details." So every item says what it is,
 * whether it is done, what is true right now (`detail`) and what to do next
 * (`fix`), and the Settings screen puts an editor under each one.
 *
 * SIX ARE REQUIRED, and they are what "ready" means everywhere: the module's
 * readiness reader, the Overview's banner, and the three email rows on the
 * launch journey all read this one list (items 1 to 5 and 13). A launch row
 * and a checklist item that disagreed would be two answers to one question.
 *
 *   1 the provider key            8  the tick-box words
 *   2 a verified sending domain   9  the two recap questions
 *   3 the sender name and address 10 who runs comms
 *   4 delivery reports            11 the investor words reviewed
 *   5 the postal address          12 the rehearsal inbox
 *   6 a reply-to inbox per path   13 a test email, delivered
 *   7 who writes back per path
 *
 * PURE AT THE CENTRE. `buildChecklist` takes facts and answers items, so every
 * rule here is tested without a database. `gatherSetupFacts` reads the facts a
 * pool and the secrets store can see, and a route adds the three that need the
 * member list (who holds the power, members' names, the admins' addresses).
 */
import type { Pool } from "mysql2/promise";
import {
  DEFAULT_CONSENT_TEXT,
  DEFAULT_RECAP_QUESTIONS,
  REQUIRED_SETUP_KEYS,
  SETUP_KEYS,
  addressOnDomain,
  type CommsSettings,
  type SetupItem,
  type SetupKey,
} from "../../../shared/comms/settings";
import { GAME_CONFIG } from "../../../shared/gameConfig";
import { readConfigDocument } from "../../repos/appConfigDocs";
import { lastDeliveryReportAt, latestTestEmail, type TestEmailRow } from "../../repos/commsOverview";
import { secretStatus as storedSecretStatus } from "../secrets";
import { effectiveSender, readCommsSettings, senderParts } from "./settings";

// The checklist's vocabulary is shared with the Settings screen, which keys an
// editor by each item (shared/comms/settings.ts).
export { REQUIRED_SETUP_KEYS, SETUP_KEYS, type SetupItem, type SetupKey };

/** The four inboxes in the `email-config` document, by the pathway each serves. */
export type InboxKey = "investor" | "steward" | "resident" | "prosperity";

/** Which inbox answers for each default path. A path a fork adds has none. */
export const PATH_INBOX: Readonly<Record<string, InboxKey>> = {
  investor: "investor",
  steward: "steward",
  resident: "resident",
  "prosperity-creator": "prosperity",
};

export interface SecretFacts {
  configured: boolean;
  source: "admin" | "env" | "none";
  last4: string | null;
}

export interface SetupFacts {
  settings: CommsSettings;
  key: SecretFacts;
  webhookSecret: SecretFacts;
  /** The From line the post office would send under, and where it comes from. */
  sender: { line: string; source: "admin" | "env" | "none" };
  inboxes: Record<InboxKey, string>;
  paths: Array<{ id: string; label: string }>;
  testEmail: TestEmailRow | null;
  /** Epoch seconds of the last delivery report of any kind. */
  lastReportAt: number | null;
  /** Names of the members who hold `comms.manage`. Null when the reader had no member list. */
  holders: string[] | null;
  /** User id to name, for the path contacts. Null when the reader had no member list. */
  memberNames: Record<string, string> | null;
  /** The admins' addresses, the rehearsal inbox's default. Null when the reader had no member list. */
  adminEmails: string[] | null;
}

/** "a, b and c". */
function listed(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function keyItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const k = f.key;
  const fix =
    "Make a key at resend.com/api-keys and paste it here. A key with full access lets this screen set up the domain and delivery reports for you.";
  if (!k.configured) {
    return { key: "api-key", label: "The Resend API key", done: false, detail: "No key yet. Without one, no email leaves this village.", fix };
  }
  const ending = k.last4 ? `, ending in ${k.last4}` : "";
  return {
    key: "api-key",
    label: "The Resend API key",
    done: true,
    detail: k.source === "env" ? `Set in the host's settings as RESEND_API_KEY${ending}.` : `Saved here${ending}.`,
    fix: "Paste a new key here to replace it. The old one stops being used at once.",
  };
}

function domainItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const s = f.settings;
  const label = "Sending domain";
  if (!s.domain) {
    return {
      key: "domain",
      label,
      done: false,
      detail: "No sending domain yet.",
      fix: "Add the domain your email will come from. This screen shows the DNS records to add at your DNS host.",
    };
  }
  if (s.domainStatus === "verified") {
    return {
      key: "domain",
      label,
      done: true,
      detail: s.domainConfirmedBy
        ? `${s.domain} is verified, as ${s.domainConfirmedBy} confirmed by hand.`
        : `${s.domain} is verified.`,
      fix: "Add a different domain here if the village moves its email.",
    };
  }
  if (!s.domainId) {
    return {
      key: "domain",
      label,
      done: false,
      detail: `${s.domain} is saved. This key cannot ask Resend about it.`,
      fix: "Verify it in Resend's dashboard, then confirm it here. The steps are shown below.",
    };
  }
  if (s.domainStatus === "failed" || s.domainStatus === "temporary_failure") {
    return {
      key: "domain",
      label,
      done: false,
      detail: `Resend could not find the DNS records for ${s.domain} yet.`,
      fix: "Check each record below against your DNS host, then press Check verification.",
    };
  }
  return {
    key: "domain",
    label,
    done: false,
    detail: `${s.domain} is waiting for its DNS records.`,
    fix: "Add the records below at your DNS host, then press Check verification. DNS can take a few minutes, sometimes a few hours.",
  };
}

function senderItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const label = "Sender name and address";
  const fix = "Give the name people see and an address on your sending domain.";
  const { line, source } = f.sender;
  if (!line) {
    return { key: "sender", label, done: false, detail: "No sender yet. With none, nothing is sent.", fix };
  }
  // The line is what is sent, so the name is read from it and never from the
  // saved `senderName` alone: a bare address in the line goes out bare.
  const parts = senderParts(line);
  const from = source === "env" ? " It comes from the host's EMAIL_FROM setting." : "";
  if (!parts.name) {
    return { key: "sender", label, done: false, detail: `Sending as ${line}, with no name beside it.${from}`, fix };
  }
  if (!f.settings.domain) {
    return {
      key: "sender",
      label,
      done: false,
      detail: `Sending as ${line}. Add the sending domain so the address can be checked against it.${from}`,
      fix: "Add the sending domain above.",
    };
  }
  if (!addressOnDomain(parts.address, f.settings.domain)) {
    return {
      key: "sender",
      label,
      done: false,
      detail: `${parts.address} is not on ${f.settings.domain}, so Resend will not deliver it.${from}`,
      fix: `Use an address that ends in @${f.settings.domain}.`,
    };
  }
  return { key: "sender", label, done: true, detail: `Sending as ${line}.${from}`, fix: "Change the name or the address here." };
}

function reportsItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const label = "Delivery reports";
  if (!f.webhookSecret.configured) {
    return {
      key: "delivery-reports",
      label,
      done: false,
      detail: "Not connected. Without them, a bounced address keeps being written to and nobody hears about it.",
      fix: "Press Connect delivery reports. If your key cannot do that, the steps to do it by hand are shown.",
    };
  }
  const who =
    f.webhookSecret.source === "env"
      ? "Connected through the host's RESEND_WEBHOOK_SECRET setting."
      : f.settings.webhookConnectedBy
        ? `Connected by ${f.settings.webhookConnectedBy}.`
        : "Connected.";
  const heard = f.lastReportAt ? " Reports are arriving." : " No report has arrived yet. The first one comes after the next email.";
  return { key: "delivery-reports", label, done: true, detail: who + heard, fix: "Connect again only if the webhook was removed in Resend." };
}

function postalItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const label = "Postal address for the footer";
  return f.settings.postalAddress.trim()
    ? { key: "postal-address", label, done: true, detail: "Every email's footer carries it.", fix: "Change it here." }
    : {
        key: "postal-address",
        label,
        done: false,
        detail: "No postal address yet. Every email's footer needs one.",
        fix: "Write the village's postal address the way you would on an envelope.",
      };
}

function replyToItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const label = "Reply-to inbox for each path";
  const missing = f.paths.filter((p) => PATH_INBOX[p.id] && !String(f.inboxes[PATH_INBOX[p.id]] ?? "").trim()).map((p) => p.label);
  return missing.length === 0
    ? { key: "reply-to", label, done: true, detail: "Each path has its own inbox for replies and form answers.", fix: "Change any inbox here." }
    : {
        key: "reply-to",
        label,
        done: false,
        detail: `${listed(missing)} ${missing.length === 1 ? "has" : "have"} no inbox, so replies go to the sender address.`,
        fix: "Add an inbox for each path. Several people can share one, separated by commas.",
      };
}

function contactsItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const label = "Who writes back for each path";
  // A contact who is no longer a present member is nobody to write back, so
  // they count as unnamed when the member list is known.
  const named = (pathId: string): boolean => {
    const id = f.settings.pathContacts[pathId];
    return !!id && (f.memberNames === null || id in f.memberNames);
  };
  const missing = f.paths.filter((p) => !named(p.id)).map((p) => p.label);
  if (missing.length === 0) {
    const who = f.memberNames ? f.paths.map((p) => `${f.memberNames![f.settings.pathContacts[p.id]]} for ${p.label}`) : [];
    return {
      key: "path-contacts",
      label,
      done: true,
      detail: who.length ? `${listed(who)}.` : "Every path has a person who writes back.",
      fix: "Choose a different member for any path here.",
    };
  }
  return {
    key: "path-contacts",
    label,
    done: false,
    detail: `Nobody is named for ${listed(missing)}. Their three-week check-in goes to the path's inbox instead.`,
    fix: "Choose the member who writes back to people on each path.",
  };
}

function consentItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  return {
    key: "consent-words",
    label: "The words beside the tick-box on public forms",
    done: true,
    detail: f.settings.consentText === DEFAULT_CONSENT_TEXT ? "Using the platform's words." : "Using your own words.",
    fix: "Write them in your own voice, or keep the platform's.",
  };
}

function recapItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const own =
    f.settings.recapQuestions[0] !== DEFAULT_RECAP_QUESTIONS[0] || f.settings.recapQuestions[1] !== DEFAULT_RECAP_QUESTIONS[1];
  return {
    key: "recap-questions",
    label: "The two recap questions",
    done: true,
    detail: own ? "Using your own questions." : "Using the platform's questions.",
    fix: "The first is answered yes or no with one click, the second with a few words.",
  };
}

function holdersItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const label = "Who runs comms";
  const fix = "Give a role the power to run comms in Game Roles, and seat the people who will do it.";
  if (f.holders === null) {
    return { key: "who-runs-comms", label, done: false, detail: "Open Comms Settings to see who holds it.", fix };
  }
  if (f.holders.length === 0) {
    return { key: "who-runs-comms", label, done: false, detail: "Only the admins run comms so far.", fix };
  }
  return { key: "who-runs-comms", label, done: true, detail: `${listed(f.holders)} ${f.holders.length === 1 ? "holds" : "hold"} it through a role.`, fix };
}

function investorItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const r = f.settings.investorWordsReviewed;
  return r
    ? {
        key: "investor-words",
        label: "Investor words reviewed",
        done: true,
        detail: `Reviewed by ${r.by}. The investor path sends all of its emails.`,
        fix: "Clear the review if the words change and need another read.",
      }
    : {
        key: "investor-words",
        label: "Investor words reviewed",
        done: false,
        detail: "Not reviewed yet. Until it is, the investor path sends only its welcome and its three-week check-in.",
        fix: "Read the investor path's emails in Words, then mark them reviewed here.",
      };
}

function rehearsalItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const named = f.settings.rehearsalTo;
  const detail = named.length
    ? `Rehearsals go to ${listed(named)}.`
    : f.adminEmails && f.adminEmails.length
      ? `Rehearsals go to the admins: ${listed(f.adminEmails)}.`
      : "Rehearsals go to the admins.";
  return {
    key: "rehearsal-inbox",
    label: "Rehearsal inbox",
    done: true,
    detail,
    fix: "While comms is in preview, every gathering, path and letter email goes here instead of to the person.",
  };
}

/** The latest test email counts once the provider says it arrived. */
export function testEmailDelivered(t: TestEmailRow | null): boolean {
  if (!t) return false;
  return t.status === "delivered" || (t.status === "sent" && t.deliveredReport);
}

function testItem(f: SetupFacts): Omit<SetupItem, "n" | "required"> {
  const label = "A test email to yourself, delivered";
  const t = f.testEmail;
  const fix = "Send yourself a test. It counts once the delivery report says it arrived.";
  if (!t) return { key: "test-email", label, done: false, detail: "No test sent yet.", fix };
  if (testEmailDelivered(t)) {
    return { key: "test-email", label, done: true, detail: `Delivered to ${t.toEmail}.`, fix: "Send another whenever something changes." };
  }
  if (t.status === "sent") {
    return {
      key: "test-email",
      label,
      done: false,
      detail: `Sent to ${t.toEmail}. Waiting for the delivery report.`,
      fix: "The report comes back through delivery reports, so connect those first if they are not.",
    };
  }
  if (t.status === "skipped") {
    return {
      key: "test-email",
      label,
      done: false,
      detail:
        t.skipReason === "not_configured"
          ? "Not sent, because the key or the sender was missing."
          : `Not sent (${t.skipReason ?? "no reason recorded"}).`,
      fix,
    };
  }
  if (t.status === "bounced") return { key: "test-email", label, done: false, detail: `It bounced at ${t.toEmail}.`, fix };
  if (t.status === "complained") return { key: "test-email", label, done: false, detail: "It was marked as spam.", fix };
  if (t.status === "failed") {
    return { key: "test-email", label, done: false, detail: `Resend did not take it. ${t.lastError ?? ""}`.trim(), fix };
  }
  return { key: "test-email", label, done: false, detail: `It is ${t.status}.`, fix };
}

/** The thirteen items, in the spec's order, from the facts. Pure. */
export function buildChecklist(f: SetupFacts): SetupItem[] {
  const parts = [
    keyItem(f),
    domainItem(f),
    senderItem(f),
    reportsItem(f),
    postalItem(f),
    replyToItem(f),
    contactsItem(f),
    consentItem(f),
    recapItem(f),
    holdersItem(f),
    investorItem(f),
    rehearsalItem(f),
    testItem(f),
  ];
  return parts.map((p, i) => ({ ...p, n: i + 1, required: REQUIRED_SETUP_KEYS.includes(p.key) }));
}

/** Ready when every required item is done. */
export function readinessOf(items: readonly SetupItem[]): { ready: boolean; open: SetupItem[] } {
  const open = items.filter((i) => i.required && !i.done);
  return { ready: open.length === 0, open };
}

export interface GatherDeps {
  getPool(): Pool;
  /** A key's masked status. Defaults to the secrets store, which boot loads before anything asks. */
  secretStatus?(key: "resend_api_key" | "resend_webhook_secret"): SecretFacts;
  env?: NodeJS.ProcessEnv;
}

/**
 * Every fact a pool and the secrets store can see. The three that need the
 * member list come back null for a caller to fill in.
 */
export async function gatherSetupFacts(deps: GatherDeps): Promise<SetupFacts> {
  const pool = deps.getPool();
  const env = deps.env ?? process.env;
  const status =
    deps.secretStatus ??
    ((key: "resend_api_key" | "resend_webhook_secret"): SecretFacts => {
      const s = storedSecretStatus(key, env);
      return { configured: s.configured, source: s.source, last4: s.last4 };
    });
  const [settings, emailConfig, testEmail, lastReportAt] = await Promise.all([
    readCommsSettings(pool),
    readConfigDocument<Record<string, unknown>>(pool, "email-config"),
    latestTestEmail(pool),
    lastDeliveryReportAt(pool),
  ]);
  const inbox = (k: InboxKey): string => (typeof emailConfig?.[k] === "string" ? String(emailConfig[k]).trim() : "");
  return {
    settings,
    key: status("resend_api_key"),
    webhookSecret: status("resend_webhook_secret"),
    sender: effectiveSender(emailConfig?.sender, env.EMAIL_FROM),
    inboxes: { investor: inbox("investor"), steward: inbox("steward"), resident: inbox("resident"), prosperity: inbox("prosperity") },
    paths: GAME_CONFIG.paths.map((p) => ({ id: p.id, label: p.label })),
    testEmail,
    lastReportAt,
    holders: null,
    memberNames: null,
    adminEmails: null,
  };
}

/** The first letter lowered, for a label inside a sentence. */
const inSentence = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1);

/**
 * The module's readiness (5.16): ready once items 1 to 5 and 13 are done, and
 * otherwise a hint naming what is still open.
 */
export async function commsReadiness(deps: GatherDeps): Promise<{ ready: boolean; hint: string; open: SetupKey[] }> {
  const { ready, open } = readinessOf(buildChecklist(await gatherSetupFacts(deps)));
  return {
    ready,
    hint: ready ? "Comms is set up" : `Finish the checklist in Comms Settings first. Still open: ${listed(open.map((i) => inSentence(i.label)))}`,
    open: open.map((i) => i.key),
  };
}

/** The launch journey's three email rows, read from the same items the checklist shows. */
export const LAUNCH_SETUP_KEYS = { sender: "sender", domain: "domain", "delivery-reports": "delivery-reports" } as const;

/**
 * One launch row's state (shared/launchRequirements.ts, checkKey `comms:<name>`).
 * Null for a name with no row, which the launch resolver reports as a
 * platform bug rather than dropping.
 */
export async function commsLaunchCheck(
  deps: GatherDeps,
  name: string,
): Promise<{ state: "ok" | "missing"; detail: string } | null> {
  const key = (LAUNCH_SETUP_KEYS as Record<string, SetupKey>)[name];
  if (!key) return null;
  const item = buildChecklist(await gatherSetupFacts(deps)).find((i) => i.key === key);
  if (!item) return null;
  return { state: item.done ? "ok" : "missing", detail: item.detail };
}
